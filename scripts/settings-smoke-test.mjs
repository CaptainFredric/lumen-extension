import { createServer } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import {
  applyPrivacyShieldToCaptureSettings,
  initializeAppSettings,
  normalizeAppSettings,
  writeSettingsTransaction
} from "../settings-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lumen-settings-smoke-"));
const extensionDir = path.join(tempRoot, "extension");
const profileDir = path.join(tempRoot, "profile");
const runtimeErrors = [];

let context;
let fixtureServer;

try {
  await verifyShieldStorageTransactions();
  await verifySettingsInitializationRaceSafety();
  const fixture = await startFixtureServer();
  fixtureServer = fixture.server;
  await prepareExtensionCopy(fixture.originPattern);

  context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`
    ]
  });

  const worker = await getExtensionWorker(context);
  const extensionId = new URL(worker.url()).host;
  const settings = await context.newPage();
  watchPageErrors(settings, "settings");
  await settings.goto(`chrome-extension://${extensionId}/settings.html`, { waitUntil: "load" });
  await settings.waitForSelector("#privacyShieldToggle", { timeout: 10000 });
  await settings.waitForFunction(() => document.querySelector("#saveStateTitle")?.textContent?.includes("Saved"));

  const initial = await readSettingsState(settings);
  assert(initial.title === "Lumen Settings", "Dedicated settings page title did not load.", initial);
  assert(!initial.privacyShieldEnabled, "New installs should expose individual safe defaults before strict Shield is enabled.", initial);
  assert(initial.autoRedact && !initial.captureDetails, "New installs did not start with redaction on and exported details off.", initial);
  assert(initial.localOnly && !initial.reviewBeforeSave, "New installs did not start local-only with one-click capture enabled.", initial);
  assert(initial.siteSummary.includes("No optional sites"), "Clean profile unexpectedly displayed optional site access.", initial);

  await toggleAndWait(settings, "#autoRedactToggle", async (state) => state.capture.autoRedact === false);
  await toggleAndWait(settings, "#captureDetailsToggle", async (state) => state.capture.exportManifest === true);
  await toggleAndWait(settings, "#localOnlyToggle", async (state) => state.app.localOnlyMode === false);

  const shieldAlarmName = "lumen.watch.settings-shield-smoke";
  await worker.evaluate(async ({ alarmName, fixtureUrl }) => {
    await chrome.storage.local.set({
      "lumen.watch.plans": [{
        id: "settings-shield-smoke",
        title: "Shield pause fixture",
        url: fixtureUrl,
        status: "active",
        runCount: 0,
        schedule: { mode: "repeat", intervalMinutes: 60, maxRuns: 0 }
      }]
    });
    await chrome.alarms.create(alarmName, { delayInMinutes: 60, periodInMinutes: 60 });
  }, { alarmName: shieldAlarmName, fixtureUrl: fixture.url });
  assert(
    await settings.evaluate((alarmName) => chrome.alarms.get(alarmName).then(Boolean), shieldAlarmName),
    "Timed monitor fixture did not register before Privacy Shield was enabled."
  );

  await toggleAndWait(settings, "#privacyShieldToggle", async (state) =>
    state.app.privacyShieldEnabled === true &&
      state.app.localOnlyMode === true &&
      state.app.reviewBeforeSave === true &&
      state.capture.autoRedact === true &&
      state.capture.exportManifest === false
  );
  await settings.waitForFunction((alarmName) => chrome.alarms.get(alarmName).then((alarm) => !alarm), shieldAlarmName);
  assert(
    !await settings.evaluate((alarmName) => chrome.alarms.get(alarmName).then(Boolean), shieldAlarmName),
    "Privacy Shield did not pause the existing timed monitor alarm."
  );

  await settings.reload({ waitUntil: "load" });
  await settings.waitForSelector("#privacyShieldToggle:checked", { timeout: 10000 });
  const shielded = await readSettingsState(settings);
  assert(
    shielded.privacyShieldEnabled &&
      shielded.autoRedactDisabled &&
      shielded.captureDetailsDisabled &&
      shielded.localOnlyDisabled &&
      shielded.reviewDisabled,
    "Privacy Shield did not persist or lock its coordinated protections after reload.",
    shielded
  );

  await toggleAndWait(settings, "#privacyShieldToggle", async (state) =>
    state.app.privacyShieldEnabled === false &&
      state.app.localOnlyMode === false &&
      state.app.reviewBeforeSave === false &&
      state.capture.autoRedact === false &&
      state.capture.exportManifest === true
  );
  await settings.waitForFunction((alarmName) => chrome.alarms.get(alarmName).then(Boolean), shieldAlarmName);
  assert(
    await settings.evaluate((alarmName) => chrome.alarms.get(alarmName).then(Boolean), shieldAlarmName),
    "Turning Privacy Shield off did not restore the active timed monitor alarm."
  );
  const restored = await readSettingsState(settings);
  assert(
    !restored.autoRedact && restored.captureDetails && !restored.localOnly && !restored.reviewBeforeSave,
    "Turning Privacy Shield off did not restore the user's previous individual choices.",
    restored
  );

  await toggleAndWait(settings, "#autoRedactToggle", async (state) => state.capture.autoRedact === true);
  await toggleAndWait(settings, "#localOnlyToggle", async (state) => state.app.localOnlyMode === true);
  const localOnlyDrive = await settings.evaluate(async () => {
    const drive = await import(chrome.runtime.getURL("drive-export.js"));
    return drive.getDriveExportStatus();
  });
  assert(
    localOnlyDrive.localOnly && localOnlyDrive.reason === "local-only-mode",
    "Local-only mode did not block the configured Drive export surface.",
    localOnlyDrive
  );

  const target = await context.newPage();
  watchPageErrors(target, "fixture");
  await target.goto(fixture.url, { waitUntil: "domcontentloaded" });
  await target.bringToFront();

  await worker.evaluate(async () => {
    const [local, sync] = await Promise.all([
      chrome.storage.local.get("lumen.app.settings"),
      chrome.storage.sync.get("lumen.capture.settings")
    ]);
    await Promise.all([
      chrome.storage.local.set({
        "lumen.app.settings": {
          ...local["lumen.app.settings"],
          privacyShieldEnabled: true,
          localOnlyMode: false,
          reviewBeforeSave: false
        }
      }),
      chrome.storage.sync.set({
        "lumen.capture.settings": {
          ...sync["lumen.capture.settings"],
          autoRedact: false,
          exportManifest: true
        }
      })
    ]);
  });
  const shieldedShortcutGate = await runShortcutCommandProbe(worker, "capture-visible-area");
  assert(
    shieldedShortcutGate.result?.reviewRequired === true &&
      shieldedShortcutGate.result?.captureStarted === false &&
      shieldedShortcutGate.result?.reason === "privacy-shield" &&
      shieldedShortcutGate.result?.captureMode === "visible" &&
      shieldedShortcutGate.beforeHistoryCount === shieldedShortcutGate.afterHistoryCount &&
      shieldedShortcutGate.beforeDownloadCount === shieldedShortcutGate.afterDownloadCount &&
      !shieldedShortcutGate.activeCaptureJob &&
      shieldedShortcutGate.badge === "!" &&
      /Privacy Shield requires review/.test(shieldedShortcutGate.actionTitle) &&
      /No visible area image was saved/.test(shieldedShortcutGate.result.detail) &&
      /Save capture/.test(shieldedShortcutGate.result.detail),
    "Privacy Shield keyboard capture did not stop before saving with a clear review action.",
    shieldedShortcutGate
  );
  const shieldedBackgroundCapture = await settings.evaluate(() => chrome.runtime.sendMessage({
    type: "LUMEN_START_CAPTURE",
    payload: {
      options: {
        removeStickyHeaders: true,
        forceLazyLoad: true,
        autoRedact: false,
        exportManifest: true,
        devicePreset: "desktop",
        exportPreset: "raw",
        longPageMode: "auto"
      }
    }
  }));
  const shieldedRuntimePolicy = await settings.evaluate(async () => {
    const drive = await import(chrome.runtime.getURL("drive-export.js"));
    const store = await import(chrome.runtime.getURL("settings-store.js"));
    const [driveStatus, app] = await Promise.all([
      drive.getDriveExportStatus(),
      store.readAppSettings()
    ]);
    return { driveStatus, app };
  });
  assert(
    shieldedBackgroundCapture?.ok &&
      shieldedBackgroundCapture.redactionCount >= 1 &&
      shieldedBackgroundCapture.manifestFile === "" &&
      shieldedRuntimePolicy.driveStatus.localOnly === true &&
      shieldedRuntimePolicy.app.reviewBeforeSave === true,
    "The background capture path accepted unsafe options while Privacy Shield was enabled.",
    { shieldedBackgroundCapture, shieldedRuntimePolicy }
  );
  const clearedShieldShortcutNotice = await worker.evaluate(async (tabId) => ({
    badge: await chrome.action.getBadgeText({ tabId }),
    title: await chrome.action.getTitle({ tabId })
  }), shieldedShortcutGate.tabId);
  assert(
    clearedShieldShortcutNotice.badge === "" && clearedShieldShortcutNotice.title === "Lumen",
    "Starting an approved capture did not clear the previous shortcut review notice.",
    clearedShieldShortcutNotice
  );
  await worker.evaluate(async () => {
    const [local, sync] = await Promise.all([
      chrome.storage.local.get("lumen.app.settings"),
      chrome.storage.sync.get("lumen.capture.settings")
    ]);
    await Promise.all([
      chrome.storage.local.set({
        "lumen.app.settings": {
          ...local["lumen.app.settings"],
          privacyShieldEnabled: false,
          localOnlyMode: true,
          reviewBeforeSave: false,
          shieldRestore: null
        }
      }),
      chrome.storage.sync.set({
        "lumen.capture.settings": {
          ...sync["lumen.capture.settings"],
          autoRedact: true,
          exportManifest: true
        }
      })
    ]);
  });

  const popup = await context.newPage();
  watchPageErrors(popup, "popup");
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: "load" });
  await popup.waitForSelector("#captureButton:not(:disabled)", { timeout: 10000 });
  await popup.click("#captureButton");
  try {
    await popup.waitForFunction(() => document.querySelector("#statusTitle")?.textContent?.trim() === "Capture complete", null, { timeout: 40000 });
  } catch (error) {
    const diagnostic = await popup.evaluate(async () => ({
      statusTitle: document.querySelector("#statusTitle")?.textContent?.trim() || "",
      statusDetail: document.querySelector("#statusDetail")?.textContent?.trim() || "",
      statusBadge: document.querySelector("#statusBadge")?.textContent?.trim() || "",
      reviewHidden: document.querySelector("#exportReviewPanel")?.classList.contains("is-hidden") || false,
      captureDisabled: document.querySelector("#captureButton")?.disabled || false,
      app: (await chrome.storage.local.get("lumen.app.settings"))["lumen.app.settings"] || {},
      capture: (await chrome.storage.sync.get("lumen.capture.settings"))["lumen.capture.settings"] || {}
    }));
    const failure = new Error(`One-click capture did not complete: ${diagnostic.statusTitle} — ${diagnostic.statusDetail}`);
    failure.details = diagnostic;
    throw failure;
  }
  const fastCapture = await popup.evaluate(() => ({
    title: document.querySelector("#statusTitle")?.textContent?.trim() || "",
    reviewHidden: document.querySelector("#exportReviewPanel")?.classList.contains("is-hidden") || false,
    settingsAction: document.querySelector("#openSettingsButton")?.textContent?.trim() || "",
    reviewQuickAction: document.querySelector("[data-quick-action='review'] strong")?.textContent?.trim() || ""
  }));
  assert(
    fastCapture.title === "Capture complete" && fastCapture.reviewHidden,
    "Review-before-save off did not complete the main one-click capture path.",
    fastCapture
  );
  assert(
    fastCapture.settingsAction === "Settings" && fastCapture.reviewQuickAction === "Review capture",
    "Popup did not expose dedicated Settings and explicit review actions.",
    fastCapture
  );

  await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get("lumen.app.settings");
    await chrome.storage.local.set({
      "lumen.app.settings": {
        ...stored["lumen.app.settings"],
        reviewBeforeSave: true
      }
    });
  });
  await target.bringToFront();
  const reviewShortcutGate = await runShortcutCommandProbe(worker, "capture-page");
  assert(
    reviewShortcutGate.result?.reviewRequired === true &&
      reviewShortcutGate.result?.captureStarted === false &&
      reviewShortcutGate.result?.reason === "review-before-save" &&
      reviewShortcutGate.result?.captureMode === "fullPage" &&
      reviewShortcutGate.beforeHistoryCount === reviewShortcutGate.afterHistoryCount &&
      reviewShortcutGate.beforeDownloadCount === reviewShortcutGate.afterDownloadCount &&
      !reviewShortcutGate.activeCaptureJob &&
      reviewShortcutGate.badge === "!" &&
      /Review required before saving/.test(reviewShortcutGate.actionTitle) &&
      /No full page image was saved/.test(reviewShortcutGate.result.detail) &&
      /Open Lumen/.test(reviewShortcutGate.result.detail),
    "Review-before-save keyboard capture did not stop before saving with a clear review action.",
    reviewShortcutGate
  );
  await popup.waitForFunction(() => document.querySelector("#statusTitle")?.textContent?.trim() === "Review required before saving", null, { timeout: 10000 });
  await popup.reload({ waitUntil: "load" });
  await popup.waitForSelector("#captureButton:not(:disabled)", { timeout: 10000 });
  await popup.click("#captureButton");
  await popup.waitForSelector("#exportReviewPanel:not(.is-hidden)", { timeout: 30000 });
  const reviewedPath = await popup.evaluate(() => ({
    reviewVisible: !document.querySelector("#exportReviewPanel")?.classList.contains("is-hidden"),
    confirmLabel: document.querySelector("#exportReviewConfirmButton")?.textContent?.trim() || "",
    statusTitle: document.querySelector("#statusTitle")?.textContent?.trim() || ""
  }));
  assert(
    reviewedPath.reviewVisible && reviewedPath.confirmLabel === "Save capture" && reviewedPath.statusTitle === "Save check ready",
    "Review-before-save on did not open the explicit confirmation path.",
    reviewedPath
  );
  await popup.click("#exportReviewCancelButton");

  await worker.evaluate(async () => {
    const [local, sync] = await Promise.all([
      chrome.storage.local.get("lumen.app.settings"),
      chrome.storage.sync.get("lumen.capture.settings")
    ]);
    await Promise.all([
      chrome.storage.local.set({
        "lumen.app.settings": {
          ...local["lumen.app.settings"],
          reviewBeforeSave: false
        }
      }),
      chrome.storage.sync.set({
        "lumen.capture.settings": {
          ...sync["lumen.capture.settings"],
          autoRedact: false
        }
      })
    ]);
  });
  await target.bringToFront();
  await popup.reload({ waitUntil: "load" });
  await popup.waitForSelector("#captureButton:not(:disabled)", { timeout: 10000 });
  await popup.click("#captureButton");
  await popup.waitForSelector("#exportReviewPanel:not(.is-hidden)", { timeout: 30000 });
  const warningEscalation = await popup.evaluate(() => ({
    reviewVisible: !document.querySelector("#exportReviewPanel")?.classList.contains("is-hidden"),
    warningText: document.querySelector("#exportReviewWarnings")?.textContent?.trim() || "",
    statusTitle: document.querySelector("#statusTitle")?.textContent?.trim() || ""
  }));
  assert(
    warningEscalation.reviewVisible &&
      warningEscalation.statusTitle === "Save check ready" &&
      warningEscalation.warningText.includes("No redaction layer"),
    "One-click mode did not escalate an unresolved no-redaction warning into review.",
    warningEscalation
  );
  await popup.click("#exportReviewCancelButton");

  const library = await context.newPage();
  await library.goto(`chrome-extension://${extensionId}/library.html`, { waitUntil: "load" });
  const review = await context.newPage();
  await review.goto(`chrome-extension://${extensionId}/review.html?demo=1`, { waitUntil: "load" });
  assert(await library.locator("a[href='settings.html']").count() === 1, "Capture library is missing its Settings navigation action.");
  assert(await review.locator("a[href='settings.html']").count() === 1, "Change review is missing its Settings navigation action.");
  assert(
    await settings.locator("a[href='https://captainfredric.github.io/lumen-extension/privacy.html']").count() === 1,
    "Packaged Settings does not point to the canonical HTTPS privacy policy."
  );
  const cleanupContract = await settings.evaluate(() => chrome.runtime.sendMessage({ type: "LUMEN_CLEAR_LOCAL_DATA" }));
  assert(
    cleanupContract?.ok && cleanupContract.complete === true && Array.isArray(cleanupContract.partialFailures) && !cleanupContract.partialFailures.length,
    "Successful workspace cleanup did not return the explicit complete/partial-failure contract.",
    cleanupContract
  );
  assert(!runtimeErrors.length, "Settings or capture flow emitted runtime errors.", runtimeErrors);

  console.log(JSON.stringify({
    ok: true,
    extensionId,
    defaults: {
      autoRedact: initial.autoRedact,
      captureDetails: initial.captureDetails,
      localOnly: initial.localOnly,
      reviewBeforeSave: initial.reviewBeforeSave
    },
    shieldPersistence: true,
    shieldRestore: true,
    shieldStorageTransaction: true,
    shieldTimedMonitorPauseResume: true,
    shieldedBackgroundCapture: {
      redactionCount: shieldedBackgroundCapture.redactionCount,
      manifestSuppressed: shieldedBackgroundCapture.manifestFile === ""
    },
    keyboardReviewGate: {
      privacyShield: shieldedShortcutGate.result.reason,
      visibleMode: shieldedShortcutGate.result.captureMode,
      reviewBeforeSave: reviewShortcutGate.result.reason,
      fullPageMode: reviewShortcutGate.result.captureMode
    },
    driveBlockedLocally: true,
    fastCapture,
    reviewedPath,
    warningEscalation,
    cleanupContract: {
      complete: cleanupContract.complete,
      partialFailures: cleanupContract.partialFailures.length
    },
    navigation: {
      popup: true,
      library: true,
      review: true
    }
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    details: error.details || null,
    runtimeErrors
  }, null, 2));
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await new Promise((resolve) => fixtureServer?.close(resolve) || resolve());
  await rm(tempRoot, { recursive: true, force: true });
}

