import {
  STORAGE_KEYS,
  getDefaultSettings
} from "./config.js";
import { disconnectGoogleDrive, getDriveExportStatus } from "./drive-export.js";
import { countLibraryCaptures } from "./library-store.js";
import {
  NEW_INSTALL_APP_SETTINGS,
  applyPrivacyShieldToCaptureSettings,
  initializeAppSettings,
  normalizeAppSettings,
  writeSettingsTransaction
} from "./settings-store.js";

const DRIVE_ORIGINS = new Set([
  "https://www.googleapis.com/*",
  "https://content.googleapis.com/*"
]);

const ui = {
  saveState: document.querySelector(".save-state"),
  saveStateTitle: document.querySelector("#saveStateTitle"),
  saveStateDetail: document.querySelector("#saveStateDetail"),
  shieldCard: document.querySelector(".shield-card"),
  privacyShieldToggle: document.querySelector("#privacyShieldToggle"),
  shieldStateLabel: document.querySelector("#shieldStateLabel"),
  privacyModeBadge: document.querySelector("#privacyModeBadge"),
  autoRedactToggle: document.querySelector("#autoRedactToggle"),
  captureDetailsToggle: document.querySelector("#captureDetailsToggle"),
  localOnlyToggle: document.querySelector("#localOnlyToggle"),
  reviewBeforeSaveToggle: document.querySelector("#reviewBeforeSaveToggle"),
  stickyCleanupToggle: document.querySelector("#stickyCleanupToggle"),
  lazyLoadToggle: document.querySelector("#lazyLoadToggle"),
  refreshAccessButton: document.querySelector("#refreshAccessButton"),
  siteAccessSummary: document.querySelector("#siteAccessSummary"),
  siteAccessList: document.querySelector("#siteAccessList"),
  revokeSiteAccessButton: document.querySelector("#revokeSiteAccessButton"),
  driveAccessSummary: document.querySelector("#driveAccessSummary"),
  revokeDriveAccessButton: document.querySelector("#revokeDriveAccessButton"),
  captureCount: document.querySelector("#captureCount"),
  photoCount: document.querySelector("#photoCount"),
  monitorCount: document.querySelector("#monitorCount"),
  clearWorkspaceButton: document.querySelector("#clearWorkspaceButton")
};

let appSettings = normalizeAppSettings({}, NEW_INSTALL_APP_SETTINGS);
let captureSettings = getDefaultSettings();
let saving = false;

bootstrap().catch((error) => {
  showSaveState("error", "Settings unavailable", error?.message || "Lumen could not load these settings.");
});

async function bootstrap() {
  // The background install event owns the fresh-install migration. Opening the
  // options page must never infer "new user" from missing sync data because an
  // existing profile may have cleared or disabled sync.
  const initialization = await initializeAppSettings({ installReason: "update" });

  appSettings = initialization.appSettings;
  captureSettings = {
    ...getDefaultSettings(),
    ...initialization.captureSettings
  };

  bindEvents();
  renderSettings();
  await Promise.all([refreshAccess(), refreshWorkspaceSummary()]);
  showSaveState("saved", "Saved automatically", "These choices stay with this Chrome profile.");
}

function bindEvents() {
  ui.privacyShieldToggle.addEventListener("change", handleShieldChange);
  ui.autoRedactToggle.addEventListener("change", () => updateCaptureChoice("autoRedact", ui.autoRedactToggle.checked));
  ui.captureDetailsToggle.addEventListener("change", () => updateCaptureChoice("exportManifest", ui.captureDetailsToggle.checked));
  ui.localOnlyToggle.addEventListener("change", () => updateAppChoice("localOnlyMode", ui.localOnlyToggle.checked));
  ui.reviewBeforeSaveToggle.addEventListener("change", () => updateAppChoice("reviewBeforeSave", ui.reviewBeforeSaveToggle.checked));
  ui.stickyCleanupToggle.addEventListener("change", () => updateCaptureChoice("removeStickyHeaders", ui.stickyCleanupToggle.checked));
  ui.lazyLoadToggle.addEventListener("change", () => updateCaptureChoice("forceLazyLoad", ui.lazyLoadToggle.checked));
  ui.refreshAccessButton.addEventListener("click", refreshAccess);
  ui.revokeSiteAccessButton.addEventListener("click", revokeOptionalSiteAccess);
  ui.revokeDriveAccessButton.addEventListener("click", revokeDriveAccess);
  ui.clearWorkspaceButton.addEventListener("click", clearLocalWorkspace);

  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (saving) {
      return;
    }

    if (areaName === "sync" && changes[STORAGE_KEYS.settings]?.newValue) {
      captureSettings = {
        ...getDefaultSettings(),
        ...changes[STORAGE_KEYS.settings].newValue
      };
      renderSettings();
    }

    if (areaName === "local" && changes[STORAGE_KEYS.appSettings]?.newValue) {
      appSettings = normalizeAppSettings(changes[STORAGE_KEYS.appSettings].newValue);
      renderSettings();
    }
  });
}

