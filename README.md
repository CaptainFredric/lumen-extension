# Lumen

Lumen is a Manifest V3 Chrome extension for clean webpage capture, annotation, visual comparison, and local monitoring.

Lumen focuses on:

1. clean the page before capture
2. capture desktop, tablet, and mobile views together
3. crop rectangles or true transparent lasso shapes
4. delay, repeat, or continuously monitor a selected area with explicit limits
5. keep real on-device previews in a local photo library while originals stay in Downloads
6. redact sensitive visible data during export
7. attach useful page signals and capture details beside the image

The repo is aimed at design review, QA, and product work.

## What Works Now

The extension includes:

1. sticky, fixed, and high-z cleanup before capture
2. lazy-load preflight scrolling
3. tail remeasurement and stalled-scroll retries for late-growing pages
4. a last-reachable-viewport fallback for app-shell pages that stop scrolling after repeated tail rechecks
5. full-page stitching with offscreen composition
6. desktop, tablet, mobile, and responsive-set capture modes
7. export-time redaction for emails, phone numbers, token-like strings, and filled inputs, rescanned before every screenshot slice
8. redaction preview from the popup before export
9. anchored manual redaction boxes for areas the scanner cannot infer, with projection into responsive captures when the source element still resolves
10. a focused-region picker that stores one reusable rectangle or freeform lasso per URL, preserves lasso points through layout projection, and exports transparent pixels outside the lasso path
11. a pre-export review screen that checks auto-redactions, manual projection, and cutaway resolution across the requested view set before saving
12. an anchored callout picker that marks one page area and renders it into the exported image with the capture note
13. page-signal extraction for palette, fonts, hero line, CTA, and navigation labels
14. capture details JSON exports with view, redaction, manual projection, focused crop, callout, signal, output health, and note metadata
15. dated per-run download folders so capture sets, tiles, and detail files stay together
16. local capture history with file, folder, summary, and Chrome download-handle metadata
17. an IndexedDB photo library with gallery previews, bounded whole-capture editor images, search, manual/timed filters, favorites, sorting, storage usage, and per-item removal
18. library file actions that open or reveal the full-resolution originals retained in Chrome Downloads
19. capture-time popup UI with run settings, cutaway state, a live stage timeline, and recent status log
20. an on-page usage HUD that appears during preparation and review setup, then hides before screenshots so exports stay clean
21. three local selected-area timer modes: one delayed run, scheduled repeat, and capped continuous monitoring
22. 5, 10, and 30 second one-time delays; repeat cadences from 15 minutes through daily; and 1, 5, or 15 minute continuous cadence
23. continuous-run safety caps of 10, 25, or 50 captures, plus visible pause, resume, run-now, and delete controls
24. selected-area timed runs that save only the resolved rectangle or transparent lasso and fail closed when the stored area cannot be found safely
25. a shared entitlement model used by the popup and backend so local and future connected features have one access contract
26. backend retention and delete controls for session-owned captures, watch records, and agent jobs
27. a local backend slice for demo session state, entitlement checks, and history sync when an API is reachable
28. a GitHub Pages landing site in `docs/`
29. capture-integrity verification that blocks export when slices leave gaps or miss the page tail
30. pixel-correct cropping for offset nested scroll areas such as dashboard app shells
31. automatic sensitive-data rescans before every screenshot slice, with a fail-closed truncation limit
32. opaque redaction rendering so covered pixels are not recoverable from the saved image
33. exact responsive CSS-width calibration with requested and actual viewport evidence in capture details
34. a three-step first-run guide that disappears after the first successful capture or dismissal
35. one-shot site-permission leases that are removed after responsive capture unless a timed capture still needs them
36. an always-available local workspace clear for history, previews, page signals, regions, note drafts, schedules, and optional site access
37. a clean-profile smoke test that installs and boots the exact release ZIP
38. a full annotation studio with arrows, rectangles, text, blur, pixelation, selection, resizing, undo, redo, keyboard shortcuts, and PNG export
39. a visual-change review workspace with a before/after reveal slider, highlighted changed regions, difference metrics, and a monitor-run timeline
40. reviewed, edited, and exported states stored beside each item in the local photo library
41. optional user-initiated Google Drive export for one reviewed image at a time, using `drive.file` and revocable Chrome Identity access

## Current Limits

These limits are important:

