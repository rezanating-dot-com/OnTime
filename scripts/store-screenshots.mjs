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
 * globe, the prayer list, Qibla, tracking, travel mode in use, and the
 * notification settings people actually go looking for. No sub-menu that only
 * makes sense once you already own the app.
 *
 * ── Why it seeds so much ─────────────────────────────────────────────
 *
 * A store screenshot has to show the app in use, not on its first launch. Each
 * shot starts from a browser profile with onboarding done, a real city, and
 * twelve days of prayer tracking behind it — including two misses, because a
 * flawless 100% reads as a mock-up rather than as the app.
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

const TORONTO = { latitude: 43.6532, longitude: -79.3832 };
const ISTANBUL = { latitude: 41.0082, longitude: 28.9784 };

function trackingBlob() {
  const prayers = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const records = [];
  const now = new Date();
  for (let back = 0; back < 12; back++) {
    const day = new Date(now);
    day.setDate(day.getDate() - back);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    prayers.forEach((prayer, i) => {
      // Today only up to Asr, so the list shows a mix of done and still-to-come.
      if (back === 0 && i > 2) return;
      // A couple of misses, so the stats read as real rather than a perfect week.
      const missed = (back === 3 && i === 0) || (back === 7 && i === 4);
      records.push({
        date: key,
        prayer,
        status: missed ? 'missed' : 'ontime',
        trackedAt: new Date(day.getTime() - i * 3600_000).toISOString(),
      });
    });
  }
  return JSON.stringify({ records, dayKeySchema: 2 });
}

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
  const coords = travelling ? ISTANBUL : TORONTO;
  const city = travelling ? 'Istanbul' : 'Toronto';
  const country = travelling ? 'TR' : 'CA';

  const ctx = await browser.newContext({
    viewport: { width: 432, height: 768 },
    deviceScaleFactor: 2.5,
    isMobile: true,
    hasTouch: true,
    permissions: [],
    timezoneId: travelling ? 'Europe/Istanbul' : 'America/Toronto',
    locale: 'en-US',
    colorScheme: theme === 'light' ? 'light' : 'dark',
  });
  await ctx.addInitScript(
    ([blob, loc, cityName, countryCode, themeName, tracking]) => {
      const set = (k, v) => localStorage.setItem(`CapacitorStorage.${k}`, v);
      set('ontime_onboarding_complete', 'true');
      set('ontime_theme', themeName);
      set('ontime_location', JSON.stringify({ coordinates: loc, cityName, countryCode }));
      set('ontime_prayer_tracking', tracking);
      set('ontime_settings', blob);
    },
    [settings(opts), coords, city, country, theme, trackingBlob()]
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

await shot('01-globe-home', { homeView: 'globe', settle: 11000 });
await shot('02-prayer-times', { homeView: 'list', theme: 'light' });
await shot('03-qibla', {
  homeView: 'list',
  after: async (page) => {
    await page.locator('[aria-label="Open qibla compass"]').first().click();
    await page.waitForTimeout(9000);
  },
});
await shot('04-prayer-tracking', {
  homeView: 'list',
  after: async (page) => {
    await page.locator('[aria-label="Open dashboard"]').first().click();
    await page.waitForTimeout(2500);
  },
});
await shot('05-travel-mode', { homeView: 'list', travelling: true, theme: 'light' });
await shot('06-notifications', { homeView: 'list', after: openSetting('Notifications') });
await shot('07-prayer-reminders', { homeView: 'list', after: openSetting(['Notifications', 'Prayer Notifications']) });
await shot('08-settings', {
  homeView: 'list',
  theme: 'light',
  after: async (page) => {
    await page.locator('[aria-label="Open settings"]').first().click();
    await page.waitForTimeout(1200);
  },
});

await browser.close();
