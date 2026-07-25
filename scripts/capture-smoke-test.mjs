import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const contentScriptPath = path.join(repoRoot, "content.js");
const offscreenScriptPath = path.join(repoRoot, "offscreen.js");

const svgPixel =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180'%3E%3Crect width='320' height='180' fill='%2364f2df'/%3E%3C/svg%3E";

const results = [];

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function record(name, details = {}) {
  results.push({
    name,
    ok: true,
    ...details
  });
}

async function buildPatchedContentScript() {
  const source = await fs.readFile(contentScriptPath, "utf8");

  return `
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime || {};
    window.chrome.runtime.onMessage = window.chrome.runtime.onMessage || { addListener() {} };
    window.chrome.runtime.sendMessage = async (message) => {
      window.__LUMEN_LAST_RUNTIME_MESSAGE__ = message;
      window.__LUMEN_RUNTIME_MESSAGES__ = [...(window.__LUMEN_RUNTIME_MESSAGES__ || []), message];

      if (message?.type === "LUMEN_CUTAWAY_REGION_UPDATED") {
        const delay = Math.max(0, Number(window.__LUMEN_CUTAWAY_SAVE_DELAY_MS__) || 0);

        if (delay) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        if (window.__LUMEN_FAIL_NEXT_CUTAWAY_SAVE__) {
          window.__LUMEN_FAIL_NEXT_CUTAWAY_SAVE__ = false;
          return {
            ok: false,
            error: { description: "Simulated area save failure." }
          };
        }
      }

      return message?.type === "LUMEN_CAPTURE_SELECTED_AREA"
        ? {
            ok: true,
            captureId: "instant-area-smoke",
            captureKind: "area",
            selectionMode: message.payload?.selectionMode || "rect",
            librarySaved: window.__LUMEN_AREA_LIBRARY_SAVED__ !== false
          }
        : { ok: true };
    };
    ${source.replace(
      /\}\)\(\);\s*$/,
      `
      window.__LUMEN_TEST_API__ = {
        handlePrepareCapture,
        scrollToPosition,
        restorePageState,
        measurePreparedPage,
        extractBrandBlueprint,
        scanSensitiveRegions,
        startManualRedactionPicker,
        resolveManualRedactions,
        clearManualRedactionPicker,
        startCutawayRegionPicker,
        resolveCutawayRegion,
        clearCutawayRegionPicker,
        simplifyRegionPoints,
        startAnnotationRegionPicker,
        resolveAnnotationRegion,
        clearAnnotationRegionPicker
      };
    })();
    `
    )}
  `;
}

async function buildPatchedOffscreenScript() {
  const source = await fs.readFile(offscreenScriptPath, "utf8");
  const withoutImport = source.replace(
    /^import \{ LUMEN_CONFIG, normalizeCaptureNoteOptions \} from "\.\/config\.js";\s*/,
    `
      const LUMEN_CONFIG = {
        capture: { tileMaxOutputHeight: 12000 },
        studio: { maxMockupSourceHeight: 4200, posterPadding: 88 }
      };
      const normalizeCaptureNoteOptions = () => ({ enabled: false, text: "", position: "top-right" });
    `
  ).replace(
    /import \{ createCanvasSequencePdfBlob \} from "\.\/export-utils\.js";\s*/,
    "const createCanvasSequencePdfBlob = async () => { throw new Error('PDF cache is outside this render smoke test.'); };\n"
  );

  return `
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime || {};
    window.chrome.runtime.onMessage = window.chrome.runtime.onMessage || { addListener() {} };
    ${withoutImport}
    window.__LUMEN_OFFSCREEN_TEST_API__ = {
      buildRenderModel,
      buildCaptureHealth,
      renderSession,
      renderSliceCanvas,
      scaleCutawayRegion,
      renderCutawayCanvas,
      renderPreviewDataUrl
    };
  `;
}

async function withPage(browser, html, contentScript, viewport, callback) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });

  try {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: contentScript });
    await callback(page);
  } finally {
    await page.close();
  }
}

