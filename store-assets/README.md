# Web Store screenshot handoff

The five checked-in images follow the same Bug Garden fixture through Capture
Result, responsive exports, annotation and redaction, Compare, and Capture Library.
The monitor is created through the UI and paused before its first run. Its
schedule is real; the pack makes no claim about completed monitor runs.

```bash
npm ci
npx playwright install chromium
npm run store:screenshots
```

This command requires a graphical Chrome session. On headless Linux, install
Chromium system dependencies and run it with `xvfb-run --auto-servernum`.

`scripts/generate-garden-store.mjs` captures the original fixture and a second
state with a changed total and coupon. It opens the real Result, editor, Compare
and Library. Workspace screenshots are framed or cropped for legibility. It
never extends captures with invented content or seeds fake capture history.

`screenshots/proof.json` records fixture hashes, capture IDs, capture health,
redaction counts, annotation source, comparison pair, monitor state and all five
PNG hashes. The old pack stays in place until generation and validation succeed.
Profiles, temporary downloads and intermediate screenshots are removed afterward.

The proof also records Chromium and Node versions, platform and architecture,
capture and presentation locales, timezones, device scale factors, viewport sizes,
the generator's SHA-256, and Git revision with a dirty-tree flag. Source archives
without Git retain the generator hash and report null revision fields.
This is provenance for an individual run, not a promise of identical PNG bytes
across machines. Fonts, scrollbars, antialiasing, IDs, ports, and timestamps vary.

The exact CI pack from commit 8943e76 was visually inspected; see
`CI_REVIEW.md`. That review does not approve later regenerations automatically.

The harness grants site access in a temporary extension copy because scripted
invocation is not Chrome's native toolbar gesture. Distributed permissions remain
unchanged. Use the screenshot and extension artifacts from the same tested commit
for submission, after visually checking each image. Store approval remains a
separate gate.
