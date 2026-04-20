# Lumen

Lumen is a Manifest V3 Chrome extension foundation for premium web capture workflows. It is designed as the technical base for a freemium SaaS product where the screenshot is only the entry point and the monetized value comes from cleanup, polish, archiving, sync, and analysis.

## Current Foundation

The current product foundation already includes:

1. A service-worker driven capture pipeline in `background.js`
2. A content-script preparation pass in `content.js` for sticky-layer cleanup and lazy-load preflight scrolling
3. An offscreen document stitcher in `offscreen.js` that composes retina-aware full-page captures
4. A Brand Blueprint inspector that extracts palette, fonts, layout, headline, CTA, and navigation signals from the active page
5. Responsive set capture that can generate desktop, tablet, and mobile outputs from one action
6. Auto-redaction that can detect emails, phone numbers, tokens, and filled fields before export
7. Studio export presets that can package captures into browser and phone poster mockups
8. A polished popup UI in `popup.html`, `popup.css`, and `popup.js`
9. A local-first backend slice for demo auth and capture history sync in `backend/`
10. A GitHub Pages workflow in `.github/workflows/pages.yml`
11. A GitHub Pages-ready landing site in `docs/`
12. A simple SaaS gating surface in `config.js` through `isProUser` and per-feature access flags
13. A lower-friction permission model where desktop capture uses `activeTab`, while viewport-based tablet, mobile, and responsive set capture request only the active site origin on demand

## Architecture

### Capture Engine

The current flow is:

1. Popup sends the capture request and the selected options to the background worker
2. Background validates the tab, injects the content script, and prepares the page
3. Content script freezes motion, optionally forces lazy-loaded content to render, and hides fixed, sticky, or high-z UI
4. Background scrolls the page in slices, respects Chrome capture throttling, and sends each viewport image to the offscreen document
5. While the page is prepared, Lumen can also extract a Brand Blueprint from the live DOM
6. If responsive set capture is selected, Lumen repeats the pipeline for desktop, tablet, and mobile viewports and archives the outputs together
7. If auto-redaction is enabled, the content script scans for sensitive text regions and filled fields before the final render
8. Offscreen can return raw stitched files or transform the output into browser and phone poster exports
9. If a page exceeds safe canvas limits, Lumen falls back to tiled raw exports instead of failing
10. Background downloads the final capture set, persists the latest blueprint, writes capture history, and restores the page state

### Inspector

The inspector is the first real workflow differentiator in the repo today. It currently extracts:

1. the page title, host, description, and visible hero headline
2. primary CTA text and top navigation labels
3. quantized dominant colors
4. most-used typography families
5. layout density metrics such as sections, visuals, forms, buttons, and words

### Backend Slice

The backend slice is intentionally small, but it is real:

1. it can create a demo session
2. it can return the active session
3. it can accept capture history records
4. it can return the capture history for that session

This keeps the extension usable in a purely local mode while allowing the first remote sync path when a backend is reachable.

### SaaS Hooks

The first planned integration points are already marked in code comments:

1. Session bootstrap and billing state in `popup.js`
2. Capture metadata upload in `background.js`
3. Studio transforms such as annotation layers and richer social layouts in `offscreen.js`

## Local Development

### Load the extension

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select this `lumen-extension` directory

### Test the extension

1. Open any normal `https://` page
2. Open the Lumen popup
3. Toggle sticky cleanup, lazy-load forcing, or auto-redaction as needed
4. Trigger `Analyze Page` to inspect the page system
5. Choose `Desktop`, `Tablet`, `Mobile`, or `Set` for the capture device
6. Choose `Raw`, `Browser`, or `Phone` export mode
7. Trigger `Capture Full Page` to save the stitched image and refresh the latest blueprint
8. Confirm the latest capture appears in the Archive panel
9. Confirm the image is downloaded into `Downloads/Lumen`

### Run the backend slice

```bash
npm run api
```

The local API listens on `http://127.0.0.1:8787`.

### Publish the landing site

1. In GitHub, enable Pages to deploy through GitHub Actions
2. Push changes to `main`
3. Wait for the `Deploy Pages` workflow to complete
4. Use the generated Pages URL as the public landing site

## Constraints To Address Next

The core capture and studio foundation is real now, but the highest-leverage next tasks are still clear:

1. Replace the demo session with a true OAuth flow and billing check
2. Add cloud sync destinations and a production capture-history backend
3. Add annotation composition and editor controls inside the offscreen studio
4. Add site-specific fallbacks for highly dynamic apps with virtualization or shadow-root heavy layouts
5. Add branded icons, store screenshots, and packaging for launch

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
