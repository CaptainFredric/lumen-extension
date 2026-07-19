import {
  LUMEN_CONFIG,
  STORAGE_KEYS,
  buildOriginPattern,
  getDefaultSettings,
  getSyncSafeSettings,
  getCaptureVariants,
  isRestrictedCaptureUrl,
  normalizeCaptureNoteOptions,
  sanitizeCaptureUrl
} from "./config.js";
import {
  bootstrapAppState,
  clearSession,
  deleteRemoteAccountData,
  deleteRemoteWatchPlan,
  queueRemoteDelivery,
  persistCaptureRecord,
  readProductReadiness,
  readRemoteDestinations,
  readRemoteDataControls,
  readLocalState,
  persistWatchRunRecord,
  saveRemoteWatchPlan,
  startDemoSession,
  updateRemoteWatchPlan,
  updateRemoteDataControls
} from "./lumen-backend.js";
import {
  clearLibrary as clearCaptureLibrary,
  getLibraryCapture,
  hasLibraryPreview,
  pruneLibraryPreviews,
  putLibraryCapture
} from "./library-store.js";
import {
  applyPrivacyShieldToCaptureSettings,
  getNewInstallCaptureSettings,
  initializeAppSettings,
  readAppSettings
} from "./settings-store.js";

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const OFFSCREEN_REASON = "BLOBS";
const CAPTURE_PROGRESS_EVENT = "LUMEN_CAPTURE_PROGRESS";
const BLUEPRINT_UPDATE_EVENT = "LUMEN_BLUEPRINT_UPDATED";
const SESSION_UPDATE_EVENT = "LUMEN_SESSION_UPDATED";
const HISTORY_UPDATE_EVENT = "LUMEN_HISTORY_UPDATED";
const WATCH_PLAN_UPDATE_EVENT = "LUMEN_WATCH_PLANS_UPDATED";
const WATCH_RUN_UPDATE_EVENT = "LUMEN_WATCH_RUNS_UPDATED";
const LIBRARY_UPDATE_EVENT = "LUMEN_LIBRARY_UPDATED";
const MANUAL_REDACTIONS_UPDATE_EVENT = "LUMEN_MANUAL_REDACTIONS_UPDATED";
const CUTAWAY_REGION_UPDATE_EVENT = "LUMEN_CUTAWAY_REGION_UPDATED";
const ANNOTATION_REGION_UPDATE_EVENT = "LUMEN_ANNOTATION_REGION_UPDATED";
const WATCH_ALARM_PREFIX = "lumen.watch.";
const MAX_CAPTURE_REDACTIONS = 800;

let captureInFlight = false;
let analyzeInFlight = false;
let offscreenCreationPromise = null;

async function restrictLocalStorageAccess() {
  if (typeof chrome.storage?.local?.setAccessLevel !== "function") {
    return;
  }

  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS"
  });
}

function normalizeWatchSchedule(schedule = {}, nowMs = Date.now()) {
  const mode = ["once", "repeat", "continuous"].includes(schedule?.mode)
    ? schedule.mode
    : "repeat";
  const intervalMinutes = Math.max(
    mode === "continuous" ? 1 : 15,
    Math.round(Number(schedule?.intervalMinutes) || (mode === "continuous" ? 1 : 60))
  );
  const delaySeconds = Math.max(5, Math.min(86400, Math.round(Number(schedule?.delaySeconds) || 10)));
  const requestedMaxRuns = Math.max(0, Math.round(Number(schedule?.maxRuns) || 0));
  const maxRuns = mode === "once"
    ? 1
    : mode === "continuous"
      ? Math.max(2, Math.min(100, requestedMaxRuns || 10))
      : Math.min(1000, requestedMaxRuns);
  const parsedRunAt = Date.parse(schedule?.runAt || "");
  const parsedExpiry = Date.parse(schedule?.expiresAt || "");

  return {
    mode,
    intervalMinutes,
    delaySeconds,
    maxRuns,
    saveOnlyWhenChanged: Boolean(schedule?.saveOnlyWhenChanged),
    runAt: Number.isFinite(parsedRunAt) ? new Date(parsedRunAt).toISOString() : new Date(nowMs + delaySeconds * 1000).toISOString(),
    expiresAt: Number.isFinite(parsedExpiry) ? new Date(parsedExpiry).toISOString() : "",
    timezone: typeof schedule?.timezone === "string" && schedule.timezone.trim()
      ? schedule.timezone.trim().slice(0, 80)
      : "local"
  };
}

function buildWatchAlarmDefinition(planOrSchedule = {}, nowMs = Date.now()) {
  const schedule = normalizeWatchSchedule(planOrSchedule?.schedule || planOrSchedule, nowMs);

  if (schedule.mode === "once") {
    return {
      when: Math.max(nowMs + 1000, Date.parse(schedule.runAt))
    };
  }

  return {
    delayInMinutes: schedule.intervalMinutes,
    periodInMinutes: schedule.intervalMinutes
  };
}

function evaluateWatchScheduleState(planOrSchedule = {}, { completedRuns, nowMs = Date.now() } = {}) {
  const schedule = normalizeWatchSchedule(planOrSchedule?.schedule || planOrSchedule, nowMs);
  const status = planOrSchedule?.schedule ? planOrSchedule.status : "active";
  const runCount = Math.max(0, Math.round(Number(completedRuns ?? planOrSchedule?.runCount) || 0));

  if (status !== "active") {
    return {
      active: false,
      reason: status === "completed" ? "completed" : "paused"
    };
  }

  if (schedule.expiresAt && Date.parse(schedule.expiresAt) <= nowMs) {
    return {
      active: false,
      reason: "expired"
    };
  }

  if (schedule.maxRuns > 0 && runCount >= schedule.maxRuns) {
    return {
      active: false,
      reason: "max-runs"
    };
  }

  return {
    active: true,
    reason: "active"
  };
}

function shouldPauseAutomaticCapture(appSettings = {}) {
  return Boolean(appSettings?.privacyShieldEnabled);
}

function calculateVisualHashDifference(previousHash = "", currentHash = "") {
  if (!previousHash || !currentHash || previousHash.length !== currentHash.length) {
    return 100;
  }

  let changedBits = 0;
  let totalBits = 0;

  for (let index = 0; index < previousHash.length; index += 1) {
    const previousNibble = Number.parseInt(previousHash[index], 16);
    const currentNibble = Number.parseInt(currentHash[index], 16);

    if (!Number.isFinite(previousNibble) || !Number.isFinite(currentNibble)) {
      return 100;
    }

    let difference = previousNibble ^ currentNibble;

    while (difference) {
      changedBits += difference & 1;
      difference >>= 1;
    }

    totalBits += 4;
  }

  return totalBits ? Number(((changedBits / totalBits) * 100).toFixed(2)) : 100;
}

