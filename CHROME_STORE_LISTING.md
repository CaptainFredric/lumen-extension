# Chrome Web Store Listing

## Single Purpose

Lumen helps people create clean webpage captures for design, QA, product, and launch checks.

## Short Description

Local webpage capture with verified full pages, transparent lassos, timed areas, redaction, and a preview library.

## Long Description

Lumen turns a busy webpage into a cleaner capture.

Use it when a normal screenshot carries too much noise: sticky headers, cookie banners, chat launchers, floating ads, unfinished lazy media, or missing layout context. Start from the Chrome toolbar, clean the page, capture the view you need, check sensitive regions, and save the result with useful capture details attached.

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

Redaction checks are a safety aid. Check each capture before sharing it outside your workspace.

Timed capture is local and runs while Chrome is available. The local beta does not provide cloud file storage, team sharing, remote monitoring, or guaranteed execution while the browser is closed.

## Privacy URL

https://captainfredric.github.io/lumen-extension/privacy.html

## Support URL

https://github.com/CaptainFredric/lumen-extension/issues

## Homepage URL

https://captainfredric.github.io/lumen-extension/

## Permission Justification

1. `activeTab`: lets Lumen read and capture the current page after the user starts an action.
2. `alarms`: runs explicitly saved one-time, repeating, or capped continuous selected-area captures while Chrome is available.
3. `downloads`: saves full-resolution capture images, focused crops, and capture details JSON to the user's Downloads folder.
4. `offscreen`: composes stitched screenshots in an offscreen canvas document.
5. `scripting`: injects the content script that prepares and reads the current page for capture.
6. `storage`: stores settings, local capture history, manual redaction boxes, focused regions, timed capture plans, and callout regions. Compact photo-library preview blobs use extension-owned IndexedDB on the device and are not placed in Chrome Sync.

## Optional Host Permission Justification

Responsive capture sets use temporary viewport tabs. Optional `http://*/*` and `https://*/*` access is also requested when the user explicitly saves a selected-area timer plan so Chrome can reopen that page while the browser is available. One-shot grants are removed after capture when no saved plan still needs the origin; deleting the last plan removes its saved access.

## Data Disclosures To Review

1. Website content: screenshots, compact local preview copies, and extracted page signals come from the page the user chooses.
2. User activity: local capture history may be classified as product usage activity.
3. Personal information: captured pages may contain personal information chosen by the user.
4. Personal communications: captured pages may contain communications chosen by the user.

The extension saves compact library previews in local extension-owned IndexedDB and full-resolution originals through Chrome Downloads. Removing a library preview does not delete the downloaded original. Screenshot content is not sent to a Lumen-owned production service by default.

## Screenshot Pack

Generated assets live in `store-assets/screenshots/` and can be refreshed with `npm run store:screenshots`.

1. Extension control surface on a capturable page.
2. Hold-action menu with responsive capture, redaction scan, boxes, rectangle, lasso, callout, and signals.
3. Responsive output set showing desktop, tablet, and mobile captures.
4. Redaction and callout checks.
5. Local photo library with real previews and original-file actions.
6. Delayed once, scheduled repeat, and capped continuous selected-area controls.
