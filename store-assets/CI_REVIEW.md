# Exact CI Store image review

## Current candidate: f6aa7f2

Reviewed September 13, 2026. All five PNGs were downloaded from the successful
[CI run](https://github.com/CaptainFredric/lumen-extension/actions/runs/34784334140),
visually inspected, and checked against their proof hashes and 1280 by 800 sizes.
The proof records a clean `f6aa7f2a61d6009b688c6cfd3be5b5c92854ab98` checkout,
Linux x64, Chromium 147.0.7727.15, en-US, UTC, and DPR 1.

[Download the exact reviewed pack](https://github.com/CaptainFredric/lumen-extension/releases/download/v0.5.0-beta.1/lumen-store-f6aa7f2.zip).
This release asset is the original CI archive, without repackaging. It contains
the five reviewed PNGs and their original proof JSON, so the candidate survives
Actions artifact expiry without adding duplicate image history to the repository.

Archive SHA-256: `a56028e8d285e2841ef9a894aa848f10a168c8e22d7c771dfe79038f562684a5`.
Proof SHA-256: `f18fb6be8d199ea51ec4b56918e6595ef85669a08d9adfe2074bf2843c77a62b`.
Actions artifact ID: `10325972616`.

Result shows the three retained originals and redacted email. The responsive
frame shows the seeded overlap and clipping. Annotation shows the marked button
and redacted email together. Compare shows its 70% boundary and a 0.11% measured
change. Library shows two captures and the paused monitor with zero runs. The
monitor's Delete button wraps onto a second row; all actions remain readable.

This candidate is ready for publisher review, not approved by the Store.
Later regenerations require their own inspection. The beta extension ZIP remains
the existing a903623 runtime artifact and has not been replaced.

## Earlier candidate: 8943e76

Reviewed September 13, 2026 from the downloaded GitHub Actions artifact, rather
than from the checked-in Mac images.

Source commit: `8943e760442ba913ab879f400d4cd2bef23e7ec8`.
Workflow: https://github.com/CaptainFredric/lumen-extension/actions/runs/34774065411
Artifact: `lumen-store-screenshots-8943e760442ba913ab879f400d4cd2bef23e7ec8`.
Proof SHA-256: `d0dea24d6104b80ae67af5b76eeec101792a822d54bad8951dd9d481a2c3adc1`.
The original proof record is retained in `reviews/8943e76-proof.json`. All five
downloaded PNG hashes matched that record before visual inspection.

| Frame | Visual observation |
| --- | --- |
| Capture Result | Three retained originals, source, dimensions, actions and redacted email are visible. |
| Responsive set | Desktop, tablet overlap and mobile clipping are readable. Labels describe configured CSS viewport widths, not exported image pixel widths. |
| Annotation | The marked button and redacted email are visible together. Linux typography and tool labels differ from the Mac pack. |
| Compare | The 70% reveal boundary, handle and change marker are visible. This run reports 0.11%; the Mac run reported 0.08%. |
| Library and monitor | Two captures and a paused, zero-run monitor are legible. Delete wraps onto a second row in this environment. |

The five-image story is suitable as a submission candidate for publisher review.
This is visual evidence review, not Chrome Web Store approval. Recheck the exact
artifact chosen for upload; a later regeneration is a different candidate.

Still open: stock Chrome toolbar clicks, permission prompts and revocation,
manual-install update behavior, publisher-owned forms, and actual submission.
Use real pages during personal testing and record scope, expected result, actual
result, and whether an original was lost or unexpectedly altered. Prioritize
repeatable failures before proposing additional capabilities.
