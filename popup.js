import {
  LUMEN_CONFIG,
  STORAGE_KEYS,
  buildOriginPattern,
  getDefaultSettings,
  getFeatureAccess,
  getPlanEntitlements,
  getCaptureVariants,
  isOriginPermissionSupported,
  normalizeCaptureNoteOptions,
  requiresOriginPermission
} from "./config.js";

const ui = {
  launchPanel: document.querySelector("#launchPanel"),
  launchStatus: document.querySelector("#launchStatus"),
  launchStatusTitle: document.querySelector("#launchStatusTitle"),
  launchStatusDetail: document.querySelector("#launchStatusDetail"),
  captureButton: document.querySelector("#captureButton"),
  analyzeButton: document.querySelector("#analyzeButton"),
  holdMenu: document.querySelector("#holdMenu"),
  holdMenuActions: [...document.querySelectorAll("[data-quick-action]")],
  removeStickyHeaders: document.querySelector("#removeStickyHeaders"),
  forceLazyLoad: document.querySelector("#forceLazyLoad"),
  autoRedact: document.querySelector("#autoRedact"),
  manualRedactionCount: document.querySelector("#manualRedactionCount"),
  previewRedactionsButton: document.querySelector("#previewRedactionsButton"),
  startRedactionPickerButton: document.querySelector("#startRedactionPickerButton"),
  clearManualRedactionsButton: document.querySelector("#clearManualRedactionsButton"),
  redactionPreviewSummary: document.querySelector("#redactionPreviewSummary"),
  cutawayRegionStatus: document.querySelector("#cutawayRegionStatus"),
  startCutawayPickerButton: document.querySelector("#startCutawayPickerButton"),
  clearCutawayButton: document.querySelector("#clearCutawayButton"),
  explainCutawayPlanButton: document.querySelector("#explainCutawayPlanButton"),
  cutawaySummary: document.querySelector("#cutawaySummary"),
  exportManifest: document.querySelector("#exportManifest"),
  annotationEnabled: document.querySelector("#annotationEnabled"),
  annotationBlock: document.querySelector("#annotationBlock"),
  annotationText: document.querySelector("#annotationText"),
  annotationCounter: document.querySelector("#annotationCounter"),
  annotationRegionStatus: document.querySelector("#annotationRegionStatus"),
  startAnnotationPickerButton: document.querySelector("#startAnnotationPickerButton"),
  clearAnnotationButton: document.querySelector("#clearAnnotationButton"),
  annotationRegionSummary: document.querySelector("#annotationRegionSummary"),
  annotationPositionButtons: [...document.querySelectorAll("[data-annotation-position]")],
  deviceButtons: [...document.querySelectorAll("[data-device]")],
  exportButtons: [...document.querySelectorAll("[data-export]")],
  statusPanel: document.querySelector("#statusPanel"),
  statusEyebrow: document.querySelector("#statusEyebrow"),
  statusTitle: document.querySelector("#statusTitle"),
  statusDetail: document.querySelector("#statusDetail"),
  statusBadge: document.querySelector("#statusBadge"),
  progressFill: document.querySelector("#progressFill"),
  runViewSummary: document.querySelector("#runViewSummary"),
  runExportSummary: document.querySelector("#runExportSummary"),
  runSafetySummary: document.querySelector("#runSafetySummary"),
  runManifestSummary: document.querySelector("#runManifestSummary"),
  exportReviewPanel: document.querySelector("#exportReviewPanel"),
  exportReviewBadge: document.querySelector("#exportReviewBadge"),
  exportReviewSummary: document.querySelector("#exportReviewSummary"),
  reviewViewCount: document.querySelector("#reviewViewCount"),
  reviewAutoCount: document.querySelector("#reviewAutoCount"),
  reviewManualCount: document.querySelector("#reviewManualCount"),
  reviewCutawayCount: document.querySelector("#reviewCutawayCount"),
  exportReviewVariants: document.querySelector("#exportReviewVariants"),
  exportReviewWarnings: document.querySelector("#exportReviewWarnings"),
  exportReviewCancelButton: document.querySelector("#exportReviewCancelButton"),
  exportReviewConfirmButton: document.querySelector("#exportReviewConfirmButton"),
  timelineSteps: [...document.querySelectorAll("[data-stage-step]")],
  statusLog: document.querySelector("#statusLog"),
  statusLogCount: document.querySelector("#statusLogCount"),
  signInButton: document.querySelector("#signInButton"),
  signOutButton: document.querySelector("#signOutButton"),
  billingButton: document.querySelector("#billingButton"),
  proChips: [...document.querySelectorAll("[data-pro-feature]")],
  backendBadge: document.querySelector("#backendBadge"),
  accountTitle: document.querySelector("#accountTitle"),
  accountDescription: document.querySelector("#accountDescription"),
  accountPlan: document.querySelector("#accountPlan"),
  accountSource: document.querySelector("#accountSource"),
  dataControlsSummary: document.querySelector("#dataControlsSummary"),
  retentionSelect: document.querySelector("#retentionSelect"),
  cloudSyncEnabled: document.querySelector("#cloudSyncEnabled"),
  deleteBackendDataButton: document.querySelector("#deleteBackendDataButton"),
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
let currentDataControls = {
  retentionDays: 90,
  cloudSyncEnabled: false,
  deleteSyncedCopiesOnAccountDelete: true,
  backendReachable: false
};
let manualRedactionRecord = {
  regions: []
};
let cutawayRegionRecord = {
  region: null,
  regions: []
};
let annotationRegionRecord = {
  region: null,
  regions: []
};
let statusEvents = [];
let holdTimer = null;
let suppressNextCaptureClick = false;
let launchActionsBlocked = false;
let launchTargetTab = null;
let latestHistoryItems = [];
let expandedHistoryId = "";
let exportReviewDecision = null;

const TIMELINE_STAGES = [
  "prepare",
  "inspect",
  "sanitize",
  "capture",
  "stitch",
  "save"
];
const HOLD_TO_OPEN_MS = 520;
const COLLAPSED_HISTORY_ID = "__collapsed__";

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
      stage: payload.stage,
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

  if (message?.type === "LUMEN_MANUAL_REDACTIONS_UPDATED") {
    renderManualRedactions(message.payload);
  }

  if (message?.type === "LUMEN_CUTAWAY_REGION_UPDATED") {
    renderCutawayRegion(message.payload);
  }

  if (message?.type === "LUMEN_ANNOTATION_REGION_UPDATED") {
    renderAnnotationRegion(message.payload);
  }
});

async function bootstrap() {
  await restoreSettings();
  bindEvents();
  await restoreAppState();
  applyPlanGates();
  await refreshLaunchStatus();
}

function bindEvents() {
  ui.removeStickyHeaders.addEventListener("change", persistCurrentSettings);
  ui.forceLazyLoad.addEventListener("change", persistCurrentSettings);
  ui.autoRedact.addEventListener("change", () => {
    if (ui.autoRedact.checked && !enforceFeatureAccess("autoRedact", "Auto-redaction")) {
      ui.autoRedact.checked = false;
    }

    persistCurrentSettings();
  });
  ui.exportManifest.addEventListener("change", persistCurrentSettings);
  ui.annotationEnabled.addEventListener("change", () => {
    updateAnnotationControls();
    persistCurrentSettings();
  });
  ui.annotationText.addEventListener("input", persistCurrentSettings);
  ui.previewRedactionsButton.addEventListener("click", handlePreviewRedactions);
  ui.startRedactionPickerButton.addEventListener("click", handleStartRedactionPicker);
  ui.clearManualRedactionsButton.addEventListener("click", handleClearManualRedactions);
  ui.startCutawayPickerButton.addEventListener("click", handleStartCutawayPicker);
  ui.clearCutawayButton.addEventListener("click", handleClearCutawayRegion);
  ui.explainCutawayPlanButton.addEventListener("click", handleExplainCutawayPlan);
  ui.startAnnotationPickerButton.addEventListener("click", handleStartAnnotationPicker);
  ui.clearAnnotationButton.addEventListener("click", handleClearAnnotationRegion);

  for (const button of ui.deviceButtons) {
    button.addEventListener("click", () => {
      if (button.dataset.device !== "desktop" && !enforceFeatureAccess("responsiveSnap", "Responsive capture")) {
        return;
      }

      currentSettings.devicePreset = button.dataset.device;
      updateDeviceButtons();
      persistCurrentSettings();
    });
  }

  for (const button of ui.exportButtons) {
    button.addEventListener("click", () => {
      if (button.dataset.export !== "raw" && !enforceFeatureAccess("beautify", "Poster export")) {
        return;
      }

      currentSettings.exportPreset = button.dataset.export;
      updateExportButtons();
      persistCurrentSettings();
    });
  }

  for (const button of ui.annotationPositionButtons) {
    button.addEventListener("click", () => {
      currentSettings.annotationPosition = button.dataset.annotationPosition;
      updateAnnotationControls();
      persistCurrentSettings();
    });
  }

  ui.captureButton.addEventListener("pointerdown", handleCapturePointerDown);
  ui.captureButton.addEventListener("pointerup", handleCapturePointerUp);
  ui.captureButton.addEventListener("pointerleave", handleCapturePointerCancel);
  ui.captureButton.addEventListener("pointercancel", handleCapturePointerCancel);
  ui.captureButton.addEventListener("keydown", handleCaptureKeyDown);
  ui.captureButton.addEventListener("click", handleCaptureButtonClick);
  ui.analyzeButton.addEventListener("click", handleAnalyzeClick);
  ui.holdMenu.addEventListener("click", handleQuickActionClick);
  ui.exportReviewCancelButton.addEventListener("click", () => settleExportReview(false));
  ui.exportReviewConfirmButton.addEventListener("click", () => settleExportReview(true));
  document.addEventListener("keydown", handleDocumentKeyDown);
  document.addEventListener("pointerdown", handleOutsidePointerDown);
  ui.signInButton.addEventListener("click", handleSignIn);
  ui.signOutButton.addEventListener("click", handleSignOut);
  ui.billingButton.addEventListener("click", handleBillingClick);
  ui.retentionSelect.addEventListener("change", handleRetentionChange);
  ui.cloudSyncEnabled.addEventListener("change", handleCloudSyncToggle);
  ui.deleteBackendDataButton.addEventListener("click", handleDeleteBackendData);
  ui.historyList.addEventListener("click", handleHistoryAction);
}

