import {
  LUMEN_CONFIG,
  STORAGE_KEYS,
  getApiBaseUrls,
  getPlanEntitlements
} from "./config.js";
import { normalizePlan } from "./entitlements.js";

const REQUEST_TIMEOUT_MS = 2500;

export async function bootstrapAppState() {
  const localState = await readLocalState();

  if (!localState.session.signedIn) {
    return localState;
  }

  const [remoteSession, remoteCaptures, remoteWatchPlans, remoteWatchRuns] = await Promise.all([
    fetchJson(LUMEN_CONFIG.api.endpoints.session, {
      sessionId: localState.session.id
    }),
    fetchJson(LUMEN_CONFIG.api.endpoints.captures, {
      sessionId: localState.session.id
    }),
    fetchJson(LUMEN_CONFIG.api.endpoints.watchPlans, {
      sessionId: localState.session.id
    }),
    fetchJson(LUMEN_CONFIG.api.endpoints.watchRuns, {
      sessionId: localState.session.id
    })
  ]);

  const session = remoteSession?.ok && remoteSession.data?.session
    ? normalizeRemoteSession(remoteSession.data.session, remoteSession.data.meta)
    : localState.session.signedIn
      ? {
          ...localState.session,
          backendReachable: false
        }
      : localState.session;
  const captureHistory =
    remoteCaptures?.ok && Array.isArray(remoteCaptures.data.captures)
      ? remoteCaptures.data.captures
      : localState.captureHistory;
  const watchPlans =
    remoteWatchPlans?.ok && Array.isArray(remoteWatchPlans.data.watchPlans)
      ? remoteWatchPlans.data.watchPlans
      : localState.watchPlans;
  const watchRuns =
    remoteWatchRuns?.ok && Array.isArray(remoteWatchRuns.data.watchRuns)
      ? remoteWatchRuns.data.watchRuns
      : localState.watchRuns;

  const merged = {
    ...localState,
    session,
    captureHistory,
    watchPlans,
    watchRuns
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.session]: session,
    [STORAGE_KEYS.captureHistory]: captureHistory,
    [STORAGE_KEYS.watchPlans]: watchPlans,
    [STORAGE_KEYS.watchRuns]: watchRuns
  });

  return merged;
}

export async function startDemoSession() {
  const remote = await fetchJson(LUMEN_CONFIG.api.endpoints.demoSession, {
    method: "POST",
    body: {
      name: "Lumen Explorer",
      plan: LUMEN_CONFIG.plans.demoPlan,
      source: "extension"
    }
  });

  const session = remote?.ok
    ? normalizeRemoteSession(remote.data.session, remote.data.meta)
    : buildLocalDemoSession();

  await chrome.storage.local.set({
    [STORAGE_KEYS.session]: session
  });

  return session;
}

export async function clearSession() {
  const localState = await readLocalState();

  if (localState.session.signedIn) {
    await fetchJson(LUMEN_CONFIG.api.endpoints.logout, {
      method: "POST",
      sessionId: localState.session.id
    }).catch(() => null);
  }

  const guest = buildGuestSession();

  await chrome.storage.local.set({
    [STORAGE_KEYS.session]: guest
  });

  return guest;
}

export async function readRemoteDataControls(sessionId) {
  const localState = await readLocalState();
  const resolvedSessionId = sessionId || localState.session.id;

  if (!localState.session.signedIn || !resolvedSessionId) {
    return {
      ok: false,
      dataControls: buildLocalDataControls(),
      backendReachable: false
    };
  }

  const remote = await fetchJson(LUMEN_CONFIG.api.endpoints.dataControls, {
    sessionId: resolvedSessionId
  });

  return remote?.ok
    ? {
        ok: true,
        dataControls: normalizeDataControls(remote.data.dataControls),
        backendReachable: true
      }
    : {
        ok: false,
        dataControls: buildLocalDataControls(),
        backendReachable: false
      };
}

export async function updateRemoteDataControls(patch = {}) {
  const localState = await readLocalState();

  if (!localState.session.signedIn || !localState.session.id) {
    return {
      ok: false,
      error: "Start a demo session before changing backend data controls."
    };
  }

  const remote = await fetchJson(LUMEN_CONFIG.api.endpoints.dataControls, {
    method: "PATCH",
    sessionId: localState.session.id,
    body: patch
  });

  return remote?.ok
    ? {
        ok: true,
        dataControls: normalizeDataControls(remote.data.dataControls)
      }
    : {
        ok: false,
        error: remote?.error || "Backend data controls were not reachable."
      };
}

