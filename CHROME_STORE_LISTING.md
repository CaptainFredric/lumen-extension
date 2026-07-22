# Chrome Web Store Listing

## Single Purpose

Lumen helps people create clean webpage captures for design, QA, product, and launch checks.

## Short Description

Capture, annotate, compare, and export full webpages or selected areas with local-first review tools.

## Long Description

Lumen turns a busy webpage into a cleaner capture.

Use it when a normal screenshot carries too much noise: sticky headers, cookie banners, chat launchers, floating ads, unfinished lazy media, or missing layout context. Start from the Chrome toolbar, clean the page, capture the view you need, check sensitive regions, and save the result with useful capture details attached.

The Chrome extension is the capture app: its toolbar popup, local library, Annotation Studio, Change Review, and Settings perform the work. The homepage is the installation, product-information, and demo front door.

Lumen supports:

1. Full-page capture after page cleanup.
2. Desktop, tablet, and mobile capture sets.
3. Redaction checks for visible sensitive text and filled fields.
4. Manual redaction boxes for custom areas.
5. Focused rectangles and freeform lasso captures with transparent pixels outside the selected lasso path.
6. Page signals such as title, URL, colors, typography, headline, CTA text, and navigation labels.
7. One-time delayed selected-area capture after 5, 10, or 30 seconds.
8. Scheduled repeat capture from every 15 minutes through daily.
9. Capped continuous selected-area monitoring every 1, 5, or 15 minutes, stopping after 10, 25, or 50 runs.
10. Pause, resume, run-now, and delete controls for local timed plans.
11. An on-device photo library with actual previews, search, manual/timed filters, favorites, and sorting.
12. Full-resolution originals retained in Chrome Downloads, with Open and Show actions from the library.
13. Capture details JSON that keeps page context beside the images.
14. A full annotation studio with arrows, rectangles, text, blur, pixelation, selection, undo, and redo.
15. Local before/after review with a reveal slider, highlighted change regions, difference statistics, and a monitor timeline.
16. Optional reviewed-image export to Google Drive after explicit user consent, using access limited to files Lumen creates or the user explicitly opens with Lumen.
17. Local PNG and paginated raster PDF export with Fit, 100%, and keyboard zoom controls for the local working image.
18. Dedicated Settings with fast capture, review-before-save, reversible Privacy Shield that pauses unattended monitors while active, permission revocation, Drive disconnect, and local-workspace deletion.
19. Fresh-install one-click defaults that keep capture local, enable automatic redaction, omit capture-details JSON, and skip the extra review screen unless the user turns it on.
20. A capture-time review PDF cache generated from the original rendered output or tiles at up to 3200 raster pixels per page, with a separate 250 MB or 75-capture local limit.

Redaction checks are a safety aid. Check each capture before sharing it outside your workspace.

Timed capture is local and runs while Chrome is available. Lumen does not provide team sharing, remote monitoring, full-Drive synchronization, or guaranteed execution while the browser is closed. Google Drive export is an optional, user-started destination for one reviewed image at a time.

## Privacy URL

https://captainfredric.github.io/lumen-extension/privacy.html

## Support URL

https://github.com/CaptainFredric/lumen-extension/issues

## Homepage URL

https://captainfredric.github.io/lumen-extension/

## Permission Justification

1. `activeTab`: lets Lumen read and capture the current page after the user starts an action.
2. `alarms`: runs explicitly saved one-time, repeating, or capped continuous selected-area captures while Chrome is available.
3. `downloads`: saves full-resolution capture images, focused crops, local PNG and raster PDF exports, and capture details JSON to the user's Downloads folder.
4. `offscreen`: composes stitched screenshots in an offscreen canvas document.
5. `scripting`: injects the content script that prepares and reads the current page for capture.
6. `storage`: stores settings, local capture history, manual redaction boxes, focused regions, timed capture plans, and callout regions. Gallery previews, bounded whole-capture editor images, and capture-time raster PDF caches use extension-owned IndexedDB on the device and are not placed in Chrome Sync.

Optional permission:

1. `identity`: requested only after the user chooses Export to Drive so Chrome can obtain a Google OAuth token for the narrow `drive.file` scope. Disconnect removes the cached token and optional permission.