async function restoreSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.settings);
  currentSettings = {
    ...getDefaultSettings(),
    ...(stored[STORAGE_KEYS.settings] || {})
  };
  const captureNote = normalizeCaptureNoteOptions(currentSettings);
  currentSettings.annotationEnabled = captureNote.enabled;
  currentSettings.annotationText = captureNote.text;
  currentSettings.annotationPosition = captureNote.position;

  ui.removeStickyHeaders.checked = Boolean(currentSettings.removeStickyHeaders);
  ui.forceLazyLoad.checked = Boolean(currentSettings.forceLazyLoad);
  ui.autoRedact.checked = Boolean(currentSettings.autoRedact);
  ui.exportManifest.checked = Boolean(currentSettings.exportManifest);
  ui.annotationEnabled.checked = Boolean(currentSettings.annotationEnabled);
  ui.annotationText.value = currentSettings.annotationText || "";
  updateAnnotationCounter();
  updateDeviceButtons();
  updateExportButtons();
  updateAnnotationControls();
  renderRunSummary(currentSettings);
  renderTimeline("idle");
  renderStatusLog();
}

async function restoreAppState() {
  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_BOOTSTRAP_APP"
  });

  if (!response?.ok) {
    renderBlueprint(null);
    renderHistory([]);
    renderSession(currentSession);
    await refreshManualRedactions();
    await refreshCutawayRegion();
    renderDataControls(currentDataControls);
    return;
  }

  renderBlueprint(response.latestBlueprint);
  renderHistory(response.captureHistory || []);
  renderSession(response.session || currentSession);
  await refreshManualRedactions();
  await refreshCutawayRegion();
  await refreshAnnotationRegion();
  await refreshDataControls();
}

async function resolveActionTargetTab() {
  const tabs = await chrome.tabs.query({
    currentWindow: true
  });
  const currentWindowTarget = selectBestCaptureTarget(tabs);

  if (currentWindowTarget) {
    return currentWindowTarget;
  }

  const allTabs = await chrome.tabs.query({});
  return selectBestCaptureTarget(allTabs);
}

function selectBestCaptureTarget(tabs = []) {
  const activeTab = tabs.find((tab) => tab.active && tab?.url && isOriginPermissionSupported(tab.url));

  if (activeTab) {
    return activeTab;
  }

  return tabs
    .filter((tab) => tab?.url && isOriginPermissionSupported(tab.url))
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
}

async function ensureActionTargetReady(actionLabel = "run this action") {
  const tab = await resolveActionTargetTab();

  if (!tab) {
    renderLaunchStatus({
      state: "blocked",
      title: "Open a normal web page first",
      detail: "Lumen cannot run capture actions on Chrome, extension, or internal browser pages.",
      actionsBlocked: true
    });
    showStatus({
      tone: "error",
      eyebrow: "Blocked",
      title: "No capturable page",
      detail: `Open an http or https page before asking Lumen to ${actionLabel}.`,
      badge: "Blocked",
      progress: 0.08
    });
    return null;
  }

  launchTargetTab = tab;

  if (!tab.active && Number.isInteger(tab.id)) {
    await chrome.tabs.update(tab.id, {
      active: true
    });
  }

  renderLaunchStatus({
    state: "ready",
    title: `${formatTabHost(tab.url)} ready`,
    detail: "Target tab selected for the next Lumen action.",
    actionsBlocked: false
  });

  return tab;
}

async function persistCurrentSettings() {
  currentSettings = {
    removeStickyHeaders: ui.removeStickyHeaders.checked,
    forceLazyLoad: ui.forceLazyLoad.checked,
    autoRedact: ui.autoRedact.checked,
    exportManifest: ui.exportManifest.checked,
    annotationEnabled: ui.annotationEnabled.checked,
    annotationText: ui.annotationText.value,
    annotationPosition: currentSettings.annotationPosition,
    devicePreset: currentSettings.devicePreset,
    exportPreset: currentSettings.exportPreset
  };

  const captureNote = normalizeCaptureNoteOptions(currentSettings);
  currentSettings.annotationEnabled = captureNote.enabled;
  currentSettings.annotationText = captureNote.text;
  currentSettings.annotationPosition = captureNote.position;
  ui.annotationEnabled.checked = captureNote.enabled;
  updateAnnotationCounter();
  updateAnnotationControls();
  renderRunSummary(currentSettings);

  await chrome.storage.sync.set({
    [STORAGE_KEYS.settings]: currentSettings
  });
}

