import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { HomeGlobe } from '../components/three/homeGlobe';
import { PRAYER_COLORS } from '../utils/prayerColors';

/**
 * User story: I use Umm al-Qura. Every other prayer on the globe has a line
 * under its label, and Isha should too.
 *
 * This is the behaviour the geometry in interval-isha-line.test.ts exists to
 * serve, asserted where it can actually regress: that a line in Isha's colour
 * is drawn at all for a method with no Isha angle.
 */
const harness = vi.hoisted(() => ({ globe: null as unknown as FakeGlobeShape }));

interface FakeGlobeShape {
  sceneObj: THREE.Scene;
  readyCb?: () => void;
  flushDeferredInit(): void;
}

vi.mock('globe.gl', async () => {
  const T = await import('three');
  class FakeGlobe {
    sceneObj = new T.Scene();
    cameraObj = new T.PerspectiveCamera(50, 1, 0.1, 1000);
    material = new T.MeshPhongMaterial();
    globeMesh = new T.Mesh(new T.SphereGeometry(100, 8, 4), this.material);
    readyCb?: () => void;
    private controlsObj = {
      autoRotate: false, enablePan: true, rotateSpeed: 1, zoomSpeed: 1,
      minDistance: 0, maxDistance: 0, enabled: true, target: new T.Vector3(),
      addEventListener: () => {}, update: () => {},
    };
    private rendererObj = {
      domElement: document.createElement('canvas'),
      getSize: (v: THREE.Vector2) => v.set(800, 600),
      render: () => {},
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
    pointOfView() { return { lat: 0, lng: 0, altitude: 2.5 }; }
    // The real thing, unlike the stub other globe tests use: this one places
    // the sun, and the line under test is drawn around a shifted sun.
    getCoords(lat: number, lon: number, alt: number) {
      const r = 100 * (1 + alt);
      const phi = ((90 - lat) * Math.PI) / 180;
      const theta = ((90 - lon) * Math.PI) / 180;
      const s = Math.sin(phi);
      return { x: r * s * Math.cos(theta), y: r * Math.cos(phi), z: r * s * Math.sin(theta) };
    }
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

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

const baseData = {
  now: new Date('2026-09-06T18:00:00Z'),
  latitude: 21.42,
  longitude: 39.83,
  prayers: [
    { name: 'fajr', time: new Date('2026-09-06T02:00:00Z') },
    { name: 'sunrise', time: new Date('2026-09-06T03:20:00Z') },
    { name: 'dhuhr', time: new Date('2026-09-06T09:10:00Z') },
    { name: 'asr', time: new Date('2026-09-06T12:35:00Z') },
    { name: 'maghrib', time: new Date('2026-09-06T15:00:00Z') },
    { name: 'isha', time: new Date('2026-09-06T16:30:00Z') },
  ],
  fajrTwilightDeg: 18.5,
  asrShadowFactor: 1,
};

let host: HTMLElement;
let view: HomeGlobe;
let origGetContext: typeof HTMLCanvasElement.prototype.getContext;

function linesColoured(hex: string): number {
  let found = 0;
  const wanted = new THREE.Color(hex);
  harness.globe.sceneObj.traverse((o) => {
    const material = (o as THREE.Mesh).material as { color?: THREE.Color } | undefined;
    if (material?.color && material.color.getHex() === wanted.getHex()) found++;
  });
  return found;
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
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  view?.dispose();
  host.remove();
  HTMLCanvasElement.prototype.getContext = origGetContext;
  vi.unstubAllGlobals();
});

async function mountWith(extra: Record<string, unknown>) {
  view = new HomeGlobe(host, { ...baseData, ...extra } as never);
  view.mount();
  harness.globe.flushDeferredInit();
  harness.globe.readyCb!();
  await nextFrame();
}

describe('Isha on a method with no Isha angle', () => {
  it('draws a line, the way every other prayer does', async () => {
    await mountWith({ ishaTwilightDeg: null, ishaIntervalMin: 90 });
    expect(linesColoured(PRAYER_COLORS.isha)).toBeGreaterThan(0);
  });

  it('still draws one on a method that does give Isha an angle', async () => {
    await mountWith({ ishaTwilightDeg: 17, ishaIntervalMin: null });
    expect(linesColoured(PRAYER_COLORS.isha)).toBeGreaterThan(0);
  });

  it('draws none if the method offers neither an angle nor an interval', async () => {
    // Nothing in the app produces this today, but it is the case the old code
    // silently fell into for every interval method.
    await mountWith({ ishaTwilightDeg: null, ishaIntervalMin: null });
    expect(linesColoured(PRAYER_COLORS.isha)).toBe(0);
  });
});
