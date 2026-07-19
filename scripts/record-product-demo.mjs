import { createServer } from "node:http";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.resolve(
  process.env.LUMEN_DEMO_OUTPUT_DIR || path.join(os.tmpdir(), "lumen-product-demo")
);
const paceMs = boundedNumber(process.env.LUMEN_DEMO_PACE_MS, 760, 80, 5000);
const captureTimeoutMs = boundedNumber(process.env.LUMEN_DEMO_CAPTURE_TIMEOUT_MS, 45_000, 10_000, 300_000);
const skipCapture = /^(1|true|yes)$/i.test(process.env.LUMEN_DEMO_SKIP_CAPTURE || "");
const keepProfile = /^(1|true|yes)$/i.test(process.env.LUMEN_DEMO_KEEP_PROFILE || "");
const executablePath = process.env.LUMEN_DEMO_EXECUTABLE_PATH || undefined;
const viewport = { width: 1280, height: 720 };
const videoName = "lumen-product-demo.webm";
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lumen-product-demo-"));
const extensionDir = path.join(tempRoot, "extension");
const profileDir = path.join(tempRoot, "profile");
const downloadsDir = path.join(tempRoot, "downloads");
const videoStagingDir = path.join(tempRoot, "video");
const warnings = [];
const stills = [];
const exportedFiles = [];
const runtimeErrors = [];

let context;
let server;
let recordedPage;
let recordedVideo;

