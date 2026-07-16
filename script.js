const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealTargets = [...document.querySelectorAll("[data-reveal]")];
const header = document.querySelector("[data-header]");
const demo = document.querySelector("[data-demo]");
const demoButtons = [...document.querySelectorAll("[data-mode]")];
const demoTitle = document.querySelector("[data-demo-title]");
const demoCoverage = document.querySelector("[data-demo-coverage]");
const demoStep = document.querySelector(".demo-step-icon");
const demoStates = [
  { id: "capture", title: "Page prepared", coverage: "Scanning…", step: "1" },
  { id: "protect", title: "Details protected", coverage: "11 segments", step: "2" },
  { id: "verify", title: "Capture complete", coverage: "100%", step: "✓" }
];

if ("IntersectionObserver" in window && !reducedMotion) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }

        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8%", threshold: 0.1 }
  );

  for (const target of revealTargets) {
    revealObserver.observe(target);
  }
} else {
  for (const target of revealTargets) {
    target.classList.add("is-visible");
  }
}

function updateHeader() {
  header?.classList.toggle("is-scrolled", window.scrollY > 24);
}

updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

function setDemoState(stateId) {
  if (!demo) {
    return;
  }

  const stateIndex = demoStates.findIndex((state) => state.id === stateId);

  if (stateIndex === -1) {
    return;
  }

  const state = demoStates[stateIndex];
  demo.dataset.state = state.id;

  if (demoTitle) {
    demoTitle.textContent = state.title;
  }

  if (demoCoverage) {
    demoCoverage.textContent = state.coverage;
  }

  if (demoStep) {
    demoStep.textContent = state.step;
  }

  for (const button of demoButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === state.id));
  }
}

for (const button of demoButtons) {
  button.addEventListener("click", () => {
    setDemoState(button.dataset.mode || demoStates[0].id);
  });
}

const localNavLinks = [...document.querySelectorAll('.site-nav a[href^="#"]')];
const navSections = localNavLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

if ("IntersectionObserver" in window && navSections.length) {
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

      if (!visible) {
        return;
      }

      for (const link of localNavLinks) {
        const isCurrent = link.getAttribute("href") === `#${visible.target.id}`;

        if (isCurrent) {
          link.setAttribute("aria-current", "true");
        } else {
          link.removeAttribute("aria-current");
        }
      }
    },
    { rootMargin: "-20% 0px -68%", threshold: [0, 0.25, 0.5] }
  );

  for (const section of navSections) {
    sectionObserver.observe(section);
  }
}
