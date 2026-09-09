import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { HomeGlobe } from '../components/three/homeGlobe';
import { BASE_4K, BASE_8K } from '../components/three/earthBaseTexture';

/**
 * The globe's surface is the bundled Blue Marble, not the Esri tile stream.
 *
 * A slippy tile level L is 256 * 2^L px around the equator; the bundled photo
 * is its own width. At the default home framing (2.5) the engine picks level 2
 * — 1024 px, an eighth of the 8192 photo — which is why the globe used to get
 * blurrier the moment tiles landed, on every launch, cache or no cache.
 *
 * jsdom has no WebGL context, so readDeviceCaps() reports maxTextureSize 0 and
 * the chooser lands on the 4096 texture: the altitudes below are therefore the
 * 4K gate (enable under 0.5, hold until 0.6). The 8K gate is covered by the
 * derivation tests in earth-base-texture.test.ts.
 *
 * These tests pin both halves of the fix: the texture is big enough to be
 * worth deferring to, and the tile engine stays switched off until the camera
 * is close enough for it to actually win.
 */

const harness = vi.hoisted(() => ({
  globes: [] as FakeGlobeShape[],
  tileUrls: [] as unknown[],
}));

interface FakeGlobeShape {
  sceneObj: THREE.Scene;
  cameraObj: THREE.PerspectiveCamera;
  material: THREE.MeshPhongMaterial;
  globeMesh: THREE.Mesh;
  readyCb?: () => void;
  zoomCb?: () => void;
  altitude: number;
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
    zoomCb?: () => void;
    /** Drives pointOfView(), the same value the tile engine reads. */
    altitude = 2.5;
    private controlsObj = {
      autoRotate: false, enablePan: true, rotateSpeed: 1, zoomSpeed: 1,
      minDistance: 0, maxDistance: 0, enabled: true,
      target: new T.Vector3(), addEventListener: () => {}, update: () => {},
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
    globeTileEngineUrl(url: unknown) { harness.tileUrls.push(url); return this; }
    onZoom(cb: () => void) { this.zoomCb = cb; return this; }
    onGlobeReady(cb: () => void) { this.readyCb = cb; return this; }
    scene() { return this.sceneObj; }
    camera() { return this.cameraObj; }
    renderer() { return this.rendererObj; }
    controls() { return this.controlsObj; }
    globeMaterial() { return this.material; }
    pointOfView() { return { lat: 0, lng: 0, altitude: this.altitude }; }
    getCoords() { return { x: 0, y: 0, z: 0 }; }
    pauseAnimation() {}
    resumeAnimation() {}

    flushDeferredInit() {
      this.sceneObj.add(this.globeMesh);
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

let origGetContext: typeof HTMLCanvasElement.prototype.getContext;
const hosts: HTMLElement[] = [];
const views: HomeGlobe[] = [];

const newGlobe = () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  hosts.push(el);
  const view = new HomeGlobe(el, data);
  views.push(view);
  return view;
};

/** Mount, let globe.gl's deferred init land, and run onGlobeReady. */
async function bringUp(view: HomeGlobe) {
  view.mount();
  const fake = harness.globes[harness.globes.length - 1];
  fake.flushDeferredInit();
  fake.readyCb?.();
  await nextFrame();
  return fake;
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
  harness.tileUrls.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  for (const v of views) v.dispose();
  views.length = 0;
  for (const h of hosts) h.remove();
  hosts.length = 0;
  HTMLCanvasElement.prototype.getContext = origGetContext;
  vi.unstubAllGlobals();
});

/** Width from the first SOFn marker, so the assertion reads the real file. */
function jpegWidth(path: string): number {
  const buf = readFileSync(path);
  let i = 2; // skip SOI
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    // SOF0-SOF15, excluding the non-frame markers DHT (c4), JPGA (c8), DAC (cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return buf.readUInt16BE(i + 7);
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error(`no SOF marker in ${path}`);
}

describe('bundled earth texture', () => {
  it('ships both sizes at exactly the widths the gate is derived from', () => {
    // The chooser picks between these two and the gate altitude is computed
    // from whichever it picked, so a file that is not the width the code
    // believes it is puts the gate at the wrong altitude on that device.
    // 8192 is also GL_MAX_TEXTURE_SIZE on the target hardware — anything larger
    // is downscaled straight back by three.js, so it is the ceiling, not a step.
    expect(jpegWidth(`public${BASE_8K.url}`)).toBe(BASE_8K.width);
    expect(jpegWidth(`public${BASE_4K.url}`)).toBe(BASE_4K.width);
  });
});

describe('HomeGlobe offline-first surface', () => {
  it('never requests Esri tiles at the default home framing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = newGlobe();
    view.mount();
    const fake = harness.globes[0];
    fake.altitude = 2.5;
    fake.flushDeferredInit();
    fake.readyCb?.();
    // Past the "base texture failed" safety net, which used to switch tiles on
    // unconditionally and so defeated any gate in front of it.
    vi.advanceTimersByTime(10_000);
    expect(harness.tileUrls).toHaveLength(0);
  });

  it('keeps tiles off through the "My location" fly-in', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = newGlobe();
    view.mount();
    const fake = harness.globes[0];
    fake.flushDeferredInit();
    fake.readyCb?.();
    // FOCUS_ALTITUDE, which is the 4K gate's own boundary: level 4 is 4096px,
    // exactly the texture, so there is nothing to gain by fetching it.
    fake.altitude = 0.5;
    fake.zoomCb?.();
    vi.advanceTimersByTime(10_000);
    expect(harness.tileUrls).toHaveLength(0);
  });

