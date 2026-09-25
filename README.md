# OnTime - Prayer Times App

A full-featured Islamic prayer times app for Android and iOS, built with React, TypeScript, and Capacitor.

## Features

### Prayer Times
- Accurate calculations using the [adhan](https://github.com/batoulapps/adhan-js) library with 12 methods (ISNA, Muslim World League, Umm al-Qura, Egyptian, and more)
- Standard (Shafi'i) and Hanafi Asr calculation
- Live countdown to the next prayer
- Current prayer window display
- Optional times: Sunrise, Middle of Night, Last Third of Night

### Globe and Qibla
- A 3D globe home screen with bundled satellite imagery, the day and night sides of the Earth, and a line for each prayer
- The Qibla drawn on the globe: a line from your location to the Kaaba, with an arrow that follows the device heading (hardware sensors on Android, WebKit on iOS)
- Bearing displayed in degrees and cardinal direction

### Notifications
- Per-prayer enable/disable with configurable reminder timing (0–30 min before)
- Custom athan sounds — browse, download, and preview from an online catalog
- Separate Fajr athan selection
- Jumu'ah (Friday prayer) reminders with masjid name, khutbah, and iqamah times

### Travel Mode
- Auto-detects travel when 88.7+ km from your home base (configurable)
- Qasr: shortens Dhuhr, Asr, and Isha to 2 rak'ah
- Jama': combines Dhuhr+Asr and Maghrib+Isha
- Suppresses most Sunnah Rawatib (keeps Fajr sunnah and Witr)
- Max travel days limit (4, 10, 15, or unlimited)
- Manual override (force on/off)

### Sunnah Information
- Sunnah Rawatib counts shown per prayer (before/after)
- Ishraq/Duha window during sunrise
- Tahajjud times (middle of night and last third)

### Location
- GPS detection with reverse geocoding
- City search across 33,000+ cities worldwide (bundled GeoNames `cities15000`, population ≥ 15,000)
- Manual coordinate entry
- Save up to 20 previous locations

### Themes
- Light, Dark, Desert, Rose, System, and Auto modes
- Auto mode switches theme based on prayer times (dark after Maghrib, light after Fajr)

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React 19, TypeScript, Tailwind CSS 4 |
| Build | Vite 7 |
| Native | Capacitor 8 (Android + iOS) |
| Prayer Math | adhan 4.4 |
| Icons | Font Awesome 7 |

## Getting Started

### Prerequisites

- Node.js 18+
- Android Studio (for Android builds)
- Xcode (for iOS builds)

### Development

```bash
npm install
npm run dev          # Start dev server
```

### Build & Deploy

```bash
npm run build:android   # Build web + sync to Android
npm run build:ios       # Build web + sync to iOS
npm run build:all       # Build web + sync both platforms
```

Then open the native project to build the APK/AAB or IPA:

```bash
npx cap open android
npx cap open ios
```

## Project Structure

```
src/
├── components/       # UI — HomeGlobeScreen, PrayerTable, CountdownTimer,
│                     #       SettingsModal, OnboardingScreen, CitySearch,
│                     #       LocationDisplay; three/ holds the 3D views
├── context/          # Global state — Location, Settings, Theme, Travel
├── hooks/            # usePrayerTimes, useNotifications, useQibla
├── services/         # prayerService, notificationService,
│                     #   athanService, solarGeometry
├── types/            # TypeScript interfaces
├── plugins/          # Native bridge (AthanPlugin)
├── data/             # City database, country codes
├── App.tsx           # Root component
└── main.tsx          # Entry point with providers
android/              # Android native project
ios/                  # iOS native project
```

## License

All rights reserved.
