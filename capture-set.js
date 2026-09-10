import { getLibraryBundleImage } from "./library-store.js";
import { createCaptureZip } from "./capture-zip.js";
import { downloadBlob, buildExportFilename } from "./export-utils.js";

export function mountCaptureSet({ capture, host, selectImage, canSelect = () => true, report }) {
  const images = capture.bundleImages || [];
  if (!images.length) return;
  const selected = new Set(images.map((image) => image.id));
  let active = -1;
  let loading = false;
  let queuedIndex = null;
  let controller = null;
  const buttons = [];
  const panel = document.createElement("section");
  panel.className = "capture-set";
  panel.setAttribute("aria-label", "Capture images");
  const controls = document.createElement("div");
  controls.className = "capture-set-controls";
  const label = document.createElement("span");
  label.setAttribute("aria-live", "polite");
  const all = document.createElement("button");
  all.textContent = "Select all";
  const none = document.createElement("button");
  none.textContent = "Clear selection";
  const download = document.createElement("button");
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel ZIP";
  cancel.hidden = true;
  const list = document.createElement("div");
  list.className = "capture-set-list";
  const checkboxes = [];
  const thumbnailUrls = [];
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const element = entry.target;
      void getLibraryBundleImage(capture.id, element.dataset.assetId).then((asset) => {
        if (!asset?.thumbnail || !element.isConnected) return;
        const url = URL.createObjectURL(asset.thumbnail);
        thumbnailUrls.push(url);
        element.src = url;
      }).catch(() => { element.hidden = true; });
    }
  }, { root: list, rootMargin: "100px" });
  const refresh = () => {
    label.textContent = `${images.length} retained originals${active >= 0 ? ` · Viewing ${active + 1} of ${images.length}` : ""}`;
    download.textContent = `Download ZIP (${selected.size})`;
    download.disabled = !selected.size || Boolean(controller);
    all.disabled = none.disabled = Boolean(controller);
    for (const checkbox of checkboxes) checkbox.disabled = Boolean(controller);
  };
  async function view(index) {
    if (loading) { queuedIndex = index; return; }
    if (!canSelect()) return;
    loading = true;
    panel.setAttribute("aria-busy", "true");
    try {
      const image = await getLibraryBundleImage(capture.id, images[index].id);
      if (!image?.blob) throw new Error("This original was removed to save space. The downloaded file may still be available in Details.");
      await selectImage(image);
      active = index;
      buttons.forEach((button, i) => button.setAttribute("aria-pressed", String(i === active)));
      buttons[index].scrollIntoView({ block: "nearest", inline: "nearest" });
      refresh();
    } catch (error) { report(error.message, "error"); }
    finally {
      loading = false;
      panel.setAttribute("aria-busy", "false");
      if (queuedIndex !== null) {
        const next = queuedIndex;
        queuedIndex = null;
        void view(next);
      }
    }
  }
  images.forEach((image, index) => {
    const card = document.createElement("div");
    card.className = "capture-set-item";
    const button = document.createElement("button");
    button.textContent = `${index + 1}. ${image.variantId} · ${image.role === "cutaway" ? "Crop" : "Page"} · ${image.width} × ${image.height}`;
    button.title = image.filename;
    if (image.hasThumbnail) {
      const thumbnail = document.createElement("img");
      thumbnail.alt = "";
      thumbnail.width = 72;
      thumbnail.height = 48;
      thumbnail.dataset.assetId = image.id;
      button.prepend(thumbnail);
      observer.observe(thumbnail);
    }
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => view(index));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? images.length - 1 : Math.max(0, Math.min(images.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
      buttons[next].focus();
      void view(next);
    });
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.setAttribute("aria-label", `Include image ${index + 1} in ZIP`);
    checkbox.addEventListener("change", () => { checkbox.checked ? selected.add(image.id) : selected.delete(image.id); refresh(); });
    buttons.push(button);
    checkboxes.push(checkbox);
    card.append(checkbox, button);
    list.append(card);
  });
  all.addEventListener("click", () => { images.forEach((image) => selected.add(image.id)); checkboxes.forEach((input) => { input.checked = true; }); refresh(); });
  none.addEventListener("click", () => { selected.clear(); checkboxes.forEach((input) => { input.checked = false; }); refresh(); });
  cancel.addEventListener("click", () => controller?.abort());
  const resizeObserver = new ResizeObserver(() => {
    if (active >= 0) buttons[active].scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  resizeObserver.observe(list);
  window.addEventListener("pagehide", () => {
    controller?.abort();
    observer.disconnect();
    resizeObserver.disconnect();
    thumbnailUrls.forEach((url) => URL.revokeObjectURL(url));
  }, { once: true });
  download.addEventListener("click", async () => {
    if (controller || !selected.size) return;
    controller = new AbortController();
    cancel.hidden = false;
    refresh();
    try {
      const blob = await createCaptureZip(images.filter((image) => selected.has(image.id)),
        (id) => getLibraryBundleImage(capture.id, id), {
          signal: controller.signal,
          onProgress: (done, total) => report(`Preparing ZIP: ${done} of ${total} images`, "success")
        });
      if (controller.signal.aborted) return;
      cancel.hidden = true;
      report("Saving ZIP to Downloads…", "success");
      await downloadBlob(blob, buildExportFilename(capture.title, "images", "zip"), { folder: "Lumen", saveAs: false });
      report("ZIP saved to Downloads. It contains the selected originals; editor changes are exported separately.", "success");
    } catch (error) { report(error.name === "AbortError" ? "ZIP cancelled. No archive was saved." : error.message, error.name === "AbortError" ? "success" : "error"); }
    finally { controller = null; cancel.hidden = true; refresh(); }
  });
  const note = document.createElement("small");
  note.textContent = "ZIP uses original captures. Export later edits separately. Cache: up to 40 images / 64 MB per capture; older sets may be cleared. Downloads stay on disk.";
  controls.append(label, all, none, download, cancel);
  panel.append(controls, list, note);
  host.prepend(panel);
  refresh();
  return { showFirst: () => view(0) };
}
