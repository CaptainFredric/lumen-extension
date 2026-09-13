import {
  STORAGE_KEYS, buildOriginPattern, getDefaultSettings, getSyncSafeSettings,
  isRestrictedCaptureUrl, requiresOriginPermission
} from "./config.js";
import { listLibraryCaptures } from "./library-store.js";
import { applyPrivacyShieldToCaptureSettings, readAppSettings } from "./settings-store.js";

const ui = Object.fromEntries([...document.querySelectorAll("[id]")].map(node => [node.id, node]));
const scopes = {
  desktop: ["Capture full page", "Capture the page from top to bottom."],
  visible: ["Capture visible area", "Capture only what is visible in this tab."],
  area: ["Select an area", "Choose the part of the page that matters."],
  responsive: ["Capture responsive set", "Desktop, tablet, and mobile views in one capture set."]
};
let settings = getDefaultSettings();
let appSettings;
let scope = "desktop";
let target;
let busy = false;
let jobActive = false;
let lastCapture;
let reviewDecision;
let permissionLease = "";

async function send(type, payload) {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response?.ok) throw new Error(response?.error?.description || response?.error || "Lumen could not complete this action.");
  return response;
}

function report(message, error = false) {
  ui.statusDetail.textContent = message;
  ui.statusDetail.dataset.error = String(error);
}

function renderControls() {
  ui.captureControls.disabled = busy || jobActive || !target;
  ui.captureButton.disabled = busy || jobActive || !target;
  ui.jobPanel.hidden = !jobActive;
  ui.autoRedact.disabled = Boolean(appSettings?.privacyShieldEnabled);
  ui.privacyModeHint.hidden = !appSettings?.privacyShieldEnabled;
  ui.areaControls.hidden = scope !== "area";
  ui.captureButton.textContent = scopes[scope][0];
  ui.scopeHint.textContent = scopes[scope][1];
  for (const button of document.querySelectorAll("[data-scope]")) {
    button.setAttribute("aria-pressed", String(button.dataset.scope === scope));
  }
}

async function refreshTarget() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const active = tabs.find(tab => tab.active);
  const ownTab = await chrome.tabs.getCurrent();
  // A popup opened as an extension page is useful for development. Never fall
  // back to another website when the actual active tab is Chrome-protected.
  const candidate = ownTab && ownTab.id === active?.id
    ? tabs.filter(tab => /^https?:/.test(tab.url || "")).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0]
    : active;
  target = candidate?.url && /^https?:/.test(candidate.url) && !isRestrictedCaptureUrl(candidate.url) ? candidate : null;
  ui.targetHost.textContent = target ? new URL(target.url).host : "Current page";
  ui.launchStatusTitle.textContent = target ? "Ready to capture" : "Open a webpage first";
  ui.launchStatusDetail.textContent = target
    ? "Choose a scope. Review and export the result afterward."
    : "Chrome protects internal pages and the Web Store. Open a regular website to capture it.";
  renderControls();
}

async function refreshLastCapture() {
  const records = await listLibraryCaptures({ limit: 1 });
  lastCapture = records[0] || null;
  ui.lastCapture.dataset.captureId = lastCapture?.id || "";
  ui.lastCaptureTitle.textContent = lastCapture?.title || "Your next capture will appear here.";
  ui.lastCaptureMeta.textContent = lastCapture
    ? [lastCapture.host, String(lastCapture.variantCount || 1) + (lastCapture.variantCount > 1 ? " views" : " view"), new Date(lastCapture.capturedAt).toLocaleString()].join(" · ")
    : "";
  ui.openLastCaptureButton.hidden = !lastCapture;
}

async function refreshJob() {
  const { job } = await send("LUMEN_GET_CAPTURE_JOB");
  jobActive = Boolean(job?.active);
  if (jobActive) {
    ui.launchStatusTitle.textContent = job.title || "Capturing";
    ui.launchStatusDetail.textContent = job.detail || "You can close this popup. Capture continues in the background.";
    ui.captureProgress.value = job.progress || 0;
    ui.cancelCaptureButton.disabled = Boolean(job.cancelRequested);
  }
  renderControls();
}

async function persistSafeguards() {
  // Patch only launcher-owned preferences. Notes and export defaults belong
  // to other surfaces and must survive this UI migration unchanged.
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.settings);
  settings = applyPrivacyShieldToCaptureSettings({
    ...getDefaultSettings(), ...stored[STORAGE_KEYS.settings],
    removeStickyHeaders: ui.removeStickyHeaders.checked,
    forceLazyLoad: ui.forceLazyLoad.checked,
    autoRedact: ui.autoRedact.checked
  }, await readAppSettings());
  await chrome.storage.sync.set({ [STORAGE_KEYS.settings]: getSyncSafeSettings(settings) });
  ui.autoRedact.checked = settings.autoRedact;
}

