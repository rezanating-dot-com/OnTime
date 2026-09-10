import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { HomeGlobe, geo2xyz, GLOBE_RADIUS } from '../components/three/homeGlobe';

/**
 * The location marker has to stay on its coordinates at every camera angle.
 *
 * Reported from the app: the pin drifts away from its spot as the globe is
 * panned. It was lifted 0.035 globe-radii along the surface normal — 3.5 units
 * above a sphere of 100 — and a point off the surface only projects to the same
 * pixel as the ground beneath it when it sits exactly on the camera axis.
 * Everywhere else the lift shows up as parallax, pushing the marker outward
 * from the centre of the disc and growing toward the limb.
 *
 * Measured on a Pixel 10 Pro XL at the "My location" framing: over one drag the
 * marker travelled 410.9 px while the terrain under it travelled 368 px, a
 * 42.9 px separation only 3.3 degrees off the screen centre. The geometry
 * predicts 41.9 px, so the mechanism is not in doubt.
 *
 * The fix is to put the marker *on* the surface and stop it relying on the
 * depth buffer to avoid being buried — the same trade the prayer labels
 * already make (see updateLabelAnchors), which means the far side of the globe
 * has to hide it by hand.
 */

/**
 * geo2xyz's convention, restated for the mock factory. It cannot import
 * homeGlobe — that module imports globe.gl, and resolving the mock through it
 * deadlocks — so the tests below check this against the real exported
 * geo2xyz to make sure the restatement has not drifted.
 */
const harness = vi.hoisted(() => {
  const D2R = Math.PI / 180;
  const R = 100;
  return {
    globes: [] as FakeGlobeShape[],
    R,
    xyz: (lat: number, lon: number, r: number) => {
      const phi = (90 - lat) * D2R;
      const theta = (90 - lon) * D2R;
      const s = Math.sin(phi);
      return { x: r * s * Math.cos(theta), y: r * Math.cos(phi), z: r * s * Math.sin(theta) };
    },
  };
});

interface FakeGlobeShape {
  cameraObj: THREE.PerspectiveCamera;
  readyCb?: () => void;
  zoomCb?: () => void;
  flushDeferredInit(): void;
  /** Put the camera at a lat/lng and altitude, looking at the globe centre. */
  lookFrom(lat: number, lng: number, altitude: number): void;
}

vi.mock('globe.gl', async () => {
  const T = await import('three');
  const g2x = harness.xyz;
  const R = harness.R;
  class FakeGlobe {
    sceneObj = new T.Scene();
    cameraObj = new T.PerspectiveCamera(50, 1344 / 2992, 1, 9000);
    material = new T.MeshPhongMaterial();
    globeMesh = new T.Mesh(new T.SphereGeometry(R, 8, 4), this.material);
    canvas = document.createElement('canvas');
    readyCb?: () => void;
    zoomCb?: () => void;
    private controlsObj = {
      autoRotate: false, enablePan: true, rotateSpeed: 1, zoomSpeed: 1,
      minDistance: 0, maxDistance: 0, enabled: true,
      target: new T.Vector3(), addEventListener: () => {}, update: () => {},
    };
    private rendererObj = {
      domElement: this.canvas,
      getSize: (v: THREE.Vector2) => v.set(1344, 2992),
      render: () => {},
    };

    constructor() {
      harness.globes.push(this as unknown as FakeGlobeShape);
      this.lookFrom(0, 0, 2.5);
    }

    lookFrom(lat: number, lng: number, altitude: number) {
      const p = g2x(lat, lng, R * (1 + altitude));
      this.cameraObj.position.set(p.x, p.y, p.z);
      this.cameraObj.lookAt(0, 0, 0);
      this.cameraObj.updateMatrixWorld(true);
      this.cameraObj.updateProjectionMatrix();
    }

    backgroundColor() { return this; }
    globeImageUrl() { this.material.map = new T.Texture(); return this; }
    showAtmosphere() { return this; }
    atmosphereColor() { return this; }
    atmosphereAltitude() { return this; }
    width() { return this; }
    height() { return this; }
    globeTileEngineUrl() { return this; }
    onZoom(cb: () => void) { this.zoomCb = cb; return this; }
    onGlobeReady(cb: () => void) { this.readyCb = cb; return this; }
    scene() { return this.sceneObj; }
    camera() { return this.cameraObj; }
    renderer() { return this.rendererObj; }
    controls() { return this.controlsObj; }
    globeMaterial() { return this.material; }
    /** Altitude derived from where the camera actually is, as globe.gl does. */
    pointOfView() {
      return { lat: 0, lng: 0, altitude: this.cameraObj.position.length() / R - 1 };
    }
    /** The real convention, so the marker lands where the test can check it. */
    getCoords(lat: number, lng: number, alt = 0) { return g2x(lat, lng, R * (1 + alt)); }
    pauseAnimation() {}
    resumeAnimation() {}

    flushDeferredInit() {
      this.sceneObj.add(this.globeMesh);
      this.cameraObj.updateProjectionMatrix();
    }
  }
  return { default: FakeGlobe };
});

