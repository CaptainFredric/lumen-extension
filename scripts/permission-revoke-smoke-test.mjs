import { createServer } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lumen-permission-revoke-"));
const extensionDir = path.join(tempRoot, "extension");
const profileDir = path.join(tempRoot, "profile");
const runtimeErrors = [];

let context;
let fixtureServer;

try {
  const fixture = await startFixtureServer();
  fixtureServer = fixture.server;
  await prepareExtensionCopy(fixture.originPattern);

  context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`
    ]
  });

  const worker = await getExtensionWorker(context);
  const extensionId = new URL(worker.url()).host;
  const harness = await context.newPage();
  harness.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  harness.on("pageerror", (error) => runtimeErrors.push(error.message));
  await harness.goto(`chrome-extension://${extensionId}/permission-test.html`, { waitUntil: "load" });

  const cleanPermissions = await harness.evaluate(() => chrome.permissions.getAll());
  assert(!(cleanPermissions.origins || []).length, "Clean extension profile started with site access.", cleanPermissions);

  const firstGrant = await requestOriginPermission(harness);
  assert(firstGrant.granted, "The user-gesture permission request was not granted in the test profile.", firstGrant);
  assert(firstGrant.contains, "Chrome did not report the requested origin after granting access.", firstGrant);

  const watchPlan = await harness.evaluate(async (fixtureUrl) => {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_SAVE_WATCH_PLAN",
      payload: {
        title: "Permission lease fixture",
        url: fixtureUrl,
        status: "active",
        selectionMode: "rect",
        region: {
          id: "permission-region",
          kind: "cutaway",
          shape: "rect",
          left: 24,
          top: 32,
          width: 320,
          height: 180,
          sourceViewport: {
            viewportWidth: 1000,
            viewportHeight: 760
          }
        },
        schedule: {
          mode: "repeat",
          intervalMinutes: 60,
          maxRuns: 0
        },
        destination: "local",
        explicitOptIn: true
      }
    });
    const contains = await chrome.permissions.contains({ origins: [window.PERMISSION_ORIGIN] });
    const alarms = await chrome.alarms.getAll();

    return { response, contains, alarms };
  }, fixture.url);

  assert(watchPlan.response?.ok && watchPlan.response.watchPlan?.id, "Timed plan did not save after site access was granted.", watchPlan);
  assert(watchPlan.contains, "Saving a timed plan unexpectedly dropped its site-access lease.", watchPlan);
  assert(watchPlan.alarms.some((alarm) => alarm.name.endsWith(watchPlan.response.watchPlan.id)), "Timed plan did not register its Chrome alarm.", watchPlan);

  const deletedPlan = await harness.evaluate(async (watchPlanId) => {
    const response = await chrome.runtime.sendMessage({
      type: "LUMEN_DELETE_WATCH_PLAN",
      payload: { watchPlanId }
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const contains = await chrome.permissions.contains({ origins: [window.PERMISSION_ORIGIN] });
    const alarms = await chrome.alarms.getAll();
    const state = await chrome.storage.local.get(["lumen.watch.plans", "lumen.watch.runs"]);

    return { response, contains, alarms, state };
  }, watchPlan.response.watchPlan.id);

  assert(deletedPlan.response?.ok, "Deleting the last timed plan failed.", deletedPlan);
  assert(!deletedPlan.contains, "Deleting the last timed plan did not revoke its optional site access.", deletedPlan);
  assert(!deletedPlan.alarms.some((alarm) => alarm.name.endsWith(watchPlan.response.watchPlan.id)), "Deleting a timed plan left its Chrome alarm behind.", deletedPlan);
  assert((deletedPlan.state["lumen.watch.plans"] || []).length === 0, "Deleting the last timed plan left a local plan record.", deletedPlan.state);

  const secondGrant = await requestOriginPermission(harness);
  assert(secondGrant.granted && secondGrant.contains, "Could not restore optional access for the workspace-clear test.", secondGrant);

  await harness.evaluate(async (fixtureUrl) => {
    const planId = "workspace-clear-plan";
    await chrome.storage.local.set({
      "lumen.capture.history": [{ id: "clear-capture", title: "Clear me", url: fixtureUrl }],
      "lumen.watch.plans": [{ id: planId, title: "Clear me", url: fixtureUrl, status: "active" }],
      "lumen.watch.runs": [{ id: "clear-run", watchPlanId: planId, status: "completed" }],
      "lumen.capture.cutawayRegions": {
        [fixtureUrl]: { url: fixtureUrl, region: { id: "clear-region", kind: "cutaway", left: 1, top: 1, width: 100, height: 100 } }
      }
    });
    await chrome.alarms.create(`lumen.watch.${planId}`, { delayInMinutes: 60 });
  }, fixture.url);

  const cleared = await harness.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: "LUMEN_CLEAR_LOCAL_DATA" });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const contains = await chrome.permissions.contains({ origins: [window.PERMISSION_ORIGIN] });
    const alarms = await chrome.alarms.getAll();
    const state = await chrome.storage.local.get([
      "lumen.capture.history",
      "lumen.watch.plans",
      "lumen.watch.runs",
      "lumen.capture.cutawayRegions"
    ]);

    return { response, contains, alarms, state };
  });

  assert(cleared.response?.ok, "Local workspace cleanup failed.", cleared);
  assert(!cleared.contains, "Local workspace cleanup left optional site access granted.", cleared);
  assert(!cleared.alarms.some((alarm) => alarm.name.includes("workspace-clear-plan")), "Local workspace cleanup left a timed alarm behind.", cleared);
  assert((cleared.state["lumen.capture.history"] || []).length === 0, "Local workspace cleanup left capture history.", cleared.state);
  assert((cleared.state["lumen.watch.plans"] || []).length === 0, "Local workspace cleanup left timed plans.", cleared.state);
  assert((cleared.state["lumen.watch.runs"] || []).length === 0, "Local workspace cleanup left timed runs.", cleared.state);
  assert(Object.keys(cleared.state["lumen.capture.cutawayRegions"] || {}).length === 0, "Local workspace cleanup left focused regions.", cleared.state);
  assert(cleared.response.deleted?.permissions >= 1, "Local workspace cleanup did not report its permission revocation.", cleared.response);
  assert(!runtimeErrors.length, "Permission harness emitted runtime errors.", runtimeErrors);

  console.log(JSON.stringify({
    ok: true,
    initialOrigins: cleanPermissions.origins || [],
    permissionGrant: {
      granted: firstGrant.granted,
      origin: fixture.originPattern
    },
    lastPlanDeletion: {
      permissionRevoked: !deletedPlan.contains,
      alarmCleared: !deletedPlan.alarms.some((alarm) => alarm.name.endsWith(watchPlan.response.watchPlan.id))
    },
    workspaceClear: {
      permissionRevoked: !cleared.contains,
      revokedPermissionCount: cleared.response.deleted.permissions,
      downloadsRemain: cleared.response.downloadsRemain
    }
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    details: error.details || null,
    runtimeErrors
  }, null, 2));
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await new Promise((resolve) => fixtureServer?.close(resolve) || resolve());
  await rm(tempRoot, { recursive: true, force: true });
}