async function releasePermission() {
  const origin = permissionLease;
  permissionLease = "";
  if (!origin) return;
  const stored = await chrome.storage.local.get(STORAGE_KEYS.watchPlans);
  const used = (stored[STORAGE_KEYS.watchPlans] || []).some(plan => {
    try { return buildOriginPattern(plan.url) === origin; } catch { return false; }
  });
  if (!used) await chrome.permissions.remove({ origins: [origin] });
}

function askReview(review) {
  ui.launchStatusTitle.textContent = "Check before saving";
  ui.exportReviewSummary.textContent = String(review.variantCount || 1) + ((review.variantCount || 1) === 1 ? " view. " : " views. ") +
    String(review.redactionCount || 0) + " sensitive regions detected.";
  renderExportReviewVariants(review.variants || []);
  renderExportReviewWarnings(review.warnings || []);
  ui.exportReviewPanel.showModal();
  ui.exportReviewCancelButton.focus();
  return new Promise(resolve => { reviewDecision = resolve; });
}

function finishReview(approved) {
  const resolve = reviewDecision;
  reviewDecision = null;
  ui.exportReviewPanel.close();
  resolve?.(approved);
}

async function capture() {
  if (busy || jobActive) return;
  busy = true;
  renderControls();
  report("");
  try {
    await refreshTarget();
    if (!target) throw new Error("Open a regular webpage before capturing.");
    appSettings = await readAppSettings();
    await persistSafeguards();
    const privateValues = await chrome.storage.local.get(STORAGE_KEYS.privateSettings);
    const options = applyPrivacyShieldToCaptureSettings({
      ...settings,
      annotationText: privateValues[STORAGE_KEYS.privateSettings]?.annotationText || "",
      devicePreset: scope === "responsive" ? "responsive" : "desktop",
      captureMode: scope === "visible" ? "visible" : "fullPage"
    }, appSettings);
    if (requiresOriginPermission(options.devicePreset)) {
      const origin = buildOriginPattern(target.url);
      if (!await chrome.permissions.contains({ origins: [origin] })) {
        if (!await chrome.permissions.request({ origins: [origin] })) {
          throw new Error("Responsive capture needs temporary access to this site.");
        }
        permissionLease = origin;
      }
    }
    await chrome.tabs.update(target.id, { active: true });
    if (scope === "area") {
      await send("LUMEN_START_CUTAWAY_PICKER", {
        selectionMode: document.querySelector('input[name="shape"]:checked').value
      });
      report("Selection tools are open on the page. Choose Capture now or save the area.");
      return;
    }
    ui.launchStatusTitle.textContent = "Checking the page";
    const review = await send("LUMEN_PREVIEW_EXPORT_REVIEW", { options });
    if (appSettings.reviewBeforeSave || review.requiresConfirmation) {
      if (!await askReview(review)) {
        report("Capture cancelled. Your settings are unchanged.");
        return;
      }
    }
    // The worker also enforces current settings and owns cleanup after dispatch.
    jobActive = true;
    renderControls();
    const response = await send("LUMEN_START_CAPTURE", {
      options: { ...options, permissionLeaseOrigin: permissionLease }
    });
    permissionLease = "";
    report(response.librarySaved === false
      ? "Files saved. The local result could not be retained; check Downloads."
      : "Capture saved. Open the result to inspect, annotate, or export it.");
    await refreshLastCapture();
  } catch (error) {
    report(error.message, true);
  } finally {
    await releasePermission().catch(error => report("Check site access in Settings: " + error.message, true));
    busy = false;
    await refreshJob().catch(() => { jobActive = false; });
    if (!jobActive) await refreshTarget();
    renderControls();
  }
}