export async function deleteRemoteAccountData() {
  const localState = await readLocalState();

  if (!localState.session.signedIn || !localState.session.id) {
    return {
      ok: false,
      error: "Start a demo session before deleting backend data."
    };
  }

  const remote = await fetchJson(LUMEN_CONFIG.api.endpoints.accountData, {
    method: "DELETE",
    sessionId: localState.session.id,
    body: {
      confirmation: "DELETE LUMEN DATA"
    }
  });

  if (!remote?.ok) {
    return {
      ok: false,
      error: remote?.error || "Backend account data was not reachable."
    };
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.captureHistory]: [],
    [STORAGE_KEYS.watchPlans]: [],
    [STORAGE_KEYS.watchRuns]: []
  });

  return {
    ok: true,
    deleted: remote.data.deleted,
    dataControls: normalizeDataControls(remote.data.dataControls),
    captureHistory: [],
    watchPlans: [],
    watchRuns: []
  };
}

export async function readProductReadiness() {
  const localState = await readLocalState();

  if (!localState.session.signedIn || !localState.session.id) {
    return {
      ok: false,
      readiness: buildLocalReadiness(localState.session)
    };
  }

  const remote = await fetchJson(LUMEN_CONFIG.api.endpoints.productReadiness, {
    sessionId: localState.session.id
  });

  return remote?.ok
    ? {
        ok: true,
        readiness: remote.data
      }
    : {
        ok: false,
        readiness: buildLocalReadiness(localState.session)
      };
}

export async function readRemoteDestinations() {
  const localState = await readLocalState();

  if (!localState.session.signedIn || !localState.session.id) {
    return {
      ok: false,
      destinations: []
    };
  }

  const remote = await fetchJson(LUMEN_CONFIG.api.endpoints.destinations, {
    sessionId: localState.session.id
  });

  return remote?.ok
    ? {
        ok: true,
        destinations: Array.isArray(remote.data.destinations) ? remote.data.destinations : []
      }
    : {
        ok: false,
        destinations: []
      };
}

export async function saveRemoteWatchPlan(payload = {}) {
  const localState = await readLocalState();

  if (!localState.session.signedIn || !localState.session.id) {
    return {
      ok: false,
      error: "Enable advanced tools before saving a timed capture."
    };
  }

  const remote = await fetchJson(LUMEN_CONFIG.api.endpoints.watchPlans, {
    method: "POST",
    sessionId: localState.session.id,
    body: {
      explicitOptIn: true,
      status: "active",
      destination: "local",
      ...payload
    }
  });

  return remote?.ok
    ? {
        ok: true,
        watchPlan: await persistLocalWatchPlan(remote.data.watchPlan)
      }
    : {
        ok: true,
        backendReachable: false,
        watchPlan: await persistLocalWatchPlan(buildLocalWatchPlan(payload, localState.session.id))
      };
}

export async function updateRemoteWatchPlan(watchPlanId = "", patch = {}) {
  const localState = await readLocalState();
  const existing = localState.watchPlans.find((plan) => plan.id === watchPlanId);

  if (!existing) {
    return {
      ok: false,
      error: "Timed capture not found."
    };
  }

  const nextPlan = normalizeWatchPlanRecord({
    ...existing,
    ...patch,
    id: existing.id,
    sessionId: existing.sessionId || localState.session.id,
    updatedAt: new Date().toISOString()
  }, localState.session.id);

  if (localState.session.signedIn && localState.session.id) {
    const remote = await fetchJson(`${LUMEN_CONFIG.api.endpoints.watchPlans}/${encodeURIComponent(watchPlanId)}`, {
      method: "PATCH",
      sessionId: localState.session.id,
      body: {
        explicitOptIn: true,
        ...patch
      }
    });

    if (remote?.ok && remote.data?.watchPlan) {
      return {
        ok: true,
        watchPlan: await persistLocalWatchPlan(remote.data.watchPlan)
      };
    }
  }

  return {
    ok: true,
    backendReachable: false,
    watchPlan: await persistLocalWatchPlan(nextPlan)
  };
}

