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
    { rootMargin: "0px 0px -4%", threshold: 0.08 }
  );

  for (const target of revealTargets) {
    revealObserver.observe(target);
  }
} else {
  for (const target of revealTargets) {
    target.classList.add("is-visible");
  }
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
