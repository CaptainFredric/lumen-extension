import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// This generator only updates the site's raw Compare image and its record.
// The reviewed Store pack and published beta remain separate artifacts.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "lumen-site-compare-"));
const extension = path.join(temp, "extension");
const profile = path.join(temp, "profile");
const downloads = path.join(temp, "downloads");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
let context;
let server;
try {
  const before = await readFile(path.join(root, "docs/bug-garden.html"), "utf8");
  const after = before.replace("$18.00", "$21.00")
    .replace("Coupon applied: EXAMPLE10", "Coupon expired")
    .replace("Checkout 01</title>", "Checkout 02</title>");
  assert.notEqual(before, after);
  let fixture = before;
  server = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(fixture);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/bug-garden.html`;
  await cp(root, extension, { recursive: true, filter: source =>
    !path.relative(root, source).split(path.sep).some(part =>
      [".git", "node_modules", "dist", "store-assets"].includes(part) || part.endsWith(".zip")) });
  const manifestPath = path.join(extension, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // Harness-only access substitutes for the stock Chrome toolbar gesture.
  manifest.host_permissions = ["<all_urls>"];
  await writeFile(manifestPath, JSON.stringify(manifest));
  await mkdir(path.join(profile, "Default"), { recursive: true });
  await mkdir(downloads);
  await writeFile(path.join(profile, "Default/Preferences"), JSON.stringify({
    download: { default_directory: downloads, prompt_for_download: false },
    profile: { default_content_setting_values: { automatic_downloads: 1 } }
  }));
  context = await chromium.launchPersistentContext(profile, {
    headless: false, viewport: null, acceptDownloads: true, downloadsPath: downloads,
    reducedMotion: "reduce",
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  const target = await context.newPage();
  await target.goto(url);
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/popup.html`);
  const captures = [];
  for (const state of [before, after]) {
    fixture = state;
    await target.reload();
    await target.bringToFront();
    const tab = await worker.evaluate(async url =>
      (await chrome.tabs.query({})).find(tab => tab.url === url), url);
    const viewport = await target.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await worker.evaluate(async ({ tab, viewport }) => {
      const window = await chrome.windows.get(tab.windowId);
      await chrome.windows.update(tab.windowId, {
        width: window.width + 1280 - viewport.width,
        height: window.height + 680 - viewport.height
      });
    }, { tab, viewport });
    await target.waitForFunction(() => innerWidth === 1280);
    const result = await control.evaluate(() => chrome.runtime.sendMessage({
      type: "LUMEN_START_CAPTURE",
      payload: { options: { devicePreset: "desktop", exportPreset: "raw",
        removeStickyHeaders: true, forceLazyLoad: true, autoRedact: true,
        exportManifest: false, annotationEnabled: false } }
    }));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.captureHealth.status, "complete");
    assert.equal(result.librarySaved, true);
    assert.ok(result.redactionCount >= 1);
    captures.push({ id: result.captureId, health: result.captureHealth.status,
      redactions: result.redactionCount });
  }
  const compare = await context.newPage();
  await compare.setViewportSize({ width: 1280, height: 900 });
  await compare.goto(`chrome-extension://${id}/review.html?before=${captures[0].id}&after=${captures[1].id}`);
  await compare.waitForFunction(() =>
    !document.querySelector("#reviewContent").classList.contains("is-hidden") &&
    parseFloat(document.querySelector("#changePercentMetric").textContent) > 0);
  await compare.locator("#revealSlider").fill("70");
  await compare.locator("#revealSlider").dispatchEvent("input");
  await compare.locator("#revealSlider").blur();
  await compare.locator("#comparisonPanel").scrollIntoViewIfNeeded();
  await compare.evaluate(() => document.fonts.ready);
  const image = await compare.screenshot({ scale: "css" });
  assert.equal(image.readUInt32BE(16), 1280);
  assert.equal(image.readUInt32BE(20), 900);
  const proof = {
    source: "Two Bug Garden states captured through the loaded extension; raw Compare viewport, without a marketing frame. Temporary harness site permissions substitute for a toolbar gesture.",
    generatedAt: new Date().toISOString(),
    generatorSha256: hash(await readFile(fileURLToPath(import.meta.url))),
    fixtureSha256: hash(before), afterSha256: hash(after), captures,
    changed: await compare.locator("#changePercentMetric").innerText(),
    revealPercent: 70, image: { file: "garden-compare.png", width: 1280, height: 900, sha256: hash(image) },
    environment: { platform: process.platform, node: process.version,
      ...await compare.evaluate(() => ({ userAgent: navigator.userAgent,
        deviceScaleFactor: devicePixelRatio, viewport: { width: innerWidth, height: innerHeight } })) }
  };
  await writeFile(path.join(root, "docs/assets/garden-compare.png"), image);
  await writeFile(path.join(root, "docs/assets/garden-compare.json"), JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, ...proof }, null, 2));
} finally {
  await context?.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