  it('switches tiles on once the camera zooms past the bundled resolution', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = newGlobe();
    view.mount();
    const fake = harness.globes[0];
    fake.flushDeferredInit();
    fake.readyCb?.();
    vi.advanceTimersByTime(10_000);
    expect(harness.tileUrls).toHaveLength(0);

    fake.altitude = 0.3; // level 5: 8192px, finally sharper than the 4K base
    fake.zoomCb?.();
    expect(harness.tileUrls).toHaveLength(1);

    const urlFn = harness.tileUrls[0] as (x: number, y: number, l: number) => string;
    expect(urlFn(1, 2, 5)).toContain('server.arcgisonline.com');
  });

  it('switches tiles back off when the camera pulls out again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = newGlobe();
    view.mount();
    const fake = harness.globes[0];
    fake.flushDeferredInit();
    fake.readyCb?.();
    vi.advanceTimersByTime(10_000);

    fake.altitude = 0.3;
    fake.zoomCb?.();
    expect(harness.tileUrls).toHaveLength(1);
    expect(harness.tileUrls[0]).toBeTypeOf('function');

    // Back out to the home framing. A one-way gate would leave the coarse
    // level-2 mosaic covering the bundled photo for the rest of the session —
    // the same soft globe the user reported, just without a relaunch.
    fake.altitude = 2.5;
    fake.zoomCb?.();
    expect(harness.tileUrls).toHaveLength(2);
    expect(harness.tileUrls[1]).toBeNull();

    // And on again when they come back in.
    fake.altitude = 0.3;
    fake.zoomCb?.();
    expect(harness.tileUrls).toHaveLength(3);
    expect(harness.tileUrls[2]).toBeTypeOf('function');
  });

  it('does not flip the engine on and off across the threshold', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = newGlobe();
    view.mount();
    const fake = harness.globes[0];
    fake.flushDeferredInit();
    fake.readyCb?.();
    fake.altitude = 0.45;
    fake.zoomCb?.();
    expect(harness.tileUrls).toHaveLength(1);

    // A pinch resting on the boundary: inside the hysteresis band, so the
    // engine holds rather than toggling once per frame.
    for (const alt of [0.5, 0.55, 0.49, 0.58, 0.51]) {
      fake.altitude = alt;
      fake.zoomCb?.();
    }
    expect(harness.tileUrls).toHaveLength(1);
  });

  it('streams real imagery in ground view, and gives it back on the way out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = newGlobe();
    view.mount();
    const fake = harness.globes[0];
    fake.flushDeferredInit();
    fake.readyCb?.();
    vi.advanceTimersByTime(10_000);
    expect(harness.tileUrls).toHaveLength(0);

    // Ground view disables OrbitControls and flies the camera by hand, so no
    // onZoom is dispatched and pointOfView() goes stale — the gate has to be
    // driven from the mode change itself or the qibla line sits on a blurry
    // earth at eye level.
    view.update({ ...data, groundMode: true });
    expect(harness.tileUrls).toHaveLength(1);
    expect(harness.tileUrls[0]).toBeTypeOf('function');

    view.update({ ...data, groundMode: false });
    // Not yet: the camera is still down at ground level, mid fly-out.
    expect(harness.tileUrls).toHaveLength(1);
    fake.altitude = 2.5;
    vi.advanceTimersByTime(1000);
    expect(harness.tileUrls).toHaveLength(2);
    expect(harness.tileUrls[1]).toBeNull();
  });

  it('reveals the globe as soon as the base is on, without waiting for tiles', async () => {
    const view = newGlobe();
    const ready = vi.fn();
    // The React host attaches this before mount(); do the same, because at home
    // framing no tile ever arrives and nothing else can release the loader.
    view.onSurfaceReady = ready;
    await bringUp(view);
    await nextFrame();
    expect(ready).toHaveBeenCalled();
    expect(harness.tileUrls).toHaveLength(0);
  });
});
