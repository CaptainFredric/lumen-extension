import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { chromium } from "playwright";
const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const sourceManifest = JSON.parse(await readFile(path.join(repoRoot, "manifest.json"), "utf8"));
const zipPath = path.join(repoRoot, "dist", `lumen-extension-${sourceManifest.version}.zip`);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lumen-release-package-"));
const extensionDir = path.join(tempRoot, "extension");
const profileDir = path.join(tempRoot, "profile");
const popupErrors = [];
const requireNativeShortcutCapture = process.env.CI === "true" && process.platform === "linux";
const areaShortcutKey = process.platform === "darwin" ? "A" : "E";

let context;
let fixtureServer;

try {
  await execFileAsync(process.execPath, [path.join(repoRoot, "scripts", "package-extension.mjs")], {
    cwd: repoRoot
  });
  const zipStats = await stat(zipPath);
  assert(zipStats.size > 0, "Release ZIP was not created.", { zipPath });

  await execFileAsync("unzip", ["-q", zipPath, "-d", extensionDir]);
  const packagedManifest = JSON.parse(await readFile(path.join(extensionDir, "manifest.json"), "utf8"));
  const packagedFiles = await listFiles(extensionDir);
  const packagedBackground = await readFile(path.join(extensionDir, "background.js"), "utf8");
  const { sanitizeCaptureUrl } = await import(
    `${pathToFileURL(path.join(extensionDir, "config.js")).href}?release=${Date.now()}`
  );

  assert(packagedManifest.version === sourceManifest.version, "Packaged manifest version drifted from source.", {
    source: sourceManifest.version,
    packaged: packagedManifest.version
  });
  assert(
    packagedManifest.commands?.["capture-page"]?.suggested_key?.default === "Alt+Shift+L" &&
      packagedManifest.commands?.["capture-visible-area"]?.suggested_key?.default === "Alt+Shift+V" &&
      packagedManifest.commands?.["capture-area"]?.suggested_key?.default === "Alt+Shift+E" &&
      packagedManifest.commands?.["capture-area"]?.suggested_key?.mac === "Alt+Shift+A",
    "Release package lost Lumen keyboard shortcuts.",
    packagedManifest.commands
  );
  assert(
    /chrome\.commands(?:\?\.|\.)onCommand\.addListener\(\(command\)\s*=>\s*\{[\s\S]*?handleCommand\(command\)/.test(packagedBackground) &&
      /\["capture-page",\s*"capture-visible-area",\s*"capture-area"\]\.includes\(command\)/.test(packagedBackground) &&
      /captureMode:\s*command\s*===\s*"capture-visible-area"\s*\?\s*"visible"\s*:\s*"fullPage"/.test(packagedBackground),
    "The exact release package lost its production command-to-capture wiring."
  );
  assert(!packagedManifest.host_permissions?.length, "Release package unexpectedly contains always-on host permissions.", packagedManifest);
  assert(packagedManifest.optional_host_permissions?.length === 2, "Release package lost its optional site-permission declarations.", packagedManifest);
  assert(!packagedFiles.some((file) => /^(scripts|backend|docs|\.github|node_modules)\//.test(file)), "Release ZIP contains development-only files.", packagedFiles);
  assert(
    [
      "library.html", "library.css", "library.js", "library-store.js",
      "annotation-engine.js", "export-utils.js", "editor.html", "editor.css", "editor.js", "editor-drive.js",
      "visual-diff-engine.js", "review.html", "review.css", "review.js", "review-actions.js",
      "result.html", "result.css", "result.js",
      "drive-export.js", "settings-store.js", "settings.html", "settings.css", "settings.js"
    ].every((file) => packagedFiles.includes(file)),
    "Release ZIP is missing a capture-review runtime file.",
    packagedFiles
  );
  assert(
    packagedManifest.optional_permissions?.includes("identity") && !packagedManifest.permissions?.includes("identity"),
    "Drive identity access must remain optional.",
    packagedManifest
  );
  if (packagedManifest.oauth2) {
    assert(
      packagedManifest.oauth2.scopes?.length === 1
        && packagedManifest.oauth2.scopes[0] === "https://www.googleapis.com/auth/drive.file",
      "Packaged Google OAuth configuration widened beyond drive.file.",
      packagedManifest.oauth2
    );
  }
assert(
  sanitizeCaptureUrl("https://example.test/review?view=grid&token=secret&session_id=private#account") === "https://example.test/review?view=grid",
  "Capture URL sanitizer did not remove sensitive query keys and fragments."
);
assert(
  sanitizeCaptureUrl("https://example.test/review?mode=full&apiKey=secret&accessToken=private&X-Amz-Signature=signed") === "https://example.test/review?mode=full",
  "Capture URL sanitizer did not remove camel-case or signed URL credentials."
);

  const fixture = await startFixtureServer();
  fixtureServer = fixture.server;

  context = await chromium.launchPersistentContext(profileDir, {
    acceptDownloads: true,
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

  const extensionId = new URL(worker.url()).host;
  const runtimeManifest = await worker.evaluate(() => chrome.runtime.getManifest());
  assert(runtimeManifest.version === packagedManifest.version, "Loaded extension version does not match the release ZIP.", runtimeManifest);
  assert(!runtimeManifest.host_permissions?.length, "Loaded release extension unexpectedly gained persistent host permissions.", runtimeManifest);

  const target = await context.newPage();
  await target.goto(fixture.url, { waitUntil: "domcontentloaded" });

  const popup = await context.newPage();
  popup.on("console", (message) => {
    if (message.type() === "error") {
      popupErrors.push(message.text());
    }
  });
  popup.on("pageerror", (error) => popupErrors.push(error.message));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
  await popup.waitForSelector("#onboardingPanel:not(.is-hidden)", { timeout: 10000 });

  const firstRun = await popup.evaluate(async () => ({
    title: document.querySelector("#onboardingTitle")?.textContent?.trim() || "",
    pageStatus: document.querySelector("#onboardingPageStatus")?.textContent?.trim() || "",
    hasDismissButton: Boolean(document.querySelector("#onboardingDismissButton")),
    hasStartButton: Boolean(document.querySelector("#onboardingStartButton")),
    hasSettingsButton: Boolean(document.querySelector("#onboardingSettingsButton")),
    stepCount: document.querySelectorAll("[data-onboarding-step]").length,
    launchFollowsHeader: document.querySelector("header")?.nextElementSibling?.id === "launchPanel",
    captureButtonBottom: Math.round(document.querySelector("#captureButton")?.getBoundingClientRect().bottom || 0),
    captureDisabled: document.querySelector("#captureButton")?.disabled || false,
    launchState: document.querySelector("#launchStatus")?.dataset.state || "",
    permissions: await chrome.permissions.getAll(),
    sync: await chrome.storage.sync.get("lumen.capture.settings"),
    local: await chrome.storage.local.get([
      "lumen.capture.privateSettings",
      "lumen.capture.history",
      "lumen.onboarding",
      "lumen.app.settings"
    ])
  }));

  assert(firstRun.title === "Capture your first page", "Clean install did not show the compact first-run guide.", firstRun);
  assert(firstRun.pageStatus, "First-run guide did not explain the current page state.", firstRun);
  assert(firstRun.hasDismissButton, "First-run guide lost its dismiss action.", firstRun);
  assert(
    !firstRun.hasStartButton && !firstRun.hasSettingsButton && firstRun.stepCount === 0,
    "First-run guide reintroduced a forced-review CTA or instructional steps.",
    firstRun
  );
  assert(firstRun.launchFollowsHeader, "Capture launch must appear directly after the compact popup header.", firstRun);
  assert(
    firstRun.captureButtonBottom > 0 && firstRun.captureButtonBottom <= 600,
    "Clean-install Capture page action must remain inside a 600px popup viewport.",
    firstRun
  );
  // A popup opened as a normal browser tab does not receive Chrome's toolbar
  // activeTab grant. The production ZIP must fail safely in that state while
  // still explaining the first-run path. Native command coverage runs later in
  // this exact-package test; the physical toolbar click remains a manual check.
  assert(firstRun.launchState === "blocked" && firstRun.captureDisabled, "Clean package did not fail safely without an activeTab grant.", firstRun);
  assert(!(firstRun.permissions.origins || []).length, "Clean install started with granted site origins.", firstRun.permissions);
  assert(!Object.hasOwn(firstRun.sync["lumen.capture.settings"] || {}, "annotationText"), "Release package synced private note text.", firstRun.sync);
  assert(typeof firstRun.local["lumen.capture.privateSettings"]?.annotationText === "string", "Release package did not initialize private settings locally.", firstRun.local);
  assert(
    firstRun.local["lumen.app.settings"]?.localOnlyMode === true &&
      firstRun.local["lumen.app.settings"]?.reviewBeforeSave === false,
    "Release package did not initialize safe local-only and one-click capture defaults.",
    firstRun.local
  );
  assert((firstRun.local["lumen.capture.history"] || []).length === 0, "Clean profile unexpectedly contains capture history.", firstRun.local);

  await popup.click("#onboardingDismissButton");
  await popup.waitForSelector("#onboardingPanel.is-hidden", { state: "attached" });
  const dismissed = await worker.evaluate(() => chrome.storage.local.get("lumen.onboarding"));
  assert(Boolean(dismissed["lumen.onboarding"]?.dismissedAt), "First-run dismissal did not persist.", dismissed);

  await popup.reload({ waitUntil: "load" });
  await popup.waitForSelector("#captureButton");
  const onboardingStayedDismissed = await popup.$eval("#onboardingPanel", (node) => node.classList.contains("is-hidden"));
  assert(onboardingStayedDismissed, "Dismissed first-run guide returned after reload.");

  const library = await context.newPage();
  library.on("console", (message) => {
    if (message.type() === "error") {
      popupErrors.push(`library: ${message.text()}`);
    }
  });
  library.on("pageerror", (error) => popupErrors.push(`library: ${error.message}`));
  await library.goto(`chrome-extension://${extensionId}/library.html`, { waitUntil: "load" });
  await library.waitForSelector("#emptyState:not(.is-hidden)", { timeout: 10000 });
  const cleanLibrary = await library.evaluate(() => ({
    title: document.title,
    captureMetric: document.querySelector("#captureMetric")?.textContent?.trim() || "",
    resultsCount: document.querySelector("#resultsCount")?.textContent?.trim() || "",
    emptyTitle: document.querySelector("#emptyTitle")?.textContent?.trim() || ""
  }));
  assert(cleanLibrary.title === "Lumen Capture Library", "Packaged photo library title did not load.", cleanLibrary);
  assert(cleanLibrary.captureMetric === "0" && cleanLibrary.resultsCount === "0 items", "Clean release profile did not start with an empty photo library.", cleanLibrary);
  assert(/No captures/i.test(cleanLibrary.emptyTitle), "Clean release photo library did not explain its empty state.", cleanLibrary);

  const packagedResultCaptureId = "release-result-smoke";
  const packagedResultSeed = await library.evaluate(async (captureId) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 960;
    const context = canvas.getContext("2d");
    context.fillStyle = "#0b1725";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#7fe9bd";
    context.fillRect(64, 640, 512, 180);
    const dataUrl = canvas.toDataURL("image/png");
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: "Lumen/release-result.png",
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
      throw new Error("The exact package could not seed a completed original download for result testing.");
    }

    await store.putLibraryCapture({
      id: captureId,
      title: "Packaged result",
      host: "release.test",
      url: "https://release.test/result",
      capturedAt: new Date().toISOString(),
      sourceType: "manual",
      dimensions: { width: 640, height: 960 },
      fileCount: 1,
      downloads: [{
        downloadId,
        filename: "Lumen/release-result.png",
        bytesReceived: download.bytesReceived,
        complete: true,
        kind: "image",
        role: "full-page",
        width: 640,
        height: 960
      }],
      editorSource: {
        dataUrl,
        width: 640,
        height: 960,
        originalWidth: 640,
        originalHeight: 960,
        scaled: false,
        kind: "lossless-full-output",
        role: "full-page",
        variantId: "desktop"
      }
    });
    return { downloadId, bytesReceived: download.bytesReceived };
  }, packagedResultCaptureId);
  assert(
    Number.isInteger(packagedResultSeed.downloadId) && packagedResultSeed.bytesReceived > 0,
    "The exact package did not retain a real completed original for result actions.",
    packagedResultSeed
  );

  const packagedResult = await context.newPage();
  packagedResult.on("console", (message) => {
    if (message.type() === "error") {
      popupErrors.push(`result: ${message.text()}`);
    }
  });
  packagedResult.on("pageerror", (error) => popupErrors.push(`result: ${error.message}`));
  await packagedResult.goto(
    `chrome-extension://${extensionId}/result.html?capture=${encodeURIComponent(packagedResultCaptureId)}`,
    { waitUntil: "load" }
  );
  await packagedResult.waitForSelector('body[data-state="ready"]', { timeout: 10000 });
  const packagedResultState = await packagedResult.evaluate(() => {
    const image = document.querySelector("#resultImage");
    const actionIds = [
      "copyImageButton", "downloadPngButton", "exportPdfButton", "annotateButton",
      "openOriginalButton", "showOriginalButton", "openLibraryButton",
      "zoomOutButton", "zoomInButton", "actualSizeButton", "fitButton"
    ];
    return {
      title: document.querySelector("#resultTitle")?.textContent?.trim() || "",
      state: document.body.dataset.state || "",
      imageWidth: image?.naturalWidth || 0,
      imageHeight: image?.naturalHeight || 0,
      loadingVisible: getComputedStyle(document.querySelector("#loadingState")).display !== "none",
      emptyVisible: getComputedStyle(document.querySelector("#emptyState")).display !== "none",
      actionsReady: actionIds.every((id) => {
        const button = document.getElementById(id);
        return button && !button.hidden;
      }),
      primaryActionsEnabled: [
        "copyImageButton", "downloadPngButton", "exportPdfButton", "annotateButton",
        "openOriginalButton", "showOriginalButton", "openLibraryButton"
      ].every((id) => !document.getElementById(id)?.disabled),
      driveHidden: document.querySelector("#driveButton")?.hidden ?? false,
      viewerCount: document.querySelectorAll(".viewer-card").length,
      actionCardCount: document.querySelectorAll(".action-card").length,
      comparisonUiCount: document.querySelectorAll("#timelineList, #regionList, [data-comparison-view]").length
    };
  });
  assert(
    packagedResultState.title === "Packaged result" &&
      packagedResultState.state === "ready" &&
      packagedResultState.imageWidth === 640 &&
      packagedResultState.imageHeight === 960 &&
      !packagedResultState.loadingVisible &&
      !packagedResultState.emptyVisible &&
      packagedResultState.actionsReady &&
      packagedResultState.primaryActionsEnabled &&
      packagedResultState.driveHidden &&
      packagedResultState.viewerCount === 1 &&
      packagedResultState.actionCardCount === 1 &&
      packagedResultState.comparisonUiCount === 0,
    "The exact release ZIP did not initialize its clean capture result workspace.",
    packagedResultState
  );
  await packagedResult.click("#copyImageButton");
  await packagedResult.waitForFunction(() => /Copied 640×960 PNG to the clipboard/i.test(
    document.querySelector("#resultStatus")?.textContent || ""
  ), null, { timeout: 10000 });
  await packagedResult.close();
  await library.evaluate(async (captureId) => {
    const store = await import(chrome.runtime.getURL("library-store.js"));
    await store.deleteLibraryCapture(captureId);
  }, packagedResultCaptureId);

  const editor = await context.newPage();
  editor.on("console", (message) => {
    if (message.type() === "error") {
      popupErrors.push(`editor: ${message.text()}`);
    }
  });
  editor.on("pageerror", (error) => popupErrors.push(`editor: ${error.message}`));
  await editor.goto(`chrome-extension://${extensionId}/editor.html?demo=1`, { waitUntil: "load" });
  await editor.waitForSelector("#canvasFrame:not(.is-hidden)", { timeout: 10000 });
  if (packagedManifest.oauth2) {
    await editor.waitForSelector("[data-lumen-export-actions] button", { timeout: 10000 });
  }
  const editorState = await editor.evaluate(() => ({
    title: document.title,
    exportReady: !document.querySelector("#exportButton")?.disabled,
    toolCount: document.querySelectorAll("button[data-tool]").length,
    driveActionCount: document.querySelectorAll("[data-lumen-export-actions] button").length,
    driveLabel: document.querySelector("[data-lumen-export-actions] button")?.textContent?.trim() || "",
    driveDisabled: document.querySelector("[data-lumen-export-actions] button")?.disabled || false
  }));
  assert(editorState.title === "Lumen Annotation Studio", "Packaged annotation editor title did not load.", editorState);
  assert(editorState.exportReady && editorState.toolCount === 6, "Packaged annotation editor did not initialize its complete toolset.", editorState);
  if (!packagedManifest.oauth2) {
    assert(editorState.driveActionCount === 0, "Unconfigured Drive export should stay hidden.", editorState);
  }
  const initialAnnotationCount = await editor.evaluate(() => globalThis.LumenAnnotationEditor?.getAnnotationCount?.() || 0);
  await editor.keyboard.press("r");
  await editor.keyboard.press("Enter");
  const packagedEditorExecution = await editor.evaluate(async () => {
    const blob = await globalThis.LumenAnnotationEditor?.getRenderedBlob?.();
    return {
      annotationCount: globalThis.LumenAnnotationEditor?.getAnnotationCount?.() || 0,
      blobSize: blob?.size || 0,
      blobType: blob?.type || ""
    };
  });
  assert(
    packagedEditorExecution.annotationCount === initialAnnotationCount + 1 &&
      packagedEditorExecution.blobSize > 0 &&
      packagedEditorExecution.blobType === "image/png",
    "The exact release ZIP did not execute keyboard annotation creation and PNG rendering.",
    packagedEditorExecution
  );

  const review = await context.newPage();
  review.on("console", (message) => {
    if (message.type() === "error") {
      popupErrors.push(`review: ${message.text()}`);
    }
  });
  review.on("pageerror", (error) => popupErrors.push(`review: ${error.message}`));
  await review.goto(`chrome-extension://${extensionId}/review.html?demo=1`, { waitUntil: "load" });
  await review.waitForSelector("#reviewContent:not(.is-hidden)", { timeout: 10000 });
  await review.waitForSelector("[data-lumen-review-actions] button", { timeout: 10000 });
  const reviewState = await review.evaluate(() => ({
    title: document.title,
    regionCount: document.querySelectorAll("#regionList li").length,
    timelineCount: document.querySelectorAll("#timelineList li").length,
    actionCount: document.querySelectorAll("[data-lumen-review-actions] button").length,
    metric: document.querySelector("#changePercentMetric")?.textContent?.trim() || ""
  }));
  assert(reviewState.title === "Lumen Visual Change Review", "Packaged visual review title did not load.", reviewState);
  assert(reviewState.timelineCount > 0 && reviewState.actionCount === 4 && /%/.test(reviewState.metric), "Packaged visual review did not initialize its demo comparison.", reviewState);

  const registeredCommands = await worker.evaluate(() => chrome.commands.getAll());
  assert(
    registeredCommands.some((command) => command.name === "capture-page" && hasRegisteredShortcut(command.shortcut, "L")) &&
      registeredCommands.some((command) => command.name === "capture-visible-area" && hasRegisteredShortcut(command.shortcut, "V")) &&
      registeredCommands.some((command) => command.name === "capture-area" && hasRegisteredShortcut(command.shortcut, areaShortcutKey)),
    "Chrome did not register every packaged capture shortcut.",
    registeredCommands
  );

  await worker.evaluate(async () => {
    const key = "lumen.capture.settings";
    const stored = await chrome.storage.sync.get(key);
    await chrome.storage.sync.set({
      [key]: {
        ...(stored[key] || {}),
        removeStickyHeaders: true,
        forceLazyLoad: false,
        autoRedact: false,
        exportManifest: false,
        annotationEnabled: false,
        devicePreset: "desktop",
        exportPreset: "raw",
        longPageMode: "auto"
      }
    });
  });

  await target.bringToFront();
  const noGrantResponse = await popup.evaluate(() => chrome.runtime.sendMessage({
    type: "LUMEN_START_CAPTURE",
    payload: {
      options: {
        removeStickyHeaders: true,
        forceLazyLoad: false,
        autoRedact: false,
        exportManifest: false,
        annotationEnabled: false,
        captureMode: "fullPage",
        devicePreset: "desktop",
        exportPreset: "raw",
        longPageMode: "auto"
      }
    }
  }));
  assert(
    !noGrantResponse?.ok &&
      noGrantResponse.error?.title === "Site Access Blocked" &&
      /did not grant temporary access/i.test(noGrantResponse.error?.description || ""),
    "The packaged worker did not fail specifically at Chrome's activeTab access boundary.",
    noGrantResponse
  );

  const noGrantState = await worker.evaluate(async () => {
    const permissions = await chrome.permissions.getAll();
    const stored = await chrome.storage.local.get("lumen.capture.history");
    return {
      permissions,
      history: stored["lumen.capture.history"] || []
    };
  });
  assert(!noGrantState.history.length, "A no-grant capture attempt unexpectedly saved history.", noGrantState);
  assert(!(noGrantState.permissions.origins || []).length, "A no-grant capture attempt unexpectedly persisted site access.", noGrantState);
  await waitForCaptureIdle(worker);

  await target.bringToFront();
  const fullPageTrigger = await dispatchBrowserShortcut(target, "L");
  const fullPageShortcut = await waitForShortcutCapture(worker, 1, fullPageTrigger.native ? 30000 : 3500);
  let visibleShortcut = null;
  let visibleTrigger = null;
  let areaShortcut = null;
  let areaTrigger = null;
  let areaOutput = null;
  let fullPageResultOpened = false;
  let visibleResultOpened = false;
  let areaResultOpened = false;

  assert(
    fullPageShortcut || (!fullPageTrigger.native && !requireNativeShortcutCapture),
    "The CI release gate did not complete the packaged full-page command through a native browser shortcut.",
    { trigger: fullPageTrigger, requireNativeShortcutCapture }
  );

  if (fullPageShortcut) {
    assert(
      fullPageShortcut.dimensions?.height > 0 && fullPageShortcut.variants?.[0]?.captureHealth?.segmentCount > 1,
      "The packaged full-page shortcut did not capture beyond the visible viewport.",
      fullPageShortcut
    );
    assert(
      fullPageShortcut.captureHealth?.status === "complete" && fullPageShortcut.downloads?.every((download) => download.bytesReceived > 0),
      "The packaged full-page shortcut did not produce a verified downloaded image.",
      fullPageShortcut
    );
    fullPageResultOpened = await captureResultOpened(context, extensionId, fullPageShortcut.id, packagedFiles);
    assert(
      !packagedFiles.includes("result.html") || fullPageResultOpened,
      "The packaged full-page shortcut did not open its result workspace.",
      { captureId: fullPageShortcut.id, pages: context.pages().map((page) => page.url()) }
    );

    await target.bringToFront();
    visibleTrigger = await dispatchBrowserShortcut(target, "V");
    visibleShortcut = await waitForShortcutCapture(worker, 2, visibleTrigger.native ? 30000 : 3500);
    assert(visibleShortcut, "Chrome accepted the full-page shortcut but did not run the packaged visible-area shortcut.", visibleTrigger);
    assert(
      visibleShortcut.dimensions?.height > 0 && visibleShortcut.dimensions.height < fullPageShortcut.dimensions.height,
      "The packaged visible-area shortcut did not stay below the full-page output height.",
      { fullPage: fullPageShortcut.dimensions, visible: visibleShortcut.dimensions }
    );
    assert(
      visibleShortcut.variants?.[0]?.captureHealth?.segmentCount === 1 || visibleShortcut.captureHealth?.segmentCount === 1,
      "The packaged visible-area shortcut did not use exactly one screenshot segment.",
      visibleShortcut
    );
    visibleResultOpened = await captureResultOpened(context, extensionId, visibleShortcut.id, packagedFiles);
    assert(
      !packagedFiles.includes("result.html") || visibleResultOpened,
      "The packaged visible-area shortcut did not open its result workspace.",
      { captureId: visibleShortcut.id, pages: context.pages().map((page) => page.url()) }
    );

    await target.bringToFront();
    areaTrigger = await dispatchBrowserShortcut(target, areaShortcutKey);
    const areaPickerOpened = await target.waitForSelector(
      "#lumen-cutaway-picker .lumen-picker-capture-now",
      { timeout: areaTrigger.native ? 10000 : 3500 }
    ).then(() => true).catch(() => false);
    assert(areaPickerOpened, "The packaged area shortcut did not open the production picker.", areaTrigger);

    const viewport = await target.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      captureWidth: document.documentElement.clientWidth || innerWidth,
      captureHeight: innerHeight
    }));
    const areaStart = {
      x: Math.max(72, Math.round(viewport.width * 0.16)),
      y: Math.max(110, Math.round(viewport.height * 0.18))
    };
    const areaEnd = {
      x: Math.min(viewport.width - 72, areaStart.x + 320),
      y: Math.min(viewport.height - 170, areaStart.y + 220)
    };
    await target.mouse.move(areaStart.x, areaStart.y);
    await target.mouse.down();
    await target.mouse.move(areaEnd.x, areaEnd.y, { steps: 8 });
    await target.mouse.up();
    await target.waitForFunction(() => {
      const button = document.querySelector("#lumen-cutaway-picker .lumen-picker-capture-now");
      return button && !button.disabled;
    });
    await target.click("#lumen-cutaway-picker .lumen-picker-capture-now");
    areaShortcut = await waitForShortcutCapture(worker, 3, 60000);
    assert(areaShortcut, "The packaged Capture now action did not save the selected area.", areaTrigger);
    areaOutput = areaShortcut.downloads?.find((download) => download.kind === "image" && download.role === "cutaway") || null;
    const expectedAreaOutput = {
      width: Math.round((areaEnd.x - areaStart.x) * (visibleShortcut.dimensions.width / viewport.captureWidth)),
      height: Math.round((areaEnd.y - areaStart.y) * (visibleShortcut.dimensions.height / viewport.captureHeight))
    };
    assert(
      areaShortcut.sourceType === "manual" &&
        areaShortcut.cutawayCount === 1 &&
        areaShortcut.variants?.[0]?.captureHealth?.segmentCount === 1 &&
        areaOutput?.bytesReceived > 0 &&
        areaOutput.width > 0 &&
        areaOutput.height > 0 &&
        Math.abs(areaOutput.width - expectedAreaOutput.width) <= 4 &&
        Math.abs(areaOutput.height - expectedAreaOutput.height) <= 4 &&
        areaOutput.width < visibleShortcut.dimensions.width &&
        areaOutput.height < visibleShortcut.dimensions.height,
      "The exact release ZIP did not produce an exact one-segment selected-area image.",
      { areaShortcut, areaOutput, expectedAreaOutput, visibleDimensions: visibleShortcut.dimensions, viewport }
    );
    areaResultOpened = await captureResultOpened(context, extensionId, areaShortcut.id, packagedFiles);
    assert(areaResultOpened, "The packaged selected-area capture did not open its result workspace.", areaShortcut);

    const storedAreaAfterCaptureNow = await worker.evaluate(async (rawUrl) => {
      const url = new URL(rawUrl);
      const key = `${url.origin}${url.pathname}${url.search}`;
      const stored = await chrome.storage.local.get("lumen.capture.cutawayRegions");
      return stored["lumen.capture.cutawayRegions"]?.[key]?.region || null;
    }, fixture.url);
    assert(
      !storedAreaAfterCaptureNow,
      "The packaged Capture now action persisted an area that was not explicitly saved for monitoring.",
      storedAreaAfterCaptureNow
    );
  }

  const permissionsAfterShortcuts = await worker.evaluate(() => chrome.permissions.getAll());
  assert(
    !(permissionsAfterShortcuts.origins || []).length,
    "Shortcut capture persisted a site origin instead of relying on activeTab.",
    permissionsAfterShortcuts
  );
  assert(!popupErrors.length, "Packaged popup emitted runtime errors.", popupErrors);

  console.log(JSON.stringify({
    ok: true,
    zip: {
      path: zipPath,
      bytes: zipStats.size,
      fileCount: packagedFiles.length
    },
    manifest: {
      name: runtimeManifest.name,
      version: runtimeManifest.version,
      manifestVersion: runtimeManifest.manifest_version
    },
    firstRun: {
      stepCount: firstRun.stepCount,
      launchState: firstRun.launchState,
      grantedOrigins: firstRun.permissions.origins || [],
      persistedDismissal: true
    },
    productionCapturePath: {
      exactPackagedManifest: true,
      persistentHostPermissions: runtimeManifest.host_permissions || [],
      grantedOriginsAfterCapture: permissionsAfterShortcuts.origins || [],
      noGrantRejected: !noGrantResponse?.ok,
      noGrantError: noGrantResponse.error,
      registeredCommands: registeredCommands
        .filter((command) => command.name.startsWith("capture-"))
        .map(({ name, shortcut }) => ({ name, shortcut })),
      nativeUserGestureExercised: Boolean(fullPageShortcut && visibleShortcut),
      ciNativeShortcutRequired: requireNativeShortcutCapture,
      fullPage: fullPageShortcut
        ? {
            trigger: fullPageTrigger.method,
            height: fullPageShortcut.dimensions.height,
            segments: fullPageShortcut.variants[0]?.captureHealth?.segmentCount || 0,
            files: fullPageShortcut.files.length,
            resultWorkspaceOpened: fullPageResultOpened
          }
        : null,
      visibleArea: visibleShortcut
        ? {
            trigger: visibleTrigger.method,
            height: visibleShortcut.dimensions.height,
            segments: visibleShortcut.variants[0]?.captureHealth?.segmentCount || 0,
            files: visibleShortcut.files.length,
            resultWorkspaceOpened: visibleResultOpened
          }
        : null,
      selectedArea: areaShortcut
        ? {
            trigger: areaTrigger.method,
            width: areaOutput.width,
            height: areaOutput.height,
            segments: areaShortcut.variants[0]?.captureHealth?.segmentCount || 0,
            files: areaShortcut.files.length,
            resultWorkspaceOpened: areaResultOpened,
            monitoringRegionPersisted: false
          }
        : null,
      automationBoundary: fullPageShortcut
        ? "Chrome toolbar-button clicks remain outside Playwright's page automation surface; all three production keyboard-command activeTab paths and in-page area capture were exercised."
        : `No browser-level command capture was observed after ${fullPageTrigger.method}. Runtime command registration, exact-package wiring, zero persistent host access, and specific activeTab-denial handling passed; a physical toolbar click or OS-level shortcut remains the manual boundary on this host.${fullPageTrigger.error ? ` Native input error: ${fullPageTrigger.error}` : ""}`
    },
    library: cleanLibrary,
    resultWorkspace: packagedResultState,
    editor: editorState,
    review: reviewState
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    details: error.details || null,
    popupErrors
  }, null, 2));
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await new Promise((resolve) => fixtureServer?.close(resolve) || resolve());
  await rm(tempRoot, { recursive: true, force: true });
}

async function startFixtureServer() {
  const server = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <html>
        <head>
          <title>Release fixture</title>
          <style>
            body { margin: 0; font: 16px system-ui; color: #ecfaff; background: #07121a; }
            header { position: sticky; top: 0; padding: 18px 28px; background: #0d2029; }
            main { min-height: 2800px; padding: 64px 8vw; background: linear-gradient(#07121a, #123c47); }
            section { margin-top: 980px; padding: 48px; border: 1px solid #4b727b; border-radius: 24px; }
          </style>
        </head>
        <body>
          <header>Exact-package activeTab fixture</header>
          <main><h1>Clean install target</h1><section>Content below the first viewport</section></main>
        </body>
      </html>`);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  return {
    server,
    url: `http://127.0.0.1:${address.port}/fixture`
  };
}

async function waitForShortcutCapture(worker, expectedCount, timeoutMs = 60000) {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastState = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get([
        "lumen.capture.history",
        "lumen.capture.activeJob"
      ]);

      return {
        history: stored["lumen.capture.history"] || [],
        activeJob: stored["lumen.capture.activeJob"] || null
      };
    });

    if (lastState.history.length >= expectedCount && !lastState.activeJob?.active) {
      return lastState.history[0];
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return null;
}

async function waitForCaptureIdle(worker, timeoutMs = 5000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const stored = await worker.evaluate(() => chrome.storage.local.get("lumen.capture.activeJob"));

    if (!stored["lumen.capture.activeJob"]?.active) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("The packaged worker did not return to idle after rejecting a no-grant capture.");
}

function hasRegisteredShortcut(shortcut, key) {
  return shortcut === `Alt+Shift+${key}` || shortcut === `⌥⇧${key}`;
}

async function dispatchBrowserShortcut(page, key) {
  await page.bringToFront();
  let nativeError = "";

  if (process.platform === "linux" && process.env.DISPLAY) {
    try {
      await execFileAsync("python3", ["-c", buildLinuxShortcutScript(), key], {
        timeout: 5000,
        env: process.env
      });
      return { native: true, method: `X11 Alt+Shift+${key}`, error: "" };
    } catch (error) {
      nativeError = error.message;
    }
  } else if (process.platform === "darwin") {
    try {
      await execFileAsync("osascript", [
        "-e", "tell application id \"com.google.chrome.for.testing\" to activate",
        "-e", `tell application \"System Events\" to keystroke \"${key.toLowerCase()}\" using {option down, shift down}`
      ], { timeout: 5000 });
      return { native: true, method: `macOS Alt+Shift+${key}`, error: "" };
    } catch (error) {
      nativeError = error.message;
    }
  }

  await page.keyboard.press(`Alt+Shift+${key}`);
  return {
    native: false,
    method: `Playwright Alt+Shift+${key}`,
    error: nativeError
  };
}

function buildLinuxShortcutScript() {
  return String.raw`
import ctypes
import sys
import time

x11 = ctypes.CDLL("libX11.so.6")
xtst = ctypes.CDLL("libXtst.so.6")
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XKeysymToKeycode.restype = ctypes.c_uint
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeKeyEvent.restype = ctypes.c_int

display = x11.XOpenDisplay(None)
if not display:
    raise RuntimeError("XOpenDisplay failed")

key = sys.argv[1].lower()
keysyms = [0xffe9, 0xffe1, ord(key)]
keycodes = [x11.XKeysymToKeycode(display, keysym) for keysym in keysyms]
if not all(keycodes):
    raise RuntimeError("X11 could not resolve the shortcut keycodes")

time.sleep(0.15)
for keycode in keycodes:
    if not xtst.XTestFakeKeyEvent(display, keycode, 1, 0):
        raise RuntimeError("XTest key-down dispatch failed")
for keycode in reversed(keycodes):
    if not xtst.XTestFakeKeyEvent(display, keycode, 0, 0):
        raise RuntimeError("XTest key-up dispatch failed")
x11.XFlush(display)
time.sleep(0.15)
x11.XCloseDisplay(display)
`;
}

async function captureResultOpened(context, extensionId, captureId, packagedFiles) {
  if (!packagedFiles.includes("result.html")) {
    return false;
  }

  const expectedUrlPart = `chrome-extension://${extensionId}/result.html?capture=${encodeURIComponent(captureId)}`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10000) {
    if (context.pages().some((page) => page.url().startsWith(expectedUrlPart))) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return false;
}

async function listFiles(root, current = "") {
  const entries = await readdir(path.join(root, current), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relative = path.join(current, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFiles(root, relative));
    } else {
      files.push(relative.split(path.sep).join("/"));
    }
  }

  return files.sort();
}

function assert(condition, message, details = null) {
  if (condition) {
    return;
  }

  const error = new Error(message);
  error.details = details;
  throw error;
}
