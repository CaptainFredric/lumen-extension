import {
  LUMEN_CONFIG,
  STORAGE_KEYS,
  buildOriginPattern,
  getDefaultSettings,
  getFeatureAccess,
  getCaptureVariants,
  isOriginPermissionSupported,
  requiresOriginPermission
} from "./config.js";

const ui = {
  captureButton: document.querySelector("#captureButton"),
  analyzeButton: document.querySelector("#analyzeButton"),
  removeStickyHeaders: document.querySelector("#removeStickyHeaders"),
  forceLazyLoad: document.querySelector("#forceLazyLoad"),
  autoRedact: document.querySelector("#autoRedact"),
  deviceButtons: [...document.querySelectorAll("[data-device]")],
  exportButtons: [...document.querySelectorAll("[data-export]")],
  statusPanel: document.querySelector("#statusPanel"),
  statusEyebrow: document.querySelector("#statusEyebrow"),
  statusTitle: document.querySelector("#statusTitle"),
  statusDetail: document.querySelector("#statusDetail"),
  statusBadge: document.querySelector("#statusBadge"),
  progressFill: document.querySelector("#progressFill"),
  signInButton: document.querySelector("#signInButton"),
  signOutButton: document.querySelector("#signOutButton"),
  billingButton: document.querySelector("#billingButton"),
  proChips: [...document.querySelectorAll("[data-pro-feature]")],
  backendBadge: document.querySelector("#backendBadge"),
  accountTitle: document.querySelector("#accountTitle"),
  accountDescription: document.querySelector("#accountDescription"),
  accountPlan: document.querySelector("#accountPlan"),
  accountSource: document.querySelector("#accountSource"),
  blueprintTimestamp: document.querySelector("#blueprintTimestamp"),
  blueprintEmpty: document.querySelector("#blueprintEmpty"),
  blueprintContent: document.querySelector("#blueprintContent"),
  blueprintHost: document.querySelector("#blueprintHost"),
  blueprintTitle: document.querySelector("#blueprintTitle"),
  blueprintDescription: document.querySelector("#blueprintDescription"),
  blueprintSiteType: document.querySelector("#blueprintSiteType"),
  blueprintHeadline: document.querySelector("#blueprintHeadline"),
  blueprintCta: document.querySelector("#blueprintCta"),
  blueprintNav: document.querySelector("#blueprintNav"),
  metricSections: document.querySelector("#metricSections"),
  metricHeadings: document.querySelector("#metricHeadings"),
  metricButtons: document.querySelector("#metricButtons"),
  metricForms: document.querySelector("#metricForms"),
  metricVisuals: document.querySelector("#metricVisuals"),
  metricWords: document.querySelector("#metricWords"),
  colorStrip: document.querySelector("#colorStrip"),
  fontStrip: document.querySelector("#fontStrip"),
  historyCount: document.querySelector("#historyCount"),
  historyEmpty: document.querySelector("#historyEmpty"),
  historyList: document.querySelector("#historyList")
};

let currentSettings = getDefaultSettings();
let actionBusy = false;
let currentSession = {
  signedIn: false,
  plan: "free",
  source: "local",
  backendReachable: false
};

bootstrap().catch((error) => {
  showStatus({
    tone: "error",
    eyebrow: "Boot",
    title: "Popup initialization failed",
    detail: error.message,
    badge: "Error",
    progress: 0
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "LUMEN_CAPTURE_PROGRESS") {
    const payload = message.payload || {};

    showStatus({
      tone: payload.stage === "done" ? "success" : "neutral",
      eyebrow: stageToEyebrow(payload.stage),
      title: payload.title || "Working",
      detail: payload.detail || "",
      badge: stageToBadge(payload.stage),
      progress: payload.progress ?? 0.08
    });
  }

  if (message?.type === "LUMEN_BLUEPRINT_UPDATED") {
    renderBlueprint(message.payload);
  }

  if (message?.type === "LUMEN_SESSION_UPDATED") {
    renderSession(message.payload);
  }

  if (message?.type === "LUMEN_HISTORY_UPDATED") {
    renderHistory(message.payload || []);
  }
});

async function bootstrap() {
  applyProGates();
  await restoreSettings();
  bindEvents();
  await restoreAppState();
}

function bindEvents() {
  ui.removeStickyHeaders.addEventListener("change", persistCurrentSettings);
  ui.forceLazyLoad.addEventListener("change", persistCurrentSettings);
  ui.autoRedact.addEventListener("change", persistCurrentSettings);

  for (const button of ui.deviceButtons) {
    button.addEventListener("click", () => {
      currentSettings.devicePreset = button.dataset.device;
      updateDeviceButtons();
      persistCurrentSettings();
    });
  }

  for (const button of ui.exportButtons) {
    button.addEventListener("click", () => {
      currentSettings.exportPreset = button.dataset.export;
      updateExportButtons();
      persistCurrentSettings();
    });
  }

  ui.captureButton.addEventListener("click", handleCaptureClick);
  ui.analyzeButton.addEventListener("click", handleAnalyzeClick);
  ui.signInButton.addEventListener("click", handleSignIn);
  ui.signOutButton.addEventListener("click", handleSignOut);
  ui.billingButton.addEventListener("click", handleBillingClick);
}

async function restoreSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.settings);
  currentSettings = {
    ...getDefaultSettings(),
    ...(stored[STORAGE_KEYS.settings] || {})
  };

  ui.removeStickyHeaders.checked = Boolean(currentSettings.removeStickyHeaders);
  ui.forceLazyLoad.checked = Boolean(currentSettings.forceLazyLoad);
  ui.autoRedact.checked = Boolean(currentSettings.autoRedact);
  updateDeviceButtons();
  updateExportButtons();
}

