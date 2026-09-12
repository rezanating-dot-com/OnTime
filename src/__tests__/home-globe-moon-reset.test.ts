import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { HomeGlobe } from '../components/three/homeGlobe';
import { subSolarPoint, subLunarPoint } from '../services/solarGeometry';

/**
 * "Reset moon" has to behave like "Reset view" does for the earth: it undoes
 * a drag without leaving the zoomed-in screen you were already looking at.
 * That means two things worth locking down separately —
 *   1. the screen has to be told when the moon is focused vs. not, so it
 *      knows when to offer the button at all (onMoonLockedChange);
 *   2. resetting the spin has to change only the moon's own rotation, not
 *      the lock/zoom state that governs whether you're still looking at it.
 *
 * getCoords needs to return real, non-degenerate directions here — the
 * default lifecycle-test fake returns {0,0,0} for every call, and
 * focusOnMoon() normalizes that position, which is NaN for a zero vector.
 * Restated inline (not imported) because the mock factory can't reach back
 * into homeGlobe.ts for geo2xyz without deadlocking on its own import of
 * globe.gl — see home-globe-pin-anchor.test.ts for the same restatement.
 */
const harness = vi.hoisted(() => {
  const D2R = Math.PI / 180;
  return {
    globes: [] as FakeGlobeShape[],
    xyz: (lat: number, lon: number, r: number) => {
      const phi = (90 - lat) * D2R;
      const theta = (90 - lon) * D2R;
      const s = Math.sin(phi);
      return { x: r * s * Math.cos(theta), y: r * Math.cos(phi), z: r * s * Math.sin(theta) };
    },
  };
});

interface FakeGlobeShape {
  sceneObj: THREE.Scene;
  cameraObj: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  readyCb?: () => void;
  flushDeferredInit(): void;
}

vi.mock('globe.gl', async () => {
  const T = await import('three');
  const g2x = harness.xyz;
  const R = 100;
  class FakeGlobe {
    sceneObj = new T.Scene();
    cameraObj = new T.PerspectiveCamera(50, 1, 0.1, 9000);
    material = new T.MeshPhongMaterial();
    globeMesh = new T.Mesh(new T.SphereGeometry(R, 8, 4), this.material);
    canvas = document.createElement('canvas');
    readyCb?: () => void;
    // A real listener map, not a no-op — HomeGlobe registers a 'change'
    // handler that re-pins the orbit target to the moon (see the mount()
    // comment on why globe.gl's own handler can't be trusted to leave it
    // alone), and the tests below fire 'change' by hand to exercise it.
    private controlsObj = {
      autoRotate: false, enablePan: true, rotateSpeed: 1, zoomSpeed: 1,
      minDistance: 0, maxDistance: 0, enabled: true,
      target: new T.Vector3(),
      listeners: {} as Record<string, Array<() => void>>,
      addEventListener(type: string, cb: () => void) {
        (this.listeners[type] ??= []).push(cb);
      },
      dispatchEvent(type: string) {
        for (const cb of this.listeners[type] ?? []) cb();
      },
      update: () => {},
    };
    private rendererObj = {
      domElement: this.canvas,
      getSize: (v: THREE.Vector2) => v.set(800, 600),
      render: () => {},
    };

    constructor() {
      harness.globes.push(this as unknown as FakeGlobeShape);
    }

    backgroundColor() { return this; }
    globeImageUrl() { this.material.map = new T.Texture(); return this; }
    showAtmosphere() { return this; }
    atmosphereColor() { return this; }
    atmosphereAltitude() { return this; }
    width() { return this; }
    height() { return this; }
    globeTileEngineUrl() { return this; }
    onZoom() { return this; }
    onGlobeReady(cb: () => void) { this.readyCb = cb; return this; }
    scene() { return this.sceneObj; }
    camera() { return this.cameraObj; }
    renderer() { return this.rendererObj; }
    controls() { return this.controlsObj; }
    globeMaterial() { return this.material; }
    pointOfView() { return { lat: 0, lng: 0, altitude: 2.5 }; }
    /** Real convention (not {0,0,0}) — focusOnMoon() normalizes this. */
    getCoords(lat: number, lng: number, alt = 0) { return g2x(lat, lng, R * (1 + alt)); }
    pauseAnimation() {}
    resumeAnimation() {}

    flushDeferredInit() {
      this.sceneObj.add(this.globeMesh);
      this.cameraObj.far = 125000;
      this.cameraObj.updateProjectionMatrix();
    }
  }
  return { default: FakeGlobe };
});

