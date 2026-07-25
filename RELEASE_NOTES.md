# Lumen Release Notes

## 0.5.0 — July 24, 2026

This release makes the path from capture to a useful result immediate, while testing the same production ZIP that is handed to the Chrome Web Store.

### Capture and result flow

1. Added **Capture now** to the rectangle and freeform lasso pickers. It captures the selected current-viewport area immediately; **Save** remains the separate action for remembering a monitoring region.
2. Added a clean Capture Result workspace that opens after successful manual captures with a zoomable preview, Copy image, PNG, paginated PDF, optional Google Drive, Annotate, original-file, and library actions. Timed captures remain quiet and stay in the local shelf.
3. Added the exact-area shortcut (`Alt+Shift+E`; `Alt+Shift+A` on macOS) beside full-page (`Alt+Shift+L`) and visible-area (`Alt+Shift+V`) shortcuts.
4. Kept visible and selected-area captures at the user's current scroll position instead of resetting the page before capture.
5. Made the area picker keyboard-operable and non-destructive until Save, and made all capture shortcuts honor Privacy Shield and review-before-save.
6. Kept cached PDF and saved-file actions available when an older capture's working image has been pruned, with accurate crop, tile, and transparency states.

### Release reliability

1. Expanded the clean-profile release test to build and boot the exact production ZIP, verify all three registered commands, reject capture specifically at the missing-`activeTab` boundary, require packaged full-page, visible-area, and drawn-area shortcut flows on Linux CI, and verify result-workspace handoff without persistent host access.
2. Added browser coverage for rectangle and lasso dispatch, real selected-area cropping, automatic result opening, local source fidelity, zoom controls, and the result page's intentionally simple one-viewer layout.
3. GitHub Actions now uploads the exact tested ZIP as `lumen-extension-<commit>`.

### Known limits

1. Physical toolbar and shortcut gestures remain a short stock-Chrome release check on hosts where Chrome rejects virtual-display input; drawing through the area shortcut is part of that pass.
2. Google Drive export still requires the publisher-owned production OAuth client. Local copy, PNG, PDF, and annotation work without it.
3. Very large captures can use a bounded working proxy in the result/editor UI while the full-resolution original remains in Chrome Downloads.

## 0.4.0 — July 18, 2026

This release makes the Chrome extension—not the marketing website—the clearer center of Lumen and turns the local capture-to-review path into a faster, more deliberate workflow.

### New

1. Added a dedicated Settings app for capture defaults, privacy, exports, optional permissions, Google Drive disconnect, and local-workspace deletion.
2. Added reversible Privacy Shield. While enabled, it centrally enforces local-only mode, review-before-save, automatic redaction, and metadata minimization and pauses unattended monitor alarms; disabling it restores the user's prior choices and resumes active monitors.
3. Added fresh-install one-click defaults: local-only mode and automatic redaction start on, capture-details JSON and review-before-save start off, and the stronger Privacy Shield remains an explicit choice.
4. Added local PNG and paginated raster PDF export from review and Annotation Studio, with Fit, 100%, and keyboard zoom for the local working image.
5. Added a capture-time PDF cache generated from the original rendered capture output or tiles at up to 3200 raster pixels per page. It remains available for review export even when a large capture's bounded editor proxy is later pruned, until its own cache limit is reached.
6. Rebuilt the public landing page as the installation and concise feature front door while keeping the Chrome extension's popup, library, editor, comparison workspace, and Settings as the actual app.

### Reliability and privacy

1. Privacy Shield is enforced in the shared settings and background capture paths rather than only represented by a UI toggle.
2. Signing in no longer implies content synchronization: capture and monitor reads or writes require the separate cloud-sync control to be explicitly enabled. Outbound capture and monitor URLs remove fragments and sensitive token, authorization, session, secret, and key parameters while the complete scheduled target remains on-device.
3. Local deletion and permission-revoke results now report what Chrome actually removed; downloaded originals and already-exported Drive files remain under the user's control.
4. Gallery previews retain their 50 MB or 500-capture cleanup limit. Whole-capture editor sources and cached review PDFs each have separate 250 MB or 75-capture limits, preserving favorites while removing the oldest eligible local assets first.
5. Export integrity coverage verifies PNG source requirements, cached-PDF provenance, PDF pagination and raster limits, cache pruning, and Blob-download URL cleanup.
6. The 0.4.0 verification pass completed Settings, export, export-integrity, annotation, change-review, difficult-site, release-ZIP, loaded-extension, and end-to-end capture tests.
7. Live reliability capture completed on four different sites: the public Lumen site, the GitHub repository, Chrome's `activeTab` documentation, and MDN's Intersection Observer documentation. This live matrix remains separate from CI because third-party pages can change.

### July 20 interface refresh

