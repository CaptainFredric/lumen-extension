# Lumen

Lumen is a Manifest V3 Chrome extension for clean, responsive, safer evidence capture.

The current wedge is narrow on purpose:

1. clean the page before capture
2. capture desktop, tablet, and mobile views together
3. redact sensitive visible data during export
4. attach useful page signals beside the image

It is aimed at design review, QA, and product work. It is not presented here as a broad platform or finished SaaS product.

## What Works Now

The current build includes:

1. sticky, fixed, and high-z cleanup before capture
2. lazy-load preflight scrolling
3. full-page stitching with offscreen composition
4. desktop, tablet, mobile, and responsive-set capture modes
5. export-time redaction for emails, phone numbers, token-like strings, and filled inputs
6. page-signal extraction for palette, fonts, hero line, CTA, and navigation labels
7. local capture history with file and summary metadata
8. a local backend slice for demo session state and history sync when an API is reachable
9. a GitHub Pages landing site in `docs/`

## Current Limits

These limits are important:

1. redaction currently covers visible text and filled inputs during export and should be reviewed before external sharing
2. cloud sync, billing, annotations, and scheduled monitoring are not implemented as product-ready features
3. highly dynamic sites with virtualization or unusual scroll behavior can still need site-specific fallback work
4. the local backend slice is a small demo path, not a production account system

## Architecture

### Capture Flow

The current capture flow is:

1. popup sends the selected capture options to the background worker
2. background injects the content script and prepares the page
3. content script freezes motion, runs the preflight scroll when enabled, and hides sticky or high-layer UI when enabled
4. background scrolls the page in slices and sends each visible segment to the offscreen document
5. offscreen stitches the final output using device-pixel-ratio aware composition
6. if the page is too large for one safe canvas, the export falls back to tiled raw output
7. background downloads the files, writes local history, and restores the page

### Page Signals

The current signal extraction reads:

1. title, host, description, and hero headline
2. primary CTA text
3. navigation labels
4. dominant palette colors
5. most-used type families
6. layout counts such as sections, headings, buttons, forms, visuals, and words

The proof generator uses the same content-script extraction path. If the proof assets do not show a signal, the product copy should not pretend that signal is reliable.

## Local Development

### Load The Extension

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select this `lumen-extension` directory

### Run The Backend Slice

```bash
npm install
npm run api
```

The local API listens on `http://127.0.0.1:8787`.

### Use The Extension

1. Open any normal `https://` page
2. Open the Lumen popup
3. Choose the capture device and export mode
4. Enable sticky cleanup, lazy-load forcing, or auto-redaction as needed
5. Run `Analyze Page` or `Capture Full Page`
6. Check the latest blueprint and local history in the popup

## Proof Assets

The landing page includes proof assets generated from the current prototype:

1. `docs/assets/proof-run-desktop.png`
2. `docs/assets/proof-run-tablet.png`
3. `docs/assets/proof-run-mobile.png`
4. `docs/assets/proof-run-redacted.png`
5. `docs/assets/proof-run-signals.png`
6. `docs/assets/proof-run-history.png`
7. `docs/assets/proof-run-signals.json`
8. `docs/assets/proof-run-summary.json`
9. `docs/assets/proof-social-card.png`

To regenerate them:

```bash
npm install
npm run proof:assets
```

If Chromium is not installed for Playwright yet, run:

```bash
npm run proof:install-browser
```

The proof script depends on Playwright and a local Chromium install. It is reproducible, but it is not a zero-dependency step.

## Publish The Landing Site

1. Enable GitHub Pages to deploy through GitHub Actions
2. Push changes to `main`
3. Wait for the `Deploy Pages` workflow to complete
4. Use the generated Pages URL

## Future Direction

These are future layers, not present-day proof:

1. manual annotation tools
2. cloud sync destinations
3. auth and billing
4. scheduled monitoring
5. visual diffs and alerts

## Next Work

The highest-leverage next steps are:

1. improve capture reliability on difficult real-world sites
2. add annotation and manual redaction tools
3. tighten the backend from demo session state into a real account path