function updateAnnotationCounter() {
  if (!ui.annotationCounter) {
    return;
  }

  const noteLength = ui.annotationText?.value?.trim()?.length || 0;
  ui.annotationCounter.textContent = `${noteLength} / 180`;
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

function updateAnnotationControls() {
  const captureNote = normalizeCaptureNoteOptions(currentSettings);
  const enabled = Boolean(ui.annotationEnabled.checked);

  currentSettings.annotationEnabled = enabled;
  currentSettings.annotationPosition = captureNote.position;
  ui.annotationBlock.classList.toggle("is-disabled", !enabled);
  ui.annotationText.disabled = !enabled;

  for (const button of ui.annotationPositionButtons) {
    const isActive = button.dataset.annotationPosition === captureNote.position;
    button.classList.toggle("is-active", isActive);
    button.disabled = !enabled;
  }
}

function applyPlanGates() {
  const plan = currentSession?.plan || "free";
  const entitlements = currentSession?.entitlements || getPlanEntitlements(plan);

  for (const chip of ui.proChips) {
    const feature = chip.dataset.proFeature;
    const featureState = entitlements.features?.[feature];
    const enabled = Boolean(featureState?.available ?? getFeatureAccess(feature, plan));

    chip.classList.toggle("is-locked", !enabled);
    chip.disabled = !enabled;
    chip.title = enabled
      ? `${featureState?.label || feature} available on ${entitlements.label}.`
      : `${featureState?.label || feature} requires ${formatRequiredPlans(featureState?.requiredPlans)}.`;
    chip.setAttribute("aria-label", chip.title);
    chip.dataset.featureStatus = featureState?.status || "";
  }

  const canAutoRedact = getFeatureAccess("autoRedact", plan);
  const canResponsive = getFeatureAccess("responsiveSnap", plan);
  const canBeautify = getFeatureAccess("beautify", plan);

  ui.autoRedact.disabled = !canAutoRedact;

  if (!canAutoRedact && currentSettings.autoRedact) {
    currentSettings.autoRedact = false;
    ui.autoRedact.checked = false;
  }

  for (const button of ui.deviceButtons) {
    const requiresResponsive = button.dataset.device !== "desktop";
    button.disabled = requiresResponsive && !canResponsive;
    button.title = button.disabled
      ? "Responsive capture is available in Demo Pro and paid plans."
      : "";

    if (button.disabled && button.dataset.device === currentSettings.devicePreset) {
      currentSettings.devicePreset = "desktop";
    }
  }

  for (const button of ui.exportButtons) {
    const requiresBeautify = button.dataset.export !== "raw";
    button.disabled = requiresBeautify && !canBeautify;
    button.title = button.disabled
      ? "Poster export frames are available in Demo Pro and paid plans."
      : "";

    if (button.disabled && button.dataset.export === currentSettings.exportPreset) {
      currentSettings.exportPreset = "raw";
    }
  }

  updateDeviceButtons();
  updateExportButtons();
  renderRunSummary(currentSettings);
}

function enforceFeatureAccess(featureName, label) {
  if (getFeatureAccess(featureName, currentSession?.plan || "free")) {
    return true;
  }

  const entitlements = currentSession?.entitlements || getPlanEntitlements(currentSession?.plan || "free");
  const feature = entitlements.features?.[featureName];

  showStatus({
    tone: "neutral",
    eyebrow: "Plan",
    title: `${label} is locked`,
    detail: `Current plan: ${entitlements.label}. ${label} requires ${formatRequiredPlans(feature?.requiredPlans)}.`,
    badge: "Plan",
    progress: 0.12
  });

  return false;
}

function formatRequiredPlans(plans = []) {
  const labels = (plans.length ? plans : ["pro", "team", "enterprise"])
    .filter((plan) => plan !== "free")
    .map((plan) => plan.replace(/-/g, " "))
    .map((plan) => plan.replace(/\b\w/g, (letter) => letter.toUpperCase()));

  return labels.length ? labels.join(", ") : "a paid plan";
}

function handleCaptureButtonClick(event) {
  if (suppressNextCaptureClick) {
    event.preventDefault();
    suppressNextCaptureClick = false;
    return;
  }

  closeHoldMenu();
  handleCaptureClick();
}

function handleCapturePointerDown(event) {
  if (event.button !== 0 || actionBusy || ui.captureButton.disabled) {
    return;
  }

  clearHoldTimer();
  ui.captureButton.classList.add("is-holding");
  try {
    ui.captureButton.setPointerCapture?.(event.pointerId);
  } catch {
    // Synthetic smoke-test pointer events do not always create an active pointer.
  }

  holdTimer = window.setTimeout(() => {
    suppressNextCaptureClick = true;
    openHoldMenu("hold");
  }, HOLD_TO_OPEN_MS);
}

function handleCapturePointerUp(event) {
  clearHoldTimer();
  ui.captureButton.classList.remove("is-holding");
  try {
    ui.captureButton.releasePointerCapture?.(event.pointerId);
  } catch {
    // Safe to ignore when the pointer was not captured.
  }
}

function handleCapturePointerCancel(event) {
  clearHoldTimer();
  ui.captureButton.classList.remove("is-holding");
  try {
    ui.captureButton.releasePointerCapture?.(event.pointerId);
  } catch {
    // Safe to ignore when the pointer was not captured.
  }
}

function handleCaptureKeyDown(event) {
  if ((event.key === "ArrowDown" || event.key === "Menu") && !actionBusy) {
    event.preventDefault();
    openHoldMenu("keyboard");
  }

  if (event.key === "Escape") {
    closeHoldMenu();
  }
}

function handleDocumentKeyDown(event) {
  if (event.key === "Escape") {
    if (isExportReviewOpen()) {
      settleExportReview(false);
      return;
    }

    closeHoldMenu();
  }
}

function handleOutsidePointerDown(event) {
  if (!ui.launchPanel.contains(event.target)) {
    closeHoldMenu();
  }
}

async function handleQuickActionClick(event) {
  const button = event.target.closest("[data-quick-action]");

  if (!button || actionBusy) {
    return;
  }

  await runQuickAction(button.dataset.quickAction);
}

async function runQuickAction(action) {
  closeHoldMenu();

  if (action === "responsive") {
    currentSettings.devicePreset = "responsive";
    updateDeviceButtons();
    await persistCurrentSettings();
    await handleCaptureClick();
    return;
  }

  if (action === "redact") {
    await handlePreviewRedactions();
    return;
  }

  if (action === "mark") {
    await handleStartRedactionPicker();
    return;
  }

  if (action === "cutaway") {
    await handleStartCutawayPicker();
    return;
  }

  if (action === "annotate") {
    await handleStartAnnotationPicker();
    return;
  }

  if (action === "analyze") {
    await handleAnalyzeClick();
  }
}

function openHoldMenu(source = "hold") {
  if (launchActionsBlocked) {
    return;
  }

  clearHoldTimer();
  ui.captureButton.classList.remove("is-holding");
  ui.launchPanel.classList.add("is-menu-open");
  ui.holdMenu.setAttribute("aria-hidden", "false");
  ui.captureButton.setAttribute("aria-expanded", "true");
  renderLaunchStatus({
    state: "ready",
    title: source === "keyboard" ? "Quick actions open" : "Hold menu ready",
    detail: "Choose a capture action without digging through settings."
  });
}

function closeHoldMenu() {
  clearHoldTimer();
  ui.captureButton.classList.remove("is-holding");
  ui.launchPanel.classList.remove("is-menu-open");
  ui.holdMenu.setAttribute("aria-hidden", "true");
  ui.captureButton.setAttribute("aria-expanded", "false");
}

function clearHoldTimer() {
  if (!holdTimer) {
    return;
  }

  window.clearTimeout(holdTimer);
  holdTimer = null;
}

async function handleCaptureClick() {
  if (actionBusy) {
    return;
  }

  if (!(await ensureActionTargetReady("capture the page"))) {
    return;
  }

  await persistCurrentSettings();

  try {
    if (!(await ensurePermissionsForCurrentCapture())) {
      return;
    }

    const approved = await requestExportReviewBeforeCapture();

    if (!approved) {
      showStatus({
        tone: "neutral",
        stage: "inspect",
        eyebrow: "Review",
        title: "Export paused",
        detail: "Adjust settings, redaction boxes, or cutaway region before starting the export again.",
        badge: "Paused",
        progress: 0.18
      });
      return;
    }

    await runApprovedCapture();
  } catch (error) {
    showStatus({
      tone: "error",
      stage: "error",
      eyebrow: "Error",
      title: "Capture failed",
      detail: error.message,
      badge: "Failed",
      progress: 0.12
    });
    setActionBusy(false);
  }
}

async function runApprovedCapture() {
  setActionBusy(true);
  hideExportReview();
  statusEvents = [];
  renderRunSummary(currentSettings);
  renderTimeline("prepare");
  renderStatusLog();

  showStatus({
    tone: "neutral",
    stage: "prepare",
    eyebrow: "Capture",
    title: "Queueing capture",
    detail: "Passing the reviewed capture settings into the export pipeline.",
    badge: "Queued",
    progress: 0.05
  });

  try {
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
      stage: "done",
      eyebrow: "Saved",
      title: "Capture complete",
      detail: buildCaptureSuccessMessage(response, currentSettings),
      badge: "Ready",
      progress: 1
    });
  } catch (error) {
    showStatus({
      tone: "error",
      stage: "error",
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

async function requestExportReviewBeforeCapture() {
  setActionBusy(true);
  if (exportReviewDecision) {
    settleExportReview(false);
  }
  hideExportReview();

  showStatus({
    tone: "neutral",
    stage: "inspect",
    eyebrow: "Review",
    title: "Preparing export review",
    detail: "Checking requested viewports for auto-redaction, manual box projection, and cutaway resolution before saving.",
    badge: "Review",
    progress: 0.16
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_PREVIEW_EXPORT_REVIEW",
      payload: {
        options: currentSettings
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Export review could not be prepared.");
    }

    renderExportReview(response);

    showStatus({
      tone: "neutral",
      stage: "inspect",
      eyebrow: "Review",
      title: "Review before export",
      detail: buildExportReviewStatusText(response),
      badge: "Confirm",
      progress: 0.24
    });
  } catch (error) {
    hideExportReview();
    showStatus({
      tone: "error",
      stage: "error",
      eyebrow: "Review",
      title: "Review failed",
      detail: error.message,
      badge: "Failed",
      progress: 0.12
    });
    return false;
  } finally {
    setActionBusy(false);
  }

  return waitForExportReviewDecision();
}

async function handleAnalyzeClick() {
  if (actionBusy) {
    return;
  }

  if (!(await ensureActionTargetReady("analyze the page"))) {
    return;
  }

  setActionBusy(true);

  showStatus({
    tone: "neutral",
    eyebrow: "Inspect",
    title: "Analyzing current page",
    detail: "Lumen is extracting colors, typography, layout density, CTA, and navigation signals.",
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
      title: "Page signals ready",
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

async function handlePreviewRedactions() {
  if (actionBusy) {
    return;
  }

  if (!(await ensureActionTargetReady("scan redactions"))) {
    return;
  }

  setActionBusy(true);

  showStatus({
    tone: "neutral",
    eyebrow: "Redact",
    title: "Scanning current page",
    detail: "Checking the current DOM for emails, phone numbers, token-like strings, filled fields, and manual boxes.",
    badge: "Scan",
    progress: 0.1
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_PREVIEW_REDACTIONS"
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Redaction scan could not run.");
    }

    renderRedactionPreview(response);

    showStatus({
      tone: "success",
      eyebrow: "Redact",
      title: "Redaction scan complete",
      detail: buildRedactionPreviewText(response),
      badge: "Ready",
      progress: 1
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Redact",
      title: "Scan failed",
      detail: error.message,
      badge: "Failed",
      progress: 0.12
    });
  } finally {
    setActionBusy(false);
  }
}

async function handleStartRedactionPicker() {
  if (actionBusy) {
    return;
  }

  if (!(await ensureActionTargetReady("mark redaction boxes"))) {
    return;
  }

  setActionBusy(true);

  showStatus({
    tone: "neutral",
    eyebrow: "Redact",
    title: "Opening page picker",
    detail: "Draw boxes over areas to sanitize. Press Done in the page overlay when finished.",
    badge: "Picker",
    progress: 0.08
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_START_REDACTION_PICKER"
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Manual redaction picker could not start.");
    }

    renderManualRedactions(response.record);

    showStatus({
      tone: "success",
      eyebrow: "Redact",
      title: "Picker ready on page",
      detail: "Manual boxes are stored locally for this URL and applied to the next desktop capture.",
      badge: "Ready",
      progress: 1
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Redact",
      title: "Picker failed",
      detail: error.message,
      badge: "Failed",
      progress: 0.12
    });
  } finally {
    setActionBusy(false);
  }
}

async function handleClearManualRedactions() {
  if (actionBusy) {
    return;
  }

  if (!(await ensureActionTargetReady("clear manual redactions"))) {
    return;
  }

  setActionBusy(true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_CLEAR_MANUAL_REDACTIONS"
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Manual redactions could not be cleared.");
    }

    renderManualRedactions(response.record);

    showStatus({
      tone: "neutral",
      eyebrow: "Redact",
      title: "Manual boxes cleared",
      detail: "The next capture will only use auto-redaction unless you mark new boxes.",
      badge: "Cleared",
      progress: 0.2
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Redact",
      title: "Clear failed",
      detail: error.message,
      badge: "Failed",
      progress: 0.12
    });
  } finally {
    setActionBusy(false);
  }
}

async function handleStartCutawayPicker() {
  if (actionBusy) {
    return;
  }

  if (!(await ensureActionTargetReady("mark a cutaway region"))) {
    return;
  }

  setActionBusy(true);

  showStatus({
    tone: "neutral",
    eyebrow: "Cutaway",
    title: "Opening region picker",
    detail: "Draw one box around the page area you want to reuse. Press Done in the page overlay when finished.",
    badge: "Picker",
    progress: 0.08
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_START_CUTAWAY_PICKER"
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Cutaway picker could not start.");
    }

    renderCutawayRegion(response.record);

    showStatus({
      tone: "success",
      eyebrow: "Cutaway",
      title: "Cutaway picker ready",
      detail: "The selected region is stored locally for this URL. Continuous watch still needs explicit opt-in and review UI.",
      badge: "Ready",
      progress: 1
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Cutaway",
      title: "Picker failed",
      detail: error.message,
      badge: "Failed",
      progress: 0.12
    });
  } finally {
    setActionBusy(false);
  }
}

async function handleClearCutawayRegion() {
  if (actionBusy) {
    return;
  }

  if (!(await ensureActionTargetReady("clear the cutaway region"))) {
    return;
  }

  setActionBusy(true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_CLEAR_CUTAWAY_REGION"
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Cutaway region could not be cleared.");
    }

    renderCutawayRegion(response.record);

    showStatus({
      tone: "neutral",
      eyebrow: "Cutaway",
      title: "Cutaway cleared",
      detail: "No reusable region is stored for this URL.",
      badge: "Cleared",
      progress: 0.2
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Cutaway",
      title: "Clear failed",
      detail: error.message,
      badge: "Failed",
      progress: 0.12
    });
  } finally {
    setActionBusy(false);
  }
}

async function handleStartAnnotationPicker() {
  if (actionBusy) {
    return;
  }

  if (!(await ensureActionTargetReady("mark an annotation callout"))) {
    return;
  }

  setActionBusy(true);

  if (!ui.annotationEnabled.checked) {
    ui.annotationEnabled.checked = true;
    updateAnnotationControls();
    await persistCurrentSettings();
  }

  showStatus({
    tone: "neutral",
    eyebrow: "Annotate",
    title: "Opening callout picker",
    detail: "Draw one box around the page area that should be highlighted in the exported image.",
    badge: "Picker",
    progress: 0.08
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_START_ANNOTATION_PICKER"
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Annotation picker could not start.");
    }

    renderAnnotationRegion(response.record);

    showStatus({
      tone: "success",
      eyebrow: "Annotate",
      title: "Callout picker ready",
      detail: "The selected region is stored locally for this URL and rendered into the next export with the capture note.",
      badge: "Ready",
      progress: 1
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Annotate",
      title: "Picker failed",
      detail: error.message,
      badge: "Failed",
      progress: 0.12
    });
  } finally {
    setActionBusy(false);
  }
}

async function handleClearAnnotationRegion() {
  if (actionBusy) {
    return;
  }

  if (!(await ensureActionTargetReady("clear the annotation callout"))) {
    return;
  }

  setActionBusy(true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_CLEAR_ANNOTATION_REGION"
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Annotation callout could not be cleared.");
    }

    renderAnnotationRegion(response.record);

    showStatus({
      tone: "neutral",
      eyebrow: "Annotate",
      title: "Callout cleared",
      detail: "The next export will keep the note text but will not draw a highlighted page region.",
      badge: "Cleared",
      progress: 0.2
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Annotate",
      title: "Clear failed",
      detail: error.message,
      badge: "Failed",
      progress: 0.12
    });
  } finally {
    setActionBusy(false);
  }
}

function handleExplainCutawayPlan() {
  const hasRegion = Boolean(cutawayRegionRecord.region);

  showStatus({
    tone: "neutral",
    eyebrow: "Cutaway",
    title: hasRegion ? "Region watch plan" : "Mark a region first",
    detail: hasRegion
      ? "Implemented now: focused cutaway crops during capture. Next layer: opt-in schedules, pause controls, retention limits, and explicit agent handoff destinations."
      : "Use Mark cutaway to save one page area before capture, watch, or agent handoff planning.",
    badge: hasRegion ? "Planned" : "No region",
    progress: hasRegion ? 0.42 : 0.12
  });
}

async function ensurePermissionsForCurrentCapture() {
  if (!requiresOriginPermission(currentSettings.devicePreset)) {
    return true;
  }

  const tab = launchTargetTab || await resolveActionTargetTab();

  if (!tab?.url || !isOriginPermissionSupported(tab.url)) {
    showStatus({
      tone: "error",
      eyebrow: "Blocked",
      title: "No capturable page",
      detail: "Open an http or https page before running tablet, mobile, or responsive capture.",
      badge: "Blocked",
      progress: 0.08
    });
    return false;
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
  await refreshDataControls();

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
  const entitlements = currentSession?.entitlements || getPlanEntitlements(currentSession?.plan || "free");

  showStatus({
    tone: "neutral",
    eyebrow: "Plan",
    title: `${entitlements.label} entitlement active`,
    detail: "This build has plan gates, but billing and account recovery are still production work.",
    badge: "Plan",
    progress: 0.12
  });
}

async function refreshDataControls() {
  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_GET_DATA_CONTROLS"
  });

  renderDataControls(response?.dataControls || currentDataControls);
}

async function handleRetentionChange() {
  const retentionDays = Number(ui.retentionSelect.value);
  await updateDataControls({
    retentionDays
  });
}

async function handleCloudSyncToggle() {
  if (ui.cloudSyncEnabled.checked && !enforceFeatureAccess("cloudSync", "Cloud sync")) {
    ui.cloudSyncEnabled.checked = false;
    return;
  }

  await updateDataControls({
    cloudSyncEnabled: ui.cloudSyncEnabled.checked
  });
}

async function updateDataControls(patch) {
  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_UPDATE_DATA_CONTROLS",
    payload: patch
  });

  if (!response?.ok) {
    renderDataControls(currentDataControls);
    showStatus({
      tone: "error",
      eyebrow: "Data",
      title: response?.error?.title || "Data controls unavailable",
      detail: response?.error?.description || "Start a demo session with the backend running before changing backend data controls.",
      badge: "Blocked",
      progress: 0.12
    });
    return;
  }

  renderDataControls(response.dataControls);
  showStatus({
    tone: "success",
    eyebrow: "Data",
    title: "Data controls updated",
    detail: `Retention is now ${formatRetentionDays(response.dataControls.retentionDays)}. Cloud sync is ${response.dataControls.cloudSyncEnabled ? "allowed" : "off"}.`,
    badge: "Saved",
    progress: 1
  });
}

async function handleDeleteBackendData() {
  const confirmed = window.confirm("Delete backend capture history, watch records, and agent jobs for this Lumen session?");

  if (!confirmed) {
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_DELETE_ACCOUNT_DATA"
  });

  if (!response?.ok) {
    showStatus({
      tone: "error",
      eyebrow: "Data",
      title: response?.error?.title || "Delete unavailable",
      detail: response?.error?.description || "Backend data could not be deleted from this session.",
      badge: "Blocked",
      progress: 0.12
    });
    return;
  }

  renderDataControls(response.dataControls || currentDataControls);
  renderHistory(response.captureHistory || []);
  showStatus({
    tone: "success",
    eyebrow: "Data",
    title: "Backend data deleted",
    detail: formatDeletedDataSummary(response.deleted),
    badge: "Deleted",
    progress: 1
  });
}