export async function deleteRemoteWatchPlan(watchPlanId = "") {
  const localState = await readLocalState();
  const nextPlans = localState.watchPlans.filter((plan) => plan.id !== watchPlanId);

  if (nextPlans.length === localState.watchPlans.length) {
    return {
      ok: false,
      error: "Timed capture not found."
    };
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.watchPlans]: nextPlans
  });

  if (localState.session.signedIn && localState.session.id) {
    await fetchJson(`${LUMEN_CONFIG.api.endpoints.watchPlans}/${encodeURIComponent(watchPlanId)}`, {
      method: "DELETE",
      sessionId: localState.session.id
    }).catch(() => null);
  }

  return {
    ok: true,
    deletedId: watchPlanId,
    watchPlans: nextPlans
  };
}

export async function readLocalWatchRuns() {
  const localState = await readLocalState();
  return localState.watchRuns;
}

export async function persistWatchRunRecord(record = {}) {
  const localState = await readLocalState();
  const normalized = normalizeWatchRunRecord(record, localState.session.id);
  const updatedRuns = [
    normalized,
    ...localState.watchRuns.filter((entry) => entry.id !== normalized.id)
  ].slice(0, LUMEN_CONFIG.capture.historyLimit * 3);
  const runAt = normalized.completedAt || normalized.startedAt || normalized.scheduledAt || "";
  const updatedPlans = normalized.watchPlanId && runAt
    ? localState.watchPlans.map((plan) => (
        plan.id === normalized.watchPlanId
          ? {
              ...plan,
              lastRunAt: runAt,
              updatedAt: new Date().toISOString()
            }
          : plan
      ))
    : localState.watchPlans;

  await chrome.storage.local.set({
    [STORAGE_KEYS.watchRuns]: updatedRuns,
    [STORAGE_KEYS.watchPlans]: updatedPlans
  });

  if (localState.session.signedIn) {
    await fetchJson(LUMEN_CONFIG.api.endpoints.watchRuns, {
      method: "POST",
      sessionId: localState.session.id,
      body: normalized
    }).catch(() => null);
  }

  return updatedRuns;
}

export async function queueRemoteDelivery(payload = {}) {
  const localState = await readLocalState();

  if (!localState.session.signedIn || !localState.session.id) {
    return {
      ok: false,
      error: "Enable advanced tools before queueing a delivery."
    };
  }

  const remote = await fetchJson(LUMEN_CONFIG.api.endpoints.deliveries, {
    method: "POST",
    sessionId: localState.session.id,
    body: {
      explicitOptIn: true,
      payloadReviewed: true,
      destinationId: "local",
      trigger: "manual",
      ...payload
    }
  });

  return remote?.ok
    ? {
        ok: true,
        delivery: remote.data.delivery
      }
    : {
        ok: false,
        error: remote?.error || "Delivery queue was not reachable."
      };
}

export async function persistCaptureRecord(record) {
  const localState = await readLocalState();
  const updatedHistory = [record, ...localState.captureHistory]
    .slice(0, LUMEN_CONFIG.capture.historyLimit);

  await chrome.storage.local.set({
    [STORAGE_KEYS.captureHistory]: updatedHistory
  });

  if (localState.session.signedIn) {
    await fetchJson(LUMEN_CONFIG.api.endpoints.captures, {
      method: "POST",
      sessionId: localState.session.id,
      body: record
    }).catch(() => null);
  }

  return updatedHistory;
}

export async function readLocalState() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.latestBlueprint,
    STORAGE_KEYS.session,
    STORAGE_KEYS.captureHistory,
    STORAGE_KEYS.watchPlans,
    STORAGE_KEYS.watchRuns
  ]);

  return {
    latestBlueprint: stored[STORAGE_KEYS.latestBlueprint] || null,
    session: normalizeStoredSession(stored[STORAGE_KEYS.session]),
    captureHistory: stored[STORAGE_KEYS.captureHistory] || [],
    watchPlans: Array.isArray(stored[STORAGE_KEYS.watchPlans]) ? stored[STORAGE_KEYS.watchPlans] : [],
    watchRuns: Array.isArray(stored[STORAGE_KEYS.watchRuns]) ? stored[STORAGE_KEYS.watchRuns] : []
  };
}

async function persistLocalWatchPlan(plan = {}) {
  const localState = await readLocalState();
  const normalized = normalizeWatchPlanRecord(plan, localState.session.id);
  const updatedPlans = [
    normalized,
    ...localState.watchPlans.filter((entry) => entry.id !== normalized.id)
  ].slice(0, 100);

  await chrome.storage.local.set({
    [STORAGE_KEYS.watchPlans]: updatedPlans
  });

  return normalized;
}