async function verifyShieldStorageTransactions() {
  const unsafeCapture = {
    autoRedact: false,
    exportManifest: true,
    removeStickyHeaders: true,
    forceLazyLoad: true,
    devicePreset: "desktop",
    exportPreset: "raw",
    longPageMode: "auto"
  };
  const shieldedApp = {
    privacyShieldEnabled: true,
    localOnlyMode: true,
    reviewBeforeSave: true
  };
  const effective = applyPrivacyShieldToCaptureSettings(unsafeCapture, shieldedApp);
  const effectiveApp = normalizeAppSettings({
    privacyShieldEnabled: true,
    localOnlyMode: false,
    reviewBeforeSave: false
  });
  assert(
    effective.autoRedact === true && effective.exportManifest === false,
    "Central Privacy Shield policy did not override unsafe capture inputs.",
    effective
  );
  assert(
    effectiveApp.localOnlyMode === true && effectiveApp.reviewBeforeSave === true,
    "Central Privacy Shield policy did not enforce local-only review behavior.",
    effectiveApp
  );

  const syncFailure = createStorageFailureHarness({ failSyncWrite: true });
  await assertRejects(() => writeSettingsTransaction({
    appSettings: shieldedApp,
    captureSettings: unsafeCapture,
    chromeApi: syncFailure.chromeApi
  }));
  assert(
    syncFailure.localWriteCount === 0 && syncFailure.localState["lumen.app.settings"].privacyShieldEnabled === false,
    "A failed safe-settings sync write still enabled Privacy Shield locally.",
    syncFailure
  );

  const localFailure = createStorageFailureHarness({ failLocalWrite: true });
  await assertRejects(() => writeSettingsTransaction({
    appSettings: shieldedApp,
    captureSettings: unsafeCapture,
    chromeApi: localFailure.chromeApi
  }));
  assert(
    localFailure.localState["lumen.app.settings"].privacyShieldEnabled === false &&
      localFailure.syncState["lumen.capture.settings"].autoRedact === false &&
      localFailure.syncState["lumen.capture.settings"].exportManifest === true,
    "A failed local Shield write did not roll synchronized capture settings back.",
    localFailure
  );
}