chrome.runtime.onInstalled.addListener(async (details = {}) => {
  await restrictLocalStorageAccess();
  await initializeAppSettings({
    installReason: details.reason || ""
  });
  const [syncState, localState] = await Promise.all([
    chrome.storage.sync.get(STORAGE_KEYS.settings),
    chrome.storage.local.get([
      STORAGE_KEYS.session,
      STORAGE_KEYS.captureHistory,
      STORAGE_KEYS.watchPlans,
      STORAGE_KEYS.watchRuns,
      STORAGE_KEYS.privateSettings
    ])
  ]);

  if (!syncState[STORAGE_KEYS.settings]) {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.settings]: getNewInstallCaptureSettings()
    });
  }

  if (
    !localState[STORAGE_KEYS.session] ||
    !Array.isArray(localState[STORAGE_KEYS.captureHistory]) ||
    !Array.isArray(localState[STORAGE_KEYS.watchPlans]) ||
    !Array.isArray(localState[STORAGE_KEYS.watchRuns]) ||
    !localState[STORAGE_KEYS.privateSettings]
  ) {
    const snapshot = await readLocalState();
    const localPatch = {};

    if (!localState[STORAGE_KEYS.session]) {
      localPatch[STORAGE_KEYS.session] = snapshot.session;
    }

    if (!Array.isArray(localState[STORAGE_KEYS.captureHistory])) {
      localPatch[STORAGE_KEYS.captureHistory] = snapshot.captureHistory;
    }

    if (!Array.isArray(localState[STORAGE_KEYS.watchPlans])) {
      localPatch[STORAGE_KEYS.watchPlans] = snapshot.watchPlans || [];
    }

    if (!Array.isArray(localState[STORAGE_KEYS.watchRuns])) {
      localPatch[STORAGE_KEYS.watchRuns] = snapshot.watchRuns || [];
    }

    if (!localState[STORAGE_KEYS.privateSettings]) {
      localPatch[STORAGE_KEYS.privateSettings] = {
        annotationText: ""
      };
    }

    await chrome.storage.local.set(localPatch);
  }

  await restoreWatchAlarms();
});

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    restrictLocalStorageAccess().catch(() => {});
    restoreWatchAlarms().catch((error) => {
      console.debug("Lumen timed captures could not be restored:", error);
    });
  });
}

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEYS.appSettings]) {
      return;
    }

    syncWatchAlarmsForPrivacyShield().catch((error) => {
      console.debug("Lumen could not synchronize timed captures with Privacy Shield:", error);
    });
  });
}

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm?.name?.startsWith(WATCH_ALARM_PREFIX)) {
      return;
    }

    handleWatchAlarm(alarm).catch((error) => {
      console.debug("Lumen watch alarm skipped:", error);
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "LUMEN_BOOTSTRAP_APP") {
    bootstrapAppState()
      .then(async (result) => {
        await restoreWatchAlarms();
        sendResponse({ ok: true, ...result });
      })
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_START_CAPTURE") {
    if (captureInFlight) {
      sendResponse({
        ok: false,
        error: createFriendlyError(
          "Capture Already Running",
          "Lumen is still processing the previous page. Wait a moment, then try again."
        )
      });
      return;
    }

    captureInFlight = true;

    const captureOptions = message.payload?.options || getDefaultSettings();

    runCaptureFlow(captureOptions)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }))
      .finally(async () => {
        captureInFlight = false;
        await releaseCapturePermissionLease(captureOptions.permissionLeaseOrigin);
      });

    return true;
  }

  if (message?.type === "LUMEN_ANALYZE_PAGE") {
    if (captureInFlight || analyzeInFlight) {
      sendResponse({
        ok: false,
        error: createFriendlyError(
          "Lumen Is Busy",
          "Wait for the current capture or analysis to finish before starting another pass."
        )
      });
      return;
    }

    analyzeInFlight = true;

    runBlueprintFlow()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }))
      .finally(() => {
        analyzeInFlight = false;
      });

    return true;
  }

  if (message?.type === "LUMEN_PREVIEW_REDACTIONS") {
    if (captureInFlight || analyzeInFlight) {
      sendResponse({
        ok: false,
        error: createFriendlyError(
          "Lumen Is Busy",
          "Wait for the current capture or analysis to finish before scanning redactions."
        )
      });
      return;
    }

    runRedactionPreviewFlow()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_PREVIEW_EXPORT_REVIEW") {
    if (captureInFlight || analyzeInFlight) {
      sendResponse({
        ok: false,
        error: createFriendlyError(
          "Lumen Is Busy",
          "Wait for the current capture or analysis to finish before preparing an export review."
        )
      });
      return;
    }

    runExportReviewFlow(message.payload?.options)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_START_REDACTION_PICKER") {
    runManualRedactionPicker()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_CLEAR_MANUAL_REDACTIONS") {
    clearManualRedactionsForActiveTab()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_GET_MANUAL_REDACTIONS") {
    getManualRedactionsForActiveTab()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_START_CUTAWAY_PICKER") {
    runCutawayRegionPicker(message.payload || {})
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_CLEAR_CUTAWAY_REGION") {
    clearCutawayRegionForActiveTab()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_GET_CUTAWAY_REGION") {
    getCutawayRegionForActiveTab()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_START_ANNOTATION_PICKER") {
    runAnnotationRegionPicker()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_CLEAR_ANNOTATION_REGION") {
    clearAnnotationRegionForActiveTab()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_GET_ANNOTATION_REGION") {
    getAnnotationRegionForActiveTab()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_OPEN_CAPTURE_DOWNLOAD") {
    runHistoryDownloadAction(message.payload, "open")
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_SHOW_CAPTURE_DOWNLOAD") {
    runHistoryDownloadAction(message.payload, "show")
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_OPEN_LIBRARY_PHOTO" || message?.type === "LUMEN_SHOW_LIBRARY_PHOTO") {
    runLibraryDownloadAction(
      message.payload || {},
      message.type === "LUMEN_OPEN_LIBRARY_PHOTO" ? "open" : "show"
    )
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_OPEN_PHOTO_LIBRARY") {
    const captureId = typeof message.payload?.captureId === "string" ? message.payload.captureId : "";
    const query = captureId ? `?capture=${encodeURIComponent(captureId)}` : "";

    chrome.tabs.create({
      url: chrome.runtime.getURL(`library.html${query}`)
    })
      .then((tab) => sendResponse({ ok: true, tabId: tab?.id || null }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_OPEN_ANNOTATION_EDITOR") {
    openCaptureToolPage("editor.html", message.payload?.captureId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_OPEN_VISUAL_REVIEW") {
    openCaptureToolPage("review.html", message.payload?.captureId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_MANUAL_REDACTIONS_UPDATED") {
    persistManualRedactionsFromContent(sender.tab, message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_CUTAWAY_REGION_UPDATED") {
    persistCutawayRegionFromContent(sender.tab, message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_ANNOTATION_REGION_UPDATED") {
    persistAnnotationRegionFromContent(sender.tab, message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_DEMO_SIGN_IN") {
    startDemoSession()
      .then(async (session) => {
        broadcastSession(session);
        const localState = await readLocalState();
        sendResponse({
          ok: true,
          session,
          captureHistory: localState.captureHistory,
          watchRuns: localState.watchRuns || []
        });
      })
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_SIGN_OUT") {
    clearSession()
      .then((session) => {
        broadcastSession(session);
        sendResponse({ ok: true, session });
      })
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_GET_DATA_CONTROLS") {
    readRemoteDataControls()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_GET_PRODUCT_READINESS") {
    readProductReadiness()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_GET_DESTINATIONS") {
    readRemoteDestinations()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_QUEUE_DELIVERY") {
    queueRemoteDelivery(message.payload || {})
      .then((result) => sendResponse(result.ok ? result : {
        ok: false,
        error: createFriendlyError("Delivery Unavailable", result.error)
      }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_SAVE_WATCH_PLAN") {
    saveRemoteWatchPlan(message.payload || {})
      .then(async (result) => {
        if (!result.ok) {
          sendResponse({
            ok: false,
            error: createFriendlyError("Timed Capture Unavailable", result.error)
          });
          return;
        }

        await registerWatchPlanAlarm(result.watchPlan);
        const localState = await readLocalState();
        broadcastWatchPlans(localState.watchPlans || []);
        sendResponse({
          ...result,
          watchPlans: localState.watchPlans || [],
          watchRuns: localState.watchRuns || []
        });
      })
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_UPDATE_WATCH_PLAN") {
    const watchPlanId = message.payload?.watchPlanId || "";
    const patch = message.payload?.patch || {};
    updateRemoteWatchPlan(watchPlanId, patch)
      .then(async (result) => {
        if (!result.ok) {
          sendResponse({
            ok: false,
            error: createFriendlyError("Timed Capture Unavailable", result.error)
          });
          return;
        }

        await registerWatchPlanAlarm(result.watchPlan);
        const localState = await readLocalState();
        broadcastWatchPlans(localState.watchPlans || []);
        sendResponse({
          ...result,
          watchPlans: localState.watchPlans || [],
          watchRuns: localState.watchRuns || []
        });
      })
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_DELETE_WATCH_PLAN") {
    const watchPlanId = message.payload?.watchPlanId || "";
    let deletedOrigin = "";

    readLocalState()
      .then((state) => {
        const existing = (state.watchPlans || []).find((plan) => plan.id === watchPlanId);
        deletedOrigin = existing?.url ? buildOriginPattern(existing.url) : "";
        return deleteRemoteWatchPlan(watchPlanId);
      })
      .then(async (result) => {
        if (!result.ok) {
          sendResponse({
            ok: false,
            error: createFriendlyError("Timed Capture Unavailable", result.error)
          });
          return;
        }

        if (chrome.alarms?.clear) {
          await chrome.alarms.clear(`${WATCH_ALARM_PREFIX}${watchPlanId}`);
        }

        if (deletedOrigin) {
          await releaseCapturePermissionLease(deletedOrigin);
        }

        const localState = await readLocalState();
        broadcastWatchPlans(localState.watchPlans || []);
        sendResponse({
          ...result,
          watchPlans: localState.watchPlans || [],
          watchRuns: localState.watchRuns || []
        });
      })
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_RUN_WATCH_PLAN_NOW") {
    const watchPlanId = message.payload?.watchPlanId || "";
    handleWatchAlarm({
      name: `${WATCH_ALARM_PREFIX}${watchPlanId}`
    })
      .then(async () => {
        const localState = await readLocalState();
        sendResponse({
          ok: true,
          watchPlans: localState.watchPlans || [],
          watchRuns: localState.watchRuns || []
        });
      })
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_UPDATE_DATA_CONTROLS") {
    updateDataControlsWithPrivacyPolicy(message.payload || {})
      .then((result) => sendResponse(result.ok ? result : {
        ok: false,
        error: createFriendlyError("Data Controls Unavailable", result.error)
      }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_DELETE_ACCOUNT_DATA") {
    deleteRemoteAccountData()
      .then((result) => {
        if (!result.ok) {
          sendResponse({
            ok: false,
            error: createFriendlyError("Delete Unavailable", result.error)
          });
          return;
        }

        broadcastHistory(result.captureHistory || []);
        sendResponse({
          ok: true,
          deleted: result.deleted,
          dataControls: result.dataControls,
          captureHistory: result.captureHistory || []
        });
      })
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

  if (message?.type === "LUMEN_CLEAR_LOCAL_DATA") {
    clearLocalWorkspaceData()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }));

    return true;
  }

});

async function openCaptureToolPage(pageName, captureId = "") {
  const normalizedCaptureId = typeof captureId === "string" ? captureId.trim().slice(0, 160) : "";

  if (!normalizedCaptureId) {
    throw createFriendlyError(
      "Capture Not Selected",
      "Choose a photo from the local library before opening this review tool."
    );
  }

  const isEditor = pageName === "editor.html";
  const capture = await getLibraryCapture(normalizedCaptureId, {
    includePreview: true,
    includeEditorSource: true
  });

  if (!capture) {
    throw createFriendlyError(
      "Capture Not Found",
      "The selected photo is no longer available in Lumen's local library."
    );
  }

  const previewAvailable = hasLibraryPreview(capture) &&
    capture.preview?.captureId === capture.id &&
    Boolean(capture.preview?.blob);
  const editorSourceAvailable = capture.editorStatus === "ready" &&
    capture.editorSource?.captureId === capture.id &&
    capture.editorSource?.purpose === "editor-source" &&
    Boolean(capture.editorSource?.blob);

  if (!previewAvailable && !editorSourceAvailable) {
    throw createFriendlyError(
      isEditor ? "Annotation Unavailable" : "Comparison Unavailable",
      "This capture no longer has a local image preview. Capture the page again to use this tool."
    );
  }

  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL(`${pageName}?capture=${encodeURIComponent(normalizedCaptureId)}`)
  });

  return {
    tabId: tab?.id || null,
    captureId: normalizedCaptureId
  };
}

async function updateDataControlsWithPrivacyPolicy(patch = {}) {
  if (patch.cloudSyncEnabled) {
    const appSettings = await readAppSettings();

    if (appSettings.localOnlyMode) {
      return {
        ok: false,
        error: "Local-only mode blocks background cloud sync. Turn it off in Lumen Settings before enabling a connected destination."
      };
    }
  }

  return updateRemoteDataControls(patch);
}

async function clearLocalWorkspaceData() {
  const partialFailures = [];
  const [localState, storedRegions, libraryOutcome] = await Promise.all([
    readLocalState(),
    chrome.storage.local.get([
      STORAGE_KEYS.latestBlueprint,
      STORAGE_KEYS.manualRedactions,
      STORAGE_KEYS.cutawayRegions,
      STORAGE_KEYS.annotationRegions
    ]),
    clearCaptureLibrary()
      .then((result) => ({ ok: true, result }))
      .catch((error) => ({ ok: false, error }))
  ]);
  const clearedLibrary = libraryOutcome.ok
    ? libraryOutcome.result
    : { captureCount: 0, assetCount: 0 };

  if (!libraryOutcome.ok) {
    partialFailures.push({
      area: "photo-library",
      description: "Chrome did not clear one or more locally cached capture previews. Reload Lumen and try Clear local workspace again."
    });
    console.debug("Lumen photo library cleanup was incomplete:", libraryOutcome.error);
  }
  const savedRegionSets = [
    storedRegions[STORAGE_KEYS.manualRedactions],
    storedRegions[STORAGE_KEYS.cutawayRegions],
    storedRegions[STORAGE_KEYS.annotationRegions]
  ].reduce((sum, record) => sum + Object.keys(record || {}).length, 0);

  for (const plan of localState.watchPlans || []) {
    if (plan?.id) {
      try {
        const alarmName = `${WATCH_ALARM_PREFIX}${plan.id}`;
        const existingAlarm = await chrome.alarms.get(alarmName);

        if (existingAlarm && !(await chrome.alarms.clear(alarmName))) {
          partialFailures.push({
            area: "monitor-alarm",
            description: "Chrome kept one timed-capture alarm. The saved monitor record was cleared; check Chrome's extension controls before scheduling it again."
          });
        }
      } catch (error) {
        partialFailures.push({
          area: "monitor-alarm",
          description: "Chrome did not confirm removal of one timed-capture alarm. The saved monitor record was cleared."
        });
        console.debug("Lumen monitor alarm cleanup was incomplete:", error);
      }
    }
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.latestBlueprint]: null,
    [STORAGE_KEYS.captureHistory]: [],
    [STORAGE_KEYS.watchPlans]: [],
    [STORAGE_KEYS.watchRuns]: [],
    [STORAGE_KEYS.manualRedactions]: {},
    [STORAGE_KEYS.cutawayRegions]: {},
    [STORAGE_KEYS.annotationRegions]: {},
    [STORAGE_KEYS.privateSettings]: {
      annotationText: ""
    }
  });

  const grantedPermissions = await chrome.permissions.getAll();
  const grantedOrigins = Array.isArray(grantedPermissions.origins) ? grantedPermissions.origins : [];
  const requiredOrigins = new Set(chrome.runtime.getManifest().host_permissions || []);
  const requiredPermissions = new Set(chrome.runtime.getManifest().permissions || []);
  const optionalPermissions = new Set(chrome.runtime.getManifest().optional_permissions || []);
  let revokedPermissionCount = 0;

  for (const origin of grantedOrigins) {
    if (requiredOrigins.has(origin)) {
      continue;
    }

    try {
      if (await chrome.permissions.remove({ origins: [origin] })) {
        revokedPermissionCount += 1;
      } else {
        partialFailures.push({
          area: "site-access",
          description: "Chrome kept one optional site permission. Revoke it from Lumen Settings or Chrome's extension controls."
        });
      }
    } catch (error) {
      partialFailures.push({
        area: "site-access",
        description: "Chrome could not revoke one optional site permission. Revoke it from Lumen Settings or Chrome's extension controls."
      });
      console.debug("Lumen optional site access cleanup skipped:", error);
    }
  }

  for (const permission of Array.isArray(grantedPermissions.permissions) ? grantedPermissions.permissions : []) {
    if (requiredPermissions.has(permission) || !optionalPermissions.has(permission)) {
      continue;
    }

    try {
      if (await chrome.permissions.remove({ permissions: [permission] })) {
        revokedPermissionCount += 1;
      } else {
        partialFailures.push({
          area: "optional-feature-access",
          description: "Chrome kept one optional feature permission. Revoke it from Lumen Settings or Chrome's extension controls."
        });
      }
    } catch (error) {
      partialFailures.push({
        area: "optional-feature-access",
        description: "Chrome could not revoke one optional feature permission. Revoke it from Lumen Settings or Chrome's extension controls."
      });
      console.debug("Lumen optional feature access cleanup skipped:", error);
    }
  }

  broadcastHistory([]);
  broadcastWatchPlans([]);
  broadcastWatchRuns([]);
  broadcastManualRedactions({ regions: [] });
  broadcastCutawayRegion({ region: null, regions: [] });
  broadcastAnnotationRegion({ region: null, regions: [] });
  if (libraryOutcome.ok) {
    broadcastLibraryUpdated({ count: 0 });
  }

  return {
    deleted: {
      captures: localState.captureHistory.length,
      watchPlans: localState.watchPlans.length,
      watchRuns: localState.watchRuns.length,
      savedRegions: savedRegionSets,
      pageSignals: Boolean(storedRegions[STORAGE_KEYS.latestBlueprint]),
      permissions: revokedPermissionCount,
      libraryPhotos: clearedLibrary.captureCount || 0
    },
    captureHistory: [],
    watchPlans: [],
    watchRuns: [],
    complete: partialFailures.length === 0,
    partialFailures,
    downloadsRemain: true
  };
}

async function runCaptureFlow(options = getDefaultSettings(), context = {}) {
  const appSettings = await readAppSettings();

  if (context.captureOrigin === "timed" && shouldPauseAutomaticCapture(appSettings)) {
    throw createFriendlyError(
      "Timed Capture Paused",
      "Privacy Shield pauses unattended captures so every saved image can be reviewed first. Turn the Shield off to resume this monitor."
    );
  }

  options = applyPrivacyShieldToCaptureSettings(options, appSettings);
  const captureNote = normalizeCaptureNoteOptions(options);
  const sourceTab = context.sourceTab || await getCurrentTab();
  const capturedAt = new Date().toISOString();
  const captureId = createLocalId();

  if (!sourceTab?.id || !sourceTab.url) {
    throw createFriendlyError(
      "No Active Page",
      "Open a normal browser tab, then trigger the capture again."
    );
  }

  if (isRestrictedCaptureUrl(sourceTab.url)) {
    throw createFriendlyError(
      "This Page Cannot Be Captured",
      "Chrome blocks full-page script injection on internal pages like chrome://, the Web Store, and other protected surfaces."
    );
  }

  const variants = getCaptureVariants(options.devicePreset);
  const manualRedactions = context.manualRedactionsOverride || await getManualRedactionsForTab(sourceTab);
  const cutawayRegion = context.cutawayRegionOverride || await getCutawayRegionForTab(sourceTab);
  const annotationRegion = context.annotationRegionOverride || await getAnnotationRegionForTab(sourceTab);
  const runContext = buildCaptureRunContext({
    title: sourceTab.title,
    url: sourceTab.url,
    capturedAt
  });
  const results = [];
  const focusedOnly = Boolean(context.focusedOnly);
  let blueprint = null;

  for (let index = 0; index < variants.length; index += 1) {
    const result = await captureVariant({
      sourceTab,
      variant: variants[index],
      options,
      manualRedactions,
      cutawayRegion,
      annotationRegion,
      runContext,
      extractBlueprint: index === 0,
      cacheReviewPdf: index === 0,
      focusedOnly,
      changeBaselineHash: context.changeBaselineHash || "",
      saveOnlyWhenChanged: Boolean(context.saveOnlyWhenChanged)
    });

    results.push(result);
    blueprint ||= result.blueprint;
  }

  const firstResult = results[0];
  const segmentCount = results.reduce((sum, result) => sum + result.segmentCount, 0);
  const tileCount = results.reduce((sum, result) => sum + result.tileCount, 0);
  const redactionCount = results.reduce((sum, result) => sum + result.redactionCount, 0);
  const manualRedactionCount = results.reduce((sum, result) => sum + result.manualRedactionCount, 0);
  const cutawayCount = results.reduce((sum, result) => sum + result.cutawayCount, 0);
  const redactionBreakdown = mergeRedactionBreakdowns(results.map((result) => result.redactionBreakdown));
  const manualProjectionStats = mergeManualProjectionStats(results.map((result) => result.manualProjectionStats));
  const cutawayResolutionStats = mergeCutawayResolutionStats(results.map((result) => result.cutawayResolutionStats));
  const annotationResolutionStats = mergeCutawayResolutionStats(results.map((result) => result.annotationResolutionStats));
  const artifactStats = buildArtifactStats(results.flatMap((result) => result.downloadRecords));
  const captureHealth = buildAggregateCaptureHealth(results.map((result) => result.captureHealth));
  const libraryPreviews = results.flatMap((result) => (result.photoPreviews || []).map((preview, index) => ({
    dataUrl: preview.previewDataUrl,
    width: preview.width,
    height: preview.height,
    role: preview.role,
    variantId: `${result.variant.id}-${preview.role || "image"}-${preview.partIndex || index + 1}`
  })));
  const libraryEditorSource = results.find((result) => result.editorSource)?.editorSource || null;
  const libraryPdfSource = results.find((result) => result.pdfSource)?.pdfSource || null;
  const visualHash = results.find((result) => result.visualHash)?.visualHash || "";
  const changePercent = results.find((result) => Number.isFinite(result.changePercent))?.changePercent ?? 100;
  const unchanged = focusedOnly && results.length > 0 && results.every((result) => result.unchanged);
  const variantSummaries = results.map((result) => ({
    id: result.variant.id,
    label: result.variant.label,
    files: result.downloadedFiles,
    downloads: result.downloadRecords,
    exportPreset: result.exportPreset,
    tileCount: result.tileCount,
    redactionCount: result.redactionCount,
    manualRedactionCount: result.manualRedactionCount,
    cutawayCount: result.cutawayCount,
    manualProjectionStats: result.manualProjectionStats,
    cutawayResolutionStats: result.cutawayResolutionStats,
    annotationResolutionStats: result.annotationResolutionStats,
    redactionBreakdown: result.redactionBreakdown,
    captureHealth: result.captureHealth,
    viewport: result.viewport,
    dimensions: result.dimensions
  }));

  if (unchanged) {
    broadcastProgress({
      stage: "done",
      title: "No visual change",
      detail: "The selected area matched the previous run, so Lumen skipped the duplicate photo.",
      progress: 1
    });

    return {
      captureId: "",
      fileName: "",
      files: [],
      downloads: [],
      archiveFolder: runContext.folder,
      segmentCount,
      exportPreset: firstResult.exportPreset,
      tileCount,
      redactionCount,
      manualRedactionCount,
      cutawayCount,
      manualProjectionStats,
      cutawayResolutionStats,
      annotationResolutionStats,
      artifactStats,
      captureHealth,
      manifestFile: "",
      variantCount: variants.length,
      dimensions: firstResult.dimensions,
      unchanged: true,
      visualHash,
      changePercent
    };
  }

  if (!blueprint) {
    blueprint = await getLatestBlueprint();
  }

  const bundleManifest = buildCaptureBundleManifest({
    page: firstResult.page,
    capturedAt,
    archiveFolder: runContext.folder,
    options,
    annotation: captureNote.enabled && captureNote.text ? captureNote : null,
    annotationRegion: annotationRegion.region || null,
    exportPreset: firstResult.exportPreset,
    variants: variantSummaries,
    redactionCount,
    manualRedactionCount,
    cutawayCount,
    manualProjectionStats,
    cutawayResolutionStats,
    annotationResolutionStats,
    redactionBreakdown,
    segmentCount,
    tileCount,
    captureHealth,
    visualHash,
    changePercent,
    sourceType: context.captureOrigin === "timed" ? "timed" : "manual",
    watchPlanId: context.watchPlanId || "",
    watchRunId: context.watchRunId || "",
    blueprint
  });

  let manifestFile = "";
  let manifestDownload = null;

  if (options.exportManifest !== false) {
    manifestDownload = await downloadBundleManifest({
      folder: runContext.folder,
      fileBaseName: buildManifestFileBaseName(firstResult.page, options, firstResult.exportPreset),
      manifest: bundleManifest
    });
    manifestFile = manifestDownload.filename;
  }

  const downloadedRecords = [
    ...results.flatMap((result) => result.downloadRecords),
    ...(manifestDownload ? [manifestDownload] : [])
  ];
  const downloadedFiles = downloadedRecords.map((record) => record.filename);

  const captureHistory = await persistCaptureRecord({
    id: captureId,
    title: firstResult.page.title,
    host: new URL(firstResult.page.url).host,
    url: sanitizeCaptureUrl(firstResult.page.url),
    devicePreset: options.devicePreset,
    exportPreset: firstResult.exportPreset,
    capturedAt,
    archiveFolder: runContext.folder,
    files: downloadedFiles,
    downloads: downloadedRecords,
    tileCount,
    redactionCount,
    manualRedactionCount,
    cutawayCount,
    manualProjectionStats,
    cutawayResolutionStats,
    annotationResolutionStats,
    redactionBreakdown,
    artifactStats,
    captureHealth,
    manifestFile,
    visualHash,
    changePercent,
    sourceType: context.captureOrigin === "timed" ? "timed" : "manual",
    watchPlanId: context.watchPlanId || "",
    watchRunId: context.watchRunId || "",
    annotation: captureNote.enabled && captureNote.text ? captureNote : null,
    annotationRegion: annotationRegion.region || null,
    variants: variantSummaries,
    dimensions: firstResult.dimensions,
    blueprintSummary: blueprint
      ? {
          siteType: blueprint.identity?.siteType || "",
          heroHeadline: blueprint.identity?.heroHeadline || "",
          primaryCta: blueprint.identity?.primaryCta || ""
        }
      : null
  });

  let librarySaved = false;

  try {
    await putLibraryCapture({
      id: captureId,
      title: firstResult.page.title,
      host: new URL(firstResult.page.url).host,
      url: sanitizeCaptureUrl(firstResult.page.url),
      capturedAt,
      sourceType: context.captureOrigin === "timed" ? "timed" : "manual",
      watchPlanId: context.watchPlanId || "",
      watchRunId: context.watchRunId || "",
      devicePreset: options.devicePreset,
      exportPreset: firstResult.exportPreset,
      archiveFolder: runContext.folder,
      manifestFile,
      downloads: downloadedRecords,
      captureHealth,
      dimensions: firstResult.dimensions,
      variantCount: variants.length,
      fileCount: downloadedFiles.length,
      redactionCount,
      manualRedactionCount,
      cutawayCount,
      previews: libraryPreviews,
      editorSource: libraryEditorSource,
      pdfSource: libraryPdfSource
    });
    await pruneLibraryPreviews();
    librarySaved = true;
    broadcastLibraryUpdated({
      captureId,
      capturedAt
    });
  } catch (error) {
    console.debug("Lumen local capture storage skipped:", error);
  }

  broadcastHistory(captureHistory);

  // Backend hook:
  // POST metadata, page metrics, and the final asset reference to
  // `${LUMEN_CONFIG.api.baseUrl}${LUMEN_CONFIG.api.endpoints.captures}`
  // once auth and cloud persistence are wired in.

  broadcastProgress({
    stage: "done",
    title: focusedOnly ? "Selected area ready" : variants.length > 1 ? "Responsive set ready" : "Capture ready",
    detail: buildCaptureCompletionDetail({
      segmentCount,
      fileCount: downloadedFiles.length,
      redactionCount,
      manualRedactionCount,
      cutawayCount,
      manualProjectionStats,
      cutawayResolutionStats,
      variantCount: variants.length,
      captureHealth,
      manifestSaved: Boolean(manifestFile),
      annotationAdded: Boolean(captureNote.enabled && captureNote.text),
      annotationRegionApplied: annotationResolutionStats.appliedCount > 0
    }),
    progress: 1
  });

  return {
    captureId,
    fileName: downloadedFiles[0] || "",
    files: downloadedFiles,
    downloads: downloadedRecords,
    archiveFolder: runContext.folder,
    segmentCount,
    exportPreset: firstResult.exportPreset,
    tileCount,
    redactionCount,
    manualRedactionCount,
    cutawayCount,
    manualProjectionStats,
    cutawayResolutionStats,
    annotationResolutionStats,
    artifactStats,
    captureHealth,
    manifestFile,
    annotation: captureNote.enabled && captureNote.text ? captureNote : null,
    annotationRegion: annotationRegion.region || null,
    variantCount: variants.length,
    dimensions: firstResult.dimensions,
    visualHash,
    changePercent,
    librarySaved
  };
}

async function releaseCapturePermissionLease(origin) {
  if (typeof origin !== "string" || !/^https?:\/\/[^/]+\/\*$/.test(origin)) {
    return false;
  }

  try {
    const localState = await readLocalState();
    const watchUsesOrigin = (localState.watchPlans || []).some((plan) => {
      try {
        return plan?.url && buildOriginPattern(plan.url) === origin;
      } catch {
        return false;
      }
    });

    if (watchUsesOrigin) {
      return false;
    }

    return chrome.permissions.remove({
      origins: [origin]
    });
  } catch (error) {
    console.debug("Lumen permission lease cleanup skipped:", error);
    return false;
  }
}

async function runBlueprintFlow() {
  const sourceTab = await getCurrentTab();

  if (!sourceTab?.id || !sourceTab.url) {
    throw createFriendlyError(
      "No Active Page",
      "Open a normal browser tab, then run the page analysis again."
    );
  }

  if (isRestrictedCaptureUrl(sourceTab.url)) {
    throw createFriendlyError(
      "This Page Cannot Be Inspected",
      "Chrome blocks script injection on internal and protected pages."
    );
  }

  broadcastProgress({
    stage: "inspect",
    title: "Reading brand blueprint",
    detail: "Extracting color, typography, layout, and CTA signals from the active page."
  });

  await ensureContentScript(sourceTab.id);

  const blueprint = await requestBrandBlueprint(sourceTab.id);
  await persistLatestBlueprint(blueprint);
  const localState = await readLocalState();

  return {
    blueprint,
    captureHistory: localState.captureHistory,
    session: localState.session
  };
}

async function runRedactionPreviewFlow() {
  const sourceTab = await getCurrentTab();

  if (!sourceTab?.id || !sourceTab.url) {
    throw createFriendlyError(
      "No Active Page",
      "Open a normal browser tab, then scan redactions again."
    );
  }

  if (isRestrictedCaptureUrl(sourceTab.url)) {
    throw createFriendlyError(
      "This Page Cannot Be Scanned",
      "Chrome blocks script injection on internal and protected pages."
    );
  }

  await ensureContentScript(sourceTab.id);

  const [autoScan, manualRecord] = await Promise.all([
    requestRedactionScan(sourceTab.id),
    getManualRedactionsForTab(sourceTab)
  ]);
  const manualRegions = normalizeManualRedactionRegions(manualRecord.regions);
  const combinedBreakdown = mergeRedactionBreakdowns([
    autoScan.breakdown || buildRedactionBreakdown(autoScan.regions),
    buildRedactionBreakdown(manualRegions)
  ]);

  return {
    page: {
      title: sourceTab.title || "",
      url: sourceTab.url,
      host: new URL(sourceTab.url).host
    },
    autoRedactionCount: autoScan.regions.length,
    manualRedactionCount: manualRegions.length,
    redactionCount: autoScan.regions.length + manualRegions.length,
    redactionBreakdown: combinedBreakdown,
    scope: "current DOM"
  };
}

async function runExportReviewFlow(options = getDefaultSettings()) {
  options = applyPrivacyShieldToCaptureSettings(options, await readAppSettings());
  const sourceTab = await getCurrentTab();

  if (!sourceTab?.id || !sourceTab.url) {
    throw createFriendlyError(
      "No Active Page",
      "Open a normal browser tab, then prepare the export review again."
    );
  }

  if (isRestrictedCaptureUrl(sourceTab.url)) {
    throw createFriendlyError(
      "This Page Cannot Be Reviewed",
      "Chrome blocks script injection on internal and protected pages."
    );
  }

  const variants = getCaptureVariants(options.devicePreset);
  const [manualRedactions, cutawayRegion] = await Promise.all([
    getManualRedactionsForTab(sourceTab),
    getCutawayRegionForTab(sourceTab)
  ]);
  const variantReviews = [];

  for (const variant of variants) {
    const target = await createCaptureTarget(sourceTab, variant);

    try {
      await ensureContentScript(target.tab.id);
      await calibrateCaptureViewport(target, variant);

      const page = await requestPreparedPageMetrics(target.tab.id);
      const [autoScan, manualResolution, cutawayResolution] = await Promise.all([
        options.autoRedact ? requestRedactionScan(target.tab.id) : Promise.resolve({
          regions: [],
          breakdown: buildRedactionBreakdown([])
        }),
        resolveManualRedactionsForTarget(target.tab.id, manualRedactions, page),
        resolveCutawayRegionForTarget(target.tab.id, cutawayRegion, page)
      ]);

      variantReviews.push(buildExportReviewVariant({
        variant,
        page,
        autoScan,
        manualResolution,
        cutawayResolution,
        manualRedactions,
        cutawayRegion
      }));
    } finally {
      if (target.kind === "viewport") {
        await closeWindowSafely(target.windowId);
      }
    }
  }

  const manualProjectionStats = mergeManualProjectionStats(variantReviews.map((variant) => variant.manualProjectionStats));
  const cutawayResolutionStats = mergeCutawayResolutionStats(variantReviews.map((variant) => variant.cutawayResolutionStats));
  const redactionBreakdown = mergeRedactionBreakdowns(variantReviews.map((variant) => variant.redactionBreakdown));
  const autoRedactionCount = variantReviews.reduce((sum, variant) => sum + variant.autoRedactionCount, 0);
  const manualAppliedCount = variantReviews.reduce((sum, variant) => sum + variant.manualAppliedCount, 0);
  const cutawayAppliedCount = variantReviews.reduce((sum, variant) => sum + (variant.cutawayApplied ? 1 : 0), 0);
  const warnings = buildExportReviewWarnings({
    options,
    variants,
    manualRedactions,
    cutawayRegion,
    manualProjectionStats,
    cutawayResolutionStats,
    variantReviews
  });
  const requiresConfirmation = exportReviewRequiresConfirmation({
    options,
    manualRedactions,
    cutawayRegion,
    manualProjectionStats,
    cutawayResolutionStats,
    variantReviews
  });

  return {
    page: {
      title: sourceTab.title || "",
      url: sourceTab.url,
      host: new URL(sourceTab.url).host
    },
    options: {
      devicePreset: options.devicePreset || "desktop",
      exportPreset: options.exportPreset || "raw",
      autoRedact: Boolean(options.autoRedact),
      exportManifest: options.exportManifest !== false,
      longPageMode: options.longPageMode || "auto"
    },
    variants: variantReviews,
    variantCount: variants.length,
    autoRedactionCount,
    manualStoredCount: manualRedactions.regions?.length || 0,
    manualAppliedCount,
    manualProjectionStats,
    cutawayStored: Boolean(cutawayRegion.region),
    cutawayAppliedCount,
    cutawayResolutionStats,
    redactionCount: autoRedactionCount + manualAppliedCount,
    redactionBreakdown,
    outputPlan: buildExportReviewOutputPlan({
      variants: variantReviews,
      variantCount: variants.length,
      cutawayAppliedCount,
      warnings,
      options
    }),
    warnings,
    requiresConfirmation
  };
}

function exportReviewRequiresConfirmation({
  options = {},
  manualRedactions = {},
  cutawayRegion = {},
  manualProjectionStats = {},
  cutawayResolutionStats = {},
  variantReviews = []
} = {}) {
  const manualCount = manualRedactions.regions?.length || 0;
  const iframeCount = Math.max(0, ...variantReviews.map((variant) => Number(variant.renderingRisks?.iframeCount) || 0));
  const canvasCount = Math.max(0, ...variantReviews.map((variant) => Number(variant.renderingRisks?.canvasCount) || 0));

  return Boolean(
    (!options.autoRedact && !manualCount) ||
    manualProjectionStats.skippedCount ||
    (cutawayRegion.region && cutawayResolutionStats.skippedCount) ||
    iframeCount ||
    canvasCount
  );
}

function buildExportReviewOutputPlan({ variants = [], variantCount = 1, cutawayAppliedCount = 0, warnings = [], options = {} } = {}) {
  const longPageMode = options.longPageMode || "auto";
  const viewCount = variantCount || variants.length || 1;
  const tileCount = estimateReviewTileCount(variants, longPageMode);
  const baseImageCount = longPageMode === "auto"
    ? Math.max(viewCount, tileCount)
    : tileCount;
  const printSheetCount = longPageMode === "print" ? viewCount : 0;
  const manifestCount = options.exportManifest === false ? 0 : 1;
  const totalFiles = baseImageCount + printSheetCount + manifestCount + cutawayAppliedCount;

  return [
    {
      label: "Artifacts",
      value: `${totalFiles} planned`,
      detail: [
        `${baseImageCount} image${baseImageCount === 1 ? "" : "s"}`,
        cutawayAppliedCount ? `${cutawayAppliedCount} crop${cutawayAppliedCount === 1 ? "" : "s"}` : "",
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
      value: warnings.length ? `${warnings.length} note${warnings.length === 1 ? "" : "s"}` : "Ready",
      detail: warnings.length
        ? "Check the notes before saving."
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

function buildExportReviewVariant({
  variant,
  page,
  autoScan,
  manualResolution,
  cutawayResolution,
  manualRedactions,
  cutawayRegion
}) {
  const manualProjectionStats = manualResolution.stats || buildManualProjectionStats();
  const cutawayResolutionStats = cutawayResolution.stats || buildCutawayResolutionStats();

  return {
    id: variant.id,
    label: variant.label,
    dimensions: {
      viewportWidth: page.viewportWidth,
      viewportHeight: page.viewportHeight,
      browserViewportWidth: page.browserViewportWidth || page.viewportWidth,
      browserViewportHeight: page.browserViewportHeight || page.viewportHeight,
      pageHeight: page.pageHeight
    },
    autoRedactionCount: autoScan.regions?.length || 0,
    manualStoredCount: manualRedactions.regions?.length || 0,
    manualAppliedCount: manualResolution.regions?.length || 0,
    manualProjectionStats,
    cutawayStored: Boolean(cutawayRegion.region),
    cutawayApplied: Boolean(cutawayResolution.region),
    cutawayRegion: cutawayResolution.region
      ? {
          left: cutawayResolution.region.left,
          top: cutawayResolution.region.top,
          width: cutawayResolution.region.width,
          height: cutawayResolution.region.height,
          projection: cutawayResolution.region.projection || ""
        }
      : null,
    cutawayResolutionStats,
    renderingRisks: {
      iframeCount: Math.max(0, Number(page.renderingRisks?.iframeCount) || 0),
      canvasCount: Math.max(0, Number(page.renderingRisks?.canvasCount) || 0)
    },
    preview: buildExportReviewPreview({
      page,
      autoRegions: autoScan.regions || [],
      manualRegions: manualResolution.regions || [],
      cutawayRegion: cutawayResolution.region
    }),
    redactionBreakdown: mergeRedactionBreakdowns([
      autoScan.breakdown || buildRedactionBreakdown(autoScan.regions || []),
      buildRedactionBreakdown(manualResolution.regions || [])
    ])
  };
}

function buildExportReviewPreview({ page, autoRegions, manualRegions, cutawayRegion }) {
  return {
    pageWidth: Math.max(1, Math.round(page.viewportWidth || 1)),
    pageHeight: Math.max(1, Math.round(page.pageHeight || page.viewportHeight || 1)),
    viewportHeight: Math.max(1, Math.round(page.viewportHeight || 1)),
    regions: [
      ...buildPreviewRegionRecords(autoRegions, "auto", 18),
      ...buildPreviewRegionRecords(manualRegions, "manual", 24),
      ...buildPreviewRegionRecords(cutawayRegion ? [cutawayRegion] : [], "cutaway", 1)
    ]
  };
}

function buildPreviewRegionRecords(regions, role, limit) {
  return (Array.isArray(regions) ? regions : [])
    .filter((region) =>
      Number.isFinite(region.left) &&
      Number.isFinite(region.top) &&
      Number.isFinite(region.width) &&
      Number.isFinite(region.height)
    )
    .slice(0, limit)
    .map((region) => ({
      role,
      kind: region.kind || role,
      left: Math.max(0, Math.round(region.left)),
      top: Math.max(0, Math.round(region.top)),
      width: Math.max(1, Math.round(region.width)),
      height: Math.max(1, Math.round(region.height)),
      ...(region.projected ? { projected: true } : {}),
      ...(typeof region.projection === "string" ? { projection: region.projection.slice(0, 32) } : {})
    }));
}

function buildExportReviewWarnings({
  options,
  variants,
  manualRedactions,
  cutawayRegion,
  manualProjectionStats,
  cutawayResolutionStats,
  variantReviews = []
}) {
  const warnings = [];
  const manualCount = manualRedactions.regions?.length || 0;

  if (!options.autoRedact && !manualCount) {
    warnings.push("No redaction layer is enabled for this export.");
  }

  if (options.autoRedact) {
    warnings.push("Current redaction covers visible text and filled inputs during export and should be reviewed before external sharing.");
  }

  if (manualProjectionStats.skippedCount) {
    warnings.push(`${manualProjectionStats.skippedCount} manual box check${manualProjectionStats.skippedCount === 1 ? "" : "s"} did not resolve in the requested view set.`);
  }

  if (cutawayRegion.region && cutawayResolutionStats.skippedCount) {
    warnings.push(`${cutawayResolutionStats.skippedCount} cutaway check${cutawayResolutionStats.skippedCount === 1 ? "" : "s"} did not resolve in the requested view set.`);
  }

  if ((manualCount || cutawayRegion.region) && variants.length > 1) {
    warnings.push("Responsive projection is checked per viewport before export. The capture details file records the capture-time result for each view.");
  }

  const iframeCount = Math.max(0, ...variantReviews.map((variant) => Number(variant.renderingRisks?.iframeCount) || 0));
  const canvasCount = Math.max(0, ...variantReviews.map((variant) => Number(variant.renderingRisks?.canvasCount) || 0));

  if (iframeCount) {
    warnings.push(`${iframeCount} embedded frame${iframeCount === 1 ? " is" : "s are"} captured visually. Cross-origin frame contents cannot be inspected for automatic redaction.`);
  }

  if (canvasCount) {
    warnings.push(`${canvasCount} canvas surface${canvasCount === 1 ? " is" : "s are"} captured visually. Text drawn into canvas pixels needs a manual review.`);
  }

  return warnings;
}

async function runHistoryDownloadAction(payload = {}, action = "show") {
  const captureId = payload.captureId || "";
  const localState = await readLocalState();
  const record = localState.captureHistory.find((item) => item.id === captureId);

  if (!record) {
    throw createFriendlyError(
      "Capture Not Found",
      "The selected capture is no longer available in local history."
    );
  }

  const downloadRecord = selectPrimaryDownloadRecord(record);

  if (!downloadRecord?.downloadId) {
    throw createFriendlyError(
      "Download Handle Missing",
      "This capture was saved before Lumen started storing local download handles. Run a fresh capture, then use this action again."
    );
  }

  const [downloadItem] = await chrome.downloads.search({
    id: downloadRecord.downloadId
  });

  if (!downloadItem) {
    throw createFriendlyError(
      "Download Not Found",
      "Chrome no longer has a local record for this downloaded file."
    );
  }

  if (downloadItem.state && downloadItem.state !== "complete") {
    throw createFriendlyError(
      "Download Still Running",
      "Chrome has not finished writing this capture yet."
    );
  }

  try {
    if (action === "open") {
      await callDownloadsMethod("open", downloadRecord.downloadId);
    } else {
      await callDownloadsMethod("show", downloadRecord.downloadId);
    }
  } catch (error) {
    throw createFriendlyError(
      action === "open" ? "File Could Not Open" : "File Could Not Be Revealed",
      error.message || "Chrome could not access this downloaded artifact. It may have been moved or deleted."
    );
  }

  return {
    filename: downloadRecord.filename,
    archiveFolder: record.archiveFolder || "",
    action
  };
}

async function runLibraryDownloadAction(payload = {}, action = "show") {
  const captureId = typeof payload.captureId === "string" ? payload.captureId : "";
  const downloadId = Number.isInteger(payload.downloadId) ? payload.downloadId : null;
  const record = captureId ? await getLibraryCapture(captureId) : null;

  if (!record) {
    throw createFriendlyError(
      "Photo Not Found",
      "The selected photo is no longer in Lumen's local library."
    );
  }

  const downloadRecord = (record.downloads || []).find((entry) => entry.downloadId === downloadId);

  if (!downloadRecord || downloadId === null) {
    throw createFriendlyError(
      "Download Handle Missing",
      "This file is not attached to the selected local library item."
    );
  }

  const [downloadItem] = await chrome.downloads.search({ id: downloadId });

  if (!downloadItem) {
    throw createFriendlyError(
      "Download Not Found",
      "Chrome no longer has a local record for this downloaded original."
    );
  }

  if (downloadItem.state && downloadItem.state !== "complete") {
    throw createFriendlyError(
      "Download Still Running",
      "Chrome has not finished writing this photo yet."
    );
  }

  try {
    await callDownloadsMethod(action === "open" ? "open" : "show", downloadId);
  } catch (error) {
    throw createFriendlyError(
      action === "open" ? "Photo Could Not Open" : "Photo Could Not Be Revealed",
      error.message || "The downloaded original may have been moved or deleted."
    );
  }

  return {
    filename: downloadRecord.filename || downloadItem.filename || "",
    action
  };
}

async function runManualRedactionPicker() {
  const sourceTab = await getCurrentTab();

  if (!sourceTab?.id || !sourceTab.url) {
    throw createFriendlyError(
      "No Active Page",
      "Open a normal browser tab, then start the redaction picker again."
    );
  }

  if (isRestrictedCaptureUrl(sourceTab.url)) {
    throw createFriendlyError(
      "This Page Cannot Be Marked",
      "Chrome blocks script injection on internal pages, so manual redaction cannot run here."
    );
  }

  await ensureContentScript(sourceTab.id);
  const record = await getManualRedactionsForTab(sourceTab);
  const response = await chrome.tabs.sendMessage(sourceTab.id, {
    type: "LUMEN_START_MANUAL_REDACTION_PICKER",
    payload: {
      regions: record.regions || []
    }
  });

  if (!response?.ok) {
    throw createFriendlyError(
      "Redaction Picker Failed",
      response?.error || "Lumen could not start the manual redaction picker on this page."
    );
  }

  return {
    record: {
      ...record,
      regions: response.picker?.regions || record.regions || []
    }
  };
}

async function clearManualRedactionsForActiveTab() {
  const sourceTab = await getCurrentTab();

  if (!sourceTab?.url) {
    return {
      record: buildEmptyManualRedactionRecord()
    };
  }

  const record = await clearManualRedactionsForTab(sourceTab);

  if (sourceTab.id) {
    chrome.tabs.sendMessage(sourceTab.id, {
      type: "LUMEN_CLEAR_MANUAL_REDACTION_PICKER"
    }).catch(() => {});
  }

  broadcastManualRedactions(record);
  return { record };
}

async function getManualRedactionsForActiveTab() {
  const sourceTab = await getCurrentTab();

  if (!sourceTab?.url) {
    return {
      record: buildEmptyManualRedactionRecord()
    };
  }

  return {
    record: await getManualRedactionsForTab(sourceTab)
  };
}

async function persistManualRedactionsFromContent(tab, payload = {}) {
  if (!tab?.url) {
    return {
      record: buildEmptyManualRedactionRecord()
    };
  }

  const store = await readManualRedactionStore();
  const key = buildManualRedactionKey(tab.url);
  const regions = normalizeManualRedactionRegions(payload.regions);
  const record = {
    url: tab.url,
    host: new URL(tab.url).host,
    updatedAt: new Date().toISOString(),
    context: payload.context || null,
    regions
  };

  if (regions.length) {
    store[key] = record;
  } else {
    delete store[key];
  }

  await writeManualRedactionStore(store);
  broadcastManualRedactions(record);

  return { record };
}

async function getManualRedactionsForTab(tab) {
  if (!tab?.url || isRestrictedCaptureUrl(tab.url)) {
    return buildEmptyManualRedactionRecord();
  }

  const store = await readManualRedactionStore();
  return store[buildManualRedactionKey(tab.url)] || buildEmptyManualRedactionRecord(tab.url);
}

async function clearManualRedactionsForTab(tab) {
  if (!tab?.url) {
    return buildEmptyManualRedactionRecord();
  }

  const store = await readManualRedactionStore();
  delete store[buildManualRedactionKey(tab.url)];
  await writeManualRedactionStore(store);
  return buildEmptyManualRedactionRecord(tab.url);
}

async function runCutawayRegionPicker(options = {}) {
  const sourceTab = await getCurrentTab();

  if (!sourceTab?.id || !sourceTab.url) {
    throw createFriendlyError(
      "No Active Page",
      "Open a normal browser tab, then start the cutaway picker again."
    );
  }

  if (isRestrictedCaptureUrl(sourceTab.url)) {
    throw createFriendlyError(
      "This Page Cannot Be Marked",
      "Chrome blocks script injection on internal pages, so the cutaway picker cannot run here."
    );
  }

  await ensureContentScript(sourceTab.id);
  const record = await getCutawayRegionForTab(sourceTab);
  const response = await chrome.tabs.sendMessage(sourceTab.id, {
    type: "LUMEN_START_CUTAWAY_REGION_PICKER",
    payload: {
      region: record.region || null,
      selectionMode: options.selectionMode === "lasso" ? "lasso" : "rect"
    }
  });

  if (!response?.ok) {
    throw createFriendlyError(
      "Cutaway Picker Failed",
      response?.error || "Lumen could not start the cutaway picker on this page."
    );
  }

  const region = normalizeCutawayRegion(response.picker?.region || record.region);

  return {
    record: {
      ...record,
      region,
      regions: region ? [region] : []
    }
  };
}

async function clearCutawayRegionForActiveTab() {
  const sourceTab = await getCurrentTab();

  if (!sourceTab?.url) {
    return {
      record: buildEmptyCutawayRegionRecord()
    };
  }

  const record = await clearCutawayRegionForTab(sourceTab);

  if (sourceTab.id) {
    chrome.tabs.sendMessage(sourceTab.id, {
      type: "LUMEN_CLEAR_CUTAWAY_REGION_PICKER"
    }).catch(() => {});
  }

  broadcastCutawayRegion(record);
  return { record };
}

async function getCutawayRegionForActiveTab() {
  const sourceTab = await getCurrentTab();

  if (!sourceTab?.url) {
    return {
      record: buildEmptyCutawayRegionRecord()
    };
  }

  return {
    record: await getCutawayRegionForTab(sourceTab)
  };
}

async function persistCutawayRegionFromContent(tab, payload = {}) {
  if (!tab?.url) {
    return {
      record: buildEmptyCutawayRegionRecord()
    };
  }

  const store = await readCutawayRegionStore();
  const key = buildManualRedactionKey(tab.url);
  const region = normalizeCutawayRegion(payload.region || payload.regions?.[0]);
  const record = {
    url: tab.url,
    host: new URL(tab.url).host,
    updatedAt: new Date().toISOString(),
    context: payload.context || null,
    region,
    regions: region ? [region] : []
  };

  if (region) {
    store[key] = record;
  } else {
    delete store[key];
  }

  await writeCutawayRegionStore(store);
  broadcastCutawayRegion(record);

  return { record };
}

async function getCutawayRegionForTab(tab) {
  if (!tab?.url || isRestrictedCaptureUrl(tab.url)) {
    return buildEmptyCutawayRegionRecord();
  }

  const store = await readCutawayRegionStore();
  const stored = store[buildManualRedactionKey(tab.url)];

  if (!stored) {
    return buildEmptyCutawayRegionRecord(tab.url);
  }

  return normalizeCutawayRecord(stored, tab.url);
}

async function clearCutawayRegionForTab(tab) {
  if (!tab?.url) {
    return buildEmptyCutawayRegionRecord();
  }

  const store = await readCutawayRegionStore();
  delete store[buildManualRedactionKey(tab.url)];
  await writeCutawayRegionStore(store);
  return buildEmptyCutawayRegionRecord(tab.url);
}

async function runAnnotationRegionPicker() {
  const sourceTab = await getCurrentTab();

  if (!sourceTab?.id || !sourceTab.url) {
    throw createFriendlyError(
      "No Active Page",
      "Open a normal browser tab, then start the annotation picker again."
    );
  }

  if (isRestrictedCaptureUrl(sourceTab.url)) {
    throw createFriendlyError(
      "This Page Cannot Be Marked",
      "Chrome blocks script injection on internal pages, so the annotation picker cannot run here."
    );
  }

  await ensureContentScript(sourceTab.id);
  const record = await getAnnotationRegionForTab(sourceTab);
  const response = await chrome.tabs.sendMessage(sourceTab.id, {
    type: "LUMEN_START_ANNOTATION_REGION_PICKER",
    payload: {
      region: record.region || null
    }
  });

  if (!response?.ok) {
    throw createFriendlyError(
      "Annotation Picker Failed",
      response?.error || "Lumen could not start the annotation picker on this page."
    );
  }

  const region = normalizeAnnotationRegion(response.picker?.region || record.region);

  return {
    record: {
      ...record,
      region,
      regions: region ? [region] : []
    }
  };
}

async function clearAnnotationRegionForActiveTab() {
  const sourceTab = await getCurrentTab();

  if (!sourceTab?.url) {
    return {
      record: buildEmptyAnnotationRegionRecord()
    };
  }

  const record = await clearAnnotationRegionForTab(sourceTab);

  if (sourceTab.id) {
    chrome.tabs.sendMessage(sourceTab.id, {
      type: "LUMEN_CLEAR_ANNOTATION_REGION_PICKER"
    }).catch(() => {});
  }

  broadcastAnnotationRegion(record);
  return { record };
}

async function getAnnotationRegionForActiveTab() {
  const sourceTab = await getCurrentTab();

  if (!sourceTab?.url) {
    return {
      record: buildEmptyAnnotationRegionRecord()
    };
  }

  return {
    record: await getAnnotationRegionForTab(sourceTab)
  };
}

async function persistAnnotationRegionFromContent(tab, payload = {}) {
  if (!tab?.url) {
    return {
      record: buildEmptyAnnotationRegionRecord()
    };
  }

  const store = await readAnnotationRegionStore();
  const key = buildManualRedactionKey(tab.url);
  const region = normalizeAnnotationRegion(payload.region || payload.regions?.[0]);
  const record = {
    url: tab.url,
    host: new URL(tab.url).host,
    updatedAt: new Date().toISOString(),
    context: payload.context || null,
    region,
    regions: region ? [region] : []
  };

  if (region) {
    store[key] = record;
  } else {
    delete store[key];
  }

  await writeAnnotationRegionStore(store);
  broadcastAnnotationRegion(record);

  return { record };
}

async function getAnnotationRegionForTab(tab) {
  if (!tab?.url || isRestrictedCaptureUrl(tab.url)) {
    return buildEmptyAnnotationRegionRecord();
  }

  const store = await readAnnotationRegionStore();
  const stored = store[buildManualRedactionKey(tab.url)];

  if (!stored) {
    return buildEmptyAnnotationRegionRecord(tab.url);
  }

  return normalizeAnnotationRecord(stored, tab.url);
}

async function clearAnnotationRegionForTab(tab) {
  if (!tab?.url) {
    return buildEmptyAnnotationRegionRecord();
  }

  const store = await readAnnotationRegionStore();
  delete store[buildManualRedactionKey(tab.url)];
  await writeAnnotationRegionStore(store);
  return buildEmptyAnnotationRegionRecord(tab.url);
}

function selectManualRedactionsForPage(record, page) {
  if (!record?.regions?.length) {
    return [];
  }

  const context = record.context || {};
  const contextMatches =
    !context.scrollMode ||
    (context.scrollMode === page.scrollMode && context.scrollContainer === page.scrollContainer);
  const viewportMatches =
    !context.viewportWidth ||
    Math.abs(context.viewportWidth - page.viewportWidth) <= Math.max(2, page.viewportWidth * 0.02);

  if (!contextMatches || !viewportMatches) {
    return [];
  }

  return normalizeManualRedactionRegions(record.regions);
}

function selectCutawayRegionForPage(record, page) {
  if (!record?.region) {
    return null;
  }

  const context = record.context || {};
  const contextMatches =
    !context.scrollMode ||
    (context.scrollMode === page.scrollMode && context.scrollContainer === page.scrollContainer);
  const viewportMatches =
    !context.viewportWidth ||
    Math.abs(context.viewportWidth - page.viewportWidth) <= Math.max(2, page.viewportWidth * 0.02);

  if (!contextMatches || !viewportMatches) {
    return null;
  }

  return normalizeCutawayRegion(record.region);
}

function normalizeManualRedactionRegions(regions) {
  return (Array.isArray(regions) ? regions : [])
    .filter((region) => Number.isFinite(region.left) && Number.isFinite(region.top))
    .map((region) => ({
      id: region.id || createLocalId(),
      kind: "manual",
      left: Math.max(0, Math.round(region.left)),
      top: Math.max(0, Math.round(region.top)),
      width: Math.max(1, Math.round(region.width || 1)),
      height: Math.max(1, Math.round(region.height || 1)),
      ...(normalizeManualSourceViewport(region.sourceViewport) ? {
        sourceViewport: normalizeManualSourceViewport(region.sourceViewport)
      } : {}),
      ...(normalizeManualAnchor(region.anchor) ? {
        anchor: normalizeManualAnchor(region.anchor)
      } : {}),
      ...(region.projected ? { projected: true } : {}),
      ...(typeof region.projection === "string" ? { projection: region.projection.slice(0, 32) } : {})
    }))
    .slice(0, LUMEN_CONFIG.capture.manualRedactionLimit || 24);
}

function normalizeCutawayRecord(record = {}, fallbackUrl = "") {
  const region = normalizeCutawayRegion(record.region || record.regions?.[0]);
  const rawUrl = record.url || fallbackUrl;

  return {
    url: rawUrl,
    host: rawUrl ? new URL(rawUrl).host : "",
    updatedAt: record.updatedAt || "",
    context: record.context || null,
    region,
    regions: region ? [region] : []
  };
}

function normalizeCutawayRegion(region) {
  if (!region || typeof region !== "object") {
    return null;
  }

  if (!Number.isFinite(region.left) || !Number.isFinite(region.top)) {
    return null;
  }

  return {
    id: region.id || createLocalId(),
    kind: "cutaway",
    left: Math.max(0, Math.round(region.left)),
    top: Math.max(0, Math.round(region.top)),
    width: Math.max(1, Math.round(region.width || 1)),
    height: Math.max(1, Math.round(region.height || 1)),
    shape: region.shape === "lasso" ? "lasso" : "rect",
    points: normalizeRegionPoints(region.points),
    ...(normalizeManualSourceViewport(region.sourceViewport) ? {
      sourceViewport: normalizeManualSourceViewport(region.sourceViewport)
    } : {}),
    ...(normalizeManualAnchor(region.anchor) ? {
      anchor: normalizeManualAnchor(region.anchor)
    } : {})
  };
}

function normalizeRegionPoints(points) {
  return (Array.isArray(points) ? points : [])
    .map((point) => ({
      x: Math.max(0, Math.round(Number(point?.x) || 0)),
      y: Math.max(0, Math.round(Number(point?.y) || 0))
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .slice(0, 120);
}

function normalizeAnnotationRecord(record = {}, fallbackUrl = "") {
  const region = normalizeAnnotationRegion(record.region || record.regions?.[0]);
  const rawUrl = record.url || fallbackUrl;

  return {
    url: rawUrl,
    host: rawUrl ? new URL(rawUrl).host : "",
    updatedAt: record.updatedAt || "",
    context: record.context || null,
    region,
    regions: region ? [region] : []
  };
}

function normalizeAnnotationRegion(region) {
  const normalized = normalizeCutawayRegion(region);

  if (!normalized) {
    return null;
  }

  return {
    ...normalized,
    kind: "annotation"
  };
}

function normalizeManualSourceViewport(sourceViewport) {
  if (!sourceViewport || typeof sourceViewport !== "object") {
    return null;
  }

  return {
    viewportWidth: Math.max(1, Math.round(sourceViewport.viewportWidth || 0)),
    viewportHeight: Math.max(1, Math.round(sourceViewport.viewportHeight || 0)),
    pageHeight: Math.max(1, Math.round(sourceViewport.pageHeight || 0)),
    scrollMode: sourceViewport.scrollMode === "container" ? "container" : "document",
    scrollContainer: typeof sourceViewport.scrollContainer === "string"
      ? sourceViewport.scrollContainer.slice(0, 160)
      : "document"
  };
}

function normalizeManualAnchor(anchor) {
  if (!anchor || typeof anchor !== "object" || typeof anchor.selector !== "string") {
    return null;
  }

  const ratios = anchor.ratios || {};

  if (
    !Number.isFinite(ratios.left) ||
    !Number.isFinite(ratios.top) ||
    !Number.isFinite(ratios.width) ||
    !Number.isFinite(ratios.height)
  ) {
    return null;
  }

  return {
    selector: anchor.selector.slice(0, 640),
    tagName: typeof anchor.tagName === "string" ? anchor.tagName.slice(0, 48) : "",
    sourceRect: normalizeManualAnchorRect(anchor.sourceRect),
    ratios: {
      left: clampRatio(ratios.left),
      top: clampRatio(ratios.top),
      width: clampRatio(ratios.width),
      height: clampRatio(ratios.height)
    }
  };
}

function normalizeManualAnchorRect(sourceRect) {
  if (!sourceRect || typeof sourceRect !== "object") {
    return null;
  }

  return {
    left: Math.max(0, Math.round(sourceRect.left || 0)),
    top: Math.max(0, Math.round(sourceRect.top || 0)),
    width: Math.max(1, Math.round(sourceRect.width || 1)),
    height: Math.max(1, Math.round(sourceRect.height || 1))
  };
}

function clampRatio(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, Number(value.toFixed(5))));
}

function buildRedactionBreakdown(regions) {
  return (Array.isArray(regions) ? regions : []).reduce((breakdown, region) => {
    const kind = region.kind || "sensitive";
    breakdown.total += 1;
    breakdown.byKind[kind] = (breakdown.byKind[kind] || 0) + 1;
    return breakdown;
  }, {
    total: 0,
    byKind: {}
  });
}

function mergeRedactionBreakdowns(breakdowns) {
  return (Array.isArray(breakdowns) ? breakdowns : []).reduce((merged, breakdown) => {
    if (!breakdown) {
      return merged;
    }

    for (const [kind, count] of Object.entries(breakdown.byKind || {})) {
      const safeCount = Number.isFinite(count) ? count : 0;
      merged.byKind[kind] = (merged.byKind[kind] || 0) + safeCount;
      merged.total += safeCount;
    }

    if (!Object.keys(breakdown.byKind || {}).length && Number.isFinite(breakdown.total)) {
      merged.total += breakdown.total;
    }

    return merged;
  }, {
    total: 0,
    byKind: {}
  });
}

function buildManualProjectionStats({
  storedCount = 0,
  appliedCount = 0,
  directCount = 0,
  projectedCount = 0,
  skippedCount = 0
} = {}) {
  return {
    storedCount: clampNonNegativeInteger(storedCount),
    appliedCount: clampNonNegativeInteger(appliedCount),
    directCount: clampNonNegativeInteger(directCount),
    projectedCount: clampNonNegativeInteger(projectedCount),
    skippedCount: clampNonNegativeInteger(skippedCount)
  };
}

function mergeManualProjectionStats(statsList) {
  return (Array.isArray(statsList) ? statsList : []).reduce((merged, stats) => {
    const normalized = buildManualProjectionStats(stats || {});

    return {
      storedCount: merged.storedCount + normalized.storedCount,
      appliedCount: merged.appliedCount + normalized.appliedCount,
      directCount: merged.directCount + normalized.directCount,
      projectedCount: merged.projectedCount + normalized.projectedCount,
      skippedCount: merged.skippedCount + normalized.skippedCount
    };
  }, buildManualProjectionStats());
}

function buildCutawayResolutionStats({
  storedCount = 0,
  appliedCount = 0,
  directCount = 0,
  projectedCount = 0,
  skippedCount = 0
} = {}) {
  return {
    storedCount: clampNonNegativeInteger(storedCount),
    appliedCount: clampNonNegativeInteger(appliedCount),
    directCount: clampNonNegativeInteger(directCount),
    projectedCount: clampNonNegativeInteger(projectedCount),
    skippedCount: clampNonNegativeInteger(skippedCount)
  };
}

function mergeCutawayResolutionStats(statsList) {
  return (Array.isArray(statsList) ? statsList : []).reduce((merged, stats) => {
    const normalized = buildCutawayResolutionStats(stats || {});

    return {
      storedCount: merged.storedCount + normalized.storedCount,
      appliedCount: merged.appliedCount + normalized.appliedCount,
      directCount: merged.directCount + normalized.directCount,
      projectedCount: merged.projectedCount + normalized.projectedCount,
      skippedCount: merged.skippedCount + normalized.skippedCount
    };
  }, buildCutawayResolutionStats());
}

function clampNonNegativeInteger(value) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

async function readManualRedactionStore() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.manualRedactions);
  const value = stored[STORAGE_KEYS.manualRedactions];
  return value && typeof value === "object" ? value : {};
}

async function writeManualRedactionStore(store) {
  const entries = Object.entries(store)
    .sort((left, right) => new Date(right[1].updatedAt || 0) - new Date(left[1].updatedAt || 0))
    .slice(0, 50);

  await chrome.storage.local.set({
    [STORAGE_KEYS.manualRedactions]: Object.fromEntries(entries)
  });
}

async function readCutawayRegionStore() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.cutawayRegions);
  const value = stored[STORAGE_KEYS.cutawayRegions];
  return value && typeof value === "object" ? value : {};
}

async function writeCutawayRegionStore(store) {
  const entries = Object.entries(store)
    .sort((left, right) => new Date(right[1].updatedAt || 0) - new Date(left[1].updatedAt || 0))
    .slice(0, 50);

  await chrome.storage.local.set({
    [STORAGE_KEYS.cutawayRegions]: Object.fromEntries(entries)
  });
}

async function readAnnotationRegionStore() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.annotationRegions);
  const value = stored[STORAGE_KEYS.annotationRegions];
  return value && typeof value === "object" ? value : {};
}

async function writeAnnotationRegionStore(store) {
  const entries = Object.entries(store)
    .sort((left, right) => new Date(right[1].updatedAt || 0) - new Date(left[1].updatedAt || 0))
    .slice(0, 50);

  await chrome.storage.local.set({
    [STORAGE_KEYS.annotationRegions]: Object.fromEntries(entries)
  });
}

function buildManualRedactionKey(rawUrl) {
  const url = new URL(rawUrl);
  return `${url.origin}${url.pathname}${url.search}`;
}

function buildEmptyManualRedactionRecord(rawUrl = "") {
  return {
    url: rawUrl,
    host: rawUrl ? new URL(rawUrl).host : "",
    updatedAt: "",
    context: null,
    regions: []
  };
}

function buildEmptyCutawayRegionRecord(rawUrl = "") {
  return {
    url: rawUrl,
    host: rawUrl ? new URL(rawUrl).host : "",
    updatedAt: "",
    context: null,
    region: null,
    regions: []
  };
}

function buildEmptyAnnotationRegionRecord(rawUrl = "") {
  return {
    url: rawUrl,
    host: rawUrl ? new URL(rawUrl).host : "",
    updatedAt: "",
    context: null,
    region: null,
    regions: []
  };
}

async function captureVariant({
  sourceTab,
  variant,
  options,
  manualRedactions,
  cutawayRegion,
  annotationRegion,
  runContext,
  extractBlueprint,
  cacheReviewPdf = false,
  focusedOnly = false,
  changeBaselineHash = "",
  saveOnlyWhenChanged = false
}) {
  const target = await createCaptureTarget(sourceTab, variant);

  try {
    broadcastProgress({
      stage: "prepare",
      title: `Preparing ${variant.label} capture`,
      detail: buildVariantProgressDetail(variant, "prepare")
    });

    await ensureContentScript(target.tab.id);
    const viewportCalibration = await calibrateCaptureViewport(target, variant);
    await showPageUsageHud(target.tab.id, {
      stage: "prepare",
      title: `Preparing ${variant.label.toLowerCase()} capture`,
      detail: "Lumen is cleaning the page and checking the scroll surface. This panel is hidden before screenshots are taken.",
      progress: 0.12
    });

    const prepareResult = await chrome.tabs.sendMessage(target.tab.id, {
      type: "LUMEN_PREPARE_CAPTURE",
      options
    });

    if (!prepareResult?.ok) {
      throw new Error("Page preparation did not complete.");
    }

    const page = prepareResult.page;
    const sessionId = createLocalId();
    let redactionScan = {
      count: 0,
      regions: []
    };
    let blueprint = null;

    if (options.autoRedact) {
      await showPageUsageHud(target.tab.id, {
        stage: "review",
        title: `Scanning ${variant.label.toLowerCase()} view`,
        detail: "Checking visible text and filled inputs for sensitive data before export.",
        progress: 0.42
      });

      broadcastProgress({
        stage: "sanitize",
        title: `Scanning ${variant.label.toLowerCase()} view`,
        detail: `Looking for emails, phone numbers, tokens, and filled fields in the ${variant.label.toLowerCase()} layout.`
      });

      redactionScan = await requestRedactionScan(target.tab.id);

      if (redactionScan.truncated) {
        throw createFriendlyError(
          "Redaction Review Limit Reached",
          `Lumen found more than ${redactionScan.limit || 80} sensitive regions in the current view. The capture stopped before saving so private pixels are not silently missed.`
        );
      }
    }

    await showPageUsageHud(target.tab.id, {
      stage: "review",
      title: "Resolving review marks",
      detail: "Projecting manual redactions, cutaways, and callouts into the current layout.",
      progress: 0.52
    });

    const manualResolution = await resolveManualRedactionsForTarget(target.tab.id, manualRedactions, page);
    const manualRegions = manualResolution.regions;
    const cutawayResolution = await resolveCutawayRegionForTarget(target.tab.id, cutawayRegion, page);
    const annotationResolution = await resolveAnnotationRegionForTarget(target.tab.id, annotationRegion, page);
    const redactionState = {
      autoRegions: [...redactionScan.regions],
      manualRegions
    };
    const combinedRedactions = mergeCaptureRedactionRegions([
      ...redactionState.autoRegions,
      ...redactionState.manualRegions
    ]);

    if (extractBlueprint) {
      blueprint = await maybeExtractBlueprint(target.tab.id);
    }

    await initializeStitchSession({
      sessionId,
      page,
      options: {
        ...options,
        devicePreset: variant.id,
        cacheReviewPdf,
        reviewPdfRole: focusedOnly ? "cutaway" : "full-page"
      },
      redactions: combinedRedactions,
      cutawayRegion: cutawayResolution.region,
      annotationRegion: annotationResolution.region
    });

    await showPageUsageHud(target.tab.id, {
      stage: "ready",
      title: "Screenshot pass starting",
      detail: "The on-page Lumen panel is being removed so the export stays clean.",
      progress: 0.62
    });
    await sleep(120);
    await hidePageUsageHud(target.tab.id);
    const segmentCount = await capturePageSegments(target, page, sessionId, variant, {
      autoRedact: Boolean(options.autoRedact),
      redactionState
    });
    const finalRedactions = mergeCaptureRedactionRegions([
      ...redactionState.autoRegions,
      ...redactionState.manualRegions
    ]);

    await showPageUsageHud(target.tab.id, {
      stage: "save",
      title: `Compositing ${variant.label.toLowerCase()} output`,
      detail: "The page capture is complete. Lumen is stitching and saving artifacts in the background.",
      progress: 0.84
    });

    broadcastProgress({
      stage: "stitch",
      title: `Compositing ${variant.label.toLowerCase()} output`,
      detail: `Drawing ${segmentCount} ${variant.label.toLowerCase()} slice${segmentCount === 1 ? "" : "s"} into the offscreen studio.`
    });

    const stitched = await finalizeStitchSession(sessionId);

    if (stitched.captureHealth?.status && stitched.captureHealth.status !== "complete") {
      throw createFriendlyError(
        "Capture Integrity Check Failed",
        `Lumen verified only ${stitched.captureHealth.coveragePercent}% of the ${variant.label.toLowerCase()} page. No files were saved; keep the page active and retry.`
      );
    }

    const renderedOutputs = focusedOnly
      ? stitched.outputs.filter((output) => output.role === "cutaway")
      : stitched.outputs;

    if (focusedOnly && !renderedOutputs.length) {
      throw createFriendlyError(
        "Selected Area Was Not Found",
        "The page layout changed enough that Lumen could not safely resolve the saved area. No files were saved."
      );
    }

    const visualHash = renderedOutputs[0]?.visualHash || "";
    const changePercent = changeBaselineHash
      ? calculateVisualHashDifference(changeBaselineHash, visualHash)
      : 100;
    const unchanged = Boolean(saveOnlyWhenChanged && changeBaselineHash && changePercent <= 1.5);

    const fileBaseName = buildCaptureFileBaseName({
      title: page.title,
      url: page.url,
      exportPreset: stitched.appliedPreset,
      devicePreset: variant.id
    });

    broadcastProgress({
      stage: "save",
      title: `Saving ${variant.label.toLowerCase()} files`,
      detail: `Writing the ${variant.label.toLowerCase()} capture to your Downloads folder.`
    });

    const downloadRecords = unchanged
      ? []
      : await downloadRenderedOutputs(renderedOutputs, {
          folder: runContext.folder,
          fileBaseName,
          variantId: variant.id,
          exportPreset: stitched.appliedPreset
        });

    const photoPreviews = unchanged ? [] : renderedOutputs.map((output, index) => ({
      role: output.role || "full-page",
      partIndex: output.partIndex || index + 1,
      width: output.width || 0,
      height: output.height || 0,
      cutawayRegion: output.cutawayRegion || null,
      previewDataUrl: output.previewDataUrl || "",
      visualHash: output.visualHash || "",
      download: downloadRecords[index] || null
    }));
    const primaryRenderedOutput = renderedOutputs[0] || null;
    const editorSource = unchanged
      ? null
      : focusedOnly && primaryRenderedOutput
        ? {
            dataUrl: primaryRenderedOutput.dataUrl || "",
            mime: "image/png",
            width: primaryRenderedOutput.width || 0,
            height: primaryRenderedOutput.height || 0,
            originalWidth: primaryRenderedOutput.width || 0,
            originalHeight: primaryRenderedOutput.height || 0,
            pageWidth: stitched.width || primaryRenderedOutput.width || 0,
            pageHeight: stitched.height || primaryRenderedOutput.height || 0,
            scaled: false,
            kind: "lossless-cutaway-output",
            role: "cutaway",
            variantId: variant.id
          }
        : stitched.editorSource
          ? {
              ...stitched.editorSource,
              variantId: variant.id
            }
          : null;

    if (!unchanged && !focusedOnly && options.longPageMode === "print") {
      downloadRecords.push(await downloadPrintSheet(renderedOutputs, {
        folder: runContext.folder,
        fileBaseName,
        variantId: variant.id,
        exportPreset: stitched.appliedPreset,
        page
      }));
    }

    const downloadedFiles = downloadRecords.map((record) => record.filename);

    return {
      variant,
      page,
      blueprint,
      downloadedFiles,
      downloadRecords,
      photoPreviews,
      editorSource,
      pdfSource: unchanged ? null : stitched.pdfSource || null,
      visualHash,
      changePercent,
      unchanged,
      segmentCount,
      tileCount: stitched.tileCount ?? stitched.outputs.length,
      redactionCount: stitched.redactionCount,
      manualRedactionCount: manualRegions.length,
      cutawayCount: stitched.cutawayCount || 0,
      manualProjectionStats: manualResolution.stats,
      cutawayResolutionStats: cutawayResolution.stats,
      annotationResolutionStats: annotationResolution.stats,
      redactionBreakdown: buildRedactionBreakdown(finalRedactions),
      captureHealth: stitched.captureHealth || null,
      viewport: viewportCalibration,
      exportPreset: stitched.appliedPreset,
      dimensions: {
        width: stitched.width,
        height: stitched.height
      }
    };
  } finally {
    await resetStitchSessionSilently();

    if (target.kind === "desktop") {
      await restoreTabState(target.tab.id);
    } else {
      await closeWindowSafely(target.windowId);
    }
  }
}

async function capturePageSegments(target, page, sessionId, variant, { autoRedact = false, redactionState = null } = {}) {
  const maxSegments = LUMEN_CONFIG.capture.maxSegments;
  let lastCaptureTimestamp = 0;
  let previousTop = null;
  let requestedTop = 0;
  let segmentCount = 0;
  let stallRetries = 0;

  while (segmentCount < maxSegments) {
    const scrollResult = await chrome.tabs.sendMessage(target.tab.id, {
      type: "LUMEN_SCROLL_TO",
      top: requestedTop
    });

    const actualTop = scrollResult?.top ?? 0;
    page.pageHeight = Math.max(page.pageHeight, scrollResult?.pageHeight ?? page.pageHeight);
    page.viewportHeight = scrollResult?.viewportHeight ?? page.viewportHeight;

    if (previousTop !== null && actualTop <= previousTop) {
      if (stallRetries >= LUMEN_CONFIG.capture.maxStallRetries) {
        page.pageHeight = Math.max(page.viewportHeight, previousTop + page.viewportHeight);
        await updateStitchSessionPage({
          sessionId,
          page
        });

        broadcastProgress({
          stage: "capture",
          title: `Finished reachable ${variant.label.toLowerCase()} area`,
          detail: "The page would not scroll farther after repeated rechecks, so Lumen sealed the capture at the last reachable viewport.",
          progress: 0.9
        });

        return segmentCount;
      }

      stallRetries += 1;

      broadcastProgress({
        stage: "capture",
        title: `Rechecking ${variant.label.toLowerCase()} layout`,
        detail: "The page stopped advancing, so Lumen is remeasuring the scroll surface before trying again.",
        progress: 0.82
      });

      const refreshedPage = await requestPreparedPageMetrics(target.tab.id);
      page.pageHeight = Math.max(page.pageHeight, refreshedPage.pageHeight ?? page.pageHeight);
      page.viewportHeight = refreshedPage.viewportHeight ?? page.viewportHeight;
      requestedTop = Math.min(
        Math.max(0, page.pageHeight - page.viewportHeight),
        previousTop + Math.max(120, Math.round(page.viewportHeight * 0.55))
      );

      await sleep(LUMEN_CONFIG.capture.tailReflowSettleMs);
      continue;
    }

    stallRetries = 0;

    await sleep(LUMEN_CONFIG.capture.segmentSettleMs);

    if (autoRedact && redactionState) {
      const sliceScan = await requestRedactionScan(target.tab.id);

      if (sliceScan.truncated) {
        throw createFriendlyError(
          "Redaction Review Limit Reached",
          `Lumen found more than ${sliceScan.limit || 80} sensitive regions while scrolling. The capture stopped before any files were saved.`
        );
      }

      redactionState.autoRegions = mergeCaptureRedactionRegions([
        ...redactionState.autoRegions,
        ...sliceScan.regions
      ]);

      if (redactionState.autoRegions.length + redactionState.manualRegions.length > MAX_CAPTURE_REDACTIONS) {
        throw createFriendlyError(
          "Redaction Safety Limit Reached",
          `This page produced more than ${MAX_CAPTURE_REDACTIONS} redaction regions during capture. Lumen stopped before export instead of silently dropping private areas.`
        );
      }

      await updateStitchSessionPage({
        sessionId,
        page,
        redactions: mergeCaptureRedactionRegions([
          ...redactionState.autoRegions,
          ...redactionState.manualRegions
        ])
      });
    }

    lastCaptureTimestamp = await waitForCaptureWindow(lastCaptureTimestamp);

    const dataUrl = await captureTargetVisibleTab(target);

    const cropTopCss =
      previousTop === null
        ? 0
        : Math.max(0, previousTop + page.viewportHeight - actualTop);
    const cropBottomCss = Math.max(0, actualTop + page.viewportHeight - page.pageHeight);

    await appendCaptureSegment({
      sessionId,
      segment: {
        index: segmentCount,
        topCss: actualTop,
        cropTopCss,
        cropBottomCss,
        captureRect: page.captureRect || null,
        dataUrl
      }
    });

    segmentCount += 1;

    const progress = Math.min(
      0.92,
      (actualTop + page.viewportHeight) / Math.max(page.pageHeight, page.viewportHeight)
    );

    broadcastProgress({
      stage: "capture",
      title: `Capturing ${variant.label.toLowerCase()} slice ${segmentCount}`,
      detail: `Viewport ${segmentCount} of the ${variant.label.toLowerCase()} scrolling stack.`,
      progress
    });

    if (actualTop + page.viewportHeight >= page.pageHeight - 1) {
      const refreshedPage = await requestPreparedPageMetrics(target.tab.id);
      page.pageHeight = Math.max(page.pageHeight, refreshedPage.pageHeight ?? page.pageHeight);
      page.viewportHeight = refreshedPage.viewportHeight ?? page.viewportHeight;

      if (actualTop + page.viewportHeight >= page.pageHeight - 1) {
        await updateStitchSessionPage({
          sessionId,
          page
        });
        return segmentCount;
      }
    }

    previousTop = actualTop;
    requestedTop = actualTop + page.viewportHeight;
  }

  throw createFriendlyError(
    "Page Too Long",
    `This page exceeded the current ${maxSegments} slice safety limit. Raise the cap or switch to a tiled export for extremely long pages.`
  );
}

function mergeCaptureRedactionRegions(regions = []) {
  const seen = new Set();
  const merged = [];

  for (const region of regions) {
    if (
      !region ||
      !Number.isFinite(region.left) ||
      !Number.isFinite(region.top) ||
      !Number.isFinite(region.width) ||
      !Number.isFinite(region.height)
    ) {
      continue;
    }

    const normalized = {
      ...region,
      left: Math.max(0, Math.round(region.left)),
      top: Math.max(0, Math.round(region.top)),
      width: Math.max(1, Math.round(region.width)),
      height: Math.max(1, Math.round(region.height))
    };
    const key = [normalized.kind || "sensitive", normalized.left, normalized.top, normalized.width, normalized.height].join(":");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(normalized);
  }

  return merged;
}

async function captureTargetVisibleTab(target) {
  if (!Number.isInteger(target?.tab?.id) || !Number.isInteger(target?.windowId)) {
    throw createFriendlyError("Capture Target Lost", "Lumen could not verify the page selected for this screenshot slice.");
  }

  await chrome.tabs.update(target.tab.id, {
    active: true
  });

  const [activeTab] = await chrome.tabs.query({
    windowId: target.windowId,
    active: true
  });

  if (activeTab?.id !== target.tab.id) {
    throw createFriendlyError(
      "Capture Target Changed",
      "Another tab became active during the capture. Lumen stopped instead of saving pixels from the wrong page."
    );
  }

  return chrome.tabs.captureVisibleTab(target.windowId, {
    format: "png"
  });
}

async function createCaptureTarget(tab, variant) {
  if (variant.mode === "desktop") {
    return {
      kind: "desktop",
      tab,
      windowId: tab.windowId
    };
  }

  const { width, height } = variant.viewport;

  const createdWindow = await chrome.windows.create({
    url: tab.url,
    type: "popup",
    width,
    height,
    focused: false
  });

  const [viewportTab] = await chrome.tabs.query({
    windowId: createdWindow.id,
    active: true
  });

  if (!viewportTab?.id) {
    throw createFriendlyError(
      `${variant.label} View Failed`,
      `Chrome could not create the temporary ${variant.label.toLowerCase()} capture window.`
    );
  }

  await waitForTabComplete(viewportTab.id);
  await sleep(260);

  return {
    kind: "viewport",
    tab: viewportTab,
    windowId: createdWindow.id
  };
}

async function calibrateCaptureViewport(target, variant) {
  if (target?.kind !== "viewport" || !variant?.viewport) {
    return {
      requestedWidth: 0,
      requestedHeight: 0,
      actualWidth: 0,
      actualHeight: 0,
      exact: true
    };
  }

  const requestedWidth = Math.max(1, Math.round(variant.viewport.width));
  const requestedHeight = Math.max(1, Math.round(variant.viewport.height));
  let metrics = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    metrics = await requestPreparedPageMetrics(target.tab.id);
    const actualWidth = Math.max(1, Math.round(metrics.browserViewportWidth || metrics.viewportWidth));
    const actualHeight = Math.max(1, Math.round(metrics.browserViewportHeight || metrics.viewportHeight));
    const widthDelta = requestedWidth - actualWidth;
    const heightDelta = requestedHeight - actualHeight;

    if (Math.abs(widthDelta) <= 1 && Math.abs(heightDelta) <= 1) {
      return {
        requestedWidth,
        requestedHeight,
        actualWidth,
        actualHeight,
        widthExact: true,
        heightExact: true,
        exact: true
      };
    }

    const captureWindow = await chrome.windows.get(target.windowId);
    await chrome.windows.update(target.windowId, {
      width: Math.max(320, Math.round((captureWindow.width || requestedWidth) + widthDelta)),
      height: Math.max(240, Math.round((captureWindow.height || requestedHeight) + heightDelta))
    });
    await sleep(140);
  }

  metrics = await requestPreparedPageMetrics(target.tab.id);
  const actualWidth = Math.max(1, Math.round(metrics.browserViewportWidth || metrics.viewportWidth));
  const actualHeight = Math.max(1, Math.round(metrics.browserViewportHeight || metrics.viewportHeight));

  const widthExact = Math.abs(actualWidth - requestedWidth) <= 1;
  const heightExact = Math.abs(actualHeight - requestedHeight) <= 1;

  if (!widthExact) {
    throw createFriendlyError(
      `${variant.label} Viewport Could Not Be Calibrated`,
      `Chrome produced a ${actualWidth}px-wide CSS viewport instead of ${requestedWidth}px. Lumen stopped rather than label an inexact responsive layout.`
    );
  }

  return {
    requestedWidth,
    requestedHeight,
    actualWidth,
    actualHeight,
    widthExact,
    heightExact,
    exact: widthExact && heightExact
  };
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
}

async function maybeExtractBlueprint(tabId) {
  try {
    broadcastProgress({
      stage: "inspect",
      title: "Extracting brand blueprint",
      detail: "Reading colors, fonts, layout density, and hero signals while the page is prepared."
    });

    const blueprint = await requestBrandBlueprint(tabId);
    await persistLatestBlueprint(blueprint);
    return blueprint;
  } catch (error) {
    console.debug("Lumen blueprint extraction skipped:", error);
    return null;
  }
}

async function restoreTabState(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "LUMEN_RESTORE_PAGE"
    });
  } catch (error) {
    console.debug("Lumen restore skipped:", error);
  }
}

