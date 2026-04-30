import {
  LUMEN_CONFIG,
  STORAGE_KEYS,
  getDefaultSettings,
  getCaptureVariants,
  isRestrictedCaptureUrl
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
  const sourceTab = await getCurrentTab();

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
  const results = [];
  let blueprint = null;

  for (let index = 0; index < variants.length; index += 1) {
    const result = await captureVariant({
      sourceTab,
      variant: variants[index],
      options,
      extractBlueprint: index === 0
    });

    results.push(result);
    blueprint ||= result.blueprint;
  }

  const firstResult = results[0];
  const segmentCount = results.reduce((sum, result) => sum + result.segmentCount, 0);
  const tileCount = results.reduce((sum, result) => sum + result.tileCount, 0);
  const redactionCount = results.reduce((sum, result) => sum + result.redactionCount, 0);
  const variantSummaries = results.map((result) => ({
    id: result.variant.id,
    label: result.variant.label,
    files: result.downloadedFiles,
    exportPreset: result.exportPreset,
    tileCount: result.tileCount,
    redactionCount: result.redactionCount,
    dimensions: result.dimensions
  }));

  if (!blueprint) {
    blueprint = await getLatestBlueprint();
  }

  const bundleManifest = buildCaptureBundleManifest({
    page: firstResult.page,
    capturedAt: new Date().toISOString(),
    options,
    exportPreset: firstResult.exportPreset,
    variants: variantSummaries,
    redactionCount,
    segmentCount,
    tileCount,
    blueprint
  });

  let manifestFile = "";

  if (options.exportManifest !== false) {
    manifestFile = await downloadBundleManifest({
      fileBaseName: buildManifestFileBaseName(firstResult.page, options, firstResult.exportPreset),
      manifest: bundleManifest
    });
  }

  const downloadedFiles = [
    ...results.flatMap((result) => result.downloadedFiles),
    ...(manifestFile ? [manifestFile] : [])
  ];

  const captureHistory = await persistCaptureRecord({
    id: crypto.randomUUID(),
    title: firstResult.page.title,
    host: new URL(firstResult.page.url).host,
    url: firstResult.page.url,
    devicePreset: options.devicePreset,
    exportPreset: firstResult.exportPreset,
    capturedAt: new Date().toISOString(),
    files: downloadedFiles,
    tileCount,
    redactionCount,
    manifestFile,
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
      variantCount: variants.length,
      manifestSaved: Boolean(manifestFile)
    }),
    progress: 1
  });

  return {
    fileName: downloadedFiles[0] || "",
    files: downloadedFiles,
    segmentCount,
    exportPreset: firstResult.exportPreset,
    tileCount,
    redactionCount,
    manifestFile,
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

async function captureVariant({ sourceTab, variant, options, extractBlueprint }) {
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
    const sessionId = crypto.randomUUID();
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
      redactions: redactionScan.regions
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

    const downloadedFiles = await downloadRenderedOutputs(stitched.outputs, fileBaseName);

    return {
      variant,
      page,
      blueprint,
      downloadedFiles,
      segmentCount,
      tileCount: stitched.outputs.length,
      redactionCount: stitched.redactionCount,
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
  const safeTitle = sanitizeSegment(title || host).slice(0, 64);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  return `${safeTitle || "capture"}-${devicePreset}-${exportPreset}-${timestamp}`;
}

function buildManifestFileBaseName(page, options, exportPreset) {
  return buildCaptureFileBaseName({
    title: page.title,
    url: page.url,
    devicePreset: options.devicePreset || "desktop",
    exportPreset
  }).replace(/-(raw|browser|phone)-/, "-bundle-");
}

function sanitizeSegment(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createFriendlyError(title, description) {
  return { title, description };
}

function buildCaptureCompletionDetail({
  segmentCount,
  fileCount,
  redactionCount,
  variantCount,
  manifestSaved
}) {
  const sliceText = `${segmentCount} slice${segmentCount === 1 ? "" : "s"} stitched`;
  const fileText = `${fileCount} file${fileCount === 1 ? "" : "s"} saved`;
  const variantText = variantCount > 1 ? `${variantCount} responsive views captured` : "";

  if (!redactionCount && !variantText) {
    return `${sliceText} and ${fileText} successfully.`;
  }

  const fragments = [sliceText, fileText];

  if (variantText) {
    fragments.push(variantText);
  }

  if (redactionCount) {
    fragments.push(`${redactionCount} sensitive region${redactionCount === 1 ? "" : "s"} sanitized`);
  }

  if (manifestSaved) {
    fragments.push("bundle manifest saved");
  }

  return `${fragments.join(", ")}.`;
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

async function downloadRenderedOutputs(outputs, fileBaseName) {
  const downloadedFiles = [];

  for (const output of outputs) {
    const suffix =
      outputs.length > 1
        ? `-part-${String(output.index + 1).padStart(2, "0")}-of-${String(output.total).padStart(2, "0")}`
        : "";
    const filename = `Lumen/${fileBaseName}${suffix}.png`;

    await chrome.downloads.download({
      url: output.dataUrl,
      filename,
      conflictAction: "uniquify",
      saveAs: false
    });

    downloadedFiles.push(filename);
  }

  return downloadedFiles;
}

async function downloadBundleManifest({ fileBaseName, manifest }) {
  const filename = `Lumen/${fileBaseName}.json`;
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(
    `${JSON.stringify(manifest, null, 2)}\n`
  )}`;

  await chrome.downloads.download({
    url: dataUrl,
    filename,
    conflictAction: "uniquify",
    saveAs: false
  });

  return filename;
}

function buildCaptureBundleManifest({
  page,
  capturedAt,
  options,
  exportPreset,
  variants,
  redactionCount,
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
      devicePreset: options.devicePreset || "desktop",
      exportPreset,
      removeStickyHeaders: options.removeStickyHeaders !== false,
      forceLazyLoad: options.forceLazyLoad !== false,
      autoRedact: Boolean(options.autoRedact),
      variantCount: variants.length,
      segmentCount,
      tileCount,
      redactionCount
    },
    variants: variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      exportPreset: variant.exportPreset,
      fileCount: variant.files.length,
      files: variant.files,
      tileCount: variant.tileCount,
      redactionCount: variant.redactionCount,
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
