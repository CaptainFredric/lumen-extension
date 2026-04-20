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
    prepared: false
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
  });

  async function handlePrepareCapture(options = {}) {
    await restorePageState();

    captureState.originalScrollX = window.scrollX;
    captureState.originalScrollY = window.scrollY;

    freezeAnimationsAndSmoothScroll();

    if (options.forceLazyLoad) {
      await runPreflightScroll();
    } else {
      window.scrollTo(0, 0);
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
    const maxScrollTop = Math.max(0, getPageMetrics().pageHeight - window.innerHeight);
    const clampedTop = Math.max(0, Math.min(top, maxScrollTop));

    window.scrollTo({
      top: clampedTop,
      left: 0,
      behavior: "auto"
    });

    await settleFrames(2);

    return {
      top: Math.round(window.scrollY)
    };
  }

  async function restorePageState() {
    restoreHiddenNodes();
    removeFreezeStyle();

    if (captureState.prepared) {
      window.scrollTo({
        top: captureState.originalScrollY,
        left: captureState.originalScrollX,
        behavior: "auto"
      });
      await settleFrames(1);
    }

    captureState.prepared = false;
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
        description: getMetaDescription()
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
    const maxScrollTop = Math.max(0, metrics.pageHeight - window.innerHeight);
    const step = Math.max(320, Math.round(window.innerHeight * 0.82));

    window.scrollTo(0, 0);
    await settleFrames(1);

    for (let top = 0; top < maxScrollTop; top += step) {
      window.scrollTo(0, top);
      await pause(36);
    }

    window.scrollTo(0, maxScrollTop);
    await pause(120);

    for (let top = maxScrollTop; top > 0; top -= step) {
      window.scrollTo(0, top);
      await pause(20);
    }

    window.scrollTo(0, 0);
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
    const doc = document.documentElement;
    const body = document.body;
    const pageHeight = Math.max(
      doc.scrollHeight,
      doc.offsetHeight,
      doc.clientHeight,
      body?.scrollHeight || 0,
      body?.offsetHeight || 0
    );

    return {
      title: document.title,
      url: window.location.href,
      viewportWidth: Math.round(doc.clientWidth),
      viewportHeight: Math.round(window.innerHeight),
      pageHeight: Math.round(pageHeight),
      devicePixelRatio: window.devicePixelRatio || 1
    };
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
