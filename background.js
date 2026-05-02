import {
  LUMEN_CONFIG,
  STORAGE_KEYS,
  getDefaultSettings,
  getCaptureVariants,
  isRestrictedCaptureUrl,
  normalizeCaptureNoteOptions
} from "./config.js";
import {
  bootstrapAppState,
  clearSession,
  persistCaptureRecord,
  readLocalState,
  startDemoSession
} from "./lumen-backend.js";

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const OFFSCREEN_REASON = "BLOBS";
const CAPTURE_PROGRESS_EVENT = "LUMEN_CAPTURE_PROGRESS";
const BLUEPRINT_UPDATE_EVENT = "LUMEN_BLUEPRINT_UPDATED";
const SESSION_UPDATE_EVENT = "LUMEN_SESSION_UPDATED";
const HISTORY_UPDATE_EVENT = "LUMEN_HISTORY_UPDATED";
const MANUAL_REDACTIONS_UPDATE_EVENT = "LUMEN_MANUAL_REDACTIONS_UPDATED";

let captureInFlight = false;
let analyzeInFlight = false;
let offscreenCreationPromise = null;

chrome.runtime.onInstalled.addListener(async () => {
  const [syncState, localState] = await Promise.all([
    chrome.storage.sync.get(STORAGE_KEYS.settings),
    chrome.storage.local.get([STORAGE_KEYS.session, STORAGE_KEYS.captureHistory])
  ]);

  if (!syncState[STORAGE_KEYS.settings]) {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.settings]: getDefaultSettings()
    });
  }

  if (!localState[STORAGE_KEYS.session] || !Array.isArray(localState[STORAGE_KEYS.captureHistory])) {
    const snapshot = await readLocalState();
    const localPatch = {};

    if (!localState[STORAGE_KEYS.session]) {
      localPatch[STORAGE_KEYS.session] = snapshot.session;
    }

    if (!Array.isArray(localState[STORAGE_KEYS.captureHistory])) {
      localPatch[STORAGE_KEYS.captureHistory] = snapshot.captureHistory;
    }

    await chrome.storage.local.set(localPatch);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "LUMEN_BOOTSTRAP_APP") {
    bootstrapAppState()
      .then((result) => sendResponse({ ok: true, ...result }))
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

    runCaptureFlow(message.payload?.options)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: normalizeCaptureError(error) }))
      .finally(() => {
        captureInFlight = false;
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

  if (message?.type === "LUMEN_MANUAL_REDACTIONS_UPDATED") {
    persistManualRedactionsFromContent(sender.tab, message.payload)
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
          captureHistory: localState.captureHistory
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

});

async function runCaptureFlow(options = getDefaultSettings()) {
  const captureNote = normalizeCaptureNoteOptions(options);
  const sourceTab = await getCurrentTab();
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
  const manualRedactions = await getManualRedactionsForTab(sourceTab);
  const runContext = buildCaptureRunContext({
    title: sourceTab.title,
    url: sourceTab.url,
    capturedAt
  });
  const results = [];
  let blueprint = null;

  for (let index = 0; index < variants.length; index += 1) {
    const result = await captureVariant({
      sourceTab,
      variant: variants[index],
      options,
      manualRedactions,
      runContext,
      extractBlueprint: index === 0
    });

    results.push(result);
    blueprint ||= result.blueprint;
  }

  const firstResult = results[0];
  const segmentCount = results.reduce((sum, result) => sum + result.segmentCount, 0);
  const tileCount = results.reduce((sum, result) => sum + result.tileCount, 0);
  const redactionCount = results.reduce((sum, result) => sum + result.redactionCount, 0);
  const manualRedactionCount = results.reduce((sum, result) => sum + result.manualRedactionCount, 0);
  const redactionBreakdown = mergeRedactionBreakdowns(results.map((result) => result.redactionBreakdown));
  const manualProjectionStats = mergeManualProjectionStats(results.map((result) => result.manualProjectionStats));
  const variantSummaries = results.map((result) => ({
    id: result.variant.id,
    label: result.variant.label,
    files: result.downloadedFiles,
    downloads: result.downloadRecords,
    exportPreset: result.exportPreset,
    tileCount: result.tileCount,
    redactionCount: result.redactionCount,
    manualRedactionCount: result.manualRedactionCount,
    manualProjectionStats: result.manualProjectionStats,
    redactionBreakdown: result.redactionBreakdown,
    dimensions: result.dimensions
  }));

  if (!blueprint) {
    blueprint = await getLatestBlueprint();
  }

  const bundleManifest = buildCaptureBundleManifest({
    page: firstResult.page,
    capturedAt,
    archiveFolder: runContext.folder,
    options,
    annotation: captureNote.enabled && captureNote.text ? captureNote : null,
    exportPreset: firstResult.exportPreset,
    variants: variantSummaries,
    redactionCount,
    manualRedactionCount,
    manualProjectionStats,
    redactionBreakdown,
    segmentCount,
    tileCount,
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
    url: firstResult.page.url,
    devicePreset: options.devicePreset,
    exportPreset: firstResult.exportPreset,
    capturedAt,
    archiveFolder: runContext.folder,
    files: downloadedFiles,
    downloads: downloadedRecords,
    tileCount,
    redactionCount,
    manualRedactionCount,
    manualProjectionStats,
    redactionBreakdown,
    manifestFile,
    annotation: captureNote.enabled && captureNote.text ? captureNote : null,
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

  broadcastHistory(captureHistory);

  // Future SaaS hook:
  // POST metadata, page metrics, and the final asset reference to
  // `${LUMEN_CONFIG.api.baseUrl}${LUMEN_CONFIG.api.endpoints.captures}`
  // once auth and cloud persistence are wired in.

  broadcastProgress({
    stage: "done",
    title: variants.length > 1 ? "Responsive set ready" : "Capture ready",
    detail: buildCaptureCompletionDetail({
      segmentCount,
      fileCount: downloadedFiles.length,
      redactionCount,
      manualRedactionCount,
      manualProjectionStats,
      variantCount: variants.length,
      manifestSaved: Boolean(manifestFile),
      annotationAdded: Boolean(captureNote.enabled && captureNote.text)
    }),
    progress: 1
  });

  return {
    fileName: downloadedFiles[0] || "",
    files: downloadedFiles,
    downloads: downloadedRecords,
    archiveFolder: runContext.folder,
    segmentCount,
    exportPreset: firstResult.exportPreset,
    tileCount,
    redactionCount,
    manualRedactionCount,
    manualProjectionStats,
    manifestFile,
    annotation: captureNote.enabled && captureNote.text ? captureNote : null,
    variantCount: variants.length,
    dimensions: firstResult.dimensions
  };
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

async function captureVariant({ sourceTab, variant, options, manualRedactions, runContext, extractBlueprint }) {
  const target = await createCaptureTarget(sourceTab, variant);

  try {
    broadcastProgress({
      stage: "prepare",
      title: `Preparing ${variant.label} capture`,
      detail: buildVariantProgressDetail(variant, "prepare")
    });

    await ensureContentScript(target.tab.id);

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
      broadcastProgress({
        stage: "sanitize",
        title: `Scanning ${variant.label.toLowerCase()} view`,
        detail: `Looking for emails, phone numbers, tokens, and filled fields in the ${variant.label.toLowerCase()} layout.`
      });

      redactionScan = await requestRedactionScan(target.tab.id);
    }

    const manualResolution = await resolveManualRedactionsForTarget(target.tab.id, manualRedactions, page);
    const manualRegions = manualResolution.regions;
    const combinedRedactions = [
      ...redactionScan.regions,
      ...manualRegions
    ];

    if (extractBlueprint) {
      blueprint = await maybeExtractBlueprint(target.tab.id);
    }

    await initializeStitchSession({
      sessionId,
      page,
      options: {
        ...options,
        devicePreset: variant.id
      },
      redactions: combinedRedactions
    });

    const segmentCount = await capturePageSegments(target, page, sessionId, variant);

    broadcastProgress({
      stage: "stitch",
      title: `Compositing ${variant.label.toLowerCase()} output`,
      detail: `Drawing ${segmentCount} ${variant.label.toLowerCase()} slice${segmentCount === 1 ? "" : "s"} into the offscreen studio.`
    });

    const stitched = await finalizeStitchSession(sessionId);
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

    const downloadRecords = await downloadRenderedOutputs(stitched.outputs, {
      folder: runContext.folder,
      fileBaseName,
      variantId: variant.id,
      exportPreset: stitched.appliedPreset
    });
    const downloadedFiles = downloadRecords.map((record) => record.filename);

    return {
      variant,
      page,
      blueprint,
      downloadedFiles,
      downloadRecords,
      segmentCount,
      tileCount: stitched.outputs.length,
      redactionCount: stitched.redactionCount,
      manualRedactionCount: manualRegions.length,
      manualProjectionStats: manualResolution.stats,
      redactionBreakdown: buildRedactionBreakdown(combinedRedactions),
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

async function capturePageSegments(target, page, sessionId, variant) {
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
        throw createFriendlyError(
          "Capture Stalled",
          "The page stopped moving before the full document could be captured. This usually points to a complex app shell, virtualized feed, or runtime layout that needs a site-specific fallback."
        );
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
    lastCaptureTimestamp = await waitForCaptureWindow(lastCaptureTimestamp);

    const dataUrl = await chrome.tabs.captureVisibleTab(target.windowId, {
      format: "png"
    });

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
  await chrome.storage.local.set({
    [STORAGE_KEYS.latestBlueprint]: blueprint
  });

  chrome.runtime.sendMessage({
    type: BLUEPRINT_UPDATE_EVENT,
    payload: blueprint
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
  const initial = await chrome.tabs.get(tabId);

  if (initial.status === "complete") {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      reject(
        createFriendlyError(
          "Page Load Timed Out",
          "The temporary capture window took too long to finish rendering."
        )
      );
    }, timeoutMs);

    function handleUpdated(updatedTabId, info) {
      if (updatedTabId !== tabId || info.status !== "complete") {
        return;
      }

      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(handleUpdated);
  });
}

function buildCaptureFileBaseName({ title, url, devicePreset, exportPreset }) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const safeTitle = sanitizeSegment(title || host).slice(0, 48);

  return `${safeTitle || "capture"}-${devicePreset}-${exportPreset}`;
}

function buildManifestFileBaseName(page, options, exportPreset) {
  const host = new URL(page.url).hostname.replace(/^www\./, "");
  const safeTitle = sanitizeSegment(page.title || host).slice(0, 48);

  return `${safeTitle || "capture"}-bundle-${options.devicePreset || "desktop"}-${exportPreset}`;
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
  manualProjectionStats,
  variantCount,
  manifestSaved,
  annotationAdded
}) {
  const sliceText = `${segmentCount} slice${segmentCount === 1 ? "" : "s"} stitched`;
  const fileText = `${fileCount} file${fileCount === 1 ? "" : "s"} saved`;
  const variantText = variantCount > 1 ? `${variantCount} responsive views captured` : "";
  const projectionText = formatManualProjectionStats(manualProjectionStats);

  if (!redactionCount && !variantText && !projectionText && !manifestSaved && !annotationAdded) {
    return `${sliceText} and ${fileText} successfully.`;
  }

  const fragments = [sliceText, fileText];

  if (variantText) {
    fragments.push(variantText);
  }

  if (redactionCount) {
    fragments.push(`${redactionCount} redaction region${redactionCount === 1 ? "" : "s"} sanitized`);
  }

  if (manualRedactionCount) {
    fragments.push(`${manualRedactionCount} manual box${manualRedactionCount === 1 ? "" : "es"} applied`);
  }

  if (projectionText) {
    fragments.push(projectionText);
  }

  if (manifestSaved) {
    fragments.push("bundle manifest saved");
  }

  if (annotationAdded) {
    fragments.push("capture note added");
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
    const suffix =
      outputs.length > 1
        ? `-part-${String(output.index + 1).padStart(2, "0")}-of-${String(output.total).padStart(2, "0")}`
        : "";
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
      kind: "image",
      variantId,
      exportPreset,
      partIndex: output.index + 1,
      partTotal: output.total
    });
  }

  return downloadRecords;
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
    kind: "manifest"
  };
}

function buildCaptureBundleManifest({
  page,
  capturedAt,
  archiveFolder,
  options,
  annotation,
  exportPreset,
  variants,
  redactionCount,
  manualRedactionCount,
  manualProjectionStats,
  redactionBreakdown,
  segmentCount,
  tileCount,
  blueprint
}) {
  return {
    schemaVersion: 1,
    generator: "Lumen prototype",
    capturedAt,
    page: {
      title: page.title || "",
      url: page.url,
      host: new URL(page.url).host
    },
    capture: {
      archiveFolder,
      devicePreset: options.devicePreset || "desktop",
      exportPreset,
      removeStickyHeaders: options.removeStickyHeaders !== false,
      forceLazyLoad: options.forceLazyLoad !== false,
      autoRedact: Boolean(options.autoRedact),
      variantCount: variants.length,
      segmentCount,
      tileCount,
      redactionCount,
      manualRedactionCount,
      manualProjectionStats,
      redactionBreakdown,
      annotation
    },
    variants: variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      exportPreset: variant.exportPreset,
      fileCount: variant.files.length,
      files: variant.files,
      tileCount: variant.tileCount,
      redactionCount: variant.redactionCount,
      manualRedactionCount: variant.manualRedactionCount || 0,
      manualProjectionStats: variant.manualProjectionStats || buildManualProjectionStats(),
      redactionBreakdown: variant.redactionBreakdown || buildRedactionBreakdown([]),
      dimensions: variant.dimensions
    })),
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

async function getLatestBlueprint() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.latestBlueprint);
  return stored[STORAGE_KEYS.latestBlueprint] || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
