import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const profileDir = await mkdtemp(path.join(os.tmpdir(), "lumen-extension-smoke-"));
const popupConsoleErrors = [];

let context;

try {
  context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${repoRoot}`,
      `--load-extension=${repoRoot}`
    ]
  });

  let [worker] = context.serviceWorkers();

  if (!worker) {
    worker = await context.waitForEvent("serviceworker", { timeout: 10000 });
  }

  const workerUrl = worker.url();
  const extensionId = new URL(workerUrl).host;
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());

  assert(manifest.manifest_version === 3, "Expected Manifest V3 extension.", manifest);
  assert(manifest.name === "Lumen", "Expected Lumen manifest name.", manifest);
  assert(manifest.background?.service_worker === "background.js", "Expected background service worker.", manifest);
  assert(manifest.action?.default_popup === "popup.html", "Expected popup entrypoint.", manifest);

  const seededCaptureId = "smoke-capture-001";
  await worker.evaluate((captureId) => chrome.storage.local.set({
    "lumen.capture.history": [
      {
        id: captureId,
        title: "Smoke capture",
        host: "example.test",
        url: "https://example.test/",
        devicePreset: "desktop",
        exportPreset: "raw",
        capturedAt: new Date().toISOString(),
        archiveFolder: "Lumen/2026-05-02/smoke-capture",
        files: ["Lumen/2026-05-02/smoke-capture/smoke-desktop-raw.png"],
        downloads: [
          {
            downloadId: 12345,
            filename: "Lumen/2026-05-02/smoke-capture/smoke-desktop-raw.png",
            kind: "image",
            variantId: "desktop"
          }
        ],
        variants: [
          {
            id: "desktop",
            label: "Desktop",
            files: ["Lumen/2026-05-02/smoke-capture/smoke-desktop-raw.png"]
          }
        ]
      }
    ]
  }), seededCaptureId);

  const popup = await context.newPage();
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
  await popup.waitForSelector("[data-history-action='open']", { timeout: 10000 });

  const popupState = await popup.evaluate(() => ({
    title: document.title,
    hasShell: Boolean(document.querySelector(".shell")),
    captureButton: document.querySelector("#captureButton")?.textContent?.trim() || "",
    analyzeButton: document.querySelector("#analyzeButton")?.textContent?.trim() || "",
    statusHidden: document.querySelector("#statusPanel")?.classList.contains("is-hidden") ?? false,
    manualCount: document.querySelector("#manualRedactionCount")?.textContent?.trim() || "",
    historyCount: document.querySelector("#historyCount")?.textContent?.trim() || "",
    historyPath: document.querySelector(".history-path")?.textContent?.trim() || "",
    historyActions: [...document.querySelectorAll("[data-history-action]")].map((button) => ({
      action: button.dataset.historyAction,
      captureId: button.dataset.captureId,
      disabled: button.disabled
    }))
  }));

  assert(popupState.title === "Lumen", "Popup title did not load.", popupState);
  assert(popupState.hasShell, "Popup shell did not render.", popupState);
  assert(popupState.captureButton === "Capture Full Page", "Capture action did not render.", popupState);
  assert(popupState.analyzeButton === "Analyze Page", "Analyze action did not render.", popupState);
  assert(popupState.statusHidden, "Popup status panel should start hidden.", popupState);
  assert(popupState.manualCount === "0 boxes", "Manual redaction counter did not initialize.", popupState);
  assert(popupState.historyCount === "1 item", "Seeded history count did not render.", popupState);
  assert(popupState.historyPath === "Lumen/2026-05-02/smoke-capture", "Archive folder did not render.", popupState);
  assert(
    popupState.historyActions.length === 2 &&
      popupState.historyActions.every((button) => button.captureId === seededCaptureId && !button.disabled),
    "History file actions did not render.",
    popupState
  );
  assert(!popupConsoleErrors.length, "Popup emitted console errors.", popupConsoleErrors);

  const storageState = await worker.evaluate(() =>
    chrome.storage.sync.get("lumen.capture.settings")
  );

  assert(
    Boolean(storageState["lumen.capture.settings"]),
    "Default capture settings were not initialized in sync storage.",
    storageState
  );

  console.log(JSON.stringify({
    ok: true,
    extensionId,
    workerUrl,
    manifest: {
      name: manifest.name,
      version: manifest.version,
      manifestVersion: manifest.manifest_version
    },
    popup: popupState
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
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

function assert(condition, message, details = null) {
  if (condition) {
    return;
  }

  const error = new Error(message);
  error.details = details;
  throw error;
}