async function showPageUsageHud(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "LUMEN_SHOW_USAGE_HUD",
      payload
    });
  } catch (error) {
    console.debug("Lumen usage HUD skipped:", error);
  }
}

async function hidePageUsageHud(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "LUMEN_HIDE_USAGE_HUD"
    });
  } catch (error) {
    console.debug("Lumen usage HUD hide skipped:", error);
  }
}

async function initializeStitchSession(payload) {
  await ensureOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_INIT_STITCH_SESSION",
    target: "offscreen",
    payload
  });

  if (!response?.ok) {
    throw new Error("Offscreen stitch session could not start.");
  }
}

async function updateStitchSessionPage(payload) {
  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_UPDATE_STITCH_SESSION",
    target: "offscreen",
    payload
  });

  if (!response?.ok) {
    throw new Error("Offscreen stitch session could not update.");
  }
}

async function requestBrandBlueprint(tabId) {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "LUMEN_EXTRACT_BLUEPRINT"
  });

  if (!response?.ok || !response.blueprint) {
    throw new Error(response?.error || "Brand blueprint extraction failed.");
  }

  return response.blueprint;
}

async function requestRedactionScan(tabId) {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "LUMEN_SCAN_REDACTIONS"
  });

  if (!response?.ok || !Array.isArray(response.redactions?.regions)) {
    throw createFriendlyError(
      "Auto-redaction failed",
      response?.error || "Lumen could not scan the page for sensitive regions."
    );
  }

  return response.redactions;
}

