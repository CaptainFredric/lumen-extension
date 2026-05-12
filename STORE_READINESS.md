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
8. Store package script builds a narrow upload ZIP and validates manifest fields, icons, permissions, and blocked development files.
9. Production manifest no longer requests the broad `tabs` permission.
10. Public privacy policy exists at `https://captainfredric.github.io/lumen-extension/privacy.html`.
11. Manifest declares the public homepage URL.

## Public URLs

1. Homepage: https://captainfredric.github.io/lumen-extension/
2. Privacy policy: https://captainfredric.github.io/lumen-extension/privacy.html
3. Support: https://github.com/CaptainFredric/lumen-extension/issues

## Permission Rationale

Current permissions:

1. `activeTab`: temporary access after user action.
2. `downloads`: save capture artifacts and manifests.
3. `offscreen`: compose stitched images in an offscreen document.
4. `scripting`: inject the capture and cleanup content script.
5. `storage`: keep settings, local history, manual redactions, and cutaway regions.

Optional host permissions:

1. `http://*/*`
2. `https://*/*`

These are only needed for tablet, mobile, and responsive captures that open temporary viewport tabs.

## Submission Risks To Resolve

1. Keep the Chrome Web Store privacy fields consistent with `PRIVACY.md` and the public privacy URL.
2. Keep continuous capture disabled until region watch has explicit schedule selection, visible pause controls, retention limits, and delete controls.
3. Keep agent handoff disabled until the user can review exactly what will be sent and choose the destination.
4. Prepare Chrome Web Store screenshots from real extension output, not concept art.
5. Fill the single-purpose field from `CHROME_STORE_LISTING.md` without widening the product story.

## Package Validation

Run:

```bash
npm run package:extension
```

The script creates `dist/lumen-extension-0.2.0.zip` and checks:

1. Manifest V3 fields, description length, background worker, popup, and version format.
2. Manifest homepage URL points to the public site.
3. Required runtime files.
4. Declared icon files and PNG dimensions.
5. Permissions against the current approved list.
6. Optional host permissions remain limited to `http://*/*` and `https://*/*`.
7. Development paths such as docs, backend, scripts, node_modules, dist, and proof assets are not included.

Current known warning:

1. No known package warning after the `tabs` permission removal. Recheck this with every package build.

## Official Policy References

1. Chrome `activeTab` permission: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
2. Manifest description length: https://developer.chrome.com/docs/extensions/reference/manifest/description
3. Chrome Web Store Program Policies: https://developer.chrome.com/docs/webstore/program-policies/policies
4. Chrome Web Store Privacy Policies: https://developer.chrome.com/docs/webstore/program-policies/privacy
5. Chrome Web Store Limited Use: https://developer.chrome.com/docs/webstore/program-policies/limited-use
6. Chrome Web Store privacy fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy

## Readiness Gate

Lumen should only ship to the Web Store when these are true:

1. Core capture flow passes local and extension e2e tests.
2. Listing copy matches implemented behavior.
3. Store screenshots show actual output.
4. Privacy policy matches the extension behavior.
5. Permission warnings are understood and justified.
6. Automated watch, sync, and agent handoff are either absent or gated behind explicit consent.
