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
const expectedVariantCount = 3;
const expectedCutawayCount = expectedVariantCount;

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
    viewport: null,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`
    ]
  });

  const worker = await getExtensionWorker(context);
  const extensionId = new URL(worker.url()).host;

  const target = await context.newPage();
  await target.goto(fixture.url, { waitUntil: "networkidle" });
  await seedCutawayRegion(worker, fixture.url);

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
    annotationText: "E2E responsive review artifact",
    annotationPosition: "top-right",
    devicePreset: "responsive",
    exportPreset: "raw"
  };

  const review = await popup.evaluate((captureOptions) =>
    chrome.runtime.sendMessage({
      type: "LUMEN_PREVIEW_EXPORT_REVIEW",
      payload: {
        options: captureOptions
      }
    }), options);

  assert(review?.ok, "Pre-export review failed.", review);
  assert(review.variantCount === expectedVariantCount, "Expected pre-export review to inspect the responsive set.", review);
  assert(review.cutawayAppliedCount === expectedCutawayCount, "Expected pre-export review to resolve cutaways for each view.", review);
  assert(review.autoRedactionCount >= expectedVariantCount * 3, "Expected pre-export review to scan sensitive regions.", review);
  assert(review.variants?.every((variant) => variant.cutawayApplied), "Expected every reviewed variant to have a cutaway crop ready.", review.variants);
  assert(review.variants?.every((variant) => variant.preview?.pageWidth > 0 && variant.preview?.pageHeight > 0), "Expected every review variant to include preview dimensions.", review.variants);
  assert(
    review.variants?.filter((variant) => variant.id !== "desktop").every((variant) => {
      const expected = variant.id === "tablet" ? { width: 1024, height: 1366 } : { width: 430, height: 932 };
      return Math.abs(variant.dimensions?.browserViewportWidth - expected.width) <= 1 &&
        variant.dimensions?.browserViewportHeight > 0;
    }),
    "Expected responsive review windows to use exact CSS viewport sizes.",
    review.variants
  );
  assert(review.outputPlan?.length === 3, "Expected pre-export review to return an output plan.", review.outputPlan);
  assert(review.outputPlan?.some((item) => item.label === "Artifacts" && /planned/.test(item.value)), "Expected output plan to summarize planned files.", review.outputPlan);
  assert(review.outputPlan?.some((item) => item.label === "Long Pages"), "Expected output plan to describe long-page behavior.", review.outputPlan);
  assert(
    review.variants?.every((variant) =>
      variant.preview?.regions?.some((region) => region.role === "auto") &&
      variant.preview?.regions?.some((region) => region.role === "cutaway")
    ),
    "Expected review preview maps to include auto-redaction and cutaway overlays.",
    review.variants
  );
  assert(review.warnings?.some((warning) => /reviewed before external sharing/i.test(warning)), "Expected redaction safety warning in pre-export review.", review.warnings);

  const response = await popup.evaluate((captureOptions) =>
    chrome.runtime.sendMessage({
      type: "LUMEN_START_CAPTURE",
      payload: {
        options: captureOptions
      }
    }), options);

  assert(response?.ok, "Loaded extension capture failed.", response);
  assert(response.variantCount === expectedVariantCount, "Expected responsive capture set.", response);
  assert(response.cutawayCount === expectedCutawayCount, "Expected focused cutaway exports from the stored region.", response);
  assert(response.cutawayResolutionStats?.appliedCount === expectedCutawayCount, "Expected cutaway region to resolve during capture.", response);
  assert(response.files?.length >= expectedVariantCount + expectedCutawayCount + 1, "Expected responsive images, a cutaway image, and manifest downloads.", response);
  assert(response.archiveFolder?.startsWith("Lumen/"), "Expected organized Lumen archive folder.", response);
  assert(response.redactionCount >= expectedVariantCount * 3, "Expected automatic redactions across responsive views.", response);
  assert(response.segmentCount >= expectedVariantCount * 2, "Expected full-page capture to stitch multiple responsive views.", response);
  assert(response.captureHealth?.status === "complete", "Expected capture response to verify full-page integrity.", response.captureHealth);
  assert(response.captureHealth?.verifiedVariantCount === expectedVariantCount, "Expected every responsive view to pass capture health.", response.captureHealth);
  assert(response.downloads.every((item) => Number.isInteger(item.downloadId)), "Expected Chrome download handles.", response.downloads);
  assert(response.downloads.every((item) => item.bytesReceived > 0), "Expected completed downloads with bytes.", response.downloads);
  assert(response.librarySaved, "Expected the completed capture to create a local photo-library record.", response);

  const libraryState = await popup.evaluate(async (captureId) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    const capture = await store.getLibraryCapture(captureId, {
      includePreview: true,
      includeEditorSource: true
    });
    const localStorage = await chrome.storage.local.get(null);

    return {
      count: await store.countLibraryCaptures(),
      id: capture?.id || "",
      sourceType: capture?.sourceType || "",
      previewCount: capture?.previewAssetIds?.length || 0,
      previewType: capture?.preview?.blob?.type || "",
      previewBytes: capture?.preview?.blob?.size || 0,
      previewWidth: capture?.preview?.width || 0,
      previewHeight: capture?.preview?.height || 0,
      editorType: capture?.editorSource?.blob?.type || "",
      editorBytes: capture?.editorSource?.blob?.size || 0,
      editorWidth: capture?.editorSource?.width || 0,
      editorHeight: capture?.editorSource?.height || 0,
      editorOriginalWidth: capture?.editorSource?.originalWidth || 0,
      editorOriginalHeight: capture?.editorSource?.originalHeight || 0,
      editorPurpose: capture?.editorSource?.purpose || "",
      downloadCount: capture?.downloads?.length || 0,
      storageContainsPreviewDataUrl: JSON.stringify(localStorage).includes("data:image/")
    };
  }, response.captureId);

  assert(libraryState.count === 1 && libraryState.id === response.captureId, "Expected one linked capture in the local photo library.", libraryState);
  assert(libraryState.sourceType === "manual", "Expected the library to distinguish manual captures.", libraryState);
  assert(libraryState.previewCount === expectedVariantCount + expectedCutawayCount, "Expected a preview for every downloaded PNG view.", libraryState);
  assert(libraryState.previewType === "image/webp" && libraryState.previewBytes > 0, "Expected a real WebP preview blob in IndexedDB.", libraryState);
  assert(
    libraryState.editorType === "image/png" &&
      libraryState.editorBytes > 0 &&
      libraryState.editorWidth > 360 &&
      libraryState.editorHeight > 240 &&
      libraryState.editorPurpose === "editor-source",
    "Expected a distinct whole-capture PNG editor source in IndexedDB.",
    libraryState
  );
  assert(
    libraryState.editorOriginalWidth >= libraryState.editorWidth &&
      libraryState.editorOriginalHeight >= libraryState.editorHeight,
    "Stored editor source dimensions lost their full-page provenance.",
    libraryState
  );
  assert(libraryState.downloadCount === response.downloads.length, "Expected library file actions to retain all download handles.", libraryState);
  assert(!libraryState.storageContainsPreviewDataUrl, "Preview image data leaked into chrome.storage.local.", libraryState);

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
  assert(latest?.variants?.length === expectedVariantCount, "Expected history to store responsive variants.", latest);
  assert(latest.redactionCount >= expectedVariantCount * 3, "Expected history redaction count.", latest);
  assert(latest.cutawayCount === expectedCutawayCount, "Expected history cutaway count.", latest);
  assert(latest.captureHealth?.status === "complete", "Expected history to retain capture integrity evidence.", latest);
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

  const imageItems = downloads.filter((item) => item.lumenRecord.kind === "image");
  const fullPageImageItems = imageItems.filter((item) => item.lumenRecord.role !== "cutaway");
  const cutawayImageItems = imageItems.filter((item) => item.lumenRecord.role === "cutaway");
  const manifestItem = downloads.find((item) => item.lumenRecord.kind === "manifest");
  const capturedVariantIds = new Set(fullPageImageItems.map((item) => item.lumenRecord.variantId));

  assert(imageItems.length === expectedVariantCount + expectedCutawayCount, "Expected responsive PNGs plus the focused cutaway PNG.", downloads);
  assert(fullPageImageItems.length === expectedVariantCount, "Expected one full-page PNG capture artifact per responsive view.", downloads);
  assert(cutawayImageItems.length === expectedCutawayCount, "Expected exactly one cutaway PNG artifact.", downloads);
  assert(capturedVariantIds.has("desktop") && capturedVariantIds.has("tablet") && capturedVariantIds.has("mobile"), "Expected desktop, tablet, and mobile image downloads.", downloads);
  assert(
    new Set(cutawayImageItems.map((item) => item.lumenRecord.variantId)).size === expectedVariantCount,
    "Expected one cutaway artifact for each responsive view.",
    downloads
  );
  assert(manifestItem, "Expected a capture details JSON file.", downloads);

  const imageInfos = [];

  for (const imageItem of imageItems) {
    const imageInfo = {
      variantId: imageItem.lumenRecord.variantId,
      role: imageItem.lumenRecord.role || "full-page",
      ...(await assertPng(imageItem.filename))
    };

    if (imageInfo.role === "cutaway") {
      imageInfo.alpha = await samplePngAlpha(popup, imageItem.filename);
    }

    imageInfos.push(imageInfo);
  }

  const cutawayInfo = imageInfos.find((info) => info.role === "cutaway");

  const manifest = JSON.parse(await readFile(manifestItem.filename, "utf8"));

  assert(manifest.capture.archiveFolder === response.archiveFolder, "Expected manifest archive folder to match response.", manifest.capture);
  assert(manifest.capture.variantCount === expectedVariantCount, "Expected manifest responsive variant metadata.", manifest.capture);
  assert(manifest.capture.health?.status === "complete", "Expected manifest to record verified capture health.", manifest.capture.health);
  assert(manifest.variants?.length === expectedVariantCount, "Expected manifest variant records.", manifest.variants);
  assert(
    manifest.variants.filter((variant) => variant.id !== "desktop").every((variant) => variant.viewport?.widthExact === true),
    "Expected responsive manifest records to prove exact CSS-width calibration.",
    manifest.variants
  );
  assert(manifest.capture.artifactStats?.complete, "Expected manifest to mark output artifacts complete.", manifest.capture);
  assert(manifest.capture.artifactStats?.imageCount === expectedVariantCount + expectedCutawayCount, "Expected manifest image artifact count.", manifest.capture);
  assert(manifest.capture.artifactStats?.cutawayCount === expectedCutawayCount, "Expected manifest cutaway artifact count.", manifest.capture);
  assert(manifest.capture.cutawayCount === expectedCutawayCount, "Expected manifest capture cutaway count.", manifest.capture);
  assert(manifest.capture.cutawayResolutionStats?.appliedCount === expectedCutawayCount, "Expected manifest cutaway resolution stats.", manifest.capture);
  assert(manifest.capture.artifactStats?.bytesReceived > 0, "Expected manifest byte count.", manifest.capture);
  assert(manifest.capture.redactionCount >= expectedVariantCount * 3, "Expected manifest redaction metadata.", manifest.capture);
  assert(manifest.capture.annotation?.text === "E2E responsive review artifact", "Expected manifest annotation metadata.", manifest.capture);
  assert(
    manifest.variants.every((variant) =>
        variant.artifactStats?.complete &&
        variant.outputs?.length >= 1 &&
        variant.outputs.every((output) => output.complete && output.bytesReceived > 0) &&
        variant.health?.status === "complete" &&
        variant.dimensions?.width > 0 &&
        variant.dimensions?.height > 0
    ),
    "Expected per-variant artifact health and dimensions in the manifest.",
    manifest.variants
  );
  assert(
    imageInfos.every((info) => {
      if (info.role === "cutaway") {
        return true;
      }

      const variant = manifest.variants.find((item) => item.id === info.variantId);

      return variant &&
        info.width === variant.dimensions.width &&
        info.height === variant.dimensions.height;
    }),
    "Expected PNG dimensions to align with manifest variants.",
    {
      imageInfos,
      variants: manifest.variants
    }
  );
  assert(
    cutawayInfo &&
      cutawayInfo.width < manifest.variants.find((variant) => variant.id === "desktop")?.dimensions?.width &&
      cutawayInfo.height < manifest.variants.find((variant) => variant.id === "desktop")?.dimensions?.height,
        "Expected cutaway PNG to be smaller than the full desktop capture.",
    { cutawayInfo, variants: manifest.variants }
  );
  assert(
    imageInfos.filter((info) => info.role === "cutaway").every((info) =>
      info.alpha?.corner === 0 && info.alpha?.center === 255
    ),
    "Expected every lasso cutaway PNG to keep transparent exterior pixels and opaque selected pixels.",
    imageInfos.filter((info) => info.role === "cutaway")
  );
  assert(
    manifest.variants.some((variant) =>
      variant.outputs?.some((output) =>
        output.role === "cutaway" &&
        output.cutawayRegion?.width > 0 &&
        output.cutawayRegion?.height > 0
      )
    ),
    "Expected manifest to mark the cutaway output and its region.",
    manifest.variants
  );
  assert(manifest.pageSignals?.heroHeadline, "Expected page signals in capture details JSON.", manifest.pageSignals);

  const savedCutaway = await worker.evaluate(async (rawUrl) => {
    const url = new URL(rawUrl);
    const key = `${url.origin}${url.pathname}${url.search}`;
    const stored = await chrome.storage.local.get("lumen.capture.cutawayRegions");
    return stored["lumen.capture.cutawayRegions"]?.[key]?.region || null;
  }, fixture.url);
  const watchSave = await popup.evaluate(({ rawUrl, region }) => chrome.runtime.sendMessage({
    type: "LUMEN_SAVE_WATCH_PLAN",
    payload: {
      title: "E2E selected area monitor",
      url: rawUrl,
      status: "active",
      selectionMode: "lasso",
      region,
      schedule: {
        mode: "continuous",
        intervalMinutes: 1,
        maxRuns: 2,
        saveOnlyWhenChanged: true,
        timezone: "UTC"
      },
      destination: "local"
    }
  }), { rawUrl: fixture.url, region: savedCutaway });

  assert(watchSave?.ok && watchSave.watchPlan?.id, "Expected Local beta to save a selected-area monitor without sign-in.", watchSave);
  const watchAlarm = await worker.evaluate((watchPlanId) => chrome.alarms.get(`lumen.watch.${watchPlanId}`), watchSave.watchPlan.id);
  assert(watchAlarm?.periodInMinutes === 1, "Expected continuous monitoring to create a one-minute recurring alarm.", watchAlarm);

  const firstWatchRun = await popup.evaluate((watchPlanId) => chrome.runtime.sendMessage({
    type: "LUMEN_RUN_WATCH_PLAN_NOW",
    payload: { watchPlanId }
  }), watchSave.watchPlan.id);
  const firstWatchRecord = firstWatchRun.watchRuns?.find((run) => run.watchPlanId === watchSave.watchPlan.id);
  assert(firstWatchRun?.ok && firstWatchRecord?.status === "captured", "Expected the first monitor run to save a selected-area photo.", firstWatchRun);
  assert(firstWatchRecord.fileCount === 1 && firstWatchRecord.captureId, "Expected the first monitor run to save only one selected-area PNG.", firstWatchRecord);

  const secondWatchRun = await popup.evaluate((watchPlanId) => chrome.runtime.sendMessage({
    type: "LUMEN_RUN_WATCH_PLAN_NOW",
    payload: { watchPlanId }
  }), watchSave.watchPlan.id);
  const secondWatchRecord = secondWatchRun.watchRuns?.find((run) => run.watchPlanId === watchSave.watchPlan.id);
  const completedWatchPlan = secondWatchRun.watchPlans?.find((plan) => plan.id === watchSave.watchPlan.id);
  assert(secondWatchRun?.ok && secondWatchRecord?.status === "unchanged", "Expected an identical continuous run to skip its duplicate photo.", secondWatchRun);
  assert(secondWatchRecord.fileCount === 0 && secondWatchRecord.changePercent <= 1.5, "Expected unchanged monitoring to create no downloaded file.", secondWatchRecord);
  assert(completedWatchPlan?.status === "completed" && completedWatchPlan.runCount === 2, "Expected the capped continuous monitor to stop after two checks.", completedWatchPlan);

  const monitorState = await popup.evaluate(async ({ watchPlanId, firstCaptureId }) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    const captures = await store.listLibraryCaptures({ limit: 20 });
    const storage = await chrome.storage.local.get(["lumen.capture.history", "lumen.watch.runs"]);
    const alarm = await chrome.alarms.get(`lumen.watch.${watchPlanId}`);
    const timedHistory = (storage["lumen.capture.history"] || []).find((capture) => capture.id === firstCaptureId);

    return {
      libraryCount: captures.length,
      timedLibraryCount: captures.filter((capture) => capture.sourceType === "timed").length,
      historyCount: storage["lumen.capture.history"]?.length || 0,
      watchRunCount: (storage["lumen.watch.runs"] || []).filter((run) => run.watchPlanId === watchPlanId).length,
      timedFiles: timedHistory?.files?.length || 0,
      timedManifest: timedHistory?.manifestFile || "",
      timedSourceType: timedHistory?.sourceType || "",
      alarmExists: Boolean(alarm)
    };
  }, { watchPlanId: watchSave.watchPlan.id, firstCaptureId: firstWatchRecord.captureId });

  assert(monitorState.libraryCount === 2 && monitorState.timedLibraryCount === 1, "Expected duplicate suppression to keep only one timed photo in the library.", monitorState);
  assert(monitorState.historyCount === 2 && monitorState.watchRunCount === 2, "Expected manual and changed timed captures plus two monitor-run records.", monitorState);
  assert(monitorState.timedFiles === 1 && !monitorState.timedManifest && monitorState.timedSourceType === "timed", "Expected timed history to contain only its selected-area PNG and no manifest download.", monitorState);
  assert(!monitorState.alarmExists, "Expected the completed continuous monitor alarm to be cleared.", monitorState);

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
      variantCount: response.variantCount,
      segmentCount: response.segmentCount,
      redactionCount: response.redactionCount,
      cutawayCount: response.cutawayCount,
      bytesReceived: manifest.capture.artifactStats.bytesReceived,
      manifestFile: response.manifestFile
    },
    history: {
      count: history.length,
      latestTitle: latest.title,
      archiveFolder: latest.archiveFolder,
      variantCount: latest.variants.length
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
  await cleanupTemporaryPath(tempRoot, "extension capture e2e temp root");
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

async function seedCutawayRegion(worker, fixtureUrl) {
  await worker.evaluate(async (rawUrl) => {
    const url = new URL(rawUrl);
    const key = `${url.origin}${url.pathname}${url.search}`;
    const sourceViewport = {
      viewportWidth: 1280,
      viewportHeight: 900,
      pageHeight: 1800,
      scrollMode: "document",
      scrollContainer: "document"
    };

    await chrome.storage.local.set({
      "lumen.capture.cutawayRegions": {
        [key]: {
          url: rawUrl,
          host: url.host,
          updatedAt: new Date().toISOString(),
          context: sourceViewport,
          region: {
            id: "e2e-cutaway-region",
            kind: "cutaway",
            shape: "lasso",
            left: 652,
            top: 424,
            width: 300,
            height: 220,
            points: [
              { x: 802, y: 424 },
              { x: 952, y: 534 },
              { x: 802, y: 644 },
              { x: 652, y: 534 }
            ],
            sourceViewport,
            anchor: {
              selector: ".proof .card:nth-child(2)",
              tagName: "article",
              sourceRect: {
                left: 652,
                top: 424,
                width: 508,
                height: 280
              },
              ratios: {
                left: 0.08,
                top: 0.08,
                width: 0.68,
                height: 0.72
              }
            }
          },
          regions: []
        }
      }
    });
  }, fixtureUrl);
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

  return {
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20),
    size: stats.size
  };
}

async function samplePngAlpha(page, filename) {
  const base64 = (await readFile(filename)).toString("base64");

  return page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);

    return {
      corner: context.getImageData(0, 0, 1, 1).data[3],
      center: context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3]
    };
  }, base64);
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