for (const button of document.querySelectorAll("[data-scope]")) {
  button.addEventListener("click", () => { scope = button.dataset.scope; renderControls(); });
}
for (const key of ["removeStickyHeaders", "forceLazyLoad", "autoRedact"]) {
  ui[key].addEventListener("change", () => persistSafeguards().catch(error => report(error.message, true)));
}
ui.captureButton.addEventListener("click", capture);
ui.cancelCaptureButton.addEventListener("click", async () => {
  ui.cancelCaptureButton.disabled = true;
  try { await send("LUMEN_CANCEL_CAPTURE"); report("Stopping at the next safe step and restoring the page."); }
  catch (error) { ui.cancelCaptureButton.disabled = false; report(error.message, true); }
});
ui.openLastCaptureButton.addEventListener("click", () => {
  if (lastCapture) send("LUMEN_OPEN_CAPTURE_RESULT", { captureId: lastCapture.id }).catch(error => report(error.message, true));
});
ui.exportReviewConfirmButton.addEventListener("click", () => finishReview(true));
ui.exportReviewCancelButton.addEventListener("click", () => finishReview(false));
ui.exportReviewPanel.addEventListener("cancel", event => { event.preventDefault(); finishReview(false); });
for (const button of document.querySelectorAll("[data-review-adjust]")) {
  button.addEventListener("click", async () => {
    const action = button.dataset.reviewAdjust;
    if (action !== "mark" && !confirm("Clear the saved " + (action === "clear" ? "redaction boxes" : "selected area") + " for this page?")) return;
    finishReview(false);
    try {
      await chrome.tabs.update(target.id, { active: true });
      await send(action === "mark" ? "LUMEN_START_REDACTION_PICKER"
        : action === "clear" ? "LUMEN_CLEAR_MANUAL_REDACTIONS" : "LUMEN_CLEAR_CUTAWAY_REGION");
      report(action === "mark" ? "Mark private areas on the page, then capture again."
        : "Saved selection cleared. Start another capture when ready.");
    } catch (error) { report(error.message, true); }
  });
}
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "LUMEN_CAPTURE_PROGRESS") {
    const progress = message.payload || {};
    ui.launchStatusTitle.textContent = progress.title || "Capturing";
    ui.launchStatusDetail.textContent = progress.detail || "";
    ui.captureProgress.value = progress.progress || 0;
    refreshJob().catch(error => report(error.message, true));
  }
  if (["LUMEN_LIBRARY_UPDATED", "LUMEN_HISTORY_UPDATED"].includes(message?.type)) {
    refreshLastCapture().catch(error => report(error.message, true));
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEYS.activeCaptureJob]) {
    refreshJob().catch(error => report(error.message, true));
  }
});

async function bootstrap() {
  await send("LUMEN_BOOTSTRAP_APP");
  appSettings = await readAppSettings();
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.settings);
  settings = applyPrivacyShieldToCaptureSettings({ ...getDefaultSettings(), ...stored[STORAGE_KEYS.settings] }, appSettings);
  scope = settings.devicePreset === "responsive" ? "responsive" : "desktop";
  for (const key of ["removeStickyHeaders", "forceLazyLoad", "autoRedact"]) ui[key].checked = Boolean(settings[key]);
  await refreshTarget();
  await refreshLastCapture();
  await refreshJob();
}
bootstrap().catch(error => report(error.message, true));

function renderExportReviewVariants(variants) {
  ui.exportReviewVariants.replaceChildren();

  if (!variants.length) {
    const empty = document.createElement("p");
    empty.className = "review-summary";
    empty.textContent = "View checks were unavailable.";
    ui.exportReviewVariants.append(empty);
    return;
  }

  for (const variant of variants) {
    const row = document.createElement("div");
    row.className = "review-variant-row";

    const label = document.createElement("strong");
    label.textContent = variant.label || titleCase(variant.id || "View");

    const metrics = document.createElement("span");
    metrics.textContent = [
      variant.dimensions?.viewportWidth && variant.dimensions?.viewportHeight
        ? `${variant.dimensions.viewportWidth}x${variant.dimensions.viewportHeight}`
        : "",
      `${variant.autoRedactionCount || 0} auto`,
      formatReviewVariantManual(variant),
      formatReviewVariantCutaway(variant)
    ]
      .filter(Boolean)
      .join(" | ");

    const detail = document.createElement("p");
    detail.textContent = buildReviewVariantDetail(variant);

    row.append(label, metrics, buildReviewPreviewMap(variant), detail);
    ui.exportReviewVariants.append(row);
  }
}

