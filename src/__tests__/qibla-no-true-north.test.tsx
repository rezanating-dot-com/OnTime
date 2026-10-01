import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * On iOS the heading comes from the orientation event's webkitCompassHeading.
 * Without it, the only number left is alpha, which iOS measures from wherever
 * the phone pointed when the listener started rather than from north. That
 * used to be turned into a heading anyway; the compass now says it is
 * unavailable instead of pointing the wrong way.
 */
const motion = vi.hoisted(() => ({
  emit: null as null | ((event: Record<string, number | undefined>) => void),
}));

vi.mock('@capacitor/motion', () => ({
  Motion: {
    addListener: (_name: string, cb: (event: Record<string, number | undefined>) => void) => {
      motion.emit = cb;
      return Promise.resolve({ remove: () => {} });
    },
  },
}));

vi.mock('../plugins/athanPlugin', () => ({ AthanPlugin: {} }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'ios', isNativePlatform: () => true },
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: vi.fn().mockResolvedValue(undefined) },
  ImpactStyle: { Medium: 'MEDIUM' },
}));

vi.mock('../context/LocationContext', () => ({
  useLocation: () => ({ location: { coordinates: { latitude: 41.0082, longitude: 28.9784 }, cityName: 'Istanbul' } }),
}));

import { useQiblaHeading } from '../hooks/useQiblaHeading';

beforeEach(() => {
  motion.emit = null;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function startAndEmit(event: Record<string, number | undefined>) {
  const { result } = renderHook(() => useQiblaHeading(true));
  await act(async () => {});
  expect(motion.emit).not.toBeNull();
  await act(async () => {
    motion.emit!(event);
  });
  return result.current;
}

describe('iOS compass without a true-north heading', () => {
  it('reports the compass unavailable instead of a heading built from alpha', async () => {
    const compass = await startAndEmit({ alpha: 90, beta: 0, gamma: 0 });
    expect(compass.unavailable).toBe(true);
    expect(compass.calibrated).toBe(false);
    expect(compass.aligned).toBe(false);
  });

  it('still uses webkitCompassHeading when the device gives one', async () => {
    const compass = await startAndEmit({ alpha: 90, beta: 0, gamma: 0, webkitCompassHeading: 152 });
    expect(compass.unavailable).toBe(false);
    expect(compass.calibrated).toBe(true);
    expect(compass.deviceHeading).toBe(152);
  });
});
