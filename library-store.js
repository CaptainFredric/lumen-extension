import { sanitizeCaptureUrl } from "./config.js";

const DATABASE_NAME = "lumen.capture.library";
const DATABASE_VERSION = 1;
const CAPTURE_STORE = "captures";
const ASSET_STORE = "assets";
const DEFAULT_PREVIEW_BUDGET_BYTES = 50 * 1024 * 1024;
const DEFAULT_PREVIEW_CAPTURE_LIMIT = 500;

let databasePromise = null;

export async function putLibraryCapture(input = {}) {
  const captureId = normalizeText(input.id, "", 160);

  if (!captureId) {
    throw new Error("A capture ID is required before a library item can be stored.");
  }

  const hasPreviewInput = Object.hasOwn(input, "previews") ||
    Object.hasOwn(input, "preview") ||
    Object.hasOwn(input, "previewBlob") ||
    Object.hasOwn(input, "previewDataUrl");
  const previewAssets = hasPreviewInput
    ? await preparePreviewAssets(captureId, collectPreviewInputs(input))
    : [];
  const database = await openLibraryDatabase();
  const transaction = database.transaction([CAPTURE_STORE, ASSET_STORE], "readwrite");
  const captureStore = transaction.objectStore(CAPTURE_STORE);
  const assetStore = transaction.objectStore(ASSET_STORE);
  const existing = await requestResult(captureStore.get(captureId));
  const existingAssetIds = Array.isArray(existing?.previewAssetIds)
    ? existing.previewAssetIds
    : [];
  const normalized = normalizeCaptureRecord(input, existing);

  if (hasPreviewInput) {
    for (const assetId of existingAssetIds) {
      assetStore.delete(assetId);
    }

    for (const asset of previewAssets) {
      assetStore.put(asset);
    }

    normalized.previewAssetIds = previewAssets.map((asset) => asset.id);
    normalized.primaryPreviewAssetId = previewAssets[0]?.id || "";
    normalized.previewBytes = previewAssets.reduce((sum, asset) => sum + asset.byteLength, 0);
    normalized.previewStatus = previewAssets.length ? "ready" : "unavailable";
  } else {
    normalized.previewAssetIds = existingAssetIds;
    normalized.primaryPreviewAssetId = existing?.primaryPreviewAssetId || existingAssetIds[0] || "";
    normalized.previewBytes = Math.max(0, Number(existing?.previewBytes) || 0);
    normalized.previewStatus = existing?.previewStatus || "unavailable";
  }

  captureStore.put(normalized);
  await transactionComplete(transaction);

  return normalized;
}

export async function listLibraryCaptures(options = {}) {
  const database = await openLibraryDatabase();
  const transaction = database.transaction(CAPTURE_STORE, "readonly");
  const captures = await requestResult(transaction.objectStore(CAPTURE_STORE).getAll());
  await transactionComplete(transaction);

  const query = normalizeText(options.query, "", 200).toLowerCase();
  const sourceType = ["manual", "timed"].includes(options.sourceType) ? options.sourceType : "";
  const favoriteOnly = options.favorite === true;
  const sortDirection = options.sort === "oldest" ? 1 : -1;
  const offset = Math.max(0, Math.round(Number(options.offset) || 0));
  const limit = Math.max(1, Math.min(2000, Math.round(Number(options.limit) || 1000)));

  return captures
    .filter((capture) => !sourceType || capture.sourceType === sourceType)
    .filter((capture) => !favoriteOnly || capture.favorite)
    .filter((capture) => {
      if (!query) {
        return true;
      }

      return [
        capture.title,
        capture.host,
        capture.url,
        ...(Array.isArray(capture.tags) ? capture.tags : [])
      ].some((value) => String(value || "").toLowerCase().includes(query));
    })
    .sort((left, right) => {
      const difference = readCaptureTimestamp(left) - readCaptureTimestamp(right);
      return difference ? difference * sortDirection : String(left.id).localeCompare(String(right.id)) * sortDirection;
    })
    .slice(offset, offset + limit);
}

