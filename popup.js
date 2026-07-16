import {
  LUMEN_CONFIG,
  STORAGE_KEYS,
  buildOriginPattern,
  getDefaultSettings,
  getSyncSafeSettings,
  getFeatureAccess,
  getPlanEntitlements,
  getCaptureVariants,
  isOriginPermissionSupported,
  normalizeCaptureNoteOptions,
  requiresOriginPermission
} from "./config.js";
import {
  countLibraryCaptures,
  getLibraryPreviewAsset,
  listLibraryCaptures
} from "./library-store.js";

const ui = {
  onboardingPanel: document.querySelector("#onboardingPanel"),
  onboardingStartButton: document.querySelector("#onboardingStartButton"),
  onboardingSettingsButton: document.querySelector("#onboardingSettingsButton"),
  onboardingDismissButton: document.querySelector("#onboardingDismissButton"),
  onboardingPageStatus: document.querySelector("#onboardingPageStatus"),
  onboardingSteps: [...document.querySelectorAll("[data-onboarding-step]")],
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
  startLassoPickerButton: document.querySelector("#startLassoPickerButton"),
  clearCutawayButton: document.querySelector("#clearCutawayButton"),
  explainCutawayPlanButton: document.querySelector("#explainCutawayPlanButton"),
  cutawaySummary: document.querySelector("#cutawaySummary"),
  watchIntervalSelect: document.querySelector("#watchIntervalSelect"),
  watchModeSelect: document.querySelector("#watchModeSelect"),
  watchDelaySelect: document.querySelector("#watchDelaySelect"),
  watchContinuousIntervalSelect: document.querySelector("#watchContinuousIntervalSelect"),
  watchMaxRunsSelect: document.querySelector("#watchMaxRunsSelect"),
  watchSaveOnlyOnChange: document.querySelector("#watchSaveOnlyOnChange"),
  watchModeHint: document.querySelector("#watchModeHint"),
  watchModeFields: [...document.querySelectorAll("[data-watch-mode-field]")],
  watchMaxRunsField: document.querySelector("#watchMaxRunsField"),
  saveWatchPlanButton: document.querySelector("#saveWatchPlanButton"),
  runWatchPlanNowButton: document.querySelector("#runWatchPlanNowButton"),
  watchPlanCard: document.querySelector("#watchPlanCard"),
  watchPlanStatus: document.querySelector("#watchPlanStatus"),
  watchPlanTitle: document.querySelector("#watchPlanTitle"),
  watchPlanMeta: document.querySelector("#watchPlanMeta"),
  toggleWatchPlanButton: document.querySelector("#toggleWatchPlanButton"),
  deleteWatchPlanButton: document.querySelector("#deleteWatchPlanButton"),
  watchPlanSummary: document.querySelector("#watchPlanSummary"),
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
  longPageButtons: [...document.querySelectorAll("[data-long-page]")],
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
  exportReviewOutputPlan: document.querySelector("#exportReviewOutputPlan"),
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
  productReadinessList: document.querySelector("#productReadinessList"),
  destinationSummary: document.querySelector("#destinationSummary"),
  queueLatestDeliveryButton: document.querySelector("#queueLatestDeliveryButton"),
  captureShelfCount: document.querySelector("#captureShelfCount"),
  captureShelfEmpty: document.querySelector("#captureShelfEmpty"),
  captureShelfGrid: document.querySelector("#captureShelfGrid"),
  photoLibraryCount: document.querySelector("#photoLibraryCount"),
  photoLibraryEmpty: document.querySelector("#photoLibraryEmpty"),
  photoLibraryGrid: document.querySelector("#photoLibraryGrid"),
  openPhotoLibraryButton: document.querySelector("#openPhotoLibraryButton"),
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
let latestWatchPlans = [];
let latestWatchRuns = [];
let expandedHistoryId = "";
let exportReviewDecision = null;
let onboardingState = {
  completedAt: "",
  dismissedAt: ""
};
let oneShotPermissionOrigin = "";
let photoLibraryObjectUrls = new Set();
let photoLibraryRenderVersion = 0;

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

  if (message?.type === "LUMEN_WATCH_PLANS_UPDATED") {
    renderWatchPlans(message.payload || []);
  }

  if (message?.type === "LUMEN_WATCH_RUNS_UPDATED") {
    renderWatchRuns(message.payload || []);
  }

  if (message?.type === "LUMEN_LIBRARY_UPDATED") {
    refreshPhotoLibrary().catch(() => {});
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
  await restoreOnboardingState();
  bindEvents();
  updateWatchScheduleControls();
  const launchStatusPromise = refreshLaunchStatus();
  await restoreAppState();
  await refreshPhotoLibrary();
  applyPlanGates();
  await launchStatusPromise;
}

function bindEvents() {
  ui.onboardingStartButton.addEventListener("click", handleCaptureClick);
  ui.onboardingSettingsButton.addEventListener("click", handleOnboardingSettings);
  ui.onboardingDismissButton.addEventListener("click", dismissOnboarding);
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
  ui.startLassoPickerButton.addEventListener("click", handleStartLassoPicker);
  ui.clearCutawayButton.addEventListener("click", handleClearCutawayRegion);
  ui.explainCutawayPlanButton.addEventListener("click", handleExplainCutawayPlan);
  ui.saveWatchPlanButton.addEventListener("click", handleSaveWatchPlan);
  ui.runWatchPlanNowButton.addEventListener("click", handleRunWatchPlanNow);
  ui.toggleWatchPlanButton.addEventListener("click", handleToggleWatchPlan);
  ui.deleteWatchPlanButton.addEventListener("click", handleDeleteWatchPlan);
  ui.watchModeSelect.addEventListener("change", updateWatchScheduleControls);
  ui.openPhotoLibraryButton.addEventListener("click", () => openPhotoLibrary());
  ui.startAnnotationPickerButton.addEventListener("click", handleStartAnnotationPicker);
  ui.clearAnnotationButton.addEventListener("click", handleClearAnnotationRegion);

  window.addEventListener("unload", releasePhotoLibraryObjectUrls);

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
      if (button.dataset.export !== "raw" && !enforceFeatureAccess("beautify", "Framed output")) {
        return;
      }

      currentSettings.exportPreset = button.dataset.export;
      updateExportButtons();
      persistCurrentSettings();
    });
  }

  for (const button of ui.longPageButtons) {
    button.addEventListener("click", () => {
      currentSettings.longPageMode = button.dataset.longPage || "auto";
      updateLongPageButtons();
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
  ui.holdMenu.addEventListener("keydown", handleHoldMenuKeyDown);
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
  ui.queueLatestDeliveryButton.addEventListener("click", handleQueueLatestDelivery);
  ui.historyList.addEventListener("click", handleHistoryAction);
  ui.captureShelfGrid.addEventListener("click", handleHistoryAction);
}

async function restoreSettings() {
  const [stored, localPrivate] = await Promise.all([
    chrome.storage.sync.get(STORAGE_KEYS.settings),
    chrome.storage.local.get(STORAGE_KEYS.privateSettings)
  ]);
  const syncedSettings = stored[STORAGE_KEYS.settings] || {};
  const privateSettings = localPrivate[STORAGE_KEYS.privateSettings] || {};
  const legacyAnnotationText = typeof syncedSettings.annotationText === "string"
    ? syncedSettings.annotationText
    : "";
  currentSettings = {
    ...getDefaultSettings(),
    ...syncedSettings,
    annotationText: typeof privateSettings.annotationText === "string"
      ? privateSettings.annotationText
      : legacyAnnotationText
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
  updateLongPageButtons();
  updateAnnotationControls();
  renderRunSummary(currentSettings);
  renderTimeline("idle");
  renderStatusLog();

  if (Object.hasOwn(syncedSettings, "annotationText") || !localPrivate[STORAGE_KEYS.privateSettings]) {
    await Promise.all([
      chrome.storage.sync.set({
        [STORAGE_KEYS.settings]: getSyncSafeSettings(currentSettings)
      }),
      chrome.storage.local.set({
        [STORAGE_KEYS.privateSettings]: {
          annotationText: currentSettings.annotationText
        }
      })
    ]);
  }
}

async function restoreOnboardingState() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.onboarding);
  onboardingState = {
    ...onboardingState,
    ...(stored[STORAGE_KEYS.onboarding] || {})
  };
  renderOnboarding();
}

function renderOnboarding() {
  if (!ui.onboardingPanel) {
    return;
  }

  const hidden = Boolean(onboardingState.completedAt || onboardingState.dismissedAt || latestHistoryItems.length);
  ui.onboardingPanel.classList.toggle("is-hidden", hidden);

  if (hidden) {
    return;
  }

  const pageReady = !launchActionsBlocked && Boolean(launchTargetTab?.url);
  ui.onboardingPageStatus.textContent = pageReady
    ? `${formatTabHost(launchTargetTab.url)} is ready for review.`
    : "Open a normal web page to begin.";
  ui.onboardingStartButton.disabled = !pageReady || actionBusy;

  for (const step of ui.onboardingSteps) {
    step.classList.toggle("is-ready", step.dataset.onboardingStep === "review" || (step.dataset.onboardingStep === "page" && pageReady));
  }
}

function handleOnboardingSettings() {
  const settingsPanel = document.querySelector(".controls-panel");
  settingsPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => ui.removeStickyHeaders?.focus(), 180);
}

