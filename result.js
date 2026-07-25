import {
  buildExportFilename,
  createImagePdfBlob,
  createPngBlobFromImage,
  downloadBlob
} from "./export-utils.js";
import {
  connectGoogleDrive,
  getDriveExportStatus,
  readDriveOAuthConfiguration,
  uploadReviewedImageToDrive
} from "./drive-export.js";
import {
  getLibraryCapture,
  updateLibraryReview
} from "./library-store.js";
import { readAppSettings } from "./settings-store.js";

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;

const ui = {
  resultHost: document.querySelector("#resultHost"),
  resultTitle: document.querySelector("#resultTitle"),
  resultSource: document.querySelector("#resultSource"),
  resultViewport: document.querySelector("#resultViewport"),
  resultImage: document.querySelector("#resultImage"),
  loadingState: document.querySelector("#loadingState"),
  emptyState: document.querySelector("#emptyState"),
  emptyStateTitle: document.querySelector("#emptyStateTitle"),
  emptyStateDescription: document.querySelector("#emptyStateDescription"),
  resultStatus: document.querySelector("#resultStatus"),
  capturedAtValue: document.querySelector("#capturedAtValue"),
  dimensionsValue: document.querySelector("#dimensionsValue"),
  filesValue: document.querySelector("#filesValue"),
  privacyValue: document.querySelector("#privacyValue"),
  copyImageButton: document.querySelector("#copyImageButton"),
  downloadPngButton: document.querySelector("#downloadPngButton"),
  exportPdfButton: document.querySelector("#exportPdfButton"),
  annotateButton: document.querySelector("#annotateButton"),
  driveButton: document.querySelector("#driveButton"),
  openOriginalButton: document.querySelector("#openOriginalButton"),
  showOriginalButton: document.querySelector("#showOriginalButton"),
  openLibraryButton: document.querySelector("#openLibraryButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  actualSizeButton: document.querySelector("#actualSizeButton"),
  fitButton: document.querySelector("#fitButton"),
  zoomLabel: document.querySelector("#zoomLabel"),
  privacyNote: document.querySelector("#privacyNote")
};

const state = {
  captureId: "",
  capture: null,
  source: null,
  objectUrl: "",
  png: null,
  zoom: 1,
  fitZoom: 1,
  zoomMode: "fit",
  busy: false,
  originalDownload: null,
  savedDownloads: [],
  imageHasTransparency: false
};

initialize().catch((error) => showFatalError(error));

async function initialize() {
  bindEvents();
  document.body.dataset.state = "loading";
  const parameters = new URLSearchParams(location.search);
  state.captureId = parameters.get("captureId") || parameters.get("capture") || "";

  if (!state.captureId) {
    throw new Error("No capture was selected. Open a result from Lumen or its local library.");
  }

  state.capture = await getLibraryCapture(state.captureId, {
    includePreview: true,
    includeEditorSource: true,
    includePdfSource: true
  });

  if (!state.capture) {
    throw new Error("This capture is no longer available in Lumen’s local library.");
  }

  state.source = selectBestImageSource(state.capture);
  state.savedDownloads = await reconcileUsableDownloads(state.capture.downloads);
  state.originalDownload = selectPrimaryDownload(state.savedDownloads);
  renderCaptureDetails();
  await configureDriveAction();

  if (!state.source?.blob) {
    renderUnavailableImage();
    return;
  }

  await loadResultImage(state.source.blob);
  syncActionAvailability();
  document.body.dataset.state = state.source.limited ? "limited" : "ready";
  document.body.setAttribute("aria-busy", "false");
  setStatus(
    state.source.limited
      ? "A local working preview is ready. Copy and PNG use this preview; PDF and saved-file actions use the retained capture formats."
      : "Ready. Copy it, download another format, or open the editor.",
    "success"
  );
}

function bindEvents() {
  ui.copyImageButton.addEventListener("click", copyImage);
  ui.downloadPngButton.addEventListener("click", downloadPng);
  ui.exportPdfButton.addEventListener("click", exportPdf);
  ui.annotateButton.addEventListener("click", openAnnotationStudio);
  ui.driveButton.addEventListener("click", exportToDrive);
  ui.openOriginalButton.addEventListener("click", () => runOriginalAction("open"));
  ui.showOriginalButton.addEventListener("click", () => runOriginalAction("show"));
  ui.openLibraryButton.addEventListener("click", openLibrary);
  ui.zoomOutButton.addEventListener("click", () => adjustZoom(1 / ZOOM_STEP));
  ui.zoomInButton.addEventListener("click", () => adjustZoom(ZOOM_STEP));
  ui.actualSizeButton.addEventListener("click", () => setZoom(1, "actual"));
  ui.fitButton.addEventListener("click", fitImage);
  ui.resultViewport.addEventListener("wheel", handleViewerWheel, { passive: false });
  document.addEventListener("keydown", handleKeyboardShortcut);
  window.addEventListener("resize", handleResize);
  window.addEventListener("beforeunload", releaseObjectUrl);
}

function selectBestImageSource(capture) {
  if (capture.editorSource?.blob) {
    const source = capture.editorSource;
    const isCutaway = source.role === "cutaway";
    return {
      blob: source.blob,
      width: source.width || capture.editorSourceWidth || 0,
      height: source.height || capture.editorSourceHeight || 0,
      originalWidth: source.originalWidth || capture.editorSourceOriginalWidth || source.width || 0,
      originalHeight: source.originalHeight || capture.editorSourceOriginalHeight || source.height || 0,
      limited: Boolean(source.scaled ?? capture.editorSourceScaled),
      role: source.role || "full-page",
      label: isCutaway
        ? "Selected-area image"
        : Boolean(source.scaled ?? capture.editorSourceScaled)
          ? "Local editing proxy"
          : "Full local image"
    };
  }

  if (capture.preview?.blob) {
    const isCutaway = capture.preview.role === "cutaway";
    return {
      blob: capture.preview.blob,
      width: capture.preview.width || 0,
      height: capture.preview.height || 0,
      originalWidth: capture.dimensions?.width || capture.preview.width || 0,
      originalHeight: capture.dimensions?.height || capture.preview.height || 0,
      limited: true,
      role: capture.preview.role || "full-page",
      label: isCutaway ? "Selected-area preview" : "Gallery preview"
    };
  }

  return null;
}

function listUsableDownloads(downloads = []) {
  return (Array.isArray(downloads) ? downloads : []).filter((item) =>
    Number.isInteger(item?.downloadId) && item.complete !== false
  );
}

async function reconcileUsableDownloads(downloads = []) {
  if (typeof chrome.downloads?.search !== "function") {
    return [];
  }

  const checked = await Promise.all(listUsableDownloads(downloads).map(async (stored) => {
    try {
      const [download] = await chrome.downloads.search({ id: stored.downloadId });

      if (!download || download.state !== "complete" || download.exists === false) {
        return null;
      }

      return {
        ...stored,
        filename: stored.filename || download.filename || "",
        bytesReceived: stored.bytesReceived || download.bytesReceived || 0,
        complete: true
      };
    } catch {
      return null;
    }
  }));

  return checked.filter(Boolean);
}

function selectPrimaryDownload(downloads = []) {
  const records = listUsableDownloads(downloads);
  return records.find((item) =>
    Number.isInteger(item?.downloadId) && item.kind === "image" && item.role === "full-page" && item.complete !== false
  ) || records.find((item) =>
    Number.isInteger(item?.downloadId) && item.kind === "image" && item.complete !== false
  ) || records.find((item) => item.kind !== "manifest") || records[0] || null;
}

function renderCaptureDetails() {
  const capture = state.capture;
  const dimensions = capture.dimensions || {};
  const imageWidth = state.source?.originalWidth || dimensions.width || 0;
  const imageHeight = state.source?.originalHeight || dimensions.height || 0;
  const sourceLabel = state.source?.label || describeRetainedFormats();
  const qualityDetail = state.source?.limited && state.source.width && state.source.height
    ? ` ${formatDimensions(state.source.width, state.source.height)} retained for quick review.`
    : "";
  const savedFileCount = state.savedDownloads.length;

  document.title = `${capture.title || capture.host || "Capture"} — Lumen`;
  ui.resultHost.textContent = capture.host || formatHost(capture.url) || "Local capture";
  ui.resultTitle.textContent = capture.title || "Saved capture";
  ui.resultSource.textContent = `${sourceLabel}.${qualityDetail}`.trim();
  ui.capturedAtValue.textContent = formatTimestamp(capture.capturedAt);
  ui.dimensionsValue.textContent = imageWidth && imageHeight ? formatDimensions(imageWidth, imageHeight) : "Unknown";
  ui.filesValue.textContent = savedFileCount
    ? `${savedFileCount} saved ${savedFileCount === 1 ? "file" : "files"}`
    : "No attached files";
  ui.privacyValue.textContent = capture.sourceType === "timed"
    ? "Local timed capture"
    : savedFileCount
      ? "Browser + Downloads"
      : "Private browser data";
  ui.resultImage.alt = `${capture.title || capture.host || "Webpage"} capture`;
  renderFileActions();
  renderPrivacyNote();
  syncActionAvailability();
}

async function loadResultImage(blob) {
  releaseObjectUrl();
  state.objectUrl = URL.createObjectURL(blob);
  ui.resultImage.src = state.objectUrl;
  await decodeImage(ui.resultImage);
  state.imageHasTransparency = detectImageTransparency(ui.resultImage);
  ui.resultImage.classList.toggle("is-transparent-image", state.imageHasTransparency);
  ui.resultViewport.classList.toggle("has-transparent-image", state.imageHasTransparency);

  if (state.imageHasTransparency && state.source?.role === "cutaway") {
    state.source.label = "Transparent lasso crop";
    renderSourceDescription();
  }

  state.source.width ||= ui.resultImage.naturalWidth;
  state.source.height ||= ui.resultImage.naturalHeight;
  ui.loadingState.hidden = true;
  ui.emptyState.hidden = true;
  ui.resultImage.hidden = false;
  requestAnimationFrame(() => fitImage({ announce: false }));
}

function renderUnavailableImage() {
  const hasCachedPdf = Boolean(state.capture?.pdfSource?.blob);
  const savedFileCount = state.savedDownloads.length;

  ui.loadingState.hidden = true;
  ui.resultImage.hidden = true;
  ui.emptyState.hidden = false;
  ui.resultImage.classList.remove("is-transparent-image");
  ui.resultViewport.classList.remove("has-transparent-image");
  syncActionAvailability();
  document.body.dataset.state = "limited";
  document.body.setAttribute("aria-busy", "false");

  if (hasCachedPdf && savedFileCount) {
    ui.emptyStateTitle.textContent = "The working preview was removed to save space.";
    ui.emptyStateDescription.textContent = "Your cached PDF and saved files are still available from the actions beside the viewer.";
    setStatus("The image preview is unavailable. Export PDF or use the saved-file actions.", "success");
  } else if (hasCachedPdf) {
    ui.emptyStateTitle.textContent = "The working preview was removed to save space.";
    ui.emptyStateDescription.textContent = "A cached PDF remains ready to export from this device.";
    setStatus("The image preview is unavailable, but the cached PDF remains available.", "success");
  } else if (savedFileCount) {
    ui.emptyStateTitle.textContent = "The working preview was removed to save space.";
    ui.emptyStateDescription.textContent = `${savedFileCount} saved ${savedFileCount === 1 ? "file remains" : "files remain"} available through Chrome Downloads.`;
    setStatus("The image preview is unavailable. Use the saved-file actions to reach the downloaded capture.", "success");
  } else {
    ui.emptyStateTitle.textContent = "This capture no longer has a working image.";
    ui.emptyStateDescription.textContent = "Its local metadata remains, but there is no preview, cached PDF, or attached download to open.";
    setStatus("No retained capture format is available from this workspace.", "error");
  }
}

function syncActionAvailability() {
  const hasImage = Boolean(state.source?.blob);
  const hasPdf = Boolean(state.capture?.pdfSource?.blob);
  const hasDownload = Boolean(state.originalDownload);

  ui.copyImageButton.disabled = !hasImage;
  ui.downloadPngButton.disabled = !hasImage;
  ui.exportPdfButton.disabled = !(hasImage || hasPdf);
  ui.annotateButton.disabled = !hasImage;
  ui.zoomOutButton.disabled = !hasImage;
  ui.zoomInButton.disabled = !hasImage;
  ui.actualSizeButton.disabled = !hasImage;
  ui.fitButton.disabled = !hasImage;
  ui.driveButton.disabled = !hasImage;
  ui.openOriginalButton.disabled = !hasDownload;
  ui.showOriginalButton.disabled = !hasDownload;
}

function describeRetainedFormats() {
  const hasCachedPdf = Boolean(state.capture?.pdfSource?.blob);
  const savedFileCount = state.savedDownloads.length;

  if (hasCachedPdf && savedFileCount) {
    return `Preview unavailable; cached PDF and ${savedFileCount} saved ${savedFileCount === 1 ? "file remain" : "files remain"}`;
  }

  if (hasCachedPdf) {
    return "Preview unavailable; cached PDF remains";
  }

  if (savedFileCount) {
    return `Preview unavailable; ${savedFileCount} saved ${savedFileCount === 1 ? "file remains" : "files remain"}`;
  }

  return "No retained image or saved file";
}

function renderSourceDescription() {
  const sourceLabel = state.source?.label || describeRetainedFormats();
  const qualityDetail = state.source?.limited && state.source.width && state.source.height
    ? ` ${formatDimensions(state.source.width, state.source.height)} retained for quick review.`
    : "";
  ui.resultSource.textContent = `${sourceLabel}.${qualityDetail}`.trim();
}

function renderFileActions() {
  const download = state.originalDownload;
  const savedFileCount = state.savedDownloads.length;

  if (!download) {
    ui.openOriginalButton.textContent = "No saved file";
    ui.openOriginalButton.title = "This capture has no attached Chrome download.";
    ui.showOriginalButton.textContent = "Show in folder";
    ui.showOriginalButton.title = "This capture has no attached Chrome download.";
    return;
  }

  const openLabel = describeOpenAction(download, countSavedImages());
  ui.openOriginalButton.textContent = openLabel;
  ui.openOriginalButton.title = `${openLabel} from Chrome Downloads`;
  ui.showOriginalButton.textContent = savedFileCount > 1 ? "Show files in folder" : "Show in folder";
  ui.showOriginalButton.title = savedFileCount > 1
    ? `Reveal the selected file beside ${savedFileCount - 1} other saved ${savedFileCount === 2 ? "file" : "files"}`
    : "Reveal the saved file in its folder";
}

function describeOpenAction(download, imageFileCount) {
  if (download.kind === "image" && download.role === "cutaway") {
    return "Open saved crop";
  }

  if (download.kind === "image" && Number(download.partTotal) > 1) {
    return `Open tile ${Math.max(1, Number(download.partIndex) || 1)} of ${download.partTotal}`;
  }

  if (download.kind === "image") {
    return imageFileCount > 1 ? "Open first saved image" : "Open saved image";
  }

  if (download.kind === "html" || download.role === "print-sheet") {
    return "Open print sheet";
  }

  if (download.kind === "manifest") {
    return "Open capture details";
  }

  return "Open saved file";
}

function countSavedImages() {
  return state.savedDownloads.filter((download) => download.kind === "image").length;
}

function renderPrivacyNote() {
  const hasImage = Boolean(state.source?.blob);
  const hasCachedPdf = Boolean(state.capture?.pdfSource?.blob);
  const hasBrowserAsset = hasImage || hasCachedPdf;
  const savedFileCount = state.savedDownloads.length;
  const retainedDescription = hasImage && hasCachedPdf
    ? "working image and cached PDF"
    : hasImage
      ? "working image"
      : "cached PDF";

  if (hasBrowserAsset && savedFileCount) {
    ui.privacyNote.textContent = `Lumen keeps its ${retainedDescription} in this browser. Saved files are already in Chrome Downloads. Nothing is sent to Drive unless you choose that action.`;
  } else if (savedFileCount) {
    ui.privacyNote.textContent = "The working copy is no longer stored in Lumen. Saved files remain in Chrome Downloads; nothing is sent to Drive unless you choose that action.";
  } else if (hasBrowserAsset) {
    ui.privacyNote.textContent = `Lumen keeps its ${retainedDescription} in this browser. Nothing is sent to Drive unless you choose that action.`;
  } else {
    ui.privacyNote.textContent = "Only local capture metadata remains in Lumen. No image or file is sent anywhere from this workspace.";
  }
}

async function ensurePng() {
  if (!state.source?.blob) {
    throw new Error("This capture has no retained local image to export.");
  }

  state.png ||= await createPngBlobFromImage(state.source.blob);
  return state.png;
}

async function copyImage() {
  await runBusyAction("Copying image…", async () => {
    if (!navigator.clipboard?.write || typeof ClipboardItem !== "function") {
      throw new Error("Chrome did not make image clipboard access available on this page.");
    }

    const png = await ensurePng();
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": png.blob })
    ]);
    setStatus(`Copied ${formatDimensions(png.width, png.height)} PNG to the clipboard.`, "success");
  });
}

