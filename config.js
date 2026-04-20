export const LUMEN_CONFIG = {
  isProUser: false,
  capture: {
    maxSegments: 30,
    captureThrottleMs: 550,
    preflightStepFactor: 0.82,
    preflightPauseMs: 36,
    segmentSettleMs: 180,
    mobileViewport: {
      width: 430,
      height: 932
    }
  },
  api: {
    baseUrl: "https://api.lumen.app",
    endpoints: {
      session: "/v1/session",
      captures: "/v1/captures",
      billing: "/v1/billing/portal",
      syncDestinations: "/v1/integrations"
    }
  },
  proFeatures: {
    beautify: false,
    autoRedact: false,
    cloudSync: false,
    responsiveSnap: false
  },
  defaults: {
    removeStickyHeaders: true,
    forceLazyLoad: true,
    devicePreset: "desktop"
  }
};

export const STORAGE_KEYS = {
  settings: "lumen.capture.settings",
  latestBlueprint: "lumen.inspector.latestBlueprint"
};

export function isRestrictedCaptureUrl(url = "") {
  return /^(chrome|chrome-extension|devtools|about|edge|brave):/i.test(url) ||
    /^https:\/\/chromewebstore\.google\.com/i.test(url);
}

export function getFeatureAccess(featureName) {
  if (LUMEN_CONFIG.isProUser) {
    return true;
  }

  return !LUMEN_CONFIG.proFeatures[featureName];
}

export function buildOriginPattern(rawUrl) {
  const { protocol, host } = new URL(rawUrl);
  return `${protocol}//${host}/*`;
}

export function getDefaultSettings() {
  return structuredClone(LUMEN_CONFIG.defaults);
}

export function isOriginPermissionSupported(rawUrl = "") {
  return /^https?:/i.test(rawUrl);
}
