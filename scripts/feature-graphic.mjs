#!/usr/bin/env node
/**
 * Render the Play Store feature graphic.
 *
 *   npm run build
 *   npx vite preview --port 5199 --strictPort   # in another shell
 *   node scripts/feature-graphic.mjs docs/store/<date>
 *
 * ── What this is ─────────────────────────────────────────────────────
 *
 * The wide banner Play shows above the screenshots, at exactly 1024x500. It
 * cannot be a screenshot: Play wants a designed image, and a phone screen at
 * this shape is mostly empty. So the app's own globe is photographed on its
 * own, against the app's own night sky, with the name beside it.
 *
 * ── Why it drives the app rather than cropping a screenshot ──────────
 *
 * The first version cut the planet out of 01-globe-home.png and hunted for it
 * by looking for the widest run of lit pixels. That is unreliable for a reason
 * worth writing down: half the planet is in night and reads darker than the
 * sky beside it, while the countdown and the prayer labels read brighter than
 * either. "The widest lit row" then lands somewhere that is neither the
 * equator nor anything else in particular, and the banner came out with the
 * planet sitting high. No threshold fixes that; the method was wrong.
 *
 * Here the app draws the globe into a square window with its own chrome
 * hidden. The camera points at the user's location, so the planet is centred
 * by construction rather than by search, and the only thing in frame that is
 * not sky is the planet — which makes measuring its radius exact.
 *
 * ── The mask ─────────────────────────────────────────────────────────
 *
 * Both of its numbers sit somewhere you would not guess. A circular CSS
 * gradient measures its stops along the ray to the farthest CORNER, so a rim
 * five sixths of the way to the edge is at 59% of that ray, not 83%. And the
 * fade has to finish before 70.7%, where the ray crosses the nearest edge:
 * past it the square's own sides show through as four flats on a sphere.
 */

import { chromium } from '/home/rinux/Desktop/Projects/Development Project/logicly/node_modules/playwright-core/index.mjs';
import { mkdirSync } from 'fs';
import { join } from 'path';

const OUT_DIR = process.argv[2] ?? 'store-shots';
mkdirSync(OUT_DIR, { recursive: true });

/** Mecca near sunrise, so the day and night sides are both in shot. */
const MECCA = { latitude: 21.4225, longitude: 39.8262 };
const SHOT = 900;
/** How wide the planet itself should be on the finished banner. */
const PLANET_PX = 430;

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

// ── 1. photograph the globe on its own ───────────────────────────────
const globeCtx = await browser.newContext({
  viewport: { width: SHOT, height: SHOT },
  deviceScaleFactor: 1,
  timezoneId: 'Asia/Riyadh',
  locale: 'en-US',
  colorScheme: 'dark',
});
await globeCtx.addInitScript((loc) => {
  const set = (k, v) => localStorage.setItem(`CapacitorStorage.${k}`, v);
  set('ontime_onboarding_complete', 'true');
  set('ontime_theme', 'dark');
  set('ontime_location', JSON.stringify({ coordinates: loc, cityName: 'Mecca', countryCode: 'SA' }));
  set('ontime_settings', JSON.stringify({
    calculationMethod: 'UmmAlQura', asrCalculation: 'Standard',
    optionalPrayers: { showSunrise: true, showMiddleOfNight: false, showLastThirdOfNight: false },
    distanceUnit: 'miles', designStyle: 'classic', homeView: 'globe',
  }));
}, MECCA);

const globePage = await globeCtx.newPage();
await globePage.goto('http://localhost:5199/', { waitUntil: 'load' });
// The globe is its own layer behind everything else, so everything else can
// simply be told not to draw. Anything left in frame would be measured as
// part of the planet.
await globePage.addStyleTag({
  content: `
    header, button { display: none !important; }
    .absolute.inset-x-0.bottom-1 { display: none !important; }
    .pointer-events-none.absolute.inset-x-0.top-0 { display: none !important; }
    .px-4.pb-6, .px-5.pb-6 { display: none !important; }
  `,
});
await globePage.waitForTimeout(12000);
const globeShot = (await globePage.screenshot()).toString('base64');
await globeCtx.close();

