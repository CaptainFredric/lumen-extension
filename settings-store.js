import {
  STORAGE_KEYS,
  getDefaultSettings,
  getSyncSafeSettings
} from "./config.js";

export const APP_SETTINGS_VERSION = 1;

export const NEW_INSTALL_APP_SETTINGS = Object.freeze({
  version: APP_SETTINGS_VERSION,
  privacyShieldEnabled: false,
  localOnlyMode: true,
  reviewBeforeSave: false,
  shieldRestore: null
});

export const EXISTING_INSTALL_APP_SETTINGS = Object.freeze({
  version: APP_SETTINGS_VERSION,
  privacyShieldEnabled: false,
  localOnlyMode: false,
  reviewBeforeSave: true,
  shieldRestore: null
});

export function getNewInstallCaptureSettings() {
  return getSyncSafeSettings({
    ...getDefaultSettings(),
    autoRedact: true,
    exportManifest: false
  });
}

export function normalizeAppSettings(value = {}, fallback = EXISTING_INSTALL_APP_SETTINGS) {
  const source = value && typeof value === "object" ? value : {};
  const restore = source.shieldRestore && typeof source.shieldRestore === "object"
    ? {
        autoRedact: Boolean(source.shieldRestore.autoRedact),
        exportManifest: source.shieldRestore.exportManifest !== false,
        localOnlyMode: Boolean(source.shieldRestore.localOnlyMode),
        reviewBeforeSave: source.shieldRestore.reviewBeforeSave !== false
      }
    : null;

  const normalized = {
    version: APP_SETTINGS_VERSION,
    privacyShieldEnabled: Object.hasOwn(source, "privacyShieldEnabled")
      ? Boolean(source.privacyShieldEnabled)
      : Boolean(fallback.privacyShieldEnabled),
    localOnlyMode: Object.hasOwn(source, "localOnlyMode")
      ? Boolean(source.localOnlyMode)
      : Boolean(fallback.localOnlyMode),
    reviewBeforeSave: Object.hasOwn(source, "reviewBeforeSave")
      ? Boolean(source.reviewBeforeSave)
      : Boolean(fallback.reviewBeforeSave),
    shieldRestore: restore
  };

  // Treat Privacy Shield as a policy, not merely a UI preset. This keeps the
  // effective app behavior safe even if storage changes arrive out of order or
  // an older popup writes an incomplete settings object.
  if (normalized.privacyShieldEnabled) {
    normalized.localOnlyMode = true;
    normalized.reviewBeforeSave = true;
  }

  return normalized;
}

export function applyPrivacyShieldToCaptureSettings(settings = {}, appSettings = {}) {
  const normalized = {
    ...getDefaultSettings(),
    ...settings
  };

  if (!normalizeAppSettings(appSettings).privacyShieldEnabled) {
    return normalized;
  }

  return {
    ...normalized,
    autoRedact: true,
    exportManifest: false
  };
}

export async function readAppSettings({
  chromeApi = globalThis.chrome,
  fallback = EXISTING_INSTALL_APP_SETTINGS
} = {}) {
  if (!chromeApi?.storage?.local?.get) {
    return normalizeAppSettings({}, fallback);
  }

  const stored = await chromeApi.storage.local.get(STORAGE_KEYS.appSettings);
  return normalizeAppSettings(stored?.[STORAGE_KEYS.appSettings], fallback);
}

export async function writeAppSettings(value, { chromeApi = globalThis.chrome } = {}) {
  const normalized = normalizeAppSettings(value);

  if (!chromeApi?.storage?.local?.set) {
    return normalized;
  }

  await chromeApi.storage.local.set({
    [STORAGE_KEYS.appSettings]: normalized
  });

  return normalized;
}

