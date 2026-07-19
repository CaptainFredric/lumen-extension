import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  getDriveExportStatus,
  readDriveOAuthConfiguration,
  uploadReviewedImageToDrive
} from "./drive-export.js";
import {
  getLibraryCapture,
  updateLibraryReview
} from "./library-store.js";

const captureId = new URLSearchParams(location.search).get("capture") || "";

initializeDriveExport().catch(() => {});

async function initializeDriveExport() {
  const slot = document.querySelector("[data-lumen-export-actions]");

  if (!slot) {
    return;
  }

  installLocalExportTracking();

  const configuration = readDriveOAuthConfiguration();

  if (!configuration.configured) {
    slot.replaceChildren();
    slot.hidden = true;
    return;
  }

  const initialStatus = await getDriveExportStatus();

  if (initialStatus.localOnly) {
    slot.replaceChildren();
    slot.hidden = true;
    return;
  }

  slot.hidden = false;

  const exportButton = document.createElement("button");
  const disconnectButton = document.createElement("button");
  const statusNode = document.createElement("span");
  let editorImageLoaded = isEditorImageLoaded();

  exportButton.type = "button";
  exportButton.className = "toolbar-button drive-export-button";
  exportButton.textContent = "Export to Drive";
  disconnectButton.type = "button";
  disconnectButton.className = "toolbar-button drive-disconnect-button";
  disconnectButton.textContent = "Disconnect Drive";
  disconnectButton.hidden = true;
  statusNode.className = "drive-export-status";
  statusNode.setAttribute("role", "status");
  statusNode.setAttribute("aria-live", "polite");
  slot.append(exportButton, disconnectButton, statusNode);

  const updateExportAvailability = (event) => {
    if (typeof event?.detail?.loaded === "boolean") {
      editorImageLoaded = event.detail.loaded;
    } else {
      editorImageLoaded = isEditorImageLoaded();
    }

    exportButton.disabled = !editorImageLoaded;
    exportButton.title = editorImageLoaded
      ? "Export this reviewed image to Google Drive"
      : "Open an image before exporting to Google Drive";
  };

  window.addEventListener("lumen:annotation-editor-ready", updateExportAvailability);
  updateExportAvailability();

  const refreshStatus = async () => {
    const status = await getDriveExportStatus();
    disconnectButton.hidden = !status.connected;
    statusNode.textContent = "";
    exportButton.title = editorImageLoaded
      ? status.connected
        ? "Export this reviewed image to the connected Google Drive account"
        : "Connect and export this reviewed image to Google Drive"
      : "Open an image before exporting to Google Drive";
    return status;
  };

  exportButton.addEventListener("click", async () => {
    if (!editorImageLoaded && !isEditorImageLoaded()) {
      exportButton.disabled = true;
      statusNode.textContent = "Open an image before exporting to Google Drive.";
      return;
    }

    exportButton.disabled = true;
    statusNode.textContent = "Preparing reviewed export…";

    try {
      assertEditorImageLoaded();
      // Permission requests must start from this explicit click. Connect before
      // rendering the potentially large canvas blob so the gesture is retained.
      await connectGoogleDrive();

      const blob = await getCurrentEditorBlob();
      const capture = captureId ? await getLibraryCapture(captureId) : null;
      const reviewedAt = new Date().toISOString();
      const upload = await uploadReviewedImageToDrive({
        blob,
        filename: buildReviewedFilename(capture),
        captureId,
        sourceUrl: capture?.url || "",
        reviewedAt,
        description: "Reviewed annotation export created in Lumen."
      });

      if (captureId) {
        const previousExports = Array.isArray(capture?.review?.driveExports)
          ? capture.review.driveExports
          : [];
        await updateLibraryReview(captureId, {
          status: "exported",
          lastReviewedAt: reviewedAt,
          lastEditedAt: reviewedAt,
          lastExportedAt: reviewedAt,
          annotationCount: readAnnotationCount(),
          driveExports: [{
            id: upload.file.id,
            name: upload.file.name,
            webViewLink: upload.file.webViewLink,
            exportedAt: reviewedAt
          }, ...previousExports]
        });
      }

      statusNode.replaceChildren(document.createTextNode(`${upload.file.name} saved to Drive. `));
      if (upload.file.webViewLink) {
        const link = document.createElement("a");
        link.href = upload.file.webViewLink;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = "Open file";
        statusNode.append(link);
      }
      disconnectButton.hidden = false;
    } catch (error) {
      statusNode.textContent = error?.message || "The reviewed image could not be exported to Drive.";
    } finally {
      editorImageLoaded = isEditorImageLoaded();
      exportButton.disabled = !editorImageLoaded;
    }
  });

  disconnectButton.addEventListener("click", async () => {
    disconnectButton.disabled = true;
    statusNode.textContent = "Disconnecting Drive…";

    try {
      const result = await disconnectGoogleDrive();
      if (result.complete === false) {
        throw new Error("Chrome kept part of the Drive permission. Open Lumen Settings and try again.");
      }
      disconnectButton.hidden = true;
      statusNode.textContent = "Drive disconnected. Existing Drive files remain under your control.";
    } catch (error) {
      statusNode.textContent = error?.message || "Drive could not be disconnected.";
    } finally {
      disconnectButton.disabled = false;
    }
  });

  await refreshStatus();
}

function installLocalExportTracking() {
  if (!captureId) {
    return;
  }

  window.addEventListener("lumen:annotation-exported", async (event) => {
    try {
      const exportedAt = new Date().toISOString();
      await updateLibraryReview(captureId, {
        status: "exported",
        lastReviewedAt: exportedAt,
        lastEditedAt: exportedAt,
        lastExportedAt: exportedAt,
        annotationCount: Number(event.detail?.metadata?.annotationCount) || readAnnotationCount()
      });
    } catch {
      // The PNG already exists in Downloads. Review metadata is best-effort and
      // must never make the user's explicit export appear to have failed.
    }
  });
}

function isEditorImageLoaded() {
  const localExportButton = document.querySelector("#exportButton");
  return Boolean(globalThis.LumenAnnotationEditor?.getRenderedBlob) && Boolean(localExportButton) && !localExportButton.disabled;
}

function assertEditorImageLoaded() {
  if (!isEditorImageLoaded()) {
    throw new Error("Open an image before exporting to Google Drive.");
  }
}

async function getCurrentEditorBlob() {
  const getter = globalThis.LumenAnnotationEditor?.getRenderedBlob;

  if (typeof getter !== "function") {
    throw new Error("The annotation editor has not finished preparing the reviewed image.");
  }

  const blob = await getter();

  if (!(blob instanceof Blob) || !blob.size) {
    throw new Error("The annotation editor returned an empty image.");
  }

  return blob;
}

function buildReviewedFilename(capture) {
  const base = String(capture?.title || capture?.host || "Lumen capture")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return `${base || "Lumen capture"} — reviewed.png`;
}

function readAnnotationCount() {
  const value = Number(globalThis.LumenAnnotationEditor?.getAnnotationCount?.());
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
