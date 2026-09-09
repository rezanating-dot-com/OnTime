/**
 * Which bundled Blue Marble the globe should use, decided once per launch.
 *
 * Both are the same NASA imagery (Visible Earth record 57752,
 * `land_shallow_topo_8192.tif`) — one at its native 8192x4096, one downsampled
 * to 4096x2048 — so the choice changes how sharp the earth is and nothing else
 * about how it looks.
 *
 * The 8192 photo is the better surface and doubles the range the globe renders
 * with no network, but it costs ~131 MB of GPU memory on every device that
 * loads it (measured: 300 MB vs 431 MB of Graphics PSS on a Pixel 10 Pro XL,
 * matching 8192*4096 RGBA plus mipmaps). A phone whose GL_MAX_TEXTURE_SIZE is
 * 4096 pays worse than that for nothing at all: the WebView still decodes all
 * 33 megapixels — around 100 MB of bitmap — and three.js then throws half of
 * them away (resizeImage in WebGLTextures). So decide before the fetch, and let
 * the devices that cannot use the detail skip the download entirely.
 */

export interface BaseTexture {
  url: string;
  /** Pixels around the equator; the tile gate is derived from it. */
  width: number;
}

export const BASE_8K: BaseTexture = { url: '/earth-base-8k.jpg', width: 8192 };
export const BASE_4K: BaseTexture = { url: '/earth-base-4k.jpg', width: 4096 };

export interface DeviceCaps {
  /** GL_MAX_TEXTURE_SIZE, or 0 when there is no WebGL context to ask. */
  maxTextureSize: number;
  /** navigator.deviceMemory in GB — capped at 8 by the spec, absent off Chromium. */
  deviceMemory?: number;
}

/**
 * The 8192 photo needs both a GPU that can hold it at full size and the memory
 * headroom to keep it there for the life of the process. `deviceMemory`
 * saturates at 8, so `>= 8` reads as "8 GB or more"; when it is missing
 * entirely we have no way to tell a flagship from a budget phone, and the safe
 * answer to that is the smaller texture.
 */
export function pickBaseTexture(caps: DeviceCaps): BaseTexture {
  if (caps.maxTextureSize < BASE_8K.width) return BASE_4K;
  if ((caps.deviceMemory ?? 0) < 8) return BASE_4K;
  return BASE_8K;
}

/**
 * Ask a throwaway context for the texture limit, then drop it — the globe's own
 * renderer does not exist yet at the point this has to be answered.
 *
 * Returns a maxTextureSize of 0 wherever WebGL is unavailable (jsdom, a blocked
 * context), which picks the smaller texture. That is the right default: no
 * WebGL means either no globe at all or a device we know nothing about.
 */
export function readDeviceCaps(): DeviceCaps {
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  let maxTextureSize = 0;
  try {
    // Feature-detect before touching a canvas. Environments with no WebGL at
    // all (jsdom under test, most notably) define neither constructor, and
    // asking them for a context is a noisy no-op.
    const hasWebGL =
      typeof WebGLRenderingContext !== 'undefined' || typeof WebGL2RenderingContext !== 'undefined';
    if (!hasWebGL) return { maxTextureSize, deviceMemory };
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      // Hand the context back rather than waiting for GC: browsers cap how many
      // live WebGL contexts a page may hold, and the globe still needs one.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    // Leave it at 0 — an unavailable context is a reason to be conservative,
    // not a reason to fail the launch.
  }
  return { maxTextureSize, deviceMemory };
}

let resolved: BaseTexture | undefined;

/** The chosen texture, decided on first call and stable for the session. */
export function baseTexture(): BaseTexture {
  return (resolved ??= pickBaseTexture(readDeviceCaps()));
}

/**
 * Altitude (in globe radii) below which the Esri stream carries more detail
 * than the bundled photo, and so is worth switching on.
 *
 * A slippy level L is 256 * 2^L px around the equator, and the engine selects
 * level L below altitude 8 / 2^(L-1). A photo `width` px wide is itself level
 * log2(width / 256), so the first level that beats it starts at
 * 8 / 2^log2(width/256) = 2048 / width: 0.25 for the 8192 photo, 0.5 for the
 * 4096 one. Derived rather than written down twice, so swapping the texture can
 * never leave the gate pointing at the wrong altitude.
 */
export function tileEnableAltitude(width: number): number {
  return 2048 / width;
}

/**
 * Start the fetch as early as the bundle runs. index.html cannot carry a static
 * preload any more — which of the two to want is not known until the GL limit
 * has been read — so this stands in for it, and still lands well before the
 * lazily-loaded globe scene mounts.
 */
export function preloadBaseTexture(): void {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'image';
  link.href = baseTexture().url;
  document.head.appendChild(link);
}
