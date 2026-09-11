import Globe from 'globe.gl';
import type { GlobeInstance } from 'globe.gl';
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { glowSprite } from './base3d';
import {
  subSolarPoint,
  subLunarPoint,
  MECCA,
  D2R,
  type Vec3,
} from '../../services/solarGeometry';
import { PRAYER_COLORS, PRAYER_ACCENTS } from '../../utils/prayerColors';

export interface HomeGlobeData {
  now: Date;
  latitude: number;
  longitude: number;
  /** The user's prayer times, used to label the sun lines. */
  prayers: { name: string; time: Date }[];
  /** Fajr twilight angle, degrees below the horizon, per the calculation method. */
  fajrTwilightDeg: number;
  /** Isha twilight angle, or null for interval-based methods (Umm al-Qura, Qatar). */
  ishaTwilightDeg: number | null;
  /** Minutes after Maghrib that Isha falls, for those interval-based methods. */
  ishaIntervalMin?: number | null;
  /** Asr shadow factor: 1 for the standard (Shafi'i) rule, 2 for Hanafi. */
  asrShadowFactor: number;
  /** Ground-view (qibla) mode: camera drops to the user and follows the compass. */
  groundMode?: boolean;
  /** Qibla mode: the line to the Kaaba drawn on the globe, seen from orbit. */
  qiblaMode?: boolean;
  /** Device compass heading, degrees clockwise from true north (null = none). */
  deviceHeading?: number | null;
  /** Bearing to the Kaaba, degrees clockwise from true north. */
  qiblaDirection?: number;
}

// All distances are in globe-radius units (globe.gl uses a 100-unit globe).
export const GLOBE_RADIUS = 100;
const HOME_ALTITUDE = 2.5; // default framing
const FOCUS_ALTITUDE = 0.5; // "My location" fly-in
const MIN_ALTITUDE = 0.06; // pinch floor, just above the atmosphere
const MAX_DISTANCE = 3500;
// Camera depth range, sized to the scene rather than to globe.gl's default
// (skyRadius * 2.5 = 125000). The farthest thing here is the starfield at
// STAR_RADIUS 4000 and the camera never backs off past
// MAX_DISTANCE + GLOBE_RADIUS = 3600, so 9000 covers it with room to spare.
//
// This is scene hygiene, not a precision fix — a note worth leaving because
// the obvious reading is wrong. For a 24-bit buffer the resolvable depth step
// at distance u is (far-near)*u^2 / (far*near*2^24), and since far >> near
// that reduces to u^2 / (near * 2^24): the far plane barely enters into it
// (0.99997 vs 0.99989 of the same step at 30000 and at 9000). The lever is
// `near`, and near is pinned at 1 by the pinch floor — minDistance is
// GLOBE_RADIUS * 1.06 = 106, with pins and prayer-line labels sitting out at
// radius ~101-105, so anything larger clips them at full zoom-in.
//
// The consequence is a known limitation: the step reaches ~0.73 units at
// maxDistance, coarser than the 0.2-unit gap BASE_SPHERE_SCALE keeps between
// the base sphere and the tile shell, so the Blue Marble can in principle
// z-fight back through the tiles when pinched right out. The globe is a few
// pixels across at that distance. Fixing it properly means a logarithmic
// depth buffer, which is a rendering-pipeline change (the prayer lines are
// Line2) that needs a device to verify.
const CAMERA_NEAR = 1;
const CAMERA_FAR = 9000;

// NASA Blue Marble (public domain), bundled so the globe always has a complete
// earth under the streamed tiles — including on a cold start and offline.
const BASE_EARTH_TEXTURE_URL = '/earth-base.jpg';
// See prepareBaseMaterial(): the base sphere sits just inside the tile shell.
const BASE_SPHERE_SCALE = 0.998;
// How many frames ensureBaseSetup() will wait for globe.gl's deferred init.
// It lands on the next tick in practice; this is only a stop condition.
const BASE_SETUP_MAX_FRAMES = 120;

// How long the render loop keeps running after something changes the scene,
// before it parks again. The initial one is longer to cover the first wave of
// surface tiles, which arrive well after onGlobeReady.
const INITIAL_SETTLE_MS = 4000;
const SETTLE_MS = 1200;
// Surface tiles start once the base texture is applied; this caps the wait.
const TILE_ENABLE_FALLBACK_MS = 2500;
// Esri World Imagery. Also matched against loading-manager URLs to tell a
// surface tile apart from the app's own textures.
const TILE_HOST = 'server.arcgisonline.com';

/**
 * How much detail the bundled photo carries, in the tile engine's own units.
 *
 * A slippy level L wraps 256 * 2^L pixels around the equator, so a photo of
 * width W is worth level log2(W / 256). Derived rather than written down: a
 * constant that has to be kept in step with an image file by hand is a
 * constant that drifts.
 */
const BASE_TEXTURE_WIDTH = 4096;
const BASE_TEXTURE_LEVEL = Math.log2(BASE_TEXTURE_WIDTH / 256);

/**
 * The altitude below which streamed tiles are worth having.
 *
 * The engine picks level L while `8 / 2^L <= altitude < 8 / 2^(L-1)`, so the
 * first level carrying *more* detail than the photo only arrives below this.
 * Above it the stream was painting a coarser image over a finer one — at the
 * default framing of 2.5 it fetched level 2, a thousand pixels around the
 * equator, over a photo worth four thousand. That is what "the map goes low
 * res when I zoom out" was.
 */
const TILE_ENABLE_ALTITUDE = 8 / 2 ** BASE_TEXTURE_LEVEL;
/** Turn the stream back off a little higher than it came on, so a pinch that
 *  hovers on the boundary cannot flap it. */
const TILE_DISABLE_ALTITUDE = TILE_ENABLE_ALTITUDE * 1.4;

/**
 * three-slippy-map-globe loads its surface tiles through a bare TextureLoader,
 * so they report to THREE.DefaultLoadingManager — a single global slot with no
 * way to inject a manager of our own.
 *
 * Saving and restoring that slot per instance corrupts the moment two globes
 * overlap: the first to dispose restores the original and silently discards
 * the second's live handler, and the second then restores the *first's*,
 * leaving the global manager owned by a disposed scene and retaining its whole
 * object graph. Only one <HomeGlobeView> exists today and StrictMode's
 * double-invoke is sequential, so that is a trap rather than a live bug — but
 * it is a cheap one to close.
 *
 * So hook the slot once, for as long as anyone is listening, and hand out
 * subscriptions instead.
 */
interface TileLoadListener {
  onTileProgress: (url: string, loaded: number, total: number) => void;
  onAllLoaded: () => void;
}

const tileLoadListeners = new Set<TileLoadListener>();
let prevManagerOnLoad: (() => void) | undefined;
let prevManagerOnProgress: ((url: string, loaded: number, total: number) => void) | undefined;

function addTileLoadListener(listener: TileLoadListener): void {
  if (tileLoadListeners.size === 0) {
    prevManagerOnLoad = THREE.DefaultLoadingManager.onLoad;
    prevManagerOnProgress = THREE.DefaultLoadingManager.onProgress;
    THREE.DefaultLoadingManager.onProgress = (url, loaded, total) => {
      prevManagerOnProgress?.(url, loaded, total);
      // Copy: a listener may dispose its globe from inside the callback.
      for (const l of [...tileLoadListeners]) l.onTileProgress(url, loaded, total);
    };
    THREE.DefaultLoadingManager.onLoad = () => {
      prevManagerOnLoad?.();
      for (const l of [...tileLoadListeners]) l.onAllLoaded();
    };
  }
  tileLoadListeners.add(listener);
}

function removeTileLoadListener(listener: TileLoadListener): void {
  if (!tileLoadListeners.delete(listener)) return;
  if (tileLoadListeners.size > 0) return;
  THREE.DefaultLoadingManager.onLoad = prevManagerOnLoad as () => void;
  THREE.DefaultLoadingManager.onProgress = prevManagerOnProgress as (
    url: string, loaded: number, total: number,
  ) => void;
  prevManagerOnLoad = undefined;
  prevManagerOnProgress = undefined;
}
// Longest the loader holds waiting for the first wave of tiles before
// revealing whatever is there — offline, or a network too slow to wait on.
const FIRST_TILES_MAX_WAIT_MS = 3000;

const SUN_ALTITUDE = 20;
const MOON_ALTITUDE = 20;
const SUN_RADIUS = 40;
const MOON_RADIUS = 34;
const SUN_HALO = 240;
const MOON_HALO = 170;
const SUN_COLOR = '#fff4d6';
const MOON_COLOR = '#d9d4ca';
/**
 * Equirectangular lunar surface texture, bundled with the app.
 *
 * NASA imagery, via the three.js examples (MIT). It used to be hotlinked from
 * threejs.org at runtime, which meant a network dependency on a third party's
 * example CDN for a decorative texture — invisible to the privacy policy, and
 * a flat white disc on first launch offline.
 */
const MOON_TEXTURE_URL = '/moon.jpg';
/** Camera distance from the moon's centre when you tap to zoom into it. */
const MOON_VIEW_DISTANCE = 150;
const MOON_FLY_DURATION_MS = 1100;
/** A tap (not a drag) must move less than this and finish within this time. */
const TAP_MOVE_THRESHOLD_PX = 8;
const TAP_TIME_THRESHOLD_MS = 400;

const STAR_COUNT = 1400;
const STAR_RADIUS = 4000;

const PIN_SIZE_PX = 50; // on-screen diameter of the location marker
const PIN_COLOR = '#4285F4';

/** Radius of the sun-position lines, just above the surface tiles. */
const SUN_LINE_ALTITUDE = 0.006;
/** Ground-view camera altitude (low, just above the qibla line) and line radius. */
const GROUND_ALTITUDE = 0.002;
const GROUND_LINE_ALTITUDE = 0.0015;
const GROUND_LINE_WIDTH_PX = 6;
/** The 3D Kaaba endpoint, raised and scaled so it reads as a landmark. */
const KAABA_ALTITUDE = 0.05;
const KAABA_SCALE = 2.2;
/** The same Kaaba seen from orbit rather than from the ground beside it. At
 *  the ground-view scale it is a speck a few pixels across. */
const KAABA_ORBIT_SCALE = 9;
/**
 * How far up the screen the ends of the line are allowed to reach, as a
 * fraction of the distance from the middle to the edge. Kept well short of 1:
 * the countdown sits over the top of the globe and the compass guidance over
 * the bottom, and an end tucked behind either of those is an end you cannot
 * see. Leaving the margin in degrees of the Earth's surface instead does
 * almost nothing, because a point that far round is already near the limb and
 * its position on screen barely moves.
 */
