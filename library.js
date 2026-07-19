import {
  clearLibrary,
  deleteLibraryCapture,
  getLibraryCapture,
  getLibraryPreviewAsset,
  getLibraryStorageEstimate,
  hasLibraryPreview,
  listLibraryCaptures,
  pruneLibraryPreviews,
  requestLibraryPersistence,
  updateLibraryFavorite
} from "./library-store.js";

const ui = {
  refreshButton: document.querySelector("#refreshButton"),
  clearLibraryButton: document.querySelector("#clearLibraryButton"),
  searchInput: document.querySelector("#searchInput"),
  sourceFilter: document.querySelector("#sourceFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  captureMetric: document.querySelector("#captureMetric"),
  previewMetric: document.querySelector("#previewMetric"),
  storageMetric: document.querySelector("#storageMetric"),
  resultsTitle: document.querySelector("#resultsTitle"),
  resultsCount: document.querySelector("#resultsCount"),
  libraryStatus: document.querySelector("#libraryStatus"),
  emptyState: document.querySelector("#emptyState"),
  emptyTitle: document.querySelector("#emptyTitle"),
  emptyCopy: document.querySelector("#emptyCopy"),
  captureGrid: document.querySelector("#captureGrid"),
  captureCardTemplate: document.querySelector("#captureCardTemplate"),
  captureDialog: document.querySelector("#captureDialog"),
  closeDialogButton: document.querySelector("#closeDialogButton"),
  dialogEyebrow: document.querySelector("#dialogEyebrow"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogImage: document.querySelector("#dialogImage"),
  dialogPreviewFallback: document.querySelector("#dialogPreviewFallback"),
  dialogBadges: document.querySelector("#dialogBadges"),
  dialogMeta: document.querySelector("#dialogMeta"),
  dialogPath: document.querySelector("#dialogPath"),
  artifactCount: document.querySelector("#artifactCount"),
  artifactList: document.querySelector("#artifactList")
};

const state = {
  captures: [],
  cardObjectUrls: new Set(),
  dialogObjectUrl: "",
  renderVersion: 0,
  busy: false,
  requestedCaptureId: new URLSearchParams(location.search).get("capture") || ""
};

initialize().catch((error) => {
  showStatus(error.message || "The local capture library could not be loaded.", "error", false);
});

async function initialize() {
  bindEvents();
  await requestLibraryPersistence();
  await refreshLibrary();

  if (state.requestedCaptureId) {
    const requested = state.captures.find((capture) => capture.id === state.requestedCaptureId);

    if (requested) {
      await openCaptureDetails(requested.id);
    }

    state.requestedCaptureId = "";
  }
}

function bindEvents() {
  ui.refreshButton.addEventListener("click", () => refreshLibrary({ announce: true }));
  ui.clearLibraryButton.addEventListener("click", handleClearLibrary);
  ui.searchInput.addEventListener("input", renderLibrary);
  ui.sourceFilter.addEventListener("change", renderLibrary);
  ui.sortSelect.addEventListener("change", renderLibrary);
  ui.closeDialogButton.addEventListener("click", () => ui.captureDialog.close());
  ui.captureDialog.addEventListener("click", (event) => {
    if (event.target === ui.captureDialog) {
      ui.captureDialog.close();
    }
  });
  ui.captureDialog.addEventListener("close", releaseDialogPreview);
  window.addEventListener("beforeunload", releaseAllObjectUrls);
}

async function refreshLibrary({ announce = false } = {}) {
  setBusy(true);

  try {
    await pruneLibraryPreviews();
    const [captures, estimate] = await Promise.all([
      listLibraryCaptures({ limit: 2000 }),
      getLibraryStorageEstimate()
    ]);

    state.captures = captures;
    renderStorageEstimate(estimate);
    renderLibrary();

    if (announce) {
      showStatus(`Library refreshed. ${formatItemCount(captures.length)} available locally.`, "success");
    }
  } catch (error) {
    showStatus(error.message || "The local library could not be refreshed.", "error", false);
  } finally {
    setBusy(false);
  }
}

function renderLibrary() {
  const captures = getVisibleCaptures();
  const renderVersion = state.renderVersion + 1;
  state.renderVersion = renderVersion;
  releaseCardPreviews();
  ui.captureGrid.replaceChildren();
  ui.resultsCount.textContent = formatItemCount(captures.length);
  ui.resultsTitle.textContent = getResultsTitle();
  ui.emptyState.classList.toggle("is-hidden", captures.length > 0);
  ui.captureGrid.classList.toggle("is-hidden", captures.length === 0);

  if (!captures.length) {
    const filtered = Boolean(ui.searchInput.value.trim() || ui.sourceFilter.value !== "all");
    ui.emptyTitle.textContent = filtered ? "No matching captures" : "No captures here yet";
    ui.emptyCopy.textContent = filtered
      ? "Try a different search or filter. Removing an item from the library does not delete its downloaded original."
      : "Run a capture from the Lumen toolbar and its preview will appear here.";
    return;
  }

  for (const [index, capture] of captures.entries()) {
    const card = buildCaptureCard(capture);
    ui.captureGrid.append(card);
    loadCardPreview(card, capture, renderVersion, { eager: index < 12 }).catch(() => {});
  }
}

function getVisibleCaptures() {
  const query = ui.searchInput.value.trim().toLowerCase();
  const filter = ui.sourceFilter.value;
  const direction = ui.sortSelect.value === "oldest" ? 1 : -1;

  return state.captures
    .filter((capture) => {
      if (filter === "favorite") {
        return capture.favorite;
      }

      return filter === "all" || capture.sourceType === filter;
    })
    .filter((capture) => {
      if (!query) {
        return true;
      }

      return [capture.title, capture.host, capture.url, ...(capture.tags || [])]
        .some((value) => String(value || "").toLowerCase().includes(query));
    })
    .sort((left, right) => {
      const difference = readCaptureTimestamp(left) - readCaptureTimestamp(right);
      return difference ? difference * direction : String(left.id).localeCompare(String(right.id)) * direction;
    });
}

function buildCaptureCard(capture) {
  const fragment = ui.captureCardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".capture-card");
  const previewButton = card.querySelector(".preview-button");
  const previewBadges = card.querySelector(".preview-badges");
  const title = capture.title || capture.host || "Untitled capture";
  const favoriteButton = card.querySelector(".favorite-button");
  const primaryDownload = selectPrimaryDownload(capture.downloads);

  card.dataset.captureId = capture.id;
  card.querySelector(".card-host").textContent = capture.host || "Local capture";
  card.querySelector(".card-title").textContent = title;
  card.querySelector(".card-meta").textContent = buildCaptureMeta(capture);
  previewButton.setAttribute("aria-label", `View details for ${title}`);
  appendCaptureBadges(previewBadges, capture);
  updateFavoriteButton(favoriteButton, capture);

  previewButton.addEventListener("click", () => openCaptureDetails(capture.id));
  favoriteButton.addEventListener("click", () => toggleFavorite(capture.id, favoriteButton));

  const openButton = card.querySelector(".open-action");
  const showButton = card.querySelector(".show-action");
  const removeButton = card.querySelector(".remove-action");
  const editButton = card.querySelector(".edit-action");
  const reviewButton = card.querySelector(".review-action");

  configureCaptureToolAction(editButton, capture, "editor");
  configureCaptureToolAction(reviewButton, capture, "review");
  configureFileAction(openButton, capture.id, primaryDownload, "open");
  configureFileAction(showButton, capture.id, primaryDownload, "show");
  removeButton.addEventListener("click", () => removeCapture(capture));

  return card;
}

function configureCaptureToolAction(button, capture, tool) {
  const hasEditorSource = capture.editorStatus === "ready" && Boolean(capture.editorAssetId);
  const available = hasLibraryPreview(capture) || hasEditorSource;

  if (!available) {
    disableCaptureToolAction(button, tool);
    return;
  }

  button.addEventListener("click", () => openCaptureTool(capture.id, tool));
}

function disableCaptureToolAction(button, tool) {
  const action = tool === "editor" ? "Annotation" : "Comparison";
  button.disabled = true;
  button.title = `${action} is unavailable because this capture has no local image.`;
  button.setAttribute("aria-label", `${action} unavailable: no local image`);
}

async function openCaptureTool(captureId, tool) {
  const messageType = tool === "editor"
    ? "LUMEN_OPEN_ANNOTATION_EDITOR"
    : "LUMEN_OPEN_VISUAL_REVIEW";

  try {
    const response = await chrome.runtime.sendMessage({
      type: messageType,
      payload: { captureId }
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || response?.error?.message || "The review tool could not open.");
    }
  } catch (error) {
    showStatus(error.message || "The review tool could not open.", "error");
  }
}

async function loadCardPreview(card, capture, renderVersion, { eager = false } = {}) {
  const asset = await getLibraryPreviewAsset(capture.id);

  if (!asset?.blob || renderVersion !== state.renderVersion || !card.isConnected) {
    if (renderVersion === state.renderVersion && card.isConnected) {
      if (!(capture.editorStatus === "ready" && capture.editorAssetId)) {
        disableCaptureToolAction(card.querySelector(".review-action"), "review");
        disableCaptureToolAction(card.querySelector(".edit-action"), "editor");
      }
    }

    return;
  }

  const image = card.querySelector(".capture-preview");
  const fallback = card.querySelector(".preview-fallback");
  const objectUrl = URL.createObjectURL(asset.blob);

  state.cardObjectUrls.add(objectUrl);
  image.loading = eager ? "eager" : "lazy";
  image.alt = `Preview of ${capture.title || capture.host || "saved capture"}`;
  image.addEventListener("load", () => {
    if (renderVersion === state.renderVersion) {
      image.classList.remove("is-hidden");
      fallback.classList.add("is-hidden");
    }
  }, { once: true });
  image.addEventListener("error", () => {
    URL.revokeObjectURL(objectUrl);
    state.cardObjectUrls.delete(objectUrl);
  }, { once: true });
  image.src = objectUrl;
}

async function openCaptureDetails(captureId) {
  try {
    const capture = await getLibraryCapture(captureId, { includePreview: true });

    if (!capture) {
      throw new Error("This capture is no longer in the local library.");
    }

    releaseDialogPreview();
    ui.dialogTitle.textContent = capture.title || capture.host || "Saved capture";
    ui.dialogEyebrow.textContent = capture.sourceType === "timed" ? "Timed capture" : "Capture details";
    ui.dialogMeta.textContent = buildDialogMeta(capture);
    ui.dialogPath.textContent = capture.archiveFolder
      ? `Downloads/${capture.archiveFolder}`
      : "The original file location is recorded by Chrome Downloads.";
    ui.dialogBadges.replaceChildren();
    appendCaptureBadges(ui.dialogBadges, capture);
    renderArtifacts(capture);

    if (capture.preview?.blob) {
      state.dialogObjectUrl = URL.createObjectURL(capture.preview.blob);
      ui.dialogImage.alt = `Preview of ${capture.title || capture.host || "saved capture"}`;
      ui.dialogImage.src = state.dialogObjectUrl;
      ui.dialogImage.classList.remove("is-hidden");
      ui.dialogPreviewFallback.classList.add("is-hidden");
    } else {
      ui.dialogImage.removeAttribute("src");
      ui.dialogImage.classList.add("is-hidden");
      ui.dialogPreviewFallback.classList.remove("is-hidden");
    }

    if (!ui.captureDialog.open) {
      ui.captureDialog.showModal();
    }
  } catch (error) {
    showStatus(error.message || "Capture details could not be opened.", "error");
  }
}

function renderArtifacts(capture) {
  const downloads = Array.isArray(capture.downloads) ? capture.downloads : [];
  ui.artifactCount.textContent = `${downloads.length} file${downloads.length === 1 ? "" : "s"}`;
  ui.artifactList.replaceChildren();

  if (!downloads.length) {
    const empty = document.createElement("p");
    empty.className = "dialog-meta";
    empty.textContent = "No Chrome download handles are attached to this library item.";
    ui.artifactList.append(empty);
    return;
  }

  for (const download of downloads) {
    const row = document.createElement("div");
    const copy = document.createElement("div");
    const label = document.createElement("strong");
    const meta = document.createElement("span");
    const actions = document.createElement("div");
    const openButton = document.createElement("button");
    const showButton = document.createElement("button");

    row.className = "artifact-row";
    copy.className = "artifact-copy";
    actions.className = "artifact-actions";
    label.textContent = formatArtifactLabel(download);
    meta.textContent = [
      download.variantId ? titleCase(download.variantId) : "",
      download.width && download.height ? `${download.width}×${download.height}` : "",
      download.bytesReceived ? formatBytes(download.bytesReceived) : "",
      download.filename ? shortenFilename(download.filename) : ""
    ].filter(Boolean).join(" · ");
    openButton.className = "card-action";
    openButton.type = "button";
    openButton.textContent = "Open";
    showButton.className = "card-action";
    showButton.type = "button";
    showButton.textContent = "Show";
    configureFileAction(openButton, capture.id, download, "open");
    configureFileAction(showButton, capture.id, download, "show");

    copy.append(label, meta);
    actions.append(openButton, showButton);
    row.append(copy, actions);
    ui.artifactList.append(row);
  }
}

function configureFileAction(button, captureId, download, action) {
  const downloadId = Number.isInteger(download?.downloadId) ? download.downloadId : null;
  button.disabled = downloadId === null;
  button.title = downloadId === null
    ? "Chrome no longer has a local handle for this file."
    : action === "open" ? "Open the downloaded original" : "Reveal the downloaded original in its folder";

  if (downloadId === null) {
    return;
  }

  button.addEventListener("click", () => runFileAction({ captureId, downloadId, action, button }));
}

async function runFileAction({ captureId, downloadId, action, button }) {
  const messageType = action === "open" ? "LUMEN_OPEN_LIBRARY_PHOTO" : "LUMEN_SHOW_LIBRARY_PHOTO";
  button.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: messageType,
      payload: { captureId, downloadId }
    });

    if (!response?.ok) {
      throw new Error(response?.error?.description || response?.error?.message || "Chrome could not access this downloaded file.");
    }

    showStatus(action === "open" ? "Opened the downloaded original." : "Revealed the downloaded original in its folder.", "success");
  } catch (error) {
    showStatus(error.message || "The downloaded original is unavailable.", "error");
  } finally {
    button.disabled = false;
  }
}

