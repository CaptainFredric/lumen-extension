import { getLibraryCapture } from "./library-store.js";
import {
  buildAnnotationFilename,
  cloneAnnotations,
  commitHistory,
  createAnnotation,
  createHistory,
  findResizeHandle,
  getAnnotationBounds,
  getResizeHandles,
  hitTestAnnotations,
  redoHistory,
  removeAnnotation,
  replaceAnnotation,
  resizeAnnotation,
  translateAnnotation,
  undoHistory
} from "./annotation-engine.js";

const MAX_IMAGE_EDGE = 8192;
const MAX_IMAGE_AREA = 64 * 1024 * 1024;
const MIN_DRAW_DISTANCE = 4;
const TOOL_TIPS = {
  select: ["Select and arrange", "Click an annotation to move or resize it. Press Delete to remove it."],
  arrow: ["Draw an arrow", "Drag from the point of emphasis toward the thing you want noticed."],
  rectangle: ["Frame an area", "Drag a clean outline around the part of the capture that matters."],
  text: ["Place a note", "Write the note in the inspector, then click where it should appear."],
  blur: ["Blur sensitive detail", "Drag across text or imagery that should be obscured before sharing."],
  pixelate: ["Pixelate a region", "Drag across account details, faces, or other visual identifiers."]
};

const ui = {
  fileInput: document.querySelector("#fileInput"),
  emptyFileInput: document.querySelector("#emptyFileInput"),
  documentTitle: document.querySelector("#documentTitle"),
  documentMeta: document.querySelector("#documentMeta"),
  undoButton: document.querySelector("#undoButton"),
  redoButton: document.querySelector("#redoButton"),
  exportButton: document.querySelector("#exportButton"),
  toolButtons: [...document.querySelectorAll("[data-tool]")],
  toolTipTitle: document.querySelector("#toolTipTitle"),
  toolTipCopy: document.querySelector("#toolTipCopy"),
  workspace: document.querySelector("#workspace"),
  dropZone: document.querySelector("#dropZone"),
  dropOverlay: document.querySelector("#dropOverlay"),
  emptyState: document.querySelector("#emptyState"),
  canvasFrame: document.querySelector("#canvasFrame"),
  canvas: document.querySelector("#editorCanvas"),
  statusMessage: document.querySelector("#statusMessage"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  fitButton: document.querySelector("#fitButton"),
  zoomLabel: document.querySelector("#zoomLabel"),
  inspectorTitle: document.querySelector("#inspectorTitle"),
  deleteButton: document.querySelector("#deleteButton"),
  annotationStyleProperties: document.querySelector(".annotation-style-properties"),
  colorInput: document.querySelector("#colorInput"),
  colorValue: document.querySelector("#colorValue"),
  strokeWidthInput: document.querySelector("#strokeWidthInput"),
  strokeWidthValue: document.querySelector("#strokeWidthValue"),
  textProperties: document.querySelector("#textProperties"),
  textInput: document.querySelector("#textInput"),
  fontSizeInput: document.querySelector("#fontSizeInput"),
  fontSizeValue: document.querySelector("#fontSizeValue"),
  textBackgroundInput: document.querySelector("#textBackgroundInput"),
  blurProperties: document.querySelector("#blurProperties"),
  blurRadiusInput: document.querySelector("#blurRadiusInput"),
  blurRadiusValue: document.querySelector("#blurRadiusValue"),
  pixelateProperties: document.querySelector("#pixelateProperties"),
  pixelSizeInput: document.querySelector("#pixelSizeInput"),
  pixelSizeValue: document.querySelector("#pixelSizeValue")
};

const state = {
  image: null,
  imageObjectUrl: "",
  source: {
    title: "capture",
    captureId: "",
    origin: "",
    sourceWidth: 0,
    sourceHeight: 0,
    scaled: false
  },
  history: createHistory([]),
  selectedId: "",
  tool: "select",
  interaction: null,
  previewAnnotations: null,
  zoom: 1,
  fitZoom: 1,
  zoomMode: "fit",
  dragDepth: 0,
  exporting: false,
  settings: {
    color: "#ff5f87",
    strokeWidth: 4,
    text: "Note",
    fontSize: 28,
    textBackground: true,
    blurRadius: 14,
    pixelSize: 14
  }
};

let resizeObserver = null;

initialize().catch((error) => {
  showStatus(error.message || "Annotation Studio could not start.", "error");
});

export async function getRenderedAnnotationBlob() {
  if (!state.image) {
    throw new Error("Open an image before requesting an annotated export.");
  }

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = ui.canvas.width;
  exportCanvas.height = ui.canvas.height;
  renderComposite(exportCanvas, state.history.present, { includeSelection: false });

  return canvasToBlob(exportCanvas, "image/png");
}

export function getAnnotationExportMetadata() {
  return {
    filename: buildAnnotationFilename(state.source.title),
    title: state.source.title,
    captureId: state.source.captureId,
    width: ui.canvas.width,
    height: ui.canvas.height,
    annotationCount: state.history.present.length,
    sourceOrigin: state.source.origin,
    sourceWidth: state.source.sourceWidth,
    sourceHeight: state.source.sourceHeight,
    sourceScaled: state.source.scaled
  };
}

async function initialize() {
  bindEvents();
  exposeIntegrationApi();
  updateControls();
  updateInspector();

  const parameters = new URLSearchParams(location.search);

  if (parameters.get("demo") === "1") {
    const demoBlob = await buildDemoImageBlob();
    await loadImageBlob(demoBlob, {
      title: "Lumen product review",
      origin: "demo"
    });
    seedDemoAnnotations();
    showStatus("Demo capture loaded. Every editing tool is ready to try.", "success");
    return;
  }

  const captureId = parameters.get("capture") || "";

  if (captureId) {
    await loadCapturePreview(captureId, parameters.get("asset") || "");
    return;
  }

  const sourceUrl = parameters.get("src") || parameters.get("url") || "";

  if (sourceUrl) {
    await loadRemoteImage(sourceUrl, { title: parameters.get("title") || "capture" });
    return;
  }

  notifyEditorReady();
}

function bindEvents() {
  ui.fileInput.addEventListener("change", handleFileSelection);
  ui.emptyFileInput.addEventListener("change", handleFileSelection);
  ui.undoButton.addEventListener("click", undo);
  ui.redoButton.addEventListener("click", redo);
  ui.exportButton.addEventListener("click", () => exportAnnotatedPng());
  ui.deleteButton.addEventListener("click", deleteSelectedAnnotation);
  ui.zoomInButton.addEventListener("click", () => adjustZoom(1.25));
  ui.zoomOutButton.addEventListener("click", () => adjustZoom(0.8));
  ui.fitButton.addEventListener("click", fitCanvas);

  for (const button of ui.toolButtons) {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  }

  ui.canvas.addEventListener("pointerdown", handlePointerDown);
  ui.canvas.addEventListener("pointermove", handlePointerMove);
  ui.canvas.addEventListener("pointerup", handlePointerUp);
  ui.canvas.addEventListener("pointercancel", cancelInteraction);
  ui.canvas.addEventListener("lostpointercapture", handleLostPointerCapture);
  ui.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  ui.dropZone.addEventListener("dragenter", handleDragEnter);
  ui.dropZone.addEventListener("dragover", handleDragOver);
  ui.dropZone.addEventListener("dragleave", handleDragLeave);
  ui.dropZone.addEventListener("drop", handleDrop);

  bindPropertyInput(ui.colorInput, "color", () => ui.colorInput.value.toLowerCase());
  bindPropertyInput(ui.strokeWidthInput, "strokeWidth", () => Number(ui.strokeWidthInput.value), renderPropertyOutputs);
  bindPropertyInput(ui.textInput, "text", () => ui.textInput.value || "Note");
  bindPropertyInput(ui.fontSizeInput, "fontSize", () => Number(ui.fontSizeInput.value), renderPropertyOutputs);
  bindPropertyInput(ui.textBackgroundInput, "background", () => ui.textBackgroundInput.checked);
  bindPropertyInput(ui.blurRadiusInput, "radius", () => Number(ui.blurRadiusInput.value), renderPropertyOutputs);
  bindPropertyInput(ui.pixelSizeInput, "pixelSize", () => Number(ui.pixelSizeInput.value), renderPropertyOutputs);

  document.addEventListener("keydown", handleKeyboardShortcut);
  window.addEventListener("beforeunload", releaseSourceObjectUrl);
  window.addEventListener("lumen:request-annotation-blob", handleBlobRequest);
  window.addEventListener("message", handleWindowMessage);

  if (globalThis.chrome?.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "LUMEN_EDITOR_LOAD_IMAGE") {
        loadImagePayload(message.payload || {})
          .then(() => sendResponse({ ok: true, metadata: getAnnotationExportMetadata() }))
          .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
      }

      if (message?.type === "LUMEN_EDITOR_EXPORT_PNG") {
        exportAnnotatedPng()
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((error) => sendResponse({ ok: false, error: error.message }));
        return true;
      }

      return undefined;
    });
  }

  if (globalThis.ResizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      if (state.image && state.zoomMode === "fit") {
        fitCanvas({ announce: false });
      }
    });
    resizeObserver.observe(ui.dropZone);
  }
}

