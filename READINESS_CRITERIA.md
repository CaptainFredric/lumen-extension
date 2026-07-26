# Lumen Readiness Criteria

This file defines how readiness percentages are estimated. The score is evidence based, not a promise that every website will work.

## Scoring Model

Readiness is split into three tracks:

1. Personal use readiness: Can Dan use Lumen locally on normal pages and recover from common failures?
2. Chrome Web Store beta readiness: Can the extension be submitted with honest copy, clean permissions, privacy alignment, and enough tested behavior?
3. Paid product readiness: Can users pay for it and expect account, support, retention, billing, and sync behavior to hold up?

Each percentage combines:

1. Implemented behavior: Does the feature exist in code and produce artifacts?
2. User path quality: Does the UI explain what is happening before, during, and after capture?
3. Test coverage: Is the behavior covered by static checks, content-script smoke, extension smoke, e2e capture, site routes, and real-site capture?
4. Policy and privacy fit: Does the extension avoid broad permissions, hidden collection, and overclaiming?
5. Recovery behavior: Does a difficult site fail clearly or produce a useful partial artifact?
6. Maintenance cost: Can the result be regenerated, packaged, and debugged without manual guessing?

## Current Track Estimates

### Personal Use: 91 percent

Current positives:

1. Full-page capture works on deterministic local fixtures and a four-site live matrix covering Lumen, GitHub, Chrome documentation, and MDN.
2. Responsive desktop, tablet, and mobile export works in e2e.
3. Auto-redaction, manual redaction, rectangular cutaway, transparent lasso, callout, manifest, and history are implemented.
4. The page now shows a usage HUD during preparation and review setup, then removes it before screenshots.
5. Temporary test profiles and downloads are cleaned by scripts.
6. Capture health blocks incomplete slice coverage and records verification per responsive view.
7. Offset nested scrollers have a pixel-level crop and stitch regression.
8. Redaction rescans each slice, uses opaque output, and fails closed when its review limit is exceeded.
9. A compact first-run tip keeps one-click capture above the fold, and successful manual captures open the matching Capture Result workspace without another popup step.
10. Rectangle and freeform lasso selections survive layout projection; lasso exports retain transparent pixels outside the path.
11. The local photo library stores gallery previews and bounded whole-capture editor images, supports search/filter/favorite workflows, and keeps full-resolution originals in Downloads.
12. Local selected-area automation now distinguishes a delayed one-time run, scheduled repeat, and capped continuous monitoring.
13. Continuous plans have an explicit 10, 25, or 50 run stop, and timed runs fail instead of silently saving a full page when the selected region cannot resolve.
14. The annotation studio supports arrows, rectangles, text, blur, pixelation, selection, undo, redo, and local reviewed-image export.
15. Visual-change review provides a before/after reveal, highlighted change regions, local difference statistics, and a monitor timeline.
16. Difficult-site fixtures now cover long pages, nested scrollers, late-growing tails, transforms, lazy media, fixed overlays, canvas, sandboxed iframes, and open and closed shadow-root behavior.
17. Rectangle and lasso pickers can capture the selected current-viewport area immediately without waiting for a second popup action; Save still creates a reusable monitoring region.
18. Successful manual captures open a clean viewer-first result workspace with whole-page/width/100% views, centered zoom, drag-to-pan, Copy image, PNG, paginated PDF, optional Drive, Edit, original-file, library, Settings, and confirmed remove-local-copy actions.

Remaining gaps:

1. Some hostile pages will still need capture fallbacks beyond the current integrity-checked retry path.
2. Canvas pixels, cross-origin iframe content, closed shadow roots, and image-only secrets remain manual-review surfaces.
3. Manual review remains required before sharing redacted artifacts.

### Chrome Web Store Beta: 84 percent

Current positives:

