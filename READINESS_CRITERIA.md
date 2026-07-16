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

### Personal Use: 88 percent

Current positives:

1. Full-page capture works on local fixtures and two real project pages.
2. Responsive desktop, tablet, and mobile export works in e2e.
3. Auto-redaction, manual redaction, rectangular cutaway, transparent lasso, callout, manifest, and history are implemented.
4. The page now shows a usage HUD during preparation and review setup, then removes it before screenshots.
5. Temporary test profiles and downloads are cleaned by scripts.
6. Capture health blocks incomplete slice coverage and records verification per responsive view.
7. Offset nested scrollers have a pixel-level crop and stitch regression.
8. Redaction rescans each slice, uses opaque output, and fails closed when its review limit is exceeded.
9. A focused three-step first-run guide now leads directly into export review.
10. Rectangle and freeform lasso selections survive layout projection; lasso exports retain transparent pixels outside the path.
11. The local photo library stores real preview blobs, supports search/filter/favorite workflows, and keeps full-resolution originals in Downloads.
12. Local selected-area automation now distinguishes a delayed one-time run, scheduled repeat, and capped continuous monitoring.
13. Continuous plans have an explicit 10, 25, or 50 run stop, and timed runs fail instead of silently saving a full page when the selected region cannot resolve.

Remaining gaps:

1. Annotation is still one callout plus note, not arrows, labels, and editable shapes. The capture lasso is shape-true but is not a general annotation editor.
2. Some hostile pages will still need capture fallbacks beyond the current integrity-checked retry path.
3. Manual review remains required before sharing redacted artifacts.

### Chrome Web Store Beta: 79 percent

Current positives:

1. Manifest V3 package validates with no warnings.
2. Runtime ZIP excludes docs, backend, scripts, and test assets.
3. Permissions are narrow and optional host permissions are reserved for responsive captures.
4. Public homepage and privacy policy exist.
5. Store screenshots are generated from real popup states and sample capture artifacts at 1280 by 800.
6. Listing copy stays aligned with the current local-first product.
7. The exact production ZIP boots in a clean Chromium profile and proves first-run/local-storage behavior.
8. One-shot site access is revoked after capture, while the last timed capture owns any longer lease.
9. Note drafts stay out of Chrome Sync, stored URLs remove sensitive query keys, and local deletion is always available.
10. Preview images remain in extension-owned IndexedDB, downloaded originals remain user-controlled, and the privacy policy distinguishes the two.
11. Timed captures are local, opt-in, selected-area-only, and bounded for continuous use rather than presented as an always-on remote service.

Remaining gaps:

1. Chrome Web Store privacy fields still need final manual completion in the dashboard.
2. Permission allow, deny, and revoke copy still needs one final manual toolbar-driven review in stock Chrome.
3. Store screenshots, including library and timer states, should be manually reviewed at 640 by 400 downscale.
4. One-time, repeating, run-cap completion, browser-sleep deferral, and last-plan permission revocation still need a final stock-Chrome manual pass.

### Paid Product: 46 percent

Current positives:

1. The product wedge is real: clean, responsive, safer evidence capture.
2. A local backend models sessions, captures, watch plans, agent jobs, integrations, and stats.
3. Local selected-area timers are implemented with explicit opt-in, pause/resume controls, and bounded continuous runs.
4. Future cloud destinations and agent records still require explicit opt-in.
5. A shared entitlement contract now unlocks the local capture toolkit while keeping connected cloud and agent paths separate.
6. Backend retention and delete controls now exist for session-owned captures, watch records, agent jobs, and saved data-control settings.

Remaining gaps:

1. No production auth, billing provider, support workflow, or account recovery.
2. No cloud storage, sync provider integration, or cloud-side deletion verification.
3. The scheduler is local to Chrome; there is no cloud runner, remote alert delivery, or guarantee that captures run while the browser is closed.
4. No visual diff review workflow or production destination for monitored captures.
5. No customer-facing reliability matrix or support path.

## Next Readiness Gates

To move personal use above 90 percent:

1. Add editable annotation shapes such as arrows, labels, and rectangles without conflating them with the existing capture lasso.
2. Expand the annotation editor beyond the current anchored callout and note.
3. Expand real-site smoke to three to five user-selected pages.

To move Web Store beta above 85 percent:

1. Complete manual Chrome Web Store privacy fields.
2. Verify screenshots downscale cleanly.
3. Manually review allow, deny, one-shot revoke, timed-capture revoke, and uninstall behavior in stock Chrome.
4. Add release notes and support instructions.
5. Review local library, delayed run, scheduled repeat, and capped continuous states in the final store screenshot set.

To move paid product above 50 percent:

1. Replace demo sessions with production auth and account recovery.
2. Add one opt-in destination, likely Google Drive or Slack, after export review.
3. Verify cloud-side deletion and retention behavior against that destination.
4. Connect entitlements to billing, receipts, support state, and plan change events.
5. Add an opt-in cloud destination only after monitored captures have a clear review step, remote retention rules, and verified deletion behavior.
