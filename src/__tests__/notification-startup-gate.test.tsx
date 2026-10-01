import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Preferences } from '@capacitor/preferences';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { AllProviders } from '../test/helpers';
import { useNotifications } from '../hooks/useNotifications';
import { scheduleNotifications } from '../services/notificationService';

/**
 * NT-16 / ST-12: what the app is allowed to do before its own state has
 * loaded, and NT-11: what a permission denial has to clean up.
 */
vi.mock('../services/notificationService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/notificationService')>();
  return {
    ...actual,
    scheduleNotifications: vi.fn().mockResolvedValue(undefined),
    scheduleJumuahNotifications: vi.fn().mockResolvedValue(undefined),
    scheduleSurahKahfNotifications: vi.fn().mockResolvedValue(undefined),
    setupNotificationListeners: vi.fn(() => () => {}),
  };
});

vi.mock('../plugins/athanPlugin', () => ({
  AthanPlugin: {
    canScheduleExactAlarms: vi.fn().mockResolvedValue({ value: true }),
    isIgnoringBatteryOptimizations: vi.fn().mockResolvedValue({ value: true }),
  },
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the first schedule waits for the app to know its own settings (NT-16/ST-12)', () => {
  it('does not build a schedule from defaults and the seed coordinates', async () => {
    // Settings and location both resolve late. App gates on onboarding only,
    // and useNotifications read neither loading flag — so the 300ms debounce
    // could fire first and arm a whole week from the defaults and the Mecca
    // fallback: transient, self-healing, and a wasted schedule/cancel cycle
    // that can flash the OS permission dialog at a user who opted out.
    let releaseSettings: () => void = () => {};
    const settingsGate = new Promise<void>((r) => { releaseSettings = r; });
    vi.mocked(Preferences.get).mockImplementation(async ({ key }) => {
      if (key === 'ontime_settings') {
        await settingsGate;
        return { value: JSON.stringify({ distanceUnit: 'km' }) };
      }
      return { value: null };
    });

    renderHook(() => useNotifications(true), { wrapper: AllProviders });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(scheduleNotifications).not.toHaveBeenCalled();

    // Two acts: inside one, React flushes the state update only at the end,
    // so advancing the clock in the same act runs past the debounce before the
    // effect that arms it has re-run.
    await act(async () => { releaseSettings(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    // …and once it has hydrated, it schedules exactly once.
    expect(scheduleNotifications).toHaveBeenCalledTimes(1);
  });
});

describe('a denied permission cleans up after itself (NT-11)', () => {
  it('cancels the prayer range instead of leaving old alarms armed', async () => {
    const real = await vi.importActual<typeof import('../services/notificationService')>(
      '../services/notificationService',
    );

    vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'denied' } as never);
    vi.mocked(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'denied' } as never);
    // Left over from a run when permission was still granted, or from a
    // previous install: ids 101/102 are Fajr's, 301 is Dhuhr's.
    (LocalNotifications as unknown as Record<string, unknown>).getPending = vi
      .fn()
      .mockResolvedValue({ notifications: [{ id: 101 }, { id: 102 }, { id: 301 }, { id: 1300 }] });
    vi.mocked(LocalNotifications.cancel).mockResolvedValue(undefined);

    await real.scheduleNotifications(
      { latitude: 43.6532, longitude: -79.3832 },
      {
        calculationMethod: 'NorthAmerica',
        asrCalculation: 'Standard',
        notifications: {
          enabled: true,
          defaultSound: 'default',
          defaultReminderMinutes: 15,
          prayers: {
            fajr: { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default', endReminderMinutes: [] },
            sunrise: { enabled: false, reminderMinutes: 0, atPrayerTime: false, sound: 'default', endReminderMinutes: [] },
            dhuhr: { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default', endReminderMinutes: [] },
            asr: { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default', endReminderMinutes: [] },
            maghrib: { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default', endReminderMinutes: [] },
            isha: { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default', endReminderMinutes: [] },
          },
        },
        athan: {
          downloadedAthans: [],
          selectedAthanId: null,
          selectedFajrAthanId: null,
          currentChannelId: null,
          currentFajrChannelId: null,
        },
      },
    );

    // It used to return before the cancel, so a user who had just revoked
    // notifications could still be woken by the schedule armed before that.
    expect(LocalNotifications.cancel).toHaveBeenCalled();
    const cancelled = vi
      .mocked(LocalNotifications.cancel)
      .mock.calls.flatMap(([arg]) => (arg as { notifications: { id: number }[] }).notifications)
      .map((n) => n.id);
    expect(cancelled).toEqual(expect.arrayContaining([101, 102, 301]));
    // …and only the prayer range: the travel prompt at 1300 is another
    // category's and is not this function's to wipe.
    expect(cancelled).not.toContain(1300);
    expect(scheduleNotifications).not.toHaveBeenCalled();
  });
});
