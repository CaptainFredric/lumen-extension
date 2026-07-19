import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const publicMirrors = [
  "404.html",
  "index.html",
  "privacy.html",
  "script.js",
  "styles.css",
  "review.html",
  "review.css",
  "review.js",
  "review-actions.js",
  "visual-diff-engine.js",
  "library-store.js",
  "config.js",
  "entitlements.js",
  "export-utils.js",
  "assets/hero-before.png",
  "assets/hero-after.png",
  "assets/lumen-product-demo-poster.png",
  "assets/lumen-product-demo.webm"
];
const siteRoots = [
  {
    name: "docs artifact root",
    root: path.join(repoRoot, "docs"),
    legacyDocsMode: "redirect",
    assetPath: "/assets/lumen-social-card.png",
    storeAssetPaths: [
      "/assets/store-control-surface.png",
      "/assets/store-annotation-studio.png",
      "/assets/store-visual-change-review.png",
      "/assets/store-responsive-set.png",
      "/assets/store-review-actions.png",
      "/assets/store-library-monitor.png",
      "/assets/hero-before.png",
      "/assets/hero-after.png"
    ]
  },
  {
    name: "repository root",
    root: repoRoot,
    legacyDocsMode: "landing",
    assetPath: "/assets/lumen-social-card.png",
    storeAssetPaths: [
      "/assets/store-control-surface.png",
      "/assets/store-annotation-studio.png",
      "/assets/store-visual-change-review.png",
      "/assets/store-responsive-set.png",
      "/assets/store-review-actions.png",
      "/assets/store-library-monitor.png",
      "/assets/hero-before.png",
      "/assets/hero-after.png"
    ]
  }
];
const results = [];

try {
  const mirrors = await verifyPublicMirrors();

  for (const target of siteRoots) {
    results.push(await runRouteChecks(target));
  }

  const liveReviewChecks = [];
  for (const target of siteRoots) {
    liveReviewChecks.push(await runLiveReviewCheck(target));
  }

  const browserChecks = await runBrowserChecks(repoRoot);

  console.log(JSON.stringify({
    ok: true,
    mirrors,
    results,
    liveReviewChecks,
    browserChecks
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    details: error.details || null
  }, null, 2));
  process.exitCode = 1;
}

async function verifyPublicMirrors() {
  const mirrors = [];

  for (const relativePath of publicMirrors) {
    const rootFile = path.join(repoRoot, relativePath);
    const docsFile = path.join(repoRoot, "docs", relativePath);
    const [rootBuffer, docsBuffer] = await Promise.all([
      readFile(rootFile),
      readFile(docsFile)
    ]);

    assert(rootBuffer.equals(docsBuffer), `Expected ${relativePath} to match docs/${relativePath}.`, {
      rootBytes: rootBuffer.byteLength,
      docsBytes: docsBuffer.byteLength,
      firstDifference: findFirstDifference(rootBuffer, docsBuffer)
    });

    mirrors.push({
      path: relativePath,
      bytes: rootBuffer.byteLength
    });
  }

  return mirrors;
}