export async function writeSettingsTransaction({
  appSettings,
  captureSettings,
  chromeApi = globalThis.chrome
} = {}) {
  if (!chromeApi?.storage?.local?.get || !chromeApi?.storage?.sync?.get) {
    throw new Error("Chrome storage is unavailable for this settings change.");
  }

  const [previousLocal, previousSync] = await Promise.all([
    chromeApi.storage.local.get(STORAGE_KEYS.appSettings),
    chromeApi.storage.sync.get(STORAGE_KEYS.settings)
  ]);
  const previousAppSettings = normalizeAppSettings(previousLocal?.[STORAGE_KEYS.appSettings]);
  const previousCaptureSettings = getSyncSafeSettings({
    ...getDefaultSettings(),
    ...(previousSync?.[STORAGE_KEYS.settings] || {})
  });
  const nextAppSettings = normalizeAppSettings(appSettings);
  const nextCaptureSettings = getSyncSafeSettings(
    applyPrivacyShieldToCaptureSettings(captureSettings, nextAppSettings)
  );

  await chromeApi.storage.sync.set({
    [STORAGE_KEYS.settings]: nextCaptureSettings
  });

  try {
    await chromeApi.storage.local.set({
      [STORAGE_KEYS.appSettings]: nextAppSettings
    });
  } catch (error) {
    await chromeApi.storage.sync.set({
      [STORAGE_KEYS.settings]: previousCaptureSettings
    }).catch(() => {});
    throw error;
  }

  return {
    appSettings: nextAppSettings,
    captureSettings: nextCaptureSettings,
    previousAppSettings,
    previousCaptureSettings
  };
}

export async function initializeAppSettings({
  chromeApi = globalThis.chrome,
  installReason = ""
} = {}) {
  if (!chromeApi?.storage?.local?.get || !chromeApi?.storage?.sync?.get) {
    return {
      appSettings: normalizeAppSettings({}, EXISTING_INSTALL_APP_SETTINGS),
      captureSettings: getSyncSafeSettings(getDefaultSettings()),
      created: false,
      freshInstall: false
    };
  }

  const [localState, syncState] = await Promise.all([
    chromeApi.storage.local.get(STORAGE_KEYS.appSettings),
    chromeApi.storage.sync.get(STORAGE_KEYS.settings)
  ]);
  const existingAppSettings = localState?.[STORAGE_KEYS.appSettings];
  const existingCaptureSettings = syncState?.[STORAGE_KEYS.settings];

  if (existingAppSettings && typeof existingAppSettings === "object") {
    const appSettings = normalizeAppSettings(existingAppSettings);
    const captureSettings = existingCaptureSettings || getNewInstallCaptureSettings();

    await Promise.all([
      writeAppSettings(appSettings, { chromeApi }),
      !existingCaptureSettings
        ? chromeApi.storage.sync.set({ [STORAGE_KEYS.settings]: captureSettings })
        : Promise.resolve()
    ]);

    return {
      appSettings,
      captureSettings,
      created: false,
      freshInstall: false
    };
  }

  // The options page and the service worker can start at the same time on a
  // new profile. Missing capture preferences must therefore converge on safe
  // first-run defaults from either context instead of depending on which one
  // observes Chrome's install reason first.
  const freshInstall = installReason === "install" || !existingCaptureSettings;
  // Missing app settings can also be the other half of the same first-run
  // race (sync storage finished first). Use the local-first app defaults for
  // every uninitialized profile while preserving any capture choices already
  // present from an older install.
  const appSettings = normalizeAppSettings({}, NEW_INSTALL_APP_SETTINGS);
  const captureSettings = freshInstall
    ? getNewInstallCaptureSettings()
    : existingCaptureSettings || getSyncSafeSettings(getDefaultSettings());

  await Promise.all([
    writeAppSettings(appSettings, { chromeApi }),
    !existingCaptureSettings
      ? chromeApi.storage.sync.set({ [STORAGE_KEYS.settings]: captureSettings })
      : Promise.resolve()
  ]);

  return {
    appSettings,
    captureSettings,
    created: true,
    freshInstall
  };
}

export async function isLocalOnlyMode({ chromeApi = globalThis.chrome } = {}) {
  if (!chromeApi?.storage?.local?.get) {
    return false;
  }

  const settings = await readAppSettings({ chromeApi });
  return settings.localOnlyMode;
}
