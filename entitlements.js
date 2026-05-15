export const LUMEN_PLAN_IDS = ["free", "pro", "demo-pro", "team", "enterprise"];

export const LUMEN_FEATURES = {
  cleanCapture: {
    label: "Clean full-page capture",
    status: "implemented",
    description: "Full-page export with sticky cleanup, lazy-load preflight, local history, and manifest output."
  },
  manualRedaction: {
    label: "Manual redaction and cutaway tools",
    status: "implemented",
    description: "Draw review boxes, cutaway regions, and one callout before export."
  },
  responsiveSnap: {
    label: "Responsive capture set",
    status: "implemented",
    description: "Export desktop, tablet, mobile, or a full responsive set from one action."
  },
  autoRedact: {
    label: "Auto-redaction scan",
    status: "implemented",
    description: "Detect visible emails, phones, tokens, and filled inputs before export review."
  },
  beautify: {
    label: "Poster export frames",
    status: "implemented",
    description: "Wrap captures in browser or phone poster outputs for review and sharing."
  },
  historySync: {
    label: "Backend history sync",
    status: "prototype",
    description: "Sync capture metadata into the local-first backend when it is reachable."
  },
  cloudSync: {
    label: "Cloud destinations",
    status: "planned",
    description: "Send reviewed capture bundles to destinations such as Drive, Slack, or Notion."
  },
  regionWatch: {
    label: "Opt-in region watch records",
    status: "prototype",
    description: "Store reviewed cutaway watch plans. Durable scheduling and visual diff review still need production work."
  },
  agentHandoff: {
    label: "Reviewed agent handoff records",
    status: "prototype",
    description: "Queue reviewed capture payloads for a future background agent workflow."
  }
};

const PLAN_LABELS = {
  free: "Free",
  pro: "Pro",
  "demo-pro": "Demo Pro",
  team: "Team",
  enterprise: "Enterprise"
};

const PLAN_FEATURES = {
  free: ["cleanCapture", "manualRedaction"],
  pro: ["cleanCapture", "manualRedaction", "responsiveSnap", "autoRedact", "beautify", "historySync"],
  "demo-pro": ["cleanCapture", "manualRedaction", "responsiveSnap", "autoRedact", "beautify", "historySync"],
  team: [
    "cleanCapture",
    "manualRedaction",
    "responsiveSnap",
    "autoRedact",
    "beautify",
    "historySync",
    "cloudSync",
    "regionWatch",
    "agentHandoff"
  ],
  enterprise: [
    "cleanCapture",
    "manualRedaction",
    "responsiveSnap",
    "autoRedact",
    "beautify",
    "historySync",
    "cloudSync",
    "regionWatch",
    "agentHandoff"
  ]
};

const PLAN_LIMITS = {
  free: {
    historyItems: 12,
    responsiveVariants: 1,
    watchPlans: 0,
    agentJobs: 0
  },
  pro: {
    historyItems: 100,
    responsiveVariants: 3,
    watchPlans: 0,
    agentJobs: 0
  },
  "demo-pro": {
    historyItems: 100,
    responsiveVariants: 3,
    watchPlans: 0,
    agentJobs: 0
  },
  team: {
    historyItems: 500,
    responsiveVariants: 3,
    watchPlans: 25,
    agentJobs: 100
  },
  enterprise: {
    historyItems: 2000,
    responsiveVariants: 3,
    watchPlans: 250,
    agentJobs: 1000
  }
};

export function normalizePlan(value = "free") {
  return LUMEN_PLAN_IDS.includes(value) ? value : "free";
}

export function hasFeatureAccess(plan, featureName) {
  const normalizedPlan = normalizePlan(plan);
  return Boolean(PLAN_FEATURES[normalizedPlan]?.includes(featureName));
}

export function getFeatureRequiredPlans(featureName) {
  return LUMEN_PLAN_IDS.filter((plan) => hasFeatureAccess(plan, featureName));
}

export function getEntitlementsForPlan(plan) {
  const normalizedPlan = normalizePlan(plan);
  const features = Object.fromEntries(
    Object.entries(LUMEN_FEATURES).map(([featureName, feature]) => {
      const available = hasFeatureAccess(normalizedPlan, featureName);

      return [
        featureName,
        {
          ...feature,
          available,
          locked: !available,
          requiredPlans: getFeatureRequiredPlans(featureName)
        }
      ];
    })
  );

  return {
    plan: normalizedPlan,
    label: PLAN_LABELS[normalizedPlan],
    isPaidLike: normalizedPlan !== "free",
    features,
    limits: PLAN_LIMITS[normalizedPlan]
  };
}
