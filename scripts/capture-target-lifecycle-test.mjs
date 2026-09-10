import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const recoveryStart = background.indexOf("async function recoverInterruptedCapture(");
const recoveryEnd = background.indexOf("async function runHistoryDownloadAction(", recoveryStart);
assert(recoveryStart >= 0 && recoveryEnd > recoveryStart);

for (const scenario of ["first view failed", "later view failed", "storage failed", "cancelled"]) {
  test(`partial capture recovery: ${scenario}`, async () => {
    const records = [];
    const notices = [];
    const error = { description: scenario === "cancelled" ? "Capture cancelled." : "Page changed." };
    const context = vm.createContext({
      URL,
      putLibraryCapture: async (record) => {
        if (scenario === "storage failed") throw new Error("Quota exceeded");
        records.push(record);
      },
      sanitizeCaptureUrl: () => "https://example.test/",
      buildAggregateCaptureHealth: () => ({ status: "complete" }),
      pruneLibraryPreviews: async () => {},
      collectBundleImages: () => [],
      broadcastLibraryUpdated: (notice) => notices.push(notice),
      normalizeCaptureError: (value) => value,
      createFriendlyError: (title, description) => ({ title, description })
    });
    vm.runInContext(background.slice(recoveryStart, recoveryEnd), context);
    const result = await context.recoverInterruptedCapture({
      error,
      results: scenario === "first view failed" ? [] : [{
        page: { title: "Example", url: "https://example.test/?secret=1" },
        variant: { id: "desktop" },
        downloadRecords: [{ downloadId: 12, filename: "desktop.png" }],
        photoPreviews: [{ previewDataUrl: "data:image/png;base64,AA", width: 100, height: 200 }],
        editorSource: { dataUrl: "original" }
      }],
      variants: [{}, {}, {}],
      captureId: "partial-1",
      capturedAt: "2026-09-10T00:00:00Z",
      runContext: { folder: "Lumen/run-1" },
      options: { devicePreset: "responsive" },
      context: {}
    });
    if (scenario === "first view failed") {
      assert.equal(result, error);
      assert.equal(records.length, 0);
    } else {
      assert.match(result.description, /1 of 3 views completed/);
      assert.match(result.description, /Retrying starts a new set/);
      assert.match(result.description, /Lumen\/run-1/);
      if (scenario === "storage failed") {
        assert.match(result.description, /Chrome Downloads/);
        assert.equal(notices.length, 0);
      } else {
        assert.match(result.description, /Open Library/);
        assert.equal(records[0].captureHealth.status, "partial");
        assert.equal(records[0].variantCount, 1);
        assert.equal(records[0].downloads[0].downloadId, 12);
        assert.equal(records[0].previews.length, 1);
        assert.equal(records[0].url, "https://example.test/");
        assert.equal(notices.length, 1);
      }
    }
  });
}

const start = background.indexOf("async function createCaptureTarget(");
const end = background.indexOf("async function calibrateCaptureViewport(", start);
assert(start >= 0 && end > start);
const source = background.slice(start, end);
const variant = { mode: "viewport", label: "Tablet", viewport: { width: 1024, height: 1366 } };

for (const failure of ["missing tab", "query rejection", "navigation timeout", "cancelled load", "success"]) {
  test(`temporary capture window lifecycle: ${failure}`, async () => {
    const closed = [];
    const context = vm.createContext({
      chrome: {
        windows: { create: async () => ({ id: 71 }) },
        tabs: { query: async () => {
          if (failure === "query rejection") throw new Error(failure);
          return failure === "missing tab" ? [] : [{ id: 82 }];
        } }
      },
      waitForTabComplete: async (_id, _timeout, checkCancelled) => {
        checkCancelled();
        if (failure === "navigation timeout") throw new Error(failure);
      },
      sleep: async () => {},
      checkCaptureCancelled: () => { if (failure === "cancelled load") throw new Error("Cancelled"); },
      createFriendlyError: (title, description) => new Error(`${title}: ${description}`),
      closeWindowSafely: async (id) => closed.push(id)
    });
    vm.runInContext(source, context);
    const pending = context.createCaptureTarget({ url: "https://example.test" }, variant);
    if (failure === "success") {
      assert.equal((await pending).windowId, 71);
      assert.deepEqual(closed, []);
    } else {
      await assert.rejects(pending);
      assert.deepEqual(closed, [71]);
    }
  });
}