async function runRouteChecks(target) {
  const fixture = await startStaticServer(target.root);

  try {
    const root = await fetchText(`${fixture.origin}/`);
    assert(root.status === 200, `Expected ${target.name} root route to load.`, root);
    assert(root.body.includes('id="hero-title"') && root.body.includes("Lumen shows what changed."), `Expected ${target.name} root route to serve the rebuilt Lumen landing page.`, {
      sample: root.body.slice(0, 240)
    });
    assert(root.body.includes("data-hero-comparison") && root.body.includes('id="heroReveal"'), `Expected ${target.name} landing page to include the interactive hero comparison.`, {
      sample: root.body.slice(0, 240)
    });
    assert(root.body.includes('src="assets/hero-before.png"') && root.body.includes('src="assets/hero-after.png"'), `Expected ${target.name} landing page to use the aligned demo pair.`, {
      sample: root.body.slice(0, 240)
    });
    assert(root.body.includes("data-shortcut-comparison") && root.body.includes('data-capture-path="shortcut"') && root.body.includes('data-capture-path="lumen"'), `Expected ${target.name} landing page to explain shortcut and Lumen use cases.`, {
      sample: root.body.slice(0, 240)
    });
    assert(root.body.includes("Open Lumen") && root.body.includes("Chrome’s toolbar"), `Expected ${target.name} landing page to describe the real toolbar entry point.`, {
      sample: root.body.slice(0, 240)
    });
    assert(root.body.includes("GoFullPage") && root.body.includes("FireShot"), `Expected ${target.name} landing page to include honest competitor positioning.`, {
      sample: root.body.slice(0, 240)
    });
    assert(root.body.includes('data-tour-tab="compare"') && root.body.includes('data-tour-tab="monitor"'), `Expected ${target.name} landing page to include the product workflow tour.`, {
      sample: root.body.slice(0, 240)
    });
    assert(root.body.includes('id="actual-app"') && root.body.includes("The extension is the actual app."), `Expected ${target.name} landing page to explain where the Lumen app lives.`, {
      sample: root.body.slice(0, 240)
    });
    assert(root.body.includes('href="review.html?demo=1"'), `Expected ${target.name} landing page to link to the live review app demo.`, {
      sample: root.body.slice(0, 240)
    });
    assert(
      root.body.includes('poster="assets/lumen-product-demo-poster.png"') &&
        root.body.includes('src="assets/lumen-product-demo.webm"') &&
        root.body.includes("Product tour"),
      `Expected ${target.name} landing page to embed the recorded extension tour.`,
      { sample: root.body.slice(0, 240) }
    );

    const privacy = await fetchText(`${fixture.origin}/privacy.html`);
    assert(privacy.status === 200, `Expected ${target.name} privacy route to load.`, privacy);
    assert(privacy.body.includes("Local-first capture, clear limits"), `Expected ${target.name} privacy route to serve the privacy page.`, {
      sample: privacy.body.slice(0, 240)
    });
    assert(privacy.body.includes("Limited Use requirements"), `Expected ${target.name} privacy route to include Limited Use disclosure.`, {
      sample: privacy.body.slice(0, 240)
    });

    const liveAppDemo = await fetchText(`${fixture.origin}/review.html?demo=1`);
    assert(liveAppDemo.status === 200, `Expected ${target.name} live app demo route to load.`, liveAppDemo);
    assert(liveAppDemo.body.includes("Lumen Visual Change Review"), `Expected ${target.name} live app route to serve the real review workspace.`, {
      sample: liveAppDemo.body.slice(0, 240)
    });

    const legacyDocs = await fetchText(`${fixture.origin}/docs/`);
    assert(legacyDocs.status === 200, `Expected ${target.name} legacy docs route to load.`, legacyDocs);

    if (target.legacyDocsMode === "redirect") {
      assert(legacyDocs.body.includes("Lumen moved to the root URL"), "Expected legacy docs route to explain the move.", {
        sample: legacyDocs.body.slice(0, 240)
      });
      assert(legacyDocs.body.includes("url=../"), "Expected legacy docs route to redirect one level up.", {
        sample: legacyDocs.body.slice(0, 240)
      });
    } else {
      assert(legacyDocs.body.includes('id="hero-title"') && legacyDocs.body.includes("Lumen shows what changed."), "Expected repository-root docs route to serve the rebuilt landing page.", {
        sample: legacyDocs.body.slice(0, 240)
      });

    }

    const notFound = await fetchText(`${fixture.origin}/missing-route`);
    assert(notFound.status === 404, `Expected ${target.name} missing routes to use the 404 page.`, notFound);
    assert(notFound.body.includes("/lumen-extension/"), `Expected ${target.name} 404 page to redirect to the public root URL.`, {
      sample: notFound.body.slice(0, 240)
    });

    const traversal = await fetchText(`${fixture.origin}/..%2fpackage.json`);
    assert(traversal.status === 403, `Expected ${target.name} encoded path traversal to be blocked.`, traversal);

    const socialCard = await fetchBytes(`${fixture.origin}${target.assetPath}`);
    assert(socialCard.status === 200, `Expected ${target.name} social image asset to load.`, socialCard);
    assert(socialCard.bytes > 1024, `Expected ${target.name} social image asset to contain data.`, socialCard);

    const demoPoster = await fetchBytes(`${fixture.origin}/assets/lumen-product-demo-poster.png`);
    const demoVideo = await fetchBytes(`${fixture.origin}/assets/lumen-product-demo.webm`);
    assert(demoPoster.status === 200 && demoPoster.bytes > 100_000, `Expected ${target.name} product-tour poster to load.`, demoPoster);
    assert(demoVideo.status === 200 && demoVideo.bytes > 1_000_000, `Expected ${target.name} product-tour video to load.`, demoVideo);

    for (const storeAssetPath of target.storeAssetPaths) {
      const storeAsset = await fetchBytes(`${fixture.origin}${storeAssetPath}`);
      assert(storeAsset.status === 200, `Expected ${target.name} store screenshot asset to load.`, {
        storeAssetPath,
        ...storeAsset
      });
      assert(storeAsset.bytes > 1024, `Expected ${target.name} store screenshot asset to contain data.`, {
        storeAssetPath,
        ...storeAsset
      });
    }

    return {
      name: target.name,
      origin: fixture.origin,
      checks: [
        "/",
        "/privacy.html",
        "/review.html?demo=1",
        "/docs/",
        "/missing-route",
        "/..%2fpackage.json",
        target.assetPath,
        "/assets/lumen-product-demo-poster.png",
        "/assets/lumen-product-demo.webm",
        ...target.storeAssetPaths
      ]
    };
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

async function runLiveReviewCheck(target) {
  const fixture = await startStaticServer(target.root);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const runtimeErrors = [];

  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });

  try {
    await page.goto(`${fixture.origin}/review.html?demo=1`, { waitUntil: "networkidle" });
    await page.locator("#reviewContent:not(.is-hidden)").waitFor();
    await page.locator("#regionList .region-button").first().waitFor();

    const navigation = await page.locator('a[href="index.html#actual-app"]').count();
    assert(navigation >= 3, `${target.name} public demo left extension-only navigation routes in place.`, { navigation });

    const editorButton = page.getByRole("button", { name: "Editor in extension" });
    assert(await editorButton.isDisabled(), `${target.name} public demo exposed a broken in-memory editor route.`);

    await page.locator("#revealSlider").fill("68");
    assert(await page.locator("#revealOutput").textContent() === "68% after", `${target.name} reveal slider did not update.`);
    await page.locator("#regionList .region-button").first().click();

    const pngDownload = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export PNG" }).click()
    ]).then(([download]) => download);
    assert(pngDownload.suggestedFilename().endsWith(".png"), `${target.name} public demo did not export PNG.`);

    const pdfDownload = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export PDF" }).click()
    ]).then(([download]) => download);
    assert(pdfDownload.suggestedFilename().endsWith(".pdf"), `${target.name} public demo did not export PDF.`);

    await page.getByRole("button", { name: "Mark reviewed" }).click();
    assert(await page.getByRole("button", { name: "Reviewed" }).isVisible(), `${target.name} review action did not complete.`);
    assert(runtimeErrors.length === 0, `${target.name} live review demo emitted runtime errors.`, runtimeErrors);

    return {
      name: target.name,
      route: "/review.html?demo=1",
      navigationRewritten: true,
      slider: true,
      regionJump: true,
      pngExport: pngDownload.suggestedFilename(),
      pdfExport: pdfDownload.suggestedFilename(),
      reviewed: true
    };
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

