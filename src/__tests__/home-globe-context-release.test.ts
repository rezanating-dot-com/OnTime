import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { HomeGlobe } from '../components/three/homeGlobe';

/**
 * User story: I switch between the globe and the list and the app does not
 * swell.
 *
 * The same defect as the Qibla screen, on the other globe. Measured on a
 * Pixel 10 Pro XL: the app sat at 131MB of graphics memory, and each switch to
 * the globe and back added about 104MB that never came back — three round
 * trips left it at 496MB. Every texture, geometry and material is disposed and
 * the canvas is removed, but a WebGL context holds its allocation inside the
 * GPU driver where none of that reaches. The context has to be lost.
 *
 * The renderer is read before the library's own teardown runs, since
 * afterwards there is nothing left to ask.
 */
const harness = vi.hoisted(() => ({
  globe: null as unknown as { readyCb?: () => void; flushDeferredInit(): void },
  disposed: 0,
  contextLost: 0,
  destructed: 0,
  rendererAsked: 0,
  /** True if the renderer was fetched before the library tore itself down. */
  askedBeforeDestruct: false,
}));

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
      dispose: () => { harness.disposed++; },
      forceContextLoss: () => { harness.contextLost++; },
    };
    constructor() { harness.globe = this as unknown as typeof harness.globe; }
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
    renderer() {
      harness.rendererAsked++;
      if (harness.destructed === 0) harness.askedBeforeDestruct = true;
      return this.rendererObj;
    }
    controls() { return this.controlsObj; }
    globeMaterial() { return this.material; }
    pointOfView() { return { lat: 0, lng: 0, altitude: 2.5 }; }
    getCoords() { return { x: 0, y: 0, z: 0 }; }
    pauseAnimation() {}
    resumeAnimation() {}
    _destructor() {
      harness.destructed++;
      // The real library disposes the renderer here. Mirrored so the count
      // below is a fact about the teardown rather than about this stand-in.
      this.rendererObj.dispose();
    }
    flushDeferredInit() {
      this.sceneObj.add(this.globeMesh);
      this.cameraObj.far = 125000;
      this.cameraObj.updateProjectionMatrix();
    }
  }
  return { default: FakeGlobe };
});

const data = {
  now: new Date('2026-09-06T18:00:00Z'),
  latitude: 43.65,
  longitude: -79.38,
  prayers: [],
  fajrTwilightDeg: 18,
  ishaTwilightDeg: 17,
  asrShadowFactor: 1,
};

let host: HTMLElement;
let origGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  harness.disposed = 0;
  harness.contextLost = 0;
  harness.destructed = 0;
  harness.rendererAsked = 0;
  harness.askedBeforeDestruct = false;
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
  host.remove();
  HTMLCanvasElement.prototype.getContext = origGetContext;
  vi.unstubAllGlobals();
});

describe('User story: leaving the globe view gives its graphics memory back', () => {
  it('loses the WebGL context when the globe goes away', () => {
    const view = new HomeGlobe(host, data as never);
    view.mount();
    harness.globe.flushDeferredInit();
    harness.globe.readyCb!();
    expect(harness.contextLost).toBe(0);

    view.dispose();

    // Disposed at least once, by the library and again here — harmless, and
    // not the point. Losing the context exactly once is the point.
    expect(harness.disposed).toBeGreaterThanOrEqual(1);
    expect(harness.contextLost).toBe(1);
  });

  it('asks for the renderer before the library tears itself down', () => {
    const view = new HomeGlobe(host, data as never);
    view.mount();
    harness.globe.flushDeferredInit();
    harness.globe.readyCb!();
    // mount() reads the renderer too, to reach the canvas. Only the teardown's
    // own read is under test here.
    harness.rendererAsked = 0;
    harness.askedBeforeDestruct = false;

    view.dispose();

    expect(harness.destructed).toBe(1);
    expect(harness.rendererAsked).toBe(1);
    expect(harness.askedBeforeDestruct).toBe(true);
  });
});