export async function getLibraryCapture(captureId, options = {}) {
  const normalizedId = normalizeText(captureId, "", 160);

  if (!normalizedId) {
    return null;
  }

  const database = await openLibraryDatabase();
  const stores = options.includePreview ? [CAPTURE_STORE, ASSET_STORE] : [CAPTURE_STORE];
  const transaction = database.transaction(stores, "readonly");
  const capture = await requestResult(transaction.objectStore(CAPTURE_STORE).get(normalizedId));

  if (!capture || !options.includePreview) {
    await transactionComplete(transaction);
    return capture || null;
  }

  const previewAssetId = options.assetId || capture.primaryPreviewAssetId || capture.previewAssetIds?.[0] || "";
  const preview = previewAssetId
    ? await requestResult(transaction.objectStore(ASSET_STORE).get(previewAssetId))
    : null;
  await transactionComplete(transaction);

  return {
    ...capture,
    preview: preview || null
  };
}

export async function getLibraryPreviewAsset(captureId, assetId = "") {
  const capture = await getLibraryCapture(captureId);
  const resolvedAssetId = assetId || capture?.primaryPreviewAssetId || capture?.previewAssetIds?.[0] || "";

  if (!capture || !resolvedAssetId) {
    return null;
  }

  const database = await openLibraryDatabase();
  const transaction = database.transaction(ASSET_STORE, "readonly");
  const asset = await requestResult(transaction.objectStore(ASSET_STORE).get(resolvedAssetId));
  await transactionComplete(transaction);

  return asset?.captureId === capture.id ? asset : null;
}

export async function deleteLibraryCapture(captureId) {
  const normalizedId = normalizeText(captureId, "", 160);

  if (!normalizedId) {
    return { deleted: false, assetCount: 0 };
  }

  const database = await openLibraryDatabase();
  const transaction = database.transaction([CAPTURE_STORE, ASSET_STORE], "readwrite");
  const captureStore = transaction.objectStore(CAPTURE_STORE);
  const assetStore = transaction.objectStore(ASSET_STORE);
  const capture = await requestResult(captureStore.get(normalizedId));
  const assetKeys = await requestResult(assetStore.index("captureId").getAllKeys(normalizedId));

  captureStore.delete(normalizedId);
  for (const assetKey of assetKeys) {
    assetStore.delete(assetKey);
  }

  await transactionComplete(transaction);

  return {
    deleted: Boolean(capture),
    assetCount: assetKeys.length
  };
}

export async function clearLibrary() {
  const database = await openLibraryDatabase();
  const transaction = database.transaction([CAPTURE_STORE, ASSET_STORE], "readwrite");
  const captureStore = transaction.objectStore(CAPTURE_STORE);
  const assetStore = transaction.objectStore(ASSET_STORE);
  const [captureCount, assetCount] = await Promise.all([
    requestResult(captureStore.count()),
    requestResult(assetStore.count())
  ]);

  captureStore.clear();
  assetStore.clear();
  await transactionComplete(transaction);

  return { captureCount, assetCount };
}

export async function countLibraryCaptures() {
  const database = await openLibraryDatabase();
  const transaction = database.transaction(CAPTURE_STORE, "readonly");
  const count = await requestResult(transaction.objectStore(CAPTURE_STORE).count());
  await transactionComplete(transaction);
  return count;
}

export async function updateLibraryFavorite(captureId, favorite) {
  const normalizedId = normalizeText(captureId, "", 160);
  const database = await openLibraryDatabase();
  const transaction = database.transaction(CAPTURE_STORE, "readwrite");
  const captureStore = transaction.objectStore(CAPTURE_STORE);
  const capture = await requestResult(captureStore.get(normalizedId));

  if (!capture) {
    transaction.abort();
    throw new Error("The selected library item could not be found.");
  }

  const updated = {
    ...capture,
    favorite: Boolean(favorite),
    updatedAt: new Date().toISOString()
  };

  captureStore.put(updated);
  await transactionComplete(transaction);
  return updated;
}