const data = {
  now: new Date('2026-09-06T04:53:00Z'),
  latitude: 41.79,
  longitude: -88.32,
  prayers: [],
};

let origGetContext: typeof HTMLCanvasElement.prototype.getContext;
const hosts: HTMLElement[] = [];
const views: HomeGlobe[] = [];

function mountGlobe() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  hosts.push(el);
  const view = new HomeGlobe(el, data);
  views.push(view);
  view.mount();
  const fake = harness.globes[harness.globes.length - 1];
  fake.flushDeferredInit();
  fake.readyCb?.();
  return { view, fake };
}

/** The moon sphere, found by the one uniform only its shader carries. */
function moonOf(fake: FakeGlobeShape): THREE.Mesh {
  let found: THREE.Mesh | undefined;
  fake.sceneObj.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
    if (mat?.uniforms?.moonMap) found = o as THREE.Mesh;
  });
  if (!found) throw new Error('moon mesh not found in scene');
  return found;
}

interface FakeControls {
  enabled: boolean;
  minDistance: number;
  maxDistance: number;
  rotateSpeed: number;
  zoomSpeed: number;
  target: THREE.Vector3;
  dispatchEvent(type: string): void;
}

function controlsOf(fake: FakeGlobeShape): FakeControls {
  return (fake as unknown as { controls(): FakeControls }).controls();
}

beforeEach(() => {
  origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => ({
    measureText: () => ({ width: 10 }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    clearRect: () => {}, fillRect: () => {}, beginPath: () => {}, closePath: () => {},
    arc: () => {}, moveTo: () => {}, lineTo: () => {}, roundRect: () => {},
    bezierCurveTo: () => {}, quadraticCurveTo: () => {},
    fill: () => {}, stroke: () => {}, fillText: () => {}, strokeText: () => {},
    save: () => {}, restore: () => {}, translate: () => {}, scale: () => {},
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  harness.globes.length = 0;
});

afterEach(() => {
  for (const v of views) v.dispose();
  views.length = 0;
  for (const h of hosts) h.remove();
  hosts.length = 0;
  HTMLCanvasElement.prototype.getContext = origGetContext;
  vi.unstubAllGlobals();
});

describe('HomeGlobe moon lighting', () => {
  it("lights the moon from the sun's real direction relative to the moon, not from earth's centre", () => {
    const { fake } = mountGlobe();
    const material = moonOf(fake).material as THREE.ShaderMaterial;

    const { latitude: sunLat, longitude: sunLon } = subSolarPoint(data.now);
    const { latitude: moonLat, longitude: moonLon } = subLunarPoint(data.now);
    const shellRadius = 100 * 21; // matches the fake's R * (1 + SUN/MOON_ALTITUDE)
    const sunPos = new THREE.Vector3().copy(harness.xyz(sunLat, sunLon, shellRadius) as THREE.Vector3);
    const moonPos = new THREE.Vector3().copy(harness.xyz(moonLat, moonLon, shellRadius) as THREE.Vector3);
    const correct = sunPos.clone().sub(moonPos).normalize();
    // The bug this guards against: lighting the moon with the direction from
    // *earth's* centre to the sun, which is only right for earth's own
    // terminator (earth sits at the origin) and points the "sun" at earth
    // instead of the moon's real phase angle for every other position.
    const earthCentred = sunPos.clone().normalize();

    const actual = material.uniforms.sunDirection.value as THREE.Vector3;
    expect(actual.distanceTo(correct)).toBeLessThan(1e-6);
    expect(actual.distanceTo(earthCentred)).toBeGreaterThan(0.01);
  });
});

describe('HomeGlobe moon lock notifications', () => {
  it('reports locked when the moon is focused, then unlocked on Reset view', () => {
    const { view } = mountGlobe();
    const states: boolean[] = [];
    view.onMoonLockedChange = (v) => states.push(v);

    view.focusOnMoon();
    expect(states).toEqual([true]);

    view.resetView();
    expect(states).toEqual([true, false]);
  });

  it('reports unlocked when My location is used to leave the moon', () => {
    const { view } = mountGlobe();
    view.focusOnMoon();
    const states: boolean[] = [];
    view.onMoonLockedChange = (v) => states.push(v);

    view.focusOnLocation();
    expect(states).toEqual([false]);
  });

  it('does not re-announce a state it is already in', () => {
    const { view } = mountGlobe();
    const states: boolean[] = [];
    view.onMoonLockedChange = (v) => states.push(v);

    view.resetView(); // already unlocked — nothing changed
    expect(states).toEqual([]);
  });
});

describe('HomeGlobe moon dragging', () => {
  it('orbits the camera instead of spinning the moon mesh, same as earth', () => {
    const { view, fake } = mountGlobe();
    view.focusOnMoon();
    const moon = moonOf(fake);
    const before = moon.quaternion.clone();

    fake.canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100 }));
    fake.canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 100 }));
    fake.canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 160, clientY: 100 }));

    expect(moon.quaternion.equals(before)).toBe(true);
  });
});

