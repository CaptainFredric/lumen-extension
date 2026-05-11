import { randomUUID } from "node:crypto";
import http from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.LUMEN_API_DATA_DIR
  ? path.resolve(process.env.LUMEN_API_DATA_DIR)
  : path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const PORT = Number.parseInt(process.env.LUMEN_API_PORT || "8787", 10);
const HOST = process.env.LUMEN_API_HOST || "127.0.0.1";
const MAX_BODY_BYTES = 1_000_000;
const MAX_CAPTURE_HISTORY = 500;
const MAX_SESSION_CAPTURES = 200;
const MAX_WATCH_PLANS = 100;
const MAX_AGENT_JOBS = 200;

const defaultStore = {
  sessions: [],
  captures: [],
  watchPlans: [],
  agentJobs: [],
  integrations: buildDefaultIntegrations()
};

const server = http.createServer(handleRequest);

server.listen(PORT, HOST, () => {
  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : PORT;
  console.log(`Lumen API listening on http://${HOST}:${resolvedPort}`);
});

async function handleRequest(request, response) {
  try {
    if (request.method === "OPTIONS") {
      return respondJson(response, 204, null);
    }

    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
    const segments = url.pathname.split("/").filter(Boolean);

    if (request.method === "GET" && url.pathname === "/health") {
      const store = await readStore();
      return respondJson(response, 200, {
        ok: true,
        service: "lumen-api",
        storage: {
          sessions: store.sessions.length,
          captures: store.captures.length,
          watchPlans: store.watchPlans.length,
          agentJobs: store.agentJobs.length
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/session") {
      const store = await readStore();
      const session = findSession(store, request.headers["x-lumen-session"]);

      return respondJson(response, 200, {
        session: session || null,
        meta: {
          backendReachable: true
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/session/demo") {
      const store = await readStore();
      const body = await readJsonBody(request);
      const now = new Date().toISOString();
      const session = {
        id: `remote-${randomUUID()}`,
        plan: normalizePlan(body?.plan || "pro"),
        user: {
          name: normalizeText(body?.name, "Lumen Explorer", 80),
          email: normalizeEmail(body?.email, "demo@lumen.app")
        },
        createdAt: now,
        updatedAt: now
      };

      store.sessions = [session, ...store.sessions.filter((entry) => entry.id !== session.id)].slice(0, 100);
      await writeStore(store);

      return respondJson(response, 200, {
        session,
        meta: {
          backendReachable: true
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/session/logout") {
      const store = await readStore();
      const sessionId = normalizeHeaderValue(request.headers["x-lumen-session"]);

      if (sessionId) {
        store.sessions = store.sessions.filter((session) => session.id !== sessionId);
        await writeStore(store);
      }

      return respondJson(response, 200, {
        ok: true
      });
    }

    if (request.method === "GET" && url.pathname === "/v1/integrations") {
      const store = await readStore();
      return respondJson(response, 200, {
        integrations: store.integrations
      });
    }

    if (segments[0] === "v1" && segments[1] === "captures") {
      return handleCapturesRoute({ request, response, url, segments });
    }

    if (segments[0] === "v1" && segments[1] === "stats") {
      return handleStatsRoute({ request, response });
    }

    if (segments[0] === "v1" && segments[1] === "watch-plans") {
      return handleWatchPlansRoute({ request, response, url, segments });
    }

    if (segments[0] === "v1" && segments[1] === "agent-jobs") {
      return handleAgentJobsRoute({ request, response, url, segments });
    }

    return respondJson(response, 404, {
      error: "Not found."
    });
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    return respondJson(response, statusCode, {
      error: error.message || "Internal server error."
    });
  }
}

async function handleCapturesRoute({ request, response, url, segments }) {
  const store = await readStore();
  const session = requireSession(store, request);

  if (!session) {
    return respondJson(response, 401, {
      error: "Missing or invalid session."
    });
  }

  const captureId = segments[2] || "";

  if (request.method === "GET" && !captureId) {
    const limit = parseLimit(url.searchParams.get("limit"), MAX_SESSION_CAPTURES, MAX_SESSION_CAPTURES);
    const captures = store.captures
      .filter((entry) => entry.sessionId === session.id)
      .slice(0, limit)
      .map(publicCapture);

    return respondJson(response, 200, {
      captures
    });
  }

  if (request.method === "POST" && !captureId) {
    const body = await readJsonBody(request);
    const capture = normalizeCaptureRecord(body, session.id);

    store.captures = [
      capture,
      ...store.captures.filter((entry) => !(entry.sessionId === session.id && entry.id === capture.id))
    ].slice(0, MAX_CAPTURE_HISTORY);
    await writeStore(store);

    return respondJson(response, 201, {
      capture: publicCapture(capture)
    });
  }

  const existing = store.captures.find((entry) => entry.sessionId === session.id && entry.id === captureId);

  if (!existing) {
    return respondJson(response, 404, {
      error: "Capture not found."
    });
  }

  if (request.method === "GET") {
    return respondJson(response, 200, {
      capture: publicCapture(existing)
    });
  }

  if (request.method === "DELETE") {
    store.captures = store.captures.filter((entry) => !(entry.sessionId === session.id && entry.id === captureId));
    await writeStore(store);

    return respondJson(response, 200, {
      ok: true,
      deletedId: captureId
    });
  }

  return respondJson(response, 405, {
    error: "Method not allowed."
  });
}

async function handleStatsRoute({ request, response }) {
  if (request.method !== "GET") {
    return respondJson(response, 405, {
      error: "Method not allowed."
    });
  }

  const store = await readStore();
  const session = requireSession(store, request);

  if (!session) {
    return respondJson(response, 401, {
      error: "Missing or invalid session."
    });
  }

  return respondJson(response, 200, {
    stats: buildSessionStats(store, session.id)
  });
}

async function handleWatchPlansRoute({ request, response, url, segments }) {
  const store = await readStore();
  const session = requireSession(store, request);

  if (!session) {
    return respondJson(response, 401, {
      error: "Missing or invalid session."
    });
  }

  const planId = segments[2] || "";

  if (request.method === "GET" && !planId) {
    const limit = parseLimit(url.searchParams.get("limit"), MAX_WATCH_PLANS, MAX_WATCH_PLANS);
    const watchPlans = store.watchPlans
      .filter((entry) => entry.sessionId === session.id)
      .slice(0, limit)
      .map(publicWatchPlan);

    return respondJson(response, 200, {
      watchPlans
    });
  }

  if (request.method === "POST" && !planId) {
    const body = await readJsonBody(request);
    const watchPlan = normalizeWatchPlan(body, session.id);

    store.watchPlans = [
      watchPlan,
      ...store.watchPlans.filter((entry) => !(entry.sessionId === session.id && entry.id === watchPlan.id))
    ].slice(0, MAX_WATCH_PLANS);
    await writeStore(store);

    return respondJson(response, 201, {
      watchPlan: publicWatchPlan(watchPlan)
    });
  }

  const existingIndex = store.watchPlans.findIndex((entry) => entry.sessionId === session.id && entry.id === planId);

  if (existingIndex === -1) {
    return respondJson(response, 404, {
      error: "Watch plan not found."
    });
  }

  if (request.method === "GET") {
    return respondJson(response, 200, {
      watchPlan: publicWatchPlan(store.watchPlans[existingIndex])
    });
  }

  if (request.method === "PATCH") {
    const body = await readJsonBody(request);
    const updated = normalizeWatchPlanUpdate(store.watchPlans[existingIndex], body);
    store.watchPlans[existingIndex] = updated;
    await writeStore(store);

    return respondJson(response, 200, {
      watchPlan: publicWatchPlan(updated)
    });
  }

  if (request.method === "DELETE") {
    store.watchPlans.splice(existingIndex, 1);
    await writeStore(store);

    return respondJson(response, 200, {
      ok: true,
      deletedId: planId
    });
  }

  return respondJson(response, 405, {
    error: "Method not allowed."
  });
}

async function handleAgentJobsRoute({ request, response, url, segments }) {
  const store = await readStore();
  const session = requireSession(store, request);

  if (!session) {
    return respondJson(response, 401, {
      error: "Missing or invalid session."
    });
  }

  const jobId = segments[2] || "";

  if (request.method === "GET" && !jobId) {
    const limit = parseLimit(url.searchParams.get("limit"), MAX_AGENT_JOBS, MAX_AGENT_JOBS);
    const agentJobs = store.agentJobs
      .filter((entry) => entry.sessionId === session.id)
      .slice(0, limit)
      .map(publicAgentJob);

    return respondJson(response, 200, {
      agentJobs
    });
  }

  if (request.method === "POST" && !jobId) {
    const body = await readJsonBody(request);
    const agentJob = normalizeAgentJob(body, session.id);

    store.agentJobs = [
      agentJob,
      ...store.agentJobs.filter((entry) => !(entry.sessionId === session.id && entry.id === agentJob.id))
    ].slice(0, MAX_AGENT_JOBS);
    await writeStore(store);

    return respondJson(response, 201, {
      agentJob: publicAgentJob(agentJob)
    });
  }

  const existingIndex = store.agentJobs.findIndex((entry) => entry.sessionId === session.id && entry.id === jobId);

  if (existingIndex === -1) {
    return respondJson(response, 404, {
      error: "Agent job not found."
    });
  }

  if (request.method === "GET") {
    return respondJson(response, 200, {
      agentJob: publicAgentJob(store.agentJobs[existingIndex])
    });
  }

  if (request.method === "PATCH") {
    const body = await readJsonBody(request);
    const updated = normalizeAgentJobUpdate(store.agentJobs[existingIndex], body);
    store.agentJobs[existingIndex] = updated;
    await writeStore(store);

    return respondJson(response, 200, {
      agentJob: publicAgentJob(updated)
    });
  }

  return respondJson(response, 405, {
    error: "Method not allowed."
  });
}

async function readStore() {
  await mkdir(DATA_DIR, {
    recursive: true
  });

  if (!existsSync(DATA_FILE)) {
    await writeStore(defaultStore);
    return structuredClone(defaultStore);
  }

  const raw = await readFile(DATA_FILE, "utf8");

  try {
    return normalizeStore(JSON.parse(raw));
  } catch {
    await writeStore(defaultStore);
    return structuredClone(defaultStore);
  }
}

async function writeStore(store) {
  await mkdir(DATA_DIR, {
    recursive: true
  });

  const normalized = normalizeStore(store);
  const tempFile = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(normalized, null, 2)}\n`);
  await rename(tempFile, DATA_FILE);
}

function normalizeStore(store = {}) {
  return {
    sessions: Array.isArray(store.sessions) ? store.sessions.map(normalizeSessionRecord).filter(Boolean).slice(0, 100) : [],
    captures: Array.isArray(store.captures) ? store.captures.map(normalizeStoredCapture).filter(Boolean).slice(0, MAX_CAPTURE_HISTORY) : [],
    watchPlans: Array.isArray(store.watchPlans) ? store.watchPlans.map(normalizeStoredWatchPlan).filter(Boolean).slice(0, MAX_WATCH_PLANS) : [],
    agentJobs: Array.isArray(store.agentJobs) ? store.agentJobs.map(normalizeStoredAgentJob).filter(Boolean).slice(0, MAX_AGENT_JOBS) : [],
    integrations: Array.isArray(store.integrations) && store.integrations.length ? store.integrations : buildDefaultIntegrations()
  };
}

function normalizeSessionRecord(session) {
  if (!session || typeof session !== "object" || typeof session.id !== "string" || !session.id) {
    return null;
  }

  return {
    id: session.id.slice(0, 96),
    plan: normalizePlan(session.plan || "free"),
    user: {
      name: normalizeText(session.user?.name, "Lumen User", 80),
      email: normalizeEmail(session.user?.email, "")
    },
    createdAt: normalizeIsoDate(session.createdAt),
    updatedAt: normalizeIsoDate(session.updatedAt || session.createdAt)
  };
}

function findSession(store, sessionId) {
  const normalized = normalizeHeaderValue(sessionId);

  if (!normalized) {
    return null;
  }

  return store.sessions.find((session) => session.id === normalized) || null;
}

function requireSession(store, request) {
  return findSession(store, request.headers["x-lumen-session"]);
}

function normalizeCaptureRecord(body, sessionId) {
  if (!body || typeof body !== "object") {
    throw createHttpError(400, "Capture payload is required.");
  }

  if (!body.url || typeof body.url !== "string") {
    throw createHttpError(400, "Capture URL is required.");
  }

  const url = safeUrl(body.url);

  if (!url) {
    throw createHttpError(400, "Capture URL must be a valid http or https URL.");
  }

  const now = new Date().toISOString();
  const id = normalizeText(body.id, `capture-${randomUUID()}`, 120);

  return {
    id,
    sessionId,
    title: normalizeText(body.title, url.hostname, 160),
    host: normalizeText(body.host, url.host, 160),
    url: url.href,
    devicePreset: normalizeText(body.devicePreset, "desktop", 40),
    exportPreset: normalizeText(body.exportPreset, "raw", 40),
    capturedAt: normalizeIsoDate(body.capturedAt || now),
    createdAt: normalizeIsoDate(body.createdAt || now),
    updatedAt: normalizeIsoDate(body.updatedAt || now),
    archiveFolder: normalizeText(body.archiveFolder, "", 320),
    files: normalizeStringArray(body.files, 80, 320),
    downloads: normalizeDownloads(body.downloads),
    tileCount: normalizeInteger(body.tileCount),
    redactionCount: normalizeInteger(body.redactionCount),
    manualRedactionCount: normalizeInteger(body.manualRedactionCount),
    artifactStats: normalizePlainObject(body.artifactStats, 60),
    manifestFile: normalizeText(body.manifestFile, "", 320),
    annotation: body.annotation && typeof body.annotation === "object" ? normalizePlainObject(body.annotation, 20) : null,
    variants: normalizeArrayObjects(body.variants, 12),
    dimensions: normalizePlainObject(body.dimensions, 12),
    blueprintSummary: body.blueprintSummary && typeof body.blueprintSummary === "object"
      ? normalizePlainObject(body.blueprintSummary, 20)
      : null
  };
}

function normalizeStoredCapture(capture) {
  if (!capture || typeof capture !== "object" || !capture.sessionId) {
    return null;
  }

  try {
    return normalizeCaptureRecord(capture, capture.sessionId);
  } catch {
    return null;
  }
}

function publicCapture(capture) {
  const { sessionId, ...publicRecord } = capture;
  return publicRecord;
}

function normalizeWatchPlan(body, sessionId) {
  if (!body || typeof body !== "object") {
    throw createHttpError(400, "Watch plan payload is required.");
  }

  const url = safeUrl(body.url);

  if (!url) {
    throw createHttpError(400, "Watch plan URL must be a valid http or https URL.");
  }

  const region = normalizeRegion(body.region);

  if (!region) {
    throw createHttpError(400, "Watch plan region is required.");
  }

  const now = new Date().toISOString();

  return {
    id: normalizeText(body.id, `watch-${randomUUID()}`, 120),
    sessionId,
    title: normalizeText(body.title, url.hostname, 160),
    url: url.href,
    host: url.host,
    status: normalizeStatus(body.status, ["active", "paused"], "paused"),
    region,
    schedule: normalizeSchedule(body.schedule),
    destination: normalizeText(body.destination, "local", 80),
    lastRunAt: body.lastRunAt ? normalizeIsoDate(body.lastRunAt) : "",
    createdAt: normalizeIsoDate(body.createdAt || now),
    updatedAt: normalizeIsoDate(body.updatedAt || now)
  };
}

function normalizeStoredWatchPlan(plan) {
  if (!plan || typeof plan !== "object" || !plan.sessionId) {
    return null;
  }

  try {
    return normalizeWatchPlan(plan, plan.sessionId);
  } catch {
    return null;
  }
}

function normalizeWatchPlanUpdate(existing, body) {
  return {
    ...existing,
    ...(typeof body.title === "string" ? { title: normalizeText(body.title, existing.title, 160) } : {}),
    ...(typeof body.status === "string" ? { status: normalizeStatus(body.status, ["active", "paused"], existing.status) } : {}),
    ...(body.region ? { region: normalizeRegion(body.region) || existing.region } : {}),
    ...(body.schedule ? { schedule: normalizeSchedule(body.schedule) } : {}),
    ...(typeof body.destination === "string" ? { destination: normalizeText(body.destination, existing.destination, 80) } : {}),
    ...(typeof body.lastRunAt === "string" ? { lastRunAt: normalizeIsoDate(body.lastRunAt) } : {}),
    updatedAt: new Date().toISOString()
  };
}

function publicWatchPlan(plan) {
  const { sessionId, ...publicRecord } = plan;
  return publicRecord;
}

function normalizeAgentJob(body, sessionId) {
  if (!body || typeof body !== "object") {
    throw createHttpError(400, "Agent job payload is required.");
  }

  const now = new Date().toISOString();

  return {
    id: normalizeText(body.id, `agent-${randomUUID()}`, 120),
    sessionId,
    status: normalizeStatus(body.status, ["queued", "running", "done", "failed", "cancelled"], "queued"),
    task: normalizeText(body.task, "summarize-capture", 120),
    captureId: normalizeText(body.captureId, "", 120),
    watchPlanId: normalizeText(body.watchPlanId, "", 120),
    destination: normalizeText(body.destination, "local-agent", 120),
    payloadPreview: normalizePlainObject(body.payloadPreview, 40),
    result: body.result && typeof body.result === "object" ? normalizePlainObject(body.result, 60) : null,
    error: normalizeText(body.error, "", 240),
    createdAt: normalizeIsoDate(body.createdAt || now),
    updatedAt: normalizeIsoDate(body.updatedAt || now)
  };
}

function normalizeStoredAgentJob(job) {
  if (!job || typeof job !== "object" || !job.sessionId) {
    return null;
  }

  try {
    return normalizeAgentJob(job, job.sessionId);
  } catch {
    return null;
  }
}

function normalizeAgentJobUpdate(existing, body) {
  return {
    ...existing,
    ...(typeof body.status === "string" ? { status: normalizeStatus(body.status, ["queued", "running", "done", "failed", "cancelled"], existing.status) } : {}),
    ...(body.result && typeof body.result === "object" ? { result: normalizePlainObject(body.result, 60) } : {}),
    ...(typeof body.error === "string" ? { error: normalizeText(body.error, "", 240) } : {}),
    updatedAt: new Date().toISOString()
  };
}

function publicAgentJob(job) {
  const { sessionId, ...publicRecord } = job;
  return publicRecord;
}

function buildSessionStats(store, sessionId) {
  const captures = store.captures.filter((entry) => entry.sessionId === sessionId);
  const watchPlans = store.watchPlans.filter((entry) => entry.sessionId === sessionId);
  const agentJobs = store.agentJobs.filter((entry) => entry.sessionId === sessionId);
  const downloads = captures.flatMap((capture) => Array.isArray(capture.downloads) ? capture.downloads : []);
  const artifactBytes = downloads.reduce((sum, download) => sum + normalizeInteger(download.bytesReceived), 0);

  return {
    captureCount: captures.length,
    watchPlanCount: watchPlans.length,
    activeWatchPlanCount: watchPlans.filter((plan) => plan.status === "active").length,
    agentJobCount: agentJobs.length,
    queuedAgentJobCount: agentJobs.filter((job) => job.status === "queued").length,
    fileCount: captures.reduce((sum, capture) => sum + capture.files.length, 0),
    imageCount: downloads.filter((download) => download.kind === "image").length,
    bytesReceived: artifactBytes,
    redactionCount: captures.reduce((sum, capture) => sum + capture.redactionCount, 0),
    latestCaptureAt: captures[0]?.capturedAt || ""
  };
}

function normalizeRegion(region) {
  if (!region || typeof region !== "object") {
    return null;
  }

  const left = normalizeInteger(region.left);
  const top = normalizeInteger(region.top);
  const width = normalizeInteger(region.width);
  const height = normalizeInteger(region.height);

  if (width < 1 || height < 1) {
    return null;
  }

  return {
    id: normalizeText(region.id, `region-${randomUUID()}`, 120),
    kind: "cutaway",
    left,
    top,
    width,
    height,
    sourceViewport: region.sourceViewport && typeof region.sourceViewport === "object"
      ? normalizePlainObject(region.sourceViewport, 12)
      : null,
    anchor: region.anchor && typeof region.anchor === "object"
      ? normalizePlainObject(region.anchor, 20)
      : null
  };
}

function normalizeSchedule(schedule = {}) {
  const intervalMinutes = Math.max(5, Math.min(10080, normalizeInteger(schedule.intervalMinutes || 60)));

  return {
    type: "interval",
    intervalMinutes,
    timezone: normalizeText(schedule.timezone, "local", 64)
  };
}

function normalizeDownloads(downloads) {
  return normalizeArrayObjects(downloads, 80).map((download) => ({
    downloadId: Number.isInteger(download.downloadId) ? download.downloadId : null,
    filename: normalizeText(download.filename, "", 320),
    bytesReceived: normalizeInteger(download.bytesReceived),
    kind: normalizeText(download.kind, "file", 40),
    variantId: normalizeText(download.variantId, "", 40)
  }));
}

function normalizeArrayObjects(value, limit) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .slice(0, limit)
    .map((item) => normalizePlainObject(item, 80));
}

function normalizePlainObject(value, keyLimit) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, keyLimit)
      .map(([key, entry]) => [String(key).slice(0, 120), normalizeJsonValue(entry)])
  );
}

function normalizeJsonValue(value) {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    return value.slice(0, 2000);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map(normalizeJsonValue);
  }

  if (value && typeof value === "object") {
    return normalizePlainObject(value, 30);
  }

  return "";
}

function normalizeStringArray(value, limit, itemLength) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => typeof item === "string")
    .map((item) => item.trim().slice(0, itemLength))
    .filter(Boolean)
    .slice(0, limit);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function normalizeText(value, fallback, maxLength) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return (text || fallback || "").slice(0, maxLength);
}

function normalizeEmail(value, fallback) {
  const text = normalizeText(value, fallback, 160);
  return text.includes("@") || !text ? text : fallback;
}

function normalizePlan(value) {
  return normalizeStatus(value, ["free", "pro", "demo-pro", "team", "enterprise"], "free");
}

function normalizeStatus(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeInteger(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0;
}

function normalizeIsoDate(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

function normalizeHeaderValue(value) {
  return Array.isArray(value) ? value[0] || "" : typeof value === "string" ? value : "";
}

function parseLimit(value, fallback, max) {
  const numeric = Number.parseInt(value || "", 10);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(max, numeric)) : fallback;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let payload = "";
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.byteLength;

      if (size > MAX_BODY_BYTES) {
        reject(createHttpError(413, "Request body is too large."));
        request.destroy();
        return;
      }

      payload += chunk;
    });

    request.on("end", () => {
      if (!payload) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(payload));
      } catch {
        reject(createHttpError(400, "Request body was not valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

function respondJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, x-lumen-session",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Content-Type": "application/json; charset=utf-8"
  });

  response.end(payload === null ? "" : JSON.stringify(payload));
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function buildDefaultIntegrations() {
  return [
    {
      id: "local",
      label: "Local history",
      status: "available",
      description: "Keep captures, watch plans, and agent jobs on this machine."
    },
    {
      id: "google-drive",
      label: "Google Drive",
      status: "planned",
      description: "Future destination for reviewed capture bundles."
    },
    {
      id: "slack",
      label: "Slack",
      status: "planned",
      description: "Future destination for selected review summaries."
    },
    {
      id: "notion",
      label: "Notion",
      status: "planned",
      description: "Future destination for swipe files and product notes."
    },
    {
      id: "agent",
      label: "Agent handoff",
      status: "planned",
      description: "Future explicit handoff for selected captures after redaction review."
    }
  ];
}
