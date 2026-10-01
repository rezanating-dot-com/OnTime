import { LocalNotifications } from '@capacitor/local-notifications';
import { scheduleNotifications } from '../services/notificationService';
import { AthanPlugin } from '../plugins/athanPlugin';
import { defaultAthanSettings } from '../context/SettingsContext';
import type { Settings, PrayerName, PrayerNotificationSettings, ReminderSound, AthanSettings } from '../types';

/**
 * One "Reminder sound" for every prayer reminder — the one before the prayer
 * and the "before it ends" ones — while each prayer's own Sound plays at
 * prayer time only. Before this, the reminder 15 minutes ahead of a prayer set
 * to Adhan played the athan too.
 */
vi.mock('../plugins/athanPlugin', () => ({
  AthanPlugin: {
    createSoundChannel: vi.fn().mockResolvedValue(undefined),
  },
}));

const TORONTO = { latitude: 43.6532, longitude: -79.3832 };
const NOW = new Date(2026, 9, 5, 3, 0, 0);

const GONG: ReminderSound = {
  kind: 'system',
  uri: 'content://media/internal/audio/media/60',
  title: 'Gentle Gong',
  channelId: 'ontime_reminder_abc',
};

type Scheduled = { id: number; title: string; body: string; channelId?: string };

function prayer(overrides: Partial<PrayerNotificationSettings> = {}): PrayerNotificationSettings {
  return { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default', endReminderMinutes: [15], ...overrides };
}

function makeSettings(
  reminderSound: ReminderSound,
  prayers: Partial<Record<PrayerName, Partial<PrayerNotificationSettings>>> = {},
  athan: AthanSettings = defaultAthanSettings,
): Settings {
  return {
    calculationMethod: 'NorthAmerica',
    asrCalculation: 'Standard',
    optionalPrayers: { showSunrise: true, showMiddleOfNight: true, showLastThirdOfNight: true },
    notifications: {
      enabled: true,
      defaultSound: 'default',
      defaultReminderMinutes: 15,
      reminderSound,
      prayers: {
        fajr: prayer(prayers.fajr),
        sunrise: prayer({ enabled: false }),
        dhuhr: prayer(prayers.dhuhr),
        asr: prayer(prayers.asr),
        maghrib: prayer(prayers.maghrib),
        isha: prayer(prayers.isha),
      },
    },
    jumuah: { enabled: false, masjidName: '', times: [], reminderMinutes: 30 },
    travel: {} as Settings['travel'],
    display: { showCurrentPrayer: true, showNextPrayer: true, showSunnahCard: true, hijriOffset: 0 },
    athan,
    surahKahf: { enabled: false, repeatIntervalHours: 0 },
    previousLocations: [],
    distanceUnit: 'miles',
    designStyle: 'classic',
    homeView: 'globe',
  };
}

describe('the reminder sound', () => {
  let scheduled: Scheduled[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    scheduled = [];
    vi.mocked(LocalNotifications.schedule).mockImplementation(async (opts) => {
      scheduled.push(...(opts.notifications as unknown as Scheduled[]));
      return { notifications: [] };
    });
    vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' } as never);
    vi.mocked(LocalNotifications.getPending).mockResolvedValue({ notifications: [] });
    vi.mocked(AthanPlugin.createSoundChannel).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const startReminders = (title: string) => scheduled.filter((n) => n.title === title && /coming soon/.test(n.body));
  const endReminders = (title: string) => scheduled.filter((n) => n.title === title && /ends in/.test(n.body));
  const atTime = (title: string) => scheduled.filter((n) => n.title === title && /^Time for/.test(n.body));
  const channels = (list: Scheduled[]) => [...new Set(list.map((n) => n.channelId))];

  it('keeps the athan for prayer time and gives the reminders the plain sound by default', async () => {
    await scheduleNotifications(TORONTO, makeSettings({ kind: 'default' }, { dhuhr: { sound: 'adhan' } }));

    expect(channels(atTime('Dhuhr'))).toEqual(['ontime_prayer_adhan']);
    expect(startReminders('Dhuhr').length).toBeGreaterThan(0);
    expect(channels(startReminders('Dhuhr'))).toEqual(['ontime_prayer']);
    expect(channels(endReminders('Dhuhr'))).toEqual(['ontime_prayer']);
  });

  it('keeps a downloaded athan for prayer time only', async () => {
    const athan = { ...defaultAthanSettings, selectedAthanId: 'abc123', currentChannelId: 'athan_main_abc123' };
    await scheduleNotifications(TORONTO, makeSettings({ kind: 'default' }, { asr: { sound: 'adhan' } }, athan));

    expect(channels(atTime('Asr'))).toEqual(['athan_main_abc123']);
    expect(channels(startReminders('Asr'))).toEqual(['ontime_prayer']);
  });

  it('plays a chosen phone sound for both kinds of reminder, and leaves prayer time alone', async () => {
    await scheduleNotifications(TORONTO, makeSettings(GONG, { maghrib: { sound: 'adhan' } }));

    expect(channels(startReminders('Maghrib'))).toEqual(['ontime_reminder_abc']);
    expect(channels(endReminders('Maghrib'))).toEqual(['ontime_reminder_abc']);
    expect(channels(atTime('Maghrib'))).toEqual(['ontime_prayer_adhan']);
    expect(channels(atTime('Fajr'))).toEqual(['ontime_prayer']);
  });

  it('makes sure the phone sound channel exists before posting to it', async () => {
    await scheduleNotifications(TORONTO, makeSettings(GONG));

    expect(AthanPlugin.createSoundChannel).toHaveBeenCalledWith({
      channelId: 'ontime_reminder_abc',
      channelName: 'Prayer reminders (Gentle Gong)',
      soundUri: 'content://media/internal/audio/media/60',
    });
    const created = vi.mocked(AthanPlugin.createSoundChannel).mock.invocationCallOrder[0];
    const posted = vi.mocked(LocalNotifications.schedule).mock.invocationCallOrder[0];
    expect(created).toBeLessThan(posted);
  });

  it('falls back to the plain sound rather than lose reminders when that channel cannot be made', async () => {
    vi.mocked(AthanPlugin.createSoundChannel).mockRejectedValue(new Error('no such sound'));
    await scheduleNotifications(TORONTO, makeSettings(GONG));

    expect(startReminders('Dhuhr').length).toBeGreaterThan(0);
    expect(channels(startReminders('Dhuhr'))).toEqual(['ontime_prayer']);
    expect(channels(endReminders('Dhuhr'))).toEqual(['ontime_prayer']);
  });

  it('silences every reminder when the reminder sound is None', async () => {
    await scheduleNotifications(TORONTO, makeSettings({ kind: 'silent' }));

    expect(channels(startReminders('Isha'))).toEqual(['ontime_prayer_silent']);
    expect(channels(endReminders('Isha'))).toEqual(['ontime_prayer_silent']);
    expect(channels(atTime('Isha'))).toEqual(['ontime_prayer']);
  });

  it('keeps a Silent prayer\'s reminders silent, whatever the reminder sound', async () => {
    await scheduleNotifications(TORONTO, makeSettings(GONG, { fajr: { sound: 'silent' } }));

    expect(channels(startReminders('Fajr'))).toEqual(['ontime_prayer_silent']);
    expect(channels(endReminders('Fajr'))).toEqual(['ontime_prayer_silent']);
    expect(channels(startReminders('Dhuhr'))).toEqual(['ontime_reminder_abc']);
  });

  it('does not touch the native channels when no phone sound is chosen', async () => {
    await scheduleNotifications(TORONTO, makeSettings({ kind: 'default' }));
    expect(AthanPlugin.createSoundChannel).not.toHaveBeenCalled();
  });
});
