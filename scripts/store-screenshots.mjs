#!/usr/bin/env node
/**
 * Render the Play Store phone screenshots.
 *
 * ── Before running ───────────────────────────────────────────────────
 *
 *   npm run build
 *   npx vite preview --port 5199 --strictPort   # in another shell
 *   node scripts/store-screenshots.mjs docs/store/<date>
 *
 * Needs a Chromium that Playwright can drive. This repo does not depend on
 * Playwright — the import below points at a sibling project's copy, which is
 * the one thing to fix if this is ever run somewhere else.
 *
 * ── What it shoots, and why ──────────────────────────────────────────
 *
 * Eight screens, which is Play's maximum, chosen to be the things somebody
 * would install the app *for* rather than whatever happens to look tidy: the
 * globe, the prayer list, Qibla, travel mode in use, the notification settings
 * people actually go looking for, and the second visual design. No sub-menu
 * that only makes sense once you already own the app.
 *
 * ── Why it seeds so much ─────────────────────────────────────────────
 *
 * A store screenshot has to show the app in use, not on its first launch, so
 * each shot starts from a browser profile with onboarding done and a real city.
 *
 * The travel shot seeds a home base in Toronto and a location in Istanbul, so
 * the banner is showing a real distance rather than a placeholder.
 *
 * Seeding here works because this is the web build, where Capacitor Preferences
 * is localStorage. **It does not work on a device**, where Preferences is
 * SharedPreferences — a lesson that cost a day's worth of confidently wrong
 * measurements. Drive the app's own controls if you ever shoot on hardware.
 *
 * ── Sizing ───────────────────────────────────────────────────────────
 *
 * Play wants each side between 320 and 3840 pixels and a ratio no wider than
 * 2:1. A 432x768 viewport at a device pixel ratio of 2.5 lands exactly on
 * 1080x1920 (9:16), the safest and most common phone size. Do not screenshot at
 * the 412x915 used for performance work: that is 2.2:1 and Play rejects it.
 *
 * The globe needs about eleven seconds before it is worth photographing.
 */

import { chromium } from '/home/rinux/Desktop/Projects/Development Project/logicly/node_modules/playwright-core/index.mjs';
import { mkdirSync } from 'fs';

const OUT = process.argv[2] ?? 'store-shots';
mkdirSync(OUT, { recursive: true });

const TORONTO = { coords: { latitude: 43.6532, longitude: -79.3832 }, city: 'Toronto', country: 'CA', tz: 'America/Toronto' };
const ISTANBUL = { coords: { latitude: 41.0082, longitude: 28.9784 }, city: 'Istanbul', country: 'TR', tz: 'Europe/Istanbul' };
// The globe shot's home. Chosen for the terminator: run this while Mecca is
// near sunrise and the day and night halves of the Earth both sit in frame,
// with the city on the line between them. See the note on the shot itself.
const MECCA = { coords: { latitude: 21.4225, longitude: 39.8262 }, city: 'Mecca', country: 'SA', tz: 'Asia/Riyadh' };

