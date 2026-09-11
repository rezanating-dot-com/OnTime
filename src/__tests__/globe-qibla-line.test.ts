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
  /** Times the view has asked for the render loop to run. */
  wakes: 0,
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
      // The shape of the phone this is aimed at, not a 4:3 desktop frame: the
      // skew that a tall screen puts on every measured angle is the whole
      // reason the arrow's angle is worked out in pixels.
      getSize: (v: THREE.Vector2) => v.set(448, 997),
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
    resumeAnimation() { harness.wakes++; }
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
  harness.wakes = 0;
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

  it('moves the camera nowhere at all', () => {
    const cam = harness.globe.cameraObj;
    cam.position.set(0, 0, 420);
    const before = cam.position.clone();
    harness.povs = [];

    view.update({ ...data, qiblaMode: true } as never);

    // Asking which way to face is not asking to be thrown to a new distance.
    // Two earlier goes at this flew somewhere — to the middle of the line, and
    // then over the user — and both were a zoom as well as a turn.
    expect(harness.povs).toHaveLength(0);
    expect(cam.position.distanceTo(before)).toBe(0);

    view.update({ ...data, qiblaMode: false } as never);

    expect(harness.povs).toHaveLength(0);
    expect(cam.position.distanceTo(before)).toBe(0);
  });

  it('stands the line upright on the screen, and lays the horizon back flat after', () => {
    const cam = harness.globe.cameraObj;
    const here = at(data.latitude, data.longitude);
    const makkah = at(21.4225, 39.8262);
    const normal = here.clone().cross(makkah).normalize();

    view.update({ ...data, qiblaMode: true } as never);

    // Upright means: square to the direction the camera is looking, which is
    // straight down at where you are, and lying in the plane the line is drawn
    // in. A phone is far taller than it is wide, and a line to Makkah laid
    // across it runs out of frame in a quarter of the distance.
    expect(Math.abs(cam.up.dot(here))).toBeLessThan(1e-6);
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

  it('leaves the globe wherever it was left, however far that is from you', () => {
    // Dragged round to look at somewhere else entirely.
    const cam = harness.globe.cameraObj;
    cam.position.set(300, 120, -260);
    const before = cam.position.clone();

    view.update({ ...data, qiblaMode: true } as never);

    expect(cam.position.distanceTo(before)).toBe(0);
  });
});

/**
 * User story: the dot where I am becomes an arrow showing which way I face.
 *
 * A dot tells you where you are, which you knew. Turned into an arrow that
 * follows the phone, it tells you which way you are pointing — and lining it up
 * with the line to the Kaaba is the whole job, without having to read a number.
 *
 * The marker is a sprite, always square to the camera, so the arrow is turned
 * in screen space: the facing direction is taken into the world at the
 * marker's own position, projected, and the sprite turned by the angle that
 * comes back. That keeps it right however the globe has been turned or rolled,
 * where an arrow laid flat on the surface would be squashed to a line near the
 * edge of the disc.
 */