async function verifySettingsInitializationRaceSafety() {
  const emptyProfile = createStorageStateHarness();
  const [optionsInitialization, workerInitialization] = await Promise.all([
    initializeAppSettings({
      chromeApi: emptyProfile.chromeApi,
      installReason: "update"
    }),
    initializeAppSettings({
      chromeApi: emptyProfile.chromeApi,
      installReason: "install"
    })
  ]);
  const emptyState = emptyProfile.read();

  assert(
    optionsInitialization.captureSettings.autoRedact === true &&
      optionsInitialization.captureSettings.exportManifest === false &&
      workerInitialization.captureSettings.autoRedact === true &&
      workerInitialization.captureSettings.exportManifest === false &&
      emptyState.local["lumen.app.settings"].localOnlyMode === true &&
      emptyState.local["lumen.app.settings"].reviewBeforeSave === false &&
      emptyState.sync["lumen.capture.settings"].autoRedact === true &&
      emptyState.sync["lumen.capture.settings"].exportManifest === false,
    "Concurrent first-run contexts did not converge on safe one-click defaults.",
    { optionsInitialization, workerInitialization, emptyState }
  );

  const halfInitializedProfile = createStorageStateHarness({
    local: {
      "lumen.app.settings": {
        version: 1,
        privacyShieldEnabled: false,
        localOnlyMode: true,
        reviewBeforeSave: false,
        shieldRestore: null
      }
    }
  });
  const resumed = await initializeAppSettings({
    chromeApi: halfInitializedProfile.chromeApi,
    installReason: "update"
  });
  const resumedState = halfInitializedProfile.read();

  assert(
    resumed.captureSettings.autoRedact === true &&
      resumed.captureSettings.exportManifest === false &&
      resumedState.sync["lumen.capture.settings"].autoRedact === true &&
      resumedState.sync["lumen.capture.settings"].exportManifest === false,
    "A half-initialized profile fell back to unsafe capture defaults.",
    { resumed, resumedState }
  );

  const syncFirstProfile = createStorageStateHarness({
    sync: {
      "lumen.capture.settings": {
        autoRedact: true,
        exportManifest: false,
        removeStickyHeaders: true,
        forceLazyLoad: true,
        devicePreset: "desktop",
        exportPreset: "raw",
        longPageMode: "auto"
      }
    }
  });
  const syncFirst = await initializeAppSettings({
    chromeApi: syncFirstProfile.chromeApi,
    installReason: "update"
  });
  const syncFirstState = syncFirstProfile.read();

  assert(
    syncFirst.appSettings.localOnlyMode === true &&
      syncFirst.appSettings.reviewBeforeSave === false &&
      syncFirstState.local["lumen.app.settings"].localOnlyMode === true &&
      syncFirstState.local["lumen.app.settings"].reviewBeforeSave === false,
    "A sync-first profile fell back to legacy connected app defaults.",
    { syncFirst, syncFirstState }
  );
}

