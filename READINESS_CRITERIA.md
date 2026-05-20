# Lumen Readiness Criteria

This file defines how readiness percentages are estimated. The score is evidence based, not a promise that every website will work.

## Scoring Model

Readiness is split into three tracks:

1. Personal use readiness: Can Dan use Lumen locally on normal pages and recover from common failures?
2. Chrome Web Store beta readiness: Can the extension be submitted with honest copy, clean permissions, privacy alignment, and enough tested behavior?
3. Paid product readiness: Can users pay for it and expect account, support, retention, billing, and sync behavior to hold up?

Each percentage combines:

1. Implemented behavior: Does the feature exist in code and produce useful files?
2. User path quality: Does the UI explain what is happening before, during, and after capture?
3. Test coverage: Is the behavior covered by static checks, content-script smoke, extension smoke, e2e capture, site routes, and real-site capture?
4. Policy and privacy fit: Does the extension avoid broad permissions, hidden collection, and overclaiming?
5. Recovery behavior: Does a difficult site fail clearly or produce useful partial output?
6. Maintenance cost: Can the result be regenerated, packaged, and debugged without manual guessing?

## Current Track Estimates

### Personal Use: 81 percent

Current positives:

1. Full-page capture works on local fixtures and two real project pages.
2. Responsive desktop, tablet, and mobile export works in e2e.
3. Auto-redaction, manual redaction, cutaway, callout, page context, shelf, and history are implemented.
4. The page now shows a usage HUD during preparation and review setup, then removes it before screenshots.
5. Timed runs now appear in the shelf with copyable summaries and file actions when files exist.
6. Temporary test profiles and downloads are cleaned by scripts.

Remaining gaps:

1. Annotation is still one callout plus note, not arrows, lasso, labels, and editable shapes.
2. Some hostile pages will still need capture fallbacks beyond the last-reachable-viewport seal.
3. Manual review remains required before sharing redacted files.
4. There is no guided first-run onboarding inside the extension yet.

### Chrome Web Store Beta: 70 percent

Current positives:

1. Manifest V3 package validates with no warnings.
2. Runtime ZIP excludes docs, backend, scripts, and test assets.
3. Permissions are narrow and optional host permissions are reserved for responsive captures.
4. Public homepage and privacy policy exist.
5. Store screenshots are generated from real popup states and sample capture files at 1280 by 800.
6. Listing copy stays aligned with the current local-first product.

Remaining gaps:

1. Chrome Web Store privacy fields still need final manual completion in the dashboard.
2. First-run permission copy should be reviewed in a loaded extension session.
3. Store screenshots should be manually reviewed at 640 by 400 downscale.
4. Need a final install-from-ZIP test in a clean Chrome profile.

### Paid Product: 46 percent

Current positives:

1. The product wedge is real: clean, responsive, safer evidence capture.
2. A local service models sessions, captures, timed capture plans, agent jobs, integrations, and stats.
3. Timed capture and agent records require explicit opt-in.
4. A shared entitlement contract now gates advanced local tools in the popup and paid-path timed capture or agent records in the service.
5. Session retention and delete controls now exist for captures, timed runs, agent jobs, and saved data-control settings.

Remaining gaps:

1. No production auth, billing provider, support workflow, or account recovery.
2. No cloud storage, sync provider integration, or cloud-side deletion verification.
3. No production-grade scheduler, automated retention enforcement, or visual diff review workflow.
4. No customer-facing reliability matrix or support path.

## Next Readiness Gates

To move personal use above 85 percent:

1. Add editable annotation shapes: arrow, label, rectangle, lasso mask.
2. Add first-run onboarding and a short loaded-extension demo flow.
3. Add a clean export review confirmation that previews callout and manual regions before saving.
4. Expand real-site smoke to three to five user-selected pages.

To move Web Store beta above 75 percent:

1. Complete manual Chrome Web Store privacy fields.
2. Verify screenshots downscale cleanly.
3. Add a final clean-profile install checklist.
4. Add release notes and support instructions.

To move paid product above 50 percent:

1. Replace demo sessions with production auth and account recovery.
2. Add one opt-in destination, likely Google Drive or Slack, after export review.
3. Verify cloud-side deletion and retention behavior against that destination.
4. Connect entitlements to billing, receipts, support state, and plan change events.
5. Expand timed capture only after destination review, retention enforcement, and support flows exist.
