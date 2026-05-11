import { readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDirs = uniqueExistingTempDirs([
  os.tmpdir(),
  "/tmp"
]);
const exactNames = [
  "lumen-docs-check.html",
  "lumen-runs.json",
  "lumen-popup-hold-menu.png",
  "lumen-popup-hold-menu-tight.png",
  "lumen-popup-hold-menu-top.png"
];
const tempPrefixes = [
  "lumen-extension-smoke-",
  "lumen-extension-e2e-",
  "lumen-real-site-capture-",
  "lumen-popup-shot-"
];
const screenshotPattern = /^lumen-popup-.*\.png$/;
const liveCheckPattern = /^lumen-live-.*\.(html|headers)$/;
const removed = [];

for (const tempDir of tempDirs) {
  for (const name of exactNames) {
    await removeIfPresent(path.join(tempDir, name));
  }

  const entries = await readdir(tempDir, { withFileTypes: true });

  for (const entry of entries) {
    const shouldRemove =
      tempPrefixes.some((prefix) => entry.name.startsWith(prefix)) ||
      screenshotPattern.test(entry.name) ||
      liveCheckPattern.test(entry.name);

    if (shouldRemove) {
      await removeIfPresent(path.join(tempDir, entry.name));
    }
  }
}

console.log(JSON.stringify({
  ok: true,
  tempDirs,
  removedCount: removed.length,
  removed
}, null, 2));

function uniqueExistingTempDirs(values) {
  return [...new Set(values.map((value) => path.resolve(value)))];
}

async function removeIfPresent(targetPath) {
  if (!(await pathExists(targetPath))) {
    return;
  }

  await rm(targetPath, { recursive: true, force: true });

  if (await pathExists(targetPath)) {
    throw new Error(`Temporary artifact still exists after cleanup: ${targetPath}`);
  }

  removed.push(targetPath);
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
