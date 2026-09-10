# Play Store screenshots — 2026-09-10

Six phone screenshots at **1080×1920** (9:16), the size Play is happiest with:
each side inside its 320–3840 range, and a ratio no wider than the 2:1 it caps
at. Regenerate with `scripts/store-screenshots.mjs` — read that file's header
first, it explains the seeding and the one path that needs changing to run it
elsewhere.

| File | Screen | Why it is in the set |
|---|---|---|
| `01-globe-home` | Home, globe view | The thing nothing else in this category has. Leads the listing. |
| `02-prayer-times` | Home, list view, light | The daily screen, and proof there is a light theme. |
| `03-prayer-tracking` | Home, list view, dark | The same screen with the checkmarks visible, and the dark theme. |
| `04-qibla` | Qibla direction | Named in the short description; needs to be seen. |
| `05-dashboard` | Tracking dashboard | The reason to come back, rather than the reason to install. |
| `06-islamic-design` | Islamic design, dark | The second visual identity, which the listing does not currently mention. |

## What these were rendered from

A production build of `main` with the three open branches merged in — the
performance work, the Isha line fix, and the row-contrast fix on this branch.
**Reshoot after those land** if any of them changes on the way in.

They are rendered in a desktop browser, not on a phone. Nothing in these shots
depends on native behaviour, but it does mean the status bar is the browser's
idea of one rather than Android's.

## Still to do before a listing update

- **Feature graphic**, 1024×500. Not something to screenshot; it has to be
  designed.
- **Tablet screenshots**, if the listing claims tablet support.
- The store copy in `store-listing.md` still says the only network request is
  the one that names your city. Esri's map tiles and the athan downloads are
  both missing from it, and the privacy policy has the same gap.
