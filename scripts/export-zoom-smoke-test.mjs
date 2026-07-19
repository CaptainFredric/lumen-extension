import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  buildExportFilename,
  buildImagePdfBytes,
  calculatePdfPagination
} from "../export-utils.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = await startStaticServer();
const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "lumen-export-zoom-"));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1440, height: 1000 }
});

try {
  verifyPureExportHelpers();
  const editorPage = await context.newPage();
  const runtimeErrors = collectRuntimeErrors(editorPage);
  await editorPage.goto(`${fixture.baseUrl}/editor.html?demo=1`, { waitUntil: "networkidle" });
  await editorPage.locator("#exportButton:not(:disabled)").waitFor();

  assert.equal(await editorPage.locator("#exportPdfButton").isEnabled(), true);
  assert.equal(await editorPage.locator("#actualSizeButton").isEnabled(), true);
  await editorPage.locator("#actualSizeButton").click();
  assert.equal(await editorPage.locator("#zoomLabel").innerText(), "100%");
  assert.match(await editorPage.locator("#statusMessage").innerText(), /Actual pixels at 100%/);

  await editorPage.keyboard.press("Control+0");
  assert.equal(await editorPage.locator("#zoomLabel").innerText(), "Fit");
  await editorPage.keyboard.press("Control+1");
  assert.equal(await editorPage.locator("#zoomLabel").innerText(), "100%");
  await editorPage.keyboard.press("Control+=");
  assert.equal(await editorPage.locator("#zoomLabel").innerText(), "125%");
  await editorPage.locator("#fitButton").click();

  const pngDownload = await triggerDownload(editorPage, "#exportButton");
  const pngPath = path.join(outputDirectory, pngDownload.suggestedFilename());
  await pngDownload.saveAs(pngPath);
  const pngBytes = await readFile(pngPath);
  assert.deepEqual([...pngBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(readPngDimensions(pngBytes), { width: 1440, height: 900 });
  assert.match(await editorPage.locator("#statusMessage").innerText(), /1440×900px/);

  const pdfDownload = await triggerDownload(editorPage, "#exportPdfButton");
  const pdfPath = path.join(outputDirectory, pdfDownload.suggestedFilename());
  await pdfDownload.saveAs(pdfPath);
  const pdfBytes = await readFile(pdfPath);
  assert.equal(pdfBytes.subarray(0, 8).toString("ascii"), "%PDF-1.4");
  assert.equal(countPdfPages(pdfBytes), 1);

  await editorPage.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 7200;
    const context = canvas.getContext("2d");
    context.fillStyle = "#f7f9fb";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < canvas.height; y += 600) {
      context.fillStyle = y % 1200 ? "#dff7ee" : "#10243a";
      context.fillRect(80, y + 70, 1040, 420);
      context.fillStyle = y % 1200 ? "#10243a" : "#eff9fb";
      context.font = "700 46px system-ui";
      context.fillText(`Tall capture section ${y / 600 + 1}`, 130, y + 170);
    }

    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error("fixture render failed")),
      "image/png"
    ));
    await globalThis.LumenAnnotationEditor.load({ blob, title: "Tall release notes" });
  });
  await editorPage.locator("#documentTitle", { hasText: "Tall release notes" }).waitFor();
  const tallPdfDownload = await triggerDownload(editorPage, "#exportPdfButton");
  const tallPdfPath = path.join(outputDirectory, tallPdfDownload.suggestedFilename());
  await tallPdfDownload.saveAs(tallPdfPath);
  const tallPdfBytes = await readFile(tallPdfPath);
  assert.equal(countPdfPages(tallPdfBytes), 5, "a 1200×7200 capture should paginate into five Letter pages");
  assert.match(await editorPage.locator("#statusMessage").innerText(), /5 pages/);

  await editorPage.goto(`${fixture.baseUrl}/editor.html?demo=1`, { waitUntil: "networkidle" });
  await editorPage.locator("#exportButton:not(:disabled)").waitFor();
  await editorPage.screenshot({ path: "/tmp/lumen-editor-export-zoom.png", fullPage: true });
  await editorPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(await editorPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  assert.equal(runtimeErrors.length, 0, `Editor runtime errors: ${runtimeErrors.join(" | ")}`);

  const reviewPage = await context.newPage();
  const reviewRuntimeErrors = collectRuntimeErrors(reviewPage);
  await reviewPage.goto(`${fixture.baseUrl}/review.html?demo=1`, { waitUntil: "networkidle" });
  await reviewPage.locator("#reviewContent:not(.is-hidden)").waitFor();
  assert.equal(await reviewPage.locator("#reviewActions button").count(), 4);

  const reviewedPngDownload = await triggerDownload(reviewPage, "#reviewActions button", "Export PNG");
  const reviewedPngPath = path.join(outputDirectory, reviewedPngDownload.suggestedFilename());
  await reviewedPngDownload.saveAs(reviewedPngPath);
  const reviewedPngBytes = await readFile(reviewedPngPath);
  assert.deepEqual(readPngDimensions(reviewedPngBytes), { width: 1200, height: 750 });
  assert.match(await reviewPage.locator("#reviewStatus").innerText(), /1200×750px/);

  const reviewedPdfDownload = await triggerDownload(reviewPage, "#reviewActions button", "Export PDF");
  const reviewedPdfPath = path.join(outputDirectory, reviewedPdfDownload.suggestedFilename());
  await reviewedPdfDownload.saveAs(reviewedPdfPath);
  const reviewedPdfBytes = await readFile(reviewedPdfPath);
  assert.equal(reviewedPdfBytes.subarray(0, 8).toString("ascii"), "%PDF-1.4");
  assert.equal(countPdfPages(reviewedPdfBytes), 1);
  assert.match(await reviewPage.locator("#reviewStatus").innerText(), /PDF ready/);
  assert.equal(reviewRuntimeErrors.length, 0, `Review runtime errors: ${reviewRuntimeErrors.join(" | ")}`);

  console.log(`Export and zoom smoke test passed: full-resolution PNG, smart 5-page PDF, Fit/100%/keyboard zoom, review exports, and mobile overflow verified. Artifacts: ${outputDirectory}`);
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => fixture.server.close(resolve));

  if (process.env.LUMEN_KEEP_EXPORT_ARTIFACTS !== "1") {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

function verifyPureExportHelpers() {
  assert.equal(buildExportFilename("Billing / Q3", "reviewed", "pdf"), "billing-q3-reviewed.pdf");
  const layout = calculatePdfPagination(1200, 7200);
  assert.equal(layout.pageCount, 5);
  assert.equal(layout.pages[0].sourceY, 0);
  assert.equal(layout.pages.at(-1).sourceY + layout.pages.at(-1).sourceHeight, 7200);
  assert.ok(layout.pages.every((page) => page.drawHeight <= layout.printableHeight + 0.001));

  const minimalLayout = calculatePdfPagination(100, 100);
  const minimalBytes = buildImagePdfBytes([
    { bytes: new Uint8Array([255, 216, 255, 217]), width: 1, height: 1 }
  ], minimalLayout);
  assert.equal(new TextDecoder().decode(minimalBytes.subarray(0, 8)), "%PDF-1.4");
}

async function triggerDownload(page, selector, text = "") {
  const target = text ? page.locator(selector, { hasText: text }).first() : page.locator(selector);
  const downloadPromise = page.waitForEvent("download");
  await target.click();
  return downloadPromise;
}

function collectRuntimeErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
}

function readPngDimensions(bytes) {
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
}

function countPdfPages(bytes) {
  return (bytes.toString("latin1").match(/\/Type \/Page\b/g) || []).length;
}

async function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
      const target = path.resolve(repoRoot, `.${pathname}`);
      const relative = path.relative(repoRoot, target);

      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        response.writeHead(403).end("Forbidden");
        return;
      }

      const body = await readFile(target);
      const contentType = target.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : target.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "text/html; charset=utf-8";
      response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not Found");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`
  };
}
