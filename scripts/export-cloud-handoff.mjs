import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const distDir = path.join(repoRoot, "dist");
const includePrivateBackendData = process.argv.includes("--include-private-backend-data");
const createdAt = new Date().toISOString();
const dateSlug = createdAt.slice(0, 10);
const zipName = `lumen-cloud-handoff-${dateSlug}.zip`;
const zipPath = path.join(distDir, zipName);
const stagingRoot = path.join(os.tmpdir(), `lumen-cloud-handoff-${process.pid}`);

try {
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  await mkdir(distDir, { recursive: true });

  const [{ stdout: trackedFilesRaw }, commit, remoteUrl] = await Promise.all([
    execFileAsync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "buffer" }),
    readGitValue(["rev-parse", "--short=12", "HEAD"]),
    readGitValue(["config", "--get", "remote.origin.url"])
  ]);

  const trackedFiles = trackedFilesRaw
    .toString("utf8")
    .split("\0")
    .filter(Boolean);

  for (const file of trackedFiles) {
    await copyTrackedFile(file);
  }

  await writeHandoffManifest({
    commit,
    remoteUrl,
    trackedFileCount: trackedFiles.length
  });
  await writeBackendDataSnapshot();

  await rm(zipPath, { force: true });
  await execFileAsync("zip", ["-qr", zipPath, "."], { cwd: stagingRoot });

  const zipStats = await stat(zipPath);
  console.log(JSON.stringify({
    ok: true,
    zip: {
      path: zipPath,
      bytes: zipStats.size,
      megabytes: Number((zipStats.size / 1024 / 1024).toFixed(2))
    },
    commit,
    remoteUrl,
    includePrivateBackendData
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    message: error.message
  }, null, 2));
  process.exitCode = 1;
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}

async function readGitValue(args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repoRoot,
    encoding: "utf8"
  });

  return stdout.trim();
}

async function copyTrackedFile(file) {
  const source = path.join(repoRoot, file);
  const target = path.join(stagingRoot, file);

  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
}

async function writeHandoffManifest({ commit, remoteUrl, trackedFileCount }) {
  const manifest = {
    project: "Lumen",
    createdAt,
    commit,
    remoteUrl,
    publicSite: "https://captainfredric.github.io/lumen-extension/",
    trackedFileCount,
    privateBackendDataIncluded: includePrivateBackendData,
    restore: {
      install: "npm install",
      checks: ["npm run check", "npm run smoke:backend", "npm run smoke:extension"],
      backend: "npm run api",
      site: "npm run site"
    }
  };

  const target = path.join(stagingRoot, "handoff-data", "handoff-manifest.json");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function writeBackendDataSnapshot() {
  const source = path.join(repoRoot, "backend", "data", "store.json");

  try {
    await stat(source);
  } catch {
    return;
  }

  const raw = JSON.parse(await readFile(source, "utf8"));
  const targetDir = path.join(stagingRoot, "handoff-data");
  await mkdir(targetDir, { recursive: true });
  await writeFile(
    path.join(targetDir, "backend-store.sanitized.json"),
    `${JSON.stringify(sanitizeBackendStore(raw), null, 2)}\n`
  );

  if (includePrivateBackendData) {
    await writeFile(
      path.join(targetDir, "backend-store.private.json"),
      `${JSON.stringify(raw, null, 2)}\n`
    );
  }
}

function sanitizeBackendStore(store = {}) {
  const sessionMap = new Map();
  const sessions = Array.isArray(store.sessions)
    ? store.sessions.map((session, index) => {
        const id = `session-${String(index + 1).padStart(3, "0")}`;
        sessionMap.set(session.id, id);

        return {
          id,
          plan: session.plan || "free",
          user: {
            name: `Lumen User ${index + 1}`,
            email: `demo+${index + 1}@lumen.local`
          },
          createdAt: session.createdAt || new Date(0).toISOString(),
          updatedAt: session.updatedAt || session.createdAt || new Date(0).toISOString()
        };
      })
    : [];

  return {
    sessions,
    captures: sanitizeRecords(store.captures, sessionMap, sanitizeCapture),
    watchPlans: sanitizeRecords(store.watchPlans, sessionMap, sanitizeWatchPlan),
    agentJobs: sanitizeRecords(store.agentJobs, sessionMap, sanitizeAgentJob),
    dataControls: sanitizeRecords(store.dataControls, sessionMap, sanitizeDataControls),
    integrations: Array.isArray(store.integrations) ? store.integrations : []
  };
}

function sanitizeRecords(records, sessionMap, mapper) {
  return Array.isArray(records)
    ? records.map((record, index) => mapper(record, index, sessionMap))
    : [];
}

function sanitizeCapture(capture, index, sessionMap) {
  return {
    ...capture,
    id: `capture-${String(index + 1).padStart(3, "0")}`,
    sessionId: sessionMap.get(capture.sessionId) || "session-unknown",
    title: `Sanitized capture ${index + 1}`,
    host: "example.com",
    url: "https://example.com/",
    archiveFolder: `Lumen/sanitized/capture-${index + 1}`,
    files: Array.isArray(capture.files) ? capture.files.map((_, fileIndex) => `Lumen/sanitized/artifact-${index + 1}-${fileIndex + 1}`) : [],
    downloads: [],
    blueprintSummary: capture.blueprintSummary ? {
      siteType: "Sanitized page",
      heroHeadline: "Sanitized headline",
      primaryCta: "Sanitized CTA"
    } : null
  };
}

function sanitizeWatchPlan(plan, index, sessionMap) {
  return {
    ...plan,
    id: `watch-${String(index + 1).padStart(3, "0")}`,
    sessionId: sessionMap.get(plan.sessionId) || "session-unknown",
    title: `Sanitized watch ${index + 1}`,
    host: "example.com",
    url: "https://example.com/"
  };
}

function sanitizeAgentJob(job, index, sessionMap) {
  return {
    ...job,
    id: `agent-${String(index + 1).padStart(3, "0")}`,
    sessionId: sessionMap.get(job.sessionId) || "session-unknown",
    payloadPreview: {},
    result: null,
    error: ""
  };
}

function sanitizeDataControls(controls, index, sessionMap) {
  return {
    ...controls,
    sessionId: sessionMap.get(controls.sessionId) || `session-${String(index + 1).padStart(3, "0")}`
  };
}
