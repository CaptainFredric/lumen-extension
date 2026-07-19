import { isLocalOnlyMode } from "./settings-store.js";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_API_ORIGIN = "https://www.googleapis.com/*";
const DRIVE_CONTENT_API_ORIGIN = "https://content.googleapis.com/*";
const DRIVE_API_ORIGINS = Object.freeze([
  DRIVE_API_ORIGIN,
  DRIVE_CONTENT_API_ORIGIN
]);
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,createdTime";
const DRIVE_RESUMABLE_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink,createdTime";
const MULTIPART_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;

export const DRIVE_EXPORT_CONFIG = Object.freeze({
  scope: DRIVE_SCOPE,
  origin: DRIVE_API_ORIGIN,
  origins: DRIVE_API_ORIGINS,
  uploadUrl: DRIVE_UPLOAD_URL
});

export function readDriveOAuthConfiguration(manifest = readRuntimeManifest()) {
  const clientId = typeof manifest?.oauth2?.client_id === "string"
    ? manifest.oauth2.client_id.trim()
    : "";
  const scopes = Array.isArray(manifest?.oauth2?.scopes)
    ? manifest.oauth2.scopes.filter((scope) => typeof scope === "string")
    : [];
  const placeholder = !clientId || /YOUR_|PLACEHOLDER|LUMEN_GOOGLE_DRIVE_CLIENT_ID/i.test(clientId);

  return {
    configured: !placeholder && clientId.endsWith(".apps.googleusercontent.com") && scopes.includes(DRIVE_SCOPE),
    clientId: placeholder ? "" : clientId,
    scopeReady: scopes.includes(DRIVE_SCOPE)
  };
}

export async function getDriveExportStatus(options = {}) {
  const chromeApi = options.chromeApi || globalThis.chrome;
  const configuration = readDriveOAuthConfiguration(options.manifest || readRuntimeManifest(chromeApi));

  if (!configuration.configured) {
    return {
      ok: true,
      configured: false,
      connected: false,
      permissionGranted: false,
      originGranted: false,
      reason: "oauth-client-required"
    };
  }

  if (await isLocalOnlyMode({ chromeApi })) {
    return {
      ok: true,
      configured: true,
      connected: false,
      permissionGranted: false,
      originGranted: false,
      localOnly: true,
      reason: "local-only-mode"
    };
  }

  const [permissionGranted, originGranted] = await Promise.all([
    containsPermission(chromeApi, { permissions: ["identity"] }),
    containsPermission(chromeApi, { origins: DRIVE_API_ORIGINS })
  ]);

  if (!permissionGranted || !originGranted) {
    return {
      ok: true,
      configured: true,
      connected: false,
      permissionGranted,
      originGranted,
      reason: "permission-required"
    };
  }

  try {
    const token = await getAuthToken(chromeApi, { interactive: false });
    return {
      ok: true,
      configured: true,
      connected: Boolean(token),
      permissionGranted,
      originGranted,
      reason: token ? "ready" : "authorization-required"
    };
  } catch {
    return {
      ok: true,
      configured: true,
      connected: false,
      permissionGranted,
      originGranted,
      reason: "authorization-required"
    };
  }
}

export async function connectGoogleDrive(options = {}) {
  const chromeApi = options.chromeApi || globalThis.chrome;
  const configuration = readDriveOAuthConfiguration(options.manifest || readRuntimeManifest(chromeApi));

  if (await isLocalOnlyMode({ chromeApi })) {
    throw createDriveError(
      "local-only-mode",
      "Google Drive export is blocked by Local-only mode. Turn it off in Lumen Settings before connecting."
    );
  }

  if (!configuration.configured) {
    throw createDriveError(
      "oauth-client-required",
      "Google Drive export needs a Chrome Extension OAuth client tied to Lumen's published extension ID."
    );
  }

  const granted = await requestPermission(chromeApi, {
    permissions: ["identity"],
    origins: DRIVE_API_ORIGINS
  });

  if (!granted) {
    throw createDriveError(
      "permission-denied",
      "Drive access was not granted. Lumen kept the reviewed image on this device."
    );
  }

  const token = await getAuthToken(chromeApi, { interactive: true });

  if (!token) {
    throw createDriveError(
      "authorization-failed",
      "Google did not return an access token for the reviewed export."
    );
  }

  return {
    ok: true,
    connected: true,
    grantedScopes: [DRIVE_SCOPE]
  };
}