function bindPropertyInput(element, annotationProperty, readValue, afterInput = null) {
  const settingKey = mapPropertyToSetting(annotationProperty);

  element.addEventListener("input", () => {
    const value = readValue();
    state.settings[settingKey] = value;
    afterInput?.();
    previewSelectedProperty(annotationProperty, value);
  });

  element.addEventListener("change", () => {
    commitPropertyPreview();
  });
}

function exposeIntegrationApi() {
  const api = Object.freeze({
    getRenderedBlob: getRenderedAnnotationBlob,
    getMetadata: getAnnotationExportMetadata,
    getAnnotationCount: () => state.history.present.length,
    load: loadImagePayload,
    exportPng: exportAnnotatedPng
  });

  Object.defineProperty(globalThis, "LumenAnnotationEditor", {
    configurable: false,
    enumerable: false,
    value: api,
    writable: false
  });
}

async function handleBlobRequest() {
  try {
    const blob = await getRenderedAnnotationBlob();
    window.dispatchEvent(new CustomEvent("lumen:annotation-blob-ready", {
      detail: {
        blob,
        metadata: getAnnotationExportMetadata()
      }
    }));
  } catch (error) {
    window.dispatchEvent(new CustomEvent("lumen:annotation-blob-error", {
      detail: { message: error.message }
    }));
  }
}

function handleWindowMessage(event) {
  if (event.source !== window || event.origin !== location.origin || event.data?.type !== "LUMEN_EDITOR_LOAD_IMAGE") {
    return;
  }

  loadImagePayload(event.data.payload || {}).catch((error) => showStatus(error.message, "error"));
}

async function loadImagePayload(payload = {}) {
  if (payload.captureId) {
    return loadCapturePreview(payload.captureId, payload.assetId || "");
  }

  if (payload.blob instanceof Blob) {
    return loadImageBlob(payload.blob, payload);
  }

  if (payload.bytes instanceof ArrayBuffer || ArrayBuffer.isView(payload.bytes) || Array.isArray(payload.bytes)) {
    const bytes = payload.bytes instanceof ArrayBuffer
      ? payload.bytes
      : ArrayBuffer.isView(payload.bytes)
        ? payload.bytes.buffer
        : new Uint8Array(payload.bytes).buffer;
    return loadImageBlob(new Blob([bytes], { type: payload.mime || "image/png" }), payload);
  }

  const sourceUrl = payload.dataUrl || payload.url || payload.src || "";

  if (sourceUrl) {
    return loadRemoteImage(sourceUrl, payload);
  }

  throw new Error("The editor did not receive an image, capture ID, or image URL.");
}

async function loadCapturePreview(captureId, assetId = "") {
  showStatus("Loading the full local editor image…");
  const capture = await getLibraryCapture(captureId, {
    includePreview: true,
    includeEditorSource: true,
    assetId
  });

  if (!capture) {
    throw new Error("This capture is no longer available in the local Lumen library.");
  }

  const source = capture.editorSource?.blob
    ? capture.editorSource
    : capture.preview?.blob
      ? capture.preview
      : null;

  if (!source?.blob) {
    throw new Error("This capture has no local editor image. Open a downloaded original with the image picker instead.");
  }

  await loadImageBlob(source.blob, {
    captureId: capture.id,
    title: capture.title || capture.host || "capture",
    origin: capture.editorSource?.blob ? "library-editor-source" : "library-preview",
    originalWidth: source.originalWidth || source.width,
    originalHeight: source.originalHeight || source.height,
    scaled: Boolean(source.scaled)
  });
  showStatus(
    capture.editorSource?.blob
      ? "Whole capture loaded from the private library. Export creates a new annotated PNG."
      : "Legacy library preview loaded. Open the downloaded original when full detail is required.",
    "success"
  );
}