const QIBLA_FRAME_FILL = 0.65;
/** Never closer than this, or a short line fills the screen and reads as a map. */
const QIBLA_MIN_FRAME_ALTITUDE = 1;
/** Never further than this, or the globe is a marble and the line is a hair. */
const QIBLA_MAX_FRAME_ALTITUDE = 3.2;
const GROUND_FLY_DURATION_MS = 900;
/** Ground camera looks slightly down (tan of the pitch angle, ~12°). */
const GROUND_PITCH = 0.21;
/** Sun angular distance from the sub-solar point for each solar event.
   Only the terminator is a constant: the Fajr/Isha and Asr rings depend on the
   calculation method, the Asr madhab and the user's latitude, so they are
   derived per rebuild — see twilightRingDeg() and asrRingDeg(). */
const HORIZON_ANGLE_DEG = 90; // sunrise / sunset (sun on the horizon)
/** Latitude offset that keeps neighbouring labels apart at the limb. */
const LABEL_STAGGER_DEG = 18;
// Solar lines are drawn as fat lines (Line2): WebGL ignores LineBasicMaterial's
// linewidth, so a plain THREE.Line is always one device pixel — a third of a
// CSS pixel on a 3x phone, which is what made these read as hairlines. One
// width for all of them, in CSS pixels: the thinner twilight and asr rings
// read as lesser lines rather than as a deliberate hierarchy.
const SOLAR_LINE_WIDTH_PX = 5;

// Shared with the globe HUD so the accent beside a prayer's name and its line
// on the earth are the same colour.
// One full circle serves the sunrise/sunset pair — the terminator is both.
// Every other ring is drawn as a half arc, morning or evening, because the
// circle's other half is the same sun altitude at the mirrored time of day and
// no prayer sits there: a whole Asr circle laid a green "Asr" line across
// mid-morning. So Fajr takes the western half and Isha the eastern half of the
// twilight ring — one circle's worth when the method gives them the same angle,
// two when it does not — Asr the eastern half of its own, plus the noon
// meridian for Dhuhr.
const FAJR_COLOR = PRAYER_COLORS.fajr;
const SUNRISE_COLOR = PRAYER_COLORS.sunrise;
const NOON_COLOR = PRAYER_COLORS.dhuhr;
const ASR_COLOR = PRAYER_COLORS.asr;
const ISHA_COLOR = PRAYER_COLORS.isha;

const NIGHT_SHADE_ALTITUDE = 0.005;


const v3 = (p: Vec3 | { x: number; y: number; z: number }) =>
  new THREE.Vector3(p.x, p.y, p.z);

/** World up. Shared read-only reference; never mutated. */
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** three-globe's lat/lng → cartesian convention (lon 0 on +z). */
export function geo2xyz(lat: number, lon: number, r: number): { x: number; y: number; z: number } {
  const phi = (90 - lat) * D2R;
  const theta = (90 - lon) * D2R;
  const s = Math.sin(phi);
  return { x: r * s * Math.cos(theta), y: r * Math.cos(phi), z: r * s * Math.sin(theta) };
}

/** The inverse of geo2xyz, for a vector that is already a unit vector.
 *  Longitude comes back in the usual -180..180, not the 0..360 the raw
 *  arithmetic gives. */
function xyz2geo(v: THREE.Vector3): { lat: number; lon: number } {
  const phi = Math.acos(Math.min(1, Math.max(-1, v.y)));
  const theta = Math.atan2(v.z, v.x);
  return { lat: 90 - phi / D2R, lon: ((90 - theta / D2R + 540) % 360) - 180 };
}

/**
 * Angular distance from the sub-solar point of the ring on which the sun sits
 * `degBelowHorizon` under the horizon. Fajr and Isha both live on such a ring,
 * at whatever depression the selected calculation method specifies.
 */
function twilightRingDeg(degBelowHorizon: number): number {
  return 90 + degBelowHorizon;
}

/**
 * Where an interval-based Isha falls on the globe.
 *
 * Umm al-Qura and Qatar put Isha at Maghrib plus a fixed number of minutes, so
 * there is no sun altitude to build a ring from — no depression angle exists
 * to be on. But the places where it is Isha right now are exactly the places
 * where the sun set that many minutes ago, so the line is the terminator as it
 * stood then: the same circle, drawn around where the sun was. The Earth turns
 * 15 degrees an hour, so that is a quarter of a degree of sub-solar longitude
 * per minute, eastward of where the sun is now.
 *
 * Returns the sub-solar longitude to draw that terminator around.
 */
export function intervalIshaSunLon(sunLon: number, intervalMinutes: number): number {
  return sunLon + intervalMinutes / 4;
}

/**
 * Angular distance from the sub-solar point of the ring on which the sun
 * reaches its Asr altitude.
 *
 * Asr is when a shadow reaches `shadowFactor` times the object's length on top
 * of its noon length, i.e. sun altitude arccot(shadowFactor + tan|φ − δ|) for
 * latitude φ and solar declination δ. That is 45° only in the special case of
 * the standard rule at a latitude the sun is directly over — so a single
 * hard-coded ring was wrong for essentially every user, and wronger still for
 * Hanafi, whose factor of 2 puts Asr at a much lower sun.
 */
function asrRingDeg(latitude: number, declination: number, shadowFactor: number): number {
  // Clamped at 90°: past that the sun never rises, tan() goes negative and the
  // shadow formula leaves its domain, which would put the ring on the far side
  // of the globe. Asr degenerates to the horizon there instead. At exactly 90°
  // tan() is finite but enormous, so the altitude collapses to 0 cleanly.
  const zenithGap = Math.min(Math.abs(latitude - declination), 90);
  const altitudeDeg = Math.atan(1 / (shadowFactor + Math.tan(zenithGap * D2R))) / D2R;
  return 90 - altitudeDeg;
}

/**
 * Points along the circle where the sun sits at a given altitude: the angular
 * distance from the sub-solar point is `thetaDeg` (90° = horizon/terminator,
 * 90° + the twilight angle = fajr/isha, 90° − the Asr altitude = Asr).
 *
 * `side` picks a half. The sun passes every altitude twice a day — climbing in
 * the morning, falling in the afternoon — so the full circle holds both
 * moments: its western half is the morning one and its eastern half the
 * afternoon one. Only the terminator has a prayer on each ('both'); every other
 * ring must be halved, or it draws its prayer's line over longitudes that are
 * at the mirrored time of day. See rebuildPrayerLines.
 */
export function sunAltitudeCircle(
  sunDir: THREE.Vector3,
  thetaDeg: number,
  radius: number,
  side: 'both' | 'east' | 'west' = 'both',
  segments = 128
): THREE.Vector3[] {
  const up = Math.abs(sunDir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(sunDir, up).normalize();
  const v = new THREE.Vector3().crossVectors(sunDir, u).normalize();
  const theta = thetaDeg * D2R;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  // `u` is the normal of the plane through the sub-solar point and both poles —
  // the noon meridian — so cos(a) alone says which side of noon a point is on,
  // whatever the ring's radius or the sun's declination. cos(a) > 0 puts the
  // point at negative hour angle (morning/west); the half arcs are swept
  // between the two cos(a) = 0 crossings so each one *ends* on that meridian
  // rather than stopping part way round. Sweeping the range beats filtering the
  // full circle: the kept points there wrap the array ends and the line closes
  // itself with a chord straight across the globe.
  const HALF = Math.PI / 2;
  const from = side === 'east' ? HALF : side === 'west' ? -HALF : 0;
  const span = side === 'both' ? Math.PI * 2 : Math.PI;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = from + (i / segments) * span;
    pts.push(
      new THREE.Vector3()
        .addScaledVector(sunDir, c * radius)
        .addScaledVector(u, s * Math.cos(a) * radius)
        .addScaledVector(v, s * Math.sin(a) * radius)
    );
  }
  return pts;
}

/** Points along the meridian at a fixed longitude, pole to pole. */
function meridianPoints(lon: number, radius: number, segments = 64): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const lat = -90 + (i / segments) * 180;
    const p = geo2xyz(lat, lon, radius);
    pts.push(new THREE.Vector3(p.x, p.y, p.z));
  }
  return pts;
}

/**
 * Where a sun line's label sits: the point on that circle at a chosen latitude,
 * on the morning (west, -1) or evening (east, +1) side.
 *
 * Fajr and sunrise are only 18° of longitude apart, and both land out near the
 * limb where the sphere squashes longitude to almost nothing on screen, so
 * their labels collided (maghrib and isha likewise). Latitude does not compress
 * that way, so they are staggered vertically — and solved for properly rather
 * than nudged, so each label still lands on its own circle. Null when the sun
 * is too far north or south for the circle to reach that latitude at all.
 */
function labelPoint(sunLat: number, sunLon: number, thetaDeg: number, targetLat: number, side: 1 | -1) {
  const theta = thetaDeg * D2R;
  const sl = sunLat * D2R;
  const tl = targetLat * D2R;
  const cos = (Math.cos(theta) - Math.sin(sl) * Math.sin(tl)) / (Math.cos(sl) * Math.cos(tl));
  if (!Number.isFinite(cos) || Math.abs(cos) > 1) return null;
  return { lat: targetLat, lon: sunLon + side * (Math.acos(cos) / D2R) };
}

/**
 * A small world-scaled text label for a sun line, drawn on its own dark pill.
 *
 * These labels ride the equator, so some sit on sunlit cloud and ice (Dhuhr,
 * Asr) and others on the night side (Fajr, Isha) — no single text colour is
 * legible on both, and a soft drop shadow over white cloud just turned to
 * mush. The pill gives every label the same dark ground to sit on, which is
 * what map labels do, and lets the text keep the prayer's own hue.
 */
