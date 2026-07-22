import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { chromium } from "playwright";
import { sanitizeCaptureUrl } from "../config.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const sourceManifest = JSON.parse(await readFile(path.join(repoRoot, "manifest.json"), "utf8"));
const zipPath = path.join(repoRoot, "dist", `lumen-extension-${sourceManifest.version}.zip`);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lumen-release-package-"));
const extensionDir = path.join(tempRoot, "extension");
const profileDir = path.join(tempRoot, "profile");
const popupErrors = [];

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

  assert(packagedManifest.version === sourceManifest.version, "Packaged manifest version drifted from source.", {
    source: sourceManifest.version,
    packaged: packagedManifest.version
  });
  assert(!packagedManifest.host_permissions?.length, "Release package unexpectedly contains always-on host permissions.", packagedManifest);
  assert(packagedManifest.optional_host_permissions?.length === 2, "Release package lost its optional site-permission declarations.", packagedManifest);
  assert(!packagedFiles.some((file) => /^(scripts|backend|docs|\.github|node_modules)\//.test(file)), "Release ZIP contains development-only files.", packagedFiles);
  assert(
    [
      "library.html", "library.css", "library.js", "library-store.js",
      "annotation-engine.js", "export-utils.js", "editor.html", "editor.css", "editor.js", "editor-drive.js",
      "visual-diff-engine.js", "review.html", "review.css", "review.js", "review-actions.js",
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
  // still explaining the first-run path; toolbar-driven capture is covered by
  // the loaded-extension and end-to-end suites.
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
    library: cleanLibrary,
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
    response.end("<!doctype html><html><head><title>Release fixture</title></head><body><main><h1>Clean install target</h1></main></body></html>");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  return {
    server,
    url: `http://127.0.0.1:${address.port}/fixture`
  };
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
