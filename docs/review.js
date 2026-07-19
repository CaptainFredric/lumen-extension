import { STORAGE_KEYS } from "./config.js";
import {
  getLibraryEditorAsset,
  getLibraryPdfAsset,
  getLibraryPreviewAsset,
  hasLibraryPdf,
  hasLibraryPreview,
  listLibraryCaptures
} from "./library-store.js";
import {
  areCapturesComparable,
  buildMonitorTimeline,
  comparePixelBuffers,
  formatChangePercent,
  resolveReviewWatchPlanId,
  selectReviewPair
} from "./visual-diff-engine.js";

const MAX_COMPARISON_WIDTH = 1800;
const MAX_COMPARISON_HEIGHT = 2600;
const MAX_COMPARISON_PIXELS = 3_400_000;

const ui = {
  refreshButton: document.querySelector("#refreshButton"),
  beforeSelect: document.querySelector("#beforeSelect"),
  afterSelect: document.querySelector("#afterSelect"),
  swapButton: document.querySelector("#swapButton"),
  reviewStatus: document.querySelector("#reviewStatus"),
  emptyState: document.querySelector("#emptyState"),
  emptyTitle: document.querySelector("#emptyTitle"),
  emptyCopy: document.querySelector("#emptyCopy"),
  reviewContent: document.querySelector("#reviewContent"),
  comparisonStage: document.querySelector("#comparisonStage"),
  beforeCanvas: document.querySelector("#beforeCanvas"),
  afterCanvas: document.querySelector("#afterCanvas"),
  afterLayer: document.querySelector("#afterLayer"),
  revealLine: document.querySelector("#revealLine"),
  revealSlider: document.querySelector("#revealSlider"),
  revealOutput: document.querySelector("#revealOutput"),
  highlightToggle: document.querySelector("#highlightToggle"),
  reviewActions: document.querySelector("#reviewActions"),
  regionOverlay: document.querySelector("#regionOverlay"),
  changePercentMetric: document.querySelector("#changePercentMetric"),
  changedPixelsMetric: document.querySelector("#changedPixelsMetric"),
  similarityMetric: document.querySelector("#similarityMetric"),
  regionCountMetric: document.querySelector("#regionCountMetric"),
  intensityMetric: document.querySelector("#intensityMetric"),
  changeClassification: document.querySelector("#changeClassification"),
  dimensionNote: document.querySelector("#dimensionNote"),
  regionList: document.querySelector("#regionList"),
  regionsSummary: document.querySelector("#regionsSummary"),
  noRegionsMessage: document.querySelector("#noRegionsMessage"),
  timelineList: document.querySelector("#timelineList"),
  timelineCount: document.querySelector("#timelineCount"),
  timelineEmpty: document.querySelector("#timelineEmpty")
};

const query = new URLSearchParams(location.search);
const state = {
  captures: [],
  runs: [],
  timeline: [],
  demoAssets: new Map(),
  watchPlanId: query.get("watch") || "",
  requestedBeforeId: query.get("before") || "",
  requestedAfterId: query.get("after") || query.get("capture") || "",
  demoMode: query.get("demo") === "1",
  reviewVersion: 0,
  selectedRegionId: "",
  injectedRuns: null,
  statusTimer: 0,
  busy: false,
  dragging: false,
  currentDiff: null
};

initialize().catch((error) => {
  showFatalError(error);
});

async function initialize() {
  configurePublicDemoNavigation();
  bindEvents();
  installIntegrationHooks();
  updateReveal(Number(ui.revealSlider.value));
  ui.comparisonStage.classList.toggle("show-regions", ui.highlightToggle.checked);
  await refreshReview({ initial: true });
}

function configurePublicDemoNavigation() {
  if (!state.demoMode || globalThis.chrome?.runtime?.id) {
    return;
  }

  const links = [...document.querySelectorAll('a[href="library.html"], a[href="settings.html"]')];

  for (const link of links) {
    const extensionDestination = link.getAttribute("href");
    link.href = "index.html#actual-app";
    if (!link.classList.contains("brand-lockup")) {
      link.textContent = extensionDestination === "library.html" ? "About Lumen" : "Install Lumen";
    }
    link.title = "The capture library and settings live inside the installed Chrome extension.";
  }
}

function bindEvents() {
  ui.refreshButton.addEventListener("click", () => refreshReview({ announce: true }));
  ui.beforeSelect.addEventListener("change", loadSelectedComparison);
  ui.afterSelect.addEventListener("change", loadSelectedComparison);
  ui.swapButton.addEventListener("click", swapCaptures);
  ui.revealSlider.addEventListener("input", () => updateReveal(Number(ui.revealSlider.value)));
  ui.highlightToggle.addEventListener("change", () => {
    ui.comparisonStage.classList.toggle("show-regions", ui.highlightToggle.checked);
  });
  ui.comparisonStage.addEventListener("keydown", handleStageKeydown);
  ui.comparisonStage.addEventListener("pointerdown", handleStagePointerDown);
  ui.comparisonStage.addEventListener("pointermove", handleStagePointerMove);
  ui.comparisonStage.addEventListener("pointerup", stopStagePointerDrag);
  ui.comparisonStage.addEventListener("pointercancel", stopStagePointerDrag);
}

