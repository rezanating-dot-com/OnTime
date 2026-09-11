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

/** The globe is photographed at this size and the banner scales it down, so
 *  the planet has more pixels than it ends up needing rather than fewer. */
const SHOT = 1600;

/**
 * Where the sun is overhead right now, near enough for a picture.
 *
 * The banner is shot from there so the whole face of the planet is lit, and
 * that is not for looks: it is what makes the planet's edge findable. Half a
 * planet in night reads barely brighter than the sky it sits on, while the
 * atmosphere's halo reads brighter than that and reaches well past the rim —
 * so against a night side there is no brightness that separates planet from
 * sky. Measuring one gave a radius more than twice the truth, and a banner
 * zoomed into a coastline.
 *
 * It also makes the shot the same whatever hour it is run at, which the
 * version that sat over one city was not.
 */
function subSolarPoint(now = new Date()) {
  const dayOfYear = Math.floor((now - Date.UTC(now.getUTCFullYear(), 0, 0)) / 86400000);
  const declination = 23.44 * Math.sin((2 * Math.PI * (dayOfYear - 81)) / 365);
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const longitude = ((15 * (12 - utcHours) + 540) % 360) - 180;
  return { latitude: declination, longitude };
}
const SUN_OVERHEAD = subSolarPoint();
/** Where the picture is taken from. Near the day/night line, so the banner has
 *  one: a fully lit Earth is easier to measure but duller to look at, and the
 *  lines for the night prayers are all round the back of it. */
const MECCA = { latitude: 21.4225, longitude: 39.8262 };
/** How wide the planet itself should be on the finished banner. */
const PLANET_PX = 430;

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

// ── 1. photograph the globe on its own ───────────────────────────────

/** The app's globe alone in a square window, with its own chrome hidden. */
async function photographGlobe(place) {
  const ctx = await browser.newContext({
    viewport: { width: SHOT, height: SHOT },
    deviceScaleFactor: 1,
    timezoneId: 'UTC',
    locale: 'en-US',
    colorScheme: 'dark',
  });
  await ctx.addInitScript((loc) => {
    const set = (k, v) => localStorage.setItem(`CapacitorStorage.${k}`, v);
    set('ontime_onboarding_complete', 'true');
    set('ontime_theme', 'dark');
    set('ontime_location', JSON.stringify({ coordinates: loc, cityName: 'Here', countryCode: 'XX' }));
    set('ontime_settings', JSON.stringify({
      calculationMethod: 'UmmAlQura', asrCalculation: 'Standard',
      optionalPrayers: { showSunrise: true, showMiddleOfNight: false, showLastThirdOfNight: false },
      distanceUnit: 'miles', designStyle: 'classic', homeView: 'globe',
    }));
  }, place);

  const page = await ctx.newPage();
  await page.goto('http://localhost:5199/', { waitUntil: 'load' });
  // The globe is its own layer behind everything else, so everything else can
  // simply be told not to draw. Anything left in frame would be measured as
  // part of the planet.
  await page.addStyleTag({
    content: `
      header, button { display: none !important; }
      .absolute.inset-x-0.bottom-1 { display: none !important; }
      .pointer-events-none.absolute.inset-x-0.top-0 { display: none !important; }
      .px-4.pb-6, .px-5.pb-6 { display: none !important; }
      /* The app lights its sky with a soft radial gradient, which is brighter
         than the night side of the planet — measure against that and the
         gradient is read as planet. Flattened to the same near-black the
         banner sits on, which is also what makes the join invisible later. */
      .absolute.inset-0.z-0 { background: #03050a !important; }
    `,
  });
  await page.waitForTimeout(12000);
  const buf = await page.screenshot();
  await ctx.close();
  return buf;
}

