import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

/**
 * A ring of constant sun altitude is a full circle around the sub-solar point,
 * and the sun reaches every altitude *twice* a day — once climbing, once
 * falling. So each circle's western half is a morning moment and its eastern
 * half is the afternoon one, and only one of the two is the prayer the ring is
 * drawn and labelled for.
 *
 * The terminator is the exception: sunrise and sunset are both on it, which is
 * why one circle legitimately serves that pair. Asr, Fajr and Isha are not —
 * drawing their full circle put a green "Asr" line across every longitude that
 * was in mid-morning, so a user at 10am watched the Asr ring sweep over their
 * own dot hours before Asr.
 *
 * These pin the halves: an 'east' arc must lie entirely in the afternoon
 * hemisphere (hour angle 0..180) and a 'west' arc entirely in the morning one.
 */
vi.mock('globe.gl', () => ({ default: class {} }));

const { sunAltitudeCircle, geo2xyz } = await import('../components/three/homeGlobe');

/** Longitude of a point in three-globe's convention (lon 0 on +z). */
function lonOf(p: THREE.Vector3): number {
  return (Math.atan2(p.x, p.z) * 180) / Math.PI;
}

function latOf(p: THREE.Vector3): number {
  return (Math.asin(p.y / p.length()) * 180) / Math.PI;
}

/** Hour angle: degrees of longitude east of the noon meridian, in [-180, 180]. */
function hourAngle(p: THREE.Vector3, sunLon: number): number {
  let h = lonOf(p) - sunLon;
  while (h > 180) h -= 360;
  while (h <= -180) h += 360;
  return h;
}

/**
 * A pole lies on every meridian at once, so it is on no side of the noon one —
 * and `atan2` there is reading two values near the floating-point floor. An arc
 * whose ends are the poles (the terminator at an equinox) is not a wrong arc.
 */
function isPole(p: THREE.Vector3): boolean {
  return Math.abs(latOf(p)) > 89.999;
}

function sunDirFor(sunLat: number, sunLon: number): THREE.Vector3 {
  const p = geo2xyz(sunLat, sunLon, 1);
  return new THREE.Vector3(p.x, p.y, p.z);
}

const R = 100;
// A sub-solar latitude inside the real declination range, and a sub-solar
// longitude that is not 0 — a bug that keys off absolute longitude rather than
// the noon meridian passes at sunLon 0 and fails everywhere else.
const CASES: Array<{ sunLat: number; sunLon: number }> = [
  { sunLat: 0, sunLon: 0 },
  { sunLat: 5.3, sunLon: -34 }, // roughly 10am Eastern in early September
  { sunLat: -23.44, sunLon: 137 },
  { sunLat: 23.44, sunLon: -175 }, // noon meridian next to the antimeridian
];

// 59.7° is Asr for New York in early September under the standard rule; 108° is
// an 18° twilight ring, which reaches past the poles and so wraps its arc
// around the antimeridian.
const THETAS = [45, 59.7, 90, 108, 110];

describe('sun altitude arcs pick a side of the noon meridian (GL-4 follow-up)', () => {
  it('keeps an east arc entirely in the afternoon hemisphere', () => {
    for (const { sunLat, sunLon } of CASES) {
      for (const theta of THETAS) {
        const pts = sunAltitudeCircle(sunDirFor(sunLat, sunLon), theta, R, 'east');
        expect(pts.length, `${sunLat}/${sunLon}/${theta}`).toBeGreaterThan(2);
        for (const p of pts) {
          if (isPole(p)) continue;
          const h = hourAngle(p, sunLon);
          // Endpoints sit on the meridian plane itself, so allow a hair of
          // floating-point slop either side of 0 and 180.
          const afternoon = h >= -1e-6 || Math.abs(Math.abs(h) - 180) < 1e-6;
          expect(afternoon, `east ${sunLat}/${sunLon}/${theta} h=${h}`).toBe(true);
        }
      }
    }
  });

  it('keeps a west arc entirely in the morning hemisphere', () => {
    for (const { sunLat, sunLon } of CASES) {
      for (const theta of THETAS) {
        const pts = sunAltitudeCircle(sunDirFor(sunLat, sunLon), theta, R, 'west');
        expect(pts.length, `${sunLat}/${sunLon}/${theta}`).toBeGreaterThan(2);
        for (const p of pts) {
          if (isPole(p)) continue;
          const h = hourAngle(p, sunLon);
          const morning = h <= 1e-6 || Math.abs(Math.abs(h) - 180) < 1e-6;
          expect(morning, `west ${sunLat}/${sunLon}/${theta} h=${h}`).toBe(true);
        }
      }
    }
  });

  it('still draws the whole circle for the terminator, which is both events', () => {
    // Sunrise and sunset really are the same line, so this pair must not be
    // halved: the arc has to reach both hemispheres.
    const pts = sunAltitudeCircle(sunDirFor(5.3, -34), 90, R, 'both');
    const angles = pts.map((p) => hourAngle(p, -34));
    expect(Math.max(...angles)).toBeGreaterThan(80);
    expect(Math.min(...angles)).toBeLessThan(-80);
    // Closed: first and last point coincide.
    expect(pts[0].distanceTo(pts[pts.length - 1])).toBeLessThan(1e-6);
  });

  it('terminates a half arc on the noon meridian, not part way round', () => {
    // The arc must run pole-to-pole across its own hemisphere and stop exactly
    // on the meridian plane — a short arc would leave the line hanging in the
    // middle of the map.
    for (const side of ['east', 'west'] as const) {
      const pts = sunAltitudeCircle(sunDirFor(5.3, -34), 59.7, R, side);
      for (const end of [pts[0], pts[pts.length - 1]]) {
        const h = Math.abs(hourAngle(end, -34));
        expect(Math.min(h, Math.abs(h - 180)), side).toBeLessThan(1e-6);
      }
      // A 59.7° ring at 5.3° declination spans latitudes -54.4..65: both
      // meridian crossings, and nothing beyond them.
      const lats = pts.map(latOf);
      expect(Math.min(...lats)).toBeCloseTo(5.3 - 59.7, 4);
      expect(Math.max(...lats)).toBeCloseTo(5.3 + 59.7, 4);
    }
  });

  it('covers a full half circle, so the two halves make the whole ring', () => {
    const east = sunAltitudeCircle(sunDirFor(5.3, -34), 59.7, R, 'east');
    const west = sunAltitudeCircle(sunDirFor(5.3, -34), 59.7, R, 'west');
    const arcLength = (pts: THREE.Vector3[]) =>
      pts.slice(1).reduce((sum, p, i) => sum + p.distanceTo(pts[i]), 0);
    const whole = arcLength(sunAltitudeCircle(sunDirFor(5.3, -34), 59.7, R, 'both'));
    expect(arcLength(east) + arcLength(west)).toBeCloseTo(whole, 1);
  });

  it('defaults to the whole circle so an unmarked caller is unchanged', () => {
    const explicit = sunAltitudeCircle(sunDirFor(5.3, -34), 90, R, 'both');
    const implicit = sunAltitudeCircle(sunDirFor(5.3, -34), 90, R);
    expect(implicit.length).toBe(explicit.length);
    implicit.forEach((p, i) => expect(p.distanceTo(explicit[i])).toBeLessThan(1e-9));
  });
});
