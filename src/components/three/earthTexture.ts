import * as THREE from 'three';

/**
 * Builds the globe's surface texture by rasterising real coastline data
 * (Natural Earth, public domain) onto a canvas.
 *
 * Drawn rather than shipped as a photo so the map takes its colours from the
 * active theme, stays a modest download, and works with no network.
 */

/** Equirectangular canvas size. Wide enough to stay clean when zoomed in. */
const TEX_WIDTH = 4096;
const TEX_HEIGHT = 2048;

export interface EarthColors {
  ocean: string;
  land: string;
  coast: string;
  graticule: string;
}

/**
 * Land is drawn as a translucent wash over the ocean colour rather than a
 * solid fill, so one set of alphas gives usable contrast in all six themes
 * without hand-picking a land colour per theme.
 */
const LAND_ALPHA = 0.34;
const COAST_ALPHA = 0.55;
const GRATICULE_ALPHA = 0.18;

type Ring = [number, number][];

/** Equirectangular projection into texture pixels. */
const px = (lon: number) => ((lon + 180) / 360) * TEX_WIDTH;
const py = (lat: number) => ((90 - lat) / 180) * TEX_HEIGHT;

let landPromise: Promise<Path2D> | null = null;

/**
 * The coastlines as one ready-to-paint path, in texture pixels.
 *
 * Built once per session and shared, because building it is the whole cost of
 * this module. Measured at 4x CPU throttle on the 1421 rings / 60,629 vertices
 * of land-50m: 240ms to walk the rings into a Path2D, and 1ms to fill and
 * stroke that path onto the 4096x2048 canvas. Only the colours change between
 * themes and between mounts, and colours are the 1ms half — so the path is
 * cached and every rebuild after the first is effectively free.
 *
 * The projection is baked in, which is why TEX_WIDTH/TEX_HEIGHT have to be
 * constants: a cached path is only valid for the canvas size it was measured
 * against. A Path2D holds coordinates, not pixels, so caching it costs about a
 * megabyte rather than the 32MB a cached canvas would pin for the whole
 * session.
 */
async function loadLandPath(): Promise<Path2D> {
  if (!landPromise) {
    landPromise = (async () => {
      const [{ feature }, topo] = await Promise.all([
        import('topojson-client'),
        import('world-atlas/land-50m.json'),
      ]);
      // The JSON import is typed structurally (number[] where topojson wants
      // fixed-length tuples), so go through unknown rather than fight it.
      const topology = ((topo as { default?: unknown }).default ?? topo) as unknown as Parameters<
        typeof feature
      >[0];
      const objects = (topology as unknown as { objects: Record<string, never> }).objects;
      const rings = flattenRings(feature(topology, objects.land));
      if (!rings.length) throw new Error('no coastline rings decoded');
      return buildLandPath(rings);
    })();
  }
  return landPromise;
}

/**
 * Every landmass goes into one path so the translucent fill is applied once.
 * Filling ring by ring would compound the alpha wherever they overlap and
 * leave islands darker than continents.
 */
function buildLandPath(rings: Ring[]): Path2D {
  const land = new Path2D();
  for (const ring of rings) {
    for (const piece of splitAtAntimeridian(ring)) {
      piece.forEach(([lon, lat], i) => {
        const x = px(lon);
        const y = py(lat);
        if (i === 0) land.moveTo(x, y);
        else land.lineTo(x, y);
      });
      land.closePath();
    }
  }
  return land;
}

/**
 * Pull every ring out of whatever GeoJSON shape topojson hands back. The land
 * object is a GeometryCollection, so `feature()` returns a FeatureCollection
 * rather than a bare polygon — handle every level rather than assuming one.
 */
function flattenRings(node: unknown): Ring[] {
  const out: Ring[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const shape = value as {
      type?: string;
      features?: unknown[];
      geometries?: unknown[];
      geometry?: unknown;
      coordinates?: unknown;
    };

    if (shape.features) shape.features.forEach(visit);
    if (shape.geometries) shape.geometries.forEach(visit);
    if (shape.geometry) visit(shape.geometry);

    if (shape.type === 'Polygon') {
      (shape.coordinates as Ring[]).forEach((ring) => out.push(ring));
    } else if (shape.type === 'MultiPolygon') {
      (shape.coordinates as Ring[][]).forEach((polygon) =>
        polygon.forEach((ring) => out.push(ring))
      );
    }
  };
  visit(node);
  return out;
}

/**
 * A ring that crosses the antimeridian would otherwise be drawn as a band
 * straight across the map, so split it where the longitude jumps.
 */
function splitAtAntimeridian(ring: Ring): Ring[] {
  const pieces: Ring[] = [];
  let current: Ring = [];

  for (let i = 0; i < ring.length; i++) {
    const point = ring[i];
    if (i > 0 && Math.abs(point[0] - ring[i - 1][0]) > 180) {
      pieces.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length) pieces.push(current);
  return pieces.filter((p) => p.length > 1);
}

export async function buildEarthTexture(colors: EarthColors): Promise<THREE.CanvasTexture> {
  const land = await loadLandPath();

  const canvas = document.createElement('canvas');
  canvas.width = TEX_WIDTH;
  canvas.height = TEX_HEIGHT;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = colors.ocean;
  ctx.fillRect(0, 0, TEX_WIDTH, TEX_HEIGHT);

  ctx.lineJoin = 'round';
  ctx.globalAlpha = LAND_ALPHA;
  ctx.fillStyle = colors.land;
  ctx.fill(land);

  ctx.globalAlpha = COAST_ALPHA;
  ctx.strokeStyle = colors.coast;
  ctx.lineWidth = 2;
  ctx.stroke(land);

  // Graticule every 30°, drawn into the texture so it scales with zoom.
  ctx.globalAlpha = GRATICULE_ALPHA;
  ctx.strokeStyle = colors.graticule;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let lon = -180; lon <= 180; lon += 30) {
    ctx.moveTo(px(lon), 0);
    ctx.lineTo(px(lon), TEX_HEIGHT);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    ctx.moveTo(0, py(lat));
    ctx.lineTo(TEX_WIDTH, py(lat));
  }
  ctx.stroke();

  // Equator, a touch stronger.
  ctx.globalAlpha = GRATICULE_ALPHA * 2;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, py(0));
  ctx.lineTo(TEX_WIDTH, py(0));
  ctx.stroke();

  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
