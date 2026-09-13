# Web Store screenshot handoff

The checked-in images still show the older workflow and terminology. The
generator's labels have been updated, but its five-frame story still needs to
be rebuilt around Bug Garden before submission. Regenerate preview images with:

```bash
npm run store:screenshots
```

The generator renders into a temporary directory, validates exactly five 1280 by 800 PNGs, and replaces the pack only after all five pass. GitHub Actions runs the same command and uploads `lumen-store-screenshots-<commit>` as a build artifact. Passing dimensions and rendering checks does not approve the narrative for submission.

The next pack should follow one fixture through Capture Result, responsive
views, annotation and redaction, Compare, and Capture Library with a monitor.
Review each resulting image against the exact tested release before uploading.
