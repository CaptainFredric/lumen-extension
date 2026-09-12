import { STORAGE_KEYS, buildOriginPattern, isRestrictedCaptureUrl } from "./config.js";
import { readAppSettings } from "./settings-store.js";

const get = id => document.getElementById(id);
let areas = [];
let plans = [];
let runs = [];
let saving = false;
let editingPlan = null;

async function request(type, payload) {
  const result = await chrome.runtime.sendMessage({ type, payload });
  if (!result?.ok) throw new Error(result?.error?.description || result?.error || "Monitor action failed.");
  return result;
}
function status(text) { get("monitorStatus").textContent = text; }
function route() {
  const monitors = location.hash === "#monitors";
  get("monitors").hidden = !monitors;
  get("captures").hidden = monitors;
  for (const link of document.querySelectorAll(".workspace-nav a")) {
    link.setAttribute("aria-current", link.hash === (monitors ? "#monitors" : "#captures") ? "page" : "false");
  }
}
function scheduleFields() {
  const mode = get("monitorMode").value;
  get("monitorDelayField").hidden = mode !== "once";
  get("monitorIntervalField").hidden = mode === "once";
  get("monitorLimitField").hidden = mode !== "continuous";
  get("monitorChangedField").hidden = mode === "once";
  get("monitorInterval").min = mode === "repeat" ? "15" : "1";
  if (mode === "repeat" && Number(get("monitorInterval").value) < 15) get("monitorInterval").value = "15";
  get("monitorEstimate").textContent = mode === "once" ? "Maximum: one capture."
    : mode === "continuous" ? "Maximum: " + get("monitorLimit").value + " captures."
    : "Repeats until you pause or delete this monitor.";
}
async function refresh() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.cutawayRegions, STORAGE_KEYS.watchPlans, STORAGE_KEYS.watchRuns]);
  plans = stored[STORAGE_KEYS.watchPlans] || [];
  runs = stored[STORAGE_KEYS.watchRuns] || [];
  areas = Object.values(stored[STORAGE_KEYS.cutawayRegions] || {}).filter(record =>
    record.region && /^https?:/.test(record.url || "") && !isRestrictedCaptureUrl(record.url));
  const selection = get("monitorArea").value;
  get("monitorArea").replaceChildren();
  if (!areas.length) get("monitorArea").append(new Option("Save an area from the Lumen toolbar first", ""));
  if (editingPlan && !areas.some(area => area.url === editingPlan.url)) areas.push(editingPlan);
  for (const [index, record] of areas.entries()) {
    const url = new URL(record.url);
    const region = record.region;
    get("monitorArea").append(new Option(
      url.host + url.pathname + " · " + (region.shape === "lasso" ? "Lasso" : "Rectangle") +
      " · " + Math.round(region.width) + " × " + Math.round(region.height), String(index)));
  }
  if ([...get("monitorArea").options].some(option => option.value === selection)) get("monitorArea").value = selection;
  get("monitorList").replaceChildren();
  if (!plans.length) {
    const empty = document.createElement("p");
    empty.textContent = "No monitors saved. Scheduled capture starts only when you choose it.";
    get("monitorList").append(empty);
  }
  for (const plan of plans) {
    const card = document.createElement("article");
    card.className = "monitor-card";
    const title = document.createElement("h3");
    title.textContent = plan.title || new URL(plan.url).host;
    const detail = document.createElement("p");
    const latest = runs.find(run => run.watchPlanId === plan.id);
    detail.textContent = [plan.status,
      plan.schedule?.mode === "once" ? "Once at " + new Date(plan.schedule.runAt).toLocaleString()
        : "Every " + plan.schedule?.intervalMinutes + " minutes",
      plan.schedule?.maxRuns ? String(plan.runCount || 0) + " of " + plan.schedule.maxRuns + " runs" : "",
      latest ? "Last run: " + latest.status : "No runs yet"].filter(Boolean).join(" · ");
    card.append(title, detail);
    for (const [label, action] of [
      ["Edit schedule", "edit"], ["Run now", "run"],
      [plan.status === "active" ? "Pause" : plan.status === "completed" ? "Restart" : "Resume", "toggle"],
      ["Delete", "delete"]
    ]) {
      const button = document.createElement("button");
      button.className = "quiet-button";
      button.textContent = label;
      button.type = "button";
      button.addEventListener("click", () => act(plan, action, button).catch(error => status(error.message)));
      card.append(button);
    }
    get("monitorList").append(card);
  }
}
async function allowOrigin(url) {
  const origin = buildOriginPattern(url);
  if (await chrome.permissions.contains({ origins: [origin] })) return "";
  if (!await chrome.permissions.request({ origins: [origin] })) throw new Error("Site access was declined. No monitor was started.");
  return origin;
}
async function releaseUnused(origin) {
  if (!origin) return;
  const stored = await chrome.storage.local.get(STORAGE_KEYS.watchPlans);
  if (!(stored[STORAGE_KEYS.watchPlans] || []).some(plan => buildOriginPattern(plan.url) === origin)) {
    await chrome.permissions.remove({ origins: [origin] });
  }
}
async function act(plan, action, button) {
  if (action === "edit") {
    editingPlan = plan;
    await refresh();
    get("monitorArea").value = String(areas.findIndex(area => area.url === plan.url));
    get("monitorArea").disabled = true;
    get("monitorMode").value = plan.schedule?.mode || "once";
    get("monitorInterval").value = String(plan.schedule?.intervalMinutes || 60);
    get("monitorDelay").value = String(plan.schedule?.delaySeconds || 5);
    get("monitorLimit").value = String(plan.schedule?.maxRuns > 1 ? plan.schedule.maxRuns : 25);
    get("monitorChanged").checked = Boolean(plan.schedule?.saveOnlyWhenChanged);
    get("cancelMonitorEdit").hidden = false;
    scheduleFields();
    get("monitorMode").focus();
    status("Editing " + plan.title + ". Saving restarts the schedule and run count.");
    return;
  }
  button.disabled = true;
  let lease = "";
  try {
    if (action === "delete" && !confirm("Delete this monitor? Saved captures will remain in the Library.")) return;
    if (action === "run" || (action === "toggle" && plan.status !== "active")) {
      if ((await readAppSettings()).privacyShieldEnabled) throw new Error("Private review mode pauses unattended capture. Change it in Settings before running a monitor.");
      lease = await allowOrigin(plan.url);
    }
    const type = action === "run" ? "LUMEN_RUN_WATCH_PLAN_NOW"
      : action === "delete" ? "LUMEN_DELETE_WATCH_PLAN" : "LUMEN_UPDATE_WATCH_PLAN";
    await request(type, {
      watchPlanId: plan.id,
      ...(action === "toggle" ? { patch: {
        status: plan.status === "active" ? "paused" : "active", explicitOptIn: true,
        ...(plan.status === "completed" ? {
          runCount: 0,
          schedule: { ...plan.schedule, runAt: plan.schedule?.mode === "once"
            ? new Date(Date.now() + Math.max(5, plan.schedule.delaySeconds || 5) * 1000).toISOString() : "" }
        } : {})
      } } : {})
    });
    status(action === "run" ? "Monitor run finished. Find its saved output in Captures." : "Monitor updated.");
    await refresh();
  } catch (error) { status(error.message); }
  finally { await releaseUnused(lease).catch(error => status(error.message)); button.disabled = false; }
}
get("monitorForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (saving || !areas.length) return;
  saving = true;
  const submit = event.submitter;
  submit.disabled = true;
  let lease = "";
  try {
    if ((await readAppSettings()).privacyShieldEnabled) throw new Error("Private review mode pauses unattended capture. Change it in Settings first.");
    const area = editingPlan || areas[Number(get("monitorArea").value)];
    if (!area) throw new Error("Choose a saved area.");
    lease = await allowOrigin(area.url);
    const mode = get("monitorMode").value;
    const delaySeconds = Number(get("monitorDelay").value);
    const payload = {
      title: new URL(area.url).host + new URL(area.url).pathname,
      url: area.url, region: area.region,
      selectionMode: area.region.shape === "lasso" ? "lasso" : "rect",
      status: "active", destination: "local", explicitOptIn: true,
      schedule: {
        mode, delaySeconds,
        intervalMinutes: Number(get("monitorInterval").value),
        maxRuns: mode === "once" ? 1 : mode === "continuous" ? Number(get("monitorLimit").value) : 0,
        saveOnlyWhenChanged: mode !== "once" && get("monitorChanged").checked,
        runAt: mode === "once" ? new Date(Date.now() + delaySeconds * 1000).toISOString() : "",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local"
      }
    };
    await request(editingPlan ? "LUMEN_UPDATE_WATCH_PLAN" : "LUMEN_SAVE_WATCH_PLAN",
      editingPlan ? { watchPlanId: editingPlan.id, patch: { ...payload, runCount: 0 } } : payload);
    editingPlan = null;
    get("monitorArea").disabled = false;
    get("cancelMonitorEdit").hidden = true;
    status("Monitor saved. Manage it here; its captures appear in the Library.");
    await refresh();
  } catch (error) { status(error.message); }
  finally { await releaseUnused(lease).catch(error => status(error.message)); saving = false; submit.disabled = false; }
});
get("monitorMode").addEventListener("change", scheduleFields);
get("cancelMonitorEdit").addEventListener("click", () => {
  editingPlan = null;
  get("monitorArea").disabled = false;
  get("cancelMonitorEdit").hidden = true;
  status("Schedule unchanged.");
  refresh().catch(error => status(error.message));
});
get("monitorLimit").addEventListener("input", scheduleFields);
window.addEventListener("hashchange", route);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && [STORAGE_KEYS.cutawayRegions, STORAGE_KEYS.watchPlans, STORAGE_KEYS.watchRuns].some(key => changes[key])) {
    refresh().catch(error => status(error.message));
  }
});
route();
scheduleFields();
refresh().catch(error => status(error.message));
