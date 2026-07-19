import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAnnotationFilename,
  commitHistory,
  createAnnotation,
  createHistory,
  findResizeHandle,
  getAnnotationBounds,
  hitTestAnnotation,
  hitTestAnnotations,
  redoHistory,
  removeAnnotation,
  replaceAnnotation,
  resizeAnnotation,
  translateAnnotation,
  undoHistory
} from "../annotation-engine.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const [editorHtml, editorJavaScript, editorCss, editorDriveJavaScript] = await Promise.all([
  readFile(path.join(repoRoot, "editor.html"), "utf8"),
  readFile(path.join(repoRoot, "editor.js"), "utf8"),
  readFile(path.join(repoRoot, "editor.css"), "utf8"),
  readFile(path.join(repoRoot, "editor-drive.js"), "utf8")
]);

assert.match(editorHtml, /id="exportButton"[^>]*>\s*Export PNG/, "editor should expose a visible PNG export action");
assert.match(editorHtml, /id="exportPdfButton"[^>]*>[\s\S]*?Export PDF/, "editor should expose a visible paginated PDF action");
assert.match(editorHtml, /id="actualSizeButton"[^>]*>[\s\S]*?100%/, "editor should expose a true actual-pixel zoom action");
assert.match(editorHtml, /data-lumen-export-actions/, "editor should expose an optional destination toolbar slot");
assert.match(editorHtml, /<script type="module" src="editor\.js"><\/script>/, "editor should use a CSP-safe external module");
assert.doesNotMatch(editorHtml, /<script(?![^>]*\bsrc=)[^>]*>/i, "editor should not use inline JavaScript");

for (const tool of ["select", "arrow", "rectangle", "text", "blur", "pixelate"]) {
  assert.match(editorHtml, new RegExp(`data-tool="${tool}"`), `${tool} should be available in the editor toolbar`);
  assert.match(editorHtml, new RegExp(`data-tool="${tool}"[^>]*aria-label="[^"]+ tool"`), `${tool} should keep an accessible name in compact layouts`);
}