function createStorageStateHarness({ local = {}, sync = {} } = {}) {
  const state = {
    local: structuredClone(local),
    sync: structuredClone(sync)
  };

  const createArea = (areaName) => ({
    async get(key) {
      return Object.hasOwn(state[areaName], key)
        ? { [key]: structuredClone(state[areaName][key]) }
        : {};
    },
    async set(patch) {
      await Promise.resolve();
      Object.assign(state[areaName], structuredClone(patch));
    }
  });

  return {
    chromeApi: {
      storage: {
        local: createArea("local"),
        sync: createArea("sync")
      }
    },
    read() {
      return structuredClone(state);
    }
  };
}

function createStorageFailureHarness({ failSyncWrite = false, failLocalWrite = false } = {}) {
  const harness = {
    localState: {
      "lumen.app.settings": {
        version: 1,
        privacyShieldEnabled: false,
        localOnlyMode: false,
        reviewBeforeSave: false,
        shieldRestore: null
      }
    },
    syncState: {
      "lumen.capture.settings": {
        autoRedact: false,
        exportManifest: true,
        removeStickyHeaders: true,
        forceLazyLoad: true,
        devicePreset: "desktop",
        exportPreset: "raw",
        longPageMode: "auto"
      }
    },
    localWriteCount: 0,
    syncWriteCount: 0
  };

  harness.chromeApi = {
    storage: {
      local: {
        async get(key) {
          return { [key]: structuredClone(harness.localState[key]) };
        },
        async set(patch) {
          harness.localWriteCount += 1;

          if (failLocalWrite) {
            throw new Error("simulated local write failure");
          }

          Object.assign(harness.localState, structuredClone(patch));
        }
      },
      sync: {
        async get(key) {
          return { [key]: structuredClone(harness.syncState[key]) };
        },
        async set(patch) {
          harness.syncWriteCount += 1;

          if (failSyncWrite && harness.syncWriteCount === 1) {
            throw new Error("simulated sync write failure");
          }

          Object.assign(harness.syncState, structuredClone(patch));
        }
      }
    }
  };

  return harness;
}

