import { LUMEN_CONFIG, STORAGE_KEYS, getApiBaseUrls } from "./config.js";

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
    session: stored[STORAGE_KEYS.session] || buildGuestSession(),
    captureHistory: stored[STORAGE_KEYS.captureHistory] || []
  };
}

function buildGuestSession() {
  return {
    id: "",
    signedIn: false,
    plan: "free",
    source: "local",
    user: null,
    backendReachable: false
  };
}

function buildLocalDemoSession() {
  return {
    id: `local-${crypto.randomUUID()}`,
    signedIn: true,
    plan: "demo-pro",
    source: "local",
    user: {
      name: "Lumen Explorer",
      email: "local@lumen.demo"
    },
    backendReachable: false
  };
}

function normalizeRemoteSession(session = {}, meta = {}) {
  return {
    id: session.id || `remote-${crypto.randomUUID()}`,
    signedIn: true,
    plan: session.plan || "pro",
    source: "remote",
    user: {
      name: session.user?.name || "Lumen User",
      email: session.user?.email || ""
    },
    backendReachable: meta.backendReachable !== false
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
