import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { HomeGlobe } from '../components/three/homeGlobe';

/**
 * Lifecycle guarantees for HomeGlobe: what has to survive a dispose(), and what
 * has to not throw before onGlobeReady has run.
 *
 * The fake globe is the same shape as home-globe-base-sphere.test.ts's, but it
 * records every instance rather than only the last, because the loading-manager
 * test needs two live globes at once.
 */
const harness = vi.hoisted(() => ({ globes: [] as FakeGlobeShape[] }));

interface FakeGlobeShape {
  sceneObj: THREE.Scene;
  cameraObj: THREE.PerspectiveCamera;
  material: THREE.MeshPhongMaterial;
  globeMesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
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
    canvas = document.createElement('canvas');
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
    getCoords() { return { x: 0, y: 0, z: 0 }; }
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

const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/1';
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

let origGetContext: typeof HTMLCanvasElement.prototype.getContext;
const hosts: HTMLElement[] = [];
const views: HomeGlobe[] = [];

/** Tracked so afterEach can dispose it even when an assertion throws first —
 *  a globe left mounted keeps its loading-manager subscription and quietly
 *  breaks every test that follows. */
const newGlobe = () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  hosts.push(el);
  const view = new HomeGlobe(el, data);
  views.push(view);
  return view;
};

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

describe('HomeGlobe camera depth range (GL-13)', () => {
  it('bounds the far plane to the scene without clipping the starfield', async () => {
    const view = newGlobe();
    view.mount();
    harness.globes[0].flushDeferredInit();
    harness.globes[0].readyCb!();
    await nextFrame();

    const cam = harness.globes[0].cameraObj;
    // Has to still reach the starfield at STAR_RADIUS 4000 …
    expect(cam.far).toBeGreaterThan(4000);
    // … and has to be the value this file set, not the one globe.gl's
    // debounced skyRadius update writes (100 * 500 * 2.5 = 125000).
    expect(cam.far).toBeLessThan(125000);
    // near is load-bearing in a way far is not: it is what sets depth
    // precision, and the pinch floor (minDistance 106, markers at ~101-105)
    // is what pins it to 1.
    expect(cam.near).toBe(1);
  });
});

describe('HomeGlobe pre-ready guards (GL-2)', () => {
  it('survives resetView() and focusOnLocation() while the loader is still up', () => {
    const view = newGlobe();
    view.mount();
    // onGlobeReady has not fired, so buildExtras() has not run and `moon` is
    // unassigned — but both buttons are already tappable above the loader.
    expect(() => view.resetView()).not.toThrow();
    expect(() => view.focusOnLocation()).not.toThrow();
  });
});

describe('HomeGlobe canvas listeners (GL-10)', () => {
  it('removes every pointer listener it added on dispose', () => {
    const view = newGlobe();
    const added: string[] = [];
    const removed: string[] = [];
    const origAdd = HTMLCanvasElement.prototype.addEventListener;
    const origRemove = HTMLCanvasElement.prototype.removeEventListener;
    HTMLCanvasElement.prototype.addEventListener = function (t: string, ...rest: unknown[]) {
      if (t.startsWith('pointer')) added.push(t);
      return (origAdd as (...a: unknown[]) => void).call(this, t, ...rest);
    } as typeof HTMLCanvasElement.prototype.addEventListener;
    HTMLCanvasElement.prototype.removeEventListener = function (t: string, ...rest: unknown[]) {
      if (t.startsWith('pointer')) removed.push(t);
      return (origRemove as (...a: unknown[]) => void).call(this, t, ...rest);
    } as typeof HTMLCanvasElement.prototype.removeEventListener;

    try {
      view.mount();
      view.dispose();
    } finally {
      HTMLCanvasElement.prototype.addEventListener = origAdd;
      HTMLCanvasElement.prototype.removeEventListener = origRemove;
    }

    expect(added.sort()).toEqual(['pointerdown', 'pointermove', 'pointerup']);
    expect(removed.sort()).toEqual(added.sort());
  });
});

describe('HomeGlobe tile-loading manager (GL-11)', () => {
  it('leaves the global manager untouched once the last globe is gone', () => {
    const sentinelLoad = () => {};
    const sentinelProgress = () => {};
    THREE.DefaultLoadingManager.onLoad = sentinelLoad;
    THREE.DefaultLoadingManager.onProgress = sentinelProgress;

    const a = newGlobe();
    const b = newGlobe();
    a.mount();
    b.mount();
    a.dispose();
    b.dispose();

    expect(THREE.DefaultLoadingManager.onLoad).toBe(sentinelLoad);
    expect(THREE.DefaultLoadingManager.onProgress).toBe(sentinelProgress);
  });

  it('keeps delivering tile progress to a live globe after another one disposes', async () => {
    const a = newGlobe();
    const b = newGlobe();
    let bSurfaceReady = false;
    b.onSurfaceReady = () => { bSurfaceReady = true; };
    a.mount();
    b.mount();
    // Save/restore hands the single global slot to whichever instance disposes
    // first, silently discarding the other's live handler.
    a.dispose();

    THREE.DefaultLoadingManager.onProgress?.(TILE_URL, 1, 1);
    THREE.DefaultLoadingManager.onLoad?.();
    await nextFrame();
    await nextFrame();

    expect(bSurfaceReady).toBe(true);
  });

  it('stops delivering to a disposed globe', async () => {
    const a = newGlobe();
    const b = newGlobe();
    let aSurfaceReady = false;
    a.onSurfaceReady = () => { aSurfaceReady = true; };
    a.mount();
    b.mount();
    a.dispose();

    THREE.DefaultLoadingManager.onProgress?.(TILE_URL, 1, 1);
    THREE.DefaultLoadingManager.onLoad?.();
    await nextFrame();
    await nextFrame();

    expect(aSurfaceReady).toBe(false);
  });
});