async function assertRejects(action) {
  let rejected = false;

  try {
    await action();
  } catch {
    rejected = true;
  }

  assert(rejected, "Expected the simulated storage transaction to fail.");
}

async function readSettingsState(page) {
  return page.evaluate(async () => {
    const [local, sync] = await Promise.all([
      chrome.storage.local.get("lumen.app.settings"),
      chrome.storage.sync.get("lumen.capture.settings")
    ]);

    return {
      title: document.title,
      privacyShieldEnabled: document.querySelector("#privacyShieldToggle")?.checked || false,
      autoRedact: document.querySelector("#autoRedactToggle")?.checked || false,
      autoRedactDisabled: document.querySelector("#autoRedactToggle")?.disabled || false,
      captureDetails: document.querySelector("#captureDetailsToggle")?.checked || false,
      captureDetailsDisabled: document.querySelector("#captureDetailsToggle")?.disabled || false,
      localOnly: document.querySelector("#localOnlyToggle")?.checked || false,
      localOnlyDisabled: document.querySelector("#localOnlyToggle")?.disabled || false,
      reviewBeforeSave: document.querySelector("#reviewBeforeSaveToggle")?.checked || false,
      reviewDisabled: document.querySelector("#reviewBeforeSaveToggle")?.disabled || false,
      siteSummary: document.querySelector("#siteAccessSummary")?.textContent?.trim() || "",
      app: local["lumen.app.settings"] || {},
      capture: sync["lumen.capture.settings"] || {}
    };
  });
}

