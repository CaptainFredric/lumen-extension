# Lumen

Product boundaries, terminology, and document ownership are defined in
[PRODUCT.md](PRODUCT.md). Run `npm run test:product-contract` to check runtime
defaults against release disclosures before changing installation or privacy copy.

Lumen is a Manifest V3 Chrome extension for clean webpage capture, annotation, visual comparison, and local monitoring. The Chrome extension is the actual app: its toolbar popup, Capture Result workspace, local library, Annotation Studio, Change Review, and Settings screen perform the work. The GitHub Pages website is the public front door for installation guidance and a concise feature overview; a normal website cannot capture arbitrary browser tabs with extension privileges.

Lumen focuses on:

1. clean the page before capture
2. capture full pages, visible viewports, or desktop, tablet, and mobile views together
3. capture a rectangle or transparent lasso immediately, or remember it for monitoring
4. delay, repeat, or continuously monitor a selected area with explicit limits
5. keep real on-device previews in Capture Library while originals stay in Downloads
6. redact sensitive visible data during export
7. attach useful page signals and capture details beside the image
8. open every completed manual capture in a viewer-first result workspace with Page/Width/100% views, drag-to-pan, Copy, PNG, PDF, Drive, Edit, library, Settings, and removal controls
9. keep privacy, permissions, export behavior, and local-data controls together in dedicated Settings

The repo is aimed at design review, QA, and product work.

## What Works Now

**Capture.** The toolbar is a launcher with Full page, Visible, Area, and Set scopes, cleanup and lazy loading controls, optional redaction, live progress, Cancel, and one Last Capture entry. The worker prepares pages, calibrates responsive widths, stitches slices, and checks coverage before export.

**Review.** Preflight warnings and the review-before-save preference still require confirmation. Review maps show sensitive regions and projected areas. Annotation Studio provides arrows, boxes, text, blur, pixelation, undo, redo, and export. Internal saved region and note keys remain compatible.

With review-before-save or Private Review Mode enabled, **Capture now** in the area picker opens a separate approval window. It shows selection geometry and page checks, rather than captured pixels. Approval expires after two minutes; cancellation saves nothing. Navigation, scrolling, viewport changes, changed manual boxes, or changed settings require a new review. After capture, inspect the image in Result before external sharing.

**Capture Result.** Completed manual captures open a viewer with original image navigation, zoom, Copy, PNG, PDF, Edit, and selected-original ZIP export. Details includes source, viewport, saved files, and Page Context when capture-details JSON was enabled for that run. Old captures without retained context say so.

**Capture Library.** Persistent captures belong here: search, filters, favorites, preview caches, original file access, removal, and Compare. The Monitors workspace owns saved area selection, delayed/repeated/capped schedules, pause, resume, run now, and deletion.

**Storage and handoff.** Originals remain in Downloads. Local previews, editor sources, PDFs, and original image bundles have separate storage budgets. Configured Drive export is an explicit reviewed action with revocable access.

**Settings.** Capture defaults, optional safeguards, local-only mode, permissions, storage, and destinations live here. Fresh installs keep automatic redaction and details export off. Private Review Mode coordinates stronger safeguards when explicitly enabled.

**Verification.** Deterministic browser fixtures, lifecycle and ZIP tests, privacy checks, and exact-package smoke tests cover the runtime. Native toolbar and OS shortcut validation remains a separate manual release gate on hosts that cannot automate native input.

The developer backend remains experimental. Accounts, billing, general cloud sync, and agent routing have no controls in the normal capture launcher.

## Current Limits

New captures have a local image strip for retained original PNG views, page tiles, and crops. Click an image or use Left/Right/Home/End while a strip button is focused. Copy, PNG, PDF, and Edit use the viewed part. Check the images you want and choose Download ZIP to export those originals together. ZIP export can be cancelled while preparing; it excludes metadata files and later editor changes.

The cache retains up to 40 images and 64 MB per capture, with a separate 128 MB total bundle budget. Larger sets may retain only a subset. Older cached originals, including favorites, can be evicted; downloaded files remain untouched. Existing captures keep their previous viewer and download actions. Their originals cannot be reconstructed from thumbnails. Opening an original in Edit may still scale it to the editor's canvas limits; exported edits remain separate files.