export async function uploadReviewedImageToDrive(input = {}, options = {}) {
  const chromeApi = options.chromeApi || globalThis.chrome;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const blob = input.blob instanceof Blob ? input.blob : null;

  if (!blob || !blob.size || !blob.type.startsWith("image/")) {
    throw createDriveError("invalid-image", "Choose or render an image before exporting it to Drive.");
  }

  if (typeof fetchImpl !== "function") {
    throw createDriveError("network-unavailable", "Drive upload is unavailable in this extension context.");
  }

  const status = await getDriveExportStatus({ chromeApi, manifest: options.manifest });

  if (status.localOnly) {
    throw createDriveError(
      "local-only-mode",
      "Google Drive export is blocked by Local-only mode. Turn it off in Lumen Settings before exporting."
    );
  }

  if (!status.configured) {
    throw createDriveError(
      "oauth-client-required",
      "Google Drive export needs a Chrome Extension OAuth client tied to Lumen's published extension ID."
    );
  }

  if (!status.permissionGranted || !status.originGranted || !status.connected) {
    await connectGoogleDrive({ chromeApi, manifest: options.manifest });
  }

  const token = await getAuthToken(chromeApi, { interactive: false });
  const filename = normalizeDriveFilename(input.filename, blob.type);
  const metadata = buildDriveMetadata({
    filename,
    captureId: input.captureId,
    sourceUrl: input.sourceUrl,
    reviewedAt: input.reviewedAt,
    description: input.description
  });
  let response = await performDriveUpload({ fetchImpl, token, blob, metadata });

  if (response.status === 401) {
    await removeCachedToken(chromeApi, token);
    const refreshedToken = await getAuthToken(chromeApi, { interactive: true });
    response = await performDriveUpload({ fetchImpl, token: refreshedToken, blob, metadata });
  }

  const payload = await readJsonResponse(response);

  if (!response.ok) {
    const reason = payload?.error?.message || `Google Drive returned ${response.status}.`;
    throw createDriveError("upload-failed", reason, { status: response.status });
  }

  return {
    ok: true,
    provider: "google-drive",
    file: {
      id: normalizeText(payload?.id, "", 240),
      name: normalizeText(payload?.name, filename, 260),
      mimeType: normalizeText(payload?.mimeType, blob.type, 120),
      size: Math.max(0, Number(payload?.size) || blob.size),
      webViewLink: sanitizeDriveLink(payload?.webViewLink),
      createdTime: normalizeTimestamp(payload?.createdTime)
    }
  };
}

export function chooseDriveUploadType(byteLength) {
  return Math.max(0, Number(byteLength) || 0) > MULTIPART_UPLOAD_LIMIT_BYTES
    ? "resumable"
    : "multipart";
}

export async function disconnectGoogleDrive(options = {}) {
  const chromeApi = options.chromeApi || globalThis.chrome;
  let token = "";

  try {
    token = await getAuthToken(chromeApi, { interactive: false });
  } catch {
    token = "";
  }

  if (token) {
    await removeCachedToken(chromeApi, token);
  }

  // Revoke each permission class independently. Chrome can retain one half of a
  // combined request when only the identity permission or the API origins are
  // currently granted, which makes a combined revoke look successful while
  // leaving Drive access behind.
  const identityRemoved = await removePermission(chromeApi, {
    permissions: ["identity"]
  });
  const originsRemoved = await removePermission(chromeApi, {
    origins: DRIVE_API_ORIGINS
  });
  const [permissionGranted, originGranted] = await Promise.all([
    containsPermission(chromeApi, { permissions: ["identity"] }),
    containsPermission(chromeApi, { origins: DRIVE_API_ORIGINS })
  ]);

  return {
    ok: true,
    connected: false,
    permissionRemoved: identityRemoved || originsRemoved,
    complete: !permissionGranted && !originGranted,
    permissionGranted,
    originGranted
  };
}

export function buildMultipartUploadRequest({ blob, metadata, boundary = "" } = {}) {
  if (!(blob instanceof Blob)) {
    throw new TypeError("A Blob is required to build a Drive upload request.");
  }

  const safeBoundary = boundary || `lumen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const prefix = [
    `--${safeBoundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata || {}),
    `--${safeBoundary}`,
    `Content-Type: ${blob.type || "application/octet-stream"}`,
    ""
  ].join("\r\n");
  const suffix = `\r\n--${safeBoundary}--\r\n`;

  return {
    boundary: safeBoundary,
    contentType: `multipart/related; boundary=${safeBoundary}`,
    body: new Blob([`${prefix}\r\n`, blob, suffix], {
      type: `multipart/related; boundary=${safeBoundary}`
    })
  };
}

