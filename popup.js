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
  proChips: [...document.querySelectorAll("[data-pro-feature]")]
};

let currentSettings = getDefaultSettings();
let captureBusy = false;

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
  if (message?.type !== "LUMEN_CAPTURE_PROGRESS") {
    return;
  }

  const payload = message.payload || {};
  const tone = payload.stage === "done" ? "success" : "neutral";

  showStatus({
    tone,
    eyebrow: "Capture",
    title: payload.title || "Working",
    detail: payload.detail || "",
    badge: stageToBadge(payload.stage),
    progress: payload.progress ?? 0.08
  });
});

async function bootstrap() {
  applyProGates();
  await restoreSettings();
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
  if (captureBusy) {
    return;
  }

  captureBusy = true;
  ui.captureButton.disabled = true;

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
      detail: `${response.fileName} saved to Downloads with ${response.segmentCount} stitched slices.`,
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
    captureBusy = false;
    ui.captureButton.disabled = false;
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

function showStatus({ tone, eyebrow, title, detail, badge, progress }) {
  ui.statusPanel.classList.remove("is-hidden");
  ui.statusPanel.dataset.tone = tone;
  ui.statusEyebrow.textContent = eyebrow;
  ui.statusTitle.textContent = title;
  ui.statusDetail.textContent = detail;
  ui.statusBadge.textContent = badge;
  ui.progressFill.style.width = `${Math.max(4, Math.round(progress * 100))}%`;
}

function stageToBadge(stage) {
  switch (stage) {
    case "prepare":
      return "Prep";
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