const LAT = 39.96;
const LNG = -86.13;

const data = {
  now: new Date('2026-09-06T04:53:00Z'),
  latitude: LAT,
  longitude: LNG,
  prayers: [],
};

let origGetContext: typeof HTMLCanvasElement.prototype.getContext;
const hosts: HTMLElement[] = [];
const views: HomeGlobe[] = [];

function mountGlobe() {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientHeight', { value: 2992, configurable: true });
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

/** The marker sprite, found in the scene by its material map. */
function pinOf(fake: FakeGlobeShape): THREE.Sprite {
  const scene = (fake as unknown as { sceneObj: THREE.Scene }).sceneObj;
  const sprites: THREE.Sprite[] = [];
  scene.traverse((o) => {
    if (o instanceof THREE.Sprite) sprites.push(o);
  });
  // The pin is the only sprite added straight to the scene at renderOrder 3.
  const pin = sprites.find((s) => s.parent === scene && s.renderOrder === 3);
  if (!pin) throw new Error('location marker not found in scene');
  return pin;
}

/** Screen pixel of a world point, for a 1344x2992 canvas. */
function toScreen(p: THREE.Vector3, cam: THREE.PerspectiveCamera) {
  const ndc = p.clone().project(cam);
  return { x: (ndc.x * 0.5 + 0.5) * 1344, y: (0.5 - ndc.y * 0.5) * 2992 };
}

beforeEach(() => {
  origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => ({
    measureText: () => ({ width: 10 }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    clearRect: () => {}, fillRect: () => {}, beginPath: () => {}, closePath: () => {},
    arc: () => {}, moveTo: () => {}, lineTo: () => {}, roundRect: () => {},
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

describe('the mock globe speaks the app\'s coordinate convention', () => {
  it('matches the real geo2xyz', () => {
    for (const [lat, lng] of [[0, 0], [LAT, LNG], [-33.9, 151.2], [71.2, -156.8]]) {
      const mine = harness.xyz(lat, lng, GLOBE_RADIUS);
      const real = geo2xyz(lat, lng, GLOBE_RADIUS);
      expect(mine.x).toBeCloseTo(real.x, 9);
      expect(mine.y).toBeCloseTo(real.y, 9);
      expect(mine.z).toBeCloseTo(real.z, 9);
    }
    expect(harness.R).toBe(GLOBE_RADIUS);
  });
});

describe('location marker anchoring', () => {
  it('sits exactly on the globe surface', () => {
    const { fake } = mountGlobe();
    // Any radius but GLOBE_RADIUS is parallax waiting to happen. The old lift
    // put it at 103.5.
    expect(pinOf(fake).position.length()).toBeCloseTo(GLOBE_RADIUS, 6);
  });

  it('lands on its own coordinates, not near them', () => {
    const { fake } = mountGlobe();
    const truth = geo2xyz(LAT, LNG, GLOBE_RADIUS);
    const pin = pinOf(fake).position;
    expect(pin.x).toBeCloseTo(truth.x, 6);
    expect(pin.y).toBeCloseTo(truth.y, 6);
    expect(pin.z).toBeCloseTo(truth.z, 6);
  });

  it('projects onto its coordinates from an oblique camera', () => {
    // The reported bug. The camera sits at the "My location" altitude but
    // 3.3 degrees off the marker — the offset at which the drift was measured
    // at 42.9 px on device.
    const { fake } = mountGlobe();
    fake.lookFrom(LAT, LNG + 3.3, 0.5);
    fake.zoomCb?.();

    const pinPx = toScreen(pinOf(fake).position, fake.cameraObj);
    const truthPx = toScreen(
      new THREE.Vector3().copy(geo2xyz(LAT, LNG, GLOBE_RADIUS) as THREE.Vector3),
      fake.cameraObj
    );
    const separation = Math.hypot(pinPx.x - truthPx.x, pinPx.y - truthPx.y);
    expect(separation).toBeLessThan(1);
  });

  it('holds its ground across a pan, moving exactly as far as the surface does', () => {
    // The on-device measurement, restated: over one rotation the marker and the
    // point it marks must travel the same number of pixels.
    const { fake } = mountGlobe();
    const truth = new THREE.Vector3().copy(geo2xyz(LAT, LNG, GLOBE_RADIUS) as THREE.Vector3);

    fake.lookFrom(LAT, LNG, 0.5);
    fake.zoomCb?.();
    const pinA = toScreen(pinOf(fake).position, fake.cameraObj);
    const groundA = toScreen(truth, fake.cameraObj);

    fake.lookFrom(LAT, LNG + 3.3, 0.5);
    fake.zoomCb?.();
    const pinB = toScreen(pinOf(fake).position, fake.cameraObj);
    const groundB = toScreen(truth, fake.cameraObj);

    const pinTravel = pinB.x - pinA.x;
    const groundTravel = groundB.x - groundA.x;
    expect(Math.abs(pinTravel - groundTravel)).toBeLessThan(1);
  });
});

describe('location marker occlusion', () => {
  it('does not depend on the depth buffer', () => {
    // A sprite centred on the surface is half inside the sphere at any oblique
    // angle, so the depth test would slice it. Skipping the test is what lets
    // the marker sit exactly on its coordinates.
    const { fake } = mountGlobe();
    expect((pinOf(fake).material as THREE.SpriteMaterial).depthTest).toBe(false);
  });

  it('is hidden once its location rotates past the horizon', () => {
    const { fake } = mountGlobe();
    const pin = pinOf(fake);

    fake.lookFrom(LAT, LNG, 2.5);
    fake.zoomCb?.();
    expect(pin.visible).toBe(true);

    // Straight through the globe: the marker is on the far side now, and with
    // no depth test nothing else would hide it.
    fake.lookFrom(-LAT, LNG + 180, 2.5);
    fake.zoomCb?.();
    expect(pin.visible).toBe(false);

    // And back again.
    fake.lookFrom(LAT, LNG, 2.5);
    fake.zoomCb?.();
    expect(pin.visible).toBe(true);
  });
});

describe('location marker size', () => {
  it('is measured to the marker, not to the point under the camera', () => {
    // Sprites scale with distance, so the world size is chosen to cancel it. Do
    // that against the sub-camera distance and the marker shrinks as it slides
    // toward the screen edge, which reads as drift of its own.
    const { fake } = mountGlobe();
    fake.lookFrom(LAT, LNG + 30, 0.5);
    fake.zoomCb?.();

    const pin = pinOf(fake);
    const trueDist = fake.cameraObj.position.distanceTo(pin.position);
    const subCameraDist = fake.cameraObj.position.length() - GLOBE_RADIUS;
    // 30 degrees off axis, these differ by enough to see.
    expect(trueDist).toBeGreaterThan(subCameraDist * 1.05);

    const canvasH = 2992 * Math.min(window.devicePixelRatio || 1, 2);
    const expected =
      (50 * 2 * Math.tan(((fake.cameraObj.fov * Math.PI) / 180) / 2) * trueDist) / canvasH;
    expect(pin.scale.x).toBeCloseTo(expected, 4);
  });
});
