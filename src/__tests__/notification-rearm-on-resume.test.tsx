import { renderHook, act } from '@testing-library/react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { AllProviders } from '../test/helpers';
import { useNotifications } from '../hooks/useNotifications';
import { scheduleNotifications } from '../services/notificationService';

vi.mock('../services/notificationService', () => ({
  scheduleNotifications: vi.fn().mockResolvedValue(undefined),
  scheduleJumuahNotifications: vi.fn().mockResolvedValue(undefined),
  scheduleSurahKahfNotifications: vi.fn().mockResolvedValue(undefined),
  setupNotificationListeners: vi.fn(() => () => {}),
}));

vi.mock('../plugins/athanPlugin', () => ({
  AthanPlugin: {
    canScheduleExactAlarms: vi.fn().mockResolvedValue({ value: true }),
    isIgnoringBatteryOptimizations: vi.fn().mockResolvedValue({ value: true }),
  },
}));

/**
 * Issue #51: prayer notifications are armed seven days ahead and were only
 * rebuilt on launch or a settings change. Someone who kept the app in the
 * background for a week lost their notifications on day 8. Coming back to the
 * app on a later day now tops the window up; coming back the same day does
 * not, so an ordinary foreground doesn't churn the whole schedule.
 */
type AppStateListener = (state: { isActive: boolean }) => void;
const DAY = 24 * 60 * 60 * 1000;

function fireAppResume() {
  for (const [event, callback] of vi.mocked(CapApp.addListener).mock.calls) {
    if (event === 'appStateChange') (callback as AppStateListener)({ isActive: true });
  }
}

async function mount() {
  const hook = renderHook(() => useNotifications(true), { wrapper: AllProviders });
  // Two acts: the contexts hydrate in the first, and the 300ms schedule
  // debounce they unblock only runs in the second.
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(scheduleNotifications).toHaveBeenCalledTimes(1);
  return hook;
}

describe('User story: my prayer notifications keep coming even if I rarely open the app', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false, media: query, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
      })),
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 21, 10, 0, 0));
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    vi.mocked(CapApp.addListener).mockResolvedValue({ remove: vi.fn() } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('tops the schedule up when the app comes back on a later day', async () => {
    await mount();
    vi.mocked(scheduleNotifications).mockClear();

    vi.setSystemTime(Date.now() + 5 * DAY);
    await act(async () => {
      fireAppResume();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(scheduleNotifications).toHaveBeenCalledTimes(1);
  });

  it('counts a new calendar day, not 24 hours', async () => {
    // Scheduled at 11 PM; back at 7 AM. The window's last day is already a
    // day shorter than it should be.
    vi.setSystemTime(new Date(2026, 8, 21, 23, 0, 0));
    await mount();
    vi.mocked(scheduleNotifications).mockClear();

    vi.setSystemTime(new Date(2026, 8, 22, 7, 0, 0));
    await act(async () => {
      fireAppResume();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(scheduleNotifications).toHaveBeenCalledTimes(1);
  });

  it('leaves the schedule alone when the app comes back the same day', async () => {
    await mount();
    vi.mocked(scheduleNotifications).mockClear();

    vi.setSystemTime(Date.now() + 3 * 60 * 60 * 1000);
    await act(async () => {
      fireAppResume();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(scheduleNotifications).not.toHaveBeenCalled();
  });

  it('works off Android too', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    await mount();
    vi.mocked(scheduleNotifications).mockClear();

    vi.setSystemTime(Date.now() + 2 * DAY);
    await act(async () => {
      fireAppResume();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(scheduleNotifications).toHaveBeenCalledTimes(1);
  });
});
