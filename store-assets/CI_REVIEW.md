# Exact CI Store image review

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
