# Lumen Reliability Matrix

Last full live run: July 18, 2026 America/Chicago (artifacts timestamped July 19 UTC).

This matrix separates reproducible CI evidence from live-site evidence. Live pages are valuable release checks, but third-party availability, login state, experiments, and markup can change, so they are not used as a blocking CI gate.

## Capture interruption checks

Run `npm run test:capture-lifecycle` for deterministic checks of the screenshot boundary and temporary window lifecycle.

The September 10, 2026 pass adds checks before and after Chrome returns screenshot pixels. Switching tabs, switching away and back, navigating, reloading, or closing the target during that operation causes the slice to be discarded. A title update or activity in another window does not interrupt it. Temporary event listeners are removed on success and failure.

Personal tab capture no longer reactivates the target after the user switches away. Cancellation is checked while a temporary responsive page is loading, so cleanup can run before the full navigation timeout expires.

If a later responsive view fails or is cancelled, completed views are retained as a partial library capture. The error includes the completed view count, saved folder, and an explicit warning that retrying creates a new set. If library storage fails, the error points to Chrome Downloads. The result screen labels partial or incomplete captures before sharing.

Recovery tests cover first-view failure, later-view failure, cancellation, and library storage failure. These are deterministic function tests; a live browser interruption matrix remains a release check. Files exported inside a failing view before that view returns are still outside this recovery record. Automatic resume is not implemented.

Run `npm run smoke:result-recovery` for a loaded-extension check of the persisted partial result at 1440, 768, and 390 pixels. It verifies the visible warning, enabled copy/save controls, and warning removal for a complete capture. Its image is a generated fixture, not a live-site capture. The test removes its temporary extension, profile, and image storage afterward.

## Capture set checks

`npm run test:capture-zip` verifies archive headers, CRC, filename isolation, missing sources, size limits, and cancellation during preparation. `npm run smoke:result-recovery` browses originals in a loaded extension, confirms PNG export and Edit follow the selected image, extracts a selected-files ZIP using the operating system unzip utility, and checks ownership, metadata updates, cache count limits, eviction, and deletion. Storage budget eviction uses synthetic size metadata to avoid allocating hundreds of megabytes for the test.

`npm run smoke:e2e` also verifies retained originals for all three responsive views and their crops. Tests use controlled fixtures and clean their temporary images, archives, and browser profiles. A fixture run is distinct from repeated personal use across live sites. ZIP export contains originals only; saved per-part annotation state and a demonstration video remain future work.

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
