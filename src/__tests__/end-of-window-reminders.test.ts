import { LocalNotifications } from '@capacitor/local-notifications';
import {
  scheduleNotifications,
  getNotificationId,
  getEndReminderNotificationId,
  prayerForNotificationId,
  END_REMINDER_OPTIONS,
  MAX_DAYS_TO_SCHEDULE,
  MIN_DAYS_TO_SCHEDULE,
} from '../services/notificationService';
import { calculatePrayerTimes } from '../services/prayerService';
import { defaultAthanSettings } from '../context/SettingsContext';
import type { Settings, PrayerName, PrayerNotificationSettings, CalculationMethod, Coordinates } from '../types';

/**
 * "Before it ends" reminders: N minutes before a prayer's window closes.
 *
 * Fajr closes at sunrise, Dhuhr at Asr, Asr at Maghrib, Maghrib at Isha, and
 * Isha at Islamic midnight — the midpoint of the night that follows that
 * evening's Isha. Sunrise is not a prayer and never gets one.
 */
const TORONTO: Coordinates = { latitude: 43.6532, longitude: -79.3832 };
const SINGAPORE: Coordinates = { latitude: 1.35, longitude: 103.82 };
const TROMSO: Coordinates = { latitude: 69.65, longitude: 18.96 };

// 03:00 local on 5 Oct 2026: before that day's Fajr, so day 0's Isha is
// still ahead and so is the midnight that follows it.
const NOW = new Date(2026, 9, 5, 3, 0, 0);

type Scheduled = {
  id: number;
  title: string;
  body: string;
  schedule: { at: Date };
  sound?: string;
  channelId?: string;
};