export async function pruneLibraryPreviews(options = {}) {
  const maxBytes = options.maxBytes === undefined
    ? DEFAULT_PREVIEW_BUDGET_BYTES
    : Math.max(0, Number(options.maxBytes) || 0);
  const maxCaptures = options.maxCaptures === undefined
    ? DEFAULT_PREVIEW_CAPTURE_LIMIT
    : Math.max(0, Math.round(Number(options.maxCaptures) || 0));
  const database = await openLibraryDatabase();
  const readTransaction = database.transaction([CAPTURE_STORE, ASSET_STORE], "readonly");
  const [captures, assets] = await Promise.all([
    requestResult(readTransaction.objectStore(CAPTURE_STORE).getAll()),
    requestResult(readTransaction.objectStore(ASSET_STORE).getAll())
  ]);
  await transactionComplete(readTransaction);

  const assetsByCapture = new Map();

  for (const asset of assets) {
    const existing = assetsByCapture.get(asset.captureId) || [];
    existing.push(asset);
    assetsByCapture.set(asset.captureId, existing);
  }

  let totalBytes = assets.reduce((sum, asset) => sum + Math.max(0, Number(asset.byteLength) || asset.blob?.size || 0), 0);
  let previewCaptureCount = captures.filter((capture) => (assetsByCapture.get(capture.id) || []).length).length;
  const candidates = captures
    .filter((capture) => !capture.favorite && (assetsByCapture.get(capture.id) || []).length)
    .sort((left, right) => readCaptureTimestamp(left) - readCaptureTimestamp(right));
  const prunedCaptureIds = [];

  if (totalBytes > maxBytes || previewCaptureCount > maxCaptures) {
    const writeTransaction = database.transaction([CAPTURE_STORE, ASSET_STORE], "readwrite");
    const captureStore = writeTransaction.objectStore(CAPTURE_STORE);
    const assetStore = writeTransaction.objectStore(ASSET_STORE);

    for (const capture of candidates) {
      if (totalBytes <= maxBytes && previewCaptureCount <= maxCaptures) {
        break;
      }

      const captureAssets = assetsByCapture.get(capture.id) || [];

      for (const asset of captureAssets) {
        totalBytes -= Math.max(0, Number(asset.byteLength) || asset.blob?.size || 0);
        assetStore.delete(asset.id);
      }

      captureStore.put({
        ...capture,
        previewAssetIds: [],
        primaryPreviewAssetId: "",
        previewBytes: 0,
        previewStatus: "pruned",
        updatedAt: new Date().toISOString()
      });
      previewCaptureCount -= 1;
      prunedCaptureIds.push(capture.id);
    }

    await transactionComplete(writeTransaction);
  }

  return {
    prunedCaptureIds,
    previewCaptureCount,
    previewBytes: Math.max(0, totalBytes),
    maxBytes,
    maxCaptures,
    overBudget: totalBytes > maxBytes || previewCaptureCount > maxCaptures
  };
}

export async function getLibraryStorageEstimate() {
  const database = await openLibraryDatabase();
  const transaction = database.transaction([CAPTURE_STORE, ASSET_STORE], "readonly");
  const [captureCount, assets] = await Promise.all([
    requestResult(transaction.objectStore(CAPTURE_STORE).count()),
    requestResult(transaction.objectStore(ASSET_STORE).getAll())
  ]);
  await transactionComplete(transaction);

  const previewBytes = assets.reduce(
    (sum, asset) => sum + Math.max(0, Number(asset.byteLength) || asset.blob?.size || 0),
    0
  );
  const originEstimate = typeof navigator?.storage?.estimate === "function"
    ? await navigator.storage.estimate().catch(() => ({}))
    : {};

  return {
    captureCount,
    previewCount: assets.length,
    previewBytes,
    usage: Math.max(0, Number(originEstimate.usage) || 0),
    quota: Math.max(0, Number(originEstimate.quota) || 0)
  };
}

export async function requestLibraryPersistence() {
  if (typeof navigator?.storage?.persist !== "function") {
    return false;
  }

  return navigator.storage.persist().catch(() => false);
}

