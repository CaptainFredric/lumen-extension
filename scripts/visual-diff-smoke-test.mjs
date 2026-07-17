import assert from "node:assert/strict";
import { hasLibraryPreview } from "../library-store.js";
import {
  areCapturesComparable,
  buildMonitorTimeline,
  comparePixelBuffers,
  formatChangePercent,
  resolveReviewWatchPlanId,
  selectReviewPair
} from "../visual-diff-engine.js";

function createFrame(width, height, color = [20, 30, 40, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let offset = 0; offset < data.length; offset += 4) {
    data.set(color, offset);
  }

  return { width, height, data };
}

function paintRectangle(frame, left, top, width, height, color) {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      frame.data.set(color, (y * frame.width + x) * 4);
    }
  }
}

const identicalBefore = createFrame(24, 16);
const identicalAfter = createFrame(24, 16);
const identical = comparePixelBuffers(identicalBefore, identicalAfter);
assert.equal(identical.changedPixels, 0);
assert.equal(identical.changePercent, 0);
assert.equal(identical.similarityPercent, 100);
assert.equal(identical.classification, "identical");
assert.deepEqual(identical.regions, []);

const changedBefore = createFrame(40, 24);
const changedAfter = createFrame(40, 24);
paintRectangle(changedAfter, 2, 3, 6, 5, [240, 30, 40, 255]);
paintRectangle(changedAfter, 30, 15, 7, 6, [20, 210, 230, 255]);
const changed = comparePixelBuffers(changedBefore, changedAfter, {
  threshold: 20,
  cellSize: 4,
  minimumChangedPixels: 2
});
assert.equal(changed.changedPixels, 72);
assert.equal(changed.changePercent, 7.5);
assert.equal(changed.classification, "major");
assert.equal(changed.regions.length, 2);
assert.equal(changed.regions[0].changedPixels, 42);
assert.equal(changed.regions[1].changedPixels, 30);
assert.equal(formatChangePercent(0.004), "<0.01%");
assert.equal(formatChangePercent(7.5), "7.5%");

assert.throws(
  () => comparePixelBuffers(createFrame(2, 2), createFrame(3, 2)),
  /same comparison dimensions/
);

const captures = [
  { id: "capture-1", capturedAt: "2026-07-16T10:00:00.000Z", watchPlanId: "watch-a", sourceType: "timed" },
  { id: "capture-2", capturedAt: "2026-07-16T10:10:00.000Z", watchPlanId: "watch-a", sourceType: "timed" },
  { id: "capture-3", capturedAt: "2026-07-16T10:20:00.000Z", watchPlanId: "watch-b", sourceType: "timed" }
];
const runs = [
  {
    id: "run-1",
    captureId: "capture-1",
    watchPlanId: "watch-a",
    status: "captured",
    completedAt: "2026-07-16T10:00:00.000Z",
    changePercent: 100
  },
  {
    id: "run-2",
    captureId: "capture-2",
    watchPlanId: "watch-a",
    status: "captured",
    completedAt: "2026-07-16T10:10:00.000Z",
    changePercent: 2.4
  },
  {
    id: "run-3",
    captureId: "",
    watchPlanId: "watch-a",
    status: "unchanged",
    completedAt: "2026-07-16T10:15:00.000Z",
    changePercent: 0
  }
];

const explicitPair = selectReviewPair(captures, runs, {
  beforeCaptureId: "capture-1",
  afterCaptureId: "capture-3"
});
assert.equal(explicitPair.source, "incompatible");
assert.equal(explicitPair.before, null);
assert.equal(explicitPair.after.id, "capture-3");

const explicitAfterPair = selectReviewPair(captures, runs, {
  afterCaptureId: "capture-2"
});
assert.equal(explicitAfterPair.source, "explicit-after");
assert.equal(explicitAfterPair.before.id, "capture-1");
assert.equal(explicitAfterPair.after.id, "capture-2");

const monitorPair = selectReviewPair(captures, runs, { watchPlanId: "watch-a" });
assert.equal(monitorPair.source, "monitor");
assert.equal(monitorPair.before.id, "capture-1");
assert.equal(monitorPair.after.id, "capture-2");
assert.equal(resolveReviewWatchPlanId(monitorPair.before, monitorPair.after), "watch-a");
assert.equal(resolveReviewWatchPlanId(captures[0], captures[2]), "");
assert.equal(resolveReviewWatchPlanId(null, captures[2]), "watch-b");

const oldestSelected = selectReviewPair(captures, runs, {
  afterCaptureId: "capture-1"
});
assert.equal(oldestSelected.source, "selected-unpaired");
assert.equal(oldestSelected.before, null);
assert.equal(oldestSelected.after.id, "capture-1");

const manualCaptures = [
  {
    id: "manual-1",
    capturedAt: "2026-07-16T11:00:00.000Z",
    url: "https://shop.example.test/products/widget?color=blue#details",
    sourceType: "manual"
  },
  {
    id: "manual-2",
    capturedAt: "2026-07-16T11:10:00.000Z",
    url: "https://shop.example.test/products/widget?color=red",
    sourceType: "manual"
  },
  {
    id: "manual-unrelated",
    capturedAt: "2026-07-16T11:20:00.000Z",
    url: "https://docs.example.test/products/widget",
    sourceType: "manual"
  }
];
assert.equal(areCapturesComparable(manualCaptures[0], manualCaptures[1]), true);
assert.equal(areCapturesComparable(manualCaptures[1], manualCaptures[2]), false);

const selectedManualPair = selectReviewPair(manualCaptures, [], {
  afterCaptureId: "manual-2"
});
assert.equal(selectedManualPair.source, "explicit-after");
assert.equal(selectedManualPair.before.id, "manual-1");
assert.equal(selectedManualPair.after.id, "manual-2");

const unrelatedManualSelection = selectReviewPair(manualCaptures, [], {
  afterCaptureId: "manual-unrelated"
});
assert.equal(unrelatedManualSelection.source, "selected-unpaired");
assert.equal(unrelatedManualSelection.before, null);
assert.equal(unrelatedManualSelection.after.id, "manual-unrelated");

const unavailableSelection = selectReviewPair(manualCaptures, [], {
  afterCaptureId: "capture-that-was-deleted"
});
assert.equal(unavailableSelection.source, "requested-unavailable");
assert.equal(unavailableSelection.before, null);
assert.equal(unavailableSelection.after, null);

assert.equal(hasLibraryPreview({
  previewStatus: "ready",
  primaryPreviewAssetId: "capture:preview"
}), true);
assert.equal(hasLibraryPreview({
  previewStatus: "pruned",
  primaryPreviewAssetId: "capture:preview"
}), false);
assert.equal(hasLibraryPreview({
  previewStatus: "ready",
  previewAssetIds: []
}), false);

const timeline = buildMonitorTimeline(captures, runs, { watchPlanId: "watch-a" });
assert.equal(timeline.length, 3);
assert.equal(timeline[0].id, "run-3");
assert.equal(timeline[0].status, "unchanged");
assert.equal(timeline[0].selectable, false);
assert.equal(timeline[1].selectable, true);

console.log("Visual diff smoke test passed: pixel statistics, strict pair selection, timeline normalization, and preview availability verified.");