async function resolveManualRedactionsForTarget(tabId, manualRedactions, page) {
  if (!manualRedactions?.regions?.length) {
    return {
      regions: [],
      stats: buildManualProjectionStats()
    };
  }

  const storedCount = manualRedactions.regions.length;

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "LUMEN_RESOLVE_MANUAL_REDACTIONS",
      payload: {
        regions: manualRedactions.regions,
        context: manualRedactions.context || null
      }
    });

    if (response?.ok && Array.isArray(response.manualRedactions?.regions)) {
      const regions = normalizeManualRedactionRegions(response.manualRedactions.regions);

      return {
        regions,
        stats: buildManualProjectionStats({
          storedCount,
          appliedCount: regions.length,
          directCount: response.manualRedactions.directCount,
          projectedCount: response.manualRedactions.projectedCount,
          skippedCount: response.manualRedactions.skippedCount
        })
      };
    }
  } catch (error) {
    console.debug("Lumen manual redaction projection skipped:", error);
  }

  const fallbackRegions = selectManualRedactionsForPage(manualRedactions, page);

  return {
    regions: fallbackRegions,
    stats: buildManualProjectionStats({
      storedCount,
      appliedCount: fallbackRegions.length,
      directCount: fallbackRegions.length,
      projectedCount: 0,
      skippedCount: Math.max(0, storedCount - fallbackRegions.length)
    })
  };
}