async function handleHistoryAction(event) {
  const artifactFilterButton = event.target.closest("[data-history-artifact-filter]");

  if (artifactFilterButton) {
    setHistoryArtifactFilter(artifactFilterButton);
    return;
  }

  const button = event.target.closest("[data-history-action]");

  if (!button) {
    return;
  }

  const captureId = button.dataset.captureId || "";
  const action = button.dataset.historyAction;

  if (action === "details") {
    expandedHistoryId = expandedHistoryId === captureId ? COLLAPSED_HISTORY_ID : captureId;
    renderHistory(latestHistoryItems);
    return;
  }

  if (action === "copy") {
    await handleCopyHistorySummary(captureId, button);
    return;
  }

  const messageType =
    action === "open"
      ? "LUMEN_OPEN_CAPTURE_DOWNLOAD"
      : "LUMEN_SHOW_CAPTURE_DOWNLOAD";

  button.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: messageType,
      payload: {
        captureId
      }
    });

    if (!response?.ok) {
      showStatus({
        tone: "error",
        eyebrow: "Archive",
        title: response?.error?.title || "History action failed",
        detail: response?.error?.description || "Lumen could not access that downloaded artifact.",
        badge: "Blocked",
        progress: 0.12
      });
      return;
    }

    showStatus({
      tone: "success",
      eyebrow: "Archive",
      title: action === "open" ? "Opened capture artifact" : "Revealed capture artifact",
      detail: response.archiveFolder
        ? `Saved in ${response.archiveFolder}.`
        : response.filename || "Chrome opened the local artifact.",
      badge: "Ready",
      progress: 1
    });
  } finally {
    button.disabled = actionBusy || button.dataset.downloadReady !== "true";
  }
}

async function handleCopyHistorySummary(captureId, button) {
  const item = latestHistoryItems.find((record) => record.id === captureId);

  if (!item) {
    return;
  }

  button.disabled = true;

  try {
    await copyTextToClipboard(buildHistorySummaryText(item));
    showStatus({
      tone: "success",
      eyebrow: "Archive",
      title: "Capture summary copied",
      detail: "The run summary is ready to paste into a bug report, review note, or project doc.",
      badge: "Copied",
      progress: 1
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Archive",
      title: "Copy failed",
      detail: error.message || "The browser did not allow clipboard access.",
      badge: "Failed",
      progress: 0.12
    });
  } finally {
    button.disabled = actionBusy;
  }
}

