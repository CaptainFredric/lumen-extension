import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const contentScriptPath = path.join(repoRoot, "content.js");
const results = [];

const lazyPixel =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='360' height='180'%3E%3Crect width='360' height='180' fill='%2342d7c5'/%3E%3C/svg%3E";

function assert(condition, message, details = null) {
  if (condition) {
    return;
  }

  const error = new Error(message);
  error.details = details;
  throw error;
}

function record(name, details) {
  results.push({ name, ok: true, ...details });
}

async function buildPatchedContentScript() {
  const source = await readFile(contentScriptPath, "utf8");

  return `
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime || {};
    window.chrome.runtime.onMessage = window.chrome.runtime.onMessage || { addListener() {} };
    window.chrome.runtime.sendMessage = async () => ({ ok: true });
    ${source.replace(
      /\}\)\(\);\s*$/,
      `
      window.__LUMEN_RELIABILITY_API__ = {
        handlePrepareCapture,
        scrollToPosition,
        restorePageState,
        measurePreparedPage,
        extractBrandBlueprint,
        scanSensitiveRegions
      };
    })();
    `
    )}
  `;
}

async function withFixture(browser, fixture, contentScript, callback) {
  const page = await browser.newPage({
    viewport: fixture.viewport,
    deviceScaleFactor: 1
  });

  try {
    await page.setContent(fixture.html, { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: contentScript });
    await callback(page);
  } finally {
    await page.close();
  }
}

async function testLongMarketingPage(browser, contentScript) {
  const fixture = {
    viewport: { width: 1280, height: 800 },
    html: `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Long marketing fixture</title>
          <meta name="description" content="A long page with sticky chrome and lazy media." />
          <style>
            * { box-sizing: border-box; }
            html, body { margin: 0; font-family: system-ui, sans-serif; color: #0f172a; }
            header { position: sticky; top: 0; z-index: 2200; min-height: 68px; padding: 20px 32px; background: white; }
            main { width: min(1040px, calc(100% - 48px)); margin: auto; padding: 80px 0 7600px; }
            h1 { max-width: 12ch; font-size: 72px; line-height: .94; }
            .transformed { width: 380px; margin-top: 72px; transform: translate3d(19px, 11px, 0) rotate(.25deg); }
            .cookie { position: fixed; inset: auto 24px 24px; z-index: 3100; padding: 24px; background: white; box-shadow: 0 20px 80px #0003; }
            .chat { position: fixed; right: 26px; bottom: 130px; z-index: 3200; width: 68px; height: 68px; border-radius: 50%; background: #111827; }
          </style>
        </head>
        <body>
          <header><nav>Product &nbsp; Pricing &nbsp; Docs &nbsp; Support</nav></header>
          <main>
            <h1>Capture very long launch pages.</h1>
            <a href="#start">Start review</a>
            <section class="transformed" id="proof-card">
              <img id="lazy-image" width="360" height="180" alt="Lazy proof" data-src="${lazyPixel}" />
              <p>Contact long.page@example.com for release review.</p>
            </section>
          </main>
          <aside class="cookie">Cookie settings</aside>
          <button class="chat" aria-label="Support chat"></button>
        </body>
      </html>`
  };

  await withFixture(browser, fixture, contentScript, async (page) => {
    const transformBefore = await page.$eval("#proof-card", (node) => getComputedStyle(node).transform);
    const prepared = await page.evaluate(() => window.__LUMEN_RELIABILITY_API__.handlePrepareCapture({
      removeStickyHeaders: true,
      forceLazyLoad: true
    }));
    const state = await page.evaluate(async () => {
      const measure = await window.__LUMEN_RELIABILITY_API__.measurePreparedPage();

      return {
        pageHeight: measure.pageHeight,
        lazySource: document.querySelector("#lazy-image")?.getAttribute("src") || "",
        headerHidden: document.querySelector("header")?.dataset.lumenHidden === "true",
        cookieHidden: document.querySelector(".cookie")?.dataset.lumenHidden === "true",
        chatHidden: document.querySelector(".chat")?.dataset.lumenHidden === "true",
        transform: getComputedStyle(document.querySelector("#proof-card")).transform
      };
    });
    const redactions = await page.evaluate(() => window.__LUMEN_RELIABILITY_API__.scanSensitiveRegions());
    await page.evaluate(() => window.__LUMEN_RELIABILITY_API__.restorePageState());
    const restored = await page.evaluate(() => ({
      headerRestored: document.querySelector("header")?.dataset.lumenHidden !== "true",
      cookieRestored: document.querySelector(".cookie")?.dataset.lumenHidden !== "true"
    }));

    assert(prepared.page.scrollMode === "document", "Long page did not use document scrolling.", { prepared, state });
    assert(state.pageHeight >= 8000, "Long-page measurement lost the lower document tail.", state);
    assert(state.lazySource === lazyPixel, "Lazy media was not hydrated before capture.", state);
    assert(state.headerHidden && state.cookieHidden && state.chatHidden, "Sticky or fixed page chrome survived cleanup.", state);
    assert(state.transform === transformBefore, "Page cleanup changed transformed content.", { transformBefore, after: state.transform });
    assert(redactions.breakdown?.byKind?.email >= 1, "Sensitive scan missed text inside transformed content.", redactions);
    assert(restored.headerRestored && restored.cookieRestored, "Page chrome did not restore after capture.", restored);

    record("long document, lazy media, fixed overlays, transforms", {
      pageHeight: state.pageHeight,
      hiddenCount: prepared.page.hiddenCount,
      redactionCount: redactions.count
    });
  });
}

