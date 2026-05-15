import { execFile } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const distDir = path.join(repoRoot, "dist");
const stagingDir = path.join(distDir, "extension-package");
const publicHomepageUrl = "https://captainfredric.github.io/lumen-extension/";

const requiredRuntimeFiles = [
  "manifest.json",
  "background.js",
  "content.js",
  "config.js",
  "entitlements.js",
  "lumen-backend.js",
  "offscreen.html",
  "offscreen.js",
  "popup.css",
  "popup.html",
  "popup.js"
];

const requiredIconFiles = [
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "icons/icon-512.png"
];

const blockedPathParts = new Set([
  ".git",
  ".github",
  "assets",
  "backend",
  "build",
  "captures",
  "coverage",
  "design-review",
  "dist",
  "docs",
  "node_modules",
  "scripts",
  "screenshots"
]);

const blockedRootFiles = new Set([
  ".env",
  ".env.local",
  "package-lock.json",
  "package.json",
  "README.md",
  "STORE_READINESS.md",
  "PRODUCT_ROADMAP.md"
]);

try {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "manifest.json"), "utf8"));
  const zipName = `lumen-extension-${manifest.version}.zip`;
  const zipPath = path.join(distDir, zipName);

  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  await copyRuntimeFiles();

  const validation = await validatePackage({ manifest, zipPath });

  await rm(zipPath, { force: true });
  await execFileAsync("zip", ["-qr", zipPath, "."], { cwd: stagingDir });

  const zipStats = await stat(zipPath);
  validation.zip = {
    path: zipPath,
    bytes: zipStats.size,
    megabytes: Number((zipStats.size / 1024 / 1024).toFixed(2))
  };

  if (zipStats.size <= 0) {
    validation.errors.push("Package ZIP was created with zero bytes.");
  }

  validation.ready = validation.errors.length === 0;
  await rm(stagingDir, { recursive: true, force: true });

  console.log(JSON.stringify(validation, null, 2));

  if (!validation.ready) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({
    ready: false,
    error: error.message
  }, null, 2));
  process.exitCode = 1;
}

async function copyRuntimeFiles() {
  for (const file of [...requiredRuntimeFiles, ...requiredIconFiles]) {
    const source = path.join(repoRoot, file);
    const target = path.join(stagingDir, file);

    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target);
  }
}

async function validatePackage({ manifest, zipPath }) {
  const errors = [];
  const warnings = [];
  const files = await listFiles(stagingDir);

  validateManifest(manifest, errors, warnings);
  await validateRequiredFiles(errors);
  await validateIcons(manifest, errors, warnings);
  validateBlockedFiles(files, errors);

  return {
    ready: false,
    name: manifest.name,
    version: manifest.version,
    manifestVersion: manifest.manifest_version,
    homepageUrl: manifest.homepage_url || "",
    zip: {
      path: zipPath,
      bytes: 0,
      megabytes: 0
    },
    fileCount: files.length,
    runtimeFiles: files,
    permissions: manifest.permissions || [],
    optionalHostPermissions: manifest.optional_host_permissions || [],
    errors,
    warnings
  };
}

function validateManifest(manifest, errors, warnings) {
  if (manifest.manifest_version !== 3) {
    errors.push("Manifest must use manifest_version 3.");
  }

  if (!manifest.name || manifest.name.length > 45) {
    errors.push("Manifest name is missing or too long.");
  }

  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version || "")) {
    errors.push("Manifest version must use Chrome extension numeric version format.");
  }

  if (!manifest.description || manifest.description.length > 132) {
    errors.push("Manifest description is missing or longer than 132 characters.");
  }

  if (manifest.homepage_url !== publicHomepageUrl) {
    errors.push("Manifest homepage_url should point to the public Lumen site.");
  }

  if (!manifest.background?.service_worker) {
    errors.push("Manifest background service worker is missing.");
  }

  if (manifest.background?.type !== "module") {
    errors.push("Background service worker should be declared as a module.");
  }

  if (!manifest.action?.default_popup) {
    errors.push("Manifest action.default_popup is missing.");
  }

  if (Array.isArray(manifest.host_permissions) && manifest.host_permissions.length) {
    errors.push("Manifest should not request broad host_permissions for the current activeTab posture.");
  }

  const allowedPermissions = new Set(["activeTab", "downloads", "offscreen", "scripting", "storage"]);
  const unexpectedPermissions = (manifest.permissions || []).filter((permission) => !allowedPermissions.has(permission));

  if (unexpectedPermissions.length) {
    errors.push(`Unexpected permissions: ${unexpectedPermissions.join(", ")}.`);
  }

  if ((manifest.optional_host_permissions || []).some((permission) => !/^https?:\/\/\*\/\*$/.test(permission))) {
    errors.push("Optional host permissions should stay limited to http://*/* and https://*/*.");
  }

  if (!manifest.minimum_chrome_version) {
    warnings.push("minimum_chrome_version is not declared.");
  }
}

async function validateRequiredFiles(errors) {
  for (const file of [...requiredRuntimeFiles, ...requiredIconFiles]) {
    try {
      const fileStats = await stat(path.join(stagingDir, file));

      if (!fileStats.isFile() || fileStats.size <= 0) {
        errors.push(`Required package file is empty: ${file}.`);
      }
    } catch {
      errors.push(`Required package file is missing: ${file}.`);
    }
  }
}

async function validateIcons(manifest, errors, warnings) {
  const declaredIcons = manifest.icons || {};

  for (const [size, iconPath] of Object.entries(declaredIcons)) {
    const fullPath = path.join(stagingDir, iconPath);

    try {
      const icon = await readPngDimensions(fullPath);
      const expectedSize = Number(size);

      if (icon.width !== expectedSize || icon.height !== expectedSize) {
        errors.push(`Icon ${iconPath} is ${icon.width}x${icon.height}, expected ${expectedSize}x${expectedSize}.`);
      }
    } catch (error) {
      errors.push(`Icon ${iconPath} could not be read: ${error.message}`);
    }
  }

  if (!declaredIcons["128"]) {
    errors.push("Manifest must declare a 128px icon.");
  }
}

function validateBlockedFiles(files, errors) {
  for (const file of files) {
    const parts = file.split("/");

    if (parts.some((part) => blockedPathParts.has(part))) {
      errors.push(`Blocked development path included in package: ${file}.`);
    }

    if (blockedRootFiles.has(file)) {
      errors.push(`Blocked root file included in package: ${file}.`);
    }

    if (/\.(zip|crx|log|map)$/i.test(file)) {
      errors.push(`Blocked generated file type included in package: ${file}.`);
    }
  }
}

async function readPngDimensions(filePath) {
  const file = await readFile(filePath);
  const signature = file.subarray(0, 8).toString("hex");

  if (signature !== "89504e470d0a1a0a") {
    throw new Error("not a PNG file");
  }

  return {
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20)
  };
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push(...await listFiles(directory, relative));
      continue;
    }

    if (entry.isFile()) {
      files.push(relative);
    }
  }

  return files.sort();
}