async function loadRemoteImage(sourceUrl, metadata = {}) {
  const normalizedUrl = String(sourceUrl || "");

  if (!/^(data:image\/(?:png|jpeg|webp);|blob:|https?:|chrome-extension:)/i.test(normalizedUrl)) {
    throw new Error("Only PNG, JPEG, or WebP image sources can be opened.");
  }

  showStatus("Loading image…");
  const response = await fetch(normalizedUrl);

  if (!response.ok) {
    throw new Error(`The image could not be loaded (${response.status}).`);
  }

  const blob = await response.blob();
  return loadImageBlob(blob, { ...metadata, origin: metadata.origin || "url" });
}

async function loadImageBlob(blob, metadata = {}) {
  if (!(blob instanceof Blob) || !blob.size || !blob.type.startsWith("image/")) {
    throw new Error("Choose a valid PNG, JPEG, or WebP image.");
  }

  const objectUrl = URL.createObjectURL(blob);
  const image = await decodeImage(objectUrl).catch((error) => {
    URL.revokeObjectURL(objectUrl);
    throw error;
  });
  const dimensions = constrainImageDimensions(image.naturalWidth, image.naturalHeight);

  releaseSourceObjectUrl();
  state.imageObjectUrl = objectUrl;
  state.image = image;
  state.source = {
    title: String(metadata.title || metadata.name || "capture").slice(0, 220),
    captureId: String(metadata.captureId || "").slice(0, 160),
    origin: String(metadata.origin || "file").slice(0, 80),
    sourceWidth: Math.max(image.naturalWidth, Math.round(Number(metadata.originalWidth) || 0)),
    sourceHeight: Math.max(image.naturalHeight, Math.round(Number(metadata.originalHeight) || 0)),
    scaled: Boolean(metadata.scaled) || dimensions.width !== image.naturalWidth || dimensions.height !== image.naturalHeight
  };
  state.history = createHistory([]);
  state.selectedId = "";
  state.interaction = null;
  state.previewAnnotations = null;

  ui.canvas.width = dimensions.width;
  ui.canvas.height = dimensions.height;
  ui.canvas.setAttribute(
    "aria-label",
    "Capture annotation canvas. Press a tool shortcut then Enter to create at the center. In Select, press Enter to move through annotations and use the arrow keys to reposition the selection."
  );
  ui.emptyState.classList.add("is-hidden");
  ui.canvasFrame.classList.remove("is-hidden");
  ui.documentTitle.textContent = state.source.title;
  ui.documentMeta.textContent = [
    `${dimensions.width}×${dimensions.height}`,
    state.source.origin === "library-editor-source"
      ? "private full-capture source"
      : state.source.origin === "library-preview"
        ? "legacy library preview"
        : "local image",
    state.source.scaled ? `editing proxy of ${state.source.sourceWidth}×${state.source.sourceHeight}` : ""
  ].filter(Boolean).join(" · ");
  setTool("select");
  updateControls();
  updateInspector();
  renderEditor();

  requestAnimationFrame(() => fitCanvas({ announce: false }));
  notifyEditorReady();

  if (state.source.scaled) {
    showStatus(
      `The ${state.source.sourceWidth}×${state.source.sourceHeight} source was safely scaled to ${dimensions.width}×${dimensions.height} for editing.`,
      "success"
    );
  }

  return getAnnotationExportMetadata();
}

function decodeImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be decoded."));
    image.src = source;
  });
}

function constrainImageDimensions(sourceWidth, sourceHeight) {
  const edgeScale = Math.min(1, MAX_IMAGE_EDGE / sourceWidth, MAX_IMAGE_EDGE / sourceHeight);
  const areaScale = Math.min(1, Math.sqrt(MAX_IMAGE_AREA / (sourceWidth * sourceHeight)));
  const scale = Math.min(edgeScale, areaScale);

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale))
  };
}

function handleFileSelection(event) {
  const [file] = event.target.files || [];
  event.target.value = "";

  if (!file) {
    return;
  }

  loadImageBlob(file, { title: removeFileExtension(file.name), origin: "file" })
    .then(() => showStatus("Image opened locally. Add annotations, then export a PNG.", "success"))
    .catch((error) => showStatus(error.message, "error"));
}

function handleDragEnter(event) {
  event.preventDefault();
  state.dragDepth += 1;
  ui.dropOverlay.classList.remove("is-hidden");
}

function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

function handleDragLeave(event) {
  event.preventDefault();
  state.dragDepth = Math.max(0, state.dragDepth - 1);

  if (!state.dragDepth) {
    ui.dropOverlay.classList.add("is-hidden");
  }
}

function handleDrop(event) {
  event.preventDefault();
  state.dragDepth = 0;
  ui.dropOverlay.classList.add("is-hidden");
  const [file] = [...(event.dataTransfer.files || [])].filter((entry) => entry.type.startsWith("image/"));

  if (!file) {
    showStatus("Drop a PNG, JPEG, or WebP image here.", "error");
    return;
  }

  loadImageBlob(file, { title: removeFileExtension(file.name), origin: "file" })
    .then(() => showStatus("Image opened locally. Add annotations, then export a PNG.", "success"))
    .catch((error) => showStatus(error.message, "error"));
}

