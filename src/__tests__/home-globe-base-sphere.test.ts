import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { HomeGlobe } from '../components/three/homeGlobe';

/**
 * The base sphere (the bundled Blue Marble photo) sits a fifth of a percent
 * inside the Esri tile shell so the two never z-fight. globe.gl applies its
 * constructor-time props — `objects([globe])`, which puts the globe object in
 * the render scene, and `skyRadius(...)`, which resets `camera.far` — on a
 * *debounced* update. three-globe's `onGlobeReady` fires off its own timer, so
 * on a fast (cached) base-texture load it can land first, with the globe
 * object not yet in the scene.
 *
 * This fake lets a test drive either order.
 */
const harness = vi.hoisted(() => ({ globe: null as unknown as FakeGlobeShape }));

interface FakeGlobeShape {
  sceneObj: THREE.Scene;
  cameraObj: THREE.PerspectiveCamera;
  material: THREE.MeshPhongMaterial;
  globeMesh: THREE.Mesh;
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
      autoRotate: false,
      enablePan: true,
      rotateSpeed: 1,
      zoomSpeed: 1,
      minDistance: 0,
      maxDistance: 0,
      enabled: true,
      target: new T.Vector3(),
      addEventListener: () => {},
      update: () => {},
    };
    private rendererObj = {
      domElement: document.createElement('canvas'),
      getSize: (v: THREE.Vector2) => v.set(800, 600),
      render: () => {},
    };

    constructor() {
      harness.globe = this as unknown as FakeGlobeShape;
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
    getCoords() { return { x: 0, y: 0, z: 0 }; }
    pauseAnimation() {}
    resumeAnimation() {}

    /** What globe.gl's debounced update does: put the globe object in the
     *  render scene, and set camera.far from skyRadius (100 * 500 * 2.5). */
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

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

let host: HTMLElement;
let view: HomeGlobe;
let origGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  // jsdom has no 2D context; the sprite labels and glows only need it to not
  // throw — nothing in this test reads back what was drawn.
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
  view = new HomeGlobe(host, data);
});

afterEach(() => {
  view.dispose();
  host.remove();
  HTMLCanvasElement.prototype.getContext = origGetContext;
  vi.unstubAllGlobals();
});

describe('HomeGlobe base sphere', () => {
  it('scales the base sphere inside the tile shell on the normal init order', async () => {
    view.mount();
    harness.globe.flushDeferredInit();
    harness.globe.readyCb!();
    await nextFrame();

    expect(harness.globe.globeMesh.scale.x).toBeCloseTo(0.998, 5);
    expect(harness.globe.cameraObj.far).toBe(9000);
  });

  it('still scales it when onGlobeReady beats globe.gl adding the globe to the scene', async () => {
    view.mount();
    // The race: ready fires while the render scene is still empty, so a
    // one-shot traverse finds nothing to scale.
    harness.globe.readyCb!();
    expect(harness.globe.globeMesh.scale.x).toBe(1);

    harness.globe.flushDeferredInit();
    await nextFrame();
    await nextFrame();

    // Left at scale 1 the base sphere is exactly coincident with the tile
    // shell, and the Blue Marble ocean z-fights through the Esri imagery.
    expect(harness.globe.globeMesh.scale.x).toBeCloseTo(0.998, 5);
    // The same deferred update resets camera.far to skyRadius * 2.5, which
    // quarters the depth precision the separation is sized against.
    expect(harness.globe.cameraObj.far).toBe(9000);
  });
});
