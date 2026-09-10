import assert from "node:assert/strict";
import { readFile, access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createSiteServer } from "./site-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = createSiteServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const results = [];
let browser;

try {
  const homepage = await fetch(origin).then((response) => response.text());
  assert.equal(
    homepage,
    await readFile(path.join(root, "docs/index.html"), "utf8"),
    "Preview must serve the deployed source.",
  );
  assert.match(homepage, /Capture it\./);
  assert.doesNotMatch(homepage, /review\.html|<iframe|<video|data-reveal/);
  assert.match(homepage, /Agent handoff is future work/);
  assert.match(homepage, /Review every capture before external sharing/);
  for (const filename of [
    "background.js",
    "popup.html",
    "editor.html",
    "library-store.js",
    "package.json",
    ".git/config",
  ]) {
    const response = await fetch(`${origin}/${filename}`);
    assert.equal(response.status, 404, `Public preview exposed ${filename}`);
    assert.doesNotMatch(
      await response.text(),
      /http-equiv="refresh"/,
      "404 pages must avoid redirect loops.",
    );
  }
  for (const filename of [
    "review.js",
    "review.css",
    "review-actions.js",
    "config.js",
    "entitlements.js",
    "export-utils.js",
    "visual-diff-engine.js",
  ]) {
    await assert.rejects(
      access(path.join(root, "docs", filename)),
      `Obsolete public runtime remains: ${filename}`,
    );
  }
  assert.equal((await fetch(`${origin}/..%2fpackage.json`)).status, 403);
  assert.equal((await fetch(`${origin}/%E0%A4%A`)).status, 400);
  assert.equal((await fetch(origin, { method: "POST" })).status, 405);
  assert.equal((await fetch(origin, { method: "HEAD" })).status, 200);

  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390, 768, 1024, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: 960 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.locator(".redaction-example").scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      [...document.images]
        .filter((image) => !image.closest("dialog"))
        .every((image) => image.complete && image.naturalWidth),
    );
    const layout = await page.evaluate(() => {
      const hero = document.querySelector(".hero-copy").getBoundingClientRect();
      const proof = document
        .querySelector(".product-window")
        .getBoundingClientRect();
      const image = document.querySelector(".editor-image");
      return {
        overflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        headingCount: document.querySelectorAll("h1").length,
        sideBySide: proof.left >= hero.right,
        stacked: proof.top >= hero.bottom,
        image: [image.naturalWidth, image.naturalHeight],
        features: document.querySelectorAll(".feature-card").length,
        workflow: document.querySelectorAll(".workflow-card").length,
        brokenAnchors: [...document.querySelectorAll('a[href^="#"]')]
          .filter((link) => !document.getElementById(link.hash.slice(1)))
          .map((link) => link.hash),
        background: getComputedStyle(document.body).backgroundColor,
      };
    });
    assert.equal(layout.overflow, false, `Overflow at ${width}px`);
    assert.equal(layout.headingCount, 1);
    assert.equal(layout.features, 4);
    assert.equal(layout.workflow, 3);
    assert.deepEqual(layout.image, [1280, 800]);
    assert.deepEqual(layout.brokenAnchors, []);
    assert.equal(layout.background, "rgb(10, 16, 20)");
    assert.equal(
      width > 820 ? layout.sideBySide : layout.stacked,
      true,
      `Hero layout at ${width}px`,
    );
    await page.locator(".hero-actions .button-primary").click();
    assert.equal(new URL(page.url()).hash, "#install");
    assert.equal(
      await page.locator("#install .button").getAttribute("href"),
      "https://github.com/CaptainFredric/lumen-extension/archive/refs/heads/main.zip",
    );
    await page
      .getByText("Does anything go to a background agent?", { exact: true })
      .click();
    assert.equal(
      await page
        .getByText("Agent handoff is future work.", { exact: false })
        .isVisible(),
      true,
    );
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.className),
      "skip-link",
    );
    assert.notEqual(
      await page.evaluate(
        () => getComputedStyle(document.activeElement).outlineStyle,
      ),
      "none",
    );

    // Every local URL used by the page must resolve; this includes downloadable proof.
    const urls = await page.evaluate(() =>
      [...document.querySelectorAll("[src], link[href], a[href]")]
        .map((element) => element.src || element.href)
        .filter((url) => url && new URL(url).origin === location.origin),
    );
    for (const url of new Set(urls)) {
      assert.equal((await fetch(url)).status, 200, `Broken local link: ${url}`);
    }
    if (process.env.LUMEN_SITE_SCREENSHOTS) {
      await mkdir(process.env.LUMEN_SITE_SCREENSHOTS, { recursive: true });
      await page.locator("#hero-title").click();
      await page.screenshot({
        path: path.join(
          process.env.LUMEN_SITE_SCREENSHOTS,
          `site-${width}.png`,
        ),
        fullPage: true,
      });
    }

    await page.locator(".editor-image-link").click();
    assert.equal(await page.locator("#editor-preview").isVisible(), true);
    await page
      .getByRole("button", { name: "Actual size", exact: true })
      .click();
    assert.equal(
      await page.locator("[data-preview-zoom]").getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page
        .locator(".preview-scroll img")
        .evaluate((image) => image.getBoundingClientRect().width),
      1280,
    );
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
      true,
      "Zoom must stay inside the dialog",
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#editor-preview").isVisible(), false);
    assert.equal(
      await page.evaluate(() => document.activeElement.className),
      "editor-image-link",
    );
    await page.locator(".editor-image-link").click();
    assert.equal(
      await page.locator("[data-preview-zoom]").getAttribute("aria-pressed"),
      "false",
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();

    // Stub only the browser clipboard boundary; the real click handler runs.
    // This avoids changing the developer's system clipboard during tests.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.copiedSetupAddress = text;
          },
        },
      });
    });
    await page.locator("[data-copy-setup]").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#setup-feedback")
        .textContent.startsWith("Copied."),
    );
    assert.equal(
      await page.evaluate(() => window.copiedSetupAddress),
      "chrome://extensions",
    );
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new Error("Permission denied");
      };
    });
    await page.locator("[data-copy-setup]").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#setup-feedback")
        .textContent.includes("Type chrome://extensions"),
    );
    assert.equal(await page.locator("[data-copy-setup]").isEnabled(), true);

    await page.goto(`${origin}/privacy.html`, { waitUntil: "networkidle" });
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(
      (await page
        .getByText("Limited Use requirements", { exact: false })
        .count()) > 0,
      true,
    );
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
      true,
      `Privacy overflow at ${width}px`,
    );
    const policyLinks = await page
      .locator(".site-header a")
      .evaluateAll((links) => links.map((link) => link.href));
    for (const url of policyLinks) {
      const destination = new URL(url);
      const html = await fetch(destination).then((response) => response.text());
      if (destination.hash)
        assert.ok(
          html.includes(`id="${destination.hash.slice(1)}"`),
          `Broken privacy navigation: ${url}`,
        );
    }
    assert.deepEqual(errors, [], `Runtime errors at ${width}px`);
    results.push({
      width,
      hero: width > 820 ? "two columns" : "stacked",
      assets: "decoded",
      overflow: false,
      policy: "passed",
      keyboardFocus: "passed",
      imagePreview: "zoom, Escape, close, and focus return passed",
      setupCopy: "success and permission failure passed",
    });
    await page.close();
  }

  for (const mode of ["no-js", "failed-js"]) {
    const context = await browser.newContext({
      javaScriptEnabled: mode !== "no-js",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    if (mode === "failed-js")
      await page.route("**/script.js*", (route) => route.abort());
    await page.goto(origin);
    assert.equal(await page.locator("h1").isVisible(), true);
    assert.equal(await page.locator("#install").isVisible(), true);
    assert.equal(
      await page
        .locator(".workflow-card")
        .first()
        .evaluate((element) => getComputedStyle(element).opacity),
      "1",
    );
    await page
      .getByText("What about automatic captures?", { exact: true })
      .click();
    assert.equal(
      await page
        .getByText("Timed area capture is available", { exact: false })
        .isVisible(),
      true,
    );
    await context.close();
  }

  const redirects = await browser.newPage();
  for (const [route, hash] of [
    ["/review.html?demo=1", "#workflow"],
    ["/docs/", ""],
  ]) {
    await redirects.goto(origin + route);
    await redirects.waitForURL(
      (url) => url.pathname === "/" && url.hash === hash,
    );
    assert.equal(await redirects.locator("#hero-title").count(), 1);
  }
  await redirects.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        source: "docs/",
        results,
        redirects: "passed",
        noJavaScript: "passed",
        failedJavaScript: "passed",
        runtimeIsolation: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
