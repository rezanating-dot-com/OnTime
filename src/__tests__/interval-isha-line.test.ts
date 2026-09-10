import { describe, it, expect, vi } from 'vitest';
import { twilightAnglesFor } from '../services/prayerService';

/**
 * User story: I use Umm al-Qura, and the globe shows me where in the world it
 * is Isha right now — with a line, like every other prayer, not a label
 * floating over nothing.
 *
 * Most methods put Isha at a fixed depression of the sun, which is a circle
 * around the sub-solar point. Umm al-Qura and Qatar do not: they put Isha at
 * Maghrib plus a fixed number of minutes, and no depression angle corresponds
 * to that. Halving the rings so a prayer's line only covers the longitudes at
 * that prayer's time of day removed the accidental stand-in these methods had
 * been relying on — Fajr's full circle — and left their Isha label anchored to
 * a half of it that is no longer drawn.
 *
 * The places where it is Isha now are exactly the places where the sun set N
 * minutes ago, so the line is the terminator as it stood N minutes ago.
 */
vi.mock('globe.gl', () => ({ default: class {} }));

const { intervalIshaSunLon } = await import('../components/three/homeGlobe');

describe('the calculation methods that give Isha no angle', () => {
  it('reports the interval instead, so the globe has something to draw', () => {
    for (const method of ['UmmAlQura', 'Qatar'] as const) {
      const angles = twilightAnglesFor(method);
      expect(angles.isha, `${method} isha angle`).toBeNull();
      expect(angles.ishaIntervalMin, `${method} isha interval`).toBeGreaterThan(0);
    }
  });

  it('leaves the angle-based methods alone', () => {
    for (const method of ['MuslimWorldLeague', 'NorthAmerica', 'Egyptian'] as const) {
      const angles = twilightAnglesFor(method);
      expect(angles.isha, `${method} isha angle`).toBeGreaterThan(0);
      expect(angles.ishaIntervalMin, `${method} isha interval`).toBeNull();
    }
  });
});

describe('placing an interval-based Isha on the globe', () => {
  it('is the terminator from when the sun set on those longitudes', () => {
    // The Earth turns 15 degrees an hour, so 90 minutes is 22.5 degrees of
    // sub-solar longitude — eastward, because that is where the sun was.
    expect(intervalIshaSunLon(0, 90)).toBeCloseTo(22.5, 6);
    expect(intervalIshaSunLon(0, 120)).toBeCloseTo(30, 6);
    expect(intervalIshaSunLon(-40, 90)).toBeCloseTo(-17.5, 6);
  });

  it('lands east of Maghrib, and by a plausible amount', () => {
    // Maghrib is the terminator's evening edge, 90 degrees east of the sun.
    // Isha has to be further into the night than that, but not by so much that
    // it wraps past the far side.
    const sunLon = 10;
    const { ishaIntervalMin } = twilightAnglesFor('UmmAlQura');
    const ishaEdge = intervalIshaSunLon(sunLon, ishaIntervalMin!) + 90;
    const maghribEdge = sunLon + 90;

    expect(ishaEdge).toBeGreaterThan(maghribEdge);
    expect(ishaEdge - maghribEdge).toBeLessThan(90);
  });

  it('sits near where an angle-based Isha would, which is why the old stand-in went unnoticed', () => {
    // Umm al-Qura's 90 minutes works out close to the 17-18 degree depression
    // the angle-based methods use, so the label had looked roughly right all
    // along. Only its line was missing.
    const { ishaIntervalMin } = twilightAnglesFor('UmmAlQura');
    const intervalEdge = intervalIshaSunLon(0, ishaIntervalMin!) + 90;
    const angleEdge = 90 + twilightAnglesFor('MuslimWorldLeague').isha!;

    expect(Math.abs(intervalEdge - angleEdge)).toBeLessThan(8);
  });
});
