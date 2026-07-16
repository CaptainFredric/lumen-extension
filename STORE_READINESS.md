# Chrome Web Store Readiness

This file tracks what Lumen needs before a serious Chrome Web Store submission.

## Current Store-Positive Choices

1. Manifest V3.
2. `activeTab` based user-triggered capture posture.
3. Optional host permissions for responsive viewport captures.
4. Local-first history and region storage.
5. Clear blocked-page handling for Chrome, Web Store, extension, and internal browser pages.
6. Manifest description shortened to 131 characters.
7. Landing page keeps present features separate from broader product planning.
8. Store package script builds a narrow upload ZIP and validates manifest fields, icons, permissions, and blocked development files.
9. Production manifest no longer requests the broad `tabs` permission.
10. Public privacy policy exists at `https://captainfredric.github.io/lumen-extension/privacy.html`.
11. Manifest declares the public homepage URL.
12. Store screenshot generator creates 1280 by 800 PNGs from actual popup states and current sample capture assets.
13. Backend watch and agent routes require explicit opt-in before creating automation records.
14. A clean-profile test boots the exact allowlisted release ZIP without modifying its manifest.
15. Capture-note text stays in local storage instead of Chrome Sync.
16. Capture metadata sync is off unless the user explicitly enables it and the data-control service confirms the setting.
17. One-shot responsive site access is removed after capture; deleting the last timed capture removes its site access.
18. Local workspace deletion is available without an account or backend connection.
19. Stored capture URLs remove fragments and common token, auth, session, secret, and key parameters.
20. The local photo library stores compact preview blobs and metadata in extension-owned IndexedDB while full-resolution originals remain in Chrome Downloads.
21. Library preview cleanup is bounded to a default 50 MB or 500 preview-bearing captures and preserves favorites, capture metadata, and downloaded originals.
22. Freeform lasso capture preserves its polygon through projection and exports transparent pixels outside the selected path.
23. Selected-area timers are explicit and local: one delayed run, scheduled repeat, or continuous monitoring capped at 10, 25, or 50 runs.
24. Timed runs save the resolved selected area rather than a silent full-page fallback and stop when the saved region can no longer be resolved safely.

## Public URLs

1. Homepage: https://captainfredric.github.io/lumen-extension/
2. Privacy policy: https://captainfredric.github.io/lumen-extension/privacy.html
3. Support: https://github.com/CaptainFredric/lumen-extension/issues

## Permission Rationale

Current permissions:

1. `activeTab`: temporary access after user action.
2. `alarms`: run explicitly saved one-time, repeating, or capped continuous selected-area captures while Chrome is available.
3. `downloads`: save full-resolution capture artifacts and manifests; the local library keeps compact previews and references to these originals.
4. `offscreen`: compose stitched images in an offscreen document.
5. `scripting`: inject the capture and cleanup content script.
6. `storage`: keep settings, local history, manual redactions, focused regions, timed capture plans, and callout regions. Compact image previews use extension-owned IndexedDB rather than Chrome Sync.

Optional host permissions:

1. `http://*/*`
2. `https://*/*`

These are needed for tablet, mobile, and responsive captures that open temporary viewport tabs, and for explicitly saved selected-area timer plans. One-shot grants are removed after capture unless a saved plan for that origin still exists. Deleting the last plan removes that saved origin access.

## Submission Risks To Resolve

1. Keep the Chrome Web Store privacy fields consistent with `PRIVACY.md` and the public privacy URL.
2. Manually verify one-time, repeating, pause/resume, run-cap completion, missed-alarm behavior, and last-plan permission revocation in stock Chrome.
3. Keep continuous monitoring local, selected-area-only, and capped; do not imply an always-on remote service when Chrome is closed.
4. Keep cloud destinations and agent handoff disabled until the user can review exactly what will leave the device and choose the destination.
5. Review generated Chrome Web Store screenshots from `store-assets/screenshots/` against final listing copy, including the local library and timer controls.
6. Fill the single-purpose field from `CHROME_STORE_LISTING.md` without widening the product story into cloud storage or remote monitoring.
7. Manually exercise permission allow, deny, one-shot revoke, last-plan revoke, and uninstall behavior in stock Chrome.

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
7. Development paths such as docs, backend, scripts, node_modules, dist, and sample capture assets are not included.
8. Local photo-library runtime files are included while library test fixtures and documentation remain excluded.

Run `npm run smoke:release` to rebuild that ZIP, extract it without source changes, load it in a clean profile, and verify first-run, storage privacy, initial permissions, and runtime errors.

## Screenshot Generation

Run:

```bash
npm run store:screenshots
```

The script writes `store-assets/screenshots/*.png`, validates each image is 1280 by 800, and removes its temporary extension profile afterward.

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
6. Local timed capture is opt-in, selected-area-only, visibly controllable, and capped where continuous; cloud sync and agent handoff remain absent or explicitly gated.
