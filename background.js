import {
  LUMEN_CONFIG,
  STORAGE_KEYS,
  getDefaultSettings,
  isRestrictedCaptureUrl
} from "./config.js";

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const OFFSCREEN_REASON = "BLOBS";
const CAPTURE_PROGRESS_EVENT = "LUMEN_CAPTURE_PROGRESS";

let captureInFlight = false;
let offscreenCreationPromise = null;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.settings);

  if (!stored[STORAGE_KEYS.settings]) {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.settings]: getDefaultSettings()
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

  if (message?.type === "LUMEN_MOCK_SIGN_IN") {
    sendResponse({
      ok: true,
      notice:
        "Auth is mocked in this scaffold. Replace this branch with your SaaS session bootstrap and billing state fetch."
    });
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

  broadcastProgress({
    stage: "prepare",
    title: "Preparing page",
    detail: "Injecting the Lumen page agent and normalizing the document."
  });

  const target = await createCaptureTarget(sourceTab, options.devicePreset);

  try {
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

    await initializeStitchSession({
      sessionId,
      page,
      options
    });

    const segments = await capturePageSegments(target, page, sessionId);

    broadcastProgress({
      stage: "stitch",
      title: "Compositing image",
      detail: `Drawing ${segments} capture slices into the offscreen studio.`
    });

    const stitched = await finalizeStitchSession(sessionId);
    const fileName = buildCaptureFileName({
      title: page.title,
      url: page.url,
      devicePreset: options.devicePreset
    });

    broadcastProgress({
      stage: "save",
      title: "Saving file",
      detail: "Writing the capture to your Downloads folder."
    });

    await chrome.downloads.download({
      url: stitched.dataUrl,
      filename: `Lumen/${fileName}`,
      conflictAction: "uniquify",
      saveAs: false
    });

    // Future SaaS hook:
    // POST metadata, page metrics, and the final asset reference to
    // `${LUMEN_CONFIG.api.baseUrl}${LUMEN_CONFIG.api.endpoints.captures}`
    // once auth and cloud persistence are wired in.

    broadcastProgress({
      stage: "done",
      title: "Capture ready",
      detail: `${segments} slices stitched and saved successfully.`,
      progress: 1
    });

    return {
      fileName,
      segmentCount: segments,
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

async function capturePageSegments(target, page, sessionId) {
  const maxSegments = LUMEN_CONFIG.capture.maxSegments;
  let lastCaptureTimestamp = 0;
  let previousTop = null;
  let requestedTop = 0;
  let segmentCount = 0;

  while (segmentCount < maxSegments) {
    const scrollResult = await chrome.tabs.sendMessage(target.tab.id, {
      type: "LUMEN_SCROLL_TO",
      top: requestedTop
    });

    const actualTop = scrollResult?.top ?? 0;

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
      title: `Capturing slice ${segmentCount}`,
      detail: `Viewport ${segmentCount} of the scrolling page stack.`,
      progress
    });

    if (actualTop + page.viewportHeight >= page.pageHeight - 1) {
      return segmentCount;
    }

    if (previousTop !== null && actualTop <= previousTop) {
      throw createFriendlyError(
        "Capture Stalled",
        "The page stopped moving before the full document could be captured. This usually means the document is inside a custom scroll container."
      );
    }

    previousTop = actualTop;
    requestedTop = actualTop + page.viewportHeight;
  }

  throw createFriendlyError(
    "Page Too Long",
    `This page exceeded the current ${maxSegments} slice safety limit. Raise the cap or switch to a tiled export for extremely long pages.`
  );
}

async function createCaptureTarget(tab, devicePreset) {
  if (devicePreset !== "mobile") {
    return {
      kind: "desktop",
      tab,
      windowId: tab.windowId
    };
  }

  const { width, height } = LUMEN_CONFIG.capture.mobileViewport;

  const createdWindow = await chrome.windows.create({
    url: tab.url,
    type: "popup",
    width,
    height,
    focused: false
  });

  const [mobileTab] = await chrome.tabs.query({
    windowId: createdWindow.id,
    active: true
  });

  if (!mobileTab?.id) {
    throw createFriendlyError(
      "Mobile View Failed",
      "Chrome could not create the temporary mobile capture window."
    );
  }

  await waitForTabComplete(mobileTab.id);
  await sleep(260);

  return {
    kind: "mobile",
    tab: mobileTab,
    windowId: createdWindow.id
  };
}

async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });
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

function buildCaptureFileName({ title, url, devicePreset }) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const safeTitle = sanitizeSegment(title || host).slice(0, 64);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  return `${safeTitle || "capture"}-${devicePreset}-${timestamp}.png`;
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
      "The final bitmap exceeded safe canvas limits. Add a PDF export path or tile the output into multiple images for extremely tall pages."
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