function renderSession(session) {
  currentSession = session || currentSession;

  const signedIn = Boolean(currentSession?.signedIn);
  const plan = currentSession?.plan || "free";
  const entitlements = currentSession?.entitlements || getPlanEntitlements(plan);
  const source = currentSession?.source || "local";
  const backendReachable = Boolean(currentSession?.backendReachable);
  const lockedAdvancedCount = Object.values(entitlements.features || {})
    .filter((feature) => feature.locked && feature.status !== "planned")
    .length;

  ui.accountTitle.textContent = signedIn
    ? `${currentSession.user?.name || "Lumen user"}`
    : "Free local session";
  ui.accountDescription.textContent = signedIn
    ? backendReachable
      ? `${entitlements.label} entitlement loaded. New captures can sync into local backend history.`
      : `${entitlements.label} entitlement loaded locally. Captures stay in this browser until the backend is reachable.`
    : `Free keeps local capture available. Start Demo Pro to unlock ${lockedAdvancedCount} current advanced tool${lockedAdvancedCount === 1 ? "" : "s"} for testing.`;
  ui.accountPlan.textContent = entitlements.label;
  ui.accountSource.textContent = source;
  ui.backendBadge.textContent = backendReachable ? "Backend reachable" : "Local-first";
  ui.signInButton.classList.toggle("is-hidden", signedIn);
  ui.signOutButton.classList.toggle("is-hidden", !signedIn);
  ui.billingButton.disabled = !signedIn || plan === "free";
  applyPlanGates();
  renderDataControls(currentDataControls);
}

function renderDataControls(dataControls = currentDataControls) {
  currentDataControls = {
    ...currentDataControls,
    ...dataControls
  };

  const signedIn = Boolean(currentSession?.signedIn);
  const backendReachable = Boolean(currentSession?.backendReachable && currentDataControls.backendReachable !== false);
  const canCloudSync = getFeatureAccess("cloudSync", currentSession?.plan || "free");
  const controlsAvailable = signedIn && backendReachable;

  ui.retentionSelect.value = String(currentDataControls.retentionDays ?? 90);
  ui.retentionSelect.disabled = !controlsAvailable;
  ui.cloudSyncEnabled.checked = Boolean(currentDataControls.cloudSyncEnabled);
  ui.cloudSyncEnabled.disabled = !controlsAvailable || !canCloudSync;
  ui.deleteBackendDataButton.disabled = !controlsAvailable;
  ui.dataControlsSummary.textContent = controlsAvailable
    ? `Backend retention is ${formatRetentionDays(currentDataControls.retentionDays)}. Cloud sync is ${currentDataControls.cloudSyncEnabled ? "allowed" : "off"}.`
    : signedIn
      ? "Backend is unavailable. Captures remain local in this browser until it reconnects."
      : "Start Demo Pro to test backend retention and delete controls.";
}

function formatRetentionDays(days) {
  const normalized = Number(days);
  return normalized === 0 ? "manual delete only" : `${normalized} days`;
}

function formatDeletedDataSummary(deleted = {}) {
  const parts = [
    `${deleted.captures || 0} capture${deleted.captures === 1 ? "" : "s"}`,
    `${deleted.watchPlans || 0} watch record${deleted.watchPlans === 1 ? "" : "s"}`,
    `${deleted.agentJobs || 0} agent job${deleted.agentJobs === 1 ? "" : "s"}`
  ];

  return `Deleted ${parts.join(", ")} from the backend session.`;
}

function renderHistory(history) {
  const items = Array.isArray(history) ? history : [];
  latestHistoryItems = items;
  ui.historyCount.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
  ui.historyList.replaceChildren();

  if (!items.length) {
    expandedHistoryId = "";
    ui.historyEmpty.classList.remove("is-hidden");
    ui.historyList.classList.add("is-hidden");
    return;
  }

  ui.historyEmpty.classList.add("is-hidden");
  ui.historyList.classList.remove("is-hidden");

  const visibleItems = items.slice(0, 5);
  const visibleIds = new Set(visibleItems.map((item) => item.id || ""));

  if (!expandedHistoryId || (expandedHistoryId !== COLLAPSED_HISTORY_ID && !visibleIds.has(expandedHistoryId))) {
    expandedHistoryId = visibleItems[0]?.id || COLLAPSED_HISTORY_ID;
  }

  for (const item of visibleItems) {
    const itemId = item.id || "";
    const isExpanded = expandedHistoryId === itemId;
    const row = document.createElement("article");
    row.className = "history-item";
    row.classList.toggle("is-expanded", isExpanded);

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
      item.manifestFile ? "manifest saved" : "",
      item.annotation?.text ? "note added" : "",
      item.manualRedactionCount ? `${item.manualRedactionCount} manual box${item.manualRedactionCount === 1 ? "" : "es"}` : "",
      item.cutawayCount ? `${item.cutawayCount} cutaway crop${item.cutawayCount === 1 ? "" : "s"}` : "",
      formatManualProjectionStats(item.manualProjectionStats),
      formatCutawayResolutionStats(item.cutawayResolutionStats),
      item.redactionCount ? `${item.redactionCount} redaction${item.redactionCount === 1 ? "" : "s"}` : "",
      item.blueprintSummary?.siteType || ""
    ]
      .filter(Boolean)
      .join(" · ");

    row.append(topRow, meta);

    const archiveFolder = item.archiveFolder || "";
    const hasDownloadHandles = Array.isArray(item.downloads) &&
      item.downloads.some((download) => Number.isInteger(download.downloadId));

    if (archiveFolder || hasDownloadHandles) {
      const archive = document.createElement("p");
      archive.className = "history-path";
      archive.textContent = archiveFolder || "Local download handles available";
      row.append(archive);
    }

    if (item.annotation?.text) {
      const note = document.createElement("p");
      note.className = "history-meta";
      note.textContent = `Note: ${item.annotation.text}`;
      row.append(note);
    }

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const detailsButton = document.createElement("button");
    detailsButton.className = "history-action";
    detailsButton.type = "button";
    detailsButton.dataset.historyAction = "details";
    detailsButton.dataset.captureId = itemId;
    detailsButton.setAttribute("aria-expanded", String(isExpanded));
    detailsButton.textContent = isExpanded ? "Hide details" : "Details";

    const copyButton = document.createElement("button");
    copyButton.className = "history-action";
    copyButton.type = "button";
    copyButton.dataset.historyAction = "copy";
    copyButton.dataset.captureId = itemId;
    copyButton.textContent = "Copy summary";

    const openButton = document.createElement("button");
    openButton.className = "history-action";
    openButton.type = "button";
    openButton.dataset.historyAction = "open";
    openButton.dataset.captureId = itemId;
    openButton.dataset.downloadReady = hasDownloadHandles ? "true" : "false";
    openButton.disabled = !hasDownloadHandles;
    openButton.textContent = "Open";

    const showButton = document.createElement("button");
    showButton.className = "history-action";
    showButton.type = "button";
    showButton.dataset.historyAction = "show";
    showButton.dataset.captureId = itemId;
    showButton.dataset.downloadReady = hasDownloadHandles ? "true" : "false";
    showButton.disabled = !hasDownloadHandles;
    showButton.textContent = "Show in folder";

    if (!hasDownloadHandles) {
      openButton.title = "Run a fresh capture to enable local file actions.";
      showButton.title = "Run a fresh capture to enable local file actions.";
    }

    actions.append(detailsButton, copyButton, openButton, showButton);
    row.append(actions);

    if (isExpanded) {
      row.append(buildHistoryDetails(item));
    }

    ui.historyList.appendChild(row);
  }
}

function renderManualRedactions(record) {
  manualRedactionRecord = record || {
    regions: []
  };

  const count = manualRedactionRecord.regions?.length || 0;
  ui.manualRedactionCount.textContent = `${count} box${count === 1 ? "" : "es"}`;
  updateActionDisabledState();
  renderRunSummary(currentSettings);
}

function renderCutawayRegion(record) {
  const region = record?.region || record?.regions?.[0] || null;
  cutawayRegionRecord = {
    ...(record || {}),
    region,
    regions: region ? [region] : []
  };

  if (!region) {
    ui.cutawayRegionStatus.textContent = "No region";
    ui.cutawaySummary.textContent = "A marked region is stored locally for this URL. The next capture can save cutaway PNGs beside the full-page artifact.";
    updateActionDisabledState();
    renderRunSummary(currentSettings);
    return;
  }

  ui.cutawayRegionStatus.textContent = `${Math.round(region.width)}x${Math.round(region.height)}`;
  ui.cutawaySummary.textContent = [
    `Stored for ${record?.host || "this URL"}.`,
    `Top ${Math.round(region.top)}px, left ${Math.round(region.left)}px.`,
    "Captures can export focused cutaway PNGs when this region resolves."
  ].join(" ");
  updateActionDisabledState();
  renderRunSummary(currentSettings);
}

function renderAnnotationRegion(record) {
  const region = record?.region || record?.regions?.[0] || null;
  annotationRegionRecord = {
    ...(record || {}),
    region,
    regions: region ? [region] : []
  };

  if (!region) {
    ui.annotationRegionStatus.textContent = "No callout";
    ui.annotationRegionSummary.textContent = "Optional. Use this when a review note needs to point at a specific page area.";
    updateActionDisabledState();
    renderRunSummary(currentSettings);
    return;
  }

  ui.annotationRegionStatus.textContent = `${Math.round(region.width)}x${Math.round(region.height)}`;
  ui.annotationRegionSummary.textContent = [
    `Stored for ${record?.host || "this URL"}.`,
    `Top ${Math.round(region.top)}px, left ${Math.round(region.left)}px.`,
    "The next export draws this as a callout when the region resolves."
  ].join(" ");
  updateActionDisabledState();
  renderRunSummary(currentSettings);
}