1. The Manifest V3 package validates with no errors; its only default warning explains that Drive stays disabled until the publisher supplies the final OAuth client ID.
2. Runtime ZIP excludes docs, backend, scripts, and test assets.
3. Permissions are narrow and optional host permissions are reserved for responsive captures, explicitly saved timed plans, and the Google API upload origin after a user starts Drive export.
4. Public homepage and privacy policy exist.
5. Store screenshots are generated from real popup states and sample capture artifacts at 1280 by 800.
6. Listing copy stays aligned with the current local-first product.
7. The exact production ZIP boots in a clean Chromium profile and proves first-run/local-storage behavior.
8. One-shot site access is revoked after capture, while the last timed capture owns any longer lease.
9. Note drafts stay out of Chrome Sync, stored URLs remove sensitive query keys, and local deletion is always available.
10. Gallery previews and bounded editor images remain in extension-owned IndexedDB, downloaded originals remain user-controlled, and the privacy policy distinguishes them.
11. Timed captures are local, opt-in, selected-area-only, and bounded for continuous use rather than presented as an always-on remote service.
12. Loaded-extension coverage proves optional site-access grant, last-plan permission revocation, alarm cleanup, and full local-workspace permission cleanup.
13. A field-by-field privacy-form draft, release notes, and publisher-only launch checklist are checked in.
14. Optional reviewed-image Drive export uses `identity` only after user action and the narrow `drive.file` scope rather than broad Drive access.
15. The production package declares full-page, visible-area, and area-picker shortcuts, and the clean-profile test verifies all three registrations.
16. Exact-package automation proves capture is rejected specifically at the missing-`activeTab` boundary, retains no site origins, and requires packaged full-page, visible-area, and drawn-area shortcut flows to complete through their result-workspace handoff on Linux CI.
17. GitHub Actions publishes the exact tested Web Store ZIP as `lumen-extension-<commit>`.

Remaining gaps:

1. The updated public privacy policy must deploy successfully and be checked in a signed-out browser before the dashboard form is submitted.
2. Chrome Web Store privacy fields and Limited Use attestations still need final publisher completion in the dashboard.
3. Permission denial, uninstall cleanup, Drive consent/revocation, the physical toolbar action, all three shortcuts, and drawing through the area shortcut still need one final manual review in stock Chrome. Automated checks cannot claim gestures that Chrome rejects from a virtual display.
4. The final screenshot pack has been reviewed at full resolution; confirm the uploaded Web Store previews remain legible after dashboard processing.
5. One-time, repeating, run-cap completion, browser-sleep deferral, and last-plan permission revocation still need a final stock-Chrome manual pass.
6. The final published extension ID must be connected to a publisher-owned Google OAuth client and checked with a non-publisher account.

### Paid Product: 49 percent

Current positives:

1. The product wedge is real: clean, responsive, safer evidence capture.
2. A local backend models sessions, captures, watch plans, agent jobs, integrations, and stats.
3. Local selected-area timers are implemented with explicit opt-in, pause/resume controls, and bounded continuous runs.
4. Future cloud destinations and agent records still require explicit opt-in.
5. A shared entitlement contract now unlocks the local capture toolkit while keeping connected cloud and agent paths separate.
6. Backend retention and delete controls now exist for session-owned captures, watch records, agent jobs, and saved data-control settings.
7. Reviewed images have one explicit destination path to Google Drive, with disconnect and per-file scope behavior modeled and tested.

Remaining gaps:

1. No production auth, billing provider, support workflow, or account recovery.
2. Google Drive upload exists, but publisher OAuth setup, production verification, support, and cloud-side deletion guidance still need a launch pass.
3. The scheduler is local to Chrome; there is no cloud runner, remote alert delivery, or guarantee that captures run while the browser is closed.
4. Visual diff review is local; there is no remote alert delivery or server-side monitor execution.
5. A checked-in reliability matrix exists, but production support ownership and response targets are still missing.

## Next Readiness Gates

To keep personal use above 90 percent:

1. Keep annotation export and visual-diff math covered by deterministic tests.
2. Run the four-page live-site matrix before tagged releases and record any site-specific limitations.
3. Keep the shipped iframe and canvas manual-review warnings covered as capture behavior evolves.

To move Web Store beta above 85 percent:

1. Verify the deployed public privacy policy includes Drive export, then complete the manual Chrome Web Store privacy fields.
2. Confirm the uploaded Web Store screenshot previews remain legible after dashboard processing.
3. Manually review allow, deny, one-shot revoke, timed-capture revoke, and uninstall behavior in stock Chrome.
4. Physically verify the toolbar action and full-page, visible-area, and area-picker shortcuts, including drawing and capturing an area.
5. Verify the final Drive OAuth consent and disconnect flow with a non-publisher account.
6. Review Capture Result, annotation, visual-change, local library, delayed run, scheduled repeat, capped continuous, and Drive states in the final store screenshot set.

To move paid product above 50 percent:

1. Replace demo sessions with production auth and account recovery.
2. Finish publisher configuration and support guidance for the opt-in Google Drive destination.
3. Verify cloud-side deletion and retention behavior against Drive.
4. Connect entitlements to billing, receipts, support state, and plan change events.
5. Add any destination beyond reviewed Drive export only after it has a clear review step, retention rules, and verified deletion behavior.
