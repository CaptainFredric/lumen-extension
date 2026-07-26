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

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 64;
const ZOOM_STEP = 1.25;

const ui = {
  topbar: document.querySelector(".topbar"),
  resultShell: document.querySelector(".result-shell"),
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
  detailsDimensionsValue: document.querySelector("#detailsDimensionsValue"),
  viewHint: document.querySelector("#viewHint"),
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
  detailsButton: document.querySelector("#detailsButton"),
  detailsPanel: document.querySelector("#detailsPanel"),
  detailsBackdrop: document.querySelector("#detailsBackdrop"),
  closeDetailsButton: document.querySelector("#closeDetailsButton"),
  settingsButton: document.querySelector("#settingsButton"),
  deleteCaptureButton: document.querySelector("#deleteCaptureButton"),
  deleteDialog: document.querySelector("#deleteDialog"),
  cancelDeleteButton: document.querySelector("#cancelDeleteButton"),
  confirmDeleteButton: document.querySelector("#confirmDeleteButton"),
  zoomOutButton: document.querySelector("#zoomOutButton"),
  zoomInButton: document.querySelector("#zoomInButton"),
  actualSizeButton: document.querySelector("#actualSizeButton"),
  fitPageButton: document.querySelector("#fitPageButton"),
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
  pageZoom: 1,
  zoomMode: "page",
  busy: false,
  originalDownload: null,
  savedDownloads: [],
  imageHasTransparency: false,
  statusTimer: 0,
  pan: {
    active: false,
    pointerId: null,
    originX: 0,
    originY: 0,
    scrollLeft: 0,
    scrollTop: 0
  }
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
  ui.detailsButton.addEventListener("click", () => toggleDetailsPanel());
  ui.closeDetailsButton.addEventListener("click", () => toggleDetailsPanel(false));
  ui.detailsBackdrop.addEventListener("click", () => toggleDetailsPanel(false));
  ui.settingsButton.addEventListener("click", openSettings);
  ui.deleteCaptureButton.addEventListener("click", openDeleteDialog);
  ui.confirmDeleteButton.addEventListener("click", removeCapture);
  ui.zoomOutButton.addEventListener("click", () => adjustZoom(1 / ZOOM_STEP));
  ui.zoomInButton.addEventListener("click", () => adjustZoom(ZOOM_STEP));
  ui.actualSizeButton.addEventListener("click", () => setZoom(1, "actual"));
  ui.fitPageButton.addEventListener("click", fitPage);
  ui.fitButton.addEventListener("click", fitWidth);
  ui.resultViewport.addEventListener("wheel", handleViewerWheel, { passive: false });
  ui.resultViewport.addEventListener("pointerdown", beginPan);
  ui.resultViewport.addEventListener("pointermove", continuePan);
  ui.resultViewport.addEventListener("pointerup", endPan);
  ui.resultViewport.addEventListener("pointercancel", endPan);
  ui.resultViewport.addEventListener("dblclick", toggleActualSize);
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
      completePage: true,
      sourceKind: "editor-source",
      role: source.role || "full-page",
      label: isCutaway
        ? "Selected-area image"
        : Boolean(source.scaled ?? capture.editorSourceScaled)
          ? "Complete-page review image"
          : "Full-resolution local image"
    };
  }

  if (capture.preview?.blob) {
    const isCutaway = capture.preview.role === "cutaway";
    return {
      blob: capture.preview.blob,
      width: 0,
      height: 0,
      originalWidth: capture.dimensions?.width || capture.preview.width || 0,
      originalHeight: capture.dimensions?.height || capture.preview.height || 0,
      limited: true,
      completePage: false,
      sourceKind: "gallery-thumbnail",
      role: capture.preview.role || "full-page",
      label: isCutaway ? "Cropped selected-area thumbnail" : "Cropped gallery thumbnail"
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
  const originalWidth = state.source?.originalWidth || dimensions.width || state.source?.width || 0;
  const originalHeight = state.source?.originalHeight || dimensions.height || state.source?.height || 0;
  const completePage = state.source?.completePage !== false;
  const reviewWidth = state.source?.width || (completePage ? originalWidth : 0);
  const reviewHeight = state.source?.height || (completePage ? originalHeight : 0);
  const sourceLabel = state.source?.label || describeRetainedFormats();
  const savedFileCount = state.savedDownloads.length;
  const savedOriginals = savedFileCount
    ? `${savedFileCount} saved ${savedFileCount === 1 ? "file remains" : "files remain"} in Downloads.`
    : "No full-resolution saved file is still attached.";
  const qualityDetail = state.source?.limited && reviewWidth && reviewHeight
    ? completePage
      ? ` ${formatDimensions(reviewWidth, reviewHeight)} complete-page review image. ${savedOriginals}`
      : ` ${formatDimensions(reviewWidth, reviewHeight)} cropped thumbnail, not the whole capture. ${savedOriginals}`
    : "";

  document.title = `${capture.title || capture.host || "Capture"} — Lumen`;
  ui.resultHost.textContent = capture.host || formatHost(capture.url) || "Local capture";
  ui.resultTitle.textContent = capture.title || "Saved capture";
  ui.resultSource.textContent = `${sourceLabel}.${qualityDetail}`.trim();
  ui.capturedAtValue.textContent = formatTimestamp(capture.capturedAt);
  ui.dimensionsValue.textContent = reviewWidth && reviewHeight
    ? `${formatDimensions(reviewWidth, reviewHeight)}${
      state.source?.limited ? completePage ? " review" : " thumbnail" : ""
    }`
    : "Unknown";
  ui.detailsDimensionsValue.textContent = originalWidth && originalHeight
    ? formatDimensions(originalWidth, originalHeight)
    : "Unknown";
  ui.detailsDimensionsValue.title = state.source?.limited && reviewWidth && reviewHeight
    ? `Original capture ${formatDimensions(originalWidth, originalHeight)}; local ${
      completePage ? "review image" : "cropped thumbnail"
    } ${formatDimensions(reviewWidth, reviewHeight)}`
    : ui.detailsDimensionsValue.textContent;
  ui.filesValue.textContent = savedFileCount
    ? `${savedFileCount} saved ${savedFileCount === 1 ? "file" : "files"}`
    : "No attached files";
  ui.privacyValue.textContent = capture.sourceType === "timed"
    ? "Local timed capture"
    : savedFileCount
      ? "Browser + Downloads"
      : "Private browser data";
  ui.resultImage.alt = `${capture.title || capture.host || "Webpage"} capture`;
  ui.viewHint.textContent = !completePage
    ? `Cropped thumbnail only. ${savedOriginals}`
    : state.source?.limited
      ? `Complete-page review view. ${savedOriginals}`
    : "Full-resolution capture. Drag to pan or choose a view.";
  renderFileActions();
  renderPrivacyNote();
  renderExportSemantics();
  syncActionAvailability();
}

function renderExportSemantics() {
  const limited = Boolean(state.source?.limited);
  const thumbnailOnly = state.source?.completePage === false;
  const savedOriginalNote = state.savedDownloads.length
    ? "Saved full-resolution files are unchanged."
    : "No full-resolution saved file is attached.";
  const copyLabel = ui.copyImageButton.querySelector("span:last-child");
  const pngLabel = ui.downloadPngButton.querySelector("span:last-child");
  const editLabel = ui.annotateButton.querySelector("span:last-child");

  if (copyLabel) {
    copyLabel.textContent = thumbnailOnly ? "Copy thumb" : limited ? "Copy view" : "Copy";
  }

  if (pngLabel) {
    pngLabel.textContent = thumbnailOnly ? "Thumb PNG" : limited ? "View PNG" : "PNG";
  }

  if (editLabel) {
    editLabel.textContent = thumbnailOnly ? "Edit" : limited ? "Edit view" : "Edit";
  }

  ui.copyImageButton.title = thumbnailOnly
    ? "Copy the cropped gallery thumbnail"
    : limited
    ? `Copy the complete-page review image. ${savedOriginalNote}`
    : "Copy the full-resolution image";
  ui.downloadPngButton.title = thumbnailOnly
    ? "Download the cropped gallery thumbnail as PNG"
    : limited
    ? `Download the complete-page review image as PNG. ${savedOriginalNote}`
    : "Download a full-resolution PNG";
  ui.actualSizeButton.title = thumbnailOnly
    ? "Show the retained thumbnail at 100% (1)"
    : limited
    ? "Show the retained review image at 100% (1)"
    : "Show actual pixels (1)";
  ui.annotateButton.title = thumbnailOnly
    ? "Editing is unavailable because only a cropped gallery thumbnail remains."
    : limited
    ? `Annotate the complete-page review image. ${savedOriginalNote}`
    : "Open the full-resolution image in Annotation Studio";
  ui.fitPageButton.textContent = thumbnailOnly ? "Image" : "Page";
  ui.fitPageButton.title = thumbnailOnly ? "Fit the retained thumbnail (0)" : "Fit the whole capture (0)";
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
  renderCaptureDetails();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  fitPage({ announce: false });
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
  const hasCompleteImage = hasImage && state.source?.completePage !== false;
  const hasPdf = Boolean(state.capture?.pdfSource?.blob);
  const hasDownload = Boolean(state.originalDownload);

  ui.copyImageButton.disabled = !hasImage;
  ui.downloadPngButton.disabled = !hasImage;
  ui.exportPdfButton.disabled = !(hasCompleteImage || hasPdf);
  ui.annotateButton.disabled = !hasCompleteImage;
  ui.zoomOutButton.disabled = !hasImage;
  ui.zoomInButton.disabled = !hasImage;
  ui.actualSizeButton.disabled = !hasImage;
  ui.fitPageButton.disabled = !hasImage;
  ui.fitButton.disabled = !hasImage;
  ui.driveButton.disabled = !hasCompleteImage;
  ui.openOriginalButton.disabled = !hasDownload;
  ui.showOriginalButton.disabled = !hasDownload;
  ui.deleteCaptureButton.disabled = !state.captureId || !state.capture;
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
  const completePage = state.source?.completePage !== false;
  const savedFileCount = state.savedDownloads.length;
  const savedOriginals = savedFileCount
    ? `${savedFileCount} saved ${savedFileCount === 1 ? "file remains" : "files remain"} in Downloads.`
    : "No full-resolution saved file is still attached.";
  const qualityDetail = state.source?.limited && state.source.width && state.source.height
    ? completePage
      ? ` ${formatDimensions(state.source.width, state.source.height)} complete-page review image. ${savedOriginals}`
      : ` ${formatDimensions(state.source.width, state.source.height)} cropped thumbnail, not the whole capture. ${savedOriginals}`
    : "";
  ui.resultSource.textContent = `${sourceLabel}.${qualityDetail}`.trim();
  renderExportSemantics();
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
    const qualifier = state.source.completePage === false
      ? " thumbnail"
      : state.source.limited
        ? " review"
        : "";
    setStatus(
      `Copied ${formatDimensions(png.width, png.height)}${qualifier} PNG to the clipboard.`,
      "success"
    );
  });
}

