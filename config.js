export const LUMEN_CONFIG = {
  isProUser: false,
  capture: {
    maxSegments: 30,
    captureThrottleMs: 550,
    historyLimit: 12,
    preflightStepFactor: 0.82,
    preflightPauseMs: 36,
    segmentSettleMs: 180,
    tileMaxOutputHeight: 12000,
    viewports: {
      tablet: {
        width: 1024,
        height: 1366
      },
      mobile: {
        width: 430,
        height: 932
      }
    }
  },
  studio: {
    maxMockupSourceHeight: 4200,
    exportPresets: ["raw", "browser", "phone"],
    posterPadding: 88
  },
  api: {
    baseUrl: "https://api.lumen.app",
    localBaseUrl: "http://127.0.0.1:8787",
    endpoints: {
      session: "/v1/session",
      demoSession: "/v1/session/demo",
      logout: "/v1/session/logout",
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
    autoRedact: false,
    devicePreset: "desktop",
    exportPreset: "raw"
  }
};

export const STORAGE_KEYS = {
  settings: "lumen.capture.settings",
  latestBlueprint: "lumen.inspector.latestBlueprint",
  session: "lumen.account.session",
  captureHistory: "lumen.capture.history"
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

export function getApiBaseUrls() {
  return [LUMEN_CONFIG.api.localBaseUrl, LUMEN_CONFIG.api.baseUrl].filter(Boolean);
}

export function getCaptureVariants(devicePreset = "desktop") {
  if (devicePreset === "responsive") {
    return [
      {
        id: "desktop",
        label: "Desktop",
        mode: "desktop"
      },
      {
        id: "tablet",
        label: "Tablet",
        mode: "viewport",
        viewport: LUMEN_CONFIG.capture.viewports.tablet
      },
      {
        id: "mobile",
        label: "Mobile",
        mode: "viewport",
        viewport: LUMEN_CONFIG.capture.viewports.mobile
      }
    ];
  }

  if (devicePreset === "tablet") {
    return [
      {
        id: "tablet",
        label: "Tablet",
        mode: "viewport",
        viewport: LUMEN_CONFIG.capture.viewports.tablet
      }
    ];
  }

  if (devicePreset === "mobile") {
    return [
      {
        id: "mobile",
        label: "Mobile",
        mode: "viewport",
        viewport: LUMEN_CONFIG.capture.viewports.mobile
      }
    ];
  }

  return [
    {
      id: "desktop",
      label: "Desktop",
      mode: "desktop"
    }
  ];
}

export function requiresOriginPermission(devicePreset = "desktop") {
  return getCaptureVariants(devicePreset).some((variant) => variant.mode === "viewport");
}