function openLibraryDatabase() {
  if (databasePromise) {
    return databasePromise;
  }

  if (!globalThis.indexedDB) {
    return Promise.reject(new Error("IndexedDB is unavailable in this extension context."));
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      const captureStore = database.objectStoreNames.contains(CAPTURE_STORE)
        ? request.transaction.objectStore(CAPTURE_STORE)
        : database.createObjectStore(CAPTURE_STORE, { keyPath: "id" });
      const assetStore = database.objectStoreNames.contains(ASSET_STORE)
        ? request.transaction.objectStore(ASSET_STORE)
        : database.createObjectStore(ASSET_STORE, { keyPath: "id" });

      ensureIndex(captureStore, "capturedAt", "capturedAt");
      ensureIndex(captureStore, "host", "host");
      ensureIndex(captureStore, "sourceType", "sourceType");
      ensureIndex(assetStore, "captureId", "captureId");
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error || new Error("The local capture library could not be opened."));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("The local capture library is open in another version of Lumen."));
    };
  });

  return databasePromise;
}

function ensureIndex(store, name, keyPath) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, { unique: false });
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("A local library request failed."));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("A local library transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("A local library transaction was cancelled."));
  });
}

function collectPreviewInputs(input) {
  if (Array.isArray(input.previews)) {
    return input.previews;
  }

  if (input.preview && typeof input.preview === "object") {
    return [input.preview];
  }

  if (input.previewBlob instanceof Blob || typeof input.previewDataUrl === "string") {
    return [{
      blob: input.previewBlob,
      dataUrl: input.previewDataUrl,
      width: input.previewWidth,
      height: input.previewHeight,
      role: input.previewRole,
      variantId: input.previewVariantId
    }];
  }

  return [];
}

async function preparePreviewAssets(captureId, previewInputs) {
  const assets = [];

  for (let index = 0; index < previewInputs.length; index += 1) {
    const input = previewInputs[index] || {};
    const blob = input.blob instanceof Blob
      ? input.blob
      : typeof input.dataUrl === "string" && input.dataUrl.startsWith("data:image/")
        ? await dataUrlToBlob(input.dataUrl)
        : null;

    if (!blob || !blob.size || !blob.type.startsWith("image/")) {
      continue;
    }

    const variantId = normalizeText(input.variantId, index ? `view-${index + 1}` : "primary", 80);
    const role = input.role === "cutaway" ? "cutaway" : "full-page";
    const id = normalizeText(input.id, `${captureId}:preview:${role}:${variantId}`, 260);

    assets.push({
      id,
      captureId,
      purpose: "preview",
      role,
      variantId,
      mime: normalizeText(blob.type, "image/webp", 80),
      width: Math.max(0, Math.round(Number(input.width) || 0)),
      height: Math.max(0, Math.round(Number(input.height) || 0)),
      byteLength: blob.size,
      blob,
      createdAt: new Date().toISOString()
    });
  }

  return assets;
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);

  if (!response.ok) {
    throw new Error("The capture preview could not be prepared for local storage.");
  }

  return response.blob();
}

