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
    prepared: false,
    scrollRoot: null,
    scrollContext: null
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
  });

  async function handlePrepareCapture(options = {}) {
    await restorePageState();

    captureState.scrollContext = detectScrollContext();
    captureState.scrollRoot = captureState.scrollContext.node;
    captureState.originalScrollX = getScrollLeft();
    captureState.originalScrollY = getScrollTop();

    freezeAnimationsAndSmoothScroll();

    if (options.forceLazyLoad) {
      await runPreflightScroll();
    } else {
      setScrollTop(0);
      await settleFrames(2);
    }

    let hiddenCount = 0;

    if (options.removeStickyHeaders) {
      hiddenCount = hideAggressiveLayers();
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

    return {
      top: Math.round(getScrollTop())
    };
  }

  async function restorePageState() {
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

  function extractBrandBlueprint() {
    const metrics = getPageMetrics();
    const sampledElements = getVisibleElements(MAX_BLUEPRINT_SAMPLE_ELEMENTS);
    const structureHeadings = getStructureHeadings();
    const heroHeadline = structureHeadings[0]?.text || cleanText(document.title);
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
      regions
    };
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
    restoreHiddenNodes();

    const hiddenNodes = [];
    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_ELEMENT
    );

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

      hiddenNodes.push({
        node,
        originalStyle: node.getAttribute("style")
      });

      node.style.setProperty("display", "none", "important");
      node.dataset.lumenHidden = "true";
    }

    captureState.hiddenNodes = hiddenNodes;
    return hiddenNodes.length;
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

  async function runPreflightScroll() {
    const metrics = getPageMetrics();
    const maxScrollTop = Math.max(0, metrics.pageHeight - metrics.viewportHeight);
    const step = Math.max(240, Math.round(metrics.viewportHeight * 0.82));

    setScrollTop(0);
    await settleFrames(1);

    for (let top = 0; top < maxScrollTop; top += step) {
      setScrollTop(top);
      await pause(36);
    }

    setScrollTop(maxScrollTop);
    await pause(120);

    for (let top = maxScrollTop; top > 0; top -= step) {
      setScrollTop(top);
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

  function getNavLabels() {
    const labels = [];

    for (const node of document.querySelectorAll("nav a, header a")) {
      if (!(node instanceof HTMLElement) || !isElementVisible(node)) {
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

      if (!parent || !rawText.trim() || shouldSkipSensitiveScan(parent) || !isElementVisible(parent)) {
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
      if (!(node instanceof HTMLElement) || !isElementVisible(node) || shouldSkipSensitiveScan(node)) {
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

  async function settleFrames(frameCount) {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }
  }
})();