async function toggleFavorite(captureId, button) {
  const capture = state.captures.find((item) => item.id === captureId);

  if (!capture) {
    return;
  }

  button.disabled = true;

  try {
    const updated = await updateLibraryFavorite(captureId, !capture.favorite);
    state.captures = state.captures.map((item) => item.id === captureId ? updated : item);
    renderLibrary();
    showStatus(updated.favorite ? "Added to favorites." : "Removed from favorites.", "success");
  } catch (error) {
    showStatus(error.message || "The favorite could not be updated.", "error");
    button.disabled = false;
  }
}

async function removeCapture(capture) {
  const confirmed = window.confirm(
    `Remove “${capture.title || capture.host || "this capture"}” from the Lumen library? The downloaded original will stay on your device.`
  );

  if (!confirmed) {
    return;
  }

  setBusy(true);

  try {
    await deleteLibraryCapture(capture.id);
    state.captures = state.captures.filter((item) => item.id !== capture.id);
    renderLibrary();
    await refreshStorageEstimate();
    showStatus("Removed from the local library. The downloaded original was not deleted.", "success");
  } catch (error) {
    showStatus(error.message || "The library item could not be removed.", "error");
  } finally {
    setBusy(false);
  }
}

async function handleClearLibrary() {
  const confirmed = window.confirm(
    "Clear all Lumen library images and library metadata from this browser profile? Downloaded originals will stay on your device."
  );

  if (!confirmed) {
    return;
  }

  setBusy(true);

  try {
    const cleared = await clearLibrary();
    state.captures = [];
    renderLibrary();
    await refreshStorageEstimate();
    showStatus(
      `Cleared ${cleared.captureCount} library item${cleared.captureCount === 1 ? "" : "s"}. Downloaded originals remain on your device.`,
      "success"
    );
  } catch (error) {
    showStatus(error.message || "The local library could not be cleared.", "error");
  } finally {
    setBusy(false);
  }
}