function buildReviewPreviewMap(variant) {
  const preview = variant.preview || {};
  const pageWidth = Math.max(1, Number(preview.pageWidth) || variant.dimensions?.viewportWidth || 1);
  const pageHeight = Math.max(1, Number(preview.pageHeight) || variant.dimensions?.pageHeight || 1);
  const viewportHeight = Math.max(1, Number(preview.viewportHeight) || variant.dimensions?.viewportHeight || 1);
  const map = document.createElement("div");
  const surface = document.createElement("div");
  const legend = document.createElement("div");
  const frame = document.createElement("span");

  map.className = "review-preview-map";
  surface.className = "review-preview-surface";
  legend.className = "review-preview-legend";
  frame.className = "review-preview-viewport";
  frame.style.height = `${clampPercent(viewportHeight / pageHeight * 100, 8, 100)}%`;
  surface.append(frame);

  for (const region of preview.regions || []) {
    const box = document.createElement("span");
    box.className = `review-preview-box review-preview-box-${region.role || "auto"}`;
    box.title = formatPreviewRegionTitle(region);
    box.style.left = `${clampPercent(region.left / pageWidth * 100)}%`;
    box.style.top = `${clampPercent(region.top / pageHeight * 100)}%`;
    box.style.width = `${clampPercent(region.width / pageWidth * 100, 1.6, 100)}%`;
    box.style.height = `${clampPercent(region.height / pageHeight * 100, 1.4, 100)}%`;
    surface.append(box);
  }

  legend.append(
    buildReviewLegendItem("Sensitive", "auto"),
    buildReviewLegendItem("Manual", "manual"),
    buildReviewLegendItem("Selected Area", "cutaway")
  );
  map.append(surface, legend);

  return map;
}

function buildReviewLegendItem(label, role) {
  const item = document.createElement("span");
  const marker = document.createElement("i");
  const text = document.createElement("span");

  item.className = "review-preview-legend-item";
  marker.className = `review-preview-legend-dot review-preview-legend-dot-${role}`;
  text.textContent = label;
  item.append(marker, text);

  return item;
}

function formatPreviewRegionTitle(region) {
  const role = region.role === "cutaway" ? "Selected Area" : titleCase(region.role || "region");
  const size = `${Math.round(region.width || 0)}x${Math.round(region.height || 0)}`;
  const projection = region.projection ? `, ${region.projection}` : "";

  return `${role} ${size}${projection}`;
}

function renderExportReviewWarnings(warnings) {
  ui.exportReviewWarnings.replaceChildren();

  if (!warnings.length) {
    const item = document.createElement("div");
    item.className = "review-warning-item";

    const label = document.createElement("strong");
    label.textContent = "Ready to save";

    const copy = document.createElement("p");
    copy.textContent = "View setup, marked areas, and long-page output are ready.";

    item.append(label, copy);
    ui.exportReviewWarnings.append(item);
    return;
  }

  for (const warning of warnings) {
    const item = document.createElement("div");
    item.className = "review-warning-item";

    const label = document.createElement("strong");
    label.textContent = "Needs review";

    const copy = document.createElement("p");
    copy.textContent = warning;

    item.append(label, copy);
    ui.exportReviewWarnings.append(item);
  }
}

function formatReviewVariantManual(variant) {
  const storedCount = variant.manualStoredCount || 0;

  if (!storedCount) {
    return "manual 0";
  }

  return `${variant.manualAppliedCount || 0}/${storedCount} manual`;
}

function formatReviewVariantCutaway(variant) {
  if (!variant.cutawayStored) {
    return "no selected area";
  }

  if (!variant.cutawayApplied) {
    return "selected area skipped";
  }

  const projection = variant.cutawayRegion?.projection || "resolved";
  return `selected area ${projection}`;
}

function buildReviewVariantDetail(variant) {
  const manualText = formatProjectionStats("manual", variant.manualProjectionStats);
  const cutawayText = formatProjectionStats("selected area", variant.cutawayResolutionStats);
  const cutawaySize = variant.cutawayRegion?.width && variant.cutawayRegion?.height
    ? ` Selected Area ${variant.cutawayRegion.width}x${variant.cutawayRegion.height}.`
    : "";

  return `${manualText || "Manual boxes: 0 for this view."} ${cutawayText || "No area selected for this view."}${cutawaySize}`;
}

function formatProjectionStats(label, stats = {}) {
  const projectedCount = Number.isFinite(stats.projectedCount) ? Math.max(0, Math.round(stats.projectedCount)) : 0;
  const directCount = Number.isFinite(stats.directCount) ? Math.max(0, Math.round(stats.directCount)) : 0;
  const skippedCount = Number.isFinite(stats.skippedCount) ? Math.max(0, Math.round(stats.skippedCount)) : 0;
  const appliedCount = Number.isFinite(stats.appliedCount) ? Math.max(0, Math.round(stats.appliedCount)) : projectedCount + directCount;
  const parts = [];

  if (!stats.storedCount) {
    return "";
  }

  if (projectedCount) {
    parts.push(`${projectedCount} projected`);
  }

  if (directCount) {
    parts.push(`${directCount} direct`);
  }

  if (skippedCount) {
    parts.push(`${skippedCount} skipped`);
  }

  return `${titleCase(label)}: ${appliedCount} applied${parts.length ? `, ${parts.join(", ")}` : ""}.`;
}

function clampPercent(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Number(value.toFixed(3))));
}

function titleCase(value = "") {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}
