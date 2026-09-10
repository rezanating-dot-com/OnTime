import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { contrastRatio, readableInkOn } from '../utils/contrast';

/**
 * User story: whichever prayer is current, I can read its time.
 *
 * The Islamic design paints the current prayer's row with that prayer's own
 * sky. Those skies run from Fajr's pre-dawn purple to Dhuhr's midday blue
 * fading to near-white, and the row's text was white throughout — so Dhuhr's
 * time sat on #eaf3fa at about 1.1:1 and could not be read at all. Asr and
 * Sunrise were nearly as bad.
 *
 * The gradients are pulled out of the component source rather than duplicated
 * here, so adding a sky to the palette is covered by this test the moment it
 * lands.
 */

// WCAG AA for body text. The row's text is 13-22px, so AA large (3:1) would
// arguably do; hold the stricter line, since every sky clears it comfortably.
const MIN_CONTRAST = 4.5;

function skyGradients(): Record<string, [string, string, string]> {
  const source = readFileSync('src/components/IslamicPrayerTable.tsx', 'utf8');
  const block = source.match(/SKY_GRADIENTS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error('could not find SKY_GRADIENTS in IslamicPrayerTable');
  const out: Record<string, [string, string, string]> = {};
  for (const line of block[1].split('\n')) {
    const m = line.match(/(\w+):\s*\['(#[0-9a-fA-F]+)',\s*'(#[0-9a-fA-F]+)',\s*'(#[0-9a-fA-F]+)'\]/);
    if (m) out[m[1]] = [m[2], m[3], m[4]];
  }
  if (Object.keys(out).length < 6) throw new Error('parsed too few gradients');
  return out;
}

describe('User story: reading the current prayer’s row', () => {
  const gradients = skyGradients();

  it('finds a readable ink for every sky in the palette', () => {
    for (const [prayer, [g1, , g3]] of Object.entries(gradients)) {
      // The name sits over the gradient's opening colour, the time over its
      // closing one — the two ends the ink has to survive.
      expect(contrastRatio(g1, readableInkOn(g1).strong), `${prayer} name`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrastRatio(g3, readableInkOn(g3).strong), `${prayer} time`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it('shows why white alone could not do the job', () => {
    // The specific failure this fixed: Dhuhr's midday sky ends near-white.
    const dhuhrEnd = gradients.dhuhr[2];
    expect(contrastRatio(dhuhrEnd, '#ffffff')).toBeLessThan(1.5);
    expect(contrastRatio(dhuhrEnd, readableInkOn(dhuhrEnd).strong)).toBeGreaterThan(10);
  });

  it('still picks white where the sky is genuinely dark', () => {
    // Isha's night sky. Flipping everything to dark ink would have broken these.
    for (const stop of gradients.isha) {
      expect(readableInkOn(stop).strong).toBe('#ffffff');
    }
  });
});
