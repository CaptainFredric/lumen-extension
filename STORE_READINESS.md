# Chrome Web Store Readiness

This file tracks what Lumen needs before a serious Chrome Web Store submission.

## Current Store-Positive Choices

1. Manifest V3.
2. `activeTab` based user-triggered capture posture.
3. Optional host permissions for responsive viewport captures.
4. Local-first history and region storage.
5. Clear blocked-page handling for Chrome, Web Store, extension, and internal browser pages.
6. Manifest description shortened to 131 characters.
7. Landing page keeps present features separate from future direction.

## Permission Rationale

Current permissions:

1. `activeTab`: temporary access after user action.
2. `downloads`: save capture artifacts and manifests.
3. `offscreen`: compose stitched images in an offscreen document.
4. `scripting`: inject the capture and cleanup content script.
5. `storage`: keep settings, local history, manual redactions, and cutaway regions.
6. `tabs`: current implementation uses tab querying and temporary viewport tabs. This should receive another audit before submission.

Optional host permissions:

1. `http://*/*`
2. `https://*/*`

These are only needed for tablet, mobile, and responsive captures that open temporary viewport tabs.

## Submission Risks To Resolve

1. Write a privacy policy that explains local capture history, screenshots, redaction metadata, page-signal extraction, and any future sync behavior.
2. Keep continuous capture disabled until region watch has explicit schedule selection, visible pause controls, retention limits, and delete controls.
3. Keep agent handoff disabled until the user can review exactly what will be sent and choose the destination.
4. Audit whether `tabs` can be removed or narrowed before submission.
5. Prepare Chrome Web Store screenshots from real extension output, not concept art.
6. Add a package validation script that builds the upload zip and checks file size, manifest fields, icons, and blocked development files.
7. Add a support URL, privacy URL, and accurate single-purpose field.

## Official Policy References

1. Chrome `activeTab` permission: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
2. Manifest description length: https://developer.chrome.com/docs/extensions/reference/manifest/description
3. Chrome Web Store Program Policies: https://developer.chrome.com/docs/webstore/program-policies/policies

## Readiness Gate

Lumen should only ship to the Web Store when these are true:

1. Core capture flow passes local and extension e2e tests.
2. Listing copy matches implemented behavior.
3. Store screenshots show actual output.
4. Privacy policy matches the extension behavior.
5. Permission warnings are understood and justified.
6. Automated watch, sync, and agent handoff are either absent or gated behind explicit consent.
