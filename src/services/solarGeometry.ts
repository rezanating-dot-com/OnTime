/**
 * Pure solar + geodesic math for the 3D sky dome and qibla globe.
 *
 * Deliberately free of three.js so it can be unit tested in jsdom and reused.
 * Vectors use the renderer's local frame: +x east, +y up, +z south
 * (so north is -z, matching the compass letters on the dome).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SunPosition {
  /** Unit vector towards the sun in the local frame. */
  v: Vec3;
  /** Altitude above the horizon, in radians. Negative below the horizon. */
  altitude: number;
  /** Azimuth clockwise from north, in radians. */
  azimuth: number;
}

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

export const MECCA = { latitude: 21.4225, longitude: 39.8262 };

/**
 * Day of the year, 1-366, from the local calendar date.
 * Compared in UTC so a daylight-saving shift between January and the
 * given date can't push the count off by one.
 */
export function dayOfYear(date: Date): number {
  const dayMs = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const janFirst = Date.UTC(date.getFullYear(), 0, 1);
  return Math.floor((dayMs - janFirst) / 86400000) + 1;
}

/**
 * Sun declination in degrees — the standard cosine approximation.
 * Within ~0.5° of the true value, which is far below what's visible
 * on a 200px dome.
 */
export function solarDeclination(date: Date): number {
  const n = dayOfYear(date);
  return -23.44 * Math.cos(((360 / 365) * (n + 10)) * D2R);
}

/** Decimal hours since local midnight. */
export function decimalHours(date: Date): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

/**
 * Hour angle in degrees for a moment, given the day's solar noon.
 * Negative before noon, positive after; 15° per hour.
 */
export function hourAngle(time: Date, solarNoon: Date): number {
  return (decimalHours(time) - decimalHours(solarNoon)) * 15;
}

/**
 * Local sun position for a given hour angle.
 * `latitude` and `declination` in degrees, `hourAngleDeg` in degrees.
 */
export function sunPosition(
  latitude: number,
  declination: number,
  hourAngleDeg: number
): SunPosition {
  const phi = latitude * D2R;
  const dec = declination * D2R;
  const H = hourAngleDeg * D2R;

  const altitude = Math.asin(
    Math.sin(dec) * Math.sin(phi) + Math.cos(dec) * Math.cos(phi) * Math.cos(H)
  );
  const azimuth = Math.atan2(
    -Math.sin(H) * Math.cos(dec),
    Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(H)
  );

  const rh = Math.cos(altitude);
  return {
    v: {
      x: rh * Math.sin(azimuth),
      y: Math.sin(altitude),
      z: -rh * Math.cos(azimuth),
    },
    altitude,
    azimuth,
  };
}

/**
 * Point on a sphere of radius `r` for a lat/lon in degrees.
 * Same frame as the globe: +y north pole, +x at (0°, 0°).
 */
export function latLonToVec3(latitude: number, longitude: number, r = 1): Vec3 {
  const la = latitude * D2R;
  const lo = longitude * D2R;
  return {
    x: r * Math.cos(la) * Math.cos(lo),
    y: r * Math.sin(la),
    z: -r * Math.cos(la) * Math.sin(lo),
  };
}

/** Any vector at right angles to `v`, chosen off its smallest component. */
function anyPerpendicular(v: Vec3): Vec3 {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  const axis: Vec3 =
    ax <= ay && ax <= az ? { x: 1, y: 0, z: 0 } : ay <= az ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  return {
    x: v.y * axis.z - v.z * axis.y,
    y: v.z * axis.x - v.x * axis.z,
    z: v.x * axis.y - v.y * axis.x,
  };
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Angle between two lat/lon points as seen from the centre of the earth, in degrees. */
export function angularSeparation(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): number {
  const a = normalize(latLonToVec3(from.latitude, from.longitude));
  const b = normalize(latLonToVec3(to.latitude, to.longitude));
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  return Math.acos(dot) * R2D;
}

/**
 * Points along the great-circle arc between two lat/lon pairs, as unit
 * vectors scaled to `radius`. Uses slerp so the arc stays on the sphere
 * even for near-antipodal endpoints, where a lerp would collapse.
 */
export function greatCircleArc(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  segments = 128,
  radius = 1
): Vec3[] {
  const a = normalize(latLonToVec3(from.latitude, from.longitude));
  const b = normalize(latLonToVec3(to.latitude, to.longitude));

  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);

  // Antipodal endpoints have infinitely many great circles between them and
  // slerp is undefined, so pick one: sweep half a turn through an arbitrary
  // perpendicular. Coincident endpoints just repeat the point.
  const degenerate = sinOmega < 1e-6;
  const perp = degenerate && dot < 0 ? normalize(anyPerpendicular(a)) : null;

  const out: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    let p: Vec3;
    if (perp) {
      const c = Math.cos(t * Math.PI);
      const s = Math.sin(t * Math.PI);
      p = {
        x: a.x * c + perp.x * s,
        y: a.y * c + perp.y * s,
        z: a.z * c + perp.z * s,
      };
    } else if (degenerate) {
      p = a;
    } else {
      const k1 = Math.sin((1 - t) * omega) / sinOmega;
      const k2 = Math.sin(t * omega) / sinOmega;
      p = {
        x: a.x * k1 + b.x * k2,
        y: a.y * k1 + b.y * k2,
        z: a.z * k1 + b.z * k2,
      };
    }
    out.push({ x: p.x * radius, y: p.y * radius, z: p.z * radius });
  }
  return out;
}

/**
 * The sun's track across the whole day, split at the horizon.
 * `above` is the daylight arc, `below` the night portion.
 */
export function sunPath(
  latitude: number,
  declination: number,
  stepDeg = 1
): { above: Vec3[]; below: Vec3[] } {
  const above: Vec3[] = [];
  const below: Vec3[] = [];
  for (let H = -180; H <= 180; H += stepDeg) {
    const { v, altitude } = sunPosition(latitude, declination, H);
    (altitude >= 0 ? above : below).push(v);
  }
  return { above, below };
}

/**
 * The lat/lon currently directly under the sun. Ignores the equation of
 * time (up to ~16 min real-world skew) — invisible on a globe this size,
 * and it keeps the function a one-liner off the UTC clock.
 */
export function subSolarPoint(date: Date): { latitude: number; longitude: number } {
  const latitude = solarDeclination(date);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const longitude = normalizeLongitude(-(utcHours - 12) * 15);
  return { latitude, longitude };
}

function normalizeLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}
