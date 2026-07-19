# Lumen Privacy Policy

Effective date: July 16, 2026; updated July 18, 2026

Lumen is a local-first browser capture workflow for design review, QA, and product work. The Chrome extension is the actual capture app; the public website is an installation, product-information, and demo front door. The current extension stores capture settings, redaction boxes, focused regions, timed-capture plans, extracted page signals, capture history, review status, compact gallery previews, bounded whole-capture editor images, and capture-time raster PDF caches on the user's device. Full-resolution screenshot files, user-exported PNGs, user-exported paginated PDFs, and capture detail files are saved through Chrome Downloads unless the user explicitly chooses the optional reviewed-image Google Drive export.

## Information Lumen Handles

1. Screenshot images of the page you choose to capture.
2. Page URL, title, host, viewport, dimensions, capture time, and export settings. Stored capture URLs omit fragments and common sensitive query keys such as tokens, authorization codes, session IDs, secrets, and API keys.
3. Redaction metadata, including detected sensitive regions and manual redaction boxes.
4. Focused-region metadata, including selected coordinates, dimensions, rectangle or lasso shape, lasso points, and projection status.
5. Extracted page signals such as colors, fonts, navigation labels, headline text, CTA text, and layout counts.
6. Local capture history, file names, Chrome download IDs, and capture detail metadata.
7. Compact gallery previews and bounded whole-capture editor images stored for the local photo library. Safe-size captures can keep a lossless editor image; very large or tiled captures use a scaled whole-page proxy. These local working copies do not replace the full-resolution downloaded originals.
8. A capture-time paginated raster PDF cache when generation succeeds. Lumen builds it from the original rendered capture output or tiles, caps each PDF page at 3200 raster pixels wide, and stores it locally for review export; it is not a full-resolution or searchable-text copy.
9. Optional timer-plan details, including the selected page, saved area, one-time delay or repeat cadence, continuous-run cap, status, and run history.
10. Optional capture notes that you choose to add to an export.
11. Optional annotation and visual-review details, including editable shapes in the current editor tab, the selected comparison pair, measured change percentage, highlighted region count, and reviewed/exported status.
12. For an explicit Google Drive export: the reviewed image, chosen file name, capture ID, review time, and source host. Lumen does not send the rest of the photo library, monitor history, page text, or Drive contents with that action.

## Use

Lumen uses this information to provide its user-facing capture workflow: page cleanup, responsive capture, redaction review, rectangular and transparent lasso export, editable arrows, text, rectangles, blur and pixelation, Fit, 100%, and keyboard zoom for the local working image, local PNG and paginated raster PDF export, visual-change comparison, delayed, repeating, or capped continuous selected-area capture, capture details, local photo-library previews, history, and file actions.

## Storage And Retention

Lumen stores capture history, page signals, saved regions, schedules, and capture-note drafts in local Chrome extension storage. Photo-library gallery previews, bounded whole-capture editor images, capture-time raster PDF caches, and their library metadata are stored in extension-owned IndexedDB on the same device. Harmless capture preferences can use Chrome Sync; user-written capture-note text, screenshot images, saved regions, schedules, capture history, and cached PDFs are not placed in Chrome Sync. Full-resolution screenshot images and any enabled capture details JSON are saved through Chrome Downloads into folders named by capture date. You control those original files through your browser and operating system.

Annotation edits remain in the editor tab until the user exports a PNG or PDF or closes the tab. Lumen stores compact reviewed/exported status and comparison statistics with the local library item, not the editable annotation document. The editor and visual-change review use the local whole-capture working image when available and fall back to a legacy gallery preview only when necessary.

Gallery-preview cleanup defaults to a 50 MB or 500-capture budget. Whole-capture editor sources use a separate 250 MB or 75-capture budget. Capture-time review PDFs use another separate 250 MB or 75-capture budget. When a limit is exceeded, Lumen removes the oldest non-favorite assets in that category first while retaining capture metadata and leaving downloaded originals untouched. Favorite assets are preserved by automatic cleanup. Removing one library item or clearing the library deletes its local metadata, gallery previews, editor source, and cached PDF; it does not delete files from Downloads.

Chrome extension storage, IndexedDB library assets, and downloaded files are not encrypted by Lumen. Do not capture or retain sensitive pages unless you are comfortable storing those files locally.

## Sharing And Transfer

The public website is an installation and demo front door, not the extension capture runtime, and it cannot capture arbitrary browser tabs. The Chrome Web Store build contains no Lumen-owned production sync endpoint. Screenshot content, photo-library images, page text, capture history, redaction metadata, timed-capture details, and page signals are not sent to Lumen. Developers can explicitly run the repository's loopback demo backend to test session and metadata contracts on their own computer; that development service is not cloud storage or a production sync service. In that development path, signing in does not enable content synchronization: capture and monitor reads or writes require the separate cloud-sync control, and outbound records remove URL fragments and common sensitive query parameters while the complete scheduled target stays on-device. Team sharing, background cloud backup, full-Drive synchronization, and remote monitoring are not part of the local beta.

Google Drive export is optional and user initiated. After the user reviews an image and presses **Export to Drive**, Lumen requests Chrome's optional `identity` permission and access to the Google API origin, obtains a Google token with the narrow `drive.file` scope, and uploads only that reviewed image plus its limited file metadata. The scope lets Lumen work only with files it creates or files the user explicitly opens with Lumen; it does not grant general access to existing Drive contents. Small images use a multipart upload and larger images use a resumable upload. Nothing is uploaded merely by connecting, capturing, monitoring, comparing, or opening the editor.

Timed captures are local and opt-in. When you save one, Lumen records the chosen site, selected rectangle or lasso, timing mode, cadence or delay, run cap, and permission so Chrome can capture that area while the browser is available. One-time delayed captures run once; repeating captures use the selected schedule; continuous captures stop at the chosen 10, 25, or 50 run cap. You can pause, resume, run now, or delete a plan. Deleting the last plan for a site revokes Lumen's saved site access.

## Your Controls

Lumen provides a dedicated Settings screen for capture behavior, privacy, permissions, exports, and local data. On a fresh install, one-click capture starts in local-only mode with automatic redaction on, capture-details JSON off, and review-before-save off. Privacy Shield is a separate stronger choice that locks review-before-save, automatic redaction, metadata minimization, and local-only behavior together and pauses unattended monitor alarms so they cannot save without review; turning it off restores the user's explicit individual choices and resumes active monitors. Local-only mode blocks optional connected export while leaving local PNG and raster PDF export available.

You can remove individual library items, clear the local photo library and its gallery/editor images and cached PDFs, or clear local capture history, page signals, saved regions, note drafts, timed-capture records, and optional site permissions at any time. You can disconnect Google Drive, which removes Lumen's cached Chrome token and optional Drive-related permissions. Files already saved through Chrome Downloads or explicitly exported to Drive remain under your control until you delete them there. One-shot responsive site access is removed after the capture finishes when no timed capture still needs it.

## Limited Use Disclosure

Lumen uses information received from Chrome extension APIs only to provide or improve the browser capture workflow described in the product UI and listing. Lumen does not use or transfer that information for personalized advertising, retargeting, or interest-based advertising.

The use of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements, and the Chrome Web Store User Data Policy. Lumen uses Drive authorization only to create the reviewed files the user explicitly exports.

Lumen does not allow human review of user capture data unless the user explicitly sends that data for support, review, or another chosen destination.

## Contact

For questions or issues, use the public repository at https://github.com/CaptainFredric/lumen-extension.