// ── 2. compose the banner around it ──────────────────────────────────
const PAGE = `
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1024px; height: 500px; overflow: hidden; }
  body {
    font-family: 'Ubuntu', system-ui, sans-serif;
    /* Lit behind the words, then settled onto the same near-black the globe
       was photographed against, well before the planet starts. The cut-out
       carries that sky in the gap between the rim and its own atmosphere, and
       against a different black that gap reads as a ring round the Earth. */
    background: linear-gradient(101deg, #0c1426 0%, #070c17 33%, #03050a 52%, #03050a 100%);
    position: relative;
  }
  .stars { position: absolute; inset: 0; }
  .stars i { position: absolute; border-radius: 50%; background: #fff; }
  /* No halo of our own: the globe brings the app's own atmosphere with it, and
     a second one drawn underneath only shows up as a ring. */
  #globe { position: absolute; }
  .copy { position: absolute; left: 68px; top: 50%; transform: translateY(-50%); width: 500px; }
  .name {
    font-size: 88px; font-weight: 700; letter-spacing: -2px; line-height: 1;
    color: #F5F6F8; text-shadow: 0 4px 30px rgba(0,0,0,0.8);
  }
  .rule {
    width: 74px; height: 3px; border-radius: 2px; margin: 22px 0 20px;
    background: linear-gradient(to right, #6B8AFF, rgba(107,138,255,0.15));
  }
  .tag {
    font-size: 29px; line-height: 1.32;
    color: rgba(245,246,248,0.80); text-shadow: 0 2px 16px rgba(0,0,0,0.85);
  }
  .sub {
    margin-top: 20px; font-size: 19px; font-weight: 500; letter-spacing: 0.4px;
    color: rgba(107,138,255,0.95);
  }
</style>
<div class="stars" id="stars"></div>
<canvas id="globe"></canvas>
<div class="copy">
  <div class="name">OnTime</div>
  <div class="rule"></div>
  <div class="tag">Prayer times for wherever<br>in the world you are</div>
  <div class="sub">Works offline &middot; No ads &middot; No account</div>
</div>
<script>
  // A fixed pattern, so re-rendering gives the same picture rather than a
  // different scatter of stars every time.
  let seed = 20260911;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const host = document.getElementById('stars');
  for (let i = 0; i < 70; i++) {
    const s = document.createElement('i');
    const size = rnd() < 0.18 ? 3 : 2;
    s.style.cssText = 'left:' + (rnd() * 1024) + 'px;top:' + (rnd() * 500) +
      'px;opacity:' + (0.18 + rnd() * 0.5).toFixed(2) +
      ';width:' + size + 'px;height:' + size + 'px';
    host.appendChild(s);
  }

  /**
   * Place the planet. The shot is square and the camera is aimed at the user's
   * own place, so the centre is the centre; only the radius has to be
   * measured, and with nothing in frame but sky that is a matter of walking in
   * from the edge until the sky stops.
   */
  window.__placeGlobe = (dataUrl, planetPx) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const n = img.width;
      const probe = document.createElement('canvas');
      probe.width = probe.height = n;
      const pc = probe.getContext('2d', { willReadFrequently: true });
      pc.drawImage(img, 0, 0);
      const { data } = pc.getImageData(0, 0, n, n);
      const lum = (x, y) => {
        const i = (y * n + x) * 4;
        return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      };
      // Along the horizontal through the centre, on the lit side, which is
      // unmistakable against the sky.
      const mid = Math.floor(n / 2);
      let r = 0;
      for (let x = n - 1; x > mid; x--) {
        if (lum(x, mid) > 26) { r = x - mid; break; }
      }
      if (!r) throw new Error('no planet in the frame');

      // A third of a radius of air around it. Enough for the atmosphere AND
      // for the prayer labels, which sit just off the limb: with less, the
      // fade starts on top of them and clips a word off the left of one.
      const pad = Math.round(r * 1.35);
      const box = pad * 2;
      const el = document.getElementById('globe');
      el.width = el.height = box;
      el.getContext('2d').drawImage(img, mid - pad, mid - pad, box, box, 0, 0, box, box);

      // Sized so the planet itself is the width asked for, and centred on the
      // banner's own middle — which is the point of photographing it alone.
      const shown = planetPx * 1.35;
      el.style.width = el.style.height = shown + 'px';
      el.style.left = (1024 - 36 - shown) + 'px';
      el.style.top = (250 - shown / 2) + 'px';
      // The rim is now at 1/1.35 of the half-box, which is 52% of the ray to
      // the corner, and the labels reach a few per cent past it. Start after
      // them, finish before 70.7%, where the ray leaves the nearest edge.
      const mask = 'radial-gradient(circle at 50% 50%, #000 0 59%, transparent 68%)';
      el.style.webkitMaskImage = mask;
      el.style.maskImage = mask;
      resolve({ radius: r, of: n });
    };
    img.src = dataUrl;
  });
</script>
`;

const ctx = await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.setContent(PAGE, { waitUntil: 'networkidle' });
const found = await page.evaluate(
  ([b64, px]) => window.__placeGlobe('data:image/png;base64,' + b64, px),
  [globeShot, PLANET_PX]
);
console.log(`planet measured at radius ${found.radius} in a ${found.of}px frame`);
await page.waitForTimeout(600);
const out = join(OUT_DIR, 'feature-graphic.png');
await page.screenshot({ path: out });
console.log(out);
await browser.close();