async function refreshReview({ initial = false, announce = false } = {}) {
  setBusy(true);

  try {
    if (state.demoMode) {
      const demo = await createDemoReviewData();
      state.captures = demo.captures;
      state.runs = demo.runs;
      state.watchPlanId = demo.watchPlanId;
      state.demoAssets = demo.assets;
    } else {
      const [captures, runs] = await Promise.all([
        listLibraryCaptures({ limit: 2000 }),
        state.injectedRuns ? Promise.resolve(state.injectedRuns) : readWatchRuns()
      ]);
      state.captures = captures;
      state.runs = runs;
    }

    populateCaptureSelects();
    const pair = selectReviewPair(state.captures, state.runs, {
      beforeCaptureId: state.requestedBeforeId,
      afterCaptureId: state.requestedAfterId,
      watchPlanId: state.watchPlanId
    });

    const selectedBefore = pair.before || findCapture(state.requestedBeforeId);
    const selectedAfter = pair.after || findCapture(state.requestedAfterId);
    ui.beforeSelect.value = selectedBefore?.id || "";
    ui.afterSelect.value = selectedAfter?.id || "";
    updateReviewContext(selectedBefore, selectedAfter);
    renderTimeline();

    if (!pair.before || !pair.after) {
      publishSelection(selectedBefore, selectedAfter, null);
      updateAddressBar(selectedBefore?.id || "", selectedAfter?.id || "");
      showIncompletePair(pair, selectedBefore, selectedAfter);
      return;
    }

    await loadComparison(pair.before.id, pair.after.id);

    if (announce) {
      showStatus(`Review refreshed. ${formatItemCount(state.captures.length)} available locally.`, "success");
    } else if (initial && state.demoMode) {
      showStatus("Demo review loaded with generated local captures. No browser storage was used.", "success");
    }
  } catch (error) {
    showFatalError(error);
  } finally {
    setBusy(false);
  }
}

function populateCaptureSelects() {
  const selectedBefore = ui.beforeSelect.value;
  const selectedAfter = ui.afterSelect.value;
  const captures = [...state.captures].sort((left, right) => captureTimestamp(right) - captureTimestamp(left));

  replaceSelectOptions(ui.beforeSelect, captures, "Choose an earlier capture");
  replaceSelectOptions(ui.afterSelect, captures, "Choose a later capture");

  if (captures.some((capture) => capture.id === selectedBefore)) {
    ui.beforeSelect.value = selectedBefore;
  }

  if (captures.some((capture) => capture.id === selectedAfter)) {
    ui.afterSelect.value = selectedAfter;
  }
}

function replaceSelectOptions(select, captures, placeholder) {
  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = placeholder;
  const fragment = document.createDocumentFragment();
  fragment.append(placeholderOption);

  for (const capture of captures) {
    const option = document.createElement("option");
    option.value = capture.id;
    option.textContent = formatCaptureOption(capture);
    fragment.append(option);
  }

  select.replaceChildren(fragment);
}

async function loadSelectedComparison() {
  const beforeId = ui.beforeSelect.value;
  const afterId = ui.afterSelect.value;

  if (!beforeId || !afterId) {
    const beforeCapture = findCapture(beforeId);
    const afterCapture = findCapture(afterId);
    updateReviewContext(beforeCapture, afterCapture);
    renderTimeline();
    publishSelection(beforeCapture, afterCapture, null);
    updateAddressBar(beforeId, afterId);
    showIncompletePair(
      { source: "selected-unpaired", before: beforeCapture, after: afterCapture },
      beforeCapture,
      afterCapture
    );
    return;
  }

  await loadComparison(beforeId, afterId);
}

async function loadComparison(beforeId, afterId) {
  const version = state.reviewVersion + 1;
  state.reviewVersion = version;
  state.selectedRegionId = "";

  if (!beforeId || !afterId) {
    const beforeCapture = findCapture(beforeId);
    const afterCapture = findCapture(afterId);
    updateReviewContext(beforeCapture, afterCapture);
    renderTimeline();
    publishSelection(beforeCapture, afterCapture, null);
    updateAddressBar(beforeId, afterId);
    showIncompletePair(
      { source: "selected-unpaired", before: beforeCapture, after: afterCapture },
      beforeCapture,
      afterCapture
    );
    return;
  }

  const beforeCapture = findCapture(beforeId);
  const afterCapture = findCapture(afterId);

  if (!beforeCapture || !afterCapture) {
    updateReviewContext(beforeCapture, afterCapture);
    renderTimeline();
    publishSelection(beforeCapture, afterCapture, null);
    updateAddressBar(beforeId, afterId);
    showStatus("One of the selected captures is no longer in the local library.", "error", false);
    showEmptyState("Capture unavailable", "Refresh the review or select another local capture.");
    return;
  }

  updateReviewContext(beforeCapture, afterCapture);
  renderTimeline();
  publishSelection(beforeCapture, afterCapture, null);
  updateAddressBar(beforeId, afterId);

  if (beforeId === afterId) {
    showStatus("Choose two different captures to measure a visual change.", "error", false);
    showEmptyState("Two different captures are required", "Keep this capture selected, then choose an earlier capture from the same page or monitor.");
    return;
  }

  if (!areCapturesComparable(beforeCapture, afterCapture)) {
    showStatus("These captures come from different pages or monitors and cannot be compared.", "error", false);
    showEmptyState(
      "Captures do not match",
      "The after capture is still selected. Choose an earlier capture from the same page or monitor."
    );
    return;
  }

  setBusy(true);
  showStatus("Comparing local capture pixels…", "info", false);

  try {
    const [beforeAsset, afterAsset] = await Promise.all([
      loadPreviewAsset(beforeCapture.id),
      loadPreviewAsset(afterCapture.id)
    ]);

    if (!beforeAsset?.blob || !afterAsset?.blob) {
      throw new Error("Both captures need a local image. The downloaded originals were not opened automatically.");
    }

    const [beforeImage, afterImage] = await Promise.all([
      decodeImage(beforeAsset.blob),
      decodeImage(afterAsset.blob)
    ]);

    try {
      if (version !== state.reviewVersion) {
        return;
      }

      const comparisonSize = calculateComparisonSize(beforeImage, afterImage);
      const beforeFrame = drawComparisonFrame(ui.beforeCanvas, beforeImage, comparisonSize);
      const afterFrame = drawComparisonFrame(ui.afterCanvas, afterImage, comparisonSize);
      const diff = comparePixelBuffers(beforeFrame, afterFrame, {
        threshold: 24,
        maxRegions: 24
      });

      renderDiff(diff, {
        beforeCapture,
        afterCapture,
        beforeImage,
        afterImage,
        comparisonSize
      });
      publishSelection(beforeCapture, afterCapture, diff);
      updateTimelineSelection(afterId);
      showReviewContent();
      showStatus(buildComparisonStatus(diff), "success");
    } finally {
      beforeImage.release();
      afterImage.release();
    }
  } catch (error) {
    if (version === state.reviewVersion) {
      publishSelection(beforeCapture, afterCapture, null);
    }
    showStatus(error.message || "The selected previews could not be compared.", "error", false);
    showEmptyState(
      "Preview comparison unavailable",
      error.message || "Choose another capture pair and try again."
    );
  } finally {
    setBusy(false);
  }
}

