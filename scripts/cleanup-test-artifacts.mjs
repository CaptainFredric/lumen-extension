import { readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDir = os.tmpdir();
const exactPaths = [
  path.join(tempDir, "lumen-docs-check.html"),
  path.join(tempDir, "lumen-popup-hold-menu.png"),
  path.join(tempDir, "lumen-popup-hold-menu-tight.png"),
  path.join(tempDir, "lumen-popup-hold-menu-top.png")
];
const tempPrefixes = [
  "lumen-extension-smoke-",
  "lumen-extension-e2e-",
  "lumen-real-site-capture-",
  "lumen-popup-shot-"
];
const screenshotPattern = /^lumen-popup-.*\.png$/;
const removed = [];

for (const targetPath of exactPaths) {
  await removeIfPresent(targetPath);
}

const entries = await readdir(tempDir, { withFileTypes: true });

for (const entry of entries) {
  const shouldRemove =
    tempPrefixes.some((prefix) => entry.name.startsWith(prefix)) ||
    screenshotPattern.test(entry.name);

  if (shouldRemove) {
    await removeIfPresent(path.join(tempDir, entry.name));
  }
}

console.log(JSON.stringify({
  ok: true,
  tempDir,
  removedCount: removed.length,
  removed
}, null, 2));

async function removeIfPresent(targetPath) {
  if (!(await pathExists(targetPath))) {
    return;
  }

  await rm(targetPath, { recursive: true, force: true });

  if (await pathExists(targetPath)) {
    throw new Error(`Temporary artifact still exists after cleanup: ${targetPath}`);
  }

  removed.push(path.relative(tempDir, targetPath));
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
