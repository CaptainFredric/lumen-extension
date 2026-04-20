const revealNodes = document.querySelectorAll("[data-reveal]");
const workflowSteps = [...document.querySelectorAll(".workflow-step")];
const workflowVisual = document.querySelector(".workflow-visual");
const tiltNode = document.querySelector("[data-tilt]");

const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
      }
    }
  },
  {
    threshold: 0.16
  }
);

for (const node of revealNodes) {
  revealObserver.observe(node);
}

const stepObserver = new IntersectionObserver(
  (entries) => {
    const activeEntry = entries
      .filter((entry) => entry.isIntersecting)
      .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

    if (!activeEntry) {
      return;
    }

    const step = activeEntry.target.dataset.step;

    for (const node of workflowSteps) {
      node.classList.toggle("is-active", node.dataset.step === step);
    }

    if (workflowVisual) {
      workflowVisual.dataset.activeStep = step;
    }
  },
  {
    threshold: 0.55
  }
);

for (const step of workflowSteps) {
  stepObserver.observe(step);
}

if (tiltNode && window.matchMedia("(prefers-reduced-motion: no-preference)").matches) {
  tiltNode.addEventListener("pointermove", (event) => {
    const bounds = tiltNode.getBoundingClientRect();
    const offsetX = (event.clientX - bounds.left) / bounds.width - 0.5;
    const offsetY = (event.clientY - bounds.top) / bounds.height - 0.5;
    const rotateX = offsetY * -5;
    const rotateY = offsetX * 7;

    tiltNode.style.transform = `perspective(1400px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  });

  tiltNode.addEventListener("pointerleave", () => {
    tiltNode.style.transform = "perspective(1400px) rotateX(0deg) rotateY(0deg)";
  });
}