function renderDiff(diff, context) {
  ui.changePercentMetric.textContent = formatChangePercent(diff.changePercent);
  ui.changedPixelsMetric.textContent = `${formatNumber(diff.changedPixels)} of ${formatNumber(diff.totalPixels)} comparison pixels`;
  ui.similarityMetric.textContent = formatChangePercent(diff.similarityPercent);
  ui.regionCountMetric.textContent = formatNumber(diff.regionCount);
  ui.intensityMetric.textContent = `${Math.round(diff.meanChangedDelta)} / 255`;
  ui.changeClassification.textContent = classificationLabel(diff.classification);
  ui.changeClassification.dataset.classification = diff.classification;
  ui.dimensionNote.textContent = buildDimensionNote(context, diff);
  renderRegions(diff.regions);
}

function renderRegions(regions) {
  ui.regionOverlay.replaceChildren();
  ui.regionList.replaceChildren();
  ui.regionsSummary.textContent = `${regions.length} ${regions.length === 1 ? "region" : "regions"}`;
  ui.noRegionsMessage.classList.toggle("is-hidden", regions.length > 0);
  ui.regionList.classList.toggle("is-hidden", regions.length === 0);

  for (const region of regions) {
    const overlay = document.createElement("span");
    overlay.className = "change-region";
    overlay.dataset.regionId = region.id;
    overlay.dataset.rank = String(region.rank);
    overlay.style.left = `${region.leftPercent}%`;
    overlay.style.top = `${region.topPercent}%`;
    overlay.style.width = `${region.widthPercent}%`;
    overlay.style.height = `${region.heightPercent}%`;
    ui.regionOverlay.append(overlay);

    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "region-button";
    button.dataset.regionId = region.id;
    button.setAttribute("aria-current", "false");
    button.setAttribute("aria-label", `Focus change region ${region.rank}, ${formatChangePercent(region.changePercent)} of the comparison`);

    const number = document.createElement("span");
    number.className = "region-number";
    number.textContent = String(region.rank);

    const copy = document.createElement("span");
    copy.className = "region-copy";
    const title = document.createElement("strong");
    title.textContent = describeRegionPosition(region);
    const detail = document.createElement("span");
    detail.textContent = `${region.width} × ${region.height}px area · intensity ${Math.round(region.meanDelta)}`;
    copy.append(title, detail);

    const percentLabel = document.createElement("span");
    percentLabel.className = "region-percent";
    percentLabel.textContent = formatChangePercent(region.changePercent);
    button.append(number, copy, percentLabel);
    button.addEventListener("click", () => focusRegion(region.id));
    item.append(button);
    ui.regionList.append(item);
  }
}

