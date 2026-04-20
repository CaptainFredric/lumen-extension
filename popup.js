import {
  LUMEN_CONFIG,
  STORAGE_KEYS,
  buildOriginPattern,
  getDefaultSettings,
  getFeatureAccess,
  isOriginPermissionSupported
} from "./config.js";

const ui = {
  captureButton: document.querySelector("#captureButton"),
  analyzeButton: document.querySelector("#analyzeButton"),
  removeStickyHeaders: document.querySelector("#removeStickyHeaders"),
  forceLazyLoad: document.querySelector("#forceLazyLoad"),
  deviceButtons: [...document.querySelectorAll("[data-device]")],
  statusPanel: document.querySelector("#statusPanel"),
  statusEyebrow: document.querySelector("#statusEyebrow"),
  statusTitle: document.querySelector("#statusTitle"),
  statusDetail: document.querySelector("#statusDetail"),
  statusBadge: document.querySelector("#statusBadge"),
  progressFill: document.querySelector("#progressFill"),
  signInButton: document.querySelector("#signInButton"),
  billingButton: document.querySelector("#billingButton"),
  proChips: [...document.querySelectorAll("[data-pro-feature]")],
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
  fontStrip: document.querySelector("#fontStrip")
};

let currentSettings = getDefaultSettings();
let actionBusy = false;

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
});

async function bootstrap() {
  applyProGates();
  await restoreSettings();
  await restoreLatestBlueprint();
  bindEvents();
}

function bindEvents() {
  ui.removeStickyHeaders.addEventListener("change", persistCurrentSettings);
  ui.forceLazyLoad.addEventListener("change", persistCurrentSettings);

  for (const button of ui.deviceButtons) {
    button.addEventListener("click", () => {
      currentSettings.devicePreset = button.dataset.device;
      updateDeviceButtons();
      persistCurrentSettings();
    });
  }

  ui.captureButton.addEventListener("click", handleCaptureClick);
  ui.analyzeButton.addEventListener("click", handleAnalyzeClick);
  ui.signInButton.addEventListener("click", handleMockSignIn);
}

async function restoreSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.settings);
  currentSettings = {
    ...getDefaultSettings(),
    ...(stored[STORAGE_KEYS.settings] || {})
  };

  ui.removeStickyHeaders.checked = Boolean(currentSettings.removeStickyHeaders);
  ui.forceLazyLoad.checked = Boolean(currentSettings.forceLazyLoad);
  updateDeviceButtons();
}

async function restoreLatestBlueprint() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.latestBlueprint);
  renderBlueprint(stored[STORAGE_KEYS.latestBlueprint] || null);
}

async function persistCurrentSettings() {
  currentSettings = {
    removeStickyHeaders: ui.removeStickyHeaders.checked,
    forceLazyLoad: ui.forceLazyLoad.checked,
    devicePreset: currentSettings.devicePreset
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

function applyProGates() {
  for (const chip of ui.proChips) {
    const feature = chip.dataset.proFeature;
    const enabled = getFeatureAccess(feature);

    chip.classList.toggle("is-locked", !enabled);
    chip.disabled = !enabled;
  }

  ui.billingButton.disabled = !LUMEN_CONFIG.isProUser;
  ui.signInButton.textContent = LUMEN_CONFIG.isProUser
    ? "Pro account active"
    : "Continue with Google";
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
    detail: "Passing your current settings into the background pipeline.",
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
      detail: `${response.fileName} saved with ${response.segmentCount} stitched slices and the latest blueprint refreshed.`,
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
  if (currentSettings.devicePreset !== "mobile") {
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
    title: "Mobile capture needs site access",
    detail: "Chrome will ask for access to this site so Lumen can open the temporary mobile viewport and inject the capture script there.",
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
      detail: "Mobile capture needs temporary permission for this site. Desktop capture still works without it.",
      badge: "Blocked",
      progress: 0.08
    });
  }

  return granted;
}

async function handleMockSignIn() {
  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_MOCK_SIGN_IN"
  });

  showStatus({
    tone: "neutral",
    eyebrow: "Auth",
    title: "SaaS hook placeholder",
    detail: response?.notice || "Replace this with your real session bootstrap.",
    badge: "Mock",
    progress: 0.1
  });
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

  return "Capture";
}

function stageToBadge(stage) {
  switch (stage) {
    case "prepare":
      return "Prep";
    case "inspect":
      return "Inspect";
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

function formatCompactNumber(value) {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value || 0);
}