async function handleShieldChange() {
  if (saving) {
    return;
  }

  const enabled = ui.privacyShieldToggle.checked;

  if (enabled) {
    appSettings = {
      ...appSettings,
      privacyShieldEnabled: true,
      shieldRestore: {
        autoRedact: Boolean(captureSettings.autoRedact),
        exportManifest: captureSettings.exportManifest !== false,
        localOnlyMode: Boolean(appSettings.localOnlyMode),
        reviewBeforeSave: appSettings.reviewBeforeSave !== false
      },
      localOnlyMode: true,
      reviewBeforeSave: true
    };
    captureSettings = {
      ...captureSettings,
      autoRedact: true,
      exportManifest: false
    };
    await persistAll("Privacy Shield on", "Redaction, metadata minimization, save review, local-only mode, and monitor pausing are now enforced.");
    await syncLocalOnlyPolicy(true);
    return;
  }

  const restore = appSettings.shieldRestore || {
    autoRedact: true,
    exportManifest: false,
    localOnlyMode: true,
    reviewBeforeSave: false
  };
  appSettings = {
    ...appSettings,
    privacyShieldEnabled: false,
    localOnlyMode: Boolean(restore.localOnlyMode),
    reviewBeforeSave: restore.reviewBeforeSave !== false,
    shieldRestore: null
  };
  captureSettings = {
    ...captureSettings,
    autoRedact: Boolean(restore.autoRedact),
    exportManifest: restore.exportManifest !== false
  };
  await persistAll("Privacy Shield off", "Your previous choices were restored and active monitors can resume.");
  await syncLocalOnlyPolicy(appSettings.localOnlyMode);
}

async function updateCaptureChoice(key, value) {
  if (saving || appSettings.privacyShieldEnabled && ["autoRedact", "exportManifest"].includes(key)) {
    renderSettings();
    return;
  }

  captureSettings = {
    ...captureSettings,
    [key]: Boolean(value)
  };
  await persistAll("Capture default saved", describeCaptureChoice(key, value));
}

async function updateAppChoice(key, value) {
  if (saving || appSettings.privacyShieldEnabled && ["localOnlyMode", "reviewBeforeSave"].includes(key)) {
    renderSettings();
    return;
  }

  appSettings = {
    ...appSettings,
    [key]: Boolean(value)
  };
  await persistAll("App default saved", describeAppChoice(key, value));

  if (key === "localOnlyMode") {
    await syncLocalOnlyPolicy(Boolean(value));
  }
}

async function syncLocalOnlyPolicy(enabled) {
  if (enabled) {
    await chrome.runtime.sendMessage({
      type: "LUMEN_UPDATE_DATA_CONTROLS",
      payload: { cloudSyncEnabled: false }
    }).catch(() => null);
  }

  await refreshAccess();
}

async function persistAll(title, detail) {
  saving = true;
  renderSettings();
  showSaveState("saving", "Saving changes", detail);

  const previousAppSettings = normalizeAppSettings(
    (await chrome.storage.local.get(STORAGE_KEYS.appSettings))[STORAGE_KEYS.appSettings]
  );
  const previousCaptureSettings = {
    ...getDefaultSettings(),
    ...(await chrome.storage.sync.get(STORAGE_KEYS.settings))[STORAGE_KEYS.settings]
  };

  try {
    const saved = await writeSettingsTransaction({
      appSettings,
      captureSettings
    });
    appSettings = saved.appSettings;
    captureSettings = {
      ...getDefaultSettings(),
      ...saved.captureSettings
    };
    showSaveState("saved", title, detail);
  } catch (error) {
    appSettings = previousAppSettings;
    captureSettings = previousCaptureSettings;
    showSaveState("error", "Change not saved", error?.message || "Chrome storage rejected this change.");
  } finally {
    saving = false;
    renderSettings();
  }
}

