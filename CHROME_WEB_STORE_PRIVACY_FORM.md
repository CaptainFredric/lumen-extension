# Chrome Web Store Privacy Form Draft

This is a field-by-field publisher draft grounded in the current Lumen manifest and runtime. It is not a submitted form and is not legal advice. The publisher must compare these answers with the exact dashboard labels shown for the final ZIP.

Before submitting this form, open the deployed privacy policy in a signed-out browser and confirm its reviewed-image Google Drive disclosure matches this draft.

Official references:

1. [Chrome Web Store privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
2. [Chrome Web Store User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
3. [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
4. [Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

Chrome requires disclosure even when user data is processed or stored only on the device. Screenshot capture is one of Google's explicit examples of handling user data.

## Single purpose

Paste:

> Lumen lets a user capture, review, annotate, compare, and export a webpage or a user-selected page area for design, QA, product, and launch evidence.

## Permission justifications

### `activeTab`

> Gives Lumen temporary access to the current webpage only after the user opens the toolbar action or starts a capture, so it can prepare, inspect, and capture that chosen page.

### `alarms`

> Runs only user-created one-time, repeating, or capped continuous selected-area plans while Chrome is available. Alarms are removed when their plan is deleted or completed.

### `downloads`

> Saves full-resolution captures, reviewed annotation exports, focused crops, and capture-details JSON to the user's Downloads folder, and supports Open and Show actions for those saved originals.

### `offscreen`

> Uses an extension-owned offscreen document to stitch screenshot slices, apply opaque redactions, render focused rectangles or transparent lassos, generate previews, and compose export files. It is not used for hidden browsing or remote code.

### `scripting`

> Injects Lumen's packaged content script into the user-selected page to prepare the page, find its scroll surface, hide removable overlays, resolve selected regions, scan visible sensitive text, and restore the page after capture.

### `storage`

> Stores capture preferences and local workflow state, including history, redaction boxes, focused regions, annotations, monitor plans and runs, review metadata, and data-control settings. Compact gallery previews and bounded whole-capture editor images stay in extension-owned IndexedDB; full-resolution originals stay in Downloads. Safe-size editor images can be lossless, while very large or tiled captures use a scaled whole-page proxy.

### Optional `identity`

> Requested only when the user chooses Export to Drive. Chrome Identity obtains a Google OAuth token for the narrow `drive.file` scope. Lumen does not store the token in its own database, and Disconnect removes the cached token and optional permission.

### Optional `http://*/*` and `https://*/*` host access

> Lumen requests access only for the specific origin involved in a user-started responsive capture or a user-saved selected-area plan. Responsive-capture access is released after the run unless an active plan still needs it. Deleting the last plan for an origin revokes that saved access. The broad patterns declare which normal web origins may be requested; they are not granted at installation.

### Google API origin requested at export time

> When Google Drive export is configured and the user presses Export to Drive, Lumen requests access to `https://www.googleapis.com/*` so it can upload that reviewed image over HTTPS. No background Drive crawl or full-Drive read is performed.

## Remote code

Select:

> No, I am not using remote code.

Reviewer note if a text field appears:

> All executable JavaScript and CSS ships inside the Manifest V3 package. Network calls to the optional Google Drive API exchange data only and do not download or execute code.

## Data usage categories

The safest accurate disclosure for a general-purpose screenshot tool is inclusive: a chosen webpage can visibly contain any of the categories below, and Lumen processes that page locally before saving or redacting it. Select each category that appears in the dashboard:

1. **Personally identifiable information — Yes.** Captured pages can contain names, email addresses, telephone numbers, usernames, addresses, and account identifiers. Lumen also detects some of these values for redaction.
2. **Health information — Yes.** A user can deliberately capture a health-related page; Lumen processes the visible pixels even though it does not classify or profile health data.
3. **Financial and payment information — Yes.** A chosen page can contain prices, transactions, or payment details. Lumen does not use them for payments, credit, or lending.
4. **Authentication information — Yes.** A chosen page can contain credentials or token-like text, and Lumen scans some token patterns for redaction. Google OAuth tokens are handled through Chrome Identity for optional Drive export.
5. **Personal communications — Yes.** A user can capture email, chat, issue, or collaboration pages.
6. **Location — Yes, conservatively.** A captured page can display a map, address, or location. Lumen does not request geolocation or independently derive location from IP addresses.
7. **Web history — Yes.** Lumen stores the URL, title, host, capture time, and local history only for pages the user captures or explicitly schedules; it does not passively record general browsing history.
8. **User activity — Yes.** Lumen stores capture actions, selected coordinates, annotation actions, and monitor-run history needed for the visible workflow. It does not perform general click, keystroke, or browsing surveillance.
9. **Website content — Yes.** Screenshots, text signals, form values visible during redaction checks, images, headings, links, and page layout are core inputs to the capture feature.

If the dashboard separately lists **Form data** or **User-generated content**, select **Yes**. Filled fields can be processed for redaction, and the user can enter capture notes and annotation text.

## How the data is used

Use this explanation wherever the dashboard provides a data-use text field:

> Lumen uses the selected page content, URL, capture settings, selected regions, annotations, and local run history only to create, review, compare, organize, and export captures requested by the user. The Web Store build has no Lumen-owned production sync endpoint, so data stays on the device unless the user explicitly chooses Export to Drive. That action sends the reviewed image, its filename, review timestamp, Lumen capture identifier, and source host to the user's Google Drive over HTTPS. Lumen does not use capture data for advertising, credit decisions, data brokerage, or unrelated analytics.

## Limited Use certifications

The publisher should select each certification only after personally confirming the final build and business practices. For the current code and stated operating model, the intended answers are:

1. **I do not sell or transfer user data to third parties outside approved use cases — Certify.** In the Web Store build, the only implemented external transfer is an explicit reviewed-image export to the user's Google Drive; the checked-in loopback backend is a developer-run local test service.
2. **I do not use or transfer user data for purposes unrelated to the item's single purpose — Certify.**
3. **I do not use or transfer user data to determine creditworthiness or for lending purposes — Certify.**

The public policy already needs to retain this affirmative statement:

> The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Privacy policy URL

Paste after the public policy has been updated and deployed:

> https://captainfredric.github.io/lumen-extension/privacy.html

## Google Drive transfer disclosure

Use this text in any dashboard or reviewer field asking about external data transfer:

> Google Drive export is optional and starts only when the user presses Export to Drive from a reviewed image. Lumen uses Chrome Identity and the non-sensitive `drive.file` scope, which is limited to files Lumen creates or that the user explicitly opens with Lumen. The upload contains the reviewed image and minimal file metadata: filename, review timestamp, Lumen capture ID, and source host. Disconnect removes the cached token and optional permissions. Existing exported files remain in the user's Drive until the user deletes them there.

## Publisher-only dashboard and attestation work

These steps cannot be completed safely from source code alone:

1. Enable 2-Step Verification on the Chrome Web Store publisher account.
2. Verify publisher contact email and any identity or organization details requested by the dashboard.
3. Upload the exact release ZIP as a draft and compare the dashboard-detected permission list with this document.
4. Obtain the permanent extension ID, create the matching Chrome Extension OAuth client in Google Cloud, enable Drive API, configure the OAuth consent screen, and package with the publisher-owned client ID.
5. Test the final signed-ID build with a non-publisher Google account. Confirm the consent screen says only the intended `drive.file` access and does not show a broad full-Drive scope.
6. Review and personally make every Limited Use certification. These are publisher attestations, not build artifacts.
7. Paste the deployed privacy-policy URL only after opening it in a signed-out browser and confirming it contains the Drive disclosure.
8. Upload screenshots and listing copy, choose distribution countries and visibility, provide test instructions, and submit for review.
9. If Google shows an unverified-app warning, complete the OAuth verification flow required for the configured public app before launch.