1. redaction checks text and filled inputs again before every screenshot slice, but iframe, canvas, closed shadow-root, and image-only secrets still require manual review
2. manual redaction boxes can project into responsive captures through DOM anchors, but the result still needs review before external sharing
3. delayed, repeating, and continuous selected-area capture uses Chrome alarms, saved site access, and a local run shelf; Chrome can defer runs while the browser is closed, asleep, or unavailable
4. Google Drive export is optional, review-first, and limited to one user-selected reviewed image at a time; it is not automatic cloud backup or full-Drive synchronization
5. very large or tiled captures use a scaled whole-page editor image; open the downloaded original with the image picker when full-resolution annotation is required
6. billing, team sharing, remote monitoring, and remote destination workers remain outside the local extension package
7. highly dynamic sites with unusual scroll behavior can still need site-specific fallback work; Lumen now blocks exports whose slice coverage cannot be verified
8. retention and delete controls cover the local backend slice, but cloud deletion and account recovery are still production work
9. the local backend slice checks entitlements, retention, watch records, and delivery queues, while production account and billing systems remain separate work

## Architecture

### Capture Flow

The current capture flow is:

1. popup sends the selected capture options to the background worker
2. background injects the content script and prepares the page
3. content script freezes motion, runs the preflight scroll when enabled, and hides sticky or high-layer UI when enabled
4. background scrolls the page in slices, remeasures the tail when the document grows, rescans sensitive regions before each screenshot, and seals at the last reachable viewport if a complex page refuses to scroll farther after repeated rechecks
5. background sends each visible segment to the offscreen document
6. content script resolves manual redactions, any stored cutaway region, and the optional callout region against the current layout
7. offscreen crops the selected scroll surface, stitches the final output using device-pixel-ratio aware composition, verifies full vertical coverage, renders one capture note and callout marker, and can export a rectangular or transparent lasso crop from the stitched result
8. if the page is too large for one safe canvas, the export falls back to tiled raw output and skips cutaway cropping for that view
9. background downloads the full-resolution files, writes capture details and local history, and places gallery previews plus a bounded whole-capture editor image in the on-device photo library before restoring the page

### Local Photo Library

The library keeps compact gallery previews, capture metadata, and one bounded whole-capture working image per eligible capture in extension-owned IndexedDB. Safe-size single images stay lossless; very large or tiled outputs use a scaled whole-page proxy. Full-resolution originals remain in Chrome Downloads and are opened or revealed through stored download handles.

The library supports title, site, URL, and tag search; manual or timed capture filters; favorite-only filtering; newest or oldest sorting; and per-capture removal. Gallery cleanup defaults to 50 MB or 500 preview-bearing captures. Whole-capture editor sources have a separate 250 MB or 75-capture budget. Each cleanup removes the oldest non-favorite local image assets first while preserving capture metadata, favorites, and downloaded originals.

### Annotation And Change Review

Each saved preview can open in Annotation Studio for editable arrows, rectangles, text, blur, and pixelation. The editor keeps undo and redo history, supports keyboard controls and resizing, and renders a flattened reviewed PNG only when the user exports it.

The same library item can open in Change Review. Lumen pairs local captures, computes pixel differences in the browser, shows a draggable before/after reveal, clusters changed regions, and builds a timeline from saved monitor runs. A reviewed comparison and its metrics are written back to the local library.

### Reviewed Google Drive Export

Google Drive is an optional destination inside Annotation Studio. It is never background backup: Lumen requests the optional Chrome Identity and Google API permissions only after the user presses **Export to Drive**, then uploads that one rendered image with minimal review metadata. Disconnect removes the cached token and optional permissions; existing files remain in the user's Drive.

The publisher must create a Chrome Extension OAuth client for the permanent extension ID and package with `LUMEN_GOOGLE_DRIVE_CLIENT_ID`. Without that value, Drive stays disabled while local editing and PNG export continue to work. See `GOOGLE_DRIVE_SETUP.md`.

### Entitlements

`entitlements.js` is the shared plan contract for the extension and backend. The local beta unlocks the local capture toolkit immediately, including responsive sets, auto-redaction, framed exports, the photo library, and selected-area timers. Team and Enterprise remain future paths for cloud destinations and agent handoff; those connected records still require explicit opt-in and review flags.

### Data Controls

The popup always exposes local workspace deletion for capture history, library images, signals, regions, note drafts, schedules, and optional site access. Removing one library item or clearing the library deletes its local metadata, gallery previews, and whole-capture editor source, not downloaded originals. The checked-in backend is a developer-run loopback contract test; the Web Store build contains no Lumen-owned production sync endpoint.

### Page Signals

The current signal extraction reads:

1. title, host, description, and hero headline
2. primary CTA text
3. navigation labels
4. dominant palette colors
5. most-used type families
6. layout counts such as sections, headings, buttons, forms, visuals, and words

The sample capture generator uses the same content-script extraction path. If the sample assets miss a signal, the product copy should avoid claiming that signal as reliable.

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

