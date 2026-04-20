const MAX_CANVAS_EDGE = 16384;
const MAX_CANVAS_AREA = 268435456;

const stitchSessions = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") {
    return;
  }

  routeMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function routeMessage(message) {
  switch (message.type) {
    case "LUMEN_INIT_STITCH_SESSION":
      return initializeSession(message.payload);
    case "LUMEN_APPEND_CAPTURE_SEGMENT":
      return appendSegment(message.payload);
    case "LUMEN_FINALIZE_STITCH_SESSION":
      return finalizeSession(message.payload.sessionId);
    case "LUMEN_RESET_STITCH_SESSIONS":
      stitchSessions.clear();
      return {};
    default:
      return {};
  }
}

function initializeSession({ sessionId, page, options }) {
  stitchSessions.set(sessionId, {
    page,
    options,
    segments: []
  });

  return {};
}

function appendSegment({ sessionId, segment }) {
  const session = stitchSessions.get(sessionId);

  if (!session) {
    throw new Error("Stitch session not found.");
  }

  session.segments.push(segment);
  return {};
}

async function finalizeSession(sessionId) {
  const session = stitchSessions.get(sessionId);

  if (!session) {
    throw new Error("Stitch session not found.");
  }

  const result = await renderSession(session);
  stitchSessions.delete(sessionId);

  return { result };
}

async function renderSession(session) {
  const orderedSegments = [...session.segments].sort((left, right) => left.index - right.index);

  if (!orderedSegments.length) {
    throw new Error("No capture slices were received.");
  }

  const firstImage = await loadImage(orderedSegments[0].dataUrl);
  const effectiveScale =
    firstImage.naturalWidth / session.page.viewportWidth || session.page.devicePixelRatio || 1;

  const canvasWidth = Math.max(1, Math.round(session.page.viewportWidth * effectiveScale));
  const canvasHeight = Math.max(1, Math.round(session.page.pageHeight * effectiveScale));

  if (
    canvasWidth > MAX_CANVAS_EDGE ||
    canvasHeight > MAX_CANVAS_EDGE ||
    canvasWidth * canvasHeight > MAX_CANVAS_AREA
  ) {
    throw new Error("The rendered page dimensions exceed safe canvas limits.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const context = canvas.getContext("2d", {
    alpha: false
  });

  if (!context) {
    throw new Error("The offscreen canvas context could not be created.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (const segment of orderedSegments) {
    const image = await loadImage(segment.dataUrl);
    const cropTopPixels = Math.round(segment.cropTopCss * effectiveScale);
    const cropBottomPixels = Math.round(segment.cropBottomCss * effectiveScale);
    const sourceHeight = image.naturalHeight - cropTopPixels - cropBottomPixels;
    const drawTopPixels = Math.round((segment.topCss + segment.cropTopCss) * effectiveScale);

    if (sourceHeight <= 0) {
      continue;
    }

    context.drawImage(
      image,
      0,
      cropTopPixels,
      image.naturalWidth,
      sourceHeight,
      0,
      drawTopPixels,
      canvas.width,
      sourceHeight
    );
  }

  // Future Studio hook:
  // Apply redaction, browser frames, brand blueprint overlays, and social
  // export variants here before the final asset is encoded.

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
    pixelRatio: effectiveScale
  };
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A captured slice could not be decoded."));
    image.src = dataUrl;
  });
}