function buildDriveMetadata(input = {}) {
  const captureId = normalizeText(input.captureId, "", 160);
  const sourceUrl = sanitizeHttpUrl(input.sourceUrl);
  const reviewedAt = normalizeTimestamp(input.reviewedAt) || new Date().toISOString();
  const description = normalizeText(
    input.description,
    "Reviewed and exported from Lumen.",
    800
  );
  const appProperties = {
    lumenReviewed: "true",
    lumenReviewedAt: reviewedAt
  };

  if (captureId) {
    appProperties.lumenCaptureId = captureId;
  }

  if (sourceUrl) {
    appProperties.lumenSourceHost = new URL(sourceUrl).host.slice(0, 120);
  }

  return {
    name: input.filename,
    description,
    appProperties
  };
}

async function performDriveUpload({ fetchImpl, token, blob, metadata }) {
  if (chooseDriveUploadType(blob.size) === "multipart") {
    const request = buildMultipartUploadRequest({ blob, metadata });
    return fetchImpl(DRIVE_UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": request.contentType
      },
      body: request.body
    });
  }

  const initiation = await fetchImpl(DRIVE_RESUMABLE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": blob.type || "application/octet-stream",
      "X-Upload-Content-Length": String(blob.size)
    },
    body: JSON.stringify(metadata)
  });

  if (!initiation.ok) {
    return initiation;
  }

  const sessionUrl = sanitizeResumableSessionUrl(initiation.headers.get("Location"));

  if (!sessionUrl) {
    throw createDriveError("upload-session-missing", "Google Drive did not return a safe resumable upload session.");
  }

  return fetchImpl(sessionUrl, {
    method: "PUT",
    headers: {
      "Content-Type": blob.type || "application/octet-stream"
    },
    body: blob
  });
}

async function getAuthToken(chromeApi, { interactive }) {
  if (!chromeApi?.identity?.getAuthToken) {
    throw createDriveError("identity-unavailable", "Chrome Identity is unavailable in this context.");
  }

  const result = await chromeApi.identity.getAuthToken({
    interactive: Boolean(interactive),
    enableGranularPermissions: true,
    scopes: [DRIVE_SCOPE]
  });

  return typeof result === "string" ? result : result?.token || "";
}

async function removeCachedToken(chromeApi, token) {
  if (!token || !chromeApi?.identity?.removeCachedAuthToken) {
    return false;
  }

  await chromeApi.identity.removeCachedAuthToken({ token });
  return true;
}

function containsPermission(chromeApi, permissions) {
  return new Promise((resolve) => {
    if (!chromeApi?.permissions?.contains) {
      resolve(false);
      return;
    }

    chromeApi.permissions.contains(permissions, (granted) => resolve(Boolean(granted)));
  });
}

function requestPermission(chromeApi, permissions) {
  return new Promise((resolve, reject) => {
    if (!chromeApi?.permissions?.request) {
      reject(createDriveError("permissions-unavailable", "Chrome permissions are unavailable in this context."));
      return;
    }

    chromeApi.permissions.request(permissions, (granted) => {
      const runtimeError = chromeApi.runtime?.lastError;
      if (runtimeError) {
        reject(createDriveError("permission-request-failed", runtimeError.message));
        return;
      }
      resolve(Boolean(granted));
    });
  });
}

function removePermission(chromeApi, permissions) {
  return new Promise((resolve) => {
    if (!chromeApi?.permissions?.remove) {
      resolve(false);
      return;
    }

    chromeApi.permissions.remove(permissions, (removed) => {
      const runtimeError = chromeApi.runtime?.lastError;
      resolve(!runtimeError && Boolean(removed));
    });
  });
}

function readRuntimeManifest(chromeApi = globalThis.chrome) {
  return chromeApi?.runtime?.getManifest?.() || {};
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function normalizeDriveFilename(value, mimeType) {
  const extension = mimeType === "image/jpeg" ? ".jpg" : mimeType === "image/webp" ? ".webp" : ".png";
  const source = normalizeText(value, `lumen-reviewed-${new Date().toISOString().slice(0, 10)}${extension}`, 240)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return /\.[a-z0-9]{2,5}$/i.test(source) ? source : `${source}${extension}`;
}

function sanitizeDriveLink(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname.toLowerCase() === "drive.google.com"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function sanitizeResumableSessionUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && (hostname === "www.googleapis.com" || hostname === "content.googleapis.com")
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function sanitizeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return /^https?:$/.test(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function normalizeText(value, fallback = "", limit = 240) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return (normalized || fallback).slice(0, limit);
}

function createDriveError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