function buildLocalWatchPlan(payload = {}, sessionId = "") {
  const now = new Date().toISOString();
  const rawUrl = safeUrl(payload.url);

  return {
    id: payload.id || `watch-${crypto.randomUUID()}`,
    sessionId,
    title: normalizeText(payload.title, rawUrl?.hostname || "Timed capture", 160),
    url: rawUrl?.href || "",
    host: rawUrl?.host || "",
    status: payload.status === "paused" ? "paused" : "active",
    selectionMode: payload.selectionMode === "lasso" ? "lasso" : "rect",
    region: normalizeRegion(payload.region),
    schedule: normalizeSchedule(payload.schedule),
    destination: normalizeText(payload.destination, "local", 80),
    explicitOptIn: true,
    consentAcceptedAt: payload.consentAcceptedAt || now,
    lastRunAt: payload.lastRunAt || "",
    createdAt: payload.createdAt || now,
    updatedAt: now
  };
}

function normalizeWatchPlanRecord(plan = {}, fallbackSessionId = "") {
  const now = new Date().toISOString();
  const rawUrl = safeUrl(plan.url);

  return {
    id: normalizeText(plan.id, `watch-${crypto.randomUUID()}`, 120),
    sessionId: normalizeText(plan.sessionId, fallbackSessionId, 120),
    title: normalizeText(plan.title, rawUrl?.hostname || "Timed capture", 160),
    url: rawUrl?.href || "",
    host: rawUrl?.host || "",
    status: plan.status === "paused" ? "paused" : "active",
    selectionMode: plan.selectionMode === "lasso" ? "lasso" : "rect",
    region: normalizeRegion(plan.region),
    schedule: normalizeSchedule(plan.schedule),
    destination: normalizeText(plan.destination, "local", 80),
    explicitOptIn: plan.explicitOptIn !== false,
    consentAcceptedAt: plan.consentAcceptedAt || now,
    lastRunAt: plan.lastRunAt || "",
    createdAt: plan.createdAt || now,
    updatedAt: plan.updatedAt || now
  };
}

function normalizeWatchRunRecord(record = {}, fallbackSessionId = "") {
  const now = new Date().toISOString();
  const rawUrl = safeUrl(record.url);

  return {
    id: normalizeText(record.id, `watch-run-${crypto.randomUUID()}`, 120),
    sessionId: normalizeText(record.sessionId, fallbackSessionId, 120),
    watchPlanId: normalizeText(record.watchPlanId, "", 120),
    captureId: normalizeText(record.captureId, "", 120),
    title: normalizeText(record.title, rawUrl?.hostname || "Timed capture", 160),
    url: rawUrl?.href || "",
    host: rawUrl?.host || "",
    status: ["queued", "running", "captured", "skipped", "failed"].includes(record.status)
      ? record.status
      : "queued",
    scheduledAt: record.scheduledAt || now,
    startedAt: record.startedAt || "",
    completedAt: record.completedAt || "",
    fileCount: Math.max(0, Math.round(Number(record.fileCount) || 0)),
    files: Array.isArray(record.files) ? record.files.map((file) => normalizeText(file, "", 240)).filter(Boolean).slice(0, 20) : [],
    error: normalizeText(record.error, "", 240),
    createdAt: record.createdAt || now,
    updatedAt: now
  };
}

function normalizeSchedule(schedule = {}) {
  const intervalMinutes = Math.max(1, Math.round(Number(schedule.intervalMinutes) || 60));

  return {
    intervalMinutes,
    timezone: normalizeText(schedule.timezone, "local", 80)
  };
}

function normalizeRegion(region = null) {
  if (!region || typeof region !== "object") {
    return null;
  }

  const width = Math.max(1, Math.round(Number(region.width) || 0));
  const height = Math.max(1, Math.round(Number(region.height) || 0));

  if (!width || !height) {
    return null;
  }

  return {
    id: normalizeText(region.id, `region-${crypto.randomUUID()}`, 120),
    kind: "cutaway",
    shape: region.shape === "lasso" ? "lasso" : "rect",
    left: Math.max(0, Math.round(Number(region.left) || 0)),
    top: Math.max(0, Math.round(Number(region.top) || 0)),
    width,
    height,
    points: Array.isArray(region.points)
      ? region.points.map((point) => ({
          x: Math.max(0, Math.round(Number(point?.x) || 0)),
          y: Math.max(0, Math.round(Number(point?.y) || 0))
        })).slice(0, 120)
      : [],
    ...(region.sourceViewport && typeof region.sourceViewport === "object" ? { sourceViewport: region.sourceViewport } : {}),
    ...(region.anchor && typeof region.anchor === "object" ? { anchor: region.anchor } : {})
  };
}

