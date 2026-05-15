import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "store-assets", "screenshots");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lumen-store-shots-"));
const extensionDir = path.join(tempRoot, "extension");
const profileDir = path.join(tempRoot, "profile");
const shotSize = {
  width: 1280,
  height: 800
};

const proofAssets = {
  desktop: await imageDataUrl("docs/assets/proof-run-desktop.png"),
  tablet: await imageDataUrl("docs/assets/proof-run-tablet.png"),
  mobile: await imageDataUrl("docs/assets/proof-run-mobile.png"),
  redacted: await imageDataUrl("docs/assets/proof-run-redacted.png"),
  signals: await imageDataUrl("docs/assets/proof-run-signals.png"),
  history: await imageDataUrl("docs/assets/proof-run-history.png")
};

const screenshots = [];
let extensionContext;
let renderBrowser;

try {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const popupShots = await captureExtensionPopupShots();
  renderBrowser = await chromium.launch();
  const page = await renderBrowser.newPage({
    viewport: shotSize,
    deviceScaleFactor: 1
  });

  await renderStoreShot(page, "01-extension-control-surface.png", buildControlSurfaceShot(popupShots.default));
  await renderStoreShot(page, "02-hold-actions-and-review.png", buildHoldActionShot(popupShots.holdMenu));
  await renderStoreShot(page, "03-responsive-capture-set.png", buildResponsiveSetShot());
  await renderStoreShot(page, "04-redaction-and-callout-review.png", buildRedactionShot());
  await renderStoreShot(page, "05-signals-and-local-history.png", buildSignalsShot());

  await page.close();

  for (const filePath of screenshots) {
    await assertPngDimensions(filePath, shotSize.width, shotSize.height);
  }

  console.log(JSON.stringify({
    ok: true,
    outputDir,
    count: screenshots.length,
    screenshots: screenshots.map((filePath) => path.relative(repoRoot, filePath))
  }, null, 2));
} finally {
  await extensionContext?.close().catch(() => {});
  await renderBrowser?.close().catch(() => {});
  await rm(tempRoot, { recursive: true, force: true });
}

