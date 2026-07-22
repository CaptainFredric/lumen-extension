import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lumen-extension-smoke-"));
const extensionDir = path.join(tempRoot, "extension");
const profileDir = path.join(tempRoot, "profile");
const popupConsoleErrors = [];

let context;

try {
  await prepareExtensionCopy();

  context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`
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
          "Lumen/2026-05-02/smoke-capture/smoke-desktop-raw-cutaway.png",
          "Lumen/2026-05-02/smoke-capture/smoke-desktop-raw-print-sheet.html",
          "Lumen/2026-05-02/smoke-capture/smoke-bundle-desktop-raw.json"
        ],
        downloads: [
          {
            downloadId: 12345,
            filename: "Lumen/2026-05-02/smoke-capture/smoke-desktop-raw.png",
            bytesReceived: 120000,
            kind: "image",
            role: "full-page",
            variantId: "desktop",
            width: 1280,
            height: 2400
          },
          {
            downloadId: 12347,
            filename: "Lumen/2026-05-02/smoke-capture/smoke-desktop-raw-cutaway.png",
            bytesReceived: 46000,
            kind: "image",
            role: "cutaway",
            variantId: "desktop",
            width: 640,
            height: 320,
            cutawayRegion: {
              left: 220,
              top: 480,
              width: 640,
              height: 320,
              projection: "direct"
            }
          },
          {
            downloadId: 12348,
            filename: "Lumen/2026-05-02/smoke-capture/smoke-desktop-raw-print-sheet.html",
            bytesReceived: 9400,
            kind: "html",
            role: "print-sheet",
            variantId: "desktop",
            width: 1280,
            height: 2400
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
        cutawayCount: 1,
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
            cutawayCount: 1,
            dimensions: {
              width: 1280,
              height: 2400
            }
          }
        ]
      }
    ],
    "lumen.watch.runs": [
      {
        id: "watch-run-smoke-captured",
        watchPlanId: "watch-plan-smoke",
        captureId,
        title: "Pricing area watch",
        url: "https://example.test/pricing",
        host: "example.test",
        status: "captured",
        scheduledAt: "2026-05-02T14:00:00.000Z",
        startedAt: "2026-05-02T14:00:10.000Z",
        completedAt: "2026-05-02T14:00:22.000Z",
        fileCount: 3,
        files: [
          "Lumen/2026-05-02/smoke-capture/smoke-desktop-raw.png",
          "Lumen/2026-05-02/smoke-capture/smoke-desktop-raw-cutaway.png",
          "Lumen/2026-05-02/smoke-capture/smoke-desktop-raw-print-sheet.html",
          "Lumen/2026-05-02/smoke-capture/smoke-bundle-desktop-raw.json"
        ]
      },
      {
        id: "watch-run-smoke-failed",
        watchPlanId: "watch-plan-smoke",
        title: "Hero area watch",
        url: "https://example.test/hero",
        host: "example.test",
        status: "failed",
        scheduledAt: "2026-05-02T15:00:00.000Z",
        completedAt: "2026-05-02T15:00:04.000Z",
        fileCount: 0,
        files: [],
        error: "Site access expired."
      }
    ]
  }), seededCaptureId);

  const librarySeedPage = await context.newPage();
  await librarySeedPage.goto(`chrome-extension://${extensionId}/library.html`, { waitUntil: "load" });
  await librarySeedPage.evaluate(async (captureId) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    await store.putLibraryCapture({
      id: captureId,
      title: "Smoke capture",
      host: "example.test",
      url: "https://example.test/",
      capturedAt: new Date().toISOString(),
      sourceType: "manual",
      devicePreset: "desktop",
      exportPreset: "raw",
      archiveFolder: "Lumen/2026-05-02/smoke-capture",
      downloads: [{
        downloadId: 12345,
        filename: "Lumen/2026-05-02/smoke-capture/smoke-desktop-raw.png",
        kind: "image",
        role: "full-page",
        variantId: "desktop",
        width: 1280,
        height: 2400
      }],
      previews: [{
        dataUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='360' height='240'%3E%3Crect width='360' height='240' fill='%2364f2df'/%3E%3C/svg%3E",
        width: 360,
        height: 240,
        role: "full-page",
        variantId: "desktop"
      }],
      editorSource: {
        dataUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='720' height='1200'%3E%3Crect width='720' height='1200' fill='%230b1b2d'/%3E%3Crect x='80' y='860' width='560' height='220' fill='%2364f2df'/%3E%3C/svg%3E",
        width: 720,
        height: 1200,
        originalWidth: 720,
        originalHeight: 1200,
        scaled: false,
        kind: "lossless-full-output",
        role: "full-page",
        variantId: "desktop"
      }
    });
  }, seededCaptureId);

  const storedEditorSource = await librarySeedPage.evaluate(async (captureId) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    const capture = await store.getLibraryCapture(captureId, {
      includePreview: true,
      includeEditorSource: true
    });
    const dedicatedEditorSource = await store.getLibraryEditorAsset(captureId);

    return {
      previewWidth: capture?.preview?.width || 0,
      previewHeight: capture?.preview?.height || 0,
      editorWidth: capture?.editorSource?.width || 0,
      editorHeight: capture?.editorSource?.height || 0,
      editorPurpose: capture?.editorSource?.purpose || "",
      editorBytes: capture?.editorSource?.blob?.size || 0,
      dedicatedEditorAssetId: dedicatedEditorSource?.id || ""
    };
  }, seededCaptureId);
  assert(
    storedEditorSource.previewWidth === 360 &&
      storedEditorSource.previewHeight === 240 &&
      storedEditorSource.editorWidth === 720 &&
      storedEditorSource.editorHeight === 1200 &&
      storedEditorSource.editorPurpose === "editor-source" &&
      storedEditorSource.editorBytes > 0 &&
      Boolean(storedEditorSource.dedicatedEditorAssetId),
    "The local library did not preserve a distinct whole-image editor source.",
    storedEditorSource
  );

  const libraryIntegrity = await librarySeedPage.evaluate(async (captureId) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("lumen.capture.library");
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error), { once: true });
    });
    const foreignAssetId = "foreign-preview-asset";
    const foreignBlob = new Blob([
      "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'></svg>"
    ], { type: "image/svg+xml" });
    const changeForeignAsset = (action) => new Promise((resolve, reject) => {
      const transaction = database.transaction("assets", "readwrite");
      const assetStore = transaction.objectStore("assets");

      if (action === "put") {
        assetStore.put({
          id: foreignAssetId,
          captureId: "different-capture",
          purpose: "preview",
          role: "full-page",
          variantId: "foreign",
          mime: foreignBlob.type,
          width: 10,
          height: 10,
          byteLength: foreignBlob.size,
          blob: foreignBlob,
          createdAt: new Date().toISOString()
        });
      } else {
        assetStore.delete(foreignAssetId);
      }

      transaction.addEventListener("complete", resolve, { once: true });
      transaction.addEventListener("error", () => reject(transaction.error), { once: true });
      transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
    });

    await changeForeignAsset("put");
    const crossCapture = await store.getLibraryCapture(captureId, {
      includePreview: true,
      assetId: foreignAssetId
    });
    await changeForeignAsset("delete");
    database.close();
    const ownCapture = await store.getLibraryCapture(captureId, { includePreview: true });
    const crossPurpose = await store.getLibraryCapture(captureId, {
      includePreview: true,
      assetId: ownCapture?.editorAssetId || ""
    });

    return {
      crossCapturePreviewRejected: crossCapture?.preview === null,
      crossPurposePreviewRejected: crossPurpose?.preview === null,
      ownCapturePreviewAvailable: Boolean(ownCapture?.preview?.blob),
      previewMetadataAvailable: store.hasLibraryPreview(ownCapture)
    };
  }, seededCaptureId);
  assert(
    libraryIntegrity.crossCapturePreviewRejected &&
      libraryIntegrity.crossPurposePreviewRejected &&
      libraryIntegrity.ownCapturePreviewAvailable &&
      libraryIntegrity.previewMetadataAvailable,
    "The local library did not enforce capture and purpose integrity for preview assets.",
    libraryIntegrity
  );

  const unavailableCaptureId = "smoke-capture-without-preview";
  await librarySeedPage.evaluate(async (captureId) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    await store.putLibraryCapture({
      id: captureId,
      title: "Unavailable preview capture",
      host: "example.test",
      url: "https://example.test/unavailable",
      capturedAt: new Date().toISOString(),
      sourceType: "manual"
    });
  }, unavailableCaptureId);
  await librarySeedPage.reload({ waitUntil: "load" });
  await librarySeedPage.waitForSelector(`.capture-card[data-capture-id="${unavailableCaptureId}"]`);
  const unavailableToolState = await librarySeedPage.evaluate((captureId) => {
    const card = document.querySelector(`.capture-card[data-capture-id="${captureId}"]`);
    const annotate = card?.querySelector(".edit-action");
    const compare = card?.querySelector(".review-action");
    return {
      annotateDisabled: annotate?.disabled,
      compareDisabled: compare?.disabled,
      annotateLabel: annotate?.getAttribute("aria-label") || "",
      compareLabel: compare?.getAttribute("aria-label") || ""
    };
  }, unavailableCaptureId);
  assert(
    unavailableToolState.annotateDisabled &&
      unavailableToolState.compareDisabled &&
      unavailableToolState.annotateLabel.includes("unavailable") &&
      unavailableToolState.compareLabel.includes("unavailable"),
    "Unavailable local images should disable annotation and comparison actions.",
    unavailableToolState
  );
  await librarySeedPage.evaluate(async (captureId) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    await store.deleteLibraryCapture(captureId);
  }, unavailableCaptureId);

  const editorOnlyCaptureId = "smoke-capture-editor-source-only";
  await librarySeedPage.evaluate(async (captureId) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    await store.putLibraryCapture({
      id: captureId,
      title: "Whole-image source only",
      host: "example.test",
      url: "https://example.test/editor-source",
      capturedAt: new Date().toISOString(),
      sourceType: "manual",
      editorSource: {
        dataUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='360' height='600'%3E%3Crect width='360' height='600' fill='%230b1b2d'/%3E%3C/svg%3E",
        width: 360,
        height: 600,
        originalWidth: 360,
        originalHeight: 600,
        role: "full-page",
        variantId: "desktop"
      }
    });
  }, editorOnlyCaptureId);
  await librarySeedPage.reload({ waitUntil: "load" });
  await librarySeedPage.waitForSelector(`.capture-card[data-capture-id="${editorOnlyCaptureId}"]`);
  const editorOnlyToolState = await librarySeedPage.evaluate((captureId) => {
    const card = document.querySelector(`.capture-card[data-capture-id="${captureId}"]`);
    return {
      annotateDisabled: card?.querySelector(".edit-action")?.disabled,
      compareDisabled: card?.querySelector(".review-action")?.disabled
    };
  }, editorOnlyCaptureId);
  assert(
    !editorOnlyToolState.annotateDisabled && !editorOnlyToolState.compareDisabled,
    "The whole-image review source should keep annotation and comparison available without a gallery preview.",
    editorOnlyToolState
  );
  await librarySeedPage.evaluate(async (captureId) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    await store.deleteLibraryCapture(captureId);
  }, editorOnlyCaptureId);
  await librarySeedPage.close();

  const editorPage = await context.newPage();
  editorPage.on("console", (message) => {
    if (message.type() === "error") {
      popupConsoleErrors.push(`editor: ${message.text()}`);
    }
  });
  editorPage.on("pageerror", (error) => popupConsoleErrors.push(`editor: ${error.message}`));
  await editorPage.setViewportSize({ width: 920, height: 820 });
  await editorPage.goto(`chrome-extension://${extensionId}/editor.html?capture=${encodeURIComponent(seededCaptureId)}`, { waitUntil: "load" });
  await editorPage.waitForSelector("#canvasFrame:not(.is-hidden)", { timeout: 10000 });
  const loadedEditor = await editorPage.evaluate(() => ({
    metadata: globalThis.LumenAnnotationEditor?.getMetadata?.(),
    toolNames: [...document.querySelectorAll("button[data-tool]")].map((button) => button.getAttribute("aria-label")),
    driveActionCount: document.querySelectorAll("[data-lumen-export-actions] button").length
  }));
  assert(
    loadedEditor.metadata?.width === 720 &&
      loadedEditor.metadata?.height === 1200 &&
      loadedEditor.metadata?.sourceOrigin === "library-editor-source",
    "Annotation Studio loaded the cropped preview instead of the stored whole-image source.",
    loadedEditor
  );
  assert(
    loadedEditor.toolNames.every((name) => /tool$/.test(name || "")),
    "Compact editor tools lost their accessible names.",
    loadedEditor.toolNames
  );
  assert(loadedEditor.driveActionCount === 0, "Unconfigured Drive controls should stay hidden.", loadedEditor);
  await editorPage.keyboard.press("a");
  await editorPage.keyboard.press("Enter");
  await editorPage.keyboard.press("]");
  const keyboardEditor = await editorPage.evaluate(() => ({
    annotationCount: globalThis.LumenAnnotationEditor?.getAnnotationCount?.(),
    status: document.querySelector("#statusMessage")?.textContent?.trim() || "",
    canvasFocused: document.activeElement === document.querySelector("#editorCanvas")
  }));
  assert(
    keyboardEditor.annotationCount === 1 && keyboardEditor.canvasFocused && /selected/i.test(keyboardEditor.status),
    "Keyboard-only creation and selection did not complete in Annotation Studio.",
    keyboardEditor
  );
  await editorPage.close();

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
  await popup.waitForSelector("#photoLibraryGrid img:not(.is-hidden)", { timeout: 10000 });

  const popupState = await popup.evaluate(() => ({
    title: document.title,
    hasShell: Boolean(document.querySelector(".shell")),
    launchStatusState: document.querySelector("#launchStatus")?.dataset.state || "",
    launchStatusTitle: document.querySelector("#launchStatusTitle")?.textContent?.trim() || "",
    launchBlocked: document.querySelector("#launchPanel")?.classList.contains("is-blocked") || false,
    captureButton: document.querySelector("#captureButton strong")?.textContent?.trim() || "",
    captureHint: document.querySelector("#captureButton small")?.textContent?.trim() || "",
    captureDisabled: document.querySelector("#captureButton")?.disabled || false,
    captureOptionsLabel: document.querySelector("#captureOptionsButton")?.getAttribute("aria-label") || "",
    captureOptionsExpanded: document.querySelector("#captureOptionsButton")?.getAttribute("aria-expanded") || "",
    captureOptionsDisabled: document.querySelector("#captureOptionsButton")?.disabled || false,
    analyzeButton: document.querySelector("#analyzeButton .action-label")?.textContent?.trim() || "",
    analyzeDisabled: document.querySelector("#analyzeButton")?.disabled || false,
    holdMenuHidden: document.querySelector("#holdMenu")?.getAttribute("aria-hidden") || "",
    holdActionCount: document.querySelectorAll("[data-quick-action]").length,
    captureReceiptHidden: document.querySelector("#captureReceipt")?.classList.contains("is-hidden") ?? false,
    captureReceiptCaptureId: document.querySelector("#captureReceipt")?.dataset.captureId || "",
    receiptActions: [...document.querySelectorAll("#captureReceipt [data-receipt-action]")].map((button) => ({
      action: button.dataset.receiptAction,
      label: button.textContent?.trim() || ""
    })),
    statusHidden: document.querySelector("#statusPanel")?.classList.contains("is-hidden") ?? false,
    manualCount: document.querySelector("#manualRedactionCount")?.textContent?.trim() || "",
    autoRedactDisabled: document.querySelector("#autoRedact")?.disabled || false,
    cutawayStatus: document.querySelector("#cutawayRegionStatus")?.textContent?.trim() || "",
    cutawayClearDisabled: document.querySelector("#clearCutawayButton")?.disabled || false,
    watchCardHidden: document.querySelector("#watchPlanCard")?.classList.contains("is-hidden") ?? false,
    runWatchNowDisabled: document.querySelector("#runWatchPlanNowButton")?.disabled || false,
    toggleWatchDisabled: document.querySelector("#toggleWatchPlanButton")?.disabled || false,
    deleteWatchDisabled: document.querySelector("#deleteWatchPlanButton")?.disabled || false,
    watchMode: document.querySelector("#watchModeSelect")?.value || "",
    watchDelayVisible: !document.querySelector("#watchDelayField")?.classList.contains("is-hidden"),
    watchContinuousHidden: document.querySelector("#watchContinuousIntervalField")?.classList.contains("is-hidden") || false,
    annotationStatus: document.querySelector("#annotationRegionStatus")?.textContent?.trim() || "",
    annotationClearDisabled: document.querySelector("#clearAnnotationButton")?.disabled || false,
    runViewSummary: document.querySelector("#runViewSummary")?.textContent?.trim() || "",
    runExportSummary: document.querySelector("#runExportSummary")?.textContent?.trim() || "",
    runSafetySummary: document.querySelector("#runSafetySummary")?.textContent?.trim() || "",
    accountPlan: document.querySelector("#accountPlan")?.textContent?.trim() || "",
    dataControlsSummary: document.querySelector("#dataControlsSummary")?.textContent?.trim() || "",
    retentionDisabled: document.querySelector("#retentionSelect")?.disabled || false,
    retentionValue: document.querySelector("#retentionSelect")?.value || "",
    cloudSyncDisabled: document.querySelector("#cloudSyncEnabled")?.disabled || false,
    deleteBackendDataDisabled: document.querySelector("#deleteBackendDataButton")?.disabled || false,
    lockedFeatureCount: document.querySelectorAll("[data-pro-feature].is-locked").length,
    disabledResponsiveModes: [...document.querySelectorAll("[data-device]:disabled")].map((button) => button.dataset.device),
    disabledPosterModes: [...document.querySelectorAll("[data-export]:disabled")].map((button) => button.dataset.export),
    exportReviewHidden: document.querySelector("#exportReviewPanel")?.classList.contains("is-hidden") ?? false,
    exportReviewConfirm: document.querySelector("#exportReviewConfirmButton")?.textContent?.trim() || "",
    timelineStepCount: document.querySelectorAll("[data-stage-step]").length,
    statusLogText: document.querySelector("#statusLog")?.textContent?.trim() || "",
    historyCount: document.querySelector("#historyCount")?.textContent?.trim() || "",
    historyPath: document.querySelector(".history-path")?.textContent?.trim() || "",
    historyDetailOpen: Boolean(document.querySelector(".history-item.is-expanded .history-detail")),
    historyDetailMetrics: [...document.querySelectorAll(".history-detail-metric strong")].map((node) => node.textContent?.trim()),
    historyDetailPanels: [...document.querySelectorAll(".history-detail-panel .field-label")].map((node) => node.textContent?.trim()),
    historyArtifactFilters: [...document.querySelectorAll("[data-history-artifact-filter]")].map((button) => button.textContent?.trim()),
    historyArtifactRows: [...document.querySelectorAll("[data-artifact-type]")].map((row) => row.dataset.artifactType),
    historyCutawayPreview: Boolean(document.querySelector(".history-cutaway-preview")),
    shelfCount: document.querySelector("#captureShelfCount")?.textContent?.trim() || "",
    shelfCards: document.querySelectorAll(".capture-shelf-card").length,
    shelfKinds: [...document.querySelectorAll(".capture-shelf-card")].map((card) => card.dataset.kind),
    shelfBadges: [...document.querySelectorAll(".capture-shelf-badge")].map((badge) => badge.textContent?.trim()),
    shelfActions: [...document.querySelectorAll("#captureShelfGrid [data-history-action]")].map((button) => ({
      action: button.dataset.historyAction,
      captureId: button.dataset.captureId,
      watchRunId: button.dataset.watchRunId,
      disabled: button.disabled,
      text: button.textContent?.trim()
    })),
    historyActions: [...document.querySelectorAll("#historyList [data-history-action]")].map((button) => ({
      action: button.dataset.historyAction,
      captureId: button.dataset.captureId,
      disabled: button.disabled
    })),
    photoLibraryCount: document.querySelector("#photoLibraryCount")?.textContent?.trim() || "",
    photoLibraryCards: document.querySelectorAll("#photoLibraryGrid .photo-library-card").length,
    photoLibraryImages: document.querySelectorAll("#photoLibraryGrid img:not(.is-hidden)").length,
    photoLibraryOpenLabel: document.querySelector("#openPhotoLibraryButton")?.textContent?.trim() || ""
  }));

  assert(popupState.title === "Lumen", "Popup title did not load.", popupState);
  assert(popupState.hasShell, "Popup shell did not render.", popupState);
  assert(popupState.launchStatusState === "ready", "Launch status should resolve the latest capturable tab.", popupState);
  assert(popupState.launchStatusTitle === "lumen-smoke.test ready", "Launch status title did not render the target host.", popupState);
  assert(!popupState.launchBlocked, "Launch panel should not block a capturable target tab.", popupState);
  assert(popupState.captureButton === "Capture page", "Capture action did not render.", popupState);
  assert(popupState.captureHint === "Click once", "One-click capture hint did not render.", popupState);
  assert(!popupState.captureDisabled, "Capture action should be enabled for a capturable target tab.", popupState);
  assert(popupState.captureOptionsLabel === "Capture options", "Capture options control needs an accessible label.", popupState);
  assert(popupState.captureOptionsExpanded === "false", "Capture options control should start collapsed.", popupState);
  assert(!popupState.captureOptionsDisabled, "Capture options should be available for a capturable target tab.", popupState);
  assert(popupState.analyzeButton === "Analyze page", "Analyze action did not render.", popupState);
  assert(!popupState.analyzeDisabled, "Analyze action should be enabled for a capturable target tab.", popupState);
  assert(popupState.holdMenuHidden === "true", "Hold menu should start closed.", popupState);
  assert(popupState.holdActionCount === 8, "Hold menu actions did not render.", popupState);
  assert(popupState.captureReceiptHidden, "Capture receipt should stay hidden until a real capture succeeds.", popupState);
  assert(!popupState.captureReceiptCaptureId, "Hidden capture receipt should not retain a capture id.", popupState);
  assert(
    JSON.stringify(popupState.receiptActions) === JSON.stringify([
      { action: "annotate", label: "Annotate & export" },
      { action: "open", label: "Open original" },
      { action: "show", label: "Show in folder" },
      { action: "library", label: "Library" }
    ]),
    "Capture receipt actions or labels drifted from the post-capture handoff.",
    popupState
  );
  assert(popupState.statusHidden, "Popup status panel should start hidden.", popupState);
  assert(popupState.manualCount === "0 boxes", "Manual redaction counter did not initialize.", popupState);
  assert(!popupState.autoRedactDisabled, "Local beta should make auto-redaction immediately usable.", popupState);
  assert(popupState.cutawayStatus === "Choose region", "Cutaway region status did not initialize.", popupState);
  assert(popupState.cutawayClearDisabled, "Cutaway clear action should start disabled without a region.", popupState);
  assert(popupState.watchCardHidden, "Timed capture card should start hidden without a saved watch.", popupState);
  assert(popupState.runWatchNowDisabled, "Run now should start disabled without a saved active watch.", popupState);
  assert(popupState.toggleWatchDisabled, "Pause/resume should start disabled without a saved watch.", popupState);
  assert(popupState.deleteWatchDisabled, "Clear watch should start disabled without a saved watch.", popupState);
  assert(popupState.watchMode === "once" && popupState.watchDelayVisible && popupState.watchContinuousHidden, "Area monitor mode controls did not initialize to delayed once.", popupState);
  assert(popupState.annotationStatus === "Choose target", "Annotation callout status did not initialize.", popupState);
  assert(popupState.annotationClearDisabled, "Annotation clear action should start disabled without a callout.", popupState);
  assert(popupState.runViewSummary === "Desktop", "Run view summary did not initialize.", popupState);
  assert(popupState.runExportSummary === "Raw", "Run export summary did not initialize.", popupState);
  assert(popupState.runSafetySummary.includes("Cleanup"), "Run safety summary did not initialize.", popupState);
  assert(popupState.accountPlan === "Local beta", "Local beta plan did not render.", popupState);
  assert(popupState.dataControlsSummary.includes("clear history"), "Data controls summary did not explain local cleanup.", popupState);
  assert(popupState.retentionDisabled, "Retention control should start disabled without a backend session.", popupState);
  assert(popupState.retentionValue === "90", "Retention control should default to 90 days.", popupState);
  assert(popupState.cloudSyncDisabled, "Cloud sync control should start disabled for the free plan.", popupState);
  assert(!popupState.deleteBackendDataDisabled, "Local workspace cleanup should always be available.", popupState);
  assert(popupState.lockedFeatureCount === 1, "Only the connected cloud feature chip should remain locked in the local beta.", popupState);
  assert(
    popupState.disabledResponsiveModes.length === 0,
    "Responsive modes should be available in the local beta.",
    popupState
  );
  assert(
    popupState.disabledPosterModes.length === 0,
    "Poster export modes should be available in the local beta.",
    popupState
  );
  assert(popupState.exportReviewHidden, "Export review screen should start hidden.", popupState);
  assert(popupState.exportReviewConfirm === "Save capture", "Export review confirmation action did not render.", popupState);
  assert(popupState.timelineStepCount === 6, "Capture timeline did not render.", popupState);
  assert(popupState.statusLogText === "Run status appears here.", "Status log did not initialize.", popupState);
  assert(popupState.historyCount === "1 item", "Seeded history count did not render.", popupState);
  assert(popupState.historyPath === "Lumen/2026-05-02/smoke-capture", "Archive folder did not render.", popupState);
  assert(popupState.historyDetailOpen, "Latest history detail panel did not open.", popupState);
  assert(popupState.historyDetailMetrics.includes("Saved"), "History detail manifest state did not render.", popupState);
  assert(popupState.historyDetailPanels.includes("Capture views"), "History detail capture views did not render.", popupState);
  assert(popupState.historyDetailPanels.includes("Files"), "History detail files did not render.", popupState);
  assert(popupState.historyDetailPanels.includes("Page signals"), "History detail page signals did not render.", popupState);
  assert(popupState.historyArtifactFilters.includes("All 4"), "Files all filter did not render.", popupState);
  assert(popupState.historyArtifactFilters.includes("Cutaway 1"), "Cutaway file filter did not render.", popupState);
  assert(popupState.historyArtifactFilters.includes("Print sheet 1"), "Print sheet file filter did not render.", popupState);
  assert(popupState.historyArtifactRows.includes("cutaway"), "Cutaway file row did not render.", popupState);
  assert(popupState.historyArtifactRows.includes("print-sheet"), "Print sheet file row did not render.", popupState);
  assert(popupState.historyCutawayPreview, "Cutaway preview did not render in history detail.", popupState);
  assert(popupState.shelfCount.includes("1 capture"), "Capture shelf did not count seeded history.", popupState);
  assert(popupState.shelfCount.includes("2 timed runs"), "Capture shelf did not count seeded timed runs.", popupState);
  assert(popupState.shelfCards === 3, "Capture shelf did not render seeded captures and timed runs.", popupState);
  assert(popupState.photoLibraryCount === "1 photo", "Local photo library count did not render.", popupState);
  assert(popupState.photoLibraryCards === 1 && popupState.photoLibraryImages === 1, "Local photo library did not render its real preview.", popupState);
  assert(popupState.photoLibraryOpenLabel === "Open all", "Photo library navigation action did not render.", popupState);
  assert(
    popupState.shelfKinds.filter((kind) => kind === "watch").length === 2 &&
      popupState.shelfKinds.includes("capture"),
    "Capture shelf did not label timed run cards and capture cards.",
    popupState
  );
  assert(
    popupState.shelfBadges.includes("Timed saved") &&
      popupState.shelfBadges.includes("Timed Failed") &&
      popupState.shelfBadges.includes("Capture"),
    "Capture shelf status badges did not render.",
    popupState
  );
  assert(
    popupState.shelfActions.some((button) =>
      button.action === "copy" &&
        button.watchRunId === "watch-run-smoke-captured" &&
        !button.disabled
    ) &&
      popupState.shelfActions.some((button) =>
        button.action === "copy" &&
          button.watchRunId === "watch-run-smoke-failed" &&
          !button.disabled
      ),
    "Timed run shelf summaries should be copyable.",
    popupState
  );
  assert(
    popupState.shelfActions.some((button) =>
      button.action === "open" &&
        button.watchRunId === "watch-run-smoke-failed" &&
        button.disabled
    ),
    "Failed timed runs should keep file actions disabled.",
    popupState
  );
  assert(
    popupState.historyActions.length === 4 &&
      popupState.historyActions.every((button) => button.captureId === seededCaptureId && !button.disabled),
    "History file actions did not render.",
    popupState
  );
  assert(!popupConsoleErrors.length, "Popup emitted console errors.", popupConsoleErrors);

  await popup.click("[data-history-artifact-filter='cutaway']");
  const filteredArtifactState = await popup.evaluate(() => ({
    activeFilter: document.querySelector("[data-history-artifact-filter].is-active")?.dataset.historyArtifactFilter || "",
    visibleRows: [...document.querySelectorAll("[data-artifact-type]")]
      .filter((row) => !row.classList.contains("is-filtered"))
      .map((row) => row.dataset.artifactType),
    hiddenRows: [...document.querySelectorAll("[data-artifact-type].is-filtered")]
      .map((row) => row.dataset.artifactType)
  }));

  assert(filteredArtifactState.activeFilter === "cutaway", "Cutaway artifact filter did not become active.", filteredArtifactState);
  assert(
    filteredArtifactState.visibleRows.length === 1 &&
      filteredArtifactState.visibleRows[0] === "cutaway" &&
      filteredArtifactState.hiddenRows.includes("image") &&
      filteredArtifactState.hiddenRows.includes("manifest"),
    "Cutaway artifact filter did not hide unrelated artifact rows.",
    filteredArtifactState
  );

  await popup.click("#captureOptionsButton");

  const clickMenuState = await popup.evaluate(async () => {
    const stored = await chrome.storage.local.get("lumen.capture.history");
    return {
      menuOpen: document.querySelector("#launchPanel")?.classList.contains("is-menu-open") || false,
      ariaHidden: document.querySelector("#holdMenu")?.getAttribute("aria-hidden") || "",
      optionsExpanded: document.querySelector("#captureOptionsButton")?.getAttribute("aria-expanded") || "",
      focusedAction: document.activeElement?.getAttribute("data-quick-action") || "",
      captureHistoryCount: stored["lumen.capture.history"]?.length || 0
    };
  });

  assert(clickMenuState.menuOpen, "Clicking capture options did not open the real action menu.", clickMenuState);
  assert(clickMenuState.ariaHidden === "false", "Capture options aria state did not open.", clickMenuState);
  assert(clickMenuState.optionsExpanded === "true", "Capture options did not expose its expanded state.", clickMenuState);
  assert(clickMenuState.focusedAction === "responsive", "Capture options did not focus the first available action.", clickMenuState);
  assert(clickMenuState.captureHistoryCount === 1, "Opening capture options accidentally started a capture.", clickMenuState);

  await popup.keyboard.press("Escape");
  const escapedMenuState = await popup.evaluate(() => ({
    menuOpen: document.querySelector("#launchPanel")?.classList.contains("is-menu-open") || false,
    ariaHidden: document.querySelector("#holdMenu")?.getAttribute("aria-hidden") || "",
    optionsExpanded: document.querySelector("#captureOptionsButton")?.getAttribute("aria-expanded") || "",
    focusId: document.activeElement?.id || ""
  }));

  assert(!escapedMenuState.menuOpen && escapedMenuState.ariaHidden === "true", "Escape did not close capture options.", escapedMenuState);
  assert(escapedMenuState.optionsExpanded === "false", "Escape did not collapse the options control.", escapedMenuState);
  assert(escapedMenuState.focusId === "captureOptionsButton", "Escape did not return focus to capture options.", escapedMenuState);

  await popup.click("#captureOptionsButton");
  await popup.dispatchEvent("#launchStatus", "pointerdown", {
    button: 0,
    pointerId: 2,
    pointerType: "mouse"
  });
  const outsideCloseState = await popup.evaluate(() => ({
    menuOpen: document.querySelector("#launchPanel")?.classList.contains("is-menu-open") || false,
    optionsExpanded: document.querySelector("#captureOptionsButton")?.getAttribute("aria-expanded") || ""
  }));
  assert(!outsideCloseState.menuOpen && outsideCloseState.optionsExpanded === "false", "Clicking outside the menu did not close it.", outsideCloseState);

  await popup.dispatchEvent("#captureButton", "pointerdown", {
    button: 0,
    pointerId: 1,
    pointerType: "mouse"
  });
  await popup.waitForTimeout(650);

  const holdState = await popup.evaluate(() => ({
    menuOpen: document.querySelector("#launchPanel")?.classList.contains("is-menu-open") || false,
    ariaHidden: document.querySelector("#holdMenu")?.getAttribute("aria-hidden") || "",
    optionsExpanded: document.querySelector("#captureOptionsButton")?.getAttribute("aria-expanded") || "",
    statusTitle: document.querySelector("#launchStatusTitle")?.textContent?.trim() || ""
  }));

  assert(holdState.menuOpen, "Holding capture did not open the quick action menu.", holdState);
  assert(holdState.ariaHidden === "false", "Hold menu aria state did not open.", holdState);
  assert(holdState.optionsExpanded === "true", "Long press did not expand the capture options control.", holdState);
  assert(holdState.statusTitle === "lumen-smoke.test ready", "Opening capture options should not replace the page readiness status.", holdState);

  await popup.dispatchEvent("#captureButton", "pointerup", {
    button: 0,
    pointerId: 1,
    pointerType: "mouse"
  });

  const clearResponse = await popup.evaluate(() => chrome.runtime.sendMessage({
    type: "LUMEN_CLEAR_LOCAL_DATA"
  }));
  assert(clearResponse?.ok, "Local workspace cleanup failed.", clearResponse);
  assert(clearResponse.deleted?.captures === 1 && clearResponse.deleted?.watchRuns === 2 && clearResponse.deleted?.libraryPhotos === 1, "Local workspace cleanup reported the wrong counts.", clearResponse);

  const clearedState = await worker.evaluate(() => chrome.storage.local.get([
    "lumen.capture.history",
    "lumen.watch.runs",
    "lumen.capture.privateSettings"
  ]));
  assert(clearedState["lumen.capture.history"]?.length === 0, "Local capture history survived workspace cleanup.", clearedState);
  assert(clearedState["lumen.watch.runs"]?.length === 0, "Timed run history survived workspace cleanup.", clearedState);
  assert(clearedState["lumen.capture.privateSettings"]?.annotationText === "", "Private note draft survived workspace cleanup.", clearedState);
  const clearedLibraryCount = await popup.evaluate(async () => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    return store.countLibraryCaptures();
  });
  assert(clearedLibraryCount === 0, "Local photo library survived workspace cleanup.", { clearedLibraryCount });

  await target.close();
  await popup.reload({ waitUntil: "load" });
  await popup.waitForSelector("#captureButton", { timeout: 10000 });

  const blockedState = await popup.evaluate(() => ({
    launchStatusState: document.querySelector("#launchStatus")?.dataset.state || "",
    launchStatusTitle: document.querySelector("#launchStatusTitle")?.textContent?.trim() || "",
    launchBlocked: document.querySelector("#launchPanel")?.classList.contains("is-blocked") || false,
    captureDisabled: document.querySelector("#captureButton")?.disabled || false,
    captureOptionsDisabled: document.querySelector("#captureOptionsButton")?.disabled || false,
    analyzeDisabled: document.querySelector("#analyzeButton")?.disabled || false,
    quickActionsDisabled: [...document.querySelectorAll("[data-quick-action]")].every((button) => button.disabled)
  }));

  assert(blockedState.launchStatusState === "blocked", "Launch status should block restricted or missing target tabs.", blockedState);
  assert(blockedState.launchBlocked, "Launch panel should mark blocked target state.", blockedState);
  assert(blockedState.captureDisabled, "Capture should be disabled without a capturable target tab.", blockedState);
  assert(blockedState.captureOptionsDisabled, "Capture options should be disabled without a capturable target tab.", blockedState);
  assert(blockedState.analyzeDisabled, "Analyze should be disabled without a capturable target tab.", blockedState);
  assert(blockedState.quickActionsDisabled, "Quick actions should be disabled without a capturable target tab.", blockedState);

  const storageState = await worker.evaluate(async () => ({
    sync: await chrome.storage.sync.get("lumen.capture.settings"),
    local: await chrome.storage.local.get([
      "lumen.capture.privateSettings",
      "lumen.app.settings"
    ])
  }));

  assert(
    Boolean(storageState.sync["lumen.capture.settings"]),
    "Default capture settings were not initialized in sync storage.",
    storageState
  );
  assert(
    !Object.hasOwn(storageState.sync["lumen.capture.settings"], "annotationText"),
    "Private capture-note text must not be copied through Chrome Sync.",
    storageState
  );
  assert(
    typeof storageState.local["lumen.capture.privateSettings"]?.annotationText === "string",
    "Private capture-note settings were not initialized in local storage.",
    storageState
  );
  assert(
    storageState.local["lumen.app.settings"]?.localOnlyMode === true &&
      storageState.local["lumen.app.settings"]?.reviewBeforeSave === false,
    "New installs did not initialize safe local-only and one-click capture defaults.",
    storageState.local
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
  await cleanupTemporaryPath(tempRoot, "extension smoke temp root");
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
        !parts.some((part) => part.endsWith(".zip"));
    }
  });

  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // The production popup relies on activeTab from a toolbar launch. This direct
  // popup smoke test grants only the fixture host so target lookup stays stable.
  manifest.host_permissions = ["https://lumen-smoke.test/*"];

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
