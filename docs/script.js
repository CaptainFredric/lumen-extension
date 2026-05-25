const revealTargets = [...document.querySelectorAll("[data-reveal]")];
const demo = document.querySelector("[data-demo]");
const demoButtons = [...document.querySelectorAll("[data-mode]")];
const tiltTargets = [...document.querySelectorAll("[data-tilt]")];
const demoModes = ["messy", "clean", "ready"];
const shouldRotateDemo =
  demo &&
  window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
let demoModeIndex = 0;
let demoRotationTimer;

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.16 }
  );

  for (const target of revealTargets) {
    observer.observe(target);
  }
} else {
  for (const target of revealTargets) {
    target.classList.add("is-visible");
  }
}

function setDemoMode(mode) {
  if (!demo) {
    return;
  }

  demo.classList.toggle("is-clean", mode === "clean" || mode === "ready");
  demo.classList.toggle("is-ready", mode === "ready");

  for (const button of demoButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  }

  const nextIndex = demoModes.indexOf(mode);

  if (nextIndex !== -1) {
    demoModeIndex = nextIndex;
  }
}

function queueDemoRotation(delay = 3600) {
  if (!shouldRotateDemo) {
    return;
  }

  window.clearTimeout(demoRotationTimer);
  demoRotationTimer = window.setTimeout(() => {
    demoModeIndex = (demoModeIndex + 1) % demoModes.length;
    setDemoMode(demoModes[demoModeIndex]);
    queueDemoRotation();
  }, delay);
}

for (const button of demoButtons) {
  button.addEventListener("click", () => {
    setDemoMode(button.dataset.mode || demoModes[0]);
    queueDemoRotation(7200);
  });
}

queueDemoRotation();

if (
  tiltTargets.length &&
  window.matchMedia("(prefers-reduced-motion: no-preference)").matches &&
  window.matchMedia("(pointer: fine)").matches
) {
  for (const target of tiltTargets) {
    target.addEventListener("pointermove", (event) => {
      const bounds = target.getBoundingClientRect();
      const offsetX = (event.clientX - bounds.left) / bounds.width - 0.5;
      const offsetY = (event.clientY - bounds.top) / bounds.height - 0.5;

      target.style.setProperty("--tilt-x", `${Math.max(-3, Math.min(3, offsetY * -6)).toFixed(2)}deg`);
      target.style.setProperty("--tilt-y", `${Math.max(-4, Math.min(4, offsetX * 8)).toFixed(2)}deg`);
    });

    target.addEventListener("pointerleave", () => {
      target.style.setProperty("--tilt-x", "0deg");
      target.style.setProperty("--tilt-y", "0deg");
    });
  }
}
