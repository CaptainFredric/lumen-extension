# Lumen Reliability Matrix

Last full live run: July 18, 2026 America/Chicago (artifacts timestamped July 19 UTC).

This matrix separates reproducible CI evidence from live-site evidence. Live pages are valuable release checks, but third-party availability, login state, experiments, and markup can change, so they are not used as a blocking CI gate.

## Deterministic difficult-site fixtures

Run:

```bash
npm run smoke:difficult-sites
```

| Site class | Stressors | Verified behavior |
| --- | --- | --- |
| Long marketing page | 8,302 px document, sticky header, fixed cookie and chat overlays, lazy image, transformed content | Document scroll detected; three overlays removed and restored; lazy source hydrated; transform preserved; lower sensitive text found |
| Nested application shell | Fixed app chrome, offset 1,024 by 732 scroll root, 4,600 px inner surface, transformed lower card | Correct nested scroller and crop offset selected; only the inner surface moved; lower content scanned; original position restored |
| Late-growing result feed | Tail appended after preparation, late fixed overlay | Height remeasured from 2,728 to 4,343 px; late overlay removed on the next scroll step and restored afterward |
| Embedded and opaque surfaces | Canvas, sandboxed iframe, open shadow root with lazy media and sensitive text, closed shadow root | Canvas pixels preserved; iframe and canvas risk counts reported; open-shadow media hydrated and text scanned; sandbox and closed-root boundaries preserved |

The fixture intentionally confirms that iframe content and closed shadow roots remain opaque to automatic text inspection. Canvas, iframe, closed-shadow, and image-only sensitive content require manual review.

## Live-site capture run

Run:

```bash
npm run smoke:real-sites
```

| Target | Page class | Segments | Output images | Captured height | Result |
| --- | --- | ---: | ---: | ---: | --- |
| `captainfredric.github.io/lumen-extension/` | Product landing page | 9 | 1 image | 15,368 px | Pass |
| `github.com/CaptainFredric/lumen-extension` | Dynamic repository application | 16 | 3 tiled images | 27,028 px | Pass |
| `developer.chrome.com/.../activeTab` | Documentation page | 4 | 1 image | 7,010 px | Pass |
| `developer.mozilla.org/.../Intersection_Observer_API` | Very long documentation page | 23 | 4 tiled images | 41,184 px | Pass |

Live-run totals:

1. Four of four sites captured successfully.
2. Fifty-two screenshot segments composed.
3. Nine image artifacts plus capture-details files completed.
4. Both single-canvas and tiled-output paths exercised.
5. Useful page title, headline, CTA, and navigation signals returned for every target.

## Optional-permission lifecycle

Run:

```bash
npm run smoke:permissions
```

Verified in a temporary loaded-extension profile:

1. Clean install begins with no granted site origins.
2. A real user-gesture request grants only the fixture origin.
3. A timed plan keeps that permission while active and registers an alarm.
4. Deleting the last plan clears its alarm and revokes the origin.
5. Local workspace cleanup clears history, regions, plans, runs, alarms, and remaining optional site access while leaving downloaded originals alone.

Manual-only checks remain permission denial copy, uninstall behavior, browser sleep and wake timing, and the final publisher-configured Google Drive consent screen.
