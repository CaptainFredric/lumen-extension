# Product review: September 2026

## Source of truth

This review starts from GitHub commit 824b2a4, version 0.5.0. The local checkout initially contained version 0.2.0 and was 27 commits behind. Changes made against that old checkout are preserved on local main in commit 11f72a0; they were never published and should remain separate from this review.

## Current product

Lumen captures whole pages, visible areas, rectangles, and lasso selections. It opens a result viewer with local copy and export, an annotation editor, a library, and visual comparison. Area monitoring has explicit timing and run limits. The narrow value remains evidence capture for design review, QA, and product work.

## What should improve next

1. Treat a responsive capture as one browsable bundle. The result screen now exposes every retained original file. A future viewer should retain and display each full resolution variant with independent annotation state and explicit storage bounds.
2. Complete one coherent review flow: capture, inspect pixels, annotate, choose an artifact, export. Measure the steps needed to complete a real bug report, including recovering from an interrupted capture.
3. Verify the physical toolbar, shortcuts, permissions, and editor in stock Chrome before release. Automated extension pages and programmatically granted test permissions cover a different interaction boundary.
4. Keep continuous area capture visible and bounded. Expand agent handoff only after users can inspect the exact transmitted artifact and choose a destination.
5. Validate repeated personal use before paid packaging. Billing, account recovery, support ownership, and publisher OAuth configuration are separate release gates.

## Readiness

Existing percentages are subjective estimates. Use observed workflows and outstanding release gates to decide whether to ship. New code and passing fixture counts alone cannot establish paid readiness.

## This pass

The result viewer can select any still available saved original, crop, tile, or details file for Open and Show in folder. Selection preserves the local review image and its export actions. Temporary responsive windows now close if tab discovery or navigation fails before a capture target is returned.

## Validation

`npm run check`, `npm run test:capture-lifecycle`, `npm run smoke:extension`, and `npm run smoke:e2e` passed. The lifecycle suite covers missing tabs, query failures, navigation failures, and successful ownership transfer. The result test verifies selection routes the chosen download ID while retaining the review image.

The capture fixture produced three responsive images, three cutaways, one context JSON, nine reported redactions, and a local history entry. Selected area capture dimensions also matched saved metadata. These are controlled browser fixtures; physical toolbar activation and arbitrary live sites remain separate checks. The browser tests remove their temporary profiles and image files when finished.