async function downloadPng() {
  await runBusyAction("Preparing PNG…", async () => {
    const png = await ensurePng();
    const filename = buildExportFilename(state.capture.title || state.capture.host, "result", "png");
    await downloadBlob(png.blob, filename, { folder: "Lumen", saveAs: false });
    const sourceDescription = state.source.completePage === false
      ? " from the cropped gallery thumbnail"
      : state.source.limited
        ? " from the complete-page review image"
        : " at full resolution";
    setStatus(
      `${filename} saved to Downloads${sourceDescription}.`,
      "success"
    );
  });
}

async function exportPdf() {
  await runBusyAction("Preparing PDF…", async () => {
    const cached = state.capture.pdfSource?.blob ? state.capture.pdfSource : null;

    if (!cached && !state.source?.blob) {
      throw new Error("This capture has no retained image or cached PDF to export.");
    }

    if (!cached && state.source?.completePage === false) {
      throw new Error("Only a cropped gallery thumbnail remains, so Lumen cannot create a whole-capture PDF from it.");
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
    if (state.source?.completePage === false) {
      throw new Error("Only a cropped gallery thumbnail remains, so this capture cannot be edited safely.");
    }

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
  const exportLabel = state.source?.limited ? "review image" : "full image";
  ui.driveButton.textContent = status.connected
    ? `Export ${exportLabel} to Google Drive`
    : `Connect & export ${exportLabel} to Drive`;
  ui.driveButton.disabled = !state.source?.blob || state.source?.completePage === false;
}

async function exportToDrive() {
  await runBusyAction("Preparing reviewed Drive export…", async () => {
    if (state.source?.completePage === false) {
      throw new Error("Only a cropped gallery thumbnail remains, so Lumen will not present it as a reviewed capture.");
    }

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
    ui.driveButton.textContent = state.source?.limited
      ? "Export review image to Google Drive"
      : "Export full image to Google Drive";
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

function toggleDetailsPanel(force) {
  const shouldOpen = typeof force === "boolean"
    ? force
    : !ui.detailsPanel.classList.contains("is-open");

  ui.detailsPanel.classList.toggle("is-open", shouldOpen);
  ui.detailsPanel.setAttribute("aria-hidden", String(!shouldOpen));
  if (shouldOpen) {
    ui.detailsPanel.setAttribute("aria-modal", "true");
  } else {
    ui.detailsPanel.removeAttribute("aria-modal");
  }
  ui.detailsPanel.inert = !shouldOpen;
  ui.detailsButton.setAttribute("aria-expanded", String(shouldOpen));
  ui.detailsBackdrop.hidden = !shouldOpen;
  ui.topbar.inert = shouldOpen;
  ui.resultShell.inert = shouldOpen;
  ui.resultStatus.inert = shouldOpen;

  if (shouldOpen) {
    ui.closeDetailsButton.focus();
  } else {
    ui.detailsButton.focus();
  }
}

function trapDetailsFocus(event) {
  if (event.key !== "Tab" || !ui.detailsPanel.classList.contains("is-open")) {
    return false;
  }

  const focusable = [...ui.detailsPanel.querySelectorAll(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((element) => !element.hidden);

  if (!focusable.length) {
    event.preventDefault();
    ui.closeDetailsButton.focus();
    return true;
  }

  const first = focusable[0];
  const last = focusable.at(-1);

  if (event.shiftKey && (document.activeElement === first || !ui.detailsPanel.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !ui.detailsPanel.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }

  return true;
}

async function openSettings() {
  await runBusyAction("Opening Lumen settings…", async () => {
    if (typeof chrome.runtime.openOptionsPage === "function") {
      await chrome.runtime.openOptionsPage();
    } else {
      await chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
    }

    setStatus("Settings opened in a new tab.", "success");
  });
}

function openDeleteDialog() {
  if (!state.capture || ui.deleteCaptureButton.disabled) {
    return;
  }

  toggleDetailsPanel(false);
  ui.deleteDialog.showModal();
}

async function removeCapture() {
  if (!state.captureId || state.busy) {
    return;
  }

  ui.deleteDialog.close();
  await runBusyAction("Removing the private library copy…", async () => {
    const removed = await chrome.runtime.sendMessage({
      type: "LUMEN_REMOVE_LOCAL_CAPTURE",
      payload: { captureId: state.captureId }
    });

    if (!removed?.ok) {
      throw new Error(removed?.error?.description || "Lumen could not remove this local capture.");
    }

    if (!removed.deleted) {
      throw new Error("This capture was already removed from Lumen’s local library.");
    }

    releaseObjectUrl();
    state.capture = null;
    state.source = null;
    state.savedDownloads = [];
    state.originalDownload = null;
    syncActionAvailability();
    setStatus("Removed from Lumen’s library and recent history. Existing files in Downloads were left untouched.", "success");
    await new Promise((resolve) => setTimeout(resolve, 320));
    location.replace(chrome.runtime.getURL("library.html?removed=1"));
  });
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

function fitPage(options = {}) {
  if (ui.resultImage.hidden || !ui.resultImage.naturalWidth) {
    return;
  }

  const { width, height } = getAvailableViewerSpace();
  state.pageZoom = clampZoom(Math.min(
    1,
    width / ui.resultImage.naturalWidth,
    height / ui.resultImage.naturalHeight
  ));
  setZoom(state.pageZoom, "page", { ...options, preserveCenter: false });
}

function fitWidth(options = {}) {
  if (ui.resultImage.hidden || !ui.resultImage.naturalWidth) {
    return;
  }

  const { width } = getAvailableViewerSpace();
  state.fitZoom = clampZoom(width / ui.resultImage.naturalWidth);
  setZoom(state.fitZoom, "width", { ...options, preserveCenter: false });
}

function getAvailableViewerSpace() {
  const stageStyle = getComputedStyle(document.querySelector("#resultStage"));
  const horizontalPadding = parseFloat(stageStyle.paddingLeft || "0") + parseFloat(stageStyle.paddingRight || "0");
  const verticalPadding = parseFloat(stageStyle.paddingTop || "0") + parseFloat(stageStyle.paddingBottom || "0");

  return {
    width: Math.max(1, ui.resultViewport.clientWidth - horizontalPadding),
    height: Math.max(1, ui.resultViewport.clientHeight - verticalPadding)
  };
}

function adjustZoom(multiplier) {
  setZoom(state.zoom * multiplier, "custom", { preserveCenter: true });
}

function setZoom(value, mode = "custom", options = {}) {
  if (ui.resultImage.hidden || !ui.resultImage.naturalWidth) {
    return;
  }

  const preserveCenter = options.preserveCenter ?? (mode === "custom" || mode === "actual");
  const previousScrollWidth = Math.max(1, ui.resultViewport.scrollWidth);
  const previousScrollHeight = Math.max(1, ui.resultViewport.scrollHeight);
  const centerX = (ui.resultViewport.scrollLeft + ui.resultViewport.clientWidth / 2) / previousScrollWidth;
  const centerY = (ui.resultViewport.scrollTop + ui.resultViewport.clientHeight / 2) / previousScrollHeight;
  const verticalProgress = ui.resultViewport.scrollTop / Math.max(1, previousScrollHeight - ui.resultViewport.clientHeight);

  state.zoom = clampZoom(value);
  state.zoomMode = mode;
  ui.resultImage.style.width = `${Math.max(1, Math.round(ui.resultImage.naturalWidth * state.zoom))}px`;
  ui.resultImage.style.height = `${Math.max(1, Math.round(ui.resultImage.naturalHeight * state.zoom))}px`;
  ui.zoomLabel.textContent = mode === "page"
    ? state.source?.completePage === false ? "Image" : "Page"
    : mode === "width"
      ? "Width"
      : `${Math.round(state.zoom * 100)}%`;
  ui.zoomOutButton.disabled = state.zoom <= MIN_ZOOM + 0.001;
  ui.zoomInButton.disabled = state.zoom >= MAX_ZOOM - 0.001;
  ui.actualSizeButton.disabled = false;
  ui.fitPageButton.disabled = false;
  ui.fitButton.disabled = false;
  ui.actualSizeButton.setAttribute("aria-pressed", String(mode === "actual"));
  ui.fitPageButton.setAttribute("aria-pressed", String(mode === "page"));
  ui.fitButton.setAttribute("aria-pressed", String(mode === "width"));

  if (preserveCenter) {
    ui.resultViewport.scrollLeft = Math.max(
      0,
      centerX * ui.resultViewport.scrollWidth - ui.resultViewport.clientWidth / 2
    );
    ui.resultViewport.scrollTop = Math.max(
      0,
      centerY * ui.resultViewport.scrollHeight - ui.resultViewport.clientHeight / 2
    );
  } else if (mode === "page") {
    ui.resultViewport.scrollLeft = 0;
    ui.resultViewport.scrollTop = 0;
  } else if (mode === "width") {
    ui.resultViewport.scrollLeft = 0;
    ui.resultViewport.scrollTop = verticalProgress * Math.max(
      0,
      ui.resultViewport.scrollHeight - ui.resultViewport.clientHeight
    );
  }

  updatePanAvailability();

  if (options.announce !== false) {
    const message = mode === "page"
      ? state.source?.completePage === false
        ? "The retained cropped thumbnail is fitted to the viewer."
        : "The whole capture is fitted to the viewer."
      : mode === "width"
        ? "Capture fitted to the viewer width. Scroll to review the full page."
        : `Zoom set to ${Math.round(state.zoom * 100)}%.`;
    setStatus(message, "neutral");
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

  setZoom(nextZoom, "custom", { announce: false, preserveCenter: false });
  const ratio = nextZoom / previousZoom;
  ui.resultViewport.scrollLeft = pointerX * ratio - (event.clientX - viewportRect.left);
  ui.resultViewport.scrollTop = pointerY * ratio - (event.clientY - viewportRect.top);
  ui.zoomLabel.textContent = `${Math.round(nextZoom * 100)}%`;
  updatePanAvailability();
}

function beginPan(event) {
  if (event.button !== 0 || event.pointerType === "touch") {
    return;
  }

  updatePanAvailability();

  if (!ui.resultViewport.classList.contains("can-pan")) {
    return;
  }

  event.preventDefault();
  state.pan.active = true;
  state.pan.pointerId = event.pointerId;
  state.pan.originX = event.clientX;
  state.pan.originY = event.clientY;
  state.pan.scrollLeft = ui.resultViewport.scrollLeft;
  state.pan.scrollTop = ui.resultViewport.scrollTop;
  ui.resultViewport.classList.add("is-panning");
  ui.resultViewport.setPointerCapture?.(event.pointerId);
}

function continuePan(event) {
  if (!state.pan.active || state.pan.pointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  ui.resultViewport.scrollLeft = state.pan.scrollLeft - (event.clientX - state.pan.originX);
  ui.resultViewport.scrollTop = state.pan.scrollTop - (event.clientY - state.pan.originY);
}

function endPan(event) {
  if (!state.pan.active || (event.pointerId != null && state.pan.pointerId !== event.pointerId)) {
    return;
  }

  ui.resultViewport.releasePointerCapture?.(state.pan.pointerId);
  state.pan.active = false;
  state.pan.pointerId = null;
  ui.resultViewport.classList.remove("is-panning");
}

function updatePanAvailability() {
  const canPan = ui.resultViewport.scrollWidth > ui.resultViewport.clientWidth + 1
    || ui.resultViewport.scrollHeight > ui.resultViewport.clientHeight + 1;
  ui.resultViewport.classList.toggle("can-pan", canPan);
}

function toggleActualSize() {
  if (ui.resultImage.hidden) {
    return;
  }

  if (state.zoomMode === "actual") {
    fitPage();
  } else {
    setZoom(1, "actual", { preserveCenter: true });
  }
}

function handleKeyboardShortcut(event) {
  const command = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();

  if (trapDetailsFocus(event)) {
    return;
  }

  if (event.key === "Escape" && ui.detailsPanel.classList.contains("is-open")) {
    event.preventDefault();
    toggleDetailsPanel(false);
    return;
  }

  if (ui.deleteDialog.open || isEditableShortcutTarget(event.target)) {
    return;
  }

  if (command && key === "c") {
    if (ui.copyImageButton.disabled || !isViewerShortcutContext()) {
      return;
    }

    event.preventDefault();
    copyImage();
    return;
  }

  if (command && key === "s") {
    const actionDisabled = event.shiftKey ? ui.exportPdfButton.disabled : ui.downloadPngButton.disabled;

    if (actionDisabled || !isViewerShortcutContext()) {
      return;
    }

    event.preventDefault();
    event.shiftKey ? exportPdf() : downloadPng();
    return;
  }

  if (command || event.altKey) {
    return;
  }

  if (!isZoomShortcutContext()) {
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
    fitPage();
  } else if (event.key === "1") {
    event.preventDefault();
    setZoom(1, "actual");
  } else if (key === "w") {
    event.preventDefault();
    fitWidth();
  }
}

function handleResize() {
  if (state.zoomMode === "page") {
    fitPage({ announce: false });
  } else if (state.zoomMode === "width") {
    fitWidth({ announce: false });
  } else {
    updatePanAvailability();
  }
}

function isEditableShortcutTarget(target) {
  return target instanceof HTMLElement && (
    target.isContentEditable
    || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
  );
}

function isViewerShortcutContext() {
  const active = document.activeElement;
  const selection = window.getSelection()?.toString() || "";
  return !selection && (
    active === document.body
    || active === ui.resultViewport
    || ui.resultViewport.contains(active)
  );
}

function isZoomShortcutContext() {
  const active = document.activeElement;
  const selection = window.getSelection()?.toString() || "";
  return !selection && (
    isViewerShortcutContext()
    || active?.closest?.(".topbar, .viewer-head")
  );
}

function setStatus(message, tone = "neutral", link = "") {
  clearTimeout(state.statusTimer);
  state.statusTimer = 0;
  ui.resultStatus.dataset.tone = tone;
  ui.resultStatus.classList.remove("is-hidden");
  ui.resultStatus.replaceChildren(document.createTextNode(message));

  if (link) {
    const anchor = document.createElement("a");
    anchor.href = link;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = " Open file";
    ui.resultStatus.append(anchor);
  }

  if (tone !== "error") {
    state.statusTimer = window.setTimeout(() => {
      ui.resultStatus.classList.add("is-hidden");
      state.statusTimer = 0;
    }, link ? 8000 : tone === "success" ? 4800 : 3200);
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
