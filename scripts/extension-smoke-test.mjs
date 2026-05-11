import { mkdtemp, rm, stat } from "node:fs/promises";
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
        files: [
          "Lumen/2026-05-02/smoke-capture/smoke-desktop-raw.png",
          "Lumen/2026-05-02/smoke-capture/smoke-bundle-desktop-raw.json"
        ],
        downloads: [
          {
            downloadId: 12345,
            filename: "Lumen/2026-05-02/smoke-capture/smoke-desktop-raw.png",
            bytesReceived: 120000,
            kind: "image",
            variantId: "desktop"
          },
          {
            downloadId: 12346,
            filename: "Lumen/2026-05-02/smoke-capture/smoke-bundle-desktop-raw.json",
            bytesReceived: 4200,
            kind: "manifest"
          }
        ],
        redactionCount: 3,
        manualRedactionCount: 1,
        manifestFile: "Lumen/2026-05-02/smoke-capture/smoke-bundle-desktop-raw.json",
        annotation: {
          text: "Smoke review note"
        },
        blueprintSummary: {
          siteType: "Landing page",
          heroHeadline: "Clean capture evidence",
          primaryCta: "Start review"
        },
        variants: [
          {
            id: "desktop",
            label: "Desktop",
            files: ["Lumen/2026-05-02/smoke-capture/smoke-desktop-raw.png"],
            fileCount: 1,
            redactionCount: 3,
            dimensions: {
              width: 1280,
              height: 2400
            }
          }
        ]
      }
    ]
  }), seededCaptureId);

  await context.route("https://lumen-smoke.test/", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><title>Lumen smoke target</title><h1>Capture-ready page</h1>"
  }));
  const target = await context.newPage();
  await target.goto("https://lumen-smoke.test/", { waitUntil: "domcontentloaded" });
  await target.bringToFront();

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
    launchBlocked: document.querySelector("#launchPanel")?.classList.contains("is-blocked") || false,
    captureButton: document.querySelector("#captureButton strong")?.textContent?.trim() || "",
    captureHint: document.querySelector("#captureButton small")?.textContent?.trim() || "",
    captureDisabled: document.querySelector("#captureButton")?.disabled || false,
    analyzeButton: document.querySelector("#analyzeButton span")?.textContent?.trim() || "",
    analyzeDisabled: document.querySelector("#analyzeButton")?.disabled || false,
    holdMenuHidden: document.querySelector("#holdMenu")?.getAttribute("aria-hidden") || "",
    holdActionCount: document.querySelectorAll("[data-quick-action]").length,
    statusHidden: document.querySelector("#statusPanel")?.classList.contains("is-hidden") ?? false,
    manualCount: document.querySelector("#manualRedactionCount")?.textContent?.trim() || "",
    cutawayStatus: document.querySelector("#cutawayRegionStatus")?.textContent?.trim() || "",
    cutawayClearDisabled: document.querySelector("#clearCutawayButton")?.disabled || false,
    runViewSummary: document.querySelector("#runViewSummary")?.textContent?.trim() || "",
    runExportSummary: document.querySelector("#runExportSummary")?.textContent?.trim() || "",
    runSafetySummary: document.querySelector("#runSafetySummary")?.textContent?.trim() || "",
    exportReviewHidden: document.querySelector("#exportReviewPanel")?.classList.contains("is-hidden") ?? false,
    exportReviewConfirm: document.querySelector("#exportReviewConfirmButton")?.textContent?.trim() || "",
    timelineStepCount: document.querySelectorAll("[data-stage-step]").length,
    statusLogText: document.querySelector("#statusLog")?.textContent?.trim() || "",
    historyCount: document.querySelector("#historyCount")?.textContent?.trim() || "",
    historyPath: document.querySelector(".history-path")?.textContent?.trim() || "",
    historyDetailOpen: Boolean(document.querySelector(".history-item.is-expanded .history-detail")),
    historyDetailMetrics: [...document.querySelectorAll(".history-detail-metric strong")].map((node) => node.textContent?.trim()),
    historyDetailPanels: [...document.querySelectorAll(".history-detail-panel .field-label")].map((node) => node.textContent?.trim()),
    historyActions: [...document.querySelectorAll("[data-history-action]")].map((button) => ({
      action: button.dataset.historyAction,
      captureId: button.dataset.captureId,
      disabled: button.disabled
    }))
  }));

  assert(popupState.title === "Lumen", "Popup title did not load.", popupState);
  assert(popupState.hasShell, "Popup shell did not render.", popupState);
  assert(popupState.launchStatusState === "ready", "Launch status should resolve the latest capturable tab.", popupState);
  assert(popupState.launchStatusTitle === "lumen-smoke.test ready", "Launch status title did not render the target host.", popupState);
  assert(!popupState.launchBlocked, "Launch panel should not block a capturable target tab.", popupState);
  assert(popupState.captureButton === "Capture page", "Capture action did not render.", popupState);
  assert(popupState.captureHint === "Full page capture. Hold for actions.", "Capture hold hint did not render.", popupState);
  assert(!popupState.captureDisabled, "Capture action should be enabled for a capturable target tab.", popupState);
  assert(popupState.analyzeButton === "Analyze Page", "Analyze action did not render.", popupState);
  assert(!popupState.analyzeDisabled, "Analyze action should be enabled for a capturable target tab.", popupState);
  assert(popupState.holdMenuHidden === "true", "Hold menu should start closed.", popupState);
  assert(popupState.holdActionCount === 5, "Hold menu actions did not render.", popupState);
  assert(popupState.statusHidden, "Popup status panel should start hidden.", popupState);
  assert(popupState.manualCount === "0 boxes", "Manual redaction counter did not initialize.", popupState);
  assert(popupState.cutawayStatus === "No region", "Cutaway region status did not initialize.", popupState);
  assert(popupState.cutawayClearDisabled, "Cutaway clear action should start disabled without a region.", popupState);
  assert(popupState.runViewSummary === "Desktop", "Run view summary did not initialize.", popupState);
  assert(popupState.runExportSummary === "Raw", "Run export summary did not initialize.", popupState);
  assert(popupState.runSafetySummary.includes("Cleanup"), "Run safety summary did not initialize.", popupState);
  assert(popupState.exportReviewHidden, "Export review screen should start hidden.", popupState);
  assert(popupState.exportReviewConfirm === "Run export", "Export review confirmation action did not render.", popupState);
  assert(popupState.timelineStepCount === 6, "Capture timeline did not render.", popupState);
  assert(popupState.statusLogText === "No active run yet.", "Status log did not initialize.", popupState);
  assert(popupState.historyCount === "1 item", "Seeded history count did not render.", popupState);
  assert(popupState.historyPath === "Lumen/2026-05-02/smoke-capture", "Archive folder did not render.", popupState);
  assert(popupState.historyDetailOpen, "Latest history detail panel did not open.", popupState);
  assert(popupState.historyDetailMetrics.includes("Saved"), "History detail manifest state did not render.", popupState);
  assert(popupState.historyDetailPanels.includes("Capture views"), "History detail capture views did not render.", popupState);
  assert(popupState.historyDetailPanels.includes("Artifacts"), "History detail artifacts did not render.", popupState);
  assert(popupState.historyDetailPanels.includes("Page signals"), "History detail page signals did not render.", popupState);
  assert(
    popupState.historyActions.length === 4 &&
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

  await target.close();
  await popup.reload({ waitUntil: "load" });
  await popup.waitForSelector("#captureButton", { timeout: 10000 });

  const blockedState = await popup.evaluate(() => ({
    launchStatusState: document.querySelector("#launchStatus")?.dataset.state || "",
    launchStatusTitle: document.querySelector("#launchStatusTitle")?.textContent?.trim() || "",
    launchBlocked: document.querySelector("#launchPanel")?.classList.contains("is-blocked") || false,
    captureDisabled: document.querySelector("#captureButton")?.disabled || false,
    analyzeDisabled: document.querySelector("#analyzeButton")?.disabled || false,
    quickActionsDisabled: [...document.querySelectorAll("[data-quick-action]")].every((button) => button.disabled)
  }));

  assert(blockedState.launchStatusState === "blocked", "Launch status should block restricted or missing target tabs.", blockedState);
  assert(blockedState.launchBlocked, "Launch panel should mark blocked target state.", blockedState);
  assert(blockedState.captureDisabled, "Capture should be disabled without a capturable target tab.", blockedState);
  assert(blockedState.analyzeDisabled, "Analyze should be disabled without a capturable target tab.", blockedState);
  assert(blockedState.quickActionsDisabled, "Quick actions should be disabled without a capturable target tab.", blockedState);

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
  await cleanupTemporaryPath(profileDir, "extension smoke profile");
}

function assert(condition, message, details = null) {
  if (condition) {
    return;
  }

  const error = new Error(message);
  error.details = details;
  throw error;
}

async function cleanupTemporaryPath(targetPath, label) {
  try {
    await rm(targetPath, { recursive: true, force: true });

    if (await pathExists(targetPath)) {
      throw new Error(`${label} still exists after cleanup.`);
    }
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      cleanupFailed: true,
      label,
      path: targetPath,
      message: error.message
    }, null, 2));
    process.exitCode = 1;
  }
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}
