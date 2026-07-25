import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "store-assets", "screenshots");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lumen-store-shots-"));
const stagingOutputDir = path.join(tempRoot, "screenshots");
const extensionDir = path.join(tempRoot, "extension");
const profileDir = path.join(tempRoot, "profile");
const shotSize = {
  width: 1280,
  height: 800
};
const screenshotNow = Date.parse("2026-07-22T18:30:00.000Z");

const captureAssets = {
  desktop: await imageDataUrl("docs/assets/capture-run-desktop.png"),
  tablet: await imageDataUrl("docs/assets/capture-run-tablet.png"),
  mobile: await imageDataUrl("docs/assets/capture-run-mobile.png"),
  redacted: await imageDataUrl("docs/assets/capture-run-redacted.png"),
  signals: await imageDataUrl("docs/assets/capture-run-signals.png"),
  history: await imageDataUrl("docs/assets/capture-run-history.png")
};
const publicStoreAssetCopies = [
  ["01-extension-control-surface.png", "store-control-surface.png"],
  ["02-annotation-studio.png", "store-review-actions.png"],
  ["02-annotation-studio.png", "store-annotation-studio.png"],
  ["03-visual-change-review.png", "store-visual-change-review.png"],
  ["04-responsive-capture-set.png", "store-responsive-set.png"],
  ["05-library-and-area-monitor.png", "store-library-monitor.png"]
];

const screenshots = [];
let extensionContext;
let renderBrowser;

try {
  await mkdir(stagingOutputDir, { recursive: true });

  const productShots = await captureExtensionProductShots();
  renderBrowser = await chromium.launch();
  const page = await renderBrowser.newPage({
    viewport: shotSize,
    deviceScaleFactor: 1,
    reducedMotion: "reduce"
  });

  await renderStoreShot(page, "01-extension-control-surface.png", buildResultWorkspaceShot(productShots.result, productShots.settings));
  await writeStoreScreenshot("02-annotation-studio.png", productShots.editor);
  await writeStoreScreenshot("03-visual-change-review.png", productShots.review);
  await renderStoreShot(page, "04-responsive-capture-set.png", buildResponsiveSetShot());
  await renderStoreShot(page, "05-library-and-area-monitor.png", buildLibraryMonitorShot(productShots.library, productShots.watch));

  await page.close();

  for (const filePath of screenshots) {
    await assertPngDimensions(filePath, shotSize.width, shotSize.height);
  }

  await replaceScreenshotOutput();
  await copyPublicStoreAssets();

  console.log(JSON.stringify({
    ok: true,
    outputDir,
    count: screenshots.length,
    screenshots: screenshots.map((filePath) => path.join("store-assets", "screenshots", path.basename(filePath)))
  }, null, 2));
} finally {
  await extensionContext?.close().catch(() => {});
  await renderBrowser?.close().catch(() => {});
  await rm(tempRoot, { recursive: true, force: true });
}

