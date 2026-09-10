import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * User story: I open the Qibla screen, close it, switch theme, and open it
 * again. The map should redraw in the new colours without the app stalling
 * each time.
 *
 * Painting the coastlines onto the 4096x2048 map is two separate jobs, and
 * they cost wildly different amounts. Walking land-50m's 1421 rings and 60,629
 * vertices into a path measured 240ms at 4x CPU throttle; filling and stroking
 * that path measured 1ms. Only the colours differ between one build and the
 * next, so the 240ms half must happen once per session and the 1ms half every
 * time.
 */

const ctl = vi.hoisted(() => ({
  pathsConstructed: 0,
  vertices: 0,
  fills: [] as string[],
  strokes: [] as string[],
}));

class FakePath2D {
  constructor() {
    ctl.pathsConstructed++;
  }
  moveTo() {
    ctl.vertices++;
  }
  lineTo() {
    ctl.vertices++;
  }
  closePath() {}
}

// Two triangles either side of the antimeridian, enough to exercise the ring
// walk without pulling in the real 533kB dataset.
vi.mock('topojson-client', () => ({
  feature: () => ({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 0],
            ],
          ],
        },
      },
    ],
  }),
}));
vi.mock('world-atlas/land-50m.json', () => ({ default: { objects: { land: {} } } }));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeCanvasTexture {
    colorSpace = '';
    anisotropy = 0;
    needsUpdate = false;
    dispose() {}
  }
  return { ...actual, CanvasTexture: FakeCanvasTexture };
});

let origGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  ctl.pathsConstructed = 0;
  ctl.vertices = 0;
  ctl.fills = [];
  ctl.strokes = [];
  vi.stubGlobal('Path2D', FakePath2D);

  origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => {
    const ctx = {
      lineJoin: '',
      lineWidth: 0,
      globalAlpha: 1,
      fillStyle: '',
      strokeStyle: '',
      fillRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      fill: () => ctl.fills.push(ctx.fillStyle),
      stroke: () => ctl.strokes.push(ctx.strokeStyle),
    };
    return ctx;
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;
  vi.unstubAllGlobals();
  vi.resetModules();
});

const COLORS_A = { ocean: '#111', land: '#222', coast: '#333', graticule: '#444' };
const COLORS_B = { ocean: '#aaa', land: '#bbb', coast: '#ccc', graticule: '#ddd' };

describe('User story: reopening the Qibla map, and switching theme under it', () => {
  it('walks the coastline vertices once however many times the map is drawn', async () => {
    const { buildEarthTexture } = await import('../components/three/earthTexture');

    await buildEarthTexture(COLORS_A);
    const afterFirst = { paths: ctl.pathsConstructed, vertices: ctl.vertices };

    await buildEarthTexture(COLORS_B);
    await buildEarthTexture(COLORS_A);

    expect(afterFirst.paths).toBe(1);
    expect(afterFirst.vertices).toBeGreaterThan(0);
    // Three maps drawn, one coastline walk.
    expect(ctl.pathsConstructed).toBe(1);
    expect(ctl.vertices).toBe(afterFirst.vertices);
  });

  it('still repaints in each theme’s own colours', async () => {
    const { buildEarthTexture } = await import('../components/three/earthTexture');

    await buildEarthTexture(COLORS_A);
    await buildEarthTexture(COLORS_B);

    expect(ctl.fills).toEqual([COLORS_A.land, COLORS_B.land]);
    // Coast stroke, graticule, then the equator, per build.
    expect(ctl.strokes).toEqual([
      COLORS_A.coast,
      COLORS_A.graticule,
      COLORS_A.graticule,
      COLORS_B.coast,
      COLORS_B.graticule,
      COLORS_B.graticule,
    ]);
  });
});
