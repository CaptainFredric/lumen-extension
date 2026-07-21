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
  "brandmark.svg",
  "assets/brandmark-512.png",
  "assets/lumen-social-card.png",
  "assets/hero-after.png",
  "assets/store-control-surface.png"
];
const PRIMARY_CTA_URL = "https://github.com/CaptainFredric/lumen-extension#load-the-extension-locally";
const REMOVED_LANDING_MARKUP = [
  "data-hero-comparison",
  "data-hero-slider",
  "data-tour",
  "data-tour-tab",
  "data-tour-panel",
  "workflow-tabs",
  "change-box",
  "product-video",
  "lumen-product-demo.webm",
  "review.html?demo=1"
];
const REMOVED_LANDING_WORDS = /\b(?:dashboard|timeline|statistics|regions)\b/i;
const siteRoots = [
  {
    name: "docs artifact root",
    root: path.join(repoRoot, "docs"),
    legacyDocsMode: "redirect",
    assetPath: "/assets/lumen-social-card.png",
    landingAssetPaths: [
      "/assets/hero-after.png",
      "/assets/store-control-surface.png"
    ]
  },
  {
    name: "repository root",
    root: repoRoot,
    legacyDocsMode: "landing",
    assetPath: "/assets/lumen-social-card.png",
    landingAssetPaths: [
      "/assets/hero-after.png",
      "/assets/store-control-surface.png"
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
    assert(
      root.body.includes('id="hero-title"') &&
        root.body.includes("Capture any webpage, all the way down.") &&
        root.body.includes('id="features"') &&
        root.body.includes('id="actual-app"') &&
        root.body.includes('id="privacy"'),
      `Expected ${target.name} root route to serve the feature-only Lumen landing page.`, {
        sample: root.body.slice(0, 240)
      }
    );
    assert(
      countMatches(root.body, /class="feature-card"/g) === 6,
      `Expected ${target.name} landing page to present exactly six product features.`, {
        featureCards: countMatches(root.body, /class="feature-card"/g)
      }
    );
    assert(
      root.body.includes(`href="${PRIMARY_CTA_URL}"`) &&
        root.body.includes('src="assets/hero-after.png"') &&
        root.body.includes('src="assets/store-control-surface.png"') &&
        root.body.includes('href="privacy.html"'),
      `Expected ${target.name} landing page to expose its install action, real UI images, and privacy route.`, {
        sample: root.body.slice(0, 240)
      }
    );
    assert(
      REMOVED_LANDING_MARKUP.every((marker) => !root.body.includes(marker)) &&
        !/<video\b/i.test(root.body) &&
        !REMOVED_LANDING_WORDS.test(stripMarkup(root.body)),
      `Expected ${target.name} landing page to omit the removed showcase, review, and dashboard UI.`, {
        presentMarkers: REMOVED_LANDING_MARKUP.filter((marker) => root.body.includes(marker)),
        hasVideo: /<video\b/i.test(root.body),
        forbiddenWords: stripMarkup(root.body).match(REMOVED_LANDING_WORDS)?.[0] || ""
      }
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
      assert(legacyDocs.body.includes('id="hero-title"') && legacyDocs.body.includes("Capture any webpage, all the way down."), "Expected repository-root docs route to serve the feature-only landing page.", {
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

    for (const landingAssetPath of target.landingAssetPaths) {
      const landingAsset = await fetchBytes(`${fixture.origin}${landingAssetPath}`);
      assert(landingAsset.status === 200, `Expected ${target.name} landing image to load.`, {
        landingAssetPath,
        ...landingAsset
      });
      assert(landingAsset.bytes > 1024 && landingAsset.contentType === "image/png", `Expected ${target.name} landing image to contain PNG data.`, {
        landingAssetPath,
        ...landingAsset
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
        ...target.landingAssetPaths
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
        const heroImage = document.querySelector('img[src="assets/hero-after.png"]');
        const extensionImage = document.querySelector('img[src="assets/store-control-surface.png"]');
        const primaryCta = document.querySelector(".hero-actions .button-primary");
        const featureCards = [...document.querySelectorAll(".feature-card")];
        const hashLinks = [...document.querySelectorAll('a[href^="#"]')];
        const removedSelector = [
          "[data-hero-comparison]",
          "[data-hero-slider]",
          "[data-tour]",
          "[data-tour-tab]",
          "[data-tour-panel]",
          ".comparison-demo",
          ".workflow-shell",
          ".workflow-tabs",
          ".change-box",
          ".product-video",
          "video",
          ".dashboard",
          ".statistics",
          ".regions",
          ".timeline"
        ].join(",");
        const forbiddenWord = document.body.innerText.match(/\b(?:dashboard|timeline|statistics|regions)\b/i)?.[0] || "";

        return {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          heroTitleCount: document.querySelectorAll("h1#hero-title").length,
          heroImage: heroImage
            ? [heroImage.complete, heroImage.naturalWidth, heroImage.naturalHeight, heroImage.getAttribute("alt")]
            : null,
          extensionImageLoading: extensionImage?.loading || "",
          extensionImageAlt: extensionImage?.getAttribute("alt") || "",
          featureCards: featureCards.map((card) => ({
            heading: card.querySelector("h3")?.textContent?.trim() || "",
            copy: card.querySelector("p")?.textContent?.trim() || ""
          })),
          primaryCta: primaryCta
            ? {
                href: primaryCta.getAttribute("href"),
                target: primaryCta.getAttribute("target"),
                rel: primaryCta.getAttribute("rel")
              }
            : null,
          privacyPolicyLinks: document.querySelectorAll('a[href="privacy.html"]').length,
          hasActualAppAnchor: Boolean(document.querySelector("#actual-app")),
          brokenHashTargets: hashLinks
            .map((link) => link.getAttribute("href"))
            .filter((href) => href && href !== "#" && !document.getElementById(href.slice(1))),
          reviewLinks: document.querySelectorAll('a[href*="review.html"]').length,
          removedSelectorCount: document.querySelectorAll(removedSelector).length,
          forbiddenWord
        };
      });

      assert(initial.scrollWidth === initial.clientWidth, `Expected ${viewport.width}px landing page to avoid horizontal overflow.`, initial);
      assert(
        initial.heroTitleCount === 1 &&
          initial.heroImage?.[0] === true &&
          initial.heroImage?.[1] === 1136 &&
          initial.heroImage?.[2] === 710 &&
          Boolean(initial.heroImage?.[3]),
        `Expected ${viewport.width}px page to render one accessible heading and the complete hero image.`,
        initial
      );
      assert(initial.featureCards.length === 6, `Expected ${viewport.width}px page to render all six feature cards.`, initial);
      assert(
        initial.featureCards.every((card) => card.heading && card.copy),
        `Expected ${viewport.width}px feature cards to include a heading and plain-language description.`,
        initial.featureCards
      );
      assert(
        initial.primaryCta?.href === PRIMARY_CTA_URL &&
          initial.primaryCta.target === "_blank" &&
          initial.primaryCta.rel?.split(/\s+/).includes("noreferrer"),
        `Expected ${viewport.width}px primary action to point to the Chrome beta installation instructions.`,
        initial.primaryCta
      );
      assert(initial.privacyPolicyLinks >= 1, `Expected ${viewport.width}px page to link to the valid privacy route.`, initial);
      assert(initial.hasActualAppAnchor, `Expected ${viewport.width}px page to preserve the public review return anchor.`, initial);
      assert(initial.brokenHashTargets.length === 0, `Expected ${viewport.width}px page hash links to resolve to real sections.`, initial.brokenHashTargets);
      assert(
        initial.reviewLinks === 0 &&
          initial.removedSelectorCount === 0 &&
          !initial.forbiddenWord,
        `Expected ${viewport.width}px landing page to contain only the feature-focused presentation.`,
        initial
      );
      assert(
        initial.extensionImageLoading === "lazy" && Boolean(initial.extensionImageAlt),
        `Expected ${viewport.width}px extension image to be accessible and bandwidth-conscious.`,
        initial
      );

      const extensionImage = page.locator('img[src="assets/store-control-surface.png"]');
      await extensionImage.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const image = document.querySelector('img[src="assets/store-control-surface.png"]');
        return Boolean(image?.complete && image.naturalWidth === 1280 && image.naturalHeight === 800);
      });
      const extensionImageState = await extensionImage.evaluate((image) => [
        image.complete,
        image.naturalWidth,
        image.naturalHeight
      ]);
      assert(
        JSON.stringify(extensionImageState) === JSON.stringify([true, 1280, 800]),
        `Expected ${viewport.width}px page to decode the actual extension image at its source dimensions.`,
        extensionImageState
      );
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth),
        `Expected ${viewport.width}px landing page to stay overflow-free after lazy images load.`
      );

      if (viewport.width === 1440) {
        const featuresLink = page.locator('.site-nav a[href="#features"]');
        await featuresLink.click();
        assert(new URL(page.url()).hash === "#features", "Expected the Features navigation action to target the feature grid.");
      }

      assert(runtimeErrors.length === 0, `Expected ${viewport.width}px landing page to avoid console and runtime errors.`, runtimeErrors);
      checks.push({
        viewport: `${viewport.width}x${viewport.height}`,
        noOverflow: true,
        featureCards: initial.featureCards.length,
        primaryCta: true,
        heroImage: true,
        extensionImage: true,
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
    contentType: response.headers.get("content-type"),
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

  if (ext === ".webm") {
    return "video/webm";
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

function countMatches(value, pattern) {
  return (String(value).match(pattern) || []).length;
}

function stripMarkup(value) {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assert(condition, message, details = null) {
  if (condition) {
    return;
  }

  const error = new Error(message);
  error.details = details;
  throw error;
}