async function dismissOnboarding() {
  onboardingState.dismissedAt = new Date().toISOString();
  await chrome.storage.local.set({
    [STORAGE_KEYS.onboarding]: onboardingState
  });
  renderOnboarding();
}

async function completeOnboarding() {
  if (onboardingState.completedAt) {
    return;
  }

  onboardingState.completedAt = new Date().toISOString();
  onboardingState.dismissedAt = "";
  await chrome.storage.local.set({
    [STORAGE_KEYS.onboarding]: onboardingState
  });
  renderOnboarding();
}

async function restoreAppState() {
  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_BOOTSTRAP_APP"
  });

  if (!response?.ok) {
    renderBlueprint(null);
    renderHistory([]);
    renderWatchPlans([]);
    renderWatchRuns([]);
    renderSession(currentSession);
    await refreshManualRedactions();
    await refreshCutawayRegion();
    renderDataControls(currentDataControls);
    return;
  }

  renderBlueprint(response.latestBlueprint);
  renderHistory(response.captureHistory || []);
  renderWatchPlans(response.watchPlans || []);
  renderWatchRuns(response.watchRuns || []);
  renderSession(response.session || currentSession);
  await refreshManualRedactions();
  await refreshCutawayRegion();
  await refreshAnnotationRegion();
  await refreshDataControls();
  await refreshProductReadiness();
  await refreshDestinations();
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
      detail: "Lumen runs capture actions on normal webpages. Chrome, extension, and internal browser pages are blocked by the browser.",
      actionsBlocked: true
    });
    showStatus({
      tone: "error",
      eyebrow: "Blocked",
      title: "Page unavailable",
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
    detail: "Target tab selected for the Lumen action.",
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
    exportPreset: currentSettings.exportPreset,
    longPageMode: currentSettings.longPageMode || "auto"
  };

  const captureNote = normalizeCaptureNoteOptions(currentSettings);
  currentSettings.annotationEnabled = captureNote.enabled;
  currentSettings.annotationText = captureNote.text;
  currentSettings.annotationPosition = captureNote.position;
  ui.annotationEnabled.checked = captureNote.enabled;
  updateAnnotationCounter();
  updateLongPageButtons();
  updateAnnotationControls();
  renderRunSummary(currentSettings);

  await Promise.all([
    chrome.storage.sync.set({
      [STORAGE_KEYS.settings]: getSyncSafeSettings(currentSettings)
    }),
    chrome.storage.local.set({
      [STORAGE_KEYS.privateSettings]: {
        annotationText: currentSettings.annotationText
      }
    })
  ]);
}

function updateAnnotationCounter() {
  if (!ui.annotationCounter) {
    return;
  }

  if (!ui.annotationEnabled?.checked) {
    ui.annotationCounter.textContent = "Disabled";
    return;
  }

  const noteLength = ui.annotationText?.value?.trim()?.length || 0;
  ui.annotationCounter.textContent = `${noteLength} / 180`;
}

