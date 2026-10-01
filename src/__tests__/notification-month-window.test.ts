import { LocalNotifications } from '@capacitor/local-notifications';
import {
  scheduleNotifications,
  setupNotificationListeners,
  prayerForNotificationId,
  END_REMINDER_OPTIONS,
  MAX_DAYS_TO_SCHEDULE,
  MIN_DAYS_TO_SCHEDULE,
  PRAYER_ALARM_BUDGET,
  type PrayerScheduleSettings,
} from '../services/notificationService';
import { defaultAthanSettings } from '../context/SettingsContext';
import type { PrayerName, PrayerNotificationSettings } from '../types';

/**
 * Prayer alerts are armed up to a month ahead (#51), as many whole days as fit
 * in the alarm budget, and never fewer than the week every setting used to
 * get. The ids moved to make room, so alarms armed by the old version have to
 * be swept and old ids still have to resolve to their prayer.
 */
const TORONTO = { latitude: 43.6532, longitude: -79.3832 };
// 03:00 local: before the day's Fajr, so every alert of day 0 is still ahead.
const NOW = new Date(2026, 9, 5, 3, 0, 0);

type Scheduled = { id: number; title: string; body: string; schedule: { at: Date } };

function prayer(overrides: Partial<PrayerNotificationSettings> = {}): PrayerNotificationSettings {
  return { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default', endReminderMinutes: [], ...overrides };
}

function makeSettings(
  prayers: Partial<Record<PrayerName, Partial<PrayerNotificationSettings>>> = {},
): PrayerScheduleSettings {
  return {
    calculationMethod: 'NorthAmerica',
    asrCalculation: 'Standard',
    athan: defaultAthanSettings,
    notifications: {
      enabled: true,
      defaultSound: 'default',
      defaultReminderMinutes: 15,
      reminderSound: { kind: 'default' },
      prayers: {
        fajr: prayer(prayers.fajr),
        sunrise: prayer({ enabled: false, ...prayers.sunrise }),
        dhuhr: prayer(prayers.dhuhr),
        asr: prayer(prayers.asr),
        maghrib: prayer(prayers.maghrib),
        isha: prayer(prayers.isha),
      },
    },
  };
}

let scheduled: Scheduled[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  scheduled = [];
  vi.mocked(LocalNotifications.schedule).mockReset().mockImplementation(async (opts) => {
    scheduled.push(...(opts.notifications as unknown as Scheduled[]));
    return { notifications: [] };
  });
  vi.mocked(LocalNotifications.cancel).mockReset().mockResolvedValue(undefined);
  vi.mocked(LocalNotifications.getPending).mockReset().mockResolvedValue({ notifications: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

const atTime = (label: string) =>
  scheduled
    .filter((n) => n.title === label && n.body.startsWith('Time for'))
    .sort((a, b) => a.schedule.at.getTime() - b.schedule.at.getTime());

const localDay = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

describe('how far ahead prayer alerts are armed', () => {
  it('reaches a full month on the default settings', async () => {
    await scheduleNotifications(TORONTO, makeSettings());

    expect(atTime('Fajr')).toHaveLength(MAX_DAYS_TO_SCHEDULE);
    expect(atTime('Isha')).toHaveLength(MAX_DAYS_TO_SCHEDULE);
    expect(scheduled.length).toBeLessThanOrEqual(PRAYER_ALARM_BUDGET);
  });

  it('stops at the last whole day that fits when each day needs more alarms', async () => {
    // Two end reminders on every prayer: 20 alarms a day.
    const two = { endReminderMinutes: [15, 5] };
    await scheduleNotifications(TORONTO, makeSettings({ fajr: two, dhuhr: two, asr: two, maghrib: two, isha: two }));

    const days = atTime('Fajr').length;
    expect(days).toBeGreaterThan(MIN_DAYS_TO_SCHEDULE);
    expect(days).toBeLessThan(MAX_DAYS_TO_SCHEDULE);
    expect(scheduled.length).toBeLessThanOrEqual(PRAYER_ALARM_BUDGET);

    // Never a day cut in half: every prayer reaches the same last day, and
    // that day keeps its evening, including Isha's end reminders after it.
    for (const label of ['Dhuhr', 'Asr', 'Maghrib', 'Isha']) {
      expect(atTime(label)).toHaveLength(days);
    }
    const lastIsha = atTime('Isha').at(-1)!;
    expect(localDay(lastIsha.schedule.at)).toBe(localDay(atTime('Fajr').at(-1)!.schedule.at));
    const lastIshaEnds = scheduled.filter(
      (n) => n.title === 'Isha' && /ends in/.test(n.body) && n.schedule.at > lastIsha.schedule.at,
    );
    expect(lastIshaEnds).toHaveLength(2);
  });

  it('still covers a week with every reminder switched on', async () => {
    const all = { endReminderMinutes: [...END_REMINDER_OPTIONS] };
    await scheduleNotifications(TORONTO, makeSettings({
      sunrise: { enabled: true },
      fajr: all, dhuhr: all, asr: all, maghrib: all, isha: all,
    }));

    expect(atTime('Fajr')).toHaveLength(MIN_DAYS_TO_SCHEDULE);
    expect(atTime('Isha')).toHaveLength(MIN_DAYS_TO_SCHEDULE);
  });

  it('gives every alert in the month its own id', async () => {
    await scheduleNotifications(TORONTO, makeSettings());
    const ids = scheduled.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('moving off the old ids', () => {
  it('clears alarms the old version armed, and leaves the other kinds alone', async () => {
    vi.mocked(LocalNotifications.getPending).mockResolvedValue({
      notifications: [
        { id: 100, title: 'Fajr', body: '' },     // old layout, Fajr
        { id: 678, title: 'Isha', body: '' },     // old layout, Isha end reminder
        { id: 10010, title: 'Fajr', body: '' },   // current layout
        { id: 60301, title: 'Isha', body: '' },
        { id: 1000, title: "Jumu'ah", body: '' },
        { id: 1100, title: 'Al-Kahf', body: '' },
        { id: 1300, title: 'Travel', body: '' },
      ],
    } as never);

    await scheduleNotifications(TORONTO, makeSettings());

    const cancelled = vi.mocked(LocalNotifications.cancel).mock.calls
      .flatMap(([opts]) => opts.notifications.map((n) => n.id));
    expect(cancelled).toEqual(expect.arrayContaining([100, 678, 10010, 60301]));
    expect(cancelled).not.toContain(1000);
    expect(cancelled).not.toContain(1100);
    expect(cancelled).not.toContain(1300);
  });

  it('reads the prayer off both the old ids and the new ones', () => {
    expect(prayerForNotificationId(100)).toBe('fajr');
    expect(prayerForNotificationId(678)).toBe('isha');
    expect(prayerForNotificationId(10011)).toBe('fajr');
    expect(prayerForNotificationId(30308)).toBe('dhuhr');
    expect(prayerForNotificationId(60301)).toBe('isha');
    expect(prayerForNotificationId(1000)).toBeNull();
    expect(prayerForNotificationId(1100)).toBeNull();
    expect(prayerForNotificationId(1300)).toBeNull();
  });

  it('opens the right prayer when an old or a new alert is tapped', async () => {
    let onTap: ((event: { notification: { id: number } }) => void) | undefined;
    vi.mocked(LocalNotifications.addListener).mockImplementation(((_event: string, cb: typeof onTap) => {
      onTap = cb;
      return Promise.resolve({ remove: vi.fn() });
    }) as never);
    const opened: PrayerName[] = [];
    setupNotificationListeners((name) => opened.push(name));

    onTap!({ notification: { id: 150 } });
    onTap!({ notification: { id: 60011 } });
    onTap!({ notification: { id: 1000 } });

    expect(opened).toEqual(['fajr', 'isha']);
  });
});
