import assert from "node:assert/strict";

const SESSION_KEY = "lumen.account.session";
const CAPTURE_HISTORY_KEY = "lumen.capture.history";
const WATCH_PLANS_KEY = "lumen.watch.plans";
const WATCH_RUNS_KEY = "lumen.watch.runs";
const APP_SETTINGS_KEY = "lumen.app.settings";

let storedState = {};
let remoteState = {};
let cloudSyncEnabled = false;
let remoteRequests = [];

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        return Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys])
            .filter((key) => Object.hasOwn(storedState, key))
            .map((key) => [key, structuredClone(storedState[key])])
        );
      },
      async set(patch) {
        storedState = {
          ...storedState,
          ...structuredClone(patch)
        };
      }
    }
  }
};

globalThis.fetch = async (input, options = {}) => {
  const pathname = new URL(input).pathname;
  const method = options.method || "GET";
  const body = options.body ? JSON.parse(options.body) : null;

  remoteRequests.push({
    pathname,
    method,
    body: body ? structuredClone(body) : null
  });

  let payload = null;

  if (pathname === "/v1/session" && method === "GET") {
    payload = {
      session: {
        id: "session-sync-smoke",
        plan: "pro",
        user: {
          name: "Sync Smoke",
          email: "sync@example.test"
        }
      },
      meta: {
        backendReachable: true
      }
    };
  } else if (pathname === "/v1/data-controls" && method === "GET") {
    payload = {
      dataControls: {
        cloudSyncEnabled,
        retentionDays: 90
      }
    };
  } else if (pathname === "/v1/captures") {
    payload = method === "POST"
      ? { capture: body || {} }
      : { captures: remoteState.captureHistory || [] };
  } else if (pathname === "/v1/watch-plans") {
    payload = method === "POST"
      ? { watchPlan: body || {} }
      : { watchPlans: remoteState.watchPlans || [] };
  } else if (pathname.startsWith("/v1/watch-plans/") && method === "PATCH") {
    payload = {
      watchPlan: {
        id: decodeURIComponent(pathname.split("/").at(-1)),
        ...(body || {})
      }
    };
  } else if (pathname === "/v1/watch-runs") {
    payload = method === "POST"
      ? { watchRun: body || {} }
      : { watchRuns: remoteState.watchRuns || [] };
  } else if (pathname === "/v1/deliveries" && method === "POST") {
    payload = {
      delivery: {
        id: "delivery-sync-smoke",
        ...(body || {})
      }
    };
  }

  return new Response(JSON.stringify(payload || {}), {
    status: payload ? 200 : 404,
    headers: {
      "Content-Type": "application/json"
    }
  });
};

const {
  bootstrapAppState,
  persistCaptureRecord,
  persistWatchRunRecord,
  queueRemoteDelivery,
  saveRemoteWatchPlan,
  updateRemoteWatchPlan
} = await import("../lumen-backend.js");

await verifyEmptyRemoteListsPreserveLocalData();
await verifyStableIdReconciliationAndOrdering();
await verifyBootstrapRequiresExplicitSync();
await verifyCaptureUploadRequiresExplicitSync();
await verifyOutboundUrlsAreSanitizedWithoutBreakingLocalTargets();
await verifyLocalOnlyBlocksEveryContentBoundary();

console.log(JSON.stringify({
  ok: true,
  checks: [
    "empty remote lists preserve local records",
    "shared IDs reconcile by freshness",
    "equal-version conflicts preserve local fields",
    "merged lists use deterministic newest-first ordering",
    "remote content bootstrap requires explicit cloud sync",
    "capture metadata uploads require explicit cloud sync",
    "outbound URLs are sanitized while local monitor targets remain complete",
    "local-only blocks bootstrap, capture, monitor, run, and delivery network boundaries"
  ]
}, null, 2));

async function verifyEmptyRemoteListsPreserveLocalData() {
  cloudSyncEnabled = true;
  remoteRequests = [];

  const capture = {
    id: "capture-local-only",
    title: "Unsynced capture",
    capturedAt: "2026-07-15T12:00:00.000Z"
  };
  const watchPlan = {
    id: "watch-plan-local-only",
    title: "Unsynced watch plan",
    updatedAt: "2026-07-15T12:01:00.000Z"
  };
  const watchRun = {
    id: "watch-run-local-only",
    title: "Unsynced watch run",
    completedAt: "2026-07-15T12:02:00.000Z"
  };

  seedLocalState({
    captureHistory: [capture],
    watchPlans: [watchPlan],
    watchRuns: [watchRun]
  });
  remoteState = {
    captureHistory: [],
    watchPlans: [],
    watchRuns: []
  };

  const bootstrapped = await bootstrapAppState();

  assert.deepEqual(bootstrapped.captureHistory, [capture]);
  assert.deepEqual(bootstrapped.watchPlans, [watchPlan]);
  assert.deepEqual(bootstrapped.watchRuns, [watchRun]);
  assert.deepEqual(storedState[CAPTURE_HISTORY_KEY], [capture]);
  assert.deepEqual(storedState[WATCH_PLANS_KEY], [watchPlan]);
  assert.deepEqual(storedState[WATCH_RUNS_KEY], [watchRun]);
}

