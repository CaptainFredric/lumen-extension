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
const cleanupDemo = document.querySelector("[data-cleanup-demo]");
const cleanupReplay = document.querySelector("[data-cleanup-replay]");
const cleanupModeButtons = [...document.querySelectorAll("[data-cleanup-mode]")];

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
  let tiltFrame = 0;
  let targetRotateX = 0;
  let targetRotateY = 0;
  let currentRotateX = 0;
  let currentRotateY = 0;

  const renderTilt = () => {
    currentRotateX += (targetRotateX - currentRotateX) * 0.16;
    currentRotateY += (targetRotateY - currentRotateY) * 0.16;

    tiltNode.style.setProperty("--tilt-x", `${currentRotateX.toFixed(3)}deg`);
    tiltNode.style.setProperty("--tilt-y", `${currentRotateY.toFixed(3)}deg`);

    if (Math.abs(targetRotateX - currentRotateX) > 0.01 || Math.abs(targetRotateY - currentRotateY) > 0.01) {
      tiltFrame = window.requestAnimationFrame(renderTilt);
    } else {
      tiltFrame = 0;
    }
  };

  const requestTiltFrame = () => {
    if (!tiltFrame) {
      tiltFrame = window.requestAnimationFrame(renderTilt);
    }
  };

  tiltNode.addEventListener("pointermove", (event) => {
    const bounds = tiltNode.getBoundingClientRect();
    const offsetX = (event.clientX - bounds.left) / bounds.width - 0.5;
    const offsetY = (event.clientY - bounds.top) / bounds.height - 0.5;

    targetRotateX = Math.max(-3.2, Math.min(3.2, offsetY * -5.2));
    targetRotateY = Math.max(-4.8, Math.min(4.8, offsetX * 7.2));
    tiltNode.style.setProperty("--tilt-glare-x", `${Math.round((offsetX + 0.5) * 100)}%`);
    tiltNode.style.setProperty("--tilt-glare-y", `${Math.round((offsetY + 0.5) * 100)}%`);
    requestTiltFrame();
  });

  tiltNode.addEventListener("pointerleave", () => {
    targetRotateX = 0;
    targetRotateY = 0;
    requestTiltFrame();
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
    setDemoStatus("Capture actions ready", "Choose a responsive set, redaction scan, lasso, callout, or signals.");
    suppressClick = true;
    window.setTimeout(() => {
      suppressClick = false;
    }, 360);
  };

  const closeDemoMenu = () => {
    demoLaunch.classList.remove("is-menu-open");
    demoHoldMenu.setAttribute("aria-hidden", "true");
    demoHoldButton.setAttribute("aria-expanded", "false");
    setDemoStatus("example.com ready", "Choose the capture you need.");
  };

  const startDemoHold = () => {
    window.clearTimeout(holdTimer);
    demoLaunch.classList.add("is-holding");
    setDemoStatus("Opening capture actions", "Release when the action menu appears.");
    holdTimer = window.setTimeout(openDemoMenu, 520);
  };

  const endDemoHold = () => {
    window.clearTimeout(holdTimer);
    demoLaunch.classList.remove("is-holding");

    if (!demoLaunch.classList.contains("is-menu-open")) {
      setDemoStatus("example.com ready", "Choose the capture you need.");
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

if (cleanupDemo && cleanupReplay) {
  cleanupReplay.addEventListener("click", () => {
    cleanupDemo.removeAttribute("data-cleanup-state");
    for (const button of cleanupModeButtons) {
      button.classList.remove("is-active");
    }

    cleanupDemo.classList.remove("is-running");
    cleanupDemo.classList.add("is-replaying");

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        cleanupDemo.classList.add("is-running");
      });
    });
  });
}

if (cleanupDemo && cleanupModeButtons.length) {
  for (const button of cleanupModeButtons) {
    button.addEventListener("click", () => {
      cleanupDemo.classList.remove("is-replaying", "is-running");
      cleanupDemo.dataset.cleanupState = button.dataset.cleanupMode || "cluttered";

      for (const modeButton of cleanupModeButtons) {
        modeButton.classList.toggle("is-active", modeButton === button);
      }
    });
  }
}