async function captureExtensionProductShots() {
  await prepareExtensionCopy();

  extensionContext = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    reducedMotion: "reduce",
    viewport: {
      width: 430,
      height: 780
    },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`
    ]
  });

  let [worker] = extensionContext.serviceWorkers();

  if (!worker) {
    worker = await extensionContext.waitForEvent("serviceworker", { timeout: 10000 });
  }

  const extensionId = new URL(worker.url()).host;
  const target = await extensionContext.newPage();
  await extensionContext.route("https://lumen-store.test/", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: buildTargetFixture()
  }));
  await target.goto("https://lumen-store.test/", { waitUntil: "domcontentloaded" });
  await target.bringToFront();
  await seedExtensionState(worker);

  const popup = await extensionContext.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
  await popup.waitForSelector("#captureButton", { timeout: 10000 });
  await popup.waitForFunction(() => document.querySelector("#launchStatus")?.dataset.state === "ready", null, {
    timeout: 10000
  });

  await seedStoreMonitorState(worker);
  await popup.reload({ waitUntil: "load" });
  await popup.locator(".options-workspace").evaluate((details) => {
    details.open = true;
  });
  await popup.waitForSelector("#watchPlanCard:not(.is-hidden)", { timeout: 10000 });
  const onboardingDismissButton = popup.locator("#onboardingDismissButton");
  if (await onboardingDismissButton.isVisible().catch(() => false)) {
    await onboardingDismissButton.click();
  }
  await popup.locator("#watchPlanCard").scrollIntoViewIfNeeded();
  await popup.waitForTimeout(200);
  const watchShot = await popup.screenshot({ type: "png" });

  const editorShot = await captureExtensionPageShot({
    extensionId,
    route: "editor.html?demo=1",
    ready(page) {
      return page.waitForFunction(() =>
        !document.querySelector("#canvasFrame")?.classList.contains("is-hidden") &&
        document.querySelectorAll("[data-tool]").length >= 6 &&
        !document.querySelector("#exportButton")?.disabled
      );
    }
  });
  const reviewShot = await captureExtensionPageShot({
    extensionId,
    route: "review.html?demo=1",
    ready(page) {
      return page.waitForFunction(() =>
        !document.querySelector("#reviewContent")?.classList.contains("is-hidden") &&
        document.querySelector("#changePercentMetric")?.textContent?.trim() !== "—" &&
        document.querySelectorAll("#timelineList .timeline-item").length >= 3
      );
    }
  });
  const settingsShot = await captureExtensionPageShot({
    extensionId,
    route: "settings.html",
    viewport: { width: 430, height: 780 },
    async ready(page) {
      await page.waitForFunction(() => document.querySelector("#saveStateTitle")?.textContent?.includes("Saved"));
      const shield = page.locator("#privacyShieldToggle");
      if (!(await shield.isChecked())) {
        await shield.check();
      }
      await page.waitForFunction(() =>
        document.querySelector(".shield-card")?.classList.contains("is-enabled") &&
        document.querySelector("#shieldStateLabel")?.textContent?.trim() === "On"
      );
      await page.locator(".shield-card").scrollIntoViewIfNeeded();
    }
  });
  const resultShot = await captureResultShot(extensionId);
  const libraryShot = await captureLibraryShot(extensionId);

  await popup.close();
  await target.close();

  return {
    watch: bufferToDataUrl(watchShot),
    editor: editorShot,
    review: reviewShot,
    result: bufferToDataUrl(resultShot),
    settings: bufferToDataUrl(settingsShot),
    library: bufferToDataUrl(libraryShot)
  };
}

async function captureResultShot(extensionId) {
  const page = await extensionContext.newPage();
  const captureId = "store-result-workspace";

  try {
    await page.setViewportSize({ width: 1120, height: 720 });
    await page.goto(`chrome-extension://${extensionId}/library.html`, { waitUntil: "load" });
    await page.evaluate(async ({ captureId: id, imageDataUrl, capturedAt }) => {
      const { putLibraryCapture } = await import(chrome.runtime.getURL("library-store.js"));
      const downloadId = await chrome.downloads.download({
        url: imageDataUrl,
        filename: "Lumen/store-shot/launch-page.png",
        saveAs: false
      });
      let download = null;

      for (let attempt = 0; attempt < 100; attempt += 1) {
        [download] = await chrome.downloads.search({ id: downloadId });

        if (download?.state === "complete") {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      if (!download || download.state !== "complete") {
        throw new Error("The store result screenshot could not seed its completed original.");
      }

      await putLibraryCapture({
        id,
        title: "Launch page review",
        host: "lumen-store.test",
        url: "https://lumen-store.test/",
        capturedAt,
        sourceType: "manual",
        dimensions: { width: 1280, height: 860 },
        fileCount: 1,
        downloads: [{
          downloadId,
          filename: "Lumen/2026-05-12/store-shot/launch-page.png",
          bytesReceived: download.bytesReceived,
          complete: true,
          kind: "image",
          role: "full-page",
          variantId: "desktop",
          width: 1280,
          height: 860
        }],
        editorSource: {
          dataUrl: imageDataUrl,
          width: 1280,
          height: 860,
          originalWidth: 1280,
          originalHeight: 860,
          scaled: false,
          kind: "lossless-full-output",
          role: "full-page",
          variantId: "desktop"
        }
      });
    }, {
      captureId,
      imageDataUrl: captureAssets.desktop,
      capturedAt: new Date(screenshotNow).toISOString()
    });
    await page.goto(`chrome-extension://${extensionId}/result.html?capture=${captureId}`, { waitUntil: "load" });
    await page.waitForSelector('body[data-state="ready"] #resultImage:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(350);
    return await page.screenshot({ type: "png", fullPage: false });
  } finally {
    await page.close();
  }
}

async function captureExtensionPageShot({ extensionId, route, ready, viewport = shotSize }) {
  const page = await extensionContext.newPage();

  try {
    await page.setViewportSize(viewport);
    await page.goto(`chrome-extension://${extensionId}/${route}`, { waitUntil: "load" });
    await ready(page);
    await page.waitForTimeout(350);
    return await page.screenshot({ type: "png", fullPage: false });
  } finally {
    await page.close();
  }
}

async function captureLibraryShot(extensionId) {
  const page = await extensionContext.newPage();

  try {
    await page.setViewportSize({ width: 1120, height: 720 });
    await page.goto(`chrome-extension://${extensionId}/library.html`, { waitUntil: "load" });
    const seededLibrary = await page.evaluate(async ({ desktop, tablet, now }) => {
      const { getLibraryCapture, putLibraryCapture } = await import(chrome.runtime.getURL("library-store.js"));
      const toBlob = async (dataUrl) => (await fetch(dataUrl)).blob();
      const records = [
        {
          id: "store-library-manual",
          title: "Launch page review",
          host: "lumen-store.test",
          url: "https://lumen-store.test/",
          sourceType: "manual",
          favorite: true,
          capturedAt: new Date(now).toISOString(),
          archiveFolder: "Lumen/2026-07-16/launch-page",
          previewBlob: await toBlob(desktop),
          downloads: [{ downloadId: 210, filename: "Lumen/launch-page.png", kind: "image", role: "full-page", width: 1440, height: 2600 }],
          tags: ["responsive", "reviewed"]
        },
        {
          id: "store-library-timed",
          title: "Pricing area monitor",
          host: "lumen-store.test",
          url: "https://lumen-store.test/pricing",
          sourceType: "timed",
          watchPlanId: "store-monitor-plan",
          capturedAt: new Date(now - 18 * 60 * 1000).toISOString(),
          archiveFolder: "Lumen/2026-07-16/pricing-monitor",
          previewBlob: await toBlob(tablet),
          downloads: [{ downloadId: 211, filename: "Lumen/pricing-monitor.png", kind: "image", role: "cutaway", width: 720, height: 840 }],
          tags: ["timed", "changed"]
        }
      ];

      for (const record of records) {
        await putLibraryCapture(record);
      }

      return Promise.all(records.map(async (record) => {
        const capture = await getLibraryCapture(record.id, { includePreview: true });
        return {
          id: record.id,
          previewReady: Boolean(capture?.preview?.blob?.size),
          previewBytes: capture?.preview?.blob?.size || 0
        };
      }));
    }, { desktop: captureAssets.desktop, tablet: captureAssets.tablet, now: screenshotNow });
    if (!seededLibrary.every((capture) => capture.previewReady)) {
      throw new Error(`Store screenshot library previews were not seeded: ${JSON.stringify(seededLibrary)}`);
    }
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#captureGrid:not(.is-hidden) .capture-card", { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll("#captureGrid .capture-card").length >= 2);
    await page.locator("#captureGrid").scrollIntoViewIfNeeded();
    const renderedPreviewCount = await page.evaluate(async () => {
      const { getLibraryPreviewAsset } = await import(chrome.runtime.getURL("library-store.js"));
      let rendered = 0;

      for (const card of document.querySelectorAll("#captureGrid .capture-card")) {
        const captureId = card.dataset.captureId || "";
        const asset = await getLibraryPreviewAsset(captureId);
        const image = card.querySelector(".capture-preview");
        const fallback = card.querySelector(".preview-fallback");

        if (!asset?.blob || !image) {
          continue;
        }

        image.loading = "eager";
        image.src = URL.createObjectURL(asset.blob);
        await image.decode();
        image.classList.remove("is-hidden");
        fallback?.classList.add("is-hidden");
        rendered += 1;
      }

      return rendered;
    });
    if (renderedPreviewCount < 2) {
      throw new Error(`Expected two rendered store-library previews, got ${renderedPreviewCount}.`);
    }
    await page.waitForTimeout(350);
    return await page.screenshot({ type: "png", fullPage: false });
  } finally {
    await page.close();
  }
}

async function writeStoreScreenshot(filename, buffer) {
  const filePath = path.join(stagingOutputDir, filename);
  await writeFile(filePath, buffer);
  screenshots.push(filePath);
}

async function renderStoreShot(page, filename, bodyHtml) {
  const filePath = path.join(stagingOutputDir, filename);
  await page.setContent(buildStoreShell(bodyHtml), { waitUntil: "load" });
  await page.screenshot({
    path: filePath,
    fullPage: false
  });
  screenshots.push(filePath);
}

function buildResultWorkspaceShot(resultImage, settingsImage) {
  return `
    <section class="workspace-shot">
      <div class="shot-head">
        <div>
          <p class="eyebrow">Capture result</p>
          <h2>Capture once. Use it immediately.</h2>
        </div>
        <p>Copy the image, download PNG or PDF, annotate it, or return to the saved original from one clean workspace.</p>
      </div>
      <div class="workspace-pair">
        <figure class="browser-card library-card"><img src="${resultImage}" alt="Lumen Capture Result workspace" /><figcaption>Copy, zoom, edit, and export</figcaption></figure>
        <div class="phone-frame workspace-phone"><img src="${settingsImage}" alt="Lumen Privacy Shield settings" /></div>
      </div>
    </section>
  `;
}

function buildHoldActionShot(popupImage) {
  return `
    <section class="split-grid">
      <div class="phone-frame compact">
        <img src="${popupImage}" alt="Lumen hold action menu" />
      </div>
      <div class="panel-stack">
        <p class="eyebrow">Quick actions</p>
        <h2>Hold the capture button to move faster.</h2>
        <p>Run the step you need: scan redactions, mark a cutaway, lasso a region, or add a callout.</p>
        <div class="metric-grid">
          <article><strong>7</strong><span>quick actions</span></article>
          <article><strong>1</strong><span>callout region</span></article>
          <article><strong>1</strong><span>lasso region</span></article>
        </div>
      </div>
    </section>
  `;
}

function buildResponsiveSetShot() {
  return `
    <section class="output-shot">
      <div class="shot-head">
        <p class="eyebrow">Responsive output</p>
        <h2>Responsive, redacted, and focused outputs in one run.</h2>
        <p>Save desktop, tablet, and mobile views, then keep a rectangle or transparent lasso beside the full page.</p>
      </div>
      <div class="device-grid">
        <figure class="browser-card wide"><img src="${captureAssets.desktop}" alt="Desktop capture output" /><figcaption>Desktop full page</figcaption></figure>
        <figure class="browser-card"><img src="${captureAssets.tablet}" alt="Tablet capture output" /><figcaption>Tablet</figcaption></figure>
        <figure class="browser-card phone"><img src="${captureAssets.mobile}" alt="Mobile capture output" /><figcaption>Mobile</figcaption></figure>
      </div>
    </section>
  `;
}

function buildLibraryMonitorShot(libraryImage, watchImage) {
  return `
    <section class="workspace-shot">
      <div class="shot-head">
        <div>
          <p class="eyebrow">Local capture workspace</p>
          <h2>Photos, monitor runs, and reviewed exports stay connected.</h2>
        </div>
        <p>Browse real local previews, keep favorites, inspect a timed area, and send only the reviewed image to Drive when you choose.</p>
      </div>
      <div class="workspace-pair">
        <figure class="browser-card library-card"><img src="${libraryImage}" alt="Lumen local capture library" /><figcaption>Local photo library</figcaption></figure>
        <div class="phone-frame workspace-phone"><img src="${watchImage}" alt="Lumen active area monitor" /></div>
      </div>
    </section>
  `;
}

function buildRedactionShot() {
  return `
    <section class="review-grid-shot">
      <div class="shot-head">
        <p class="eyebrow">Redaction and callouts</p>
        <h2>Clean the page first, then mark what needs attention.</h2>
        <p>Redaction covers visible text and filled inputs during saving. Marked regions stay visible for a final check before sharing.</p>
      </div>
      <div class="review-pair">
        <figure class="browser-card redaction"><img src="${captureAssets.redacted}" alt="Redacted capture output" /><figcaption>Redacted image</figcaption></figure>
        <div class="artifact-card">
          <span class="status-pill">Save controls</span>
          <h3>Check before sharing</h3>
          <ul>
            <li>Auto-redactions applied</li>
            <li>Manual boxes can be drawn before saving</li>
            <li>Cutaway and callout regions resolve by page anchor</li>
            <li>Timed capture and routing records require explicit opt-in</li>
          </ul>
        </div>
      </div>
    </section>
  `;
}

function buildSignalsShot() {
  return `
    <section class="review-grid-shot">
      <div class="shot-head">
        <p class="eyebrow">Signals and local history</p>
        <h2>The screenshot ships with context.</h2>
        <p>Each run can include files, dimensions, redaction counts, page signals, and a local history entry for later reference.</p>
      </div>
      <div class="review-pair">
        <figure class="browser-card"><img src="${captureAssets.signals}" alt="Extracted page signals" /><figcaption>Signals JSON</figcaption></figure>
        <figure class="browser-card"><img src="${captureAssets.history}" alt="Local capture history" /><figcaption>Local history item</figcaption></figure>
      </div>
    </section>
  `;
}

function buildStoreShell(bodyHtml) {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          :root {
            color-scheme: dark;
            font-family: "SF Pro Display", "Segoe UI Variable Display", "IBM Plex Sans", sans-serif;
            --bg: #050811;
            --panel: rgba(12, 19, 32, 0.82);
            --panel-strong: rgba(15, 24, 40, 0.96);
            --border: rgba(255, 255, 255, 0.1);
            --text: #f3f8ff;
            --muted: rgba(231, 241, 255, 0.72);
            --quiet: rgba(231, 241, 255, 0.54);
            --accent: #86ddff;
            --accent-strong: #42d7c5;
          }
          * { box-sizing: border-box; }
          html, body { width: 1280px; height: 800px; margin: 0; overflow: hidden; }
          body {
            display: grid;
            place-items: stretch;
            background:
              radial-gradient(circle at 18% 12%, rgba(76, 201, 240, 0.24), transparent 28%),
              radial-gradient(circle at 90% 88%, rgba(66, 215, 197, 0.16), transparent 30%),
              linear-gradient(135deg, #050811 0%, #08111f 54%, #04070d 100%);
            color: var(--text);
          }
          main {
            position: relative;
            width: 1280px;
            height: 800px;
            padding: 54px 64px;
          }
          main::before {
            content: "";
            position: absolute;
            inset: 28px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 38px;
            pointer-events: none;
          }
          .hero-grid,
          .split-grid,
          .output-shot,
          .review-grid-shot,
          .control-shot,
          .workspace-shot {
            position: relative;
            display: grid;
            height: 100%;
            gap: 34px;
            align-items: center;
          }
          .hero-grid { grid-template-columns: 1fr 430px; }
          .split-grid { grid-template-columns: 430px 1fr; }
          .control-shot { grid-template-columns: 0.82fr 1.18fr; }
          .output-shot,
          .review-grid-shot,
          .workspace-shot { align-content: center; }
          .copy,
          .panel-stack,
          .artifact-card {
            border: 1px solid var(--border);
            border-radius: 32px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), transparent 34%), var(--panel);
            box-shadow: 0 34px 90px rgba(0, 0, 0, 0.38);
            backdrop-filter: blur(20px);
          }
          .copy { padding: 52px; }
          .panel-stack,
          .artifact-card { padding: 34px; }
          .eyebrow {
            margin: 0 0 14px;
            color: var(--accent);
            font-size: 13px;
            font-weight: 800;
            letter-spacing: 0.16em;
            text-transform: uppercase;
          }
          h1, h2, h3, p { margin: 0; }
          h1 {
            max-width: 11ch;
            font-size: 72px;
            line-height: 0.9;
            letter-spacing: -0.07em;
          }
          h2 {
            max-width: 14ch;
            font-size: 48px;
            line-height: 0.94;
            letter-spacing: -0.05em;
          }
          h3 {
            margin-top: 16px;
            font-size: 28px;
            letter-spacing: -0.03em;
          }
          .lede,
          .shot-head p,
          .panel-stack p {
            max-width: 620px;
            margin-top: 22px;
            color: var(--muted);
            font-size: 20px;
            line-height: 1.5;
          }
          .cta-row {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 34px;
          }
          .cta-row span,
          .status-pill {
            display: inline-flex;
            align-items: center;
            min-height: 34px;
            padding: 0 14px;
            border: 1px solid rgba(134, 221, 255, 0.2);
            border-radius: 999px;
            background: rgba(134, 221, 255, 0.1);
            color: rgba(235, 252, 255, 0.9);
            font-size: 13px;
            font-weight: 800;
          }
          .phone-frame {
            justify-self: end;
            padding: 14px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 36px;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.11), transparent 36%), rgba(5, 9, 16, 0.72);
            box-shadow: 0 36px 100px rgba(0, 0, 0, 0.48);
          }
          .phone-frame.compact { justify-self: start; }
          .phone-frame img {
            display: block;
            width: 400px;
            height: 720px;
            object-fit: cover;
            object-position: top;
            border-radius: 24px;
          }
          .phone-frame.compact img {
            object-fit: contain;
            background: #050811;
          }
          .popup-pair {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 16px;
            min-width: 0;
          }
          .phone-frame.mini {
            justify-self: auto;
            padding: 10px;
            border-radius: 28px;
          }
          .phone-frame.mini img {
            width: 294px;
            height: 534px;
            border-radius: 20px;
          }
          .phone-frame.mini.raised { transform: translateY(-18px); }
          .metric-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 14px;
            margin-top: 34px;
          }
          .metric-grid article {
            min-height: 116px;
            padding: 20px;
            border: 1px solid var(--border);
            border-radius: 22px;
            background: rgba(255, 255, 255, 0.045);
          }
          .metric-grid strong {
            display: block;
            color: var(--accent);
            font-size: 46px;
            line-height: 1;
            letter-spacing: -0.05em;
          }
          .metric-grid span {
            display: block;
            margin-top: 12px;
            color: var(--quiet);
            font-size: 14px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.08em;
          }
          .shot-head {
            display: flex;
            align-items: end;
            justify-content: space-between;
            gap: 28px;
          }
          .shot-head h2 { max-width: 640px; }
          .shot-head p { max-width: 460px; }
          .device-grid {
            display: grid;
            grid-template-columns: 1.45fr 0.86fr 0.7fr;
            gap: 18px;
            align-items: stretch;
          }
          .review-pair {
            display: grid;
            grid-template-columns: 1.15fr 0.85fr;
            gap: 22px;
            align-items: stretch;
          }
          .workspace-pair {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 294px;
            gap: 22px;
            min-height: 452px;
            align-items: stretch;
          }
          .workspace-phone {
            justify-self: stretch;
            padding: 10px;
            border-radius: 28px;
          }
          .workspace-phone img {
            width: 100%;
            height: 430px;
            border-radius: 20px;
          }
          .browser-card {
            position: relative;
            min-height: 420px;
            margin: 0;
            overflow: hidden;
            border: 1px solid var(--border);
            border-radius: 28px;
            background: var(--panel-strong);
            box-shadow: 0 30px 80px rgba(0, 0, 0, 0.34);
          }
          .browser-card::before {
            content: "";
            display: block;
            height: 38px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            background: linear-gradient(90deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.03));
          }
          .browser-card::after {
            content: "";
            position: absolute;
            top: 16px;
            left: 18px;
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: #ff6b6b;
            box-shadow: 16px 0 #ffd166, 32px 0 #4ade80;
          }
          .browser-card img {
            display: block;
            width: 100%;
            height: 380px;
            object-fit: cover;
            object-position: top left;
          }
          .browser-card.wide img { height: 480px; }
          .browser-card.phone img { object-position: top center; }
          .browser-card.redaction img { height: 500px; }
          .browser-card.library-card { min-height: 452px; }
          .browser-card.library-card img {
            height: 414px;
            object-fit: cover;
            object-position: top left;
          }
          figcaption {
            position: absolute;
            left: 16px;
            bottom: 14px;
            padding: 8px 11px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 999px;
            background: rgba(5, 9, 16, 0.78);
            color: rgba(242, 249, 255, 0.88);
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }
          ul {
            display: grid;
            gap: 14px;
            margin: 28px 0 0;
            padding: 0;
            list-style: none;
            color: var(--muted);
            font-size: 18px;
            line-height: 1.35;
          }
          li {
            padding-left: 22px;
            position: relative;
          }
          li::before {
            content: "";
            position: absolute;
            left: 0;
            top: 0.62em;
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: var(--accent-strong);
          }
        </style>
      </head>
      <body><main>${bodyHtml}</main></body>
    </html>`;
}

function buildTargetFixture() {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Lumen store screenshot target</title>
        <style>
          body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #f6f8fb; color: #101828; }
          header { position: sticky; top: 0; z-index: 20; padding: 18px 40px; background: rgba(255, 255, 255, 0.92); border-bottom: 1px solid #e4e9f2; }
          main { width: min(1040px, calc(100% - 48px)); margin: 0 auto; padding: 76px 0 900px; }
          h1 { max-width: 720px; font-size: 72px; line-height: 0.92; letter-spacing: -0.06em; }
          .card { margin-top: 54px; padding: 28px; border: 1px solid #d7dee8; border-radius: 28px; background: #fff; }
          .cookie { position: fixed; right: 24px; bottom: 24px; z-index: 40; padding: 18px 20px; border-radius: 18px; background: #fff; box-shadow: 0 20px 50px rgba(16, 24, 40, 0.18); }
        </style>
      </head>
      <body>
        <header><strong>Example launch page</strong></header>
        <main>
          <p>Store screenshot fixture</p>
          <h1>Evidence page with overlays and sensitive text.</h1>
          <section class="card"><p>Contact qa.audit@example.com before external sharing.</p></section>
        </main>
        <aside class="cookie">Cookie notice</aside>
      </body>
    </html>`;
}

