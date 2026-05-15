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
4. a last-reachable-viewport fallback for app-shell pages that stop scrolling after repeated tail rechecks
5. full-page stitching with offscreen composition
6. desktop, tablet, mobile, and responsive-set capture modes
7. export-time redaction for emails, phone numbers, token-like strings, and filled inputs across the current DOM
8. redaction preview from the popup before export
9. anchored manual redaction boxes for areas the scanner cannot infer, with projection into responsive captures when the source element still resolves
10. a cutaway region picker that stores one reusable page area per URL and exports focused cutaway crops when that region resolves during capture
11. a pre-export review screen that checks auto-redactions, manual projection, and cutaway resolution across the requested view set before saving
12. an anchored callout picker that marks one page area and renders it into the exported image with the capture note
13. page-signal extraction for palette, fonts, hero line, CTA, and navigation labels
14. bundle-manifest JSON exports with view, redaction, manual projection, cutaway, callout, signal, output health, and note metadata
15. dated per-run download folders so capture sets, tiles, and manifests stay together
16. local capture history with file, folder, summary, and Chrome download-handle metadata
17. popup history actions to open the latest artifact or reveal it in the Downloads folder
18. capture-time popup UI with run settings, cutaway state, a live stage timeline, and recent status log
19. an on-page usage HUD that appears during preparation and review setup, then hides before screenshots so exports stay clean
20. a shared entitlement model used by the popup and backend so paid-path features have one access contract
21. a local backend slice for demo session state, entitlement checks, and history sync when an API is reachable
22. a GitHub Pages landing site in `docs/`

## Current Limits

These limits are important:

1. redaction currently covers text and filled inputs present in the current DOM during export and should be reviewed before external sharing
2. manual redaction boxes can project into responsive captures through DOM anchors, but the result still needs review before external sharing
3. cutaway export works when the stored region can resolve in the captured view, but scheduled watch automation is not active yet
4. the current annotation pass is one anchored callout plus one capture note, not a full drawing suite
5. cloud sync, billing, scheduled monitoring, and visual diffs remain future work
6. highly dynamic sites with virtualization or unusual scroll behavior can still need site-specific fallback work
7. the local backend slice now checks entitlements, but it remains a demo path rather than a production account or billing system

## Architecture

### Capture Flow

The current capture flow is:

1. popup sends the selected capture options to the background worker
2. background injects the content script and prepares the page
3. content script freezes motion, runs the preflight scroll when enabled, and hides sticky or high-layer UI when enabled
4. background scrolls the page in slices, remeasures the tail when the document grows, and seals at the last reachable viewport if a complex page refuses to scroll farther after repeated rechecks
5. background sends each visible segment to the offscreen document
6. content script resolves manual redactions, any stored cutaway region, and the optional callout region against the current layout
7. offscreen stitches the final output using device-pixel-ratio aware composition, renders one capture note and callout marker, and can export a cutaway crop from the stitched result
8. if the page is too large for one safe canvas, the export falls back to tiled raw output and skips cutaway cropping for that view
9. background downloads the files, writes the bundle manifest, writes local history, and restores the page

### Entitlements

`entitlements.js` is the shared plan contract for the extension and backend. Free keeps the local capture wedge available. Demo Pro unlocks current advanced local tools for testing. Team and Enterprise are required before the backend accepts future watch or agent records, and those records still require explicit opt-in and review flags.

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

To verify the backend contract for sessions, captures, watch plans, agent jobs, stats, and integrations:

```bash
npm run smoke:backend
```

### Run The Landing Site Locally

```bash
npm install
npm run site
```

The public landing page will be available at `http://127.0.0.1:3000/`.

### Use The Extension

1. Open any normal `https://` page
2. Open the Lumen popup
3. Check the launch indicator to confirm the current tab is capture-ready
4. Click `Capture page` for the default full-page run
5. Hold `Capture page` to open quick actions for responsive capture, redaction scan, manual boxes, or signal extraction
6. Change capture device, export mode, cleanup, lazy-load forcing, auto-redaction, notes, or manifest settings when needed
7. Use `Scan` to preview detected redaction regions before export
8. Use `Mark boxes` if you need manual redactions before capture
9. Use `Mark cutaway` to store one reusable page region; the next capture exports cutaway PNGs for views where the region resolves
10. Use `Open` or `Show in folder` from recent captures to get back to the saved artifact
11. When the pre-export review appears, check auto-redaction counts, manual projection status, cutaway status, and warnings, then click `Run export`
12. Expand recent capture details to review views, artifacts, redactions, manifest status, notes, and page signals
13. Copy a capture summary when you need to paste evidence into a review note or bug report