function prayer(overrides: Partial<PrayerNotificationSettings> = {}): PrayerNotificationSettings {
  return { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default', endReminderMinutes: [], ...overrides };
}

function makeSettings(
  prayers: Partial<Record<PrayerName, Partial<PrayerNotificationSettings>>> = {},
  calculationMethod: CalculationMethod = 'NorthAmerica',
): Settings {
  return {
    calculationMethod,
    asrCalculation: 'Standard',
    optionalPrayers: { showSunrise: true, showMiddleOfNight: true, showLastThirdOfNight: true },
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
    jumuah: { enabled: false, masjidName: '', times: [], reminderMinutes: 30 },
    travel: {} as Settings['travel'],
    display: { showCurrentPrayer: true, showNextPrayer: true, showSunnahCard: true, hijriOffset: 0 },
    athan: defaultAthanSettings,
    surahKahf: { enabled: false, repeatIntervalHours: 0 },
    previousLocations: [],
    distanceUnit: 'miles',
    designStyle: 'classic',
    homeView: 'globe',
  };
}

/** The app's own times for a day, asked at noon so no pre-Fajr swap applies. */
function timesFor(coords: Coordinates, dayOffset: number, method: CalculationMethod = 'NorthAmerica') {
  const day = new Date(NOW);
  day.setDate(day.getDate() + dayOffset);
  day.setHours(12, 0, 0, 0);
  return calculatePrayerTimes(coords, day, method, 'Standard');
}

function timeOf(data: ReturnType<typeof calculatePrayerTimes>, name: PrayerName): Date {
  return data.prayers.find((p) => p.name === name)!.time;
}

const minutesBefore = (t: Date, minutes: number) => new Date(t.getTime() - minutes * 60000);

describe('reminders before a prayer window ends', () => {
  let scheduled: Scheduled[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    scheduled = [];
    vi.mocked(LocalNotifications.schedule).mockImplementation(async (opts) => {
      scheduled.push(...(opts.notifications as unknown as Scheduled[]));
      return { notifications: [] };
    });
    vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' } as never);
    vi.mocked(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'granted' } as never);
    vi.mocked(LocalNotifications.getPending).mockResolvedValue({ notifications: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const endReminders = (title: string) =>
    scheduled
      .filter((n) => n.title === title && /ends in/.test(n.body))
      .sort((a, b) => a.schedule.at.getTime() - b.schedule.at.getTime());

  /**
   * How many days the schedule reached for a prayer, read from its at-time
   * alerts. The window depends on how many alerts a day needs, so the tests
   * count it rather than assume one.
   */
  const daysCovered = (title: string) =>
    scheduled.filter((n) => n.title === title && n.body.startsWith('Time for')).length;

  it.each([
    ['fajr', 'Fajr', 'sunrise'],
    ['dhuhr', 'Dhuhr', 'asr'],
    ['asr', 'Asr', 'maghrib'],
    ['maghrib', 'Maghrib', 'isha'],
  ] as const)('%s: fires the chosen minutes before the next prayer, every day scheduled', async (name, label, next) => {
    await scheduleNotifications(TORONTO, makeSettings({ [name]: { endReminderMinutes: [15] } }));

    const reminders = endReminders(label);
    expect(daysCovered(label)).toBeGreaterThan(MIN_DAYS_TO_SCHEDULE);
    expect(reminders).toHaveLength(daysCovered(label));
    reminders.forEach((reminder, dayOffset) => {
      const expected = minutesBefore(timeOf(timesFor(TORONTO, dayOffset), next), 15);
      expect(reminder.schedule.at.getTime()).toBe(expected.getTime());
    });
  });

  it('isha: fires before the Islamic midnight that follows that evening, even when built before Fajr', async () => {
    await scheduleNotifications(TORONTO, makeSettings({ isha: { endReminderMinutes: [30] } }));

    const reminders = endReminders('Isha');
    expect(reminders).toHaveLength(daysCovered('Isha'));
    reminders.forEach((reminder, dayOffset) => {
      const data = timesFor(TORONTO, dayOffset);
      const midnight = data.sunnahTimes!.middleOfTheNight;
      // Sanity: that midnight sits after the same evening's Isha, not last night's.
      expect(midnight.getTime()).toBeGreaterThan(timeOf(data, 'isha').getTime());
      expect(reminder.schedule.at.getTime()).toBe(minutesBefore(midnight, 30).getTime());
    });
  });

  it('isha: keeps last night\'s reminder when rebuilt after local midnight but before Islamic midnight', async () => {
    // 00:10 on 6 Oct: the 5 Oct Isha window is still open (it closes at
    // ~00:27). A rebuild here — the day-change top-up on resume, or any
    // settings change — cancels everything armed and must put it back.
    vi.setSystemTime(new Date(2026, 9, 6, 0, 10, 0));
    await scheduleNotifications(TORONTO, makeSettings({ isha: { endReminderMinutes: [5] } }));

    const reminders = endReminders('Isha');
    const lastNightMidnight = timesFor(TORONTO, 0).sunnahTimes!.middleOfTheNight; // 5 Oct's night
    expect(lastNightMidnight.getTime()).toBeGreaterThan(new Date(2026, 9, 6, 0, 10, 0).getTime());
    expect(reminders[0].schedule.at.getTime()).toBe(minutesBefore(lastNightMidnight, 5).getTime());
    // One per day scheduled, plus last night's.
    expect(reminders).toHaveLength(daysCovered('Isha') + 1);
  });

  it('gives one reminder per chosen minute, each saying how long is left', async () => {
    await scheduleNotifications(TORONTO, makeSettings({ dhuhr: { endReminderMinutes: [30, 15, 5] } }));

    const reminders = endReminders('Dhuhr');
    expect(reminders).toHaveLength(3 * daysCovered('Dhuhr'));
    const day0 = reminders.slice(0, 3);
    expect(day0.map((n) => n.body)).toEqual([
      'Dhuhr ends in 30 minutes',
      'Dhuhr ends in 15 minutes',
      'Dhuhr ends in 5 minutes',
    ]);
    expect(new Set(reminders.map((n) => n.id)).size).toBe(reminders.length);
  });

  it('skips a reminder that would land before the prayer has even begun', async () => {
    // Singapore under the Tehran method: Maghrib to Isha is about 38 minutes.
    await scheduleNotifications(SINGAPORE, makeSettings({ maghrib: { endReminderMinutes: [45, 30] } }, 'Tehran'));

    const reminders = endReminders('Maghrib');
    expect(reminders).toHaveLength(daysCovered('Maghrib'));
    expect(reminders.every((n) => n.body === 'Maghrib ends in 30 minutes')).toBe(true);
    reminders.forEach((reminder, dayOffset) => {
      const data = timesFor(SINGAPORE, dayOffset, 'Tehran');
      expect(reminder.schedule.at.getTime()).toBeGreaterThan(timeOf(data, 'maghrib').getTime());
    });
  });

  it('skips the reminder, without throwing, when the window has no end (polar summer)', async () => {
    vi.setSystemTime(new Date(2026, 5, 20, 3, 0, 0));
    await expect(
      scheduleNotifications(TROMSO, makeSettings({
        dhuhr: { endReminderMinutes: [15] },
        maghrib: { endReminderMinutes: [15] },
        isha: { endReminderMinutes: [15] },
      })),
    ).resolves.toBeUndefined();

    // Dhuhr still closes at Asr in the midnight sun; Maghrib and Isha have no end.
    expect(endReminders('Dhuhr')).toHaveLength(daysCovered('Dhuhr'));
    expect(endReminders('Maghrib')).toHaveLength(0);
    expect(endReminders('Isha')).toHaveLength(0);
    for (const n of scheduled) {
      expect(Number.isNaN(n.schedule.at.getTime())).toBe(false);
    }
  });

  it('never gives sunrise one, since it is not a prayer', async () => {
    await scheduleNotifications(TORONTO, makeSettings({
      sunrise: { enabled: true, endReminderMinutes: [15] },
      fajr: { endReminderMinutes: [15] },
    }));
    expect(endReminders('Fajr')).toHaveLength(daysCovered('Fajr'));
    expect(endReminders('Sunrise')).toHaveLength(0);
  });

  it('gives a disabled prayer none', async () => {
    await scheduleNotifications(TORONTO, makeSettings({
      dhuhr: { enabled: false, endReminderMinutes: [15] },
      asr: { endReminderMinutes: [15] },
    }));
    expect(endReminders('Asr')).toHaveLength(daysCovered('Asr'));
    expect(endReminders('Dhuhr')).toHaveLength(0);
  });

  it('schedules nothing extra for a profile with no end reminders chosen', async () => {
    await scheduleNotifications(TORONTO, makeSettings());
    expect(scheduled.filter((n) => /ends in/.test(n.body))).toHaveLength(0);
  });

  it('uses the plain notification sound, not the athan', async () => {
    await scheduleNotifications(TORONTO, makeSettings({ dhuhr: { sound: 'adhan', endReminderMinutes: [15] } }));

    const atTime = scheduled.filter((n) => n.title === 'Dhuhr' && n.body.startsWith('Time for'));
    expect(atTime[0].channelId).toBe('ontime_prayer_adhan');

    for (const n of endReminders('Dhuhr')) {
      expect(n.channelId).toBe('ontime_prayer');
      expect(n.sound).toBe('default');
    }
  });

  it('stays silent when the prayer is set to Silent', async () => {
    await scheduleNotifications(TORONTO, makeSettings({ dhuhr: { sound: 'silent', endReminderMinutes: [15] } }));
    const reminders = endReminders('Dhuhr');
    expect(reminders).toHaveLength(daysCovered('Dhuhr'));
    for (const n of reminders) {
      expect(n.channelId).toBe('ontime_prayer_silent');
    }
  });

  it('with every option on for every prayer, keeps the week: 245 end reminders', async () => {
    const all = { endReminderMinutes: [...END_REMINDER_OPTIONS] };
    await scheduleNotifications(TORONTO, makeSettings({ fajr: all, dhuhr: all, asr: all, maghrib: all, isha: all }));
    expect(scheduled.filter((n) => /ends in/.test(n.body))).toHaveLength(5 * 7 * END_REMINDER_OPTIONS.length);
    expect(new Set(scheduled.map((n) => n.id)).size).toBe(scheduled.length);
  });
});

describe('end reminder notification ids', () => {
  it('offers at most eight options, so they fit in slots 2–9 of each decade', () => {
    expect(END_REMINDER_OPTIONS.length).toBeLessThanOrEqual(8);
    expect(END_REMINDER_OPTIONS).toEqual([5, 10, 15, 20, 30, 45, 60]);
  });

  it('stay inside their own prayer block across a full month and never collide', () => {
    const ids: number[] = [];
    for (const prayer of ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const) {
      const own: number[] = [];
      for (let dayOffset = 0; dayOffset < MAX_DAYS_TO_SCHEDULE; dayOffset++) {
        own.push(getNotificationId(prayer, dayOffset, false));
        own.push(getNotificationId(prayer, dayOffset, true));
      }
      // End reminders also cover yesterday, whose Isha window can still be open.
      for (let dayOffset = -1; dayOffset < MAX_DAYS_TO_SCHEDULE; dayOffset++) {
        for (const minutes of END_REMINDER_OPTIONS) {
          own.push(getEndReminderNotificationId(prayer, dayOffset, minutes));
        }
      }
      for (const id of own) {
        expect(prayerForNotificationId(id)).toBe(prayer);
      }
      ids.push(...own);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keep the prayer recoverable from the id, like the existing ones', () => {
    // The click listener and per-prayer cancel both read the prayer off the id.
    expect(prayerForNotificationId(getEndReminderNotificationId('asr', 29, 60))).toBe('asr');
    expect(prayerForNotificationId(getEndReminderNotificationId('fajr', -1, 5))).toBe('fajr');
  });
});
