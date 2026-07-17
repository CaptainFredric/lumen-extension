# Lumen Product Roadmap

Lumen should stay focused on clean, responsive, safer evidence capture for design review, QA, and product work.

The product can become ambitious without changing the first wedge. The screenshot is still only the starting point. The durable value is the workflow around the screenshot: cleanup, focused selection, redaction, context, review, and handoff.

## Current Wedge

1. Clean the page before capture.
2. Capture desktop, tablet, and mobile views together.
3. Redact visible sensitive data during export.
4. Attach useful page signals beside the image.
5. Keep local history and portable capture details.
6. Annotate and compare saved captures before they leave the browser.
7. Monitor one selected area on an explicit local schedule.

## Implemented Now

1. Full-page capture with DOM cleanup, lazy-load preflight, tail remeasurement, and offscreen stitching.
2. Responsive capture sets for desktop, tablet, and mobile.
3. Auto-redaction preview and export redaction for visible text, token-like strings, and filled inputs.
4. Manual redaction boxes anchored to source elements when possible.
5. One anchored capture note rendered into the export.
6. Page-signal extraction for palette, typography, headline, CTA, navigation, and layout counts.
7. Local history with run details, artifacts, copyable summaries, and file actions.
8. Cutaway region picker that stores one reusable page area per URL and exports focused crops when the region resolves during capture.
9. Pre-export review that checks auto-redaction, manual projection, and cutaway resolution across the requested view set.
10. Local photo library with real previews, favorites, review state, and original-file actions.
11. Annotation Studio with arrows, rectangles, text, blur, pixelation, selection, undo, redo, and reviewed PNG export.
12. Local visual-change review with a before/after reveal, highlighted change regions, metrics, and monitor timeline.
13. One-time, repeating, and capped continuous selected-area monitoring with pause, resume, run-now, and delete controls.
14. Optional review-first Google Drive export using narrow `drive.file` access.

## Near-Term Product Bets

### Cutaway Artifact Review

The user can now draw a rectangular cutaway region and export that area beside the full-page capture. This is useful for pricing tables, hero sections, checkout modules, dashboards, and bug reproduction areas where a full-page capture is noisy.

Implemented review layer:

1. Popup history can filter artifacts by full-page image, cutaway crop, and manifest.
2. Cutaway runs show a compact preview map, dimensions, variant, and projection status in the run detail.
3. Reviewed editor output can go to Drive explicitly; any additional destination still needs its own review and consent path.

### Region Watch — Implemented Locally

The user can opt into delayed, repeated, or capped continuous captures of a marked region. The implementation is local, visible, pauseable, and bounded rather than silent surveillance.

Store-ready rules for this feature:

1. The user explicitly marks the region.
2. The user explicitly chooses the schedule.
3. The extension shows a visible status and pause control.
4. The bundle keeps retention limits and deletion controls.
5. No page content is sent off-device unless the user chooses a destination.

### Agent Handoff

Send a capture bundle, cutaway image, manifest, and extracted signals to a background agent for review notes, QA summaries, or change explanations.

Required guardrails:

1. Explicit user action before any handoff.
2. Clear destination label.
3. Redaction review step before sending.
4. Local preview of what will be sent.
5. Per-destination disable controls.

## Future Feature Backlog

1. Numbered callouts, highlight strokes, and reusable annotation styles.
2. Multiple named monitored regions per page and optional post-review change notifications.
3. Agent handoff: summarize change, prepare bug evidence, or draft review notes.
4. Additional review-first destinations such as Slack, Notion, GitHub, or Jira.
5. Capture inbox: local queue of captures that need review, redaction approval, or export.
6. Capture templates: QA bug report, design review, competitor reference, release evidence.
7. Safer sharing: outbound checklist that confirms redactions, source URL, and included files.

## Chrome Web Store Direction

Lumen should avoid hidden or surprising capture behavior. Continuous capture, watchlists, and agent handoff need visible controls, narrow permissions, explicit user opt-in, and clear local storage or data-transfer disclosure.

The current extension should stay usable with `activeTab`, optional host access for responsive captures, local storage, downloads, scripting, and offscreen composition. Do not add broad permissions until a feature clearly needs them.

## Next Engineering Milestones

1. Complete publisher-owned Web Store fields, OAuth setup, signed-ID testing, and submission.
2. Keep the four-site live matrix and deterministic difficult-page suite green for releases.
3. Keep privacy disclosure aligned as new destinations or remote automation are added.
4. Tighten the backend from demo session state into a real account path.
