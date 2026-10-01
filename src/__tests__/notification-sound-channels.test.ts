import { LocalNotifications } from '@capacitor/local-notifications';
import {
  scheduleNotifications,
  ensureBuiltInSoundChannels,
} from '../services/notificationService';
import { defaultAthanSettings } from '../context/SettingsContext';
import type { Settings, NotificationSound, PrayerName, AthanSettings } from '../types';

/**
 * On Android 8+ a notification's sound comes from its channel, and `setSound()`
 * on the builder is ignored. Every built-in option used to omit `channelId` and
 * so posted to the plugin's single "default" channel — created once, with a
 * sound read from `capacitor.config.ts`'s `LocalNotifications.sound`, which is
 * unset. All four options were therefore identical in effect, "Silent" included,
 * and adding the missing audio files alone would not have changed that because a
 * channel's sound is fixed at creation.
 *
 * These live in their own file on purpose: `ensureBuiltInSoundChannels` memoises
 * at module scope, so sharing a file with other notification tests would make
 * the createChannel assertions depend on which test ran first.
 */
const TORONTO = { latitude: 43.6532, longitude: -79.3832 };

function prayerSettings(sound: NotificationSound): Settings['notifications']['prayers'] {
  const names: PrayerName[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  return Object.fromEntries(
    names.map((name) => [
      name,
      { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound, endReminderMinutes: [] },
    ]),
  ) as Settings['notifications']['prayers'];
}

function makeSettings(sound: NotificationSound, athan: AthanSettings = defaultAthanSettings): Settings {
  return {
    calculationMethod: 'NorthAmerica',
    asrCalculation: 'Standard',
    optionalPrayers: { showSunrise: true, showMiddleOfNight: true, showLastThirdOfNight: true },
    notifications: {
      enabled: true,
      defaultSound: sound,
      defaultReminderMinutes: 15,
      prayers: prayerSettings(sound),
    },
    jumuah: { enabled: false, masjidName: '', times: [], reminderMinutes: 30 },
    travel: {} as Settings['travel'],
    display: { showCurrentPrayer: true, showNextPrayer: true, showSunnahCard: true },
    athan,
    surahKahf: {} as Settings['surahKahf'],
    previousLocations: [],
    distanceUnit: 'miles',
    designStyle: 'classic',
  } as Settings;
}

describe('built-in notification sound channels', () => {
  let scheduled: Record<string, unknown>[] = [];

  beforeEach(() => {
    scheduled = [];
    vi.mocked(LocalNotifications.schedule).mockImplementation(
      async (opts: { notifications: Record<string, unknown>[] }) => {
        scheduled.push(...opts.notifications);
        return { notifications: [] };
      },
    );
    vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' } as never);
    vi.mocked(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'granted' } as never);
    (LocalNotifications as Record<string, unknown>).getPending = vi
      .fn()
      .mockResolvedValue({ notifications: [] });
  });

  async function channelsFor(sound: NotificationSound, athan?: AthanSettings): Promise<string[]> {
    scheduled = [];
    await scheduleNotifications(TORONTO, makeSettings(sound, athan));
    return [...new Set(scheduled.map((n) => String(n.channelId)))];
  }

  it('creates a channel for each sound that actually ships audio', async () => {
    await ensureBuiltInSoundChannels();

    const created = vi.mocked(LocalNotifications.createChannel).mock.calls.map(([c]) => c);
    const ids = created.map((c) => c.id);
    expect(ids).toContain('ontime_prayer');
    expect(ids).toContain('ontime_prayer_silent');

    // Silent is a low-importance channel, which Android plays with no sound at
    // all — that is what makes the option real without shipping a silent file.
    const silent = created.find((c) => c.id === 'ontime_prayer_silent');
    expect(silent?.importance).toBe(2);
    expect(silent?.sound).toBeUndefined();

    // The bundled adhan gets a channel now that res/raw/adhan.mp3 ships, and it
    // has to name that file — the plugin strips the extension and resolves the
    // resource by name.
    expect(ids).toContain('ontime_prayer_adhan');
    expect(created.find((c) => c.id === 'ontime_prayer_adhan')?.sound).toBe('adhan.mp3');

    // No channel for a sound whose audio is NOT bundled: pointing one at a
    // missing res/raw resource falls back silently, which is exactly the
    // failure this is meant to prevent.
    expect(ids).not.toContain('ontime_prayer_adhan_fajr');
  });

  it('puts every prayer notification on an app-owned channel', async () => {
    for (const sound of ['default', 'silent', 'adhan', 'adhan_fajr'] as NotificationSound[]) {
      const channels = await channelsFor(sound);
      expect(channels.length, sound).toBeGreaterThan(0);
      expect(channels, sound).not.toContain('undefined');
      expect(
        channels.every((c) => c.startsWith('ontime_') || c.startsWith('athan_')),
        sound,
      ).toBe(true);
    }
  });

  it('gives Silent a different channel from Default', async () => {
    // The whole point: if these were the same channel, both options would make
    // the same noise however they were labelled.
    expect(await channelsFor('silent')).not.toEqual(await channelsFor('default'));
  });

  it('still prefers a downloaded athan over the built-in channels', async () => {
    const athan: AthanSettings = {
      ...defaultAthanSettings,
      selectedAthanId: 'abc123',
      currentChannelId: 'athan_main_abc123',
    };

    expect(await channelsFor('adhan', athan)).toEqual(['athan_main_abc123']);
  });

  it('routes Fajr to the dedicated Fajr athan channel when one is selected', async () => {
    const athan: AthanSettings = {
      ...defaultAthanSettings,
      selectedAthanId: 'abc123',
      currentChannelId: 'athan_main_abc123',
      selectedFajrAthanId: 'def456',
      currentFajrChannelId: 'athan_fajr_def456',
    };

    await scheduleNotifications(TORONTO, makeSettings('adhan_fajr', athan));

    const fajr = scheduled.filter((n) => String(n.title).toLowerCase().includes('fajr'));
    expect(fajr.length).toBeGreaterThan(0);
    expect(fajr.every((n) => n.channelId === 'athan_fajr_def456')).toBe(true);
  });

  it('creates the channels once, however many times scheduling runs', async () => {
    await ensureBuiltInSoundChannels();
    const afterFirst = vi.mocked(LocalNotifications.createChannel).mock.calls.length;

    await ensureBuiltInSoundChannels();
    await scheduleNotifications(TORONTO, makeSettings('default'));
    await scheduleNotifications(TORONTO, makeSettings('silent'));

    expect(vi.mocked(LocalNotifications.createChannel).mock.calls.length).toBe(afterFirst);
  });
});