async function downloadPng() {
  await runBusyAction("Preparing PNG…", async () => {
    const png = await ensurePng();
    const filename = buildExportFilename(state.capture.title || state.capture.host, "result", "png");
    await downloadBlob(png.blob, filename, { folder: "Lumen", saveAs: false });
    setStatus(`${filename} saved to Downloads.`, "success");
  });
}

async function exportPdf() {
  await runBusyAction("Preparing PDF…", async () => {
    const cached = state.capture.pdfSource?.blob ? state.capture.pdfSource : null;

    if (!cached && !state.source?.blob) {
      throw new Error("This capture has no retained image or cached PDF to export.");
    }

    const pdf = cached || await createImagePdfBlob(state.source.blob, {
      sourceExact: !state.source.limited
    });
    const filename = buildExportFilename(state.capture.title || state.capture.host, "result", "pdf");
    await downloadBlob(pdf.blob, filename, { folder: "Lumen", saveAs: false });
    const pageCount = cached?.pageCount || pdf.pageCount || 1;
    const qualifier = cached?.sourceExact === false || (!cached && state.source.limited)
      ? " from the retained review source"
      : "";
    setStatus(`${filename} saved as ${pageCount} ${pageCount === 1 ? "page" : "pages"}${qualifier}.`, "success");
  });
}

