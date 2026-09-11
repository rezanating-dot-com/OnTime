import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { HomeGlobe } from '../components/three/homeGlobe';

/**
 * User story: I tap the Kaaba and the globe I am looking at shows me the way.
 *
 * The Qibla used to be a screen of its own, carrying a second globe: a second
 * WebGL context, a second copy of the world, and around 440ms of shader
 * building on every open. The line is drawn on the globe that is already up
 * instead, and the Kaaba button turns it on and off.
 *
 * Two things have to hold. The line and the Kaaba appear and then go away
 * again, leaving nothing behind. And the camera moves somewhere both ends of
 * the line can be seen from — a line to Makkah is usually most of a hemisphere
 * long, and at the globe's opening framing half of it is round the back.
 */
const harness = vi.hoisted(() => ({
  globe: null as unknown as FakeGlobeShape,
  povs: [] as { lat: number; lng: number; altitude: number }[],
}));

interface FakeGlobeShape {
  sceneObj: THREE.Scene;
  cameraObj: THREE.PerspectiveCamera;
  controls(): { _quat: THREE.Quaternion; _quatInverse: THREE.Quaternion };
  readyCb?: () => void;
  flushDeferredInit(): void;
  getCoords(lat: number, lon: number, alt: number): { x: number; y: number; z: number };
}

vi.mock('globe.gl', async () => {
  const T = await import('three');
  class FakeGlobe {
    sceneObj = new T.Scene();
    cameraObj = new T.PerspectiveCamera(50, 1, 0.1, 1000);
    material = new T.MeshPhongMaterial();
    globeMesh = new T.Mesh(new T.SphereGeometry(100, 8, 4), this.material);
    readyCb?: () => void;
    // OrbitControls caches the frame it orbits in as a pair of quaternions,
    // built from the camera's up when the controls are, and never refreshed.
    // Mirrored here because keeping it in step is the thing under test.
    private controlsObj = {
      autoRotate: false, enablePan: true, rotateSpeed: 1, zoomSpeed: 1,
      minDistance: 0, maxDistance: 0, enabled: true, target: new T.Vector3(),
      addEventListener: () => {}, update: () => {},
      _quat: new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(0, 1, 0)),
      _quatInverse: new T.Quaternion(),
    };
    private rendererObj = {
      domElement: document.createElement('canvas'),
      getSize: (v: THREE.Vector2) => v.set(800, 600),
      render: () => {},
      dispose: () => {},
      forceContextLoss: () => {},
    };
    constructor() { harness.globe = this as unknown as FakeGlobeShape; }
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
    pointOfView(pov?: { lat: number; lng: number; altitude: number }) {
      if (pov) harness.povs.push(pov);
      return { lat: 0, lng: 0, altitude: 2.5 };
    }
    getCoords(lat: number, lon: number, alt: number) {
      const r = 100 * (1 + alt);
      const phi = ((90 - lat) * Math.PI) / 180;
      const theta = ((90 - lon) * Math.PI) / 180;
      const s = Math.sin(phi);
      return { x: r * s * Math.cos(theta), y: r * Math.cos(phi), z: r * s * Math.sin(theta) };
    }
    pauseAnimation() {}
    resumeAnimation() {}
    _destructor() {}
    flushDeferredInit() {
      this.sceneObj.add(this.globeMesh);
      this.cameraObj.far = 125000;
      this.cameraObj.updateProjectionMatrix();
    }
  }
  return { default: FakeGlobe };
});

/** Toronto: about 100 degrees of arc from Makkah, a typical case. */
const data = {
  now: new Date('2026-09-06T18:00:00Z'),
  latitude: 43.65,
  longitude: -79.38,
  prayers: [],
  fajrTwilightDeg: 18,
  ishaTwilightDeg: 17,
  asrShadowFactor: 1,
  qiblaDirection: 58,
};

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
const qiblaGroup = () => harness.globe.sceneObj.getObjectByName('qibla')!;
/** The same lat/lon to cartesian the globe itself uses, for the assertions. */
const at = (lat: number, lon: number) => {
  const p = harness.globe.getCoords(lat, lon, 1);
  return new THREE.Vector3(p.x, p.y, p.z).normalize();
};

let host: HTMLElement;
let view: HomeGlobe;
let origGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(async () => {
  harness.povs = [];
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

  host = document.createElement('div');
  document.body.appendChild(host);
  view = new HomeGlobe(host, data as never);
  view.mount();
  harness.globe.flushDeferredInit();
  harness.globe.readyCb!();
  await nextFrame();
});

afterEach(() => {
  view.dispose();
  host.remove();
  HTMLCanvasElement.prototype.getContext = origGetContext;
  vi.unstubAllGlobals();
});

