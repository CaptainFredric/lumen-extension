# Chrome Web Store Listing

## Single Purpose

Lumen helps people create clean webpage captures for design, QA, product, and launch checks.

## Short Description

Clean webpage captures with responsive views, redaction checks, notes, page signals, and local history.

## Long Description

Lumen turns a busy webpage into a cleaner capture.

Use it when a normal screenshot carries too much noise: sticky headers, cookie banners, chat launchers, floating ads, unfinished lazy media, or missing layout context. Start from the Chrome toolbar, clean the page, capture the view you need, check sensitive regions, and save the result with a useful bundle manifest attached.

Lumen supports:

1. Full-page capture after page cleanup.
2. Desktop, tablet, and mobile capture sets.
3. Redaction checks for visible sensitive text and filled fields.
4. Manual redaction boxes for custom areas.
5. Focused crops, lasso-style region selection, and anchored callout notes.
6. Page signals such as title, URL, colors, typography, headline, CTA text, and navigation labels.
7. Timed captures for saved regions, with pause, resume, and run-now controls.
8. Local capture history with saved file details.
9. Bundle manifest JSON that keeps capture details beside the images.

Redaction checks are a safety aid. Check each capture before sharing it outside your workspace.

## Privacy URL

https://captainfredric.github.io/lumen-extension/privacy.html

## Support URL

https://github.com/CaptainFredric/lumen-extension/issues

## Homepage URL

https://captainfredric.github.io/lumen-extension/

## Permission Justification

1. `activeTab`: lets Lumen read and capture the current page after the user starts an action.
2. `alarms`: runs saved timed captures on the cadence the user chooses.
3. `downloads`: saves capture images, focused crops, and bundle manifest JSON to the user's Downloads folder.
4. `offscreen`: composes stitched screenshots in an offscreen canvas document.
5. `scripting`: injects the content script that prepares and reads the current page for capture.
6. `storage`: stores settings, local capture history, manual redaction boxes, focused crop regions, timed capture plans, and callout regions.

## Optional Host Permission Justification

Responsive capture sets use temporary viewport tabs. Optional `http://*/*` and `https://*/*` access is requested when the user chooses a responsive capture workflow that needs those pages.

## Data Disclosures To Review

1. Website content: screenshots and extracted page signals come from the page the user chooses.
2. User activity: local capture history may be classified as product usage activity.
3. Personal information: captured pages may contain personal information chosen by the user.
4. Personal communications: captured pages may contain communications chosen by the user.

The extension saves capture content locally through Chrome extension storage and Chrome Downloads by default.

## Screenshot Pack

Generated assets live in `store-assets/screenshots/` and can be refreshed with `npm run store:screenshots`.

1. Extension control surface on a capturable page.
2. Hold-action menu with responsive capture, redaction scan, boxes, cutaway, lasso, callout, and signals.
3. Responsive output set showing desktop, tablet, and mobile captures.
4. Redaction and callout checks.
5. Signals and local history detail.