async function openAnnotationStudio() {
  await runBusyAction("Opening Annotation Studio…", async () => {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_OPEN_ANNOTATION_EDITOR",
      payload: { captureId: state.captureId }
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Annotation Studio could not open.");
    }

    setStatus("Annotation Studio opened in a new tab.", "success");
  });
}

async function configureDriveAction() {
  const configuration = readDriveOAuthConfiguration();
  const appSettings = await readAppSettings();

  if (!configuration.configured || appSettings.localOnlyMode) {
    ui.driveButton.hidden = true;
    return;
  }

  ui.driveButton.hidden = false;
  const status = await getDriveExportStatus().catch(() => ({ connected: false }));
  ui.driveButton.textContent = status.connected ? "Export to Google Drive" : "Connect & export to Drive";
  ui.driveButton.disabled = !state.source?.blob;
}

async function exportToDrive() {
  await runBusyAction("Preparing reviewed Drive export…", async () => {
    await connectGoogleDrive();
    const png = await ensurePng();
    const exportedAt = new Date().toISOString();
    const filename = buildExportFilename(state.capture.title || state.capture.host, "reviewed", "png");
    const upload = await uploadReviewedImageToDrive({
      blob: png.blob,
      filename,
      captureId: state.captureId,
      sourceUrl: state.capture.url || "",
      reviewedAt: exportedAt,
      description: "Reviewed capture exported from the Lumen result workspace."
    });
    const previousExports = Array.isArray(state.capture.review?.driveExports)
      ? state.capture.review.driveExports
      : [];

    state.capture = await updateLibraryReview(state.captureId, {
      status: "exported",
      lastReviewedAt: exportedAt,
      lastExportedAt: exportedAt,
      driveExports: [{
        id: upload.file.id,
        name: upload.file.name,
        webViewLink: upload.file.webViewLink,
        exportedAt
      }, ...previousExports]
    });
    setStatus(`${upload.file.name} saved to Drive.`, "success", upload.file.webViewLink);
    ui.driveButton.textContent = "Export to Google Drive";
  });
}