describe('User story: the qibla drawn on the globe already up', () => {
  it('draws nothing until it is asked for', () => {
    expect(qiblaGroup().visible).toBe(false);
    expect(qiblaGroup().children.length).toBe(0);
  });

  it('draws the line and the Kaaba when switched on', () => {
    view.update({ ...data, qiblaMode: true } as never);

    expect(qiblaGroup().visible).toBe(true);
    // The line itself, and the Kaaba standing at the end of it.
    expect(qiblaGroup().children.length).toBe(2);
  });

  it('takes them away again when switched off, leaving nothing behind', () => {
    view.update({ ...data, qiblaMode: true } as never);
    expect(qiblaGroup().children.length).toBe(2);

    view.update({ ...data, qiblaMode: false } as never);

    expect(qiblaGroup().visible).toBe(false);
    expect(qiblaGroup().children.length).toBe(0);
  });

  it('backs the camera off far enough to see both ends of the line', () => {
    view.update({ ...data, qiblaMode: true } as never);

    const framed = harness.povs.at(-1)!;
    // Toronto to Makkah is about 100 degrees of arc, so the camera has to be
    // able to see 50 degrees either side of the midpoint. From altitude h the
    // horizon is acos(1 / (1 + h)) away, which needs h of at least about 0.56
    // before the ends are even on the edge, and more to clear the silhouette.
    const horizonDeg = (Math.acos(1 / (1 + framed.altitude)) * 180) / Math.PI;
    expect(horizonDeg).toBeGreaterThan(55);
    // And not so far that the globe is a marble.
    expect(framed.altitude).toBeLessThanOrEqual(3.2);
  });

  it('stands the line upright on the screen, and lays the horizon back flat after', () => {
    const cam = harness.globe.cameraObj;
    const here = at(data.latitude, data.longitude);
    const makkah = at(21.4225, 39.8262);
    const mid = here.clone().add(makkah).normalize();
    const normal = here.clone().cross(makkah).normalize();

    view.update({ ...data, qiblaMode: true } as never);

    // Upright means: square to the direction the camera is looking, and lying
    // in the plane the line is drawn in. A phone is far taller than it is
    // wide, and a line to Makkah laid across it does not fit.
    expect(Math.abs(cam.up.dot(mid))).toBeLessThan(1e-6);
    expect(Math.abs(cam.up.dot(normal))).toBeLessThan(1e-6);
    expect(cam.up.length()).toBeCloseTo(1, 6);

    view.update({ ...data, qiblaMode: false } as never);

    // Every other part of the globe assumes north is up.
    expect(cam.up.x).toBeCloseTo(0, 6);
    expect(cam.up.y).toBeCloseTo(1, 6);
    expect(cam.up.z).toBeCloseTo(0, 6);
  });

  it('turns the frame a drag is measured in along with the picture', () => {
    const cam = harness.globe.cameraObj;

    view.update({ ...data, qiblaMode: true } as never);

    // The controls cache the rotation that takes the camera's up onto world
    // up. Left stale it rolls the view without rolling the gestures, and the
    // globe spins the wrong way under your finger.
    const carried = cam.up.clone().applyQuaternion(harness.globe.controls()._quat);
    expect(carried.x).toBeCloseTo(0, 5);
    expect(carried.y).toBeCloseTo(1, 5);
    expect(carried.z).toBeCloseTo(0, 5);

    view.update({ ...data, qiblaMode: false } as never);

    const back = cam.up.clone().applyQuaternion(harness.globe.controls()._quat);
    expect(back.y).toBeCloseTo(1, 5);
  });

  it('leaves the picture and the drag frame agreeing after a reset, with the line still up', () => {
    const cam = harness.globe.cameraObj;
    view.update({ ...data, qiblaMode: true } as never);

    // Reset view and My location both put the camera upright. Doing that
    // without telling the controls is the same defect as never rolling them,
    // arrived at from the other side.
    view.resetView();

    expect(cam.up.y).toBeCloseTo(1, 5);
    const carried = cam.up.clone().applyQuaternion(harness.globe.controls()._quat);
    expect(carried.y).toBeCloseTo(1, 5);
    expect(Math.abs(carried.x)).toBeLessThan(1e-5);
    expect(Math.abs(carried.z)).toBeLessThan(1e-5);
  });

  it('frames the middle of the line, not the user and not Makkah', () => {
    view.update({ ...data, qiblaMode: true } as never);

    const framed = harness.povs.at(-1)!;
    // Somewhere in the north Atlantic, between Toronto and Makkah.
    expect(framed.lng).toBeGreaterThan(data.longitude);
    expect(framed.lng).toBeLessThan(40);
    expect(framed.lat).toBeGreaterThan(30);
  });
});
