# Web Store screenshot handoff

The upload-ready pack is generated from the extension runtime with:

```bash
npm run store:screenshots
```

The generator renders into a temporary directory, validates exactly five 1280 by 800 PNGs, and replaces the pack only after all five pass. GitHub Actions runs the same command and uploads `lumen-store-screenshots-<commit>` as a build artifact. The five-image limit matches [Chrome's current listing guidance](https://developer.chrome.com/docs/webstore/best-listing), so the first image pairs the clean Capture Result workspace with dedicated Privacy Shield Settings.

The first image shows the real result viewer and its Copy, PNG, PDF, annotation, original-file, and library actions beside Privacy Shield Settings. Use the CI artifact from the release commit for Chrome Web Store submission. The checked-in images are review previews; always upload the exact artifact produced from the signed release commit.
