import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Base3D } from '../components/three/base3d';

/**
 * User story: I open the Qibla screen a few times and the app does not swell.
 *
 * Measured on a Pixel 10 Pro XL: opening the Qibla screen took the app's
 * graphics memory from 131MB to 267MB, and closing it gave none of that back.
 * Three opens left it at 514MB and still climbing, because a WebGL context
 * keeps its allocation inside the GPU driver and nothing in JavaScript can
 * reach it — disposing every texture, geometry and material and removing the
 * canvas all leave it exactly where it was. Losing the context is the one
 * thing that releases it.
 */
const ctl = vi.hoisted(() => ({
  listeners: {} as Record<string, Array<() => void>>,
  disposed: 0,
  contextLost: 0,
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    domElement = document.createElement('canvas');
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() { ctl.disposed++; }
    forceContextLoss() { ctl.contextLost++; }
    info = { programs: [], reset: () => {} };
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

vi.mock('three/addons/controls/OrbitControls.js', () => {
  class FakeOrbitControls {
    enableZoom = true;
    enablePan = true;
    enableDamping = true;
    dampingFactor = 0;
    rotateSpeed = 1;
    zoomSpeed = 1;
    minDistance = 0;
    maxDistance = 0;
    touches = {};
    target = { copy: () => {}, clone: () => ({ length: () => 1 }), set: () => {} };
    autoRotate = false;
    addEventListener(type: string, fn: () => void) {
      (ctl.listeners[type] ??= []).push(fn);
    }
    update() {}
    dispose() {}
  }
  return { OrbitControls: FakeOrbitControls };
});

class TestView extends Base3D<{ n: number }> {
  protected build(): void {}
}

let host: HTMLElement;

beforeEach(() => {
  ctl.listeners = {};
  ctl.disposed = 0;
  ctl.contextLost = 0;
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
  vi.unstubAllGlobals();
});

describe('User story: closing a 3D view gives its graphics memory back', () => {
  it('loses the WebGL context, not just the objects drawn with it', () => {
    const view = new TestView(host, { n: 0 });
    view.mount();
    expect(ctl.contextLost).toBe(0);

    view.dispose();

    expect(ctl.disposed).toBe(1);
    expect(ctl.contextLost).toBe(1);
  });

  it('takes the canvas out of the page as well', () => {
    const view = new TestView(host, { n: 0 });
    view.mount();
    expect(host.querySelector('canvas')).not.toBeNull();

    view.dispose();

    expect(host.querySelector('canvas')).toBeNull();
  });
});
