# Lumen Roadmap

Lumen preserves web evidence for design review, QA, and product work. The next
phase is repeated use and release completion. New capabilities wait until that
work identifies a concrete need.

## Current Product

1. Capture a full page, visible viewport, selected area, or responsive set.
2. Clean overlays and load lazy content before capture.
3. Retain observable Page Context beside the images.
4. Review, redact, annotate, and export from Capture Result.
5. Revisit captures in Capture Library and open Compare.
6. Opt into Once, Recurring, or bounded Rapid watch for a saved area.
7. Keep captures local; choose any configured destination explicitly.

Automatic redaction is optional and requires review before external sharing.
Private Review Mode coordinates stronger safeguards. PRODUCT.md owns the runtime
defaults and vocabulary, checked by the product contract tests.

## Release Completion

1. Publish a versioned beta ZIP from a successful exact-package test run. Retain
   its source commit, workflow link, and SHA-256 alongside the download.
2. Finish publisher-owned Store fields, privacy disclosures, and stock Chrome
   toolbar testing. Drive stays unavailable in packages without configured OAuth.
3. Keep Store images tied to Bug Garden and the actual product. Record a new short
   walkthrough from this workflow when the release surface is stable.
4. Preserve one website stylesheet and remove superseded presentation rules.
5. Validate releases against difficult pages and the exact packaged manifest.
   Keep native shortcut testing separate from harness grants.

## Repeated Personal Use

Use Lumen for actual design and QA work. Record the source page, capture scope,
expected result, and observed failure for each issue. Prioritize lost captures,
unexpected redactions, hard-to-find originals, and confusing review decisions.

Selected Area review currently shows a geometry map rather than captured pixels.
Follow-up integrity work can investigate page mutation during approval and
area-intersecting sensitive-match counts. Add each behavior behind a regression
test before changing the capture path.

## Bounded Maintenance

After release completion, extract one independently testable responsibility at
a time from background.js or content.js. Begin with shared pure models and
permission or scheduling boundaries. Preserve storage keys and message contracts.
Keep the browser-specific capture engine behind its existing tests.

## Deferred Experiments

Accounts, billing, agent handoff, and additional cloud destinations are outside
the next release. The experimental backend remains separate from the local
product. Revisit a proposal only when repeated use demonstrates a workflow gap.

Any future handoff needs an explicit destination, a preview of the outgoing
artifact, review before sending, and revocation controls. No unattended upload
or broad permission expansion is implied by this roadmap.
