import assert from "node:assert/strict";
import { cp, mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), "lumen-result-recovery-"));
const extension = path.join(temporary, "extension");
let browser;
try {
  await cp(root, extension, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(root, source);
      return !relative || relative === "icons" || relative.startsWith(`icons${path.sep}`) ||
        (!relative.includes(path.sep) && /\.(js|html|css|json)$/.test(relative));
    }
  });
  browser = await chromium.launchPersistentContext(path.join(temporary, "profile"), {
    headless: false,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent("serviceworker");
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/library.html`);
  await page.evaluate(async () => {
    const { putLibraryCapture } = await import("./library-store.js");
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    canvas.getContext("2d").fillRect(0, 0, 640, 480);
    const second = document.createElement("canvas");
    second.width = 320;
    second.height = 240;
    second.getContext("2d").fillRect(0, 0, 320, 240);
    await putLibraryCapture({
      id: "partial-fixture",
      title: "Partial capture (1/3 views): Recovery fixture",
      captureHealth: { status: "partial" },
      dimensions: { width: 640, height: 480 },
      variantCount: 1,
      editorSourceDataUrl: canvas.toDataURL(),
      bundleImages: [
        { dataUrl: canvas.toDataURL(), thumbnailDataUrl: canvas.toDataURL(), width: 640, height: 480, filename: "desktop.png", variantId: "desktop" },
        { dataUrl: second.toDataURL(), width: 320, height: 240, filename: "tablet.png", variantId: "tablet" }
      ],
      previews: [{ dataUrl: canvas.toDataURL(), width: 640, height: 480 }]
    });
  });
  await page.goto(`${origin}/result.html?capture=partial-fixture`);
  await page.waitForFunction(() => ["ready", "limited"].includes(document.body.dataset.state));
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.locator("#captureWarning").isVisible(), `Warning hidden at ${width}px`);
    const bounds = await page.locator("#captureWarning").boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, "Warning overflowed the viewport");
    assert(await page.locator("#downloadPngButton").isEnabled(), "Recovered image cannot be saved");
    assert(await page.locator("#copyImageButton").isEnabled(), "Recovered image cannot be copied");
  }
  await page.evaluate(async () => {
    const { putLibraryCapture } = await import("./library-store.js");
    await putLibraryCapture({ id: "partial-fixture", captureHealth: { status: "complete" } });
  });
  await page.reload();
  await page.waitForFunction(() => ["ready", "limited"].includes(document.body.dataset.state));
  assert(await page.locator("#captureWarning").isHidden(), "Complete capture retained warning");
  const imageButtons = page.locator(".capture-set-item button");
  assert.equal(await imageButtons.count(), 2);
  await imageButtons.nth(0).click();
  await page.waitForFunction(() => document.querySelector(".capture-set-item button")?.getAttribute("aria-pressed") === "true");
  await page.waitForFunction(() => document.querySelector(".capture-set-item img")?.naturalWidth > 0);
  const firstPngEvent = page.waitForEvent("download");
  await page.locator("#downloadPngButton").click();
  await (await firstPngEvent).saveAs(path.join(temporary, "first.png"));
  await imageButtons.nth(0).press("ArrowRight");
  await page.waitForFunction(() => document.querySelectorAll(".capture-set-item button")[1]?.getAttribute("aria-pressed") === "true");
  assert((await page.locator("#resultSource").textContent()).includes("tablet"));
  assert.equal(await page.locator("#resultImage").evaluate((image) => image.naturalWidth), 320);
  const secondPngEvent = page.waitForEvent("download");
  await page.locator("#downloadPngButton").click();
  await (await secondPngEvent).saveAs(path.join(temporary, "second.png"));
  assert.equal((await readFile(path.join(temporary, "first.png"))).readUInt32BE(16), 640);
  assert.equal((await readFile(path.join(temporary, "second.png"))).readUInt32BE(16), 320, "PNG cache retained the previous image");
  const editorEvent = browser.waitForEvent("page");
  await page.locator("#annotateButton").click();
  const selectedEditor = await editorEvent;
  await selectedEditor.waitForFunction(() => document.querySelector("#editorCanvas")?.width === 320);
  assert(selectedEditor.url().includes("bundle="), "Edit opened the primary capture instead of the selected part");
  await selectedEditor.close();
  await page.getByRole("button", { name: "Clear selection", exact: true }).click();
  assert(await page.getByRole("button", { name: "Download ZIP (0)", exact: true }).isDisabled());
  await page.getByRole("checkbox", { name: "Include image 2 in ZIP", exact: true }).check();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP (1)", exact: true }).click();
  const archive = await downloadEvent;
  const archivePath = path.join(temporary, "selected.zip");
  await archive.saveAs(archivePath);
  const unzip = promisify(execFile);
  await unzip("unzip", ["-t", archivePath]);
  const entries = await unzip("unzip", ["-Z1", archivePath]);
  assert.equal(entries.stdout.trim(), "01-tablet.png", "ZIP contained unselected files");
  const png = await unzip("unzip", ["-p", archivePath, "01-tablet.png"], { encoding: "buffer" });
  assert.equal(png.stdout.readUInt32BE(16), 320, "ZIP contained the wrong image pixels");
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  const allDownloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download ZIP (2)", exact: true }).click();
  const allArchivePath = path.join(temporary, "all.zip");
  await (await allDownloadEvent).saveAs(allArchivePath);
  await unzip("unzip", ["-t", allArchivePath]);
  assert.equal((await unzip("unzip", ["-Z1", allArchivePath])).stdout.trim(), "01-desktop.png\n02-tablet.png");
  const ownership = await page.evaluate(async () => {
    const { getLibraryCapture, getLibraryBundleImage } = await import("./library-store.js");
    const capture = await getLibraryCapture("partial-fixture");
    return await getLibraryBundleImage("other-capture", capture.bundleImages[0].id);
  });
  assert.equal(ownership, null, "Bundle lookup crossed capture ownership");
  if (process.env.LUMEN_CAPTURE_SET_SCREENSHOT) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `${process.env.LUMEN_CAPTURE_SET_SCREENSHOT}-${width}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/editor.html?capture=partial-fixture`);
  await page.waitForFunction(() => !document.querySelector("#exportButton").disabled);
  const color = page.locator("#colorInput");
  const thickness = page.locator("#strokeWidthInput");
  assert(await color.isHidden(), "Empty selection showed style controls");
  for (const tool of ["arrow", "rectangle", "text", "blur", "pixelate", "select"]) {
    await page.locator(`[data-tool="${tool}"]`).click();
    assert.equal(await color.isVisible(), ["arrow", "rectangle", "text"].includes(tool));
    assert.equal(await thickness.isVisible(), ["arrow", "rectangle"].includes(tool));
    assert.equal(await page.locator("#blurRadiusInput").isVisible(), tool === "blur");
    assert.equal(await page.locator("#pixelSizeInput").isVisible(), tool === "pixelate");
  }
  assert(await page.locator(".shortcut-card dl").isHidden());
  await page.locator(".shortcut-card summary").click();
  assert(await page.locator(".shortcut-card dl").isVisible());
  const storage = await page.evaluate(async () => {
    const { putLibraryCapture, getLibraryCapture, getLibraryBundleImage, deleteLibraryCapture } = await import("./library-store.js");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const image = { dataUrl: canvas.toDataURL(), width: 8, height: 8 };
    const capped = await putLibraryCapture({ id: "limit-fixture", bundleImages: Array.from({ length: 41 }, () => image) });
    await putLibraryCapture({ id: "limit-fixture", title: "Metadata update" });
    const preserved = await getLibraryCapture("limit-fixture");
    const original = capped.bundleImages[0].id;
    // Simulate an over-budget cache record without allocating 129 MB in a test.
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("lumen.capture.library", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("captures", "readwrite");
        const store = tx.objectStore("captures");
        const read = store.get("limit-fixture");
        read.onsuccess = () => {
          const record = read.result;
          record.bundleImages[0].byteLength = 129 * 1024 * 1024;
          store.put(record);
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    await putLibraryCapture({ id: "new-fixture", bundleImages: [image] });
    const evicted = await getLibraryCapture("limit-fixture");
    const missing = await getLibraryBundleImage("limit-fixture", original);
    const deleted = await deleteLibraryCapture("new-fixture");
    return { count: capped.bundleImages.length, preserved: preserved.bundleImages.length, evicted: evicted.bundleImages.length, missing, deleted: deleted.assetCount };
  });
  assert.deepEqual(storage, { count: 40, preserved: 40, evicted: 0, missing: null, deleted: 1 });
  assert.deepEqual(errors, []);
  console.log("Capture set passed: three widths, thumbnails, keyboard selection, correct PNG/editor pixels, selected ZIP extraction, cache limits, ownership, cleanup, and legacy editor controls.");
} finally {
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