function focusRegion(regionId) {
  const nextSelected = state.selectedRegionId === regionId ? "" : regionId;
  state.selectedRegionId = nextSelected;
  ui.regionOverlay.querySelectorAll(".change-region").forEach((element) => {
    element.classList.toggle("is-focused", element.dataset.regionId === nextSelected);
  });
  ui.regionList.querySelectorAll(".region-button").forEach((button) => {
    button.setAttribute("aria-current", String(button.dataset.regionId === nextSelected));
  });

  if (nextSelected) {
    updateReveal(100);
    ui.comparisonStage.classList.add("show-regions");
    ui.highlightToggle.checked = true;
    ui.comparisonStage.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function renderTimeline() {
  state.timeline = state.watchPlanId
    ? buildMonitorTimeline(state.captures, state.runs, {
        watchPlanId: state.watchPlanId,
        limit: 100
      })
    : [];
  ui.timelineList.replaceChildren();
  ui.timelineCount.textContent = `${state.timeline.length} ${state.timeline.length === 1 ? "run" : "runs"}`;
  ui.timelineEmpty.classList.toggle("is-hidden", state.timeline.length > 0);
  ui.timelineList.classList.toggle("is-hidden", state.timeline.length === 0);

  for (const entry of state.timeline) {
    const item = document.createElement("li");
    item.className = "timeline-item";
    item.dataset.status = entry.status;

    const marker = document.createElement("span");
    marker.className = "timeline-marker";
    marker.setAttribute("aria-hidden", "true");

    const card = document.createElement(entry.selectable ? "button" : "div");
    card.className = "timeline-entry";
    card.dataset.captureId = entry.captureId;

    if (entry.selectable) {
      card.type = "button";
      card.setAttribute("aria-current", "false");
      card.setAttribute("aria-label", `Compare saved run from ${formatDateTime(entry.timeText)}`);
      card.addEventListener("click", () => selectTimelineEntry(entry));
    }

    const head = document.createElement("span");
    head.className = "timeline-entry-head";
    const status = document.createElement("span");
    status.className = "timeline-status";
    status.textContent = timelineStatusLabel(entry.status);
    const change = document.createElement("span");
    change.className = "timeline-change";
    change.textContent = entry.status === "unchanged"
      ? "No change"
      : entry.changePercent === null
        ? ""
        : `${formatChangePercent(entry.changePercent)} changed`;
    head.append(status, change);

    const title = document.createElement("span");
    title.className = "timeline-title";
    title.textContent = entry.title;
    const time = document.createElement("time");
    time.className = "timeline-time";
    time.dateTime = entry.timeText;
    time.textContent = formatDateTime(entry.timeText);
    card.append(head, title, time);

    if (entry.error) {
      const error = document.createElement("span");
      error.className = "timeline-error";
      error.textContent = entry.error;
      card.append(error);
    }

    item.append(marker, card);
    ui.timelineList.append(item);
  }
}

async function selectTimelineEntry(entry) {
  const chronological = [...state.timeline]
    .filter((item) => item.selectable)
    .sort((left, right) => left.timestamp - right.timestamp);
  const selectedIndex = chronological.findIndex((item) => item.id === entry.id);
  const precedingEntry = selectedIndex > 0 ? chronological[selectedIndex - 1] : null;
  const precedingCapture = precedingEntry
    ? state.captures.find((capture) => capture.id === precedingEntry.captureId)
    : findCaptureBefore(entry);

  if (!precedingCapture) {
    showStatus("This is the first saved run, so there is no preceding capture to compare.", "info");
    return;
  }

  ui.beforeSelect.value = precedingCapture.id;
  ui.afterSelect.value = entry.captureId;
  await loadComparison(precedingCapture.id, entry.captureId);
}

function findCaptureBefore(entry) {
  const selectedCapture = findCapture(entry.captureId);

  if (!selectedCapture) {
    return null;
  }

  return [...state.captures]
    .filter((capture) => areCapturesComparable(capture, selectedCapture))
    .filter((capture) => captureTimestamp(capture) < entry.timestamp)
    .sort((left, right) => captureTimestamp(right) - captureTimestamp(left))[0] || null;
}

function updateTimelineSelection(captureId) {
  ui.timelineList.querySelectorAll("button.timeline-entry").forEach((button) => {
    button.setAttribute("aria-current", String(button.dataset.captureId === captureId));
  });
}

function swapCaptures() {
  const beforeId = ui.beforeSelect.value;
  const afterId = ui.afterSelect.value;

  if (!beforeId || !afterId) {
    showStatus("Choose a before and after capture before swapping them.", "info");
    return;
  }

  ui.beforeSelect.value = afterId;
  ui.afterSelect.value = beforeId;
  loadComparison(afterId, beforeId);
}

function handleStageKeydown(event) {
  const current = Number(ui.revealSlider.value);
  let next = current;

  if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
    next = current - (event.shiftKey ? 10 : 2);
  } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
    next = current + (event.shiftKey ? 10 : 2);
  } else if (event.key === "Home") {
    next = 0;
  } else if (event.key === "End") {
    next = 100;
  } else {
    return;
  }

  event.preventDefault();
  updateReveal(next);
}

function handleStagePointerDown(event) {
  if (state.busy || ui.reviewContent.classList.contains("is-hidden")) {
    return;
  }

  state.dragging = true;
  ui.comparisonStage.setPointerCapture(event.pointerId);
  updateRevealFromPointer(event);
}

function handleStagePointerMove(event) {
  if (state.dragging) {
    updateRevealFromPointer(event);
  }
}

function stopStagePointerDrag(event) {
  state.dragging = false;

  if (ui.comparisonStage.hasPointerCapture?.(event.pointerId)) {
    ui.comparisonStage.releasePointerCapture(event.pointerId);
  }
}

function updateRevealFromPointer(event) {
  const bounds = ui.comparisonStage.getBoundingClientRect();
  const value = bounds.width ? ((event.clientX - bounds.left) / bounds.width) * 100 : 50;
  updateReveal(value);
}

function updateReveal(value) {
  const normalized = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  ui.revealSlider.value = String(normalized);
  ui.revealSlider.setAttribute("aria-label", `Reveal amount: ${normalized} percent after`);
  ui.revealOutput.value = `${normalized}% after`;
  ui.revealOutput.textContent = `${normalized}% after`;
  ui.comparisonStage.style.setProperty("--reveal", `${normalized}%`);
}