function settings({ homeView = 'list', designStyle = 'classic', travelling = false }) {
  return JSON.stringify({
    calculationMethod: 'NorthAmerica',
    asrCalculation: 'Standard',
    // The night prayers are on. They are real optional rows, and with travel
    // mode combining Dhuhr and Asr the list is otherwise short enough to leave
    // half the frame empty.
    optionalPrayers: { showSunrise: true, showMiddleOfNight: true, showLastThirdOfNight: true },
    notifications: {
      enabled: true,
      defaultSound: 'default',
      defaultReminderMinutes: 15,
      prayers: {
        // The app offers 0/5/10/15/30 only; anything else renders as Off.
        fajr: { enabled: true, sound: 'adhan_fajr', reminderMinutes: 30 },
        sunrise: { enabled: false, sound: 'default', reminderMinutes: 0 },
        dhuhr: { enabled: true, sound: 'adhan_makkah', reminderMinutes: 15 },
        asr: { enabled: true, sound: 'default', reminderMinutes: 10 },
        maghrib: { enabled: true, sound: 'adhan_madinah', reminderMinutes: 5 },
        isha: { enabled: true, sound: 'default', reminderMinutes: 15 },
      },
    },
    travel: travelling
      ? {
          enabled: true,
          homeBase: { coordinates: TORONTO, cityName: 'Toronto', countryCode: 'CA' },
          override: 'auto',
          distanceThresholdKm: 88.7,
          jamaDhuhrAsr: true,
          jamaMaghribIsha: false,
          maxTravelDays: 0,
          travelStartDate: new Date(Date.now() - 2 * 86400_000).toISOString(),
          autoConfirmed: true,
          promptDismissed: true,
          offerSuppressed: false,
        }
      : undefined,
    distanceUnit: 'miles',
    designStyle,
    homeView,
  });
}

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function shot(name, opts) {
  const { theme = 'dark', travelling = false, settle = 4000, after } = opts;
  const place = opts.place ?? (travelling ? ISTANBUL : TORONTO);
  const { coords, city, country } = place;

  const ctx = await browser.newContext({
    viewport: { width: 432, height: 768 },
    deviceScaleFactor: 2.5,
    isMobile: true,
    hasTouch: true,
    permissions: [],
    timezoneId: place.tz,
    locale: 'en-US',
    colorScheme: theme === 'light' ? 'light' : 'dark',
  });
  await ctx.addInitScript(
    ([blob, loc, cityName, countryCode, themeName]) => {
      const set = (k, v) => localStorage.setItem(`CapacitorStorage.${k}`, v);
      set('ontime_onboarding_complete', 'true');
      set('ontime_theme', themeName);
      set('ontime_location', JSON.stringify({ coordinates: loc, cityName, countryCode }));
      set('ontime_settings', blob);
    },
    [settings(opts), coords, city, country, theme]
  );

  const page = await ctx.newPage();
  await page.goto('http://localhost:5199/', { waitUntil: 'load' });
  await page.waitForTimeout(settle);

  // Anything that popped over the shot.
  for (const label of ['Not now', 'Maybe later', 'Later', 'Dismiss']) {
    await page.getByRole('button', { name: label, exact: false }).first().click({ timeout: 600 }).catch(() => {});
  }
  if (after) await after(page);

  await page.screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
  console.log(`${OUT}/${name}.png`);
}

/** Click a settings row by its visible title, then let the panel settle. */
const openSetting = (title) => async (page) => {
  await page.locator('[aria-label="Open settings"]').first().click();
  await page.waitForTimeout(900);
  for (const step of [].concat(title)) {
    await page.getByText(step, { exact: true }).first().click();
    await page.waitForTimeout(900);
  }
};

await shot('01-globe-home', {
  homeView: 'globe',
  place: MECCA,
  settle: 11000,
  // Two things the default framing does not give you. The globe opens close
  // enough that the Earth fills the frame edge to edge, which reads as a map
  // rather than as a planet, so pull back until the whole disc and its
  // atmosphere are inside the shot. And the day and night sides only both
  // appear when the camera is over the line between them, which is why this
  // one shot is taken from Mecca near sunrise rather than from Toronto.
  after: async (page) => {
    await page.locator('canvas').first().hover();
    // Nine notches. Seven leaves the disc clipped at the left edge; eleven
    // leaves so much empty sky that the planet reads as small.
    for (let i = 0; i < 9; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(4000);
  },
});
await shot('02-prayer-times', { homeView: 'list', theme: 'light' });
await shot('03-qibla', {
  // The qibla is drawn on the globe itself now rather than on a screen of its
  // own, so this shot starts on the globe and turns the line on.
  homeView: 'globe',
  settle: 11000,
  after: async (page) => {
    await page.locator('[aria-label="Show qibla direction"]').first().click();
    // Long enough for the camera to settle and for the app to stop asking for
    // a figure-8, which a browser with no magnetometer will never satisfy.
    await page.waitForTimeout(9500);
  },
});
await shot('04-travel-mode', { homeView: 'list', travelling: true, theme: 'light' });
await shot('05-notifications', { homeView: 'list', after: openSetting('Notifications') });
await shot('06-prayer-reminders', { homeView: 'list', after: openSetting(['Notifications', 'Prayer Notifications']) });
await shot('07-settings', {
  homeView: 'list',
  theme: 'light',
  after: async (page) => {
    await page.locator('[aria-label="Open settings"]').first().click();
    await page.waitForTimeout(1200);
  },
});
// The second design gets the last slot, on the same screen as shot 02 so the
// two read as a choice rather than as two different apps.
await shot('08-islamic-design', { homeView: 'list', designStyle: 'islamic' });

await browser.close();
