# Lumen Product Roadmap

Lumen should stay focused on clean, responsive, safer evidence capture for design review, QA, and product work.

The product can become ambitious without changing the first wedge. The screenshot is still only the starting point. The durable value is the workflow around the screenshot: cleanup, focused selection, redaction, context, review, and handoff.

## Current Wedge

1. Clean the page before capture.
2. Capture desktop, tablet, and mobile views together.
3. Redact visible sensitive data during export.
4. Attach useful page signals beside the image.
5. Keep local history and a portable bundle manifest.

## Implemented Now

1. Full-page capture with DOM cleanup, lazy-load preflight, tail remeasurement, and offscreen stitching.
2. Responsive capture sets for desktop, tablet, and mobile.
3. Auto-redaction preview and export redaction for visible text, token-like strings, and filled inputs.
4. Manual redaction boxes anchored to source elements when possible.
5. One anchored capture note rendered into the export.
6. Page-signal extraction for palette, typography, headline, CTA, navigation, and layout counts.
7. Local history with run details, artifacts, copyable summaries, and file actions.
8. Cutaway region picker foundation that stores one reusable page area per URL.

## Near-Term Product Bets

### Focused Cutaway Capture

Let the user draw a rectangular cutaway region and export only that area. This is useful for pricing tables, hero sections, checkout modules, dashboards, and bug reproduction areas where a full-page capture is noisy.

Implementation path:

1. Use the stored cutaway region from the popup picker.
2. Project the region through the same viewport and anchor model used by manual redaction boxes.
3. Crop the stitched output in the offscreen document after capture.
4. Store the cutaway output beside the full-page artifact in the same bundle manifest.
5. Show the cutaway in local history as its own artifact.

### Region Watch

Let the user opt into repeated captures of a marked region. This should start as local, visible, pauseable automation rather than silent surveillance.

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

1. Freeform annotation tools: arrow, text, highlight, blur, and numbered callouts.
2. Cutaway capture export: crop from stitched output while keeping manifest context.
3. Region watch: scheduled local captures of a selected area.
4. Visual diff: compare the latest region or page capture against the previous run.
5. Agent handoff: summarize change, prepare bug evidence, or draft review notes.
6. Team sync: push selected bundles to Drive, Slack, Notion, GitHub, or Jira.
7. Capture inbox: local queue of captures that need review, redaction approval, or export.
8. Capture templates: QA bug report, design review, competitor reference, release evidence.
9. Safer sharing: outbound checklist that confirms redactions, source URL, and included files.
10. Store package readiness: permissions audit, privacy policy, screenshots, listing copy, and rejection-risk review.

## Chrome Web Store Direction

Lumen should avoid hidden or surprising capture behavior. Continuous capture, watchlists, and agent handoff need visible controls, narrow permissions, explicit user opt-in, and clear local storage or data-transfer disclosure.

The current extension should stay usable with `activeTab`, optional host access for responsive captures, local storage, downloads, scripting, and offscreen composition. Do not add broad permissions until a feature clearly needs them.

## Next Engineering Milestones

1. Connect the stored cutaway region to a focused crop export.
2. Add a history detail row for cutaway artifacts.
3. Add a review screen for manual redaction and cutaway projection before export.
4. Add one real annotation tool that works on exported images.
5. Build store readiness checks: permission rationale, privacy text, listing screenshots, and automated zip validation.
