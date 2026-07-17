import {
  getLibraryCapture,
  updateLibraryReview
} from "./library-store.js";

initializeReviewActions().catch(() => {});

async function initializeReviewActions() {
  const review = globalThis.LumenVisualReview;
  const slot = review?.getActionsSlot?.() || document.querySelector("[data-lumen-review-actions]");

  if (!review || !slot) {
    return;
  }

  const editButton = document.createElement("button");
  const reviewedButton = document.createElement("button");

  editButton.type = "button";
  editButton.className = "review-action-button";
  editButton.textContent = "Open in editor";
  reviewedButton.type = "button";
  reviewedButton.className = "review-action-button primary-review-action";
  reviewedButton.textContent = "Mark reviewed";
  slot.append(editButton, reviewedButton);

  const syncDisabledState = () => {
    const selection = review.getSelection();
    const ready = Boolean(selection.beforeCaptureId && selection.afterCaptureId && selection.diff);
    editButton.disabled = !selection.afterCaptureId || !selection.afterImageAvailable;
    editButton.title = selection.afterCaptureId && !selection.afterImageAvailable
      ? "Annotation is unavailable because this capture has no local image."
      : "";
    reviewedButton.disabled = !ready;
  };

  editButton.addEventListener("click", async () => {
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

function showActionStatus(message, tone = "info") {
  const status = document.querySelector("#reviewStatus");

  if (!status) {
    return;
  }

  status.textContent = message;
  status.dataset.tone = tone;
  status.classList.remove("is-hidden");
}
