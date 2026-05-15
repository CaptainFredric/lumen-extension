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

### Personal Use: 78 percent

Current positives:

1. Full-page capture works on local fixtures and two real project pages.
2. Responsive desktop, tablet, and mobile export works in e2e.
3. Auto-redaction, manual redaction, cutaway, callout, manifest, and history are implemented.
4. The page now shows a usage HUD during preparation and review setup, then removes it before screenshots.
5. Temporary test profiles and downloads are cleaned by scripts.

Remaining gaps:

1. Annotation is still one callout plus note, not arrows, lasso, labels, and editable shapes.
2. Some hostile pages will still need capture fallbacks beyond the last-reachable-viewport seal.
3. Manual review remains required before sharing redacted artifacts.
4. There is no guided first-run onboarding inside the extension yet.

### Chrome Web Store Beta: 67 percent

Current positives:

1. Manifest V3 package validates with no warnings.
2. Runtime ZIP excludes docs, backend, scripts, and test assets.
3. Permissions are narrow and optional host permissions are reserved for responsive captures.
4. Public homepage and privacy policy exist.
5. Store screenshots are generated from real popup states and proof artifacts at 1280 by 800.
6. Listing copy stays aligned with the current local-first product.

Remaining gaps:

1. Chrome Web Store privacy fields still need final manual completion in the dashboard.
2. First-run permission copy should be reviewed in a loaded extension session.
3. Store screenshots should be manually reviewed at 640 by 400 downscale.
4. Need a final install-from-ZIP test in a clean Chrome profile.

### Paid Product: 42 percent

Current positives:

1. The product wedge is real: clean, responsive, safer evidence capture.
2. A local backend models sessions, captures, watch plans, agent jobs, integrations, and stats.
3. Future watch and agent records require explicit opt-in.
4. A shared entitlement contract now gates advanced local tools in the popup and paid-path watch or agent records in the backend.

Remaining gaps:

1. No production auth, billing provider, support workflow, or account recovery.
2. No cloud storage, sync provider integration, or deletion controls.
3. No durable watch scheduler, retention controls, or visual diff review workflow.
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
2. Add deletion and retention controls before cloud upload.
3. Add one opt-in destination, likely Google Drive or Slack, after export review.
4. Connect entitlements to billing, receipts, support state, and plan change events.
5. Build region watch only after pause, schedule, retention, and review controls exist.
