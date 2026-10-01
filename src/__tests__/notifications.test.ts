import { LocalNotifications } from '@capacitor/local-notifications';
import { scheduleNotifications, scheduleJumuahNotifications, scheduleSurahKahfNotifications } from '../services/notificationService';
import type { Settings } from '../types';
import { defaultTravelSettings, defaultAthanSettings, defaultSurahKahfSettings } from '../context/SettingsContext';

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    calculationMethod: 'NorthAmerica',
    asrCalculation: 'Standard',
    optionalPrayers: { showSunrise: true, showMiddleOfNight: true, showLastThirdOfNight: true },
    notifications: {
      enabled: true,
      defaultSound: 'default',
      defaultReminderMinutes: 15,
      reminderSound: { kind: 'default' },
      prayers: {
        fajr: { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default', endReminderMinutes: [] },
        sunrise: { enabled: false, reminderMinutes: 0, atPrayerTime: false, sound: 'default', endReminderMinutes: [] },
        dhuhr: { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default', endReminderMinutes: [] },
        asr: { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default', endReminderMinutes: [] },
        maghrib: { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default', endReminderMinutes: [] },
        isha: { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default', endReminderMinutes: [] },
      },
    },
    jumuah: { enabled: false, masjidName: '', times: [{ khutbah: '13:00', iqamah: '13:30' }], reminderMinutes: 30 },
    travel: defaultTravelSettings,
    display: { showCurrentPrayer: true, showNextPrayer: true, showSunnahCard: true },
    athan: defaultAthanSettings,
    surahKahf: defaultSurahKahfSettings,
    previousLocations: [],
    distanceUnit: 'miles',
    designStyle: 'classic',
    ...overrides,
  };
}

const TORONTO = { latitude: 43.6532, longitude: -79.3832 };

describe('User story: I get notified before each prayer', () => {
  let scheduledNotifications: unknown[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    scheduledNotifications = [];

    vi.mocked(LocalNotifications.schedule).mockImplementation(async (opts: { notifications: unknown[] }) => {
      scheduledNotifications.push(...opts.notifications);
      return { notifications: [] };
    });
    vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' } as never);
    vi.mocked(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'granted' } as never);
    (LocalNotifications as Record<string, unknown>).getPending = vi.fn().mockResolvedValue({ notifications: [] });
  });

  it('schedules notifications for all enabled prayers', async () => {
    const settings = makeSettings();
    await scheduleNotifications(TORONTO, settings);
    expect(scheduledNotifications.length).toBeGreaterThan(0);
  });

  it('does not schedule any notifications when globally disabled', async () => {
    const settings = makeSettings({
      notifications: {
        ...makeSettings().notifications,
        enabled: false,
      },
    });
    await scheduleNotifications(TORONTO, settings);
    expect(scheduledNotifications.length).toBe(0);
  });

  it('skips sunrise notifications (sunrise is disabled by default)', async () => {
    const settings = makeSettings();
    await scheduleNotifications(TORONTO, settings);
    const sunriseNotifs = scheduledNotifications.filter(
      (n: Record<string, unknown>) => (n.title as string)?.includes('Sunrise')
    );
    expect(sunriseNotifs.length).toBe(0);
  });

  it('skips notifications for individually disabled prayers', async () => {
    const settings = makeSettings();
    settings.notifications.prayers.asr.enabled = false;
    await scheduleNotifications(TORONTO, settings);
    const asrNotifs = scheduledNotifications.filter(
      (n: Record<string, unknown>) => (n.title as string) === 'Asr'
    );
    expect(asrNotifs.length).toBe(0);
  });

  it('sets reminder notifications before prayer time', async () => {
    const settings = makeSettings();
    settings.notifications.prayers.fajr.reminderMinutes = 30;
    await scheduleNotifications(TORONTO, settings);
    const fajrReminders = scheduledNotifications.filter(
      (n: Record<string, unknown>) => (n.title as string) === 'Fajr' && (n.body as string)?.includes('coming soon')
    );
    for (const reminder of fajrReminders) {
      const r = reminder as Record<string, Record<string, Date>>;
      expect(r.schedule.at).toBeInstanceOf(Date);
    }
  });

  it('includes at-prayer-time notifications', async () => {
    const settings = makeSettings();
    await scheduleNotifications(TORONTO, settings);
    const atTimeNotifs = scheduledNotifications.filter(
      (n: Record<string, unknown>) => (n.body as string)?.includes('Time for')
    );
    expect(atTimeNotifs.length).toBeGreaterThan(0);
  });

  it('each notification has a unique ID', async () => {
    const settings = makeSettings();
    await scheduleNotifications(TORONTO, settings);
    const ids = scheduledNotifications.map((n: Record<string, unknown>) => n.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe('User story: I get reminded about Jumuah prayer', () => {
  let scheduledNotifications: unknown[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    scheduledNotifications = [];
    vi.mocked(LocalNotifications.schedule).mockImplementation(async (opts: { notifications: unknown[] }) => {
      scheduledNotifications.push(...opts.notifications);
      return { notifications: [] };
    });
    vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' } as never);
    vi.mocked(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'granted' } as never);
    (LocalNotifications as Record<string, unknown>).getPending = vi.fn().mockResolvedValue({ notifications: [] });
  });

  it('schedules Jumuah notifications when enabled', async () => {
    await scheduleJumuahNotifications({
      enabled: true,
      masjidName: 'ISNA Masjid',
      times: [{ khutbah: '13:00', iqamah: '13:30' }],
      reminderMinutes: 30,
    });
    expect(scheduledNotifications.length).toBeGreaterThan(0);
    const firstNotif = scheduledNotifications[0] as Record<string, unknown>;
    expect(firstNotif.title).toBe("Jumu'ah Prayer");
    expect((firstNotif.body as string)).toContain('ISNA Masjid');
  });

  it('does not schedule Jumuah when disabled', async () => {
    await scheduleJumuahNotifications({
      enabled: false,
      masjidName: '',
      times: [{ khutbah: '13:00', iqamah: '13:30' }],
      reminderMinutes: 30,
    });
    expect(scheduledNotifications.length).toBe(0);
  });

  it('gives every Jumuah time its own id, even at more times than the UI offers', async () => {
    // NT-13: id = JUMUAH_BASE_ID + weekOffset * 10 + timeIndex, with an
    // unbounded timeIndex against a 10-wide week stride. With 12 times the
    // duplicates are [1010,1011,1020,1021,1030,1031], and a duplicate id
    // inside one schedule() call means the later entry silently replaces the
    // earlier — so a masjid with many jamaats loses notifications with no
    // sign that anything went wrong.
    const times = Array.from({ length: 30 }, (_, i) => ({
      khutbah: `${String(12 + Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}`,
      iqamah: '14:30',
    }));
    await scheduleJumuahNotifications({ enabled: true, masjidName: '', times, reminderMinutes: 30 });

    const ids = scheduledNotifications.map((n) => (n as { id: number }).id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    // And they all stay inside the range cancelJumuahNotifications sweeps.
    for (const id of ids) {
      expect(id).toBeGreaterThanOrEqual(1000);
      expect(id).toBeLessThan(1100);
    }
  });
});

describe('User story: I get reminded to read Surah Al-Kahf', () => {
  let scheduledNotifications: unknown[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    scheduledNotifications = [];
    vi.mocked(LocalNotifications.schedule).mockImplementation(async (opts: { notifications: unknown[] }) => {
      scheduledNotifications.push(...opts.notifications);
      return { notifications: [] };
    });
    vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' } as never);
    vi.mocked(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'granted' } as never);
    (LocalNotifications as Record<string, unknown>).getPending = vi.fn().mockResolvedValue({ notifications: [] });
  });

  it('schedules Surah Kahf reminders when enabled', async () => {
    await scheduleSurahKahfNotifications(TORONTO, { enabled: true, repeatIntervalHours: 0 }, 'NorthAmerica', 'Standard');
    expect(scheduledNotifications.length).toBeGreaterThan(0);
    const firstNotif = scheduledNotifications[0] as Record<string, unknown>;
    expect((firstNotif.title as string)).toContain('Surah');
  });

  it('does not schedule Surah Kahf when disabled', async () => {
    await scheduleSurahKahfNotifications(TORONTO, { enabled: false, repeatIntervalHours: 0 }, 'NorthAmerica', 'Standard');
    expect(scheduledNotifications.length).toBe(0);
  });

  it('schedules repeat reminders when repeatIntervalHours > 0', async () => {
    await scheduleSurahKahfNotifications(TORONTO, { enabled: true, repeatIntervalHours: 4 }, 'NorthAmerica', 'Standard');
    expect(scheduledNotifications.length).toBeGreaterThan(4);
  });

  it('keeps reminding right up to Friday Maghrib at the finest interval', async () => {
    // NT-12: the loop was capped at `reminderIndex < 9` to keep ids inside a
    // 10-wide week block, so at 2h intervals the reminders covered 16h of a
    // ~24h window — the last one landing around 11:37 against a ~19:15
    // Maghrib, leaving Friday afternoon uncovered. Which is when the reminder
    // matters most.
    await scheduleSurahKahfNotifications(TORONTO, { enabled: true, repeatIntervalHours: 2 }, 'NorthAmerica', 'Standard');

    // Group by burst rather than by id, so the assertion says nothing about
    // how the ids happen to be laid out. Reminders inside one Islamic Friday
    // are 2h apart; consecutive weeks are ~7 days apart.
    const times = (scheduledNotifications as Array<{ schedule: { at: Date } }>)
      .map((n) => n.schedule.at.getTime())
      .sort((a, b) => a - b);
    const bursts: number[][] = [];
    for (const t of times) {
      const last = bursts[bursts.length - 1];
      if (last && t - last[last.length - 1] < 12 * 3_600_000) last.push(t);
      else bursts.push([t]);
    }

    // Skip the first burst: today may already be part-way through the window.
    const full = bursts.slice(1).find((b) => b.length > 1);
    expect(full).toBeDefined();
    const spanHours = (full![full!.length - 1] - full![0]) / 3_600_000;
    // Thursday Maghrib to Friday Maghrib is ~24h; the last reminder has to sit
    // within one interval of the end rather than eight hours short of it.
    expect(spanHours).toBeGreaterThan(21);

    const ids = scheduledNotifications.map((n) => (n as { id: number }).id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toBeGreaterThanOrEqual(1100);
      expect(id).toBeLessThan(1200);
    }
  });

  it('never puts a large icon on a notification that cannot resolve one', async () => {
    // NT-15: largeIcon: 'ic_launcher' resolves against res/drawable, and
    // ic_launcher.png only exists under mipmap-*. resId 0 ->
    // decodeResource(res, 0) -> null, so every notification lost its large
    // icon anyway. smallIcon 'ic_stat_icon' is fine — that one is in
    // drawable-*.
    await scheduleSurahKahfNotifications(TORONTO, { enabled: true, repeatIntervalHours: 4 }, 'NorthAmerica', 'Standard');
    for (const n of scheduledNotifications as Array<Record<string, unknown>>) {
      expect(n.largeIcon).toBeUndefined();
      expect(n.smallIcon).toBe('ic_stat_icon');
    }
  });
});