function renderSettings() {
  const shieldEnabled = Boolean(appSettings.privacyShieldEnabled);
  captureSettings = applyPrivacyShieldToCaptureSettings(captureSettings, appSettings);
  const lockedControls = [
    ui.autoRedactToggle,
    ui.captureDetailsToggle,
    ui.localOnlyToggle,
    ui.reviewBeforeSaveToggle
  ];

  ui.privacyShieldToggle.checked = shieldEnabled;
  ui.privacyShieldToggle.disabled = saving;
  ui.shieldCard.classList.toggle("is-enabled", shieldEnabled);
  ui.shieldStateLabel.textContent = shieldEnabled ? "On" : "Off";
  ui.privacyModeBadge.textContent = shieldEnabled ? "Shielded" : "Custom";
  ui.autoRedactToggle.checked = Boolean(captureSettings.autoRedact);
  ui.captureDetailsToggle.checked = captureSettings.exportManifest !== false;
  ui.localOnlyToggle.checked = Boolean(appSettings.localOnlyMode);
  ui.reviewBeforeSaveToggle.checked = appSettings.reviewBeforeSave !== false;
  ui.stickyCleanupToggle.checked = captureSettings.removeStickyHeaders !== false;
  ui.lazyLoadToggle.checked = captureSettings.forceLazyLoad !== false;

  for (const control of lockedControls) {
    control.disabled = saving || shieldEnabled;
    control.closest(".setting-row")?.classList.toggle("is-locked", shieldEnabled);
  }

  ui.stickyCleanupToggle.disabled = saving;
  ui.lazyLoadToggle.disabled = saving;
}

async function refreshAccess() {
  ui.refreshAccessButton.disabled = true;

  try {
    const [granted, driveStatus] = await Promise.all([
      chrome.permissions.getAll(),
      getDriveExportStatus()
    ]);
    const manifest = chrome.runtime.getManifest();
    const requiredOrigins = new Set(manifest.host_permissions || []);
    const optionalOrigins = (granted.origins || []).filter((origin) =>
      !requiredOrigins.has(origin) && !DRIVE_ORIGINS.has(origin)
    );
    renderSiteAccess(optionalOrigins);
    renderDriveAccess({
      ...driveStatus,
      identityGranted: (granted.permissions || []).includes("identity"),
      driveOriginGranted: (granted.origins || []).some((origin) => DRIVE_ORIGINS.has(origin))
    });
  } catch (error) {
    ui.siteAccessSummary.textContent = "Chrome access could not be read.";
    ui.driveAccessSummary.textContent = "Drive status could not be read.";
    showSaveState("error", "Permission check failed", error?.message || "Chrome did not return permission details.");
  } finally {
    ui.refreshAccessButton.disabled = false;
  }
}

function renderSiteAccess(origins) {
  ui.siteAccessList.replaceChildren();
  ui.siteAccessSummary.textContent = origins.length
    ? `${origins.length} optional site${origins.length === 1 ? "" : "s"} currently granted`
    : "No optional sites currently granted";
  ui.revokeSiteAccessButton.disabled = !origins.length;

  if (!origins.length) {
    const item = document.createElement("li");
    item.className = "empty-permission";
    item.textContent = "Nothing to revoke";
    ui.siteAccessList.append(item);
    return;
  }

  for (const origin of origins) {
    const item = document.createElement("li");
    item.textContent = formatOrigin(origin);
    item.title = origin;
    ui.siteAccessList.append(item);
  }
}

function renderDriveAccess(status) {
  const granted = Boolean(status.identityGranted || status.driveOriginGranted || status.connected);
  ui.revokeDriveAccessButton.disabled = !granted;

  if (appSettings.localOnlyMode) {
    ui.driveAccessSummary.textContent = granted
      ? "Blocked by local-only mode; a previous grant can be revoked"
      : "Blocked by local-only mode";
    return;
  }

  if (!status.configured) {
    ui.driveAccessSummary.textContent = "Not configured in this GitHub beta";
  } else if (status.connected) {
    ui.driveAccessSummary.textContent = "Connected for reviewed-image export";
  } else if (granted) {
    ui.driveAccessSummary.textContent = "Permission granted; Google authorization is inactive";
  } else {
    ui.driveAccessSummary.textContent = "Not connected";
  }
}

async function revokeOptionalSiteAccess() {
  const confirmed = window.confirm(
    "Revoke every optional site permission? Active area monitors may need access again before their next run."
  );

  if (!confirmed) {
    return;
  }

  showSaveState("saving", "Revoking site access", "Chrome is removing optional origins.");
  ui.revokeSiteAccessButton.disabled = true;

  try {
    const granted = await chrome.permissions.getAll();
    const requiredOrigins = new Set(chrome.runtime.getManifest().host_permissions || []);
    const origins = (granted.origins || []).filter((origin) =>
      !requiredOrigins.has(origin) && !DRIVE_ORIGINS.has(origin)
    );
    let removed = 0;
    const failed = [];

    for (const origin of origins) {
      if (await chrome.permissions.remove({ origins: [origin] })) {
        removed += 1;
      } else {
        failed.push(origin);
      }
    }

    await refreshAccess();
    if (failed.length) {
      showSaveState(
        "error",
        "Some site access remains",
        `${removed} removed; ${failed.length} permission${failed.length === 1 ? " needs" : "s need"} another attempt.`
      );
    } else {
      showSaveState("saved", "Optional site access revoked", `${removed} site permission${removed === 1 ? "" : "s"} removed.`);
    }
  } catch (error) {
    showSaveState("error", "Site access not revoked", error?.message || "Chrome rejected the permission change.");
  }
}