async function captureExtensionPopupShots() {
  await prepareExtensionCopy();

  extensionContext = await chromium.launchPersistentContext(profileDir, {
    headless: false,
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
  const defaultShot = await popup.screenshot({ type: "png" });

  await popup.dispatchEvent("#captureButton", "pointerdown", {
    button: 0,
    pointerId: 1,
    pointerType: "mouse"
  });
  await popup.waitForTimeout(700);
  const holdShot = await popup.screenshot({ type: "png" });

  await popup.close();
  await target.close();

  return {
    default: bufferToDataUrl(defaultShot),
    holdMenu: bufferToDataUrl(holdShot)
  };
}

async function renderStoreShot(page, filename, bodyHtml) {
  const filePath = path.join(outputDir, filename);
  await page.setContent(buildStoreShell(bodyHtml), { waitUntil: "load" });
  await page.screenshot({
    path: filePath,
    fullPage: false
  });
  screenshots.push(filePath);
}

function buildControlSurfaceShot(popupImage) {
  return `
    <section class="hero-grid">
      <div class="copy">
        <p class="eyebrow">Lumen browser capture workflow</p>
        <h1>Clean, responsive, safer evidence from any webpage.</h1>
        <p class="lede">Capture the page, clean hostile overlays, review sensitive regions, and save a useful bundle instead of a dead screenshot.</p>
        <div class="cta-row"><span>Full-page capture</span><span>Responsive set</span><span>Review before export</span></div>
      </div>
      <div class="phone-frame">
        <img src="${popupImage}" alt="Lumen extension popup" />
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
        <p class="eyebrow">Quick actions during review</p>
        <h2>Hold the capture button to move faster.</h2>
        <p>Run the exact review step you need: scan redactions, prepare export review, mark a cutaway, or add a callout region.</p>
        <div class="metric-grid">
          <article><strong>6</strong><span>quick actions</span></article>
          <article><strong>1</strong><span>callout region</span></article>
          <article><strong>0</strong><span>silent handoffs</span></article>
        </div>
      </div>
    </section>
  `;
}

function buildResponsiveSetShot() {
  return `
    <section class="output-shot">
      <div class="shot-head">
        <p class="eyebrow">Current output</p>
        <h2>One run can export desktop, tablet, and mobile evidence.</h2>
      </div>
      <div class="device-grid">
        <figure class="browser-card wide"><img src="${proofAssets.desktop}" alt="Desktop capture output" /><figcaption>Desktop full page</figcaption></figure>
        <figure class="browser-card"><img src="${proofAssets.tablet}" alt="Tablet capture output" /><figcaption>Tablet</figcaption></figure>
        <figure class="browser-card phone"><img src="${proofAssets.mobile}" alt="Mobile capture output" /><figcaption>Mobile</figcaption></figure>
      </div>
    </section>
  `;
}

function buildRedactionShot() {
  return `
    <section class="proof-grid-shot">
      <div class="shot-head">
        <p class="eyebrow">Redaction and annotation review</p>
        <h2>Clean the page first, then mark what needs attention.</h2>
        <p>Current redaction covers visible text and filled inputs during export and should be reviewed before external sharing.</p>
      </div>
      <div class="proof-pair">
        <figure class="browser-card redaction"><img src="${proofAssets.redacted}" alt="Redacted capture output" /><figcaption>Redacted export</figcaption></figure>
        <div class="artifact-card">
          <span class="status-pill">Implemented now</span>
          <h3>Review artifact</h3>
          <ul>
            <li>Auto-redactions applied</li>
            <li>Manual boxes can be drawn before export</li>
            <li>Cutaway and callout regions resolve by page anchor</li>
            <li>Agent or watch features require explicit opt-in</li>
          </ul>
        </div>
      </div>
    </section>
  `;
}

function buildSignalsShot() {
  return `
    <section class="proof-grid-shot">
      <div class="shot-head">
        <p class="eyebrow">Signals and local history</p>
        <h2>The screenshot ships with context.</h2>
        <p>Each run can include files, dimensions, redaction counts, page signals, and a local history entry for later review.</p>
      </div>
      <div class="proof-pair">
        <figure class="browser-card"><img src="${proofAssets.signals}" alt="Extracted page signals" /><figcaption>Signals JSON</figcaption></figure>
        <figure class="browser-card"><img src="${proofAssets.history}" alt="Local capture history" /><figcaption>Local history item</figcaption></figure>
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
          .proof-grid-shot {
            position: relative;
            display: grid;
            height: 100%;
            gap: 34px;
            align-items: center;
          }
          .hero-grid { grid-template-columns: 1fr 430px; }
          .split-grid { grid-template-columns: 430px 1fr; }
          .output-shot,
          .proof-grid-shot { align-content: center; }
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
          .proof-pair {
            display: grid;
            grid-template-columns: 1.15fr 0.85fr;
            gap: 22px;
            align-items: stretch;
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

async function seedExtensionState(worker) {
  await worker.evaluate(() => chrome.storage.sync.set({
    "lumen.capture.settings": {
      removeStickyHeaders: true,
      forceLazyLoad: true,
      autoRedact: true,
      exportManifest: true,
      annotationEnabled: true,
      annotationText: "Check pricing module before sharing",
      annotationPosition: "top-right",
      devicePreset: "responsive",
      exportPreset: "browser"
    }
  }));

  await worker.evaluate(() => chrome.storage.local.set({
    "lumen.capture.history": [
      {
        id: "store-shot-capture",
        title: "Launch review capture",
        host: "lumen-store.test",
        url: "https://lumen-store.test/",
        devicePreset: "responsive",
        exportPreset: "browser",
        capturedAt: new Date().toISOString(),
        archiveFolder: "Lumen/2026-05-12/store-shot",
        files: [
          "Lumen/2026-05-12/store-shot/desktop-browser.png",
          "Lumen/2026-05-12/store-shot/tablet-browser.png",
          "Lumen/2026-05-12/store-shot/mobile-browser.png",
          "Lumen/2026-05-12/store-shot/bundle.json"
        ],
        downloads: [
          { downloadId: 210, filename: "Lumen/2026-05-12/store-shot/desktop-browser.png", bytesReceived: 180000, kind: "image", role: "full-page", variantId: "desktop", width: 1440, height: 2600 },
          { downloadId: 211, filename: "Lumen/2026-05-12/store-shot/tablet-browser.png", bytesReceived: 132000, kind: "image", role: "full-page", variantId: "tablet", width: 1024, height: 2400 },
          { downloadId: 212, filename: "Lumen/2026-05-12/store-shot/mobile-browser.png", bytesReceived: 88000, kind: "image", role: "full-page", variantId: "mobile", width: 430, height: 2100 },
          { downloadId: 213, filename: "Lumen/2026-05-12/store-shot/bundle.json", bytesReceived: 5200, kind: "manifest" }
        ],
        redactionCount: 4,
        manualRedactionCount: 1,
        cutawayCount: 1,
        manifestFile: "Lumen/2026-05-12/store-shot/bundle.json",
        annotation: { text: "Check pricing module before sharing" },
        annotationRegion: { left: 220, top: 460, width: 520, height: 240 },
        blueprintSummary: {
          siteType: "Landing page",
          heroHeadline: "Evidence page with overlays",
          primaryCta: "Start review"
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
        updatedAt: new Date().toISOString(),
        regions: [
          { id: "manual-store-1", kind: "manual", left: 300, top: 460, width: 420, height: 110 }
        ]
      }
    },
    "lumen.capture.annotationRegions": {
      "https://lumen-store.test/": {
        url: "https://lumen-store.test/",
        host: "lumen-store.test",
        updatedAt: new Date().toISOString(),
        region: { id: "annotation-store-1", kind: "annotation", left: 260, top: 430, width: 520, height: 220 }
      }
    }
  }));
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