If a responsive capture stops after completing a view, Lumen keeps completed views in a library item labeled "Partial capture". Open its result and Details to review the retained files. The error also identifies the download folder. Retrying creates a separate set and can duplicate previously completed views. Automatic resume and recovery of files from inside the failing view remain future work.

These limits are important:

1. redaction checks text and filled inputs again before every screenshot slice, but iframe, canvas, closed shadow-root, and image-only secrets still require manual review
2. manual redaction boxes can project into responsive captures through DOM anchors, but the result still needs review before external sharing
3. delayed, repeating, and continuous selected-area capture uses Chrome alarms, saved site access, and a local run shelf; Chrome can defer runs while the browser is closed, asleep, or unavailable
4. Google Drive export is optional, review-first, and limited to one user-selected reviewed image at a time; it is not automatic cloud backup or full-Drive synchronization
5. very large or tiled captures use a scaled whole-page editor image; Fit, 100%, and keyboard zoom operate on that local working image rather than claiming the downloaded original's resolution
6. billing, team sharing, remote monitoring, and remote destination workers remain outside the local extension package
7. highly dynamic sites with unusual scroll behavior can still need site-specific fallback work; Lumen now blocks exports whose slice coverage cannot be verified
8. retention and delete controls cover the local backend slice, but cloud deletion and account recovery are still production work
9. the local backend slice checks entitlements, retention, watch records, and delivery queues, while production account and billing systems remain separate work
10. PDF exports are paginated raster documents, not searchable text PDFs; the capture-time review cache is generated from the original rendered output or tiles but limits each page to at most 3200 raster pixels wide

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
9. for the primary capture variant, offscreen composition can also generate a paginated raster PDF from the original rendered output canvases or tiles, limiting each PDF page to at most 3200 raster pixels wide
10. background downloads the full-resolution image files, writes capture details and local history, and places gallery previews, a bounded whole-capture editor image, and the capture-time review PDF in the on-device Capture Library before restoring the page
11. successful manual runs open Capture Result for the exact saved item; timed runs finish quietly in the local shelf

### Capture Library

The library keeps compact gallery previews, capture metadata, one bounded whole-capture working image, and—when capture-time generation succeeds—a paginated raster review PDF in extension-owned IndexedDB. Safe-size single images can keep a lossless working image; very large or tiled outputs use a scaled whole-page proxy. The review PDF is produced from the original rendered capture output or tiles rather than that proxy, but each PDF page is capped at 3200 raster pixels wide. Full-resolution original images remain in Chrome Downloads and are opened or revealed through stored download handles.

The library supports title, site, URL, and tag search; manual or timed capture filters; favorite-only filtering; newest or oldest sorting; and per-capture removal. Gallery cleanup defaults to 50 MB or 500 preview-bearing captures. Whole-capture editor sources have a separate 250 MB or 75-capture budget, and cached review PDFs have another separate 250 MB or 75-capture budget. Each cleanup removes the oldest non-favorite local assets in that category first while preserving capture metadata, favorites, and downloaded originals.

### Annotation And Change Review

Each saved preview can open in Annotation Studio for editable arrows, rectangles, text, blur, and pixelation. The editor keeps undo and redo history, supports keyboard controls and resizing, offers Fit, 100%, and keyboard zoom for the local working image, and renders a flattened reviewed PNG or paginated raster PDF only when the user exports it.

The same library item can open in Change Review. Lumen pairs local captures, computes pixel differences in the browser, shows a draggable before/after reveal, clusters changed regions, and builds a timeline from saved monitor runs. A reviewed comparison and its metrics are written back to the local library.

### Reviewed Google Drive Export

Google Drive is an optional destination inside Capture Result and Annotation Studio. It is never background backup: Lumen requests the optional Chrome Identity and Google API permissions only after the user presses **Export to Drive**, then uploads that one rendered image with minimal review metadata. Disconnect removes the cached token and optional permissions; existing files remain in the user's Drive.

The publisher must create a Chrome Extension OAuth client for the permanent extension ID and provide it as `LUMEN_GOOGLE_DRIVE_CLIENT_ID`. Add the same name as a GitHub Actions repository secret so the commit-addressed CI ZIP is both Drive-configured and the exact package that passed verification. Without that value, Drive stays disabled while local editing, PNG, and PDF export continue to work. See `GOOGLE_DRIVE_SETUP.md`.

### Entitlements

