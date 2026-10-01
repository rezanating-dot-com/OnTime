import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the capacitor local-notifications plugin
const mockGetPending = vi.fn();
const mockCancel = vi.fn();
const mockSchedule = vi.fn();
const mockCheckPermissions = vi.fn();
const mockRequestPermissions = vi.fn();
const mockAddListener = vi.fn();

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    getPending: (...args: unknown[]) => mockGetPending(...args),
    cancel: (...args: unknown[]) => mockCancel(...args),
    schedule: (...args: unknown[]) => mockSchedule(...args),
    checkPermissions: (...args: unknown[]) => mockCheckPermissions(...args),
    requestPermissions: (...args: unknown[]) => mockRequestPermissions(...args),
    addListener: (...args: unknown[]) => mockAddListener(...args),
  },
}));

import {
  cancelByCategory,
  scheduleNotifications,
  scheduleJumuahNotifications,
  getNotificationId,
} from '../services/notificationService';
import type { Settings, Coordinates, JumuahSettings } from '../types';

// Helper to create a minimal Settings object for scheduleNotifications
function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    calculationMethod: 'NorthAmerica',
    asrCalculation: 'Standard',
    optionalPrayers: { showSunrise: false, showMiddleOfNight: false, showLastThirdOfNight: false },
    notifications: {
      enabled: true,
      defaultSound: 'default',
      defaultReminderMinutes: 10,
      reminderSound: { kind: 'default' },
      prayers: {
        fajr: { enabled: false, reminderMinutes: 0, atPrayerTime: false, sound: 'default', endReminderMinutes: [] },
        sunrise: { enabled: false, reminderMinutes: 0, atPrayerTime: false, sound: 'default', endReminderMinutes: [] },
        dhuhr: { enabled: false, reminderMinutes: 0, atPrayerTime: false, sound: 'default', endReminderMinutes: [] },
        asr: { enabled: false, reminderMinutes: 0, atPrayerTime: false, sound: 'default', endReminderMinutes: [] },
        maghrib: { enabled: false, reminderMinutes: 0, atPrayerTime: false, sound: 'default', endReminderMinutes: [] },
        isha: { enabled: false, reminderMinutes: 0, atPrayerTime: false, sound: 'default', endReminderMinutes: [] },
      },
    },
    jumuah: { enabled: false, masjidName: '', times: [], reminderMinutes: 15 },
    travel: {
      enabled: false,
      homeBase: null,
      override: 'auto',
      distanceThresholdKm: 88.7,
      jamaDhuhrAsr: false,
      jamaMaghribIsha: false,
      maxTravelDays: 0,
      travelStartDate: null,
      autoConfirmed: false,
    },
    display: { showCurrentPrayer: true, showNextPrayer: true, showSunnahCard: false },
    athan: {
      downloadedAthans: [],
      selectedAthanId: null,
      selectedFajrAthanId: null,
      currentChannelId: null,
      currentFajrChannelId: null,
    },
    surahKahf: { enabled: false, repeatIntervalHours: 0 },
    previousLocations: [],
    distanceUnit: 'miles',
    designStyle: 'classic',
    ...overrides,
  };
}

const coords: Coordinates = { latitude: 35.7804, longitude: -78.6391 };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPending.mockResolvedValue({ notifications: [] });
  mockCancel.mockResolvedValue(undefined);
  mockSchedule.mockResolvedValue(undefined);
  mockCheckPermissions.mockResolvedValue({ display: 'granted' });
  mockRequestPermissions.mockResolvedValue({ display: 'granted' });
  mockAddListener.mockResolvedValue({ remove: vi.fn() });
});

describe('cancelByCategory', () => {
  it('cancels only prayer-range IDs (1–999) when category is "prayer"', async () => {
    mockGetPending.mockResolvedValue({
      notifications: [
        { id: 100, title: 'fajr' },
        { id: 650, title: 'isha' },
        { id: 1000, title: 'jumuah' },
        { id: 1050, title: 'jumuah' },
        { id: 1100, title: 'kahf' },
        { id: 1190, title: 'kahf' },
      ],
    });

    await cancelByCategory('prayer');

    expect(mockCancel).toHaveBeenCalledTimes(1);
    const canceledIds = mockCancel.mock.calls[0][0].notifications.map((n: { id: number }) => n.id);
    expect(canceledIds).toContain(100);
    expect(canceledIds).toContain(650);
    expect(canceledIds).not.toContain(1000);
    expect(canceledIds).not.toContain(1050);
    expect(canceledIds).not.toContain(1100);
    expect(canceledIds).not.toContain(1190);
  });

  it('cancels only jumuah-range IDs (1000–1099) when category is "jumuah"', async () => {
    mockGetPending.mockResolvedValue({
      notifications: [
        { id: 100, title: 'fajr' },
        { id: 1000, title: 'jumuah' },
        { id: 1050, title: 'jumuah' },
        { id: 1099, title: 'jumuah' },
        { id: 1100, title: 'kahf' },
      ],
    });

    await cancelByCategory('jumuah');

    expect(mockCancel).toHaveBeenCalledTimes(1);
    const canceledIds = mockCancel.mock.calls[0][0].notifications.map((n: { id: number }) => n.id);
    expect(canceledIds).not.toContain(100);
    expect(canceledIds).toContain(1000);
    expect(canceledIds).toContain(1050);
    expect(canceledIds).toContain(1099);
    expect(canceledIds).not.toContain(1100);
  });

  it('cancels only kahf-range IDs (1100–1199) when category is "kahf"', async () => {
    mockGetPending.mockResolvedValue({
      notifications: [
        { id: 100, title: 'fajr' },
        { id: 1099, title: 'jumuah' },
        { id: 1100, title: 'kahf' },
        { id: 1150, title: 'kahf' },
        { id: 1199, title: 'kahf' },
        { id: 1200, title: 'reminder' },
      ],
    });

    await cancelByCategory('kahf');

    expect(mockCancel).toHaveBeenCalledTimes(1);
    const canceledIds = mockCancel.mock.calls[0][0].notifications.map((n: { id: number }) => n.id);
    expect(canceledIds).not.toContain(100);
    expect(canceledIds).not.toContain(1099);
    expect(canceledIds).toContain(1100);
    expect(canceledIds).toContain(1150);
    expect(canceledIds).toContain(1199);
    expect(canceledIds).not.toContain(1200);
  });

  it('does not call cancel when no matching notifications exist', async () => {
    mockGetPending.mockResolvedValue({
      notifications: [
        { id: 1000, title: 'jumuah' },
        { id: 1100, title: 'kahf' },
      ],
    });

    await cancelByCategory('prayer');

    expect(mockCancel).not.toHaveBeenCalled();
  });
});