async function runDocumentCaptureSmoke(browser, contentScript) {
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Smoke Capture Fixture</title>
        <meta name="description" content="A deterministic page for Lumen capture smoke tests." />
        <style>
          * { box-sizing: border-box; }
          html { overflow-y: hidden; }
          body { margin: 0; overflow-y: hidden; font-family: ui-sans-serif, system-ui, sans-serif; color: #102033; }
          #sticky-header {
            position: sticky;
            top: 0;
            z-index: 2400;
            display: flex;
            gap: 18px;
            align-items: center;
            padding: 18px 32px;
            background: rgba(255, 255, 255, 0.94);
            border-bottom: 1px solid rgba(16, 32, 51, 0.12);
          }
          #sticky-header a { color: inherit; text-decoration: none; }
          main { width: min(1060px, calc(100% - 48px)); margin: 0 auto; padding: 80px 0 1400px; }
          h1 { max-width: 9ch; margin: 0 0 18px; font-size: 76px; line-height: 0.9; }
          .hero { display: grid; gap: 24px; }
          .cta { display: inline-flex; width: max-content; padding: 14px 20px; border-radius: 999px; background: #2563eb; color: #fff; text-decoration: none; }
          .proof-card { margin-top: 48px; padding: 24px; border: 1px solid rgba(16, 32, 51, 0.14); border-radius: 24px; }
          .cookie-banner {
            position: fixed;
            left: 24px;
            right: 24px;
            bottom: 24px;
            z-index: 2800;
            padding: 24px;
            border-radius: 22px;
            background: #fff;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18);
          }
          .intercom-launcher {
            position: fixed;
            right: 22px;
            bottom: 130px;
            z-index: 2900;
            width: 74px;
            height: 74px;
            border-radius: 999px;
            background: #111827;
          }
          #hidden-proof { margin-top: 900px; }
        </style>
      </head>
      <body>
        <header id="sticky-header">
          <strong>Orbit</strong>
          <nav>
            <a href="#product">Product</a>
            <a href="#pricing">Pricing</a>
            <a href="#docs">Docs</a>
            <a href="#support">Support</a>
          </nav>
        </header>
        <main>
          <section class="hero">
            <p>Release reviews</p>
            <h1>Ship cleaner launch evidence.</h1>
            <a class="cta" href="#start">Start review</a>
            <img id="lazy-proof" width="320" height="180" alt="Lazy proof" data-src="${svgPixel}" />
          </section>
          <section class="proof-card">
            <h2>Review handoff details</h2>
            <p>Email qa.audit@example.com</p>
            <p>Phone +1 (312) 555-0199</p>
            <p>Token sk_test_51MxYp9X8cA12bnXqPL4v9dAs3rFgH6tZ</p>
          </section>
          <section id="hidden-proof">
            <p>Secondary contact product.ops@example.com</p>
          </section>
        </main>
        <aside class="cookie-banner">Cookie banner should be hidden before capture.</aside>
        <button class="intercom-launcher" aria-label="Intercom support"></button>
      </body>
    </html>`;

  await withPage(browser, html, contentScript, { width: 1280, height: 900 }, async (page) => {
    const prepare = await page.evaluate(() =>
      window.__LUMEN_TEST_API__.handlePrepareCapture({
        removeStickyHeaders: true,
        forceLazyLoad: true
      })
    );
    const state = await page.evaluate(() => ({
      stickyHidden: document.querySelector("#sticky-header")?.dataset.lumenHidden === "true",
      cookieHidden: document.querySelector(".cookie-banner")?.dataset.lumenHidden === "true",
      chatHidden: document.querySelector(".intercom-launcher")?.dataset.lumenHidden === "true",
      lazySrc: document.querySelector("#lazy-proof")?.getAttribute("src") || "",
      scrollY: window.scrollY,
      htmlOverflow: document.documentElement.style.overflowY,
      bodyOverflow: document.body.style.overflowY,
      hudStage: document.querySelector("#lumen-usage-hud")?.dataset.stage || "",
      hudVisible: document.querySelector("#lumen-usage-hud")?.classList.contains("is-visible") || false,
      hudHidden: document.querySelector("#lumen-usage-hud")?.dataset.lumenHidden === "true"
    }));
    const blueprint = await page.evaluate(() => window.__LUMEN_TEST_API__.extractBrandBlueprint());
    const redactions = await page.evaluate(() => window.__LUMEN_TEST_API__.scanSensitiveRegions());

    await page.evaluate(() => {
      const late = document.createElement("aside");
      late.className = "late-cookie-banner";
      late.textContent = "Late overlay";
      late.style.cssText = [
        "position:fixed",
        "left:18px",
        "right:18px",
        "bottom:18px",
        "z-index:3100",
        "min-height:90px",
        "background:white"
      ].join(";");
      document.body.appendChild(late);
    });
    await page.evaluate(() => window.__LUMEN_TEST_API__.scrollToPosition(620));
    const lateHidden = await page.evaluate(() =>
      document.querySelector(".late-cookie-banner")?.dataset.lumenHidden === "true"
    );
    await page.evaluate(() => window.__LUMEN_TEST_API__.restorePageState());
    const restored = await page.evaluate(() => ({
      stickyHidden: document.querySelector("#sticky-header")?.dataset.lumenHidden === "true",
      cookieHidden: document.querySelector(".cookie-banner")?.dataset.lumenHidden === "true",
      chatHidden: document.querySelector(".intercom-launcher")?.dataset.lumenHidden === "true",
      htmlInlineStyle: document.documentElement.getAttribute("style") || "",
      bodyInlineStyle: document.body.getAttribute("style") || "",
      hudExists: Boolean(document.querySelector("#lumen-usage-hud"))
    }));

    assert(prepare.page.scrollMode === "document", "Document fixture did not prepare as document", prepare);
    assert(prepare.page.hiddenCount >= 2, "Expected cleanup to hide multiple page chrome elements", prepare.page);
    assert(state.stickyHidden && state.cookieHidden && state.chatHidden, "Expected sticky and overlay elements to be hidden", state);
    assert(state.lazySrc === svgPixel, "Expected lazy image source to be hydrated", state);
    assert(state.scrollY === 0, "Expected preflight scroll to return to top", state);
    assert(state.htmlOverflow === "auto" && state.bodyOverflow === "auto", "Expected capture prep to release document scroll locks", state);
    assert(state.hudStage === "ready" && state.hudVisible && !state.hudHidden, "Expected usage HUD to remain visible during preparation without being cleaned as page chrome", state);
    assert(lateHidden, "Expected late overlay to be hidden after scroll");
    assert(!restored.stickyHidden && !restored.cookieHidden && !restored.chatHidden, "Expected hidden elements to restore", restored);
    assert(!restored.htmlInlineStyle && !restored.bodyInlineStyle, "Expected scroll lock inline overrides to restore", restored);
    assert(!restored.hudExists, "Expected usage HUD to be removed on restore", restored);
    assert(blueprint.identity.navLabels.length >= 3, "Expected navigation labels to survive cleanup extraction", blueprint.identity);
    assert(redactions.count >= 4, "Expected redaction scanner to find visible and lower-page sensitive text", redactions);
    assert(redactions.breakdown.byKind.email >= 2, "Expected email redactions in breakdown", redactions.breakdown);
    assert(redactions.breakdown.byKind.phone >= 1, "Expected phone redaction in breakdown", redactions.breakdown);
    assert(redactions.breakdown.byKind.secret >= 1, "Expected secret redaction in breakdown", redactions.breakdown);

    record("document cleanup, lazy load, signals, redaction", {
      hiddenCount: prepare.page.hiddenCount,
      navLabelCount: blueprint.identity.navLabels.length,
      redactionCount: redactions.count,
      breakdown: redactions.breakdown.byKind
    });
  });
}

async function runNestedScrollSmoke(browser, contentScript) {
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Nested Scroll Fixture</title>
        <style>
          html, body { height: 100%; margin: 0; overflow: hidden; font-family: ui-sans-serif, system-ui, sans-serif; }
          body { background: #172033; }
          .app-rail { position: fixed; inset: 0 auto 0 0; width: 180px; background: #0d1424; }
          .app-bar { position: fixed; inset: 0 0 auto 180px; height: 72px; background: #ffffff; }
          #app-shell {
            position: fixed;
            left: 200px;
            top: 80px;
            width: 980px;
            height: 740px;
            overflow-y: auto;
            background: #eef4fb;
          }
          .inner { min-height: 2400px; width: min(940px, calc(100% - 48px)); margin: 0 auto; padding: 64px 0; }
          .panel { margin-top: 900px; padding: 24px; border-radius: 20px; background: white; }
        </style>
      </head>
      <body>
        <aside class="app-rail"></aside>
        <header class="app-bar"></header>
        <div id="app-shell">
          <main class="inner">
            <h1>Application shell capture</h1>
            <p>Nested scrollers are common in dashboards and app shells.</p>
            <section class="panel">qa.shell@example.com</section>
          </main>
        </div>
      </body>
    </html>`;

  await withPage(browser, html, contentScript, { width: 1180, height: 820 }, async (page) => {
    const prepare = await page.evaluate(() =>
      window.__LUMEN_TEST_API__.handlePrepareCapture({
        removeStickyHeaders: false,
        forceLazyLoad: false
      })
    );
    const scroll = await page.evaluate(() => window.__LUMEN_TEST_API__.scrollToPosition(760));
    const state = await page.evaluate(() => ({
      windowScrollY: window.scrollY,
      appScrollTop: document.querySelector("#app-shell").scrollTop
    }));
    const redactions = await page.evaluate(() => window.__LUMEN_TEST_API__.scanSensitiveRegions());
    await page.evaluate(() => window.__LUMEN_TEST_API__.restorePageState());

    assert(prepare.page.scrollMode === "container", "Nested fixture did not detect container scroll", prepare);
    assert(/#app-shell/.test(prepare.page.scrollContainer), "Nested fixture selected the wrong scroll root", prepare.page);
    assert(prepare.page.browserViewportWidth === 1180 && prepare.page.browserViewportHeight === 820, "Nested fixture did not retain browser viewport metrics", prepare.page);
    assert(
      prepare.page.captureRect?.left === 200 &&
        prepare.page.captureRect?.top === 80 &&
        prepare.page.captureRect?.width === 980 &&
        prepare.page.captureRect?.height === 740,
      "Nested fixture did not report the visible scroll-root crop",
      prepare.page
    );
    assert(scroll.top >= 700 && state.appScrollTop >= 700, "Nested fixture did not scroll the container", { scroll, state });
    assert(state.windowScrollY === 0, "Nested fixture should not scroll the window", state);
    assert(redactions.breakdown.byKind.email >= 1, "Nested fixture redaction scan missed lower content", redactions);

    record("nested scroll capture context", {
      scrollContainer: prepare.page.scrollContainer,
      captureRect: prepare.page.captureRect,
      top: scroll.top,
      redactionCount: redactions.count
    });
  });
}

async function runOffsetStitchPixelSmoke(browser, offscreenScript) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });

  try {
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ content: offscreenScript });
    const result = await page.evaluate(async () => {
      const makeSlice = (rootColor) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1180;
        canvas.height = 820;
        const context = canvas.getContext("2d");
        context.fillStyle = "rgb(210, 32, 48)";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "rgb(40, 92, 214)";
        context.fillRect(200, 0, 980, 80);
        context.fillStyle = rootColor;
        context.fillRect(200, 80, 980, 740);
        return canvas.toDataURL("image/png");
      };
      const session = {
        page: {
          viewportWidth: 980,
          viewportHeight: 740,
          browserViewportWidth: 1180,
          browserViewportHeight: 820,
          pageHeight: 1480,
          devicePixelRatio: 1,
          scrollMode: "container",
          captureRect: { left: 200, top: 80, width: 980, height: 740 }
        },
        options: {},
        redactions: [],
        cutawayRegion: null,
        annotationRegion: null,
        segments: [
          {
            index: 0,
            topCss: 0,
            cropTopCss: 0,
            cropBottomCss: 0,
            captureRect: { left: 200, top: 80, width: 980, height: 740 },
            dataUrl: makeSlice("rgb(24, 190, 118)")
          },
          {
            index: 1,
            topCss: 740,
            cropTopCss: 0,
            cropBottomCss: 0,
            captureRect: { left: 200, top: 80, width: 980, height: 740 },
            dataUrl: makeSlice("rgb(242, 184, 46)")
          }
        ]
      };
      const model = await window.__LUMEN_OFFSCREEN_TEST_API__.buildRenderModel(session);
      const output = window.__LUMEN_OFFSCREEN_TEST_API__.renderSliceCanvas(model, 0, model.canvasHeight);
      const exactRender = await window.__LUMEN_OFFSCREEN_TEST_API__.renderSession(session);
      const tiledRender = await window.__LUMEN_OFFSCREEN_TEST_API__.renderSession({
        ...session,
        options: { longPageMode: "tiles" }
      });
      const context = output.getContext("2d");
      const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data];

      return {
        width: output.width,
        height: output.height,
        topPixel: pixel(20, 20),
        bottomPixel: pixel(20, 760),
        health: window.__LUMEN_OFFSCREEN_TEST_API__.buildCaptureHealth(model),
        exactEditorSource: {
          width: exactRender.editorSource?.width,
          height: exactRender.editorSource?.height,
          originalWidth: exactRender.editorSource?.originalWidth,
          originalHeight: exactRender.editorSource?.originalHeight,
          kind: exactRender.editorSource?.kind,
          scaled: exactRender.editorSource?.scaled,
          type: exactRender.editorSource?.dataUrl?.slice(0, 22)
        },
        tiledEditorSource: {
          width: tiledRender.editorSource?.width,
          height: tiledRender.editorSource?.height,
          originalWidth: tiledRender.editorSource?.originalWidth,
          originalHeight: tiledRender.editorSource?.originalHeight,
          kind: tiledRender.editorSource?.kind,
          scaled: tiledRender.editorSource?.scaled,
          type: tiledRender.editorSource?.dataUrl?.slice(0, 22)
        }
      };
    });

    assert(result.width === 980 && result.height === 1480, "Offset stitch used the browser viewport instead of the scroll root", result);
    assert(result.topPixel[0] === 24 && result.topPixel[1] === 190, "Offset stitch leaked fixed page chrome into the first slice", result);
    assert(result.bottomPixel[0] === 242 && result.bottomPixel[1] === 184, "Offset stitch did not crop the second root slice", result);
    assert(result.health.status === "complete" && result.health.coveragePercent === 100, "Offset stitch health did not verify full coverage", result.health);
    assert(
      result.exactEditorSource.kind === "lossless-full-output" &&
        result.exactEditorSource.width === 980 &&
        result.exactEditorSource.height === 1480 &&
        result.exactEditorSource.scaled === false &&
        result.exactEditorSource.type === "data:image/png;base64,",
      "Safe captures should retain a distinct lossless whole-image editor source",
      result.exactEditorSource
    );
    assert(
      result.tiledEditorSource.kind === "whole-page-proxy" &&
        result.tiledEditorSource.scaled === true &&
        result.tiledEditorSource.originalWidth === 980 &&
        result.tiledEditorSource.originalHeight === 1480 &&
        Math.abs(result.tiledEditorSource.width / result.tiledEditorSource.height - 980 / 1480) < 0.01,
      "Tiled captures should retain a downscaled proxy spanning the whole page",
      result.tiledEditorSource
    );

    record("offset scroll-root pixel stitch", {
      width: result.width,
      height: result.height,
      coveragePercent: result.health.coveragePercent,
      editorSource: result.exactEditorSource,
      tiledEditorSource: result.tiledEditorSource
    });
  } finally {
    await page.close();
  }
}