async function runOriginalAction(action) {
  if (!state.originalDownload) {
    setStatus("Chrome no longer has a local handle for this saved file.", "error");
    return;
  }

  const openLabel = describeOpenAction(state.originalDownload, countSavedImages());
  const openedName = openLabel.replace(/^Open\s+/i, "");
  const openedMessage = `${openedName.charAt(0).toUpperCase()}${openedName.slice(1)} opened.`;
  await runBusyAction(action === "open" ? `${openLabel.replace(/^Open/, "Opening")}…` : "Opening the saved-file location…", async () => {
    const response = await chrome.runtime.sendMessage({
      type: action === "open" ? "LUMEN_OPEN_LIBRARY_PHOTO" : "LUMEN_SHOW_LIBRARY_PHOTO",
      payload: {
        captureId: state.captureId,
        downloadId: state.originalDownload.downloadId
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Chrome could not access the saved download.");
    }

    setStatus(
      action === "open"
        ? openedMessage
        : state.savedDownloads.length > 1
          ? "Saved files shown in their folder."
          : "Saved file shown in its folder.",
      "success"
    );
  });
}

function openLibrary() {
  location.href = chrome.runtime.getURL(`library.html?capture=${encodeURIComponent(state.captureId)}`);
}

async function runBusyAction(message, action) {
  if (state.busy) {
    return;
  }

  state.busy = true;
  document.body.dataset.busy = "true";
  document.body.setAttribute("aria-busy", "true");
  setStatus(message, "neutral");

  try {
    await action();
  } catch (error) {
    setStatus(error?.message || "That result action did not complete.", "error");
  } finally {
    state.busy = false;
    document.body.dataset.busy = "false";
    document.body.setAttribute("aria-busy", "false");
  }
}

function fitImage(options = {}) {
  if (ui.resultImage.hidden || !ui.resultImage.naturalWidth) {
    return;
  }

  const availableWidth = Math.max(1, ui.resultViewport.clientWidth - 48);
  state.fitZoom = clampZoom(Math.min(1, availableWidth / ui.resultImage.naturalWidth));
  setZoom(state.fitZoom, "fit", options);
}

function adjustZoom(multiplier) {
  setZoom(state.zoom * multiplier, "custom");
}

function setZoom(value, mode = "custom", options = {}) {
  if (ui.resultImage.hidden || !ui.resultImage.naturalWidth) {
    return;
  }

  state.zoom = clampZoom(value);
  state.zoomMode = mode;
  ui.resultImage.style.width = `${Math.max(1, Math.round(ui.resultImage.naturalWidth * state.zoom))}px`;
  ui.resultImage.style.height = `${Math.max(1, Math.round(ui.resultImage.naturalHeight * state.zoom))}px`;
  ui.zoomLabel.textContent = mode === "fit" ? "Fit" : `${Math.round(state.zoom * 100)}%`;
  ui.zoomOutButton.disabled = state.zoom <= MIN_ZOOM + 0.001;
  ui.zoomInButton.disabled = state.zoom >= MAX_ZOOM - 0.001;
  ui.actualSizeButton.disabled = false;
  ui.fitButton.disabled = false;
  ui.actualSizeButton.setAttribute("aria-pressed", String(mode === "actual"));
  ui.fitButton.setAttribute("aria-pressed", String(mode === "fit"));

  if (options.announce !== false) {
    setStatus(mode === "fit" ? "Capture fitted to the viewer width." : `Zoom set to ${Math.round(state.zoom * 100)}%.`, "neutral");
  }
}

function handleViewerWheel(event) {
  if (!(event.metaKey || event.ctrlKey) || ui.resultImage.hidden) {
    return;
  }

  event.preventDefault();
  const viewportRect = ui.resultViewport.getBoundingClientRect();
  const pointerX = event.clientX - viewportRect.left + ui.resultViewport.scrollLeft;
  const pointerY = event.clientY - viewportRect.top + ui.resultViewport.scrollTop;
  const previousZoom = state.zoom;
  const nextZoom = clampZoom(previousZoom * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));

  setZoom(nextZoom, "custom", { announce: false });
  const ratio = nextZoom / previousZoom;
  ui.resultViewport.scrollLeft = pointerX * ratio - (event.clientX - viewportRect.left);
  ui.resultViewport.scrollTop = pointerY * ratio - (event.clientY - viewportRect.top);
  ui.zoomLabel.textContent = `${Math.round(nextZoom * 100)}%`;
}

function handleKeyboardShortcut(event) {
  const command = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (command && key === "c") {
    if (ui.copyImageButton.disabled) {
      return;
    }

    event.preventDefault();
    copyImage();
    return;
  }

  if (command && key === "s") {
    const actionDisabled = event.shiftKey ? ui.exportPdfButton.disabled : ui.downloadPngButton.disabled;

    if (actionDisabled) {
      return;
    }

    event.preventDefault();
    event.shiftKey ? exportPdf() : downloadPng();
    return;
  }

  if (command || event.altKey) {
    return;
  }

  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    adjustZoom(ZOOM_STEP);
  } else if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    adjustZoom(1 / ZOOM_STEP);
  } else if (event.key === "0") {
    event.preventDefault();
    fitImage();
  } else if (event.key === "1") {
    event.preventDefault();
    setZoom(1, "actual");
  }
}