function setTool(tool) {
  if (!TOOL_TIPS[tool]) {
    return;
  }

  cancelInteraction();
  state.tool = tool;
  ui.canvas.dataset.tool = tool;

  for (const button of ui.toolButtons) {
    const active = button.dataset.tool === tool;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  const [title, copy] = TOOL_TIPS[tool];
  ui.toolTipTitle.textContent = title;
  ui.toolTipCopy.textContent = copy;
  updateInspector();

  if (tool === "text") {
    requestAnimationFrame(() => ui.textInput.focus());
  }
}

function handlePointerDown(event) {
  if (!state.image || event.button !== 0) {
    return;
  }

  commitPropertyPreview();
  const point = getCanvasPoint(event);
  const pixelScale = getCanvasPixelsPerCssPixel();
  ui.canvas.setPointerCapture(event.pointerId);
  ui.canvas.focus({ preventScroll: true });

  if (state.tool === "select") {
    const selected = getSelectedAnnotation();
    const handle = selected ? findResizeHandle(selected, point, 9 * pixelScale) : null;

    if (selected && handle) {
      state.interaction = {
        kind: "resize",
        pointerId: event.pointerId,
        annotationId: selected.id,
        handle: handle.name,
        original: { ...selected },
        start: point
      };
      return;
    }

    const hit = hitTestAnnotations(state.history.present, point, 8 * pixelScale);
    state.selectedId = hit?.id || "";
    state.previewAnnotations = null;

    if (hit) {
      state.interaction = {
        kind: "move",
        pointerId: event.pointerId,
        annotationId: hit.id,
        original: { ...hit },
        start: point
      };
    }

    updateInspector();
    renderEditor();
    return;
  }

  if (state.tool === "text") {
    placeTextAnnotation(point);
    return;
  }

  state.interaction = {
    kind: "create",
    pointerId: event.pointerId,
    tool: state.tool,
    start: point,
    current: point
  };
  renderEditor();
}

function handlePointerMove(event) {
  if (!state.interaction || state.interaction.pointerId !== event.pointerId) {
    return;
  }

  const point = getCanvasPoint(event);
  const bounds = { width: ui.canvas.width, height: ui.canvas.height };

  if (state.interaction.kind === "create") {
    state.interaction.current = point;
    renderEditor();
    return;
  }

  if (state.interaction.kind === "move") {
    const moved = translateAnnotation(
      state.interaction.original,
      point.x - state.interaction.start.x,
      point.y - state.interaction.start.y,
      bounds
    );
    state.previewAnnotations = replaceAnnotation(state.history.present, moved);
    renderEditor();
    return;
  }

  if (state.interaction.kind === "resize") {
    const resized = resizeAnnotation(
      state.interaction.original,
      state.interaction.handle,
      point,
      bounds,
      8 * getCanvasPixelsPerCssPixel()
    );
    state.previewAnnotations = replaceAnnotation(state.history.present, resized);
    renderEditor();
  }
}

function handlePointerUp(event) {
  const interaction = state.interaction;

  if (!interaction || interaction.pointerId !== event.pointerId) {
    return;
  }

  if (interaction.kind === "create") {
    const annotation = createDraftAnnotation(interaction.tool, interaction.start, interaction.current, true);

    if (annotation) {
      commitAnnotations([...state.history.present, annotation], annotation.id);
      showStatus(`${titleCase(annotation.type)} added. Drag it to reposition or use the handles to resize.`);
    }
  } else if (state.previewAnnotations) {
    commitAnnotations(state.previewAnnotations, interaction.annotationId);
  }

  state.interaction = null;
  state.previewAnnotations = null;

  if (ui.canvas.hasPointerCapture(event.pointerId)) {
    ui.canvas.releasePointerCapture(event.pointerId);
  }

  updateControls();
  updateInspector();
  renderEditor();
}

function handleLostPointerCapture(event) {
  if (state.interaction?.pointerId === event.pointerId) {
    handlePointerUp(event);
  }
}

function cancelInteraction() {
  if (!state.interaction && !state.previewAnnotations) {
    return;
  }

  state.interaction = null;
  state.previewAnnotations = null;
  renderEditor();
}

function createDraftAnnotation(tool, start, end, finalize = false) {
  const pixelScale = getCanvasPixelsPerCssPixel();
  const style = readAnnotationStyle(pixelScale);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);

  if (tool === "arrow") {
    const arrowEnd = distance < MIN_DRAW_DISTANCE * pixelScale && finalize
      ? { x: Math.min(ui.canvas.width, start.x + 120 * pixelScale), y: Math.min(ui.canvas.height, start.y + 60 * pixelScale) }
      : end;

    return createAnnotation({
      type: "arrow",
      x1: start.x,
      y1: start.y,
      x2: arrowEnd.x,
      y2: arrowEnd.y,
      ...style
    });
  }

  const defaultWidth = tool === "rectangle" ? 180 : 210;
  const defaultHeight = tool === "rectangle" ? 110 : 120;
  const rectangleEnd = distance < MIN_DRAW_DISTANCE * pixelScale && finalize
    ? {
        x: Math.min(ui.canvas.width, start.x + defaultWidth * pixelScale),
        y: Math.min(ui.canvas.height, start.y + defaultHeight * pixelScale)
      }
    : end;
  const rectangle = {
    x: start.x,
    y: start.y,
    width: rectangleEnd.x - start.x,
    height: rectangleEnd.y - start.y
  };

  if (!finalize && Math.abs(rectangle.width) < 1 && Math.abs(rectangle.height) < 1) {
    return null;
  }

  return createAnnotation({
    type: tool,
    ...rectangle,
    ...style,
    radius: state.settings.blurRadius * pixelScale,
    pixelSize: state.settings.pixelSize * pixelScale
  });
}

function placeTextAnnotation(point) {
  const pixelScale = getCanvasPixelsPerCssPixel();
  const fontSize = state.settings.fontSize * pixelScale;
  const width = Math.min(320 * pixelScale, Math.max(80 * pixelScale, ui.canvas.width - point.x));
  const height = estimateTextHeight(state.settings.text, width, fontSize);
  const annotation = createAnnotation({
    type: "text",
    x: Math.min(point.x, Math.max(0, ui.canvas.width - width)),
    y: Math.min(point.y, Math.max(0, ui.canvas.height - height)),
    width,
    height: Math.min(height, ui.canvas.height),
    text: state.settings.text,
    fontSize,
    background: state.settings.textBackground,
    ...readAnnotationStyle(pixelScale)
  });

  commitAnnotations([...state.history.present, annotation], annotation.id);
  setTool("select");
  updateInspector();
  renderEditor();
  showStatus("Text note added. Edit its copy in the inspector or drag it into place.");
}

function createKeyboardAnnotation(tool = state.tool) {
  if (!state.image || tool === "select") {
    return false;
  }

  const pixelScale = getCanvasPixelsPerCssPixel();
  const center = {
    x: ui.canvas.width / 2,
    y: ui.canvas.height / 2
  };

  if (tool === "text") {
    placeTextAnnotation(center);
    ui.canvas.focus({ preventScroll: true });
    return true;
  }

  const targetWidth = Math.min(ui.canvas.width * 0.58, (tool === "arrow" ? 240 : 220) * pixelScale);
  const targetHeight = Math.min(ui.canvas.height * 0.48, (tool === "arrow" ? 120 : 140) * pixelScale);
  const start = {
    x: Math.max(0, center.x - targetWidth / 2),
    y: Math.max(0, center.y - targetHeight / 2)
  };
  const end = {
    x: Math.min(ui.canvas.width, center.x + targetWidth / 2),
    y: Math.min(ui.canvas.height, center.y + targetHeight / 2)
  };
  const annotation = createDraftAnnotation(tool, start, end, true);

  if (!annotation) {
    return false;
  }

  commitAnnotations([...state.history.present, annotation], annotation.id);
  showStatus(`${titleCase(annotation.type)} added at the canvas center. Use the arrow keys to move it.`);
  return true;
}