async function refreshStorageEstimate() {
  renderStorageEstimate(await getLibraryStorageEstimate());
}

function renderStorageEstimate(estimate) {
  ui.captureMetric.textContent = String(estimate.captureCount || 0);
  ui.previewMetric.textContent = formatBytes(
    (estimate.previewBytes || 0) +
    (estimate.editorBytes || 0) +
    (estimate.pdfBytes || 0)
  );
  ui.storageMetric.textContent = estimate.quota
    ? `${formatBytes(estimate.usage || 0)} of ${formatBytes(estimate.quota)}`
    : formatBytes(estimate.usage || 0);
}

function appendCaptureBadges(container, capture) {
  const badges = [];

  if (capture.captureHealth?.status === "complete") {
    badges.push({ label: "Verified", className: "is-verified" });
  }

  if (capture.sourceType === "timed") {
    badges.push({ label: "Timed", className: "is-timed" });
  }

  if (capture.cutawayCount) {
    badges.push({ label: `${capture.cutawayCount} crop${capture.cutawayCount === 1 ? "" : "s"}`, className: "" });
  }

  if (["reviewed", "edited", "exported"].includes(capture.review?.status)) {
    badges.push({
      label: capture.review.status === "exported" ? "Exported" : capture.review.status === "edited" ? "Edited" : "Reviewed",
      className: "is-reviewed"
    });
  }

  if (!badges.length) {
    badges.push({ label: titleCase(capture.exportPreset || "capture"), className: "" });
  }

  for (const badge of badges) {
    const node = document.createElement("span");
    node.className = `capture-badge ${badge.className}`.trim();
    node.textContent = badge.label;
    container.append(node);
  }
}

