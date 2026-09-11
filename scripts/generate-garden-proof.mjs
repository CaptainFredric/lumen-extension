import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { LUMEN_CONFIG } from "../config.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "lumen-garden-proof-"));
const extension = path.join(temp, "extension");
const profile = path.join(temp, "profile");
const downloads = path.join(temp, "downloads");
const staged = path.join(temp, "proof");
const output = path.join(root, "docs/assets");
let context;
let server;
try {
  const html = await readFile(path.join(root, "docs/bug-garden.html"));
  server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/bug-garden.html`;
  await cp(root, extension, { recursive: true, filter: (source) => !path.relative(root, source).split(path.sep).some((part) => [".git", "node_modules"].includes(part) || part.endsWith(".zip")) });
  const manifestPath = path.join(extension, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // Only this temporary copy has broad access: the harness starts a capture
  // from an extension page, without Chrome's real toolbar activeTab gesture.
  manifest.host_permissions = ["<all_urls>"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  await mkdir(path.join(profile, "Default"), { recursive: true });
  await mkdir(downloads);
  await mkdir(staged);
  await writeFile(path.join(profile, "Default/Preferences"), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false }, profile: { default_content_setting_values: { automatic_downloads: 1 } } }));
  context = await chromium.launchPersistentContext(profile, { headless: false, viewport: null, acceptDownloads: true, downloadsPath: downloads, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  const target = await context.newPage();
  await target.goto(url);
  // captureVisibleTab uses physical browser geometry, not Playwright's emulation.
  const targetTab = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url), url);
  const dimensions = await target.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await worker.evaluate(async ({ windowId, dimensions }) => {
    const window = await chrome.windows.get(windowId);
    await chrome.windows.update(windowId, { width: window.width + 1280 - dimensions.width, height: window.height + 600 - dimensions.height });
  }, { windowId: targetTab.windowId, dimensions });
  await target.waitForFunction(() => innerWidth === 1280);
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/popup.html`);
  await target.bringToFront();
  const response = await control.evaluate(() => chrome.runtime.sendMessage({ type: "LUMEN_START_CAPTURE", payload: { options: { devicePreset: "responsive", exportPreset: "raw", removeStickyHeaders: true, forceLazyLoad: true, autoRedact: true, exportManifest: true, annotationEnabled: false } } }));
  assert.equal(response?.ok, true, JSON.stringify(response));
  assert.equal(response.variantCount, 3);
  assert.equal(response.captureHealth?.status, "complete");
  assert.ok(response.redactionCount >= 3, "Each viewport must detect the fictional email");
  assert.equal(response.librarySaved, true);
  const records = await worker.evaluate(async (items) => {
    const result = [];
    for (const record of items) {
      const [download] = await chrome.downloads.search({ id: record.downloadId });
      result.push({ ...record, filename: download.filename, state: download.state });
    }
    return result;
  }, response.downloads);
  const images = records.filter((record) => record.kind === "image");
  assert.equal(images.length, 3);
  const pixelRatio = images.find((record) => record.variantId === "desktop").width / 1280;
  for (const [variantId, preset] of Object.entries(LUMEN_CONFIG.capture.viewports)) {
    assert.equal(images.find((record) => record.variantId === variantId)?.width, preset.width * pixelRatio);
  }
  for (const record of records) {
    assert.equal(record.state, "complete");
    assert.ok(record.filename.startsWith(`${downloads}${path.sep}`), "Download must stay in the temporary profile");
  }
  for (const record of images) {
    assert.ok(["desktop", "tablet", "mobile"].includes(record.variantId));
    await cp(record.filename, path.join(staged, `garden-${record.variantId}.png`));
  }
  const stored = await control.evaluate(async (captureId) => {
    const { getLibraryCapture } = await import("./library-store.js");
    const capture = await getLibraryCapture(captureId);
    const local = await chrome.storage.local.get("lumen.inspector.latestBlueprint");
    return { capture, blueprint: local["lumen.inspector.latestBlueprint"] };
  }, response.captureId);
  assert.ok(stored.capture);
  assert.ok(stored.blueprint?.identity?.navLabels?.includes("Checkout"));
  assert.equal(stored.blueprint.page.title, "Lumen Bug Garden | Checkout 01");
  const resultUrl = `chrome-extension://${id}/result.html?capture=${encodeURIComponent(response.captureId)}`;
  const result = context.pages().find((page) => page.url().startsWith(resultUrl)) || await context.newPage();
  if (!result.url().startsWith(resultUrl)) await result.goto(resultUrl);
  await result.setViewportSize({ width: 1280, height: 800 });
  await result.waitForFunction(() => document.body.dataset.state === "ready");
  await result.locator(".capture-set-item button").first().click();
  await result.waitForFunction(() => document.querySelector(".capture-set-item img")?.naturalWidth > 0);
  await result.locator("#resultStatus").waitFor({ state: "hidden" });
  await result.screenshot({ path: path.join(staged, "garden-result.png") });
  const proof = {
    generatedAt: new Date().toISOString(),
    fixtureSha256: createHash("sha256").update(html).digest("hex"),
    source: "docs/bug-garden.html through the loaded Lumen extension. Temporary harness permissions differ from the toolbar installation.",
    captureId: response.captureId,
    variantCount: response.variantCount,
    redactionCount: response.redactionCount,
    captureHealth: response.captureHealth,
    historyItem: { id: stored.capture.id, title: stored.capture.title },
    images: images.map(({ variantId, width, height }) => ({ variantId, width, height, file: `garden-${variantId}.png` })),
    blueprint: stored.blueprint,
  };
  await writeFile(path.join(staged, "garden-run.json"), `${JSON.stringify(proof, null, 2)}\n`);
  // Publish only after the real run and all assertions succeed.
  for (const file of ["garden-desktop.png", "garden-tablet.png", "garden-mobile.png", "garden-result.png", "garden-run.json"]) await cp(path.join(staged, file), path.join(output, file));
  console.log(JSON.stringify(proof, null, 2));
} finally {
  await context?.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