async function resolveCutawayRegionForTarget(tabId, cutawayRecord, page) {
  if (!cutawayRecord?.region) {
    return {
      region: null,
      stats: buildCutawayResolutionStats()
    };
  }

  const storedCount = 1;

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "LUMEN_RESOLVE_CUTAWAY_REGION",
      payload: {
        region: cutawayRecord.region,
        context: cutawayRecord.context || null
      }
    });

    if (response?.ok) {
      const region = normalizeCutawayRegion(response.cutawayRegion?.region);

      return {
        region,
        stats: buildCutawayResolutionStats({
          storedCount,
          appliedCount: region ? 1 : 0,
          directCount: response.cutawayRegion?.directCount,
          projectedCount: response.cutawayRegion?.projectedCount,
          skippedCount: response.cutawayRegion?.skippedCount
        })
      };
    }
  } catch (error) {
    console.debug("Lumen cutaway projection skipped:", error);
  }

  const fallbackRegion = selectCutawayRegionForPage(cutawayRecord, page);

  return {
    region: fallbackRegion,
    stats: buildCutawayResolutionStats({
      storedCount,
      appliedCount: fallbackRegion ? 1 : 0,
      directCount: fallbackRegion ? 1 : 0,
      projectedCount: 0,
      skippedCount: fallbackRegion ? 0 : 1
    })
  };
}