// Two shots of the same camera. The first is taken from under the sun, where
// the planet is lit end to end and its edge can be found without argument; the
// second is the one that goes in the banner, taken near the day/night line
// where there is something to look at and where the night prayers' lines are
// still on this side. Same window, same altitude, same offset, so what is
// measured on one is true of the other.
const sunlitShot = (await photographGlobe(SUN_OVERHEAD)).toString('base64');
const globeBuf = await photographGlobe(MECCA);
if (process.env.FG_DEBUG) {
  const { writeFileSync } = await import('fs');
  writeFileSync(process.env.FG_DEBUG, globeBuf);
  console.log('globe shot written to', process.env.FG_DEBUG);
}
const globeShot = globeBuf.toString('base64');

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
  window.__placeGlobe = (measureUrl, drawUrl, planetPx) => new Promise((resolve) => {
    const measure = new Image();
    measure.onload = () => {
      const n = measure.width;
      const probe = document.createElement('canvas');
      probe.width = probe.height = n;
      const pc = probe.getContext('2d', { willReadFrequently: true });
      pc.drawImage(measure, 0, 0);
      const { data } = pc.getImageData(0, 0, n, n);
      const lum = (x, y) => {
        const i = (y * n + x) * 4;
        return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      };
      // The widest row of the disc is its equator, and that gives the centre
      // and the radius at once. Measured rather than assumed, because the app
      // does not put the planet in the middle of its window: it sits it lower
      // than centre so the countdown above has room.
      //
      // Just above the flattened sky and well below the oceans, which are
      // darker than you would guess — a threshold picked to clear the land
      // measured a continent rather than a planet. Checked against the
      // geometry it should give: from altitude h a sphere's edge is
      // asin(1 / (1 + h)) off the view axis, which in this window works out
      // near 320 pixels, and this lands on 315.
      // Straight down the middle of the frame. The camera points at the
      // user's own place and the only offset the app applies is vertical, so
      // the planet is always centred left to right; all that is unknown is how
      // far down it sits and how big it is, and one column answers both.
      //
      // The longest unbroken run of lit pixels, not the first and last lit
      // pixel: there are stars out there, and taking the outermost of anything
      // bright measures the starfield rather than the Earth.
      const cx = n / 2;
      const x = Math.floor(cx);
      let bestLo = -1, bestLen = 0, runLo = -1;
      for (let y = 0; y <= n; y++) {
        const isLit = y < n && lum(x, y) > 10;
        if (isLit && runLo < 0) runLo = y;
        if (!isLit && runLo >= 0) {
          if (y - runLo > bestLen) { bestLen = y - runLo; bestLo = runLo; }
          runLo = -1;
        }
      }
      const r = bestLen / 2;
      const cy = bestLo + r;

      // Loudly, rather than quietly producing a banner zoomed into a coastline,
      // which is what the previous version did when the app's framing changed
      // under it.
      // No backticks in here: this whole page is itself a template literal, and
      // one would close it.
      if (r < n * 0.06 || r > n * 0.49) {
        throw new Error('planet measured at radius ' + r + ' in a ' + n + 'px frame, which cannot be right');
      }

      // A third of a radius of air around it. Enough for the atmosphere AND
      // for the prayer labels, which sit just off the limb: with less, the
      // fade starts on top of them and clips a word off the left of one.
      const pad = Math.round(r * 1.35);
      const box = pad * 2;
      const el = document.getElementById('globe');
      el.width = el.height = box;

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

      // The picture, cut to what the other shot measured.
      const drawn = new Image();
      drawn.onload = () => {
        el.getContext('2d').drawImage(drawn, cx - pad, cy - pad, box, box, 0, 0, box, box);
        resolve({ radius: Math.round(r), at: [Math.round(cx), Math.round(cy)], of: n });
      };
      drawn.src = drawUrl;
    };
    measure.src = measureUrl;
  });
</script>
`;

const ctx = await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.setContent(PAGE, { waitUntil: 'networkidle' });
const found = await page.evaluate(
  ([lit, pretty, px]) => window.__placeGlobe(
    'data:image/png;base64,' + lit,
    'data:image/png;base64,' + pretty,
    px,
  ),
  [sunlitShot, globeShot, PLANET_PX]
);
console.log(`sun overhead at ${SUN_OVERHEAD.latitude.toFixed(1)}, ${SUN_OVERHEAD.longitude.toFixed(1)}`);
console.log(`planet measured at radius ${found.radius}, centred on ${found.at}, in a ${found.of}px frame`);
await page.waitForTimeout(600);
const out = join(OUT_DIR, 'feature-graphic.png');
await page.screenshot({ path: out });
console.log(out);
await browser.close();