try {
  milestone("Preparing temporary extension and browser profile");
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    mkdir(downloadsDir, { recursive: true }),
    mkdir(videoStagingDir, { recursive: true })
  ]);
  await prepareExtensionCopy();
  await prepareChromeProfile();

  const fixture = await startFixtureServer();
  server = fixture.server;

  milestone("Launching Chromium with the unpacked extension");
  context = await chromium.launchPersistentContext(profileDir, {
    acceptDownloads: true,
    downloadsPath: downloadsDir,
    executablePath,
    headless: false,
    viewport,
    recordVideo: {
      dir: videoStagingDir,
      size: viewport
    },
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--disable-search-engine-choice-screen",
      "--no-first-run"
    ]
  });

  milestone("Waiting for the Lumen service worker");
  const worker = await getExtensionWorker(context);
  const extensionId = new URL(worker.url()).host;
  await seedExtensionState(worker);

  milestone("Opening the real capture fixture and recording stage");
  const target = await getInitialPage(context);
  await target.goto(fixture.url, { waitUntil: "networkidle" });
  await target.setViewportSize(viewport);

  recordedPage = await context.newPage();
  recordedVideo = recordedPage.video();
  recordedPage.setDefaultTimeout(20_000);
  recordRuntimeErrors(recordedPage, runtimeErrors, "stage");
  await recordedPage.goto(`chrome-extension://${extensionId}/demo-stage.html`, { waitUntil: "load" });
  await recordedPage.locator("#siteFrame").evaluate((frame, url) => {
    frame.src = url;
  }, fixture.url);
  await waitForFrameUrl(recordedPage, "lumenDemoSite", fixture.url);

  // Keep the real fixture tab active. The popup is driven through DevTools while
  // it remains in the recorded stage, matching Chrome's toolbar-popup workflow.
  await target.bringToFront();
  const popup = await navigateAppFrame(recordedPage, `chrome-extension://${extensionId}/popup.html`);
  recordRuntimeErrors(popup, runtimeErrors, "popup");
  await popup.locator("#captureButton").waitFor();
  await popup.locator('#launchStatus[data-state="ready"]').waitFor({ timeout: 15_000 });

  milestone("Recording privacy controls and the capture review");
  await setScene(recordedPage, {
    chapter: "01 / Capture",
    title: "Privacy you can see before save.",
    copy: "Choose what Lumen cleans and redacts, then review the exact output before anything is written.",
    mode: "split"
  });
  await popup.locator(".controls-panel").scrollIntoViewIfNeeded();
  await pause(0.8);
  await toggleWithCursor(recordedPage, popup, "#autoRedact", ".toggle-row:has(#autoRedact) .toggle-shell", false);
  await pause(0.45);
  await toggleWithCursor(recordedPage, popup, "#autoRedact", ".toggle-row:has(#autoRedact) .toggle-shell", true);
  await pause(0.75);
  await saveStill(recordedPage, "01-privacy-controls.png");

  await popup.locator("#launchPanel").scrollIntoViewIfNeeded();
  await setScene(recordedPage, {
    chapter: "01 / Capture",
    title: "Click once. Keep the whole page.",
    copy: "The current site stays visible while Lumen prepares a clean, full-page local capture.",
    mode: "split"
  });
  await pause(0.65);

  if (!skipCapture) {
    await clickWithCursor(recordedPage, popup, "#captureButton");
    await popup.locator("#exportReviewPanel:not(.is-hidden)").waitFor({ timeout: captureTimeoutMs });
    await popup.locator("#exportReviewPanel").scrollIntoViewIfNeeded();
    await pause(1.1);
    await saveStill(recordedPage, "02-save-review.png");
    await clickInBackgroundWithCursor(recordedPage, target, popup, "#exportReviewConfirmButton");
    try {
      await popup.waitForFunction(() => {
        const title = document.querySelector("#statusTitle")?.textContent?.trim() || "";
        return title === "Capture complete" || title === "Capture failed";
      }, null, { timeout: captureTimeoutMs });
    } catch (error) {
      const diagnostics = await readCaptureDiagnostics(popup);
      throw new Error(`Capture did not finish within ${captureTimeoutMs}ms. ${formatCaptureDiagnostics(diagnostics)}`, {
        cause: error
      });
    }
    const diagnostics = await readCaptureDiagnostics(popup);
    if (diagnostics.title !== "Capture complete") {
      throw new Error(`Capture did not complete. ${formatCaptureDiagnostics(diagnostics)}`);
    }
    await popup.locator("#statusPanel").scrollIntoViewIfNeeded();
    await pause(1.2);
    await saveStill(recordedPage, "03-capture-complete.png");
    await seedDemoLibraryCaptures(popup, fixture.url, false);
    milestone("Real full-page capture completed");
  } else {
    warnings.push("Real capture was skipped because LUMEN_DEMO_SKIP_CAPTURE is enabled.");
    await seedDemoLibraryCaptures(popup, fixture.url, true);
  }

  await setScene(recordedPage, {
    chapter: "02 / Library",
    title: "Every useful capture stays findable.",
    copy: "Preview locally, favorite it, reopen the original, annotate it, or compare it with a later run.",
    mode: "full"
  });
  const library = await navigateAppFrame(recordedPage, `chrome-extension://${extensionId}/library.html`);
  recordRuntimeErrors(library, runtimeErrors, "library");
  await library.locator("#captureGrid .capture-card").first().waitFor({ timeout: 20_000 });
  await library.locator("#captureGrid").scrollIntoViewIfNeeded();
  await library.locator("#captureGrid .capture-preview:not(.is-hidden)").first().waitFor({ timeout: 5_000 }).catch(() => {
    warnings.push("The library card preview did not decode before its scene; capture details still verify the local image.");
  });
  await pause(1.05);
  await saveStill(recordedPage, "04-capture-library.png");
  await clickWithCursor(recordedPage, library, "#captureGrid .capture-card .preview-button");
  await library.locator("#captureDialog[open]").waitFor();
  await pause(0.9);
  await saveStill(recordedPage, "05-library-detail.png");
  milestone("Local capture library recorded");

  await setScene(recordedPage, {
    chapter: "03 / Annotate + export",
    title: "Zoom in. Mark it up. Export the result.",
    copy: "Arrows, rectangles, text, blur, and pixelation remain editable until a new PNG or PDF is exported.",
    mode: "full"
  });
  const editor = await navigateAppFrame(recordedPage, `chrome-extension://${extensionId}/editor.html?demo=1`);
  recordRuntimeErrors(editor, runtimeErrors, "editor");
  await editor.addStyleTag({
    content: ".editor-layout{min-height:0!important;height:calc(100vh - 74px)!important}"
  });
  await editor.locator("#canvasFrame:not(.is-hidden)").waitFor({ timeout: 15_000 });
  await editor.locator("#exportButton:not([disabled])").waitFor();
  await pause(0.75);
  const initialAnnotationCount = await editor.evaluate(() => globalThis.LumenAnnotationEditor?.getAnnotationCount?.() || 0);
  await clickWithCursor(recordedPage, editor, '[data-tool="rectangle"]');
  await drawCanvasGesture(recordedPage, editor, { x: 0.56, y: 0.28 }, { x: 0.77, y: 0.52 });
  await clickWithCursor(recordedPage, editor, '[data-tool="arrow"]');
  await drawCanvasGesture(recordedPage, editor, { x: 0.31, y: 0.39 }, { x: 0.56, y: 0.61 });
  await editor.waitForFunction((count) => (globalThis.LumenAnnotationEditor?.getAnnotationCount?.() || 0) >= count + 2, initialAnnotationCount);
  await clickWithCursor(recordedPage, editor, "#zoomInButton");
  await pause(0.75);
  await clickWithCursor(recordedPage, editor, "#undoButton");
  await pause(0.35);
  await clickWithCursor(recordedPage, editor, "#redoButton");
  await pause(0.8);
  await saveStill(recordedPage, "06-annotation-editor.png");

  const pngExport = await renderEditorExport(editor, "png");
  const pngPath = path.join(outputDir, "lumen-demo-annotated.png");
  await writeFile(pngPath, Buffer.from(pngExport.base64, "base64"));
  await assertFileHasBytes(pngPath, 1024);
  exportedFiles.push(pngPath);
  milestone("Annotation Studio and rendered PNG recorded");

  const pdfExport = await renderOptionalEditorPdf(editor);
  if (pdfExport) {
    const pdfPath = path.join(outputDir, "lumen-demo-annotated.pdf");
    await writeFile(pdfPath, Buffer.from(pdfExport.base64, "base64"));
    await assertFileHasBytes(pdfPath, 1024);
    exportedFiles.push(pdfPath);
  }

  await setScene(recordedPage, {
    chapter: "04 / Compare",
    title: "See the change, not just another screenshot.",
    copy: "Drag through before and after, jump to detected regions, and review the selected-area monitor timeline.",
    mode: "full"
  });
  const review = await navigateAppFrame(recordedPage, `chrome-extension://${extensionId}/review.html?demo=1`);
  recordRuntimeErrors(review, runtimeErrors, "review");
  await review.locator("#reviewContent:not(.is-hidden)").waitFor({ timeout: 15_000 });
  await review.locator("#changePercentMetric").waitFor();
  await pause(0.8);
  await moveCursor(recordedPage, review, "#revealSlider");
  await review.locator("#revealSlider").fill("68");
  await pause(0.8);
  await clickWithCursor(recordedPage, review, "#regionList .region-button");
  await pause(0.75);
  const reviewedButton = review.locator("#reviewActions .primary-review-action");
  if (await reviewedButton.isVisible().catch(() => false)) {
    await clickWithCursor(recordedPage, review, "#reviewActions .primary-review-action");
  }
  await pause(0.9);
  await saveStill(recordedPage, "07-change-review.png");
  const posterPath = path.join(outputDir, "lumen-product-demo-poster.png");
  await cp(path.join(outputDir, "07-change-review.png"), posterPath);
  await assertFileHasBytes(posterPath, 20_000);
  stills.push(posterPath);
  milestone("Visual change review and poster recorded");

  await showSettingsScene({
    recordedPage,
    extensionId,
    extensionDir
  });
  await pause(1.15);
  await saveStill(recordedPage, "08-settings-privacy.png");
  milestone("Settings privacy controls recorded");

  await setScene(recordedPage, {
    chapter: "Lumen",
    title: "Capture once. Understand what changed.",
    copy: "Full-page capture, local library, annotation, zoomable export, privacy controls, and visual monitoring in one workflow.",
    mode: "end"
  });
  await pause(1.8);

  if (runtimeErrors.length) {
    throw new Error(`Product demo emitted runtime errors: ${runtimeErrors.join(" | ")}`);
  }

  await recordedPage.close();
  recordedPage = null;
  const videoPath = path.join(outputDir, videoName);
  await recordedVideo.saveAs(videoPath);
  await assertWebm(videoPath);
  milestone("WebM finalized");

  const capturedPng = await findLargestFile(downloadsDir, (filePath) => filePath.toLowerCase().endsWith(".png"));
  if (capturedPng) {
    const capturePath = path.join(outputDir, "lumen-demo-full-page.png");
    await cp(capturedPng, capturePath);
    await assertFileHasBytes(capturePath, 1024);
    exportedFiles.push(capturePath);
  }

  console.log(JSON.stringify({
    ok: true,
    command: "npm run demo:record",
    outputDir,
    video: videoPath,
    stills,
    exports: exportedFiles,
    realCapture: !skipCapture,
    paceMs,
    warnings
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    outputDir,
    tempRoot: keepProfile ? tempRoot : undefined,
    warnings,
    runtimeErrors
  }, null, 2));
  process.exitCode = 1;
} finally {
  await recordedPage?.close().catch(() => {});
  await context?.close().catch(() => {});
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (!keepProfile) {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function prepareExtensionCopy() {
  await cp(repoRoot, extensionDir, {
    recursive: true,
    filter(source) {
      const relative = path.relative(repoRoot, source);
      const parts = relative.split(path.sep);

      return !parts.includes(".git") &&
        !parts.includes("node_modules") &&
        !parts.includes("artifacts") &&
        !parts.some((part) => part.endsWith(".zip")) &&
        !parts.some((part) => part.endsWith(".crx"));
    }
  });

  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // The installed extension uses activeTab after a toolbar click. The recorded
  // popup lives in a controlled extension frame, so the temporary demo copy gets
  // deterministic fixture coverage without changing the shipped manifest.
  manifest.host_permissions = ["<all_urls>"];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await Promise.all([
    writeFile(path.join(extensionDir, "demo-stage.html"), buildDemoStageHtml()),
    writeFile(path.join(extensionDir, "demo-stage.css"), buildDemoStageCss())
  ]);
}

async function prepareChromeProfile() {
  await mkdir(path.join(profileDir, "Default"), { recursive: true });
  await writeFile(path.join(profileDir, "Default", "Preferences"), JSON.stringify({
    download: {
      default_directory: downloadsDir,
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

async function seedExtensionState(worker) {
  await worker.evaluate(async () => {
    await chrome.storage.sync.set({
      "lumen.capture.settings": {
        removeStickyHeaders: true,
        forceLazyLoad: true,
        autoRedact: true,
        exportManifest: true,
        annotationEnabled: false,
        annotationPosition: "top-right",
        devicePreset: "desktop",
        exportPreset: "raw",
        longPageMode: "auto"
      }
    });
    await chrome.storage.local.set({
      "lumen.onboarding": {
        dismissedAt: new Date().toISOString()
      },
      "lumen.capture.privateSettings": {
        annotationText: ""
      },
      "lumen.app.settings": {
        version: 1,
        privacyShieldEnabled: false,
        localOnlyMode: true,
        reviewBeforeSave: true,
        shieldRestore: null
      }
    });
  });
}

async function seedDemoLibraryCaptures(extensionPage, fixtureUrl, includePrimary) {
  await extensionPage.evaluate(async ({ url, includePrimaryCapture }) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    const definitions = [
      ...(includePrimaryCapture ? [{
        id: "demo-recording-primary",
        title: "Lumen checkout review",
        asset: "assets/hero-after.png",
        width: 1136,
        height: 710,
        minutesAgo: 0,
        favorite: true,
        sourceType: "manual",
        tags: ["demo", "reviewed"]
      }] : []),
      {
        id: "demo-recording-baseline",
        title: "Checkout baseline",
        asset: "assets/hero-before.png",
        width: 1136,
        height: 710,
        minutesAgo: 18,
        favorite: false,
        sourceType: "timed",
        tags: ["baseline", "monitor"]
      },
      {
        id: "demo-recording-handoff",
        title: "Annotation handoff",
        asset: "assets/store-annotation-studio.png",
        width: 1280,
        height: 800,
        minutesAgo: 42,
        favorite: false,
        sourceType: "manual",
        tags: ["annotated", "handoff"]
      }
    ];

    for (const definition of definitions) {
      const response = await fetch(chrome.runtime.getURL(definition.asset));
      const bytes = await response.arrayBuffer();
      const blob = new Blob([bytes], { type: "image/png" });
      const capturedAt = new Date(Date.now() - definition.minutesAgo * 60_000).toISOString();
      await store.putLibraryCapture({
        id: definition.id,
        title: definition.title,
        host: new URL(url).host,
        url,
        sourceType: definition.sourceType,
        favorite: definition.favorite,
        capturedAt,
        archiveFolder: `Lumen/demo/${definition.id}`,
        previews: [{
          blob,
          width: definition.width,
          height: definition.height,
          role: "full-page",
          variantId: "desktop"
        }],
        editorSource: {
          blob,
          width: definition.width,
          height: definition.height,
          originalWidth: definition.width,
          originalHeight: definition.height,
          scaled: false,
          kind: "lossless-demo-output",
          role: "full-page",
          variantId: "desktop"
        },
        downloads: [{
          downloadId: 0,
          filename: `Lumen/demo/${definition.id}.png`,
          kind: "image",
          role: "full-page",
          width: definition.width,
          height: definition.height
        }],
        tags: definition.tags
      });
    }
  }, { url: fixtureUrl, includePrimaryCapture: includePrimary });
}

async function showSettingsScene({ recordedPage: page, extensionId, extensionDir: copiedExtensionDir }) {
  await setScene(page, {
    chapter: "05 / Settings",
    title: "Privacy is visible, local, and reversible.",
    copy: "Turn protections on or off in Lumen settings. Nothing is silently uploaded, and reviewed exports remain your choice.",
    mode: "settings"
  });

  const dedicatedSettings = await fileExists(path.join(copiedExtensionDir, "settings.html"));
  const settings = await navigateAppFrame(
    page,
    dedicatedSettings
      ? `chrome-extension://${extensionId}/settings.html`
      : `chrome-extension://${extensionId}/popup.html`
  );
  recordRuntimeErrors(settings, runtimeErrors, dedicatedSettings ? "settings" : "popup-settings");

  if (!dedicatedSettings) {
    await settings.locator(".controls-panel").scrollIntoViewIfNeeded();
  }

  const privacyToggle = await firstExistingLocator(settings, [
    "#privacyShieldToggle",
    "#privacyMode",
    "#privacyEnabled",
    "#privacyToggle",
    "#autoRedact",
    '[data-setting="privacy"] input[type="checkbox"]',
    '[name="privacyMode"]'
  ]);

  if (!privacyToggle) {
    warnings.push("The settings scene loaded, but no privacy toggle selector was found.");
    return;
  }

  await privacyToggle.scrollIntoViewIfNeeded();
  const visualToggle = privacyToggle.locator("xpath=following-sibling::*[contains(@class, 'toggle')][1]");
  const visualSelector = await visualToggle.count() ? visualToggle : privacyToggle;
  await moveCursorToLocator(page, visualSelector);
  await privacyToggle.setChecked(false, { force: true });
  await pause(0.55);
  await moveCursorToLocator(page, visualSelector);
  await privacyToggle.setChecked(true, { force: true });
  const shieldCard = settings.locator(".shield-card").first();
  if (await shieldCard.count()) {
    await shieldCard.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await moveCursorToLocator(page, visualSelector);
  }
}

async function renderEditorExport(editor, format) {
  return editor.evaluate(async (requestedFormat) => {
    const api = globalThis.LumenAnnotationEditor;
    const blob = requestedFormat === "png"
      ? await api?.getRenderedBlob?.()
      : null;

    if (!(blob instanceof Blob) || !blob.size) {
      throw new Error(`The editor did not produce a ${requestedFormat.toUpperCase()} Blob.`);
    }

    return {
      type: blob.type,
      size: blob.size,
      base64: await blobToBase64(blob)
    };

    function blobToBase64(sourceBlob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
        reader.onerror = () => reject(reader.error || new Error("Blob encoding failed."));
        reader.readAsDataURL(sourceBlob);
      });
    }
  }, format);
}

async function renderOptionalEditorPdf(editor) {
  return editor.evaluate(async () => {
    const api = globalThis.LumenAnnotationEditor;
    if (!api?.getRenderedBlob) {
      return null;
    }

    let sourceBlob;
    let pdf;
    try {
      sourceBlob = await api.getRenderedBlob();
      const { createImagePdfBlob } = await import(chrome.runtime.getURL("export-utils.js"));
      pdf = await createImagePdfBlob(sourceBlob);
    } catch {
      return null;
    }

    const blob = pdf?.blob;
    if (!(blob instanceof Blob) || !blob.size) {
      return null;
    }

    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
      reader.onerror = () => reject(reader.error || new Error("PDF encoding failed."));
      reader.readAsDataURL(blob);
    });

    return { type: blob.type, size: blob.size, pageCount: pdf.pageCount, base64 };
  });
}

async function navigateAppFrame(page, url) {
  const frame = page.frame({ name: "lumenDemoApp" });
  if (!frame) {
    throw new Error("The product demo app frame was not created.");
  }
  await frame.goto(url, { waitUntil: "load" });
  return frame;
}

async function setScene(page, { chapter, title, copy, mode }) {
  await page.evaluate((scene) => {
    document.body.dataset.mode = scene.mode;
    document.querySelector("#chapter").textContent = scene.chapter;
    document.querySelector("#sceneTitle").textContent = scene.title;
    document.querySelector("#sceneCopy").textContent = scene.copy;
  }, { chapter, title, copy, mode });
  await pause(0.45);
}

async function clickWithCursor(page, frame, selector) {
  const target = frame.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  await moveCursorToLocator(page, target);
  await pause(0.2);
  await target.click();
  await page.locator("#demoCursor").evaluate((cursor) => {
    cursor.classList.remove("is-clicking");
    void cursor.offsetWidth;
    cursor.classList.add("is-clicking");
  });
  await pause(0.42);
}

async function clickInBackgroundWithCursor(page, foregroundPage, frame, selector) {
  const target = frame.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  await moveCursorToLocator(page, target);
  await pause(0.2);
  await foregroundPage.bringToFront();
  await target.evaluate((element) => element.click());
  await page.locator("#demoCursor").evaluate((cursor) => {
    cursor.classList.remove("is-clicking");
    void cursor.offsetWidth;
    cursor.classList.add("is-clicking");
  });
  await pause(0.42);
}

async function readCaptureDiagnostics(frame) {
  return frame.evaluate(() => ({
    title: document.querySelector("#statusTitle")?.textContent?.trim() || "",
    detail: document.querySelector("#statusDetail")?.textContent?.trim() || "",
    badge: document.querySelector("#statusBadge")?.textContent?.trim() || "",
    log: [...document.querySelectorAll("#statusLog > *")]
      .map((item) => item.textContent?.trim() || "")
      .filter(Boolean)
      .slice(-4)
  }));
}

function formatCaptureDiagnostics(diagnostics = {}) {
  return [
    diagnostics.title,
    diagnostics.detail,
    diagnostics.badge ? `badge=${diagnostics.badge}` : "",
    diagnostics.log?.length ? `log=${diagnostics.log.join(" | ")}` : ""
  ].filter(Boolean).join(" · ");
}

async function toggleWithCursor(page, frame, inputSelector, visualSelector, checked) {
  const input = frame.locator(inputSelector);
  const visual = frame.locator(visualSelector).first();
  await visual.scrollIntoViewIfNeeded();
  await moveCursorToLocator(page, visual);
  await pause(0.18);
  await input.setChecked(checked, { force: true });
  await page.locator("#demoCursor").evaluate((cursor) => {
    cursor.classList.remove("is-clicking");
    void cursor.offsetWidth;
    cursor.classList.add("is-clicking");
  });
}

async function moveCursor(page, frame, selector) {
  const target = frame.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  await moveCursorToLocator(page, target);
}

async function drawCanvasGesture(page, frame, start, end) {
  const canvas = frame.locator("#editorCanvas");
  const box = await canvas.boundingBox();

  if (!box) {
    throw new Error("The annotation canvas is not visible for the recorded gesture.");
  }

  const from = {
    x: Math.round(box.x + box.width * start.x),
    y: Math.round(box.y + box.height * start.y)
  };
  const to = {
    x: Math.round(box.x + box.width * end.x),
    y: Math.round(box.y + box.height * end.y)
  };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await page.locator("#demoCursor").evaluate((cursor, point) => {
    cursor.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
  }, to);
  await pause(0.35);
}

async function moveCursorToLocator(page, locator) {
  const box = await locator.boundingBox();
  if (!box) {
    return;
  }
  await page.locator("#demoCursor").evaluate((cursor, point) => {
    cursor.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
  }, {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2)
  });
}

async function saveStill(page, filename) {
  const outputPath = path.join(outputDir, filename);
  await page.locator("#demoCursor").evaluate((cursor) => {
    cursor.dataset.previousOpacity = cursor.style.opacity;
    cursor.style.opacity = "0";
  });
  await page.screenshot({ path: outputPath, type: "png" });
  await page.locator("#demoCursor").evaluate((cursor) => {
    cursor.style.opacity = cursor.dataset.previousOpacity || "";
    delete cursor.dataset.previousOpacity;
  });
  await assertFileHasBytes(outputPath, 20_000);
  stills.push(outputPath);
}

async function firstExistingLocator(frame, selectors) {
  for (const selector of selectors) {
    const locator = frame.locator(selector).first();
    if (await locator.count()) {
      return locator;
    }
  }
  return null;
}

async function getExtensionWorker(browserContext) {
  let [worker] = browserContext.serviceWorkers();
  if (!worker) {
    worker = await browserContext.waitForEvent("serviceworker", { timeout: 15_000 });
  }
  return worker;
}

async function getInitialPage(browserContext) {
  const pages = browserContext.pages();
  return pages[0] || browserContext.newPage();
}

function recordRuntimeErrors(target, collection, label) {
  if (typeof target.mainFrame !== "function") {
    return;
  }
  target.on("pageerror", (error) => collection.push(`${label}: ${error.message}`));
  target.on("console", (message) => {
    if (message.type() === "error") {
      collection.push(`${label}: ${message.text()}`);
    }
  });
}

async function waitForFrameUrl(page, frameName, expectedUrl) {
  await page.waitForFunction(({ name, url }) => {
    const frame = document.querySelector(`iframe[name="${name}"]`);
    try {
      return frame?.contentWindow?.location?.href === url;
    } catch {
      return Boolean(frame?.src === url);
    }
  }, { name: frameName, url: expectedUrl });
}

async function pause(multiplier = 1) {
  await new Promise((resolve) => setTimeout(resolve, Math.round(paceMs * multiplier)));
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function assertFileHasBytes(filePath, minimumBytes) {
  const fileStat = await stat(filePath);
  if (fileStat.size < minimumBytes) {
    throw new Error(`${filePath} is unexpectedly small (${fileStat.size} bytes).`);
  }
}

async function assertWebm(filePath) {
  await assertFileHasBytes(filePath, 50_000);
  const header = await readFile(filePath);
  if (header.subarray(0, 4).toString("hex") !== "1a45dfa3") {
    throw new Error(`The recorded demo is not a valid WebM container: ${filePath}`);
  }
}

async function findLargestFile(root, predicate) {
  const candidates = [];
  await walk(root);
  candidates.sort((left, right) => right.size - left.size);
  return candidates[0]?.filePath || "";

  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(filePath);
      } else if (predicate(filePath)) {
        candidates.push({ filePath, size: (await stat(filePath)).size });
      }
    }
  }
}