async function resolveAnnotationRegionForTarget(tabId, annotationRecord, page) {
  if (!annotationRecord?.region) {
    return {
      region: null,
      stats: buildCutawayResolutionStats()
    };
  }

  const storedCount = 1;

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "LUMEN_RESOLVE_ANNOTATION_REGION",
      payload: {
        region: annotationRecord.region,
        context: annotationRecord.context || null
      }
    });

    if (response?.ok) {
      const region = normalizeAnnotationRegion(response.annotationRegion?.region);

      return {
        region,
        stats: buildCutawayResolutionStats({
          storedCount,
          appliedCount: region ? 1 : 0,
          directCount: response.annotationRegion?.directCount,
          projectedCount: response.annotationRegion?.projectedCount,
          skippedCount: response.annotationRegion?.skippedCount
        })
      };
    }
  } catch (error) {
    console.debug("Lumen annotation projection skipped:", error);
  }

  const fallbackRegion = normalizeAnnotationRegion(selectCutawayRegionForPage(annotationRecord, page));

  return {
    region: fallbackRegion,
    stats: buildCutawayResolutionStats({
      storedCount,
      appliedCount: fallbackRegion ? 1 : 0,
      directCount: fallbackRegion ? 1 : 0,
      projectedCount: 0,
      skippedCount: fallbackRegion ? 0 : 1
    })
  };
}