## Optional Host Permission Justification

Responsive capture sets use temporary viewport tabs. Optional `http://*/*` and `https://*/*` access is also requested when the user explicitly saves a selected-area timer plan so Chrome can reopen that page while the browser is available. When the user chooses Drive export, the same optional-host mechanism requests only the Google API upload origin for that action. One-shot page grants are removed after capture when no saved plan still needs the origin; deleting the last plan removes its saved access.

## Data Disclosures To Review

1. Website content: screenshots, compact gallery previews, bounded whole-capture editor copies, visible form values processed for redaction, and extracted page signals come from the page the user chooses.
2. Web history: Lumen stores the URL, title, host, and capture time only for pages the user captures or explicitly schedules; it does not passively record general browsing history.
3. User activity: selected coordinates, annotation actions, capture history, and monitor-run history support the visible workflow; Lumen does not perform general activity surveillance.
4. Personally identifiable information: chosen pages can contain names, emails, telephone numbers, usernames, addresses, and account identifiers.
5. Authentication information: chosen pages can contain token-like or credential text, some of which Lumen processes for redaction; optional Drive OAuth uses Chrome Identity.
6. Personal communications: chosen email, chat, issue, or collaboration pages can contain communications.
7. Financial, health, and location information: a user can deliberately capture pages showing these categories. Lumen processes visible page pixels but does not profile, monetize, or independently derive this information.
8. User-generated content and form data: capture notes, annotation text, selected shapes, and visible filled fields are processed for capture and review.

The extension saves compact gallery previews, bounded whole-capture editor images, and capture-time raster PDF caches in local extension-owned IndexedDB; full-resolution original images stay in Chrome Downloads. Safe-size captures can keep a lossless editor image, while very large or tiled captures use a scaled whole-page proxy. Cached review PDFs are generated from the original rendered capture output or tiles, but each page is capped at 3200 raster pixels wide and is not searchable text. Gallery cleanup has a 50 MB or 500-capture limit; editor sources and cached PDFs each have separate 250 MB or 75-capture limits. These cleanups preserve favorites. Removing a library item does not delete the downloaded original. The Web Store build has no Lumen-owned production sync endpoint. If the user explicitly selects Export to Drive, Lumen uploads that reviewed image and minimal file metadata to the user's Google Drive over HTTPS using the `drive.file` scope.

## Screenshot Pack

Generated assets live in `store-assets/screenshots/` and can be refreshed with `npm run store:screenshots`.
For submission, use the `lumen-store-screenshots-<commit>` artifact produced by the release commit's GitHub Actions run so every image comes from the exact pushed runtime. The checked-in annotation image is a review preview and must be replaced by that generated artifact.

1. One-click capture with the immediate open/edit/library receipt beside dedicated Privacy Shield Settings.
2. Annotation studio with arrows, text, shapes, blur, pixelation, undo, redo, Fit/100% working-image zoom, PNG/raster-PDF export, and optional reviewed-image Drive export.
3. Before/after visual change review with highlighted regions and monitor timeline.
4. Responsive desktop, tablet, and mobile outputs with redaction and focused-area context.
5. Local photo library with real previews beside the selected-area timer and active monitor controls.

## Reviewer Test Instructions

1. Open a normal `https://` page, open Lumen from the toolbar, and run a default capture.
2. Open the local library, choose a saved capture, and launch annotation or visual-change review.
3. Create an arrow, rectangle, text label, blur, and pixelated region; use undo and redo; test Fit, 100%, and keyboard zoom on the local working image; export a reviewed PNG and raster PDF.
4. Create a selected-area timer and delete it. Confirm Chrome removes saved access when it is the final plan for that origin.
5. Google Drive export is disabled unless the release ZIP was packaged with the publisher OAuth client. In a configured build, press Export to Drive from the reviewed image, approve the narrow consent, verify one file appears, then press Disconnect Drive.
6. Open Settings, confirm the fresh-install local-only, automatic-redaction, metadata-off, fast-capture defaults; turn Privacy Shield on and off; confirm its coordinated protections lock and restore the individual controls; then test site-access revoke and local-workspace clear.
7. No feature requires or downloads remote executable code.