function normalizeCaptureRecord(input, existing = null) {
  const now = new Date().toISOString();
  const source = input.source && typeof input.source === "object" ? input.source : {};
  const sourceLabel = String(input.sourceType || source.type || source.kind || "").toLowerCase();
  const sourceType = ["timed", "watch", "scheduled"].includes(sourceLabel) || input.watchPlanId || source.watchPlanId
    ? "timed"
    : sourceLabel === "manual"
      ? "manual"
      : existing?.sourceType || "manual";

  return {
    id: normalizeText(input.id, existing?.id || "", 160),
    schemaVersion: 1,
    capturedAt: normalizeTimestamp(input.capturedAt, existing?.capturedAt || now),
    createdAt: existing?.createdAt || normalizeTimestamp(input.createdAt, now),
    updatedAt: now,
    title: normalizeText(input.title, existing?.title || input.host || "Untitled capture", 220),
    host: normalizeText(input.host, existing?.host || "", 240),
    url: sanitizeCaptureUrl(input.url || existing?.url || ""),
    sourceType,
    watchPlanId: normalizeText(input.watchPlanId || source.watchPlanId, existing?.watchPlanId || "", 160),
    watchRunId: normalizeText(input.watchRunId || source.watchRunId, existing?.watchRunId || "", 160),
    devicePreset: normalizeText(input.devicePreset, existing?.devicePreset || "desktop", 80),
    exportPreset: normalizeText(input.exportPreset, existing?.exportPreset || "raw", 80),
    archiveFolder: normalizeText(input.archiveFolder, existing?.archiveFolder || "", 420),
    manifestFile: normalizeText(input.manifestFile, existing?.manifestFile || "", 420),
    downloads: normalizeDownloads(input.downloads ?? existing?.downloads),
    captureHealth: normalizeCaptureHealth(input.captureHealth ?? existing?.captureHealth),
    dimensions: normalizeDimensions(input.dimensions ?? existing?.dimensions),
    variantCount: Math.max(0, Math.round(Number(input.variantCount ?? input.variants?.length ?? existing?.variantCount) || 0)),
    fileCount: Math.max(0, Math.round(Number(input.fileCount ?? input.files?.length ?? existing?.fileCount) || 0)),
    redactionCount: Math.max(0, Math.round(Number(input.redactionCount ?? existing?.redactionCount) || 0)),
    manualRedactionCount: Math.max(0, Math.round(Number(input.manualRedactionCount ?? existing?.manualRedactionCount) || 0)),
    cutawayCount: Math.max(0, Math.round(Number(input.cutawayCount ?? existing?.cutawayCount) || 0)),
    favorite: typeof input.favorite === "boolean" ? input.favorite : Boolean(existing?.favorite),
    tags: Array.isArray(input.tags) ? normalizeTags(input.tags) : normalizeTags(existing?.tags),
    previewAssetIds: [],
    primaryPreviewAssetId: "",
    previewBytes: 0,
    previewStatus: "unavailable"
  };
}

function normalizeDownloads(downloads) {
  return (Array.isArray(downloads) ? downloads : []).slice(0, 120).map((download) => ({
    downloadId: Number.isInteger(download?.downloadId) ? download.downloadId : null,
    filename: normalizeText(download?.filename, "", 520),
    kind: ["image", "html", "manifest"].includes(download?.kind) ? download.kind : "image",
    role: ["full-page", "cutaway", "print-sheet"].includes(download?.role) ? download.role : "full-page",
    variantId: normalizeText(download?.variantId, "", 80),
    exportPreset: normalizeText(download?.exportPreset, "", 80),
    partIndex: Math.max(1, Math.round(Number(download?.partIndex) || 1)),
    partTotal: Math.max(1, Math.round(Number(download?.partTotal) || 1)),
    width: Math.max(0, Math.round(Number(download?.width) || 0)),
    height: Math.max(0, Math.round(Number(download?.height) || 0)),
    bytesReceived: Math.max(0, Math.round(Number(download?.bytesReceived) || 0)),
    complete: download?.complete !== false
  }));
}

function normalizeCaptureHealth(health) {
  if (!health || typeof health !== "object") {
    return null;
  }

  return {
    status: ["complete", "partial", "incomplete"].includes(health.status) ? health.status : "unknown",
    coveragePercent: Math.max(0, Math.min(100, Number(health.coveragePercent) || 0)),
    reachedTail: health.reachedTail !== false,
    seamGapCount: Math.max(0, Math.round(Number(health.seamGapCount) || 0)),
    widthMismatchCount: Math.max(0, Math.round(Number(health.widthMismatchCount) || 0))
  };
}

function normalizeDimensions(dimensions) {
  if (!dimensions || typeof dimensions !== "object") {
    return null;
  }

  return {
    width: Math.max(0, Math.round(Number(dimensions.width) || 0)),
    height: Math.max(0, Math.round(Number(dimensions.height) || 0))
  };
}

function normalizeTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : [])
    .map((tag) => normalizeText(tag, "", 40).toLowerCase())
    .filter(Boolean))]
    .slice(0, 20);
}

function normalizeText(value, fallback = "", limit = 240) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return (normalized || fallback).slice(0, limit);
}

function normalizeTimestamp(value, fallback) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

function readCaptureTimestamp(capture) {
  return Date.parse(capture?.capturedAt || capture?.createdAt || "") || 0;
}