function handleResize() {
  if (state.zoomMode === "fit") {
    fitImage({ announce: false });
  }
}

function setStatus(message, tone = "neutral", link = "") {
  ui.resultStatus.dataset.tone = tone;
  ui.resultStatus.replaceChildren(document.createTextNode(message));

  if (link) {
    const anchor = document.createElement("a");
    anchor.href = link;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = " Open file";
    ui.resultStatus.append(anchor);
  }
}

function showFatalError(error) {
  document.body.dataset.state = "error";
  document.body.dataset.busy = "false";
  document.body.setAttribute("aria-busy", "false");
  ui.loadingState.hidden = true;
  ui.resultImage.hidden = true;
  ui.emptyState.hidden = false;
  ui.emptyStateTitle.textContent = "This result could not open.";
  ui.emptyStateDescription.textContent = error?.message || "The local capture is unavailable.";
  ui.resultTitle.textContent = "Capture unavailable";
  ui.resultSource.textContent = "Open Lumen’s library to choose another capture.";
  state.source = null;
  state.originalDownload = null;
  state.savedDownloads = [];
  syncActionAvailability();
  setStatus(error?.message || "The capture result could not load.", "error");
}

function decodeImage(image) {
  if (image.complete && image.naturalWidth) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => reject(new Error("The local capture image could not be decoded.")), { once: true });
  });
}

function detectImageTransparency(image) {
  if (!image?.naturalWidth || !image?.naturalHeight) {
    return false;
  }

  const sampleWidth = Math.max(1, Math.min(64, image.naturalWidth));
  const sampleHeight = Math.max(1, Math.min(64, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });

  if (!context) {
    return false;
  }

  try {
    context.clearRect(0, 0, sampleWidth, sampleHeight);
    context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
    const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;

    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 250) {
        return true;
      }
    }
  } catch {
    return false;
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }

  return false;
}

function releaseObjectUrl() {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = "";
  }
}

function clampZoom(value) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(value) || 1));
}

function formatDimensions(width, height) {
  return `${Math.max(0, Math.round(width || 0)).toLocaleString()}×${Math.max(0, Math.round(height || 0)).toLocaleString()}`;
}

function formatTimestamp(value) {
  const timestamp = Date.parse(value || "");

  if (!Number.isFinite(timestamp)) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function formatHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}
