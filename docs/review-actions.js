import {
  getLibraryCapture,
  updateLibraryReview
} from "./library-store.js";
import {
  buildExportFilename,
  createImagePdfBlob,
  createPngBlobFromImage,
  downloadBlob
} from "./export-utils.js";

initializeReviewActions().catch(() => {});

async function initializeReviewActions() {
  const review = globalThis.LumenVisualReview;
  const slot = review?.getActionsSlot?.() || document.querySelector("[data-lumen-review-actions]");
  const publicDemo = new URLSearchParams(location.search).get("demo") === "1" && !globalThis.chrome?.runtime?.id;

  if (!review || !slot) {
    return;
  }

  const editButton = document.createElement("button");
  const pngButton = document.createElement("button");
  const pdfButton = document.createElement("button");
  const reviewedButton = document.createElement("button");
  let exportBusy = false;

  editButton.type = "button";
  editButton.className = "review-action-button";
  editButton.textContent = "Open in editor";
  pngButton.type = "button";
  pngButton.className = "review-action-button";
  pngButton.textContent = "Export PNG";
  pngButton.title = "Download the selected capture's local editor source as PNG";
  pdfButton.type = "button";
  pdfButton.className = "review-action-button";
  pdfButton.textContent = "Export PDF";
  pdfButton.title = "Download the selected after capture as a paginated PDF";
  reviewedButton.type = "button";
  reviewedButton.className = "review-action-button primary-review-action";
  reviewedButton.textContent = "Mark reviewed";
  slot.append(editButton, pngButton, pdfButton, reviewedButton);

  const syncDisabledState = () => {
    const selection = review.getSelection();
    const ready = Boolean(selection.beforeCaptureId && selection.afterCaptureId && selection.diff);
    editButton.disabled = publicDemo || !selection.afterCaptureId || !selection.afterImageAvailable;
    editButton.textContent = publicDemo ? "Editor in extension" : "Open in editor";
    editButton.title = publicDemo
      ? "Install Lumen to open the full annotation editor with this workflow."
      : selection.afterCaptureId && !selection.afterImageAvailable
        ? "Annotation is unavailable because this capture has no local image."
        : "";
    pngButton.disabled = exportBusy || !selection.afterCaptureId || !selection.afterImageExportAvailable;
    pngButton.title = selection.afterCaptureId && !selection.afterImageExportAvailable
      ? "PNG export is unavailable because only a small comparison preview remains."
      : "Download the selected capture's local editor source as PNG";
    pdfButton.disabled = exportBusy || !selection.afterCaptureId || !selection.afterPdfExportAvailable;
    pdfButton.title = selection.afterCaptureId && !selection.afterPdfExportAvailable
      ? "PDF export is unavailable because no review PDF or editor source remains."
      : "Download the selected after capture as a paginated PDF";
    reviewedButton.disabled = !ready;
  };

  editButton.addEventListener("click", async () => {
    if (publicDemo) {
      return;
    }

    const captureId = review.getSelectedCaptureId();

    const selection = review.getSelection();

    if (!captureId || !selection.afterImageAvailable) {
      showActionStatus(
        captureId
          ? "This capture no longer has a local image for annotation."
          : "Choose an after capture before opening the editor.",
        "error"
      );
      return;
    }

    editButton.disabled = true;

    try {
      if (globalThis.chrome?.runtime?.sendMessage) {
        const response = await chrome.runtime.sendMessage({
          type: "LUMEN_OPEN_ANNOTATION_EDITOR",
          payload: { captureId }
        });

        if (!response?.ok) {
          throw new Error(response?.error?.description || "The annotation editor could not open.");
        }
      } else {
        location.href = `editor.html?capture=${encodeURIComponent(captureId)}`;
      }
    } catch (error) {
      showActionStatus(error?.message || "The annotation editor could not open.", "error");
    } finally {
      syncDisabledState();
    }
  });

  pngButton.addEventListener("click", () => runLocalExport("png"));
  pdfButton.addEventListener("click", () => runLocalExport("pdf"));

  async function runLocalExport(format) {
    const selection = review.getSelection();
    const exportAvailable = format === "pdf"
      ? selection.afterPdfExportAvailable
      : selection.afterImageExportAvailable;

    if (exportBusy || !selection.afterCaptureId || !exportAvailable) {
      showActionStatus(
        format === "pdf"
          ? "Choose a capture with a cached review PDF or editor source before exporting."
          : "PNG export needs the capture's editor source; comparison thumbnails are not export masters.",
        "error"
      );
      return;
    }

    exportBusy = true;
    slot.setAttribute("aria-busy", "true");
    const activeButton = format === "pdf" ? pdfButton : pngButton;
    const idleLabel = activeButton.textContent;
    activeButton.textContent = "Exporting…";
    syncDisabledState();
    showActionStatus(format === "pdf" ? "Preparing the best local PDF source…" : "Rendering the local editor source as PNG…");

    try {
      const asset = format === "pdf"
        ? await review.getSelectedPdfAsset()
        : await review.getSelectedExportAsset();
      const filename = buildExportFilename(asset.title, "reviewed", format);
      let result;
      let successMessage;

      if (format === "pdf") {
        result = asset.format === "pdf"
          ? {
              blob: asset.blob,
              pageCount: asset.pageCount,
              sourceWidth: asset.sourceWidth,
              sourceHeight: asset.sourceHeight,
              rasterWidth: asset.rasterWidth
            }
          : await createImagePdfBlob(asset.blob, { sourceExact: asset.exact });
        await downloadBlob(result.blob, filename, { folder: "Lumen" });
        const pageLabel = `${result.pageCount} ${result.pageCount === 1 ? "page" : "pages"}`;
        const rasterLabel = result.rasterWidth ? ` at up to ${result.rasterWidth}px page raster width` : "";

        if (asset.cached) {
          const provenance = asset.sourceExact ? " from the original capture output" : " from the best cached capture source";
          successMessage = `Capture-time PDF ready — ${pageLabel}${rasterLabel}${provenance}.`;
        } else if (asset.scaled && asset.originalWidth && asset.originalHeight) {
          successMessage = `PDF ready — ${pageLabel} from the ${asset.width}×${asset.height}px editor proxy; the recorded original was ${asset.originalWidth}×${asset.originalHeight}px.`;
        } else {
          successMessage = `PDF ready — ${pageLabel}${rasterLabel} from the local editor source.`;
        }
      } else {
        result = await createPngBlobFromImage(asset.blob);
        await downloadBlob(result.blob, filename, { folder: "Lumen" });
        successMessage = asset.exact
          ? `Exact local PNG ready at ${result.width}×${result.height}px.`
          : `Editor-proxy PNG ready at ${result.width}×${result.height}px; the recorded original was ${asset.originalWidth || "unknown"}×${asset.originalHeight || "unknown"}px.`;
      }

      showActionStatus(successMessage, "success");

      try {
        await markCaptureExported(selection.afterCaptureId);
      } catch (error) {
        console.debug("Lumen review export bookkeeping skipped after a successful download:", error);
      }

      try {
        window.dispatchEvent(new CustomEvent("lumen-review-exported", {
          detail: {
            captureId: selection.afterCaptureId,
            format,
            filename,
            pageCount: result.pageCount || 1,
            width: result.sourceWidth || result.width || 0,
            height: result.sourceHeight || result.height || 0
          }
        }));
      } catch (error) {
        console.debug("Lumen review export notification skipped after a successful download:", error);
      }
    } catch (error) {
      showActionStatus(error?.message || `The ${format.toUpperCase()} could not be exported.`, "error");
    } finally {
      exportBusy = false;
      slot.setAttribute("aria-busy", "false");
      activeButton.textContent = idleLabel;
      syncDisabledState();
    }
  }

  reviewedButton.addEventListener("click", async () => {
    const selection = review.getSelection();

    if (!selection.afterCaptureId || !selection.diff) {
      showActionStatus("Choose and compare two captures before marking the result reviewed.", "error");
      return;
    }

    reviewedButton.disabled = true;

    try {
      if (new URLSearchParams(location.search).get("demo") === "1") {
        reviewedButton.textContent = "Reviewed";
        showActionStatus("Demo comparison marked reviewed locally for this tab.", "success");
        return;
      }

      const capture = await getLibraryCapture(selection.afterCaptureId);
      if (!capture) {
        throw new Error("The after capture is no longer in the local library.");
      }

      const reviewedAt = new Date().toISOString();
      await updateLibraryReview(selection.afterCaptureId, {
        status: capture.review?.status === "exported" ? "exported" : "reviewed",
        lastReviewedAt: reviewedAt,
        lastComparison: {
          beforeCaptureId: selection.beforeCaptureId,
          changePercent: selection.diff.changePercent,
          similarityPercent: selection.diff.similarityPercent,
          regionCount: selection.diff.regions?.length || 0,
          reviewedAt
        }
      });
      review.markReviewed({ source: "review-actions" });
      reviewedButton.textContent = "Reviewed";
      showActionStatus("Comparison marked reviewed in the local library.", "success");
    } catch (error) {
      showActionStatus(error?.message || "The comparison could not be marked reviewed.", "error");
      reviewedButton.disabled = false;
    }
  });

  window.addEventListener("lumen-review-selection", () => {
    reviewedButton.textContent = "Mark reviewed";
    syncDisabledState();
  });
  syncDisabledState();
}

async function markCaptureExported(captureId) {
  if (new URLSearchParams(location.search).get("demo") === "1") {
    return;
  }

  const capture = await getLibraryCapture(captureId);

  if (!capture) {
    return;
  }

  await updateLibraryReview(captureId, {
    status: "exported",
    lastExportedAt: new Date().toISOString()
  });
}

function showActionStatus(message, tone = "info") {
  const status = document.querySelector("#reviewStatus");

  if (!status) {
    return;
  }

  status.textContent = message;
  status.dataset.tone = tone;
  status.classList.remove("is-hidden");
}