async function loadPreviewAsset(captureId) {
  if (state.demoMode && state.demoAssets.has(captureId)) {
    return { captureId, blob: state.demoAssets.get(captureId) };
  }

  const editorSource = await getLibraryEditorAsset(captureId);

  if (editorSource?.blob) {
    return editorSource;
  }

  return getLibraryPreviewAsset(captureId);
}

async function decodeImage(blob) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close()
    };
  }

  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";

  try {
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", () => reject(new Error("A local capture image could not be decoded.")), { once: true });
      image.src = objectUrl;
    });
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(objectUrl)
  };
}

function calculateComparisonSize(beforeImage, afterImage) {
  const naturalWidth = Math.max(beforeImage.width, afterImage.width);
  const naturalHeight = Math.max(beforeImage.height, afterImage.height);
  const dimensionalScale = Math.min(
    1,
    MAX_COMPARISON_WIDTH / naturalWidth,
    MAX_COMPARISON_HEIGHT / naturalHeight
  );
  const pixelScale = Math.min(1, Math.sqrt(MAX_COMPARISON_PIXELS / (naturalWidth * naturalHeight)));
  const scale = Math.min(dimensionalScale, pixelScale);

  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
    scale
  };
}

function drawComparisonFrame(canvas, image, size) {
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, size.width, size.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image.source,
    0,
    0,
    Math.max(1, Math.round(image.width * size.scale)),
    Math.max(1, Math.round(image.height * size.scale))
  );
  return context.getImageData(0, 0, size.width, size.height);
}

async function readWatchRuns() {
  const storage = globalThis.chrome?.storage?.local;

  if (!storage?.get) {
    return [];
  }

  try {
    const stored = await storage.get(STORAGE_KEYS.watchRuns);
    return Array.isArray(stored?.[STORAGE_KEYS.watchRuns]) ? stored[STORAGE_KEYS.watchRuns] : [];
  } catch {
    return [];
  }
}

function updateAddressBar(beforeId, afterId) {
  if (state.demoMode) {
    return;
  }

  const params = new URLSearchParams(location.search);
  if (beforeId) {
    params.set("before", beforeId);
  } else {
    params.delete("before");
  }

  if (afterId) {
    params.set("after", afterId);
  } else {
    params.delete("after");
  }

  params.delete("capture");

  if (state.watchPlanId) {
    params.set("watch", state.watchPlanId);
  } else {
    params.delete("watch");
  }

  history.replaceState(null, "", `${location.pathname}?${params.toString()}`);
}

function installIntegrationHooks() {
  const loadPair = async (options = {}) => {
    const {
      beforeCaptureId = "",
      afterCaptureId = "",
      runs
    } = options;

    if (Array.isArray(runs)) {
      state.injectedRuns = runs;
      state.runs = runs;
    }

    if (Object.hasOwn(options, "watchPlanId")) {
      state.watchPlanId = String(options.watchPlanId || "");
    }

    state.requestedBeforeId = beforeCaptureId;
    state.requestedAfterId = afterCaptureId;

    if (beforeCaptureId && afterCaptureId) {
      populateCaptureSelects();
      ui.beforeSelect.value = beforeCaptureId;
      ui.afterSelect.value = afterCaptureId;
      return loadComparison(beforeCaptureId, afterCaptureId);
    }

    return refreshReview();
  };

  const getSelection = () => ({
    beforeCaptureId: state.requestedBeforeId,
    afterCaptureId: state.requestedAfterId,
    selectedCaptureId: state.requestedAfterId,
    watchPlanId: state.watchPlanId,
    afterImageAvailable: isEditableCapture(findCapture(state.requestedAfterId)),
    afterImageExportAvailable: hasEditorExportSource(findCapture(state.requestedAfterId)),
    afterPdfExportAvailable: hasPdfExportSource(findCapture(state.requestedAfterId)),
    diff: state.currentDiff
  });
  const getSelectedExportAsset = async () => {
    const capture = findCapture(state.requestedAfterId);

    if (!capture) {
      throw new Error("Choose an after capture before exporting.");
    }

    const asset = state.demoMode && state.demoAssets.has(capture.id)
      ? { captureId: capture.id, blob: state.demoAssets.get(capture.id), kind: "demo-source" }
      : await getLibraryEditorAsset(capture.id);

    if (!asset?.blob) {
      throw new Error("PNG export needs this capture's local editor source. The comparison thumbnail is intentionally not exportable.");
    }

    const originalWidth = Math.max(0, Math.round(Number(asset.originalWidth) || Number(asset.width) || 0));
    const originalHeight = Math.max(0, Math.round(Number(asset.originalHeight) || Number(asset.height) || 0));
    const width = Math.max(0, Math.round(Number(asset.width) || 0));
    const height = Math.max(0, Math.round(Number(asset.height) || 0));

    return {
      blob: asset.blob,
      captureId: capture.id,
      title: capture.title || capture.host || "capture",
      width,
      height,
      originalWidth,
      originalHeight,
      scaled: Boolean(asset.scaled),
      exact: !asset.scaled && (!originalWidth || !originalHeight || (width === originalWidth && height === originalHeight)),
      sourceKind: String(asset.kind || "editor-source")
    };
  };
  const getSelectedPdfAsset = async () => {
    const capture = findCapture(state.requestedAfterId);

    if (!capture) {
      throw new Error("Choose an after capture before exporting.");
    }

    if (!state.demoMode) {
      const pdfAsset = await getLibraryPdfAsset(capture.id);

      if (pdfAsset?.blob) {
        return {
          blob: pdfAsset.blob,
          captureId: capture.id,
          title: capture.title || capture.host || "capture",
          format: "pdf",
          cached: true,
          pageCount: Math.max(1, Math.round(Number(pdfAsset.pageCount) || 1)),
          rasterWidth: Math.max(0, Math.round(Number(pdfAsset.rasterWidth) || 0)),
          sourceWidth: Math.max(0, Math.round(Number(pdfAsset.sourceWidth) || 0)),
          sourceHeight: Math.max(0, Math.round(Number(pdfAsset.sourceHeight) || 0)),
          sourceExact: Boolean(pdfAsset.sourceExact),
          sourceKind: String(pdfAsset.kind || "capture-output-pdf")
        };
      }
    }

    const imageAsset = await getSelectedExportAsset();
    return {
      ...imageAsset,
      format: "image",
      cached: false
    };
  };
  const markReviewed = (metadata = {}) => {
    const detail = {
      ...getSelection(),
      reviewedAt: new Date().toISOString(),
      metadata: metadata && typeof metadata === "object" ? metadata : {}
    };
    const event = new CustomEvent("lumen-review-mark-reviewed", {
      detail,
      cancelable: true
    });
    window.dispatchEvent(event);
    return { ...detail, handled: event.defaultPrevented };
  };

  globalThis.LumenVisualReview = Object.freeze({
    loadPair,
    refresh: () => refreshReview({ announce: true }),
    setTimelineData: (runs) => loadPair({ runs }),
    getSelection,
    getSelectedCaptureId: () => state.requestedAfterId,
    getSelectedExportAsset,
    getSelectedPdfAsset,
    getActionsSlot: () => ui.reviewActions,
    markReviewed
  });
  window.addEventListener("lumen-review-load", (event) => {
    loadPair(event.detail || {}).catch(showFatalError);
  });
}