const guardStart = background.indexOf("async function captureTargetVisibleTab(");
const guardEnd = background.indexOf("async function createCaptureTarget(", guardStart);
assert(guardStart >= 0 && guardEnd > guardStart);

function eventChannel() {
  const listeners = new Set();
  return {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    emit: (...args) => [...listeners].forEach((listener) => listener(...args)),
    count: () => listeners.size
  };
}

for (const scenario of ["stable", "other window", "title change", "wrong tab before", "wrong tab after", "switch and return", "navigation", "url change", "tab closed", "capture rejected", "cancelled"]) {
  test(`screenshot target guard: ${scenario}`, async () => {
    const onActivated = eventChannel();
    const onUpdated = eventChannel();
    const onRemoved = eventChannel();
    let queries = 0;
    let captures = 0;
    let activations = 0;
    const context = vm.createContext({
      chrome: { tabs: {
        onActivated, onUpdated, onRemoved,
        update: async () => { activations++; },
        query: async () => {
          queries++;
          const wrong = (scenario === "wrong tab before" && queries === 1) || (scenario === "wrong tab after" && queries === 2);
          return [{ id: wrong ? 99 : 82, url: "https://example.test", status: "complete" }];
        },
        captureVisibleTab: async () => {
          captures++;
          if (scenario === "switch and return") {
            onActivated.emit({ windowId: 71, tabId: 99 });
            onActivated.emit({ windowId: 71, tabId: 82 });
          }
          if (scenario === "other window") onActivated.emit({ windowId: 22, tabId: 99 });
          if (scenario === "title change") onUpdated.emit(82, { title: "Changed title" });
          if (scenario === "navigation") onUpdated.emit(82, { status: "loading" });
          if (scenario === "url change") onUpdated.emit(82, { url: "https://example.test/other" });
          if (scenario === "tab closed") onRemoved.emit(82);
          if (scenario === "capture rejected") throw new Error("Chrome screenshot failed");
          return "data:image/png;base64,fixture";
        }
      } },
      checkCaptureCancelled: () => { if (scenario === "cancelled") throw new Error("Cancelled"); },
      createFriendlyError: (title, description) => new Error(`${title}: ${description}`)
    });
    vm.runInContext(background.slice(guardStart, guardEnd), context);
    const pending = context.captureTargetVisibleTab({ tab: { id: 82 }, windowId: 71 });
    if (["stable", "other window", "title change"].includes(scenario)) {
      assert.equal(await pending, "data:image/png;base64,fixture");
    } else {
      await assert.rejects(pending, /Capture Interrupted|screenshot failed|Cancelled/);
    }
    assert.equal(captures, scenario === "wrong tab before" ? 0 : 1);
    assert.equal(activations, 0, "Personal tab capture must not steal activation back");
    assert.equal(onActivated.count() + onUpdated.count() + onRemoved.count(), 0, "Capture listeners must always be removed");
  });
}

test("cancel a temporary page while it is still loading", async () => {
  const waitStart = background.indexOf("async function waitForTabComplete(");
  const waitEnd = background.indexOf("function buildCaptureFileBaseName(", waitStart);
  assert(waitStart >= 0 && waitEnd > waitStart);
  let polls = 0;
  const context = vm.createContext({
    chrome: { tabs: { get: async () => { polls++; return { status: "loading" }; } } },
    sleep: async () => {},
    createFriendlyError: (title) => new Error(title)
  });
  vm.runInContext(background.slice(waitStart, waitEnd), context);
  await assert.rejects(context.waitForTabComplete(82, 15000, () => {
    if (polls) throw new Error("Cancelled during loading");
  }), /Cancelled during loading/);
  assert.equal(polls, 1, "Cancellation should avoid waiting out the navigation timeout");
});
