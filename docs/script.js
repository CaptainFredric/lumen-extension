// Navigation is progressive enhancement. All content and actions work without it.
const gardenFrame = document.querySelector("#garden-frame");
if (gardenFrame) {
  document.querySelector(".sample-tabs").hidden = false;
  let width = 1280;
  const views = {
    1280: ["Desktop", "Desktop: the address and continue button fit."],
    768: ["Tablet", "Tablet: the coupon overlaps the shipping address."],
    390: ["Mobile", "Mobile: the continue button clips inside the order card."],
  };
  const fit = () => {
    const scale = Math.min(1, gardenFrame.parentElement.clientWidth / width);
    gardenFrame.style.width = `${width}px`;
    gardenFrame.style.transform = `scale(${scale})`;
    gardenFrame.parentElement.style.height = `${780 * scale}px`;
  };
  for (const button of document.querySelectorAll("[data-viewport]")) {
    button.addEventListener("click", () => {
      width = Number(button.dataset.viewport);
      document.querySelectorAll("[data-viewport]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      document.querySelector("#garden-label").textContent = `${width} px / ${views[width][0]}`;
      document.querySelector("#garden-note").textContent = views[width][1];
      fit();
    });
  }
  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(gardenFrame.parentElement);
  else window.addEventListener("resize", fit);
  fit();
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