async function runRedactionLimitSmoke(browser, contentScript) {
  const sensitiveRows = Array.from({ length: 100 }, (_, index) =>
    `<p>Private contact ${index}: reviewer${index}@example.com</p>`
  ).join("");
  const html = `<!doctype html><html><head><title>Redaction Limit</title></head><body>${sensitiveRows}</body></html>`;

  await withPage(browser, html, contentScript, { width: 1000, height: 800 }, async (page) => {
    const scan = await page.evaluate(() => window.__LUMEN_TEST_API__.scanSensitiveRegions());

    assert(scan.count === 80, "Redaction limit fixture did not exercise the scanner cap", scan);
    assert(scan.truncated === true && scan.limit === 80, "Redaction scanner did not disclose truncation", scan);

    record("redaction scan fails closed at limit", {
      reported: scan.count,
      limit: scan.limit,
      truncated: scan.truncated
    });
  });
}

async function runManualProjectionSmoke(browser, contentScript) {
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Manual Projection Fixture</title>
        <style>
          body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; }
          main { width: min(1040px, calc(100% - 64px)); margin: 0 auto; padding: 96px 0 1000px; }
          .grid { display: grid; grid-template-columns: 1fr 360px; gap: 32px; align-items: start; }
          #secret-card { min-height: 190px; border-radius: 24px; background: #fff; border: 1px solid #ddd; padding: 28px; }
          @media (max-width: 600px) {
            main { width: calc(100% - 24px); padding-top: 44px; }
            .grid { grid-template-columns: 1fr; }
            #secret-card { min-height: 260px; padding: 18px; }
          }
        </style>
      </head>
      <body>
        <main>
          <section class="grid">
            <article><h1>Responsive test page</h1><p>Layout content.</p></article>
            <aside id="secret-card"><strong>QA handoff</strong><p>qa.audit@example.com</p><p>Token sk_test_1234567890abcdefghijkl</p></aside>
          </section>
        </main>
      </body>
    </html>`;

  await withPage(browser, html, contentScript, { width: 1280, height: 900 }, async (page) => {
    await page.evaluate(() =>
      window.__LUMEN_TEST_API__.handlePrepareCapture({
        removeStickyHeaders: false,
        forceLazyLoad: false
      })
    );
    const desktopBox = await page.locator("#secret-card").boundingBox();
    assert(desktopBox, "Manual projection fixture target is missing");

    await page.evaluate(() => window.__LUMEN_TEST_API__.startManualRedactionPicker());
    await page.mouse.move(desktopBox.x + 24, desktopBox.y + 26);
    await page.mouse.down();
    await page.mouse.move(desktopBox.x + desktopBox.width - 24, desktopBox.y + 98, { steps: 8 });
    await page.mouse.up();

    const stored = await page.evaluate(() => window.__LUMEN_LAST_RUNTIME_MESSAGE__?.payload?.regions?.[0]);
    const recordContext = await page.evaluate(() => window.__LUMEN_LAST_RUNTIME_MESSAGE__?.payload?.context);
    const manualPickerUi = await page.evaluate(() => ({
      title: document.querySelector("#lumen-redaction-picker .lumen-picker-title")?.textContent?.trim() || "",
      hint: document.querySelector("#lumen-redaction-picker .lumen-picker-hint")?.textContent?.trim() || "",
      count: document.querySelector("#lumen-redaction-picker .lumen-picker-count")?.textContent?.trim() || "",
      primary: document.querySelector("#lumen-redaction-picker .lumen-picker-primary")?.textContent?.trim() || "",
      label: document.querySelector("#lumen-redaction-picker .lumen-redaction-box")?.dataset.label || ""
    }));
    await page.keyboard.press("Enter");
    const manualPickerClosed = await page.evaluate(() => !document.querySelector("#lumen-redaction-picker"));
    assert(stored?.anchor?.selector === "#secret-card", "Manual box did not store a usable DOM anchor", stored);
    assert(
      manualPickerUi.title === "Manual redaction" &&
        manualPickerUi.hint === "Marked areas are hidden in saved captures." &&
        manualPickerUi.count === "1 area" &&
        manualPickerUi.primary === "Save" &&
        manualPickerUi.label === "Hidden",
      "Manual picker UI did not render the polished controls.",
      manualPickerUi
    );
    assert(manualPickerClosed, "Manual picker did not close on Enter.");

    await page.setViewportSize({ width: 390, height: 900 });
    await page.evaluate(() =>
      window.__LUMEN_TEST_API__.handlePrepareCapture({
        removeStickyHeaders: false,
        forceLazyLoad: false
      })
    );
    const resolved = await page.evaluate((payload) => window.__LUMEN_TEST_API__.resolveManualRedactions(payload), {
      regions: [stored],
      context: recordContext
    });
    const legacyWithoutAnchor = { ...stored };
    delete legacyWithoutAnchor.anchor;
    delete legacyWithoutAnchor.sourceViewport;
    const legacy = await page.evaluate((payload) => window.__LUMEN_TEST_API__.resolveManualRedactions(payload), {
      regions: [legacyWithoutAnchor],
      context: recordContext
    });

    assert(resolved.projectedCount === 1 && resolved.regions[0]?.projected, "Manual box did not project into mobile layout", resolved);
    assert(legacy.count === 0, "Legacy desktop coordinates should not apply directly to mobile layout", legacy);

    record("anchored manual redaction projection", {
      selector: stored.anchor.selector,
      projectedCount: resolved.projectedCount,
      legacySkippedCount: legacy.skippedCount
    });
  });
}

async function runCutawayRegionSmoke(browser, contentScript) {
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Cutaway Region Fixture</title>
        <style>
          body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; }
          main { width: min(960px, calc(100% - 48px)); margin: 0 auto; padding: 72px 0 760px; }
          #pricing-card { margin-top: 80px; min-height: 220px; padding: 28px; border: 1px solid #d7dee8; border-radius: 24px; background: #fff; }
        </style>
      </head>
      <body>
        <main>
          <button id="focus-return" type="button">Open area picker</button>
          <h1>Cutaway fixture</h1>
          <section id="pricing-card">
            <h2>Launch plan</h2>
            <p>$49 per seat</p>
          </section>
        </main>
      </body>
    </html>`;

  await withPage(browser, html, contentScript, { width: 1180, height: 820 }, async (page) => {
    await page.evaluate(() =>
      window.__LUMEN_TEST_API__.handlePrepareCapture({
        removeStickyHeaders: false,
        forceLazyLoad: false
      })
    );
    const targetBox = await page.locator("#pricing-card").boundingBox();
    assert(targetBox, "Cutaway fixture target is missing");

    const rectangleUpdatesBefore = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    await page.locator("#focus-return").focus();
    await page.evaluate(() => window.__LUMEN_TEST_API__.startCutawayRegionPicker());

    const dialogUi = await page.evaluate(() => {
      const overlay = document.querySelector("#lumen-cutaway-picker");
      const surface = overlay?.querySelector(".lumen-cutaway-surface");
      const labelledBy = overlay?.getAttribute("aria-labelledby") || "";
      const describedBy = overlay?.getAttribute("aria-describedby") || "";

      return {
        role: overlay?.getAttribute("role") || "",
        modal: overlay?.getAttribute("aria-modal") || "",
        surfaceFocused: document.activeElement === surface,
        surfaceTabIndex: surface?.getAttribute("tabindex") || "",
        labelled: Boolean(labelledBy && document.getElementById(labelledBy)),
        described: Boolean(describedBy && document.getElementById(describedBy))
      };
    });
    await page.keyboard.press("Enter");
    const keyboardRegionBefore = await page.locator("#lumen-cutaway-picker .lumen-cutaway-box").boundingBox();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    const keyboardRegionAfter = await page.locator("#lumen-cutaway-picker .lumen-cutaway-box").boundingBox();
    const keyboardPickerUi = await page.evaluate(() => ({
      count: document.querySelector("#lumen-cutaway-picker .lumen-picker-count")?.textContent?.trim() || "",
      captureDisabled: document.querySelector("#lumen-cutaway-picker .lumen-picker-capture-now")?.disabled ?? true
    }));
    await page.getByRole("button", { name: "Close" }).click();
    const keyboardUpdatesAfterClose = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    const focusRestored = await page.evaluate(() => document.activeElement?.id === "focus-return");

    assert(
      dialogUi.role === "dialog" &&
        dialogUi.modal === "true" &&
        dialogUi.surfaceFocused &&
        dialogUi.surfaceTabIndex === "0" &&
        dialogUi.labelled &&
        dialogUi.described,
      "Cutaway picker did not expose dialog semantics and transfer focus to its drawing surface.",
      dialogUi
    );
    assert(keyboardRegionBefore && keyboardRegionAfter, "Keyboard rectangle creation did not render a region.");
    assert(
      Math.abs(keyboardRegionAfter.x - keyboardRegionBefore.x - 10) <= 1 &&
        Math.abs(keyboardRegionAfter.height - keyboardRegionBefore.height - 10) <= 1 &&
        keyboardPickerUi.count === "Region selected" &&
        !keyboardPickerUi.captureDisabled,
      "Keyboard rectangle movement or resizing did not update the selection.",
      { keyboardRegionBefore, keyboardRegionAfter, keyboardPickerUi }
    );
    assert(
      keyboardUpdatesAfterClose === rectangleUpdatesBefore && focusRestored,
      "Closing a keyboard-created draft should not persist it and should restore prior focus.",
      { rectangleUpdatesBefore, keyboardUpdatesAfterClose, focusRestored }
    );

    await page.evaluate(() => window.__LUMEN_TEST_API__.startCutawayRegionPicker());
    await page.mouse.move(targetBox.x + 20, targetBox.y + 22);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width - 28, targetBox.y + 156, { steps: 8 });
    await page.mouse.up();

    const rectangleUpdatesAfterDraw = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    const cutawayPickerUi = await page.evaluate(() => ({
      title: document.querySelector("#lumen-cutaway-picker .lumen-picker-title")?.textContent?.trim() || "",
      count: document.querySelector("#lumen-cutaway-picker .lumen-picker-count")?.textContent?.trim() || "",
      primary: document.querySelector("#lumen-cutaway-picker .lumen-picker-primary")?.textContent?.trim() || "",
      captureNow: document.querySelector("#lumen-cutaway-picker .lumen-picker-capture-now")?.textContent?.trim() || "",
      captureNowDisabled: document.querySelector("#lumen-cutaway-picker .lumen-picker-capture-now")?.disabled ?? true,
      label: document.querySelector("#lumen-cutaway-picker .lumen-cutaway-box")?.dataset.label || ""
    }));
    await page.evaluate(() => {
      window.__LUMEN_CUTAWAY_SAVE_DELAY_MS__ = 240;
    });
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForFunction(() =>
      document.querySelector("#lumen-cutaway-picker .lumen-picker-primary")?.textContent?.trim() === "Saving…"
    );
    const pendingSaveUi = await page.evaluate(() => ({
      busy: document.querySelector("#lumen-cutaway-picker")?.getAttribute("aria-busy") || "",
      saveDisabled: document.querySelector("#lumen-cutaway-picker .lumen-picker-primary")?.disabled ?? false,
      closeDisabled: [...document.querySelectorAll("#lumen-cutaway-picker button")]
        .find((button) => button.textContent?.trim() === "Close")?.disabled ?? false
    }));
    await page.waitForSelector("#lumen-cutaway-picker", { state: "detached" });
    await page.evaluate(() => {
      window.__LUMEN_CUTAWAY_SAVE_DELAY_MS__ = 0;
    });
    const completedSaveUi = await page.evaluate(() => ({
      hudTitle: document.querySelector("#lumen-usage-hud [data-lumen-hud-title]")?.textContent?.trim() || ""
    }));
    const message = await readLastRuntimeMessage(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    const region = message?.payload?.region;

    assert(rectangleUpdatesAfterDraw === rectangleUpdatesBefore, "Drawing a rectangle should not remember it until Save is chosen.");
    assert(message?.type === "LUMEN_CUTAWAY_REGION_UPDATED", "Cutaway picker did not publish its region.", message);
    assert(region?.kind === "cutaway", "Cutaway picker did not store a cutaway region kind.", region);
    assert(region.width > 240 && region.height > 120, "Cutaway region geometry is too small.", region);
    assert(region.anchor?.selector === "#pricing-card", "Cutaway region did not store a stable DOM anchor.", region);
    assert(
      pendingSaveUi.busy === "true" && pendingSaveUi.saveDisabled && pendingSaveUi.closeDisabled,
      "Saving a remembered area did not expose a locked, accessible pending state.",
      pendingSaveUi
    );
    assert(completedSaveUi.hudTitle === "Area saved", "Successful persistence was not surfaced to the user.", completedSaveUi);
    assert(
      cutawayPickerUi.title === "Focused crop" &&
        cutawayPickerUi.count === "Region selected" &&
        cutawayPickerUi.primary === "Save" &&
        cutawayPickerUi.captureNow === "Capture now" &&
        !cutawayPickerUi.captureNowDisabled &&
        cutawayPickerUi.label === "Capture area",
      "Cutaway picker UI did not render the polished controls.",
      cutawayPickerUi
    );

    record("cutaway region picker", {
      selector: region.anchor.selector,
      width: region.width,
      height: region.height
    });

    const clearUpdatesBefore = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    await page.evaluate((selectedRegion) =>
      window.__LUMEN_TEST_API__.startCutawayRegionPicker({ region: selectedRegion }), region);
    await page.getByRole("button", { name: "Clear" }).click();
    const clearedDraftUi = await page.evaluate(() => ({
      hint: document.querySelector("#lumen-cutaway-picker .lumen-picker-hint")?.textContent?.trim() || "",
      hasRegion: Boolean(document.querySelector("#lumen-cutaway-picker .lumen-cutaway-box")),
      saveDisabled: document.querySelector("#lumen-cutaway-picker .lumen-picker-primary")?.disabled ?? true
    }));
    await page.getByRole("button", { name: "Close" }).click();
    const clearUpdatesAfterClose = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    assert(
      clearUpdatesAfterClose === clearUpdatesBefore &&
        !clearedDraftUi.hasRegion &&
        !clearedDraftUi.saveDisabled &&
        clearedDraftUi.hint.includes("Choose Save to remove"),
      "Clear should remain a reversible draft until Save is chosen.",
      { clearUpdatesBefore, clearUpdatesAfterClose, clearedDraftUi }
    );

    const deleteUpdatesBefore = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    await page.evaluate((selectedRegion) =>
      window.__LUMEN_TEST_API__.startCutawayRegionPicker({ region: selectedRegion }), region);
    await page.locator("#lumen-cutaway-picker .lumen-cutaway-surface").focus();
    await page.keyboard.press("Delete");
    const deletedDraftUi = await page.evaluate(() => ({
      hint: document.querySelector("#lumen-cutaway-picker .lumen-picker-hint")?.textContent?.trim() || "",
      hasRegion: Boolean(document.querySelector("#lumen-cutaway-picker .lumen-cutaway-box"))
    }));
    await page.getByRole("button", { name: "Close" }).click();
    const deleteUpdatesAfterClose = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    assert(
      deleteUpdatesAfterClose === deleteUpdatesBefore &&
        !deletedDraftUi.hasRegion &&
        deletedDraftUi.hint.includes("Choose Save to remove"),
      "Delete should remain a reversible draft until Save is chosen.",
      { deleteUpdatesBefore, deleteUpdatesAfterClose, deletedDraftUi }
    );

    const failedSaveUpdatesBefore = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    await page.evaluate((selectedRegion) => {
      window.__LUMEN_FAIL_NEXT_CUTAWAY_SAVE__ = true;
      window.__LUMEN_TEST_API__.startCutawayRegionPicker({ region: selectedRegion });
    }, region);
    await page.locator("#lumen-cutaway-picker .lumen-cutaway-surface").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() =>
      document.querySelector("#lumen-cutaway-picker .lumen-picker-hint")?.textContent?.includes("Simulated area save failure")
    );
    const failedSaveUi = await page.evaluate(() => ({
      pickerOpen: Boolean(document.querySelector("#lumen-cutaway-picker")),
      busy: document.querySelector("#lumen-cutaway-picker")?.getAttribute("aria-busy") || "",
      saveLabel: document.querySelector("#lumen-cutaway-picker .lumen-picker-primary")?.textContent?.trim() || "",
      saveDisabled: document.querySelector("#lumen-cutaway-picker .lumen-picker-primary")?.disabled ?? true,
      saveFocused: document.activeElement === document.querySelector("#lumen-cutaway-picker .lumen-picker-primary")
    }));
    const failedSaveUpdatesAfterAttempt = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    await page.getByRole("button", { name: "Close" }).click();
    const failedSaveUpdatesAfterClose = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    assert(
      failedSaveUi.pickerOpen &&
        failedSaveUi.busy === "false" &&
        failedSaveUi.saveLabel === "Save" &&
        !failedSaveUi.saveDisabled &&
        failedSaveUi.saveFocused &&
        failedSaveUpdatesAfterAttempt === failedSaveUpdatesBefore + 1 &&
        failedSaveUpdatesAfterClose === failedSaveUpdatesAfterAttempt,
      "A failed save should stay open, explain the error, and remain retryable without persisting on Close.",
      { failedSaveUi, failedSaveUpdatesBefore, failedSaveUpdatesAfterAttempt, failedSaveUpdatesAfterClose }
    );

    const instantRectUpdatesBefore = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    await page.evaluate((selectedRegion) =>
      window.__LUMEN_TEST_API__.startCutawayRegionPicker({
        region: selectedRegion,
        selectionMode: "rect"
      }), region);
    const scrollGeometryBefore = await page.locator("#lumen-cutaway-picker .lumen-cutaway-box").boundingBox();
    const scrollDelta = await page.evaluate(() => {
      const previous = window.scrollY;
      window.scrollBy(0, 40);
      return window.scrollY - previous;
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const scrollGeometryAfter = await page.locator("#lumen-cutaway-picker .lumen-cutaway-box").boundingBox();
    assert(scrollGeometryBefore && scrollGeometryAfter && scrollDelta > 0, "Scroll geometry fixture did not move.");
    assert(
      Math.abs(scrollGeometryAfter.y - (scrollGeometryBefore.y - scrollDelta)) <= 2,
      "Saved selection geometry drifted after the page scrolled.",
      { scrollGeometryBefore, scrollGeometryAfter, scrollDelta }
    );
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.locator("#lumen-cutaway-picker .lumen-picker-capture-now").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__LUMEN_LAST_RUNTIME_MESSAGE__?.type === "LUMEN_CAPTURE_SELECTED_AREA");
    const instantRectCapture = await page.evaluate(() => ({
      message: window.__LUMEN_LAST_RUNTIME_MESSAGE__,
      buttonLabel: document.querySelector("#lumen-cutaway-picker .lumen-picker-capture-now")?.textContent?.trim() || "",
      buttonDisabled: document.querySelector("#lumen-cutaway-picker .lumen-picker-capture-now")?.disabled ?? false,
      hudTitle: document.querySelector("#lumen-usage-hud [data-lumen-hud-title]")?.textContent?.trim() || ""
    }));
    const instantRectUpdatesAfter = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    assert(
      instantRectCapture.message?.payload?.selectionMode === "rect" &&
        instantRectCapture.message?.payload?.region?.kind === "cutaway" &&
        instantRectCapture.message?.payload?.region?.anchor?.selector === "#pricing-card" &&
        Boolean(instantRectCapture.message?.payload?.context),
      "Capture now did not dispatch the selected rectangle and page context.",
      instantRectCapture
    );
    assert(
      instantRectCapture.buttonLabel === "Starting…" &&
        instantRectCapture.buttonDisabled &&
        instantRectCapture.hudTitle === "Selected area ready",
      "Capture now did not expose an accessible in-flight and completion state.",
      instantRectCapture
    );
    assert(
      instantRectUpdatesAfter === instantRectUpdatesBefore,
      "Capture now should not remember a one-off rectangle.",
      { instantRectUpdatesBefore, instantRectUpdatesAfter }
    );

    record("instant rectangle Capture now dispatch", {
      captureId: "instant-area-smoke",
      selectionMode: instantRectCapture.message.payload.selectionMode,
      selector: instantRectCapture.message.payload.region.anchor.selector
    });

    await page.evaluate((selectedRegion) => {
      window.__LUMEN_AREA_LIBRARY_SAVED__ = false;
      window.__LUMEN_TEST_API__.startCutawayRegionPicker({
        region: selectedRegion,
        selectionMode: "rect"
      });
    }, region);
    await page.locator("#lumen-cutaway-picker .lumen-picker-capture-now").click();
    await page.waitForFunction(() =>
      document.querySelector("#lumen-usage-hud [data-lumen-hud-title]")?.textContent?.trim() === "Selected area downloaded"
    );
    const downloadsOnlyFallback = await page.evaluate(() => ({
      title: document.querySelector("#lumen-usage-hud [data-lumen-hud-title]")?.textContent?.trim() || "",
      detail: document.querySelector("#lumen-usage-hud [data-lumen-hud-detail]")?.textContent?.trim() || ""
    }));
    await page.evaluate(() => {
      window.__LUMEN_AREA_LIBRARY_SAVED__ = true;
    });
    assert(
      downloadsOnlyFallback.title === "Selected area downloaded" &&
        /Chrome Downloads/i.test(downloadsOnlyFallback.detail) &&
        /could not add it to the local library/i.test(downloadsOnlyFallback.detail) &&
        !/copy, edit, or export/i.test(downloadsOnlyFallback.detail),
      "A Downloads-only area capture overstated local workspace availability.",
      downloadsOnlyFallback
    );
    record("Downloads-only area capture fallback", downloadsOnlyFallback);

    const lassoSimplification = await page.evaluate(() => {
      const source = Array.from({ length: 320 }, (_, index) => ({
        x: index,
        y: Math.round(80 + Math.sin(index / 12) * 36)
      }));
      const points = window.__LUMEN_TEST_API__.simplifyRegionPoints(source, 120);

      return {
        length: points.length,
        first: points[0],
        last: points.at(-1),
        sourceLast: source.at(-1)
      };
    });
    assert(
      lassoSimplification.length === 120 &&
        lassoSimplification.first?.x === 0 &&
        lassoSimplification.last?.x === lassoSimplification.sourceLast?.x &&
        lassoSimplification.last?.y === lassoSimplification.sourceLast?.y,
      "Lasso simplification did not sample the complete path or preserve both endpoints.",
      lassoSimplification
    );

    const lassoUpdatesBefore = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    await page.evaluate(() => window.__LUMEN_TEST_API__.startCutawayRegionPicker({ selectionMode: "lasso" }));
    await page.mouse.move(targetBox.x + 34, targetBox.y + 34);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width - 42, targetBox.y + 40, { steps: 6 });
    await page.mouse.move(targetBox.x + targetBox.width - 34, targetBox.y + 150, { steps: 6 });
    await page.mouse.move(targetBox.x + 48, targetBox.y + 156, { steps: 6 });
    await page.mouse.move(targetBox.x + 34, targetBox.y + 34, { steps: 6 });
    await page.mouse.up();

    const lassoUpdatesAfterDraw = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    const lassoPickerUi = await page.evaluate(() => ({
      title: document.querySelector("#lumen-cutaway-picker .lumen-picker-title")?.textContent?.trim() || "",
      count: document.querySelector("#lumen-cutaway-picker .lumen-picker-count")?.textContent?.trim() || "",
      primary: document.querySelector("#lumen-cutaway-picker .lumen-picker-primary")?.textContent?.trim() || "",
      captureNow: document.querySelector("#lumen-cutaway-picker .lumen-picker-capture-now")?.textContent?.trim() || "",
      captureNowDisabled: document.querySelector("#lumen-cutaway-picker .lumen-picker-capture-now")?.disabled ?? true,
      label: document.querySelector("#lumen-cutaway-picker .lumen-cutaway-box")?.dataset.label || ""
    }));
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForFunction((previousCount) =>
      (window.__LUMEN_RUNTIME_MESSAGES__ || []).filter((message) => message?.type === "LUMEN_CUTAWAY_REGION_UPDATED").length > previousCount,
    lassoUpdatesAfterDraw);
    const lassoMessage = await readLastRuntimeMessage(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    const lassoRegion = lassoMessage?.payload?.region;
    const resolvedLasso = await page.evaluate((payload) => window.__LUMEN_TEST_API__.resolveCutawayRegion(payload), {
      region: lassoRegion,
      context: lassoMessage?.payload?.context
    });

    assert(lassoUpdatesAfterDraw === lassoUpdatesBefore, "Drawing a lasso should not remember it until Save is chosen.");
    assert(lassoRegion?.shape === "lasso", "Lasso picker did not store lasso geometry.", lassoRegion);
    assert(lassoRegion.points?.length >= 4, "Lasso picker did not retain the drawn points.", lassoRegion);
    assert(resolvedLasso.region?.shape === "lasso", "Resolved lasso lost its shape metadata.", resolvedLasso);
    assert(resolvedLasso.region?.points?.length >= 4, "Resolved lasso lost its projected polygon points.", resolvedLasso);
    assert(
      lassoPickerUi.title === "Lasso capture" &&
        lassoPickerUi.count === "Lasso selected" &&
        lassoPickerUi.primary === "Save" &&
        lassoPickerUi.captureNow === "Capture now" &&
        !lassoPickerUi.captureNowDisabled &&
        lassoPickerUi.label === "Lasso area",
      "Lasso picker UI did not render the polished controls.",
      lassoPickerUi
    );

    record("lasso region picker", {
      selector: lassoRegion.anchor.selector,
      pointCount: lassoRegion.points.length
    });

    const instantLassoUpdatesBefore = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    await page.evaluate((selectedRegion) =>
      window.__LUMEN_TEST_API__.startCutawayRegionPicker({
        region: selectedRegion,
        selectionMode: "lasso"
      }), lassoRegion);
    await page.locator("#lumen-cutaway-picker .lumen-picker-capture-now").click();
    await page.waitForFunction(() =>
      window.__LUMEN_LAST_RUNTIME_MESSAGE__?.type === "LUMEN_CAPTURE_SELECTED_AREA" &&
      window.__LUMEN_LAST_RUNTIME_MESSAGE__?.payload?.selectionMode === "lasso"
    );
    const instantLassoCapture = await page.evaluate(() => window.__LUMEN_LAST_RUNTIME_MESSAGE__);
    const instantLassoUpdatesAfter = await countRuntimeMessages(page, "LUMEN_CUTAWAY_REGION_UPDATED");
    assert(
      instantLassoCapture?.payload?.selectionMode === "lasso" &&
        instantLassoCapture?.payload?.region?.shape === "lasso" &&
        instantLassoCapture?.payload?.region?.points?.length >= 4,
      "Capture now did not preserve lasso geometry in its capture dispatch.",
      instantLassoCapture
    );
    assert(
      instantLassoUpdatesAfter === instantLassoUpdatesBefore,
      "Capture now should not remember a one-off lasso.",
      { instantLassoUpdatesBefore, instantLassoUpdatesAfter }
    );

    record("instant lasso Capture now dispatch", {
      captureId: "instant-area-smoke",
      selectionMode: instantLassoCapture.payload.selectionMode,
      pointCount: instantLassoCapture.payload.region.points.length
    });

    await page.evaluate(() => window.__LUMEN_TEST_API__.startAnnotationRegionPicker());
    await page.mouse.move(targetBox.x + 32, targetBox.y + 36);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width - 42, targetBox.y + 126, { steps: 8 });
    await page.mouse.up();

    const annotationMessage = await page.evaluate(() => window.__LUMEN_LAST_RUNTIME_MESSAGE__);
    const annotationRegion = annotationMessage?.payload?.region;
    const annotationPickerUi = await page.evaluate(() => ({
      title: document.querySelector("#lumen-annotation-picker .lumen-picker-title")?.textContent?.trim() || "",
      count: document.querySelector("#lumen-annotation-picker .lumen-picker-count")?.textContent?.trim() || "",
      primary: document.querySelector("#lumen-annotation-picker .lumen-picker-primary")?.textContent?.trim() || "",
      label: document.querySelector("#lumen-annotation-picker .lumen-annotation-box")?.dataset.label || ""
    }));
    await page.getByRole("button", { name: "Save" }).click();
    const resolvedAnnotation = await page.evaluate((payload) => window.__LUMEN_TEST_API__.resolveAnnotationRegion(payload), {
      region: annotationRegion,
      context: annotationMessage?.payload?.context
    });

    assert(annotationMessage?.type === "LUMEN_ANNOTATION_REGION_UPDATED", "Annotation picker did not publish its region.", annotationMessage);
    assert(annotationRegion?.kind === "annotation", "Annotation picker did not store an annotation region kind.", annotationRegion);
    assert(annotationRegion.anchor?.selector === "#pricing-card", "Annotation region did not store a stable DOM anchor.", annotationRegion);
    assert(resolvedAnnotation.region?.kind === "annotation", "Annotation region did not resolve as an annotation.", resolvedAnnotation);
    assert(
      annotationPickerUi.title === "Capture note" &&
        annotationPickerUi.count === "Callout selected" &&
        annotationPickerUi.primary === "Save" &&
        annotationPickerUi.label === "Note target",
      "Annotation picker UI did not render the polished controls.",
      annotationPickerUi
    );

    record("annotation callout picker", {
      selector: annotationRegion.anchor.selector,
      width: annotationRegion.width,
      height: annotationRegion.height
    });
  });
}