async function verifyStableIdReconciliationAndOrdering() {
  cloudSyncEnabled = true;
  remoteRequests = [];

  seedLocalState({
    captureHistory: [
      {
        id: "capture-local",
        title: "Local-only capture",
        capturedAt: "2026-07-15T12:00:00.000Z"
      },
      {
        id: "capture-shared",
        title: "Fresher local capture",
        capturedAt: "2026-07-15T10:00:00.000Z",
        updatedAt: "2026-07-15T11:00:00.000Z",
        localArtifact: "kept"
      }
    ],
    watchPlans: [
      {
        id: "watch-plan-local",
        title: "Local-only plan",
        status: "active",
        updatedAt: "2026-07-15T09:00:00.000Z"
      },
      {
        id: "watch-plan-shared",
        title: "Older local plan",
        status: "active",
        updatedAt: "2026-07-15T10:00:00.000Z",
        localRegion: "kept"
      }
    ],
    watchRuns: [
      {
        id: "watch-run-shared",
        title: "Equal-version local run",
        completedAt: "2026-07-15T08:00:00.000Z",
        updatedAt: "2026-07-15T08:05:00.000Z",
        localFiles: ["capture.png"]
      }
    ]
  });

  remoteState = {
    captureHistory: [
      {
        id: "capture-remote",
        title: "Remote-only capture",
        capturedAt: "2026-07-15T13:00:00.000Z"
      },
      {
        id: "capture-shared",
        title: "Older remote capture",
        capturedAt: "2026-07-15T10:00:00.000Z",
        updatedAt: "2026-07-15T10:30:00.000Z",
        remoteReceipt: "kept"
      }
    ],
    watchPlans: [
      {
        id: "watch-plan-remote",
        title: "Remote-only plan",
        status: "active",
        updatedAt: "2026-07-15T11:00:00.000Z"
      },
      {
        id: "watch-plan-shared",
        title: "Newer remote plan",
        status: "paused",
        updatedAt: "2026-07-15T12:00:00.000Z",
        remoteRevision: 2
      }
    ],
    watchRuns: [
      {
        id: "watch-run-remote",
        title: "Remote-only run",
        completedAt: "2026-07-15T09:00:00.000Z",
        updatedAt: "2026-07-15T09:05:00.000Z"
      },
      {
        id: "watch-run-shared",
        title: "Equal-version remote run",
        completedAt: "2026-07-15T08:00:00.000Z",
        updatedAt: "2026-07-15T08:05:00.000Z",
        remoteReceipt: "kept"
      }
    ]
  };

  const bootstrapped = await bootstrapAppState();

  assert.deepEqual(
    bootstrapped.captureHistory.map((record) => record.id),
    ["capture-remote", "capture-local", "capture-shared"]
  );
  assert.equal(bootstrapped.captureHistory.at(-1).title, "Fresher local capture");
  assert.equal(bootstrapped.captureHistory.at(-1).localArtifact, "kept");
  assert.equal(bootstrapped.captureHistory.at(-1).remoteReceipt, "kept");

  assert.deepEqual(
    bootstrapped.watchPlans.map((record) => record.id),
    ["watch-plan-shared", "watch-plan-remote", "watch-plan-local"]
  );
  assert.equal(bootstrapped.watchPlans[0].title, "Newer remote plan");
  assert.equal(bootstrapped.watchPlans[0].status, "paused");
  assert.equal(bootstrapped.watchPlans[0].localRegion, "kept");

  assert.deepEqual(
    bootstrapped.watchRuns.map((record) => record.id),
    ["watch-run-remote", "watch-run-shared"]
  );
  assert.equal(bootstrapped.watchRuns[1].title, "Equal-version local run");
  assert.deepEqual(bootstrapped.watchRuns[1].localFiles, ["capture.png"]);
  assert.equal(bootstrapped.watchRuns[1].remoteReceipt, "kept");

  for (const records of [
    bootstrapped.captureHistory,
    bootstrapped.watchPlans,
    bootstrapped.watchRuns
  ]) {
    assert.equal(new Set(records.map((record) => record.id)).size, records.length);
  }
}

