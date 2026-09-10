import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

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
    await putLibraryCapture({
      id: "partial-fixture",
      title: "Partial capture (1/3 views): Recovery fixture",
      captureHealth: { status: "partial" },
      dimensions: { width: 640, height: 480 },
      variantCount: 1,
      editorSourceDataUrl: canvas.toDataURL(),
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
  assert.deepEqual(errors, []);
  console.log("Result recovery UI passed at 1440, 768, and 390px; copy/save enabled; complete state cleared warning.");
} finally {
  await browser?.close();
  await rm(temporary, { recursive: true, force: true });
}
