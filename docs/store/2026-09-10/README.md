# Play Store screenshots — 2026-09-10

Eight phone screenshots at **1080×1920** (9:16) — Play's maximum count, and the
size it is happiest with: each side inside its 320–3840 range, and a ratio no
wider than the 2:1 it caps at.

Regenerate with `scripts/store-screenshots.mjs`. Read that file's header first:
it explains the seeding, the sizing trap, and the one path that needs changing
to run it elsewhere.

## The set, and why each one is in it

Chosen to be the things somebody would install the app *for*. Nothing here is a
sub-menu that only makes sense once you already own it.

| File | Screen | What it has to prove |
|---|---|---|
| `01-globe-home` | Globe home, dark | The thing nothing else in this category has. A line drawn across the world for each prayer, taken from Mecca near sunset so day and night are both in shot. The app opens at this framing by itself now, so the shot is what a launch looks like. Leads the listing. |
| `02-prayer-times` | Prayer list, light | The daily screen, with the Sunnah counts beside each prayer. Also proves there is a light theme. |
| `03-qibla` | Qibla on the globe, dark | A line from where you are to the Kaaba with the pin standing over it, drawn across the same globe as shot 01. Not a needle, and not a separate screen. Taken from Istanbul, not Toronto: from North America the Kaaba is round the back of the planet, the pin is correctly hidden, and the shot would be a line running off the edge. |
| `04-travel-mode` | Travel mode in use | Qasr and Jama' shown working, with a real distance from home. The feature most competitors do not have. |
| `05-notifications` | Notification settings | Where people go first, and where the athan lives. |
| `06-prayer-reminders` | Per-prayer reminders | Proof it is per-prayer, not one global switch: separate reminder times and a separate athan per prayer. |
| `07-settings` | Settings, light | Shows the whole feature surface in one frame — location, method, appearance, notifications, travel. |
| `08-islamic-design` | Second design, light | The same list as shot 02, so the pair reads as a choice of look rather than as two different apps. |

## Light, except the globe

Every screen is shot light apart from the two that are mostly globe. The globe
paints its own night sky whatever theme the app is in, so a light frame round
it would be a light frame round a dark picture. Everything else reads better
light on a store page, where the chrome around it is white.

## What these were rendered from

`main` at the time of writing, in a desktop browser at phone dimensions — not on
a handset. Nothing in these screens depends on native behaviour, but it does
mean the status bar is the browser's rather than Android's.

The globe is rendered by a software rasteriser here. It looks the same as the
device does; only the timing differs, and timing is not in a screenshot.

## Seeded state

A store screenshot has to show the app in use, not on its first launch, so each
one starts from a real city with onboarding already done.

The travel shot puts home in Toronto and the user in Istanbul, so the banner
shows a real distance and the list shows Dhuhr and Asr genuinely combined.

The globe shot is the one that depends on **when** it is run. It sits in Mecca,
and the day/night line only crosses the visible face while Mecca is near
sunrise or sunset. Run it at the wrong hour and you get a fully lit disc or a
fully dark one, which loses the whole point of the shot. Look at it before
keeping it.

## Feature graphic

`feature-graphic.png`, 1024×500 — the wide banner Play shows above the
screenshots. Play will not take a screenshot for this, and a phone screen at
this shape is mostly empty anyway, so the app's own globe is photographed on
its own and set against its own night sky with the name beside it.

Regenerate with `scripts/feature-graphic.mjs`, which needs the preview server
running the same as the screenshots do. It drives the app rather than cropping
a screenshot: with the app's chrome hidden and a square window, the planet is
centred by construction and the only thing in frame that is not sky is the
planet, which makes measuring it exact. The script's header says why the
cropping version did not work.

## Still to do before a listing update

- **Tablet screenshots**, if the listing claims tablet support.
