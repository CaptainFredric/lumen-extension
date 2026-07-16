import { LUMEN_CONFIG, normalizeCaptureNoteOptions } from "./config.js";

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
    case "LUMEN_UPDATE_STITCH_SESSION":
      return updateSession(message.payload);
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

function initializeSession({ sessionId, page, options, redactions = [], cutawayRegion = null, annotationRegion = null }) {
  stitchSessions.set(sessionId, {
    page,
    options,
    redactions,
    cutawayRegion,
    annotationRegion,
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

function updateSession({ sessionId, page, redactions }) {
  const session = stitchSessions.get(sessionId);

  if (!session) {
    throw new Error("Stitch session not found.");
  }

  if (page && typeof page === "object") {
    session.page = {
      ...session.page,
      ...page
    };
  }

  if (Array.isArray(redactions)) {
    session.redactions = redactions;
  }

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
  const captureHealth = buildCaptureHealth(renderModel);
  const requestedPreset = session.options?.exportPreset || "raw";
  const canRenderSingle = canFitCanvas(renderModel.canvasWidth, renderModel.canvasHeight);
  const forceTiled = ["tiles", "print"].includes(session.options?.longPageMode);

  let outputItems = [];
  let appliedPreset = requestedPreset;
  let tileCount = 0;

  if (canRenderSingle && !forceTiled) {
    const baseCanvas = renderSliceCanvas(renderModel, 0, renderModel.canvasHeight);
    const enhancedCanvas = renderPresentationCanvas(baseCanvas, {
      preset: requestedPreset,
      devicePreset: session.options?.devicePreset || "desktop"
    });

    appliedPreset = enhancedCanvas === baseCanvas ? "raw" : requestedPreset;
    tileCount = 1;
    outputItems = [{
      canvas: enhancedCanvas,
      role: "full-page",
      index: 0,
      total: 1
    }];

    const cutawayCanvas = renderCutawayCanvas(baseCanvas, renderModel.cutawayRegion);

    if (cutawayCanvas) {
      outputItems.push({
        canvas: cutawayCanvas,
        role: "cutaway",
        index: 0,
        total: 1,
        cutawayRegion: renderModel.cutawayRegion
      });
    }
  } else {
    appliedPreset = "raw";
    const tiledCanvases = renderTiledCanvases(renderModel);
    tileCount = tiledCanvases.length;
    outputItems = tiledCanvases.map((canvas, index) => ({
      canvas,
      role: "full-page",
      index,
      total: tiledCanvases.length
    }));

    const cutawayCanvas = renderCutawayFromModel(renderModel, renderModel.cutawayRegion);

    if (cutawayCanvas) {
      outputItems.push({
        canvas: cutawayCanvas,
        role: "cutaway",
        index: 0,
        total: 1,
        cutawayRegion: renderModel.cutawayRegion
      });
    }
  }

  return {
    outputs: outputItems.map((output) => {
      const previewDataUrl = renderPreviewDataUrl(output.canvas);

      return {
        dataUrl: output.canvas.toDataURL("image/png"),
        previewDataUrl,
        visualHash: buildVisualHash(output.canvas),
        width: output.canvas.width,
        height: output.canvas.height,
        index: output.index,
        total: output.total,
        role: output.role,
        partIndex: output.index + 1,
        partTotal: output.total,
        cutawayRegion: output.cutawayRegion || null
      };
    }),
    width: renderModel.canvasWidth,
    height: renderModel.canvasHeight,
    pixelRatio: renderModel.effectiveScale,
    appliedPreset,
    tileCount,
    cutawayCount: outputItems.filter((output) => output.role === "cutaway").length,
    redactionCount: renderModel.redactions.length,
    captureHealth,
    annotation: renderModel.annotation
      ? {
          enabled: true,
          position: renderModel.annotation.position,
          text: renderModel.annotation.text
        }
      : {
          enabled: Boolean(renderModel.annotationRegion),
          position: "",
          text: ""
        },
    annotationRegion: renderModel.annotationRegion
  };
}

function buildCaptureHealth(renderModel) {
  const expectedHeight = Math.max(1, renderModel.canvasHeight);
  const spans = renderModel.segments
    .map((segment) => ({
      start: Math.max(0, Math.min(expectedHeight, Math.round(segment.drawTop))),
      end: Math.max(0, Math.min(expectedHeight, Math.round(segment.drawBottom)))
    }))
    .filter((span) => span.end > span.start)
    .sort((left, right) => left.start - right.start);
  const merged = [];
  let totalDrawnPixels = 0;
  let seamGapCount = 0;

  for (const span of spans) {
    totalDrawnPixels += span.end - span.start;
    const previous = merged[merged.length - 1];

    if (!previous || span.start > previous.end) {
      if (previous && span.start > previous.end) {
        seamGapCount += 1;
      }
      merged.push({ ...span });
      continue;
    }

    previous.end = Math.max(previous.end, span.end);
  }

  const coveredPixels = merged.reduce((sum, span) => sum + span.end - span.start, 0);
  const uncoveredPixels = Math.max(0, expectedHeight - coveredPixels);
  const overlapPixels = Math.max(0, totalDrawnPixels - coveredPixels);
  const capturedBottom = merged.reduce((maximum, span) => Math.max(maximum, span.end), 0);
  const coveragePercent = Number((coveredPixels / expectedHeight * 100).toFixed(2));
  const reachedTail = capturedBottom >= expectedHeight - 1;
  const widthMismatchCount = renderModel.segments.filter((segment) =>
    Math.abs(segment.sourceWidth - renderModel.canvasWidth) > 1
  ).length;
  const status = coveragePercent >= 99.5 && reachedTail && seamGapCount === 0 && widthMismatchCount === 0
    ? "complete"
    : coveragePercent >= 90
      ? "partial"
      : "incomplete";

  return {
    status,
    coveragePercent,
    reachedTail,
    seamGapCount,
    widthMismatchCount,
    segmentCount: spans.length,
    expectedWidth: renderModel.canvasWidth,
    expectedHeight,
    coveredPixels,
    uncoveredPixels,
    overlapPixels,
    capturedBottom,
    uncoveredCssPixels: Math.max(0, Math.round(uncoveredPixels / Math.max(1, renderModel.effectiveScale)))
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
  const browserViewportWidth = Math.max(
    1,
    Number(session.page.browserViewportWidth) || Number(session.page.viewportWidth) || firstImage.naturalWidth
  );
  const effectiveScale =
    firstImage.naturalWidth / browserViewportWidth || session.page.devicePixelRatio || 1;
  const canvasWidth = Math.max(1, Math.round(session.page.viewportWidth * effectiveScale));
  const canvasHeight = Math.max(1, Math.round(session.page.pageHeight * effectiveScale));
  const annotation = buildCaptureAnnotation({
    canvasWidth,
    canvasHeight,
    effectiveScale,
    note: normalizeCaptureNoteOptions(session.options)
  });

  return {
    canvasWidth,
    canvasHeight,
    effectiveScale,
    annotation,
    annotationRegion: scaleAnnotationRegion(session.annotationRegion, effectiveScale, canvasWidth, canvasHeight),
    cutawayRegion: scaleCutawayRegion(session.cutawayRegion, effectiveScale, canvasWidth, canvasHeight),
    redactions: (session.redactions || []).map((region) => ({
      ...region,
      left: Math.max(0, Math.round(region.left * effectiveScale)),
      top: Math.max(0, Math.round(region.top * effectiveScale)),
      width: Math.max(1, Math.round(region.width * effectiveScale)),
      height: Math.max(1, Math.round(region.height * effectiveScale))
    })),
    segments: hydratedSegments.map((segment) => {
      const captureRect = normalizeCaptureRect(
        segment.captureRect || session.page.captureRect,
        session.page,
        segment.image,
        effectiveScale
      );
      const cropTopPixels = Math.round(segment.cropTopCss * effectiveScale);
      const cropBottomPixels = Math.round(segment.cropBottomCss * effectiveScale);
      const sourceHeight = captureRect.height - cropTopPixels - cropBottomPixels;
      const drawTopPixels = Math.round((segment.topCss + segment.cropTopCss) * effectiveScale);

      return {
        image: segment.image,
        sourceX: captureRect.left,
        sourceWidth: captureRect.width,
        sourceHeight,
        sourceY: captureRect.top + cropTopPixels,
        drawTop: drawTopPixels,
        drawBottom: drawTopPixels + sourceHeight
      };
    })
  };
}

function normalizeCaptureRect(rawRect, page, image, effectiveScale) {
  const fallbackWidth = Math.max(1, Math.round((Number(page.viewportWidth) || 1) * effectiveScale));
  const fallbackHeight = Math.max(1, Math.round((Number(page.viewportHeight) || 1) * effectiveScale));
  const left = Math.max(0, Math.round((Number(rawRect?.left) || 0) * effectiveScale));
  const top = Math.max(0, Math.round((Number(rawRect?.top) || 0) * effectiveScale));
  const requestedWidth = Math.max(1, Math.round((Number(rawRect?.width) || Number(page.viewportWidth) || 1) * effectiveScale));
  const requestedHeight = Math.max(1, Math.round((Number(rawRect?.height) || Number(page.viewportHeight) || 1) * effectiveScale));

  return {
    left: Math.min(left, Math.max(0, image.naturalWidth - 1)),
    top: Math.min(top, Math.max(0, image.naturalHeight - 1)),
    width: Math.max(1, Math.min(requestedWidth || fallbackWidth, image.naturalWidth - left)),
    height: Math.max(1, Math.min(requestedHeight || fallbackHeight, image.naturalHeight - top))
  };
}

function scaleCutawayRegion(region, effectiveScale, canvasWidth, canvasHeight) {
  if (!region || typeof region !== "object") {
    return null;
  }

  if (
    !Number.isFinite(region.left) ||
    !Number.isFinite(region.top) ||
    !Number.isFinite(region.width) ||
    !Number.isFinite(region.height)
  ) {
    return null;
  }

  const left = Math.max(0, Math.round(region.left * effectiveScale));
  const top = Math.max(0, Math.round(region.top * effectiveScale));
  const right = Math.min(canvasWidth, Math.round((region.left + region.width) * effectiveScale));
  const bottom = Math.min(canvasHeight, Math.round((region.top + region.height) * effectiveScale));
  const width = right - left;
  const height = bottom - top;

  if (width < 2 || height < 2) {
    return null;
  }

  const points = region.shape === "lasso"
    ? (Array.isArray(region.points) ? region.points : [])
        .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
        .map((point) => ({
          x: Math.max(left, Math.min(right, Math.round(point.x * effectiveScale))),
          y: Math.max(top, Math.min(bottom, Math.round(point.y * effectiveScale)))
        }))
        .slice(0, 120)
    : [];

  return {
    id: region.id || "",
    kind: "cutaway",
    left,
    top,
    width,
    height,
    shape: points.length >= 3 ? "lasso" : "rect",
    points: points.length >= 3 ? points : [],
    ...(region.projected ? { projected: true } : {}),
    ...(typeof region.projection === "string" ? { projection: region.projection } : {})
  };
}

function scaleAnnotationRegion(region, effectiveScale, canvasWidth, canvasHeight) {
  if (!region || typeof region !== "object") {
    return null;
  }

  if (
    !Number.isFinite(region.left) ||
    !Number.isFinite(region.top) ||
    !Number.isFinite(region.width) ||
    !Number.isFinite(region.height)
  ) {
    return null;
  }

  const left = Math.max(0, Math.round(region.left * effectiveScale));
  const top = Math.max(0, Math.round(region.top * effectiveScale));
  const right = Math.min(canvasWidth, Math.round((region.left + region.width) * effectiveScale));
  const bottom = Math.min(canvasHeight, Math.round((region.top + region.height) * effectiveScale));
  const width = right - left;
  const height = bottom - top;

  if (width < 2 || height < 2) {
    return null;
  }

  return {
    id: region.id || "",
    kind: "annotation",
    left,
    top,
    width,
    height,
    ...(region.projected ? { projected: true } : {}),
    ...(typeof region.projection === "string" ? { projection: region.projection } : {})
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
      segment.sourceX,
      segment.sourceY + sourceOffset,
      segment.sourceWidth,
      drawHeight,
      0,
      localDrawY,
      canvas.width,
      drawHeight
    );
  }

  applyRedactionRegions(canvas, context, renderModel.redactions, sliceStart, sliceEnd);
  applyRegionCallout(context, renderModel.annotationRegion, renderModel.annotation, sliceStart, sliceEnd);
  applyCaptureAnnotation(context, renderModel.annotation, sliceStart, sliceEnd);

  return canvas;
}

function renderCutawayCanvas(sourceCanvas, region) {
  if (!region) {
    return null;
  }

  const left = Math.max(0, Math.min(sourceCanvas.width - 1, Math.round(region.left)));
  const top = Math.max(0, Math.min(sourceCanvas.height - 1, Math.round(region.top)));
  const width = Math.max(1, Math.min(sourceCanvas.width - left, Math.round(region.width)));
  const height = Math.max(1, Math.min(sourceCanvas.height - top, Math.round(region.height)));

  if (width < 2 || height < 2) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const lassoPoints = region.shape === "lasso"
    ? (Array.isArray(region.points) ? region.points : [])
        .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
        .map((point) => ({
          x: Math.max(0, Math.min(width, point.x - left)),
          y: Math.max(0, Math.min(height, point.y - top))
        }))
        .slice(0, 120)
    : [];
  const isLasso = lassoPoints.length >= 3;

  const context = canvas.getContext("2d", {
    alpha: isLasso
  });

  if (!context) {
    return null;
  }

  if (isLasso) {
    context.clearRect(0, 0, width, height);
    context.save();
    context.beginPath();
    context.moveTo(lassoPoints[0].x, lassoPoints[0].y);

    for (const point of lassoPoints.slice(1)) {
      context.lineTo(point.x, point.y);
    }

    context.closePath();
    context.clip();
  } else {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }

  context.drawImage(sourceCanvas, left, top, width, height, 0, 0, width, height);

  if (isLasso) {
    context.restore();
  }

  return canvas;
}

function renderCutawayFromModel(renderModel, region) {
  if (!region) {
    return null;
  }

  const sliceStart = Math.max(0, Math.floor(region.top));
  const sliceEnd = Math.min(renderModel.canvasHeight, Math.ceil(region.top + region.height));

  if (sliceEnd - sliceStart < 2 || !canFitCanvas(renderModel.canvasWidth, sliceEnd - sliceStart)) {
    return null;
  }

  const sourceCanvas = renderSliceCanvas(renderModel, sliceStart, sliceEnd);
  const localRegion = {
    ...region,
    top: region.top - sliceStart,
    points: Array.isArray(region.points)
      ? region.points.map((point) => ({
          x: point.x,
          y: point.y - sliceStart
        }))
      : []
  };

  return renderCutawayCanvas(sourceCanvas, localRegion);
}

function renderPreviewDataUrl(sourceCanvas) {
  const width = 360;
  const height = 240;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });

  if (!context) {
    return "";
  }

  const sourceAspect = sourceCanvas.width / Math.max(1, sourceCanvas.height);
  const targetAspect = width / height;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = sourceCanvas.width;
  let sourceHeight = sourceCanvas.height;

  if (sourceAspect > targetAspect) {
    sourceWidth = Math.max(1, Math.round(sourceCanvas.height * targetAspect));
    sourceX = Math.max(0, Math.round((sourceCanvas.width - sourceWidth) / 2));
  } else if (sourceAspect < targetAspect) {
    sourceHeight = Math.max(1, Math.round(sourceCanvas.width / targetAspect));
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(
    sourceCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height
  );

  return canvas.toDataURL("image/webp", 0.78);
}

function buildVisualHash(sourceCanvas) {
  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 8;
  const context = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true
  });

  if (!context) {
    return "";
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let bits = "";

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width - 1; x += 1) {
      const leftIndex = (y * canvas.width + x) * 4;
      const rightIndex = leftIndex + 4;
      const leftLuma = pixels[leftIndex] * 0.299 + pixels[leftIndex + 1] * 0.587 + pixels[leftIndex + 2] * 0.114;
      const rightLuma = pixels[rightIndex] * 0.299 + pixels[rightIndex + 1] * 0.587 + pixels[rightIndex + 2] * 0.114;
      bits += leftLuma > rightLuma ? "1" : "0";
    }
  }

  return bits.match(/.{1,4}/g)
    .map((nibble) => Number.parseInt(nibble, 2).toString(16))
    .join("");
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