function publishSelection(beforeCapture, afterCapture, diff = null) {
  const beforeCaptureId = beforeCapture?.id || "";
  const afterCaptureId = afterCapture?.id || "";
  state.requestedBeforeId = beforeCaptureId;
  state.requestedAfterId = afterCaptureId;
  state.currentDiff = diff || null;
  document.body.dataset.selectedCaptureId = afterCaptureId;
  document.body.dataset.beforeCaptureId = beforeCaptureId;
  ui.reviewActions.dataset.captureId = afterCaptureId;
  ui.reviewActions.dataset.beforeCaptureId = beforeCaptureId;
  window.dispatchEvent(new CustomEvent("lumen-review-selection", {
    detail: {
      beforeCaptureId,
      afterCaptureId,
      selectedCaptureId: afterCaptureId,
      watchPlanId: state.watchPlanId || "",
      afterImageAvailable: isEditableCapture(afterCapture),
      afterImageExportAvailable: hasEditorExportSource(afterCapture),
      afterPdfExportAvailable: hasPdfExportSource(afterCapture),
      diff: state.currentDiff
    }
  }));
}

function updateReviewContext(beforeCapture, afterCapture) {
  state.watchPlanId = resolveReviewWatchPlanId(beforeCapture, afterCapture);
}

function findCapture(captureId) {
  return state.captures.find((capture) => capture.id === captureId) || null;
}

function isEditableCapture(capture) {
  if (!capture) {
    return false;
  }

  if (state.demoMode && state.demoAssets.has(capture.id)) {
    return true;
  }

  return hasLibraryPreview(capture) ||
    (capture.editorStatus === "ready" && Boolean(capture.editorAssetId));
}

function hasEditorExportSource(capture) {
  if (!capture) {
    return false;
  }

  if (state.demoMode && state.demoAssets.has(capture.id)) {
    return true;
  }

  return capture.editorStatus === "ready" && Boolean(capture.editorAssetId);
}

function hasPdfExportSource(capture) {
  if (!capture) {
    return false;
  }

  if (state.demoMode && state.demoAssets.has(capture.id)) {
    return true;
  }

  return hasLibraryPdf(capture) || hasEditorExportSource(capture);
}

function showIncompletePair(pair, beforeCapture, afterCapture) {
  if (pair?.source === "requested-unavailable") {
    showStatus("A requested capture is no longer in the local library.", "error", false);
    showEmptyState("Capture unavailable", "Refresh the review or choose another local capture.");
    return;
  }

  if (pair?.source === "incompatible" || (beforeCapture && afterCapture && !areCapturesComparable(beforeCapture, afterCapture))) {
    showStatus("These captures come from different pages or monitors and cannot be compared.", "error", false);
    showEmptyState(
      "Captures do not match",
      "The after capture is still selected. Choose an earlier capture from the same page or monitor."
    );
    return;
  }

  if (afterCapture) {
    showEmptyState(
      "No earlier matching capture",
      "This capture remains selected. Capture the same page again, or choose an earlier capture from the same page or monitor."
    );
    return;
  }

  if (beforeCapture) {
    showEmptyState(
      "No later matching capture",
      "This capture remains selected. Choose a later capture from the same page or monitor."
    );
    return;
  }

  showEmptyState();
}