describe('HomeGlobe moon orbit range', () => {
  it('gives the moon its own zoom range as soon as it is focused, while the fly-in is still animating', () => {
    const { view, fake } = mountGlobe();
    const controls = controlsOf(fake);
    const earthMin = controls.minDistance;
    const earthMax = controls.maxDistance;

    view.focusOnMoon();

    expect(controls.enabled).toBe(false); // the fly-in owns the camera until it lands
    expect(controls.minDistance).not.toBe(earthMin);
    expect(controls.maxDistance).not.toBe(earthMax);
    expect(controls.minDistance).toBeLessThan(controls.maxDistance);
  });

  it('restores earth\'s own zoom range on the way out', () => {
    const { view, fake } = mountGlobe();
    const controls = controlsOf(fake);
    const earthMin = controls.minDistance;
    const earthMax = controls.maxDistance;

    view.focusOnMoon();
    view.resetView();

    expect(controls.minDistance).toBe(earthMin);
    expect(controls.maxDistance).toBe(earthMax);
  });

  it('re-pins the orbit target to the moon and rescales speed on every drag while locked', () => {
    const { view, fake } = mountGlobe();
    const controls = controlsOf(fake);
    view.focusOnMoon();
    const moon = moonOf(fake);

    // globe.gl's own 'change' handler always zeroes the target and rescales
    // speed off the camera's distance from the *earth's* centre — stand in
    // for that here, then confirm HomeGlobe's own listener (registered
    // after it) corrects both back to the moon.
    controls.target.set(0, 0, 0);
    controls.rotateSpeed = 999;
    controls.zoomSpeed = 999;
    fake.cameraObj.position.copy(moon.position).add(new THREE.Vector3(0, 0, 60));
    controls.dispatchEvent('change');

    expect(controls.target.distanceTo(moon.position)).toBeCloseTo(0, 6);
    expect(controls.rotateSpeed).not.toBe(999);
    expect(controls.zoomSpeed).not.toBe(999);
  });

  it('leaves the target and speed alone when the moon is not locked', () => {
    const { view, fake } = mountGlobe();
    const controls = controlsOf(fake);
    view.focusOnMoon();
    view.resetView(); // back to earth — not locked any more

    controls.target.set(1, 2, 3);
    controls.rotateSpeed = 42;
    controls.dispatchEvent('change');

    expect(controls.target).toEqual(new THREE.Vector3(1, 2, 3));
    expect(controls.rotateSpeed).toBe(42);
  });
});

describe('HomeGlobe resetMoonView', () => {
  it('leaves the zoomed-in lock alone — it is not the same action as Reset view', () => {
    const { view } = mountGlobe();
    view.focusOnMoon();
    const states: boolean[] = [];
    view.onMoonLockedChange = (v) => states.push(v);

    view.resetMoonView();
    expect(states).toEqual([]);
  });

  it('disables orbiting again to re-fly to the default framing, same as the initial focus', () => {
    const { view, fake } = mountGlobe();
    const controls = controlsOf(fake);
    view.focusOnMoon();
    controls.enabled = true; // pretend the fly-in already landed and handed control back

    view.resetMoonView();

    expect(controls.enabled).toBe(false);
  });
});
