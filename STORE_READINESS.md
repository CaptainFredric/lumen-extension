# Chrome Web Store Readiness

This file tracks what Lumen needs before a serious Chrome Web Store submission.

## Current Store-Positive Choices

1. Manifest V3.
2. `activeTab` based user-triggered capture posture.
3. Optional host permissions for responsive viewport captures.
4. Local-first history and region storage.
5. Clear blocked-page handling for Chrome, Web Store, extension, and internal browser pages.
6. Manifest description shortened to 131 characters.
7. The landing page identifies the Chrome extension as the actual capture app and limits the website to truthful installation guidance and a concise feature overview.
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
20. The local photo library stores gallery previews, bounded whole-capture editor images, and metadata in extension-owned IndexedDB while full-resolution originals remain in Chrome Downloads.
21. Gallery cleanup is bounded to 50 MB or 500 preview-bearing captures; editor-source cleanup and cached-review-PDF cleanup each have separate 250 MB or 75-capture budgets. All preserve favorites, capture metadata, and downloaded originals.
22. Freeform lasso capture preserves its polygon through projection and exports transparent pixels outside the selected path.
23. Selected-area timers are explicit and local: one delayed run, scheduled repeat, or continuous monitoring capped at 10, 25, or 50 runs.
24. Timed runs save the resolved selected area rather than a silent full-page fallback and stop when the saved region can no longer be resolved safely.
25. Deterministic difficult-site fixtures cover long pages, nested application scrollers, late-growing tails, sticky and fixed overlays, lazy media, transforms, canvas, sandboxed iframes, and open and closed shadow-root behavior.
26. A loaded-extension permission test proves a clean install starts without host access, a user gesture can grant one origin, the last timed-plan deletion revokes that origin and clears its alarm, and local workspace cleanup revokes remaining optional site access.
27. Reviewed-image Google Drive export is optional, starts from an explicit user action, uses Chrome Identity with the narrow `drive.file` scope, and removes cached authorization and optional permissions on disconnect.
28. Dedicated Settings expose reversible Privacy Shield, local-only mode, review-before-save, monitor pause/resume behavior, optional-permission revocation, Drive disconnect, and verified local-workspace deletion outcomes.
29. Local exports include PNG and paginated raster PDF, with Fit, 100%, and keyboard zoom controls for the local working image; connected export remains separately consented.
30. Fresh installs default to one-click local capture with automatic redaction enabled, capture-details JSON disabled, review-before-save disabled, and Privacy Shield available as an explicit stronger mode.
31. Capture-time review PDFs are generated from the original rendered output or tiles at up to 3200 raster pixels per page and stored under their own bounded local cache.
32. The clean-install popup keeps Capture page above the fold, does not force review when the saved default is off, and shows direct open, edit/export, reveal, and library actions after success.
33. Visible-area capture is available from the popup quick-action menu and as a keyboard command, saving one current viewport without a scroll pass.
34. Long capture runs publish active state so the popup can be reopened to cancel at a safe point or return to the source tab.
35. Rectangle and lasso pickers offer an immediate one-viewport **Capture now** action while retaining an explicit **Save** path for local monitoring.
36. Successful manual captures open a local Capture Result workspace with zoom, Copy image, PNG, paginated PDF, optional Drive, Annotate, original-file, and library actions; timed runs do not open tabs.
37. Three commands are declared and checked in the release package: full page (`Alt+Shift+L`), visible area (`Alt+Shift+V`), and area picker (`Alt+Shift+A`).
38. The clean-profile release test uses the exact production ZIP, verifies command registration and specific no-gesture rejection, checks zero persistent host access, and requires packaged full-page, visible-area, and drawn-area shortcut flows plus result handoff on Linux CI.
39. CI uploads the exact tested ZIP as `lumen-extension-<commit>` instead of requiring the publisher to rebuild it locally.

## Public URLs

1. Homepage: https://captainfredric.github.io/lumen-extension/
2. Privacy policy: https://captainfredric.github.io/lumen-extension/privacy.html
3. Support: https://github.com/CaptainFredric/lumen-extension/issues

## Permission Rationale

Current permissions:

1. `activeTab`: temporary access after user action.
2. `alarms`: run explicitly saved one-time, repeating, or capped continuous selected-area captures while Chrome is available.
3. `downloads`: save full-resolution capture artifacts, optional manifests, and user-exported PNG and raster PDF files; the local library keeps gallery previews, bounded editor images, cached review PDFs, and references to downloaded originals.
4. `offscreen`: compose stitched images in an offscreen document.
5. `scripting`: inject the capture and cleanup content script.
6. `storage`: keep settings, local history, manual redactions, focused regions, timed capture plans, and callout regions. Gallery previews, bounded whole-capture editor images, and capture-time raster PDF caches use extension-owned IndexedDB rather than Chrome Sync.

Optional permissions:

1. `identity`: requested only when the user chooses reviewed-image export to Google Drive. Chrome obtains the OAuth token for the narrow `drive.file` scope; Lumen does not store that token in its own database.

Optional host permissions:

1. `http://*/*`
2. `https://*/*`

These are needed for tablet, mobile, and responsive captures that open temporary viewport tabs, for explicitly saved selected-area timer plans, and for the Google API upload origin only after the user starts Drive export. One-shot page grants are removed after capture unless a saved plan for that origin still exists. Deleting the last plan removes that saved origin access.

## Submission Risks To Resolve