async function toggleAndWait(page, selector, predicate) {
  await page.click(selector);
  await page.waitForFunction(async ({ appKey, captureKey }) => {
    const [local, sync] = await Promise.all([
      chrome.storage.local.get(appKey),
      chrome.storage.sync.get(captureKey)
    ]);
    return {
      app: local[appKey] || {},
      capture: sync[captureKey] || {}
    };
  }, {
    appKey: "lumen.app.settings",
    captureKey: "lumen.capture.settings"
  });

  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    const state = await page.evaluate(async () => {
      const [local, sync] = await Promise.all([
        chrome.storage.local.get("lumen.app.settings"),
        chrome.storage.sync.get("lumen.capture.settings")
      ]);
      return {
        app: local["lumen.app.settings"] || {},
        capture: sync["lumen.capture.settings"] || {}
      };
    });

    if (await predicate(state)) {
      await page.waitForFunction(() => !document.querySelector("#privacyShieldToggle")?.disabled);
      return;
    }

    await page.waitForTimeout(50);
  }

  throw new Error(`Timed out waiting for ${selector} to persist.`);
}

function watchPageErrors(page, label) {
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(`${label}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(`${label}: ${error.message}`));
}

async function getExtensionWorker(browserContext) {
  let [worker] = browserContext.serviceWorkers();

  if (!worker) {
    worker = await browserContext.waitForEvent("serviceworker", { timeout: 10000 });
  }

  return worker;
}

async function prepareExtensionCopy(originPattern) {
  await cp(repoRoot, extensionDir, {
    recursive: true,
    filter(source) {
      const relative = path.relative(repoRoot, source);
      const parts = relative.split(path.sep);
      return !parts.includes(".git") &&
        !parts.includes("node_modules") &&
        !parts.includes("dist") &&
        !parts.some((part) => part.endsWith(".zip"));
    }
  });

  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // Test-only always-on access makes chrome.tabs.captureVisibleTab available
  // when the popup is exercised as a normal tab instead of Chrome's toolbar.
  manifest.host_permissions = ["<all_urls>"];
  manifest.oauth2 = {
    client_id: "123456789-lumen-settings.apps.googleusercontent.com",
    scopes: ["https://www.googleapis.com/auth/drive.file"]
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const backgroundPath = path.join(extensionDir, "background.js");
  const backgroundSource = await readFile(backgroundPath, "utf8");
  await writeFile(
    backgroundPath,
    `${backgroundSource.trimEnd()}\n\n// Test-only hook for exercising production command routing.\nglobalThis.__LUMEN_TEST_HANDLE_COMMAND__ = handleCommand;\n`
  );
}

