import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const contentScriptPath = path.join(repoRoot, "content.js");

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
      return { ok: true };
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
        clearManualRedactionPicker
      };
    })();
    `
    )}
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
          body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; color: #102033; }
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
      scrollY: window.scrollY
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
      chatHidden: document.querySelector(".intercom-launcher")?.dataset.lumenHidden === "true"
    }));

    assert(prepare.page.scrollMode === "document", "Document fixture did not prepare as document", prepare);
    assert(prepare.page.hiddenCount >= 2, "Expected cleanup to hide multiple page chrome elements", prepare.page);
    assert(state.stickyHidden && state.cookieHidden && state.chatHidden, "Expected sticky and overlay elements to be hidden", state);
    assert(state.lazySrc === svgPixel, "Expected lazy image source to be hydrated", state);
    assert(state.scrollY === 0, "Expected preflight scroll to return to top", state);
    assert(lateHidden, "Expected late overlay to be hidden after scroll");
    assert(!restored.stickyHidden && !restored.cookieHidden && !restored.chatHidden, "Expected hidden elements to restore", restored);
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
          #app-shell { height: 100vh; overflow-y: auto; background: #eef4fb; }
          .inner { min-height: 2400px; width: min(940px, calc(100% - 48px)); margin: 0 auto; padding: 64px 0; }
          .panel { margin-top: 900px; padding: 24px; border-radius: 20px; background: white; }
        </style>
      </head>
      <body>
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
    assert(scroll.top >= 700 && state.appScrollTop >= 700, "Nested fixture did not scroll the container", { scroll, state });
    assert(state.windowScrollY === 0, "Nested fixture should not scroll the window", state);
    assert(redactions.breakdown.byKind.email >= 1, "Nested fixture redaction scan missed lower content", redactions);

    record("nested scroll capture context", {
      scrollContainer: prepare.page.scrollContainer,
      top: scroll.top,
      redactionCount: redactions.count
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
    await page.keyboard.press("Escape");
    assert(stored?.anchor?.selector === "#secret-card", "Manual box did not store a usable DOM anchor", stored);

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

async function main() {
  const contentScript = await buildPatchedContentScript();
  const browser = await chromium.launch();

  try {
    await runDocumentCaptureSmoke(browser, contentScript);
    await runNestedScrollSmoke(browser, contentScript);
    await runManualProjectionSmoke(browser, contentScript);
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
