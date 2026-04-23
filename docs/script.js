const canReveal = "IntersectionObserver" in window;

if (canReveal) {
  document.documentElement.classList.add("js-ready");
}

const revealNodes = [...document.querySelectorAll("[data-reveal]")];
const workflowSteps = [...document.querySelectorAll(".workflow-step")];
const workflowVisual = document.querySelector(".workflow-visual");
const tiltNode = document.querySelector("[data-tilt]");

if (canReveal) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
        }
      }
    },
    {
      threshold: 0.14
    }
  );

  for (const node of revealNodes) {
    revealObserver.observe(node);
  }

  const workflowObserver = new IntersectionObserver(
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
      threshold: 0.5
    }
  );

  for (const step of workflowSteps) {
    workflowObserver.observe(step);
  }
} else {
  for (const node of revealNodes) {
    node.classList.add("is-visible");
  }
}

if (
  tiltNode &&
  window.matchMedia("(prefers-reduced-motion: no-preference)").matches &&
  window.matchMedia("(pointer: fine)").matches
) {
  tiltNode.addEventListener("pointermove", (event) => {
    const bounds = tiltNode.getBoundingClientRect();
    const offsetX = (event.clientX - bounds.left) / bounds.width - 0.5;
    const offsetY = (event.clientY - bounds.top) / bounds.height - 0.5;
    const rotateX = offsetY * -3.6;
    const rotateY = offsetX * 5.2;

    tiltNode.style.transform = `perspective(1500px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  });

  tiltNode.addEventListener("pointerleave", () => {
    tiltNode.style.transform = "perspective(1500px) rotateX(0deg) rotateY(0deg)";
  });
}
