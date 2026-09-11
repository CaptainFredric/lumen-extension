import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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
  const disclosure = "Fresh-install defaults: local-only mode starts on. Automatic redaction, capture-details JSON, review-before-save, and Privacy Shield start off. Saved choices are preserved on updates.";
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
    assert.doesNotMatch(text, /productReadinessList|renderProductReadiness|Workspace meter/);
  }
});