async function revokeDriveAccess() {
  const confirmed = window.confirm(
    "Disconnect Google Drive and revoke Lumen's optional Drive permission? Existing Drive files will remain."
  );

  if (!confirmed) {
    return;
  }

  showSaveState("saving", "Disconnecting Drive", "Removing cached authorization and optional permission.");
  ui.revokeDriveAccessButton.disabled = true;

  try {
    const result = await disconnectGoogleDrive();
    await refreshAccess();
    if (result.complete === false) {
      throw new Error("Chrome kept part of the Drive permission. Review site access and try again.");
    }
    showSaveState("saved", "Drive disconnected", "Lumen no longer has optional Drive access. Existing Drive files remain.");
  } catch (error) {
    showSaveState("error", "Drive not disconnected", error?.message || "Chrome rejected the Drive permission change.");
  }
}

async function refreshWorkspaceSummary() {
  const [stored, photos] = await Promise.all([
    chrome.storage.local.get([
      STORAGE_KEYS.captureHistory,
      STORAGE_KEYS.watchPlans
    ]),
    countLibraryCaptures().catch(() => 0)
  ]);

  ui.captureCount.textContent = String(stored[STORAGE_KEYS.captureHistory]?.length || 0);
  ui.monitorCount.textContent = String(stored[STORAGE_KEYS.watchPlans]?.length || 0);
  ui.photoCount.textContent = String(photos || 0);
}

async function clearLocalWorkspace() {
  const confirmed = window.confirm(
    "Clear Lumen's local history, preview and PDF cache, saved regions, note draft, signals, and area monitors? Downloaded files stay on disk."
  );

  if (!confirmed) {
    return;
  }

  ui.clearWorkspaceButton.disabled = true;
  showSaveState("saving", "Clearing local workspace", "Downloaded image and PDF files will remain on disk.");

  try {
    const response = await chrome.runtime.sendMessage({ type: "LUMEN_CLEAR_LOCAL_DATA" });

    if (!response?.ok) {
      throw new Error(response?.error?.description || "Local workspace cleanup failed.");
    }

    await Promise.all([refreshWorkspaceSummary(), refreshAccess()]);
    const partialFailures = Array.isArray(response.partialFailures) ? response.partialFailures : [];

    if (response.complete === false || partialFailures.length) {
      const remainingAreas = [...new Set(partialFailures.map((failure) => failure.area).filter(Boolean))];
      showSaveState(
        "error",
        "Workspace cleared with warnings",
        `${remainingAreas.length || partialFailures.length} cleanup area${(remainingAreas.length || partialFailures.length) === 1 ? " needs" : "s need"} another pass. ${partialFailures[0]?.description || "Reload Lumen and try again."} Downloaded files remain.`
      );
      return;
    }

    showSaveState("saved", "Local workspace cleared", "History, preview and PDF cache, regions, signals, schedules, and optional access were removed. Downloads remain.");
  } catch (error) {
    showSaveState("error", "Workspace not cleared", error?.message || "Lumen could not remove local data.");
  } finally {
    ui.clearWorkspaceButton.disabled = false;
  }
}

function showSaveState(state, title, detail) {
  ui.saveState.dataset.state = state;
  ui.saveStateTitle.textContent = title;
  ui.saveStateDetail.textContent = detail;
}

function describeCaptureChoice(key, value) {
  if (key === "autoRedact") {
    return value ? "Recognized sensitive details will be obscured before export." : "New captures will preserve page pixels unless you mark redaction boxes.";
  }

  if (key === "exportManifest") {
    return value ? "A JSON capture-details companion will be saved beside new images." : "New exports will skip the capture-details JSON file.";
  }

  if (key === "removeStickyHeaders") {
    return value ? "Repeated sticky interface will be cleaned up during full-page capture." : "Sticky page interface will be preserved as rendered.";
  }

  return value ? "Long pages will be hydrated before capture." : "Lumen will not pre-scroll deferred media before capture.";
}

function describeAppChoice(key, value) {
  if (key === "localOnlyMode") {
    return value ? "Optional Drive connections and uploads are blocked." : "Explicit reviewed-image Drive actions may be used when configured.";
  }

  return value ? "The save review will open before every capture." : "The primary toolbar action will capture after a clean preflight; unresolved warnings still open review.";
}

function formatOrigin(pattern) {
  try {
    const normalized = pattern.replace(/\/\*$/, "");
    const url = new URL(normalized);
    return url.host || pattern;
  } catch {
    return pattern;
  }
}