async function runBrowserChecks(siteRoot) {
  const fixture = await startStaticServer(siteRoot);
  const browser = await chromium.launch({ headless: true });
  const viewports = [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 1000 }
  ];
  const checks = [];

  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      const runtimeErrors = [];

      page.on("pageerror", (error) => runtimeErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") {
          runtimeErrors.push(message.text());
        }
      });

      await page.goto(`${fixture.origin}/`, { waitUntil: "networkidle" });

      const initial = await page.evaluate(() => {
        const before = document.querySelector('img[src="assets/hero-before.png"]');
        const after = document.querySelector('img[src="assets/hero-after.png"]');
        const stage = document.querySelector("[data-hero-comparison-stage]");
        const slider = document.querySelector("#heroReveal");
        const label = document.querySelector('label[for="heroReveal"]');
        const activeTourImage = document.querySelector('[data-tour-panel="capture"] img');
        const reliabilityImage = document.querySelector(".reliability-visual img");
        const productTour = document.querySelector(".app-demo-frame video");

        return {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          before: before ? [before.complete, before.naturalWidth, before.naturalHeight] : null,
          after: after ? [after.complete, after.naturalWidth, after.naturalHeight] : null,
          divider: stage ? getComputedStyle(stage).getPropertyValue("--divider").trim() : null,
          sliderValue: slider?.value || null,
          sliderLabel: label?.textContent?.trim() || null,
          activeTourImage: activeTourImage
            ? [activeTourImage.loading, activeTourImage.complete, activeTourImage.naturalWidth, activeTourImage.naturalHeight]
            : null,
          reliabilityImage: reliabilityImage
            ? [reliabilityImage.loading, reliabilityImage.complete, reliabilityImage.naturalWidth, reliabilityImage.naturalHeight]
            : null,
          changeRegions: document.querySelectorAll(".change-box").length,
          liveAppLinks: document.querySelectorAll('a[href="review.html?demo=1"]').length,
          productTour: productTour
            ? [productTour.controls, productTour.preload, productTour.getAttribute("poster"), productTour.querySelector("source")?.getAttribute("src")]
            : null,
          shortcutPaths: document.querySelectorAll("[data-capture-path]").length,
          bodyText: document.body.innerText
        };
      });

      assert(initial.scrollWidth === initial.clientWidth, `Expected ${viewport.width}px landing page to avoid horizontal overflow.`, initial);
      assert(JSON.stringify(initial.before) === JSON.stringify([true, 1136, 710]), `Expected ${viewport.width}px before image to decode at its aligned dimensions.`, initial);
      assert(JSON.stringify(initial.after) === JSON.stringify([true, 1136, 710]), `Expected ${viewport.width}px after image to decode at its aligned dimensions.`, initial);
      assert(initial.divider === "48%" && initial.sliderValue === "48", `Expected ${viewport.width}px comparison divider to match its slider thumb.`, initial);
      assert(initial.sliderLabel === "Move the divider to compare captures", `Expected ${viewport.width}px comparison slider to have a visible associated label.`, initial);
      assert(initial.changeRegions === 6, `Expected ${viewport.width}px demo to draw all six reported changed regions.`, initial);
      assert(initial.liveAppLinks >= 2, `Expected ${viewport.width}px page to offer the live app demo from the hero and app section.`, initial);
      assert(
        JSON.stringify(initial.productTour) === JSON.stringify([true, "metadata", "assets/lumen-product-demo-poster.png", "assets/lumen-product-demo.webm"]),
        `Expected ${viewport.width}px page to expose a user-controlled, bandwidth-conscious product tour.`,
        initial
      );
      assert(initial.shortcutPaths === 2, `Expected ${viewport.width}px page to present distinct shortcut and Lumen paths.`, initial);
      assert(initial.bodyText.includes("Open Lumen") && initial.bodyText.includes("Chrome’s toolbar"), `Expected ${viewport.width}px page to explain the toolbar entry point.`, initial);
      assert(initial.bodyText.includes("GoFullPage") && initial.bodyText.includes("FireShot"), `Expected ${viewport.width}px page to include competitor positioning.`, initial);
      assert(initial.activeTourImage?.[0] === "lazy", `Expected ${viewport.width}px tour proof to preserve initial-load bandwidth.`, initial);
      assert(initial.reliabilityImage?.[0] === "lazy", `Expected ${viewport.width}px reliability proof to preserve initial-load bandwidth.`, initial);

      const slider = page.locator("#heroReveal");
      const output = page.locator("[data-hero-output]");
      const stage = page.locator("[data-hero-comparison-stage]");

      await slider.fill("0");
      assert(await output.textContent() === "0% before · 100% after", `Expected ${viewport.width}px comparison output to update at the left edge.`);
      assert(await stage.evaluate((element) => getComputedStyle(element).getPropertyValue("--divider").trim()) === "0%", `Expected ${viewport.width}px comparison divider to meet the slider at the left edge.`);

      await slider.fill("100");
      assert(await output.textContent() === "100% before · 0% after", `Expected ${viewport.width}px comparison output to update at the right edge.`);
      assert(await stage.evaluate((element) => getComputedStyle(element).getPropertyValue("--divider").trim()) === "100%", `Expected ${viewport.width}px comparison divider to meet the slider at the right edge.`);

      await slider.focus();
      await slider.press("Home");
      assert(await slider.getAttribute("aria-valuetext") === "0% before, 100% after", `Expected ${viewport.width}px Home key to move the divider left.`);
      await slider.press("End");
      assert(await slider.getAttribute("aria-valuetext") === "100% before, 0% after", `Expected ${viewport.width}px End key to move the divider right.`);
      await slider.fill("48");

      const activeTourProof = page.locator('[data-tour-panel="capture"] img');
      await activeTourProof.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const image = document.querySelector('[data-tour-panel="capture"] img');
        return Boolean(image?.complete && image.naturalWidth > 1000);
      });

      const reliabilityProof = page.locator(".reliability-visual img");
      await reliabilityProof.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const image = document.querySelector(".reliability-visual img");
        return Boolean(image?.complete && image.naturalWidth > 1000);
      });

      if (viewport.width <= 390) {
        const boundedControls = await page.evaluate(() => {
          const selectors = ["#heroReveal", "[data-hero-output]", ".key-groups"];
          return selectors.map((selector) => {
            const rect = document.querySelector(selector)?.getBoundingClientRect();
            return rect ? { selector, left: rect.left, right: rect.right } : null;
          });
        });

        assert(boundedControls.every((control) => control && control.left >= 0 && control.right <= viewport.width), `Expected ${viewport.width}px comparison and shortcut controls to remain inside the viewport.`, boundedControls);
      }

      if (viewport.width === 1440) {
        const compareTab = page.locator('[data-tour-tab="compare"]');
        await compareTab.click();
        assert(await compareTab.getAttribute("aria-selected") === "true", "Expected comparison tour tab to activate by click.");
        assert(await page.locator('[data-tour-panel="compare"]').isVisible(), "Expected comparison tour panel to become visible.");
        await compareTab.press("ArrowRight");
        assert(await page.locator('[data-tour-tab="monitor"]').getAttribute("aria-selected") === "true", "Expected tour arrow-key navigation to activate Monitor.");
      }

      assert(runtimeErrors.length === 0, `Expected ${viewport.width}px landing page to avoid console and runtime errors.`, runtimeErrors);
      checks.push({
        viewport: `${viewport.width}x${viewport.height}`,
        noOverflow: true,
        alignedDemoPair: true,
        keyboardComparison: true,
        runtimeErrors: runtimeErrors.length
      });

      await page.close();
    }

    return checks;
  } finally {
    await browser.close();
    await new Promise((resolve) => fixture.server.close(resolve));
  }
}