function updateFavoriteButton(button, capture) {
  const favorite = Boolean(capture.favorite);
  button.setAttribute("aria-pressed", String(favorite));
  button.querySelector("[aria-hidden]").textContent = favorite ? "★" : "☆";
  button.querySelector(".sr-only").textContent = favorite ? "Remove from favorites" : "Add to favorites";
  button.setAttribute("aria-label", `${favorite ? "Remove" : "Add"} ${capture.title || "capture"} ${favorite ? "from" : "to"} favorites`);
}

function buildCaptureMeta(capture) {
  return [
    formatTimestamp(capture.capturedAt),
    capture.variantCount ? `${capture.variantCount} view${capture.variantCount === 1 ? "" : "s"}` : "",
    capture.fileCount ? `${capture.fileCount} file${capture.fileCount === 1 ? "" : "s"}` : "",
    capture.dimensions?.width && capture.dimensions?.height
      ? `${capture.dimensions.width}×${capture.dimensions.height}`
      : ""
  ].filter(Boolean).join(" · ");
}

function buildDialogMeta(capture) {
  return [
    capture.host || "Local capture",
    formatTimestamp(capture.capturedAt),
    capture.devicePreset ? `${titleCase(capture.devicePreset)} capture` : "",
    capture.captureHealth?.coveragePercent ? `${capture.captureHealth.coveragePercent}% capture coverage` : "",
    capture.redactionCount ? `${capture.redactionCount} redaction${capture.redactionCount === 1 ? "" : "s"}` : "",
    capture.manualRedactionCount ? `${capture.manualRedactionCount} manual` : "",
    capture.cutawayCount ? `${capture.cutawayCount} cutaway` : ""
  ].filter(Boolean).join(" · ");
}