function cycleAnnotationSelection(direction = 1) {
  const annotations = state.history.present;

  if (!annotations.length) {
    state.selectedId = "";
    showStatus("There are no annotations to select yet. Choose a tool and press Enter to create one.");
    updateInspector();
    renderEditor();
    return false;
  }

  commitPropertyPreview();
  setTool("select");
  const currentIndex = annotations.findIndex((annotation) => annotation.id === state.selectedId);
  const nextIndex = currentIndex < 0
    ? direction < 0 ? annotations.length - 1 : 0
    : (currentIndex + direction + annotations.length) % annotations.length;
  const selected = annotations[nextIndex];
  state.selectedId = selected.id;
  updateInspector();
  renderEditor();
  showStatus(`${titleCase(selected.type)} selected, ${nextIndex + 1} of ${annotations.length}. Arrow keys move it; Delete removes it.`);
  return true;
}

function readAnnotationStyle(pixelScale) {
  return {
    color: state.settings.color,
    strokeWidth: Math.max(1, state.settings.strokeWidth * pixelScale)
  };
}

function getCanvasPoint(event) {
  const rectangle = ui.canvas.getBoundingClientRect();

  return {
    x: Math.max(0, Math.min(ui.canvas.width, (event.clientX - rectangle.left) * ui.canvas.width / rectangle.width)),
    y: Math.max(0, Math.min(ui.canvas.height, (event.clientY - rectangle.top) * ui.canvas.height / rectangle.height))
  };
}

function getCanvasPixelsPerCssPixel() {
  if (!state.image) {
    return 1;
  }

  const rectangle = ui.canvas.getBoundingClientRect();
  return rectangle.width ? ui.canvas.width / rectangle.width : 1 / Math.max(0.01, state.zoom);
}

function renderEditor() {
  if (!state.image) {
    return;
  }

  let annotations = state.previewAnnotations || state.history.present;

  if (state.interaction?.kind === "create") {
    const draft = createDraftAnnotation(
      state.interaction.tool,
      state.interaction.start,
      state.interaction.current
    );

    if (draft) {
      annotations = [...annotations, draft];
    }
  }

  renderComposite(ui.canvas, annotations, {
    includeSelection: true,
    selectedId: state.selectedId
  });
}

function renderComposite(canvas, annotations, options = {}) {
  const context = canvas.getContext("2d", { alpha: true });

  if (!context || !state.image) {
    return;
  }

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(state.image, 0, 0, canvas.width, canvas.height);

  for (const annotation of annotations) {
    drawAnnotation(context, annotation);
  }

  if (options.includeSelection && options.selectedId) {
    const selected = annotations.find((annotation) => annotation.id === options.selectedId);

    if (selected) {
      drawSelection(context, selected, getCanvasPixelsPerCssPixel());
    }
  }

  context.restore();
}

function drawAnnotation(context, annotation) {
  if (annotation.type === "arrow") {
    drawArrow(context, annotation);
    return;
  }

  if (annotation.type === "rectangle") {
    drawRectangle(context, annotation);
    return;
  }

  if (annotation.type === "text") {
    drawText(context, annotation);
    return;
  }

  if (annotation.type === "blur") {
    applyBlur(context, annotation);
    return;
  }

  if (annotation.type === "pixelate") {
    applyPixelation(context, annotation);
  }
}

function drawArrow(context, annotation) {
  const angle = Math.atan2(annotation.y2 - annotation.y1, annotation.x2 - annotation.x1);
  const headLength = Math.max(annotation.strokeWidth * 4.5, 12);

  context.save();
  context.strokeStyle = annotation.color;
  context.fillStyle = annotation.color;
  context.lineWidth = annotation.strokeWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(annotation.x1, annotation.y1);
  context.lineTo(annotation.x2, annotation.y2);
  context.stroke();
  context.beginPath();
  context.moveTo(annotation.x2, annotation.y2);
  context.lineTo(
    annotation.x2 - headLength * Math.cos(angle - Math.PI / 6),
    annotation.y2 - headLength * Math.sin(angle - Math.PI / 6)
  );
  context.lineTo(
    annotation.x2 - headLength * Math.cos(angle + Math.PI / 6),
    annotation.y2 - headLength * Math.sin(angle + Math.PI / 6)
  );
  context.closePath();
  context.fill();
  context.restore();
}

function drawRectangle(context, annotation) {
  context.save();
  context.fillStyle = colorWithAlpha(annotation.color, annotation.fillOpacity ?? 0.08);
  context.strokeStyle = annotation.color;
  context.lineWidth = annotation.strokeWidth;
  context.lineJoin = "round";
  context.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
  context.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
  context.restore();
}

function drawText(context, annotation) {
  const padding = Math.max(8, annotation.fontSize * 0.42);
  const lineHeight = annotation.fontSize * 1.25;
  const maximumTextWidth = Math.max(1, annotation.width - padding * 2);
  const lines = wrapText(context, annotation.text, maximumTextWidth, annotation.fontSize);

  context.save();
  context.beginPath();
  context.rect(annotation.x, annotation.y, annotation.width, annotation.height);
  context.clip();

  if (annotation.background) {
    context.fillStyle = "rgba(4, 9, 16, 0.84)";
    context.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
    context.fillStyle = colorWithAlpha(annotation.color, 0.25);
    context.fillRect(annotation.x, annotation.y, Math.max(3, annotation.strokeWidth), annotation.height);
  }

  context.font = `700 ${annotation.fontSize}px ${annotation.fontFamily || "system-ui"}`;
  context.textBaseline = "top";
  context.fillStyle = annotation.color;

  lines.forEach((line, index) => {
    context.fillText(line, annotation.x + padding, annotation.y + padding + index * lineHeight);
  });
  context.restore();
}

function applyBlur(context, annotation) {
  const bounds = getSafeEffectBounds(annotation, context.canvas);

  if (!bounds) {
    return;
  }

  const padding = Math.ceil(annotation.radius * 2);
  const sourceX = Math.max(0, bounds.x - padding);
  const sourceY = Math.max(0, bounds.y - padding);
  const sourceRight = Math.min(context.canvas.width, bounds.x + bounds.width + padding);
  const sourceBottom = Math.min(context.canvas.height, bounds.y + bounds.height + padding);
  const scratch = document.createElement("canvas");
  scratch.width = Math.max(1, sourceRight - sourceX);
  scratch.height = Math.max(1, sourceBottom - sourceY);
  const scratchContext = scratch.getContext("2d");
  scratchContext.drawImage(
    context.canvas,
    sourceX,
    sourceY,
    scratch.width,
    scratch.height,
    0,
    0,
    scratch.width,
    scratch.height
  );

  context.save();
  context.beginPath();
  context.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  context.clip();
  context.filter = `blur(${annotation.radius}px)`;
  context.drawImage(scratch, sourceX, sourceY);
  context.filter = "none";
  context.restore();
}

