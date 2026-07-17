# Web Store screenshot handoff

The upload-ready pack is generated from the extension runtime with:

```bash
npm run store:screenshots
```

The generator renders into a temporary directory, validates exactly five 1280 by 800 PNGs, and replaces the pack only after all five pass. GitHub Actions runs the same command and uploads `lumen-store-screenshots-<commit>` as a build artifact.

Use the CI artifact from the release commit for Chrome Web Store submission. The checked-in images are review previews; the current annotation preview predates the non-overlapping Drive-status toast and should not be uploaded as the final signed-build screenshot.
