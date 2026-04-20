# Lumen

Lumen is a Manifest V3 Chrome extension scaffold for premium web capture workflows. It is designed as the technical base for a freemium SaaS product where the screenshot is only the entry point and the monetized value comes from cleanup, polish, archiving, sync, and analysis.

## Current Foundation

The scaffold already includes:

1. A service-worker driven capture pipeline in `background.js`
2. A content-script preparation pass in `content.js` for sticky-layer cleanup and lazy-load preflight scrolling
3. An offscreen document stitcher in `offscreen.js` that composes retina-aware full-page captures
4. A Brand Blueprint inspector that extracts palette, fonts, layout, headline, CTA, and navigation signals from the active page
5. A polished popup UI in `popup.html`, `popup.css`, and `popup.js`
6. A GitHub Pages-ready landing site in `docs/`
7. A simple SaaS gating surface in `config.js` through `isProUser` and per-feature access flags
8. A lower-friction permission model where desktop capture uses `activeTab`, while mobile capture requests only the active site origin on demand

## Architecture

### Capture Engine

The current flow is:

1. Popup sends the capture request and the selected options to the background worker
2. Background validates the tab, injects the content script, and prepares the page
3. Content script freezes motion, optionally forces lazy-loaded content to render, and hides fixed, sticky, or high-z UI
4. Background scrolls the page in slices, respects Chrome capture throttling, and sends each viewport image to the offscreen document
5. While the page is prepared, Lumen can also extract a Brand Blueprint from the live DOM
6. Offscreen document stitches the slices into one PNG and returns the final data URL
7. Background downloads the final capture, persists the latest blueprint, and restores the page state

### Inspector

The inspector is the first real workflow differentiator in the repo today. It currently extracts:

1. the page title, host, description, and visible hero headline
2. primary CTA text and top navigation labels
3. quantized dominant colors
4. most-used typography families
5. layout density metrics such as sections, visuals, forms, buttons, and words

### SaaS Hooks

The first planned integration points are already marked in code comments:

1. Session bootstrap and billing state in `popup.js`
2. Capture metadata upload in `background.js`
3. Studio transforms such as mockup frames, blur, and redaction in `offscreen.js`

## Local Development

### Load the extension

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select this `lumen-extension` directory

### Test the scaffold

1. Open any normal `https://` page
2. Open the Lumen popup
3. Toggle sticky cleanup or lazy-load forcing as needed
4. Trigger `Analyze Page` to inspect the page system
5. Trigger `Capture Full Page` to save the stitched image and refresh the latest blueprint
6. Confirm the image is downloaded into `Downloads/Lumen`

### Publish the landing site

1. In GitHub, set Pages to deploy from `main` and the `/docs` folder
2. Wait for Pages to build
3. Use the generated URL as the public landing site

## Constraints To Address Next

The current scaffold is intentionally strong, but it is still a scaffold. The highest-leverage next tasks are:

1. Add support for pages that render inside nested scroll containers instead of the main document
2. Add a tile or PDF fallback when extremely tall pages exceed canvas limits
3. Replace the mocked auth state with a real SaaS session and billing check
4. Add the first true Pro studio export such as browser-frame beautification
5. Add asset branding such as real extension icons and store screenshots

## Suggested Product Roadmap

### Milestone 1

Ship the cleanest possible capture experience:

1. sticky cleanup
2. lazy-load forcing
3. reliable full-page stitching
4. responsive capture

### Milestone 2

Ship the first monetizable Studio layer:

1. browser and device frames
2. annotation overlays
3. redaction
4. export presets for social sharing

### Milestone 3

Ship the SaaS backend:

1. auth
2. billing
3. capture history
4. cloud sync integrations

### Milestone 4

Ship the higher-ticket workflow product:

1. scheduled competitor watch
2. visual diffing
3. alerts
4. team workspaces
5. brand blueprint extraction

## Repository Notes

This repository is ready for:

1. local git history
2. extension loading in Chrome
3. GitHub Pages deployment from `docs/`
4. iterative feature work