function applyPixelation(context, annotation) {
  const bounds = getSafeEffectBounds(annotation, context.canvas);

  if (!bounds) {
    return;
  }

  const pixelSize = Math.max(2, annotation.pixelSize);
  const sampleWidth = Math.max(1, Math.ceil(bounds.width / pixelSize));
  const sampleHeight = Math.max(1, Math.ceil(bounds.height / pixelSize));
  const scratch = document.createElement("canvas");
  scratch.width = sampleWidth;
  scratch.height = sampleHeight;
  const scratchContext = scratch.getContext("2d");
  scratchContext.imageSmoothingEnabled = false;
  scratchContext.drawImage(
    context.canvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    sampleWidth,
    sampleHeight
  );

  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(
    scratch,
    0,
    0,
    sampleWidth,
    sampleHeight,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height
  );
  context.restore();
}

function getSafeEffectBounds(annotation, canvas) {
  const x = Math.max(0, Math.floor(annotation.x));
  const y = Math.max(0, Math.floor(annotation.y));
  const right = Math.min(canvas.width, Math.ceil(annotation.x + annotation.width));
  const bottom = Math.min(canvas.height, Math.ceil(annotation.y + annotation.height));

  if (right - x < 2 || bottom - y < 2) {
    return null;
  }

  return { x, y, width: right - x, height: bottom - y };
}

