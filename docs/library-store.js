import { sanitizeCaptureUrl } from "./config.js";

const DATABASE_NAME = "lumen.capture.library";
const DATABASE_VERSION = 1;
const CAPTURE_STORE = "captures";
const ASSET_STORE = "assets";
const DEFAULT_PREVIEW_BUDGET_BYTES = 50 * 1024 * 1024;
const DEFAULT_PREVIEW_CAPTURE_LIMIT = 500;
const DEFAULT_EDITOR_SOURCE_BUDGET_BYTES = 250 * 1024 * 1024;
const DEFAULT_EDITOR_SOURCE_CAPTURE_LIMIT = 75;
const DEFAULT_PDF_SOURCE_BUDGET_BYTES = 250 * 1024 * 1024;
const DEFAULT_PDF_SOURCE_CAPTURE_LIMIT = 75;

let databasePromise = null;

export function hasLibraryPreview(capture) {
  if (!capture || capture.previewStatus !== "ready") {
    return false;
  }

  const previewAssetIds = Array.isArray(capture.previewAssetIds)
    ? capture.previewAssetIds.filter(Boolean)
    : [];
  return Boolean(capture.primaryPreviewAssetId || previewAssetIds.length);
}

export function hasLibraryPdf(capture) {
  return Boolean(capture?.pdfStatus === "ready" && capture?.pdfAssetId);
}

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
  const hasEditorSourceInput = Object.hasOwn(input, "editorSource") ||
    Object.hasOwn(input, "editorSourceBlob") ||
    Object.hasOwn(input, "editorSourceDataUrl");
  const editorSourceAsset = hasEditorSourceInput
    ? await prepareEditorSourceAsset(captureId, collectEditorSourceInput(input))
    : null;
  const hasPdfSourceInput = Object.hasOwn(input, "pdfSource") ||
    Object.hasOwn(input, "pdfSourceBlob") ||
    Object.hasOwn(input, "pdfSourceDataUrl");
  const pdfSourceAsset = hasPdfSourceInput
    ? await preparePdfSourceAsset(captureId, collectPdfSourceInput(input))
    : null;
  const database = await openLibraryDatabase();
  const transaction = database.transaction([CAPTURE_STORE, ASSET_STORE], "readwrite");
  const captureStore = transaction.objectStore(CAPTURE_STORE);
  const assetStore = transaction.objectStore(ASSET_STORE);
  const existing = await requestResult(captureStore.get(captureId));
  const existingAssetIds = Array.isArray(existing?.previewAssetIds)
    ? existing.previewAssetIds
    : [];
  const existingEditorAssetId = normalizeText(existing?.editorAssetId, "", 260);
  const existingPdfAssetId = normalizeText(existing?.pdfAssetId, "", 260);
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

  if (hasEditorSourceInput) {
    if (existingEditorAssetId) {
      assetStore.delete(existingEditorAssetId);
    }

    if (editorSourceAsset) {
      assetStore.put(editorSourceAsset);
    }

    normalized.editorAssetId = editorSourceAsset?.id || "";
    normalized.editorBytes = editorSourceAsset?.byteLength || 0;
    normalized.editorStatus = editorSourceAsset ? "ready" : "unavailable";
    normalized.editorSourceWidth = editorSourceAsset?.width || 0;
    normalized.editorSourceHeight = editorSourceAsset?.height || 0;
    normalized.editorSourceOriginalWidth = editorSourceAsset?.originalWidth || 0;
    normalized.editorSourceOriginalHeight = editorSourceAsset?.originalHeight || 0;
    normalized.editorSourceScaled = Boolean(editorSourceAsset?.scaled);
    normalized.editorSourceKind = editorSourceAsset?.kind || "";
  } else {
    normalized.editorAssetId = existingEditorAssetId;
    normalized.editorBytes = Math.max(0, Number(existing?.editorBytes) || 0);
    normalized.editorStatus = existing?.editorStatus || "unavailable";
    normalized.editorSourceWidth = Math.max(0, Math.round(Number(existing?.editorSourceWidth) || 0));
    normalized.editorSourceHeight = Math.max(0, Math.round(Number(existing?.editorSourceHeight) || 0));
    normalized.editorSourceOriginalWidth = Math.max(0, Math.round(Number(existing?.editorSourceOriginalWidth) || 0));
    normalized.editorSourceOriginalHeight = Math.max(0, Math.round(Number(existing?.editorSourceOriginalHeight) || 0));
    normalized.editorSourceScaled = Boolean(existing?.editorSourceScaled);
    normalized.editorSourceKind = normalizeText(existing?.editorSourceKind, "", 80);
  }

  if (hasPdfSourceInput) {
    if (existingPdfAssetId) {
      assetStore.delete(existingPdfAssetId);
    }

    if (pdfSourceAsset) {
      assetStore.put(pdfSourceAsset);
    }

    normalized.pdfAssetId = pdfSourceAsset?.id || "";
    normalized.pdfBytes = pdfSourceAsset?.byteLength || 0;
    normalized.pdfStatus = pdfSourceAsset ? "ready" : "unavailable";
    normalized.pdfPageCount = pdfSourceAsset?.pageCount || 0;
    normalized.pdfRasterWidth = pdfSourceAsset?.rasterWidth || 0;
    normalized.pdfSourceWidth = pdfSourceAsset?.sourceWidth || 0;
    normalized.pdfSourceHeight = pdfSourceAsset?.sourceHeight || 0;
    normalized.pdfSourceExact = Boolean(pdfSourceAsset?.sourceExact);
    normalized.pdfSourceKind = pdfSourceAsset?.kind || "";
  } else {
    normalized.pdfAssetId = existingPdfAssetId;
    normalized.pdfBytes = Math.max(0, Number(existing?.pdfBytes) || 0);
    normalized.pdfStatus = existing?.pdfStatus || "unavailable";
    normalized.pdfPageCount = Math.max(0, Math.round(Number(existing?.pdfPageCount) || 0));
    normalized.pdfRasterWidth = Math.max(0, Math.round(Number(existing?.pdfRasterWidth) || 0));
    normalized.pdfSourceWidth = Math.max(0, Math.round(Number(existing?.pdfSourceWidth) || 0));
    normalized.pdfSourceHeight = Math.max(0, Math.round(Number(existing?.pdfSourceHeight) || 0));
    normalized.pdfSourceExact = Boolean(existing?.pdfSourceExact);
    normalized.pdfSourceKind = normalizeText(existing?.pdfSourceKind, "", 80);
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
  const includeAssets = Boolean(options.includePreview || options.includeEditorSource || options.includePdfSource);
  const stores = includeAssets ? [CAPTURE_STORE, ASSET_STORE] : [CAPTURE_STORE];
  const transaction = database.transaction(stores, "readonly");
  const capture = await requestResult(transaction.objectStore(CAPTURE_STORE).get(normalizedId));

  if (!capture || !includeAssets) {
    await transactionComplete(transaction);
    return capture || null;
  }

  const assetStore = transaction.objectStore(ASSET_STORE);
  const previewAssetId = options.includePreview
    ? options.assetId || capture.primaryPreviewAssetId || capture.previewAssetIds?.[0] || ""
    : "";
  const editorAssetId = options.includeEditorSource
    ? options.editorAssetId || capture.editorAssetId || ""
    : "";
  const pdfAssetId = options.includePdfSource
    ? options.pdfAssetId || capture.pdfAssetId || ""
    : "";
  const [preview, editorSource, pdfSource] = await Promise.all([
    previewAssetId ? requestResult(assetStore.get(previewAssetId)) : null,
    editorAssetId ? requestResult(assetStore.get(editorAssetId)) : null,
    pdfAssetId ? requestResult(assetStore.get(pdfAssetId)) : null
  ]);
  await transactionComplete(transaction);

  return {
    ...capture,
    ...(options.includePreview ? {
      preview: preview?.captureId === capture.id && preview?.purpose === "preview" ? preview : null
    } : {}),
    ...(options.includeEditorSource ? {
      editorSource: editorSource?.captureId === capture.id && editorSource?.purpose === "editor-source"
        ? editorSource
        : null
    } : {}),
    ...(options.includePdfSource ? {
      pdfSource: pdfSource?.captureId === capture.id && pdfSource?.purpose === "pdf-source"
        ? pdfSource
        : null
    } : {})
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

  return asset?.captureId === capture.id && asset?.purpose === "preview" ? asset : null;
}

export async function getLibraryEditorAsset(captureId) {
  const capture = await getLibraryCapture(captureId);
  const editorAssetId = capture?.editorAssetId || "";

  if (!capture || !editorAssetId) {
    return null;
  }

  const database = await openLibraryDatabase();
  const transaction = database.transaction(ASSET_STORE, "readonly");
  const asset = await requestResult(transaction.objectStore(ASSET_STORE).get(editorAssetId));
  await transactionComplete(transaction);

  return asset?.captureId === capture.id && asset?.purpose === "editor-source" ? asset : null;
}

export async function getLibraryPdfAsset(captureId) {
  const capture = await getLibraryCapture(captureId);
  const pdfAssetId = capture?.pdfAssetId || "";

  if (!capture || !pdfAssetId) {
    return null;
  }

  const database = await openLibraryDatabase();
  const transaction = database.transaction(ASSET_STORE, "readonly");
  const asset = await requestResult(transaction.objectStore(ASSET_STORE).get(pdfAssetId));
  await transactionComplete(transaction);

  return asset?.captureId === capture.id && asset?.purpose === "pdf-source" ? asset : null;
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

export async function updateLibraryReview(captureId, patch = {}) {
  const normalizedId = normalizeText(captureId, "", 160);

  if (!normalizedId) {
    throw new Error("A capture ID is required before review metadata can be saved.");
  }

  const database = await openLibraryDatabase();
  const transaction = database.transaction(CAPTURE_STORE, "readwrite");
  const captureStore = transaction.objectStore(CAPTURE_STORE);
  const capture = await requestResult(captureStore.get(normalizedId));

  if (!capture) {
    transaction.abort();
    throw new Error("The reviewed library item could not be found.");
  }

  const updated = {
    ...capture,
    review: normalizeReviewMetadata(patch, capture.review),
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

  const previewAssets = assets.filter((asset) => asset.purpose === "preview");
  const assetsByCapture = new Map();

  for (const asset of previewAssets) {
    const existing = assetsByCapture.get(asset.captureId) || [];
    existing.push(asset);
    assetsByCapture.set(asset.captureId, existing);
  }

  let totalBytes = previewAssets.reduce((sum, asset) => sum + readAssetBytes(asset), 0);
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
        totalBytes -= readAssetBytes(asset);
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

  const editorPrune = await pruneLibraryEditorSources({
    maxBytes: options.editorMaxBytes,
    maxCaptures: options.editorMaxCaptures
  });
  const pdfPrune = await pruneLibraryPdfSources({
    maxBytes: options.pdfMaxBytes,
    maxCaptures: options.pdfMaxCaptures
  });

  return {
    prunedCaptureIds,
    previewCaptureCount,
    previewBytes: Math.max(0, totalBytes),
    maxBytes,
    maxCaptures,
    overBudget: totalBytes > maxBytes || previewCaptureCount > maxCaptures,
    editorPrunedCaptureIds: editorPrune.prunedCaptureIds,
    editorCaptureCount: editorPrune.editorCaptureCount,
    editorBytes: editorPrune.editorBytes,
    editorOverBudget: editorPrune.overBudget,
    pdfPrunedCaptureIds: pdfPrune.prunedCaptureIds,
    pdfCaptureCount: pdfPrune.pdfCaptureCount,
    pdfBytes: pdfPrune.pdfBytes,
    pdfOverBudget: pdfPrune.overBudget
  };
}

export async function pruneLibraryEditorSources(options = {}) {
  const maxBytes = options.maxBytes === undefined
    ? DEFAULT_EDITOR_SOURCE_BUDGET_BYTES
    : Math.max(0, Number(options.maxBytes) || 0);
  const maxCaptures = options.maxCaptures === undefined
    ? DEFAULT_EDITOR_SOURCE_CAPTURE_LIMIT
    : Math.max(0, Math.round(Number(options.maxCaptures) || 0));
  const database = await openLibraryDatabase();
  const readTransaction = database.transaction([CAPTURE_STORE, ASSET_STORE], "readonly");
  const [captures, assets] = await Promise.all([
    requestResult(readTransaction.objectStore(CAPTURE_STORE).getAll()),
    requestResult(readTransaction.objectStore(ASSET_STORE).getAll())
  ]);
  await transactionComplete(readTransaction);

  const editorAssets = assets.filter((asset) => asset.purpose === "editor-source");
  const assetsByCapture = new Map(editorAssets.map((asset) => [asset.captureId, asset]));
  let totalBytes = editorAssets.reduce((sum, asset) => sum + readAssetBytes(asset), 0);
  let editorCaptureCount = assetsByCapture.size;
  const candidates = captures
    .filter((capture) => !capture.favorite && assetsByCapture.has(capture.id))
    .sort((left, right) => readCaptureTimestamp(left) - readCaptureTimestamp(right));
  const prunedCaptureIds = [];

  if (totalBytes > maxBytes || editorCaptureCount > maxCaptures) {
    const writeTransaction = database.transaction([CAPTURE_STORE, ASSET_STORE], "readwrite");
    const captureStore = writeTransaction.objectStore(CAPTURE_STORE);
    const assetStore = writeTransaction.objectStore(ASSET_STORE);

    for (const capture of candidates) {
      if (totalBytes <= maxBytes && editorCaptureCount <= maxCaptures) {
        break;
      }

      const asset = assetsByCapture.get(capture.id);

      if (!asset) {
        continue;
      }

      totalBytes -= readAssetBytes(asset);
      editorCaptureCount -= 1;
      assetStore.delete(asset.id);
      captureStore.put({
        ...capture,
        editorAssetId: "",
        editorBytes: 0,
        editorStatus: "pruned",
        updatedAt: new Date().toISOString()
      });
      prunedCaptureIds.push(capture.id);
    }

    await transactionComplete(writeTransaction);
  }

  return {
    prunedCaptureIds,
    editorCaptureCount,
    editorBytes: Math.max(0, totalBytes),
    maxBytes,
    maxCaptures,
    overBudget: totalBytes > maxBytes || editorCaptureCount > maxCaptures
  };
}

export async function pruneLibraryPdfSources(options = {}) {
  const maxBytes = options.maxBytes === undefined
    ? DEFAULT_PDF_SOURCE_BUDGET_BYTES
    : Math.max(0, Number(options.maxBytes) || 0);
  const maxCaptures = options.maxCaptures === undefined
    ? DEFAULT_PDF_SOURCE_CAPTURE_LIMIT
    : Math.max(0, Math.round(Number(options.maxCaptures) || 0));
  const database = await openLibraryDatabase();
  const readTransaction = database.transaction([CAPTURE_STORE, ASSET_STORE], "readonly");
  const [captures, assets] = await Promise.all([
    requestResult(readTransaction.objectStore(CAPTURE_STORE).getAll()),
    requestResult(readTransaction.objectStore(ASSET_STORE).getAll())
  ]);
  await transactionComplete(readTransaction);

  const pdfAssets = assets.filter((asset) => asset.purpose === "pdf-source");
  const assetsByCapture = new Map(pdfAssets.map((asset) => [asset.captureId, asset]));
  let totalBytes = pdfAssets.reduce((sum, asset) => sum + readAssetBytes(asset), 0);
  let pdfCaptureCount = assetsByCapture.size;
  const candidates = captures
    .filter((capture) => !capture.favorite && assetsByCapture.has(capture.id))
    .sort((left, right) => readCaptureTimestamp(left) - readCaptureTimestamp(right));
  const prunedCaptureIds = [];

  if (totalBytes > maxBytes || pdfCaptureCount > maxCaptures) {
    const writeTransaction = database.transaction([CAPTURE_STORE, ASSET_STORE], "readwrite");
    const captureStore = writeTransaction.objectStore(CAPTURE_STORE);
    const assetStore = writeTransaction.objectStore(ASSET_STORE);

    for (const capture of candidates) {
      if (totalBytes <= maxBytes && pdfCaptureCount <= maxCaptures) {
        break;
      }

      const asset = assetsByCapture.get(capture.id);

      if (!asset) {
        continue;
      }

      totalBytes -= readAssetBytes(asset);
      pdfCaptureCount -= 1;
      assetStore.delete(asset.id);
      captureStore.put({
        ...capture,
        pdfAssetId: "",
        pdfBytes: 0,
        pdfStatus: "pruned",
        updatedAt: new Date().toISOString()
      });
      prunedCaptureIds.push(capture.id);
    }

    await transactionComplete(writeTransaction);
  }

  return {
    prunedCaptureIds,
    pdfCaptureCount,
    pdfBytes: Math.max(0, totalBytes),
    maxBytes,
    maxCaptures,
    overBudget: totalBytes > maxBytes || pdfCaptureCount > maxCaptures
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

  const previewAssets = assets.filter((asset) => asset.purpose === "preview");
  const editorAssets = assets.filter((asset) => asset.purpose === "editor-source");
  const pdfAssets = assets.filter((asset) => asset.purpose === "pdf-source");
  const previewBytes = previewAssets.reduce((sum, asset) => sum + readAssetBytes(asset), 0);
  const editorBytes = editorAssets.reduce((sum, asset) => sum + readAssetBytes(asset), 0);
  const pdfBytes = pdfAssets.reduce((sum, asset) => sum + readAssetBytes(asset), 0);
  const originEstimate = typeof navigator?.storage?.estimate === "function"
    ? await navigator.storage.estimate().catch(() => ({}))
    : {};

  return {
    captureCount,
    previewCount: previewAssets.length,
    previewBytes,
    editorCount: editorAssets.length,
    editorBytes,
    pdfCount: pdfAssets.length,
    pdfBytes,
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

function collectEditorSourceInput(input) {
  if (input.editorSource && typeof input.editorSource === "object") {
    return input.editorSource;
  }

  if (input.editorSourceBlob instanceof Blob || typeof input.editorSourceDataUrl === "string") {
    return {
      blob: input.editorSourceBlob,
      dataUrl: input.editorSourceDataUrl,
      width: input.editorSourceWidth,
      height: input.editorSourceHeight,
      originalWidth: input.editorSourceOriginalWidth,
      originalHeight: input.editorSourceOriginalHeight,
      scaled: input.editorSourceScaled,
      kind: input.editorSourceKind
    };
  }

  return null;
}

function collectPdfSourceInput(input) {
  if (input.pdfSource && typeof input.pdfSource === "object") {
    return input.pdfSource;
  }

  if (input.pdfSourceBlob instanceof Blob || typeof input.pdfSourceDataUrl === "string") {
    return {
      blob: input.pdfSourceBlob,
      dataUrl: input.pdfSourceDataUrl,
      pageCount: input.pdfPageCount,
      rasterWidth: input.pdfRasterWidth,
      sourceWidth: input.pdfSourceWidth,
      sourceHeight: input.pdfSourceHeight,
      sourceExact: input.pdfSourceExact,
      kind: input.pdfSourceKind
    };
  }

  return null;
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

async function prepareEditorSourceAsset(captureId, input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const blob = input.blob instanceof Blob
    ? input.blob
    : typeof input.dataUrl === "string" && input.dataUrl.startsWith("data:image/")
      ? await dataUrlToBlob(input.dataUrl)
      : null;

  if (!blob || !blob.size || !blob.type.startsWith("image/")) {
    return null;
  }

  const variantId = normalizeText(input.variantId, "primary", 80);
  const role = input.role === "cutaway" ? "cutaway" : "full-page";

  return {
    id: normalizeText(input.id, `${captureId}:editor-source:${variantId}`, 260),
    captureId,
    purpose: "editor-source",
    role,
    variantId,
    kind: normalizeText(input.kind, "whole-page-proxy", 80),
    mime: normalizeText(blob.type, "image/png", 80),
    width: Math.max(0, Math.round(Number(input.width) || 0)),
    height: Math.max(0, Math.round(Number(input.height) || 0)),
    originalWidth: Math.max(0, Math.round(Number(input.originalWidth) || Number(input.width) || 0)),
    originalHeight: Math.max(0, Math.round(Number(input.originalHeight) || Number(input.height) || 0)),
    pageWidth: Math.max(0, Math.round(Number(input.pageWidth) || Number(input.originalWidth) || Number(input.width) || 0)),
    pageHeight: Math.max(0, Math.round(Number(input.pageHeight) || Number(input.originalHeight) || Number(input.height) || 0)),
    scaled: Boolean(input.scaled),
    byteLength: blob.size,
    blob,
    createdAt: new Date().toISOString()
  };
}

async function preparePdfSourceAsset(captureId, input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const blob = input.blob instanceof Blob
    ? input.blob
    : typeof input.dataUrl === "string" && input.dataUrl.startsWith("data:application/pdf")
      ? await dataUrlToBlob(input.dataUrl)
      : null;

  if (!blob || !blob.size || blob.type !== "application/pdf") {
    return null;
  }

  return {
    id: normalizeText(input.id, `${captureId}:pdf-source:primary`, 260),
    captureId,
    purpose: "pdf-source",
    role: input.role === "cutaway" ? "cutaway" : "full-page",
    kind: normalizeText(input.kind, "capture-output-pdf", 80),
    mime: "application/pdf",
    pageCount: Math.max(1, Math.round(Number(input.pageCount) || 1)),
    rasterWidth: Math.max(0, Math.round(Number(input.rasterWidth) || 0)),
    sourceWidth: Math.max(0, Math.round(Number(input.sourceWidth) || 0)),
    sourceHeight: Math.max(0, Math.round(Number(input.sourceHeight) || 0)),
    sourceExact: Boolean(input.sourceExact),
    byteLength: blob.size,
    blob,
    createdAt: new Date().toISOString()
  };
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);

  if (!response.ok) {
    throw new Error("The capture asset could not be prepared for local storage.");
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
    review: normalizeReviewMetadata(input.review, existing?.review),
    favorite: typeof input.favorite === "boolean" ? input.favorite : Boolean(existing?.favorite),
    tags: Array.isArray(input.tags) ? normalizeTags(input.tags) : normalizeTags(existing?.tags),
    previewAssetIds: [],
    primaryPreviewAssetId: "",
    previewBytes: 0,
    previewStatus: "unavailable",
    editorAssetId: "",
    editorBytes: 0,
    editorStatus: "unavailable",
    editorSourceWidth: 0,
    editorSourceHeight: 0,
    editorSourceOriginalWidth: 0,
    editorSourceOriginalHeight: 0,
    editorSourceScaled: false,
    editorSourceKind: "",
    pdfAssetId: "",
    pdfBytes: 0,
    pdfStatus: "unavailable",
    pdfPageCount: 0,
    pdfRasterWidth: 0,
    pdfSourceWidth: 0,
    pdfSourceHeight: 0,
    pdfSourceExact: false,
    pdfSourceKind: ""
  };
}

function normalizeReviewMetadata(input, existing = null) {
  const source = input && typeof input === "object" ? input : {};
  const previous = existing && typeof existing === "object" ? existing : {};
  const exports = Array.isArray(source.driveExports)
    ? source.driveExports
    : Array.isArray(previous.driveExports)
      ? previous.driveExports
      : [];

  return {
    status: ["unreviewed", "reviewed", "edited", "exported"].includes(source.status)
      ? source.status
      : ["unreviewed", "reviewed", "edited", "exported"].includes(previous.status)
        ? previous.status
        : "unreviewed",
    lastReviewedAt: normalizeOptionalTimestamp(source.lastReviewedAt ?? previous.lastReviewedAt),
    lastEditedAt: normalizeOptionalTimestamp(source.lastEditedAt ?? previous.lastEditedAt),
    lastExportedAt: normalizeOptionalTimestamp(source.lastExportedAt ?? previous.lastExportedAt),
    annotationCount: Math.max(0, Math.min(500, Math.round(Number(source.annotationCount ?? previous.annotationCount) || 0))),
    driveExports: exports.slice(0, 20).map((item) => ({
      id: normalizeText(item?.id, "", 240),
      name: normalizeText(item?.name, "", 260),
      webViewLink: sanitizeGoogleDriveLink(item?.webViewLink),
      exportedAt: normalizeOptionalTimestamp(item?.exportedAt)
    })).filter((item) => item.id),
    lastComparison: normalizeReviewComparison(source.lastComparison ?? previous.lastComparison)
  };
}

function normalizeReviewComparison(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  return {
    beforeCaptureId: normalizeText(input.beforeCaptureId, "", 160),
    changePercent: Math.max(0, Math.min(100, Number(input.changePercent) || 0)),
    similarityPercent: Math.max(0, Math.min(100, Number(input.similarityPercent) || 0)),
    regionCount: Math.max(0, Math.min(5000, Math.round(Number(input.regionCount) || 0))),
    reviewedAt: normalizeOptionalTimestamp(input.reviewedAt)
  };
}

function sanitizeGoogleDriveLink(value) {
  try {
    const url = new URL(String(value || ""));
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && (hostname === "drive.google.com" || hostname.endsWith(".drive.google.com"))
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function readAssetBytes(asset) {
  return Math.max(0, Number(asset?.byteLength) || asset?.blob?.size || 0);
}

function normalizeOptionalTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
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