function prayerLabelSprite(text: string, color: string): THREE.Sprite {
  const px = 30;
  const padX = 16;
  const padY = 11;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d')!;
  measure.font = `500 ${px}px Ubuntu, system-ui, sans-serif`;
  const w = Math.ceil(measure.measureText(text).width);
  canvas.width = w + padX * 2;
  canvas.height = px + padY * 2;
  const ctx = canvas.getContext('2d')!;

  const r = canvas.height / 2;
  ctx.fillStyle = 'rgba(4,7,14,0.66)';
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, r);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.font = `500 ${px}px Ubuntu, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, padX, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // depthTest off so a label overhanging the globe is not sliced by it; the
  // far side is culled by hand instead (see updateLabelAnchors).
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
  );
  sp.renderOrder = 6;
  const worldHeight = 8; // the pill's padding is inside this, so a touch taller
  sp.scale.set((canvas.width / canvas.height) * worldHeight, worldHeight, 1);
  return sp;
}

/** The Kaaba as a 3D model (mirrors the KaabaMini card's geometry). */
function buildKaabaModel(): THREE.Group {
  const g = new THREE.Group();
  const kiswah = new THREE.MeshStandardMaterial({ color: '#131316', roughness: 0.72, metalness: 0.12 });
  const gold = new THREE.MeshStandardMaterial({ color: '#C8954C', roughness: 0.3, metalness: 0.85 });
  const stone = new THREE.MeshStandardMaterial({ color: '#2a2e38', roughness: 0.9, metalness: 0.05 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1.12, 1), kiswah);
  body.position.y = 0.62;
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.015, 0.13, 1.015), gold);
  band.position.y = 0.92;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.52, 0.02), gold);
  door.position.set(0.16, 0.5, 0.511);
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.12, 1.34), stone);
  g.add(body, band, door, base);
  return g;
}

/** A small "you are here" marker: blue dot with a thin white ring. */
function locationMarkerTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const r = size / 2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(r, r, r - 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PIN_COLOR;
  ctx.beginPath();
  ctx.arc(r, r, r - 18, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const NIGHT_VERTEX_SHADER = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NIGHT_FRAGMENT_SHADER = `
  uniform vec3 sunDirection;
  varying vec3 vNormal;
  void main() {
    float ndotl = dot(normalize(vNormal), normalize(sunDirection));
    float daylight = smoothstep(-0.08, 0.18, ndotl);
    gl_FragColor = vec4(0.0, 0.0, 0.0, (1.0 - daylight) * 0.88);
  }
`;

const MOON_FRAGMENT_SHADER = `
  uniform sampler2D moonMap;
  uniform vec3 sunDirection;
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vec4 moon = texture2D(moonMap, vUv);
    float ndotl = dot(normalize(vNormal), normalize(sunDirection));
    float light = smoothstep(-0.28, 0.28, ndotl);
    gl_FragColor = vec4(moon.rgb * mix(0.05, 1.0, light), 1.0);
  }