function drawSelection(context, annotation, pixelScale) {
  const bounds = getAnnotationBounds(annotation);

  if (!bounds) {
    return;
  }

  const lineWidth = 1.5 * pixelScale;
  const radius = 5 * pixelScale;

  context.save();
  context.strokeStyle = "#86ddff";
  context.fillStyle = "#07101b";
  context.lineWidth = lineWidth;
  context.setLineDash([5 * pixelScale, 4 * pixelScale]);
  context.strokeRect(bounds.x, bounds.y, Math.max(1, bounds.width), Math.max(1, bounds.height));
  context.setLineDash([]);

  for (const handle of getResizeHandles(annotation)) {
    context.beginPath();
    context.arc(handle.x, handle.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  context.restore();
}

function wrapText(context, text, maximumWidth, fontSize) {
  context.save();
  context.font = `700 ${fontSize}px system-ui`;
  const lines = [];

  for (const paragraph of String(text || "Note").split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";

    if (!words.length) {
      lines.push("");
      continue;
    }

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;

      if (current && context.measureText(candidate).width > maximumWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }

    if (current) {
      lines.push(current);
    }
  }

  context.restore();
  return lines;
}

function estimateTextHeight(text, width, fontSize) {
  const context = ui.canvas.getContext("2d");
  const padding = Math.max(8, fontSize * 0.42);
  const lines = wrapText(context, text, Math.max(1, width - padding * 2), fontSize);
  return Math.max(fontSize * 2, padding * 2 + lines.length * fontSize * 1.25);
}

function commitAnnotations(annotations, selectedId = state.selectedId) {
  state.history = commitHistory(state.history, annotations);
  state.selectedId = annotations.some((annotation) => annotation.id === selectedId) ? selectedId : "";
  state.previewAnnotations = null;
  updateControls();
  updateInspector();
  renderEditor();
}

function undo() {
  const next = undoHistory(state.history);

  if (next === state.history) {
    return;
  }

  state.history = next;
  ensureValidSelection();
  updateControls();
  updateInspector();
  renderEditor();
  showStatus("Undid the last annotation change.");
}

function redo() {
  const next = redoHistory(state.history);

  if (next === state.history) {
    return;
  }

  state.history = next;
  ensureValidSelection();
  updateControls();
  updateInspector();
  renderEditor();
  showStatus("Redid the annotation change.");
}

function deleteSelectedAnnotation() {
  if (!state.selectedId) {
    return;
  }

  const selected = getSelectedAnnotation();
  commitAnnotations(removeAnnotation(state.history.present, state.selectedId), "");
  showStatus(`${titleCase(selected?.type || "annotation")} deleted.`);
}

function previewSelectedProperty(property, rawValue) {
  const selected = getSelectedAnnotation();

  if (!selected || !propertyAppliesToAnnotation(property, selected.type)) {
    renderPropertyOutputs();
    return;
  }

  const pixelScale = getCanvasPixelsPerCssPixel();
  const value = ["strokeWidth", "fontSize", "radius", "pixelSize"].includes(property)
    ? Number(rawValue) * pixelScale
    : rawValue;
  const updated = {
    ...selected,
    [property]: value
  };

  state.previewAnnotations = replaceAnnotation(state.history.present, updated);
  renderEditor();
}

function commitPropertyPreview() {
  if (!state.previewAnnotations || state.interaction) {
    return;
  }

  commitAnnotations(state.previewAnnotations, state.selectedId);
}

function propertyAppliesToAnnotation(property, type) {
  if (property === "color" || property === "strokeWidth") {
    return ["arrow", "rectangle", "text"].includes(type);
  }

  if (["text", "fontSize", "background"].includes(property)) {
    return type === "text";
  }

  if (property === "radius") {
    return type === "blur";
  }

  return property === "pixelSize" && type === "pixelate";
}

function mapPropertyToSetting(property) {
  return {
    color: "color",
    strokeWidth: "strokeWidth",
    text: "text",
    fontSize: "fontSize",
    background: "textBackground",
    radius: "blurRadius",
    pixelSize: "pixelSize"
  }[property];
}

function updateInspector() {
  const selected = getSelectedAnnotation();
  const activeType = selected?.type || state.tool;
  const pixelScale = getCanvasPixelsPerCssPixel();

  ui.inspectorTitle.textContent = selected
    ? `${titleCase(selected.type)} selected`
    : activeType === "select"
      ? "New annotation"
      : `New ${titleCase(activeType)}`;
  ui.deleteButton.disabled = !selected;
  ui.annotationStyleProperties.classList.toggle("is-hidden", ["blur", "pixelate"].includes(activeType));
  ui.textProperties.classList.toggle("is-hidden", activeType !== "text");
  ui.blurProperties.classList.toggle("is-hidden", activeType !== "blur");
  ui.pixelateProperties.classList.toggle("is-hidden", activeType !== "pixelate");

  if (selected) {
    if (selected.color) {
      state.settings.color = selected.color;
      ui.colorInput.value = selected.color;
    }

    if (selected.strokeWidth) {
      state.settings.strokeWidth = clampUiValue(selected.strokeWidth / pixelScale, ui.strokeWidthInput);
      ui.strokeWidthInput.value = String(state.settings.strokeWidth);
    }

    if (selected.type === "text") {
      state.settings.text = selected.text;
      state.settings.fontSize = clampUiValue(selected.fontSize / pixelScale, ui.fontSizeInput);
      state.settings.textBackground = selected.background;
      ui.textInput.value = selected.text;
      ui.fontSizeInput.value = String(state.settings.fontSize);
      ui.textBackgroundInput.checked = selected.background;
    }

    if (selected.type === "blur") {
      state.settings.blurRadius = clampUiValue(selected.radius / pixelScale, ui.blurRadiusInput);
      ui.blurRadiusInput.value = String(state.settings.blurRadius);
    }

    if (selected.type === "pixelate") {
      state.settings.pixelSize = clampUiValue(selected.pixelSize / pixelScale, ui.pixelSizeInput);
      ui.pixelSizeInput.value = String(state.settings.pixelSize);
    }
  }

  renderPropertyOutputs();
}

function renderPropertyOutputs() {
  ui.colorValue.textContent = ui.colorInput.value.toUpperCase();
  ui.strokeWidthValue.textContent = `${ui.strokeWidthInput.value} px`;
  ui.fontSizeValue.textContent = `${ui.fontSizeInput.value} px`;
  ui.blurRadiusValue.textContent = `${ui.blurRadiusInput.value} px`;
  ui.pixelSizeValue.textContent = `${ui.pixelSizeInput.value} px`;
}

function updateControls() {
  const hasImage = Boolean(state.image);
  ui.undoButton.disabled = !state.history.past.length;
  ui.redoButton.disabled = !state.history.future.length;
  ui.exportButton.disabled = !hasImage || state.exporting;
  ui.zoomInButton.disabled = !hasImage;
  ui.zoomOutButton.disabled = !hasImage;
  ui.fitButton.disabled = !hasImage;
  ui.zoomLabel.textContent = state.zoomMode === "fit" ? "Fit" : `${Math.round(state.zoom * 100)}%`;
}

function getSelectedAnnotation() {
  const source = state.previewAnnotations || state.history.present;
  return source.find((annotation) => annotation.id === state.selectedId) || null;
}

function ensureValidSelection() {
  if (!state.history.present.some((annotation) => annotation.id === state.selectedId)) {
    state.selectedId = "";
  }
}

function fitCanvas(options = {}) {
  if (!state.image) {
    return;
  }

  const horizontalPadding = 72;
  const verticalPadding = 72;
  const availableWidth = Math.max(120, ui.dropZone.clientWidth - horizontalPadding);
  const availableHeight = Math.max(120, ui.dropZone.clientHeight - verticalPadding);
  state.fitZoom = Math.max(0.03, Math.min(2.5, availableWidth / ui.canvas.width, availableHeight / ui.canvas.height));
  state.zoom = state.fitZoom;
  state.zoomMode = "fit";
  applyZoom();

  if (options.announce !== false) {
    showStatus("Canvas fitted to the available workspace.");
  }
}

function adjustZoom(multiplier) {
  if (!state.image) {
    return;
  }

  state.zoomMode = "custom";
  state.zoom = Math.max(0.03, Math.min(4, state.zoom * multiplier));
  applyZoom();
}

function applyZoom() {
  const width = Math.max(1, Math.round(ui.canvas.width * state.zoom));
  const height = Math.max(1, Math.round(ui.canvas.height * state.zoom));
  ui.canvas.style.width = `${width}px`;
  ui.canvas.style.height = `${height}px`;
  ui.canvasFrame.style.width = `${width}px`;
  ui.canvasFrame.style.height = `${height}px`;
  updateControls();
  updateInspector();
  renderEditor();
}

function handleKeyboardShortcut(event) {
  const editingText = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  const modifier = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (modifier && key === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }

  if (modifier && key === "y") {
    event.preventDefault();
    redo();
    return;
  }

  if (modifier && key === "s") {
    event.preventDefault();
    exportAnnotatedPng();
    return;
  }

  if (modifier && key === "enter" && event.target === ui.textInput) {
    event.preventDefault();
    state.settings.text = ui.textInput.value || "Note";
    createKeyboardAnnotation("text");
    return;
  }

  if (editingText) {
    return;
  }

  if (state.image && ["[", "]"].includes(event.key)) {
    event.preventDefault();
    cycleAnnotationSelection(event.key === "[" ? -1 : 1);
    ui.canvas.focus({ preventScroll: true });
    return;
  }

  if (state.image && event.target === ui.canvas && (event.key === "Enter" || event.code === "Space")) {
    event.preventDefault();

    if (state.tool === "select") {
      cycleAnnotationSelection(event.shiftKey ? -1 : 1);
    } else {
      createKeyboardAnnotation(state.tool);
    }
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();

    if (state.interaction) {
      cancelInteraction();
    } else {
      state.selectedId = "";
      updateInspector();
      renderEditor();
    }
    return;
  }

  if (["Delete", "Backspace"].includes(event.key) && state.selectedId) {
    event.preventDefault();
    deleteSelectedAnnotation();
    return;
  }

  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && state.selectedId) {
    event.preventDefault();
    nudgeSelectedAnnotation(event.key, event.shiftKey ? 10 : 1);
    return;
  }

  const tool = {
    v: "select",
    a: "arrow",
    r: "rectangle",
    t: "text",
    b: "blur",
    p: "pixelate"
  }[key];

  if (tool) {
    event.preventDefault();
    setTool(tool);

    if (state.image && tool !== "text") {
      ui.canvas.focus({ preventScroll: true });
      showStatus(`${titleCase(tool)} tool ready. Press Enter to create at the canvas center.`);
    }
  }
}

function nudgeSelectedAnnotation(key, distance) {
  const selected = getSelectedAnnotation();

  if (!selected) {
    return;
  }

  const pixelDistance = distance * getCanvasPixelsPerCssPixel();
  const deltaX = key === "ArrowLeft" ? -pixelDistance : key === "ArrowRight" ? pixelDistance : 0;
  const deltaY = key === "ArrowUp" ? -pixelDistance : key === "ArrowDown" ? pixelDistance : 0;
  const moved = translateAnnotation(selected, deltaX, deltaY, {
    width: ui.canvas.width,
    height: ui.canvas.height
  });
  commitAnnotations(replaceAnnotation(state.history.present, moved), moved.id);
}

async function exportAnnotatedPng() {
  if (!state.image || state.exporting) {
    return null;
  }

  commitPropertyPreview();
  state.exporting = true;
  updateControls();
  showStatus("Rendering the annotated PNG…");

  try {
    const blob = await getRenderedAnnotationBlob();
    const metadata = getAnnotationExportMetadata();
    const objectUrl = URL.createObjectURL(blob);
    let downloadId = null;

    if (globalThis.chrome?.downloads?.download) {
      downloadId = await chrome.downloads.download({
        url: objectUrl,
        filename: `Lumen/${metadata.filename}`,
        saveAs: true
      });
    } else {
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = metadata.filename;
      link.click();
    }

    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    window.dispatchEvent(new CustomEvent("lumen:annotation-exported", {
      detail: { blob, metadata, downloadId }
    }));
    showStatus("Annotated PNG is ready.", "success");

    return {
      blob,
      metadata,
      downloadId
    };
  } catch (error) {
    showStatus(error.message || "The annotated PNG could not be exported.", "error");
    throw error;
  } finally {
    state.exporting = false;
    updateControls();
  }
}

function canvasToBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("The browser could not render this annotated image."));
      }
    }, type);
  });
}

