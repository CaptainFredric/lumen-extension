# Lumen Privacy Policy

Effective date: May 12, 2026

Lumen is a local-first browser capture workflow for design review, QA, and product work. The current extension stores capture settings, redaction boxes, cutaway regions, extracted page signals, and capture history in the browser. Screenshot files and manifest files are saved through Chrome Downloads.

## Information Lumen Handles

1. Screenshot images of the page you choose to capture.
2. Page URL, title, host, viewport, dimensions, capture time, and export settings.
3. Redaction metadata, including detected sensitive regions and manual redaction boxes.
4. Cutaway region metadata, including selected coordinates, dimensions, and projection status.
5. Extracted page signals such as colors, fonts, navigation labels, headline text, CTA text, and layout counts.
6. Local capture history, file names, Chrome download IDs, and bundle manifest metadata.
7. Optional capture notes that you choose to add to an export.

## Use

Lumen uses this information to provide its user-facing capture workflow: page cleanup, responsive capture, redaction review, cutaway export, bundle manifests, local history, and file actions.

## Storage And Retention

Lumen stores extension settings and local history using Chrome extension storage. Screenshot images and JSON manifests are saved through Chrome Downloads into folders named by capture date. You control those files through your browser and operating system.

Chrome extension storage and downloaded files are not encrypted by Lumen. Do not capture or retain sensitive pages unless you are comfortable storing those files locally.

## Sharing And Transfer

The current public prototype does not send screenshot content, page text, capture history, redaction metadata, or page signals to a Lumen-owned production service by default. The repository includes a local demo backend for development testing, but it is not a production sync service.

If future versions add cloud sync, agent handoff, team destinations, or scheduled watch, those features should be opt-in, visibly controlled, and described before data is sent.

## Limited Use Disclosure

Lumen uses information received from Chrome extension APIs only to provide or improve the browser capture workflow described in the product UI and listing. Lumen does not use or transfer that information for personalized advertising, retargeting, or interest-based advertising.

The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

Lumen does not allow human review of user capture data unless the user explicitly sends that data for support, review, or another chosen destination.

## Contact

For questions or issues, use the public repository at https://github.com/CaptainFredric/lumen-extension.