function buildHistoryDetails(item) {
  const detail = document.createElement("div");
  detail.className = "history-detail";

  const metrics = document.createElement("div");
  metrics.className = "history-detail-grid";

  const viewCount = item.variants?.length || (item.devicePreset === "responsive" ? 3 : 1);
  const fileCount = item.files?.length || 0;
  const redactionCount = item.redactionCount || 0;
  const cutawayCount = item.cutawayCount || 0;
  const manifestState = item.manifestFile ? "Saved" : "Off";

  metrics.append(
    buildHistoryMetric("Views", String(viewCount)),
    buildHistoryMetric("Files", String(fileCount)),
    buildHistoryMetric("Redactions", String(redactionCount)),
    buildHistoryMetric("Cutaways", String(cutawayCount)),
    buildHistoryMetric("Manifest", manifestState)
  );
  detail.append(metrics);

  const variantList = buildHistoryVariantList(item);

  if (variantList) {
    detail.append(variantList);
  }

  const artifactList = buildHistoryArtifactList(item);

  if (artifactList) {
    detail.append(artifactList);
  }

  const signals = buildHistorySignalPanel(item);

  if (signals) {
    detail.append(signals);
  }

  if (item.annotation?.text) {
    detail.append(buildHistoryTextPanel("Capture note", item.annotation.text));
  }

  return detail;
}

function buildHistoryMetric(label, value) {
  const node = document.createElement("div");
  node.className = "history-detail-metric";

  const labelNode = document.createElement("span");
  labelNode.textContent = label;

  const valueNode = document.createElement("strong");
  valueNode.textContent = value;

  node.append(labelNode, valueNode);
  return node;
}

function buildHistoryVariantList(item) {
  const variants = Array.isArray(item.variants) ? item.variants : [];

  if (!variants.length) {
    return null;
  }

  const panel = buildHistoryPanelShell("Capture views");

  for (const variant of variants) {
    const row = document.createElement("div");
    row.className = "history-detail-row";

    const label = document.createElement("strong");
    label.textContent = variant.label || titleCase(variant.id || "View");

    const meta = document.createElement("span");
    meta.textContent = [
      variant.dimensions?.width && variant.dimensions?.height
        ? `${variant.dimensions.width}x${variant.dimensions.height}`
        : "",
      variant.fileCount ? `${variant.fileCount} file${variant.fileCount === 1 ? "" : "s"}` : "",
      variant.cutawayCount ? `${variant.cutawayCount} cutaway${variant.cutawayCount === 1 ? "" : "s"}` : "",
      variant.redactionCount ? `${variant.redactionCount} redaction${variant.redactionCount === 1 ? "" : "s"}` : ""
    ]
      .filter(Boolean)
      .join(" | ") || "Captured";

    row.append(label, meta);
    panel.append(row);
  }

  return panel;
}

function buildHistoryArtifactList(item) {
  const records = getHistoryArtifactRecords(item);

  if (!records.length) {
    return null;
  }

  const panel = buildHistoryPanelShell("Artifacts");
  const list = document.createElement("div");
  const cutawayPreview = buildHistoryCutawayPreview(item, records);

  list.className = "history-artifact-list";
  panel.append(buildHistoryArtifactFilters(records));

  if (cutawayPreview) {
    panel.append(cutawayPreview);
  }

  for (const record of records) {
    const artifactType = getHistoryArtifactType(record);
    const row = document.createElement("div");
    row.className = `history-detail-row history-artifact-row history-artifact-row-${artifactType}`;
    row.dataset.artifactType = artifactType;

    const label = document.createElement("strong");
    label.textContent = formatArtifactLabel(record);

    const meta = document.createElement("span");
    meta.textContent = [
      record.variantId ? titleCase(record.variantId) : "",
      record.width && record.height ? `${record.width}x${record.height}` : "",
      record.bytesReceived ? formatBytes(record.bytesReceived) : "",
      record.filename ? shortenPath(record.filename) : ""
    ]
      .filter(Boolean)
      .join(" | ");

    row.append(label, meta);
    list.append(row);
  }

  panel.append(list);
  return panel;
}

function getHistoryArtifactRecords(item) {
  const downloads = Array.isArray(item.downloads) ? item.downloads : [];
  const files = Array.isArray(item.files) ? item.files : [];

  if (downloads.length) {
    return downloads;
  }

  return files.map((filename) => ({
    filename,
    kind: filename.endsWith(".json") ? "manifest" : "image",
    role: filename.includes("-cutaway") ? "cutaway" : "full-page"
  }));
}

function buildHistoryArtifactFilters(records) {
  const filterRow = document.createElement("div");
  const counts = countHistoryArtifacts(records);
  const filters = [
    ["all", "All", records.length],
    ["image", "Full page", counts.image],
    ["cutaway", "Cutaway", counts.cutaway],
    ["manifest", "Manifest", counts.manifest]
  ].filter(([, , count]) => count > 0);

  filterRow.className = "history-artifact-filters";

  for (const [filter, label, count] of filters) {
    const button = document.createElement("button");
    button.className = "history-artifact-filter";
    button.type = "button";
    button.dataset.historyArtifactFilter = filter;
    button.setAttribute("aria-pressed", String(filter === "all"));
    button.classList.toggle("is-active", filter === "all");
    button.textContent = `${label} ${count}`;
    filterRow.append(button);
  }

  return filterRow;
}

function countHistoryArtifacts(records) {
  return records.reduce((counts, record) => {
    counts[getHistoryArtifactType(record)] += 1;
    return counts;
  }, {
    image: 0,
    cutaway: 0,
    manifest: 0
  });
}

function setHistoryArtifactFilter(button) {
  const panel = button.closest(".history-detail-panel");
  const filter = button.dataset.historyArtifactFilter || "all";

  if (!panel) {
    return;
  }

  for (const filterButton of panel.querySelectorAll("[data-history-artifact-filter]")) {
    const isActive = filterButton === button;
    filterButton.classList.toggle("is-active", isActive);
    filterButton.setAttribute("aria-pressed", String(isActive));
  }

  for (const row of panel.querySelectorAll("[data-artifact-type]")) {
    row.classList.toggle("is-filtered", filter !== "all" && row.dataset.artifactType !== filter);
  }
}

function buildHistoryCutawayPreview(item, records) {
  const cutaways = records.filter((record) => getHistoryArtifactType(record) === "cutaway");

  if (!cutaways.length) {
    return null;
  }

  const preview = document.createElement("div");
  const map = document.createElement("div");
  const summary = document.createElement("p");
  const first = cutaways[0];
  const region = first.cutawayRegion || {};
  const variant = findHistoryVariant(item, first.variantId);
  const pageWidth = Math.max(1, Number(variant?.dimensions?.width) || Number(first.width) || Number(region.width) || 1);
  const pageHeight = Math.max(1, Number(variant?.dimensions?.height) || Number(first.height) || Number(region.height) || 1);
  const box = document.createElement("span");

  preview.className = "history-cutaway-preview";
  map.className = "history-cutaway-map";
  box.className = "history-cutaway-box";
  box.style.left = `${clampPercent((Number(region.left) || 0) / pageWidth * 100, 4, 92)}%`;
  box.style.top = `${clampPercent((Number(region.top) || 0) / pageHeight * 100, 4, 92)}%`;
  box.style.width = `${clampPercent((Number(region.width) || Number(first.width) || pageWidth) / pageWidth * 100, 8, 92)}%`;
  box.style.height = `${clampPercent((Number(region.height) || Number(first.height) || pageHeight) / pageHeight * 100, 8, 92)}%`;

  summary.className = "history-detail-note";
  summary.textContent = [
    `${cutaways.length} cutaway crop${cutaways.length === 1 ? "" : "s"} saved`,
    first.variantId ? `${titleCase(first.variantId)} view` : "",
    first.width && first.height ? `${first.width}x${first.height}` : "",
    region.projection ? `${region.projection} region` : ""
  ]
    .filter(Boolean)
    .join(" | ");

  map.append(box);
  preview.append(map, summary);
  return preview;
}

function findHistoryVariant(item, variantId) {
  const variants = Array.isArray(item.variants) ? item.variants : [];

  return variants.find((variant) => variant.id === variantId) || variants[0] || null;
}

function getHistoryArtifactType(record) {
  if (record.role === "cutaway" || /-cutaway(?:\.|$)/i.test(record.filename || "")) {
    return "cutaway";
  }

  if (record.kind === "manifest" || /\.json$/i.test(record.filename || "")) {
    return "manifest";
  }

  return "image";
}

function formatArtifactLabel(record) {
  const artifactType = getHistoryArtifactType(record);

  if (artifactType === "cutaway") {
    return "Cutaway PNG";
  }

  if (artifactType === "manifest") {
    return "Manifest JSON";
  }

  return record.partTotal > 1
    ? `Full-page PNG ${record.partIndex || 1}/${record.partTotal}`
    : "Full-page PNG";
}

function buildHistorySignalPanel(item) {
  const summary = item.blueprintSummary;

  if (!summary?.siteType && !summary?.heroHeadline && !summary?.primaryCta) {
    return null;
  }

  const parts = [
    summary.siteType ? `Type: ${summary.siteType}` : "",
    summary.heroHeadline ? `Hero: ${summary.heroHeadline}` : "",
    summary.primaryCta ? `CTA: ${summary.primaryCta}` : ""
  ].filter(Boolean);

  return buildHistoryTextPanel("Page signals", parts.join(" | "));
}

function buildHistoryTextPanel(label, text) {
  const panel = buildHistoryPanelShell(label);
  const copy = document.createElement("p");
  copy.className = "history-detail-note";
  copy.textContent = text;
  panel.append(copy);
  return panel;
}

function buildHistoryPanelShell(label) {
  const panel = document.createElement("div");
  panel.className = "history-detail-panel";

  const title = document.createElement("p");
  title.className = "field-label";
  title.textContent = label;
  panel.append(title);

  return panel;
}

function renderRedactionPreview(preview) {
  ui.redactionPreviewSummary.textContent = buildRedactionPreviewText(preview);
}

