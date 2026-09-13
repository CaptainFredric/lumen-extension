import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createHash } from "node:crypto";
import { LUMEN_CONFIG } from "../config.js";
import {
  NEW_INSTALL_APP_SETTINGS,
  getNewInstallCaptureSettings,
  normalizeAppSettings,
  applyPrivacyShieldToCaptureSettings,
} from "../settings-store.js";

test("fresh capture is local with optional safeguards off", () => {
  const capture = getNewInstallCaptureSettings();
  assert.equal(NEW_INSTALL_APP_SETTINGS.localOnlyMode, true);
  assert.equal(NEW_INSTALL_APP_SETTINGS.privacyShieldEnabled, false);
  assert.equal(NEW_INSTALL_APP_SETTINGS.reviewBeforeSave, false);
  assert.equal(capture.autoRedact, false);
  assert.equal(capture.exportManifest, false);
});

test("explicit choices survive normalization and stronger safeguards enforce policy", () => {
  const saved = { localOnlyMode: false, reviewBeforeSave: true, privacyShieldEnabled: false };
  const normalized = normalizeAppSettings(saved, NEW_INSTALL_APP_SETTINGS);
  for (const key of Object.keys(saved)) assert.equal(normalized[key], saved[key]);
  const strict = normalizeAppSettings({ ...saved, privacyShieldEnabled: true });
  assert.equal(strict.localOnlyMode, true);
  assert.equal(strict.reviewBeforeSave, true);
  const capture = applyPrivacyShieldToCaptureSettings({ autoRedact: false, exportManifest: true }, strict);
  assert.equal(capture.autoRedact, true);
  assert.equal(capture.exportManifest, false);
});

test("release disclosures agree with the tested fresh defaults", async () => {
  // One shared sentence keeps submission copy explicit and reviewable.
  const disclosure = "Fresh-install defaults: local-only mode starts on. Automatic redaction, capture-details JSON, review-before-save, and Private Review Mode start off. Saved choices are preserved on updates.";
  for (const filename of ["PRIVACY.md", "RELEASE_NOTES.md", "STORE_READINESS.md", "CHROME_STORE_LISTING.md", "CHROME_WEB_STORE_PRIVACY_FORM.md"]) {
    const text = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
    assert.ok(text.includes(disclosure), `${filename}: review the default disclosure alongside settings-store.js`);
    assert.doesNotMatch(text, /automatic redaction (?:starts? on|on and capture-details|enabled, capture-details)/i);
  }
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.doesNotMatch(readme, /http:\/\/127\.0\.0\.1:3000\//);
});

test("popup has no development readiness meter", async () => {
  for (const filename of ["popup.html", "popup.js"]) {
    const text = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /productReadinessList|renderProductReadiness|refreshProductReadiness|LUMEN_GET_PRODUCT_READINESS|Workspace meter/);
  }
});

test("visible safeguards and capture vocabulary agree across product surfaces", async () => {
  for (const filename of ["settings.html", "settings.js", "library.html", "library.js", "content.js", "README.md", "PRIVACY.md", "docs/privacy.html"]) {
    const text = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /Privacy Shield|Photo Library|photo library|Focused crop/, filename);
  }
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.doesNotMatch(background, /prevents one-click saving/);
  const area = await readFile(new URL("../area-review.html", import.meta.url), "utf8");
  assert.ok(area.includes('id="approve"') && area.includes("Selection map, not an image preview"));
});

test("launcher boundaries keep persistent and experimental workspaces elsewhere", async () => {
  const html = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  const js = await readFile(new URL("../popup.js", import.meta.url), "utf8");
  assert.doesNotMatch(html, /Analyze page|Mark cutaway|Focused crop|Connect team preview|Queue latest capture|Allow cloud sync|Recent captures and timed runs|Archive|captureShelfGrid|photoLibraryGrid|historyList/);
  assert.doesNotMatch(js, /LUMEN_ANALYZE_PAGE|LUMEN_SAVE_WATCH_PLAN|LUMEN_SIGN_IN|renderBlueprint|renderHistory/);
  assert.ok(html.includes('href="library.html#monitors"'));
  assert.ok(html.includes('id="lastCapture"'));
  for (const scope of ["desktop", "visible", "area", "responsive"]) assert.ok(html.includes(`data-scope="${scope}"`));
  assert.ok(html.split("\n").length < 400, "Keep launcher markup focused");
  assert.ok(js.split("\n").length < 1000, "Persistent workspaces belong outside the launcher");
  const library = await readFile(new URL("../library.html", import.meta.url), "utf8");
  assert.ok(library.includes('id="monitors"') && library.includes("library-monitors.js"));
  const result = await readFile(new URL("../result.html", import.meta.url), "utf8");
  assert.ok(result.includes('id="pageContextValues"'));
});

test("public demo and retained proof match the responsive presets", async () => {
  const html = await readFile(new URL("../docs/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /Orbit|capture-run-|store-capture-set/);
  for (const preset of Object.values(LUMEN_CONFIG.capture.viewports)) {
    assert.ok(html.includes(`data-viewport="${preset.width}"`));
  }
  const proof = JSON.parse(await readFile(new URL("../docs/assets/garden-run.json", import.meta.url), "utf8"));
  const fixture = await readFile(new URL("../docs/bug-garden.html", import.meta.url));
  assert.equal(proof.fixtureSha256, createHash("sha256").update(fixture).digest("hex"), "Regenerate proof after changing the fixture");
  assert.equal(proof.images.length, 3);
  assert.equal(proof.captureHealth.status, "complete");
  assert.ok(proof.redactionCount >= 3);
  assert.ok(proof.historyItem.id);
  assert.ok(proof.blueprint.identity.navLabels.includes("Checkout"));
  for (const image of proof.images) {
    const png = await readFile(new URL(`../docs/assets/${image.file}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), image.width);
    assert.equal(png.readUInt32BE(20), image.height);
  }
});
