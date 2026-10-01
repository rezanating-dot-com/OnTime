import { LocalNotifications } from '@capacitor/local-notifications';
import {
  scheduleNotifications,
  getNotificationId,
  getEndReminderNotificationId,
  END_REMINDER_OPTIONS,
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

  it.each([
    ['fajr', 'Fajr', 'sunrise'],
    ['dhuhr', 'Dhuhr', 'asr'],
    ['asr', 'Asr', 'maghrib'],
    ['maghrib', 'Maghrib', 'isha'],
  ] as const)('%s: fires the chosen minutes before the next prayer, every day of the week', async (name, label, next) => {
    await scheduleNotifications(TORONTO, makeSettings({ [name]: { endReminderMinutes: [15] } }));

    const reminders = endReminders(label);
    expect(reminders).toHaveLength(7);
    reminders.forEach((reminder, dayOffset) => {
      const expected = minutesBefore(timeOf(timesFor(TORONTO, dayOffset), next), 15);
      expect(reminder.schedule.at.getTime()).toBe(expected.getTime());
    });
  });

  it('isha: fires before the Islamic midnight that follows that evening, even when built before Fajr', async () => {
    await scheduleNotifications(TORONTO, makeSettings({ isha: { endReminderMinutes: [30] } }));

    const reminders = endReminders('Isha');
    expect(reminders).toHaveLength(7);
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
    expect(reminders).toHaveLength(8);
  });

  it('gives one reminder per chosen minute, each saying how long is left', async () => {
    await scheduleNotifications(TORONTO, makeSettings({ dhuhr: { endReminderMinutes: [30, 15, 5] } }));

    const reminders = endReminders('Dhuhr');
    expect(reminders).toHaveLength(21);
    const day0 = reminders.slice(0, 3);
    expect(day0.map((n) => n.body)).toEqual([
      'Dhuhr ends in 30 minutes',
      'Dhuhr ends in 15 minutes',
      'Dhuhr ends in 5 minutes',
    ]);
    expect(new Set(reminders.map((n) => n.id)).size).toBe(21);
  });

  it('skips a reminder that would land before the prayer has even begun', async () => {
    // Singapore under the Tehran method: Maghrib to Isha is about 38 minutes.
    await scheduleNotifications(SINGAPORE, makeSettings({ maghrib: { endReminderMinutes: [45, 30] } }, 'Tehran'));

    const reminders = endReminders('Maghrib');
    expect(reminders).toHaveLength(7);
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
    expect(endReminders('Dhuhr')).toHaveLength(7);
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
    expect(endReminders('Fajr')).toHaveLength(7);
    expect(endReminders('Sunrise')).toHaveLength(0);
  });

  it('gives a disabled prayer none', async () => {
    await scheduleNotifications(TORONTO, makeSettings({
      dhuhr: { enabled: false, endReminderMinutes: [15] },
      asr: { endReminderMinutes: [15] },
    }));
    expect(endReminders('Asr')).toHaveLength(7);
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
    expect(reminders).toHaveLength(7);
    for (const n of reminders) {
      expect(n.channelId).toBe('ontime_prayer_silent');
    }
  });

  it('with every option on for every prayer, arms 245 end reminders for the week', async () => {
    const all = { endReminderMinutes: [...END_REMINDER_OPTIONS] };
    await scheduleNotifications(TORONTO, makeSettings({ fajr: all, dhuhr: all, asr: all, maghrib: all, isha: all }));
    expect(scheduled.filter((n) => /ends in/.test(n.body))).toHaveLength(5 * 7 * END_REMINDER_OPTIONS.length);
    expect(new Set(scheduled.map((n) => n.id)).size).toBe(scheduled.length);
  });
});

describe('end reminder notification ids', () => {
  it('offers at most eight options, so a week fits inside each prayer block', () => {
    expect(END_REMINDER_OPTIONS.length).toBeLessThanOrEqual(8);
    expect(END_REMINDER_OPTIONS).toEqual([5, 10, 15, 20, 30, 45, 60]);
  });

  it('stay within 1–999 and never collide with each other or the existing ids', () => {
    const ids: number[] = [];
    for (const prayer of ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const) {
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        ids.push(getNotificationId(prayer, dayOffset, false));
        ids.push(getNotificationId(prayer, dayOffset, true));
      }
      // End reminders also cover yesterday, whose Isha window can still be open.
      for (let dayOffset = -1; dayOffset < 7; dayOffset++) {
        for (const minutes of END_REMINDER_OPTIONS) {
          ids.push(getEndReminderNotificationId(prayer, dayOffset, minutes));
        }
      }
    }
    for (const id of ids) {
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(999);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keep the prayer recoverable from the id, like the existing ones', () => {
    // The click listener and per-prayer cancel both read the hundreds digit.
    expect(Math.floor(getEndReminderNotificationId('asr', 6, 60) / 100) * 100).toBe(400);
    expect(Math.floor(getEndReminderNotificationId('fajr', -1, 5) / 100) * 100).toBe(100);
  });
});