assert.match(editorJavaScript, /export async function getRenderedAnnotationBlob/, "Drive and local integrations should be able to request the rendered Blob");
assert.match(editorJavaScript, /createCanvasPdfBlob/, "annotated PDF exports should use the shared real PDF renderer");
assert.match(editorJavaScript, /function setActualSize/, "editor should support an exact 100% zoom mode");
assert.match(editorJavaScript, /getAnnotationCount/, "editor integrations should be able to read the annotation count");
assert.match(editorJavaScript, /parameters\.get\("demo"\) === "1"/, "editor should support its generated browser-QA demo route");
assert.match(editorJavaScript, /includeEditorSource: true/, "library launches should prefer the stored whole-image editor source");
assert.match(editorJavaScript, /function createKeyboardAnnotation/, "editor should support keyboard-only annotation creation");
assert.match(editorJavaScript, /function cycleAnnotationSelection/, "editor should support keyboard-only annotation selection");
assert.match(editorCss, /\.file-button:focus-within\s*\{/, "hidden file controls should draw a visible focus ring on their labels");
assert.match(editorDriveJavaScript, /if \(!configuration\.configured\) \{[\s\S]*?slot\.hidden = true;[\s\S]*?return;/, "unconfigured Drive controls should not occupy editor space");
assert(
  editorDriveJavaScript.indexOf("assertEditorImageLoaded();") < editorDriveJavaScript.indexOf("await connectGoogleDrive();"),
  "Drive consent should happen only after a loaded-image preflight"
);

const rectangle = createAnnotation({
  id: "rectangle-1",
  type: "rectangle",
  x: 140,
  y: 90,
  width: -100,
  height: -60,
  color: "#7ff1c5",
  strokeWidth: 5
});

assert.deepEqual(getAnnotationBounds(rectangle), {
  x: 40,
  y: 30,
  width: 100,
  height: 60
}, "negative drag directions should normalize into a stable rectangle");
assert.equal(hitTestAnnotation(rectangle, { x: 40, y: 50 }, 6), true, "rectangle border should be selectable");
assert.equal(hitTestAnnotation(rectangle, { x: 90, y: 60 }, 6), false, "rectangle interior should not steal selection");

const arrow = createAnnotation({
  id: "arrow-1",
  type: "arrow",
  x1: 10,
  y1: 20,
  x2: 110,
  y2: 120,
  color: "#ff5f87",
  strokeWidth: 4
});

assert.equal(hitTestAnnotation(arrow, { x: 61, y: 69 }, 5), true, "arrow line should be selectable");
assert.equal(findResizeHandle(arrow, { x: 108, y: 119 }, 5)?.name, "end", "arrow endpoint should expose a resize handle");

const movedArrow = translateAnnotation(arrow, -40, -60, { width: 300, height: 200 });
assert.equal(movedArrow.x1, 0, "moving past the left edge should clamp the complete arrow");
assert.equal(movedArrow.y1, 0, "moving past the top edge should clamp the complete arrow");
assert.equal(movedArrow.x2, 100, "clamping should preserve the arrow width");
assert.equal(movedArrow.y2, 100, "clamping should preserve the arrow height");

const resizedRectangle = resizeAnnotation(
  rectangle,
  "se",
  { x: 220, y: 160 },
  { width: 240, height: 180 }
);
assert.deepEqual(getAnnotationBounds(resizedRectangle), {
  x: 40,
  y: 30,
  width: 180,
  height: 130
}, "rectangle resize should follow the selected corner");

const blur = createAnnotation({
  id: "blur-1",
  type: "blur",
  x: 20,
  y: 20,
  width: 80,
  height: 50,
  radius: 20
});
const pixelate = createAnnotation({
  id: "pixelate-1",
  type: "pixelate",
  x: 45,
  y: 35,
  width: 70,
  height: 45,
  pixelSize: 12
});
const text = createAnnotation({
  id: "text-1",
  type: "text",
  x: 15,
  y: 90,
  width: 180,
  height: 70,
  text: "Review this section",
  fontSize: 26,
  background: true
});

assert.equal(hitTestAnnotation(blur, { x: 50, y: 50 }), true, "blurred regions should be selectable throughout");
assert.equal(hitTestAnnotations([blur, pixelate], { x: 50, y: 50 }).id, "pixelate-1", "hit testing should prefer the topmost annotation");
assert.equal(hitTestAnnotation(text, { x: 30, y: 110 }), true, "text boxes should be selectable throughout");

let history = createHistory([]);
history = commitHistory(history, [rectangle]);
history = commitHistory(history, [rectangle, arrow]);
assert.equal(history.present.length, 2, "history should commit annotation changes");
assert.equal(history.past.length, 2, "history should retain undo checkpoints");

history = undoHistory(history);
assert.deepEqual(history.present.map((annotation) => annotation.id), ["rectangle-1"], "undo should restore the previous annotation set");
history = redoHistory(history);
assert.deepEqual(history.present.map((annotation) => annotation.id), ["rectangle-1", "arrow-1"], "redo should restore the undone set");

const recolored = { ...rectangle, color: "#86ddff" };
const replaced = replaceAnnotation(history.present, recolored);
assert.equal(replaced[0].color, "#86ddff", "property edits should replace only the selected annotation");
assert.deepEqual(removeAnnotation(replaced, "arrow-1").map((annotation) => annotation.id), ["rectangle-1"], "delete should remove only the requested annotation");

assert.equal(buildAnnotationFilename("Billing / Q3: Review"), "billing-q3-review-annotated.png", "export filenames should be portable and predictable");
assert.throws(() => createAnnotation({ type: "unknown" }), /Unsupported annotation type/, "unknown annotation types should fail closed");

console.log("Annotation editor smoke test passed: tools, accessible keyboard workflow, whole-image loading, transforms, history, delete, and export naming are stable.");
