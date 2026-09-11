# Google Play Store Listing

*Last updated: 2026-09-11 for version 2.0.0. Update this alongside
`PRIVACY_POLICY.md` — the privacy paragraph below is a summary of that file and
the two must not drift.*

## App Name (30 chars max)

OnTime – Prayer Times & Qibla

Twenty-nine of the thirty. Play searches the app name, and "OnTime" on its own
says nothing about what the app is for; the rest of the line is the two words
somebody actually types.

## Short Description (80 chars max)

Prayer times, Qibla on a live globe. Works offline. No ads, no account.

Seventy-one of the eighty. This is indexed for search as well as read, so it
carries the two words people search for and the one thing no other prayer app
does.

## Full Description

Paste as-is. Play takes no formatting at all, so this uses none: no bullet
characters, no dashes, nothing outside plain ASCII. Written that way
deliberately after the console started refusing the listing without saying
which field it disliked - when you cannot see the complaint, the cheapest move
is to stop giving it anything to complain about. The structure is carried by
line breaks and two plain capitalised headings instead.

2,385 of the 4,000 characters.

OnTime - Prayer Times & Qibla
Accurate prayer times wherever in the world you are. No ads, no account, nothing to sign up for.

Everything is worked out on your phone. Your prayer times, the Qibla and the position of the sun are all calculated on the device. None of it needs a connection, and none of it is sent anywhere.

WHAT YOU GET

Accurate prayer times using the method you trust: ISNA, Muslim World League, Umm Al-Qura, Egyptian, Dubai, Karachi, Kuwait, Qatar, Singapore, Tehran, Turkey or Moonsighting Committee. Hanafi and Shafi'i Asr calculation, and a Hijri date that you can nudge to match your local moonsighting.

A living globe for your home screen. Real satellite imagery that works with no signal, the day and night sides of the Earth, and a line drawn across the world for each prayer, so you can see where in the world it is Fajr right now. Or a plain list, if that is what you would rather have.

A countdown to the prayer you are in and the one coming, on whichever screen you keep.

The Qibla drawn on that same globe. A line from where you are standing to the Kaaba, an arrow that follows your phone as you turn, and a buzz the moment you line up.

Notifications before each prayer, with a real athan if you want one. Set per prayer, not all at once, so Fajr can wake you and Dhuhr can stay quiet.

Travel mode, noticed on its own when you are far from home, with shortened Qasr prayers and Jama' combinations.

Jumu'ah support with your own khutbah time. Sunnah and Rawatib reminders for each fard prayer. Optional sunrise, middle of the night and last third of the night.

Light and dark, plus Desert, Rose, Forest and Ocean, and an Auto mode that turns dark at Maghrib. A second visual design drawn around Islamic geometry.

PRIVACY

No account. No analytics. No advertising. No third party tracking. Nothing you do in the app is reported anywhere, because there is nowhere for it to be reported to. There is no server.

Three things reach the internet, and none of them is about you. Your coordinates go to OpenStreetMap to turn them into a city name. The globe's satellite photo ships inside the app and needs no connection at all, and only if you zoom a long way in does it stream sharper imagery from Esri. Athan recordings download from Assabile, and only when you choose one.

The full detail, including how to avoid each one, is in the privacy policy.

## Category

Lifestyle

## Tags

prayer times, salah, islamic, muslim, qibla, adhan, ramadan, athan, namaz, prayer reminder

## Assets

- **Feature graphic** — `docs/store/2026-09-10/feature-graphic.png`, 1024×500. The banner above the screenshots. Regenerate with `scripts/feature-graphic.mjs` after the screenshots, since it cuts the planet out of the first one.
- **Phone screenshots** — `docs/store/2026-09-10/`, eight at 1080×1920: globe, prayer list, Qibla, travel mode in use, notifications, per-prayer reminders, settings, and the second visual design. Regenerate with `scripts/store-screenshots.mjs`; the README beside them says why each is in the set.
- **Tablet screenshots** — only needed if the listing claims tablet support.

## Release notes — 2.0.0

Play caps these at 500 characters. Written for someone who has the old version
and is deciding whether they care, which means the removal goes near the top:
finding a feature gone with no warning is worse than being told.

```
The Qibla is now drawn on the globe itself — a line from where you are standing
to the Kaaba, with an arrow that follows your phone and a buzz the moment you
line up. Its separate screen is gone.

Prayer tracking has been removed, and the records it kept are deleted when you
update.

Fixed: the app held on to graphics memory it had finished with, which could
build up to hundreds of megabytes in ordinary use.

The app now stays in portrait.
```

A major version rather than a minor one because a feature people were using has
gone and a screen they knew has been replaced. Nothing in the numbering is
load-bearing; 1.9.0 would do if that reads better on the listing.

## Before submitting

- **Data safety form.** Declare location as collected and shared, used for app
  functionality, not linked to an identity, and not used for tracking. The
  sharing answer is yes because coordinates reach OpenStreetMap — answering no
  is the common mistake here.
- **Permission declarations.** `SCHEDULE_EXACT_ALARM` and
  `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` both need a justification in the
  console.
- **Privacy policy URL** must point at the current `PRIVACY_POLICY.md`, not a
  cached copy.