async function testNestedApplicationShell(browser, contentScript) {
  const fixture = {
    viewport: { width: 1260, height: 860 },
    html: `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Nested application shell</title>
          <style>
            * { box-sizing: border-box; }
            html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; font-family: system-ui, sans-serif; }
            .rail { position: fixed; inset: 0 auto 0 0; width: 176px; background: #111827; }
            .topbar { position: fixed; inset: 0 0 auto 176px; height: 72px; background: white; }
            #workspace { position: fixed; left: 196px; top: 88px; width: 1024px; height: 732px; overflow-y: auto; background: #eef2f7; }
            .workspace-inner { min-height: 4600px; padding: 48px 38px; }
            .workspace-sticky { position: sticky; top: 0; z-index: 90; padding: 18px; background: #fff; }
            .dashboard-card { margin-top: 2600px; min-height: 420px; padding: 28px; transform: translateX(13px); background: white; }
          </style>
        </head>
        <body>
          <aside class="rail"></aside>
          <header class="topbar"></header>
          <div id="workspace">
            <main class="workspace-inner">
              <div class="workspace-sticky">Pinned filters</div>
              <h1>Release operations</h1>
              <section class="dashboard-card">Lower dashboard state: app.shell@example.com</section>
            </main>
          </div>
        </body>
      </html>`
  };

  await withFixture(browser, fixture, contentScript, async (page) => {
    const prepared = await page.evaluate(() => window.__LUMEN_RELIABILITY_API__.handlePrepareCapture({
      removeStickyHeaders: false,
      forceLazyLoad: false
    }));
    const scrolled = await page.evaluate(() => window.__LUMEN_RELIABILITY_API__.scrollToPosition(2550));
    const state = await page.evaluate(async () => ({
      windowScrollY: window.scrollY,
      shellScrollTop: document.querySelector("#workspace")?.scrollTop || 0,
      measure: await window.__LUMEN_RELIABILITY_API__.measurePreparedPage()
    }));
    const redactions = await page.evaluate(() => window.__LUMEN_RELIABILITY_API__.scanSensitiveRegions());
    await page.evaluate(() => window.__LUMEN_RELIABILITY_API__.restorePageState());
    const restoredTop = await page.$eval("#workspace", (node) => node.scrollTop);

    assert(prepared.page.scrollMode === "container", "App shell did not select its nested scroll root.", prepared.page);
    assert(/#workspace/.test(prepared.page.scrollContainer), "App shell selected the wrong nested scroller.", prepared.page);
    assert(prepared.page.captureRect?.left === 196 && prepared.page.captureRect?.top === 88, "App-shell capture crop lost its viewport offset.", prepared.page.captureRect);
    assert(scrolled.top >= 2500 && state.shellScrollTop >= 2500 && state.windowScrollY === 0, "Nested scrolling moved the wrong surface.", { scrolled, state });
    assert(state.measure.pageHeight >= 4500, "Nested scroll measurement lost lower application content.", state.measure);
    assert(redactions.breakdown?.byKind?.email >= 1, "Nested app shell scan missed lower sensitive content.", redactions);
    assert(restoredTop === 0, "Nested scroll root did not restore its original position.", { restoredTop });

    record("nested application shell and offset scroll root", {
      scrollContainer: prepared.page.scrollContainer,
      pageHeight: state.measure.pageHeight,
      captureRect: prepared.page.captureRect
    });
  });
}

async function testLateGrowthAndOverlays(browser, contentScript) {
  const fixture = {
    viewport: { width: 1120, height: 760 },
    html: `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Late growth fixture</title>
          <style>
            body { margin: 0; font-family: system-ui, sans-serif; }
            main { min-height: 2600px; padding: 64px; }
            .late-tail { min-height: 4100px; background: linear-gradient(#fff, #dbeafe); }
          </style>
        </head>
        <body><main><h1>Growing result feed</h1><p>Initial content.</p></main></body>
      </html>`
  };

  await withFixture(browser, fixture, contentScript, async (page) => {
    await page.evaluate(() => window.__LUMEN_RELIABILITY_API__.handlePrepareCapture({
      removeStickyHeaders: true,
      forceLazyLoad: false
    }));
    const before = await page.evaluate(() => window.__LUMEN_RELIABILITY_API__.measurePreparedPage());
    await page.evaluate(() => {
      const tail = document.createElement("section");
      tail.className = "late-tail";
      tail.textContent = "Late result batch";
      document.querySelector("main").append(tail);

      const overlay = document.createElement("aside");
      overlay.className = "late-overlay";
      overlay.textContent = "Late cookie prompt";
      overlay.style.cssText = "position:fixed;inset:auto 20px 20px;z-index:4000;min-height:100px;background:white";
      document.body.append(overlay);
    });
    await page.evaluate(() => window.__LUMEN_RELIABILITY_API__.scrollToPosition(1800));
    const after = await page.evaluate(async () => ({
      measure: await window.__LUMEN_RELIABILITY_API__.measurePreparedPage(),
      overlayHidden: document.querySelector(".late-overlay")?.dataset.lumenHidden === "true"
    }));
    await page.evaluate(() => window.__LUMEN_RELIABILITY_API__.restorePageState());
    const restored = await page.evaluate(() => ({
      overlayHidden: document.querySelector(".late-overlay")?.dataset.lumenHidden === "true",
      scrollY: window.scrollY
    }));

    assert(after.measure.pageHeight > before.pageHeight + 1500, "Tail remeasurement did not observe late-growing content.", { before, after });
    assert(after.overlayHidden, "A late fixed overlay was not cleaned on the next scroll step.", after);
    assert(!restored.overlayHidden && restored.scrollY === 0, "Late-page mutations did not restore cleanly.", restored);

    record("late document growth and late overlay cleanup", {
      beforeHeight: before.pageHeight,
      afterHeight: after.measure.pageHeight
    });
  });
}

async function testOpaqueContentSafety(browser, contentScript) {
  const fixture = {
    viewport: { width: 1024, height: 760 },
    html: `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Opaque content safety fixture</title>
          <style>
            body { margin: 0; font-family: system-ui, sans-serif; }
            main { min-height: 3200px; padding: 56px; }
            canvas, iframe, #open-shadow-host, #closed-shadow-host { display: block; width: 420px; min-height: 180px; margin: 28px 0; border: 1px solid #94a3b8; }
          </style>
        </head>
        <body>
          <main>
            <h1>Embedded surfaces</h1>
            <p>Visible document contact: document.owner@example.com</p>
            <canvas id="chart" width="420" height="180"></canvas>
            <iframe id="opaque-frame" sandbox srcdoc="<!doctype html><p>Frame-only secret iframe.owner@example.com</p>"></iframe>
            <div id="open-shadow-host"></div>
            <div id="closed-shadow-host"></div>
          </main>
          <script>
            const context = document.querySelector("#chart").getContext("2d");
            context.fillStyle = "rgb(38, 110, 246)";
            context.fillRect(0, 0, 420, 180);
            const openShadow = document.querySelector("#open-shadow-host").attachShadow({ mode: "open" });
            openShadow.innerHTML = '<p>Open shadow contact open.shadow@example.com</p><img id="shadow-lazy" width="160" height="80" alt="Lazy shadow media" />';
            openShadow.querySelector("#shadow-lazy").setAttribute("data-src", ${JSON.stringify(lazyPixel)});
            const shadow = document.querySelector("#closed-shadow-host").attachShadow({ mode: "closed" });
            shadow.innerHTML = "<p>Closed shadow secret shadow.owner@example.com</p>";
          <\/script>
        </body>
      </html>`
  };

  await withFixture(browser, fixture, contentScript, async (page) => {
    const pixelBefore = await page.$eval("#chart", (canvas) => [...canvas.getContext("2d").getImageData(12, 12, 1, 1).data]);
    const prepared = await page.evaluate(() => window.__LUMEN_RELIABILITY_API__.handlePrepareCapture({
      removeStickyHeaders: true,
      forceLazyLoad: true
    }));
    const redactions = await page.evaluate(() => window.__LUMEN_RELIABILITY_API__.scanSensitiveRegions());
    const blueprint = await page.evaluate(() => window.__LUMEN_RELIABILITY_API__.extractBrandBlueprint());
    const state = await page.evaluate(() => ({
      iframeConnected: document.querySelector("#opaque-frame")?.isConnected || false,
      iframeSandbox: document.querySelector("#opaque-frame")?.hasAttribute("sandbox") || false,
      openShadowRootExposed: Boolean(document.querySelector("#open-shadow-host")?.shadowRoot),
      openShadowLazySource: document.querySelector("#open-shadow-host")?.shadowRoot?.querySelector("#shadow-lazy")?.getAttribute("src") || "",
      closedShadowRootExposed: Boolean(document.querySelector("#closed-shadow-host")?.shadowRoot),
      pixel: [...document.querySelector("#chart").getContext("2d").getImageData(12, 12, 1, 1).data]
    }));
    await page.evaluate(() => window.__LUMEN_RELIABILITY_API__.restorePageState());

    assert(prepared.page.pageHeight >= 3000, "Opaque-content fixture lost its document tail.", prepared.page);
    assert(
      prepared.page.renderingRisks?.iframeCount === 1 && prepared.page.renderingRisks?.canvasCount === 1,
      "Capture preparation did not report iframe and canvas review risks.",
      prepared.page.renderingRisks
    );
    assert(state.iframeConnected && state.iframeSandbox, "Capture preparation removed or widened the sandboxed iframe.", state);
    assert(state.openShadowRootExposed, "Open shadow-root traversal lost the page-owned root.", state);
    assert(state.openShadowLazySource === lazyPixel, "Lazy media inside an open shadow root was not hydrated.", state);
    assert(!state.closedShadowRootExposed, "Closed shadow-root encapsulation changed during preparation.", state);
    assert(state.pixel.join(",") === pixelBefore.join(","), "Capture preparation changed canvas pixels.", { before: pixelBefore, after: state.pixel });
    assert(redactions.breakdown?.byKind?.email === 2, "Open shadow text should be scanned while iframe and closed-shadow content remain opaque.", redactions);
    assert(Boolean(blueprint?.identity), "Signal extraction failed in the presence of opaque embedded surfaces.", blueprint);

    record("canvas, sandboxed iframe, and open/closed shadow-root safety", {
      pageHeight: prepared.page.pageHeight,
      redactionCount: redactions.count,
      renderingRisks: prepared.page.renderingRisks,
      canvasPixel: state.pixel
    });
  });
}

async function main() {
  const contentScript = await buildPatchedContentScript();
  const browser = await chromium.launch();

  try {
    await testLongMarketingPage(browser, contentScript);
    await testNestedApplicationShell(browser, contentScript);
    await testLateGrowthAndOverlays(browser, contentScript);
    await testOpaqueContentSafety(browser, contentScript);
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({
    ok: true,
    fixtureCount: results.length,
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
  process.exitCode = 1;
});
