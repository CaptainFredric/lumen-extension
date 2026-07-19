import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = process.env.LUMEN_REVIEW_BASE_URL
  ? { baseUrl: process.env.LUMEN_REVIEW_BASE_URL, server: null }
  : await startStaticServer();
const baseUrl = fixture.baseUrl;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });

  await page.goto(`${baseUrl}/review.html?demo=1`, { waitUntil: "networkidle" });
  await page.locator("#reviewContent:not(.is-hidden)").waitFor();
  await page.locator("#changePercentMetric").waitFor();

  assert.match(await page.locator("#changePercentMetric").innerText(), /%/);
  assert.notEqual(await page.locator("#similarityMetric").innerText(), "—");
  assert.equal(await page.locator("#timelineList .timeline-item").count(), 5);
  assert.ok(await page.locator("#regionList .region-button").count() >= 2);
  assert.equal(await page.locator("#beforeSelect option").count(), 5);
  assert.equal(await page.locator("#afterSelect option").count(), 5);
  assert.equal(await page.locator("#reviewActions button").count(), 4);
  assert.equal(await page.locator("#reviewActions button", { hasText: "Export PNG" }).isEnabled(), true);
  assert.equal(await page.locator("#reviewActions button", { hasText: "Export PDF" }).isEnabled(), true);
  assert.equal(await page.locator("body").getAttribute("data-selected-capture-id"), "demo-after");
  const hookResult = await page.evaluate(() => {
    let eventCaptureId = "";
    window.addEventListener("lumen-review-mark-reviewed", (event) => {
      eventCaptureId = event.detail.selectedCaptureId;
      event.preventDefault();
    }, { once: true });
    const result = globalThis.LumenVisualReview.markReviewed({ source: "smoke-test" });
    return {
      selectedCaptureId: globalThis.LumenVisualReview.getSelectedCaptureId(),
      eventCaptureId,
      handled: result.handled,
      hasActionsSlot: globalThis.LumenVisualReview.getActionsSlot()?.id === "reviewActions"
    };
  });
  assert.deepEqual(hookResult, {
    selectedCaptureId: "demo-after",
    eventCaptureId: "demo-after",
    handled: true,
    hasActionsSlot: true
  });

  await page.locator("#comparisonStage").focus();
  await page.keyboard.press("End");
  assert.equal(await page.locator("#revealSlider").inputValue(), "100");
  assert.equal(await page.locator("#revealOutput").innerText(), "100% after");

  await page.locator("#regionList .region-button").first().click();
  assert.equal(await page.locator("#highlightToggle").isChecked(), true);
  assert.equal(await page.locator("#regionOverlay .change-region.is-focused").count(), 1);

  const unpairedSelection = await page.evaluate(async () => {
    await globalThis.LumenVisualReview.loadPair({
      afterCaptureId: "demo-other",
      watchPlanId: "demo-homepage-monitor"
    });
    return globalThis.LumenVisualReview.getSelection();
  });
  await page.locator("#emptyState:not(.is-hidden)").waitFor();
  assert.equal(unpairedSelection.beforeCaptureId, "");
  assert.equal(unpairedSelection.afterCaptureId, "demo-other");
  assert.equal(unpairedSelection.watchPlanId, "demo-homepage-monitor");
  assert.equal(unpairedSelection.diff, null);
  assert.equal(await page.locator("#emptyTitle").innerText(), "No earlier matching capture");
  assert.equal(await page.locator("#beforeSelect").inputValue(), "");
  assert.equal(await page.locator("#afterSelect").inputValue(), "demo-other");
  assert.equal(await page.locator("#timelineList .timeline-item").count(), 1);
  assert.equal(await page.locator("#reviewActions .primary-review-action").isDisabled(), true);

  await page.evaluate(() => globalThis.LumenVisualReview.loadPair({
    beforeCaptureId: "demo-middle",
    afterCaptureId: "demo-after",
    watchPlanId: "demo-checkout-monitor"
  }));
  await page.locator("#reviewContent:not(.is-hidden)").waitFor();
  assert.equal(await page.locator("#timelineList .timeline-item").count(), 5);

  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(desktopOverflow, false);
  await page.locator("#revealSlider").fill("52");
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.screenshot({ path: "/tmp/lumen-review-demo.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(mobileOverflow, false);
  assert.equal(runtimeErrors.length, 0, `Review page runtime errors: ${runtimeErrors.join(" | ")}`);

  console.log("Visual review page smoke test passed: demo comparison, statistics, regions, timeline, keyboard controls, and responsive layout verified.");
} finally {
  await browser.close();
  await new Promise((resolve) => fixture.server?.close(resolve) || resolve());
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

  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}