function renderExportReview(review) {
  ui.exportReviewPanel.classList.remove("is-hidden");
  ui.exportReviewBadge.textContent = review.warnings?.length ? "Review" : "Ready";
  ui.exportReviewSummary.textContent = [
    `${review.variantCount || 1} view${review.variantCount === 1 ? "" : "s"} checked for ${review.page?.host || "this page"}.`,
    `${review.redactionCount || 0} redaction check${review.redactionCount === 1 ? "" : "s"} ready before export.`
  ].join(" ");
  ui.reviewViewCount.textContent = String(review.variantCount || 1);
  ui.reviewAutoCount.textContent = String(review.autoRedactionCount || 0);
  ui.reviewManualCount.textContent = formatReviewManualMetric(review);
  ui.reviewCutawayCount.textContent = formatReviewCutawayMetric(review);

  renderExportReviewVariants(review.variants || []);
  renderExportReviewWarnings(review.warnings || []);

  window.requestAnimationFrame(() => {
    ui.exportReviewConfirmButton.focus();
  });
}

function renderExportReviewVariants(variants) {
  ui.exportReviewVariants.replaceChildren();

  if (!variants.length) {
    const empty = document.createElement("p");
    empty.className = "review-summary";
    empty.textContent = "No view checks were returned.";
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
    buildReviewLegendItem("Auto", "auto"),
    buildReviewLegendItem("Manual", "manual"),
    buildReviewLegendItem("Cutaway", "cutaway")
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
  const role = titleCase(region.role || "region");
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
    label.textContent = "No blocking issues found";

    const copy = document.createElement("p");
    copy.textContent = "Review the final artifact before external sharing, then continue when ready.";

    item.append(label, copy);
    ui.exportReviewWarnings.append(item);
    return;
  }

  for (const warning of warnings) {
    const item = document.createElement("div");
    item.className = "review-warning-item";

    const label = document.createElement("strong");
    label.textContent = "Check before export";

    const copy = document.createElement("p");
    copy.textContent = warning;

    item.append(label, copy);
    ui.exportReviewWarnings.append(item);
  }
}

function hideExportReview() {
  ui.exportReviewPanel.classList.add("is-hidden");
}

function isExportReviewOpen() {
  return !ui.exportReviewPanel.classList.contains("is-hidden");
}

function waitForExportReviewDecision() {
  return new Promise((resolve) => {
    exportReviewDecision = resolve;
  });
}