async function restoreAppState() {
  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_BOOTSTRAP_APP"
  });

  if (!response?.ok) {
    renderBlueprint(null);
    renderHistory([]);
    renderSession(currentSession);
    return;
  }

  renderBlueprint(response.latestBlueprint);
  renderHistory(response.captureHistory || []);
  renderSession(response.session || currentSession);
}

async function persistCurrentSettings() {
  currentSettings = {
    removeStickyHeaders: ui.removeStickyHeaders.checked,
    forceLazyLoad: ui.forceLazyLoad.checked,
    autoRedact: ui.autoRedact.checked,
    devicePreset: currentSettings.devicePreset,
    exportPreset: currentSettings.exportPreset
  };

  await chrome.storage.sync.set({
    [STORAGE_KEYS.settings]: currentSettings
  });
}

function updateDeviceButtons() {
  for (const button of ui.deviceButtons) {
    button.classList.toggle("is-active", button.dataset.device === currentSettings.devicePreset);
  }
}

function updateExportButtons() {
  for (const button of ui.exportButtons) {
    button.classList.toggle("is-active", button.dataset.export === currentSettings.exportPreset);
  }
}

function applyProGates() {
  for (const chip of ui.proChips) {
    const feature = chip.dataset.proFeature;
    const enabled = getFeatureAccess(feature);

    chip.classList.toggle("is-locked", !enabled);
    chip.disabled = !enabled;
  }
}

async function handleCaptureClick() {
  if (actionBusy) {
    return;
  }

  setActionBusy(true);
  await persistCurrentSettings();

  showStatus({
    tone: "neutral",
    eyebrow: "Capture",
    title: "Queueing capture",
    detail: "Passing your capture and export settings into the pipeline.",
    badge: "Queued",
    progress: 0.05
  });

  try {
    if (!(await ensurePermissionsForCurrentCapture())) {
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_START_CAPTURE",
      payload: {
        options: currentSettings
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Capture failed.");
    }

    showStatus({
      tone: "success",
      eyebrow: "Saved",
      title: "Capture complete",
      detail: buildCaptureSuccessMessage(response, currentSettings.devicePreset),
      badge: "Ready",
      progress: 1
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Error",
      title: "Capture failed",
      detail: error.message,
      badge: "Failed",
      progress: 0.12
    });
  } finally {
    setActionBusy(false);
  }
}

async function handleAnalyzeClick() {
  if (actionBusy) {
    return;
  }

  setActionBusy(true);

  showStatus({
    tone: "neutral",
    eyebrow: "Inspect",
    title: "Analyzing current page",
    detail: "Lumen is extracting colors, typography, layout density, and CTA signals.",
    badge: "Inspect",
    progress: 0.08
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_ANALYZE_PAGE"
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Analysis failed.");
    }

    renderBlueprint(response.blueprint);

    showStatus({
      tone: "success",
      eyebrow: "Inspect",
      title: "Brand Blueprint ready",
      detail: `${response.blueprint.colors.length} palette colors and ${response.blueprint.typography.families.length} type families extracted.`,
      badge: "Ready",
      progress: 1
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Inspect",
      title: "Analysis failed",
      detail: error.message,
      badge: "Failed",
      progress: 0.12
    });
  } finally {
    setActionBusy(false);
  }
}

async function ensurePermissionsForCurrentCapture() {
  if (!requiresOriginPermission(currentSettings.devicePreset)) {
    return true;
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  if (!tab?.url || !isOriginPermissionSupported(tab.url)) {
    return true;
  }

  const origin = buildOriginPattern(tab.url);
  const contains = await chrome.permissions.contains({
    origins: [origin]
  });

  if (contains) {
    return true;
  }

  showStatus({
    tone: "neutral",
    eyebrow: "Permission",
    title: "Viewport capture needs site access",
    detail: "Chrome will ask for access to this site so Lumen can open temporary tablet or mobile viewports and inject the capture script there.",
    badge: "Prompt",
    progress: 0.06
  });

  const granted = await chrome.permissions.request({
    origins: [origin]
  });

  if (!granted) {
    showStatus({
      tone: "error",
      eyebrow: "Permission",
      title: "Site access denied",
      detail: "Tablet, mobile, and responsive set capture need temporary permission for this site. Desktop capture still works without it.",
      badge: "Blocked",
      progress: 0.08
    });
  }

  return granted;
}

async function handleSignIn() {
  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_DEMO_SIGN_IN"
  });

  if (!response?.ok) {
    showStatus({
      tone: "error",
      eyebrow: "Auth",
      title: "Session bootstrap failed",
      detail: response?.error?.description || "The demo session could not be started.",
      badge: "Failed",
      progress: 0.12
    });
    return;
  }

  renderSession(response.session);
  renderHistory(response.captureHistory || []);

  showStatus({
    tone: "success",
    eyebrow: "Auth",
    title: "Demo session started",
    detail: response.session.source === "remote"
      ? "Connected to the backend slice and ready to sync captures."
      : "Backend was not reachable, so Lumen started a local demo session and kept working.",
    badge: "Ready",
    progress: 1
  });
}