async function requestPreparedPageMetrics(tabId) {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "LUMEN_MEASURE_PAGE"
  });

  if (!response?.ok || !response.page) {
    throw createFriendlyError(
      "Capture Recheck Failed",
      response?.error || "Lumen could not remeasure the page after scrolling."
    );
  }

  return response.page;
}

async function persistLatestBlueprint(blueprint) {
  const sanitizedBlueprint = blueprint?.page
    ? {
        ...blueprint,
        page: {
          ...blueprint.page,
          url: sanitizeCaptureUrl(blueprint.page.url)
        }
      }
    : blueprint;

  await chrome.storage.local.set({
    [STORAGE_KEYS.latestBlueprint]: sanitizedBlueprint
  });

  chrome.runtime.sendMessage({
    type: BLUEPRINT_UPDATE_EVENT,
    payload: sanitizedBlueprint
  }).catch(() => {});
}

async function appendCaptureSegment(payload) {
  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_APPEND_CAPTURE_SEGMENT",
    target: "offscreen",
    payload
  });

  if (!response?.ok) {
    throw new Error("Offscreen segment append failed.");
  }
}

async function finalizeStitchSession(sessionId) {
  const response = await chrome.runtime.sendMessage({
    type: "LUMEN_FINALIZE_STITCH_SESSION",
    target: "offscreen",
    payload: { sessionId }
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Offscreen compositing failed.");
  }

  return response.result;
}

async function resetStitchSessionSilently() {
  try {
    await chrome.runtime.sendMessage({
      type: "LUMEN_RESET_STITCH_SESSIONS",
      target: "offscreen"
    });
  } catch (error) {
    console.debug("Lumen offscreen reset skipped:", error);
  }
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }

  if (offscreenCreationPromise) {
    await offscreenCreationPromise;
    return;
  }

  offscreenCreationPromise = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [OFFSCREEN_REASON],
    justification: "Stitch viewport captures into a single full-page image."
  });

  try {
    await offscreenCreationPromise;
  } finally {
    offscreenCreationPromise = null;
  }
}

async function hasOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if ("getContexts" in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });

    return contexts.length > 0;
  }

  const matchedClients = await clients.matchAll();
  return matchedClients.some((client) => client.url === offscreenUrl);
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  return tab;
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);

    if (tab.status === "complete") {
      return tab;
    }

    await sleep(120);
  }

  throw createFriendlyError(
    "Page Load Timed Out",
    "The temporary capture window took too long to finish rendering."
  );
}

function buildCaptureFileBaseName({ title, url, devicePreset, exportPreset }) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const safeTitle = sanitizeSegment(title || host).slice(0, 48);

  return `${safeTitle || "capture"}-${devicePreset}-${exportPreset}`;
}

function buildManifestFileBaseName(page, options, exportPreset) {
  const host = new URL(page.url).hostname.replace(/^www\./, "");
  const safeTitle = sanitizeSegment(page.title || host).slice(0, 48);

  return `${safeTitle || "capture"}-context-${options.devicePreset || "desktop"}-${exportPreset}`;
}

function buildCaptureRunContext({ title, url, capturedAt }) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const safeTitle = sanitizeSegment(title || host).slice(0, 48) || "capture";
  const day = capturedAt.slice(0, 10);
  const timestamp = capturedAt.replace(/[:.]/g, "-");

  return {
    capturedAt,
    folder: `Lumen/${day}/${safeTitle}-${timestamp}`
  };
}

function sanitizeSegment(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function selectPrimaryDownloadRecord(record) {
  const downloads = Array.isArray(record.downloads) ? record.downloads : [];

  return downloads.find((download) => Number.isInteger(download.downloadId) && download.kind === "image") ||
    downloads.find((download) => Number.isInteger(download.downloadId)) ||
    null;
}

function callDownloadsMethod(method, ...args) {
  return new Promise((resolve, reject) => {
    try {
      const result = chrome.downloads[method](...args);

      if (result && typeof result.then === "function") {
        result.then(resolve, reject);
        return;
      }

      const lastError = chrome.runtime.lastError;

      if (lastError) {
        reject(new Error(lastError.message));
        return;
      }

      resolve(result);
    } catch (error) {
      reject(error);
    }
  });
}

async function waitForDownloadComplete(downloadId, timeoutMs = 30000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const [downloadItem] = await chrome.downloads.search({
      id: downloadId
    });

    if (downloadItem?.state === "complete") {
      return downloadItem;
    }

    if (downloadItem?.state === "interrupted") {
      throw createFriendlyError(
        "Download Interrupted",
        downloadItem.error || "Chrome interrupted the capture download before it finished."
      );
    }

    await sleep(120);
  }

  throw createFriendlyError(
    "Download Timed Out",
    "Chrome started the capture download, but it did not finish in time."
  );
}

function createFriendlyError(title, description) {
  return { title, description };
}