async function buildDemoImageBlob() {
  const canvas = document.createElement("canvas");
  canvas.width = 1440;
  canvas.height = 900;
  const context = canvas.getContext("2d");
  const background = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  background.addColorStop(0, "#07111d");
  background.addColorStop(0.52, "#10243a");
  background.addColorStop(1, "#08101b");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const glow = context.createRadialGradient(1150, 110, 20, 1150, 110, 480);
  glow.addColorStop(0, "rgba(127, 241, 197, 0.20)");
  glow.addColorStop(1, "rgba(127, 241, 197, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "#eef9fb";
  context.font = "800 52px system-ui";
  context.fillText("Capture review", 90, 116);
  context.fillStyle = "#9fb6c2";
  context.font = "24px system-ui";
  context.fillText("A safe generated workspace for Lumen Annotation Studio", 90, 160);

  drawDemoCard(context, 90, 222, 380, 245, "96.8%", "Page coverage", "Complete across 7 stitched segments");
  drawDemoCard(context, 500, 222, 380, 245, "3", "Responsive views", "Desktop, tablet, and mobile verified");
  drawDemoCard(context, 910, 222, 440, 245, "9", "Sensitive regions", "Review before external sharing");

  context.fillStyle = "rgba(255, 255, 255, 0.035)";
  context.beginPath();
  context.roundRect(90, 510, 1260, 300, 24);
  context.fill();
  context.strokeStyle = "rgba(180, 220, 233, 0.12)";
  context.stroke();
  context.fillStyle = "#eef9fb";
  context.font = "750 25px system-ui";
  context.fillText("Capture activity", 126, 560);

  const values = [0.28, 0.52, 0.43, 0.7, 0.61, 0.82, 0.76, 0.93, 0.86, 0.97];
  context.strokeStyle = "#7ff1c5";
  context.lineWidth = 6;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  values.forEach((value, index) => {
    const x = 130 + index * 128;
    const y = 760 - value * 150;
    index ? context.lineTo(x, y) : context.moveTo(x, y);
  });
  context.stroke();

  return canvasToBlob(canvas, "image/png");
}

function drawDemoCard(context, x, y, width, height, metric, label, detail) {
  context.fillStyle = "rgba(255, 255, 255, 0.045)";
  context.beginPath();
  context.roundRect(x, y, width, height, 24);
  context.fill();
  context.strokeStyle = "rgba(180, 220, 233, 0.13)";
  context.stroke();
  context.fillStyle = "#7ff1c5";
  context.font = "800 54px system-ui";
  context.fillText(metric, x + 34, y + 82);
  context.fillStyle = "#edf8fa";
  context.font = "750 23px system-ui";
  context.fillText(label, x + 34, y + 132);
  context.fillStyle = "#94abb8";
  context.font = "19px system-ui";
  context.fillText(detail, x + 34, y + 181);
}

function seedDemoAnnotations() {
  const annotations = [
    createAnnotation({
      type: "rectangle",
      x: 484,
      y: 208,
      width: 412,
      height: 274,
      color: "#ff5f87",
      strokeWidth: 7,
      fillOpacity: 0.06
    }),
    createAnnotation({
      type: "arrow",
      x1: 1130,
      y1: 520,
      x2: 1158,
      y2: 428,
      color: "#ffce70",
      strokeWidth: 8
    }),
    createAnnotation({
      type: "text",
      x: 846,
      y: 612,
      width: 420,
      height: 112,
      text: "Ready for review",
      color: "#7ff1c5",
      strokeWidth: 5,
      fontSize: 37,
      background: true
    }),
    createAnnotation({
      type: "pixelate",
      x: 1078,
      y: 353,
      width: 218,
      height: 64,
      pixelSize: 15
    })
  ];

  state.history = commitHistory(state.history, annotations);
  state.selectedId = annotations[0].id;
  updateControls();
  updateInspector();
  renderEditor();
}

function notifyEditorReady() {
  if (globalThis.chrome?.runtime?.sendMessage) {
    chrome.runtime.sendMessage({
      type: "LUMEN_EDITOR_READY",
      payload: {
        loaded: Boolean(state.image),
        captureId: state.source.captureId
      }
    }).catch(() => {});
  }

  window.dispatchEvent(new CustomEvent("lumen:annotation-editor-ready", {
    detail: {
      loaded: Boolean(state.image),
      metadata: state.image ? getAnnotationExportMetadata() : null
    }
  }));
}

function showStatus(message, tone = "neutral") {
  ui.statusMessage.textContent = message;
  ui.statusMessage.dataset.tone = tone;
}

function releaseSourceObjectUrl() {
  if (state.imageObjectUrl) {
    URL.revokeObjectURL(state.imageObjectUrl);
    state.imageObjectUrl = "";
  }
}

function colorWithAlpha(color, alpha) {
  const normalized = String(color || "#ff5f87").replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha))})`;
}

function clampUiValue(value, input) {
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  return Math.round(Math.max(minimum, Math.min(maximum, Number(value) || minimum)));
}

function removeFileExtension(filename) {
  return String(filename || "capture").replace(/\.(png|jpe?g|webp)$/i, "") || "capture";
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