async function createDemoReviewData() {
  const watchPlanId = "demo-checkout-monitor";
  const baseTime = Date.now() - 42 * 60 * 1000;
  const captures = [
    createDemoCapture("demo-before", "Checkout · Before", baseTime, watchPlanId),
    createDemoCapture("demo-middle", "Checkout · Inventory update", baseTime + 18 * 60 * 1000, watchPlanId),
    createDemoCapture("demo-after", "Checkout · After", baseTime + 36 * 60 * 1000, watchPlanId),
    createDemoCapture("demo-other", "Homepage · First saved run", baseTime + 39 * 60 * 1000, "demo-homepage-monitor")
  ];
  const images = await Promise.all([
    drawDemoCapture({ version: 0 }),
    drawDemoCapture({ version: 1 }),
    drawDemoCapture({ version: 2 })
  ]);
  const assets = new Map([
    ...captures.slice(0, 3).map((capture, index) => [capture.id, images[index]]),
    [captures[3].id, images[2]]
  ]);
  const runs = [
    createDemoRun("run-1", captures[0], "captured", 100),
    createDemoRun("run-2", null, "unchanged", 0, baseTime + 9 * 60 * 1000, watchPlanId),
    createDemoRun("run-3", captures[1], "captured", 2.8),
    createDemoRun("run-4", null, "failed", 0, baseTime + 28 * 60 * 1000, watchPlanId, "The page stopped responding before capture completed."),
    createDemoRun("run-5", captures[2], "captured", 6.4),
    createDemoRun("run-homepage-1", captures[3], "captured", 100)
  ];

  if (!state.requestedBeforeId && !state.requestedAfterId) {
    state.requestedBeforeId = captures[1].id;
    state.requestedAfterId = captures[2].id;
  }
  return { watchPlanId, captures, runs, assets };
}

function createDemoCapture(id, title, capturedAt, watchPlanId) {
  return {
    id,
    title,
    host: "store.lumen-demo.test",
    url: "https://store.lumen-demo.test/checkout",
    sourceType: "timed",
    watchPlanId,
    capturedAt: new Date(capturedAt).toISOString(),
    dimensions: { width: 1200, height: 750 },
    previewStatus: "ready"
  };
}

function createDemoRun(id, capture, status, changePercent, completedAt, watchPlanId, error = "") {
  return {
    id,
    captureId: capture?.id || "",
    watchPlanId: capture?.watchPlanId || watchPlanId,
    title: capture?.title || "Checkout monitor",
    url: capture?.url || "https://store.lumen-demo.test/checkout",
    status,
    changePercent,
    completedAt: capture?.capturedAt || new Date(completedAt).toISOString(),
    error
  };
}

async function drawDemoCapture({ version }) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 750;
  const context = canvas.getContext("2d");
  const changed = version > 0;
  const latest = version > 1;

  context.fillStyle = "#f4f5f7";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#0b1320";
  context.fillRect(0, 0, canvas.width, 82);
  context.fillStyle = "#7ff1c5";
  context.beginPath();
  context.arc(54, 41, 18, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f2fbfc";
  context.font = "700 25px system-ui";
  context.fillText("Northstar Supply", 86, 50);
  context.fillStyle = "#9fb1bf";
  context.font = "500 15px system-ui";
  context.fillText("Cart     Account", 995, 48);

  context.fillStyle = "#172333";
  context.font = "750 38px system-ui";
  context.fillText("Review your order", 74, 150);
  context.fillStyle = "#647180";
  context.font = "500 16px system-ui";
  context.fillText("Secure checkout · 3 items", 76, 181);

  drawDemoProduct(context, 76, 224, "Field Day Pack", changed ? "$118.00" : "$112.00", "Sand / One size", "#c78f60");
  drawDemoProduct(context, 76, 352, "Trail Bottle", "$28.00", latest ? "Moss / 1 liter" : "Slate / 1 liter", latest ? "#688d6b" : "#6b7f98");
  drawDemoProduct(context, 76, 480, "Utility Pouch", "$34.00", "Black / Medium", "#38424e");

  context.fillStyle = "#ffffff";
  roundedRect(context, 740, 126, 386, 470, 22);
  context.fill();
  context.strokeStyle = "#dce2e8";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "#172333";
  context.font = "750 24px system-ui";
  context.fillText("Order summary", 780, 179);
  drawSummaryLine(context, "Subtotal", changed ? "$180.00" : "$174.00", 232);
  drawSummaryLine(context, "Shipping", latest ? "Free" : "$8.00", 278);
  drawSummaryLine(context, "Estimated tax", latest ? "$14.40" : "$13.92", 324);
  context.strokeStyle = "#dce2e8";
  context.beginPath();
  context.moveTo(780, 352);
  context.lineTo(1086, 352);
  context.stroke();
  context.fillStyle = "#172333";
  context.font = "750 20px system-ui";
  context.fillText("Total", 780, 396);
  context.textAlign = "right";
  context.fillText(latest ? "$194.40" : changed ? "$201.92" : "$195.92", 1086, 396);
  context.textAlign = "left";

  context.fillStyle = latest ? "#126f56" : "#172333";
  roundedRect(context, 780, 438, 306, 62, 13);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = "750 18px system-ui";
  context.textAlign = "center";
  context.fillText(latest ? "Complete secure checkout" : "Continue to payment", 933, 477);
  context.textAlign = "left";

  if (latest) {
    context.fillStyle = "#e1f8ee";
    roundedRect(context, 780, 520, 306, 46, 10);
    context.fill();
    context.fillStyle = "#126f56";
    context.font = "650 14px system-ui";
    context.fillText("Free shipping unlocked", 807, 549);
  } else {
    context.fillStyle = "#768493";
    context.font = "500 13px system-ui";
    context.textAlign = "center";
    context.fillText("Taxes calculated at checkout", 933, 545);
    context.textAlign = "left";
  }

  context.fillStyle = "#d9e0e6";
  context.fillRect(0, 687, 1200, 1);
  context.fillStyle = "#647180";
  context.font = "500 13px system-ui";
  context.fillText("© Northstar Supply     Shipping & returns     Privacy", 76, 721);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The demo preview could not be created.")), "image/png");
  });
}