function applyCaptureAnnotation(context, annotation, sliceStart, sliceEnd) {
  if (!annotation) {
    return;
  }

  const drawStart = Math.max(sliceStart, annotation.top);
  const drawEnd = Math.min(sliceEnd, annotation.top + annotation.height);

  if (drawEnd <= drawStart) {
    return;
  }

  drawCaptureAnnotation(context, annotation, sliceStart);
}

function applyRegionCallout(context, region, annotation, sliceStart, sliceEnd) {
  if (!region) {
    return;
  }

  const drawStart = Math.max(sliceStart, region.top);
  const drawEnd = Math.min(sliceEnd, region.top + region.height);

  if (drawEnd <= drawStart) {
    return;
  }

  const x = Math.max(0, region.left);
  const y = drawStart - sliceStart;
  const width = Math.max(1, region.width);
  const height = Math.max(1, drawEnd - drawStart);
  const radius = Math.min(20, Math.max(8, Math.round(Math.min(width, height) / 12)));

  context.save();
  context.font = "700 12px 'SF Pro Display', 'IBM Plex Sans', sans-serif";
  const label = annotation?.text ? truncateLine(context, annotation.text, Math.max(80, width - 24)) : "Review callout";

  roundPath(context, x, y, width, height, radius);
  context.fillStyle = "rgba(134, 221, 255, 0.13)";
  context.fill();
  context.strokeStyle = "rgba(134, 221, 255, 0.9)";
  context.lineWidth = Math.max(2, Math.round(Math.min(width, height) / 80));
  context.stroke();

  const badgeHeight = 28;
  const badgeWidth = Math.min(Math.max(150, context.measureText(label).width + 34), Math.max(150, width));
  const badgeX = Math.max(8, Math.min(x, context.canvas.width - badgeWidth - 8));
  const badgeY = Math.max(8, y - badgeHeight - 10);

  context.shadowColor = "rgba(4, 10, 18, 0.32)";
  context.shadowBlur = 18;
  context.shadowOffsetY = 8;
  drawRoundedRect(context, badgeX, badgeY, badgeWidth, badgeHeight, 999, "rgba(8, 13, 24, 0.88)");
  context.shadowColor = "transparent";
  context.strokeStyle = "rgba(134, 221, 255, 0.32)";
  context.lineWidth = 1;
  roundPath(context, badgeX, badgeY, badgeWidth, badgeHeight, 999);
  context.stroke();
  context.fillStyle = "rgba(224, 250, 255, 0.96)";
  context.textBaseline = "middle";
  context.fillText(label, badgeX + 16, badgeY + badgeHeight / 2 + 0.5);
  context.restore();
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
  // Redaction must destroy the underlying pixels, not merely blur them. The
  // opaque fill keeps exported secrets unrecoverable while the stripe and
  // label treatment preserves Lumen's visual review language.
  context.fillStyle = "rgb(4, 10, 18)";
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

function buildCaptureAnnotation({ canvasWidth, canvasHeight, effectiveScale, note }) {
  if (!note.enabled || !note.text) {
    return null;
  }

  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");

  if (!measureContext) {
    return null;
  }

  const margin = Math.max(28, Math.round(30 * effectiveScale));
  const horizontalPadding = Math.max(18, Math.round(20 * effectiveScale));
  const verticalPadding = Math.max(16, Math.round(18 * effectiveScale));
  const labelFontSize = Math.max(10, Math.round(11 * effectiveScale));
  const bodyFontSize = Math.max(14, Math.round(15 * effectiveScale));
  const labelLineHeight = Math.round(labelFontSize * 1.35);
  const bodyLineHeight = Math.round(bodyFontSize * 1.45);
  const labelGap = Math.max(8, Math.round(8 * effectiveScale));
  const availableWidth = canvasWidth - margin * 2;

  if (availableWidth <= horizontalPadding * 2 + 40) {
    return null;
  }

  const maxWidth = Math.max(
    Math.round(Math.min(availableWidth, 220 * effectiveScale)),
    Math.min(
      availableWidth,
      Math.round(canvasWidth * 0.42),
      Math.round(410 * effectiveScale)
    )
  );

  measureContext.font = `600 ${bodyFontSize}px "SF Pro Display", "IBM Plex Sans", sans-serif`;
  const lines = wrapTextLines(measureContext, note.text, maxWidth - horizontalPadding * 2, 5);
  const contentHeight = labelLineHeight + labelGap + lines.length * bodyLineHeight;
  const height = contentHeight + verticalPadding * 2;
  const radius = Math.max(18, Math.round(20 * effectiveScale));
  const x = note.position.includes("left")
    ? margin
    : Math.max(margin, canvasWidth - margin - maxWidth);
  const y = note.position.includes("top")
    ? margin
    : Math.max(margin, canvasHeight - margin - height);

  return {
    text: note.text,
    position: note.position,
    left: x,
    top: y,
    width: maxWidth,
    height,
    radius,
    horizontalPadding,
    verticalPadding,
    labelFontSize,
    bodyFontSize,
    labelLineHeight,
    bodyLineHeight,
    labelGap,
    lines
  };
}

function drawCaptureAnnotation(context, annotation, sliceStart) {
  const localTop = annotation.top - sliceStart;
  const labelY = localTop + annotation.verticalPadding + annotation.labelLineHeight - 2;
  const textStartY = localTop + annotation.verticalPadding + annotation.labelLineHeight + annotation.labelGap;

  context.save();
  context.shadowColor = "rgba(4, 10, 18, 0.36)";
  context.shadowBlur = 28;
  context.shadowOffsetY = 14;
  drawRoundedRect(
    context,
    annotation.left,
    localTop,
    annotation.width,
    annotation.height,
    annotation.radius,
    "rgba(8, 13, 24, 0.84)"
  );
  context.restore();

  context.save();
  roundPath(context, annotation.left, localTop, annotation.width, annotation.height, annotation.radius);
  context.clip();

  const fill = context.createLinearGradient(
    annotation.left,
    localTop,
    annotation.left + annotation.width,
    localTop + annotation.height
  );
  fill.addColorStop(0, "rgba(16, 24, 38, 0.96)");
  fill.addColorStop(1, "rgba(8, 12, 22, 0.92)");
  context.fillStyle = fill;
  context.fillRect(annotation.left, localTop, annotation.width, annotation.height);

  context.fillStyle = "rgba(134, 221, 255, 0.14)";
  context.fillRect(annotation.left, localTop, annotation.width, Math.max(18, Math.round(annotation.height * 0.18)));
  context.restore();

  context.save();
  roundPath(context, annotation.left, localTop, annotation.width, annotation.height, annotation.radius);
  context.strokeStyle = "rgba(134, 221, 255, 0.26)";
  context.lineWidth = Math.max(1, Math.round(annotation.bodyFontSize / 12));
  context.stroke();

  context.fillStyle = "#86ddff";
  context.font = `700 ${annotation.labelFontSize}px "SF Pro Display", "IBM Plex Sans", sans-serif`;
  context.textBaseline = "alphabetic";
  context.fillText("CAPTURE NOTE", annotation.left + annotation.horizontalPadding, labelY);

  context.fillStyle = "rgba(244, 247, 255, 0.92)";
  context.font = `600 ${annotation.bodyFontSize}px "SF Pro Display", "IBM Plex Sans", sans-serif`;

  annotation.lines.forEach((line, index) => {
    context.fillText(
      line,
      annotation.left + annotation.horizontalPadding,
      textStartY + annotation.bodyLineHeight * (index + 0.92)
    );
  });

  const accentY = annotation.position.includes("top")
    ? localTop + annotation.height - Math.max(20, Math.round(annotation.bodyFontSize * 1.3))
    : localTop + Math.max(18, Math.round(annotation.bodyFontSize * 1.1));

  context.strokeStyle = "rgba(134, 221, 255, 0.28)";
  context.lineWidth = Math.max(2, Math.round(annotation.bodyFontSize / 7));
  context.beginPath();

  if (annotation.position.includes("left")) {
    context.moveTo(annotation.left + 16, accentY);
    context.lineTo(annotation.left + Math.min(annotation.width * 0.28, 72), accentY);
  } else {
    context.moveTo(annotation.left + annotation.width - 16, accentY);
    context.lineTo(annotation.left + annotation.width - Math.min(annotation.width * 0.28, 72), accentY);
  }

  context.stroke();
  context.restore();
}

function wrapTextLines(context, text, maxWidth, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (!currentLine || context.measureText(candidate).width <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    lines.push(currentLine);

    if (lines.length === maxLines - 1) {
      currentLine = truncateLine(context, word, maxWidth);
      break;
    }

    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }

  if (lines.length === maxLines) {
    lines[maxLines - 1] = truncateLine(context, lines[maxLines - 1], maxWidth);
  }

  return lines;
}

function truncateLine(context, text, maxWidth) {
  const ellipsis = "...";

  if (context.measureText(text).width <= maxWidth) {
    return text;
  }

  let result = text;

  while (result.length > 1 && context.measureText(`${result}${ellipsis}`).width > maxWidth) {
    result = result.slice(0, -1).trimEnd();
  }

  return `${result}${ellipsis}`;
}

function formatRedactionLabel(kind) {
  if (kind === "manual") {
    return "MANUAL";
  }

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