1. Rebuilt the public landing page into five concise, feature-focused sections with ordinary product language and static images of real capture output and the extension interface.
2. Removed the long screenshot-shortcut tutorial, competitor table, faux proof labels, numbered markers, and repeated calls to action from the landing page.
3. Added a visible capture-options arrow beside the one-click Capture page button. The arrow and press-and-hold gesture now open the same eight actions without accidentally starting a capture.
4. Added menu keyboard navigation, Escape and outside-click closure, focus restoration, and synchronized accessibility state for the new capture control.
5. Re-recorded the unpacked extension performing a real capture, save review, library flow, annotation and undo/redo, 100% zoom, PNG and PDF exports, change review, and reversible Privacy Shield changes. Refreshed all affected Chrome Web Store screenshots from the current build.

### July 22 first-click refinement

1. Moved the Capture page action directly under a compact toolbar header so it remains visible inside a 600-pixel popup on a clean install.
2. Replaced the forced three-step first-run review flow with one dismissible page-readiness tip. Fresh installs now honor the one-click `reviewBeforeSave: false` default.
3. Added an immediate saved-capture receipt with **Annotate & export**, **Open original**, **Show in folder**, and **Library** actions linked to the exact completed capture.
4. Collapsed optional capture controls and page analysis by default while keeping area, lasso, responsive, redaction, timer, output, and monitoring tools available on demand.
5. Tightened the public site to four concise feature cards, truthful GitHub-beta install labels, concrete privacy and reliability copy, and no unsupported visible-area claim.
6. Refreshed the Web Store control-surface image from the current extension and added loaded-extension coverage for the compact first run and the real post-capture editor/library handoff.

### July 22 product-gap pass

1. Added first-class visible-area capture from the popup quick-action menu and the background capture path. It saves one current viewport instead of scrolling the page.
2. Added Chrome keyboard commands for full-page capture and visible-area capture.
3. Added active-run state in the background worker so a reopened popup can show a running capture, cancel it at the next safe step, or return to the source tab.
4. Added release and loaded-extension smoke coverage for shortcuts, visible-area UI, active-run controls, and a real one-segment visible-area capture.

### Known limits

1. Fit, 100%, and keyboard zoom apply to the local working image. Very large or tiled captures can use a scaled whole-page editor proxy; full-resolution original images remain in Chrome Downloads.
2. PDF output is a paginated raster document, not a searchable text PDF. Capture-time review PDFs use the original rendered output or tiles as input but cap each page at 3200 raster pixels wide.
3. Chrome can defer local timed captures while the browser or device is asleep or closed.
4. Cross-origin iframe content, closed shadow roots, canvas-rendered secrets, and image-only sensitive data require manual review.
5. Google Drive export requires publisher-owned Chrome Web Store and Google Cloud OAuth configuration. It remains a user-started export of one reviewed image, not background backup or full-Drive synchronization.
6. Chrome Web Store privacy attestations, final permission testing in stock Chrome, distribution settings, and submission remain publisher actions.

## 0.3.0 — July 16, 2026

This release turns Lumen from a full-page capture utility into a local review workspace.

### New

1. Full annotation studio with arrows, rectangles, text, blur, pixelation, selection, resizing, keyboard shortcuts, undo, redo, and reviewed PNG export.
2. Local visual-change review with a before/after reveal slider, changed-region highlights, difference statistics, and a monitor-run timeline.
3. Optional reviewed-image export to Google Drive. Drive access is requested only from an explicit export action and uses the narrow `drive.file` scope.
4. Local photo library with gallery previews, bounded whole-capture editor images, search, source filters, favorites, sorting, capture details, and original-file actions.
5. True freeform lasso capture with transparent pixels outside the selected polygon.
6. One-time, repeating, and capped continuous selected-area capture, including save-only-when-changed behavior.

### Reliability and privacy

1. Added deterministic difficult-site coverage for very long documents, fixed and sticky overlays, lazy media, transformed content, nested application scrollers, late-growing pages, canvas, sandboxed iframes, and closed shadow roots.
2. Added a loaded-extension test for optional site-access grant, last-plan revocation, alarm cleanup, and full local-workspace permission cleanup.
3. Optional site access remains per-origin and user initiated. Deleting the last timed plan for a site removes its saved access.
4. Google Drive connection is optional and disconnect removes the cached Chrome token and optional `identity` and Google API permissions. Existing Drive files remain under the user's control.
5. The release package remains Manifest V3, contains no remote executable code, and excludes development files.

### Known limits

1. Chrome can defer local timed captures while the browser or device is asleep or closed.
2. Cross-origin iframe content, closed shadow roots, canvas-rendered secrets, and image-only sensitive data require manual review.
3. Google Drive export requires publisher-owned Chrome Web Store and Google Cloud OAuth configuration. Local editing and PNG export continue to work without it.
4. Drive export uploads only the reviewed image selected by the user. It is not background backup or full-Drive synchronization.
5. The Chrome Web Store privacy attestations, distribution settings, dashboard screenshots, and final submission must be completed by the publisher.

## 0.2.0 — Local capture toolkit

1. Added full-page and responsive desktop, tablet, and mobile capture.
2. Added redaction checks, manual redaction boxes, focused rectangles, transparent lassos, notes, and capture-detail exports.
3. Added a local photo library and selected-area timer modes.
4. Added exact release-ZIP, loaded-extension, capture, schedule, and backend smoke coverage.
