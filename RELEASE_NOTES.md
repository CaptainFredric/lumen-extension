# Lumen Release Notes

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
