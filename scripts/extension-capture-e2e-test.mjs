import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lumen-extension-e2e-"));
const profileDir = path.join(tempRoot, "profile");
const downloadDir = path.join(tempRoot, "downloads");
const extensionDir = path.join(tempRoot, "extension");
const popupConsoleErrors = [];

let context;
let server;

try {
  const fixture = await startFixtureServer();
  server = fixture.server;

  await prepareExtensionCopy();
  await prepareChromeProfile();

  context = await chromium.launchPersistentContext(profileDir, {
    acceptDownloads: true,
    downloadsPath: downloadDir,
    headless: false,
    viewport: {
      width: 1280,
      height: 900
    },
    deviceScaleFactor: 1,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`
    ]
  });

  const worker = await getExtensionWorker(context);
  const extensionId = new URL(worker.url()).host;

  const target = await context.newPage();
  await target.goto(fixture.url, { waitUntil: "networkidle" });

  const popup = await context.newPage();
  popup.setDefaultTimeout(120000);
  popup.on("console", (message) => {
    if (message.type() === "error") {
      popupConsoleErrors.push(message.text());
    }
  });
  popup.on("pageerror", (error) => {
    popupConsoleErrors.push(error.message);
  });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
  await popup.waitForSelector("#captureButton", { timeout: 10000 });

  await target.bringToFront();

  const options = {
    removeStickyHeaders: true,
    forceLazyLoad: true,
    autoRedact: true,
    exportManifest: true,
    annotationEnabled: true,
    annotationText: "E2E review artifact",
    annotationPosition: "top-right",
    devicePreset: "desktop",
    exportPreset: "raw"
  };

  const response = await popup.evaluate((captureOptions) =>
    chrome.runtime.sendMessage({
      type: "LUMEN_START_CAPTURE",
      payload: {
        options: captureOptions
      }
    }), options);

  assert(response?.ok, "Loaded extension capture failed.", response);
  assert(response.files?.length >= 2, "Expected image and manifest downloads.", response);
  assert(response.archiveFolder?.startsWith("Lumen/"), "Expected organized Lumen archive folder.", response);
  assert(response.redactionCount >= 3, "Expected automatic redactions from the fixture.", response);
  assert(response.segmentCount >= 2, "Expected full-page capture to stitch multiple segments.", response);
  assert(response.downloads.every((item) => Number.isInteger(item.downloadId)), "Expected Chrome download handles.", response.downloads);
  assert(response.downloads.every((item) => item.bytesReceived > 0), "Expected completed downloads with bytes.", response.downloads);

  const localState = await worker.evaluate(() =>
    chrome.storage.local.get([
      "lumen.capture.history",
      "lumen.inspector.latestBlueprint"
    ])
  );
  const history = localState["lumen.capture.history"] || [];
  const latest = history[0] || null;

  assert(latest?.archiveFolder === response.archiveFolder, "Expected history to store the archive folder.", latest);
  assert(latest?.downloads?.length === response.downloads.length, "Expected history to store download records.", latest);
  assert(latest.redactionCount >= 3, "Expected history redaction count.", latest);
  assert(localState["lumen.inspector.latestBlueprint"]?.identity?.heroHeadline, "Expected latest blueprint to be stored.", localState);

  const downloadItems = await worker.evaluate((downloadIds) =>
    Promise.all(downloadIds.map(async (downloadId) => {
      const [item] = await chrome.downloads.search({ id: downloadId });

      return item
        ? {
            id: item.id,
            state: item.state,
            filename: item.filename,
            bytesReceived: item.bytesReceived,
            error: item.error || ""
          }
        : null;
    })), response.downloads.map((item) => item.downloadId));
  const downloads = downloadItems.map((item, index) => ({
    ...item,
    lumenRecord: response.downloads[index]
  }));

  assert(downloads.every(Boolean), "Expected Chrome download records to exist.", downloads);
  assert(downloads.every((item) => item.state === "complete"), "Expected all downloads to be complete.", downloads);
  assert(downloads.every((item) => isInside(downloadDir, item.filename)), "Downloads escaped the temporary test directory.", {
    downloadDir,
    downloads
  });

  const imageItem = downloads.find((item) => item.lumenRecord.kind === "image");
  const manifestItem = downloads.find((item) => item.lumenRecord.kind === "manifest");

  assert(imageItem, "Expected a PNG capture artifact.", downloads);
  assert(manifestItem, "Expected a JSON bundle manifest.", downloads);

  await assertPng(imageItem.filename);
  const manifest = JSON.parse(await readFile(manifestItem.filename, "utf8"));

  assert(manifest.capture.archiveFolder === response.archiveFolder, "Expected manifest archive folder to match response.", manifest.capture);
  assert(manifest.capture.redactionCount >= 3, "Expected manifest redaction metadata.", manifest.capture);
  assert(manifest.capture.annotation?.text === "E2E review artifact", "Expected manifest annotation metadata.", manifest.capture);
  assert(manifest.pageSignals?.heroHeadline, "Expected page signals in the bundle manifest.", manifest.pageSignals);

  assert(!popupConsoleErrors.length, "Popup emitted console errors.", popupConsoleErrors);

  console.log(JSON.stringify({
    ok: true,
    page: fixture.url,
    archiveFolder: response.archiveFolder,
    files: response.files.length,
    downloads: downloads.map((item) => ({
      kind: item.lumenRecord.kind,
      lumenFilename: item.lumenRecord.filename,
      state: item.state,
      filename: path.relative(downloadDir, item.filename),
      bytesReceived: item.bytesReceived
    })),
    capture: {
      segmentCount: response.segmentCount,
      redactionCount: response.redactionCount,
      manifestFile: response.manifestFile
    },
    history: {
      count: history.length,
      latestTitle: latest.title,
      archiveFolder: latest.archiveFolder
    }
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    details: error.details || null,
    popupConsoleErrors
  }, null, 2));
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}

async function prepareExtensionCopy() {
  await cp(repoRoot, extensionDir, {
    recursive: true,
    filter(source) {
      const relative = path.relative(repoRoot, source);
      const parts = relative.split(path.sep);

      return !parts.includes(".git") &&
        !parts.includes("node_modules") &&
        !parts.some((part) => part.endsWith(".zip"));
    }
  });

  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // The real extension relies on activeTab from the toolbar popup. This test
  // sends the capture message from an extension page, so the temp copy gets
  // explicit coverage permission to exercise captureVisibleTab deterministically.
  manifest.host_permissions = ["<all_urls>"];

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function prepareChromeProfile() {
  await mkdir(path.join(profileDir, "Default"), { recursive: true });
  await mkdir(downloadDir, { recursive: true });
  await writeFile(path.join(profileDir, "Default", "Preferences"), JSON.stringify({
    download: {
      default_directory: downloadDir,
      directory_upgrade: true,
      prompt_for_download: false
    },
    profile: {
      default_content_setting_values: {
        automatic_downloads: 1
      }
    },
    safebrowsing: {
      enabled: true
    }
  }));
}

async function getExtensionWorker(browserContext) {
  let [worker] = browserContext.serviceWorkers();

  if (!worker) {
    worker = await browserContext.waitForEvent("serviceworker", { timeout: 10000 });
  }

  return worker;
}

async function startFixtureServer() {
  const serverInstance = createServer((request, response) => {
    if (request.url === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });
    response.end(buildFixtureHtml());
  });

  await new Promise((resolve) => serverInstance.listen(0, "127.0.0.1", resolve));
  const address = serverInstance.address();

  return {
    server: serverInstance,
    url: `http://127.0.0.1:${address.port}/fixture`
  };
}

function buildFixtureHtml() {
  const svgPixel =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360'%3E%3Crect width='640' height='360' fill='%2319d3c5'/%3E%3Ctext x='48' y='190' font-size='48' fill='%23061218'%3ELumen E2E%3C/text%3E%3C/svg%3E";

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="description" content="A local fixture used to test the Lumen capture workflow." />
        <title>Lumen E2E Fixture</title>
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: #081118;
            color: #e9fbff;
            font-family: ui-sans-serif, system-ui, sans-serif;
          }
          .topbar {
            position: sticky;
            top: 0;
            z-index: 2500;
            display: flex;
            justify-content: space-between;
            padding: 18px 36px;
            background: rgba(8, 17, 24, 0.92);
            border-bottom: 1px solid rgba(255, 255, 255, 0.14);
            backdrop-filter: blur(14px);
          }
          .topbar a { color: inherit; margin-left: 16px; text-decoration: none; }
          main {
            width: min(1040px, calc(100% - 48px));
            margin: 0 auto;
            padding: 96px 0 980px;
          }
          h1 {
            max-width: 760px;
            margin: 0;
            font-size: 74px;
            line-height: 0.92;
            letter-spacing: -0.06em;
          }
          .lede {
            max-width: 620px;
            margin: 24px 0;
            color: #a9bdc7;
            font-size: 20px;
            line-height: 1.55;
          }
          .cta {
            display: inline-flex;
            border-radius: 999px;
            padding: 14px 20px;
            background: #24ddc8;
            color: #051117;
            font-weight: 800;
          }
          .proof {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
            margin-top: 72px;
          }
          .card {
            min-height: 280px;
            padding: 26px;
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 28px;
            background: rgba(255, 255, 255, 0.06);
          }
          .card img {
            width: 100%;
            border-radius: 18px;
          }
          .cookie-banner {
            position: fixed;
            left: 24px;
            right: 24px;
            bottom: 24px;
            z-index: 3200;
            padding: 22px;
            border-radius: 22px;
            background: #ffffff;
            color: #102033;
            box-shadow: 0 22px 80px rgba(0, 0, 0, 0.36);
          }
          .chat-widget {
            position: fixed;
            right: 28px;
            bottom: 130px;
            z-index: 3300;
            width: 72px;
            height: 72px;
            border-radius: 999px;
            background: #24ddc8;
          }
        </style>
      </head>
      <body>
        <header class="topbar">
          <strong>Lumen Fixture</strong>
          <nav>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#docs">Docs</a>
          </nav>
        </header>
        <main>
          <section>
            <p>Browser capture workflow</p>
            <h1>Clean launch evidence for product review.</h1>
            <p class="lede">This page contains sticky UI, lazy media, sensitive text, and enough height to require a stitched capture.</p>
            <a class="cta" href="#start">Start review</a>
          </section>
          <section class="proof">
            <article class="card">
              <h2>Lazy media</h2>
              <img alt="Lazy visual proof" data-src="${svgPixel}" width="640" height="360" />
            </article>
            <article class="card">
              <h2>Review details</h2>
              <p>Owner: qa.audit@example.com</p>
              <p>Phone: +1 (312) 555-0199</p>
              <p>Token: sk_test_51MxYp9X8cA12bnXqPL4v9dAs3rFgH6tZ</p>
            </article>
          </section>
        </main>
        <aside class="cookie-banner">Cookie banner should not be in the final capture.</aside>
        <button class="chat-widget" aria-label="Support chat"></button>
      </body>
    </html>`;
}

async function assertPng(filename) {
  const file = await readFile(filename);
  const signature = file.subarray(0, 8).toString("hex");

  assert(signature === "89504e470d0a1a0a", "Expected a valid PNG file.", {
    filename,
    signature
  });

  const stats = await stat(filename);
  assert(stats.size > 1024, "Expected PNG artifact to contain image data.", {
    filename,
    size: stats.size
  });
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));

  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assert(condition, message, details = null) {
  if (condition) {
    return;
  }

  const error = new Error(message);
  error.details = details;
  throw error;
}
