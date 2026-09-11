#!/usr/bin/env node
/**
 * Render the Play Store feature graphic.
 *
 *   node scripts/feature-graphic.mjs docs/store/<date>
 *
 * ── What this is ─────────────────────────────────────────────────────
 *
 * The wide banner Play shows above the screenshots, at exactly 1024x500. It
 * cannot be a screenshot: Play wants a designed image, and a phone screen at
 * this shape is mostly empty. So the globe is lifted out of the first store
 * screenshot and set against the app's own night sky with the name beside it.
 *
 * Taking the globe from the screenshot rather than re-rendering it means the
 * banner can never show something the app does not: it is the same frame a
 * user would see, with the prayer lines, the day and night sides, and the pin.
 * Regenerate the screenshots first if the globe has changed.
 *
 * ── Finding the planet ───────────────────────────────────────────────
 *
 * The crop is measured, not hard-coded: the widest run of non-space pixels in
 * the screenshot gives the disc's centre and radius, and the square cut around
 * it is the radius plus a tenth, so the prayer-line labels that sit just off
 * the limb survive. Hard-coded numbers would silently mis-frame the moment the
 * globe shot is retaken at a different zoom.
 *
 * The soft edge on the planet is a mask. Note the number: a circular gradient
 * measures its stops along the ray to the farthest *corner*, so the rim sits
 * near 68% of it, not near 50%. Getting that wrong slices the Earth in half.
 */

import { chromium } from '/home/rinux/Desktop/Projects/Development Project/logicly/node_modules/playwright-core/index.mjs';
import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const OUT_DIR = process.argv[2] ?? 'store-shots';
const SOURCE = join(OUT_DIR, '01-globe-home.png');
mkdirSync(OUT_DIR, { recursive: true });

const globeShot = readFileSync(SOURCE).toString('base64');

const PAGE = `
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1024px; height: 500px; overflow: hidden; }
  body {
    font-family: 'Ubuntu', system-ui, sans-serif;
    background: radial-gradient(ellipse 820px 560px at 78% 48%, #101a2e 0%, #070b14 55%, #03050a 100%);
    position: relative;
  }
  .stars { position: absolute; inset: 0; }
  .stars i { position: absolute; border-radius: 50%; background: #fff; }
  .glow {
    position: absolute; right: -30px; top: 50%; transform: translateY(-50%);
    width: 600px; height: 600px; border-radius: 50%;
    background: radial-gradient(circle, rgba(80,130,255,0.22) 0%, rgba(80,130,255,0.06) 45%, transparent 68%);
  }
  #globe {
    position: absolute; right: 38px; top: 50%; transform: translateY(-50%);
    width: 452px; height: 452px;
    -webkit-mask-image: radial-gradient(circle at 50% 50%, #000 0 68%, transparent 71.5%);
    mask-image: radial-gradient(circle at 50% 50%, #000 0 68%, transparent 71.5%);
  }
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
<div class="glow"></div>
<canvas id="globe" width="900" height="900"></canvas>
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

  /** Cut the planet out of a store screenshot, measured rather than guessed. */
  window.__placeGlobe = (dataUrl) => new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const probe = document.createElement('canvas');
      probe.width = img.width; probe.height = img.height;
      const pc = probe.getContext('2d', { willReadFrequently: true });
      pc.drawImage(img, 0, 0);
      const { data } = pc.getImageData(0, 0, img.width, img.height);
      const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];

      // Space is near black; anything brighter is either the planet or the
      // app's own text. Only rows well below the countdown and above the
      // controls are considered, and the widest of them is the equator of the
      // disc as drawn.
      const top = Math.round(img.height * 0.22);
      const bottom = Math.round(img.height * 0.84);
      let best = { width: 0 };
      for (let y = top; y < bottom; y++) {
        let lo = -1, hi = -1;
        for (let x = 0; x < img.width; x++) {
          if (lum((y * img.width + x) * 4) > 12) { if (lo < 0) lo = x; hi = x; }
        }
        if (hi - lo > best.width) best = { y, lo, hi, width: hi - lo };
      }
      const r = best.width / 2;
      const cx = (best.lo + best.hi) / 2;
      // A tenth of the radius of air, so the labels that sit just off the limb
      // are inside the cut.
      const pad = Math.round(r * 1.1);

      const out = document.getElementById('globe').getContext('2d');
      out.drawImage(img, cx - pad, best.y - pad, pad * 2, pad * 2, 0, 0, 900, 900);
      resolve({ cx: Math.round(cx), cy: best.y, r: Math.round(r) });
    };
    img.src = dataUrl;
  });
</script>
`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.setContent(PAGE, { waitUntil: 'networkidle' });
const found = await page.evaluate(
  (b64) => window.__placeGlobe('data:image/png;base64,' + b64),
  globeShot
);
console.log(`globe found at (${found.cx}, ${found.cy}) radius ${found.r} in ${SOURCE}`);
await page.waitForTimeout(600);
const out = join(OUT_DIR, 'feature-graphic.png');
await page.screenshot({ path: out });
console.log(out);
await browser.close();
