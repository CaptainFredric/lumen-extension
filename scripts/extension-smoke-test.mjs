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
    launchStatusState: document.querySelector("#launchStatus")?.dataset.state || "",
    launchStatusTitle: document.querySelector("#launchStatusTitle")?.textContent?.trim() || "",
    captureButton: document.querySelector("#captureButton strong")?.textContent?.trim() || "",
    captureHint: document.querySelector("#captureButton small")?.textContent?.trim() || "",
    analyzeButton: document.querySelector("#analyzeButton span")?.textContent?.trim() || "",
    holdMenuHidden: document.querySelector("#holdMenu")?.getAttribute("aria-hidden") || "",
    holdActionCount: document.querySelectorAll("[data-quick-action]").length,
    statusHidden: document.querySelector("#statusPanel")?.classList.contains("is-hidden") ?? false,
    manualCount: document.querySelector("#manualRedactionCount")?.textContent?.trim() || "",
    runViewSummary: document.querySelector("#runViewSummary")?.textContent?.trim() || "",
    runExportSummary: document.querySelector("#runExportSummary")?.textContent?.trim() || "",
    runSafetySummary: document.querySelector("#runSafetySummary")?.textContent?.trim() || "",
    timelineStepCount: document.querySelectorAll("[data-stage-step]").length,
    statusLogText: document.querySelector("#statusLog")?.textContent?.trim() || "",
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
  assert(Boolean(popupState.launchStatusState), "Launch status did not initialize.", popupState);
  assert(Boolean(popupState.launchStatusTitle), "Launch status title did not render.", popupState);
  assert(popupState.captureButton === "Capture page", "Capture action did not render.", popupState);
  assert(popupState.captureHint === "Full page capture. Hold for actions.", "Capture hold hint did not render.", popupState);
  assert(popupState.analyzeButton === "Analyze Page", "Analyze action did not render.", popupState);
  assert(popupState.holdMenuHidden === "true", "Hold menu should start closed.", popupState);
  assert(popupState.holdActionCount === 4, "Hold menu actions did not render.", popupState);
  assert(popupState.statusHidden, "Popup status panel should start hidden.", popupState);
  assert(popupState.manualCount === "0 boxes", "Manual redaction counter did not initialize.", popupState);
  assert(popupState.runViewSummary === "Desktop", "Run view summary did not initialize.", popupState);
  assert(popupState.runExportSummary === "Raw", "Run export summary did not initialize.", popupState);
  assert(popupState.runSafetySummary.includes("Cleanup"), "Run safety summary did not initialize.", popupState);
  assert(popupState.timelineStepCount === 6, "Capture timeline did not render.", popupState);
  assert(popupState.statusLogText === "No active run yet.", "Status log did not initialize.", popupState);
  assert(popupState.historyCount === "1 item", "Seeded history count did not render.", popupState);
  assert(popupState.historyPath === "Lumen/2026-05-02/smoke-capture", "Archive folder did not render.", popupState);
  assert(
    popupState.historyActions.length === 2 &&
      popupState.historyActions.every((button) => button.captureId === seededCaptureId && !button.disabled),
    "History file actions did not render.",
    popupState
  );
  assert(!popupConsoleErrors.length, "Popup emitted console errors.", popupConsoleErrors);

  await popup.dispatchEvent("#captureButton", "pointerdown", {
    button: 0,
    pointerId: 1,
    pointerType: "mouse"
  });
  await popup.waitForTimeout(650);

  const holdState = await popup.evaluate(() => ({
    menuOpen: document.querySelector("#launchPanel")?.classList.contains("is-menu-open") || false,
    ariaHidden: document.querySelector("#holdMenu")?.getAttribute("aria-hidden") || "",
    expanded: document.querySelector("#captureButton")?.getAttribute("aria-expanded") || "",
    statusTitle: document.querySelector("#launchStatusTitle")?.textContent?.trim() || ""
  }));

  assert(holdState.menuOpen, "Holding capture did not open the quick action menu.", holdState);
  assert(holdState.ariaHidden === "false", "Hold menu aria state did not open.", holdState);
  assert(holdState.expanded === "true", "Capture button aria state did not expand.", holdState);
  assert(holdState.statusTitle === "Hold menu ready", "Launch status did not reflect hold menu state.", holdState);

  await popup.dispatchEvent("#captureButton", "pointerup", {
    button: 0,
    pointerId: 1,
    pointerType: "mouse"
  });

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
