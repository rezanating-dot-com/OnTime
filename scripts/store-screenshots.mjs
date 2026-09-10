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
 * ── Why it seeds so much ─────────────────────────────────────────────
 *
 * A store screenshot has to show the app in use, not on its first launch. So
 * each shot starts from a browser profile with onboarding done, a real city,
 * and twelve days of prayer tracking behind it — including two misses, because
 * a flawless 100% reads as a mock-up rather than as the app.
 *
 * ── Sizing ───────────────────────────────────────────────────────────
 *
 * Play wants each side between 320 and 3840 pixels and a ratio no wider than
 * 2:1. A 432x768 viewport at a device pixel ratio of 2.5 lands exactly on
 * 1080x1920 (9:16), which is the safest and most common phone size. Do not
 * screenshot at the 412x915 used for performance work: that is 2.2:1 and Play
 * rejects it.
 *
 * The globe needs about eleven seconds before it is worth photographing —
 * surface tiles stream in after the first frame.
 */

import { chromium } from '/home/rinux/Desktop/Projects/Development Project/logicly/node_modules/playwright-core/index.mjs';
import { mkdirSync } from 'fs';

const OUT = process.argv[2] ?? 'store-shots';
mkdirSync(OUT, { recursive: true });

const TORONTO = { latitude: 43.6532, longitude: -79.3832 };

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
      // A couple of misses, so the stats read as real rather than a perfect 100%.
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

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--force-device-scale-factor=2.5'] });

async function shot(name, { homeView, designStyle, theme, after }) {
  const ctx = await browser.newContext({
    viewport: { width: 432, height: 768 },
    deviceScaleFactor: 2.5,
    isMobile: true,
    hasTouch: true,
    permissions: [],
    timezoneId: 'America/Toronto',
    locale: 'en-US',
    colorScheme: theme === 'light' ? 'light' : 'dark',
  });
  await ctx.addInitScript(
    ([hv, ds, th, coords, tracking]) => {
      const set = (k, v) => localStorage.setItem(`CapacitorStorage.${k}`, v);
      set('ontime_onboarding_complete', 'true');
      set('ontime_theme', th);
      set('ontime_location', JSON.stringify({ coordinates: coords, cityName: 'Toronto', countryCode: 'CA' }));
      set('ontime_prayer_tracking', tracking);
      set('ontime_settings', JSON.stringify({
        calculationMethod: 'NorthAmerica',
        asrCalculation: 'Standard',
        optionalPrayers: { showSunrise: true, showMiddleOfNight: false, showLastThirdOfNight: false },
        notifications: { enabled: true, defaultSound: 'default', defaultReminderMinutes: 15 },
        distanceUnit: 'miles',
        designStyle: ds,
        homeView: hv,
      }));
    },
    [homeView, designStyle, theme, TORONTO, trackingBlob()]
  );
  const page = await ctx.newPage();
  await page.goto('http://localhost:5199/', { waitUntil: 'load' });
  await page.waitForTimeout(homeView === 'globe' ? 11000 : 4000);
  // Dismiss anything that popped over the shot.
  for (const label of ['Not now', 'Maybe later', 'Later', 'Dismiss']) {
    await page.getByRole('button', { name: label, exact: false }).first().click({ timeout: 800 }).catch(() => {});
  }
  if (after) await after(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await ctx.close();
  console.log(`${OUT}/${name}.png`);
}

await shot('01-globe-home', { homeView: 'globe', designStyle: 'classic', theme: 'dark' });
await shot('02-prayer-times', { homeView: 'list', designStyle: 'classic', theme: 'light' });
await shot('03-prayer-tracking', { homeView: 'list', designStyle: 'classic', theme: 'dark' });
await shot('04-qibla', {
  homeView: 'list', designStyle: 'classic', theme: 'dark',
  after: async (page) => {
    await page.locator('[aria-label="Open qibla compass"]').first().click();
    await page.waitForTimeout(9000);
  },
});
await shot('05-dashboard', {
  homeView: 'list', designStyle: 'classic', theme: 'dark',
  after: async (page) => {
    await page.locator('[aria-label="Open dashboard"]').first().click();
    await page.waitForTimeout(2500);
  },
});
await shot('06-islamic-design', { homeView: 'list', designStyle: 'islamic', theme: 'dark' });

await browser.close();
