// Navigation is progressive enhancement. All content and actions work without it.
const sampleImage = document.querySelector("#sample-image");
const sampleLinks = [...document.querySelectorAll("[data-sample]")];
if (sampleImage) {
  let sampleRequest = 0;
  for (const link of sampleLinks) {
    link.addEventListener("click", async (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const request = ++sampleRequest;
      const next = new Image();
      next.src = link.href;
      try {
        await next.decode();
        if (request !== sampleRequest) return;
        sampleImage.src = next.src;
        sampleImage.width = next.naturalWidth;
        sampleImage.height = next.naturalHeight;
        sampleImage.alt = `${link.dataset.sample} capture of the Orbit sample page`;
        sampleImage.parentElement.dataset.view = link.dataset.sample;
        sampleImage.parentElement.scrollTop = 0;
        document.querySelector("#sample-original").href = link.href;
        document.querySelector("#sample-label").textContent = `${link.dataset.sample} sample`;
        sampleLinks.forEach((item) => item === link ? item.setAttribute("aria-current", "true") : item.removeAttribute("aria-current"));
      } catch {
        if (request === sampleRequest) document.querySelector("#sample-label").textContent = "Image unavailable. Use the original image link to retry.";
      }
    });
  }
}

const navLinks = [...document.querySelectorAll('.site-nav a[href^="#"]')];
const sections = navLinks
  .map((link) => document.getElementById(link.hash.slice(1)))
  .filter(Boolean);

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      const current = entries.find((entry) => entry.isIntersecting);
      if (!current) return;
      for (const link of navLinks) {
        if (link.hash === `#${current.target.id}`)
          link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
    },
    { rootMargin: "-10% 0px -65%" },
  );
  sections.forEach((section) => observer.observe(section));
}

const previewLink = document.querySelector(".editor-image-link");
const preview = document.querySelector("#editor-preview");
const zoomButton = document.querySelector("[data-preview-zoom]");

if (previewLink && typeof preview?.showModal === "function") {
  previewLink.setAttribute("aria-haspopup", "dialog");
  previewLink.setAttribute("aria-controls", preview.id);
  previewLink.addEventListener("click", (event) => {
    // Preserve normal open-in-new-tab gestures and the no-JavaScript image link.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    preview.showModal();
  });
  zoomButton.addEventListener("click", () => {
    const zoomed = preview.classList.toggle("is-zoomed");
    zoomButton.setAttribute("aria-pressed", String(zoomed));
    zoomButton.textContent = zoomed ? "Fit to window" : "Actual size";
  });
  preview.addEventListener("close", () => {
    preview.classList.remove("is-zoomed");
    zoomButton.setAttribute("aria-pressed", "false");
    zoomButton.textContent = "Actual size";
    previewLink.focus({ preventScroll: true });
  });
}

const copySetup = document.querySelector("[data-copy-setup]");
const setupFeedback = document.querySelector("#setup-feedback");
if (copySetup && navigator.clipboard?.writeText) {
  copySetup.hidden = false;
  copySetup.addEventListener("click", async () => {
    copySetup.disabled = true;
    try {
      await navigator.clipboard.writeText("chrome://extensions");
      setupFeedback.textContent =
        "Copied. Paste it into Chrome's address bar to open extension setup.";
    } catch {
      setupFeedback.textContent =
        "Copy was blocked. Type chrome://extensions into Chrome's address bar instead.";
    } finally {
      copySetup.disabled = false;
    }
  });
}