function safeUrl(rawValue = "") {
  try {
    const url = new URL(rawValue);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function normalizeText(value, fallback = "", limit = 120) {
  const normalized = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return String(normalized || "").slice(0, limit);
}

function normalizeStoredSession(session) {
  if (!session || typeof session !== "object") {
    return buildGuestSession();
  }

  const plan = normalizePlan(session.plan || "free");

  return {
    ...session,
    signedIn: Boolean(session.signedIn),
    plan,
    source: session.source || "local",
    backendReachable: Boolean(session.backendReachable),
    entitlements: session.entitlements || getPlanEntitlements(plan)
  };
}

function buildGuestSession() {
  const plan = "free";

  return {
    id: "",
    signedIn: false,
    plan,
    source: "local",
    user: null,
    backendReachable: false,
    entitlements: getPlanEntitlements(plan)
  };
}

function buildLocalDataControls() {
  return {
    retentionDays: 90,
    cloudSyncEnabled: false,
    deleteSyncedCopiesOnAccountDelete: true,
    backendReachable: false
  };
}

function normalizeDataControls(dataControls = {}) {
  const allowedRetentionDays = new Set([0, 7, 30, 90, 180, 365]);
  const retentionDays = Number(dataControls.retentionDays);

  return {
    retentionDays: allowedRetentionDays.has(retentionDays) ? retentionDays : 90,
    cloudSyncEnabled: dataControls.cloudSyncEnabled === true,
    deleteSyncedCopiesOnAccountDelete: dataControls.deleteSyncedCopiesOnAccountDelete !== false,
    updatedAt: dataControls.updatedAt || "",
    backendReachable: true
  };
}

function buildLocalDemoSession() {
  const plan = LUMEN_CONFIG.plans.demoPlan;

  return {
    id: `local-${crypto.randomUUID()}`,
    signedIn: true,
    plan,
    source: "local",
    user: {
      name: "Lumen Explorer",
      email: "local@lumen.demo"
    },
    backendReachable: false,
    entitlements: getPlanEntitlements(plan)
  };
}

function buildLocalReadiness(session) {
  const entitlements = session?.entitlements || getPlanEntitlements(session?.plan || "free");

  return {
    readiness: [
      {
        id: "capture-core",
        label: "Capture core",
        score: entitlements.features?.responsiveSnap?.available ? 88 : 66,
        status: entitlements.features?.responsiveSnap?.available ? "strong" : "local",
        signals: ["Clean capture", "Manual boxes", "Local history"]
      },
      {
        id: "review-loop",
        label: "Save flow",
        score: entitlements.features?.autoRedact?.available ? 78 : 58,
        status: "solid",
        signals: ["Redaction check", "Focused crop", "Capture notes"]
      },
      {
        id: "team-automation",
        label: "Team automation",
        score: entitlements.features?.cloudSync?.available ? 62 : 34,
        status: "forming",
        signals: ["Destination queue", "Timed watch records", "Agent handoff"]
      }
    ],
    session: {
      plan: entitlements.plan,
      label: entitlements.label
    }
  };
}

function normalizeRemoteSession(session = {}, meta = {}) {
  const plan = normalizePlan(session.plan || "pro");

  return {
    id: session.id || `remote-${crypto.randomUUID()}`,
    signedIn: true,
    plan,
    source: "remote",
    user: {
      name: session.user?.name || "Lumen User",
      email: session.user?.email || ""
    },
    backendReachable: meta.backendReachable !== false,
    entitlements: session.entitlements || getPlanEntitlements(plan)
  };
}

async function fetchJson(path, { method = "GET", body, sessionId = "" } = {}) {
  for (const baseUrl of getApiBaseUrls()) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(new URL(path, baseUrl), {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(sessionId ? { "X-Lumen-Session": sessionId } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      }).finally(() => clearTimeout(timeoutId));

      if (!response.ok) {
        continue;
      }

      return {
        ok: true,
        data: await response.json(),
        baseUrl
      };
    } catch (error) {
      if (error.name === "AbortError") {
        continue;
      }
    }
  }

  return {
    ok: false,
    data: null
  };
}
