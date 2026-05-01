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

  const popupState = await popup.evaluate(() => ({
    title: document.title,
    hasShell: Boolean(document.querySelector(".shell")),
    captureButton: document.querySelector("#captureButton")?.textContent?.trim() || "",
    analyzeButton: document.querySelector("#analyzeButton")?.textContent?.trim() || "",
    statusHidden: document.querySelector("#statusPanel")?.classList.contains("is-hidden") ?? false,
    manualCount: document.querySelector("#manualRedactionCount")?.textContent?.trim() || ""
  }));

  assert(popupState.title === "Lumen", "Popup title did not load.", popupState);
  assert(popupState.hasShell, "Popup shell did not render.", popupState);
  assert(popupState.captureButton === "Capture Full Page", "Capture action did not render.", popupState);
  assert(popupState.analyzeButton === "Analyze Page", "Analyze action did not render.", popupState);
  assert(popupState.statusHidden, "Popup status panel should start hidden.", popupState);
  assert(popupState.manualCount === "0 boxes", "Manual redaction counter did not initialize.", popupState);
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
