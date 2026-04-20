import { LUMEN_CONFIG } from "./config.js";

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

function initializeSession({ sessionId, page, options, redactions = [] }) {
  stitchSessions.set(sessionId, {
    page,
    options,
    redactions,
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
  const renderModel = await buildRenderModel(session);
  const requestedPreset = session.options?.exportPreset || "raw";
  const canRenderSingle = canFitCanvas(renderModel.canvasWidth, renderModel.canvasHeight);

  let outputs = [];
  let appliedPreset = requestedPreset;

  if (canRenderSingle) {
    const baseCanvas = renderSliceCanvas(renderModel, 0, renderModel.canvasHeight);
    const enhancedCanvas = renderPresentationCanvas(baseCanvas, {
      preset: requestedPreset,
      devicePreset: session.options?.devicePreset || "desktop"
    });

    appliedPreset = enhancedCanvas === baseCanvas ? "raw" : requestedPreset;
    outputs = [enhancedCanvas];
  } else {
    appliedPreset = "raw";
    outputs = renderTiledCanvases(renderModel);
  }

  return {
    outputs: outputs.map((canvas, index) => ({
      dataUrl: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
      index,
      total: outputs.length
    })),
    width: renderModel.canvasWidth,
    height: renderModel.canvasHeight,
    pixelRatio: renderModel.effectiveScale,
    appliedPreset,
    redactionCount: renderModel.redactions.length
  };
}

async function buildRenderModel(session) {
  const orderedSegments = [...session.segments].sort((left, right) => left.index - right.index);

  if (!orderedSegments.length) {
    throw new Error("No capture slices were received.");
  }

  const hydratedSegments = [];

  for (const segment of orderedSegments) {
    const image = await loadImage(segment.dataUrl);
    hydratedSegments.push({
      ...segment,
      image
    });
  }

  const firstImage = hydratedSegments[0].image;
  const effectiveScale =
    firstImage.naturalWidth / session.page.viewportWidth || session.page.devicePixelRatio || 1;
  const canvasWidth = Math.max(1, Math.round(session.page.viewportWidth * effectiveScale));
  const canvasHeight = Math.max(1, Math.round(session.page.pageHeight * effectiveScale));

  return {
    canvasWidth,
    canvasHeight,
    effectiveScale,
    redactions: (session.redactions || []).map((region) => ({
      ...region,
      left: Math.max(0, Math.round(region.left * effectiveScale)),
      top: Math.max(0, Math.round(region.top * effectiveScale)),
      width: Math.max(1, Math.round(region.width * effectiveScale)),
      height: Math.max(1, Math.round(region.height * effectiveScale))
    })),
    segments: hydratedSegments.map((segment) => {
      const cropTopPixels = Math.round(segment.cropTopCss * effectiveScale);
      const cropBottomPixels = Math.round(segment.cropBottomCss * effectiveScale);
      const sourceHeight = segment.image.naturalHeight - cropTopPixels - cropBottomPixels;
      const drawTopPixels = Math.round((segment.topCss + segment.cropTopCss) * effectiveScale);

      return {
        image: segment.image,
        sourceHeight,
        sourceY: cropTopPixels,
        drawTop: drawTopPixels,
        drawBottom: drawTopPixels + sourceHeight
      };
    })
  };
}

function renderTiledCanvases(renderModel) {
  const tileHeight = Math.max(
    2048,
    Math.min(
      LUMEN_CONFIG.capture.tileMaxOutputHeight,
      MAX_CANVAS_EDGE,
      Math.floor(MAX_CANVAS_AREA / renderModel.canvasWidth)
    )
  );
  const canvases = [];

  for (let startY = 0; startY < renderModel.canvasHeight; startY += tileHeight) {
    const endY = Math.min(renderModel.canvasHeight, startY + tileHeight);
    canvases.push(renderSliceCanvas(renderModel, startY, endY));
  }

  return canvases;
}

function renderSliceCanvas(renderModel, sliceStart, sliceEnd) {
  const canvas = document.createElement("canvas");
  canvas.width = renderModel.canvasWidth;
  canvas.height = sliceEnd - sliceStart;

  const context = canvas.getContext("2d", {
    alpha: false
  });

  if (!context) {
    throw new Error("The offscreen canvas context could not be created.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (const segment of renderModel.segments) {
    if (segment.sourceHeight <= 0) {
      continue;
    }

    const drawStart = Math.max(sliceStart, segment.drawTop);
    const drawEnd = Math.min(sliceEnd, segment.drawBottom);

    if (drawEnd <= drawStart) {
      continue;
    }

    const localDrawY = drawStart - sliceStart;
    const sourceOffset = drawStart - segment.drawTop;
    const drawHeight = drawEnd - drawStart;

    context.drawImage(
      segment.image,
      0,
      segment.sourceY + sourceOffset,
      segment.image.naturalWidth,
      drawHeight,
      0,
      localDrawY,
      canvas.width,
      drawHeight
    );
  }

  applyRedactionRegions(canvas, context, renderModel.redactions, sliceStart, sliceEnd);

  return canvas;
}

function renderPresentationCanvas(sourceCanvas, { preset, devicePreset }) {
  if (preset === "raw") {
    return sourceCanvas;
  }

  if (
    sourceCanvas.height > LUMEN_CONFIG.studio.maxMockupSourceHeight ||
    !canFitCanvas(sourceCanvas.width, sourceCanvas.height)
  ) {
    return sourceCanvas;
  }

  if (preset === "browser") {
    return renderBrowserPoster(sourceCanvas);
  }

  if (preset === "phone") {
    return renderPhonePoster(sourceCanvas, devicePreset);
  }

  return sourceCanvas;
}

function renderBrowserPoster(sourceCanvas) {
  const padding = LUMEN_CONFIG.studio.posterPadding;
  const maxInnerWidth = 1480;
  const innerScale = Math.min(1, maxInnerWidth / sourceCanvas.width);
  const contentWidth = Math.round(sourceCanvas.width * innerScale);
  const contentHeight = Math.round(sourceCanvas.height * innerScale);
  const topBarHeight = 52;
  const chromeHeight = topBarHeight + 18;
  const posterWidth = contentWidth + padding * 2;
  const posterHeight = contentHeight + chromeHeight + padding * 2;

  if (!canFitCanvas(posterWidth, posterHeight)) {
    return sourceCanvas;
  }

  const canvas = document.createElement("canvas");
  canvas.width = posterWidth;
  canvas.height = posterHeight;

  const context = canvas.getContext("2d");

  context.fillStyle = createPosterGradient(context, canvas.width, canvas.height);
  context.fillRect(0, 0, canvas.width, canvas.height);

  drawPosterGlow(context, canvas.width, canvas.height, "#59d0ff");
  drawRoundedRect(context, padding, padding, contentWidth, contentHeight + chromeHeight, 32, "#0a1220");

  context.fillStyle = "rgba(255, 255, 255, 0.08)";
  context.fillRect(padding, padding, contentWidth, topBarHeight);
  context.fillStyle = "#101a2f";
  context.fillRect(padding, padding + topBarHeight, contentWidth, 18);

  drawWindowDots(context, padding + 24, padding + 26);
  drawAddressBar(context, padding + 112, padding + 16, contentWidth - 160, 22);

  context.save();
  roundPath(context, padding, padding + chromeHeight, contentWidth, contentHeight, 22);
  context.clip();
  context.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, padding, padding + chromeHeight, contentWidth, contentHeight);
  context.restore();

  return canvas;
}

function renderPhonePoster(sourceCanvas, devicePreset) {
  const padding = 96;
  const frameWidth = devicePreset === "mobile" ? 470 : 430;
  const frameHeight = devicePreset === "mobile" ? 920 : 880;
  const posterWidth = frameWidth + padding * 2;
  const posterHeight = frameHeight + padding * 2;

  if (!canFitCanvas(posterWidth, posterHeight)) {
    return sourceCanvas;
  }

  const canvas = document.createElement("canvas");
  canvas.width = posterWidth;
  canvas.height = posterHeight;

  const context = canvas.getContext("2d");

  context.fillStyle = createPosterGradient(context, canvas.width, canvas.height);
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawPosterGlow(context, canvas.width, canvas.height, "#8de7ff");

  const phoneX = padding;
  const phoneY = padding;
  const corner = 58;

  drawRoundedRect(context, phoneX, phoneY, frameWidth, frameHeight, corner, "#050910");
  drawRoundedRect(context, phoneX + 10, phoneY + 10, frameWidth - 20, frameHeight - 20, 48, "#0a1220");

  context.fillStyle = "rgba(255, 255, 255, 0.1)";
  roundPath(context, phoneX + frameWidth * 0.28, phoneY + 18, frameWidth * 0.44, 16, 999);
  context.fill();

  const screenX = phoneX + 22;
  const screenY = phoneY + 44;
  const screenWidth = frameWidth - 44;
  const screenHeight = frameHeight - 70;
  const scale = screenWidth / sourceCanvas.width;
  const visibleSourceHeight = Math.min(sourceCanvas.height, Math.round(screenHeight / scale));

  context.save();
  roundPath(context, screenX, screenY, screenWidth, screenHeight, 36);
  context.clip();
  context.drawImage(
    sourceCanvas,
    0,
    0,
    sourceCanvas.width,
    visibleSourceHeight,
    screenX,
    screenY,
    screenWidth,
    visibleSourceHeight * scale
  );

  const fade = context.createLinearGradient(0, screenY + screenHeight * 0.72, 0, screenY + screenHeight);
  fade.addColorStop(0, "rgba(10, 18, 32, 0)");
  fade.addColorStop(1, "rgba(10, 18, 32, 0.92)");
  context.fillStyle = fade;
  context.fillRect(screenX, screenY, screenWidth, screenHeight);
  context.restore();

  return canvas;
}

function canFitCanvas(width, height) {
  return width <= MAX_CANVAS_EDGE && height <= MAX_CANVAS_EDGE && width * height <= MAX_CANVAS_AREA;
}

function createPosterGradient(context, width, height) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#07111f");
  gradient.addColorStop(0.5, "#10223d");
  gradient.addColorStop(1, "#060a13");
  return gradient;
}

function drawPosterGlow(context, width, height, color) {
  const gradient = context.createRadialGradient(width * 0.18, height * 0.16, 40, width * 0.18, height * 0.16, width * 0.55);
  gradient.addColorStop(0, `${color}66`);
  gradient.addColorStop(1, "transparent");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

function drawWindowDots(context, startX, centerY) {
  const colors = ["#ff6b6b", "#ffd166", "#4ade80"];

  colors.forEach((color, index) => {
    context.beginPath();
    context.fillStyle = color;
    context.arc(startX + index * 16, centerY, 5, 0, Math.PI * 2);
    context.fill();
  });
}

function drawAddressBar(context, x, y, width, height) {
  roundPath(context, x, y, width, height, 999);
  context.fillStyle = "rgba(255, 255, 255, 0.12)";
  context.fill();
}

function applyRedactionRegions(canvas, context, redactions, sliceStart, sliceEnd) {
  for (const region of redactions) {
    const drawStart = Math.max(sliceStart, region.top);
    const drawEnd = Math.min(sliceEnd, region.top + region.height);

    if (drawEnd <= drawStart) {
      continue;
    }

    const x = Math.max(0, region.left);
    const y = drawStart - sliceStart;
    const width = Math.min(canvas.width - x, region.width);
    const height = Math.min(canvas.height - y, drawEnd - drawStart);

    if (width <= 1 || height <= 1) {
      continue;
    }

    pixelateRegion(canvas, context, x, y, width, height);
    drawRedactionShell(context, x, y, width, height, region.kind);
  }
}

function pixelateRegion(canvas, context, x, y, width, height) {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;

  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) {
    return;
  }
  sourceContext.drawImage(canvas, x, y, width, height, 0, 0, width, height);

  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = Math.max(1, Math.round(width / 18));
  sampleCanvas.height = Math.max(1, Math.round(height / 18));

  const sampleContext = sampleCanvas.getContext("2d");
  if (!sampleContext) {
    return;
  }
  sampleContext.drawImage(sourceCanvas, 0, 0, width, height, 0, 0, sampleCanvas.width, sampleCanvas.height);

  context.save();
  roundPath(context, x, y, width, height, Math.min(18, width / 2, height / 2));
  context.clip();
  context.imageSmoothingEnabled = false;
  context.drawImage(sampleCanvas, 0, 0, sampleCanvas.width, sampleCanvas.height, x, y, width, height);
  context.restore();
}

function drawRedactionShell(context, x, y, width, height, kind) {
  const radius = Math.min(18, width / 2, height / 2);
  const stripeCount = Math.max(3, Math.round(width / 42));

  context.save();
  roundPath(context, x, y, width, height, radius);
  context.fillStyle = "rgba(4, 10, 18, 0.66)";
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.14)";
  context.lineWidth = 1;
  context.stroke();
  context.clip();

  context.strokeStyle = "rgba(134, 221, 255, 0.2)";
  context.lineWidth = 1;

  for (let index = -1; index <= stripeCount; index += 1) {
    const offset = index * 28;
    context.beginPath();
    context.moveTo(x + offset, y + height);
    context.lineTo(x + offset + 32, y);
    context.stroke();
  }

  if (width >= 80 && height >= 24) {
    context.fillStyle = "rgba(244, 247, 255, 0.78)";
    context.font = "600 11px 'SF Pro Display', 'IBM Plex Sans', sans-serif";
    context.fillText(formatRedactionLabel(kind), x + 10, y + 16);
  }

  context.restore();
}

function formatRedactionLabel(kind) {
  if (kind === "email") {
    return "EMAIL";
  }

  if (kind === "phone") {
    return "PHONE";
  }

  return "SENSITIVE";
}

function drawRoundedRect(context, x, y, width, height, radius, fillStyle) {
  roundPath(context, x, y, width, height, radius);
  context.fillStyle = fillStyle;
  context.fill();
}

function roundPath(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A captured slice could not be decoded."));
    image.src = dataUrl;
  });
}
