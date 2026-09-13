import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(path.join(os.tmpdir(), "lumen-garden-store-"));
const extension = path.join(temp, "extension");
const profile = path.join(temp, "profile");
const downloads = path.join(temp, "downloads");
const staged = path.join(temp, "screenshots");
const destination = path.join(root, "store-assets/screenshots");
const fixture = await readFile(path.join(root, "docs/bug-garden.html"), "utf8");
const stateB = fixture.replace("$18.00", "$21.00").replace("Coupon applied: EXAMPLE10", "Coupon expired").replace("Checkout 01</title>", "Checkout 02</title>");
let currentFixture = fixture;
let context;
let renderer;
let server;
const dataUrl = buffer => "data:image/png;base64," + buffer.toString("base64");
const proof = { source: "Bug Garden through the loaded extension. Temporary harness site access replaces the toolbar gesture.", fixtureSha256: hash(fixture), stateBSha256: hash(stateB), captures: [], frames: [] };

try {
  await mkdir(staged);
  await mkdir(downloads);
  server = createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(currentFixture); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/bug-garden.html`;
  await cp(root, extension, { recursive: true, filter: source => !path.relative(root, source).split(path.sep).some(part => [".git", "node_modules", "dist", "store-assets"].includes(part) || part.endsWith(".zip")) });
  const manifestFile = path.join(extension, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  // Test-only site access. The distributed manifest remains unchanged.
  manifest.host_permissions = ["<all_urls>"];
  await writeFile(manifestFile, JSON.stringify(manifest));
  await mkdir(path.join(profile, "Default"), { recursive: true });
  await writeFile(path.join(profile, "Default/Preferences"), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false }, profile: { default_content_setting_values: { automatic_downloads: 1 } } }));
  context = await chromium.launchPersistentContext(profile, { headless: false, viewport: null, acceptDownloads: true, downloadsPath: downloads, reducedMotion: "reduce", args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  const target = await context.newPage();
  await target.goto(url);
  const control = await context.newPage();
  await control.goto(`chrome-extension://${id}/popup.html`);

  async function capture(preset) {
    await target.bringToFront();
    const tab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url), url);
    const viewport = await target.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await worker.evaluate(async ({ tab, viewport }) => {
      const window = await chrome.windows.get(tab.windowId);
      await chrome.windows.update(tab.windowId, { width: window.width + 1280 - viewport.width, height: window.height + 680 - viewport.height });
    }, { tab, viewport });
    await target.waitForFunction(() => innerWidth === 1280);
    const result = await control.evaluate(preset => chrome.runtime.sendMessage({ type: "LUMEN_START_CAPTURE", payload: { options: { devicePreset: preset, exportPreset: "raw", removeStickyHeaders: true, forceLazyLoad: true, autoRedact: true, exportManifest: true, annotationEnabled: false } } }), preset);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.captureHealth.status, "complete");
    assert.equal(result.librarySaved, true);
    assert.ok(result.redactionCount >= result.variantCount);
    proof.captures.push({ id: result.captureId, variantCount: result.variantCount, redactions: result.redactionCount, health: result.captureHealth.status });
    return result;
  }

  const first = await capture("responsive");
  assert.equal(first.variantCount, 3);
  const retained = await control.evaluate(async id => (await import("./library-store.js")).getLibraryCapture(id), first.captureId);
  const mobile = retained.bundleImages.find(image => image.variantId === "mobile");
  assert.ok(mobile?.id);
  const images = {};
  for (const output of first.downloads.filter(item => item.kind === "image")) {
    const record = await worker.evaluate(async id => (await chrome.downloads.search({ id }))[0], output.downloadId);
    assert.equal(record.state, "complete");
    assert.ok(record.filename.startsWith(downloads + path.sep));
    images[output.variantId] = dataUrl(await readFile(record.filename));
  }
  assert.deepEqual(Object.keys(images).sort(), ["desktop", "mobile", "tablet"]);

  async function workspace(route, ready, width = 1200, height = 570) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    await page.goto(`chrome-extension://${id}/${route}`);
    await ready(page);
    return page;
  }
  const resultPage = await workspace(`result.html?capture=${first.captureId}`, page => page.waitForSelector('body[data-state="ready"]'));
  await resultPage.locator(".capture-set-item button").first().click();
  await resultPage.locator("#resultStatus").waitFor({ state: "hidden" });
  await resultPage.locator("#resultViewport").evaluate(node => { node.scrollTop = 260; });
  const resultShot = dataUrl(await resultPage.screenshot());
  await resultPage.close();

  // Use the measured fixture element to place a real editor annotation.
  renderer = await chromium.launch();
  const measure = await renderer.newPage({ viewport: { width: 430, height: 932 } });
  await measure.goto(url);
  const issue = await measure.locator(".continue").evaluate(node => {
    const r = node.getBoundingClientRect();
    return { left: r.left, top: r.top + scrollY, right: Math.min(r.right, 430), bottom: r.bottom + scrollY, pageHeight: document.documentElement.scrollHeight };
  });
  await measure.close();
  const editor = await workspace(`editor.html?capture=${first.captureId}&bundle=${encodeURIComponent(mobile.id)}`, page => page.waitForSelector("#exportButton:not(:disabled)"));
  await editor.locator('[data-tool="rectangle"]').click();
  const canvas = await editor.locator("#editorCanvas").boundingBox();
  assert.ok(canvas?.width > 0);
  const x = value => canvas.x + value / 430 * canvas.width;
  const y = value => canvas.y + value / issue.pageHeight * canvas.height;
  await editor.mouse.move(x(issue.left - 5), y(issue.top - 6));
  await editor.mouse.down();
  await editor.mouse.move(x(issue.right - 2), y(issue.bottom + 6), { steps: 12 });
  await editor.mouse.up();
  await editor.waitForFunction(() => globalThis.LumenAnnotationEditor.getAnnotationCount() === 1);
  for (let step = 0; step < 3; step++) await editor.locator("#zoomInButton").click();
  await editor.locator(".canvas-stage").evaluate(async node => {
    node.scrollTop = node.scrollHeight;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.equal(await editor.locator(".canvas-stage").evaluate((node, issue) => {
    const canvas = document.getElementById("editorCanvas").getBoundingClientRect();
    const stage = node.getBoundingClientRect();
    const markTop = canvas.top + issue.top / issue.pageHeight * canvas.height;
    return markTop >= stage.top && markTop < stage.bottom - 20;
  }, issue), true, "The annotation must be visible in the Store image");
  proof.annotations = { count: 1, sourceCapture: first.captureId, variant: "mobile", target: ".continue" };
  const editorShot = dataUrl(await editor.screenshot());
  await editor.close();

  currentFixture = stateB;
  await target.reload();
  const second = await capture("desktop");
  const compare = await workspace(`review.html?before=${first.captureId}&after=${second.captureId}`, page => page.waitForFunction(() => !document.querySelector("#reviewContent")?.classList.contains("is-hidden") && parseFloat(document.querySelector("#changePercentMetric")?.textContent) > 0), 1200, 1800);
  proof.compare = { before: first.captureId, after: second.captureId, changed: await compare.locator("#changePercentMetric").innerText() };
  await compare.locator("#revealSlider").fill("70");
  await compare.locator("#revealSlider").dispatchEvent("input");
  await compare.locator("#revealSlider").blur();
  proof.compare.revealPercent = Number(await compare.locator("#revealSlider").inputValue());
  await compare.evaluate(() => scrollTo(0, 0));
  const compareShot = dataUrl(await compare.locator("#comparisonPanel").screenshot());
  await compare.close();

  // Create a real saved area and monitor via their UI; no invented run history.
  await target.bringToFront();
  const picker = await control.evaluate(() => chrome.runtime.sendMessage({ type: "LUMEN_START_CUTAWAY_PICKER", payload: { selectionMode: "rect" } }));
  assert.equal(picker.ok, true);
  const total = await target.locator(".total").boundingBox();
  await target.mouse.move(total.x, total.y);
  await target.mouse.down();
  await target.mouse.move(total.x + total.width, total.y + total.height, { steps: 10 });
  await target.mouse.up();
  await target.locator("#lumen-cutaway-picker .lumen-picker-primary").click();
  const library = await workspace("library.html#monitors", page => page.waitForFunction(() => Boolean(document.querySelector("#monitorArea")?.value)), 740, 570);
  await library.locator("#monitorMode").selectOption("continuous");
  await library.locator("#monitorInterval").fill("1");
  await library.locator("#monitorLimit").fill("5");
  await library.locator('#monitorForm button[type="submit"]').click();
  await library.waitForSelector("#monitorList .monitor-card");
  await library.locator("#monitorList button").filter({ hasText: /^Pause$/ }).click();
  await library.waitForSelector("#monitorList button:text-is('Resume')");
  const plan = await control.evaluate(async () => (await chrome.storage.local.get("lumen.watch.plans"))["lumen.watch.plans"][0]);
  assert.equal(plan.status, "paused");
  assert.equal(plan.schedule.intervalMinutes, 1);
  assert.equal(plan.schedule.maxRuns, 5);
  assert.equal(plan.runCount || 0, 0);
  proof.monitor = { source: ".total", intervalMinutes: plan.schedule.intervalMinutes, maxRuns: plan.schedule.maxRuns, status: plan.status, runs: plan.runCount || 0 };
  await library.setViewportSize({ width: 480, height: 700 });
  await library.locator("#monitorList").scrollIntoViewIfNeeded();
  const monitorShot = dataUrl(await library.locator("#monitorList").screenshot());
  await library.setViewportSize({ width: 740, height: 570 });
  await library.goto(`chrome-extension://${id}/library.html`);
  await library.waitForFunction(() => Number(document.getElementById("captureMetric")?.textContent) === 2);
  await library.locator("#captureGrid").scrollIntoViewIfNeeded();
  await library.waitForFunction(() => [...document.querySelectorAll("#captureGrid img")].every(image => image.naturalWidth > 0));
  const libraryShot = dataUrl(await library.locator("#captureGrid").screenshot());
  await library.close();

  const page = await renderer.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const frames = [
    ["01-capture-result.png", "Capture the page. Keep the context.", "Bug Garden / one real responsive capture, opened in Lumen.", `<img class="workspace" src="${resultShot}">`, ["store-control-surface.png"]],
    ["02-responsive-set.png", "Find the width where it breaks.", "1280 px: clear layout. 1024 px: coupon overlap. 430 px: clipped button.", `<div class="responsive">${["desktop", "tablet", "mobile"].map((name, index) => `<figure><figcaption>${[1280, 1024, 430][index]} CSS px</figcaption><img src="${images[name]}"></figure>`).join("")}</div>`, ["store-responsive-set.png"]],
    ["03-annotation-redaction.png", "Mark the issue. Hide private details.", "The captured mobile page, with its test email redacted and the clipped button marked in the editor.", `<img class="workspace" src="${editorShot}">`, ["store-review-actions.png", "store-annotation-studio.png"]],
    ["04-compare.png", "See what changed.", "The same checkout, captured again after the total and coupon changed.", `<img class="workspace" src="${compareShot}">`, ["store-visual-change-review.png"]],
    ["05-library-monitor.png", "Keep it. Check the same area later.", "Captures stay in Library. Choose a schedule when you need to check a selected area again.", `<div class="pair"><section><h2>Capture Library</h2><img src="${libraryShot}"></section><section><h2>Area monitor / paused</h2><img src="${monitorShot}"><p class="note">One minute apart. Five runs maximum.<br>Saved and paused here before its first run.</p></section></div>`, ["store-library-monitor.png"]]
  ];
  for (const [filename, title, detail, body, aliases] of frames) {
    await page.setContent(frame(title, detail, body));
    await page.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode())); await document.fonts.ready; });
    const bytes = await page.screenshot();
    assert.equal(bytes.readUInt32BE(16), 1280);
    assert.equal(bytes.readUInt32BE(20), 800);
    await writeFile(path.join(staged, filename), bytes);
    proof.frames.push({ filename, aliases, sha256: hash(bytes) });
  }
  proof.generatedAt = new Date().toISOString();
  await writeFile(path.join(staged, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
  // Keep the previous pack intact until every capture, UI state and image passes.
  const backup = path.join(temp, "previous");
  let hadPrevious = true;
  try { await rename(destination, backup); } catch (error) { if (error.code !== "ENOENT") throw error; hadPrevious = false; }
  try { await cp(staged, destination, { recursive: true }); }
  catch (error) { await rm(destination, { recursive: true, force: true }); if (hadPrevious) await rename(backup, destination); throw error; }
  for (const item of proof.frames) for (const alias of item.aliases) await cp(path.join(destination, item.filename), path.join(root, "docs/assets", alias));
  console.log(JSON.stringify({ ok: true, outputDir: destination, ...proof }, null, 2));
} finally {
  await context?.close().catch(() => {});
  await renderer?.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function frame(title, detail, content) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Lumen Store preview</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f3f3ef;color:#192322;font-family:"Avenir Next","Trebuchet MS",sans-serif}
  main{padding:30px 40px;width:1280px;height:800px;overflow:hidden}header{display:flex;justify-content:space-between;border-bottom:1px solid #bac5bd;padding-bottom:12px;font-size:14px}
  h1{font-size:38px;letter-spacing:-1.4px;margin:20px 0 8px}p{font-size:17px;color:#465750;margin:0 0 22px}
  .workspace{display:block;width:1200px;height:570px;object-fit:contain;background:#171b1e;border:1px solid #4e6259;border-radius:8px}
  .responsive{display:grid;grid-template-columns:1.35fr 1.08fr .58fr;gap:22px;height:560px;align-items:start}
  figure{margin:0;border:1px solid #8fa39a;background:white;height:560px;overflow:hidden;border-radius:6px}
  figcaption{font-family:monospace;padding:12px;background:#192622;color:#a6e6c9}
  figure img{width:100%;height:515px;object-fit:contain;object-position:top;display:block}
  .pair{display:grid;grid-template-columns:1.55fr 1fr;gap:24px;align-items:start}
  .pair section{background:#171b1e;padding:20px;border:1px solid #4e6259;border-radius:8px}
  .pair img{width:100%;max-height:475px;object-fit:contain;object-position:top}
  .pair h2{color:#bde2ce;font-size:18px;margin:0 0 20px}.note{color:#a8bfb3;font-size:16px;line-height:1.7;margin:24px 0 0}
  </style><main><header><strong>Lumen</strong><span>Browser capture / local evidence</span></header><h1>${title}</h1><p>${detail}</p>${content}</main></html>`;
}
