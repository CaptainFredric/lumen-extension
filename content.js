(function initLumenContentScript() {
  if (window.__LUMEN_CONTENT_SCRIPT__) {
    return;
  }

  window.__LUMEN_CONTENT_SCRIPT__ = true;

  const MAX_BLUEPRINT_SAMPLE_ELEMENTS = 420;
  const MAX_PALETTE_COLORS = 6;
  const MAX_FONT_FAMILIES = 5;
  const MAX_NAV_LABELS = 6;
  const MAX_STRUCTURE_HEADINGS = 4;
  const MAX_REDACTION_REGIONS = 80;
  const PAGE_READY_TIMEOUT_MS = 2200;
  const OVERLAY_SETTLE_MS = 140;
  const MANUAL_REDACTION_LIMIT = 24;
  const SENSITIVE_TEXT_PATTERNS = [
    {
      kind: "email",
      regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
    },
    {
      kind: "phone",
      regex: /(?:\+?\d[\d().\s-]{7,}\d)/g
    },
    {
      kind: "secret",
      regex: /\b(?:sk_(?:live|test)_[A-Za-z0-9]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\-_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:api[_-]?key|secret|token|access[_-]?token)[^A-Za-z0-9]{0,3}[A-Za-z0-9_\-]{10,})\b/gi
    }
  ];
  const GENERIC_FONT_FAMILIES = new Set([
    "sans-serif",
    "serif",
    "monospace",
    "system-ui",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
    "inherit",
    "initial",
    "unset"
  ]);

  const captureState = {
    hiddenNodes: [],
    originalScrollX: 0,
    originalScrollY: 0,
    freezeStyleNode: null,
    overlayObserver: null,
    prepared: false,
    scrollRoot: null,
    scrollContext: null,
    manualPicker: null
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.type) {
      return;
    }

    if (message.type === "LUMEN_PREPARE_CAPTURE") {
      handlePrepareCapture(message.options)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === "LUMEN_SCROLL_TO") {
      scrollToPosition(message.top)
        .then((result) => sendResponse(result))
        .catch(() => sendResponse({ top: Math.round(window.scrollY) }));
      return true;
    }

    if (message.type === "LUMEN_RESTORE_PAGE") {
      restorePageState()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === "LUMEN_MEASURE_PAGE") {
      measurePreparedPage()
        .then((page) => sendResponse({ ok: true, page }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === "LUMEN_EXTRACT_BLUEPRINT") {
      Promise.resolve()
        .then(() => sendResponse({ ok: true, blueprint: extractBrandBlueprint() }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === "LUMEN_SCAN_REDACTIONS") {
      Promise.resolve()
        .then(() => sendResponse({ ok: true, redactions: scanSensitiveRegions() }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === "LUMEN_RESOLVE_MANUAL_REDACTIONS") {
      Promise.resolve()
        .then(() => sendResponse({ ok: true, manualRedactions: resolveManualRedactions(message.payload || {}) }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === "LUMEN_START_MANUAL_REDACTION_PICKER") {
      Promise.resolve()
        .then(() => sendResponse({ ok: true, picker: startManualRedactionPicker(message.payload || {}) }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message.type === "LUMEN_CLEAR_MANUAL_REDACTION_PICKER") {
      Promise.resolve()
        .then(() => sendResponse({ ok: true, picker: clearManualRedactionPicker() }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
  });

  async function handlePrepareCapture(options = {}) {
    await restorePageState();

    captureState.scrollContext = detectScrollContext();
    captureState.scrollRoot = captureState.scrollContext.node;
    captureState.originalScrollX = getScrollLeft();
    captureState.originalScrollY = getScrollTop();

    freezeAnimationsAndSmoothScroll();
    primeLazyMedia(document);

    if (options.forceLazyLoad) {
      await runPreflightScroll();
    } else {
      setScrollTop(0);
      await settleFrames(2);
    }

    await waitForPageReady();

    let hiddenCount = 0;

    if (options.removeStickyHeaders) {
      hiddenCount = hideAggressiveLayers();
      startOverlayObserver();
      await pause(OVERLAY_SETTLE_MS);
      hiddenCount += hideAggressiveLayers();
      await settleFrames(2);
    }

    captureState.prepared = true;

    return {
      page: {
        ...getPageMetrics(),
        hiddenCount
      }
    };
  }

  async function scrollToPosition(top) {
    const metrics = getPageMetrics();
    const maxScrollTop = Math.max(0, metrics.pageHeight - metrics.viewportHeight);
    const clampedTop = Math.max(0, Math.min(top, maxScrollTop));

    setScrollTop(clampedTop);
    await settleFrames(2);
    primeLazyMedia(getScrollContainerNode());
    await waitForPageReady();

    if (captureState.overlayObserver || captureState.hiddenNodes.length) {
      hideAggressiveLayers();
      await pause(OVERLAY_SETTLE_MS);
    }

    return {
      top: Math.round(getScrollTop()),
      pageHeight: getPageMetrics().pageHeight,
      viewportHeight: getPageMetrics().viewportHeight
    };
  }

  async function restorePageState() {
    teardownManualRedactionPicker(false);
    stopOverlayObserver();
    restoreHiddenNodes();
    removeFreezeStyle();

    if (captureState.prepared) {
      setScrollTop(captureState.originalScrollY);
      await settleFrames(1);
    }

    captureState.prepared = false;
    captureState.scrollRoot = null;
    captureState.scrollContext = null;
  }

  async function measurePreparedPage() {
    await waitForPageReady();

    if (captureState.overlayObserver || captureState.hiddenNodes.length) {
      hideAggressiveLayers();
      await pause(OVERLAY_SETTLE_MS);
    }

    await settleFrames(2);
    return getPageMetrics();
  }

  function extractBrandBlueprint() {
    const metrics = getPageMetrics();
    const sampledElements = getVisibleElements(MAX_BLUEPRINT_SAMPLE_ELEMENTS);
    const structureHeadings = getStructureHeadings();
    const heroHeadline = findHeroHeadline(structureHeadings);
    const primaryCta = findPrimaryCta();
    const navLabels = getNavLabels();
    const colors = buildPalette(sampledElements);
    const fonts = buildFontProfile(sampledElements);
    const layout = buildLayoutSnapshot();

    return {
      generatedAt: new Date().toISOString(),
      page: {
        title: document.title,
        url: window.location.href,
        host: window.location.host,
        description: getMetaDescription(),
        scrollMode: metrics.scrollMode,
        scrollContainer: metrics.scrollContainer
      },
      identity: {
        siteType: inferSiteType(layout),
        heroHeadline,
        primaryCta,
        navLabels
      },
      colors,
      typography: {
        headingFont: getHeadingFont() || fonts[0]?.family || "Unknown",
        bodyFont: getBodyFont() || fonts[1]?.family || fonts[0]?.family || "Unknown",
        families: fonts
      },
      layout: {
        ...layout,
        viewportWidth: metrics.viewportWidth,
        viewportHeight: metrics.viewportHeight
      },
      structure: structureHeadings
    };
  }

  function scanSensitiveRegions() {
    const context = captureState.scrollContext || detectScrollContext();
    const collected = [
      ...collectSensitiveTextRegions(context),
      ...collectSensitiveFieldRegions(context)
    ];
    const regions = mergeSensitiveRegions(collected).slice(0, MAX_REDACTION_REGIONS);

    return {
      count: regions.length,
      regions,
      breakdown: buildRedactionBreakdown(regions)
    };
  }

  function startManualRedactionPicker({ regions = [] } = {}) {
    teardownManualRedactionPicker(false);

    const overlay = document.createElement("div");
    const surface = document.createElement("div");
    const toolbar = document.createElement("div");
    const title = document.createElement("strong");
    const hint = document.createElement("span");
    const count = document.createElement("span");
    const undoButton = document.createElement("button");
    const clearButton = document.createElement("button");
    const doneButton = document.createElement("button");
    const cancelButton = document.createElement("button");

    overlay.id = "lumen-redaction-picker";
    surface.className = "lumen-redaction-surface";
    toolbar.className = "lumen-redaction-toolbar";
    title.textContent = "Lumen manual redaction";
    hint.textContent = "Drag boxes over sensitive areas. These boxes apply to the current desktop layout.";
    count.className = "lumen-redaction-count";
    undoButton.textContent = "Undo";
    clearButton.textContent = "Clear";
    doneButton.textContent = "Done";
    cancelButton.textContent = "Cancel";

    for (const button of [undoButton, clearButton, doneButton, cancelButton]) {
      button.type = "button";
    }

    toolbar.append(title, hint, count, undoButton, clearButton, doneButton, cancelButton);
    overlay.append(surface, toolbar);
    document.documentElement.appendChild(overlay);

    const picker = {
      overlay,
      surface,
      count,
      regions: normalizeManualRegions(regions),
      draft: null,
      start: null,
      moved: false
    };

    captureState.manualPicker = picker;
    injectManualPickerStyles();
    renderManualRedactionBoxes();

    surface.addEventListener("pointerdown", handleManualPickerPointerDown);
    surface.addEventListener("pointermove", handleManualPickerPointerMove);
    surface.addEventListener("pointerup", handleManualPickerPointerUp);
    surface.addEventListener("pointercancel", handleManualPickerPointerCancel);

    undoButton.addEventListener("click", () => {
      picker.regions.pop();
      renderManualRedactionBoxes();
      persistManualRedactions();
    });
    clearButton.addEventListener("click", () => {
      picker.regions = [];
      renderManualRedactionBoxes();
      persistManualRedactions();
    });
    doneButton.addEventListener("click", () => {
      persistManualRedactions();
      teardownManualRedactionPicker(false);
    });
    cancelButton.addEventListener("click", () => teardownManualRedactionPicker(false));

    window.addEventListener("keydown", handleManualPickerKeydown, true);

    persistManualRedactions();
    return buildManualPickerPayload();
  }

  function clearManualRedactionPicker() {
    if (captureState.manualPicker) {
      captureState.manualPicker.regions = [];
      renderManualRedactionBoxes();
    }

    chrome.runtime.sendMessage({
      type: "LUMEN_MANUAL_REDACTIONS_UPDATED",
      payload: {
        regions: [],
        context: getPageMetrics()
      }
    }).catch(() => {});

    return {
      count: 0,
      regions: []
    };
  }

  function teardownManualRedactionPicker(persist = true) {
    const picker = captureState.manualPicker;

    if (!picker) {
      return;
    }

    if (persist) {
      persistManualRedactions();
    }

    window.removeEventListener("keydown", handleManualPickerKeydown, true);
    picker.overlay.remove();
    captureState.manualPicker = null;
  }

  function handleManualPickerPointerDown(event) {
    const picker = captureState.manualPicker;

    if (!picker || event.button !== 0) {
      return;
    }

    event.preventDefault();
    picker.surface.setPointerCapture(event.pointerId);
    picker.start = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId
    };
    picker.moved = false;
    picker.draft = document.createElement("div");
    picker.draft.className = "lumen-redaction-box lumen-redaction-box-draft";
    picker.surface.appendChild(picker.draft);
  }

  function handleManualPickerPointerMove(event) {
    const picker = captureState.manualPicker;

    if (!picker?.start || !picker.draft || event.pointerId !== picker.start.pointerId) {
      return;
    }

    event.preventDefault();
    picker.moved = true;
    drawManualPickerBox(picker.draft, normalizeViewportRect(picker.start.x, picker.start.y, event.clientX, event.clientY));
  }

  function handleManualPickerPointerUp(event) {
    const picker = captureState.manualPicker;

    if (!picker?.start || event.pointerId !== picker.start.pointerId) {
      return;
    }

    event.preventDefault();

    const rect = normalizeViewportRect(picker.start.x, picker.start.y, event.clientX, event.clientY);
    picker.surface.releasePointerCapture(event.pointerId);
    picker.draft?.remove();
    picker.draft = null;
    picker.start = null;

    if (!picker.moved || rect.width < 8 || rect.height < 8) {
      picker.moved = false;
      return;
    }

    const region = buildManualRedactionRegion(rect);

    if (region) {
      picker.regions = [...picker.regions, region].slice(-MANUAL_REDACTION_LIMIT);
      renderManualRedactionBoxes();
      persistManualRedactions();
    }

    picker.moved = false;
  }

  function handleManualPickerPointerCancel(event) {
    const picker = captureState.manualPicker;

    if (!picker?.start || event.pointerId !== picker.start.pointerId) {
      return;
    }

    picker.draft?.remove();
    picker.draft = null;
    picker.start = null;
    picker.moved = false;
  }

  function handleManualPickerKeydown(event) {
    const picker = captureState.manualPicker;

    if (!picker) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      teardownManualRedactionPicker(false);
      return;
    }

    if ((event.key === "Backspace" || event.key === "Delete") && picker.regions.length) {
      event.preventDefault();
      picker.regions.pop();
      renderManualRedactionBoxes();
      persistManualRedactions();
    }
  }

  function buildManualRedactionRegion(viewportRect) {
    const context = detectScrollContext();
    const region = buildRedactionRegion(viewportRect, context, "manual");

    if (!region) {
      return null;
    }

    const anchor = buildManualRedactionAnchor(viewportRect, region, context);

    return {
      ...region,
      id: createLocalId(),
      sourceViewport: getManualRedactionSourceViewport(context),
      ...(anchor ? { anchor } : {})
    };
  }

  function normalizeManualRegions(regions) {
    return (Array.isArray(regions) ? regions : [])
      .filter((region) => Number.isFinite(region.left) && Number.isFinite(region.top))
      .map((region) => ({
        id: region.id || createLocalId(),
        kind: "manual",
        left: Math.max(0, Math.round(region.left)),
        top: Math.max(0, Math.round(region.top)),
        width: Math.max(1, Math.round(region.width || 1)),
        height: Math.max(1, Math.round(region.height || 1)),
        ...(normalizeManualRedactionSourceViewport(region.sourceViewport) ? {
          sourceViewport: normalizeManualRedactionSourceViewport(region.sourceViewport)
        } : {}),
        ...(normalizeManualRedactionAnchor(region.anchor) ? {
          anchor: normalizeManualRedactionAnchor(region.anchor)
        } : {})
      }))
      .slice(0, MANUAL_REDACTION_LIMIT);
  }

  function resolveManualRedactions({ regions = [], context: recordContext = null } = {}) {
    const context = captureState.scrollContext || detectScrollContext();
    const page = getPageMetrics();
    const resolved = [];
    const sourceViewportFallback = normalizeManualRedactionSourceViewport(recordContext);
    let anchorResolvedCount = 0;
    let directCount = 0;
    let skippedCount = 0;

    for (const region of normalizeManualRegions(regions)) {
      const projected = resolveAnchoredManualRegion(region, context);

      if (projected) {
        resolved.push(projected);
        anchorResolvedCount += 1;
        continue;
      }

      const direct = resolveDirectManualRegion(region, context, page, sourceViewportFallback);

      if (direct) {
        resolved.push(direct);
        directCount += 1;
        continue;
      }

      skippedCount += 1;
    }

    return {
      count: resolved.length,
      regions: resolved,
      projectedCount: anchorResolvedCount,
      directCount,
      skippedCount,
      breakdown: buildRedactionBreakdown(resolved)
    };
  }

  function resolveAnchoredManualRegion(region, context) {
    const anchor = normalizeManualRedactionAnchor(region.anchor);

    if (!anchor?.selector || !anchor.ratios) {
      return null;
    }

    const node = findManualAnchorNode(anchor);

    if (!(node instanceof HTMLElement) || !isElementScannable(node)) {
      return null;
    }

    const coordinates = toScrollCoordinates(node.getBoundingClientRect(), context);

    if (!coordinates || coordinates.width < 2 || coordinates.height < 2) {
      return null;
    }

    const nextRegion = {
      id: region.id,
      kind: "manual",
      left: Math.round(coordinates.left + anchor.ratios.left * coordinates.width),
      top: Math.round(coordinates.top + anchor.ratios.top * coordinates.height),
      width: Math.max(1, Math.round(anchor.ratios.width * coordinates.width)),
      height: Math.max(1, Math.round(anchor.ratios.height * coordinates.height)),
      projected: true,
      projection: "anchor"
    };

    return isResolvedManualRegionValid(nextRegion) ? nextRegion : null;
  }

  function resolveDirectManualRegion(region, context, page, sourceViewportFallback) {
    const sourceViewport = normalizeManualRedactionSourceViewport(region.sourceViewport) || sourceViewportFallback;

    if (!sourceViewport) {
      return null;
    }

    if (
      (sourceViewport.scrollMode !== page.scrollMode || sourceViewport.scrollContainer !== page.scrollContainer)
    ) {
      return null;
    }

    const sourceWidth = sourceViewport?.viewportWidth;
    const sameViewport =
      !sourceWidth ||
      Math.abs(sourceWidth - page.viewportWidth) <= Math.max(2, page.viewportWidth * 0.02);

    if (!sameViewport) {
      return null;
    }

    const nextRegion = {
      id: region.id,
      kind: "manual",
      left: Math.max(0, Math.round(region.left)),
      top: Math.max(0, Math.round(region.top)),
      width: Math.max(1, Math.round(region.width)),
      height: Math.max(1, Math.round(region.height)),
      projected: false,
      projection: "direct"
    };

    return isResolvedManualRegionValid(nextRegion) && doesManualRegionIntersectPage(nextRegion, context)
      ? nextRegion
      : null;
  }

  function isResolvedManualRegionValid(region) {
    return Number.isFinite(region.left) &&
      Number.isFinite(region.top) &&
      Number.isFinite(region.width) &&
      Number.isFinite(region.height) &&
      region.width > 1 &&
      region.height > 1;
  }

  function doesManualRegionIntersectPage(region, context) {
    const page = getPageMetrics();
    const maxWidth = context.isDocument ? document.documentElement.scrollWidth : context.node.scrollWidth;
    const right = region.left + region.width;
    const bottom = region.top + region.height;

    return right > 0 && bottom > 0 && region.left < maxWidth && region.top < page.pageHeight;
  }

  function buildManualRedactionAnchor(viewportRect, region, context) {
    const node = getElementUnderManualRect(viewportRect);

    if (!(node instanceof HTMLElement)) {
      return null;
    }

    const selector = buildStableCssPath(node);

    if (!selector) {
      return null;
    }

    const elementCoordinates = toScrollCoordinates(node.getBoundingClientRect(), context);

    if (!elementCoordinates || elementCoordinates.width < 2 || elementCoordinates.height < 2) {
      return null;
    }

    return {
      selector,
      tagName: node.tagName.toLowerCase(),
      sourceRect: {
        left: Math.round(elementCoordinates.left),
        top: Math.round(elementCoordinates.top),
        width: Math.round(elementCoordinates.width),
        height: Math.round(elementCoordinates.height)
      },
      ratios: {
        left: clampRatio((region.left - elementCoordinates.left) / elementCoordinates.width),
        top: clampRatio((region.top - elementCoordinates.top) / elementCoordinates.height),
        width: clampRatio(region.width / elementCoordinates.width),
        height: clampRatio(region.height / elementCoordinates.height)
      }
    };
  }

  function getElementUnderManualRect(viewportRect) {
    const centerX = viewportRect.left + viewportRect.width / 2;
    const centerY = viewportRect.top + viewportRect.height / 2;
    const overlay = captureState.manualPicker?.overlay;
    const previousVisibility = overlay?.style.visibility || "";
    const previousPointerEvents = overlay?.style.pointerEvents || "";

    if (overlay) {
      overlay.style.visibility = "hidden";
      overlay.style.pointerEvents = "none";
    }

    try {
      const nodes = document.elementsFromPoint(centerX, centerY);
      return nodes.find((node) =>
        node instanceof HTMLElement &&
        !["html", "body"].includes(node.tagName.toLowerCase()) &&
        !node.closest("#lumen-redaction-picker") &&
        isElementScannable(node)
      ) || null;
    } finally {
      if (overlay) {
        overlay.style.visibility = previousVisibility;
        overlay.style.pointerEvents = previousPointerEvents;
      }
    }
  }

  function findManualAnchorNode(anchor) {
    try {
      const node = document.querySelector(anchor.selector);

      if (node instanceof HTMLElement) {
        return node;
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  function buildStableCssPath(node) {
    if (!(node instanceof HTMLElement)) {
      return "";
    }

    if (node.id && document.querySelectorAll(`#${escapeCssIdentifier(node.id)}`).length === 1) {
      return `#${escapeCssIdentifier(node.id)}`;
    }

    const parts = [];
    let current = node;

    while (current && current instanceof HTMLElement && current !== document.body && current !== document.documentElement) {
      parts.unshift(buildCssPathPart(current));

      const candidate = parts.join(" > ");

      try {
        if (document.querySelectorAll(candidate).length === 1) {
          return candidate;
        }
      } catch (error) {
        return "";
      }

      current = current.parentElement;

      if (parts.length >= 6) {
        break;
      }
    }

    return "";
  }

  function buildCssPathPart(node) {
    const tag = node.tagName.toLowerCase();
    const stableAttributes = ["data-testid", "data-test", "data-cy", "name", "aria-label"];

    for (const attr of stableAttributes) {
      const value = node.getAttribute(attr);

      if (value && !looksSensitiveSelectorValue(value)) {
        return `${tag}[${attr}="${escapeCssString(value)}"]`;
      }
    }

    const classNames = [...node.classList]
      .filter((className) => !/^lumen-/i.test(className) && /^[A-Za-z0-9_-]{2,}$/.test(className))
      .slice(0, 2)
      .map((className) => `.${escapeCssIdentifier(className)}`)
      .join("");
    const siblingIndex = getElementSiblingIndex(node);

    return `${tag}${classNames}:nth-of-type(${siblingIndex})`;
  }

  function normalizeManualRedactionAnchor(anchor) {
    if (!anchor || typeof anchor !== "object" || typeof anchor.selector !== "string") {
      return null;
    }

    const ratios = anchor.ratios || {};

    if (
      !Number.isFinite(ratios.left) ||
      !Number.isFinite(ratios.top) ||
      !Number.isFinite(ratios.width) ||
      !Number.isFinite(ratios.height)
    ) {
      return null;
    }

    return {
      selector: anchor.selector.slice(0, 640),
      tagName: typeof anchor.tagName === "string" ? anchor.tagName.slice(0, 48) : "",
      sourceRect: normalizeAnchorSourceRect(anchor.sourceRect),
      ratios: {
        left: clampRatio(ratios.left),
        top: clampRatio(ratios.top),
        width: clampRatio(ratios.width),
        height: clampRatio(ratios.height)
      }
    };
  }

  function normalizeAnchorSourceRect(sourceRect) {
    if (!sourceRect || typeof sourceRect !== "object") {
      return null;
    }

    return {
      left: Math.max(0, Math.round(sourceRect.left || 0)),
      top: Math.max(0, Math.round(sourceRect.top || 0)),
      width: Math.max(1, Math.round(sourceRect.width || 1)),
      height: Math.max(1, Math.round(sourceRect.height || 1))
    };
  }

  function getManualRedactionSourceViewport(context) {
    const metrics = getPageMetrics();

    return {
      viewportWidth: metrics.viewportWidth,
      viewportHeight: metrics.viewportHeight,
      pageHeight: metrics.pageHeight,
      scrollMode: metrics.scrollMode,
      scrollContainer: metrics.scrollContainer || context.label || "document"
    };
  }

  function normalizeManualRedactionSourceViewport(sourceViewport) {
    if (!sourceViewport || typeof sourceViewport !== "object") {
      return null;
    }

    return {
      viewportWidth: Math.max(1, Math.round(sourceViewport.viewportWidth || 0)),
      viewportHeight: Math.max(1, Math.round(sourceViewport.viewportHeight || 0)),
      pageHeight: Math.max(1, Math.round(sourceViewport.pageHeight || 0)),
      scrollMode: sourceViewport.scrollMode === "container" ? "container" : "document",
      scrollContainer: typeof sourceViewport.scrollContainer === "string"
        ? sourceViewport.scrollContainer.slice(0, 160)
        : "document"
    };
  }

  function getElementSiblingIndex(node) {
    let index = 1;
    let sibling = node.previousElementSibling;

    while (sibling) {
      if (sibling.tagName === node.tagName) {
        index += 1;
      }

      sibling = sibling.previousElementSibling;
    }

    return index;
  }

  function looksSensitiveSelectorValue(value) {
    return SENSITIVE_TEXT_PATTERNS.some((pattern) => {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      return regex.test(value);
    });
  }

  function clampRatio(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(1, Number(value.toFixed(5))));
  }

  function escapeCssIdentifier(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(value);
    }

    return String(value).replace(/[^A-Za-z0-9_-]/g, "\\$&");
  }

  function escapeCssString(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function normalizeViewportRect(startX, startY, endX, endY) {
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    const right = Math.max(startX, endX);
    const bottom = Math.max(startY, endY);

    return {
      left,
      top,
      width: right - left,
      height: bottom - top
    };
  }

  function drawManualPickerBox(node, rect) {
    node.style.left = `${Math.round(rect.left)}px`;
    node.style.top = `${Math.round(rect.top)}px`;
    node.style.width = `${Math.round(rect.width)}px`;
    node.style.height = `${Math.round(rect.height)}px`;
  }

  function renderManualRedactionBoxes() {
    const picker = captureState.manualPicker;

    if (!picker) {
      return;
    }

    picker.surface.querySelectorAll(".lumen-redaction-box:not(.lumen-redaction-box-draft)").forEach((node) => node.remove());

    for (const region of picker.regions) {
      const rect = fromScrollCoordinates(region, detectScrollContext());

      if (!rect) {
        continue;
      }

      const box = document.createElement("div");
      box.className = "lumen-redaction-box";
      drawManualPickerBox(box, rect);
      picker.surface.appendChild(box);
    }

    picker.count.textContent = `${picker.regions.length} box${picker.regions.length === 1 ? "" : "es"}`;
  }

  function persistManualRedactions() {
    const picker = captureState.manualPicker;

    if (!picker) {
      return;
    }

    chrome.runtime.sendMessage({
      type: "LUMEN_MANUAL_REDACTIONS_UPDATED",
      payload: buildManualPickerPayload()
    }).catch(() => {});
  }

  function buildManualPickerPayload() {
    const picker = captureState.manualPicker;

    return {
      regions: picker ? picker.regions : [],
      context: getPageMetrics()
    };
  }

  function fromScrollCoordinates(region, context) {
    if (!region) {
      return null;
    }

    if (context.isDocument) {
      return {
        left: region.left - window.scrollX,
        top: region.top - window.scrollY,
        width: region.width,
        height: region.height
      };
    }

    if (!(context.node instanceof HTMLElement)) {
      return null;
    }

    const rootRect = context.node.getBoundingClientRect();

    return {
      left: rootRect.left + region.left - context.node.scrollLeft,
      top: rootRect.top + region.top - context.node.scrollTop,
      width: region.width,
      height: region.height
    };
  }

  function injectManualPickerStyles() {
    if (document.getElementById("lumen-redaction-picker-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "lumen-redaction-picker-style";
    style.textContent = `
      #lumen-redaction-picker {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483647 !important;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        color: #eef6ff !important;
        cursor: crosshair !important;
      }

      #lumen-redaction-picker .lumen-redaction-surface {
        position: absolute !important;
        inset: 0 !important;
        background: rgba(2, 8, 16, 0.22) !important;
      }

      #lumen-redaction-picker .lumen-redaction-toolbar {
        position: absolute !important;
        left: 18px !important;
        right: 18px !important;
        bottom: 18px !important;
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        padding: 12px !important;
        border: 1px solid rgba(134, 221, 255, 0.22) !important;
        border-radius: 14px !important;
        background: rgba(5, 11, 20, 0.92) !important;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.34) !important;
        cursor: default !important;
      }

      #lumen-redaction-picker strong {
        color: #86ddff !important;
        font-size: 13px !important;
        letter-spacing: 0.08em !important;
        text-transform: uppercase !important;
        white-space: nowrap !important;
      }

      #lumen-redaction-picker span {
        color: rgba(238, 246, 255, 0.72) !important;
        font-size: 13px !important;
      }

      #lumen-redaction-picker .lumen-redaction-count {
        margin-left: auto !important;
        white-space: nowrap !important;
      }

      #lumen-redaction-picker button {
        min-height: 34px !important;
        padding: 0 12px !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        border-radius: 10px !important;
        background: rgba(255, 255, 255, 0.06) !important;
        color: #eef6ff !important;
        font: inherit !important;
        cursor: pointer !important;
      }

      #lumen-redaction-picker button:last-child {
        color: rgba(238, 246, 255, 0.7) !important;
      }

      #lumen-redaction-picker .lumen-redaction-box {
        position: fixed !important;
        border: 2px solid #86ddff !important;
        border-radius: 10px !important;
        background: rgba(134, 221, 255, 0.18) !important;
        box-shadow: 0 0 0 9999px rgba(2, 8, 16, 0.02), inset 0 0 0 1px rgba(255, 255, 255, 0.2) !important;
        pointer-events: none !important;
      }

      #lumen-redaction-picker .lumen-redaction-box-draft {
        border-style: dashed !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function freezeAnimationsAndSmoothScroll() {
    removeFreezeStyle();

    const style = document.createElement("style");
    style.id = "lumen-capture-freeze";
    style.textContent = `
      *,
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }

      html {
        scroll-behavior: auto !important;
      }
    `;

    document.documentElement.appendChild(style);
    captureState.freezeStyleNode = style;
  }

  function removeFreezeStyle() {
    captureState.freezeStyleNode?.remove();
    captureState.freezeStyleNode = null;
  }

  function hideAggressiveLayers() {
    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_ELEMENT
    );
    let hiddenCount = 0;

    while (walker.nextNode()) {
      const node = walker.currentNode;

      if (!(node instanceof HTMLElement)) {
        continue;
      }

      if (node === document.documentElement || node === document.body) {
        continue;
      }

      const rect = node.getBoundingClientRect();

      if (!isRectVisible(rect)) {
        continue;
      }

      const style = window.getComputedStyle(node);
      const numericZIndex = Number.parseInt(style.zIndex, 10);
      const isFixedLike = style.position === "fixed" || style.position === "sticky";
      const isHighLayer = Number.isFinite(numericZIndex) && numericZIndex > 1000;

      if (!isFixedLike && !isHighLayer) {
        continue;
      }

      if (!shouldHideAggressiveLayer(node, rect, style)) {
        continue;
      }

      if (hideNode(node)) {
        hiddenCount += 1;
      }
    }

    return hiddenCount;
  }

  function restoreHiddenNodes() {
    for (const entry of captureState.hiddenNodes) {
      if (!entry.node.isConnected) {
        continue;
      }

      if (entry.originalStyle === null) {
        entry.node.removeAttribute("style");
      } else {
        entry.node.setAttribute("style", entry.originalStyle);
      }

      entry.node.removeAttribute("data-lumen-hidden");
    }

    captureState.hiddenNodes = [];
  }

  function hideNode(node) {
    if (captureState.hiddenNodes.some((entry) => entry.node === node)) {
      return false;
    }

    captureState.hiddenNodes.push({
      node,
      originalStyle: node.getAttribute("style")
    });

    node.style.setProperty("display", "none", "important");
    node.dataset.lumenHidden = "true";
    return true;
  }

  function shouldHideAggressiveLayer(node, rect, style) {
    if (node.dataset.lumenHidden === "true") {
      return false;
    }

    const numericZIndex = Number.parseInt(style.zIndex, 10);
    const isFixedLike = style.position === "fixed" || style.position === "sticky";
    const isHighLayer = Number.isFinite(numericZIndex) && numericZIndex > 1000;

    if (!isFixedLike && !isHighLayer) {
      return false;
    }

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const area = rect.width * rect.height;
    const viewportArea = Math.max(1, viewportWidth * viewportHeight);
    const coversEdge =
      rect.top <= 24 ||
      rect.bottom >= viewportHeight - 24 ||
      rect.left <= 24 ||
      rect.right >= viewportWidth - 24;
    const isOverlaySized =
      area >= viewportArea * 0.04 ||
      rect.height >= viewportHeight * 0.12 ||
      rect.width >= viewportWidth * 0.52;
    const looksLikeKnownChrome = /(cookie|consent|banner|notice|modal|drawer|toast|chat|intercom|launcher|support|help|feedback|subscribe|promo)/i
      .test(`${node.id} ${node.className} ${node.getAttribute("aria-label") || ""}`);
    const isTinyWidget = rect.width < 56 && rect.height < 56 && !looksLikeKnownChrome;

    if (isTinyWidget) {
      return false;
    }

    return looksLikeKnownChrome || (coversEdge && isOverlaySized) || (isHighLayer && isOverlaySized);
  }

  function startOverlayObserver() {
    stopOverlayObserver();

    const root = document.body || document.documentElement;
    if (!root) {
      return;
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const addedNode of mutation.addedNodes) {
          if (!(addedNode instanceof HTMLElement)) {
            continue;
          }

          scanNodeForAggressiveLayers(addedNode);
        }
      }
    });

    observer.observe(root, {
      childList: true,
      subtree: true
    });

    captureState.overlayObserver = observer;
  }

  function stopOverlayObserver() {
    captureState.overlayObserver?.disconnect();
    captureState.overlayObserver = null;
  }

  function scanNodeForAggressiveLayers(rootNode) {
    if (!(rootNode instanceof HTMLElement)) {
      return;
    }

    const queue = [rootNode];

    while (queue.length) {
      const node = queue.shift();
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      const rect = node.getBoundingClientRect();
      if (!isRectVisible(rect)) {
        for (const child of node.children) {
          queue.push(child);
        }
        continue;
      }

      const style = window.getComputedStyle(node);
      if (shouldHideAggressiveLayer(node, rect, style)) {
        hideNode(node);
      }

      for (const child of node.children) {
        queue.push(child);
      }
    }
  }

  async function runPreflightScroll() {
    const metrics = getPageMetrics();
    const maxScrollTop = Math.max(0, metrics.pageHeight - metrics.viewportHeight);
    const step = Math.max(240, Math.round(metrics.viewportHeight * 0.82));

    setScrollTop(0);
    await settleFrames(1);

    for (let top = 0; top < maxScrollTop; top += step) {
      setScrollTop(top);
      primeLazyMedia(getScrollContainerNode());
      await pause(36);
    }

    setScrollTop(maxScrollTop);
    primeLazyMedia(getScrollContainerNode());
    await pause(120);

    for (let top = maxScrollTop; top > 0; top -= step) {
      setScrollTop(top);
      primeLazyMedia(getScrollContainerNode());
      await pause(20);
    }

    setScrollTop(0);
    await settleFrames(2);
  }

  function buildPalette(elements) {
    const weights = new Map();
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);

    for (const element of elements) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const text = cleanText(element.innerText || element.textContent || "");
      const fontSize = Number.parseFloat(style.fontSize) || 16;
      const areaWeight = Math.min(14, Math.max(0.6, (rect.width * rect.height) / viewportArea * 8));
      const textWeight = Math.min(10, Math.max(1, text.length / 32 + fontSize / 14));

      registerColor(weights, style.backgroundColor, areaWeight);
      registerColor(weights, style.color, textWeight);

      if (style.borderStyle !== "none") {
        registerColor(weights, style.borderTopColor, 0.5);
      }
    }

    return [...weights.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_PALETTE_COLORS)
      .map(([hex, weight]) => ({
        hex,
        weight: Number(weight.toFixed(2))
      }));
  }

  function buildFontProfile(elements) {
    const weights = new Map();

    for (const element of elements) {
      const style = window.getComputedStyle(element);
      const family = normalizeFontFamily(style.fontFamily);
      const text = cleanText(element.innerText || element.textContent || "");

      if (!family || !text) {
        continue;
      }

      const fontSize = Number.parseFloat(style.fontSize) || 16;
      const semanticBoost = /^H[1-6]$/.test(element.tagName) ? 2 : element.matches("button, a") ? 1.2 : 1;
      const weight = Math.min(18, Math.max(1, text.length / 28 + fontSize / 12)) * semanticBoost;

      weights.set(family, (weights.get(family) || 0) + weight);
    }

    return [...weights.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_FONT_FAMILIES)
      .map(([family, weight]) => ({
        family,
        weight: Number(weight.toFixed(2))
      }));
  }

  function buildLayoutSnapshot() {
    const textSample = cleanText(document.body?.innerText || "");

    return {
      sections: document.querySelectorAll("main section, section").length || estimateVisualSections(),
      headings: document.querySelectorAll("h1, h2, h3").length,
      buttons: getVisibleInteractiveElements().length,
      forms: document.querySelectorAll("form").length,
      navs: document.querySelectorAll("nav, header nav").length,
      visuals: document.querySelectorAll("img, picture, video, canvas, svg").length,
      words: textSample ? textSample.split(/\s+/).length : 0
    };
  }

  function estimateVisualSections() {
    const landmarks = document.querySelectorAll("main > *, body > *");
    let count = 0;

    for (const node of landmarks) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      const rect = node.getBoundingClientRect();

      if (rect.height > 180 && rect.width > window.innerWidth * 0.45) {
        count += 1;
      }
    }

    return count;
  }

  function getVisibleInteractiveElements() {
    return [...document.querySelectorAll("a[href], button, input[type='submit'], input[type='button']")]
      .filter((element) => element instanceof HTMLElement && isElementVisible(element));
  }

  function getStructureHeadings() {
    return [...document.querySelectorAll("h1, h2, h3")]
      .filter((node) => node instanceof HTMLElement && isElementVisible(node))
      .map((node) => ({
        level: node.tagName.toLowerCase(),
        text: cleanText(node.innerText || node.textContent || "")
      }))
      .filter((entry) => entry.text)
      .slice(0, MAX_STRUCTURE_HEADINGS);
  }

  function findHeroHeadline(structureHeadings = []) {
    const pageHeading = structureHeadings.find((entry) => !isGenericHeadline(entry.text));

    return pageHeading?.text || normalizeDocumentTitle(document.title) || cleanText(document.title);
  }

  function isGenericHeadline(text = "") {
    return /^(navigation menu|global navigation|main navigation|site navigation|menu|skip to content)$/i.test(cleanText(text));
  }

  function normalizeDocumentTitle(title = "") {
    return cleanText(title)
      .replace(/^GitHub\s*-\s*/i, "")
      .replace(/\s*·\s*GitHub$/i, "")
      .replace(/\s*\|\s*GitHub$/i, "");
  }

  function getNavLabels() {
    const visibleLabels = collectNavLabels(false);

    if (visibleLabels.length) {
      return visibleLabels;
    }

    return collectNavLabels(true);
  }

  function collectNavLabels(includePreparedHidden) {
    const labels = [];

    for (const node of document.querySelectorAll("nav a, header a")) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      if (!includePreparedHidden && !isElementVisible(node)) {
        continue;
      }

      if (includePreparedHidden && !canExtractPreparedHiddenLabel(node)) {
        continue;
      }

      const label = cleanText(node.innerText || node.textContent || "");

      if (!label || labels.includes(label)) {
        continue;
      }

      labels.push(label);

      if (labels.length >= MAX_NAV_LABELS) {
        break;
      }
    }

    return labels;
  }

  function canExtractPreparedHiddenLabel(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    if (node.closest("[hidden], [aria-hidden='true'], dialog, details:not([open])")) {
      return false;
    }

    const preparedHiddenAncestor = node.closest("[data-lumen-hidden='true']");

    if (preparedHiddenAncestor) {
      return true;
    }

    const style = window.getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function findPrimaryCta() {
    const ctaPattern = /\b(get|start|try|book|request|sign up|join|download|install|launch|contact)\b/i;

    const candidates = getVisibleInteractiveElements()
      .map((node) => ({
        text: cleanText(node.innerText || node.textContent || node.getAttribute("value") || ""),
        top: node.getBoundingClientRect().top
      }))
      .filter((entry) => entry.text);

    const promoted = candidates.find((candidate) => ctaPattern.test(candidate.text));
    const fallback = candidates.sort((left, right) => left.top - right.top)[0];

    return promoted?.text || fallback?.text || "";
  }

  function getHeadingFont() {
    const heading = document.querySelector("h1, h2, h3");

    if (!(heading instanceof HTMLElement)) {
      return "";
    }

    return normalizeFontFamily(window.getComputedStyle(heading).fontFamily) || "";
  }

  function getBodyFont() {
    const bodyNode = document.querySelector("p, li, span");

    if (!(bodyNode instanceof HTMLElement)) {
      return "";
    }

    return normalizeFontFamily(window.getComputedStyle(bodyNode).fontFamily) || "";
  }

  function inferSiteType(layout) {
    if (layout.forms >= 1 && layout.buttons <= 6) {
      return "Lead capture";
    }

    if (layout.visuals >= 12 && layout.words >= 1000) {
      return "Editorial showcase";
    }

    if (layout.buttons >= 6 && layout.sections >= 4) {
      return "Product marketing";
    }

    if (layout.navs >= 1 && layout.words < 450) {
      return "Brochure site";
    }

    return "Hybrid landing page";
  }

  function getMetaDescription() {
    return (
      document.querySelector("meta[name='description']")?.getAttribute("content") ||
      document.querySelector("meta[property='og:description']")?.getAttribute("content") ||
      ""
    ).trim();
  }

  function getVisibleElements(limit) {
    const elements = [];

    for (const node of document.querySelectorAll("body *")) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      if (!isElementVisible(node)) {
        continue;
      }

      elements.push(node);

      if (elements.length >= limit) {
        break;
      }
    }

    return elements;
  }

  function collectSensitiveTextRegions(context) {
    const regions = [];
    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_TEXT
    );

    while (walker.nextNode() && regions.length < MAX_REDACTION_REGIONS) {
      const node = walker.currentNode;

      if (!(node instanceof Text)) {
        continue;
      }

      const parent = node.parentElement;
      const rawText = node.nodeValue || "";

      if (!parent || !rawText.trim() || shouldSkipSensitiveScan(parent) || !isElementScannable(parent)) {
        continue;
      }

      for (const pattern of SENSITIVE_TEXT_PATTERNS) {
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
        let match = regex.exec(rawText);

        while (match && regions.length < MAX_REDACTION_REGIONS) {
          if (!match[0]?.trim()) {
            match = regex.exec(rawText);
            continue;
          }

          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);

          const rects = [...range.getClientRects()]
            .map((rect) => buildRedactionRegion(rect, context, pattern.kind))
            .filter(Boolean);

          regions.push(...rects);
          match = regex.exec(rawText);
        }
      }
    }

    return regions.slice(0, MAX_REDACTION_REGIONS);
  }

  function collectSensitiveFieldRegions(context) {
    const regions = [];

    for (const node of document.querySelectorAll("input, textarea, [contenteditable='true'], a[href^='mailto:'], a[href^='tel:']")) {
      if (!(node instanceof HTMLElement) || !isElementScannable(node) || shouldSkipSensitiveScan(node)) {
        continue;
      }

      const kind = inferSensitiveElementKind(node);

      if (!kind) {
        continue;
      }

      const region = buildRedactionRegion(node.getBoundingClientRect(), context, kind);

      if (region) {
        regions.push(region);
      }

      if (regions.length >= MAX_REDACTION_REGIONS) {
        break;
      }
    }

    return regions;
  }

  function inferSensitiveElementKind(node) {
    if (!(node instanceof HTMLElement)) {
      return "";
    }

    if (node.matches("a[href^='mailto:']")) {
      return "email";
    }

    if (node.matches("a[href^='tel:']")) {
      return "phone";
    }

    if (node instanceof HTMLInputElement) {
      if (node.type === "password" && node.value) {
        return "secret";
      }

      if (["email", "tel"].includes(node.type) && node.value) {
        return node.type === "email" ? "email" : "phone";
      }

      return matchSensitiveKind(node.value || "");
    }

    if (node instanceof HTMLTextAreaElement) {
      return matchSensitiveKind(node.value || "");
    }

    return matchSensitiveKind(node.innerText || node.textContent || "");
  }

  function matchSensitiveKind(text) {
    if (!text || !text.trim()) {
      return "";
    }

    for (const pattern of SENSITIVE_TEXT_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);

      if (regex.test(text)) {
        return pattern.kind;
      }
    }

    return "";
  }

  function buildRedactionRegion(rect, context, kind) {
    if (!rect || rect.width < 2 || rect.height < 2) {
      return null;
    }

    const coordinates = toScrollCoordinates(rect, context);

    if (!coordinates) {
      return null;
    }

    return {
      kind,
      left: Math.round(coordinates.left),
      top: Math.round(coordinates.top),
      width: Math.round(coordinates.width),
      height: Math.round(coordinates.height)
    };
  }

  function toScrollCoordinates(rect, context) {
    if (context.isDocument) {
      return {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height
      };
    }

    if (!(context.node instanceof HTMLElement)) {
      return null;
    }

    const rootRect = context.node.getBoundingClientRect();

    return {
      left: rect.left - rootRect.left + context.node.scrollLeft,
      top: rect.top - rootRect.top + context.node.scrollTop,
      width: rect.width,
      height: rect.height
    };
  }

  function mergeSensitiveRegions(regions) {
    const merged = [];
    const ordered = regions
      .filter((region) => region && region.width > 0 && region.height > 0)
      .sort((left, right) => left.top - right.top || left.left - right.left);

    for (const region of ordered) {
      const last = merged[merged.length - 1];

      if (last && canMergeSensitiveRegion(last, region)) {
        const currentRight = last.left + last.width;
        const currentBottom = last.top + last.height;
        const nextRight = region.left + region.width;
        const nextBottom = region.top + region.height;

        last.left = Math.min(last.left, region.left);
        last.top = Math.min(last.top, region.top);
        last.width = Math.max(currentRight, nextRight) - last.left;
        last.height = Math.max(currentBottom, nextBottom) - last.top;
        continue;
      }

      merged.push({ ...region });
    }

    return merged;
  }

  function buildRedactionBreakdown(regions) {
    return regions.reduce((breakdown, region) => {
      const kind = region.kind || "sensitive";
      breakdown.total += 1;
      breakdown.byKind[kind] = (breakdown.byKind[kind] || 0) + 1;
      return breakdown;
    }, {
      total: 0,
      byKind: {}
    });
  }

  function canMergeSensitiveRegion(left, right) {
    const horizontalGap = right.left - (left.left + left.width);
    const verticalGap = right.top - (left.top + left.height);
    const overlapsHorizontally =
      right.left <= left.left + left.width + 12 && right.left + right.width >= left.left - 12;
    const overlapsVertically =
      right.top <= left.top + left.height + 10 && right.top + right.height >= left.top - 10;

    return left.kind === right.kind &&
      horizontalGap <= 12 &&
      verticalGap <= 10 &&
      overlapsHorizontally &&
      overlapsVertically;
  }

  function shouldSkipSensitiveScan(node) {
    return Boolean(
      node.closest("script, style, noscript, svg, canvas, [aria-hidden='true'], [hidden]")
    );
  }

  function isElementScannable(node) {
    const rect = node.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const style = window.getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function isElementVisible(node) {
    const rect = node.getBoundingClientRect();

    if (!isRectVisible(rect)) {
      return false;
    }

    const style = window.getComputedStyle(node);

    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function isRectVisible(rect) {
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > -window.innerHeight * 0.3 &&
      rect.right > 0 &&
      rect.top < window.innerHeight * 1.7 &&
      rect.left < window.innerWidth
    );
  }

  function registerColor(target, rawColor, weight) {
    const normalized = normalizeColor(rawColor);

    if (!normalized) {
      return;
    }

    target.set(normalized, (target.get(normalized) || 0) + weight);
  }

  function normalizeColor(rawColor) {
    if (!rawColor || rawColor === "transparent") {
      return null;
    }

    if (rawColor.startsWith("#")) {
      return quantizeHex(rawColor);
    }

    const matches = rawColor.match(/rgba?\(([^)]+)\)/i);

    if (!matches) {
      return null;
    }

    const channels = matches[1]
      .split(",")
      .map((value) => Number.parseFloat(value.trim()))
      .filter((value) => Number.isFinite(value));

    if (channels.length < 3) {
      return null;
    }

    const alpha = channels[3] ?? 1;

    if (alpha < 0.08) {
      return null;
    }

    return rgbToQuantizedHex(channels[0], channels[1], channels[2]);
  }

  function quantizeHex(rawHex) {
    const hex = rawHex.replace("#", "");

    if (hex.length === 3) {
      return rgbToQuantizedHex(
        Number.parseInt(`${hex[0]}${hex[0]}`, 16),
        Number.parseInt(`${hex[1]}${hex[1]}`, 16),
        Number.parseInt(`${hex[2]}${hex[2]}`, 16)
      );
    }

    if (hex.length !== 6) {
      return null;
    }

    return rgbToQuantizedHex(
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16)
    );
  }

  function rgbToQuantizedHex(red, green, blue) {
    const quantize = (value) => {
      const bounded = Math.max(0, Math.min(255, value));
      return Math.max(0, Math.min(255, Math.round(bounded / 17) * 17));
    };

    return `#${[red, green, blue]
      .map((value) => quantize(value).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  function normalizeFontFamily(rawFontFamily) {
    if (!rawFontFamily) {
      return "";
    }

    const candidates = rawFontFamily
      .split(",")
      .map((family) => family.replace(/["']/g, "").trim())
      .filter(Boolean);

    return candidates.find((family) => !GENERIC_FONT_FAMILIES.has(family.toLowerCase())) || candidates[0] || "";
  }

  function cleanText(rawText) {
    return rawText.replace(/\s+/g, " ").trim();
  }

  function createLocalId() {
    if (typeof crypto?.randomUUID === "function") {
      return crypto.randomUUID();
    }

    return `lumen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function getPageMetrics() {
    const context = captureState.scrollContext || detectScrollContext();
    const root = context.node;
    const doc = document.documentElement;
    const body = document.body;

    const pageHeight = context.isDocument
      ? Math.max(
          doc.scrollHeight,
          doc.offsetHeight,
          doc.clientHeight,
          body?.scrollHeight || 0,
          body?.offsetHeight || 0
        )
      : root.scrollHeight;

    return {
      title: document.title,
      url: window.location.href,
      viewportWidth: Math.round(context.isDocument ? doc.clientWidth : root.clientWidth),
      viewportHeight: Math.round(context.isDocument ? window.innerHeight : root.clientHeight),
      pageHeight: Math.round(pageHeight),
      devicePixelRatio: window.devicePixelRatio || 1,
      scrollMode: context.isDocument ? "document" : "container",
      scrollContainer: context.label
    };
  }

  function detectScrollContext() {
    const documentRoot = document.scrollingElement || document.documentElement;
    const candidates = [
      {
        node: documentRoot,
        isDocument: true,
        score: 1,
        label: "document"
      }
    ];

    for (const node of document.querySelectorAll("body *")) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      if (!isElementVisible(node)) {
        continue;
      }

      const style = window.getComputedStyle(node);
      const overflowY = style.overflowY;
      const canScroll =
        /(auto|scroll|overlay)/.test(overflowY) &&
        node.scrollHeight > node.clientHeight + 180 &&
        node.clientHeight > window.innerHeight * 0.34 &&
        node.clientWidth > window.innerWidth * 0.38;

      if (!canScroll) {
        continue;
      }

      const rect = node.getBoundingClientRect();
      const coverageScore =
        Math.min(1, rect.width / window.innerWidth) + Math.min(1, rect.height / window.innerHeight);
      const densityScore = Math.min(3, node.scrollHeight / Math.max(1, node.clientHeight));

      candidates.push({
        node,
        isDocument: false,
        score: coverageScore * 2 + densityScore,
        label: buildElementLabel(node)
      });
    }

    return candidates.sort((left, right) => right.score - left.score)[0];
  }

  function getScrollTop() {
    const context = captureState.scrollContext || detectScrollContext();

    return context.isDocument ? window.scrollY : context.node.scrollTop;
  }

  function getScrollLeft() {
    const context = captureState.scrollContext || detectScrollContext();

    return context.isDocument ? window.scrollX : context.node.scrollLeft;
  }

  function setScrollTop(top) {
    const context = captureState.scrollContext || detectScrollContext();
    const clampedTop = Math.max(0, Math.min(top, context.node.scrollHeight));

    if (context.isDocument) {
      window.scrollTo({
        top: clampedTop,
        left: captureState.originalScrollX,
        behavior: "auto"
      });
      return;
    }

    context.node.scrollTo({
      top: clampedTop,
      left: captureState.originalScrollX,
      behavior: "auto"
    });
  }

  function buildElementLabel(node) {
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${node.id}` : "";
    const classes = [...node.classList].slice(0, 2).join(".");
    const classSuffix = classes ? `.${classes}` : "";

    return `${tag}${id}${classSuffix}`;
  }

  function pause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForPageReady() {
    await Promise.allSettled([
      waitForFonts(),
      waitForMedia()
    ]);
    await settleFrames(2);
  }

  async function waitForFonts() {
    if (!("fonts" in document) || typeof document.fonts?.ready?.then !== "function") {
      return;
    }

    await Promise.race([
      document.fonts.ready,
      pause(PAGE_READY_TIMEOUT_MS)
    ]);
  }

  async function waitForMedia() {
    const container = getScrollContainerNode();
    const mediaNodes = [
      ...container.querySelectorAll("img, iframe, video")
    ]
      .filter((node) => node instanceof HTMLElement && isElementVisible(node))
      .slice(0, 28);

    if (!mediaNodes.length) {
      return;
    }

    await Promise.race([
      Promise.allSettled(mediaNodes.map((node) => waitForMediaNode(node))),
      pause(PAGE_READY_TIMEOUT_MS)
    ]);
  }

  function primeLazyMedia(root) {
    const scope = root instanceof HTMLElement ? root : document;
    const lazyCandidates = scope.querySelectorAll("img[loading='lazy'], iframe[loading='lazy'], video[preload='none'], [data-src], [data-srcset]");

    for (const node of lazyCandidates) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      if (node instanceof HTMLImageElement || node instanceof HTMLIFrameElement) {
        node.loading = "eager";
      }

      if (node instanceof HTMLVideoElement) {
        node.preload = "auto";
      }

      hydrateDeferredAttributes(node);
    }
  }

  function hydrateDeferredAttributes(node) {
    const attrMap = [
      ["data-src", "src"],
      ["data-srcset", "srcset"],
      ["data-lazy-src", "src"],
      ["data-original", "src"]
    ];

    for (const [from, to] of attrMap) {
      const value = node.getAttribute(from);
      if (value && !node.getAttribute(to)) {
        node.setAttribute(to, value);
      }
    }
  }

  function getScrollContainerNode() {
    const context = captureState.scrollContext || detectScrollContext();
    return context.isDocument ? document : context.node;
  }

  function waitForMediaNode(node) {
    if (node instanceof HTMLImageElement) {
      if (node.complete && node.naturalWidth > 0) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        const done = () => {
          node.removeEventListener("load", done);
          node.removeEventListener("error", done);
          resolve();
        };

        node.addEventListener("load", done, { once: true });
        node.addEventListener("error", done, { once: true });
      });
    }

    if (node instanceof HTMLIFrameElement) {
      return new Promise((resolve) => {
        const done = () => {
          node.removeEventListener("load", done);
          node.removeEventListener("error", done);
          resolve();
        };

        node.addEventListener("load", done, { once: true });
        node.addEventListener("error", done, { once: true });
      });
    }

    if (node instanceof HTMLVideoElement) {
      if (node.readyState >= 2) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        const done = () => {
          node.removeEventListener("loadeddata", done);
          node.removeEventListener("error", done);
          resolve();
        };

        node.addEventListener("loadeddata", done, { once: true });
        node.addEventListener("error", done, { once: true });
      });
    }

    return Promise.resolve();
  }

  async function settleFrames(frameCount) {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }
  }
})();
