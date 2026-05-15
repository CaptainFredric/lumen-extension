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

  const [remoteSession, remoteCaptures] = await Promise.all([
    fetchJson(LUMEN_CONFIG.api.endpoints.session, {
      sessionId: localState.session.id
    }),
    fetchJson(LUMEN_CONFIG.api.endpoints.captures, {
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

  const merged = {
    ...localState,
    session,
    captureHistory
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.session]: session,
    [STORAGE_KEYS.captureHistory]: captureHistory
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
    [STORAGE_KEYS.captureHistory]: []
  });

  return {
    ok: true,
    deleted: remote.data.deleted,
    dataControls: normalizeDataControls(remote.data.dataControls),
    captureHistory: []
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
    STORAGE_KEYS.captureHistory
  ]);

  return {
    latestBlueprint: stored[STORAGE_KEYS.latestBlueprint] || null,
    session: normalizeStoredSession(stored[STORAGE_KEYS.session]),
    captureHistory: stored[STORAGE_KEYS.captureHistory] || []
  };
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