`;

const SURFACE_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Full-page ambient globe for the Home screen, built on globe.gl's tile
 * engine (Esri World Imagery). Layered on top of the globe: a real day/night
 * terminator, the sun and moon positioned from actual ephemeris, a location
 * and pin. The camera always aims at the user's
 * coordinates, with "My location" flying closer.
 */
export class HomeGlobe {
  onAdjustedChange?: (adjusted: boolean) => void;
  onGroundModeChange?: (on: boolean) => void;

  private host: HTMLElement;
  private data: HomeGlobeData;
  private globe!: GlobeInstance;
  private ready = false;
  private disposed = false;
  private adjusted = false;
  private homePov = { lat: 0, lng: 0, altitude: HOME_ALTITUDE };

  private starfield!: THREE.Points;
  private nightShade!: THREE.Mesh;
  private nightMaterial!: THREE.ShaderMaterial;
  private sun!: THREE.Mesh;
  private sunHalo!: THREE.Sprite;
  private moon!: THREE.Mesh;
  private moonHalo!: THREE.Sprite;
  private moonMaterial!: THREE.ShaderMaterial;
  private pin!: THREE.Sprite;

  // Tap-to-zoom on the moon
  private raycaster = new THREE.Raycaster();
  private pointerDown = { x: 0, y: 0, t: 0 };
  private moonFlyAnim: {
    start: number;
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
  } | null = null;

  private moonRot = new THREE.Quaternion();
  private moonLocked = false;
  private moonSurfaceTexture?: THREE.Texture;
  private worldSunDir = new THREE.Vector3(0, 0, 1);
  private dragStart = { x: 0, y: 0, active: false };
  private idlePauseTimer?: ReturnType<typeof setTimeout>;
  /** Sun-position lines (terminator + noon meridian) and their labels. */
  private prayerLinesGroup!: THREE.Group;
  /** Ground-view qibla line + Kaaba marker. */
  private groundGroup!: THREE.Group;
  private groundLineMaterial?: LineMaterial;
  /** Live solar-line materials, so resize() can refresh their pixel widths. */
  private prayerLineMaterials: LineMaterial[] = [];
  private inGroundMode = false;
  private inQiblaMode = false;
  /** Low-pass filtered compass heading (deg) to damp jitter. */
  private smoothHeading = -1;
  private groundFlyAnim: { start: number; from: THREE.Vector3; to: THREE.Vector3 } | null = null;



  private ro?: ResizeObserver;
  private io?: IntersectionObserver;
  private onVisibility = () => this.syncLoop();
  /** Set once a surface tile image has come through the loading manager. */
  private sawTileTexture = false;
  /** Surface tiles load through three's default manager (three-slippy-map-globe
   *  uses a bare TextureLoader), and they arrive long after the camera stopped
   *  moving. With the loop parking when idle, a tile landing after the park
   *  would never be drawn — so render once more whenever loading goes quiet. */
  private tileLoadListener: TileLoadListener = {
    onTileProgress: (url) => {
      if (typeof url === 'string' && url.includes(TILE_HOST)) this.sawTileTexture = true;
    },
    onAllLoaded: () => {
      this.enableTilesOnceBaseIsUp();
      // Hold the loader until surface tiles have actually landed, not merely
      // until the base texture is on: enabling the tile engine is what starts
      // the tile fetch, so revealing there uncovers a globe that then visibly
      // fills in tile by tile. This drains once the first wave is in.
      if (this.tilesEnabled && this.sawTileTexture) this.fireSurfaceReady();
      this.renderThenSettle();
    },
  };

  constructor(host: HTMLElement, data: HomeGlobeData) {
    this.host = host;
    this.data = data;
  }

  mount(): void {
    this.homePov = { lat: this.data.latitude, lng: this.data.longitude, altitude: HOME_ALTITUDE };

    // Start the webfont load before anything else. Canvas text is baked at draw
    // time and the prayer labels are drawn during onGlobeReady, so loading in
    // parallel with the base texture usually gets them the real face first time
    // instead of needing the redraw this arranges.
    this.redrawLabelsWhenFontsLoad();

    this.globe = new Globe(this.host, {
      rendererConfig: { alpha: true, antialias: true },
      // three-globe's default intro scales the globe up from nothing and spins
      // it for 1.2s on every mount — on a cold start (and on every return from
      // an overlay) that reads as the globe being "rebuilt". Tiles come from
      // the on-disk cache in well under a second, so just show it.
      animateIn: false,
    })
      .backgroundColor('rgba(0,0,0,0)')
      // The tile engine parks an opaque black sphere just under the surface at
      // any level > 0, and only adds a tile once its image has downloaded — so
      // without a base texture every un-loaded tile reads as a black hole while
      // the mosaic streams in. Bundled (and preloaded from index.html) so it is
      // decoded before the globe mounts and still works offline. The tile
      // engine itself is switched on in
      // enableTilesOnceBaseIsUp(): started together, the tile flood (hundreds
      // of decodes + GPU uploads) lands ahead of the base and the globe sits
      // black for the first half second of every cold start.
      .globeImageUrl(BASE_EARTH_TEXTURE_URL)
      .showAtmosphere(true)
      .atmosphereColor('#4d7fbf')
      .atmosphereAltitude(0.12);
    // Safety net: never leave the surface tile-less if the base somehow fails
    // — but only where tiles would actually be an improvement.
    setTimeout(() => this.syncTileEngine(), TILE_ENABLE_FALLBACK_MS);

    const controls = this.globe.controls();
    controls.autoRotate = false;
    controls.enablePan = false;
    controls.rotateSpeed = 0.9;
    controls.zoomSpeed = 0.8;
    controls.minDistance = GLOBE_RADIUS * (1 + MIN_ALTITUDE);
    controls.maxDistance = MAX_DISTANCE;
    controls.addEventListener('start', () => {
      this.wake();
      this.markAdjusted(true);
    });
    controls.addEventListener('end', () => this.scheduleIdlePause(1500));
    // Every camera move, not just onZoom: onZoom does not fire for a
    // programmatic pointOfView, and the tile gate must not depend on which way
    // the camera was moved. Both checks are two comparisons.
    controls.addEventListener('change', () => this.syncTileEngine());

    this.globe.onGlobeReady(() => {
      if (this.disposed) return;
      this.ready = true;
      this.ensureBaseSetup();
      this.enableTilesOnceBaseIsUp();
      this.buildExtras();
      // Aim the camera before the first paint so the surface tiles load
      // around the user rather than the globe's default (0,0) point.
      this.globe.pointOfView({ lat: this.data.latitude, lng: this.data.longitude, altitude: HOME_ALTITUDE }, 0);
      this.applyKey = this.computeApplyKey(this.data);
      this.applyData();
      this.updateZoomFades();
      // Nothing animates on its own in orbit view (no auto-rotate; sun and moon
      // move once a minute), so park the render loop once the opening tiles
      // have had time to land. Without this the loop only ever idles after an
      // interaction, and an untouched globe renders at full rate forever.
      this.renderThenSettle(INITIAL_SETTLE_MS);
    });

    this.globe.onZoom(() => {
      this.updateZoomFades();
      this.syncTileEngine();
    });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.host);
    this.resize();

    this.io = new IntersectionObserver(
      ([entry]) => {
        const hasArea = entry.boundingClientRect.width > 0 && entry.boundingClientRect.height > 0;
        if (entry.isIntersecting || !hasArea) this.syncLoop();
        else this.globe.pauseAnimation();
      },
      { threshold: 0 }
    );
    this.io.observe(this.host);

    document.addEventListener('visibilitychange', this.onVisibility);
    addTileLoadListener(this.tileLoadListener);
    this.syncLoop();

    // Tap (not drag) detection for tap-to-zoom on the moon. Named handlers,
    // held on a field, so dispose() can actually take them off again — as
    // anonymous closures nothing could remove them, and the canvas kept the
    // whole HomeGlobe alive for as long as anything still referenced it.
    this.canvas = this.globe.renderer().domElement;
    this.canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
    this.canvas.addEventListener('pointermove', this.onCanvasPointerMove);
    this.canvas.addEventListener('pointerup', this.onCanvasPointerUp);
  }

  private canvas?: HTMLCanvasElement;

  private onCanvasPointerDown = (e: PointerEvent) => {
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.dragStart = { x: e.clientX, y: e.clientY, active: this.moonLocked };
    if (this.moonLocked) this.wake();
  };

  private onCanvasPointerMove = (e: PointerEvent) => {
    if (!this.dragStart.active || !this.moonLocked) return;
    this.wake();
    const dx = e.clientX - this.dragStart.x;
    const dy = e.clientY - this.dragStart.y;
    this.dragStart.x = e.clientX;
    this.dragStart.y = e.clientY;
    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * 0.005)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -dy * 0.005));
    this.moonRot.premultiply(q);
    this.applyMoonRotation();
  };

  private onCanvasPointerUp = (e: PointerEvent) => {
    this.dragStart.active = false;
    const dx = e.clientX - this.pointerDown.x;
    const dy = e.clientY - this.pointerDown.y;
    const dt = performance.now() - this.pointerDown.t;
    if (Math.hypot(dx, dy) > TAP_MOVE_THRESHOLD_PX || dt > TAP_TIME_THRESHOLD_MS) {
      if (this.moonLocked) this.scheduleIdlePause(1500);
      return;
    }
    this.handleTap(e);
  };

  update(data: HomeGlobeData): void {
    this.data = data;
    if (!this.ready) return;
    const wantQibla = !!data.qiblaMode && !data.groundMode;
    if (wantQibla !== this.inQiblaMode) {
      if (wantQibla) this.enterQiblaMode();
      else this.exitQiblaMode();
    }
    const wantGround = !!data.groundMode;
    if (wantGround !== this.inGroundMode) {
      if (wantGround) this.enterGroundMode();
      else this.exitGroundMode();
    }
    if (this.inGroundMode) this.updateGroundView();
    // The sun, moon and prayer lines move with time and place — not with
    // compass headings or the parent's per-second countdown re-renders.
    // Skip the full reapply (four line geometries + six canvas label
    // textures + the lunar ephemeris) unless one of those actually changed.
    const key = this.computeApplyKey(data);
    if (key !== this.applyKey) {
      this.applyKey = key;
      this.applyData();
      // The scene changed while the loop may be parked — render it, then park
      // again. Skipping this leaves the minute tick invisible until the user
      // next touches the globe.
      this.renderThenSettle();
    }
  }

  private tilesEnabled = false;

  /**
   * The base sphere (the bundled earth photo) stays visible under
   * the tile mosaic (three-globe patch), so it must lose the depth test
   * wherever a tile exists. Tiles sit at exactly the same radius, and a
   * polygon offset alone still sparkled at this camera distance (24-bit depth
   * over a 1..30000 range is coarse out here), so the sphere is scaled a
   * fifth of a percent inward instead: a real geometric gap, invisible at the
   * limb, still outside the tile engine's black inner sphere at 0.99.
   *
   * Returns false if the globe object is not in the render scene yet — see
   * ensureBaseSetup(), which is what retries.
   */
  private prepareBaseMaterial(): boolean {
    const mat = this.globe?.globeMaterial() as THREE.MeshPhongMaterial | undefined;
    if (!mat) return false;
    mat.depthWrite = true;
    mat.needsUpdate = true;
    let base: THREE.Mesh | undefined;
    this.globe.scene().traverse((obj) => {
      if ((obj as THREE.Mesh).material === mat) base = obj as THREE.Mesh;
    });
    if (!base) return false;
    base.scale.setScalar(BASE_SPHERE_SCALE);
    return true;
  }

  /**
   * globe.gl applies its constructor-time props on a *debounced* update, and
   * two of them matter here: `objects([globe])` is what puts the globe object
   * into the render scene, and `skyRadius()` is what sets camera.far.
   * three-globe's onGlobeReady fires off a timer of its own, so when the base
   * texture comes back fast (cached, preloaded) it can land first — the render
   * scene is still empty, prepareBaseMaterial() has nothing to scale, and the
   * camera range set here is overwritten a tick later.
   *
   * The symptom is not subtle: the base sphere left at scale 1 is exactly
   * coincident with the tile shell, and the Blue Marble ocean z-fights up
   * through the Esri imagery as dark wedges all over the globe. So retry until
   * the globe object is actually in the scene, then assert both.
   */
  private ensureBaseSetup(attempt = 0): void {
    if (this.disposed) return;
    if (!this.prepareBaseMaterial()) {
      if (attempt < BASE_SETUP_MAX_FRAMES) {
        requestAnimationFrame(() => this.ensureBaseSetup(attempt + 1));
      }
      return;
    }
    // Reached only once the deferred update has run, so this is the last word
    // on the camera range rather than a value skyRadius will overwrite.
    const cam = this.globe.camera() as THREE.PerspectiveCamera;
    if (cam.near !== CAMERA_NEAR || cam.far !== CAMERA_FAR) {
      cam.near = CAMERA_NEAR;
      cam.far = CAMERA_FAR;
      cam.updateProjectionMatrix();
    }
    // A late fix-up has to be drawn; onGlobeReady's own render already covers
    // the first-attempt case.
    if (attempt > 0) this.renderThenSettle();
  }

  /** Fired once, on the first frame drawn with the base earth on the surface. */
  onSurfaceReady?: () => void;
  private surfaceReadyFired = false;
  /** True while a full-screen overlay hides the globe (see setCovered). */
  private covered = false;

  /**
   * A full-screen overlay (Settings, Qibla, Dashboard) now sits on top of the
   * globe instead of unmounting it, so returning is instant. While covered the
   * globe must cost nothing: the loop is parked and wake() refuses to restart
   * it. Uncovering draws one frame so any minute tick that happened
   * underneath is on screen, then parks again.
   */
  setCovered(covered: boolean): void {
    if (this.covered === covered) return;
    this.covered = covered;
    if (covered) {
      if (this.idlePauseTimer) clearTimeout(this.idlePauseTimer);
      this.globe?.pauseAnimation();
    } else {
      this.renderThenSettle();
    }
  }

  private fireSurfaceReady(): void {
    if (this.surfaceReadyFired) return;
    this.surfaceReadyFired = true;
    // Next frame, not now: the texture is on the material but not yet drawn.
    requestAnimationFrame(() => {
      if (!this.disposed) this.onSurfaceReady?.();
    });
  }

  /** Start streaming surface tiles, but only after the base earth texture is
   *  on the material — see the globeImageUrl note in mount(). */
  private enableTilesOnceBaseIsUp(): void {
    if (this.tilesEnabled || this.disposed) return;
    const mat = this.globe?.globeMaterial() as THREE.MeshPhongMaterial | undefined;
    if (!mat?.map) return;
    this.syncTileEngine();
    // At the default framing the stream stays off, so the photo *is* the
    // finished surface — nothing further is coming to wait for.
    if (!this.tilesEnabled) this.fireSurfaceReady();
  }

  /**
   * Start or stop the tile stream according to how close the camera is.
   *
   * Tiles are an improvement only below TILE_ENABLE_ALTITUDE; above it they are
   * a coarser image painted over a finer one. Running both ways matters: a
   * one-way gate would leave the first pinch-in streaming tiles for the rest of
   * the session, including back out at the default framing where they look
   * worse than the photo underneath.
   */
  private syncTileEngine(): void {
    if (this.disposed || !this.globe || !this.ready) return;
    // Measured off the camera, not read from pointOfView(). pointOfView lags
    // its own transition — driven to altitude 0.3 it still reported 2.5 a beat
    // later — and in ground view it is stale outright, because that mode moves
    // the camera by hand. The camera orbits the centre, so its distance is the
    // altitude, always current and true in every mode.
    const cam = this.globe.camera() as THREE.PerspectiveCamera;
    const altitude = cam.position.length() / GLOBE_RADIUS - 1;
    if (!this.tilesEnabled && altitude < TILE_ENABLE_ALTITUDE) this.enableTiles();
    else if (this.tilesEnabled && altitude > TILE_DISABLE_ALTITUDE) this.disableTiles();
  }

  /** Hand back the photo. three-globe hides the tile group and stops asking for
   *  tiles, so the base shows through and nothing further is requested. */
  private disableTiles(): void {
    if (!this.tilesEnabled || this.disposed || !this.globe) return;
    this.tilesEnabled = false;
    (this.globe.globeTileEngineUrl as unknown as (u: null) => void)(null);
  }

  private enableTiles(): void {
    if (this.tilesEnabled || this.disposed || !this.globe) return;
    this.tilesEnabled = true;
    // Setting the URL is what *starts* the tile fetch, so the surface is not
    // ready yet — the loader stays up until the first wave of tiles is drawn
    // (see the loading-manager hook in mount()). This caps the wait, for a
    // slow network or a cold start with nothing cached and no connection.
    setTimeout(() => this.fireSurfaceReady(), FIRST_TILES_MAX_WAIT_MS);
    this.globe.globeTileEngineUrl(
      (x, y, l) => `https://${TILE_HOST}/ArcGIS/rest/services/World_Imagery/MapServer/tile/${l}/${y}/${x}`
    );
  }

  /** Draw the change that was just applied, then let the loop idle again. */
  private renderThenSettle(ms = SETTLE_MS): void {
    this.wake();
    this.scheduleIdlePause(ms);
  }

  private applyKey = '';

  private computeApplyKey(data: HomeGlobeData): string {
    return [
      data.now.getTime(),
      data.latitude,
      data.longitude,
      data.prayers.map((p) => `${p.name}${p.time.getTime()}`).join(','),
      // The twilight and Asr rings are derived from these, so switching
      // calculation method or Asr madhab has to rebuild the lines even when
      // the resulting prayer times happen to be identical.
      data.fajrTwilightDeg,
      data.ishaTwilightDeg ?? 'no-isha-angle',
      data.ishaIntervalMin ?? 'no-isha-interval',
      data.asrShadowFactor,
    ].join('|');
  }

  /** Restore the camera's up vector to world-up and re-centre the orbit target.
   *  Ground view tilts cam.up to the local radial direction; OrbitControls uses
   *  object.up as its orbit axis, so if that tilt leaks out the whole orbit —
   *  and every pointOfView() fly-in — renders tilted or upside-down. */
  private resetOrbit(): void {
    (this.globe.camera() as THREE.PerspectiveCamera).up.set(0, 1, 0);
    this.globe.controls().target.set(0, 0, 0);
  }

  resetView(): void {
    if (this.inGroundMode) this.exitGroundMode();
    this.resetOrbit();
    this.moonFlyAnim = null;
    this.moonLocked = false;
    this.moonRot.identity();
    this.applyMoonRotation();
    if (this.moonHalo) this.moonHalo.visible = true;
    this.globe.controls().enabled = true;
    this.homePov = { lat: this.data.latitude, lng: this.data.longitude, altitude: HOME_ALTITUDE };
    this.wake();
    this.globe.pointOfView({ ...this.homePov }, 900);
    this.scheduleIdlePause(2200);
    this.markAdjusted(false);
  }

  focusOnLocation(): void {
    if (this.inGroundMode) this.exitGroundMode();
    this.resetOrbit();
    this.moonFlyAnim = null;
    this.moonLocked = false;
    this.moonRot.identity();
    this.applyMoonRotation();
    if (this.moonHalo) this.moonHalo.visible = true;
    this.globe.controls().enabled = true;
    this.wake();
    this.globe.pointOfView({ lat: this.data.latitude, lng: this.data.longitude, altitude: FOCUS_ALTITUDE }, 900);
    this.scheduleIdlePause(2200);
    this.markAdjusted(true);
  }

  /** Fly the camera out to the moon so it fills the view, then allow spinning it. */
  focusOnMoon(): void {
    if (!this.moon) return;
    (this.globe.camera() as THREE.PerspectiveCamera).up.set(0, 1, 0);
    const controls = this.globe.controls();
    const moonPos = this.moon.position.clone();
    // Camera at the moon height, offset horizontally toward Earth, so the
    // moon reads centred with north up rather than from below.
    const dir = moonPos.clone().normalize();
    const horiz = new THREE.Vector3(dir.x, 0, dir.z);
    const camDir = horiz.lengthSq() > 1e-6 ? horiz.normalize() : new THREE.Vector3(1, 0, 0);
    const camPos = moonPos.clone().addScaledVector(camDir, -MOON_VIEW_DISTANCE);
    this.moonFlyAnim = {
      start: performance.now(),
      fromPos: this.globe.camera().position.clone(),
      toPos: camPos,
      fromTarget: controls.target.clone(),
      toTarget: moonPos.clone(),
    };
    controls.enabled = false;
    this.moonRot.identity();
    this.moonLocked = true;
    this.moonHalo.visible = false;
    this.applyMoonRotation();
    this.wake();
    this.markAdjusted(true);
    this.animateMoonFly();
  }

  /** Apply the drag rotation to the moon, keeping the lit side sun-facing. */
  private applyMoonRotation(): void {
    // `moon` is only assigned in buildExtras(), which runs from onGlobeReady —
    // but the instance is handed to React the moment mount() returns, and the
    // "My location" / "Reset view" buttons sit above the loader and are
    // tappable through the whole prelude. Without this guard both handlers
    // threw before reaching pointOfView(), so the tap did nothing at all.
    // Same idiom as focusOnMoon(). buildExtras() re-applies the rotation once
    // the moon exists, so nothing is lost by skipping here.
    if (!this.moon) return;
    this.moon.setRotationFromQuaternion(this.moonRot);
    this.moonMaterial.uniforms.sunDirection.value
      .copy(this.worldSunDir)
      .applyQuaternion(this.moonRot.clone().invert());
  }

  // ── qibla mode (the line, seen from orbit) ────────────────────────────

  /**
   * The line to the Kaaba drawn across the globe you are already looking at,
   * rather than on a screen of its own. This replaced a separate Qibla page
   * that carried a second globe: a second WebGL context, its own copy of the
   * world, and around 440ms of shader building every time it was opened.
   */
  private enterQiblaMode(): void {
    this.inQiblaMode = true;
    this.buildGroundLine(KAABA_ORBIT_SCALE);
    this.groundGroup.visible = true;
    this.frameQiblaLine();
    this.renderThenSettle();
  }

  private exitQiblaMode(): void {
    this.inQiblaMode = false;
    this.groundGroup.visible = false;
    this.clearGroundLine();
    // Put the horizon back the way the rest of the globe expects it.
    this.setCameraUp(WORLD_UP);
    // Back to the framing the globe opens at, rather than leaving the user
    // parked over the middle of an arc that is no longer drawn.
    this.globe.pointOfView({ ...this.homePov }, 700);
    this.markAdjusted(false);
    this.renderThenSettle();
  }

  /**
   * Roll the camera, and tell the controls about it.
   *
   * OrbitControls works out the axis it orbits around from the camera's up
   * vector once, when it is built, and caches a pair of quaternions from it.
   * It never looks again. So rolling the camera turns the picture on screen
   * without turning the frame a drag is measured in, and the globe spins the
   * wrong way under your finger. Refreshing that cached pair is what keeps
   * the two in step.
   *
   * Reaching into the controls for it is deliberate and worth re-checking on
   * a three.js upgrade: there is no public way to say "up has changed", and
   * the alternative is a view whose gestures are reversed.
   */
  private setCameraUp(up: THREE.Vector3): void {
    const cam = this.globe.camera() as THREE.PerspectiveCamera;
    cam.up.copy(up);
    const controls = this.globe.controls() as unknown as {
      _quat?: THREE.Quaternion;
      _quatInverse?: THREE.Quaternion;
      update?: () => void;
    };
    if (controls._quat && controls._quatInverse) {
      controls._quat.setFromUnitVectors(cam.up, WORLD_UP);
      controls._quatInverse.copy(controls._quat).invert();
    }
    controls.update?.();
  }

  /**
   * Look at the middle of the line, stand the line upright on the screen, and
   * back off until both of its ends are inside the frame.
   *
   * Standing it upright is what makes this work on a phone. Held in portrait
   * the camera sees about 25 degrees either side of centre vertically and
   * only about 12 horizontally, and a line to Makkah is usually most of a
   * quarter turn of the planet. Laid across the screen it needs the camera so
   * far out that the Earth is a marble; stood on end it fits with the globe
   * still filling the frame.
   *
   * The altitude is then the projection, not the horizon. A point an angle t
   * from the point under the camera appears atan(sin t / ((1 + h) - cos t))
   * off the view axis, so the altitude that brings it to a half-angle f is
   * cos t + sin t / tan(f) - 1. Fitting to the horizon instead puts both ends
   * on the visible face and both off the sides of the screen, which is
   * exactly what the first attempt at this did.
   */
  private frameQiblaLine(): void {
    const { latitude, longitude } = this.data;
    const cam = this.globe.camera() as THREE.PerspectiveCamera;
    // The globe's own frame, since the camera lives in it.
    const a = v3(this.globe.getCoords(latitude, longitude, 1)).normalize();
    const b = v3(this.globe.getCoords(MECCA.latitude, MECCA.longitude, 1)).normalize();

    const span = a.angleTo(b);
    // Standing in Makkah: no line, so leave the framing alone.
    if (span < 1e-4) return;

    const mid = a.clone().add(b).normalize();
    // The arc lies in the plane of a and b, so its direction at the midpoint
    // is the plane's normal turned a quarter turn about the view axis.
    const normal = a.clone().cross(b).normalize();
    const along = normal.clone().cross(mid).normalize();

    const wanted = (cam.fov / 2) * QIBLA_FRAME_FILL * D2R;
    const t = span / 2;
    // Past a quarter turn the far end is behind the planet at any altitude.
    const needed = t >= 89 * D2R
      ? QIBLA_MAX_FRAME_ALTITUDE
      : Math.cos(t) + Math.sin(t) / Math.tan(wanted) - 1;
    const altitude = Math.min(QIBLA_MAX_FRAME_ALTITUDE, Math.max(QIBLA_MIN_FRAME_ALTITUDE, needed));

    // Upright before the move, so the tween lands already oriented rather than
    // rolling into place after it.
    this.setCameraUp(along);

    const geo = xyz2geo(mid);
    this.globe.pointOfView({ lat: geo.lat, lng: geo.lon, altitude }, 900);
    this.markAdjusted(true);
  }

  // ── ground view (qibla) ───────────────────────────────────────────────

  private enterGroundMode(): void {
    this.inGroundMode = true;
    this.moonFlyAnim = null;
    this.moonLocked = false;
    this.globe.controls().enabled = false;
    // The ground is only ~0.2 units below the camera — the default near plane
    // (1) would clip it, showing black. Pull the near plane in.
    const cam = this.globe.camera() as THREE.PerspectiveCamera;
    cam.near = 0.1;
    cam.updateProjectionMatrix();
    // Hide markers that don't belong (or would blow up) at ground level.
    if (this.pin) this.pin.visible = false;
    if (this.prayerLinesGroup) this.prayerLinesGroup.visible = false;
    this.smoothHeading = -1;
    this.buildGroundLine();
    this.groundGroup.visible = true;
    this.onGroundModeChange?.(true);

    const { latitude, longitude } = this.data;
    const target = v3(this.globe.getCoords(latitude, longitude, GROUND_ALTITUDE));
    this.groundFlyAnim = {
      start: performance.now(),
      from: this.globe.camera().position.clone(),
      to: target,
    };
    this.wake();
    this.animateGroundFly();
  }

  private exitGroundMode(): void {
    this.inGroundMode = false;
    this.groundFlyAnim = null;
    // Symmetric cleanup: if a moon tap snuck in during ground mode, make sure
    // we don't leave the moon lock / controls / halo in a moon-mode state.
    this.moonFlyAnim = null;
    this.moonLocked = false;
    if (this.moonHalo) this.moonHalo.visible = true;
    this.groundGroup.visible = false;
    this.clearGroundLine();
    this.globe.controls().enabled = true;
    const cam = this.globe.camera() as THREE.PerspectiveCamera;
    cam.near = CAMERA_NEAR;
    cam.up.set(0, 1, 0); // undo the ground-view radial tilt before re-enabling orbit
    cam.updateProjectionMatrix();
    if (this.pin) this.pin.visible = true;
    if (this.prayerLinesGroup) this.prayerLinesGroup.visible = true;
    this.onGroundModeChange?.(false);
    this.globe.pointOfView({ lat: this.data.latitude, lng: this.data.longitude, altitude: HOME_ALTITUDE }, 700);
    this.wake();
    this.scheduleIdlePause(2200);
  }

  private animateGroundFly(): void {
    if (!this.groundFlyAnim) return;
    const anim = this.groundFlyAnim;
    const t = Math.min(1, (performance.now() - anim.start) / GROUND_FLY_DURATION_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    const cam = this.globe.camera() as THREE.PerspectiveCamera;
    cam.position.lerpVectors(anim.from, anim.to, eased);
    this.applyGroundOrientation();
    if (t >= 1) {
      this.groundFlyAnim = null;
      this.updateGroundView();
    } else {
      requestAnimationFrame(() => this.animateGroundFly());
    }
  }

  // Scratch vectors for the ground view — applyGroundOrientation runs at
  // compass rate, so no per-call allocations.
  private groundUp = new THREE.Vector3();
  private groundNorth = new THREE.Vector3();
  private groundEast = new THREE.Vector3();
  private groundFacing = new THREE.Vector3();
  private groundLookAt = new THREE.Vector3();

  /** Point the ground camera at the phone's compass heading, slightly down. */
  private applyGroundOrientation(): void {
    const cam = this.globe.camera() as THREE.PerspectiveCamera;
    const pos = cam.position;
    const up = this.groundUp.copy(pos).normalize();
    const north = this.groundNorth.set(0, 1, 0).addScaledVector(up, -up.y);
    if (north.lengthSq() < 1e-6) north.set(1, 0, 0);
    north.normalize();
    const east = this.groundEast.crossVectors(north, up).normalize();

    const raw = this.data.deviceHeading ?? 0;
    // Low-pass filter the heading (shortest-arc lerp) so the view and the line
    // swing smoothly instead of jittering with every noisy magnetometer read.
    if (this.smoothHeading < 0) this.smoothHeading = raw;
    else {
      let diff = raw - this.smoothHeading;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      this.smoothHeading = (this.smoothHeading + diff * 0.22 + 360) % 360;
    }
    const rad = this.smoothHeading * D2R;
    const facing = this.groundFacing.set(0, 0, 0).addScaledVector(north, Math.cos(rad)).addScaledVector(east, Math.sin(rad));
    cam.up.copy(up);
    this.groundLookAt.copy(pos).add(facing).addScaledVector(up, -GROUND_PITCH);
    cam.lookAt(this.groundLookAt);
  }

  /** Place the ground camera at the user's location and aim it. */
  private updateGroundView(): void {
    const { latitude, longitude } = this.data;
    const cam = this.globe.camera() as THREE.PerspectiveCamera;
    const p = this.globe.getCoords(latitude, longitude, GROUND_ALTITUDE);
    cam.position.set(p.x, p.y, p.z);
    this.applyGroundOrientation();
    // Compass events re-arm this on every reading, so the loop stays live while
    // the phone is moving and parks shortly after the readings stop.
    this.renderThenSettle();
  }

  /**
   * Draw the thick great-circle line from the user to the Kaaba, and the Kaaba
   * itself standing at the far end of it. Shared by the two ways of looking at
   * the same line: from orbit, and from the ground beside it.
   */
  private buildGroundLine(kaabaScale = KAABA_SCALE): void {
    this.clearGroundLine();
    const { latitude, longitude } = this.data;
    const radius = GLOBE_RADIUS * (1 + GROUND_LINE_ALTITUDE);

    // Slerp the unit vectors in the globe's own coordinate frame (greatCircleArc
    // lives in a different frame, so don't reuse it here) — the line hugs the
    // surface of the sphere rather than cutting a straight chord through it.
    const from = v3(this.globe.getCoords(latitude, longitude, 1)).normalize();
    const to = v3(this.globe.getCoords(MECCA.latitude, MECCA.longitude, 1)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(from, to);
    const identity = new THREE.Quaternion();
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 256; i++) {
      const qi = new THREE.Quaternion().slerpQuaternions(identity, q, i / 256);
      pts.push(from.clone().applyQuaternion(qi).multiplyScalar(radius));
    }

    const geometry = new LineGeometry();
    geometry.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const material = new LineMaterial({ color: 0x22d3ee, linewidth: GROUND_LINE_WIDTH_PX, transparent: true, opacity: 0.95, depthTest: false });
    const size = this.globe.renderer().getSize(new THREE.Vector2());
    material.resolution.set(size.x, size.y);
    this.groundLineMaterial = material;
    this.groundGroup.add(new Line2(geometry, material));

    // The 3D Kaaba at the line's end point, standing on the surface at Makkah.
    const kaabaModel = buildKaabaModel();
    kaabaModel.scale.setScalar(kaabaScale);
    const kaabaPos = v3(this.globe.getCoords(MECCA.latitude, MECCA.longitude, KAABA_ALTITUDE));
    kaabaModel.position.copy(kaabaPos);
    kaabaModel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), kaabaPos.clone().normalize());
    this.groundGroup.add(kaabaModel);
  }

  private clearGroundLine(): void {
    if (!this.groundGroup) return;
    for (const obj of [...this.groundGroup.children]) {
      this.groundGroup.remove(obj);
      obj.traverse((o) => {
        const m = o as THREE.Mesh | THREE.Line;
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else (mat as THREE.Material)?.dispose();
      });
    }
    this.groundLineMaterial?.dispose();
    this.groundLineMaterial = undefined;
  }

  private tapSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), GLOBE_RADIUS);
  private tapHit = new THREE.Vector3();

  private handleTap(e: PointerEvent): void {
    if (!this.moon || this.disposed) return;
    if (this.inGroundMode || this.groundFlyAnim) return; // moon tap is a globe-mode action
    const canvas = this.globe.renderer().domElement;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.globe.camera());
    const moonHits = this.raycaster.intersectObject(this.moon);
    if (moonHits.length === 0) return;
    // Don't let a tap reach the moon through the planet: if the ray meets
    // the surface sphere first, the globe is in front of the moon.
    const surfaceHit = this.raycaster.ray.intersectSphere(this.tapSphere, this.tapHit);
    if (surfaceHit && surfaceHit.distanceTo(this.raycaster.ray.origin) < moonHits[0].distance) return;
    this.focusOnMoon();
  }

  private animateMoonFly(): void {
    if (!this.moonFlyAnim) return;
    const anim = this.moonFlyAnim;
    const t = Math.min(1, (performance.now() - anim.start) / MOON_FLY_DURATION_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    const cam = this.globe.camera() as THREE.PerspectiveCamera;
    cam.position.lerpVectors(anim.fromPos, anim.toPos, eased);
    this.globe.controls().target.lerpVectors(anim.fromTarget, anim.toTarget, eased);
    cam.lookAt(this.globe.controls().target);
    if (t >= 1) {
      this.moonFlyAnim = null;
      // Intentionally leave OrbitControls disabled: globe.gl hard-resets the
      // orbit target to the origin on its change event, so re-enabling here
      // would snap the camera back to Earth. resetView()/focusOnLocation()
      // re-enable controls when the user explicitly changes view.
      this.scheduleIdlePause(1500);
    } else {
      requestAnimationFrame(() => this.animateMoonFly());
    }
  }

  dispose(): void {
    this.disposed = true;
    this.moonFlyAnim = null;
    this.groundFlyAnim = null;
    if (this.idlePauseTimer) clearTimeout(this.idlePauseTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    removeTileLoadListener(this.tileLoadListener);
    this.canvas?.removeEventListener('pointerdown', this.onCanvasPointerDown);
    this.canvas?.removeEventListener('pointermove', this.onCanvasPointerMove);
    this.canvas?.removeEventListener('pointerup', this.onCanvasPointerUp);
    this.canvas = undefined;
    this.ro?.disconnect();
    this.io?.disconnect();
    this.globe?.pauseAnimation();
    if (this.prayerLinesGroup) {
      for (const obj of [...this.prayerLinesGroup.children]) {
        this.prayerLinesGroup.remove(obj);
        if (obj instanceof THREE.Sprite) {
          obj.material.map?.dispose();
          obj.material.dispose();
        } else {
          (obj as THREE.Line).geometry?.dispose();
          ((obj as THREE.Line).material as THREE.Material)?.dispose();
        }
      }
    }
    // clearGroundLine traverses, so the Kaaba model's meshes and materials
    // are disposed too — a shallow child loop would leak them.
    if (this.groundGroup) this.clearGroundLine();
    if (this.starfield) {
      this.starfield.geometry.dispose();
      (this.starfield.material as THREE.Material).dispose();
    }
    if (this.nightShade) {
      this.nightShade.geometry.dispose();
      this.nightMaterial.dispose();
    }
    if (this.sun) {
      this.sun.geometry.dispose();
      (this.sun.material as THREE.Material).dispose();
    }
    if (this.sunHalo) {
      (this.sunHalo.material as THREE.SpriteMaterial).map?.dispose();
      this.sunHalo.material.dispose();
    }
    if (this.moon) {
      this.moon.geometry.dispose();
      this.moonMaterial.dispose();
    }
    this.moonSurfaceTexture?.dispose();
    if (this.moonHalo) {
      (this.moonHalo.material as THREE.SpriteMaterial).map?.dispose();
      this.moonHalo.material.dispose();
    }
    if (this.pin) {
      (this.pin.material as THREE.SpriteMaterial).map?.dispose();
      this.pin.material.dispose();
    }
    this.placeholderTexture?.dispose();
    // Held before the destructor runs, because afterwards there is nothing
    // left to ask for it.
    let renderer: THREE.WebGLRenderer | undefined;
    try {
      renderer = this.globe?.renderer() as THREE.WebGLRenderer | undefined;
    } catch {
      // Nothing to release if the globe never finished building.
    }
    try {
      (this.globe as unknown as { _destructor?: () => void })._destructor?.();
    } catch {
      // The canvas removal below is enough if the internal hook is missing.
    }
    // Dropping the JavaScript objects is not enough. The WebGL context holds
    // its own allocation in the GPU driver, and on Android that allocation
    // survives every dispose above and the canvas being removed — switching
    // between the globe and the list added the globe's whole graphics cost
    // again on each switch, and never gave any of it back. Losing the context
    // is what actually hands the memory over.
    try {
      renderer?.dispose();
      renderer?.forceContextLoss();
    } catch {
      // A context already lost throws here, which is the state we wanted.
    }
    this.host.querySelectorAll('canvas').forEach((c) => c.remove());
  }

  // ── internals ────────────────────────────────────────────────────────────

  private markAdjusted(value: boolean): void {
    if (this.adjusted === value) return;
    this.adjusted = value;
    this.onAdjustedChange?.(value);
  }

  private syncLoop(): void {
    if (this.disposed || !this.globe) return;
    if (document.hidden) this.globe.pauseAnimation();
    // Coming back into view (or back to the tab) needs a frame to redraw, but
    // must not leave the loop running forever afterwards.
    else this.renderThenSettle();
  }

  /** Keep the render loop running now, and cancel any pending idle pause. */
  private wake(): void {
    if (this.disposed || !this.globe || this.covered) return;
    this.globe.resumeAnimation();
    if (this.idlePauseTimer) {
      clearTimeout(this.idlePauseTimer);
      this.idlePauseTimer = undefined;
    }
  }

  /** Pause the render loop once the view has been idle for `ms`. */
  private scheduleIdlePause(ms: number): void {
    if (this.disposed) return;
    if (this.idlePauseTimer) clearTimeout(this.idlePauseTimer);
    this.idlePauseTimer = setTimeout(() => {
      if (this.disposed || this.moonFlyAnim || this.groundFlyAnim) return;
      this.globe.pauseAnimation();
    }, ms);
  }

  private resize(): void {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.globe?.width(w).height(h);
    // Fat lines need the canvas pixel size to compute their screen width.
    const size = this.globe?.renderer().getSize(new THREE.Vector2());
    if (size) {
      this.groundLineMaterial?.resolution.set(size.x, size.y);
      for (const m of this.prayerLineMaterials) m.resolution.set(size.x, size.y);
    }
  }

  private buildExtras(): void {
    const scene = this.globe.scene();

    // Starfield
    const positions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      positions[i * 3] = STAR_RADIUS * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = STAR_RADIUS * Math.cos(phi);
      positions[i * 3 + 2] = STAR_RADIUS * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starfield = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: '#ffffff', size: 4.5, sizeAttenuation: true })
    );
    scene.add(this.starfield);

    // Day/night terminator
    this.nightMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      uniforms: { sunDirection: { value: new THREE.Vector3(0, 0, 1) } },
      vertexShader: NIGHT_VERTEX_SHADER,
      fragmentShader: NIGHT_FRAGMENT_SHADER,
    });
    this.nightShade = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS * (1 + NIGHT_SHADE_ALTITUDE), 64, 32),
      this.nightMaterial
    );
    this.nightShade.renderOrder = 1;
    scene.add(this.nightShade);

    // Sun + moon
    this.sun = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_RADIUS, 24, 18),
      new THREE.MeshBasicMaterial({ color: SUN_COLOR })
    );
    this.sunHalo = glowSprite(SUN_COLOR);
    this.sunHalo.scale.setScalar(SUN_HALO);
    this.sunHalo.renderOrder = 4;
    this.sun.renderOrder = 4;
    scene.add(this.sun, this.sunHalo);

    this.moonMaterial = new THREE.ShaderMaterial({
      uniforms: {
        moonMap: { value: this.emptyTexture() },
        sunDirection: { value: new THREE.Vector3(0, 0, 1) },
      },
      vertexShader: SURFACE_VERTEX_SHADER,
      fragmentShader: MOON_FRAGMENT_SHADER,
    });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_RADIUS, 48, 32), this.moonMaterial);
    this.moonHalo = glowSprite(MOON_COLOR);
    this.moonHalo.scale.setScalar(MOON_HALO);
    (this.moonHalo.material as THREE.SpriteMaterial).opacity = 0.5;
    this.moon.renderOrder = 4;
    this.moonHalo.renderOrder = 4;
    scene.add(this.moon, this.moonHalo);

    // Real lunar surface, bundled with the app so it works offline.
    new THREE.TextureLoader().load(
      MOON_TEXTURE_URL,
      (tex) => {
        // Arriving after dispose() used to leak this texture: it was never
        // assigned to moonSurfaceTexture, so dispose() had nothing to free.
        if (this.disposed) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        this.moonSurfaceTexture = tex;
        this.moonMaterial.uniforms.moonMap.value = tex;
        this.moonMaterial.needsUpdate = true;
        this.renderThenSettle();
      },
      undefined,
      () => {
        // Only reachable if the asset went missing from the bundle. The
        // procedural placeholder stays in place, which reads as a plain white
        // moon — worth a line in the console rather than a broken scene.
        console.warn('OnTime: moon texture missing from the bundle; using the plain disc.');
      },
    );

    // Location marker
    // depthTest off so the marker can sit exactly on the surface without the
    // sphere slicing the half of the sprite that falls behind it; the globe is
    // put back in front of it by hand in updatePinVisibility().
    this.pin = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: locationMarkerTexture(), transparent: true, depthWrite: false, depthTest: false,
      })
    );
    this.pin.renderOrder = 3;
    scene.add(this.pin);

    // Sun-position lines (terminator + noon meridian) with salah labels
    this.prayerLinesGroup = new THREE.Group();
    this.prayerLinesGroup.renderOrder = 3;
    scene.add(this.prayerLinesGroup);

    // The line to the Kaaba and the Kaaba itself, shown either from orbit
    // (qibla mode) or from the ground beside it (ground view). Named so the
    // scene graph is readable from a debugger and from a test.
    this.groundGroup = new THREE.Group();
    this.groundGroup.name = 'qibla';
    this.groundGroup.renderOrder = 4;
    this.groundGroup.visible = false;
    scene.add(this.groundGroup);
  }

  /** The faces `prayerLabelSprite` draws with; keep the two in step. */
  private static readonly LABEL_FONTS = ['500 30px Ubuntu', '600 30px Ubuntu'];

  /**
   * Redraw the prayer labels once the webfont they are drawn in has loaded.
   *
   * Canvas 2D bakes text at draw time, so a font arriving afterwards never
   * repaints it: the pills keep the fallback face *and* the widths measured
   * against the fallback metrics, for the life of the scene. Nothing else here
   * awaits `document.fonts`, so without this the labels drawn during
   * onGlobeReady stayed wrong until the next minute tick happened to rebuild
   * them.
   */
  private redrawLabelsWhenFontsLoad(): void {
    if (typeof document === 'undefined' || !('fonts' in document)) return;
    const fonts = document.fonts;
    if (HomeGlobe.LABEL_FONTS.every((spec) => fonts.check(spec))) return;

    void Promise.all([
      ...HomeGlobe.LABEL_FONTS.map((spec) => fonts.load(spec).catch(() => [])),
      fonts.ready.catch(() => undefined),
    ]).then(() => {
      // Either resolution order is fine. Before onGlobeReady the labels have not
      // been drawn yet and will pick the font up; after it, they were drawn with
      // the fallback and need this redraw.
      if (this.disposed || !this.ready) return;
      const { latitude: sunLat, longitude: sunLon } = subSolarPoint(this.data.now);
      this.rebuildPrayerLines(sunLat, sunLon);
      this.renderThenSettle();
    });
  }

  private applyData(): void {
    if (!this.ready || !this.globe) return;
    const { latitude, longitude } = this.data;

    this.updatePin();
    this.homePov = { lat: latitude, lng: longitude, altitude: HOME_ALTITUDE };

    const { latitude: sunLat, longitude: sunLon } = subSolarPoint(this.data.now);
    const { latitude: moonLat, longitude: moonLon } = subLunarPoint(this.data.now);
    const sunDir = v3(this.globe.getCoords(sunLat, sunLon, 1)).normalize();

    this.nightMaterial.uniforms.sunDirection.value.copy(sunDir);
    this.worldSunDir.copy(sunDir);

    const sunPos = this.globe.getCoords(sunLat, sunLon, SUN_ALTITUDE);
    this.sun.position.copy(v3(sunPos));
    this.sunHalo.position.copy(v3(sunPos));
    const moonPos = this.globe.getCoords(moonLat, moonLon, MOON_ALTITUDE);
    this.moon.position.copy(v3(moonPos));
    this.moonHalo.position.copy(v3(moonPos));
    this.applyMoonRotation();

    this.rebuildPrayerLines(sunLat, sunLon);
  }

  /**
   * Draw the solar lines: the sunrise/sunset terminator (where the sun is on
   * the horizon right now) and the noon meridian (where it's currently Dhuhr),
   * each labelled with the user's local salah time at the equator.
   */
  private rebuildPrayerLines(sunLat: number, sunLon: number): void {
    // Clear the previous lines + labels.
    this.prayerLineMaterials.length = 0;
    for (const obj of [...this.prayerLinesGroup.children]) {
      this.prayerLinesGroup.remove(obj);
      if (obj instanceof THREE.Sprite) {
        obj.material.map?.dispose();
        obj.material.dispose();
      } else {
        const mesh = obj as THREE.Line;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else (mat as THREE.Material)?.dispose();
      }
    }

    const radius = GLOBE_RADIUS * (1 + SUN_LINE_ALTITUDE);
    const labelRadius = GLOBE_RADIUS * 1.035;
    const sunDir = v3(this.globe.getCoords(sunLat, sunLon, 1)).normalize();

    const fmt = (name: string) => {
      const p = this.data.prayers.find((x) => x.name === name);
      // Skip prayers that don't occur at this latitude instead of rasterising
      // "Invalid Date" into a sprite over the earth: adhan returns Invalid Date
      // under midnight sun / polar night, and formatTime()'s em-dash guard does
      // not reach this formatter. Inline rather than importing prayerService so
      // adhan stays out of the lazy 3D chunk.
      if (!p || Number.isNaN(p.time.getTime())) return null;
      // hour12 to match formatTime(), so these labels and the HUD beside them
      // agree on a device set to a 24-hour locale.
      const t = p.time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      return `${name.charAt(0).toUpperCase() + name.slice(1)} ${t}`;
    };

    const addLabel = (lat: number, lon: number, text: string | null, color: string) => {
      if (!text) return;
      const pos = geo2xyz(lat, lon, labelRadius);
      const sprite = prayerLabelSprite(text, color);
      sprite.position.set(pos.x, pos.y, pos.z);
      this.prayerLinesGroup.add(sprite);
    };

    const size = this.globe.renderer().getSize(new THREE.Vector2());
    const addFatLine = (points: THREE.Vector3[], color: string, opacity: number, widthPx: number) => {
      const flat: number[] = [];
      for (const p of points) flat.push(p.x, p.y, p.z);
      const geo = new LineGeometry();
      geo.setPositions(flat);
      const mat = new LineMaterial({ color, linewidth: widthPx, transparent: true, opacity });
      mat.resolution.set(size.x, size.y);
      this.prayerLineMaterials.push(mat);
      this.prayerLinesGroup.add(new Line2(geo, mat));
    };
    const addCircle = (
      thetaDeg: number,
      color: string,
      opacity: number,
      widthPx: number,
      side: 'both' | 'east' | 'west' = 'both'
    ) => addFatLine(sunAltitudeCircle(sunDir, thetaDeg, radius, side), color, opacity, widthPx);

    // Every ring but the terminator is derived: the twilight depression comes
    // from the calculation method, and the Asr altitude from the user's
    // latitude, today's declination (sunLat) and the Asr madhab.
    const fajrRing = twilightRingDeg(this.data.fajrTwilightDeg);
    // Interval-based methods fix Isha at Maghrib + N minutes, so no solar angle
    // exists and there is no ring at a fixed depression. ishaSunLon below
    // carries what those methods use instead.
    const ishaRing = this.data.ishaTwilightDeg === null ? null : twilightRingDeg(this.data.ishaTwilightDeg);
    // For a method with no Isha angle, the sub-solar longitude whose terminator
    // is today's Isha line. See intervalIshaSunLon.
    const ishaSunLon =
      ishaRing === null && this.data.ishaIntervalMin
        ? intervalIshaSunLon(sunLon, this.data.ishaIntervalMin)
        : null;
    const asrRing = asrRingDeg(this.data.latitude, sunLat, this.data.asrShadowFactor);

    // Horizon (sunrise/sunset terminator), twilight (fajr/isha), Asr.
    // The terminator is the one full circle: sunrise on its western half,
    // maghrib on its eastern. The rest take the half their prayer falls on —
    // Fajr and Asr and Isha are each a single time of day, not a pair.
    addCircle(HORIZON_ANGLE_DEG, SUNRISE_COLOR, 0.95, SOLAR_LINE_WIDTH_PX);
    addCircle(fajrRing, FAJR_COLOR, 0.75, SOLAR_LINE_WIDTH_PX, 'west');
    if (ishaRing !== null) {
      // Isha needs its evening half drawn even when the method puts it at the
      // same depression as Fajr: the Fajr line is now the morning half only, so
      // it no longer covers for both the way the old whole circle did.
      addCircle(ishaRing, ISHA_COLOR, 0.75, SOLAR_LINE_WIDTH_PX, 'east');
    } else if (ishaSunLon !== null) {
      // Interval-based method: no ring exists, so draw the terminator as it
      // stood when the sun set on the places that are at Isha now. Before the
      // rings were halved, Fajr's whole circle happened to pass close enough to
      // this to serve as a stand-in; with Fajr reduced to its morning half the
      // stand-in is gone and the label was left floating over nothing.
      addFatLine(
        sunAltitudeCircle(v3(this.globe.getCoords(sunLat, ishaSunLon, 1)).normalize(), HORIZON_ANGLE_DEG, radius, 'east'),
        ISHA_COLOR,
        0.75,
        SOLAR_LINE_WIDTH_PX
      );
    }
    addCircle(asrRing, ASR_COLOR, 0.85, SOLAR_LINE_WIDTH_PX, 'east');

    // Noon meridian (Dhuhr).
    addFatLine(meridianPoints(sunLon, radius), NOON_COLOR, 1, SOLAR_LINE_WIDTH_PX);

    // Morning prayers are west of the sub-solar meridian, evening ones east.
    // Label text takes the light weight — it sits on the pill's dark ground.
    // The neighbouring pairs are staggered in latitude so they stop colliding
    // at the limb; see labelPoint.
    const at = (theta: number, lat: number, side: 1 | -1) =>
      labelPoint(sunLat, sunLon, theta, lat, side) ?? { lat: 0, lon: sunLon + side * theta };
    const S = LABEL_STAGGER_DEG;
    const fajrAt = at(fajrRing, S, -1);
    const sunriseAt = at(HORIZON_ANGLE_DEG, -S, -1);
    const asrAt = at(asrRing, 0, 1);
    const maghribAt = at(HORIZON_ANGLE_DEG, -S, 1);
    // The label rides whichever line Isha was actually drawn on.
    const ishaAt =
      ishaSunLon !== null
        ? labelPoint(sunLat, ishaSunLon, HORIZON_ANGLE_DEG, S, 1) ?? {
            lat: 0,
            lon: ishaSunLon + HORIZON_ANGLE_DEG,
          }
        : at(ishaRing ?? fajrRing, S, 1);

    addLabel(fajrAt.lat, fajrAt.lon, fmt('fajr'), PRAYER_ACCENTS.fajr);
    addLabel(sunriseAt.lat, sunriseAt.lon, fmt('sunrise'), PRAYER_ACCENTS.sunrise);
    addLabel(0, sunLon, fmt('dhuhr'), PRAYER_ACCENTS.dhuhr);
    addLabel(asrAt.lat, asrAt.lon, fmt('asr'), PRAYER_ACCENTS.asr);
    addLabel(maghribAt.lat, maghribAt.lon, fmt('maghrib'), PRAYER_ACCENTS.maghrib);
    addLabel(ishaAt.lat, ishaAt.lon, fmt('isha'), PRAYER_ACCENTS.isha);
    this.updateLabelAnchors();
  }

  private labelNdc = new THREE.Vector3();
  private labelWorld = new THREE.Vector3();

  /**
   * Keep each label inside the viewport, and out of the globe.
   *
   * A sprite is centred on its anchor, and these anchors sit out by the limb —
   * which is also the edge of the screen — so half of "Isha 9:39 PM" hung off
   * and was clipped. Sliding the sprite's own centre toward the near edge makes
   * it grow inward instead, eased off the projected position so it never snaps.
   *
   * That alone traded one clipping for another: a label overhanging inward lies
   * over a stretch of globe that is nearer the camera than the label's own
   * plane, so the depth test ate the overhang. The sprites therefore skip depth
   * testing entirely and are culled here by hand — hidden once their point on
   * the sphere has rotated past the horizon, which the depth buffer used to do.
   */
  private updateLabelAnchors(): void {
    if (!this.globe || !this.prayerLinesGroup) return;
    const cam = this.globe.camera() as THREE.PerspectiveCamera;
    cam.updateMatrixWorld();
    // A point on a sphere of radius R is over the horizon when the cosine of
    // its angle from the camera direction exceeds R / camera distance.
    const camDist = cam.position.length();
    const horizonCos = camDist > GLOBE_RADIUS ? GLOBE_RADIUS / camDist : 0;
    const clamp = (n: number) => Math.max(-1, Math.min(1, n));
    for (const obj of this.prayerLinesGroup.children) {
      if (!(obj instanceof THREE.Sprite)) continue;
      obj.getWorldPosition(this.labelWorld);
      const facing = this.labelWorld.dot(cam.position) / (this.labelWorld.length() * camDist);
      if (!facing || facing <= horizonCos) {
        obj.visible = false;
        continue;
      }
      this.labelNdc.copy(this.labelWorld).project(cam);
      // Anchor itself off-screen: growing inward cannot rescue it, and half a
      // word is worse than none. The line it marks is barely in frame anyway.
      obj.visible = Math.abs(this.labelNdc.x) <= 1 && Math.abs(this.labelNdc.y) <= 1;
      if (!obj.visible) continue;
      obj.center.set(0.5 + 0.5 * clamp(this.labelNdc.x), 0.5 + 0.5 * clamp(this.labelNdc.y));
    }
  }

  /**
   * Exactly on the surface, at altitude 0.
   *
   * The marker used to be lifted 0.035 globe-radii along the surface normal, to
   * keep it clear of the sphere for the depth test. But a point off the surface
   * only projects to the same pixel as the ground beneath it when it lies on
   * the camera axis; everywhere else the lift is parallax, pushing the marker
   * outward from the centre of the disc and growing toward the limb. Measured
   * on device at the "My location" framing: over one drag the marker travelled
   * 410.9px while the terrain under it travelled 368px — 42.9px adrift, only
   * 3.3 degrees off the screen centre.
   *
   * A sprite centred on the surface is half inside the sphere at any oblique
   * angle, so this only works because the marker skips the depth test (see the
   * SpriteMaterial in buildExtras) and is culled against the horizon by hand in
   * updatePinVisibility — the same trade updateLabelAnchors already makes for
   * the prayer labels, and for the same reason.
   */
  private updatePin(): void {
    const p = this.globe.getCoords(this.data.latitude, this.data.longitude, 0);
    this.pin.position.copy(v3(p));
  }

  /**
   * Hide the marker once its point on the sphere has rotated past the horizon.
   *
   * With the depth test off, nothing else does: the far side of the globe would
   * otherwise show its own marker straight through the earth. This is the test
   * updateLabelAnchors uses — a point on a sphere of radius R is over the
   * horizon when the cosine of its angle from the camera direction drops below
   * R / camera distance.
   */
  private updatePinVisibility(cam: THREE.PerspectiveCamera): void {
    const camDist = cam.position.length();
    const horizonCos = camDist > GLOBE_RADIUS ? GLOBE_RADIUS / camDist : 0;
    const facing = this.pin.position.dot(cam.position) / (GLOBE_RADIUS * camDist);
    this.pin.visible = facing > horizonCos;
  }

  private updateZoomFades(): void {
    // In ground view the pointOfView() altitude is stale (the camera is moved
    // manually) and the pin/labels are hidden anyway — skip the fade logic.
    if (this.inGroundMode) return;
    // Keep the marker a constant size on screen at every zoom level. Sprites
    // scale with distance, so the world size is chosen to cancel it out —
    // measured to the marker itself rather than to the point under the camera,
    // which are the same only at the centre of the disc. Against the
    // sub-camera distance the marker visibly shrinks as it slides toward the
    // screen edge, which reads as a drift of its own.
    const cam = this.globe.camera() as THREE.PerspectiveCamera;
    const canvasH = (this.host.clientHeight || 1) * Math.min(window.devicePixelRatio || 1, 2);
    const dist = Math.max(1, cam.position.distanceTo(this.pin.position));
    const worldSize = (PIN_SIZE_PX * 2 * Math.tan((cam.fov * D2R) / 2) * dist) / canvasH;
    this.pin.scale.setScalar(worldSize);
    this.updatePinVisibility(cam);
    // This is the camera-changed hook, so it is also where labels re-anchor.
    this.updateLabelAnchors();
  }


  private placeholderTexture?: THREE.DataTexture;

  /** Shared 1×1 transparent stand-in until a patch's real texture loads —
   *  one per globe, not one per patch. */
  private emptyTexture(): THREE.DataTexture {
    if (!this.placeholderTexture) {
      const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1, THREE.RGBAFormat);
      tex.needsUpdate = true;
      this.placeholderTexture = tex;
    }
    return this.placeholderTexture;
  }
}