function settleExportReview(approved) {
  if (!exportReviewDecision) {
    hideExportReview();
    return;
  }

  const resolve = exportReviewDecision;
  exportReviewDecision = null;
  hideExportReview();
  resolve(Boolean(approved));
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

async function refreshLaunchStatus() {
  try {
    const tab = await resolveActionTargetTab();
    launchTargetTab = tab;

    if (!tab?.url) {
      renderLaunchStatus({
        state: "blocked",
        title: "No active tab found",
        detail: "Open a web page, then launch Lumen again.",
        actionsBlocked: true
      });
      return;
    }

    if (!isOriginPermissionSupported(tab.url)) {
      renderLaunchStatus({
        state: "blocked",
        title: "This page cannot be captured",
        detail: "Chrome blocks capture scripts on browser and extension pages.",
        actionsBlocked: true
      });
      return;
    }

    renderLaunchStatus({
      state: "ready",
      title: `${formatTabHost(tab.url)} ready`,
      detail: "Click to capture. Hold the main button for quick actions.",
      actionsBlocked: false
    });
  } catch (error) {
    renderLaunchStatus({
      state: "blocked",
      title: "Tab check failed",
      detail: error.message || "Lumen could not read the active tab.",
      actionsBlocked: true
    });
  }
}

function renderLaunchStatusFromRun({ tone, title, detail, progress }) {
  if (tone === "error") {
    renderLaunchStatus({
      state: "blocked",
      title: "Action needs attention",
      detail: title || detail || "The last action could not finish.",
      actionsBlocked: launchActionsBlocked
    });
    return;
  }

  if (tone === "success" || progress >= 1) {
    renderLaunchStatus({
      state: "ready",
      title: "Ready for the next action",
      detail: title || "The last Lumen action completed.",
      actionsBlocked: false
    });
    return;
  }

  renderLaunchStatus({
    state: "working",
    title: title || "Working",
    detail: detail || "Lumen is running the selected action.",
    actionsBlocked: false
  });
}

function renderLaunchStatus({ state, title, detail, actionsBlocked = false }) {
  launchActionsBlocked = Boolean(actionsBlocked);
  ui.launchStatus.dataset.state = state || "ready";
  ui.launchStatusTitle.textContent = title || "Ready";
  ui.launchStatusDetail.textContent = detail || "Choose the next Lumen action.";
  ui.launchPanel.classList.toggle("is-blocked", launchActionsBlocked);
  updateActionDisabledState();
}

function showStatus({ tone, stage, eyebrow, title, detail, badge, progress }) {
  ui.statusPanel.classList.remove("is-hidden");
  ui.statusPanel.dataset.tone = tone;
  ui.statusEyebrow.textContent = eyebrow;
  ui.statusTitle.textContent = title;
  ui.statusDetail.textContent = detail;
  ui.statusBadge.textContent = badge;
  ui.progressFill.style.width = `${Math.max(4, Math.round(progress * 100))}%`;
  if (stage) {
    renderTimeline(stage, tone, progress);
  }
  appendStatusEvent({
    badge,
    title,
    detail,
    tone
  });
  renderLaunchStatusFromRun({
    tone,
    title,
    detail,
    progress
  });
}

function renderRunSummary(settings = currentSettings) {
  const variants = getCaptureVariants(settings.devicePreset);
  const viewLabel = variants.length > 1
    ? variants.map((variant) => variant.label).join(", ")
    : variants[0]?.label || "Desktop";
  const exportLabel = titleCase(settings.exportPreset || "raw");
  const safetyParts = [
    settings.removeStickyHeaders !== false ? "Cleanup" : "",
    settings.forceLazyLoad !== false ? "Lazy load" : "",
    settings.autoRedact ? "Redact" : "",
    manualRedactionRecord.regions?.length ? "Manual boxes" : "",
    cutawayRegionRecord.region ? "Cutaway" : "",
    annotationRegionRecord.region ? "Callout" : ""
  ].filter(Boolean);

  ui.runViewSummary.textContent = viewLabel;
  ui.runExportSummary.textContent = exportLabel;
  ui.runSafetySummary.textContent = safetyParts.length ? safetyParts.join(", ") : "Basic";
  ui.runManifestSummary.textContent = settings.exportManifest === false ? "Off" : "Manifest";
}

function renderTimeline(stage = "idle", tone = "neutral", progress = 0) {
  const normalizedStage = normalizeTimelineStage(stage);
  const activeIndex = TIMELINE_STAGES.indexOf(normalizedStage);
  const markComplete = stage === "done" || (tone === "success" && progress >= 1);

  for (const step of ui.timelineSteps) {
    const stepIndex = TIMELINE_STAGES.indexOf(step.dataset.stageStep);
    const isComplete = markComplete || (activeIndex >= 0 && stepIndex < activeIndex);
    const isActive = !markComplete && activeIndex === stepIndex;
    const isError = tone === "error" && isActive;

    step.classList.toggle("is-complete", isComplete);
    step.classList.toggle("is-active", isActive);
    step.classList.toggle("is-error", isError);
    step.classList.toggle("is-pending", !isComplete && !isActive);
  }
}

function appendStatusEvent({ badge, title, detail, tone }) {
  const event = {
    badge: badge || "Run",
    title: title || "Working",
    detail: detail || "",
    tone: tone || "neutral",
    time: new Date()
  };

  const previous = statusEvents[0];

  if (previous?.title === event.title && previous?.detail === event.detail) {
    return;
  }

  statusEvents = [event, ...statusEvents].slice(0, 4);
  renderStatusLog();
}

function renderStatusLog() {
  ui.statusLog.replaceChildren();
  ui.statusLogCount.textContent = String(statusEvents.length);

  if (!statusEvents.length) {
    const empty = document.createElement("p");
    empty.textContent = "No active run yet.";
    ui.statusLog.appendChild(empty);
    return;
  }

  for (const event of statusEvents) {
    const item = document.createElement("div");
    item.className = "status-log-item";
    item.dataset.tone = event.tone;

    const meta = document.createElement("span");
    meta.textContent = `${event.badge} | ${formatLogTime(event.time)}`;

    const title = document.createElement("strong");
    title.textContent = event.title;

    const detail = document.createElement("p");
    detail.textContent = event.detail;

    item.append(meta, title, detail);
    ui.statusLog.appendChild(item);
  }
}

function normalizeTimelineStage(stage = "") {
  if (stage === "done") {
    return "save";
  }

  if (stage === "queued" || stage === "error") {
    return "prepare";
  }

  return TIMELINE_STAGES.includes(stage) ? stage : "idle";
}

function setActionBusy(isBusy) {
  actionBusy = isBusy;
  ui.launchPanel.classList.toggle("is-busy", isBusy);
  updateActionDisabledState();
}

function updateActionDisabledState() {
  const disabled = actionBusy || launchActionsBlocked;
  ui.captureButton.disabled = disabled;
  ui.analyzeButton.disabled = disabled;
  ui.previewRedactionsButton.disabled = disabled;
  ui.startRedactionPickerButton.disabled = disabled;
  ui.clearManualRedactionsButton.disabled = disabled || !(manualRedactionRecord.regions?.length);
  ui.startCutawayPickerButton.disabled = disabled;
  ui.clearCutawayButton.disabled = disabled || !cutawayRegionRecord.region;
  ui.explainCutawayPlanButton.disabled = disabled;
  ui.startAnnotationPickerButton.disabled = disabled;
  ui.clearAnnotationButton.disabled = disabled || !annotationRegionRecord.region;
  ui.exportReviewCancelButton.disabled = actionBusy;
  ui.exportReviewConfirmButton.disabled = actionBusy;

  for (const button of ui.holdMenuActions) {
    button.disabled = disabled;
  }

  for (const button of ui.historyList.querySelectorAll("[data-history-action]")) {
    const requiresDownload = button.dataset.historyAction === "open" || button.dataset.historyAction === "show";
    button.disabled = actionBusy || (requiresDownload && button.dataset.downloadReady !== "true");
  }
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

function buildExportReviewStatusText(review) {
  const warnings = review.warnings?.length || 0;
  const cutawayText = review.cutawayStored
    ? `${review.cutawayAppliedCount || 0} cutaway view${review.cutawayAppliedCount === 1 ? "" : "s"} ready`
    : "no cutaway selected";
  const manualText = review.manualStoredCount
    ? `${review.manualAppliedCount || 0} manual check${review.manualAppliedCount === 1 ? "" : "s"} ready`
    : "no manual boxes selected";

  return `${manualText}, ${cutawayText}. ${warnings ? `${warnings} review note${warnings === 1 ? "" : "s"} to check.` : "No blocking review notes."}`;
}

function formatReviewManualMetric(review) {
  const storedCount = review.manualStoredCount || 0;

  if (!storedCount) {
    return "None";
  }

  return `${review.manualAppliedCount || 0}/${storedCount * Math.max(1, review.variantCount || 1)}`;
}

function formatReviewCutawayMetric(review) {
  if (!review.cutawayStored) {
    return "None";
  }

  return `${review.cutawayAppliedCount || 0}/${Math.max(1, review.variantCount || 1)}`;
}

function formatReviewVariantManual(variant) {
  const storedCount = variant.manualStoredCount || 0;

  if (!storedCount) {
    return "manual none";
  }

  return `${variant.manualAppliedCount || 0}/${storedCount} manual`;
}

function formatReviewVariantCutaway(variant) {
  if (!variant.cutawayStored) {
    return "cutaway none";
  }

  if (!variant.cutawayApplied) {
    return "cutaway skipped";
  }

  const projection = variant.cutawayRegion?.projection || "resolved";
  return `cutaway ${projection}`;
}

function buildReviewVariantDetail(variant) {
  const manualText = formatProjectionStats("manual", variant.manualProjectionStats);
  const cutawayText = formatProjectionStats("cutaway", variant.cutawayResolutionStats);
  const cutawaySize = variant.cutawayRegion?.width && variant.cutawayRegion?.height
    ? ` Cutaway crop ${variant.cutawayRegion.width}x${variant.cutawayRegion.height}.`
    : "";

  return `${manualText || "No manual boxes for this view."} ${cutawayText || "No cutaway region for this view."}${cutawaySize}`;
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

function buildCaptureSuccessMessage(response, settings) {
  const fileText = `${response.files.length} file${response.files.length === 1 ? "" : "s"} saved using ${response.exportPreset} export mode`;
  const variantCount = response.variantCount || getCaptureVariants(settings.devicePreset).length;
  const manifestText = response.manifestFile ? " Bundle manifest saved." : "";
  const folderText = response.archiveFolder ? ` Saved in ${response.archiveFolder}.` : "";
  const captureNote = normalizeCaptureNoteOptions(settings);
  const noteText = response.annotation?.enabled || captureNote.enabled ? " Capture note added." : "";
  const manualText = response.manualRedactionCount
    ? ` ${response.manualRedactionCount} manual box${response.manualRedactionCount === 1 ? "" : "es"} applied.`
    : "";
  const cutawayText = response.cutawayCount
    ? ` ${response.cutawayCount} cutaway crop${response.cutawayCount === 1 ? "" : "s"} exported.`
    : "";
  const projectionText = formatManualProjectionStats(response.manualProjectionStats);
  const projectionSentence = projectionText ? ` ${projectionText}.` : "";
  const cutawayProjectionText = formatCutawayResolutionStats(response.cutawayResolutionStats);
  const cutawayProjectionSentence = cutawayProjectionText ? ` ${cutawayProjectionText}.` : "";

  if (!response.redactionCount) {
    return variantCount > 1
      ? `${fileText}. ${variantCount} responsive views captured.${manifestText}${folderText}${noteText}${manualText}${cutawayText}${projectionSentence}${cutawayProjectionSentence}`
      : `${fileText}.${manifestText}${folderText}${noteText}${manualText}${cutawayText}${projectionSentence}${cutawayProjectionSentence}`;
  }

  return `${fileText}. ${variantCount > 1 ? `${variantCount} responsive views captured. ` : ""}${response.redactionCount} redaction region${response.redactionCount === 1 ? "" : "s"} sanitized.${manifestText}${folderText}${noteText}${manualText}${cutawayText}${projectionSentence}${cutawayProjectionSentence}`;
}

function buildRedactionPreviewText(preview) {
  const autoCount = preview?.autoRedactionCount || 0;
  const manualCount = preview?.manualRedactionCount || 0;
  const total = preview?.redactionCount ?? autoCount + manualCount;
  const kinds = formatRedactionKinds(preview?.redactionBreakdown?.byKind);

  if (!total) {
    return "No sensitive regions detected in the current DOM. Review the page before external sharing.";
  }

  return `${total} region${total === 1 ? "" : "s"} found: ${autoCount} auto, ${manualCount} manual${kinds ? ` (${kinds})` : ""}.`;
}

function buildHistorySummaryText(item) {
  const lines = [
    "Lumen capture summary",
    `Title: ${item.title || item.host || "Untitled capture"}`,
    `URL: ${item.url || "Unknown"}`,
    `Captured: ${formatTimestamp(item.capturedAt)}`,
    `Views: ${item.variants?.length || 1}`,
    `Files: ${item.files?.length || 0}`,
    `Redactions: ${item.redactionCount || 0}`,
    item.manualRedactionCount ? `Manual boxes: ${item.manualRedactionCount}` : "",
    item.cutawayCount ? `Cutaway crops: ${item.cutawayCount}` : "",
    item.manifestFile ? `Manifest: ${item.manifestFile}` : "Manifest: not saved",
    item.archiveFolder ? `Folder: ${item.archiveFolder}` : "",
    item.blueprintSummary?.siteType ? `Page type: ${item.blueprintSummary.siteType}` : "",
    item.blueprintSummary?.heroHeadline ? `Hero: ${item.blueprintSummary.heroHeadline}` : "",
    item.blueprintSummary?.primaryCta ? `Primary CTA: ${item.blueprintSummary.primaryCta}` : "",
    item.annotation?.text ? `Note: ${item.annotation.text}` : ""
  ];

  return lines.filter(Boolean).join("\n");
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard write was blocked.");
  }
}

function formatRedactionKinds(byKind = {}) {
  return Object.entries(byKind)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${kind}`)
    .join(", ");
}

function formatManualProjectionStats(stats = {}) {
  const storedCount = Number.isFinite(stats.storedCount) ? Math.max(0, Math.round(stats.storedCount)) : 0;

  if (!storedCount) {
    return "";
  }

  const projectedCount = Number.isFinite(stats.projectedCount) ? Math.max(0, Math.round(stats.projectedCount)) : 0;
  const directCount = Number.isFinite(stats.directCount) ? Math.max(0, Math.round(stats.directCount)) : 0;
  const skippedCount = Number.isFinite(stats.skippedCount) ? Math.max(0, Math.round(stats.skippedCount)) : 0;
  const parts = [];

  if (projectedCount) {
    parts.push(`${projectedCount} projected`);
  }

  if (directCount) {
    parts.push(`${directCount} direct`);
  }

  if (skippedCount) {
    parts.push(`${skippedCount} skipped`);
  }

  return parts.length ? `manual projection ${parts.join(", ")}` : "";
}

function formatCutawayResolutionStats(stats = {}) {
  const storedCount = Number.isFinite(stats.storedCount) ? Math.max(0, Math.round(stats.storedCount)) : 0;

  if (!storedCount) {
    return "";
  }

  const projectedCount = Number.isFinite(stats.projectedCount) ? Math.max(0, Math.round(stats.projectedCount)) : 0;
  const directCount = Number.isFinite(stats.directCount) ? Math.max(0, Math.round(stats.directCount)) : 0;
  const skippedCount = Number.isFinite(stats.skippedCount) ? Math.max(0, Math.round(stats.skippedCount)) : 0;
  const parts = [];

  if (projectedCount) {
    parts.push(`${projectedCount} projected`);
  }

  if (directCount) {
    parts.push(`${directCount} direct`);
  }

  if (skippedCount) {
    parts.push(`${skippedCount} skipped`);
  }

  return parts.length ? `cutaway ${parts.join(", ")}` : "";
}

function formatBytes(value = 0) {
  const bytes = Math.max(0, Number(value) || 0);

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function shortenPath(value = "") {
  const parts = String(value).split(/[\\/]+/).filter(Boolean);

  if (parts.length <= 2) {
    return value;
  }

  return `${parts.at(-2)}/${parts.at(-1)}`;
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

function formatTabHost(url) {
  try {
    return new URL(url).host.replace(/^www\./, "") || "Current tab";
  } catch {
    return "Current tab";
  }
}

function formatLogTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

async function refreshManualRedactions() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_GET_MANUAL_REDACTIONS"
    });

    renderManualRedactions(response?.record);
  } catch {
    renderManualRedactions(null);
  }
}

async function refreshCutawayRegion() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_GET_CUTAWAY_REGION"
    });

    renderCutawayRegion(response?.record);
  } catch {
    renderCutawayRegion(null);
  }
}

async function refreshAnnotationRegion() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_GET_ANNOTATION_REGION"
    });

    renderAnnotationRegion(response?.record);
  } catch {
    renderAnnotationRegion(null);
  }
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value || 0);
}
