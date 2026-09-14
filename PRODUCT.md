# Lumen product contract

Lumen preserves webpage evidence for design review, QA, and product work.
The central workflow is capture, inspect, annotate or redact, export, and revisit.
Scope, viewport, context, review, time, and handoff determine whether a feature belongs.

## Surface responsibilities

| Surface | Responsibility |
| --- | --- |
| Popup | Choose scope and start or cancel a capture |
| Capture Result | Inspect a capture set, choose originals, open editing and export |
| Capture Library | Revisit captures and manage monitors |
| Settings | Defaults, safeguards, permissions, storage, explicit destinations |
| Annotation Studio / Compare | Tools opened from captured evidence |

The popup now owns four capture scopes, safeguards, preflight confirmation,
active job status, and one Last Capture entry. Persistent browsing and monitor
administration live in the Library. Result Details shows context retained with
that capture when capture-details JSON was enabled; older captures cannot
recover it from the latest global analysis record. Experimental account and
delivery controls are absent from the launcher.

## Vocabulary

| Preferred UI term | Meaning |
| --- | --- |
| Capture | One user requested run |
| Capture Set | Related originals and responsive views from that run |
| Selected Area | Rectangle or lasso scope |
| Callout | A note identifying a region |
| Page Context | Source and extracted page signals beside the image |
| Capture Library | Persistent local collection of captures and monitors |
| Recent | A short list linking to saved captures |
| Monitor | Explicitly scheduled repeated capture of a selected source |
| Compare | Visual comparison of saved evidence |
| Private Review Mode | Optional coordinated redaction, local storage, metadata and save-review safeguards |

Visible labels, Settings and privacy disclosures use this vocabulary. Internal
`privacyShieldEnabled` and `cutaway` keys remain compatible with saved preferences.
Selected Area capture opens a bounded approval window when review is enabled;
cancellation saves nothing, and changed page geometry requires a new review.

## Current boundaries

Public copy describes tasks and outcomes in ordinary language. Evidence is an
internal product concept; use the word publicly where it adds meaning rather
than as a repeated slogan. Avoid dramatic noun fragments and language that
assumes every capture represents a defect. Responsive capture saves chosen
viewport states. It does not diagnose defects or discover breakpoints.
Keep verification records accessible as supporting details.
Headings name capabilities or tasks directly. Avoid filler such as "ready to",
"what you need", and "useful details" where a concrete description fits.
Give each feature one place in the page rather than repeating it for coverage.
Keep build provenance behind supporting disclosures. Public mode labels mirror
the launcher: Full page, Visible, Area, Set. Use formal UI names when directing
someone to a control; ordinary prose can describe screenshots and the local library.

Capture, responsive sets, selected areas, review, annotation, local library,
comparison, bounded monitoring, and explicit reviewed Drive export belong to the
local product. Production accounts, billing, general cloud sync, and agent
routing remain experimental or future work. They must not become primary actions.

ZIP export contains retained originals. Later annotated exports are separate.
Redaction is optional and requires user inspection. Geometry tests on public
fixtures prove those fixtures' defects, not capture reliability.

## Truth ownership

1. Runtime defaults: `settings-store.js`; capture configuration: `config.js`.
2. User data behavior: `PRIVACY.md`, checked against runtime and public policy.
3. Install and developer commands: `README.md` and `package.json`.
4. Product boundaries and terminology: this file.
5. Release evidence and remaining gates: `STORE_READINESS.md` and `RELIABILITY_MATRIX.md`.
6. Store copy and design prompts are derived material; they cannot override runtime facts.

`npm run test:product-contract` checks fresh defaults, preservation of explicit
choices, coordinated protections, and the shared default disclosure in five
release documents. A passing contract does not establish Web Store approval.
Use release gates and their evidence instead of completion percentages.