describe('User story: the marker that shows which way I am facing', () => {
  const marker = () => harness.globe.sceneObj.getObjectByName('location') as THREE.Sprite;

  /** Stand in for a frame: the rotation is worked out as the marker is drawn. */
  const draw = () => {
    const cam = harness.globe.cameraObj;
    cam.position.copy(marker().position).multiplyScalar(3);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    marker().onBeforeRender(
      null as never, null as never, cam, null as never, marker().material, null as never,
    );
    return (marker().material as THREE.SpriteMaterial).rotation;
  };

  it('stays a plain dot while the qibla is not up', () => {
    const dot = (marker().material as THREE.SpriteMaterial).map;

    view.update({ ...data, deviceHeading: 30, headingCalibrated: true } as never);

    expect((marker().material as THREE.SpriteMaterial).map).toBe(dot);
  });

  it('stays a plain dot while the reading cannot be trusted', () => {
    const dot = (marker().material as THREE.SpriteMaterial).map;

    // An arrow pointing at noise is worse than no arrow.
    view.update({ ...data, qiblaMode: true, deviceHeading: 30, headingCalibrated: false } as never);

    expect((marker().material as THREE.SpriteMaterial).map).toBe(dot);
  });

  it('becomes an arrow once the qibla is up and the reading has settled', () => {
    const dot = (marker().material as THREE.SpriteMaterial).map;

    view.update({ ...data, qiblaMode: true, deviceHeading: 30, headingCalibrated: true } as never);

    expect((marker().material as THREE.SpriteMaterial).map).not.toBe(dot);
  });

  it('goes back to the dot when the qibla is switched off', () => {
    const dot = (marker().material as THREE.SpriteMaterial).map;
    view.update({ ...data, qiblaMode: true, deviceHeading: 30, headingCalibrated: true } as never);
    expect((marker().material as THREE.SpriteMaterial).map).not.toBe(dot);

    view.update({ ...data, qiblaMode: false } as never);

    expect((marker().material as THREE.SpriteMaterial).map).toBe(dot);
    expect((marker().material as THREE.SpriteMaterial).rotation).toBe(0);
  });

  it('rests pointing the way the phone points, not a quarter or a half turn off it', () => {
    // On the equator at longitude zero, with the camera straight above and the
    // world's north up the screen, a phone pointing north is a phone pointing
    // up the screen. So the sprite should not be turned at all.
    //
    // This is the assertion that was missing when the arrow first shipped
    // pointing backwards: every other term was right, and the constant that
    // relates the drawn shape to the measured angle was guessed rather than
    // measured.
    view.update({
      ...data, latitude: 0, longitude: 0,
      qiblaMode: true, deviceHeading: 0, headingCalibrated: true,
    } as never);

    const cam = harness.globe.cameraObj;
    cam.position.set(0, 0, 600);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    marker().onBeforeRender(
      null as never, null as never, cam, null as never, marker().material, null as never,
    );

    expect((marker().material as THREE.SpriteMaterial).rotation).toBeCloseTo(0, 3);
  });

  it('leans the way the phone leans, not the mirror of it', () => {
    // Same frame as above: on the equator at longitude zero with the camera
    // straight above and the world's north up the screen, east is to the
    // right. A phone pointing east should put the arrow on its right side.
    //
    // This is the assertion that was missing when the arrow leaned the wrong
    // way on the device: pointing it up and turning it a half turn both work
    // whichever way round the sprite turns, so nothing here could tell.
    view.update({
      ...data, latitude: 0, longitude: 0,
      qiblaMode: true, deviceHeading: 90, headingCalibrated: true,
    } as never);

    const cam = harness.globe.cameraObj;
    cam.position.set(0, 0, 600);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    marker().onBeforeRender(
      null as never, null as never, cam, null as never, marker().material, null as never,
    );

    // A quarter turn, and the sign is the whole point: the other sign puts the
    // arrow out to the left while the guidance says to turn right.
    expect((marker().material as THREE.SpriteMaterial).rotation).toBeCloseTo(Math.PI / 2, 3);
  });

  it('asks for a frame when the phone turns, and stops asking when it is held still', () => {
    view.update({ ...data, qiblaMode: true, deviceHeading: 10, headingCalibrated: true } as never);

    // Nothing else on this globe moves for a compass reading, so the render
    // loop is parked. A turning phone has to ask for its own frames or the
    // arrow sticks while the guidance under it goes on updating.
    harness.wakes = 0;
    view.update({ ...data, qiblaMode: true, deviceHeading: 40, headingCalibrated: true } as never);
    expect(harness.wakes).toBeGreaterThan(0);

    // Held still, the filter goes on easing towards the same reading for ever.
    // Asking for a frame on any change at all would hold the loop open for the
    // life of the screen.
    for (let i = 0; i < 80; i++) {
      view.update({ ...data, qiblaMode: true, deviceHeading: 40, headingCalibrated: true } as never);
    }
    harness.wakes = 0;
    for (let i = 0; i < 20; i++) {
      view.update({ ...data, qiblaMode: true, deviceHeading: 40, headingCalibrated: true } as never);
    }
    expect(harness.wakes).toBe(0);
  });

  it('settles towards a new heading once per reading, not once per drawn frame', () => {
    view.update({ ...data, qiblaMode: true, deviceHeading: 0, headingCalibrated: true } as never);
    draw();

    // One reading of a heading a quarter turn away: the arrow should start
    // easing towards it.
    view.update({ ...data, qiblaMode: true, deviceHeading: 90, headingCalibrated: true } as never);
    const afterOneReading = draw();
    for (let i = 0; i < 10; i++) draw();
    const afterTenMoreFrames = draw();

    // Drawing the same state again is not the same as hearing from the
    // compass again. Advanced per frame, the easing would be finished by now
    // and would smooth nothing on a fast screen.
    expect(afterTenMoreFrames).toBeCloseTo(afterOneReading, 9);

    // A second reading does move it on.
    view.update({ ...data, qiblaMode: true, deviceHeading: 90, headingCalibrated: true } as never);
    expect(Math.abs(draw() - afterOneReading)).toBeGreaterThan(0.01);
  });

  it('turns the arrow right round when the phone turns right round', () => {
    view.update({ ...data, qiblaMode: true, deviceHeading: 0, headingCalibrated: true } as never);
    const north = draw();

    // Off and on again, so the smoothing starts from the new heading rather
    // than easing towards it over the next fifty frames.
    view.update({ ...data, qiblaMode: false } as never);
    view.update({ ...data, qiblaMode: true, deviceHeading: 180, headingCalibrated: true } as never);
    const south = draw();

    // Half a turn on the phone is half a turn on screen, exactly, whatever the
    // shape of the screen: reversing a direction reverses its projection.
    const apart = Math.abs(((south - north + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    expect(Math.PI - apart).toBeLessThan(0.02);
  });

  it('turns the arrow by a quarter when the phone turns by a quarter', () => {
    view.update({ ...data, qiblaMode: true, deviceHeading: 0, headingCalibrated: true } as never);
    const north = draw();

    view.update({ ...data, qiblaMode: false } as never);
    view.update({ ...data, qiblaMode: true, deviceHeading: 90, headingCalibrated: true } as never);
    const east = draw();

    // Not a quarter turn on screen to the decimal: the frame is more than
    // twice as tall as it is wide, and that skews every angle but a reversal.
    // Nowhere near standing still either.
    const apart = Math.abs(((east - north + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    expect(apart).toBeGreaterThan(0.8);
    expect(apart).toBeLessThan(2.4);
  });
});