function createLocalId() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `lumen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildCaptureCompletionDetail({
  segmentCount,
  fileCount,
  redactionCount,
  manualRedactionCount,
  cutawayCount,
  manualProjectionStats,
  cutawayResolutionStats,
  variantCount,
  captureHealth,
  manifestSaved,
  annotationAdded,
  annotationRegionApplied
}) {
  const sliceText = `${segmentCount} slice${segmentCount === 1 ? "" : "s"} stitched`;
  const fileText = `${fileCount} file${fileCount === 1 ? "" : "s"} saved`;
  const variantText = variantCount > 1 ? `${variantCount} responsive views captured` : "";
  const projectionText = formatManualProjectionStats(manualProjectionStats);
  const cutawayProjectionText = formatCutawayResolutionStats(cutawayResolutionStats);

  if (
    !redactionCount &&
    !variantText &&
    !projectionText &&
    !cutawayCount &&
    !cutawayProjectionText &&
    !manifestSaved &&
    !annotationAdded &&
    !annotationRegionApplied
  ) {
    return `${sliceText} and ${fileText} successfully.`;
  }

  const fragments = [sliceText, fileText];

  if (captureHealth?.status === "complete") {
    fragments.push(`${captureHealth.verifiedVariantCount || variantCount} view${(captureHealth.verifiedVariantCount || variantCount) === 1 ? "" : "s"} integrity-verified`);
  }

  if (variantText) {
    fragments.push(variantText);
  }

  if (redactionCount) {
    fragments.push(`${redactionCount} redaction region${redactionCount === 1 ? "" : "s"} sanitized`);
  }

  if (manualRedactionCount) {
    fragments.push(`${manualRedactionCount} manual box${manualRedactionCount === 1 ? "" : "es"} applied`);
  }

  if (cutawayCount) {
    fragments.push(`${cutawayCount} cutaway crop${cutawayCount === 1 ? "" : "s"} exported`);
  }

  if (projectionText) {
    fragments.push(projectionText);
  }

  if (cutawayProjectionText) {
    fragments.push(cutawayProjectionText);
  }

  if (manifestSaved) {
    fragments.push("capture details saved");
  }

  if (annotationAdded) {
    fragments.push("capture note added");
  }

  if (annotationRegionApplied) {
    fragments.push("callout region marked");
  }

  return `${fragments.join(", ")}.`;
}

function formatManualProjectionStats(stats) {
  const normalized = buildManualProjectionStats(stats || {});
  const parts = [];

  if (!normalized.storedCount) {
    return "";
  }

  if (normalized.projectedCount) {
    parts.push(`${normalized.projectedCount} projected`);
  }

  if (normalized.directCount) {
    parts.push(`${normalized.directCount} direct`);
  }

  if (normalized.skippedCount) {
    parts.push(`${normalized.skippedCount} skipped`);
  }

  return parts.length ? `manual projection ${parts.join(", ")}` : "";
}

function formatCutawayResolutionStats(stats) {
  const normalized = buildCutawayResolutionStats(stats || {});
  const parts = [];

  if (!normalized.storedCount) {
    return "";
  }

  if (normalized.projectedCount) {
    parts.push(`${normalized.projectedCount} projected`);
  }

  if (normalized.directCount) {
    parts.push(`${normalized.directCount} direct`);
  }

  if (normalized.skippedCount) {
    parts.push(`${normalized.skippedCount} skipped`);
  }

  return parts.length ? `cutaway ${parts.join(", ")}` : "";
}

function buildVariantProgressDetail(variant, stage) {
  if (stage === "prepare" && variant.mode === "desktop") {
    return "Injecting the Lumen page agent into the active tab and normalizing the document.";
  }

  if (stage === "prepare") {
    return `Opening a temporary ${variant.label.toLowerCase()} viewport, then normalizing the page for capture.`;
  }

  return `${variant.label} capture in progress.`;
}

function normalizeCaptureError(error) {
  if (error?.title && error?.description) {
    return error;
  }

  const message = error?.message || String(error);

  if (/cannot access contents of url/i.test(message) || /cannot be scripted/i.test(message)) {
    return createFriendlyError(
      "Site Access Blocked",
      "Chrome refused script access for this page. Try a normal http or https page instead."
    );
  }

  if (/canvas/i.test(message) || /dimensions/i.test(message)) {
    return createFriendlyError(
      "Page Too Large To Stitch",
      "The final bitmap exceeded safe browser canvas limits. Lumen already falls back to tiled exports for large pages, but this page still needs a lower-scale or alternate export path."
    );
  }

  return createFriendlyError("Capture Failed", message);
}

function broadcastProgress(payload) {
  chrome.runtime.sendMessage({
    type: CAPTURE_PROGRESS_EVENT,
    payload
  }).catch(() => {});
}

function broadcastSession(session) {
  chrome.runtime.sendMessage({
    type: SESSION_UPDATE_EVENT,
    payload: session
  }).catch(() => {});
}

function broadcastHistory(captureHistory) {
  chrome.runtime.sendMessage({
    type: HISTORY_UPDATE_EVENT,
    payload: captureHistory
  }).catch(() => {});
}

function broadcastManualRedactions(record) {
  chrome.runtime.sendMessage({
    type: MANUAL_REDACTIONS_UPDATE_EVENT,
    payload: record
  }).catch(() => {});
}

function broadcastCutawayRegion(record) {
  chrome.runtime.sendMessage({
    type: CUTAWAY_REGION_UPDATE_EVENT,
    payload: record
  }).catch(() => {});
}

function broadcastAnnotationRegion(record) {
  chrome.runtime.sendMessage({
    type: ANNOTATION_REGION_UPDATE_EVENT,
    payload: record
  }).catch(() => {});
}

function broadcastWatchPlans(watchPlans) {
  chrome.runtime.sendMessage({
    type: WATCH_PLAN_UPDATE_EVENT,
    payload: watchPlans
  }).catch(() => {});
}

function broadcastWatchRuns(watchRuns) {
  chrome.runtime.sendMessage({
    type: WATCH_RUN_UPDATE_EVENT,
    payload: watchRuns
  }).catch(() => {});
}

function broadcastLibraryUpdated(payload = {}) {
  chrome.runtime.sendMessage({
    type: LIBRARY_UPDATE_EVENT,
    payload
  }).catch(() => {});
}

async function broadcastWatchState(watchRuns) {
  broadcastWatchRuns(watchRuns);
  const localState = await readLocalState();
  broadcastWatchPlans(localState.watchPlans || []);
}

async function restoreWatchAlarms() {
  if (!chrome.alarms?.create) {
    return;
  }

  if (shouldPauseAutomaticCapture(await readAppSettings())) {
    await clearWatchAlarms();
    return;
  }

  const localState = await readLocalState();
  const plans = Array.isArray(localState.watchPlans) ? localState.watchPlans : [];

  for (const plan of plans) {
    await registerWatchPlanAlarm(plan);
  }
}

async function clearWatchAlarms() {
  if (!chrome.alarms?.getAll || !chrome.alarms?.clear) {
    return 0;
  }

  const alarms = await chrome.alarms.getAll();
  const watchAlarms = alarms.filter((alarm) => alarm?.name?.startsWith(WATCH_ALARM_PREFIX));
  const cleared = await Promise.all(watchAlarms.map((alarm) => chrome.alarms.clear(alarm.name)));
  return cleared.filter(Boolean).length;
}

async function syncWatchAlarmsForPrivacyShield() {
  const appSettings = await readAppSettings();

  if (shouldPauseAutomaticCapture(appSettings)) {
    return {
      paused: true,
      cleared: await clearWatchAlarms()
    };
  }

  await restoreWatchAlarms();
  return { paused: false, cleared: 0 };
}

async function registerWatchPlanAlarm(plan = {}) {
  if (!chrome.alarms?.create || !plan?.id) {
    return;
  }

  const alarmName = `${WATCH_ALARM_PREFIX}${plan.id}`;
  await chrome.alarms.clear(alarmName);

  const lifecycle = evaluateWatchScheduleState(plan);

  if (!lifecycle.active) {
    return;
  }

  await chrome.alarms.create(alarmName, buildWatchAlarmDefinition(plan));
}

async function handleWatchAlarm(alarm) {
  const planId = alarm.name.slice(WATCH_ALARM_PREFIX.length);
  const localState = await readLocalState();
  const plan = (localState.watchPlans || []).find((entry) => entry.id === planId);
  const lifecycle = plan ? evaluateWatchScheduleState(plan) : { active: false, reason: "missing" };

  if (!plan || !lifecycle.active) {
    await chrome.alarms.clear(alarm.name);

    if (plan?.status === "active" && ["expired", "max-runs"].includes(lifecycle.reason)) {
      const result = await updateRemoteWatchPlan(plan.id, { status: "completed" });
      const state = await readLocalState();
      broadcastWatchPlans(state.watchPlans || (result.watchPlan ? [result.watchPlan] : []));
    }

    return;
  }

  if (shouldPauseAutomaticCapture(await readAppSettings())) {
    const skippedAt = new Date().toISOString();
    const watchRuns = await persistWatchRunRecord({
      id: `watch-run-${createLocalId()}`,
      watchPlanId: plan.id,
      title: plan.title,
      url: plan.url,
      status: "skipped",
      scheduledAt: skippedAt,
      completedAt: skippedAt,
      error: "Privacy Shield paused this unattended capture because every saved image requires review."
    });
    await chrome.alarms.clear(alarm.name);
    await broadcastWatchState(watchRuns);
    return;
  }

  const scheduledAt = new Date().toISOString();
  const runId = `watch-run-${createLocalId()}`;

  if (captureInFlight || analyzeInFlight) {
    const watchRuns = await persistWatchRunRecord({
      id: runId,
      watchPlanId: plan.id,
      title: plan.title,
      url: plan.url,
      status: "skipped",
      scheduledAt,
      completedAt: scheduledAt,
      error: "Another Lumen run was active."
    });
    await broadcastWatchState(watchRuns);

    if (normalizeWatchSchedule(plan.schedule).mode === "once") {
      await chrome.alarms.create(alarm.name, {
        when: Date.now() + 30000
      });
    }

    return;
  }

  captureInFlight = true;
  let sourceWindowId = null;

  try {
    let watchRuns = await persistWatchRunRecord({
      id: runId,
      watchPlanId: plan.id,
      title: plan.title,
      url: plan.url,
      status: "running",
      scheduledAt,
      startedAt: new Date().toISOString()
    });
    await broadcastWatchState(watchRuns);

    const source = await createWatchSource(plan);
    sourceWindowId = source.windowId;
    const result = await runCaptureFlow({
      ...getDefaultSettings(),
      devicePreset: "desktop",
      exportPreset: "raw",
      exportManifest: false,
      autoRedact: true,
      longPageMode: "tiles"
    }, {
      sourceTab: source.tab,
      cutawayRegionOverride: buildWatchCutawayRecord(plan),
      focusedOnly: true,
      captureOrigin: "timed",
      watchPlanId: plan.id,
      watchRunId: runId,
      changeBaselineHash: plan.lastVisualHash || "",
      saveOnlyWhenChanged: Boolean(plan.schedule?.saveOnlyWhenChanged)
    });

    if (!result.cutawayCount || (!result.unchanged && !result.files?.length)) {
      throw createFriendlyError(
        "Selected Area Was Not Found",
        "Lumen stopped this timed run because the saved area could not be resolved safely on the current page."
      );
    }

    await updateRemoteWatchPlan(plan.id, {
      lastVisualHash: result.visualHash || plan.lastVisualHash || "",
      lastChangePercent: result.changePercent ?? 100
    });

    watchRuns = await persistWatchRunRecord({
      id: runId,
      watchPlanId: plan.id,
      captureId: result.captureId || "",
      title: plan.title,
      url: plan.url,
      status: result.unchanged ? "unchanged" : "captured",
      scheduledAt,
      startedAt: scheduledAt,
      completedAt: new Date().toISOString(),
      fileCount: result.files?.length || 0,
      files: result.files || [],
      visualHash: result.visualHash || "",
      changePercent: result.changePercent ?? 100
    });
    await broadcastWatchState(watchRuns);
  } catch (error) {
    const watchRuns = await persistWatchRunRecord({
      id: runId,
      watchPlanId: plan.id,
      title: plan.title,
      url: plan.url,
      status: "failed",
      scheduledAt,
      completedAt: new Date().toISOString(),
      error: error?.description || error?.message || "Timed capture failed."
    });
    await broadcastWatchState(watchRuns);
  } finally {
    captureInFlight = false;
    await closeWindowSafely(sourceWindowId);
    await completeWatchPlanIfNeeded(plan.id);
  }
}

async function completeWatchPlanIfNeeded(planId = "") {
  const localState = await readLocalState();
  const currentPlan = (localState.watchPlans || []).find((entry) => entry.id === planId);

  if (!currentPlan) {
    return;
  }

  const lifecycle = evaluateWatchScheduleState(currentPlan);

  if (currentPlan.status === "active" && ["expired", "max-runs"].includes(lifecycle.reason)) {
    const result = await updateRemoteWatchPlan(currentPlan.id, {
      status: "completed"
    });
    await registerWatchPlanAlarm(result.watchPlan || currentPlan);
    const state = await readLocalState();
    broadcastWatchPlans(state.watchPlans || []);
  }
}

async function createWatchSource(plan = {}) {
  if (!plan.url) {
    throw createFriendlyError("Timed Capture Missing URL", "The saved timed capture does not include a capturable URL.");
  }

  const origin = buildOriginPattern(plan.url);
  const hasPermission = await chrome.permissions.contains({
    origins: [origin]
  });

  if (!hasPermission) {
    throw createFriendlyError(
      "Timed Capture Needs Site Access",
      "Open Lumen on that page and save the timed capture again so Chrome can grant site access."
    );
  }

  const width = Math.max(320, Math.round(Number(plan.region?.sourceViewport?.viewportWidth) || 1280));
  const height = Math.max(240, Math.round(Number(plan.region?.sourceViewport?.viewportHeight) || 900));
  const createdWindow = await chrome.windows.create({
    url: plan.url,
    type: "popup",
    width,
    height,
    focused: false
  });
  const tab = createdWindow.tabs?.[0] || (await chrome.tabs.query({
    windowId: createdWindow.id,
    active: true
  }))[0];

  if (!tab?.id) {
    throw createFriendlyError("Timed Capture Failed", "Chrome could not open the saved page for timed capture.");
  }

  const readyTab = await waitForTabComplete(tab.id);
  const captureTab = {
    ...readyTab,
    url: readyTab.url || readyTab.pendingUrl || plan.url,
    title: readyTab.title || plan.title || plan.host || "Timed capture"
  };
  await sleep(260);
  await ensureContentScript(captureTab.id);
  await calibrateCaptureViewport({
    kind: "viewport",
    tab: captureTab,
    windowId: createdWindow.id
  }, {
    viewport: {
      width,
      height
    }
  });

  return {
    tab: captureTab,
    windowId: createdWindow.id
  };
}

function buildWatchCutawayRecord(plan = {}) {
  const region = plan.region || null;

  return {
    url: plan.url || "",
    host: plan.host || "",
    updatedAt: plan.updatedAt || "",
    context: null,
    region,
    regions: region ? [region] : []
  };
}

async function closeWindowSafely(windowId) {
  try {
    if (typeof windowId === "number") {
      await chrome.windows.remove(windowId);
    }
  } catch (error) {
    console.debug("Lumen window close skipped:", error);
  }
}

async function waitForCaptureWindow(previousCaptureTimestamp) {
  const now = Date.now();
  const elapsed = now - previousCaptureTimestamp;
  const remaining = LUMEN_CONFIG.capture.captureThrottleMs - elapsed;

  if (previousCaptureTimestamp && remaining > 0) {
    await sleep(remaining);
  }

  return Date.now();
}

async function downloadRenderedOutputs(outputs, { folder, fileBaseName, variantId, exportPreset }) {
  const downloadRecords = [];

  for (const output of outputs) {
    const role = output.role || "full-page";
    const rawPartIndex = output.partIndex ?? (Number.isFinite(output.index) ? output.index + 1 : 1);
    const partIndex = Math.max(1, clampNonNegativeInteger(rawPartIndex));
    const partTotal = Math.max(1, clampNonNegativeInteger(output.partTotal ?? output.total ?? 1));
    const suffix = role === "cutaway" ? "-cutaway" : buildPartFilenameSuffix(partIndex, partTotal);
    const filename = `${folder}/${fileBaseName}${suffix}.png`;

    const downloadId = await chrome.downloads.download({
      url: output.dataUrl,
      filename,
      conflictAction: "uniquify",
      saveAs: false
    });
    const downloadItem = await waitForDownloadComplete(downloadId);

    downloadRecords.push({
      downloadId,
      filename,
      bytesReceived: downloadItem.bytesReceived || 0,
      complete: (downloadItem.bytesReceived || 0) > 0,
      kind: "image",
      role,
      variantId,
      exportPreset,
      partIndex,
      partTotal,
      width: output.width || 0,
      height: output.height || 0,
      cutawayRegion: output.cutawayRegion || null
    });
  }

  return downloadRecords;
}

async function downloadPrintSheet(outputs, { folder, fileBaseName, variantId, exportPreset, page }) {
  const fullPageOutputs = (outputs || []).filter((output) => (output.role || "full-page") === "full-page");
  const filename = `${folder}/${fileBaseName}-print-sheet.html`;
  const html = buildPrintSheetHtml(fullPageOutputs, page);
  const downloadId = await chrome.downloads.download({
    url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    filename,
    conflictAction: "uniquify",
    saveAs: false
  });
  const downloadItem = await waitForDownloadComplete(downloadId);

  return {
    downloadId,
    filename,
    bytesReceived: downloadItem.bytesReceived || 0,
    complete: (downloadItem.bytesReceived || 0) > 0,
    kind: "html",
    role: "print-sheet",
    variantId,
    exportPreset,
    partIndex: 1,
    partTotal: 1,
    width: page?.viewportWidth || 0,
    height: page?.pageHeight || 0,
    cutawayRegion: null
  };
}

function buildPrintSheetHtml(outputs = [], page = {}) {
  const title = escapeHtml(page.title || "Lumen capture");
  const source = escapeHtml(page.url || "");
  const outputMarkup = outputs.map((output, index) => `
    <figure>
      <figcaption>Part ${index + 1} of ${outputs.length}</figcaption>
      <img src="${output.dataUrl}" alt="${title} part ${index + 1}" />
    </figure>
  `).join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title} | Lumen print sheet</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; background: #f6f7f8; color: #101418; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      header { padding: 18px 24px; border-bottom: 1px solid #d8dde3; background: white; }
      h1 { margin: 0 0 4px; font-size: 18px; }
      p { margin: 0; color: #5b6470; }
      main { display: grid; gap: 18px; padding: 18px; }
      figure { margin: 0 auto; width: min(100%, 1200px); padding: 14px; background: white; border: 1px solid #d8dde3; page-break-after: always; }
      figcaption { margin-bottom: 10px; color: #5b6470; font-weight: 700; }
      img { display: block; width: 100%; height: auto; }
      @media print {
        body { background: white; }
        header { position: static; }
        main { padding: 0; gap: 0; }
        figure { width: 100%; border: 0; padding: 0; }
        figcaption { padding: 8px 0; }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${title}</h1>
      <p>${source}</p>
    </header>
    <main>${outputMarkup || "<p>No image parts were exported.</p>"}</main>
  </body>
</html>`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildPartFilenameSuffix(partIndex, partTotal) {
  if (partTotal <= 1) {
    return "";
  }

  return `-part-${String(partIndex).padStart(2, "0")}-of-${String(partTotal).padStart(2, "0")}`;
}

async function downloadBundleManifest({ folder, fileBaseName, manifest }) {
  const filename = `${folder}/${fileBaseName}.json`;
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(
    `${JSON.stringify(manifest, null, 2)}\n`
  )}`;

  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename,
    conflictAction: "uniquify",
    saveAs: false
  });
  const downloadItem = await waitForDownloadComplete(downloadId);

  return {
    downloadId,
    filename,
    bytesReceived: downloadItem.bytesReceived || 0,
    complete: (downloadItem.bytesReceived || 0) > 0,
    kind: "manifest"
  };
}

function buildCaptureBundleManifest({
  page,
  capturedAt,
  archiveFolder,
  options,
  annotation,
  annotationRegion,
  exportPreset,
  variants,
  redactionCount,
  manualRedactionCount,
  cutawayCount,
  manualProjectionStats,
  cutawayResolutionStats,
  annotationResolutionStats,
  redactionBreakdown,
  segmentCount,
  tileCount,
  captureHealth,
  blueprint
}) {
  const variantOutputs = variants.map((variant) => buildPortableOutputRecords(variant.downloads));
  const artifactStats = buildArtifactStats(variantOutputs.flat());

  return {
    schemaVersion: 1,
    generator: "Lumen",
    capturedAt,
    page: {
      title: page.title || "",
      url: sanitizeCaptureUrl(page.url),
      host: new URL(page.url).host
    },
    capture: {
      archiveFolder,
      devicePreset: options.devicePreset || "desktop",
      exportPreset,
      longPageMode: options.longPageMode || "auto",
      removeStickyHeaders: options.removeStickyHeaders !== false,
      forceLazyLoad: options.forceLazyLoad !== false,
      autoRedact: Boolean(options.autoRedact),
      variantCount: variants.length,
      segmentCount,
      tileCount,
      health: captureHealth,
      redactionCount,
      manualRedactionCount,
      cutawayCount,
      manualProjectionStats,
      cutawayResolutionStats,
      annotationResolutionStats,
      redactionBreakdown,
      artifactStats,
      annotation,
      annotationRegion
    },
    variants: variants.map((variant, index) => {
      const outputs = variantOutputs[index] || [];

      return {
        id: variant.id,
        label: variant.label,
        exportPreset: variant.exportPreset,
        fileCount: variant.files.length,
        files: variant.files,
        outputs,
        artifactStats: buildArtifactStats(outputs),
        tileCount: variant.tileCount,
        redactionCount: variant.redactionCount,
        manualRedactionCount: variant.manualRedactionCount || 0,
        cutawayCount: variant.cutawayCount || 0,
        manualProjectionStats: variant.manualProjectionStats || buildManualProjectionStats(),
        cutawayResolutionStats: variant.cutawayResolutionStats || buildCutawayResolutionStats(),
        annotationResolutionStats: variant.annotationResolutionStats || buildCutawayResolutionStats(),
        redactionBreakdown: variant.redactionBreakdown || buildRedactionBreakdown([]),
        health: variant.captureHealth || null,
        viewport: variant.viewport || null,
        dimensions: variant.dimensions
      };
    }),
    pageSignals: blueprint
      ? {
          siteType: blueprint.identity?.siteType || "",
          heroHeadline: blueprint.identity?.heroHeadline || "",
          primaryCta: blueprint.identity?.primaryCta || "",
          navLabels: blueprint.identity?.navLabels || [],
          colors: blueprint.colors || [],
          typography: blueprint.typography?.families || []
        }
      : null
  };
}

function buildAggregateCaptureHealth(healthRecords = []) {
  const records = healthRecords.filter((health) => health && typeof health === "object");

  if (!records.length) {
    return null;
  }

  const expectedPixels = records.reduce((sum, health) => sum + Math.max(0, Number(health.expectedHeight) || 0), 0);
  const coveredPixels = records.reduce((sum, health) => sum + Math.max(0, Number(health.coveredPixels) || 0), 0);
  const coveragePercent = expectedPixels > 0
    ? Number((coveredPixels / expectedPixels * 100).toFixed(2))
    : Math.min(...records.map((health) => Number(health.coveragePercent) || 0));
  const status = records.some((health) => health.status === "incomplete")
    ? "incomplete"
    : records.some((health) => health.status === "partial")
      ? "partial"
      : records.every((health) => health.status === "complete")
        ? "complete"
        : "unknown";

  return {
    status,
    coveragePercent,
    verifiedVariantCount: records.filter((health) => health.status === "complete").length,
    variantCount: records.length,
    reachedTail: records.every((health) => health.reachedTail !== false),
    seamGapCount: records.reduce((sum, health) => sum + Math.max(0, Number(health.seamGapCount) || 0), 0),
    widthMismatchCount: records.reduce((sum, health) => sum + Math.max(0, Number(health.widthMismatchCount) || 0), 0),
    expectedPixels,
    coveredPixels
  };
}

function buildPortableOutputRecords(downloads = []) {
  return downloads.map((download) => ({
    filename: download.filename,
    kind: download.kind || "image",
    bytesReceived: Math.max(0, Math.round(download.bytesReceived || 0)),
    complete: Number(download.bytesReceived || 0) > 0,
    variantId: download.variantId || "",
    exportPreset: download.exportPreset || "",
    role: download.role || "full-page",
    partIndex: download.partIndex || 1,
    partTotal: download.partTotal || 1,
    width: Math.max(0, Math.round(download.width || 0)),
    height: Math.max(0, Math.round(download.height || 0)),
    cutawayRegion: download.cutawayRegion || null
  }));
}

function buildArtifactStats(outputs = []) {
  const bytesReceived = outputs.reduce((sum, output) => sum + Math.max(0, output.bytesReceived || 0), 0);
  const imageCount = outputs.filter((output) => output.kind === "image").length;
  const htmlCount = outputs.filter((output) => output.kind === "html").length;

  return {
    outputCount: outputs.length,
    imageCount,
    htmlCount,
    cutawayCount: outputs.filter((output) => output.role === "cutaway").length,
    printSheetCount: outputs.filter((output) => output.role === "print-sheet").length,
    bytesReceived,
    complete: outputs.length > 0 && outputs.every((output) => output.complete),
    tiled: outputs.some((output) => (output.partTotal || 1) > 1)
  };
}

async function getLatestBlueprint() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.latestBlueprint);
  return stored[STORAGE_KEYS.latestBlueprint] || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