async function handleSignOut() {
  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_SIGN_OUT"
  });

  if (!response?.ok) {
    return;
  }

  renderSession(response.session);
  showStatus({
    tone: "neutral",
    eyebrow: "Auth",
    title: "Signed out",
    detail: "Lumen returned to a free local session.",
    badge: "Idle",
    progress: 0.08
  });
}

function handleBillingClick() {
  showStatus({
    tone: "neutral",
    eyebrow: "Billing",
    title: "Billing endpoint reserved",
    detail: "The UI contract is in place, but the demo backend does not implement a billing portal yet.",
    badge: "Soon",
    progress: 0.12
  });
}

function renderSession(session) {
  currentSession = session || currentSession;

  const signedIn = Boolean(currentSession?.signedIn);
  const plan = currentSession?.plan || "free";
  const source = currentSession?.source || "local";
  const backendReachable = Boolean(currentSession?.backendReachable);

  ui.accountTitle.textContent = signedIn
    ? `${currentSession.user?.name || "Lumen user"}`
    : "Free local session";
  ui.accountDescription.textContent = signedIn
    ? backendReachable
      ? "Session is connected to the backend slice. New captures can sync into history."
      : "Session is active, but the backend was not reachable. Lumen keeps state locally and will still archive captures in this browser."
    : "Start a demo session to unlock the first backend slice: session state and capture history sync when an API is reachable.";
  ui.accountPlan.textContent = plan.replace(/-/g, " ");
  ui.accountSource.textContent = source;
  ui.backendBadge.textContent = backendReachable ? "Backend reachable" : "Local-first";
  ui.signInButton.classList.toggle("is-hidden", signedIn);
  ui.signOutButton.classList.toggle("is-hidden", !signedIn);
  ui.billingButton.disabled = !signedIn || !/pro/i.test(plan);
}

function renderHistory(history) {
  const items = Array.isArray(history) ? history : [];
  ui.historyCount.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
  ui.historyList.replaceChildren();

  if (!items.length) {
    ui.historyEmpty.classList.remove("is-hidden");
    ui.historyList.classList.add("is-hidden");
    return;
  }

  ui.historyEmpty.classList.add("is-hidden");
  ui.historyList.classList.remove("is-hidden");

  for (const item of items.slice(0, 5)) {
    const row = document.createElement("article");
    row.className = "history-item";

    const topRow = document.createElement("div");
    topRow.className = "history-head";

    const title = document.createElement("strong");
    title.textContent = item.title || item.host || "Untitled capture";

    const badge = document.createElement("span");
    badge.className = "tiny-note";
    badge.textContent = item.exportPreset || "raw";

    topRow.append(title, badge);

    const meta = document.createElement("p");
    meta.className = "history-meta";
    meta.textContent = [
      item.host || "",
      formatTimestamp(item.capturedAt),
      item.variants?.length ? `${item.variants.length} view${item.variants.length === 1 ? "" : "s"}` : "",
      `${item.files?.length || 0} file${item.files?.length === 1 ? "" : "s"}`,
      item.redactionCount ? `${item.redactionCount} redaction${item.redactionCount === 1 ? "" : "s"}` : "",
      item.blueprintSummary?.siteType || ""
    ]
      .filter(Boolean)
      .join(" · ");

    row.append(topRow, meta);
    ui.historyList.appendChild(row);
  }
}

