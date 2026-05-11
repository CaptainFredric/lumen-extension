const canReveal = "IntersectionObserver" in window;

if (canReveal) {
  document.documentElement.classList.add("js-ready");
}

const revealNodes = [...document.querySelectorAll("[data-reveal]")];
const workflowSteps = [...document.querySelectorAll(".workflow-step")];
const workflowVisual = document.querySelector(".workflow-visual");
const tiltNode = document.querySelector("[data-tilt]");
const demoLaunch = document.querySelector("[data-demo-launch]");
const demoHoldButton = document.querySelector("[data-demo-hold-button]");
const demoHoldMenu = document.querySelector(".demo-hold-menu");
const demoStatusTitle = document.querySelector("[data-demo-status-title]");
const demoStatusDetail = document.querySelector("[data-demo-status-detail]");

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

if (demoLaunch && demoHoldButton && demoHoldMenu) {
  let holdTimer = null;
  let suppressClick = false;

  const setDemoStatus = (title, detail) => {
    if (demoStatusTitle) {
      demoStatusTitle.textContent = title;
    }

    if (demoStatusDetail) {
      demoStatusDetail.textContent = detail;
    }
  };

  const openDemoMenu = () => {
    demoLaunch.classList.add("is-menu-open");
    demoHoldMenu.setAttribute("aria-hidden", "false");
    demoHoldButton.setAttribute("aria-expanded", "true");
    setDemoStatus("Hold menu ready", "Choose responsive, redaction, boxes, or cutaway.");
    suppressClick = true;
    window.setTimeout(() => {
      suppressClick = false;
    }, 360);
  };

  const closeDemoMenu = () => {
    demoLaunch.classList.remove("is-menu-open");
    demoHoldMenu.setAttribute("aria-hidden", "true");
    demoHoldButton.setAttribute("aria-expanded", "false");
    setDemoStatus("captainfredric.github.io ready", "Hold capture to choose a focused action.");
  };

  const startDemoHold = () => {
    window.clearTimeout(holdTimer);
    demoLaunch.classList.add("is-holding");
    setDemoStatus("Hold to open actions", "Release after the menu appears.");
    holdTimer = window.setTimeout(openDemoMenu, 520);
  };

  const endDemoHold = () => {
    window.clearTimeout(holdTimer);
    demoLaunch.classList.remove("is-holding");

    if (!demoLaunch.classList.contains("is-menu-open")) {
      setDemoStatus("captainfredric.github.io ready", "Hold capture to choose a focused action.");
    }
  };

  demoHoldButton.addEventListener("pointerdown", startDemoHold);
  demoHoldButton.addEventListener("pointerup", endDemoHold);
  demoHoldButton.addEventListener("pointercancel", endDemoHold);
  demoHoldButton.addEventListener("pointerleave", endDemoHold);

  demoHoldButton.addEventListener("click", () => {
    if (suppressClick) {
      return;
    }

    if (demoLaunch.classList.contains("is-menu-open")) {
      closeDemoMenu();
    } else {
      openDemoMenu();
    }
  });

  demoHoldButton.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    openDemoMenu();
  });

  document.addEventListener("pointerdown", (event) => {
    if (demoLaunch.contains(event.target)) {
      return;
    }

    closeDemoMenu();
  });
}
