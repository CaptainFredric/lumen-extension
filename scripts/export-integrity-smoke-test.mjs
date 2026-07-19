import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = await startStaticServer();
const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "lumen-export-integrity-"));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });

try {
  await verifySourceGuards();
  const page = await context.newPage();
  await page.goto(`${fixture.baseUrl}/index.html`, { waitUntil: "domcontentloaded" });

  const sequenceResult = await page.evaluate(async () => {
    const { createCanvasSequencePdfBlob } = await import("./export-utils.js");
    const canvases = Array.from({ length: 3 }, (_value, index) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 2400;
      const context = canvas.getContext("2d");
      context.fillStyle = ["#10243a", "#13a487", "#ff5f87"][index];
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#ffffff";
      context.font = "700 72px system-ui";
      context.fillText(`Exact source tile ${index + 1}`, 80, 180);
      return canvas;
    });
    const pdf = await createCanvasSequencePdfBlob(canvases, { maxRasterWidth: 1200 });
    const bytes = new Uint8Array(await pdf.blob.arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);

    return {
      header: text.slice(0, 8),
      pageMarkers: (text.match(/\/Type \/Page\b/g) || []).length,
      pageCount: pdf.pageCount,
      sourceWidth: pdf.sourceWidth,
      sourceHeight: pdf.sourceHeight,
      rasterWidth: pdf.rasterWidth,
      sourceExact: pdf.sourceExact,
      bytes: bytes.length
    };
  });

  assert.deepEqual(sequenceResult, {
    header: "%PDF-1.4",
    pageMarkers: 5,
    pageCount: 5,
    sourceWidth: 1200,
    sourceHeight: 7200,
    rasterWidth: 1200,
    sourceExact: true,
    bytes: sequenceResult.bytes
  });
  assert.ok(sequenceResult.bytes > 20_000, "the exact three-tile fixture should produce a substantive PDF");

  const lifecycle = await page.evaluate(async () => {
    const { downloadBlob } = await import("./export-utils.js");
    const chromeObject = globalThis.chrome || (globalThis.chrome = {});
    const originalDownloads = chromeObject.downloads;
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    let listeners = [];
    let revoked = false;
    let revokedAtCompletion = null;

    URL.revokeObjectURL = (url) => {
      revoked = true;
      originalRevoke(url);
    };
    chromeObject.downloads = {
      download: async () => {
        window.setTimeout(() => {
          revokedAtCompletion = revoked;
          for (const listener of [...listeners]) {
            listener({ id: 77, state: { current: "complete" } });
          }
        }, 25);
        return 77;
      },
      onChanged: {
        addListener(listener) {
          listeners.push(listener);
        },
        removeListener(listener) {
          listeners = listeners.filter((candidate) => candidate !== listener);
        }
      }
    };

    try {
      const downloadId = await downloadBlob(new Blob(["saved"], { type: "text/plain" }), "saved.txt", {
        saveAs: false,
        completionTimeoutMs: 5_000
      });
      return { downloadId, revokedAtCompletion, revokedAfterCompletion: revoked, listeners: listeners.length };
    } finally {
      chromeObject.downloads = originalDownloads;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  assert.deepEqual(lifecycle, {
    downloadId: 77,
    revokedAtCompletion: false,
    revokedAfterCompletion: true,
    listeners: 0
  });

  const interrupted = await page.evaluate(async () => {
    const { downloadBlob } = await import("./export-utils.js");
    const chromeObject = globalThis.chrome || (globalThis.chrome = {});
    const originalDownloads = chromeObject.downloads;
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    let listener = null;
    let revoked = false;

    URL.revokeObjectURL = (url) => {
      revoked = true;
      originalRevoke(url);
    };
    chromeObject.downloads = {
      download: async () => {
        window.setTimeout(() => listener?.({
          id: 91,
          state: { current: "interrupted" },
          error: { current: "USER_CANCELED" }
        }), 20);
        return 91;
      },
      onChanged: {
        addListener(callback) {
          listener = callback;
        },
        removeListener(callback) {
          if (listener === callback) {
            listener = null;
          }
        }
      }
    };

    try {
      await downloadBlob(new Blob(["cancel"], { type: "text/plain" }), "cancel.txt", {
        saveAs: false,
        completionTimeoutMs: 5_000
      });
      return { rejected: false, revoked };
    } catch (error) {
      return { rejected: /interrupted.*USER_CANCELED/i.test(error.message), revoked };
    } finally {
      chromeObject.downloads = originalDownloads;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  assert.deepEqual(interrupted, { rejected: true, revoked: true });

  const timedOut = await page.evaluate(async () => {
    const { downloadBlob } = await import("./export-utils.js");
    const chromeObject = globalThis.chrome || (globalThis.chrome = {});
    const originalDownloads = chromeObject.downloads;
    const originalRevoke = URL.revokeObjectURL.bind(URL);
    const originalSetTimeout = window.setTimeout;
    let listeners = [];
    let revoked = false;
    let delayedRevoke = null;

    URL.revokeObjectURL = (url) => {
      revoked = true;
      originalRevoke(url);
    };
    window.setTimeout = (callback, delay, ...args) => {
      if (delay === 5_000) {
        return originalSetTimeout.call(window, callback, 20, ...args);
      }

      if (delay === 60_000) {
        delayedRevoke = () => callback(...args);
        return 987654;
      }

      return originalSetTimeout.call(window, callback, delay, ...args);
    };
    chromeObject.downloads = {
      download: async () => 108,
      onChanged: {
        addListener(listener) {
          listeners.push(listener);
        },
        removeListener(listener) {
          listeners = listeners.filter((candidate) => candidate !== listener);
        }
      }
    };

    try {
      await downloadBlob(new Blob(["slow"], { type: "text/plain" }), "slow.txt", {
        saveAs: false,
        completionTimeoutMs: 5_000
      });
      const revokedAtReturn = revoked;
      const fallbackScheduled = typeof delayedRevoke === "function";
      delayedRevoke?.();
      return {
        revokedAtReturn,
        fallbackScheduled,
        listeners: listeners.length,
        revokedAfterFallback: revoked
      };
    } finally {
      chromeObject.downloads = originalDownloads;
      URL.revokeObjectURL = originalRevoke;
      window.setTimeout = originalSetTimeout;
    }
  });

  assert.deepEqual(timedOut, {
    revokedAtReturn: false,
    fallbackScheduled: true,
    listeners: 0,
    revokedAfterFallback: true
  });

  const captureIds = await seedPreviewOnlyReview(page);
  await page.goto(
    `${fixture.baseUrl}/review.html?before=${encodeURIComponent(captureIds.before)}&after=${encodeURIComponent(captureIds.after)}`,
    { waitUntil: "networkidle" }
  );
  await page.locator("#reviewContent:not(.is-hidden)").waitFor();
  assert.equal(await reviewButton(page, "Export PNG").isDisabled(), true, "preview-only PNG export must stay disabled");
  assert.equal(await reviewButton(page, "Export PDF").isDisabled(), true, "preview-only PDF export must stay disabled");
  assert.match(await reviewButton(page, "Export PNG").getAttribute("title"), /comparison preview/i);

  await page.evaluate(async ({ after }) => {
    const { putLibraryCapture } = await import("./library-store.js");
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 7200;
    const context = canvas.getContext("2d");
    context.fillStyle = "#eef7f5";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#10243a";
    context.font = "700 64px system-ui";
    context.fillText("Bounded editor proxy", 80, 160);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));

    await putLibraryCapture({
      id: after,
      editorSource: {
        blob,
        width: 1200,
        height: 7200,
        originalWidth: 1440,
        originalHeight: 12000,
        scaled: true,
        kind: "whole-page-proxy"
      }
    });
  }, captureIds);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#reviewContent:not(.is-hidden)").waitFor();
  assert.equal(await reviewButton(page, "Export PNG").isEnabled(), true);
  assert.equal(await reviewButton(page, "Export PDF").isEnabled(), true);

  await page.evaluate(async ({ after }) => {
    const { createCanvasSequencePdfBlob } = await import("./export-utils.js");
    const { putLibraryCapture } = await import("./library-store.js");
    const tiles = Array.from({ length: 2 }, (_value, index) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 3600;
      const context = canvas.getContext("2d");
      context.fillStyle = index ? "#13a487" : "#10243a";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas;
    });
    const pdf = await createCanvasSequencePdfBlob(tiles, { maxRasterWidth: 1200 });

    await putLibraryCapture({
      id: after,
      editorSource: null,
      pdfSource: {
        blob: pdf.blob,
        pageCount: pdf.pageCount,
        rasterWidth: pdf.rasterWidth,
        sourceWidth: pdf.sourceWidth,
        sourceHeight: pdf.sourceHeight,
        sourceExact: true,
        kind: "capture-tile-pdf"
      }
    });
  }, captureIds);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#reviewContent:not(.is-hidden)").waitFor();
  assert.equal(await reviewButton(page, "Export PNG").isDisabled(), true, "a cached PDF must not masquerade as a PNG source");
  assert.equal(await reviewButton(page, "Export PDF").isEnabled(), true, "a capture-time PDF should remain reusable after editor pruning");

  const cachedDownload = await Promise.all([
    page.waitForEvent("download"),
    reviewButton(page, "Export PDF").click()
  ]).then(([download]) => download);
  const cachedPath = path.join(outputDirectory, cachedDownload.suggestedFilename());
  await cachedDownload.saveAs(cachedPath);
  const cachedBytes = await readFile(cachedPath);
  assert.equal(cachedBytes.subarray(0, 8).toString("ascii"), "%PDF-1.4");
  assert.match(await page.locator("#reviewStatus").innerText(), /Capture-time PDF ready/);

  const pruneResult = await page.evaluate(async () => {
    const {
      getLibraryCapture,
      getLibraryPdfAsset,
      getLibraryStorageEstimate,
      pruneLibraryPreviews
    } = await import("./library-store.js");
    await pruneLibraryPreviews({
      maxBytes: 50 * 1024 * 1024,
      maxCaptures: 500,
      editorMaxBytes: 250 * 1024 * 1024,
      editorMaxCaptures: 75,
      pdfMaxBytes: 0,
      pdfMaxCaptures: 0
    });
    const captureId = new URLSearchParams(location.search).get("after");
    const capture = await getLibraryCapture(captureId);
    const pdf = await getLibraryPdfAsset(captureId);
    const estimate = await getLibraryStorageEstimate();
    return {
      status: capture.pdfStatus,
      assetPresent: Boolean(pdf),
      pdfCount: estimate.pdfCount,
      pdfBytes: estimate.pdfBytes
    };
  });
  assert.deepEqual(pruneResult, { status: "pruned", assetPresent: false, pdfCount: 0, pdfBytes: 0 });

  console.log("Export integrity smoke test passed: exact tile pagination, complete/interrupted/timeout download lifecycle, preview-only PNG blocking, cached PDF reuse, and bounded PDF pruning verified.");
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => fixture.server.close(resolve));
  await rm(outputDirectory, { recursive: true, force: true });
}

async function verifySourceGuards() {
  const [editor, review, reviewActions, offscreen, libraryStore] = await Promise.all([
    readFile(path.join(repoRoot, "editor.js"), "utf8"),
    readFile(path.join(repoRoot, "review.js"), "utf8"),
    readFile(path.join(repoRoot, "review-actions.js"), "utf8"),
    readFile(path.join(repoRoot, "offscreen.js"), "utf8"),
    readFile(path.join(repoRoot, "library-store.js"), "utf8")
  ]);

  const pdfExport = editor.slice(editor.indexOf("async function exportAnnotatedPdf"), editor.indexOf("function canvasToBlob"));
  assert.doesNotMatch(pdfExport, /document\.createElement\("canvas"\)/, "editor PDF export must not allocate a second full-size canvas");
  assert.match(pdfExport, /createCanvasPdfBlob\(ui\.canvas\)/);
  assert.match(review, /getLibraryEditorAsset\(capture\.id\)/, "review image export must request the editor source directly");
  assert.match(review, /comparison thumbnail is intentionally not exportable/i);
  assert.match(reviewActions, /afterImageExportAvailable/);
  assert.match(reviewActions, /bookkeeping skipped after a successful download/);
  assert.match(offscreen, /createCanvasSequencePdfBlob\(sourceCanvases/);
  assert.match(libraryStore, /DEFAULT_PDF_SOURCE_BUDGET_BYTES/);
  assert.match(libraryStore, /pruneLibraryPdfSources/);
}

async function seedPreviewOnlyReview(page) {
  return page.evaluate(async () => {
    const { clearLibrary, putLibraryCapture } = await import("./library-store.js");
    await clearLibrary();
    const makePreview = async (color, label) => {
      const canvas = document.createElement("canvas");
      canvas.width = 360;
      canvas.height = 600;
      const context = canvas.getContext("2d");
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#ffffff";
      context.font = "700 32px system-ui";
      context.fillText(label, 30, 80);
      return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
    };
    const before = `integrity-before-${Date.now()}`;
    const after = `integrity-after-${Date.now()}`;

    await putLibraryCapture({
      id: before,
      title: "Integrity fixture",
      host: "integrity.example",
      url: "https://integrity.example/review",
      capturedAt: "2026-07-17T12:00:00.000Z",
      dimensions: { width: 1200, height: 7200 },
      previews: [{ blob: await makePreview("#10243a", "Before"), width: 360, height: 600 }]
    });
    await putLibraryCapture({
      id: after,
      title: "Integrity fixture",
      host: "integrity.example",
      url: "https://integrity.example/review",
      capturedAt: "2026-07-18T12:00:00.000Z",
      dimensions: { width: 1200, height: 7200 },
      previews: [{ blob: await makePreview("#13a487", "After"), width: 360, height: 600 }]
    });
    return { before, after };
  });
}

function reviewButton(page, label) {
  return page.locator("#reviewActions button", { hasText: label });
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

  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}
