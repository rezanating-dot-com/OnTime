import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  BASE_4K,
  BASE_8K,
  pickBaseTexture,
  readDeviceCaps,
  tileEnableAltitude,
  preloadBaseTexture,
} from '../components/three/earthBaseTexture';

/**
 * The 8192 photo costs ~131 MB of GPU memory on every device that loads it, and
 * a device whose GL_MAX_TEXTURE_SIZE is 4096 gets none of the benefit — it
 * still decodes all 33 megapixels and three.js discards half of them. So the
 * chooser has to be conservative in every direction it is unsure about.
 */
describe('picking the bundled earth texture', () => {
  it('takes the 8K photo on a device that can hold it', () => {
    expect(pickBaseTexture({ maxTextureSize: 8192, deviceMemory: 8 })).toBe(BASE_8K);
    expect(pickBaseTexture({ maxTextureSize: 16384, deviceMemory: 8 })).toBe(BASE_8K);
  });

  it('falls back when the GPU would downscale it anyway', () => {
    // The decode happens at full size before three.js resizes, so this device
    // would pay the whole cost and then throw the pixels away.
    expect(pickBaseTexture({ maxTextureSize: 4096, deviceMemory: 8 })).toBe(BASE_4K);
    expect(pickBaseTexture({ maxTextureSize: 2048, deviceMemory: 8 })).toBe(BASE_4K);
  });

  it('falls back when the device is short on memory', () => {
    expect(pickBaseTexture({ maxTextureSize: 8192, deviceMemory: 4 })).toBe(BASE_4K);
    expect(pickBaseTexture({ maxTextureSize: 8192, deviceMemory: 2 })).toBe(BASE_4K);
  });

  it('falls back when the device will not say how much memory it has', () => {
    // navigator.deviceMemory is Chromium-only. Absent means unknown, and an
    // unknown device is not one to hand a 131 MB texture to.
    expect(pickBaseTexture({ maxTextureSize: 8192 })).toBe(BASE_4K);
  });

  it('falls back where there is no WebGL context to ask', () => {
    // jsdom, a blocked context, a lost context during startup.
    expect(readDeviceCaps().maxTextureSize).toBe(0);
    expect(pickBaseTexture(readDeviceCaps())).toBe(BASE_4K);
  });
});

describe('deriving the tile gate from the texture', () => {
  it('puts the gate at the first slippy level that beats each photo', () => {
    // A level L grid is 256 * 2^L px around the equator and the engine selects
    // it below altitude 8 / 2^(L-1). The 8192 photo *is* level 5, so level 6
    // (altitude 0.25) is the first that carries more; the 4096 photo is level
    // 4, so level 5 (altitude 0.5) is.
    expect(tileEnableAltitude(BASE_8K.width)).toBe(0.25);
    expect(tileEnableAltitude(BASE_4K.width)).toBe(0.5);
  });

  it('never lets a sharper photo widen the window where tiles are fetched', () => {
    let previous = Infinity;
    for (const width of [1024, 2048, 4096, 8192, 16384]) {
      const gate = tileEnableAltitude(width);
      expect(gate).toBeLessThan(previous);
      previous = gate;
    }
  });
});

describe('preloading', () => {
  afterEach(() => {
    document.head.querySelectorAll('link[rel="preload"]').forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  it('starts the fetch for the texture that was actually chosen', () => {
    preloadBaseTexture();
    const link = document.head.querySelector('link[rel="preload"]') as HTMLLinkElement;
    expect(link).toBeTruthy();
    expect(link.as).toBe('image');
    // jsdom reports no WebGL, so this is the 4K path.
    expect(link.getAttribute('href')).toBe(BASE_4K.url);
  });
});
