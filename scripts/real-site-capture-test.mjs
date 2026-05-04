import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lumen-real-site-capture-"));
const profileDir = path.join(tempRoot, "profile");
const downloadDir = path.join(tempRoot, "downloads");
const extensionDir = path.join(tempRoot, "extension");
const urls = getTargetUrls();
const popupConsoleErrors = [];
const results = [];
const CAPTURE_TIMEOUT_MS = 90000;

let context;

try {
  await prepareExtensionCopy();
  await prepareChromeProfile();

  context = await chromium.launchPersistentContext(profileDir, {
    acceptDownloads: true,
    downloadsPath: downloadDir,
    headless: false,
    viewport: {
      width: 1366,
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

  for (const url of urls) {
    reportProgress("capture:start", { url });
    results.push(await captureRealPage({ url, popup, worker }));
    reportProgress("capture:done", results.at(-1));
  }

  assert(!popupConsoleErrors.length, "Popup emitted console errors.", popupConsoleErrors);

  console.log(JSON.stringify({
    ok: true,
    checked: results.length,
    results
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    details: error.details || null,
    popupConsoleErrors,
    results
  }, null, 2));
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}

async function captureRealPage({ url, popup, worker }) {
  const page = await context.newPage();

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });
    await page.waitForLoadState("load", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.bringToFront();

    const options = {
      removeStickyHeaders: true,
      forceLazyLoad: true,
      autoRedact: true,
      exportManifest: true,
      annotationEnabled: false,
      annotationText: "",
      annotationPosition: "top-right",
      devicePreset: "desktop",
      exportPreset: "raw"
    };

    const response = await withTimeout(
      popup.evaluate((captureOptions) =>
        chrome.runtime.sendMessage({
          type: "LUMEN_START_CAPTURE",
          payload: {
            options: captureOptions
          }
        }), options),
      CAPTURE_TIMEOUT_MS,
      `Capture timed out after ${Math.round(CAPTURE_TIMEOUT_MS / 1000)} seconds.`
    );

    assert(response?.ok, "Real page capture failed.", {
      url,
      response
    });
    assert(response.files?.length >= 2, "Expected image and manifest downloads.", {
      url,
      response
    });
    assert(response.variantCount === 1, "Real page gate should run one desktop capture per URL.", {
      url,
      response
    });
    assert(response.archiveFolder?.startsWith("Lumen/"), "Expected organized Lumen archive folder.", {
      url,
      response
    });
    assert(response.segmentCount >= 1, "Expected at least one captured segment.", {
      url,
      response
    });

    const downloads = await getDownloadItems(worker, response.downloads || []);
    const imageItem = downloads.find((item) => item.lumenRecord.kind === "image");
    const manifestItem = downloads.find((item) => item.lumenRecord.kind === "manifest");

    assert(downloads.length >= 2, "Expected Chrome download records.", {
      url,
      downloads
    });
    assert(downloads.every((item) => item.state === "complete"), "Expected completed Chrome downloads.", {
      url,
      downloads
    });
    assert(downloads.every((item) => item.bytesReceived > 0), "Expected downloaded bytes.", {
      url,
      downloads
    });
    assert(downloads.every((item) => isInside(downloadDir, item.filename)), "Downloads escaped the temporary directory.", {
      url,
      downloadDir,
      downloads
    });
    assert(imageItem, "Expected an image artifact.", {
      url,
      downloads
    });
    assert(manifestItem, "Expected a manifest artifact.", {
      url,
      downloads
    });

    const imageInfo = await assertPng(imageItem.filename);
    const manifest = JSON.parse(await readFile(manifestItem.filename, "utf8"));
    const expectedHost = new URL(url).host;

    assert(manifest.page.host === expectedHost, "Manifest host did not match target URL.", {
      url,
      manifestPage: manifest.page
    });
    assert(manifest.capture.artifactStats?.complete, "Manifest should mark artifacts complete.", {
      url,
      capture: manifest.capture
    });
    assert(manifest.capture.artifactStats?.imageCount >= 1, "Manifest should count image artifacts.", {
      url,
      capture: manifest.capture
    });
    assert(manifest.variants?.[0]?.dimensions?.width === imageInfo.width, "Manifest width should match PNG width.", {
      url,
      imageInfo,
      variant: manifest.variants?.[0]
    });
    assert(manifest.variants?.[0]?.dimensions?.height === imageInfo.height, "Manifest height should match PNG height.", {
      url,
      imageInfo,
      variant: manifest.variants?.[0]
    });
    assert(manifest.pageSignals, "Expected page signals in the manifest.", {
      url,
      manifest
    });
    assert(!isGenericSignalText(manifest.pageSignals.heroHeadline), "Expected a useful headline signal.", {
      url,
      pageSignals: manifest.pageSignals
    });

    const localState = await worker.evaluate(() =>
      chrome.storage.local.get("lumen.capture.history")
    );
    const history = localState["lumen.capture.history"] || [];
    const latest = history[0] || {};

    assert(latest.archiveFolder === response.archiveFolder, "History did not store latest real page capture.", {
      url,
      latest,
      response
    });

    return {
      ok: true,
      url,
      title: manifest.page.title,
      host: manifest.page.host,
      files: response.files.length,
      archiveFolder: response.archiveFolder,
      segmentCount: response.segmentCount,
      redactionCount: response.redactionCount,
      bytesReceived: manifest.capture.artifactStats.bytesReceived,
      dimensions: imageInfo,
      pageSignals: {
        heroHeadline: manifest.pageSignals.heroHeadline || "",
        primaryCta: manifest.pageSignals.primaryCta || "",
        navCount: manifest.pageSignals.navLabels?.length || 0
      }
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function getDownloadItems(worker, downloadRecords) {
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
    })), downloadRecords.map((item) => item.downloadId));

  return downloadItems
    .map((item, index) => item
      ? {
          ...item,
          lumenRecord: downloadRecords[index]
        }
      : null)
    .filter(Boolean);
}

function getTargetUrls() {
  const fromEnv = process.env.LUMEN_REAL_SITE_URLS
    ?.split(",")
    .map((url) => url.trim())
    .filter(Boolean);

  if (fromEnv?.length) {
    return fromEnv;
  }

  return [
    "https://captainfredric.github.io/lumen-extension/docs/",
    "https://github.com/CaptainFredric/lumen-extension"
  ];
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

  return {
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20),
    size: stats.size
  };
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));

  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isGenericSignalText(text = "") {
  return /^(navigation menu|global navigation|main navigation|site navigation|menu|skip to content)$/i.test(text.trim());
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function reportProgress(stage, details) {
  console.error(JSON.stringify({
    stage,
    ...details
  }));
}

function assert(condition, message, details = null) {
  if (condition) {
    return;
  }

  const error = new Error(message);
  error.details = details;
  throw error;
}