async function verifyBootstrapRequiresExplicitSync() {
  const localCapture = {
    id: "capture-bootstrap-local",
    title: "Local capture",
    capturedAt: "2026-07-15T13:30:00.000Z"
  };

  seedLocalState({
    captureHistory: [localCapture],
    watchPlans: [],
    watchRuns: []
  });
  remoteState = {
    captureHistory: [{
      id: "capture-bootstrap-remote",
      title: "Remote capture",
      capturedAt: "2026-07-15T13:31:00.000Z"
    }],
    watchPlans: [],
    watchRuns: []
  };
  cloudSyncEnabled = false;
  remoteRequests = [];

  const bootstrapped = await bootstrapAppState();

  assert.deepEqual(bootstrapped.captureHistory, [localCapture]);
  assert.deepEqual(storedState[CAPTURE_HISTORY_KEY], [localCapture]);
  assert.deepEqual(
    remoteRequests.map(({ pathname, method }) => ({ pathname, method })),
    [{ pathname: "/v1/data-controls", method: "GET" }]
  );
}

async function verifyCaptureUploadRequiresExplicitSync() {
  seedLocalState({
    captureHistory: [],
    watchPlans: [],
    watchRuns: []
  });
  remoteRequests = [];
  cloudSyncEnabled = false;

  await persistCaptureRecord({
    id: "capture-local-no-sync",
    capturedAt: "2026-07-15T14:00:00.000Z"
  });

  assert.equal(
    remoteRequests.some((request) => request.pathname === "/v1/captures" && request.method === "POST"),
    false
  );
  assert.equal(storedState[CAPTURE_HISTORY_KEY][0].id, "capture-local-no-sync");

  remoteRequests = [];
  cloudSyncEnabled = true;
  await persistCaptureRecord({
    id: "capture-explicit-sync",
    capturedAt: "2026-07-15T14:01:00.000Z"
  });

  assert.equal(
    remoteRequests.some((request) => request.pathname === "/v1/captures" && request.method === "POST"),
    true
  );
}

async function verifyOutboundUrlsAreSanitizedWithoutBreakingLocalTargets() {
  const rawUrl = "https://example.test/monitor?token=secret&view=full#private-fragment";
  const updatedRawUrl = "https://example.test/monitor?access_token=rotated&view=detail#new-fragment";
  const expectedRawUrl = new URL(rawUrl).href;
  const expectedUpdatedRawUrl = new URL(updatedRawUrl).href;

  seedLocalState({
    captureHistory: [],
    watchPlans: [],
    watchRuns: []
  });
  remoteState = {
    captureHistory: [],
    watchPlans: [],
    watchRuns: []
  };
  cloudSyncEnabled = true;
  remoteRequests = [];

  const saved = await saveRemoteWatchPlan({
    id: "watch-sensitive-url",
    title: "Authenticated monitor",
    url: rawUrl,
    status: "active",
    schedule: { mode: "repeat", intervalMinutes: 60 }
  });
  const savedRequest = findRequest("/v1/watch-plans", "POST");

  assert.equal(saved.watchPlan.url, expectedRawUrl);
  assert.equal(storedState[WATCH_PLANS_KEY][0].url, expectedRawUrl);
  assertSanitizedUrl(savedRequest.body.url, "view", "full");

  remoteRequests = [];
  const updated = await updateRemoteWatchPlan(saved.watchPlan.id, {
    url: updatedRawUrl,
    status: "paused"
  });
  const updatedRequest = findRequest(`/v1/watch-plans/${saved.watchPlan.id}`, "PATCH");

  assert.equal(updated.watchPlan.url, expectedUpdatedRawUrl);
  assert.equal(storedState[WATCH_PLANS_KEY][0].url, expectedUpdatedRawUrl);
  assertSanitizedUrl(updatedRequest.body.url, "view", "detail");

  // A newer sanitized server copy must not erase the complete on-device target
  // when both URLs identify the same page.
  remoteState.watchPlans = [{
    ...updated.watchPlan,
    url: updatedRequest.body.url,
    updatedAt: "2030-07-15T14:02:00.000Z"
  }];
  remoteRequests = [];
  const bootstrapped = await bootstrapAppState();
  assert.equal(
    bootstrapped.watchPlans.find((plan) => plan.id === saved.watchPlan.id)?.url,
    expectedUpdatedRawUrl
  );

  remoteRequests = [];
  await persistWatchRunRecord({
    id: "watch-run-sensitive-url",
    watchPlanId: saved.watchPlan.id,
    title: "Authenticated run",
    url: updatedRawUrl,
    status: "captured",
    completedAt: "2026-07-15T14:03:00.000Z"
  });
  const runRequest = findRequest("/v1/watch-runs", "POST");
  assert.equal(storedState[WATCH_RUNS_KEY][0].url, expectedUpdatedRawUrl);
  assertSanitizedUrl(runRequest.body.url, "view", "detail");

  remoteRequests = [];
  await persistCaptureRecord({
    id: "capture-sensitive-url",
    url: rawUrl,
    capturedAt: "2026-07-15T14:04:00.000Z"
  });
  const captureRequest = findRequest("/v1/captures", "POST");
  assert.equal(storedState[CAPTURE_HISTORY_KEY][0].url, rawUrl);
  assertSanitizedUrl(captureRequest.body.url, "view", "full");

  remoteRequests = [];
  const delivery = await queueRemoteDelivery({
    captureId: "capture-sensitive-url",
    destinationId: "drive-fixture",
    url: rawUrl
  });
  const deliveryRequest = findRequest("/v1/deliveries", "POST");
  assert.equal(delivery.ok, true);
  assertSanitizedUrl(deliveryRequest.body.url, "view", "full");
}

