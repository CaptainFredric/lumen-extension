# Lumen

Lumen is a Manifest V3 Chrome extension for clean, responsive, safer evidence capture.

The current wedge is narrow on purpose:

1. clean the page before capture
2. capture desktop, tablet, and mobile views together
3. redact sensitive visible data during export
4. attach useful page signals beside the image
5. save a bundle manifest so the capture can travel with its context

The repo is aimed at design review, QA, and product work with a deliberately narrow first wedge.

## What Works Now

The current build includes:

1. sticky, fixed, and high-z cleanup before capture
2. lazy-load preflight scrolling
3. tail remeasurement and stalled-scroll retries for late-growing pages
4. full-page stitching with offscreen composition
5. desktop, tablet, mobile, and responsive-set capture modes
6. export-time redaction for emails, phone numbers, token-like strings, and filled inputs across the current DOM
7. redaction preview from the popup before export
8. anchored manual redaction boxes for areas the scanner cannot infer, with projection into responsive captures when the source element still resolves
9. anchored capture notes rendered into the exported image
10. page-signal extraction for palette, fonts, hero line, CTA, and navigation labels
11. bundle-manifest JSON exports with view, redaction, manual projection, signal, breakdown, and note metadata
12. dated per-run download folders so capture sets, tiles, and manifests stay together
13. local capture history with file, folder, summary, and Chrome download-handle metadata
14. popup history actions to open the latest artifact or reveal it in the Downloads folder
15. a local backend slice for demo session state and history sync when an API is reachable
16. a GitHub Pages landing site in `docs/`

## Current Limits

These limits are important:

1. redaction currently covers text and filled inputs present in the current DOM during export and should be reviewed before external sharing
2. manual redaction boxes can project into responsive captures through DOM anchors, but the result still needs review before external sharing
3. the current annotation pass is one anchored capture note
4. cloud sync, billing, scheduled monitoring, and visual diffs remain future work
5. highly dynamic sites with virtualization or unusual scroll behavior can still need site-specific fallback work
6. the local backend slice remains a small demo path rather than a production account system

## Architecture

### Capture Flow

The current capture flow is:

1. popup sends the selected capture options to the background worker
2. background injects the content script and prepares the page
3. content script freezes motion, runs the preflight scroll when enabled, and hides sticky or high-layer UI when enabled
4. background scrolls the page in slices, remeasures the tail when the document grows, and retries a few stalled scrolls before failing
5. background sends each visible segment to the offscreen document
6. offscreen stitches the final output using device-pixel-ratio aware composition and can render one anchored capture note into the artifact
7. if the page is too large for one safe canvas, the export falls back to tiled raw output
8. background downloads the files, writes the bundle manifest, writes local history, and restores the page

### Page Signals

The current signal extraction reads:

1. title, host, description, and hero headline
2. primary CTA text
3. navigation labels
4. dominant palette colors
5. most-used type families
6. layout counts such as sections, headings, buttons, forms, visuals, and words

The proof generator uses the same content-script extraction path. If the proof assets miss a signal, the product copy should avoid claiming that signal as reliable.

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

### Run The Landing Site Locally

```bash
npm install
npm run site
```

The public landing page will be available at `http://127.0.0.1:3000/`.

### Use The Extension

1. Open any normal `https://` page
2. Open the Lumen popup
3. Choose the capture device and export mode
4. Enable sticky cleanup, lazy-load forcing, or auto-redaction as needed
5. Use `Scan` to preview detected redaction regions before export
6. Use `Mark boxes` if you need manual redactions before capture
7. Add a capture note if you want the export to carry a review comment
8. Keep `Save bundle manifest` enabled if you want a portable JSON sidecar next to the capture files
9. Run `Analyze Page` or `Capture Full Page`
10. Use `Open` or `Show in folder` from recent captures to get back to the saved artifact
11. Check the latest blueprint and local history in the popup

## Proof Assets

The landing page includes proof assets generated from the current prototype:

1. `docs/assets/proof-run-desktop.png`
2. `docs/assets/proof-run-tablet.png`
3. `docs/assets/proof-run-mobile.png`
4. `docs/assets/proof-run-redacted.png`
5. `docs/assets/proof-run-signals.png`
6. `docs/assets/proof-run-history.png`
7. `docs/assets/proof-run-bundle.json`
8. `docs/assets/proof-run-signals.json`
9. `docs/assets/proof-run-summary.json`
10. `docs/assets/proof-social-card.png`
11. `docs/assets/proof-run-bundle.zip`

To regenerate them:

```bash
npm install
npm run proof:assets
```

### Run Capture Smoke Tests

```bash
npm run smoke:capture
```

The smoke suite runs deterministic Playwright pages through the content-script capture path. It checks sticky and overlay cleanup, lazy media hydration, redaction scanning, navigation extraction, nested scroll containers, and anchored manual redaction projection.

To verify the unpacked MV3 extension can boot, start its service worker, initialize settings, and render the popup:

```bash
npm run smoke:extension
```

This opens a temporary Chromium profile, loads the extension unpacked, checks the background service worker, opens `popup.html`, then closes the profile.

To verify the loaded extension can capture a real local page and produce finished artifacts:

```bash
npm run smoke:e2e
```

This starts a local fixture page, loads a temporary copy of the extension with explicit test only capture access, runs the capture through the MV3 background worker, waits for Chrome downloads to finish, validates the PNG and manifest artifacts, and checks that local history stores the run. The checked in manifest is not widened by this test.

To install Chromium for Playwright, run:

```bash
npm run proof:install-browser
```

The proof script depends on Playwright and a local Chromium install. It is reproducible and requires those local browser dependencies.

The script also tries to create `docs/assets/proof-run-bundle.zip` with the system `zip` command. If `zip` is missing, the proof images and JSON files still generate, but the archive step is skipped.

## Publish The Landing Site

1. Enable GitHub Pages to deploy through GitHub Actions
2. Push changes to `main`
3. Wait for the `Deploy Pages` workflow to complete
4. Use the generated Pages URL

## Future Direction

These are future layers:

1. freeform annotation tools
2. cloud sync destinations
3. auth and billing
4. scheduled monitoring
5. visual diffs and alerts

## Next Work

The highest-leverage next steps are:

1. improve capture reliability on difficult real-world sites
2. improve cross-layout review for projected manual redactions
3. tighten the backend from demo session state into a real account path