async function runShortcutCommandProbe(worker, command) {
  return worker.evaluate(async (requestedCommand) => {
    if (typeof globalThis.__LUMEN_TEST_HANDLE_COMMAND__ !== "function") {
      throw new Error("The command-routing test hook was not installed.");
    }

    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tabId = activeTab?.id;
    const [beforeStorage, beforeDownloads] = await Promise.all([
      chrome.storage.local.get("lumen.capture.history"),
      chrome.downloads.search({})
    ]);
    const result = await globalThis.__LUMEN_TEST_HANDLE_COMMAND__(requestedCommand);
    const [afterStorage, afterDownloads, activeJob, badge, actionTitle] = await Promise.all([
      chrome.storage.local.get("lumen.capture.history"),
      chrome.downloads.search({}),
      chrome.storage.local.get("lumen.capture.activeJob"),
      chrome.action.getBadgeText({ tabId }),
      chrome.action.getTitle({ tabId })
    ]);

    return {
      tabId,
      result,
      beforeHistoryCount: beforeStorage["lumen.capture.history"]?.length || 0,
      afterHistoryCount: afterStorage["lumen.capture.history"]?.length || 0,
      beforeDownloadCount: beforeDownloads.length,
      afterDownloadCount: afterDownloads.length,
      activeCaptureJob: activeJob["lumen.capture.activeJob"] || null,
      badge,
      actionTitle
    };
  }, command);
}

async function startFixtureServer() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
      <html>
        <head><title>Lumen settings fixture</title></head>
        <body>
          <main style="min-height:1800px;padding:32px;font-family:sans-serif">
            <h1>One-click capture fixture</h1>
            <p>A simple page with no embedded frames or canvas warnings. Contact private@example.com for the test fixture.</p>
          </main>
        </body>
      </html>`);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  return {
    server,
    url: `http://127.0.0.1:${address.port}/fixture`,
    originPattern: `http://127.0.0.1:${address.port}/*`
  };
}

function assert(condition, message, details = null) {
  if (condition) {
    return;
  }

  const error = new Error(message);
  error.details = details;
  throw error;
}
