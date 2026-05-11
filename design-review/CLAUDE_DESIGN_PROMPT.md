# Claude Design Prompt: Lumen Landing Layout Review

You are reviewing the Lumen landing site for layout, hierarchy, and visual polish.

## Product Context

Lumen is an early Chrome extension for clean, responsive, safer evidence capture for design review, QA, and product work.

What it does today:

1. Cleans sticky, fixed, and overlay page chrome before capture.
2. Forces lazy-loaded media before capture.
3. Captures desktop, tablet, and mobile sets.
4. Redacts visible sensitive data and filled inputs during export.
5. Allows anchored manual redaction boxes.
6. Stores one reusable cutaway region per URL.
7. Extracts page signals such as palette, fonts, CTA, navigation, and layout counts.
8. Saves local capture history and bundle manifests.

What is future direction:

1. Focused cutaway export.
2. Opt-in region watch.
3. Explicit agent handoff.
4. Cloud sync.
5. Billing and account plans.
6. Visual diffs.

Do not make the story broader than that.

## Design Goal

Improve the landing page layout greatly while preserving the current restrained product positioning.

The page should feel:

1. Premium.
2. Dark.
3. Technical but readable.
4. Product-ready.
5. Credible for an early Chrome extension.
6. More intentional in spacing, density, and visual rhythm.

## Main Problems To Solve

1. Improve overall layout hierarchy without changing the product wedge.
2. Make the hero and proof dashboard feel more composed.
3. Reduce any feeling of pasted-together proof cards.
4. Improve section rhythm below the fold.
5. Make the "Focused region work" section clearer and more visually integrated.
6. Improve mobile layout and navigation.
7. Keep proof assets visible as evidence, not decoration.
8. Keep current/future separation obvious.

## Tone Constraints

Use direct product language.

Avoid:

1. Grandiose startup copy.
2. AI platform language.
3. Broad surveillance positioning.
4. Pricing claims.
5. Claims that imply watch, agent handoff, cloud sync, or billing already work.
6. Replacing proof with decorative concept art.

## Files Included

Primary files:

1. `docs/index.html`
2. `docs/styles.css`
3. `docs/script.js`

Supporting context:

1. `README.md`
2. `PRODUCT_ROADMAP.md`
3. `STORE_READINESS.md`
4. `manifest.json`
5. `popup.html`
6. `popup.css`
7. `current-desktop.png`
8. `current-mobile.png`
9. `docs/assets/`

## Output Requested

Return a concrete redesign plan and code-level recommendations.

If writing code, focus on:

1. `docs/index.html`
2. `docs/styles.css`
3. Small `docs/script.js` changes only if needed.

Do not modify extension mechanics.
Do not add new fake product layers.
Do not remove the proof assets.
Do not make the product sound more complete than it is.

## Acceptance Criteria

The improved page should:

1. Keep the headline: `Clean, responsive, safer evidence from any webpage.`
2. Preserve the proof dashboard.
3. Preserve present vs future separation.
4. Preserve links to GitHub and proof bundle.
5. Improve mobile without horizontal overflow.
6. Make the site feel like a credible early product, not a concept poster.
