(function initLumenContentScript() {
  if (window.__LUMEN_CONTENT_SCRIPT__) {
    return;
  }

  window.__LUMEN_CONTENT_SCRIPT__ = true;

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
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);

    while (walker.nextNode()) {
      const node = walker.currentNode;

      if (!(node instanceof HTMLElement)) {
        continue;
      }

      if (node === document.documentElement || node === document.body) {
        continue;
      }

      const rect = node.getBoundingClientRect();

      if (!isVisibleInViewport(rect)) {
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

  function isVisibleInViewport(rect) {
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
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