async function replaceScreenshotOutput() {
  const parentDir = path.dirname(outputDir);
  const nextDir = path.join(parentDir, `.screenshots-next-${process.pid}`);
  const backupDir = path.join(parentDir, `.screenshots-backup-${process.pid}`);
  let movedExistingOutput = false;

  await mkdir(parentDir, { recursive: true });
  await rm(nextDir, { recursive: true, force: true });
  await rm(backupDir, { recursive: true, force: true });
  await cp(stagingOutputDir, nextDir, { recursive: true });

  try {
    await rename(outputDir, backupDir);
    movedExistingOutput = true;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  try {
    await rename(nextDir, outputDir);
  } catch (error) {
    if (movedExistingOutput) {
      await rename(backupDir, outputDir).catch(() => {});
    }
    throw error;
  }

  if (movedExistingOutput) {
    await rm(backupDir, { recursive: true, force: true });
  }
}

async function copyPublicStoreAssets() {
  const targets = [
    path.join(repoRoot, "assets"),
    path.join(repoRoot, "docs", "assets")
  ];

  for (const targetDir of targets) {
    await mkdir(targetDir, { recursive: true });
  }

  for (const [sourceName, targetName] of publicStoreAssetCopies) {
    const source = path.join(outputDir, sourceName);

    for (const targetDir of targets) {
      await cp(source, path.join(targetDir, targetName));
    }
  }
}

async function seedStoreMonitorState(worker) {
  const now = screenshotNow;
  const planId = "store-monitor-plan";

  await worker.evaluate(({ now, planId }) => chrome.storage.local.set({
    "lumen.watch.plans": [
      {
        id: planId,
        title: "Pricing area monitor",
        host: "lumen-store.test",
        url: "https://lumen-store.test/",
        status: "active",
        selectionMode: "lasso",
        explicitOptIn: true,
        destination: "local",
        runCount: 7,
        lastRunAt: new Date(now - 4 * 60 * 1000).toISOString(),
        createdAt: new Date(now - 74 * 60 * 1000).toISOString(),
        updatedAt: new Date(now - 4 * 60 * 1000).toISOString(),
        region: {
          id: "store-monitor-region",
          kind: "cutaway",
          shape: "lasso",
          left: 260,
          top: 430,
          width: 520,
          height: 220
        },
        schedule: {
          mode: "continuous",
          intervalMinutes: 5,
          maxRuns: 25,
          saveOnlyWhenChanged: true
        }
      }
    ],
    "lumen.watch.runs": [
      {
        id: "store-monitor-run-3",
        watchPlanId: planId,
        captureId: "store-library-timed",
        title: "Pricing area monitor",
        url: "https://lumen-store.test/",
        status: "captured",
        changePercent: 6.4,
        fileCount: 1,
        completedAt: new Date(now - 4 * 60 * 1000).toISOString()
      },
      {
        id: "store-monitor-run-2",
        watchPlanId: planId,
        title: "Pricing area monitor",
        url: "https://lumen-store.test/",
        status: "unchanged",
        changePercent: 0,
        fileCount: 0,
        completedAt: new Date(now - 9 * 60 * 1000).toISOString()
      }
    ]
  }), { now, planId });
}

async function seedExtensionState(worker) {
  await worker.evaluate(() => chrome.storage.sync.set({
    "lumen.capture.settings": {
      removeStickyHeaders: true,
      forceLazyLoad: true,
      autoRedact: true,
      exportManifest: true,
      annotationEnabled: true,
      annotationPosition: "top-right",
      devicePreset: "responsive",
      exportPreset: "browser"
    }
  }));

  await worker.evaluate((now) => chrome.storage.local.set({
    "lumen.capture.privateSettings": {
      annotationText: "Check pricing module before sharing"
    },
    "lumen.capture.history": [
      {
        id: "store-shot-capture",
        title: "Launch capture",
        host: "lumen-store.test",
        url: "https://lumen-store.test/",
        devicePreset: "responsive",
        exportPreset: "browser",
        capturedAt: new Date(now).toISOString(),
        archiveFolder: "Lumen/2026-05-12/store-shot",
        files: [
          "Lumen/2026-05-12/store-shot/desktop-browser.png",
          "Lumen/2026-05-12/store-shot/tablet-browser.png",
          "Lumen/2026-05-12/store-shot/mobile-browser.png",
          "Lumen/2026-05-12/store-shot/context.json"
        ],
        downloads: [
          { downloadId: 210, filename: "Lumen/2026-05-12/store-shot/desktop-browser.png", bytesReceived: 180000, kind: "image", role: "full-page", variantId: "desktop", width: 1440, height: 2600 },
          { downloadId: 211, filename: "Lumen/2026-05-12/store-shot/tablet-browser.png", bytesReceived: 132000, kind: "image", role: "full-page", variantId: "tablet", width: 1024, height: 2400 },
          { downloadId: 212, filename: "Lumen/2026-05-12/store-shot/mobile-browser.png", bytesReceived: 88000, kind: "image", role: "full-page", variantId: "mobile", width: 430, height: 2100 },
          { downloadId: 213, filename: "Lumen/2026-05-12/store-shot/context.json", bytesReceived: 5200, kind: "manifest" }
        ],
        redactionCount: 4,
        manualRedactionCount: 1,
        cutawayCount: 1,
        manifestFile: "Lumen/2026-05-12/store-shot/context.json",
        annotation: { text: "Check pricing module before sharing" },
        annotationRegion: { left: 220, top: 460, width: 520, height: 240 },
        blueprintSummary: {
          siteType: "Landing page",
          heroHeadline: "Evidence page with overlays",
          primaryCta: "Start capture"
        },
        variants: [
          { id: "desktop", label: "Desktop", files: ["desktop-browser.png"], redactionCount: 4, cutawayCount: 1, dimensions: { width: 1440, height: 2600 } },
          { id: "tablet", label: "Tablet", files: ["tablet-browser.png"], redactionCount: 4, cutawayCount: 1, dimensions: { width: 1024, height: 2400 } },
          { id: "mobile", label: "Mobile", files: ["mobile-browser.png"], redactionCount: 3, cutawayCount: 1, dimensions: { width: 430, height: 2100 } }
        ]
      }
    ],
    "lumen.capture.manualRedactions": {
      "https://lumen-store.test/": {
        url: "https://lumen-store.test/",
        host: "lumen-store.test",
        updatedAt: new Date(now).toISOString(),
        regions: [
          { id: "manual-store-1", kind: "manual", left: 300, top: 460, width: 420, height: 110 }
        ]
      }
    },
    "lumen.capture.annotationRegions": {
      "https://lumen-store.test/": {
        url: "https://lumen-store.test/",
        host: "lumen-store.test",
        updatedAt: new Date(now).toISOString(),
        region: { id: "annotation-store-1", kind: "annotation", left: 260, top: 430, width: 520, height: 220 }
      }
    }
  }), screenshotNow);
}

async function prepareExtensionCopy() {
  await cp(repoRoot, extensionDir, {
    recursive: true,
    filter(source) {
      const relative = path.relative(repoRoot, source);
      const parts = relative.split(path.sep);

      return !parts.includes(".git") &&
        !parts.includes("node_modules") &&
        !parts.includes("dist") &&
        !parts.includes("store-assets") &&
      !parts.includes(".DS_Store");
    }
  });

  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = ["https://lumen-store.test/*"];
  manifest.oauth2 = {
    client_id: "123456789-lumen-store-screenshot.apps.googleusercontent.com",
    scopes: ["https://www.googleapis.com/auth/drive.file"]
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function assertPngDimensions(filePath, expectedWidth, expectedHeight) {
  const buffer = await readFile(filePath);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${path.basename(filePath)} should be ${expectedWidth}x${expectedHeight}, got ${width}x${height}.`);
  }
}

async function imageDataUrl(relativePath) {
  const buffer = await readFile(path.join(repoRoot, relativePath));
  return bufferToDataUrl(buffer);
}

function bufferToDataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}