async function requestOriginPermission(harness) {
  await harness.evaluate(() => {
    document.body.dataset.permissionResult = "pending";
  });
  await harness.click("#requestPermissionButton");
  await harness.waitForFunction(() => document.body.dataset.permissionResult !== "pending", null, { timeout: 10000 });

  return harness.evaluate(async () => ({
    granted: document.body.dataset.permissionResult === "granted",
    error: document.body.dataset.permissionError || "",
    contains: await chrome.permissions.contains({ origins: [window.PERMISSION_ORIGIN] }),
    permissions: await chrome.permissions.getAll()
  }));
}

async function prepareExtensionCopy(originPattern) {
  await cp(repoRoot, extensionDir, {
    recursive: true,
    filter(source) {
      const relative = path.relative(repoRoot, source);
      const parts = relative.split(path.sep);

      return !parts.includes(".git") &&
        !parts.includes("node_modules") &&
        !parts.includes("dist") &&
        !parts.includes("store-assets") &&
        !parts.includes(".DS_Store");
    }
  });

  const manifestPath = path.join(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(!manifest.host_permissions?.length, "Source manifest should not have always-on host access.", manifest);
  assert((manifest.optional_host_permissions || []).includes("http://*/*"), "Source manifest lost its optional HTTP host declaration.", manifest);

  await writeFile(path.join(extensionDir, "permission-test.html"), `<!doctype html>
    <html>
      <head><meta charset="utf-8" /><title>Lumen permission test</title></head>
      <body data-permission-result="idle">
        <button id="requestPermissionButton" type="button">Grant fixture access</button>
        <script src="permission-test.js"></script>
      </body>
    </html>`);
  await writeFile(path.join(extensionDir, "permission-test.js"), `
    window.PERMISSION_ORIGIN = ${JSON.stringify(originPattern)};
    document.querySelector("#requestPermissionButton").addEventListener("click", async () => {
      document.body.dataset.permissionError = "";
      try {
        const granted = await chrome.permissions.request({ origins: [window.PERMISSION_ORIGIN] });
        document.body.dataset.permissionResult = granted ? "granted" : "denied";
      } catch (error) {
        document.body.dataset.permissionResult = "error";
        document.body.dataset.permissionError = error?.message || String(error);
      }
    });
  `);
}

async function getExtensionWorker(browserContext) {
  let [worker] = browserContext.serviceWorkers();

  if (!worker) {
    worker = await browserContext.waitForEvent("serviceworker", { timeout: 10000 });
  }

  return worker;
}

async function startFixtureServer() {
  const server = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><head><title>Permission fixture</title></head><body><main><h1>Permission fixture</h1></main></body></html>");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  return {
    server,
    url: `http://127.0.0.1:${address.port}/review`,
    originPattern: `http://127.0.0.1:${address.port}/*`
  };
}

function assert(condition, message, details = null) {
  if (condition) {
    return;
  }

  const error = new Error(message);
  error.details = details;
  throw error;
}
