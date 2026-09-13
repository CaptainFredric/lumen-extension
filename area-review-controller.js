export const AreaReviewMessage = Object.freeze({
  READ: "LUMEN_AREA_REVIEW_READ",
  DECIDE: "LUMEN_AREA_REVIEW_DECIDE"
});

// Geometry approval is invalid after navigation, scrolling, or a viewport change.
export function sameAreaReviewPage(before, after) {
  if (!before?.url || !after?.url || !(before.viewportWidth > 0) || !(before.viewportHeight > 0)) return false;
  const fields = ["url", "viewportWidth", "viewportHeight", "browserViewportWidth",
    "browserViewportHeight", "scrollTop", "scrollLeft", "scrollMode", "scrollContainer", "devicePixelRatio"];
  return fields.every(key => before?.[key] === after?.[key]) &&
    ["left", "top", "width", "height"].every(key => before?.captureRect?.[key] === after?.captureRect?.[key]);
}

export function createAreaReviewController(api, { timeoutMs = 120000 } = {}) {
  let pending = null;
  const pageUrl = api.runtime.getURL("area-review.html");

  function finish(approved) {
    if (!pending) return;
    const entry = pending;
    pending = null;
    clearTimeout(entry.timer);
    entry.resolve(approved);
    if (entry.windowId != null) api.windows.remove(entry.windowId).catch(() => {});
  }

  api.windows.onRemoved.addListener(id => {
    if (id === pending?.windowId) finish(false);
  });

  return {
    cancel: () => finish(false),
    async request(review) {
      if (pending) throw new Error("An area review is already open.");
      const id = crypto.randomUUID();
      const decision = new Promise(resolve => {
        pending = { id, review, resolve, expiresAt: Date.now() + timeoutMs };
        pending.timer = setTimeout(() => finish(false), timeoutMs);
      });
      try {
        const window = await api.windows.create({
          url: `${pageUrl}?id=${encodeURIComponent(id)}`,
          type: "popup", width: 520, height: 740, focused: true
        });
        if (pending?.id !== id) {
          await api.windows.remove(window.id).catch(() => {});
          return false;
        }
        pending.windowId = window.id;
        pending.tabId = window.tabs?.[0]?.id;
      } catch (error) {
        if (pending?.id === id) finish(false);
        throw error;
      }
      return decision;
    },
    handle(message, sender, respond) {
      if (!Object.values(AreaReviewMessage).includes(message?.type)) return false;
      // A content script or another extension page cannot approve this request.
      const authorized = pending && message.id === pending.id &&
        sender.url === `${pageUrl}?id=${encodeURIComponent(pending.id)}` &&
        Number.isInteger(pending.tabId) && sender.tab?.id === pending.tabId &&
        sender.tab?.windowId === pending.windowId && Date.now() < pending.expiresAt;
      if (!authorized) {
        respond({ ok: false, error: "This review has expired or is unavailable. Select the area again." });
      } else if (message.type === AreaReviewMessage.READ) {
        respond({ ok: true, review: pending.review, expiresAt: pending.expiresAt });
      } else if (typeof message.approved !== "boolean") {
        respond({ ok: false, error: "Choose Capture or Cancel." });
      } else {
        respond({ ok: true });
        finish(message.approved);
      }
      return true;
    }
  };
}
