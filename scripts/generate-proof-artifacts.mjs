import { promises as fs } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const execFile = promisify(execFileCallback);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const assetDir = path.join(repoRoot, "docs", "assets");
const contentScriptPath = path.join(repoRoot, "content.js");

const OUTPUT_FILES = {
  desktop: "proof-run-desktop.png",
  tablet: "proof-run-tablet.png",
  mobile: "proof-run-mobile.png",
  redacted: "proof-run-redacted.png",
  signalsPanel: "proof-run-signals.png",
  historyPanel: "proof-run-history.png",
  socialCard: "proof-social-card.png",
  bundleJson: "proof-run-bundle.json",
  bundleArchive: "proof-run-bundle.zip",
  signalsJson: "proof-run-signals.json",
  summaryJson: "proof-run-summary.json"
};

const DEVICE_PRESETS = [
  {
    id: "desktop",
    width: 1280,
    height: 920,
    clipHeight: 860
  },
  {
    id: "tablet",
    width: 834,
    height: 1112,
    clipHeight: 980
  },
  {
    id: "mobile",
    width: 390,
    height: 844,
    clipHeight: 820
  }
];

const PROOF_PAGE_URL = "http://proof.lumen.test/";

const proofPageHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Orbit Release Manager</title>
    <meta
      name="description"
      content="Ship product updates with cleaner planning, calmer launches, and clearer status reviews."
    />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;700&display=swap"
      rel="stylesheet"
    />
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f7fb;
        --surface: #ffffff;
        --surface-alt: #edf3fb;
        --border: rgba(12, 24, 44, 0.12);
        --text: #152033;
        --muted: rgba(21, 32, 51, 0.64);
        --accent: #2f73ff;
        --accent-soft: rgba(47, 115, 255, 0.12);
        --mint: #6fe1c0;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Space Grotesk", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(111, 225, 192, 0.18), transparent 24%),
          linear-gradient(180deg, #f7f9fd 0%, #eef3fb 100%);
      }

      .site-header {
        position: sticky;
        top: 0;
        z-index: 2000;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 32px;
        background: rgba(255, 255, 255, 0.88);
        border-bottom: 1px solid var(--border);
        backdrop-filter: blur(14px);
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        font-weight: 700;
      }

      .brand-mark {
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 12px;
        background: linear-gradient(135deg, rgba(47, 115, 255, 0.18), rgba(111, 225, 192, 0.28));
        border: 1px solid rgba(47, 115, 255, 0.18);
      }

      .nav {
        display: flex;
        align-items: center;
        gap: 20px;
        color: var(--muted);
        font-size: 0.9rem;
      }

      .nav a {
        color: inherit;
        text-decoration: none;
      }

      .site-shell {
        width: min(1180px, calc(100% - 48px));
        margin: 0 auto;
        padding: 38px 0 120px;
      }

      .hero {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
        gap: 28px;
        align-items: start;
      }

      .hero-copy {
        display: grid;
        gap: 20px;
        padding: 36px;
        border-radius: 28px;
        background: rgba(255, 255, 255, 0.78);
        border: 1px solid var(--border);
        box-shadow: 0 24px 60px rgba(33, 52, 84, 0.08);
      }

      .eyebrow,
      .mini-label {
        color: var(--accent);
        font-size: 0.78rem;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      h1,
      h2 {
        margin: 0;
        font-family: "Instrument Serif", serif;
        font-weight: 400;
        letter-spacing: -0.04em;
      }

      h1 {
        max-width: 10ch;
        font-size: clamp(3.6rem, 8vw, 6.4rem);
        line-height: 0.93;
      }

      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.7;
      }

      .action-row {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      }

      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 46px;
        padding: 0 18px;
        border-radius: 999px;
        border: 1px solid transparent;
        font-size: 0.95rem;
        font-weight: 500;
        text-decoration: none;
      }

      .button-primary {
        background: var(--accent);
        color: white;
      }

      .button-secondary {
        background: white;
        border-color: var(--border);
        color: var(--text);
      }

      .hero-aside,
      .proof-card,
      .stats,
      .proof-contact,
      .proof-section,
      .quote-strip,
      .cookie-banner,
      .chat-widget {
        background: rgba(255, 255, 255, 0.86);
        border: 1px solid var(--border);
        box-shadow: 0 24px 60px rgba(33, 52, 84, 0.08);
      }

      .hero-aside {
        display: grid;
        gap: 18px;
        padding: 26px;
        border-radius: 28px;
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        padding: 18px;
        border-radius: 24px;
      }

      .stats div {
        display: grid;
        gap: 4px;
      }

      .stats strong {
        font-size: 1.55rem;
        font-family: "Instrument Serif", serif;
        font-weight: 400;
      }

      .proof-card {
        display: grid;
        gap: 12px;
        padding: 18px;
        border-radius: 24px;
      }

      .mini-list {
        display: grid;
        gap: 10px;
        padding-left: 1rem;
        margin: 0;
        color: var(--muted);
      }

      .proof-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
        gap: 24px;
        margin-top: 24px;
      }

      .proof-section {
        display: grid;
        gap: 18px;
        padding: 28px;
        border-radius: 28px;
      }

      .proof-section h2 {
        font-size: 2.5rem;
        line-height: 0.97;
      }

      .quote-strip {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 18px 22px;
        border-radius: 22px;
      }

      .quote-strip strong {
        max-width: 20ch;
        font-size: 1.02rem;
        line-height: 1.5;
      }

      .proof-contact {
        position: relative;
        display: grid;
        gap: 12px;
        padding: 22px;
        border-radius: 24px;
      }

      .proof-contact h3,
      .proof-section h3 {
        margin: 0;
        font-size: 1.16rem;
      }

      .contact-row,
      .plan-row {
        display: grid;
        gap: 4px;
        padding-top: 10px;
        border-top: 1px solid var(--border);
      }

      .contact-row span:first-child,
      .plan-row span:first-child {
        color: var(--muted);
        font-size: 0.82rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .plan-row strong {
        font-size: 1.05rem;
      }

      .stack {
        display: grid;
        gap: 24px;
      }

      .proof-body {
        display: grid;
        gap: 20px;
      }

      .proof-columns {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
      }

      .cookie-banner {
        position: fixed;
        left: 28px;
        right: 28px;
        bottom: 24px;
        z-index: 2400;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        padding: 18px 22px;
        border-radius: 22px;
      }

      .cookie-banner p {
        max-width: 48ch;
      }

      .chat-widget {
        position: fixed;
        right: 28px;
        bottom: 116px;
        z-index: 2600;
        width: 76px;
        height: 76px;
        display: grid;
        place-items: center;
        border-radius: 24px;
        font-weight: 700;
        color: var(--accent);
      }

      @media (max-width: 960px) {
        .hero,
        .proof-grid,
        .proof-columns {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <header class="site-header">
      <div class="brand">
        <div class="brand-mark">O</div>
        <span>Orbit</span>
      </div>

      <nav class="nav" aria-label="Primary">
        <a href="#product">Product</a>
        <a href="#workflow">Workflow</a>
        <a href="#security">Security</a>
        <a href="#contact">Contact</a>
      </nav>
    </header>

    <div class="site-shell">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">Release reviews</p>
          <h1>Ship product updates without shipping chaos.</h1>
          <p>
            Orbit gives product, design, and engineering teams one place to review changes, publish
            launch notes, and catch issues before release day.
          </p>

          <div class="action-row">
            <a href="#contact" class="button button-primary">Request access</a>
            <a href="#workflow" class="button button-secondary">See workflow</a>
          </div>

          <div class="quote-strip">
            <strong>Keep launch status, release notes, and QA evidence in one calmer review flow.</strong>
            <span class="mini-label">Current preview</span>
          </div>
        </div>

        <aside class="hero-aside">
          <div>
            <p class="mini-label">Launch week</p>
            <h2>Daily release pulse</h2>
          </div>

          <div class="stats">
            <div>
              <span class="mini-label">Teams</span>
              <strong>12</strong>
              <p>active groups</p>
            </div>
            <div>
              <span class="mini-label">Checks</span>
              <strong>31</strong>
              <p>open review items</p>
            </div>
            <div>
              <span class="mini-label">Lead time</span>
              <strong>2.1d</strong>
              <p>median handoff</p>
            </div>
          </div>

          <article class="proof-card">
            <p class="mini-label">This week</p>
            <ul class="mini-list">
              <li>Homepage refresh scheduled for Thursday</li>
              <li>Billing copy review with product marketing</li>
              <li>QA evidence required before freeze</li>
            </ul>
          </article>
        </aside>
      </section>

      <section class="proof-grid">
        <article class="proof-section" id="workflow">
          <p class="mini-label">Review board</p>
          <h2>Track the page, the message, and the release state together.</h2>
          <div class="proof-body">
            <p>
              Product teams can check the live page, share changes, and keep launch context visible
              without turning every release review into a screenshot hunt.
            </p>

            <div class="proof-columns">
              <div class="plan-row">
                <span>Lead</span>
                <strong>Danielle Chen</strong>
              </div>
              <div class="plan-row">
                <span>Focus</span>
                <strong>Onboarding refresh</strong>
              </div>
              <div class="plan-row">
                <span>Next review</span>
                <strong>Thursday 10:00 AM</strong>
              </div>
            </div>
          </div>
        </article>

        <aside class="proof-contact" id="contact">
          <p class="mini-label">Proof data</p>
          <h3>Review handoff details</h3>

          <div class="contact-row">
            <span>Email</span>
            <strong>qa.audit@example.com</strong>
          </div>

          <div class="contact-row">
            <span>Phone</span>
            <strong>+1 (312) 555-0192</strong>
          </div>

          <div class="contact-row">
            <span>API token</span>
            <strong>sk_test_51MxYp9X8cA12bnXqPL4v9dAs3rFgH6tZ</strong>
          </div>

          <div class="contact-row">
            <span>Owner</span>
            <input
              type="email"
              value="release.owner@example.com"
              aria-label="Owner email"
              style="min-height: 46px; border-radius: 14px; border: 1px solid var(--border); padding: 0 14px; font: inherit; background: var(--surface-alt); color: var(--text);"
            />
          </div>
        </aside>
      </section>
    </div>

    <div class="cookie-banner">
      <p>
        Orbit uses cookies to keep release audits, reviewer assignment, and approval state synced.
      </p>
      <span class="button button-primary">Accept</span>
    </div>

    <div class="chat-widget" aria-label="Chat support">Chat</div>
  </body>
</html>`;

async function main() {
  await fs.mkdir(assetDir, { recursive: true });

  const contentScript = await buildPatchedContentScript();
  const browser = await chromium.launch();

  try {
    const desktopRun = await captureResponsiveArtifact(browser, contentScript, DEVICE_PRESETS[0], OUTPUT_FILES.desktop);
    await captureResponsiveArtifact(browser, contentScript, DEVICE_PRESETS[1], OUTPUT_FILES.tablet);
    await captureResponsiveArtifact(browser, contentScript, DEVICE_PRESETS[2], OUTPUT_FILES.mobile);

    const redactedPath = path.join(assetDir, OUTPUT_FILES.redacted);
    await captureRedactionExample(browser, contentScript, desktopRun.redactions.regions, redactedPath);

    const signalsJsonPath = path.join(assetDir, OUTPUT_FILES.signalsJson);
    await fs.writeFile(signalsJsonPath, `${JSON.stringify(desktopRun.blueprint, null, 2)}\n`, "utf8");

    const bundleManifest = buildBundleManifest(desktopRun);
    await fs.writeFile(
      path.join(assetDir, OUTPUT_FILES.bundleJson),
      `${JSON.stringify(bundleManifest, null, 2)}\n`,
      "utf8"
    );
    await createProofArchive();

    await renderSignalsPanel(browser, desktopRun.blueprint, path.join(assetDir, OUTPUT_FILES.signalsPanel));

    const historyItem = buildHistoryItem(desktopRun);
    await renderHistoryPanel(browser, historyItem, path.join(assetDir, OUTPUT_FILES.historyPanel));
    await renderSocialCard(browser, path.join(assetDir, OUTPUT_FILES.socialCard));

    const summary = {
      generatedAt: new Date().toISOString(),
      source: "Prototype proof page rendered with Lumen content-script cleanup, scan, and extraction logic.",
      files: [
        OUTPUT_FILES.desktop,
        OUTPUT_FILES.tablet,
        OUTPUT_FILES.mobile,
        OUTPUT_FILES.bundleJson,
        OUTPUT_FILES.bundleArchive,
        OUTPUT_FILES.signalsJson
      ],
      hiddenCount: desktopRun.prepareResult.page.hiddenCount,
      redactionCount: desktopRun.redactions.count,
      redactionBreakdown: desktopRun.redactions.breakdown || buildRedactionBreakdown(desktopRun.redactions.regions),
      navLabelCount: desktopRun.blueprint.identity?.navLabels?.length || 0,
      blueprint: desktopRun.blueprint,
      historyItem
    };

    await fs.writeFile(
      path.join(assetDir, OUTPUT_FILES.summaryJson),
      `${JSON.stringify(summary, null, 2)}\n`,
      "utf8"
    );
  } finally {
    await browser.close();
  }
}

async function createProofArchive() {
  const outputPath = path.join(assetDir, OUTPUT_FILES.bundleArchive);
  const archiveInputs = [
    OUTPUT_FILES.desktop,
    OUTPUT_FILES.tablet,
    OUTPUT_FILES.mobile,
    OUTPUT_FILES.bundleJson,
    OUTPUT_FILES.signalsJson
  ];

  try {
    await fs.rm(outputPath, { force: true });
    await execFile("zip", ["-j", outputPath, ...archiveInputs.map((file) => path.join(assetDir, file))], {
      cwd: assetDir
    });
  } catch (error) {
    console.warn("Skipping proof archive creation:", error.message);
  }
}

async function buildPatchedContentScript() {
  const source = await fs.readFile(contentScriptPath, "utf8");

  return `
    window.chrome = window.chrome || {};
    window.chrome.runtime = window.chrome.runtime || {};
    window.chrome.runtime.onMessage = window.chrome.runtime.onMessage || { addListener() {} };
    ${source.replace(
      /\}\)\(\);\s*$/,
      `
      window.__LUMEN_TEST_API__ = {
        handlePrepareCapture,
        restorePageState,
        extractBrandBlueprint,
        scanSensitiveRegions
      };
    })();
    `
    )}
  `;
}

async function captureResponsiveArtifact(browser, contentScript, device, outputName) {
  const page = await openProofPage(browser, contentScript, device);

  try {
    const prepareResult = await page.evaluate(async () =>
      window.__LUMEN_TEST_API__.handlePrepareCapture({
        removeStickyHeaders: true,
        forceLazyLoad: true
      })
    );
    const blueprint = await page.evaluate(() => window.__LUMEN_TEST_API__.extractBrandBlueprint());
    const redactions = await page.evaluate(() => window.__LUMEN_TEST_API__.scanSensitiveRegions());

    const clip = {
      x: 0,
      y: 0,
      width: device.width,
      height: Math.min(device.clipHeight, device.height)
    };

    await page.screenshot({
      path: path.join(assetDir, outputName),
      clip
    });

    return {
      device,
      prepareResult,
      blueprint,
      redactions
    };
  } finally {
    await page.close();
  }
}

async function captureRedactionExample(browser, contentScript, regions, outputPath) {
  const page = await openProofPage(browser, contentScript, DEVICE_PRESETS[0]);

  try {
    await page.evaluate(async () =>
      window.__LUMEN_TEST_API__.handlePrepareCapture({
        removeStickyHeaders: true,
        forceLazyLoad: false
      })
    );

    await page.evaluate((redactionRegions) => {
      const card = document.querySelector(".proof-contact");

      if (!(card instanceof HTMLElement)) {
        return;
      }

      const cardRect = card.getBoundingClientRect();
      const cardPageLeft = cardRect.left + window.scrollX;
      const cardPageTop = cardRect.top + window.scrollY;
      const root = document.createElement("div");
      root.id = "lumen-proof-redactions";
      root.style.position = "absolute";
      root.style.inset = "0";
      root.style.pointerEvents = "none";
      root.style.zIndex = "5000";
      card.appendChild(root);

      for (const region of redactionRegions) {
        const relativeLeft = region.left - cardPageLeft;
        const relativeTop = region.top - cardPageTop;

        if (
          relativeLeft + region.width < 0 ||
          relativeTop + region.height < 0 ||
          relativeLeft > cardRect.width ||
          relativeTop > cardRect.height
        ) {
          continue;
        }

        const overlay = document.createElement("div");
        overlay.style.position = "absolute";
        overlay.style.left = `${relativeLeft}px`;
        overlay.style.top = `${relativeTop}px`;
        overlay.style.width = `${region.width}px`;
        overlay.style.height = `${region.height}px`;
        overlay.style.background = "rgba(9, 17, 28, 0.72)";
        overlay.style.backdropFilter = "blur(12px)";
        overlay.style.border = "1px solid rgba(137, 241, 209, 0.24)";
        overlay.style.borderRadius = "8px";
        root.appendChild(overlay);
      }
    }, regions);

    await page.locator(".proof-contact").screenshot({ path: outputPath });
  } finally {
    await page.close();
  }
}

async function renderSignalsPanel(browser, blueprint, outputPath) {
  const page = await browser.newPage({
    viewport: {
      width: 640,
      height: 560
    }
  });

  try {
    const colors = (blueprint.colors || [])
      .map((color) => `<span style="background:${color.hex}" title="${color.hex}"></span>`)
      .join("");
    const detailRows = [
      {
        label: "Headline",
        value: blueprint.identity?.heroHeadline || "None"
      },
      {
        label: "CTA",
        value: blueprint.identity?.primaryCta || "None"
      },
      {
        label: "Navigation",
        value: (blueprint.identity?.navLabels || []).join(" · ") || "None"
      },
      {
        label: "Layout",
        value: `${blueprint.layout?.sections || 0} sections · ${blueprint.layout?.headings || 0} headings`
      }
    ]
      .map(
        (row) =>
          `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`
      )
      .join("");
    const fonts = blueprint.typography?.families
      ?.slice(0, 3)
      .map((family) => `<li><strong>${escapeHtml(family.family)}</strong><span>${family.weight}</span></li>`)
      .join("") || "";

    await page.setContent(
      `<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
          <link
            href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;700&display=swap"
            rel="stylesheet"
          />
          <style>
            body { margin: 0; background: transparent; font-family: "Space Grotesk", sans-serif; }
            .panel {
              display: grid;
              gap: 16px;
              padding: 22px;
              border-radius: 24px;
              border: 1px solid rgba(255,255,255,0.08);
              background: linear-gradient(180deg, rgba(255,255,255,0.06), transparent 34%), rgba(9,17,28,0.94);
              color: #f5f8fc;
              box-shadow: 0 24px 70px rgba(0,0,0,0.28);
            }
            .eyebrow { color: #89f1d1; font-size: 0.74rem; letter-spacing: 0.16em; text-transform: uppercase; }
            h1 { margin: 0; font-size: 1.2rem; line-height: 1.3; }
            .meta, .grid dt { color: rgba(245,248,252,0.58); }
            .meta { font-size: 0.88rem; }
            .swatches { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
            .swatches span { display: block; height: 28px; border-radius: 10px; }
            dl { display: grid; gap: 10px; margin: 0; }
            .grid { display: grid; gap: 10px; }
            .grid div { display: flex; justify-content: space-between; gap: 18px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); }
            .grid dt, .grid dd { margin: 0; }
            .fonts { display: grid; gap: 8px; padding: 0; margin: 0; list-style: none; }
            .fonts li { display: flex; justify-content: space-between; gap: 16px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); }
            .fonts span { color: rgba(245,248,252,0.64); }
          </style>
        </head>
        <body>
          <article class="panel">
            <span class="eyebrow">Signals JSON</span>
            <h1>${escapeHtml(blueprint.page?.title || "Untitled page")}</h1>
            <p class="meta">${escapeHtml(blueprint.identity?.siteType || "Unknown")} · ${escapeHtml(blueprint.page?.host || "Unknown host")}</p>
            <div class="swatches">${colors}</div>
            <dl class="grid">${detailRows}</dl>
            <ul class="fonts">${fonts}</ul>
          </article>
        </body>
      </html>`,
      { waitUntil: "load" }
    );

    await page.locator(".panel").screenshot({ path: outputPath });
  } finally {
    await page.close();
  }
}

async function renderHistoryPanel(browser, historyItem, outputPath) {
  const page = await browser.newPage({
    viewport: {
      width: 720,
      height: 220
    }
  });

  try {
    await page.setContent(
      `<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
          <link
            href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap"
            rel="stylesheet"
          />
          <style>
            body { margin: 0; background: transparent; font-family: "Space Grotesk", sans-serif; }
            .panel {
              display: grid;
              gap: 12px;
              padding: 18px 20px;
              border-radius: 22px;
              border: 1px solid rgba(255,255,255,0.08);
              background: linear-gradient(180deg, rgba(255,255,255,0.06), transparent 40%), rgba(9,17,28,0.94);
              color: #f5f8fc;
              box-shadow: 0 24px 70px rgba(0,0,0,0.28);
            }
            .eyebrow { color: #89f1d1; font-size: 0.74rem; letter-spacing: 0.16em; text-transform: uppercase; }
            .head { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
            strong { font-size: 1rem; }
            .badge {
              padding: 8px 10px;
              border-radius: 999px;
              border: 1px solid rgba(255,255,255,0.1);
              color: rgba(245,248,252,0.66);
              font-size: 0.72rem;
              letter-spacing: 0.12em;
              text-transform: uppercase;
            }
            .meta {
              color: rgba(245,248,252,0.68);
              font-size: 0.9rem;
              line-height: 1.6;
            }
          </style>
        </head>
        <body>
          <article class="panel">
            <span class="eyebrow">Local history item</span>
            <div class="head">
              <strong>${escapeHtml(historyItem.title)}</strong>
              <span class="badge">${escapeHtml(historyItem.exportPreset)}</span>
            </div>
            <p class="meta">${escapeHtml(historyItem.metaLine)}</p>
          </article>
        </body>
      </html>`,
      { waitUntil: "load" }
    );

    await page.locator(".panel").screenshot({ path: outputPath });
  } finally {
    await page.close();
  }
}

async function renderSocialCard(browser, outputPath) {
  const page = await browser.newPage({
    viewport: {
      width: 1200,
      height: 630
    }
  });

  try {
    const [desktopSrc, redactedSrc, signalsSrc] = await Promise.all([
      toDataUri(path.join(assetDir, OUTPUT_FILES.desktop)),
      toDataUri(path.join(assetDir, OUTPUT_FILES.redacted)),
      toDataUri(path.join(assetDir, OUTPUT_FILES.signalsPanel))
    ]);

    await page.setContent(
      `<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
          <link
            href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@400;500;700&display=swap"
            rel="stylesheet"
          />
          <style>
            body {
              margin: 0;
              font-family: "Space Grotesk", sans-serif;
              background:
                radial-gradient(circle at 14% 14%, rgba(137, 241, 209, 0.14), transparent 24%),
                radial-gradient(circle at 84% 12%, rgba(119, 183, 255, 0.16), transparent 26%),
                linear-gradient(180deg, #041019 0%, #07111c 100%);
              color: #f5f8fc;
            }
            .frame {
              width: 1200px;
              height: 630px;
              display: grid;
              grid-template-columns: 430px 1fr;
              gap: 28px;
              padding: 34px 36px;
              box-sizing: border-box;
            }
            .copy {
              display: grid;
              align-content: start;
              gap: 18px;
            }
            .eyebrow {
              color: #89f1d1;
              font-size: 0.78rem;
              letter-spacing: 0.18em;
              text-transform: uppercase;
            }
            h1 {
              margin: 0;
              font-family: "Instrument Serif", serif;
              font-weight: 400;
              letter-spacing: -0.05em;
              line-height: 0.94;
              font-size: 5.1rem;
            }
            p {
              margin: 0;
              color: rgba(245, 248, 252, 0.76);
              line-height: 1.6;
              font-size: 1.03rem;
            }
            .chips {
              display: flex;
              gap: 10px;
              flex-wrap: wrap;
            }
            .chips span {
              padding: 10px 12px;
              border-radius: 999px;
              border: 1px solid rgba(255,255,255,0.1);
              background: rgba(255,255,255,0.04);
              color: rgba(245,248,252,0.72);
              font-size: 0.74rem;
              letter-spacing: 0.12em;
              text-transform: uppercase;
            }
            .stack {
              display: grid;
              grid-template-columns: minmax(0, 1fr) 280px;
              gap: 18px;
              align-items: start;
            }
            .panel,
            .side-panel {
              border: 1px solid rgba(255,255,255,0.08);
              background:
                linear-gradient(180deg, rgba(255,255,255,0.08), transparent 34%),
                rgba(9,17,28,0.9);
              box-shadow: 0 30px 90px rgba(0,0,0,0.28);
              border-radius: 28px;
            }
            .panel {
              display: grid;
              gap: 12px;
              padding: 18px;
            }
            .panel img,
            .side-panel img {
              display: block;
              width: 100%;
              height: auto;
              border-radius: 18px;
              border: 1px solid rgba(255,255,255,0.08);
            }
            .panel h2,
            .side-panel h2 {
              margin: 0;
              font-size: 1.05rem;
            }
            .panel small,
            .side-panel small {
              color: rgba(245,248,252,0.62);
            }
            .side-column {
              display: grid;
              gap: 18px;
            }
            .side-panel {
              display: grid;
              gap: 12px;
              padding: 14px;
            }
          </style>
        </head>
        <body>
          <div class="frame">
            <section class="copy">
              <span class="eyebrow">Lumen</span>
              <h1>Clean browser capture for review work.</h1>
              <p>
                Removes sticky page chrome before capture, saves desktop, tablet, and mobile views
                together, redacts sensitive fields, and keeps useful page signals attached.
              </p>
              <div class="chips">
                <span>Page cleanup</span>
                <span>Responsive set</span>
                <span>Safer export</span>
                <span>Signals attached</span>
              </div>
            </section>

            <section class="stack">
              <article class="panel">
                <img src="${desktopSrc}" alt="" />
                <div>
                  <h2>Current output</h2>
                  <small>Real cleaned capture from the proof run</small>
                </div>
              </article>

              <div class="side-column">
                <article class="side-panel">
                  <img src="${redactedSrc}" alt="" />
                  <div>
                    <h2>Redaction</h2>
                    <small>Visible text and filled inputs blurred</small>
                  </div>
                </article>

                <article class="side-panel">
                  <img src="${signalsSrc}" alt="" />
                  <div>
                    <h2>Signals</h2>
                    <small>Headline, CTA, navigation, palette, type</small>
                  </div>
                </article>
              </div>
            </section>
          </div>
        </body>
      </html>`,
      { waitUntil: "load" }
    );

    await page.screenshot({ path: outputPath });
  } finally {
    await page.close();
  }
}

function buildHistoryItem(desktopRun) {
  const timestamp = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date());

  return {
    title: desktopRun.blueprint.page?.title || "Untitled capture",
    exportPreset: "raw",
    metaLine: [
      "proof.lumen.test",
      timestamp,
      "3 views",
      "4 files",
      `${desktopRun.redactions.count} redactions`,
      desktopRun.blueprint.identity?.siteType || "Unknown"
    ].join(" · ")
  };
}

function buildBundleManifest(desktopRun) {
  return {
    schemaVersion: 1,
    generator: "Lumen proof asset script",
    capturedAt: new Date().toISOString(),
    page: {
      title: desktopRun.blueprint.page?.title || "Untitled capture",
      url: PROOF_PAGE_URL,
      host: "proof.lumen.test"
    },
    capture: {
      devicePreset: "responsive",
      exportPreset: "raw",
      responsiveViews: 3,
      redactionCount: desktopRun.redactions.count,
      redactionBreakdown: desktopRun.redactions.breakdown || buildRedactionBreakdown(desktopRun.redactions.regions)
    },
    files: [
      OUTPUT_FILES.desktop,
      OUTPUT_FILES.tablet,
      OUTPUT_FILES.mobile
    ],
    pageSignals: {
      siteType: desktopRun.blueprint.identity?.siteType || "",
      heroHeadline: desktopRun.blueprint.identity?.heroHeadline || "",
      primaryCta: desktopRun.blueprint.identity?.primaryCta || "",
      navLabels: desktopRun.blueprint.identity?.navLabels || [],
      colors: desktopRun.blueprint.colors || [],
      typography: desktopRun.blueprint.typography?.families || []
    }
  };
}

function buildRedactionBreakdown(regions = []) {
  return regions.reduce((breakdown, region) => {
    const kind = region.kind || "sensitive";
    breakdown.total += 1;
    breakdown.byKind[kind] = (breakdown.byKind[kind] || 0) + 1;
    return breakdown;
  }, {
    total: 0,
    byKind: {}
  });
}

async function openProofPage(browser, contentScript, device) {
  const page = await browser.newPage({
    viewport: {
      width: device.width,
      height: device.height
    }
  });

  await page.route(PROOF_PAGE_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: proofPageHtml
    })
  );

  await page.goto(PROOF_PAGE_URL, { waitUntil: "load" });
  await page.waitForLoadState("networkidle").catch(() => null);
  await page.waitForTimeout(400);
  await page.addScriptTag({ content: contentScript });
  await page.waitForTimeout(100);

  return page;
}

async function toDataUri(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = extension === ".png" ? "image/png" : "application/octet-stream";
  const buffer = await fs.readFile(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