function updateDeviceButtons() {
  for (const button of ui.deviceButtons) {
    const isActive = button.dataset.device === currentSettings.devicePreset;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function updateExportButtons() {
  for (const button of ui.exportButtons) {
    const isActive = button.dataset.export === currentSettings.exportPreset;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function updateLongPageButtons() {
  const mode = currentSettings.longPageMode || "auto";

  for (const button of ui.longPageButtons) {
    const isActive = button.dataset.longPage === mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function updateAnnotationControls() {
  const captureNote = normalizeCaptureNoteOptions(currentSettings);
  const enabled = Boolean(ui.annotationEnabled.checked);

  currentSettings.annotationEnabled = enabled;
  currentSettings.annotationPosition = captureNote.position;
  ui.annotationBlock.classList.toggle("is-disabled", !enabled);
  ui.annotationText.disabled = !enabled;
  updateAnnotationCounter();

  for (const button of ui.annotationPositionButtons) {
    const isActive = button.dataset.annotationPosition === captureNote.position;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
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
      ? "Responsive capture is available in advanced mode."
      : "";

    if (button.disabled && button.dataset.device === currentSettings.devicePreset) {
      currentSettings.devicePreset = "desktop";
    }
  }

  for (const button of ui.exportButtons) {
    const requiresBeautify = button.dataset.export !== "raw";
    button.disabled = requiresBeautify && !canBeautify;
    button.title = button.disabled
      ? "Browser and phone frames are available in advanced mode."
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

function handleHoldMenuKeyDown(event) {
  const actions = ui.holdMenuActions.filter((button) => !button.disabled);

  if (!actions.length) {
    return;
  }

  const activeIndex = actions.indexOf(document.activeElement);
  let nextIndex = activeIndex;

  if (event.key === "ArrowDown") {
    nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % actions.length;
  } else if (event.key === "ArrowUp") {
    nextIndex = activeIndex < 0 ? actions.length - 1 : (activeIndex - 1 + actions.length) % actions.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = actions.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  actions[nextIndex].focus();
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

  if (action === "lasso") {
    await handleStartLassoPicker();
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
  ui.holdMenu.inert = false;
  ui.captureButton.setAttribute("aria-expanded", "true");
  renderLaunchStatus({
    state: "ready",
    title: source === "keyboard" ? "Quick actions open" : "Hold menu ready",
    detail: "Choose a capture action from the main control."
  });

  if (source === "keyboard") {
    ui.holdMenuActions.find((button) => !button.disabled)?.focus();
  }
}

function closeHoldMenu() {
  const restoreCaptureFocus = ui.holdMenu.contains(document.activeElement);
  clearHoldTimer();
  ui.captureButton.classList.remove("is-holding");
  ui.launchPanel.classList.remove("is-menu-open");
  ui.holdMenu.setAttribute("aria-hidden", "true");
  ui.holdMenu.inert = true;
  ui.captureButton.setAttribute("aria-expanded", "false");

  if (restoreCaptureFocus) {
    ui.captureButton.focus();
  }
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
      await releaseOneShotPermission();
      showStatus({
        tone: "neutral",
        stage: "inspect",
        eyebrow: "Check",
        title: "Save paused",
        detail: "Adjust settings, redaction boxes, or focused crop region before saving.",
        badge: "Paused",
        progress: 0.18
      });
      return;
    }

    await runApprovedCapture();
  } catch (error) {
    await releaseOneShotPermission();
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
    detail: "Passing the checked capture settings into the save flow.",
    badge: "Queued",
    progress: 0.05
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_START_CAPTURE",
      payload: {
        options: {
          ...currentSettings,
          permissionLeaseOrigin: oneShotPermissionOrigin
        }
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
    await completeOnboarding();
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
    oneShotPermissionOrigin = "";
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
    title: "Preparing save review",
    detail: "Checking requested viewports, sensitive regions, manual boxes, and focused crop resolution before saving.",
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
      throw new Error(response?.error?.description || "Save check failed to prepare.");
    }

    renderExportReview(response);

    showStatus({
      tone: "neutral",
      stage: "inspect",
      eyebrow: "Review",
      title: "Save check ready",
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
      title: "Save check failed",
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
      throw new Error(response?.error?.description || "Redaction scan failed.");
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
    detail: "Mark the areas to hide, then save them from the page overlay.",
    badge: "Picker",
    progress: 0.08
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_START_REDACTION_PICKER"
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Manual redaction picker failed to start.");
    }

    renderManualRedactions(response.record);

    showStatus({
      tone: "success",
      eyebrow: "Redact",
      title: "Picker ready on page",
      detail: "Manual boxes are stored for this URL and applied to captures.",
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
      throw new Error(response?.error?.description || "Manual redactions failed to clear.");
    }

    renderManualRedactions(response.record);

    showStatus({
      tone: "neutral",
      eyebrow: "Redact",
      title: "Manual boxes cleared",
      detail: "Manual boxes cleared. Mark new boxes to add custom redaction again.",
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
    detail: "Choose the page area you want to reuse, then save it from the page overlay.",
    badge: "Picker",
    progress: 0.08
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_START_CUTAWAY_PICKER",
      payload: {
        selectionMode: "rect"
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Cutaway picker failed to start.");
    }

    renderCutawayRegion(response.record);

    showStatus({
      tone: "success",
      eyebrow: "Cutaway",
      title: "Cutaway picker ready",
      detail: "The selected region is stored for this URL and can be used for timed captures.",
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

async function handleStartLassoPicker() {
  if (actionBusy) {
    return;
  }

  if (!(await ensureActionTargetReady("lasso a capture region"))) {
    return;
  }

  setActionBusy(true);

  showStatus({
    tone: "neutral",
    eyebrow: "Lasso",
    title: "Opening lasso picker",
    detail: "Draw around the page area you want to reuse. Lumen saves the lasso and a clean crop around it.",
    badge: "Picker",
    progress: 0.08
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_START_CUTAWAY_PICKER",
      payload: {
        selectionMode: "lasso"
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Lasso picker failed to start.");
    }

    renderCutawayRegion(response.record);

    showStatus({
      tone: "success",
      eyebrow: "Lasso",
      title: "Lasso region stored",
      detail: "The lasso is saved for this URL. PNG exports keep the drawn shape and leave the outside transparent.",
      badge: "Ready",
      progress: 1
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Lasso",
      title: "Picker failed",
      detail: error.message,
      badge: "Failed",
      progress: 0.12
    });
  } finally {
    setActionBusy(false);
  }
}

async function handleSaveWatchPlan() {
  if (actionBusy) {
    return;
  }

  if (!enforceFeatureAccess("regionWatch", "Timed capture")) {
    return;
  }

  if (!cutawayRegionRecord.region) {
    showStatus({
      tone: "neutral",
      eyebrow: "Watch",
      title: "Mark a region first",
      detail: "Use Mark cutaway or Lasso area, then save that region as a timed capture.",
      badge: "Choose region",
      progress: 0.12
    });
    return;
  }

  const tab = await ensureActionTargetReady("save a timed capture");

  if (!tab) {
    return;
  }

  const hasWatchAccess = await ensureOriginPermissionForTab(tab, "Timed capture needs site access so Chrome can run the saved region later.");

  if (!hasWatchAccess) {
    return;
  }

  setActionBusy(true);

  try {
    const schedule = buildWatchSchedulePayload();
    const existingPlan = selectCurrentWatchPlan();
    const planPayload = {
      title: tab.title || new URL(tab.url).hostname,
      url: tab.url,
      status: "active",
      selectionMode: cutawayRegionRecord.region.shape === "lasso" ? "lasso" : "rect",
      region: cutawayRegionRecord.region,
      schedule,
      destination: "local",
      explicitOptIn: true
    };
    const response = await chrome.runtime.sendMessage({
      type: existingPlan ? "LUMEN_UPDATE_WATCH_PLAN" : "LUMEN_SAVE_WATCH_PLAN",
      payload: existingPlan
        ? {
            watchPlanId: existingPlan.id,
            patch: planPayload
          }
        : planPayload
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Timed capture failed to save.");
    }

    renderWatchPlans([
      response.watchPlan,
      ...latestWatchPlans.filter((plan) => plan.id !== response.watchPlan?.id)
    ].filter(Boolean));
    renderWatchPlanSummary(response.watchPlan);
    renderWatchRuns(response.watchRuns || latestWatchRuns);
    await refreshProductReadiness();

    showStatus({
      tone: "success",
      eyebrow: "Watch",
      title: existingPlan ? "Area monitor updated" : "Area monitor saved",
      detail: `${response.watchPlan.title || tab.title || "This page"} will run ${formatWatchSchedule(schedule)}.`,
      badge: "Saved",
      progress: 1
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Watch",
      title: "Timed capture blocked",
      detail: error.message,
      badge: "Blocked",
      progress: 0.12
    });
  } finally {
    setActionBusy(false);
  }
}

function buildWatchSchedulePayload() {
  const mode = ["once", "repeat", "continuous"].includes(ui.watchModeSelect.value)
    ? ui.watchModeSelect.value
    : "once";
  const delaySeconds = Math.max(5, Number(ui.watchDelaySelect.value) || 5);
  const intervalMinutes = mode === "continuous"
    ? Math.max(1, Number(ui.watchContinuousIntervalSelect.value) || 1)
    : Math.max(15, Number(ui.watchIntervalSelect.value) || 60);
  const maxRuns = mode === "once"
    ? 1
    : mode === "continuous"
      ? Math.max(2, Number(ui.watchMaxRunsSelect.value) || 25)
      : 0;

  return {
    mode,
    intervalMinutes,
    delaySeconds,
    maxRuns,
    saveOnlyWhenChanged: mode !== "once" && ui.watchSaveOnlyOnChange.checked,
    runAt: mode === "once" ? new Date(Date.now() + delaySeconds * 1000).toISOString() : "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local"
  };
}

function updateWatchScheduleControls() {
  const mode = ui.watchModeSelect.value || "once";

  for (const field of ui.watchModeFields) {
    field.classList.toggle("is-hidden", field.dataset.watchModeField !== mode);
  }

  ui.watchMaxRunsField.classList.toggle("is-hidden", mode !== "continuous");
  ui.watchSaveOnlyOnChange.closest(".watch-change-row")?.classList.toggle("is-hidden", mode === "once");

  const hints = {
    once: "One reviewed area will be captured after a short delay—useful for opening a menu or preparing a hover state.",
    repeat: "The reviewed area will be checked on a durable browser schedule until you pause it.",
    continuous: "Lumen will check the reviewed area repeatedly, save only visual changes, and stop at the run cap."
  };
  ui.watchModeHint.textContent = hints[mode] || hints.once;
}

async function handleRunWatchPlanNow() {
  if (actionBusy) {
    return;
  }

  if (!enforceFeatureAccess("regionWatch", "Timed capture")) {
    return;
  }

  const watchPlan = selectActiveWatchPlan();

  if (!watchPlan?.id) {
    showStatus({
      tone: "neutral",
      eyebrow: "Watch",
      title: "Save a timed capture first",
      detail: "Mark a focused region, save the timed capture, then run it whenever you need a fresh check.",
      badge: "Setup",
      progress: 0.12
    });
    return;
  }

  setActionBusy(true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_RUN_WATCH_PLAN_NOW",
      payload: {
        watchPlanId: watchPlan.id
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Timed capture could not run.");
    }

    renderWatchPlans(response.watchPlans || latestWatchPlans);
    renderWatchRuns(response.watchRuns || latestWatchRuns);

    const latestRun = (response.watchRuns || []).find((run) => run.watchPlanId === watchPlan.id) || null;
    const status = latestRun?.status || "captured";

    showStatus({
      tone: status === "captured" ? "success" : status === "running" ? "neutral" : "error",
      eyebrow: "Watch",
      title: status === "captured" ? "Timed capture saved" : "Timed capture updated",
      detail: formatWatchRunStatus(latestRun, watchPlan),
      badge: titleCase(status),
      progress: status === "captured" ? 1 : 0.64
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Watch",
      title: "Timed capture blocked",
      detail: error.message,
      badge: "Blocked",
      progress: 0.12
    });
  } finally {
    setActionBusy(false);
  }
}

async function handleToggleWatchPlan() {
  if (actionBusy) {
    return;
  }

  if (!enforceFeatureAccess("regionWatch", "Timed capture")) {
    return;
  }

  const watchPlan = selectCurrentWatchPlan();

  if (!watchPlan?.id) {
    showStatus({
      tone: "neutral",
      eyebrow: "Watch",
      title: "Timed capture setup",
      detail: "Save a focused region before pausing or resuming a timed capture.",
      badge: "Setup",
      progress: 0.12
    });
    return;
  }

  const nextStatus = watchPlan.status === "active" ? "paused" : "active";
  const restartSchedule = watchPlan.status === "completed" && watchPlan.schedule?.mode === "once"
    ? {
        ...watchPlan.schedule,
        runAt: new Date(Date.now() + Math.max(5, Number(watchPlan.schedule.delaySeconds) || 10) * 1000).toISOString()
      }
    : null;
  setActionBusy(true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_UPDATE_WATCH_PLAN",
      payload: {
        watchPlanId: watchPlan.id,
        patch: {
          status: nextStatus,
          ...(restartSchedule ? { schedule: restartSchedule, runCount: 0 } : {}),
          explicitOptIn: true
        }
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Timed capture could not be updated.");
    }

    renderWatchPlans(response.watchPlans || latestWatchPlans);

    showStatus({
      tone: "success",
      eyebrow: "Watch",
      title: nextStatus === "active" ? "Timed capture resumed" : "Timed capture paused",
      detail: nextStatus === "active"
        ? `${watchPlan.title || "Area monitor"} will run ${formatWatchSchedule(restartSchedule || watchPlan.schedule)}.`
        : `${watchPlan.title || "Timed capture"} will stay in the shelf and stop scheduled runs.`,
      badge: titleCase(nextStatus),
      progress: 1
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Watch",
      title: "Timed capture blocked",
      detail: error.message,
      badge: "Blocked",
      progress: 0.12
    });
  } finally {
    setActionBusy(false);
  }
}

async function handleDeleteWatchPlan() {
  if (actionBusy) {
    return;
  }

  const watchPlan = selectCurrentWatchPlan();

  if (!watchPlan?.id) {
    return;
  }

  setActionBusy(true);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_DELETE_WATCH_PLAN",
      payload: {
        watchPlanId: watchPlan.id
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Timed capture could not be cleared.");
    }

    renderWatchPlans(response.watchPlans || []);
    renderWatchRuns(response.watchRuns || latestWatchRuns);
    await releaseOriginPermissionIfUnused(buildOriginPattern(watchPlan.url));

    showStatus({
      tone: "success",
      eyebrow: "Watch",
      title: "Timed capture cleared",
      detail: "Scheduled runs are off. Existing capture shelf items stay available.",
      badge: "Cleared",
      progress: 1
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Watch",
      title: "Timed capture blocked",
      detail: error.message,
      badge: "Blocked",
      progress: 0.12
    });
  } finally {
    setActionBusy(false);
  }
}

async function ensureOriginPermissionForTab(tab, detail) {
  if (!tab?.url || !isOriginPermissionSupported(tab.url)) {
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
    title: "Site access needed",
    detail,
    badge: "Prompt",
    progress: 0.08
  });

  const granted = await chrome.permissions.request({
    origins: [origin]
  });

  if (!granted) {
    showStatus({
      tone: "error",
      eyebrow: "Permission",
      title: "Site access denied",
      detail: "Chrome needs site access before a timed capture can run in the background.",
      badge: "Blocked",
      progress: 0.08
    });
  }

  return granted;
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
      throw new Error(response?.error?.description || "Cutaway region failed to clear.");
    }

    renderCutawayRegion(response.record);

    showStatus({
      tone: "neutral",
      eyebrow: "Cutaway",
      title: "Cutaway cleared",
      detail: "Save a reusable region for this URL when you need a focused crop.",
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
    detail: "Draw one box around the page area that should be highlighted in the saved image.",
    badge: "Picker",
    progress: 0.08
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_START_ANNOTATION_PICKER"
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Annotation picker failed to start.");
    }

    renderAnnotationRegion(response.record);

    showStatus({
      tone: "success",
      eyebrow: "Annotate",
      title: "Callout picker ready",
      detail: "The selected region is stored locally for this URL and rendered into the saved image with the capture note.",
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
      throw new Error(response?.error?.description || "Annotation callout failed to clear.");
    }

    renderAnnotationRegion(response.record);

    showStatus({
      tone: "neutral",
      eyebrow: "Annotate",
      title: "Callout cleared",
      detail: "Exports keep the note text and skip the highlighted page region.",
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
    title: hasRegion ? "Focused crop details" : "Mark a region first",
    detail: hasRegion
      ? "The selected region is stored locally for this URL and saved beside matching captures."
      : "Use Mark cutaway to save one page area for focused crops.",
    badge: hasRegion ? "Stored" : "Choose region",
    progress: hasRegion ? 0.42 : 0.12
  });
}

async function ensurePermissionsForCurrentCapture() {
  oneShotPermissionOrigin = "";

  if (!requiresOriginPermission(currentSettings.devicePreset)) {
    return true;
  }

  const tab = launchTargetTab || await resolveActionTargetTab();

  if (!tab?.url || !isOriginPermissionSupported(tab.url)) {
    showStatus({
      tone: "error",
      eyebrow: "Blocked",
      title: "Page unavailable",
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
      detail: "Tablet, mobile, and responsive set capture need temporary permission for this site. Desktop capture still works with the active tab permission.",
      badge: "Blocked",
      progress: 0.08
    });
  }

  if (granted) {
    oneShotPermissionOrigin = origin;
  }

  return granted;
}

async function releaseOneShotPermission() {
  const origin = oneShotPermissionOrigin;
  oneShotPermissionOrigin = "";

  if (!origin) {
    return;
  }

  await releaseOriginPermissionIfUnused(origin);
}

async function releaseOriginPermissionIfUnused(origin) {
  if (!origin || latestWatchPlans.some((plan) => {
    try {
      return plan?.url && buildOriginPattern(plan.url) === origin;
    } catch {
      return false;
    }
  })) {
    return false;
  }

  return chrome.permissions.remove({
    origins: [origin]
  });
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
      detail: response?.error?.description || "Demo session failed to start.",
      badge: "Failed",
      progress: 0.12
    });
    return;
  }

  renderSession(response.session);
  renderHistory(response.captureHistory || []);
  renderWatchPlans(response.watchPlans || latestWatchPlans);
  renderWatchRuns(response.watchRuns || []);
  await refreshDataControls();
  await refreshProductReadiness();
  await refreshDestinations();

  showStatus({
    tone: "success",
    eyebrow: "Auth",
    title: "Advanced tools enabled",
    detail: response.session.source === "remote"
      ? "Advanced access loaded and ready to sync captures."
      : "The local service is unavailable, so Lumen kept working in this browser.",
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
  await refreshProductReadiness();
  await refreshDestinations();
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
    eyebrow: "Access",
    title: `${entitlements.label} access active`,
    detail: "Current access controls responsive capture, framed output, sync, and history tools.",
    badge: "Access",
    progress: 0.12
  });
}

async function refreshProductReadiness() {
  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_GET_PRODUCT_READINESS"
  });

  renderProductReadiness(response?.readiness);
}

async function refreshDestinations() {
  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_GET_DESTINATIONS"
  });

  renderDestinationSummary(response?.destinations || []);
}

async function handleQueueLatestDelivery() {
  const latest = latestHistoryItems[0];

  if (!latest) {
    showStatus({
      tone: "neutral",
      eyebrow: "Routing",
      title: "Capture something first",
      detail: "Run a capture, then queue it for local delivery or a connected destination.",
      badge: "Empty",
      progress: 0.1
    });
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_QUEUE_DELIVERY",
    payload: {
      captureId: latest.id,
      files: latest.files || [],
      payloadSummary: {
        title: latest.title || latest.host || "Untitled capture",
        host: latest.host || "",
        fileCount: latest.files?.length || 0,
        redactionCount: latest.redactionCount || 0,
        manifestFile: latest.manifestFile || ""
      }
    }
  });

  if (!response?.ok) {
    showStatus({
      tone: "error",
      eyebrow: "Routing",
      title: response?.error?.title || "Delivery unavailable",
      detail: response?.error?.description || "Enable advanced tools before queueing deliveries.",
      badge: "Blocked",
      progress: 0.12
    });
    return;
  }

  showStatus({
    tone: "success",
    eyebrow: "Routing",
    title: "Delivery queued",
    detail: `${latest.title || latest.host || "Capture"} is queued for ${response.delivery.destinationLabel || "local history"}.`,
    badge: "Queued",
    progress: 1
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
      detail: response?.error?.description || "Start an advanced session before changing data controls.",
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
  const confirmed = window.confirm("Clear Lumen's local history, photo previews, page signals, saved regions, note draft, and area monitors? Downloaded originals stay on disk.");

  if (!confirmed) {
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_CLEAR_LOCAL_DATA"
  });

  if (!response?.ok) {
    showStatus({
      tone: "error",
      eyebrow: "Data",
      title: response?.error?.title || "Clear unavailable",
      detail: response?.error?.description || "Local workspace cleanup failed.",
      badge: "Blocked",
      progress: 0.12
    });
    return;
  }

  renderHistory(response.captureHistory || []);
  renderWatchPlans(response.watchPlans || []);
  renderWatchRuns(response.watchRuns || []);
  renderBlueprint(null);
  renderManualRedactions({ regions: [] });
  renderCutawayRegion({ region: null, regions: [] });
  renderAnnotationRegion({ region: null, regions: [] });
  await refreshPhotoLibrary();
  currentSettings.annotationText = "";
  ui.annotationText.value = "";
  updateAnnotationCounter();
  showStatus({
    tone: "success",
    eyebrow: "Data",
    title: "Local workspace cleared",
    detail: `${formatDeletedDataSummary(response.deleted)} Downloaded files remain on disk.`,
    badge: "Cleared",
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
  const watchRunId = button.dataset.watchRunId || "";
  const action = button.dataset.historyAction;

  if (action === "details") {
    expandedHistoryId = expandedHistoryId === captureId ? COLLAPSED_HISTORY_ID : captureId;
    renderHistory(latestHistoryItems);
    return;
  }

  if (action === "copy") {
    if (watchRunId) {
      await handleCopyWatchRunSummary(watchRunId, button);
      return;
    }

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
        detail: response?.error?.description || "Lumen failed to access that downloaded file.",
        badge: "Blocked",
        progress: 0.12
      });
      return;
    }

    showStatus({
      tone: "success",
      eyebrow: "Archive",
      title: action === "open" ? "Opened capture file" : "Revealed capture file",
      detail: response.archiveFolder
        ? `Saved in ${response.archiveFolder}.`
        : response.filename || "Chrome opened the local file.",
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
      detail: error.message || "The browser blocked clipboard access.",
      badge: "Failed",
      progress: 0.12
    });
  } finally {
    button.disabled = actionBusy;
  }
}

async function handleCopyWatchRunSummary(watchRunId, button) {
  const run = latestWatchRuns.find((record) => record.id === watchRunId);

  if (!run) {
    return;
  }

  button.disabled = true;

  try {
    await copyTextToClipboard(buildWatchRunSummaryText(run));
    showStatus({
      tone: "success",
      eyebrow: "Shelf",
      title: "Timed run summary copied",
      detail: "The timed capture summary is ready to paste into a review note or issue.",
      badge: "Copied",
      progress: 1
    });
  } catch (error) {
    showStatus({
      tone: "error",
      eyebrow: "Shelf",
      title: "Copy failed",
      detail: error.message || "The browser blocked clipboard access.",
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
    : `${entitlements.label} session`;
  ui.accountDescription.textContent = signedIn
    ? backendReachable
      ? `${entitlements.label} access loaded. New captures can sync into session history.`
      : `${entitlements.label} access loaded locally. Captures stay in this browser until the local service is reachable.`
    : `${entitlements.label} includes Lumen's complete local capture toolkit. ${lockedAdvancedCount} connected or team tool${lockedAdvancedCount === 1 ? " remains" : "s remain"} separate.`;
  ui.accountPlan.textContent = entitlements.label;
  ui.accountSource.textContent = source;
  ui.backendBadge.textContent = backendReachable ? "Connected" : "Local";
  ui.signInButton.classList.toggle("is-hidden", signedIn || plan === "demo-pro");
  ui.signOutButton.classList.toggle("is-hidden", !signedIn);
  ui.billingButton.disabled = !signedIn || plan === "free";
  applyPlanGates();
  renderDataControls(currentDataControls);
  updateDeliveryActionState();
}

function renderProductReadiness(payload = {}) {
  const meters = Array.isArray(payload?.readiness) && payload.readiness.length
    ? payload.readiness
    : [
        { label: "Capture core", score: 66, status: "local" },
        { label: "Save flow", score: 58, status: "ready" },
        { label: "Automation", score: 34, status: "queued" }
      ];

  ui.productReadinessList.replaceChildren();

  for (const meter of meters.slice(0, 3)) {
    const item = document.createElement("div");
    const label = document.createElement("span");
    const status = document.createElement("strong");
    const track = document.createElement("i");
    const bar = document.createElement("b");

    item.className = "readiness-item";
    label.textContent = meter.label || "Readiness";
    status.textContent = `${Math.max(0, Math.min(100, Math.round(meter.score || 0)))}% ${meter.status || ""}`.trim();
    bar.style.width = `${Math.max(4, Math.min(100, Math.round(meter.score || 0)))}%`;

    track.append(bar);
    item.append(label, status, track);
    ui.productReadinessList.append(item);
  }
}

function renderDestinationSummary(destinations = []) {
  const signedIn = Boolean(currentSession?.signedIn);
  const activeCount = destinations.filter((destination) => destination.status === "active").length;

  ui.destinationSummary.textContent = signedIn
    ? activeCount
      ? `${activeCount} destination${activeCount === 1 ? "" : "s"} ready. Latest captures can be queued after the save check.`
      : "Local delivery queue ready. Add connected destinations when the team workflow needs them."
    : "Local history is ready. Connected destinations appear after advanced tools are enabled.";

  updateDeliveryActionState();
}

function updateDeliveryActionState() {
  if (!ui.queueLatestDeliveryButton) {
    return;
  }

  const canQueue = Boolean(currentSession?.signedIn && latestHistoryItems.length);
  ui.queueLatestDeliveryButton.disabled = !canQueue;
  ui.queueLatestDeliveryButton.title = canQueue
    ? "Queue the latest capture in the delivery log."
    : "Enable advanced tools and run a capture before queueing delivery.";
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
  ui.deleteBackendDataButton.disabled = false;
  ui.dataControlsSummary.textContent = controlsAvailable
    ? `Retention is ${formatRetentionDays(currentDataControls.retentionDays)}. Cloud sync is ${currentDataControls.cloudSyncEnabled ? "allowed" : "off"}.`
    : signedIn
      ? "The local service is unavailable. Captures remain local in this browser."
      : "Captures stay local. You can clear history, saved regions, note drafts, and schedules at any time.";
}

function formatRetentionDays(days) {
  const normalized = Number(days);
  return normalized === 0 ? "manual delete only" : `${normalized} days`;
}

function formatWatchInterval(minutes) {
  const normalized = Number(minutes) || 60;

  if (normalized < 60) {
    return normalized === 1 ? "every minute" : `every ${normalized} minutes`;
  }

  if (normalized === 60) {
    return "hourly";
  }

  if (normalized % 1440 === 0) {
    const days = normalized / 1440;
    return days === 1 ? "daily" : `every ${days} days`;
  }

  if (normalized % 60 === 0) {
    const hours = normalized / 60;
    return `every ${hours} hours`;
  }

  return `every ${normalized} minutes`;
}

function formatWatchSchedule(schedule = {}) {
  const mode = schedule.mode || "repeat";

  if (mode === "once") {
    return `once after ${Math.max(5, Number(schedule.delaySeconds) || 10)} seconds`;
  }

  const cadence = formatWatchInterval(schedule.intervalMinutes || (mode === "continuous" ? 1 : 60));

  if (mode === "continuous") {
    return `${cadence}, up to ${Math.max(2, Number(schedule.maxRuns) || 10)} runs`;
  }

  return cadence;
}

function formatWatchRunStatus(run = null, plan = {}) {
  if (!run) {
    return `${plan.title || "Timed capture"} started. The result will appear in the capture shelf.`;
  }

  if (run.status === "captured") {
    const fileText = run.fileCount
      ? `${run.fileCount} file${run.fileCount === 1 ? "" : "s"}`
      : "Files";
    return `${run.title || plan.title || "Timed capture"} finished with ${fileText} in the capture shelf.`;
  }

  if (run.status === "unchanged") {
    return `${run.title || plan.title || "Selected area"} matched the previous run, so no duplicate photo was saved.`;
  }

  if (run.status === "skipped") {
    return run.error || "Another Lumen run was active, so this timed capture was skipped.";
  }

  if (run.status === "failed") {
    return run.error || "The saved page could not be captured.";
  }

  return `${run.title || plan.title || "Timed capture"} is running now.`;
}

function formatDeletedDataSummary(deleted = {}) {
  const parts = [
    `${deleted.captures || 0} capture${deleted.captures === 1 ? "" : "s"}`,
    `${deleted.watchPlans || 0} timed capture${deleted.watchPlans === 1 ? "" : "s"}`,
    `${deleted.watchRuns || 0} timed run${deleted.watchRuns === 1 ? "" : "s"}`,
    `${deleted.savedRegions || 0} saved region set${deleted.savedRegions === 1 ? "" : "s"}`,
    `${deleted.libraryPhotos || 0} library photo${deleted.libraryPhotos === 1 ? "" : "s"}`,
    deleted.pageSignals ? "page signals" : "0 page signals"
  ];

  return `Removed ${parts.join(", ")}.`;
}

function renderWatchRuns(watchRuns = []) {
  latestWatchRuns = Array.isArray(watchRuns) ? watchRuns : [];
  renderWatchPlanCard(selectCurrentWatchPlan());
  renderCaptureShelf(latestHistoryItems, latestWatchRuns);
}

function renderWatchPlans(watchPlans = []) {
  latestWatchPlans = Array.isArray(watchPlans) ? watchPlans : [];

  const currentPlan = selectCurrentWatchPlan();

  renderWatchPlanCard(currentPlan);

  if (currentPlan) {
    renderWatchPlanSummary(currentPlan);
  }

  updateActionDisabledState();
}

async function refreshPhotoLibrary() {
  const renderVersion = photoLibraryRenderVersion + 1;
  photoLibraryRenderVersion = renderVersion;
  releasePhotoLibraryObjectUrls();

  try {
    const [count, captures] = await Promise.all([
      countLibraryCaptures(),
      listLibraryCaptures({ limit: 4 })
    ]);

    if (renderVersion !== photoLibraryRenderVersion) {
      return;
    }

    ui.photoLibraryCount.textContent = `${count} photo${count === 1 ? "" : "s"}`;
    ui.photoLibraryGrid.replaceChildren();
    ui.photoLibraryEmpty.classList.toggle("is-hidden", captures.length > 0);
    ui.photoLibraryGrid.classList.toggle("is-hidden", captures.length === 0);

    for (const capture of captures) {
      const card = document.createElement("article");
      const previewButton = document.createElement("button");
      const image = document.createElement("img");
      const fallback = document.createElement("span");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      const meta = document.createElement("small");

      card.className = "photo-library-card";
      card.role = "listitem";
      card.dataset.captureId = capture.id;
      previewButton.className = "photo-library-preview";
      previewButton.type = "button";
      previewButton.setAttribute("aria-label", `Open ${capture.title || capture.host || "saved photo"} in the photo library`);
      previewButton.addEventListener("click", () => openPhotoLibrary(capture.id));
      image.className = "is-hidden";
      image.alt = `Preview of ${capture.title || capture.host || "saved capture"}`;
      fallback.className = "photo-library-preview-fallback";
      fallback.textContent = capture.sourceType === "timed" ? "Timed area" : "Capture";
      copy.className = "photo-library-copy";
      title.textContent = capture.title || capture.host || "Saved capture";
      meta.textContent = [
        capture.host || "Local",
        capture.sourceType === "timed" ? "Timed" : "Manual",
        formatTimestamp(capture.capturedAt)
      ].filter(Boolean).join(" · ");

      previewButton.append(image, fallback);
      copy.append(title, meta);
      card.append(previewButton, copy);
      ui.photoLibraryGrid.append(card);

      getLibraryPreviewAsset(capture.id).then((asset) => {
        if (!asset?.blob || renderVersion !== photoLibraryRenderVersion || !card.isConnected) {
          return;
        }

        const objectUrl = URL.createObjectURL(asset.blob);
        photoLibraryObjectUrls.add(objectUrl);
        image.addEventListener("load", () => {
          image.classList.remove("is-hidden");
          fallback.classList.add("is-hidden");
        }, { once: true });
        image.src = objectUrl;
      }).catch(() => {});
    }
  } catch (error) {
    ui.photoLibraryCount.textContent = "Unavailable";
    ui.photoLibraryGrid.classList.add("is-hidden");
    ui.photoLibraryEmpty.classList.remove("is-hidden");
    ui.photoLibraryEmpty.textContent = "The local photo library could not be opened in this browser context.";
  }
}

async function openPhotoLibrary(captureId = "") {
  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_OPEN_PHOTO_LIBRARY",
    payload: captureId ? { captureId } : {}
  });

  if (!response?.ok) {
    showStatus({
      tone: "error",
      eyebrow: "Library",
      title: "Photo library could not open",
      detail: response?.error?.description || "Chrome blocked the local library page.",
      badge: "Blocked",
      progress: 0.12
    });
  }
}

function releasePhotoLibraryObjectUrls() {
  for (const objectUrl of photoLibraryObjectUrls) {
    URL.revokeObjectURL(objectUrl);
  }

  photoLibraryObjectUrls.clear();
}

function selectActiveWatchPlan() {
  return latestWatchPlans.find((plan) => plan?.status === "active" && isWatchPlanForLaunchTarget(plan)) || null;
}

function selectCurrentWatchPlan() {
  return selectActiveWatchPlan() ||
    latestWatchPlans.find((plan) => plan?.id && isWatchPlanForLaunchTarget(plan)) ||
    null;
}

function isWatchPlanForLaunchTarget(plan = {}) {
  if (!launchTargetTab?.url || !plan?.url) {
    return false;
  }

  return normalizeWatchPageUrl(plan.url) === normalizeWatchPageUrl(launchTargetTab.url);
}

function normalizeWatchPageUrl(rawUrl = "") {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

function renderWatchPlanCard(watchPlan = null) {
  if (!watchPlan) {
    ui.watchPlanCard.classList.add("is-hidden");
    ui.watchPlanCard.removeAttribute("data-status");
    ui.watchPlanStatus.textContent = "Timed capture";
    ui.watchPlanTitle.textContent = "Ready for setup";
    ui.watchPlanMeta.textContent = "Save a focused region to start timed captures.";
    ui.toggleWatchPlanButton.textContent = "Pause";
    return;
  }

  const status = ["active", "paused", "completed"].includes(watchPlan.status)
    ? watchPlan.status
    : "active";
  const shapeLabel = watchPlan.selectionMode === "lasso" ? "Lasso" : "Region";
  const lastRun = latestWatchRuns.find((run) => run.watchPlanId === watchPlan.id);
  const runText = watchPlan.lastRunAt || lastRun?.completedAt || lastRun?.startedAt || lastRun?.scheduledAt
    ? `Last run ${formatTimestamp(watchPlan.lastRunAt || lastRun.completedAt || lastRun.startedAt || lastRun.scheduledAt)}`
    : "Awaiting first run";

  ui.watchPlanCard.classList.remove("is-hidden");
  ui.watchPlanCard.dataset.status = status;
  ui.watchPlanStatus.textContent = status === "active"
    ? "Active area monitor"
    : status === "completed"
      ? "Completed area monitor"
      : "Paused area monitor";
  ui.watchPlanTitle.textContent = watchPlan.title || watchPlan.host || "Timed capture";
  ui.watchPlanMeta.textContent = [
    formatWatchSchedule(watchPlan.schedule),
    shapeLabel,
    runText
  ].join(" · ");
  ui.toggleWatchPlanButton.textContent = status === "active" ? "Pause" : status === "completed" ? "Restart" : "Resume";
}

function renderCaptureShelf(history = latestHistoryItems, watchRuns = latestWatchRuns) {
  const captures = Array.isArray(history) ? history : [];
  const runs = Array.isArray(watchRuns) ? watchRuns : [];
  const watchCards = runs.slice(0, 4).map((run) => ({
    type: "watch",
    id: run.id,
    watchRunId: run.id || "",
    title: run.title || run.host || "Timed capture",
    meta: [
      "Timed",
      titleCase(run.status || "queued"),
      formatTimestamp(run.completedAt || run.startedAt || run.scheduledAt),
      run.fileCount ? `${run.fileCount} file${run.fileCount === 1 ? "" : "s"}` : "",
      run.error ? shortenText(run.error, 44) : ""
    ].filter(Boolean).join(" · "),
    captureId: run.captureId || "",
    status: run.status || "queued",
    badge: run.status === "captured" ? "Timed saved" : run.status === "unchanged" ? "No change" : `Timed ${titleCase(run.status || "queued")}`
  }));
  const captureCards = captures.slice(0, 6).map((item) => ({
    type: "capture",
    id: item.id,
    watchRunId: "",
    title: item.title || item.host || "Capture",
    meta: [
      item.host || "",
      formatTimestamp(item.capturedAt),
      item.variants?.length ? `${item.variants.length} view${item.variants.length === 1 ? "" : "s"}` : "",
      `${item.files?.length || 0} file${item.files?.length === 1 ? "" : "s"}`
    ].filter(Boolean).join(" · "),
    captureId: item.id || "",
    status: "captured",
    badge: "Capture"
  }));
  const cards = [...watchCards, ...captureCards].slice(0, 8);

  ui.captureShelfCount.textContent = [
    `${captures.length} capture${captures.length === 1 ? "" : "s"}`,
    `${runs.length} timed run${runs.length === 1 ? "" : "s"}`
  ].join(" · ");
  ui.captureShelfGrid.replaceChildren();

  if (!cards.length) {
    ui.captureShelfEmpty.classList.remove("is-hidden");
    ui.captureShelfGrid.classList.add("is-hidden");
    return;
  }

  ui.captureShelfEmpty.classList.add("is-hidden");
  ui.captureShelfGrid.classList.remove("is-hidden");

  for (const card of cards) {
    const item = document.createElement("article");
    const thumb = document.createElement("div");
    const copy = document.createElement("div");
    const titleRow = document.createElement("div");
    const badge = document.createElement("span");
    const title = document.createElement("strong");
    const meta = document.createElement("p");
    const actions = document.createElement("div");
    const copyButton = document.createElement("button");
    const openButton = document.createElement("button");
    const showButton = document.createElement("button");
    const hasCapture = Boolean(card.captureId);
    const captureRecord = captures.find((record) => record.id === card.captureId);
    const hasDownloadHandles = Array.isArray(captureRecord?.downloads) &&
      captureRecord.downloads.some((download) => Number.isInteger(download.downloadId));
    const canCopy = hasCapture || Boolean(card.watchRunId);

    item.className = "capture-shelf-card";
    item.dataset.kind = card.type;
    item.dataset.state = card.status;
    thumb.className = "capture-shelf-thumb";
    thumb.dataset.kind = card.type;
    thumb.innerHTML = "<span></span><span></span><span></span><span></span>";
    copy.className = "capture-shelf-copy";
    titleRow.className = "capture-shelf-title-row";
    badge.className = "capture-shelf-badge";
    badge.textContent = card.badge;
    title.textContent = card.title;
    meta.textContent = card.meta;
    actions.className = "capture-shelf-actions";
    titleRow.append(title, badge);

    copyButton.className = "history-action";
    copyButton.type = "button";
    copyButton.dataset.historyAction = "copy";
    copyButton.dataset.captureId = card.captureId;
    copyButton.dataset.watchRunId = card.watchRunId;
    copyButton.disabled = !canCopy;
    copyButton.textContent = "Copy";

    openButton.className = "history-action";
    openButton.type = "button";
    openButton.dataset.historyAction = "open";
    openButton.dataset.captureId = card.captureId;
    openButton.dataset.watchRunId = card.watchRunId;
    openButton.dataset.downloadReady = hasDownloadHandles ? "true" : "false";
    openButton.disabled = !hasDownloadHandles;
    openButton.textContent = "Open";

    showButton.className = "history-action";
    showButton.type = "button";
    showButton.dataset.historyAction = "show";
    showButton.dataset.captureId = card.captureId;
    showButton.dataset.watchRunId = card.watchRunId;
    showButton.dataset.downloadReady = hasDownloadHandles ? "true" : "false";
    showButton.disabled = !hasDownloadHandles;
    showButton.textContent = "Show";

    if (!hasDownloadHandles) {
      openButton.title = card.type === "watch"
        ? "Open becomes available after a timed run saves local files."
        : "Run a fresh capture to enable local file actions.";
      showButton.title = openButton.title;
    }

    actions.append(copyButton, openButton, showButton);
    copy.append(titleRow, meta, actions);
    item.append(thumb, copy);
    ui.captureShelfGrid.append(item);
  }
}

function renderHistory(history) {
  const items = Array.isArray(history) ? history : [];
  latestHistoryItems = items;
  renderOnboarding();
  renderCaptureShelf(latestHistoryItems, latestWatchRuns);
  ui.historyCount.textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
  ui.historyList.replaceChildren();

  if (!items.length) {
    expandedHistoryId = "";
    ui.historyEmpty.classList.remove("is-hidden");
    ui.historyList.classList.add("is-hidden");
    updateDeliveryActionState();
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
    badge.textContent = item.captureHealth?.status === "complete"
      ? "Verified"
      : item.exportPreset || "raw";
    badge.classList.toggle("is-verified", item.captureHealth?.status === "complete");

    topRow.append(title, badge);

    const meta = document.createElement("p");
    meta.className = "history-meta";
    meta.textContent = [
      item.host || "",
      formatTimestamp(item.capturedAt),
      item.variants?.length ? `${item.variants.length} view${item.variants.length === 1 ? "" : "s"}` : "",
      `${item.files?.length || 0} file${item.files?.length === 1 ? "" : "s"}`,
      item.manifestFile ? "details saved" : "",
      item.annotation?.text ? "note added" : "",
      item.manualRedactionCount ? `${item.manualRedactionCount} manual box${item.manualRedactionCount === 1 ? "" : "es"}` : "",
      item.cutawayCount ? `${item.cutawayCount} cutaway crop${item.cutawayCount === 1 ? "" : "s"}` : "",
      formatCaptureHealth(item.captureHealth),
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

  updateDeliveryActionState();
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
    ui.cutawayRegionStatus.textContent = "Choose region";
    ui.cutawaySummary.textContent = "The selected area is saved beside full-page captures when it is found.";
    if (selectActiveWatchPlan()) {
      renderWatchPlanSummary(selectActiveWatchPlan());
    } else {
      ui.watchPlanSummary.textContent = "Mark a region, then save it as a timed capture.";
    }
    updateActionDisabledState();
    renderRunSummary(currentSettings);
    return;
  }

  const shapeLabel = region.shape === "lasso" ? "Lasso" : "Region";
  ui.cutawayRegionStatus.textContent = `${shapeLabel} ${Math.round(region.width)}x${Math.round(region.height)}`;
  ui.cutawaySummary.textContent = [
    `Stored for ${record?.host || "this URL"}.`,
    `Top ${Math.round(region.top)}px, left ${Math.round(region.left)}px.`,
    region.shape === "lasso"
      ? "Captures preserve the lasso and leave pixels outside it transparent."
      : "Captures save focused crop PNGs when this region resolves."
  ].join(" ");
  ui.watchPlanSummary.textContent = `${shapeLabel} ready for timed capture. Choose a cadence and save it after checking the region.`;
  updateActionDisabledState();
  renderRunSummary(currentSettings);
}

function renderWatchPlanSummary(watchPlan = null) {
  if (!watchPlan) {
    return;
  }

  ui.watchPlanSummary.textContent = [
    `${watchPlan.title || "Timed capture"} saved.`,
    watchPlan.status === "paused"
      ? `Paused; cadence was ${formatWatchSchedule(watchPlan.schedule)}.`
      : watchPlan.status === "completed"
        ? `Completed after ${watchPlan.runCount || 0} run${watchPlan.runCount === 1 ? "" : "s"}.`
        : `Runs ${formatWatchSchedule(watchPlan.schedule)}.`,
    watchPlan.selectionMode === "lasso" ? "Lasso region retained." : "Focused region retained.",
    watchPlan.status === "paused"
      ? "Resume when you want scheduled runs again."
      : watchPlan.status === "completed"
        ? "Restart to run the selected area again."
        : "Use Run now for a fresh capture."
  ].join(" ");
}

function renderAnnotationRegion(record) {
  const region = record?.region || record?.regions?.[0] || null;
  annotationRegionRecord = {
    ...(record || {}),
    region,
    regions: region ? [region] : []
  };

  if (!region) {
    ui.annotationRegionStatus.textContent = "Choose target";
    ui.annotationRegionSummary.textContent = "Optional. Use this when a capture note needs to point at a specific page area.";
    updateActionDisabledState();
    renderRunSummary(currentSettings);
    return;
  }

  ui.annotationRegionStatus.textContent = `${Math.round(region.width)}x${Math.round(region.height)}`;
  ui.annotationRegionSummary.textContent = [
    `Stored for ${record?.host || "this URL"}.`,
    `Top ${Math.round(region.top)}px, left ${Math.round(region.left)}px.`,
    "Saved images draw this as a callout when the region resolves."
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
  const integrityState = formatCaptureHealth(item.captureHealth) || "Legacy";

  metrics.append(
    buildHistoryMetric("Views", String(viewCount)),
    buildHistoryMetric("Files", String(fileCount)),
    buildHistoryMetric("Redactions", String(redactionCount)),
    buildHistoryMetric("Cutaways", String(cutawayCount)),
    buildHistoryMetric("Integrity", integrityState),
    buildHistoryMetric("Details", manifestState)
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
      variant.redactionCount ? `${variant.redactionCount} redaction${variant.redactionCount === 1 ? "" : "s"}` : "",
      formatCaptureHealth(variant.captureHealth || variant.health)
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

  const panel = buildHistoryPanelShell("Files");
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
    kind: inferHistoryFileKind(filename),
    role: inferHistoryFileRole(filename)
  }));
}

function buildHistoryArtifactFilters(records) {
  const filterRow = document.createElement("div");
  const counts = countHistoryArtifacts(records);
  const filters = [
    ["all", "All", records.length],
    ["image", "Full page", counts.image],
    ["cutaway", "Cutaway", counts.cutaway],
    ["print-sheet", "Print sheet", counts["print-sheet"]],
    ["manifest", "Details", counts.manifest]
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
    manifest: 0,
    "print-sheet": 0
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

  if (
    record.role === "print-sheet" ||
    record.kind === "html" ||
    /-print-sheet\.html$/i.test(record.filename || "")
  ) {
    return "print-sheet";
  }

  if (record.kind === "manifest" || /\.json$/i.test(record.filename || "")) {
    return "manifest";
  }

  return "image";
}

function inferHistoryFileKind(filename = "") {
  if (/\.json$/i.test(filename)) {
    return "manifest";
  }

  if (/\.html?$/i.test(filename)) {
    return "html";
  }

  return "image";
}

function inferHistoryFileRole(filename = "") {
  if (/-cutaway(?:\.|$)/i.test(filename)) {
    return "cutaway";
  }

  if (/-print-sheet\.html?$/i.test(filename)) {
    return "print-sheet";
  }

  return "full-page";
}

function formatArtifactLabel(record) {
  const artifactType = getHistoryArtifactType(record);

  if (artifactType === "cutaway") {
    return "Cutaway PNG";
  }

  if (artifactType === "manifest") {
    return "Capture details JSON";
  }

  if (artifactType === "print-sheet") {
    return "Print sheet HTML";
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
    `${review.variantCount || 1} view${review.variantCount === 1 ? "" : "s"} ready for ${review.page?.host || "this page"}.`,
    `${review.redactionCount || 0} detected sensitive region${review.redactionCount === 1 ? "" : "s"}.`,
    `${titleCase(currentSettings.longPageMode || "auto")} long-page mode.`
  ].join(" ");
  ui.reviewViewCount.textContent = String(review.variantCount || 1);
  ui.reviewAutoCount.textContent = String(review.autoRedactionCount || 0);
  ui.reviewManualCount.textContent = formatReviewManualMetric(review);
  ui.reviewCutawayCount.textContent = formatReviewCutawayMetric(review);

  renderExportReviewOutputPlan(review);
  renderExportReviewVariants(review.variants || []);
  renderExportReviewWarnings(review.warnings || []);

  window.requestAnimationFrame(() => {
    ui.exportReviewConfirmButton.focus();
  });
}

function renderExportReviewOutputPlan(review) {
  ui.exportReviewOutputPlan.replaceChildren();

  const planItems = Array.isArray(review.outputPlan) && review.outputPlan.length
    ? review.outputPlan
    : buildExportReviewOutputPlan(review);

  for (const item of planItems) {
    const card = document.createElement("div");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    const copy = document.createElement("p");

    card.className = "review-output-card";
    label.textContent = item.label;
    value.textContent = item.value;
    copy.textContent = item.detail;
    card.append(label, value, copy);
    ui.exportReviewOutputPlan.append(card);
  }
}

function buildExportReviewOutputPlan(review) {
  const variants = Array.isArray(review.variants) ? review.variants : [];
  const viewCount = review.variantCount || variants.length || 1;
  const longPageMode = currentSettings.longPageMode || "auto";
  const tileCount = estimateReviewTileCount(variants, longPageMode);
  const baseImageCount = longPageMode === "auto"
    ? Math.max(viewCount, tileCount)
    : tileCount;
  const printSheetCount = longPageMode === "print" ? viewCount : 0;
  const manifestCount = currentSettings.exportManifest === false ? 0 : 1;
  const cutawayCount = review.cutawayAppliedCount || 0;
  const totalFiles = baseImageCount + printSheetCount + manifestCount + cutawayCount;

  return [
    {
      label: "Artifacts",
      value: `${totalFiles} planned`,
      detail: [
        `${baseImageCount} image${baseImageCount === 1 ? "" : "s"}`,
        cutawayCount ? `${cutawayCount} crop${cutawayCount === 1 ? "" : "s"}` : "",
        printSheetCount ? `${printSheetCount} print sheet${printSheetCount === 1 ? "" : "s"}` : "",
        manifestCount ? "details JSON" : ""
      ].filter(Boolean).join(", ")
    },
    {
      label: "Long Pages",
      value: formatLongPagePlanLabel(longPageMode, tileCount, viewCount),
      detail: buildLongPagePlanDetail(longPageMode, tileCount, viewCount)
    },
    {
      label: "Review",
      value: review.warnings?.length ? `${review.warnings.length} note${review.warnings.length === 1 ? "" : "s"}` : "Ready",
      detail: review.warnings?.length
        ? "Check the notes below before saving."
        : "Marked areas and output choices are ready."
    }
  ];
}

function estimateReviewTileCount(variants, longPageMode) {
  const viewCount = variants.length || 1;

  if (longPageMode === "auto") {
    return viewCount;
  }

  const maxTileHeight = Math.max(1, Number(LUMEN_CONFIG.capture.tileMaxOutputHeight) || 12000);

  return variants.reduce((sum, variant) => {
    const pageHeight = Math.max(1, Number(variant.dimensions?.pageHeight) || 1);
    return sum + Math.max(1, Math.ceil(pageHeight / maxTileHeight));
  }, 0) || viewCount;
}

function formatLongPagePlanLabel(mode, tileCount, viewCount) {
  if (mode === "print") {
    return "Print sheets";
  }

  if (mode === "tiles") {
    return `${tileCount} tile${tileCount === 1 ? "" : "s"}`;
  }

  return tileCount > viewCount ? "Tiles if needed" : "Single images";
}

function buildLongPagePlanDetail(mode, tileCount, viewCount) {
  if (mode === "print") {
    return "Saves readable image tiles and browser-printable sheets for PDF export.";
  }

  if (mode === "tiles") {
    return `Splits tall pages into ${tileCount} readable image tile${tileCount === 1 ? "" : "s"}.`;
  }

  return tileCount > viewCount
    ? "Keeps normal pages as one image and splits very tall pages."
    : "Keeps each view as one image when browser limits allow.";
}

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
    buildReviewLegendItem("Crop", "cutaway")
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
    ui.blueprintTimestamp.textContent = "Awaiting analysis";
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
    blueprint.identity.heroHeadline || "Awaiting headline.";
  ui.blueprintCta.textContent = blueprint.identity.primaryCta || "Awaiting CTA.";
  ui.blueprintNav.textContent =
    blueprint.identity.navLabels?.join(" · ") || "Awaiting navigation.";
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
    ui.colorStrip.textContent = "Palette pending.";
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
    ui.fontStrip.textContent = "Type pending.";
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
    renderWatchPlans(latestWatchPlans);

    if (!tab?.url) {
      renderLaunchStatus({
        state: "blocked",
        title: "Active tab unavailable",
        detail: "Open a web page, then launch Lumen again.",
        actionsBlocked: true
      });
      return;
    }

    if (!isOriginPermissionSupported(tab.url)) {
      renderLaunchStatus({
        state: "blocked",
        title: "This page is blocked by Chrome",
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
      detail: error.message || "Lumen failed to read the active tab.",
      actionsBlocked: true
    });
  }
}

function renderLaunchStatusFromRun({ tone, title, detail, progress }) {
  if (tone === "error") {
    renderLaunchStatus({
      state: "blocked",
      title: "Action needs attention",
      detail: title || detail || "The last action needs attention.",
      actionsBlocked: launchActionsBlocked
    });
    return;
  }

  if (tone === "success" || progress >= 1) {
    renderLaunchStatus({
      state: "ready",
      title: "Ready for another action",
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
  ui.launchStatusDetail.textContent = detail || "Choose a Lumen action.";
  ui.launchPanel.classList.toggle("is-blocked", launchActionsBlocked);
  updateActionDisabledState();
  renderOnboarding();
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
  ui.runManifestSummary.textContent = [
    settings.exportManifest === false ? "Details off" : "Details file",
    settings.longPageMode === "tiles" ? "Tiles" : "",
    settings.longPageMode === "print" ? "Print sheet" : ""
  ].filter(Boolean).join(" + ");
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
    empty.textContent = "Run status appears here.";
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
  ui.startLassoPickerButton.disabled = disabled;
  ui.clearCutawayButton.disabled = disabled || !cutawayRegionRecord.region;
  ui.explainCutawayPlanButton.disabled = disabled;
  ui.saveWatchPlanButton.disabled = disabled || !cutawayRegionRecord.region || !getFeatureAccess("regionWatch", currentSession?.plan || "free");
  ui.runWatchPlanNowButton.disabled = disabled || !selectActiveWatchPlan() || !getFeatureAccess("regionWatch", currentSession?.plan || "free");
  ui.toggleWatchPlanButton.disabled = disabled || !selectCurrentWatchPlan() || !getFeatureAccess("regionWatch", currentSession?.plan || "free");
  ui.deleteWatchPlanButton.disabled = disabled || !selectCurrentWatchPlan();
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

  for (const button of ui.captureShelfGrid.querySelectorAll("[data-history-action]")) {
    const requiresDownload = button.dataset.historyAction === "open" || button.dataset.historyAction === "show";
    const hasSummaryTarget = Boolean(button.dataset.captureId || button.dataset.watchRunId);
    const hasFileTarget = Boolean(button.dataset.captureId);
    button.disabled = actionBusy ||
      (requiresDownload ? !hasFileTarget : !hasSummaryTarget) ||
      (requiresDownload && button.dataset.downloadReady !== "true");
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
    return "Awaiting analysis";
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
    : "cutaway unselected";
  const manualText = review.manualStoredCount
    ? `${review.manualAppliedCount || 0} manual check${review.manualAppliedCount === 1 ? "" : "s"} ready`
    : "manual boxes unselected";

  return `${manualText}, ${cutawayText}. ${warnings ? `${warnings} review note${warnings === 1 ? "" : "s"} to check.` : "Ready to save."}`;
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
    return "manual 0";
  }

  return `${variant.manualAppliedCount || 0}/${storedCount} manual`;
}

function formatReviewVariantCutaway(variant) {
  if (!variant.cutawayStored) {
    return "cutaway 0";
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

  return `${manualText || "Manual boxes: 0 for this view."} ${cutawayText || "Cutaway: unselected for this view."}${cutawaySize}`;
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
  const fileText = `${response.files.length} file${response.files.length === 1 ? "" : "s"} saved using ${response.exportPreset} output mode`;
  const variantCount = response.variantCount || getCaptureVariants(settings.devicePreset).length;
  const manifestText = response.manifestFile ? " Capture details saved." : "";
  const folderText = response.archiveFolder ? ` Saved in ${response.archiveFolder}.` : "";
  const captureNote = normalizeCaptureNoteOptions(settings);
  const noteText = response.annotation?.enabled || captureNote.enabled ? " Capture note added." : "";
  const manualText = response.manualRedactionCount
    ? ` ${response.manualRedactionCount} manual box${response.manualRedactionCount === 1 ? "" : "es"} applied.`
    : "";
  const cutawayText = response.cutawayCount
    ? ` ${response.cutawayCount} cutaway crop${response.cutawayCount === 1 ? "" : "s"} saved.`
    : "";
  const projectionText = formatManualProjectionStats(response.manualProjectionStats);
  const projectionSentence = projectionText ? ` ${projectionText}.` : "";
  const cutawayProjectionText = formatCutawayResolutionStats(response.cutawayResolutionStats);
  const cutawayProjectionSentence = cutawayProjectionText ? ` ${cutawayProjectionText}.` : "";
  const healthText = response.captureHealth?.status === "complete"
    ? ` Integrity verified across ${response.captureHealth.verifiedVariantCount || variantCount} view${(response.captureHealth.verifiedVariantCount || variantCount) === 1 ? "" : "s"}.`
    : "";

  if (!response.redactionCount) {
    return variantCount > 1
      ? `${fileText}. ${variantCount} responsive views captured.${healthText}${manifestText}${folderText}${noteText}${manualText}${cutawayText}${projectionSentence}${cutawayProjectionSentence}`
      : `${fileText}.${healthText}${manifestText}${folderText}${noteText}${manualText}${cutawayText}${projectionSentence}${cutawayProjectionSentence}`;
  }

  return `${fileText}. ${variantCount > 1 ? `${variantCount} responsive views captured. ` : ""}${response.redactionCount} redaction region${response.redactionCount === 1 ? "" : "s"} sanitized.${healthText}${manifestText}${folderText}${noteText}${manualText}${cutawayText}${projectionSentence}${cutawayProjectionSentence}`;
}

function formatCaptureHealth(health) {
  if (!health?.status) {
    return "";
  }

  const percent = Number.isFinite(Number(health.coveragePercent))
    ? `${Number(health.coveragePercent).toFixed(Number(health.coveragePercent) % 1 ? 1 : 0)}%`
    : "";

  if (health.status === "complete") {
    return `Verified${percent ? ` ${percent}` : ""}`;
  }

  return `${titleCase(health.status)}${percent ? ` ${percent}` : ""}`;
}

function buildRedactionPreviewText(preview) {
  const autoCount = preview?.autoRedactionCount || 0;
  const manualCount = preview?.manualRedactionCount || 0;
  const total = preview?.redactionCount ?? autoCount + manualCount;
  const kinds = formatRedactionKinds(preview?.redactionBreakdown?.byKind);

  if (!total) {
    return "Sensitive region scan found 0 areas. Check the page before sharing.";
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
    item.captureHealth ? `Integrity: ${formatCaptureHealth(item.captureHealth)}` : "Integrity: legacy capture",
    `Redactions: ${item.redactionCount || 0}`,
    item.manualRedactionCount ? `Manual boxes: ${item.manualRedactionCount}` : "",
    item.cutawayCount ? `Cutaway crops: ${item.cutawayCount}` : "",
    item.manifestFile ? `Capture details: ${item.manifestFile}` : "Capture details: off",
    item.archiveFolder ? `Folder: ${item.archiveFolder}` : "",
    item.blueprintSummary?.siteType ? `Page type: ${item.blueprintSummary.siteType}` : "",
    item.blueprintSummary?.heroHeadline ? `Hero: ${item.blueprintSummary.heroHeadline}` : "",
    item.blueprintSummary?.primaryCta ? `Primary CTA: ${item.blueprintSummary.primaryCta}` : "",
    item.annotation?.text ? `Note: ${item.annotation.text}` : ""
  ];

  return lines.filter(Boolean).join("\n");
}

function buildWatchRunSummaryText(run) {
  const linkedCapture = latestHistoryItems.find((item) => item.id === run.captureId);
  const lines = [
    "Lumen timed capture summary",
    `Title: ${run.title || run.host || "Timed capture"}`,
    `URL: ${run.url || "Unknown"}`,
    `Status: ${titleCase(run.status || "queued")}`,
    `Scheduled: ${formatTimestamp(run.scheduledAt)}`,
    run.startedAt ? `Started: ${formatTimestamp(run.startedAt)}` : "",
    run.completedAt ? `Finished: ${formatTimestamp(run.completedAt)}` : "",
    `Files: ${run.fileCount || run.files?.length || 0}`,
    run.files?.length ? `File list: ${run.files.map(shortenPath).join(", ")}` : "",
    run.error ? `Issue: ${run.error}` : "",
    run.captureId ? `Capture: ${run.captureId}` : "",
    linkedCapture?.archiveFolder ? `Folder: ${linkedCapture.archiveFolder}` : ""
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

function shortenText(value = "", limit = 80) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 3)).trim()}...`;
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