async function startStaticServer(siteRoot) {
  const serverInstance = createServer(async (request, response) => {
    try {
      const filePath = resolveFilePath(request.url || "/", siteRoot);

      if (!filePath) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      const file = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": getContentType(filePath)
      });
      response.end(file);
    } catch (error) {
      if (error?.code === "ENOENT") {
        const fallback = await readFile(path.join(siteRoot, "404.html"));
        response.writeHead(404, {
          "Content-Type": "text/html; charset=utf-8"
        });
        response.end(fallback);
        return;
      }

      response.writeHead(500);
      response.end("Internal Server Error");
    }
  });

  await new Promise((resolve) => serverInstance.listen(0, "127.0.0.1", resolve));
  const address = serverInstance.address();

  return {
    server: serverInstance,
    origin: `http://127.0.0.1:${address.port}`,
    siteRoot
  };
}

function resolveFilePath(requestUrl, siteRoot) {
  const url = new URL(requestUrl, "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const withIndex = normalized.endsWith("/") ? `${normalized}index.html` : normalized;
  const filePath = path.resolve(siteRoot, `.${withIndex}`);

  return isInsideRoot(siteRoot, filePath) ? filePath : null;
}

async function fetchText(url) {
  const response = await fetch(url);

  return {
    status: response.status,
    body: await response.text()
  };
}

async function fetchBytes(url) {
  const response = await fetch(url);

  return {
    status: response.status,
    bytes: (await response.arrayBuffer()).byteLength
  };
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".html") {
    return "text/html; charset=utf-8";
  }

  if (ext === ".css") {
    return "text/css; charset=utf-8";
  }

  if (ext === ".js") {
    return "text/javascript; charset=utf-8";
  }

  if (ext === ".png") {
    return "image/png";
  }

  if (ext === ".svg") {
    return "image/svg+xml";
  }

  if (ext === ".json") {
    return "application/json; charset=utf-8";
  }

  return "application/octet-stream";
}

function isInsideRoot(root, targetPath) {
  const relative = path.relative(root, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function findFirstDifference(left, right) {
  const limit = Math.min(left.byteLength, right.byteLength);

  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) {
      return index;
    }
  }

  return left.byteLength === right.byteLength ? -1 : limit;
}

function assert(condition, message, details = null) {
  if (condition) {
    return;
  }

  const error = new Error(message);
  error.details = details;
  throw error;
}
