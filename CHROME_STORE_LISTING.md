# Chrome Web Store Listing Draft

Use this as the submission copy baseline. Keep it narrower than the long-term product plan.

## Single Purpose

Lumen helps users create cleaner webpage evidence for design review, QA, and product work by cleaning page chrome, capturing responsive views, redacting visible sensitive data, and saving local capture context.

## Short Description

Clean responsive webpage captures with redaction review, cutaway exports, page signals, and local history.

## Longer Description

Lumen is a browser capture workflow for teams and individuals who need more than a dead screenshot.

The current extension helps you:

1. Clean sticky headers, cookie banners, chat widgets, and high-layer page chrome before capture.
2. Capture desktop, tablet, and mobile views from one workflow.
3. Preview and apply redactions for visible sensitive text and filled inputs.
4. Mark manual redaction boxes for areas the scanner cannot infer.
5. Draw a reusable cutaway region and export focused crops beside the full-page image.
6. Mark one callout region so a review note points at the relevant area in the exported image.
7. Extract page signals such as colors, fonts, headline, CTA, navigation labels, and layout counts.
8. Save a local capture history and bundle manifest so evidence can travel with context.

Current redaction covers visible text and filled inputs during export and should be reviewed before external sharing.

## Privacy URL

https://captainfredric.github.io/lumen-extension/privacy.html

## Support URL

https://github.com/CaptainFredric/lumen-extension/issues

## Homepage URL

https://captainfredric.github.io/lumen-extension/

## Permission Justification

1. `activeTab`: lets Lumen access the current page only after the user starts a capture.
2. `downloads`: saves capture images, cutaway images, and JSON manifests to the user's Downloads folder.
3. `offscreen`: composes stitched screenshots in an offscreen canvas document.
4. `scripting`: injects the content script that prepares and reads the current page for capture.
5. `storage`: stores settings, local capture history, manual redaction boxes, and cutaway regions.

## Optional Host Permission Justification

Responsive tablet and mobile captures use temporary viewport tabs. Optional `http://*/*` and `https://*/*` access should only be requested when the user chooses a responsive capture workflow that needs those temporary pages.

## Data Disclosures To Select

Review these in the Chrome Web Store dashboard before submission:

1. Website content, because screenshots and extracted page signals come from the page the user chooses.
2. User activity, only if the dashboard classifies local capture history as product usage activity.
3. Authentication information, only if future sync, billing, or agent handoff adds account login.
4. Personal communications or personal information, only to the extent the user chooses to capture pages containing that data.

Do not claim remote collection while the current build is local-first and does not send capture content to a Lumen-owned production service by default.

## Screenshots Needed

Use real output from the extension, not concept art:

Generated assets live in `store-assets/screenshots/` and can be refreshed with `npm run store:screenshots`.

1. Popup ready state on a normal page.
2. Hold-action menu with review actions.
3. Responsive output bundle showing desktop, tablet, and mobile.
4. Redaction and callout review.
5. Signals and local history detail.

## Claims To Avoid Until Implemented

1. Automated competitor monitoring.
2. Cloud sync.
3. Team workspaces.
4. Ungated agent handoff.
5. Billing or pro plans.
6. Guaranteed PII removal.