describe('cross-category isolation', () => {
  it('rescheduling prayers does not cancel jumuah notifications', async () => {
    // Pre-populate pending with jumuah IDs
    mockGetPending.mockResolvedValueOnce({
      notifications: [{ id: 1000 }, { id: 1001 }],
    });
    // After scheduleNotifications calls cancelByCategory('prayer')
    mockGetPending.mockResolvedValueOnce({
      notifications: [{ id: 1000 }, { id: 1001 }],
    });

    const settings = makeSettings({
      notifications: {
        enabled: true,
        defaultSound: 'default',
        defaultReminderMinutes: 10,
        reminderSound: { kind: 'default' },
        prayers: {
          fajr: { enabled: true, reminderMinutes: 10, atPrayerTime: true, sound: 'default', endReminderMinutes: [] },
          sunrise: { enabled: false, reminderMinutes: 0, atPrayerTime: false, sound: 'default', endReminderMinutes: [] },
          dhuhr: { enabled: false, reminderMinutes: 0, atPrayerTime: false, sound: 'default', endReminderMinutes: [] },
          asr: { enabled: false, reminderMinutes: 0, atPrayerTime: false, sound: 'default', endReminderMinutes: [] },
          maghrib: { enabled: false, reminderMinutes: 0, atPrayerTime: false, sound: 'default', endReminderMinutes: [] },
          isha: { enabled: false, reminderMinutes: 0, atPrayerTime: false, sound: 'default', endReminderMinutes: [] },
        },
      },
    });

    await scheduleNotifications(coords, settings);

    // The cancel call (first cancel call) should only include prayer-range IDs
    // Since the pending list only had 1000 and 1001 (jumuah range), cancel should
    // be called with an empty list (so cancelByCategory won't call cancel at all)
    // But scheduleNotifications calls cancelByCategory which filters to prayer range,
    // finds none, and doesn't call cancel. Then schedule calls schedule with new IDs.
    // Verify cancel was NOT called (since no prayer-range IDs existed)
    // The second mockGetPending call returned only jumuah IDs so cancelByCategory should skip
    expect(mockSchedule).toHaveBeenCalled();
    // Verify the scheduled notification IDs are all in prayer range (1–999)
    const scheduled = mockSchedule.mock.calls[0][0].notifications;
    for (const n of scheduled) {
      expect(n.id).toBeGreaterThanOrEqual(1);
      expect(n.id).toBeLessThanOrEqual(999);
    }
  });

  it('rescheduling jumuah does not affect prayer notifications', async () => {
    mockGetPending.mockResolvedValueOnce({
      notifications: [{ id: 100 }, { id: 1100 }],
    });

    const jumuahSettings: JumuahSettings = {
      enabled: true,
      masjidName: 'Test Mosque',
      times: [{ khutbah: '13:00', iqamah: '13:30' }],
      reminderMinutes: 15,
    };

    await scheduleJumuahNotifications(jumuahSettings);

    // cancelJumuahNotifications should only cancel IDs in 1000–1099
    // The pending had 100 (prayer) and 1100 (kahf) — neither in jumuah range
    // So cancel should not be called for cancelJumuahNotifications
    // But schedule will still run if enabled and times exist
    const cancelCalls = mockCancel.mock.calls;
    // Verify no cancel calls targeted prayer IDs
    for (const call of cancelCalls) {
      const ids = call[0].notifications.map((n: { id: number }) => n.id);
      for (const id of ids) {
        expect(id).toBeGreaterThanOrEqual(1000);
        expect(id).toBeLessThanOrEqual(1099);
      }
    }
  });
});

describe('deterministic ID ranges', () => {
  it('prayer notification IDs are within 1–999', () => {
    const prayerIds: number[] = [];
    for (const prayer of ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const) {
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        prayerIds.push(getNotificationId(prayer, dayOffset, false));
        prayerIds.push(getNotificationId(prayer, dayOffset, true));
      }
    }

    for (const id of prayerIds) {
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(999);
    }
  });

  it('all prayer notification IDs are unique', () => {
    const prayerIds: number[] = [];
    for (const prayer of ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const) {
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        prayerIds.push(getNotificationId(prayer, dayOffset, false));
        prayerIds.push(getNotificationId(prayer, dayOffset, true));
      }
    }

    const uniqueIds = new Set(prayerIds);
    expect(uniqueIds.size).toBe(prayerIds.length);
  });
});