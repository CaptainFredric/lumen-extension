# Lumen Cloud Workspace Handoff

This repo is the source of truth for moving Lumen between computers:

```bash
git clone https://github.com/CaptainFredric/lumen-extension.git
cd lumen-extension
npm install
npm run check
```

## Run The Project

```bash
npm run site
npm run api
npm run smoke:backend
npm run smoke:extension
npm run package:extension
```

The public site is:

```text
https://captainfredric.github.io/lumen-extension/
```

## What GitHub Transfers

GitHub transfers the code, docs, extension UI, backend server, tests, store assets, and public site source.

GitHub intentionally does not transfer:

1. `node_modules/`
2. `dist/`
3. generated ZIP files
4. private `.env` files
5. local backend state at `backend/data/store.json`
6. downloaded captures or screenshots

Those ignored files can contain private page URLs, capture metadata, or machine-specific artifacts.

## Portable Handoff Bundle

Create a portable bundle for another computer:

```bash
npm run handoff:cloud
```

The bundle is written to `dist/lumen-cloud-handoff-YYYY-MM-DD.zip`.

It contains:

1. tracked repo files
2. a handoff manifest with the current commit and remote URL
3. a sanitized backend data snapshot when `backend/data/store.json` exists

To include raw local backend data, run:

```bash
npm run handoff:cloud -- --include-private-backend-data
```

Use the private option only for your own trusted cloud storage. Do not commit the raw backend store.

## Restore Backend Data On Another Computer

For a sanitized demo restore:

```bash
mkdir -p backend/data
cp handoff-data/backend-store.sanitized.json backend/data/store.json
npm run api
```

For a private restore, copy `handoff-data/backend-store.private.json` instead.

## Practical Cloud Options

1. GitHub is best for source code and docs.
2. GitHub Releases can hold generated handoff ZIPs if you are logged into `gh`.
3. Google Drive, iCloud Drive, or Dropbox are better for raw private backend data and generated captures.
4. A cloud dev box can clone the repo and run the backend, but the Chrome extension still needs local Chrome for real extension testing.
