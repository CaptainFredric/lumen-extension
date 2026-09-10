# Product review: September 2026

## Source of truth

This review starts from GitHub commit 824b2a4, version 0.5.0. The local checkout initially contained version 0.2.0 and was 27 commits behind. Changes made against that old checkout are preserved on local main in commit 11f72a0; they were never published and should remain separate from this review.

## Current product

Lumen captures whole pages, visible areas, rectangles, and lasso selections. It opens a result viewer with local copy and export, an annotation editor, a library, and visual comparison. Area monitoring has explicit timing and run limits. The narrow value remains evidence capture for design review, QA, and product work.

## September 10 feature review

The central workflow is capture, review, edit, and save. Completed responsive views now survive a later interruption as a partial library item. Automatic redaction and Privacy Shield start off for fresh installs, with saved preferences preserved.

### Menu ergonomics

The editor now calls its property panel "Tool options". An empty selection hides style controls. Arrows and rectangles expose color and thickness; text exposes color and text controls; blur and pixelation expose only their relevant strength controls. Keyboard help is collapsed by default. These changes reduce irrelevant choices without removing editing functionality.

### Feature decisions

1. Real demonstration video: worthwhile after the capture-set viewer is stable. Show a real page capture, a selected area, one annotation, optional redaction, and the saved result in roughly 45 to 60 seconds. Use synthetic private details, captions, playback controls, and a poster image. Keep playback user initiated and label fixtures. The website currently has no newly recorded video from this pass.
2. Clickable capture: a useful future export mode. PNG cannot contain clickable link regions. A self-contained HTML viewer or PDF link annotations could pair pixels with captured link rectangles. Preserve coordinates through scaling, cropping, and tiling; allow only HTTP/HTTPS links; exclude redacted regions and sensitive URLs; never execute source-page scripts. The snapshot would preserve links, not live forms or application behavior. No linked export is implemented yet.
3. Timed captures: the existing bounded area-monitoring path is the starting point. Improve a session-oriented UI with interval, duration, expected image count, storage budget, pause, and stop. Interviews require participant awareness and a visible indicator. Background or hidden-page capture needs separate verification; current functionality should not be described as a desktop or meeting recorder.
4. Lasso: already implemented. Prioritize selection adjustment, cancellation, and predictable transparent edges before adding more selection tools.
5. Direct computer storage: already uses Chrome Downloads. Explain the destination and expose Show in folder. Browser settings determine prompts and location; arbitrary filesystem access would require a different permission model.
6. Small completion preview: a promising preference alongside the existing automatic result tab. It should offer Open, Copy, and Dismiss, avoid stealing focus, and avoid displaying sensitive pixels over a shared page without consent. No new preview overlay is implemented in this pass.
7. Keyboard capture: page, visible-area, and selection commands already exist in manifest.json. Expose actual assigned shortcuts and a Customize action rather than hardcoded promises. Chrome and operating-system reserved shortcuts take precedence; preserve macOS Command-Shift-3/4/5. Desktop-wide capture is outside the current tab-capture architecture.
8. Readable page parts and one packet: the first capture-set viewer is implemented. New captures retain original PNG parts with a horizontal image strip, fit-width viewing, keyboard navigation, selection, and ZIP export. Copy, PDF, PNG, and Edit follow the viewed part. Up to 40 images and 64 MB are cached per capture, with a separate 128 MB total bundle cache. Older sets may be evicted, including favorites; downloaded files remain untouched. ZIP contains selected originals only, with no details JSON or subsequent editor changes. Independent persistent annotation state per part remains future work.

### Execution order

The first capture-set viewer and selected-original ZIP export are delivered. Validate repeated use with long tiled pages, then record the actual workflow for the website. Next improve shortcut discovery and optional completion preview. Follow with bounded session capture controls. Linked exports require their own geometry and privacy tests before release.

### Reference checks

GoFullPage describes full-page capture and image/PDF export at https://gofullpage.com/. Its simplicity is a useful benchmark; this review does not attribute interactive-link capture to it. Chrome's command constraints and user remapping are documented at https://developer.chrome.com/docs/extensions/reference/api/commands.

## What should improve next

1. Test capture-set ergonomics on large real pages. Full-resolution part viewing and selected-original ZIP export now work within explicit storage bounds. Independent saved annotation state per part remains open.
2. Complete one coherent review flow: capture, inspect pixels, annotate, choose an artifact, export. Measure the steps needed to complete a real bug report, including recovering from an interrupted capture.
3. Verify the physical toolbar, shortcuts, permissions, and editor in stock Chrome before release. Automated extension pages and programmatically granted test permissions cover a different interaction boundary.
4. Keep continuous area capture visible and bounded. Expand agent handoff only after users can inspect the exact transmitted artifact and choose a destination.
5. Validate repeated personal use before paid packaging. Billing, account recovery, support ownership, and publisher OAuth configuration are separate release gates.

## Readiness

Existing percentages are subjective estimates. Use observed workflows and outstanding release gates to decide whether to ship. New code and passing fixture counts alone cannot establish paid readiness.

## Initial September pass

The result viewer can select any still available saved original, crop, tile, or details file for Open and Show in folder. Selection preserves the local review image and its export actions. Temporary responsive windows now close if tab discovery or navigation fails before a capture target is returned.

## Initial September validation

`npm run check`, `npm run test:capture-lifecycle`, `npm run smoke:extension`, and `npm run smoke:e2e` passed. The lifecycle suite covers missing tabs, query failures, navigation failures, and successful ownership transfer. The result test verifies selection routes the chosen download ID while retaining the review image.

The capture fixture produced three responsive images, three cutaways, one context JSON, nine reported redactions, and a local history entry. Selected area capture dimensions also matched saved metadata. These are controlled browser fixtures; physical toolbar activation and arbitrary live sites remain separate checks. The browser tests remove their temporary profiles and image files when finished.
