import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const iconSizes = [16, 32, 48, 128, 512];
const svg = await readFile(path.join(repoRoot, "brandmark.svg"), "utf8");
const browser = await chromium.launch();

try {
  for (const size of iconSizes) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1
    });

    await page.setContent(buildIconDocument(size), { waitUntil: "load" });
    const png = await page.screenshot({ type: "png", fullPage: false });
    await mkdir(path.join(repoRoot, "icons"), { recursive: true });
    await writeFile(path.join(repoRoot, "icons", `icon-${size}.png`), png);

    if (size === 512) {
      await mkdir(path.join(repoRoot, "assets"), { recursive: true });
      await mkdir(path.join(repoRoot, "docs", "assets"), { recursive: true });
      await writeFile(path.join(repoRoot, "assets", "brandmark-512.png"), png);
      await writeFile(path.join(repoRoot, "docs", "assets", "brandmark-512.png"), png);
    }

    await page.close();
  }

  console.log(JSON.stringify({ ok: true, sizes: iconSizes }, null, 2));
} finally {
  await browser.close();
}

function buildIconDocument(size) {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          html,
          body {
            width: ${size}px;
            height: ${size}px;
            margin: 0;
            overflow: hidden;
            background: transparent;
          }

          svg {
            display: block;
            width: ${size}px;
            height: ${size}px;
          }
        </style>
      </head>
      <body>${svg}</body>
    </html>`;
}