To verify that local-only records survive backend reconciliation and capture metadata is uploaded only after explicit cloud-sync consent:

```bash
npm run smoke:sync
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
5. Hold `Capture page` to open quick actions for responsive capture, redaction scan, manual boxes, cutaway, lasso, callout, or signal extraction
6. Change capture device, export mode, cleanup, lazy-load forcing, auto-redaction, notes, or capture-detail settings when needed
7. Use `Scan` to preview detected redaction regions before export
8. Use `Mark boxes` if you need manual redactions before capture
9. Use `Mark cutaway` or `Lasso area` to store one reusable page region; rectangle captures save clean crops and lasso captures keep pixels outside the selected path transparent
10. Choose `Once` for a 5, 10, or 30 second delayed area capture, `Repeat` for a 15-minute through daily schedule, or `Continuous` for a 1, 5, or 15 minute cadence capped at 10, 25, or 50 runs
11. Use `Open library` to browse real local previews, search or filter them, mark favorites, and return to the originals in Downloads
12. Choose `Annotate` to add arrows, rectangles, text, blur, or pixelation; use undo and redo; then export a reviewed PNG locally
13. Choose `Compare` to pair captures, drag the before/after reveal, inspect highlighted changes, and mark the comparison reviewed
14. In a publisher-configured build, choose `Export to Drive` only after reviewing the image; use `Disconnect Drive` to revoke the cached connection and optional permissions
15. Use `Open` or `Show in folder` from recent captures to get back to the saved original
16. When the pre-export review appears, check auto-redaction counts, manual projection status, focused-region status, and warnings, then click `Run export`
17. Expand recent capture details to review views, artifacts, redactions, detail-file status, notes, and page signals
18. Copy a capture summary when you need to paste evidence into a review note or bug report

If the launch indicator says the page is blocked, switch to a normal `http://` or `https://` page. Chrome does not allow extension capture scripts on internal browser pages, Web Store pages, or other extension pages.

## Sample Capture Assets

The landing page and store screenshot pack use generated sample capture assets:

1. `docs/assets/capture-run-desktop.png`
2. `docs/assets/capture-run-tablet.png`
3. `docs/assets/capture-run-mobile.png`
4. `docs/assets/capture-run-redacted.png`
5. `docs/assets/capture-run-signals.png`
6. `docs/assets/capture-run-history.png`
7. `docs/assets/capture-run-bundle.json`
8. `docs/assets/capture-run-signals.json`
9. `docs/assets/capture-run-summary.json`
10. `docs/assets/lumen-social-card.png`
11. `docs/assets/capture-run-bundle.zip`

To regenerate them:

```bash
npm install
npm run capture:assets
```

### Run Capture Smoke Tests

```bash
npm run smoke:capture
```

The smoke suite runs deterministic Playwright pages through the content-script and offscreen capture path. It checks sticky and overlay cleanup, document scroll-lock release, lazy media hydration, redaction scanning, navigation extraction, nested scroll containers, anchored manual redaction projection, rectangular cutaways, lasso point projection, transparent lasso pixels, and annotation callout selection.

To verify delayed, repeating, and capped continuous schedule rules—including first-run timing, expiry, and run limits:

```bash
npm run smoke:watch
```

To verify hostile but deterministic page classes—including long pages, fixed overlays, nested app shells, late growth, lazy and transformed content, canvas, sandboxed iframes, and open and closed shadow roots:

```bash
npm run smoke:difficult-sites
```

To verify optional host access starts empty, survives while a timed plan needs it, and is revoked after last-plan deletion or local workspace cleanup:

```bash
npm run smoke:permissions
```

This check is intentionally headed because Chrome owns the optional-host-access consent sheet.
Click **Allow** when the isolated `127.0.0.1` prompt appears; the test then proves last-plan
revocation, alarm cleanup, and full local-workspace permission cleanup. For a deliberate local
review session, extend the prompt window with
`LUMEN_PERMISSION_PROMPT_TIMEOUT=120000 npm run smoke:permissions`.

To verify annotation state, undo/redo, selection transforms, visual-diff clustering, the full review page, and reviewed Drive upload behavior:

```bash
npm run smoke:editor
npm run smoke:diff
npm run smoke:review
npm run smoke:drive
```

To verify the unpacked MV3 extension can boot, start its service worker, initialize settings, and render the popup:

```bash
npm run smoke:extension
```

This opens a temporary Chromium profile, loads the extension unpacked, checks the background service worker, opens `popup.html`, then closes and removes the profile.

To verify the loaded extension can capture a real local page and produce finished artifacts:

```bash
npm run smoke:e2e
```

GitHub Actions runs syntax, backend, sync, capture, difficult-site, watch-schedule, annotation, visual-diff, review-page, Drive, site, package, clean-release, loaded-extension, permission-revoke, and end-to-end capture checks on every pull request and push to `main`. The browser-backed checks run Chromium in a virtual display so they exercise the same headed extension path used locally.

To package the production allowlist and boot that exact ZIP in a clean profile:

```bash
npm run smoke:release
```

This starts a local fixture page, loads a temporary copy of the extension with explicit test-only capture access, seeds one anchored focused-crop region, runs a responsive desktop, tablet, and mobile capture through the MV3 background worker, waits for Chrome downloads to finish, validates the full-page PNGs, focused-crop PNGs, and capture detail files, checks that local history stores the run, then removes the temporary profile and download folder. The checked-in extension manifest is not widened by this test.

If a browser run is interrupted, remove leftover Lumen test screenshots, temporary profiles, and capture downloads with:

```bash
npm run cleanup:tmp
```

To test the loaded extension against live pages tied to this project:

```bash
npm run smoke:real-sites
```

The default live matrix captures the public Lumen site, the GitHub repository, Chrome's `activeTab` documentation, and MDN's Intersection Observer documentation. Set `LUMEN_REAL_SITE_URLS` to a comma separated list if you want to test a personal page list. This live check is intentionally separate from CI because third-party availability and markup can change.

To install Chromium for Playwright, run:

```bash
npm run capture:install-browser
```

The sample asset script depends on Playwright and a local Chromium install. It is reproducible and requires those local browser dependencies.

The script also tries to create `docs/assets/capture-run-bundle.zip` with the system `zip` command. If `zip` is missing, the sample images and JSON files still generate, but the archive step is skipped.

### Generate Store Screenshots

```bash
npm run store:screenshots
```

This creates Chrome Web Store sized screenshots in `store-assets/screenshots/` from the live extension popup plus the current sample capture assets. The generated screenshots are 1280 by 800 PNGs.

### Build The Store Package

```bash
npm run package:extension
```

This validates the Manifest V3 upload package, checks required runtime files, verifies declared PNG icon dimensions, rejects development folders, and writes `dist/lumen-extension-0.3.0.zip`. The ZIP contains only the runtime extension files, not docs, tests, backend code, node_modules, or sample capture assets.

Release and store handoff documents:

1. `RELEASE_NOTES.md` summarizes the launch-candidate behavior and known limits.
2. `CHROME_WEB_STORE_PRIVACY_FORM.md` contains field-by-field privacy and permission drafts plus the publisher-only dashboard checklist.
3. `CHROME_STORE_LISTING.md` contains listing copy, disclosures, permission justifications, screenshot captions, and reviewer instructions.
4. `STORE_READINESS.md` tracks automated evidence and remaining manual launch gates.

## Publish The Landing Site

1. Enable GitHub Pages to deploy through GitHub Actions
2. Push changes to `main`
3. Wait for the `Deploy Pages` workflow to complete
4. Use `https://captainfredric.github.io/lumen-extension/`

The Pages workflow deploys `docs/` as the public root. The root public files mirror the `docs/` copies so local repository-root previews match the deployed page. The project also keeps a compatibility route at `/docs/` so older shared links redirect back to the root product page.

To verify the deployed route shape locally:

```bash
npm run smoke:site
```

This checks the mirrored public files, the root landing page, privacy page, legacy `/docs/` route, 404 fallback, and required social and store screenshot assets.

## Product Backlog

Potential product layers:

1. multiple named monitored regions per page
2. explicit agent handoff for selected bundles
3. optional change notifications after local review
4. additional review-first destinations after Google Drive
5. production auth, billing, support, and account recovery

See `PRODUCT_ROADMAP.md` for the longer product direction and Chrome Web Store guardrails.
See `STORE_READINESS.md` for the current submission checklist, permission rationale, and policy references.
See `READINESS_CRITERIA.md` for how the personal use, Web Store beta, and paid product percentages are estimated.
See `PRIVACY.md` for the local-first privacy disclosure that mirrors the public privacy page.
See `CHROME_STORE_LISTING.md` for the single-purpose listing copy, permission rationale, and screenshot checklist.

## Next Work

The highest-leverage next steps are publisher and production gates:

1. create the final Chrome Extension OAuth client and verify Drive consent with a non-publisher account
2. complete the Chrome Web Store privacy attestations, distribution settings, and submission
3. keep the four-site live matrix and difficult-site fixtures green for every release
4. turn the entitlement contract into production auth, billing, support, retention, and deletion controls