If the launch indicator says the page is blocked, switch to a normal `http://` or `https://` page. Chrome does not allow extension capture scripts on internal browser pages, Web Store pages, or other extension pages.

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

The smoke suite runs deterministic Playwright pages through the content-script capture path. It checks sticky and overlay cleanup, document scroll-lock release, lazy media hydration, redaction scanning, navigation extraction, nested scroll containers, anchored manual redaction projection, cutaway selection, and annotation callout selection.

To verify the unpacked MV3 extension can boot, start its service worker, initialize settings, and render the popup:

```bash
npm run smoke:extension
```

This opens a temporary Chromium profile, loads the extension unpacked, checks the background service worker, opens `popup.html`, then closes and removes the profile.

To verify the loaded extension can capture a real local page and produce finished artifacts:

```bash
npm run smoke:e2e
```

This starts a local fixture page, loads a temporary copy of the extension with explicit test only capture access, seeds one anchored cutaway region, runs a responsive desktop, tablet, and mobile capture through the MV3 background worker, waits for Chrome downloads to finish, validates the full-page PNGs, cutaway PNGs, and manifest artifacts, checks that local history stores the run, then removes the temporary profile and download folder. The checked in manifest is not widened by this test.

If a browser run is interrupted, remove leftover Lumen test screenshots, temporary profiles, and capture downloads with:

```bash
npm run cleanup:tmp
```

To test the loaded extension against live pages tied to this project:

```bash
npm run smoke:real-sites
```

The default list captures the public Lumen docs page and the GitHub repository. Set `LUMEN_REAL_SITE_URLS` to a comma separated list if you want to test a personal page list.

To install Chromium for Playwright, run:

```bash
npm run proof:install-browser
```

The proof script depends on Playwright and a local Chromium install. It is reproducible and requires those local browser dependencies.

The script also tries to create `docs/assets/proof-run-bundle.zip` with the system `zip` command. If `zip` is missing, the proof images and JSON files still generate, but the archive step is skipped.

### Generate Store Screenshots

```bash
npm run store:screenshots
```

This creates Chrome Web Store sized screenshots in `store-assets/screenshots/` from the live extension popup plus the current proof output assets. The generated screenshots are 1280 by 800 PNGs.

### Build The Store Package

```bash
npm run package:extension
```

This validates the Manifest V3 upload package, checks required runtime files, verifies declared PNG icon dimensions, rejects development folders, and writes `dist/lumen-extension-0.2.0.zip`. The ZIP contains only the runtime extension files, not docs, tests, backend code, node_modules, or proof assets.

## Publish The Landing Site

1. Enable GitHub Pages to deploy through GitHub Actions
2. Push changes to `main`
3. Wait for the `Deploy Pages` workflow to complete
4. Use `https://captainfredric.github.io/lumen-extension/`

The Pages workflow deploys `docs/` as the public root. The project also keeps a compatibility route at `/docs/` so older shared links redirect back to the root product page.

To verify the deployed route shape locally:

```bash
npm run smoke:site
```

## Future Direction

These are future layers:

1. freeform annotation tools
2. opt-in region watch with visible pause and retention controls
3. explicit agent handoff for selected bundles
4. cloud sync destinations
5. auth and billing
6. visual diffs and alerts

See `PRODUCT_ROADMAP.md` for the longer product direction and Chrome Web Store guardrails.
See `STORE_READINESS.md` for the current submission checklist, permission rationale, and policy references.
See `READINESS_CRITERIA.md` for how the personal use, Web Store beta, and paid product percentages are estimated.
See `PRIVACY.md` for the local-first privacy disclosure that mirrors the public privacy page.
See `CHROME_STORE_LISTING.md` for the current single-purpose listing draft, permission rationale, and screenshot checklist.

## Next Work

The highest-leverage next steps are:

1. improve capture reliability on difficult real-world sites
2. review the generated Chrome Web Store screenshots against final listing copy
3. expand annotation from one callout into arrows, labels, and lasso edits
4. turn the entitlement contract into production auth, billing, retention, and deletion controls