function renderBlueprint(blueprint) {
  if (!blueprint) {
    ui.blueprintTimestamp.textContent = "No analysis yet";
    ui.blueprintEmpty.classList.remove("is-hidden");
    ui.blueprintContent.classList.add("is-hidden");
    return;
  }

  ui.blueprintTimestamp.textContent = formatTimestamp(blueprint.generatedAt);
  ui.blueprintEmpty.classList.add("is-hidden");
  ui.blueprintContent.classList.remove("is-hidden");
  ui.blueprintHost.textContent = blueprint.page.host || "Unknown host";
  ui.blueprintTitle.textContent = blueprint.page.title || "Untitled page";
  ui.blueprintDescription.textContent =
    blueprint.page.description ||
    `${blueprint.identity.siteType} with ${blueprint.layout.sections} sections, ${blueprint.layout.visuals} visuals, and ${blueprint.layout.words} words.`;
  ui.blueprintSiteType.textContent = blueprint.identity.siteType || "Unknown";
  ui.blueprintHeadline.textContent =
    blueprint.identity.heroHeadline || "No hero headline detected.";
  ui.blueprintCta.textContent = blueprint.identity.primaryCta || "No primary CTA detected.";
  ui.blueprintNav.textContent =
    blueprint.identity.navLabels?.join(" · ") || "No visible navigation labels detected.";
  ui.metricSections.textContent = formatCompactNumber(blueprint.layout.sections);
  ui.metricHeadings.textContent = formatCompactNumber(blueprint.layout.headings);
  ui.metricButtons.textContent = formatCompactNumber(blueprint.layout.buttons);
  ui.metricForms.textContent = formatCompactNumber(blueprint.layout.forms);
  ui.metricVisuals.textContent = formatCompactNumber(blueprint.layout.visuals);
  ui.metricWords.textContent = formatCompactNumber(blueprint.layout.words);

  renderColorStrip(blueprint.colors || []);
  renderFontStrip(blueprint.typography?.families || []);
}

function renderColorStrip(colors) {
  ui.colorStrip.replaceChildren();

  if (!colors.length) {
    ui.colorStrip.textContent = "No strong palette extracted.";
    return;
  }

  for (const color of colors) {
    const node = document.createElement("div");
    node.className = "color-chip";

    const swatch = document.createElement("span");
    swatch.className = "color-swatch";
    swatch.style.background = color.hex;

    const label = document.createElement("span");
    label.className = "color-label";
    label.textContent = color.hex;

    node.append(swatch, label);
    ui.colorStrip.appendChild(node);
  }
}

function renderFontStrip(fonts) {
  ui.fontStrip.replaceChildren();

  if (!fonts.length) {
    ui.fontStrip.textContent = "No type families extracted.";
    return;
  }

  for (const font of fonts) {
    const node = document.createElement("div");
    node.className = "font-chip";
    node.style.fontFamily = `"${font.family}", "IBM Plex Sans", sans-serif`;
    node.textContent = font.family;
    ui.fontStrip.appendChild(node);
  }
}

function showStatus({ tone, eyebrow, title, detail, badge, progress }) {
  ui.statusPanel.classList.remove("is-hidden");
  ui.statusPanel.dataset.tone = tone;
  ui.statusEyebrow.textContent = eyebrow;
  ui.statusTitle.textContent = title;
  ui.statusDetail.textContent = detail;
  ui.statusBadge.textContent = badge;
  ui.progressFill.style.width = `${Math.max(4, Math.round(progress * 100))}%`;
}

function setActionBusy(isBusy) {
  actionBusy = isBusy;
  ui.captureButton.disabled = isBusy;
  ui.analyzeButton.disabled = isBusy;
}

function stageToEyebrow(stage) {
  if (stage === "inspect") {
    return "Inspect";
  }

  if (stage === "sanitize") {
    return "Sanitize";
  }

  return "Capture";
}

function stageToBadge(stage) {
  switch (stage) {
    case "prepare":
      return "Prep";
    case "inspect":
      return "Inspect";
    case "sanitize":
      return "Sanitize";
    case "capture":
      return "Capture";
    case "stitch":
      return "Studio";
    case "save":
      return "Save";
    case "done":
      return "Ready";
    default:
      return "Working";
  }
}

function formatTimestamp(rawValue) {
  if (!rawValue) {
    return "No analysis yet";
  }

  const date = new Date(rawValue);

  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function buildCaptureSuccessMessage(response, devicePreset) {
  const fileText = `${response.files.length} file${response.files.length === 1 ? "" : "s"} saved using ${response.exportPreset} export mode`;
  const variantCount = response.variantCount || getCaptureVariants(devicePreset).length;

  if (!response.redactionCount) {
    return variantCount > 1 ? `${fileText}. ${variantCount} responsive views captured.` : `${fileText}.`;
  }

  return `${fileText}. ${variantCount > 1 ? `${variantCount} responsive views captured. ` : ""}${response.redactionCount} sensitive region${response.redactionCount === 1 ? "" : "s"} sanitized.`;
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value || 0);
}