function boundedNumber(rawValue, fallback, minimum, maximum) {
  const value = Number(rawValue);
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : fallback;
}

function milestone(message) {
  process.stderr.write(`[Lumen demo] ${message}\n`);
}

async function startFixtureServer() {
  const serverInstance = createServer((request, response) => {
    if (request.url === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(buildFixtureHtml());
  });

  await new Promise((resolve, reject) => {
    serverInstance.once("error", reject);
    serverInstance.listen(0, "127.0.0.1", resolve);
  });
  const address = serverInstance.address();
  return {
    server: serverInstance,
    url: `http://127.0.0.1:${address.port}/checkout`
  };
}

function buildFixtureHtml() {
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Northstar checkout review</title>
        <style>
          * { box-sizing: border-box; }
          html { color-scheme: dark; }
          body { margin: 0; background: #071018; color: #f4f9ff; font: 16px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; }
          header { position: sticky; top: 0; z-index: 5; display: flex; justify-content: space-between; align-items: center; padding: 18px 7vw; border-bottom: 1px solid #ffffff16; background: #071018e8; backdrop-filter: blur(18px); }
          nav { display: flex; gap: 24px; color: #9eb0c0; }
          main { width: min(1080px, 86vw); margin: auto; padding: 72px 0 780px; }
          .eyebrow { color: #7ee8cf; font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
          h1 { max-width: 760px; margin: 12px 0 18px; font-size: clamp(54px, 7vw, 88px); line-height: .94; letter-spacing: -.065em; }
          .lede { max-width: 650px; color: #aabac7; font-size: 20px; }
          .grid { display: grid; grid-template-columns: 1.25fr .75fr; gap: 22px; margin-top: 56px; }
          .panel { min-height: 310px; padding: 28px; border: 1px solid #ffffff18; border-radius: 28px; background: linear-gradient(145deg, #ffffff0d, transparent), #0d1722; box-shadow: 0 30px 70px #0006; }
          .product { display: grid; place-items: center; min-height: 190px; margin-top: 22px; border-radius: 22px; background: radial-gradient(circle at 40% 20%, #7ee8cf55, transparent 30%), linear-gradient(135deg, #172c3b, #0b131c); }
          .product span { font-size: 46px; font-weight: 850; letter-spacing: -.06em; }
          .row { display: flex; justify-content: space-between; padding: 13px 0; border-bottom: 1px solid #ffffff10; }
          .total { margin-top: 16px; color: #7ee8cf; font-size: 26px; font-weight: 850; }
          button { width: 100%; margin-top: 22px; padding: 15px 18px; border: 0; border-radius: 14px; background: #7ee8cf; color: #061014; font-weight: 850; }
          .privacy { margin-top: 26px; padding: 18px; border: 1px solid #ffd16655; border-radius: 18px; color: #dce7ef; background: #ffd1660c; }
          .floating { position: fixed; right: 24px; bottom: 24px; padding: 14px 18px; border-radius: 999px; background: white; color: #071018; box-shadow: 0 20px 60px #0008; }
        </style>
      </head>
      <body>
        <header><strong>NORTHSTAR</strong><nav><span>Shop</span><span>Journal</span><span>Support</span></nav></header>
        <main>
          <p class="eyebrow">Release candidate · Checkout 4.2</p>
          <h1>Review the entire checkout, not just the viewport.</h1>
          <p class="lede">A local fixture with a sticky bar, long content, and private fields makes the real capture path reproducible.</p>
          <section class="grid">
            <article class="panel"><span class="eyebrow">Order preview</span><div class="product"><span>Field Kit 02</span></div></article>
            <article class="panel"><span class="eyebrow">Summary</span><div class="row"><span>Subtotal</span><strong>$148.00</strong></div><div class="row"><span>Shipping</span><strong>Free</strong></div><div class="row"><span>Tax</span><strong>$12.21</strong></div><div class="row total"><span>Total</span><strong>$160.21</strong></div><button>Confirm order</button></article>
          </section>
          <aside class="privacy"><strong>Private test details</strong><p>Customer: demo.customer@example.com · Phone: +1 (312) 555-0199 · Token: sk_test_LumenCaptureReview5820</p></aside>
        </main>
        <div class="floating">Chat with support</div>
      </body>
    </html>`;
}

function buildDemoStageHtml() {
  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Lumen product demo</title>
        <link rel="stylesheet" href="demo-stage.css" />
      </head>
      <body data-mode="split">
        <header class="demo-header">
          <div class="brand"><span class="mark">L</span><span><b>Lumen</b><small>Browser capture workspace</small></span></div>
          <div class="local-pill"><i></i> Local-first demo</div>
        </header>
        <section class="scene-copy">
          <p id="chapter">Lumen</p>
          <h1 id="sceneTitle">Capture a page. Keep the story.</h1>
          <span id="sceneCopy">A real extension workflow recorded against a local reproducible site.</span>
        </section>
        <main class="demo-stage">
          <section class="browser-card site-card">
            <div class="browser-bar"><i></i><i></i><i></i><span>northstar.test/checkout</span></div>
            <iframe id="siteFrame" name="lumenDemoSite" title="Website being captured"></iframe>
          </section>
          <section class="browser-card app-card">
            <div class="app-bar"><span>Lumen</span><small>Extension app</small></div>
            <iframe id="appFrame" name="lumenDemoApp" title="Lumen extension app"></iframe>
          </section>
          <div id="demoCursor" class="demo-cursor" aria-hidden="true"></div>
          <div class="end-card"><span class="end-mark">L</span><strong>Built for evidence that lasts beyond the screenshot.</strong><small>Local by default · Export only when you choose</small></div>
        </main>
      </body>
    </html>`;
}

function buildDemoStageCss() {
  return `:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --ink: #f4f8ff; --muted: #9babbc; --accent: #7ee8cf; }
    * { box-sizing: border-box; }
    html, body { width: 1280px; height: 720px; margin: 0; overflow: hidden; }
    body { position: relative; display: grid; grid-template-rows: 68px 102px 1fr; padding: 0 30px 26px; color: var(--ink); background: radial-gradient(circle at 16% 4%, #267aa533, transparent 30%), radial-gradient(circle at 88% 90%, #2cae8c20, transparent 30%), linear-gradient(145deg, #04070d, #08111c 55%, #050910); }
    body::before { content: ""; position: absolute; inset: 18px; border: 1px solid #ffffff0e; border-radius: 26px; pointer-events: none; }
    .demo-header { position: relative; z-index: 2; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; border-bottom: 1px solid #ffffff10; }
    .brand { display: flex; align-items: center; gap: 11px; }
    .brand > span:last-child { display: grid; gap: 1px; }
    .brand b { font-size: 15px; letter-spacing: .01em; }
    .brand small { color: #8395a7; font-size: 10px; letter-spacing: .09em; text-transform: uppercase; }
    .mark { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid #7ee8cf55; border-radius: 11px; color: #c9fff2; background: linear-gradient(135deg, #7ee8cf38, #4cb7f318); font-weight: 850; }
    .local-pill { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid #7ee8cf33; border-radius: 999px; color: #c8f9ed; background: #7ee8cf0d; font-size: 11px; font-weight: 750; letter-spacing: .04em; }
    .local-pill i { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 16px var(--accent); }
    .scene-copy { position: relative; z-index: 2; display: grid; grid-template-columns: 120px minmax(0, 1fr) 440px; gap: 18px; align-items: center; padding: 12px 10px 14px; }
    .scene-copy p { margin: 0; color: var(--accent); font-size: 11px; font-weight: 850; letter-spacing: .15em; text-transform: uppercase; }
    .scene-copy h1 { margin: 0; font-size: 30px; line-height: 1; letter-spacing: -.045em; transition: opacity .25s ease; }
    .scene-copy span { color: var(--muted); font-size: 13px; line-height: 1.45; }
    .demo-stage { position: relative; z-index: 2; display: grid; grid-template-columns: minmax(0, 1fr) 430px; gap: 16px; min-height: 0; }
    .browser-card { position: relative; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid #ffffff16; border-radius: 20px; background: #080d15; box-shadow: 0 28px 80px #0008; transition: opacity .3s ease, transform .4s cubic-bezier(.16,1,.3,1), width .4s ease; }
    .browser-bar, .app-bar { height: 38px; display: flex; align-items: center; gap: 8px; padding: 0 14px; border-bottom: 1px solid #ffffff10; color: #8ea0b2; background: linear-gradient(180deg, #151c28, #0d131d); font-size: 10px; }
    .browser-bar i { width: 7px; height: 7px; border-radius: 50%; background: #ff6f78; }
    .browser-bar i:nth-child(2) { background: #ffd166; }
    .browser-bar i:nth-child(3) { background: #7ee8a5; }
    .browser-bar span { flex: 1; max-width: 360px; margin-left: 6px; padding: 5px 12px; border-radius: 7px; background: #ffffff08; }
    .app-bar { justify-content: space-between; color: #d8e6f2; font-weight: 800; }
    .app-bar small { color: #7ee8cf; font-size: 9px; letter-spacing: .12em; text-transform: uppercase; }
    iframe { display: block; width: 100%; height: calc(100% - 38px); border: 0; background: #060a12; }
    .app-card iframe { background: #050811; }
    body[data-mode="full"] .demo-stage { grid-template-columns: 1fr; }
    body[data-mode="full"] .site-card, body[data-mode="settings"] .site-card { position: absolute; inset: 28px 90px -16px; opacity: .1; transform: scale(.97); pointer-events: none; }
    body[data-mode="full"] .app-card { z-index: 2; }
    body[data-mode="settings"] .demo-stage { display: grid; grid-template-columns: 1fr; place-items: center; }
    body[data-mode="settings"] .app-card { z-index: 2; width: min(1120px, 100%); height: 100%; }
    .demo-cursor { position: fixed; z-index: 50; left: -7px; top: -7px; width: 16px; height: 20px; pointer-events: none; transform: translate3d(1120px, 610px, 0); transition: transform .38s cubic-bezier(.16,1,.3,1), opacity .15s ease; filter: drop-shadow(0 3px 5px #000b); }
    .demo-cursor::before { content: ""; display: block; width: 0; height: 0; border-top: 17px solid white; border-right: 10px solid transparent; transform: rotate(-16deg); }
    .demo-cursor::after { content: ""; position: absolute; left: 4px; top: 17px; width: 16px; height: 16px; border: 2px solid #7ee8cf; border-radius: 50%; opacity: 0; transform: scale(.35); }
    .demo-cursor.is-clicking::after { animation: click-ring .42s ease-out; }
    @keyframes click-ring { 0% { opacity: .9; transform: scale(.35); } 100% { opacity: 0; transform: scale(1.8); } }
    .end-card { display: none; }
    body[data-mode="end"] .scene-copy { grid-template-columns: 120px 1fr 440px; }
    body[data-mode="end"] .site-card, body[data-mode="end"] .app-card { display: none; }
    body[data-mode="end"] .demo-stage { display: grid; place-items: center; }
    body[data-mode="end"] .end-card { display: grid; justify-items: center; gap: 16px; max-width: 760px; text-align: center; }
    .end-mark { display: grid; place-items: center; width: 74px; height: 74px; border: 1px solid #7ee8cf55; border-radius: 24px; color: #ddfff7; background: linear-gradient(135deg, #7ee8cf3b, #4cb7f318); box-shadow: 0 24px 70px #2ba98b22; font-size: 30px; font-weight: 900; }
    .end-card strong { font-size: 34px; line-height: 1.05; letter-spacing: -.045em; }
    .end-card small { color: #8ea0b2; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
    body[data-mode="end"] .demo-cursor { opacity: 0; }
  `;
}
