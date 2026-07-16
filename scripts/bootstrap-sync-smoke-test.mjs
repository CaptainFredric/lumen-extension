import assert from "node:assert/strict";

const SESSION_KEY = "lumen.account.session";
const CAPTURE_HISTORY_KEY = "lumen.capture.history";
const WATCH_PLANS_KEY = "lumen.watch.plans";
const WATCH_RUNS_KEY = "lumen.watch.runs";

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
  remoteRequests.push({
    pathname,
    method: options.method || "GET"
  });
  const payload = {
    "/v1/session": {
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
    },
    "/v1/captures": {
      captures: remoteState.captureHistory || []
    },
    "/v1/watch-plans": {
      watchPlans: remoteState.watchPlans || []
    },
    "/v1/watch-runs": {
      watchRuns: remoteState.watchRuns || []
    },
    "/v1/data-controls": {
      dataControls: {
        cloudSyncEnabled,
        retentionDays: 90
      }
    },
    "/v1/captures": options.method === "POST"
      ? {
          capture: JSON.parse(options.body || "{}")
        }
      : {
          captures: remoteState.captureHistory || []
    }
  }[pathname];

  return new Response(JSON.stringify(payload || {}), {
    status: payload ? 200 : 404,
    headers: {
      "Content-Type": "application/json"
    }
  });
};

const { bootstrapAppState, persistCaptureRecord } = await import("../lumen-backend.js");

await verifyEmptyRemoteListsPreserveLocalData();
await verifyStableIdReconciliationAndOrdering();
await verifyCaptureUploadRequiresExplicitSync();

console.log(JSON.stringify({
  ok: true,
  checks: [
    "empty remote lists preserve local records",
    "shared IDs reconcile by freshness",
    "equal-version conflicts preserve local fields",
    "merged lists use deterministic newest-first ordering",
    "capture metadata uploads require explicit cloud sync"
  ]
}, null, 2));

async function verifyEmptyRemoteListsPreserveLocalData() {
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

function seedLocalState({ captureHistory, watchPlans, watchRuns }) {
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
    [WATCH_RUNS_KEY]: structuredClone(watchRuns)
  };
}
