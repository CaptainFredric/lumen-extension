# Lumen Privacy Policy

Effective date: July 16, 2026

Lumen is a local-first browser capture workflow for design review, QA, and product work. The current extension stores capture settings, redaction boxes, focused regions, timed-capture plans, extracted page signals, capture history, and compact image previews on the user's device. Full-resolution screenshot files and capture detail files are saved through Chrome Downloads.

## Information Lumen Handles

1. Screenshot images of the page you choose to capture.
2. Page URL, title, host, viewport, dimensions, capture time, and export settings. Stored capture URLs omit fragments and common sensitive query keys such as tokens, authorization codes, session IDs, secrets, and API keys.
3. Redaction metadata, including detected sensitive regions and manual redaction boxes.
4. Focused-region metadata, including selected coordinates, dimensions, rectangle or lasso shape, lasso points, and projection status.
5. Extracted page signals such as colors, fonts, navigation labels, headline text, CTA text, and layout counts.
6. Local capture history, file names, Chrome download IDs, and capture detail metadata.
7. Compact preview images stored for the local photo library. These are local preview copies, not replacements for the full-resolution downloaded originals.
8. Optional timer-plan details, including the selected page, saved area, one-time delay or repeat cadence, continuous-run cap, status, and run history.
9. Optional capture notes that you choose to add to an export.

## Use

Lumen uses this information to provide its user-facing capture workflow: page cleanup, responsive capture, redaction review, rectangular and transparent lasso export, delayed, repeating, or capped continuous selected-area capture, capture details, local photo-library previews, history, and file actions.

## Storage And Retention

Lumen stores capture history, page signals, saved regions, schedules, and capture-note drafts in local Chrome extension storage. Compact photo-library preview blobs and their library metadata are stored in extension-owned IndexedDB on the same device. Harmless capture preferences can use Chrome Sync; user-written capture-note text, screenshot previews, saved regions, schedules, and capture history are not placed in Chrome Sync. Full-resolution screenshot images and capture details JSON are saved through Chrome Downloads into folders named by capture date. You control those original files through your browser and operating system.

Library preview cleanup defaults to a 50 MB or 500-preview budget. When that limit is exceeded, Lumen removes the oldest non-favorite preview blobs first while retaining their capture metadata and leaving downloaded originals untouched. Favorite previews are preserved by this automatic cleanup. Removing one library item or clearing the library deletes its local metadata and preview blobs only; it does not delete files from Downloads.

Chrome extension storage and downloaded files are not encrypted by Lumen. Do not capture or retain sensitive pages unless you are comfortable storing those files locally.

## Sharing And Transfer

The current extension does not send screenshot content, photo-library previews, page text, capture history, redaction metadata, timed-capture details, or page signals to a Lumen-owned production service by default. Capture metadata can be sent only after an advanced session is active, the data-control service is reachable, and you explicitly enable cloud sync. The repository includes a local demo backend for development testing, but it is not a production sync service. Cloud file storage, team sharing, destination delivery, and remote monitoring are not part of the local beta.

Timed captures are local and opt-in. When you save one, Lumen records the chosen site, selected rectangle or lasso, timing mode, cadence or delay, run cap, and permission so Chrome can capture that area while the browser is available. One-time delayed captures run once; repeating captures use the selected schedule; continuous captures stop at the chosen 10, 25, or 50 run cap. You can pause, resume, run now, or delete a plan. Deleting the last plan for a site revokes Lumen's saved site access.

## Your Controls

You can remove individual library items, clear the local photo library, or clear local capture history, page signals, saved regions, note drafts, timed-capture records, and optional site permissions at any time. Files already saved through Chrome Downloads remain on disk until you delete them through your browser or operating system. One-shot responsive site access is removed after the capture finishes when no timed capture still needs it.

## Limited Use Disclosure

Lumen uses information received from Chrome extension APIs only to provide or improve the browser capture workflow described in the product UI and listing. Lumen does not use or transfer that information for personalized advertising, retargeting, or interest-based advertising.

The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

Lumen does not allow human review of user capture data unless the user explicitly sends that data for support, review, or another chosen destination.

## Contact

For questions or issues, use the public repository at https://github.com/CaptainFredric/lumen-extension.