function selectPrimaryDownload(downloads) {
  const records = Array.isArray(downloads) ? downloads : [];
  return records.find((download) => Number.isInteger(download.downloadId) && download.kind === "image" && download.role === "full-page") ||
    records.find((download) => Number.isInteger(download.downloadId) && download.kind === "image") ||
    records.find((download) => Number.isInteger(download.downloadId)) ||
    null;
}

function formatArtifactLabel(download) {
  if (download.role === "cutaway") {
    return "Focused crop PNG";
  }

  if (download.role === "print-sheet" || download.kind === "html") {
    return "Print sheet HTML";
  }

  if (download.kind === "manifest") {
    return "Capture details JSON";
  }

  if (download.partTotal > 1) {
    return `Full-page PNG ${download.partIndex || 1}/${download.partTotal}`;
  }

  return "Full-page PNG";
}

function getResultsTitle() {
  const labels = {
    all: "All captures",
    manual: "Manual captures",
    timed: "Timed captures",
    favorite: "Favorites"
  };

  return labels[ui.sourceFilter.value] || labels.all;
}

function showStatus(message, tone = "success", autoHide = true) {
  ui.libraryStatus.textContent = message;
  ui.libraryStatus.dataset.tone = tone;
  ui.libraryStatus.classList.remove("is-hidden");
  clearTimeout(showStatus.timeoutId);

  if (autoHide) {
    showStatus.timeoutId = setTimeout(() => ui.libraryStatus.classList.add("is-hidden"), 5200);
  }
}

function setBusy(busy) {
  state.busy = busy;
  ui.refreshButton.disabled = busy;
  ui.clearLibraryButton.disabled = busy || state.captures.length === 0;
  document.body.setAttribute("aria-busy", String(busy));
}

function releaseCardPreviews() {
  for (const objectUrl of state.cardObjectUrls) {
    URL.revokeObjectURL(objectUrl);
  }

  state.cardObjectUrls.clear();
}

function releaseDialogPreview() {
  if (state.dialogObjectUrl) {
    URL.revokeObjectURL(state.dialogObjectUrl);
    state.dialogObjectUrl = "";
  }

  ui.dialogImage.removeAttribute("src");
}

function releaseAllObjectUrls() {
  releaseCardPreviews();
  releaseDialogPreview();
}

function formatTimestamp(value) {
  const timestamp = Date.parse(value || "");

  if (!Number.isFinite(timestamp)) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);

  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function shortenFilename(filename) {
  const parts = String(filename || "").split("/").filter(Boolean);
  return parts.at(-1) || "Saved file";
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readCaptureTimestamp(capture) {
  return Date.parse(capture?.capturedAt || capture?.createdAt || "") || 0;
}

function formatItemCount(count) {
  return `${count} item${count === 1 ? "" : "s"}`;
}
