import { getEntitlementsForPlan, hasFeatureAccess, normalizePlan } from "./entitlements.js";

export const LUMEN_CONFIG = {
  isProUser: false,
  plans: {
    defaultPlan: "demo-pro",
    demoPlan: "team"
  },
  capture: {
    maxSegments: 30,
    captureThrottleMs: 550,
    historyLimit: 100,
    manualRedactionLimit: 24,
    cutawayRegionLimit: 1,
    annotationRegionLimit: 1,
    lateOverlaySettleMs: 140,
    mediaSettleTimeoutMs: 2200,
    maxStallRetries: 3,
    preflightStepFactor: 0.82,
    preflightPauseMs: 36,
    segmentSettleMs: 180,
    tailReflowSettleMs: 240,
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
    // Store builds do not ship a Lumen-owned production endpoint. The local
    // loopback backend exists only for explicit development and contract tests.
    baseUrl: "",
    localBaseUrl: "http://127.0.0.1:8787",
    endpoints: {
      session: "/v1/session",
      demoSession: "/v1/session/demo",
      entitlements: "/v1/entitlements",
      logout: "/v1/session/logout",
      captures: "/v1/captures",
      dataControls: "/v1/data-controls",
      accountData: "/v1/account-data",
      billing: "/v1/billing/portal",
      productReadiness: "/v1/product-readiness",
      syncDestinations: "/v1/integrations",
      watchPlans: "/v1/watch-plans",
      watchRuns: "/v1/watch-runs",
      destinations: "/v1/destinations",
      deliveries: "/v1/deliveries"
    }
  },
  defaults: {
    removeStickyHeaders: true,
    forceLazyLoad: true,
    autoRedact: false,
    exportManifest: true,
    annotationEnabled: false,
    annotationText: "",
    annotationPosition: "top-right",
    devicePreset: "desktop",
    exportPreset: "raw",
    longPageMode: "auto"
  }
};

const CAPTURE_NOTE_POSITIONS = new Set([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right"
]);

const SENSITIVE_URL_KEY_TOKENS = new Set([
  "token",
  "auth",
  "authorization",
  "code",
  "session",
  "secret",
  "password",
  "passwd",
  "key",
  "signature",
  "sig",
  "jwt",
  "credential"
]);

const SENSITIVE_URL_COMPACT_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "authtoken",
  "authorizationcode",
  "sessionid",
  "sessionkey",
  "apikey",
  "clientsecret",
  "signedsignature"
]);

export const STORAGE_KEYS = {
  settings: "lumen.capture.settings",
  latestBlueprint: "lumen.inspector.latestBlueprint",
  session: "lumen.account.session",
  captureHistory: "lumen.capture.history",
  watchPlans: "lumen.watch.plans",
  watchRuns: "lumen.watch.runs",
  manualRedactions: "lumen.capture.manualRedactions",
  cutawayRegions: "lumen.capture.cutawayRegions",
  annotationRegions: "lumen.capture.annotationRegions",
  privateSettings: "lumen.capture.privateSettings",
  onboarding: "lumen.onboarding",
  appSettings: "lumen.app.settings"
};

export function isRestrictedCaptureUrl(url = "") {
  return /^(chrome|chrome-extension|devtools|about|edge|brave):/i.test(url) ||
    /^https:\/\/chromewebstore\.google\.com/i.test(url);
}

export function getFeatureAccess(featureName, plan = "") {
  const fallbackPlan = LUMEN_CONFIG.isProUser ? "pro" : LUMEN_CONFIG.plans.defaultPlan;
  return hasFeatureAccess(normalizePlan(plan || fallbackPlan), featureName);
}

export function getPlanFeatureAccess(plan, featureName) {
  return hasFeatureAccess(normalizePlan(plan), featureName);
}

export function getPlanEntitlements(plan) {
  return getEntitlementsForPlan(normalizePlan(plan));
}

export function buildOriginPattern(rawUrl) {
  const { protocol, host } = new URL(rawUrl);
  return `${protocol}//${host}/*`;
}

export function getDefaultSettings() {
  return structuredClone(LUMEN_CONFIG.defaults);
}

export function getSyncSafeSettings(settings = {}) {
  const normalized = {
    ...getDefaultSettings(),
    ...settings
  };
  const { annotationText: _privateAnnotationText, ...syncSafeSettings } = normalized;

  return syncSafeSettings;
}

export function normalizeCaptureNoteOptions(settings = {}) {
  const text = typeof settings.annotationText === "string"
    ? settings.annotationText.trim().replace(/\s+/g, " ").slice(0, 180)
    : "";
  const position = CAPTURE_NOTE_POSITIONS.has(settings.annotationPosition)
    ? settings.annotationPosition
    : LUMEN_CONFIG.defaults.annotationPosition;

  return {
    enabled: Boolean(settings.annotationEnabled),
    text,
    position
  };
}

export function isOriginPermissionSupported(rawUrl = "") {
  return /^https?:/i.test(rawUrl);
}

export function sanitizeCaptureUrl(rawUrl = "") {
  try {
    const url = new URL(rawUrl);

    if (!/^https?:$/.test(url.protocol)) {
      return "";
    }

    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      const spacedKey = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
      const tokens = spacedKey.split(/[^a-z0-9]+/).filter(Boolean);
      const compactKey = tokens.join("");
      const isSensitive = tokens.some((token) => SENSITIVE_URL_KEY_TOKENS.has(token)) ||
        SENSITIVE_URL_COMPACT_KEYS.has(compactKey);

      if (isSensitive) {
        url.searchParams.delete(key);
      }
    }

    return url.href;
  } catch {
    return "";
  }
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