1. Recheck the deployed `privacy.html` in a signed-out browser before dashboard submission; all source copies now describe reviewed-image Drive export.
2. Complete the field-by-field draft in `CHROME_WEB_STORE_PRIVACY_FORM.md` in the publisher dashboard and personally make the Limited Use attestations.
3. Manually verify one-time, repeating, pause/resume, run-cap completion, missed-alarm behavior, and last-plan permission revocation in stock Chrome.
4. Keep continuous monitoring local, selected-area-only, and capped; do not imply an always-on remote service when Chrome is closed.
5. Keep Drive export review-first and user initiated; do not imply background cloud backup, full-Drive access, or remote monitoring.
6. Review generated Chrome Web Store screenshots from `store-assets/screenshots/` against final listing copy, including annotation, change review, local library, timer, and Drive states.
7. Fill the single-purpose field from `CHROME_STORE_LISTING.md` without widening the product story beyond capture and review.
8. Manually exercise permission allow, deny, one-shot revoke, last-plan revoke, Drive connect/disconnect, and uninstall behavior in stock Chrome.
9. Create the publisher-owned Chrome Extension OAuth client for the permanent extension ID, save it as the `LUMEN_GOOGLE_DRIVE_CLIENT_ID` GitHub Actions repository secret, and verify the final consent screen with a non-publisher Google account.
10. Use the `lumen-store-screenshots-<commit>` CI artifact for submission; do not upload the checked-in annotation review preview, which predates the corrected Drive-status layout.
11. In stock Chrome, physically test the toolbar action and all three shortcuts. Linux CI requires full-page and visible-area commands plus a Playwright-drawn area-picker capture to complete from the exact ZIP; the physical check remains the release sign-off.
12. Upload the matching `lumen-extension-<commit>` CI artifact so the submitted ZIP is the package that passed the clean-profile release test.

## Package Validation

Run:

```bash
npm run package:extension
```

The script creates `dist/lumen-extension-0.5.0.zip` and checks:

1. Manifest V3 fields, description length, background worker, popup, and version format.
2. Manifest homepage URL points to the public site.
3. Required runtime files.
4. Declared icon files and PNG dimensions.
5. Permissions against the current approved list.
6. Optional host permissions remain limited to `http://*/*` and `https://*/*`.
7. Development paths such as docs, backend, scripts, node_modules, dist, and sample capture assets are not included.
8. Local photo-library, Capture Result, annotation, visual-review, and optional Drive runtime files are included while tests and documentation remain excluded.
9. All three capture commands and their default shortcuts are present.
10. Optional permissions remain allowlisted, and any packaged OAuth configuration uses only the narrow `drive.file` scope.

Run `npm run smoke:release` to rebuild that ZIP, extract it without source changes, and load it in a clean profile. The test verifies first run, storage privacy, initial permissions, all three registered commands, rejection specifically at the missing-`activeTab` boundary, the packaged Capture Result page, and no persistent host access. Linux CI additionally requires native full-page and visible-area shortcut captures, an area picker opened from its native shortcut and completed with a Playwright drag, and automatic result opening; a local host that blocks OS input reports the remaining boundary. A physical toolbar click and all three shortcuts remain final stock-Chrome checks.

Run `npm run smoke:permissions` manually in a headed stock-Chrome release session, click the isolated fixture's **Allow** prompt, and verify optional origin grant, timed-plan lease retention, last-plan revocation, alarm cleanup, and local-workspace permission cleanup. This native consent flow is intentionally not an unattended CI gate.

Run `npm run smoke:settings`, `npm run smoke:export`, and `npm run smoke:export-integrity` to verify the dedicated Settings contract, reversible Privacy Shield enforcement, local working-image zoom, raster PDF generation, cached-PDF provenance and pruning, and export download lifecycle.

Run `npm run smoke:difficult-sites` for deterministic hostile-page classes. Run `npm run smoke:real-sites` separately for the live Lumen site, GitHub, Chrome extension documentation, and MDN. All four live captures completed in the 0.4.0 release verification pass; live-site checks are intentionally not a CI gate because third-party availability and markup can change.

## Screenshot Generation

Run:

```bash
npm run store:screenshots
```

The script writes `store-assets/screenshots/*.png`, validates each image is 1280 by 800, and removes its temporary extension profile afterward.
The main CI workflow also regenerates the pack from the pushed commit and uploads it as `lumen-store-screenshots-<commit>` for the publisher handoff.

Current known package warning:

1. Google Drive remains disabled in packages built without `LUMEN_GOOGLE_DRIVE_CLIENT_ID`. This is intentional until the publisher creates the OAuth client tied to the permanent extension ID.

## Official Policy References

1. Chrome `activeTab` permission: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
2. Manifest description length: https://developer.chrome.com/docs/extensions/reference/manifest/description
3. Chrome Web Store Program Policies: https://developer.chrome.com/docs/webstore/program-policies/policies
4. Chrome Web Store Privacy Policies: https://developer.chrome.com/docs/webstore/program-policies/privacy
5. Chrome Web Store Limited Use: https://developer.chrome.com/docs/webstore/program-policies/limited-use
6. Chrome Web Store privacy fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
7. Chrome Identity API: https://developer.chrome.com/docs/extensions/reference/api/identity
8. Google Drive `drive.file` scope: https://developers.google.com/workspace/drive/api/guides/api-specific-auth

## Readiness Gate

Lumen should only ship to the Web Store when these are true:

1. Core capture flow passes local and extension e2e tests.
2. Listing copy matches implemented behavior.
3. Store screenshots show actual output.
4. Privacy policy matches the extension behavior.
5. Permission warnings are understood and justified.
6. Local timed capture is opt-in, selected-area-only, visibly controllable, and capped where continuous.
7. Optional Drive export is review-first, explicitly initiated, narrowly scoped, accurately disclosed, and tested with the final publisher OAuth configuration.
8. Settings, local PNG/raster-PDF export, cached-PDF integrity, and the four-site live matrix pass for the release candidate.
9. The commit-addressed CI ZIP is used for submission, and the remaining physical toolbar, shortcut, and area-drawing checks pass in stock Chrome.
