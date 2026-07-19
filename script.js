const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealTargets = [...document.querySelectorAll("[data-reveal]")];

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
    { rootMargin: "0px 0px -5%", threshold: 0.08 }
  );

  for (const target of revealTargets) {
    revealObserver.observe(target);
  }
} else {
  for (const target of revealTargets) {
    target.classList.add("is-visible");
  }
}

const heroComparison = document.querySelector("[data-hero-comparison]");
const heroComparisonStage = heroComparison?.querySelector("[data-hero-comparison-stage]");
const heroSlider = heroComparison?.querySelector("[data-hero-slider]");
const heroOutput = heroComparison?.querySelector("[data-hero-output]");

function updateHeroComparison(rawValue) {
  if (!heroComparisonStage || !heroSlider || !heroOutput) {
    return;
  }

  const beforePercent = Math.min(100, Math.max(0, Number(rawValue) || 0));
  const afterPercent = 100 - beforePercent;
  const label = `${beforePercent}% before, ${afterPercent}% after`;

  heroComparisonStage.style.setProperty("--divider", `${beforePercent}%`);
  heroSlider.value = String(beforePercent);
  heroSlider.setAttribute("aria-valuetext", label);
  heroOutput.textContent = `${beforePercent}% before · ${afterPercent}% after`;
}

if (heroSlider) {
  updateHeroComparison(heroSlider.value);
  heroSlider.addEventListener("input", () => updateHeroComparison(heroSlider.value));
  heroSlider.addEventListener("keydown", (event) => {
    const currentValue = Number(heroSlider.value);
    let nextValue = currentValue;

    if (event.key === "Home") {
      nextValue = 0;
    } else if (event.key === "End") {
      nextValue = 100;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextValue = currentValue - 1;
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextValue = currentValue + 1;
    } else {
      return;
    }

    event.preventDefault();
    updateHeroComparison(nextValue);
  });
}

const tour = document.querySelector("[data-tour]");
const tourTabs = [...document.querySelectorAll("[data-tour-tab]")];
const tourPanels = [...document.querySelectorAll("[data-tour-panel]")];

function selectTourTab(selectedTab, { moveFocus = false } = {}) {
  if (!tour || !selectedTab) {
    return;
  }

  const selectedId = selectedTab.dataset.tourTab;

  for (const tab of tourTabs) {
    const isSelected = tab === selectedTab;
    tab.setAttribute("aria-selected", String(isSelected));
    tab.tabIndex = isSelected ? 0 : -1;
  }

  for (const panel of tourPanels) {
    panel.hidden = panel.dataset.tourPanel !== selectedId;
  }

  tour.dataset.activeTour = selectedId || "capture";

  if (moveFocus) {
    selectedTab.focus();
  }
}

for (const tab of tourTabs) {
  tab.addEventListener("click", () => selectTourTab(tab));
  tab.addEventListener("keydown", (event) => {
    const currentIndex = tourTabs.indexOf(tab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % tourTabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + tourTabs.length) % tourTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tourTabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    selectTourTab(tourTabs[nextIndex], { moveFocus: true });
  });
}

const navLinks = [...document.querySelectorAll('.site-nav a[href^="#"]')];
const navSections = navLinks
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

      for (const link of navLinks) {
        const isCurrent = link.getAttribute("href") === `#${visible.target.id}`;

        if (isCurrent) {
          link.setAttribute("aria-current", "true");
        } else {
          link.removeAttribute("aria-current");
        }
      }
    },
    { rootMargin: "-18% 0px -66%", threshold: [0, 0.2, 0.5] }
  );

  for (const section of navSections) {
    sectionObserver.observe(section);
  }
}
