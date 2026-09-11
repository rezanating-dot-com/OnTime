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
| `01-globe-home` | Globe home | The thing nothing else in this category has. A line drawn across the world for each prayer. Leads the listing. |
| `02-prayer-times` | Prayer list, light | The daily screen, with the Sunnah counts beside each prayer. Also proves there is a light theme. |
| `03-qibla` | Qibla direction | Named in the short description, so it has to be seen. Shows the great-circle arc, not just a needle. |
| `04-travel-mode` | Travel mode in use | Qasr and Jama' shown working, with a real distance from home. The feature most competitors do not have. |
| `05-notifications` | Notification settings | Where people go first, and where the athan lives. |
| `06-prayer-reminders` | Per-prayer reminders | Proof it is per-prayer, not one global switch: separate reminder times and a separate athan per prayer. |
| `07-settings` | Settings, light | Shows the whole feature surface in one frame — location, method, appearance, notifications, travel. |
| `08-islamic-design` | Second design, dark | The same list as shot 02, so the pair reads as a choice of look rather than as two different apps. |

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

## Still to do before a listing update

- **Feature graphic**, 1024×500. Not something to screenshot; it has to be
  designed.
- **Tablet screenshots**, if the listing claims tablet support.
