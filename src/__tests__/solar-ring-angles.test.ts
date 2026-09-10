import { twilightAnglesFor, asrShadowFactor } from '../services/prayerService';
import type { CalculationMethod } from '../types';

/**
 * The home globe draws a ring across the earth for each solar prayer event.
 * Those rings used to be hard coded at 108° (fajr and isha) and 45° (asr),
 * which is only correct for an 18° method under the standard Asr rule at a
 * latitude the sun happens to be directly over. In practice the Asr ring was
 * wrong for essentially every user — by up to ~39° of arc, roughly 4,350 km on
 * the ground, for a Hanafi user at high latitude in winter — and the twilight
 * ring ignored the twelve methods' real 15°–20° spread.
 *
 * These are the inputs the rings are now derived from, so they are the part
 * worth pinning: they come from the same adhan parameter table that
 * `calculatePrayerTimes` uses, which is what stops the drawn ring and the
 * computed time from drifting apart.
 */
const METHODS: CalculationMethod[] = [
  'MuslimWorldLeague',
  'Egyptian',
  'Karachi',
  'UmmAlQura',
  'Dubai',
  'MoonsightingCommittee',
  'NorthAmerica',
  'Kuwait',
  'Qatar',
  'Singapore',
  'Tehran',
  'Turkey',
];

/** The methods that fix Isha at an interval after Maghrib rather than an angle. */
const INTERVAL_ISHA: CalculationMethod[] = ['UmmAlQura', 'Qatar'];

describe('twilight angles per calculation method (GL-4)', () => {
  it('gives every method a real fajr angle', () => {
    for (const method of METHODS) {
      const { fajr } = twilightAnglesFor(method);
      expect(fajr, method).toBeGreaterThan(0);
      expect(fajr, method).toBeLessThanOrEqual(20);
    }
  });

  it('matches adhan where the methods disagree with each other', () => {
    // ishaIntervalMin is null throughout here: every method in this list gives
    // Isha an angle. The interval-based ones are covered below.
    expect(twilightAnglesFor('MuslimWorldLeague')).toEqual({ fajr: 18, isha: 17, ishaIntervalMin: null });
    expect(twilightAnglesFor('Egyptian')).toEqual({ fajr: 19.5, isha: 17.5, ishaIntervalMin: null });
    expect(twilightAnglesFor('NorthAmerica')).toEqual({ fajr: 15, isha: 15, ishaIntervalMin: null });
    expect(twilightAnglesFor('Singapore')).toEqual({ fajr: 20, isha: 18, ishaIntervalMin: null });
    expect(twilightAnglesFor('Tehran')).toEqual({ fajr: 17.7, isha: 14, ishaIntervalMin: null });
    expect(twilightAnglesFor('Dubai')).toEqual({ fajr: 18.2, isha: 18.2, ishaIntervalMin: null });
    expect(twilightAnglesFor('Kuwait')).toEqual({ fajr: 18, isha: 17.5, ishaIntervalMin: null });
  });

  it('reports no isha angle for the interval-based methods', () => {
    // Isha is Maghrib + 90 minutes here, so there is no solar depression to
    // draw a ring at and the globe must not invent one. It gets the interval
    // instead, which is what it places Isha's line from.
    for (const method of INTERVAL_ISHA) {
      expect(twilightAnglesFor(method).isha, method).toBeNull();
      expect(twilightAnglesFor(method).ishaIntervalMin, method).toBeGreaterThan(0);
    }
    expect(twilightAnglesFor('UmmAlQura').fajr).toBe(18.5);
    expect(twilightAnglesFor('Qatar').fajr).toBe(18);
  });

  it('gives an isha angle to every angle-based method', () => {
    for (const method of METHODS) {
      if (INTERVAL_ISHA.includes(method)) continue;
      expect(twilightAnglesFor(method).isha, method).not.toBeNull();
    }
  });

  it('separates fajr from isha where the method does', () => {
    // The old single 108° ring served both labels; these methods put them at
    // genuinely different depressions, so they need two rings.
    const { fajr, isha } = twilightAnglesFor('Egyptian');
    expect(fajr).not.toBe(isha);
  });
});

describe('Asr shadow factor (GL-4)', () => {
  it('maps the madhab to the multiplier adhan uses', () => {
    expect(asrShadowFactor('Standard')).toBe(1);
    expect(asrShadowFactor('Hanafi')).toBe(2);
  });
});

/**
 * The ring geometry itself lives in `homeGlobe.asrRingDeg`, which is private to
 * a module that pulls in three.js and globe.gl. This restates it as an
 * executable spec of the relationship the fix depends on — not a test of that
 * function's source, so it will not catch a regression inside homeGlobe.ts.
 */
const D2R = Math.PI / 180;

function asrRingDeg(latitude: number, declination: number, shadowFactor: number): number {
  const zenithGap = Math.min(Math.abs(latitude - declination), 90);
  const altitudeDeg = Math.atan(1 / (shadowFactor + Math.tan(zenithGap * D2R))) / D2R;
  return 90 - altitudeDeg;
}

describe('Asr ring geometry (GL-4)', () => {
  it('reduces to 45° only in the special case the old constant assumed', () => {
    // Standard rule, sun directly over the user's latitude: shadow factor 1 and
    // a zero zenith gap is the single point where 45° was ever correct.
    expect(asrRingDeg(0, 0, 1)).toBeCloseTo(45, 10);
    expect(asrRingDeg(21.4, 21.4, 1)).toBeCloseTo(45, 10);
  });

  it('is not 45° for ordinary users, which is the bug', () => {
    // London at the December solstice under the standard rule.
    expect(Math.abs(asrRingDeg(51.5, -23.44, 1) - 45)).toBeGreaterThan(20);
  });

  it('pushes the ring further from the sub-solar point for Hanafi', () => {
    // A longer required shadow means a lower sun, which means a later Asr.
    expect(asrRingDeg(51.5, -23.44, 2)).toBeGreaterThan(asrRingDeg(51.5, -23.44, 1));
    expect(asrRingDeg(21.4, 0, 2)).toBeGreaterThan(asrRingDeg(21.4, 0, 1));
  });

  it('tracks the season: a lower sun at winter Asr means a wider ring', () => {
    const summer = asrRingDeg(51.5, 23.44, 1);
    const winter = asrRingDeg(51.5, -23.44, 1);
    expect(winter).toBeGreaterThan(summer);
  });

  it('clamps to the horizon in polar night instead of wrapping past 90°', () => {
    // |latitude - declination| exceeds 90° when the sun never rises. tan() goes
    // negative there, so an unclamped formula puts the ring on the far side of
    // the globe; Asr degenerates to the horizon instead.
    expect(asrRingDeg(90, -23.44, 1)).toBeCloseTo(90, 6);
    expect(asrRingDeg(-90, 23.44, 2)).toBeCloseTo(90, 6);
  });

  it('stays finite at the poles and never leaves the sphere', () => {
    for (const latitude of [90, -90, 69.65, 0]) {
      for (const declination of [23.44, -23.44, 0]) {
        for (const shadowFactor of [1, 2]) {
          const ring = asrRingDeg(latitude, declination, shadowFactor);
          expect(Number.isFinite(ring), `${latitude}/${declination}/${shadowFactor}`).toBe(true);
          // Angular distance from the sub-solar point: 0 (sun overhead) to 90
          // (sun on the horizon). Asr is always between them.
          expect(ring).toBeGreaterThanOrEqual(0);
          expect(ring).toBeLessThanOrEqual(90);
        }
      }
    }
  });
});