async function verifyLocalOnlyBlocksEveryContentBoundary() {
  seedLocalState({
    captureHistory: [],
    watchPlans: [],
    watchRuns: [],
    localOnlyMode: true
  });
  remoteRequests = [];
  cloudSyncEnabled = true;

  await bootstrapAppState();
  await persistCaptureRecord({
    id: "capture-blocked-by-local-only",
    capturedAt: "2026-07-15T15:00:00.000Z"
  });
  const watchPlan = await saveRemoteWatchPlan({
    id: "watch-blocked-by-local-only",
    title: "Local-only monitor",
    url: "https://example.test/local-only",
    status: "active",
    schedule: { mode: "repeat", intervalMinutes: 60 }
  });
  await updateRemoteWatchPlan(watchPlan.watchPlan.id, { status: "paused" });
  await persistWatchRunRecord({
    id: "watch-run-blocked-by-local-only",
    watchPlanId: watchPlan.watchPlan.id,
    title: "Local-only run",
    url: "https://example.test/local-only",
    status: "captured",
    completedAt: "2026-07-15T15:01:00.000Z"
  });
  const delivery = await queueRemoteDelivery({
    captureId: "capture-blocked-by-local-only",
    destinationId: "drive-fixture"
  });

  assert.equal(delivery.ok, false);
  assert.match(delivery.error, /local-only/i);
  assert.equal(remoteRequests.length, 0, `Local-only mode reached remote endpoints: ${JSON.stringify(remoteRequests)}`);
  assert.equal(storedState[CAPTURE_HISTORY_KEY][0].id, "capture-blocked-by-local-only");
  assert.equal(storedState[WATCH_PLANS_KEY][0].id, "watch-blocked-by-local-only");
  assert.equal(storedState[WATCH_RUNS_KEY][0].id, "watch-run-blocked-by-local-only");
}

function seedLocalState({ captureHistory, watchPlans, watchRuns, localOnlyMode = false }) {
  storedState = {
    [SESSION_KEY]: {
      id: "session-sync-smoke",
      signedIn: true,
      plan: "pro",
      source: "local",
      backendReachable: false,
      user: {
        name: "Sync Smoke",
        email: "sync@example.test"
      }
    },
    [CAPTURE_HISTORY_KEY]: structuredClone(captureHistory),
    [WATCH_PLANS_KEY]: structuredClone(watchPlans),
    [WATCH_RUNS_KEY]: structuredClone(watchRuns),
    [APP_SETTINGS_KEY]: {
      version: 1,
      privacyShieldEnabled: false,
      localOnlyMode,
      reviewBeforeSave: false,
      shieldRestore: null
    }
  };
}

function findRequest(pathname, method) {
  const request = remoteRequests.find((entry) => (
    entry.pathname === pathname && entry.method === method
  ));

  assert.ok(request, `Expected ${method} ${pathname}; received ${JSON.stringify(remoteRequests)}`);
  return request;
}

function assertSanitizedUrl(rawUrl, benignKey, benignValue) {
  const url = new URL(rawUrl);

  assert.equal(url.hash, "");
  assert.equal(url.searchParams.get(benignKey), benignValue);
  assert.equal(url.searchParams.has("token"), false);
  assert.equal(url.searchParams.has("access_token"), false);
  assert.doesNotMatch(rawUrl, /secret|rotated|fragment/i);
}
