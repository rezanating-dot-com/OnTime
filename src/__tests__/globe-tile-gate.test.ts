import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { HomeGlobe } from '../components/three/homeGlobe';

/**
 * User story: I zoom out and the map still looks good.
 *
 * The globe has two sources of surface detail: a photo bundled with the app,
 * and Esri tiles streamed as you zoom. A slippy level L carries 256 * 2^L
 * pixels around the equator, and the level is picked from camera altitude — so
 * at the default framing of 2.5 the engine chose level 2, a thousand pixels
 * around the equator, and painted it over a photo worth four thousand. The map
 * got visibly worse about a second into every launch, and worse again every
 * time you zoomed back out.
 *
 * The stream is now gated on the altitude where tiles start carrying more
 * detail than the photo, and the gate runs both ways: a one-way gate would
 * leave the first pinch-in streaming coarse tiles for the rest of the session.
 */
const harness = vi.hoisted(() => ({ globe: null as unknown as FakeGlobeShape }));

interface FakeGlobeShape {
  cameraObj: THREE.PerspectiveCamera;
  sceneObj: THREE.Scene;
  readyCb?: () => void;
  tileUrls: (unknown)[];
  fireControlsChange(): void;
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
    /** Every value handed to globeTileEngineUrl: a function turns the stream
     *  on, null turns it off. */
    tileUrls: unknown[] = [];
    private changeListeners: (() => void)[] = [];
    private controlsObj = {
      autoRotate: false, enablePan: true, rotateSpeed: 1, zoomSpeed: 1,
      minDistance: 0, maxDistance: 0, enabled: true, target: new T.Vector3(),
      addEventListener: (event: string, fn: () => void) => {
        if (event === 'change') this.changeListeners.push(fn);
      },
      update: () => {},
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
    globeTileEngineUrl(v: unknown) { this.tileUrls.push(v); return this; }
    onZoom() { return this; }
    onGlobeReady(cb: () => void) { this.readyCb = cb; return this; }
    scene() { return this.sceneObj; }
    camera() { return this.cameraObj; }
    renderer() { return this.rendererObj; }
    controls() { return this.controlsObj; }
    globeMaterial() { return this.material; }
    pointOfView() { return { lat: 0, lng: 0, altitude: 2.5 }; }
    getCoords(lat: number, lon: number, alt: number) {
      const r = 100 * (1 + alt);
      const phi = ((90 - lat) * Math.PI) / 180;
      const theta = ((90 - lon) * Math.PI) / 180;
      const s = Math.sin(phi);
      return { x: r * s * Math.cos(theta), y: r * Math.cos(phi), z: r * s * Math.sin(theta) };
    }
    pauseAnimation() {}
    resumeAnimation() {}
    fireControlsChange() { this.changeListeners.forEach((fn) => fn()); }
    flushDeferredInit() {
      this.sceneObj.add(this.globeMesh);
      this.cameraObj.far = 125000;
      this.cameraObj.updateProjectionMatrix();
    }
  }
  return { default: FakeGlobe };
});

const GLOBE_RADIUS = 100;
const data = {
  now: new Date('2026-09-06T18:00:00Z'),
  latitude: 43.65,
  longitude: -79.38,
  prayers: [],
  fajrTwilightDeg: 18,
  ishaTwilightDeg: 17,
  asrShadowFactor: 1,
};

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

let host: HTMLElement;
let view: HomeGlobe;
let origGetContext: typeof HTMLCanvasElement.prototype.getContext;

/** Put the camera at a given altitude in globe-radius units and let the view react. */
function flyTo(altitude: number) {
  harness.globe.cameraObj.position.set(0, 0, GLOBE_RADIUS * (1 + altitude));
  harness.globe.fireControlsChange();
}

const streaming = () => {
  const last = harness.globe.tileUrls.at(-1);
  return typeof last === 'function';
};

beforeEach(async () => {
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

describe('User story: the surface at every altitude', () => {
  it('leaves the stream off at the default framing, where the photo is better', () => {
    flyTo(2.5);
    expect(streaming()).toBe(false);
  });

  it('turns the stream on once the tiles carry more detail than the photo', () => {
    flyTo(2.5);
    expect(streaming()).toBe(false);

    // The photo is 4096 wide, which is slippy level 4. Level 5 is the first
    // that beats it, and the engine reaches level 5 below altitude 0.5.
    flyTo(0.3);
    expect(streaming()).toBe(true);
  });

  it('turns it off again on the way back out', () => {
    flyTo(0.3);
    expect(streaming()).toBe(true);

    flyTo(2.5);
    expect(streaming()).toBe(false);
  });

  it('does not flap while a pinch hovers on the boundary', () => {
    flyTo(0.3);
    const afterOn = harness.globe.tileUrls.length;

    // Drifting either side of the enable point, but inside the hysteresis band,
    // must not touch the stream.
    flyTo(0.49);
    flyTo(0.52);
    flyTo(0.49);

    expect(harness.globe.tileUrls.length).toBe(afterOn);
    expect(streaming()).toBe(true);
  });

  it('streams in ground view, where the surface is metres away', () => {
    flyTo(2.5);
    expect(streaming()).toBe(false);

    // Ground view drops the camera to the user's own position.
    flyTo(0.01);
    expect(streaming()).toBe(true);
  });
});