async function runLassoMaskPixelSmoke(browser, offscreenScript) {
  await withPage(browser, "<!doctype html><html><body></body></html>", offscreenScript, { width: 640, height: 480 }, async (page) => {
    const pixels = await page.evaluate(() => {
      const source = document.createElement("canvas");
      source.width = 160;
      source.height = 160;
      const sourceContext = source.getContext("2d");
      sourceContext.fillStyle = "#f43f5e";
      sourceContext.fillRect(0, 0, source.width, source.height);

      const region = window.__LUMEN_OFFSCREEN_TEST_API__.scaleCutawayRegion({
        id: "lasso-pixel-test",
        shape: "lasso",
        left: 20,
        top: 20,
        width: 100,
        height: 100,
        points: [
          { x: 70, y: 20 },
          { x: 120, y: 70 },
          { x: 70, y: 120 },
          { x: 20, y: 70 }
        ]
      }, 1, source.width, source.height);
      const output = window.__LUMEN_OFFSCREEN_TEST_API__.renderCutawayCanvas(source, region);
      const context = output.getContext("2d");

      return {
        shape: region.shape,
        pointCount: region.points.length,
        outsideAlpha: context.getImageData(0, 0, 1, 1).data[3],
        insideAlpha: context.getImageData(50, 50, 1, 1).data[3],
        previewType: window.__LUMEN_OFFSCREEN_TEST_API__.renderPreviewDataUrl(output).slice(0, 23)
      };
    });

    assert(pixels.shape === "lasso" && pixels.pointCount === 4, "Scaled cutaway lost its lasso polygon.", pixels);
    assert(pixels.outsideAlpha === 0, "Pixels outside the lasso should remain transparent.", pixels);
    assert(pixels.insideAlpha === 255, "Pixels inside the lasso should contain the capture.", pixels);
    assert(pixels.previewType === "data:image/webp;base64,", "Library preview was not encoded as WebP.", pixels);

    record("transparent lasso export pixels", pixels);
  });
}

async function countRuntimeMessages(page, type) {
  return page.evaluate((messageType) =>
    (window.__LUMEN_RUNTIME_MESSAGES__ || []).filter((message) => message?.type === messageType).length,
  type);
}

async function readLastRuntimeMessage(page, type) {
  return page.evaluate((messageType) =>
    (window.__LUMEN_RUNTIME_MESSAGES__ || []).findLast((message) => message?.type === messageType) || null,
  type);
}

async function main() {
  const contentScript = await buildPatchedContentScript();
  const offscreenScript = await buildPatchedOffscreenScript();
  const browser = await chromium.launch();

  try {
    await runDocumentCaptureSmoke(browser, contentScript);
    await runNestedScrollSmoke(browser, contentScript);
    await runOffsetStitchPixelSmoke(browser, offscreenScript);
    await runRedactionLimitSmoke(browser, contentScript);
    await runManualProjectionSmoke(browser, contentScript);
    await runCutawayRegionSmoke(browser, contentScript);
    await runLassoMaskPixelSmoke(browser, offscreenScript);
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({
    ok: true,
    checks: results
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    details: error.details || null,
    checks: results
  }, null, 2));
  process.exit(1);
});