function drawDemoProduct(context, x, y, title, price, detail, swatch) {
  context.fillStyle = "#e3e7eb";
  roundedRect(context, x, y, 100, 98, 14);
  context.fill();
  context.fillStyle = swatch;
  roundedRect(context, x + 18, y + 19, 64, 60, 12);
  context.fill();
  context.fillStyle = "#172333";
  context.font = "700 18px system-ui";
  context.fillText(title, x + 126, y + 30);
  context.fillStyle = "#647180";
  context.font = "500 14px system-ui";
  context.fillText(detail, x + 126, y + 56);
  context.fillStyle = "#172333";
  context.font = "700 16px system-ui";
  context.fillText(price, x + 126, y + 83);
}

function drawSummaryLine(context, label, value, y) {
  context.fillStyle = "#647180";
  context.font = "500 16px system-ui";
  context.fillText(label, 780, y);
  context.fillStyle = "#172333";
  context.font = "650 16px system-ui";
  context.textAlign = "right";
  context.fillText(value, 1086, y);
  context.textAlign = "left";
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function showReviewContent() {
  ui.emptyState.classList.add("is-hidden");
  ui.reviewContent.classList.remove("is-hidden");
}

function showEmptyState(title = "Two local capture images are required.", copy = "Run the same timed area capture twice, or choose two captures from the same page or monitor.") {
  ui.emptyTitle.textContent = title;
  ui.emptyCopy.textContent = copy;
  ui.emptyState.classList.remove("is-hidden");
  ui.reviewContent.classList.add("is-hidden");
}

function showFatalError(error) {
  const message = error?.message || "The visual review could not be loaded.";
  publishSelection(findCapture(state.requestedBeforeId), findCapture(state.requestedAfterId), null);
  showStatus(message, "error", false);
  showEmptyState("Visual review unavailable", message);
  setBusy(false);
}

function showStatus(message, tone = "info", autoHide = true) {
  clearTimeout(state.statusTimer);
  ui.reviewStatus.textContent = message;
  ui.reviewStatus.dataset.tone = tone;
  ui.reviewStatus.classList.remove("is-hidden");

  if (autoHide) {
    state.statusTimer = window.setTimeout(() => ui.reviewStatus.classList.add("is-hidden"), 5200);
  }
}

function setBusy(busy) {
  state.busy = busy;
  ui.refreshButton.disabled = busy;
  ui.beforeSelect.disabled = busy;
  ui.afterSelect.disabled = busy;
  ui.swapButton.disabled = busy;
  ui.comparisonStage.setAttribute("aria-busy", String(busy));
}

function buildComparisonStatus(diff) {
  if (diff.classification === "identical") {
    return "The two local previews are pixel-identical at the comparison resolution.";
  }

  return `${formatChangePercent(diff.changePercent)} changed across ${diff.regionCount} detected ${diff.regionCount === 1 ? "region" : "regions"}.`;
}

function buildDimensionNote(context, diff) {
  const beforeDimensions = `${context.beforeImage.width} × ${context.beforeImage.height}`;
  const afterDimensions = `${context.afterImage.width} × ${context.afterImage.height}`;
  const comparisonDimensions = `${diff.width} × ${diff.height}`;
  const mismatch = beforeDimensions !== afterDimensions
    ? ` Source dimensions differ: before ${beforeDimensions}px, after ${afterDimensions}px.`
    : ` Both sources are ${beforeDimensions}px.`;
  return `Measured at ${comparisonDimensions}px with a ${diff.threshold}-point color threshold.${mismatch}`;
}

function formatCaptureOption(capture) {
  const title = capture.title || capture.host || "Untitled capture";
  return `${formatDateTime(capture.capturedAt)} — ${title}`;
}

function classificationLabel(classification) {
  return ({
    identical: "No change",
    minor: "Minor change",
    noticeable: "Noticeable change",
    major: "Major change"
  })[classification] || "Measured";
}

function timelineStatusLabel(status) {
  return ({
    captured: "Change captured",
    unchanged: "Checked · unchanged",
    failed: "Capture failed",
    running: "Running now",
    queued: "Queued",
    skipped: "Skipped"
  })[status] || "Monitor run";
}

function describeRegionPosition(region) {
  const horizontal = region.leftPercent + region.widthPercent / 2 < 34
    ? "left"
    : region.leftPercent + region.widthPercent / 2 > 66
      ? "right"
      : "center";
  const vertical = region.topPercent + region.heightPercent / 2 < 34
    ? "top"
    : region.topPercent + region.heightPercent / 2 > 66
      ? "bottom"
      : "middle";
  return `${capitalize(vertical)} ${horizontal}`;
}

function formatDateTime(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(timestamp)
    : "Time unavailable";
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Math.max(0, Number(value) || 0));
}

function formatItemCount(count) {
  return `${count} ${count === 1 ? "capture" : "captures"}`;
}

function captureTimestamp(capture) {
  return Date.parse(capture?.capturedAt || capture?.createdAt || "") || 0;
}

function capitalize(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "";
}