`entitlements.js` is the shared plan contract for the extension and backend. The local beta unlocks the local capture toolkit immediately, including responsive sets, auto-redaction, framed exports, the Capture Library, and selected-area timers. Team and Enterprise remain future paths for cloud destinations and agent handoff; those connected records still require explicit opt-in and review flags.

### Data Controls

The dedicated Settings screen exposes capture behavior, export choices, Private Review Mode, local-only mode, optional-permission revocation, Drive disconnect, and local workspace deletion. A fresh install defaults to one-click local capture with automatic redaction, Private Review Mode, capture-details JSON, and review-before-save disabled. Saved choices are preserved on updates. Private Review Mode is an explicit stronger mode: while on it enforces review-before-save, automatic redaction, metadata minimization, and local-only behavior and pauses unattended monitor alarms; when turned off it restores the user's prior individual choices and active monitors resume.

Local workspace deletion covers capture history, library images and cached PDFs, signals, regions, note drafts, schedules, and optional site access. Removing one library item or clearing the library deletes its local metadata, gallery previews, whole-capture editor source, and cached review PDF, not downloaded originals. The checked-in backend is a developer-run loopback contract test; the Web Store build contains no Lumen-owned production sync endpoint. In development, signing in is not consent to move content: capture and monitor reads or writes require the separate cloud-sync control, and outbound records strip sensitive URL parameters while keeping the complete scheduled target on-device.

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

The public landing page will be available at `http://127.0.0.1:4173/`. Port 3000 remains available for other apps.

### Use The Extension

1. Open a normal webpage and click Lumen in the Chrome toolbar.
2. Choose Full page, Visible, Area, or Set. Area exposes Rectangle and Lasso; the page picker offers Capture now or Save.
3. Expand Capture safeguards to adjust cleanup, lazy loading, and optional redaction.
4. Click Capture. If a review appears, inspect the counts, projection map, and warnings before confirming. Cancel remains available while capture runs.
5. Use Capture Result to inspect images, copy, export, or open Edit. Details holds source information and retained Page Context.
6. Open Capture Library to revisit captures, use Compare, or manage Monitors. Scheduled capture requires explicit site access.
7. Open Settings to change defaults, enable stronger safeguards, revoke permissions, disconnect Drive, or clear local data.

If the launch indicator says the page is blocked, switch to a normal `http://` or `https://` page. Chrome does not allow extension capture scripts on internal browser pages, Web Store pages, or other extension pages.

## Sample Capture Assets

The homepage uses the real Bug Garden output from `npm run proof:garden`. These older generated assets remain available for reproducible fixtures and the existing store screenshot generator:

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

This is an intentionally manual, headed release check—not a CI gate—because Chrome owns the
optional-host-access consent sheet and an unattended Actions runner cannot approve it.
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

To verify dedicated Settings, reversible Private Review Mode invariants, local export zoom, raster PDF generation, cached-PDF provenance, storage budgets, and export download lifecycle:

```bash
npm run smoke:settings
npm run smoke:export
npm run smoke:export-integrity
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

GitHub Actions runs syntax, backend, sync, capture, difficult-site, watch-schedule, Settings, annotation, export zoom, export integrity, visual-diff, review-page, Drive, site, package, clean-release, loaded-extension, and end-to-end capture checks on every pull request and push to `main`. The browser-backed checks run Chromium in a virtual display, and CI uploads the exact ZIP that passed as `lumen-extension-<commit>`. Native optional-host consent and any shortcut gesture Chrome rejects from the virtual display remain explicit stock-Chrome release checks.

To package the production allowlist and boot that exact ZIP in a clean profile:

```bash
npm run smoke:release
```

This builds the production allowlist, loads that exact ZIP in a clean profile, confirms all three commands are registered, proves a capture request without a Chrome user gesture is rejected specifically at Chrome's site-access boundary, and checks that no persistent site access is retained. Linux CI must then run the packaged full-page and visible-area shortcuts through native virtual-display input, open the packaged area picker from its shortcut, draw and save an immediate crop, validate the files, and confirm each clean result handoff before the ZIP artifact is uploaded. Local hosts that block OS-level input report that boundary without pretending it passed. A physical toolbar click and all three shortcuts remain a short manual stock-Chrome release sign-off. The checked-in manifest is never widened for this test.

If a browser run is interrupted, remove leftover Lumen test screenshots, temporary profiles, and capture downloads with:

```bash
npm run cleanup:tmp
```

To test the loaded extension against live pages tied to this project:

```bash
npm run smoke:real-sites
```

The default four-site live matrix captures the public Lumen site, the GitHub repository, Chrome's `activeTab` documentation, and MDN's Intersection Observer documentation. All four completed in the 0.4.0 release verification pass. Set `LUMEN_REAL_SITE_URLS` to a comma separated list if you want to test a personal page list. This live check is intentionally separate from CI because third-party availability and markup can change.

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

This creates Chrome Web Store sized screenshots in `store-assets/screenshots/` from extension workspaces and sample capture assets. The monitor image now comes from Capture Library. The generated screenshots are 1280 by 800 PNGs.

### Record The Product Demo

The recorder now follows the four-scope launcher. Existing published recordings
and store images predate this consolidation and need regeneration before submission.

```bash
npm run demo:record
```

This launches a temporary unpacked copy of Lumen, captures a reproducible local checkout fixture through the real popup save-review flow, opens the local library, exercises Annotation Studio tools and zoom, renders the annotated export, opens the visual-change review, and demonstrates the privacy control in Settings. It writes a 1280 by 720 WebM, a poster frame, representative stills, and the rendered export to the system temporary directory at `lumen-product-demo/`, keeping generated media outside the repository by default.

Set `LUMEN_DEMO_OUTPUT_DIR=/absolute/path` to choose an output folder. `LUMEN_DEMO_PACE_MS` controls the pause between visible actions, `LUMEN_DEMO_CAPTURE_TIMEOUT_MS` extends the capture deadline on a slow machine, and `LUMEN_DEMO_EXECUTABLE_PATH` selects a compatible Chromium or Chrome executable. Use `LUMEN_DEMO_SKIP_CAPTURE=1` only for a faster UI-only rehearsal; the default recording runs the real local capture path and requires no external credentials.

### Build The Store Package

```bash
npm run package:extension
```

This validates the Manifest V3 upload package, checks required runtime files including Capture Result, verifies declared PNG icon dimensions, rejects development folders, and writes `dist/lumen-extension-0.5.0.zip`. The ZIP contains only runtime extension files—not docs, tests, backend code, `node_modules`, or sample capture assets. CI uploads the exact tested ZIP as `lumen-extension-<commit>` for release handoff.

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

The Pages workflow deploys `docs/` as the public root. This is the only website source. Run `npm run site` to preview that exact folder at `http://127.0.0.1:4173/`; set `PORT` to choose another port. Port 3000 stays available for other apps. Root `index.html` and `privacy.html` are compatibility redirects for generic repository previews.

The former public review demo at `review.html?demo=1` now redirects to the workflow section. The working extension review page stays at the repository root and remains part of the extension runtime. Avoid copying extension modules into `docs/`. The compatibility route at `/docs/` sends old shared links back to the root website.

To verify the deployed route shape locally:

```bash
npm run smoke:site
```

This checks the actual preview server, legacy redirects, public asset and anchor paths, privacy page, keyboard focus, reduced motion, JavaScript failure, mobile/tablet/desktop layout, and isolation from extension runtime files. Extension review behavior has its own `npm run smoke:review` test.

## Product Backlog

Potential product layers:

1. multiple named monitored regions per page
2. explicit agent handoff for selected bundles
3. optional change notifications after local review
4. additional review-first destinations after Google Drive
5. production auth, billing, support, and account recovery

See `PRODUCT_ROADMAP.md` for the longer product direction and Chrome Web Store guardrails.
See `STORE_READINESS.md` for the current submission checklist, permission rationale, and policy references.
Use the explicit release gates in `STORE_READINESS.md`; older readiness percentages are historical estimates.
See `PRIVACY.md` for the local-first privacy disclosure that mirrors the public privacy page.
See `CHROME_STORE_LISTING.md` for the single-purpose listing copy, permission rationale, and screenshot checklist.

## Next Work

The highest-leverage next steps are publisher and production gates:

1. create the final Chrome Extension OAuth client and verify Drive consent with a non-publisher account
2. complete the Chrome Web Store privacy attestations, distribution settings, and submission
3. keep the four-site live matrix and difficult-site fixtures green for every release
4. refresh the demo recording and store screenshots around the consolidated launcher and the same Bug Garden fixture; account and billing work remains experimental
