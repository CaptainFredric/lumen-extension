import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "lumen-backend-smoke-"));
const port = 19000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["backend/server.mjs"], {
  cwd: path.resolve(new URL("..", import.meta.url).pathname),
  env: {
    ...process.env,
    LUMEN_API_PORT: String(port),
    LUMEN_API_DATA_DIR: tempDir
  },
  stdio: ["ignore", "pipe", "pipe"]
});

const stderr = [];
server.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

try {
  await waitForServerReady(server, baseUrl);

  const health = await requestJson("/health");
  assert(health.status === 200 && health.body.ok, "Health endpoint did not return ok.", health);

  const freeDemo = await requestJson("/v1/session/demo", {
    method: "POST",
    body: {
      name: "Backend Smoke Free",
      email: "free-smoke@lumen.test",
      plan: "free"
    }
  });
  assert(freeDemo.status === 200 && freeDemo.body.session?.id, "Free demo session did not initialize.", freeDemo);
  assert(
    freeDemo.body.session.entitlements?.features?.regionWatch?.available === false,
    "Free session should lock region watch.",
    freeDemo
  );

  const freeSessionId = freeDemo.body.session.id;
  const freeEntitlements = await requestJson("/v1/entitlements", { sessionId: freeSessionId });
  assert(
    freeEntitlements.status === 200 &&
      freeEntitlements.body.entitlements?.features?.autoRedact?.available === false,
    "Free entitlements endpoint did not return locked advanced features.",
    freeEntitlements
  );

  const rejectedFreeCloudSync = await requestJson("/v1/data-controls", {
    method: "PATCH",
    sessionId: freeSessionId,
    body: {
      cloudSyncEnabled: true
    }
  });
  assert(rejectedFreeCloudSync.status === 402, "Free plan should reject cloud sync controls.", rejectedFreeCloudSync);

  const rejectedPaidWatchPlan = await requestJson("/v1/watch-plans", {
    method: "POST",
    sessionId: freeSessionId,
    body: {
      explicitOptIn: true,
      title: "Locked watch",
      url: "https://example.com/pricing",
      status: "active",
      region: {
        left: 100,
        top: 220,
        width: 640,
        height: 320
      }
    }
  });
  assert(rejectedPaidWatchPlan.status === 402, "Free plan should reject paid watch records.", rejectedPaidWatchPlan);

  const rejectedPaidAgentJob = await requestJson("/v1/agent-jobs", {
    method: "POST",
    sessionId: freeSessionId,
    body: {
      explicitOptIn: true,
      payloadReviewed: true,
      task: "summarize-capture"
    }
  });
  assert(rejectedPaidAgentJob.status === 402, "Free plan should reject paid agent records.", rejectedPaidAgentJob);

  const rejectedFreeDestination = await requestJson("/v1/destinations", {
    method: "POST",
    sessionId: freeSessionId,
    body: {
      explicitOptIn: true,
      type: "webhook",
      label: "Free webhook",
      endpointUrl: "https://hooks.example.com/lumen"
    }
  });
  assert(rejectedFreeDestination.status === 402, "Free plan should reject connected destinations.", rejectedFreeDestination);

  const demo = await requestJson("/v1/session/demo", {
    method: "POST",
    body: {
      name: "Backend Smoke Team",
      email: "smoke@lumen.test",
      plan: "team"
    }
  });
  assert(demo.status === 200 && demo.body.session?.id, "Demo session did not initialize.", demo);
  assert(
    demo.body.session.entitlements?.features?.regionWatch?.available === true,
    "Team session should unlock paid workflow records.",
    demo
  );

  const sessionId = demo.body.session.id;
  const readiness = await requestJson("/v1/product-readiness", { sessionId });
  assert(
    readiness.status === 200 && readiness.body.readiness?.some((item) => item.id === "team-automation"),
    "Product readiness endpoint did not describe automation coverage.",
    readiness
  );

  const defaultDataControls = await requestJson("/v1/data-controls", { sessionId });
  assert(
    defaultDataControls.status === 200 && defaultDataControls.body.dataControls?.retentionDays === 90,
    "Default data controls did not load.",
    defaultDataControls
  );

  const updatedDataControls = await requestJson("/v1/data-controls", {
    method: "PATCH",
    sessionId,
    body: {
      retentionDays: 30,
      cloudSyncEnabled: true
    }
  });
  assert(
    updatedDataControls.status === 200 &&
      updatedDataControls.body.dataControls.retentionDays === 30 &&
      updatedDataControls.body.dataControls.cloudSyncEnabled === true,
    "Data controls were not updated for the team plan.",
    updatedDataControls
  );

  const capturePayload = {
    id: "capture-smoke-001",
    title: "Backend Smoke Capture",
    url: "https://example.com/pricing",
    host: "example.com",
    devicePreset: "responsive",
    exportPreset: "raw",
    capturedAt: "2026-05-11T04:00:00.000Z",
    archiveFolder: "Lumen/2026-05-11/backend-smoke",
    files: [
      "Lumen/2026-05-11/backend-smoke/desktop.png",
      "Lumen/2026-05-11/backend-smoke/bundle.json"
    ],
    downloads: [
      {
        downloadId: 10,
        filename: "desktop.png",
        bytesReceived: 120000,
        kind: "image",
        variantId: "desktop"
      },
      {
        downloadId: 11,
        filename: "bundle.json",
        bytesReceived: 4000,
        kind: "manifest"
      }
    ],
    redactionCount: 3,
    manualRedactionCount: 1,
    artifactStats: {
      complete: true,
      imageCount: 1,
      bytesReceived: 124000
    }
  };
  const createdCapture = await requestJson("/v1/captures", {
    method: "POST",
    sessionId,
    body: capturePayload
  });
  assert(createdCapture.status === 201, "Capture was not created.", createdCapture);

  const captureList = await requestJson("/v1/captures", { sessionId });
  assert(captureList.body.captures?.length === 1, "Capture list did not return the created capture.", captureList);
  assert(!("sessionId" in captureList.body.captures[0]), "Capture response leaked sessionId.", captureList);

  const captureDetail = await requestJson("/v1/captures/capture-smoke-001", { sessionId });
  assert(captureDetail.status === 200 && captureDetail.body.capture.title === "Backend Smoke Capture", "Capture detail failed.", captureDetail);

  const destination = await requestJson("/v1/destinations", {
    method: "POST",
    sessionId,
    body: {
      explicitOptIn: true,
      type: "webhook",
      label: "Review channel",
      endpointUrl: "https://hooks.example.com/lumen-review",
      deliveryMode: "manual",
      includeImages: true,
      includeManifest: true
    }
  });
  assert(destination.status === 201 && destination.body.destination?.id, "Destination was not created.", destination);

  const delivery = await requestJson("/v1/deliveries", {
    method: "POST",
    sessionId,
    body: {
      explicitOptIn: true,
      payloadReviewed: true,
      destinationId: destination.body.destination.id,
      captureId: "capture-smoke-001",
      files: capturePayload.files,
      payloadSummary: {
        fileCount: capturePayload.files.length,
        redactionCount: capturePayload.redactionCount
      }
    }
  });
  assert(delivery.status === 201 && delivery.body.delivery?.status === "queued", "Delivery was not queued.", delivery);

  const rejectedWatchPlan = await requestJson("/v1/watch-plans", {
    method: "POST",
    sessionId,
    body: {
      title: "Unapproved watch",
      url: "https://example.com/pricing",
      status: "active",
      region: {
        left: 100,
        top: 220,
        width: 640,
        height: 320
      }
    }
  });
  assert(rejectedWatchPlan.status === 400, "Watch plan should require explicit opt-in.", rejectedWatchPlan);

  const watchPlan = await requestJson("/v1/watch-plans", {
    method: "POST",
    sessionId,
    body: {
      explicitOptIn: true,
      title: "Pricing card watch",
      url: "https://example.com/pricing",
      status: "active",
      selectionMode: "lasso",
      region: {
        id: "region-001",
        shape: "lasso",
        left: 100,
        top: 220,
        width: 640,
        height: 320,
        points: [
          { x: 120, y: 240 },
          { x: 720, y: 260 },
          { x: 700, y: 520 },
          { x: 110, y: 500 }
        ]
      },
      schedule: {
        intervalMinutes: 60
      }
    }
  });
  assert(watchPlan.status === 201 && watchPlan.body.watchPlan?.id, "Watch plan was not created.", watchPlan);
  assert(
    watchPlan.body.watchPlan.selectionMode === "lasso" &&
      watchPlan.body.watchPlan.region?.shape === "lasso" &&
      watchPlan.body.watchPlan.region?.points?.length === 4,
    "Watch plan did not preserve lasso selection metadata.",
    watchPlan
  );

  const updatedWatchPlan = await requestJson(`/v1/watch-plans/${watchPlan.body.watchPlan.id}`, {
    method: "PATCH",
    sessionId,
    body: {
      status: "paused",
      destination: "local"
    }
  });
  assert(updatedWatchPlan.body.watchPlan.status === "paused", "Watch plan was not patched.", updatedWatchPlan);

  const watchRun = await requestJson("/v1/watch-runs", {
    method: "POST",
    sessionId,
    body: {
      id: "watch-run-smoke-001",
      watchPlanId: watchPlan.body.watchPlan.id,
      captureId: "capture-smoke-001",
      title: "Pricing card watch",
      url: "https://example.com/pricing",
      status: "captured",
      fileCount: 2,
      files: ["pricing-desktop.png", "pricing-print-sheet.html"]
    }
  });
  assert(watchRun.status === 201 && watchRun.body.watchRun.status === "captured", "Watch run was not stored.", watchRun);

  const agentJob = await requestJson("/v1/agent-jobs", {
    method: "POST",
    sessionId,
    body: {
      explicitOptIn: true,
      payloadReviewed: true,
      task: "summarize-capture",
      captureId: "capture-smoke-001",
      watchPlanId: watchPlan.body.watchPlan.id,
      payloadPreview: {
        redactions: 3,
        files: 2
      }
    }
  });
  assert(agentJob.status === 201 && agentJob.body.agentJob.status === "queued", "Agent job was not queued.", agentJob);

  const completedAgentJob = await requestJson(`/v1/agent-jobs/${agentJob.body.agentJob.id}`, {
    method: "PATCH",
    sessionId,
    body: {
      status: "done",
      result: {
        summary: "Capture ready for review."
      }
    }
  });
  assert(completedAgentJob.body.agentJob.status === "done", "Agent job was not updated.", completedAgentJob);

  const stats = await requestJson("/v1/stats", { sessionId });
  assert(stats.body.stats.captureCount === 1, "Stats did not count captures.", stats);
  assert(stats.body.stats.watchPlanCount === 1, "Stats did not count watch plans.", stats);
  assert(stats.body.stats.watchRunCount === 1, "Stats did not count watch runs.", stats);
  assert(stats.body.stats.agentJobCount === 1, "Stats did not count agent jobs.", stats);
  assert(stats.body.stats.destinationCount === 1, "Stats did not count destinations.", stats);
  assert(stats.body.stats.deliveryCount === 1, "Stats did not count deliveries.", stats);
  assert(stats.body.stats.bytesReceived === 124000, "Stats did not sum download bytes.", stats);

  const integrations = await requestJson("/v1/integrations");
  assert(integrations.body.integrations?.some((item) => item.id === "agent-chat"), "Integrations did not include agent handoff.", integrations);

  const invalidSession = await requestJson("/v1/captures", {
    sessionId: "missing-session"
  });
  assert(invalidSession.status === 401, "Invalid session should be rejected.", invalidSession);

  const rejectedAccountDataDelete = await requestJson("/v1/account-data", {
    method: "DELETE",
    sessionId
  });
  assert(
    rejectedAccountDataDelete.status === 400,
    "Account data delete should require confirmation.",
    rejectedAccountDataDelete
  );

  const deletedAccountData = await requestJson("/v1/account-data", {
    method: "DELETE",
    sessionId,
    body: {
      confirmation: "DELETE LUMEN DATA"
    }
  });
  assert(
    deletedAccountData.status === 200 &&
      deletedAccountData.body.deleted.captures === 1 &&
      deletedAccountData.body.deleted.watchPlans === 1 &&
      deletedAccountData.body.deleted.watchRuns === 1 &&
      deletedAccountData.body.deleted.agentJobs === 1 &&
      deletedAccountData.body.deleted.destinations === 1 &&
      deletedAccountData.body.deleted.deliveries === 1,
    "Account data delete did not remove session records.",
    deletedAccountData
  );

  const postDeleteStats = await requestJson("/v1/stats", { sessionId });
  assert(postDeleteStats.body.stats.captureCount === 0, "Post-delete stats still count captures.", postDeleteStats);
  assert(postDeleteStats.body.stats.watchPlanCount === 0, "Post-delete stats still count watch plans.", postDeleteStats);
  assert(postDeleteStats.body.stats.watchRunCount === 0, "Post-delete stats still count watch runs.", postDeleteStats);
  assert(postDeleteStats.body.stats.agentJobCount === 0, "Post-delete stats still count agent jobs.", postDeleteStats);
  assert(postDeleteStats.body.stats.destinationCount === 0, "Post-delete stats still count destinations.", postDeleteStats);
  assert(postDeleteStats.body.stats.deliveryCount === 0, "Post-delete stats still count deliveries.", postDeleteStats);

  const concurrentDemo = await requestJson("/v1/session/demo", {
    method: "POST",
    body: {
      name: "Backend Concurrency Smoke",
      email: "concurrency-smoke@lumen.test",
      plan: "team"
    }
  });
  assert(
    concurrentDemo.status === 200 && concurrentDemo.body.session?.id,
    "Concurrency smoke session did not initialize.",
    concurrentDemo
  );

  const concurrentSessionId = concurrentDemo.body.session.id;
  const concurrentCaptureCount = 40;
  const concurrentCaptureIds = Array.from(
    { length: concurrentCaptureCount },
    (_, index) => `capture-concurrent-${String(index + 1).padStart(3, "0")}`
  );
  const concurrentCreates = await Promise.all(concurrentCaptureIds.map((id, index) => requestJson("/v1/captures", {
    method: "POST",
    sessionId: concurrentSessionId,
    body: {
      id,
      title: `Concurrent capture ${index + 1}`,
      url: `https://example.com/concurrency/${index + 1}`,
      capturedAt: new Date(Date.UTC(2026, 4, 11, 5, index)).toISOString()
    }
  })));
  const failedConcurrentCreates = concurrentCreates
    .map((result, index) => ({ id: concurrentCaptureIds[index], ...result }))
    .filter((result) => result.status !== 201);
  assert(
    failedConcurrentCreates.length === 0,
    "Concurrent capture writes did not all succeed.",
    failedConcurrentCreates
  );

  const concurrentCaptureList = await requestJson("/v1/captures?limit=200", {
    sessionId: concurrentSessionId
  });
  const storedConcurrentIds = new Set(
    (concurrentCaptureList.body.captures || []).map((capture) => capture.id)
  );
  const missingConcurrentIds = concurrentCaptureIds.filter((id) => !storedConcurrentIds.has(id));
  assert(
    concurrentCaptureList.status === 200 &&
      concurrentCaptureList.body.captures?.length === concurrentCaptureCount &&
      missingConcurrentIds.length === 0,
    "Concurrent capture writes did not all survive the read-modify-write cycle.",
    {
      expected: concurrentCaptureCount,
      actual: concurrentCaptureList.body.captures?.length || 0,
      missingConcurrentIds
    }
  );

  const deletedConcurrentData = await requestJson("/v1/account-data", {
    method: "DELETE",
    sessionId: concurrentSessionId,
    body: {
      confirmation: "DELETE LUMEN DATA"
    }
  });
  assert(
    deletedConcurrentData.status === 200 && deletedConcurrentData.body.deleted.captures === concurrentCaptureCount,
    "Concurrency smoke cleanup did not remove every capture.",
    deletedConcurrentData
  );

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    checks: {
      session: sessionId,
      capture: createdCapture.body.capture.id,
      destination: destination.body.destination.id,
      delivery: delivery.body.delivery.id,
      watchPlan: watchPlan.body.watchPlan.id,
      watchRun: watchRun.body.watchRun.id,
      agentJob: agentJob.body.agentJob.id,
      concurrentCaptures: concurrentCaptureCount,
      stats: stats.body.stats,
      deleted: deletedAccountData.body.deleted
    }
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    details: error.details || null,
    stderr: stderr.join("")
  }, null, 2));
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => server.once("exit", resolve));
  await cleanupTemporaryPath(tempDir);
}

async function requestJson(pathname, { method = "GET", sessionId = "", body } = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(sessionId ? { "X-Lumen-Session": sessionId } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();

  return {
    status: response.status,
    body: text ? JSON.parse(text) : null
  };
}

async function waitForServerReady(child, origin) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10000) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before it became ready: ${stderr.join("")}`);
    }

    try {
      const response = await fetch(new URL("/health", origin));

      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  throw new Error("Timed out waiting for backend server.");
}

function assert(condition, message, details = null) {
  if (condition) {
    return;
  }

  const error = new Error(message);
  error.details = details;
  throw error;
}

async function cleanupTemporaryPath(targetPath) {
  try {
    await rm(targetPath, { recursive: true, force: true });

    if (await pathExists(targetPath)) {
      throw new Error(`${targetPath} still exists after cleanup.`);
    }
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      cleanupFailed: true,
      path: targetPath,
      message: error.message
    }, null, 2));
    process.exitCode = 1;
  }
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}
