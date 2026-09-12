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
  const tallResultCaptureId = "smoke-result-tall-disposable";
  const degradedResultCaptureId = "smoke-result-pdf-download-only";
  const thumbnailResultCaptureId = "smoke-result-thumbnail-only";
  const limitedReviewCaptureId = "smoke-result-limited-review-only";
  const transparentLassoCaptureId = "smoke-result-transparent-lasso";
  const staleDownloadCaptureId = "smoke-result-stale-download-only";
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
    const editorCanvas = document.createElement("canvas");
    editorCanvas.width = 720;
    editorCanvas.height = 1200;
    const editorContext = editorCanvas.getContext("2d");
    editorContext.fillStyle = "#0b1b2d";
    editorContext.fillRect(0, 0, editorCanvas.width, editorCanvas.height);
    editorContext.fillStyle = "#64f2df";
    editorContext.fillRect(80, 860, 560, 220);
    const originalDownloadId = await chrome.downloads.download({
      url: editorCanvas.toDataURL("image/png"),
      filename: "Lumen/smoke-result-original.png",
      saveAs: false
    });
    let originalDownload = null;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      [originalDownload] = await chrome.downloads.search({ id: originalDownloadId });

      if (originalDownload?.state === "complete") {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (!originalDownload || originalDownload.state !== "complete") {
      throw new Error("Could not seed a completed result-workspace original.");
    }

    await store.putLibraryCapture({
      id: captureId,
      title: "Smoke capture",
      pageContext: {
        headline: "<script>capture context</script>",
        primaryAction: "Continue",
        navigation: ["Checkout", "Account"],
        colors: ["#123456"],
        fonts: ["Avenir Next"]
      },
      host: "example.test",
      url: "https://example.test/",
      capturedAt: new Date().toISOString(),
      sourceType: "manual",
      devicePreset: "desktop",
      exportPreset: "raw",
      archiveFolder: "Lumen/2026-05-02/smoke-capture",
      downloads: [{
        downloadId: originalDownloadId,
        filename: "Lumen/2026-05-02/smoke-capture/smoke-desktop-raw.png",
        bytesReceived: originalDownload.bytesReceived,
        complete: true,
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
        dataUrl: editorCanvas.toDataURL("image/png"),
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

  const tallResultSeed = await librarySeedPage.evaluate(async (captureId) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    const { STORAGE_KEYS } = await import(chrome.runtime.getURL("config.js"));
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 7200;
    const context = canvas.getContext("2d");
    context.fillStyle = "#f7fafc";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < canvas.height; y += 600) {
      context.fillStyle = y % 1200 ? "#dff7ee" : "#10243a";
      context.fillRect(80, y + 70, 1040, 420);
      context.fillStyle = y % 1200 ? "#10243a" : "#eff9fb";
      context.font = "700 46px system-ui";
      context.fillText(`Tall result section ${y / 600 + 1}`, 130, y + 170);
    }

    context.fillStyle = "#ff5f78";
    context.fillRect(0, canvas.height - 28, canvas.width, 28);
    const dataUrl = canvas.toDataURL("image/png");
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: "Lumen/tall-result-disposable-original.png",
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

    if (!download || download.state !== "complete" || !download.bytesReceived) {
      throw new Error("Could not seed the tall result-workspace original.");
    }

    await store.putLibraryCapture({
      id: captureId,
      title: "Tall result smoke capture",
      host: "tall.example.test",
      url: "https://tall.example.test/release-notes",
      capturedAt: new Date().toISOString(),
      sourceType: "manual",
      dimensions: { width: canvas.width, height: canvas.height },
      fileCount: 1,
      downloads: [{
        downloadId,
        filename: "Lumen/tall-result-disposable-original.png",
        bytesReceived: download.bytesReceived,
        complete: true,
        kind: "image",
        role: "full-page",
        variantId: "desktop",
        width: canvas.width,
        height: canvas.height
      }],
      editorSource: {
        dataUrl,
        width: canvas.width,
        height: canvas.height,
        originalWidth: canvas.width,
        originalHeight: canvas.height,
        scaled: false,
        kind: "lossless-full-output",
        role: "full-page",
        variantId: "desktop"
      }
    });
    const localState = await chrome.storage.local.get([
      STORAGE_KEYS.captureHistory,
      STORAGE_KEYS.watchRuns
    ]);
    const captureHistory = Array.isArray(localState[STORAGE_KEYS.captureHistory])
      ? localState[STORAGE_KEYS.captureHistory]
      : [];
    const watchRuns = Array.isArray(localState[STORAGE_KEYS.watchRuns])
      ? localState[STORAGE_KEYS.watchRuns]
      : [];
    await chrome.storage.local.set({
      [STORAGE_KEYS.captureHistory]: [{
        id: captureId,
        title: "Tall result smoke capture",
        url: "https://tall.example.test/release-notes",
        capturedAt: new Date().toISOString(),
        dimensions: { width: canvas.width, height: canvas.height }
      }, ...captureHistory],
      [STORAGE_KEYS.watchRuns]: [{
        id: "watch-run-tall-result-disposable",
        captureId,
        status: "captured",
        completedAt: new Date().toISOString()
      }, ...watchRuns]
    });

    const storedCapture = await store.getLibraryCapture(captureId, {
      includeEditorSource: true
    });

    return {
      downloadId,
      filename: download.filename,
      bytesReceived: download.bytesReceived,
      editorWidth: storedCapture?.editorSource?.width || 0,
      editorHeight: storedCapture?.editorSource?.height || 0,
      editorBytes: storedCapture?.editorSource?.blob?.size || 0
    };
  }, tallResultCaptureId);
  assert(
    Number.isInteger(tallResultSeed.downloadId) &&
      tallResultSeed.bytesReceived > 0 &&
      tallResultSeed.editorWidth === 1200 &&
      tallResultSeed.editorHeight === 7200 &&
      tallResultSeed.editorBytes > 0,
    "The tall result fixture did not retain its full-page source and completed original.",
    tallResultSeed
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
  await librarySeedPage.evaluate(async ({
    degradedCaptureId,
    thumbnailCaptureId,
    limitedReviewCaptureId: reviewCaptureId,
    lassoCaptureId,
    staleCaptureId
  }) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    const createCompletedDownload = async (dataUrl, filename) => {
      const downloadId = await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [download] = await chrome.downloads.search({ id: downloadId });

        if (download?.state === "complete") {
          return download;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      throw new Error(`Could not seed completed download ${filename}.`);
    };
    const cachedPdf = new Blob([
      "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"
    ], { type: "application/pdf" });
    const lassoCanvas = document.createElement("canvas");
    lassoCanvas.width = 240;
    lassoCanvas.height = 180;
    const lassoContext = lassoCanvas.getContext("2d", { alpha: true });
    lassoContext.clearRect(0, 0, lassoCanvas.width, lassoCanvas.height);
    lassoContext.fillStyle = "#6de8bd";
    lassoContext.beginPath();
    lassoContext.moveTo(120, 12);
    lassoContext.lineTo(228, 90);
    lassoContext.lineTo(120, 168);
    lassoContext.lineTo(12, 90);
    lassoContext.closePath();
    lassoContext.fill();
    const lassoDataUrl = lassoCanvas.toDataURL("image/png");
    const thumbnailCanvas = document.createElement("canvas");
    thumbnailCanvas.width = 360;
    thumbnailCanvas.height = 240;
    const thumbnailContext = thumbnailCanvas.getContext("2d");
    thumbnailContext.fillStyle = "#f4f7f8";
    thumbnailContext.fillRect(0, 0, thumbnailCanvas.width, thumbnailCanvas.height);
    thumbnailContext.fillStyle = "#10243a";
    thumbnailContext.fillRect(24, 24, 312, 72);
    thumbnailContext.fillStyle = "#64f2df";
    thumbnailContext.fillRect(24, 116, 208, 92);
    const thumbnailDataUrl = thumbnailCanvas.toDataURL("image/png");
    const reviewCanvas = document.createElement("canvas");
    reviewCanvas.width = 240;
    reviewCanvas.height = 1200;
    const reviewContext = reviewCanvas.getContext("2d");
    reviewContext.fillStyle = "#f4f7f8";
    reviewContext.fillRect(0, 0, reviewCanvas.width, reviewCanvas.height);

    for (let top = 24; top < reviewCanvas.height; top += 180) {
      reviewContext.fillStyle = top % 360 === 24 ? "#10243a" : "#64f2df";
      reviewContext.fillRect(18, top, 204, 128);
    }

    const reviewDataUrl = reviewCanvas.toDataURL("image/png");
    const [firstTileDownload, secondTileDownload, lassoDownload] = await Promise.all([
      createCompletedDownload(lassoDataUrl, "Lumen/retained-formats-part-01-of-02.png"),
      createCompletedDownload(lassoDataUrl, "Lumen/retained-formats-part-02-of-02.png"),
      createCompletedDownload(lassoDataUrl, "Lumen/transparent-lasso-crop.png")
    ]);

    await store.putLibraryCapture({
      id: degradedCaptureId,
      title: "Retained formats only",
      host: "example.test",
      url: "https://example.test/retained-formats",
      capturedAt: new Date().toISOString(),
      sourceType: "manual",
      dimensions: { width: 1280, height: 18000 },
      fileCount: 2,
      downloads: [
        {
          downloadId: firstTileDownload.id,
          filename: "Lumen/retained-formats-part-01-of-02.png",
          bytesReceived: firstTileDownload.bytesReceived,
          complete: true,
          kind: "image",
          role: "full-page",
          variantId: "desktop",
          partIndex: 1,
          partTotal: 2,
          width: 1280,
          height: 9000
        },
        {
          downloadId: secondTileDownload.id,
          filename: "Lumen/retained-formats-part-02-of-02.png",
          bytesReceived: secondTileDownload.bytesReceived,
          complete: true,
          kind: "image",
          role: "full-page",
          variantId: "desktop",
          partIndex: 2,
          partTotal: 2,
          width: 1280,
          height: 9000
        }
      ],
      pdfSource: {
        blob: cachedPdf,
        pageCount: 2,
        rasterWidth: 1280,
        sourceWidth: 1280,
        sourceHeight: 18000,
        sourceExact: true,
        role: "full-page",
        kind: "capture-tile-pdf"
      }
    });

    await store.putLibraryCapture({
      id: thumbnailCaptureId,
      title: "Thumbnail-only legacy capture",
      host: "example.test",
      url: "https://example.test/thumbnail-only",
      capturedAt: new Date().toISOString(),
      sourceType: "manual",
      dimensions: { width: 1200, height: 12000 },
      fileCount: 0,
      previews: [{
        dataUrl: thumbnailDataUrl,
        width: 1200,
        height: 12000,
        role: "full-page",
        variantId: "desktop"
      }]
    });

    await store.putLibraryCapture({
      id: reviewCaptureId,
      title: "Limited complete-page review",
      host: "example.test",
      url: "https://example.test/limited-review",
      capturedAt: new Date().toISOString(),
      sourceType: "manual",
      dimensions: { width: 1200, height: 6000 },
      fileCount: 0,
      editorSource: {
        dataUrl: reviewDataUrl,
        width: 240,
        height: 1200,
        originalWidth: 1200,
        originalHeight: 6000,
        scaled: true,
        kind: "bounded-full-page-review",
        role: "full-page",
        variantId: "desktop"
      }
    });

    await store.putLibraryCapture({
      id: lassoCaptureId,
      title: "Transparent lasso crop",
      host: "example.test",
      url: "https://example.test/lasso",
      capturedAt: new Date().toISOString(),
      sourceType: "manual",
      dimensions: { width: 240, height: 180 },
      fileCount: 1,
      downloads: [{
        downloadId: lassoDownload.id,
        filename: "Lumen/transparent-lasso-crop.png",
        bytesReceived: lassoDownload.bytesReceived,
        complete: true,
        kind: "image",
        role: "cutaway",
        variantId: "desktop",
        width: 240,
        height: 180
      }],
      editorSource: {
        dataUrl: lassoDataUrl,
        width: 240,
        height: 180,
        originalWidth: 240,
        originalHeight: 180,
        scaled: false,
        kind: "lossless-cutaway-output",
        role: "cutaway",
        variantId: "desktop"
      }
    });

    await store.putLibraryCapture({
      id: staleCaptureId,
      title: "Stale downloaded original",
      host: "example.test",
      url: "https://example.test/stale-download",
      capturedAt: new Date().toISOString(),
      sourceType: "manual",
      dimensions: { width: 800, height: 1200 },
      fileCount: 1,
      downloads: [{
        downloadId: 987654321,
        filename: "Lumen/cleared-from-download-history.png",
        bytesReceived: 12000,
        complete: true,
        kind: "image",
        role: "full-page",
        width: 800,
        height: 1200
      }]
    });
  }, {
    degradedCaptureId: degradedResultCaptureId,
    thumbnailCaptureId: thumbnailResultCaptureId,
    limitedReviewCaptureId,
    lassoCaptureId: transparentLassoCaptureId,
    staleCaptureId: staleDownloadCaptureId
  });
  const artifactChoices = await librarySeedPage.evaluate(async ({ captureId, secondId }) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    const capture = await store.getLibraryCapture(captureId);
    const second = await store.getLibraryCapture(secondId);
    const extra = { ...second.downloads[0], variantId: "tablet" };
    await store.putLibraryCapture({ ...capture, downloads: [...capture.downloads, extra] });
    return { first: capture.downloads[0].downloadId, second: extra.downloadId };
  }, { captureId: seededCaptureId, secondId: tallResultCaptureId });
  await librarySeedPage.close();

  const resultPage = await context.newPage();
  resultPage.on("console", (message) => {
    if (message.type() === "error") {
      popupConsoleErrors.push(`result: ${message.text()}`);
    }
  });
  resultPage.on("pageerror", (error) => popupConsoleErrors.push(`result: ${error.message}`));
  await resultPage.setViewportSize({ width: 1280, height: 900 });
  await resultPage.goto(
    `chrome-extension://${extensionId}/result.html?captureId=${encodeURIComponent(seededCaptureId)}`,
    { waitUntil: "load" }
  );
  await resultPage.waitForSelector('body[data-state="ready"]', { timeout: 10000 });
  await resultPage.waitForSelector("#resultImage:not([hidden])", { timeout: 10000 });

  const stableResultIds = [
    "resultStatus",
    "resultImage",
    "copyImageButton",
    "downloadPngButton",
    "exportPdfButton",
    "annotateButton",
    "driveButton",
    "openOriginalButton",
    "showOriginalButton",
    "openLibraryButton",
    "detailsButton",
    "settingsButton",
    "deleteCaptureButton",
    "zoomOutButton",
    "zoomInButton",
    "actualSizeButton",
    "fitPageButton",
    "fitButton",
    "zoomLabel"
  ];
  const resultWorkspaceState = await resultPage.evaluate((stableIds) => ({
    state: document.body.dataset.state || "",
    title: document.querySelector("#resultTitle")?.textContent?.trim() || "",
    host: document.querySelector("#resultHost")?.textContent?.trim() || "",
    source: document.querySelector("#resultSource")?.textContent?.trim() || "",
    status: document.querySelector("#resultStatus")?.textContent?.trim() || "",
    imageHidden: document.querySelector("#resultImage")?.hidden ?? true,
    imageWidth: document.querySelector("#resultImage")?.naturalWidth || 0,
    imageHeight: document.querySelector("#resultImage")?.naturalHeight || 0,
    loadingVisible: getComputedStyle(document.querySelector("#loadingState")).display !== "none",
    emptyVisible: getComputedStyle(document.querySelector("#emptyState")).display !== "none",
    missingIds: stableIds.filter((id) => !document.getElementById(id)),
    copyDisabled: document.querySelector("#copyImageButton")?.disabled ?? true,
    pngDisabled: document.querySelector("#downloadPngButton")?.disabled ?? true,
    pdfDisabled: document.querySelector("#exportPdfButton")?.disabled ?? true,
    annotateDisabled: document.querySelector("#annotateButton")?.disabled ?? true,
    openDisabled: document.querySelector("#openOriginalButton")?.disabled ?? true,
    showDisabled: document.querySelector("#showOriginalButton")?.disabled ?? true,
    driveHidden: document.querySelector("#driveButton")?.hidden ?? false,
    deleteDisabled: document.querySelector("#deleteCaptureButton")?.disabled ?? true,
    zoomLabel: document.querySelector("#zoomLabel")?.textContent?.trim() || "",
    pagePressed: document.querySelector("#fitPageButton")?.getAttribute("aria-pressed") || "",
    viewerCount: document.querySelectorAll(".viewer-card").length,
    actionCardCount: document.querySelectorAll(".action-card").length,
    timelineCount: document.querySelectorAll(".timeline, [data-stage-step]").length
  }), stableResultIds);

  assert(resultWorkspaceState.missingIds.length === 0, "The result workspace lost stable action or viewer IDs.", resultWorkspaceState);
  const pageContext = await resultPage.locator("#pageContextValues").textContent();
  assert(pageContext.includes("<script>capture context</script>") && pageContext.includes("Checkout / Account"), "Result lost capture-specific context or interpreted page text as markup.", { pageContext });
  assert(await resultPage.locator("#pageContextValues script").count() === 0, "Untrusted page context created executable markup.");
  await resultPage.click("#detailsButton");
  assert(await resultPage.locator("#savedFileSelect option").count() === 2, "Every available original should be selectable.");
  await resultPage.selectOption("#savedFileSelect", String(artifactChoices.second));
  await resultPage.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message, ...args) => {
      if (message.type === "LUMEN_SHOW_LIBRARY_PHOTO") {
        window.selectedArtifactRequest = message;
        chrome.runtime.sendMessage = original;
        return Promise.resolve({ ok: true });
      }
      return original(message, ...args);
    };
  });
  await resultPage.click("#showOriginalButton");
  const selectedRequest = await resultPage.evaluate(() => window.selectedArtifactRequest);
  assert(selectedRequest?.payload?.downloadId === artifactChoices.second && selectedRequest.payload.captureId === seededCaptureId,
    "Saved file action should target the chosen artifact within this capture.", selectedRequest);
  assert(await resultPage.locator("#resultImage").evaluate((image) => image.naturalWidth) === 720,
    "Selecting an original should preserve the working review image.");
  await resultPage.selectOption("#savedFileSelect", String(artifactChoices.first));
  await resultPage.click("#closeDetailsButton");
  assert(
    resultWorkspaceState.state === "ready" &&
      !resultWorkspaceState.imageHidden &&
      !resultWorkspaceState.loadingVisible &&
      !resultWorkspaceState.emptyVisible &&
      resultWorkspaceState.imageWidth === 720 &&
      resultWorkspaceState.imageHeight === 1200,
    "The result workspace did not load the seeded whole-image source.",
    resultWorkspaceState
  );
  assert(
      resultWorkspaceState.title === "Smoke capture" &&
      resultWorkspaceState.host === "example.test" &&
      /Full(?:-resolution)? local image/i.test(resultWorkspaceState.source) &&
      /Ready/i.test(resultWorkspaceState.status),
    "The result workspace did not render concise seeded capture context.",
    resultWorkspaceState
  );
  assert(
    !resultWorkspaceState.copyDisabled &&
      !resultWorkspaceState.pngDisabled &&
      !resultWorkspaceState.pdfDisabled &&
      !resultWorkspaceState.annotateDisabled &&
      !resultWorkspaceState.openDisabled &&
      !resultWorkspaceState.showDisabled &&
      !resultWorkspaceState.deleteDisabled &&
      resultWorkspaceState.zoomLabel === "Page" &&
      resultWorkspaceState.pagePressed === "true" &&
      resultWorkspaceState.driveHidden,
    "The clean result workspace did not expose the expected local actions.",
    resultWorkspaceState
  );
  assert(
    resultWorkspaceState.viewerCount === 1 &&
      resultWorkspaceState.actionCardCount === 1 &&
      resultWorkspaceState.timelineCount === 0,
    "The result workspace should stay focused on one preview and one concise action surface.",
    resultWorkspaceState
  );

  await resultPage.click("#copyImageButton");
  await resultPage.waitForFunction(() => {
    const status = document.querySelector("#resultStatus")?.textContent?.trim() || "";
    return status && status !== "Copying image…" && !/^Ready\./.test(status);
  }, null, { timeout: 10000 });
  const copiedResultStatus = await resultPage.locator("#resultStatus").textContent();
  assert(/Copied 720×1,200 PNG/i.test(copiedResultStatus || ""), "Copy image did not execute from the result workspace.", copiedResultStatus);

  await resultPage.click("#downloadPngButton");
  await resultPage.waitForFunction(() => /smoke-capture-result\.png saved to Downloads/i.test(
    document.querySelector("#resultStatus")?.textContent || ""
  ), null, { timeout: 15000 });
  await resultPage.click("#exportPdfButton");
  await resultPage.waitForFunction(() => /smoke-capture-result\.pdf saved as \d+ pages?/i.test(
    document.querySelector("#resultStatus")?.textContent || ""
  ), null, { timeout: 15000 });
  const resultDownloadHistory = await worker.evaluate(async () => (await chrome.downloads.search({}))
    .sort((left, right) => Date.parse(right.startTime || "") - Date.parse(left.startTime || ""))
    .map((item) => ({
      filename: item.filename,
      state: item.state,
      bytesReceived: item.bytesReceived
    })));
  const resultExports = resultDownloadHistory.slice(0, 2);
  assert(
    resultExports.length === 2 && resultExports.every((item) => item.state === "complete" && item.bytesReceived > 0),
    "The result workspace did not finish its PNG and PDF downloads.",
    resultDownloadHistory.slice(0, 10)
  );

  await resultPage.keyboard.press("1");
  assert(
    await resultPage.locator("#zoomLabel").textContent() === "100%",
    "The result workspace keyboard shortcut did not switch to actual size."
  );
  await resultPage.keyboard.press("0");
  assert(
    await resultPage.locator("#zoomLabel").textContent() === "Page",
    "The result workspace keyboard shortcut did not restore whole-page fit."
  );

  await resultPage.setViewportSize({ width: 320, height: 700 });
  const mobileResultState = await resultPage.evaluate(() => ({
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    annotateVisible: getComputedStyle(document.querySelector("#annotateButton")).display !== "none",
    viewerColumns: getComputedStyle(document.querySelector(".result-shell")).gridTemplateColumns,
    actionCardVisible: getComputedStyle(document.querySelector(".action-card")).display !== "none"
  }));
  assert(
    mobileResultState.documentWidth <= mobileResultState.viewportWidth &&
      mobileResultState.annotateVisible &&
      mobileResultState.actionCardVisible &&
      !mobileResultState.viewerColumns.includes(" "),
    "The result workspace lost an action or overflowed at 320px.",
    mobileResultState
  );

  const tallResultPage = await context.newPage();
  tallResultPage.on("console", (message) => {
    if (message.type() === "error") {
      popupConsoleErrors.push(`tall result: ${message.text()}`);
    }
  });
  tallResultPage.on("pageerror", (error) => popupConsoleErrors.push(`tall result: ${error.message}`));
  await tallResultPage.setViewportSize({ width: 1280, height: 900 });
  await tallResultPage.goto(
    `chrome-extension://${extensionId}/result.html?capture=${encodeURIComponent(tallResultCaptureId)}`,
    { waitUntil: "load" }
  );
  await tallResultPage.waitForSelector('body[data-state="ready"] #resultImage:not([hidden])', { timeout: 15000 });
  await tallResultPage.waitForFunction(() => {
    const image = document.querySelector("#resultImage");
    return document.querySelector("#zoomLabel")?.textContent === "Page" &&
      parseFloat(image?.style.width || "0") > 0 &&
      parseFloat(image?.style.height || "0") > 0;
  });

  const tallPageFitState = await tallResultPage.evaluate(() => {
    const viewport = document.querySelector("#resultViewport");
    const stage = document.querySelector("#resultStage");
    const image = document.querySelector("#resultImage");
    const stageStyle = getComputedStyle(stage);
    const horizontalPadding = parseFloat(stageStyle.paddingLeft || "0") + parseFloat(stageStyle.paddingRight || "0");
    const verticalPadding = parseFloat(stageStyle.paddingTop || "0") + parseFloat(stageStyle.paddingBottom || "0");
    const availableWidth = viewport.clientWidth - horizontalPadding;
    const availableHeight = viewport.clientHeight - verticalPadding;
    const expectedZoom = Math.max(0.01, Math.min(
      1,
      availableWidth / image.naturalWidth,
      availableHeight / image.naturalHeight
    ));
    const viewportRect = viewport.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();

    return {
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      renderedWidth: image.offsetWidth,
      renderedHeight: image.offsetHeight,
      expectedWidth: Math.round(image.naturalWidth * expectedZoom),
      expectedHeight: Math.round(image.naturalHeight * expectedZoom),
      zoomLabel: document.querySelector("#zoomLabel")?.textContent?.trim() || "",
      pagePressed: document.querySelector("#fitPageButton")?.getAttribute("aria-pressed") || "",
      widthPressed: document.querySelector("#fitButton")?.getAttribute("aria-pressed") || "",
      actualPressed: document.querySelector("#actualSizeButton")?.getAttribute("aria-pressed") || "",
      scrollWidth: viewport.scrollWidth,
      clientWidth: viewport.clientWidth,
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
      imageTop: imageRect.top,
      imageBottom: imageRect.bottom,
      viewportTop: viewportRect.top,
      viewportBottom: viewportRect.bottom
    };
  });
  assert(
    tallPageFitState.naturalWidth === 1200 &&
      tallPageFitState.naturalHeight === 7200 &&
      tallPageFitState.zoomLabel === "Page" &&
      tallPageFitState.pagePressed === "true" &&
      tallPageFitState.widthPressed === "false" &&
      tallPageFitState.actualPressed === "false" &&
      Math.abs(tallPageFitState.renderedWidth - tallPageFitState.expectedWidth) <= 3 &&
      Math.abs(tallPageFitState.renderedHeight - tallPageFitState.expectedHeight) <= 3 &&
      tallPageFitState.scrollWidth <= tallPageFitState.clientWidth + 2 &&
      tallPageFitState.scrollHeight <= tallPageFitState.clientHeight + 2 &&
      tallPageFitState.imageTop >= tallPageFitState.viewportTop - 1 &&
      tallPageFitState.imageBottom <= tallPageFitState.viewportBottom + 1,
    "Whole-page mode did not fit the complete tall capture inside the result viewer.",
    tallPageFitState
  );

  await tallResultPage.click("#fitButton");
  await tallResultPage.waitForFunction(() => document.querySelector("#zoomLabel")?.textContent === "Width");
  const tallWidthState = await tallResultPage.evaluate(async () => {
    const viewport = document.querySelector("#resultViewport");
    const stage = document.querySelector("#resultStage");
    const image = document.querySelector("#resultImage");
    const stageStyle = getComputedStyle(stage);
    const horizontalPadding = parseFloat(stageStyle.paddingLeft || "0") + parseFloat(stageStyle.paddingRight || "0");
    const verticalPadding = parseFloat(stageStyle.paddingTop || "0") + parseFloat(stageStyle.paddingBottom || "0");
    viewport.scrollTop = viewport.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const viewportRect = viewport.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    const maximumScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);

    return {
      renderedWidth: image.offsetWidth,
      renderedHeight: image.offsetHeight,
      expectedWidth: Math.round(((viewport.clientWidth - horizontalPadding) / image.naturalWidth) * image.naturalWidth),
      expectedHeight: Math.round(((viewport.clientWidth - horizontalPadding) / image.naturalWidth) * image.naturalHeight),
      verticalPadding,
      zoomLabel: document.querySelector("#zoomLabel")?.textContent?.trim() || "",
      pagePressed: document.querySelector("#fitPageButton")?.getAttribute("aria-pressed") || "",
      widthPressed: document.querySelector("#fitButton")?.getAttribute("aria-pressed") || "",
      scrollTop: viewport.scrollTop,
      maximumScrollTop,
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
      imageBottom: imageRect.bottom,
      viewportTop: viewportRect.top,
      viewportBottom: viewportRect.bottom
    };
  });
  const tallBottomGap = tallWidthState.viewportBottom - tallWidthState.imageBottom;
  assert(
    tallWidthState.zoomLabel === "Width" &&
      tallWidthState.pagePressed === "false" &&
      tallWidthState.widthPressed === "true" &&
      Math.abs(tallWidthState.renderedWidth - tallWidthState.expectedWidth) <= 1 &&
      Math.abs(tallWidthState.renderedHeight - tallWidthState.expectedHeight) <= 1 &&
      tallWidthState.scrollHeight > tallWidthState.clientHeight &&
      tallWidthState.renderedHeight > tallWidthState.clientHeight * 5 &&
      Math.abs(tallWidthState.scrollTop - tallWidthState.maximumScrollTop) <= 2 &&
      tallWidthState.imageBottom >= tallWidthState.viewportTop &&
      tallWidthState.imageBottom <= tallWidthState.viewportBottom + 1 &&
      tallBottomGap >= Math.max(0, tallWidthState.verticalPadding / 2 - 4) &&
      tallBottomGap <= tallWidthState.verticalPadding / 2 + 8,
    "Width mode did not preserve a vertically scrollable, unclipped tall capture through its bottom edge.",
    { ...tallWidthState, tallBottomGap }
  );

  await tallResultPage.click("#actualSizeButton");
  await tallResultPage.waitForFunction(() => document.querySelector("#zoomLabel")?.textContent === "100%");
  const tallActualState = await tallResultPage.evaluate(() => {
    const image = document.querySelector("#resultImage");
    return {
      renderedWidth: image.offsetWidth,
      renderedHeight: image.offsetHeight,
      actualPressed: document.querySelector("#actualSizeButton")?.getAttribute("aria-pressed") || ""
    };
  });
  assert(
    tallActualState.renderedWidth === 1200 &&
      tallActualState.renderedHeight === 7200 &&
      tallActualState.actualPressed === "true",
    "The tall result did not render at exact source pixels in 100% mode.",
    tallActualState
  );

  await tallResultPage.click("#zoomOutButton");
  await tallResultPage.waitForFunction(() => document.querySelector("#zoomLabel")?.textContent === "80%");
  const tallZoomOutState = await tallResultPage.evaluate(() => {
    const image = document.querySelector("#resultImage");
    return {
      renderedWidth: image.offsetWidth,
      renderedHeight: image.offsetHeight
    };
  });
  assert(
    tallZoomOutState.renderedWidth === 960 && tallZoomOutState.renderedHeight === 5760,
    "Zoom out did not scale both dimensions of the tall result by one step.",
    tallZoomOutState
  );

  await tallResultPage.click("#zoomInButton");
  await tallResultPage.waitForFunction(() => document.querySelector("#zoomLabel")?.textContent === "100%");
  const tallZoomInState = await tallResultPage.evaluate(() => {
    const image = document.querySelector("#resultImage");
    return {
      renderedWidth: image.offsetWidth,
      renderedHeight: image.offsetHeight
    };
  });
  assert(
    tallZoomInState.renderedWidth === 1200 && tallZoomInState.renderedHeight === 7200,
    "Zoom in did not restore both dimensions of the tall result by one step.",
    tallZoomInState
  );

  await tallResultPage.click("#fitPageButton");
  const pageFitBeforeResize = await tallResultPage.locator("#resultImage").evaluate((image) => ({
    width: image.offsetWidth,
    height: image.offsetHeight
  }));
  await tallResultPage.setViewportSize({ width: 1000, height: 1000 });
  await tallResultPage.waitForFunction(() => {
    const viewport = document.querySelector("#resultViewport");
    const stage = document.querySelector("#resultStage");
    const image = document.querySelector("#resultImage");
    const stageStyle = getComputedStyle(stage);
    const horizontalPadding = parseFloat(stageStyle.paddingLeft || "0") + parseFloat(stageStyle.paddingRight || "0");
    const verticalPadding = parseFloat(stageStyle.paddingTop || "0") + parseFloat(stageStyle.paddingBottom || "0");
    const expectedZoom = Math.max(0.01, Math.min(
      1,
      (viewport.clientWidth - horizontalPadding) / image.naturalWidth,
      (viewport.clientHeight - verticalPadding) / image.naturalHeight
    ));
    return document.querySelector("#zoomLabel")?.textContent === "Page" &&
      Math.abs(image.offsetWidth - Math.round(image.naturalWidth * expectedZoom)) <= 1 &&
      Math.abs(image.offsetHeight - Math.round(image.naturalHeight * expectedZoom)) <= 1;
  });
  const pageFitAfterResize = await tallResultPage.evaluate(() => {
    const viewport = document.querySelector("#resultViewport");
    const image = document.querySelector("#resultImage");
    const viewportRect = viewport.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    return {
      width: image.offsetWidth,
      height: image.offsetHeight,
      scrollWidth: viewport.scrollWidth,
      clientWidth: viewport.clientWidth,
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
      imageBottom: imageRect.bottom,
      viewportBottom: viewportRect.bottom,
      pagePressed: document.querySelector("#fitPageButton")?.getAttribute("aria-pressed") || ""
    };
  });
  assert(
    pageFitAfterResize.pagePressed === "true" &&
      pageFitAfterResize.height !== pageFitBeforeResize.height &&
      pageFitAfterResize.scrollWidth <= pageFitAfterResize.clientWidth + 2 &&
      pageFitAfterResize.scrollHeight <= pageFitAfterResize.clientHeight + 2 &&
      pageFitAfterResize.imageBottom <= pageFitAfterResize.viewportBottom + 1,
    "Whole-page fit did not recompute cleanly after the result viewer resized.",
    { before: pageFitBeforeResize, after: pageFitAfterResize }
  );

  const closedDetailsState = await tallResultPage.evaluate(() => ({
    expanded: document.querySelector("#detailsButton")?.getAttribute("aria-expanded") || "",
    ariaHidden: document.querySelector("#detailsPanel")?.getAttribute("aria-hidden") || "",
    inert: document.querySelector("#detailsPanel")?.inert ?? false,
    backdropHidden: document.querySelector("#detailsBackdrop")?.hidden ?? false,
    topbarInert: document.querySelector(".topbar")?.inert ?? false,
    resultShellInert: document.querySelector(".result-shell")?.inert ?? false
  }));
  assert(
    closedDetailsState.expanded === "false" &&
      closedDetailsState.ariaHidden === "true" &&
      closedDetailsState.inert &&
      closedDetailsState.backdropHidden &&
      !closedDetailsState.topbarInert &&
      !closedDetailsState.resultShellInert,
    "The result details drawer did not initialize closed and non-interactive.",
    closedDetailsState
  );
  await tallResultPage.click("#detailsButton");
  const openDetailsState = await tallResultPage.evaluate(() => ({
    expanded: document.querySelector("#detailsButton")?.getAttribute("aria-expanded") || "",
    ariaHidden: document.querySelector("#detailsPanel")?.getAttribute("aria-hidden") || "",
    ariaModal: document.querySelector("#detailsPanel")?.getAttribute("aria-modal") || "",
    inert: document.querySelector("#detailsPanel")?.inert ?? true,
    openClass: document.querySelector("#detailsPanel")?.classList.contains("is-open") || false,
    backdropHidden: document.querySelector("#detailsBackdrop")?.hidden ?? true,
    focusedId: document.activeElement?.id || "",
    source: document.querySelector("#resultSource")?.textContent?.trim() || "",
    dimensions: document.querySelector("#detailsDimensionsValue")?.textContent?.trim() || "",
    files: document.querySelector("#filesValue")?.textContent?.trim() || "",
    topbarInert: document.querySelector(".topbar")?.inert ?? false,
    resultShellInert: document.querySelector(".result-shell")?.inert ?? false
  }));
  assert(
    openDetailsState.expanded === "true" &&
      openDetailsState.ariaHidden === "false" &&
      openDetailsState.ariaModal === "true" &&
      !openDetailsState.inert &&
      openDetailsState.openClass &&
      !openDetailsState.backdropHidden &&
      openDetailsState.focusedId === "closeDetailsButton" &&
      /Full(?:-resolution)? local image/i.test(openDetailsState.source) &&
      openDetailsState.dimensions === "1,200×7,200" &&
      openDetailsState.files === "1 saved file" &&
      openDetailsState.topbarInert &&
      openDetailsState.resultShellInert,
    "The result details drawer did not expose the tall capture context accessibly.",
    openDetailsState
  );
  await tallResultPage.click("#closeDetailsButton");
  await tallResultPage.waitForFunction(() => document.querySelector("#detailsPanel")?.getAttribute("aria-hidden") === "true");
  await tallResultPage.waitForFunction(
    () => document.querySelector("#resultStatus")?.classList.contains("is-hidden"),
    null,
    { timeout: 7000 }
  );

  const settingsPagePromise = context.waitForEvent("page", { timeout: 10000 });
  await tallResultPage.click("#settingsButton");
  const settingsPageFromResult = await settingsPagePromise;
  settingsPageFromResult.on("console", (message) => {
    if (message.type() === "error") {
      popupConsoleErrors.push(`result settings: ${message.text()}`);
    }
  });
  settingsPageFromResult.on("pageerror", (error) => popupConsoleErrors.push(`result settings: ${error.message}`));
  await settingsPageFromResult.waitForLoadState("domcontentloaded");
  await settingsPageFromResult.waitForSelector("#privacyShieldToggle", { timeout: 10000 });
  assert(
    settingsPageFromResult.url() === `chrome-extension://${extensionId}/settings.html`,
    "The result Settings action did not route to the dedicated extension settings page.",
    settingsPageFromResult.url()
  );
  await settingsPageFromResult.close();

  const tallPreDeleteState = await tallResultPage.evaluate(async ({ captureId, downloadId }) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    const { STORAGE_KEYS } = await import(chrome.runtime.getURL("config.js"));
    const capture = await store.getLibraryCapture(captureId, { includeEditorSource: true });
    const [download] = await chrome.downloads.search({ id: downloadId });
    const localState = await chrome.storage.local.get([
      STORAGE_KEYS.captureHistory,
      STORAGE_KEYS.watchRuns
    ]);
    return {
      captureExists: Boolean(capture),
      editorExists: Boolean(capture?.editorSource?.blob),
      historyExists: (localState[STORAGE_KEYS.captureHistory] || []).some((record) => record?.id === captureId),
      watchRunExists: (localState[STORAGE_KEYS.watchRuns] || []).some((record) => record?.captureId === captureId),
      downloadId: download?.id ?? null,
      downloadState: download?.state || "",
      downloadExists: download?.exists !== false,
      bytesReceived: download?.bytesReceived || 0,
      filename: download?.filename || ""
    };
  }, {
    captureId: tallResultCaptureId,
    downloadId: tallResultSeed.downloadId
  });
  const tallDownloadStatBeforeDelete = await stat(tallResultSeed.filename);
  assert(
    tallPreDeleteState.captureExists &&
      tallPreDeleteState.editorExists &&
      tallPreDeleteState.historyExists &&
      tallPreDeleteState.watchRunExists &&
      tallPreDeleteState.downloadId === tallResultSeed.downloadId &&
      tallPreDeleteState.downloadState === "complete" &&
      tallPreDeleteState.downloadExists &&
      tallPreDeleteState.bytesReceived === tallResultSeed.bytesReceived &&
      tallDownloadStatBeforeDelete.size === tallResultSeed.bytesReceived,
    "The disposable tall capture was not intact before exercising deletion.",
    { tallPreDeleteState, downloadSize: tallDownloadStatBeforeDelete.size }
  );

  await tallResultPage.click("#deleteCaptureButton");
  await tallResultPage.waitForFunction(() => document.querySelector("#deleteDialog")?.open === true);
  const deletePromptState = await tallResultPage.evaluate(() => ({
    open: document.querySelector("#deleteDialog")?.open || false,
    title: document.querySelector("#deleteDialogTitle")?.textContent?.trim() || "",
    copy: document.querySelector("#deleteDialog")?.textContent?.replace(/\s+/g, " ").trim() || ""
  }));
  assert(
    deletePromptState.open &&
      /Remove this capture/i.test(deletePromptState.title) &&
      /Downloads stays on your device/i.test(deletePromptState.copy),
    "The result Remove action did not present an explicit local-only confirmation.",
    deletePromptState
  );
  await tallResultPage.click("#cancelDeleteButton");
  await tallResultPage.waitForFunction(() => document.querySelector("#deleteDialog")?.open === false);
  const captureAfterDeleteCancel = await tallResultPage.evaluate(async (captureId) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    return Boolean(await store.getLibraryCapture(captureId));
  }, tallResultCaptureId);
  assert(captureAfterDeleteCancel, "Cancelling result deletion still removed the disposable capture.");

  await tallResultPage.click("#deleteCaptureButton");
  await tallResultPage.waitForFunction(() => document.querySelector("#deleteDialog")?.open === true);
  await Promise.all([
    tallResultPage.waitForURL(`chrome-extension://${extensionId}/library.html?removed=1`, { timeout: 15000 }),
    tallResultPage.click("#confirmDeleteButton")
  ]);
  await tallResultPage.waitForSelector("#captureGrid", { timeout: 10000 });
  const tallPostDeleteState = await tallResultPage.evaluate(async ({ captureId, downloadId }) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    const { STORAGE_KEYS } = await import(chrome.runtime.getURL("config.js"));
    const capture = await store.getLibraryCapture(captureId, { includeEditorSource: true });
    const orphanedAssetKeys = await new Promise((resolve, reject) => {
      const request = indexedDB.open("lumen.capture.library");
      request.onerror = () => reject(request.error || new Error("Could not inspect deleted capture assets."));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("assets", "readonly");
        const keyRequest = transaction.objectStore("assets").index("captureId").getAllKeys(captureId);
        keyRequest.onerror = () => reject(keyRequest.error || new Error("Could not query deleted capture assets."));
        keyRequest.onsuccess = () => resolve(keyRequest.result || []);
      };
    });
    const [download] = await chrome.downloads.search({ id: downloadId });
    const localState = await chrome.storage.local.get([
      STORAGE_KEYS.captureHistory,
      STORAGE_KEYS.watchRuns
    ]);
    return {
      captureMissing: !capture,
      assetCount: orphanedAssetKeys.length,
      historyMissing: !(localState[STORAGE_KEYS.captureHistory] || []).some((record) => record?.id === captureId),
      watchRunMissing: !(localState[STORAGE_KEYS.watchRuns] || []).some((record) => record?.captureId === captureId),
      cardMissing: !document.querySelector(`.capture-card[data-capture-id="${CSS.escape(captureId)}"]`),
      downloadId: download?.id ?? null,
      downloadState: download?.state || "",
      downloadExists: download?.exists !== false,
      bytesReceived: download?.bytesReceived || 0,
      filename: download?.filename || ""
    };
  }, {
    captureId: tallResultCaptureId,
    downloadId: tallResultSeed.downloadId
  });
  const tallDownloadStatAfterDelete = await stat(tallResultSeed.filename);
  assert(
    tallPostDeleteState.captureMissing &&
      tallPostDeleteState.assetCount === 0 &&
      tallPostDeleteState.historyMissing &&
      tallPostDeleteState.watchRunMissing &&
      tallPostDeleteState.cardMissing &&
      tallPostDeleteState.downloadId === tallResultSeed.downloadId &&
      tallPostDeleteState.downloadState === "complete" &&
      tallPostDeleteState.downloadExists &&
      tallPostDeleteState.bytesReceived === tallResultSeed.bytesReceived &&
      tallPostDeleteState.filename === tallResultSeed.filename &&
      tallDownloadStatAfterDelete.size === tallDownloadStatBeforeDelete.size,
    "Confirmed result deletion did not remove only the private library copy while preserving Downloads.",
    {
      tallPostDeleteState,
      downloadSizeBefore: tallDownloadStatBeforeDelete.size,
      downloadSizeAfter: tallDownloadStatAfterDelete.size
    }
  );
  await tallResultPage.close();

  await resultPage.goto(
    `chrome-extension://${extensionId}/result.html?capture=${encodeURIComponent(seededCaptureId)}`,
    { waitUntil: "load" }
  );
  await resultPage.waitForSelector('body[data-state="ready"]', { timeout: 10000 });
  assert(
    await resultPage.locator("#resultTitle").textContent() === "Smoke capture",
    "The result workspace did not accept the existing ?capture= tool convention."
  );

  await resultPage.goto(
    `chrome-extension://${extensionId}/result.html?capture=${encodeURIComponent(degradedResultCaptureId)}`,
    { waitUntil: "load" }
  );
  await resultPage.waitForSelector('body[data-state="limited"]', { timeout: 10000 });
  const degradedResultState = await resultPage.evaluate(() => ({
    imageHidden: document.querySelector("#resultImage")?.hidden ?? false,
    loadingVisible: getComputedStyle(document.querySelector("#loadingState")).display !== "none",
    emptyVisible: getComputedStyle(document.querySelector("#emptyState")).display !== "none",
    source: document.querySelector("#resultSource")?.textContent?.trim() || "",
    emptyTitle: document.querySelector("#emptyStateTitle")?.textContent?.trim() || "",
    emptyDescription: document.querySelector("#emptyStateDescription")?.textContent?.trim() || "",
    fileSummary: document.querySelector("#filesValue")?.textContent?.trim() || "",
    privacy: document.querySelector("#privacyValue")?.textContent?.trim() || "",
    privacyNote: document.querySelector("#privacyNote")?.textContent?.trim() || "",
    copyDisabled: document.querySelector("#copyImageButton")?.disabled ?? false,
    pngDisabled: document.querySelector("#downloadPngButton")?.disabled ?? false,
    pdfDisabled: document.querySelector("#exportPdfButton")?.disabled ?? true,
    annotateDisabled: document.querySelector("#annotateButton")?.disabled ?? false,
    openDisabled: document.querySelector("#openOriginalButton")?.disabled ?? true,
    showDisabled: document.querySelector("#showOriginalButton")?.disabled ?? true,
    openLabel: document.querySelector("#openOriginalButton")?.textContent?.trim() || "",
    showLabel: document.querySelector("#showOriginalButton")?.textContent?.trim() || ""
  }));
  assert(
    degradedResultState.imageHidden &&
      !degradedResultState.loadingVisible &&
      degradedResultState.emptyVisible &&
      /cached PDF and 2 saved files remain/i.test(degradedResultState.source) &&
      /working preview was removed/i.test(degradedResultState.emptyTitle) &&
      /cached PDF and saved files/i.test(degradedResultState.emptyDescription) &&
      degradedResultState.fileSummary === "2 saved files" &&
      degradedResultState.privacy === "Browser + Downloads" &&
      /already in Chrome Downloads/i.test(degradedResultState.privacyNote),
    "The result workspace did not explain a pruned image without misrepresenting retained files or privacy.",
    degradedResultState
  );
  assert(
    degradedResultState.copyDisabled &&
      degradedResultState.pngDisabled &&
      !degradedResultState.pdfDisabled &&
      degradedResultState.annotateDisabled &&
      !degradedResultState.openDisabled &&
      !degradedResultState.showDisabled &&
      degradedResultState.openLabel === "Open tile 1 of 2" &&
      degradedResultState.showLabel === "Show files in folder",
    "The degraded result workspace did not keep only its genuinely usable actions enabled.",
    degradedResultState
  );
  const degradedResultOpenResponse = await resultPage.evaluate((captureId) => chrome.runtime.sendMessage({
    type: "LUMEN_OPEN_CAPTURE_RESULT",
    payload: { captureId }
  }), degradedResultCaptureId);
  assert(
    degradedResultOpenResponse?.ok && Number.isInteger(degradedResultOpenResponse.tabId),
    "The result opener rejected a capture that still had a cached PDF and saved-file handles.",
    degradedResultOpenResponse
  );
  await resultPage.click("#exportPdfButton");
  await resultPage.waitForFunction(() => /retained-formats-only-result\.pdf saved as 2 pages/i.test(
    document.querySelector("#resultStatus")?.textContent || ""
  ), null, { timeout: 15000 });

  const staleDownloadOpenResponse = await resultPage.evaluate((captureId) => chrome.runtime.sendMessage({
    type: "LUMEN_OPEN_CAPTURE_RESULT",
    payload: { captureId }
  }), staleDownloadCaptureId);
  assert(
    !staleDownloadOpenResponse?.ok && staleDownloadOpenResponse.error?.title === "Result Unavailable",
    "The result opener advertised a download handle that Chrome had already forgotten.",
    staleDownloadOpenResponse
  );
  await resultPage.goto(
    `chrome-extension://${extensionId}/result.html?capture=${encodeURIComponent(staleDownloadCaptureId)}`,
    { waitUntil: "load" }
  );
  await resultPage.waitForSelector('body[data-state="limited"]', { timeout: 10000 });
  const staleDownloadResultState = await resultPage.evaluate(() => ({
    source: document.querySelector("#resultSource")?.textContent?.trim() || "",
    fileSummary: document.querySelector("#filesValue")?.textContent?.trim() || "",
    privacy: document.querySelector("#privacyValue")?.textContent?.trim() || "",
    openDisabled: document.querySelector("#openOriginalButton")?.disabled ?? false,
    showDisabled: document.querySelector("#showOriginalButton")?.disabled ?? false,
    emptyDescription: document.querySelector("#emptyStateDescription")?.textContent?.trim() || ""
  }));
  assert(
    /No retained image or saved file/i.test(staleDownloadResultState.source) &&
      staleDownloadResultState.fileSummary === "No attached files" &&
      staleDownloadResultState.privacy === "Private browser data" &&
      staleDownloadResultState.openDisabled &&
      staleDownloadResultState.showDisabled &&
      /no preview, cached PDF, or attached download/i.test(staleDownloadResultState.emptyDescription),
    "The result workspace presented a cleared Chrome download-history handle as usable.",
    staleDownloadResultState
  );

  await resultPage.setViewportSize({ width: 1920, height: 1000 });
  await resultPage.goto(
    `chrome-extension://${extensionId}/result.html?capture=${encodeURIComponent(thumbnailResultCaptureId)}`,
    { waitUntil: "load" }
  );
  await resultPage.waitForSelector('body[data-state="limited"] #resultImage:not([hidden])', { timeout: 10000 });
  const thumbnailOnlyState = await resultPage.evaluate(() => ({
    imageWidth: document.querySelector("#resultImage")?.naturalWidth || 0,
    imageHeight: document.querySelector("#resultImage")?.naturalHeight || 0,
    source: document.querySelector("#resultSource")?.textContent?.trim() || "",
    mainDimensions: document.querySelector("#dimensionsValue")?.textContent?.trim() || "",
    originalDimensions: document.querySelector("#detailsDimensionsValue")?.textContent?.trim() || "",
    hint: document.querySelector("#viewHint")?.textContent?.trim() || "",
    zoomLabel: document.querySelector("#zoomLabel")?.textContent?.trim() || "",
    pageLabel: document.querySelector("#fitPageButton")?.textContent?.trim() || "",
    copyLabel: document.querySelector("#copyImageButton span:last-child")?.textContent?.trim() || "",
    pngLabel: document.querySelector("#downloadPngButton span:last-child")?.textContent?.trim() || "",
    copyDisabled: document.querySelector("#copyImageButton")?.disabled ?? true,
    pngDisabled: document.querySelector("#downloadPngButton")?.disabled ?? true,
    pdfDisabled: document.querySelector("#exportPdfButton")?.disabled ?? false,
    annotateDisabled: document.querySelector("#annotateButton")?.disabled ?? false,
    driveDisabled: document.querySelector("#driveButton")?.disabled ?? false
  }));
  assert(
    thumbnailOnlyState.imageWidth === 360 &&
      thumbnailOnlyState.imageHeight === 240 &&
      thumbnailOnlyState.mainDimensions === "360×240 thumbnail" &&
      thumbnailOnlyState.originalDimensions === "1,200×12,000" &&
      /Cropped gallery thumbnail/i.test(thumbnailOnlyState.source) &&
      /360×240 cropped thumbnail, not the whole capture/i.test(thumbnailOnlyState.source) &&
      /No full-resolution saved file is still attached/i.test(thumbnailOnlyState.source) &&
      !/complete-page review/i.test(thumbnailOnlyState.source) &&
      /Cropped thumbnail only/i.test(thumbnailOnlyState.hint) &&
      thumbnailOnlyState.zoomLabel === "Image" &&
      thumbnailOnlyState.pageLabel === "Image",
    "The result workspace presented a small gallery thumbnail as the complete capture.",
    thumbnailOnlyState
  );
  assert(
    thumbnailOnlyState.copyLabel === "Copy thumb" &&
      thumbnailOnlyState.pngLabel === "Thumb PNG" &&
      !thumbnailOnlyState.copyDisabled &&
      !thumbnailOnlyState.pngDisabled &&
      thumbnailOnlyState.pdfDisabled &&
      thumbnailOnlyState.annotateDisabled &&
      thumbnailOnlyState.driveDisabled,
    "The thumbnail-only result exposed actions that require a complete capture source.",
    thumbnailOnlyState
  );
  await resultPage.click("#fitButton");
  await resultPage.waitForFunction(() => document.querySelector("#zoomLabel")?.textContent?.trim() === "Width");
  const thumbnailWidthFit = await resultPage.evaluate(() => {
    const image = document.querySelector("#resultImage");
    const viewport = document.querySelector("#resultViewport");
    const stageStyle = getComputedStyle(document.querySelector("#resultStage"));
    const availableWidth = viewport.clientWidth -
      parseFloat(stageStyle.paddingLeft || "0") -
      parseFloat(stageStyle.paddingRight || "0");
    return {
      naturalWidth: image.naturalWidth,
      renderedWidth: image.getBoundingClientRect().width,
      availableWidth,
      zoomLabel: document.querySelector("#zoomLabel")?.textContent?.trim() || ""
    };
  });
  assert(
    thumbnailWidthFit.zoomLabel === "Width" &&
      thumbnailWidthFit.renderedWidth > thumbnailWidthFit.naturalWidth * 4 &&
      Math.abs(thumbnailWidthFit.renderedWidth - thumbnailWidthFit.availableWidth) <= 2,
    "Width mode did not fill the viewer when a narrow retained image required more than 4× enlargement.",
    thumbnailWidthFit
  );

  await resultPage.goto(
    `chrome-extension://${extensionId}/result.html?capture=${encodeURIComponent(limitedReviewCaptureId)}`,
    { waitUntil: "load" }
  );
  await resultPage.waitForSelector('body[data-state="limited"] #resultImage:not([hidden])', { timeout: 10000 });
  const limitedReviewState = await resultPage.evaluate(() => ({
    source: document.querySelector("#resultSource")?.textContent?.trim() || "",
    mainDimensions: document.querySelector("#dimensionsValue")?.textContent?.trim() || "",
    originalDimensions: document.querySelector("#detailsDimensionsValue")?.textContent?.trim() || "",
    copyLabel: document.querySelector("#copyImageButton span:last-child")?.textContent?.trim() || "",
    pngLabel: document.querySelector("#downloadPngButton span:last-child")?.textContent?.trim() || "",
    editLabel: document.querySelector("#annotateButton span:last-child")?.textContent?.trim() || "",
    copyTitle: document.querySelector("#copyImageButton")?.title || "",
    pngTitle: document.querySelector("#downloadPngButton")?.title || "",
    editTitle: document.querySelector("#annotateButton")?.title || "",
    pdfDisabled: document.querySelector("#exportPdfButton")?.disabled ?? true,
    annotateDisabled: document.querySelector("#annotateButton")?.disabled ?? true,
    pageLabel: document.querySelector("#fitPageButton")?.textContent?.trim() || ""
  }));
  const limitedReviewTitles = [
    limitedReviewState.copyTitle,
    limitedReviewState.pngTitle,
    limitedReviewState.editTitle
  ].join(" ");
  assert(
    /Complete-page review image/i.test(limitedReviewState.source) &&
      /240×1,200 complete-page review image/i.test(limitedReviewState.source) &&
      /No full-resolution saved file is still attached/i.test(limitedReviewState.source) &&
      limitedReviewState.mainDimensions === "240×1,200 review" &&
      limitedReviewState.originalDimensions === "1,200×6,000" &&
      limitedReviewState.copyLabel === "Copy view" &&
      limitedReviewState.pngLabel === "View PNG" &&
      limitedReviewState.editLabel === "Edit view" &&
      !limitedReviewState.pdfDisabled &&
      !limitedReviewState.annotateDisabled &&
      limitedReviewState.pageLabel === "Page",
    "A bounded complete-page review source lost its honest dimensions or usable review actions.",
    limitedReviewState
  );
  assert(
    (limitedReviewTitles.match(/No full-resolution saved file is attached\./g) || []).length === 3 &&
      !/unchanged|Use Details for saved/i.test(limitedReviewTitles),
    "Limited review tooltips claimed that a full-resolution saved file existed when none was attached.",
    limitedReviewState
  );

  await resultPage.goto(
    `chrome-extension://${extensionId}/result.html?capture=${encodeURIComponent(transparentLassoCaptureId)}`,
    { waitUntil: "load" }
  );
  await resultPage.waitForSelector('body[data-state="ready"] #resultImage:not([hidden])', { timeout: 10000 });
  const transparentLassoState = await resultPage.evaluate(() => {
    const image = document.querySelector("#resultImage");
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { alpha: true });
    context.drawImage(image, 0, 0);
    const cornerAlpha = context.getImageData(0, 0, 1, 1).data[3];
    const centerAlpha = context.getImageData(
      Math.floor(canvas.width / 2),
      Math.floor(canvas.height / 2),
      1,
      1
    ).data[3];

    return {
      source: document.querySelector("#resultSource")?.textContent?.trim() || "",
      imageBackground: getComputedStyle(image).backgroundColor,
      transparentClass: image.classList.contains("is-transparent-image"),
      checkerboardClass: document.querySelector("#resultViewport")?.classList.contains("has-transparent-image") || false,
      cornerAlpha,
      centerAlpha,
      openLabel: document.querySelector("#openOriginalButton")?.textContent?.trim() || "",
      showLabel: document.querySelector("#showOriginalButton")?.textContent?.trim() || ""
    };
  });
  assert(
    /Transparent lasso crop/i.test(transparentLassoState.source) &&
      transparentLassoState.imageBackground === "rgba(0, 0, 0, 0)" &&
      transparentLassoState.transparentClass &&
      transparentLassoState.checkerboardClass &&
      transparentLassoState.cornerAlpha === 0 &&
      transparentLassoState.centerAlpha === 255 &&
      transparentLassoState.openLabel === "Open saved crop" &&
      transparentLassoState.showLabel === "Show in folder",
    "The result workspace did not preserve and visibly present a transparent lasso crop.",
    transparentLassoState
  );
  await resultPage.evaluate(async ({
    degradedCaptureId,
    thumbnailCaptureId,
    limitedReviewCaptureId: reviewCaptureId,
    lassoCaptureId,
    staleCaptureId
  }) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    await Promise.all([
      store.deleteLibraryCapture(degradedCaptureId),
      store.deleteLibraryCapture(thumbnailCaptureId),
      store.deleteLibraryCapture(reviewCaptureId),
      store.deleteLibraryCapture(lassoCaptureId),
      store.deleteLibraryCapture(staleCaptureId)
    ]);
  }, {
    degradedCaptureId: degradedResultCaptureId,
    thumbnailCaptureId: thumbnailResultCaptureId,
    limitedReviewCaptureId,
    lassoCaptureId: transparentLassoCaptureId,
    staleCaptureId: staleDownloadCaptureId
  });
  await resultPage.close();

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
  await popup.waitForSelector("#openLastCaptureButton:not([hidden])", { timeout: 10000 });
  await popup.waitForSelector("#captureButton:not(:disabled)", { timeout: 10000 });
  const popupState = await popup.evaluate(() => ({
    title: document.title,
    target: document.querySelector("#targetHost").textContent,
    scopes: [...document.querySelectorAll("[data-scope]")].map(node => node.dataset.scope),
    lastCapture: document.querySelector("#lastCapture").dataset.captureId,
    duplicateWorkspaces: document.querySelectorAll("#analyzeButton, #historyList, #captureShelfGrid, #photoLibraryGrid, #watchPlanCard").length,
    captureBottom: document.querySelector("#captureButton").getBoundingClientRect().bottom
  }));
  assert(popupState.title === "Lumen" && popupState.target === "lumen-smoke.test", "Launcher did not resolve the fixture.", popupState);
  assert(popupState.scopes.join(",") === "desktop,visible,area,responsive", "Capture scopes changed.", popupState);
  assert(popupState.lastCapture && popupState.duplicateWorkspaces === 0, "Launcher reintroduced persistent workspaces.", popupState);
  assert(popupState.captureBottom <= 600, "Primary action falls outside the popup viewport.", popupState);
  if (process.env.LUMEN_POPUP_PROOF) {
    await popup.locator("body").screenshot({ path: process.env.LUMEN_POPUP_PROOF });
  }
  await popup.click('[data-scope="area"]');
  assert(await popup.locator("#areaControls").isVisible(), "Area scope did not expose selection tools.");
  assert(await popup.locator('input[name="shape"]').count() === 2, "Rectangle/lasso choices are missing.");
  await popup.click('[data-scope="responsive"]');
  assert(await popup.locator("#captureButton").textContent() === "Capture responsive set", "Set action label did not update.");
  assert(await popup.locator("#areaControls").isHidden(), "Area tools remained visible in set scope.");
  await popup.locator('[data-scope="visible"]').focus();
  await popup.keyboard.press("Enter");
  assert(await popup.locator('[data-scope="visible"]').getAttribute("aria-pressed") === "true", "Scope selection is not keyboard accessible.");
  const unchangedHistory = await popup.evaluate(async () => (await chrome.storage.local.get("lumen.capture.history"))["lumen.capture.history"].length);
  assert(unchangedHistory === 1, "Choosing scopes accidentally started a capture.");

  const monitorPage = await context.newPage();
  monitorPage.on("pageerror", error => popupConsoleErrors.push(error.message));
  await monitorPage.goto(`chrome-extension://${extensionId}/library.html#monitors`);
  await monitorPage.waitForSelector("#monitors:not([hidden])");
  assert(await monitorPage.locator("#captures").isHidden(), "Monitor navigation leaves duplicate capture workspace visible.");
  await monitorPage.selectOption("#monitorMode", "continuous");
  assert(await monitorPage.locator("#monitorLimitField").isVisible(), "Continuous monitor lost its run limit.");
  await monitorPage.fill("#monitorLimit", "10");
  assert((await monitorPage.locator("#monitorEstimate").textContent()).includes("10"), "Monitor estimate does not follow the run limit.");
  await monitorPage.selectOption("#monitorMode", "repeat");
  assert(await monitorPage.locator("#monitorInterval").getAttribute("min") === "15", "Repeat cadence lost its lower bound.");
  await worker.evaluate(() => chrome.storage.local.set({
    "lumen.capture.cutawayRegions": {
      "https://lumen-smoke.test/": {
        url: "https://lumen-smoke.test/",
        region: { id: "launcher-area", left: 0, top: 0, width: 200, height: 120, shape: "rect" }
      }
    }
  }));
  await monitorPage.waitForFunction(() => document.querySelector("#monitorArea")?.options[0]?.textContent.includes("Rectangle"));
  await monitorPage.click('#monitorForm button[type="submit"]');
  await monitorPage.waitForSelector("#monitorList .monitor-card");
  await monitorPage.getByRole("button", { name: "Pause", exact: true }).click();
  await monitorPage.getByRole("button", { name: "Resume", exact: true }).waitFor();
  const pausedMonitor = await worker.evaluate(async () => {
    const plans = (await chrome.storage.local.get("lumen.watch.plans"))["lumen.watch.plans"];
    return { plan: plans[0], alarm: await chrome.alarms.get("lumen.watch." + plans[0].id) };
  });
  assert(pausedMonitor.plan.status === "paused" && !pausedMonitor.alarm, "Pausing in Library did not clear its alarm.", pausedMonitor);
  await monitorPage.getByRole("button", { name: "Edit schedule", exact: true }).click();
  await monitorPage.fill("#monitorInterval", "30");
  await monitorPage.click('#monitorForm button[type="submit"]');
  await monitorPage.waitForFunction(() => document.querySelector("#monitorList").textContent.includes("Every 30 minutes"));
  const editedMonitor = await worker.evaluate(async () => {
    const plans = (await chrome.storage.local.get("lumen.watch.plans"))["lumen.watch.plans"];
    return { count: plans.length, plan: plans[0], alarm: await chrome.alarms.get("lumen.watch." + plans[0].id) };
  });
  assert(editedMonitor.count === 1 && editedMonitor.plan.status === "active" && editedMonitor.alarm?.periodInMinutes === 30, "Editing created a duplicate or failed to update the alarm.", editedMonitor);
  monitorPage.once("dialog", dialog => dialog.accept());
  await monitorPage.getByRole("button", { name: "Delete", exact: true }).click();
  await monitorPage.waitForFunction(() => document.querySelector("#monitorList").textContent.includes("No monitors saved"));
  await monitorPage.close();

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

  await popup.waitForFunction(() => document.querySelector("#launchStatusTitle").textContent === "Open a webpage first");
  const blockedState = await popup.evaluate(() => ({
    title: document.querySelector("#launchStatusTitle").textContent,
    disabled: document.querySelector("#captureButton").disabled
  }));
  assert(blockedState.disabled, "Capture should be disabled without a capturable target.", blockedState);

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
    resultWorkspace: resultWorkspaceState,
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
