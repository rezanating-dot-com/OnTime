# Google Play Store Listing

*Last updated: 2026-09-10. Update this alongside `PRIVACY_POLICY.md` — the
privacy paragraph below is a summary of that file and the two must not drift.*

## Short Description (80 chars max)

Prayer times, Qibla and travel mode. Works offline. No ads, no accounts.

## Full Description

OnTime gives you accurate Islamic prayer times for wherever you are, in an app
that stays out of your way.

Everything is calculated on your phone. No account, no ads, no tracking, and
nothing to sign up for.

FEATURES

- Accurate prayer times, calculated on your device, using the method you trust — ISNA, Muslim World League, Umm Al-Qura, Egyptian, Dubai, Karachi, Kuwait, Qatar, Singapore, Tehran, Turkey, or Moonsighting Committee
- Hanafi and Shafi'i Asr calculation
- A living globe for your home screen: real satellite imagery that works with no signal, the day and night sides of the Earth, and a line drawn across the world for each prayer, so you can see where in the world it is Fajr right now
- Or a plain list, if that is what you want. Both light and dark, plus Desert, Rose, Forest and Ocean, and an Auto mode that turns dark at Maghrib
- Qibla drawn on the globe itself: a line from where you are standing to the Kaaba, with a live compass telling you which way to turn
- Countdown to the current and next prayer
- Notifications before each prayer, with a real athan if you want one
- Travel mode — noticed automatically when you are far from home, with shortened Qasr prayers and Jama' combinations
- Jumu'ah support with your own khutbah time
- Sunnah and Rawatib reminders for each fard prayer
- Optional sunrise, middle of the night, and last third of the night
- A second visual design, drawn around Islamic geometry
- Works with no signal — every calculation is local

PRIVACY

OnTime has no account, no analytics, no advertising, and no third-party
tracking. Prayer times, Qibla bearings and sun positions are all worked out on
your device.

Four things do reach the internet, and none of them is about you:

- your coordinates go to OpenStreetMap to turn them into a city name
- the map preview, when you open it, is loaded from OpenStreetMap
- the globe's satellite photo ships inside the app, so it needs no network at all until you zoom in; past that it streams sharper imagery from Esri, and those requests show roughly which part of the world you are looking at
- athan recordings are downloaded from Assabile, only when you choose one

Full detail, including how to avoid each one, is in the privacy policy.

## Category

Lifestyle

## Tags

prayer times, salah, islamic, muslim, qibla, adhan, ramadan, athan, namaz, prayer reminder

## Assets

- **Phone screenshots** — `docs/store/2026-09-10/`, eight at 1080×1920: globe, prayer list, Qibla, travel mode in use, notifications, per-prayer reminders, settings, and the second visual design. Regenerate with `scripts/store-screenshots.mjs`; the README beside them says why each is in the set.
- **Feature graphic** — 1024×500. **Not done.** Has to be designed; it cannot be screenshotted.
- **Tablet screenshots** — only needed if the listing claims tablet support.

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
