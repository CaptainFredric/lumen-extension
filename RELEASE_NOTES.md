# Lumen Release Notes

## 0.4.0 — July 18, 2026

This release makes the Chrome extension—not the marketing website—the clearer center of Lumen and turns the local capture-to-review path into a faster, more deliberate workflow.

### New

1. Added a dedicated Settings app for capture defaults, privacy, exports, optional permissions, Google Drive disconnect, and local-workspace deletion.
2. Added reversible Privacy Shield. While enabled, it centrally enforces local-only mode, review-before-save, automatic redaction, and metadata minimization and pauses unattended monitor alarms; disabling it restores the user's prior choices and resumes active monitors.
3. Added fresh-install one-click defaults: local-only mode and automatic redaction start on, capture-details JSON and review-before-save start off, and the stronger Privacy Shield remains an explicit choice.
4. Added local PNG and paginated raster PDF export from review and Annotation Studio, with Fit, 100%, and keyboard zoom for the local working image.
5. Added a capture-time PDF cache generated from the original rendered capture output or tiles at up to 3200 raster pixels per page. It remains available for review export even when a large capture's bounded editor proxy is later pruned, until its own cache limit is reached.
6. Rebuilt the public landing page as the installation, explanation, and demo front door while keeping the Chrome extension's popup, library, editor, comparison workspace, and Settings as the actual app.

### Reliability and privacy

1. Privacy Shield is enforced in the shared settings and background capture paths rather than only represented by a UI toggle.
2. Signing in no longer implies content synchronization: capture and monitor reads or writes require the separate cloud-sync control to be explicitly enabled. Outbound capture and monitor URLs remove fragments and sensitive token, authorization, session, secret, and key parameters while the complete scheduled target remains on-device.
3. Local deletion and permission-revoke results now report what Chrome actually removed; downloaded originals and already-exported Drive files remain under the user's control.
4. Gallery previews retain their 50 MB or 500-capture cleanup limit. Whole-capture editor sources and cached review PDFs each have separate 250 MB or 75-capture limits, preserving favorites while removing the oldest eligible local assets first.
5. Export integrity coverage verifies PNG source requirements, cached-PDF provenance, PDF pagination and raster limits, cache pruning, and Blob-download URL cleanup.
6. The 0.4.0 verification pass completed Settings, export, export-integrity, annotation, change-review, difficult-site, release-ZIP, loaded-extension, and end-to-end capture tests.
7. Live reliability capture completed on four different sites: the public Lumen site, the GitHub repository, Chrome's `activeTab` documentation, and MDN's Intersection Observer documentation. This live matrix remains separate from CI because third-party pages can change.

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
