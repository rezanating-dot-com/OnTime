import { LocalNotifications, type Importance, type ScheduleOptions } from '@capacitor/local-notifications';
import type { PrayerName, AllPrayerNames, Settings, NotificationSound, JumuahSettings, SurahKahfSettings, AthanSettings, Coordinates, NotificationCategory, ReminderSound } from '../types';
import { calculatePrayerTimes, isValidPrayerTime } from './prayerService';
import { AthanPlugin } from '../plugins/athanPlugin';
import { reminderChannelNameFor } from './reminderSoundService';

/**
 * Notification ID ranges (do not reuse):
 *
 *   prayer:     1–999   (one per prayer per scheduled day)
 *   jumuah:     1000–1099
 *   kahf:       1100–1199
 *   reminder:   1200–1299
 *   travel:     1300    (the "Are you traveling?" prompt in App.tsx)
 *
 * Prayer sub-ranges within 1–999:
 *   fajr:    100–199   base 100, formula: base + (dayOffset * 10) + slot
 *   sunrise: 200–299   base 200
 *   dhuhr:   300–399   base 300
 *   asr:     400–499   base 400
 *   maghrib: 500–599   base 500
 *   isha:    600–699   base 600
 *
 * Each decade within a prayer's block, base + (decade * 10) + slot, holds:
 *   0      reminder before the prayer         (decade = dayOffset, 0–6)
 *   1      at prayer time                     (decade = dayOffset, 0–6)
 *   2–8    "before it ends" reminders, one per entry of END_REMINDER_OPTIONS
 *          (decade = dayOffset + 1, 0–7: the pass starts at yesterday, whose
 *          Isha window can still be open after local midnight)
 *   9      spare
 * The block therefore reaches base + 78 at most, and the hundreds digit still
 * names the prayer, which cancelNotification() and the click listener rely on.
 */

// Base IDs for each prayer (we'll add offsets for reminder vs at-time)
const PRAYER_BASE_IDS: Record<PrayerName, number> = {
  fajr: 100,
  sunrise: 200,
  dhuhr: 300,
  asr: 400,
  maghrib: 500,
  isha: 600,
};

// Jumuah notification IDs (1000–1099 range)
const JUMUAH_BASE_ID = 1000;
/**
 * Ids per scheduled week, and so the hard ceiling on jamaats per Friday.
 * WEEKS_TO_SCHEDULE_JUMUAH * JUMUAH_WEEK_STRIDE must stay within the 100-wide
 * block cancelJumuahNotifications() sweeps.
 *
 * This used to be 10 against an unbounded time index, so twelve jamaats
 * produced the duplicate ids [1010,1011,1020,1021,1030,1031] — and a
 * duplicate id inside one schedule() call means the later entry silently
 * replaces the earlier. The "+ Add Another" button appends unconditionally,
 * so it was UI-reachable rather than theoretical.
 */
const JUMUAH_WEEK_STRIDE = 25;
export const MAX_JUMUAH_TIMES = JUMUAH_WEEK_STRIDE;

// Offset for at-time notifications (reminder = base, at-time = base + 1)
const AT_TIME_OFFSET = 1;

/**
 * Minutes before a prayer window closes that a user can ask to be reminded
 * at. Capped at eight entries by the id layout above (slots 2–9); the order is
 * the slot order, so an entry must never be moved or removed once released —
 * that would silently change which armed alarm an id refers to.
 */
export const END_REMINDER_OPTIONS: readonly number[] = [5, 10, 15, 20, 30, 45, 60];
const END_REMINDER_SLOT_BASE = 2;
/**
 * The end-reminder pass starts one day back: Isha's window closes at Islamic
 * midnight, which is after local midnight, so between the two a rebuild (the
 * day-change top-up on resume, or any settings change) would otherwise cancel
 * last night's armed reminder and never put it back. Every other window closes
 * the same day, so for them yesterday yields nothing.
 */
const END_REMINDER_FIRST_DAY = -1;

// Days ahead to schedule notifications (limited by Android)
const DAYS_TO_SCHEDULE = 7;

// Weeks ahead to schedule Jumuah notifications
const WEEKS_TO_SCHEDULE_JUMUAH = 4;

function endReminderMessage(label: string, minutes: number): string {
  return `${label} ends in ${minutes} minutes`;
}

const PRAYER_MESSAGES: Record<PrayerName, { reminder: string; atTime: string }> = {
  fajr: { reminder: 'Fajr prayer coming soon', atTime: 'Time for Fajr prayer' },
  sunrise: { reminder: 'Sunrise is approaching', atTime: 'The sun has risen' },
  dhuhr: { reminder: 'Dhuhr prayer coming soon', atTime: 'Time for Dhuhr prayer' },
  asr: { reminder: 'Asr prayer coming soon', atTime: 'Time for Asr prayer' },
  maghrib: { reminder: 'Maghrib prayer coming soon', atTime: 'Time for Maghrib prayer' },
  isha: { reminder: 'Isha prayer coming soon', atTime: 'Time for Isha prayer' },
};

/**
 * One app-owned Android channel per built-in sound.
 *
 * On Android 8+ a notification's sound comes from its channel and `setSound()`
 * on the builder is ignored. Every built-in option used to post to the plugin's
 * single "default" channel — created once, with a sound read from
 * capacitor.config.ts's `LocalNotifications.sound`, which is unset — so all four
 * options made the same generic system noise, "Silent" included. A channel's
 * sound also cannot be changed after creation, so bundling the missing audio
 * alone would not have fixed it.
 *
 * `ships` records whether the audio is actually bundled in
 * `android/app/src/main/res/raw`. A channel pointing at a missing resource falls
 * back silently, which is how the two adhan options came to be indistinguishable
 * from Default — so no channel is created for one that is not bundled, and it
 * routes to the user's downloaded athan if one is selected and to the default
 * channel otherwise. Adding a file to res/raw and flipping its flag is all it
 * takes to make that option live.
 *
 * Importance 4 (HIGH) gives audible options a heads-up; the plugin's own default
 * channel is 3, which never shows one — wrong for a prayer notification.
 * Importance 2 (LOW) is how "Silent" works: Android plays no sound at all at
 * that importance, so it needs no silent audio file.
 */
const BUILT_IN_SOUNDS: Record<string, {
  file?: string;
  channelId: string;
  channelName: string;
  importance: Importance;
  ships: boolean;
}> = {
  default: { channelId: 'ontime_prayer', channelName: 'Prayer times', importance: 4, ships: true },
  silent: { channelId: 'ontime_prayer_silent', channelName: 'Prayer times (silent)', importance: 2, ships: true },
  adhan: { file: 'adhan.mp3', channelId: 'ontime_prayer_adhan', channelName: 'Prayer times (Adhan)', importance: 4, ships: true },
  // Not bundled: none of the available recordings is a Fajr adhan (with
  // aṣ-ṣalātu khayrun minan-nawm), and labelling a general one "Fajr Adhan"
  // would repeat the promise the "(Built-in)" suffix was just removed for.
  // Tracked in issue #17. Until then this routes to the user's downloaded Fajr
  // athan if they have one, and to the default channel otherwise.
  adhan_fajr: { file: 'adhan_fajr.wav', channelId: 'ontime_prayer_adhan_fajr', channelName: 'Prayer times (Adhan Fajr)', importance: 4, ships: false },
};

let builtInChannels: Promise<void> | null = null;

/**
 * Create the app-owned channels for the built-in sounds. Android ignores a
 * repeat creation for an existing id, so this is safe to call on every
 * reschedule; the memo just keeps a full rebuild from issuing redundant bridge
 * calls.
 */
export function ensureBuiltInSoundChannels(): Promise<void> {
  builtInChannels ??= (async () => {
    for (const builtIn of Object.values(BUILT_IN_SOUNDS)) {
      if (!builtIn.ships) continue;
      try {
        await LocalNotifications.createChannel({
          id: builtIn.channelId,
          name: builtIn.channelName,
          description: '',
          sound: builtIn.file,
          importance: builtIn.importance,
          visibility: 1,
        });
      } catch {
        // Pre-Android-8 has no channels; the per-notification sound still
        // applies there, so there is nothing to set up.
      }
    }
  })();
  return builtInChannels;
}

// Check if a prayer name is a core prayer (not optional)
function isCorePrayer(name: AllPrayerNames): name is PrayerName {
  return name in PRAYER_BASE_IDS;
}

// Generate unique notification ID for a prayer on a specific day
export function getNotificationId(prayer: PrayerName, dayOffset: number, isAtTime: boolean): number {
  const baseId = PRAYER_BASE_IDS[prayer];
  const timeOffset = isAtTime ? AT_TIME_OFFSET : 0;
  return baseId + (dayOffset * 10) + timeOffset;
}

// Generate unique notification ID for a "before it ends" reminder
export function getEndReminderNotificationId(prayer: PrayerName, dayOffset: number, minutes: number): number {
  const slot = END_REMINDER_OPTIONS.indexOf(minutes);
  if (slot === -1) {
    throw new RangeError(`${minutes} is not an end reminder option`);
  }
  // Shifted one decade up so END_REMINDER_FIRST_DAY lands in decade 0, not in
  // the block below.
  const decade = dayOffset - END_REMINDER_FIRST_DAY;
  return PRAYER_BASE_IDS[prayer] + (decade * 10) + END_REMINDER_SLOT_BASE + slot;
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const permission = await LocalNotifications.checkPermissions();
    
    if (permission.display === 'granted') {
      return true;
    }

    if (permission.display === 'denied') {
      return false;
    }

    const result = await LocalNotifications.requestPermissions();
    return result.display === 'granted';
  } catch (error) {
    console.error('Failed to request notification permission:', error);
    return false;
  }
}

// Check if a sound value refers to a downloaded athan
function isDownloadedAthan(sound: NotificationSound): boolean {
  return sound.startsWith('athan:');
}

// Get the athan ID from a sound value like 'athan:abc123'
function getAthanIdFromSound(sound: NotificationSound): string {
  return sound.replace('athan:', '');
}

// Get sound string for notification
function getSoundForNotification(sound: NotificationSound): string | undefined {
  if (isDownloadedAthan(sound)) {
    // Downloaded athans use channels, not sound files directly
    return undefined;
  }
  return BUILT_IN_SOUNDS[sound]?.file;
}

// Resolve the notification channel ID based on prayer, sound, and athan settings
function resolveChannelId(
  prayer: PrayerName,
  sound: NotificationSound,
  athanSettings: AthanSettings,
): string | undefined {
  // Downloaded athan - find its channel
  if (isDownloadedAthan(sound)) {
    const athanId = getAthanIdFromSound(sound);
    // Check if this athan has a dedicated fajr channel
    if (prayer === 'fajr' && athanSettings.selectedFajrAthanId === athanId && athanSettings.currentFajrChannelId) {
      return athanSettings.currentFajrChannelId;
    }
    // Use the main athan channel if the selected athan matches
    if (athanSettings.selectedAthanId === athanId && athanSettings.currentChannelId) {
      return athanSettings.currentChannelId;
    }
    // Legacy value: the per-prayer athan picker no longer exists, because no
    // channel was ever created for a non-selected athan and the choice could
    // not be honoured. Values stored before its removal still land here — the
    // main athan is the closest thing to what the user asked for, and it is
    // what the 'adhan' option resolves to as well.
    if (athanSettings.currentChannelId) {
      return athanSettings.currentChannelId;
    }
    return undefined;
  }

  // Fajr with dedicated fajr channel
  if (prayer === 'fajr' && (sound === 'adhan_fajr' || sound === 'adhan') && athanSettings.currentFajrChannelId) {
    return athanSettings.currentFajrChannelId;
  }
  // Any prayer with athan sound and main channel
  if ((sound === 'adhan' || sound === 'adhan_fajr') && athanSettings.currentChannelId) {
    return athanSettings.currentChannelId;
  }
  // Built-in sounds each get their own channel, which is the only thing that
  // makes the choice audible at all on Android 8+.
  const builtIn = BUILT_IN_SOUNDS[sound];
  if (builtIn?.ships) {
    return builtIn.channelId;
  }
  // No bundled audio for it and no downloaded athan selected: still land on the
  // app's own heads-up channel rather than the plugin's IMPORTANCE_DEFAULT one.
  return BUILT_IN_SOUNDS.default.channelId;
}

/**
 * Make sure the channel for a phone reminder sound exists before anything is
 * posted to it. Android ignores a repeat creation, so this is cheap, and it
 * covers a profile restored onto a new install, where the settings come back
 * but the channel does not — and Android silently drops a notification posted
 * to a channel that does not exist.
 *
 * Resolves false when there is no phone sound, or the channel could not be
 * made (off Android, or the sound is gone), and reminders then fall back to
 * the plain channel rather than be lost.
 */
async function ensureReminderSoundChannel(reminderSound: ReminderSound): Promise<boolean> {
  if (reminderSound.kind !== 'system') return false;
  try {
    await AthanPlugin.createSoundChannel({
      channelId: reminderSound.channelId,
      channelName: reminderChannelNameFor(reminderSound.title),
      soundUri: reminderSound.uri,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * The channel a prayer's reminders post to — the one before the prayer and
 * the "before it ends" ones. They are nudges, not a call to prayer, so they
 * never play the athan: the user's reminder sound, or silence when either it
 * or the prayer itself is silent.
 */
function resolveReminderChannelId(
  prayerSound: NotificationSound,
  reminderSound: ReminderSound,
  phoneSoundReady: boolean,
): string {
  if (prayerSound === 'silent' || reminderSound.kind === 'silent') {
    return BUILT_IN_SOUNDS.silent.channelId;
  }
  if (reminderSound.kind === 'system' && phoneSoundReady) {
    return reminderSound.channelId;
  }
  return BUILT_IN_SOUNDS.default.channelId;
}

// ID range boundaries for each notification category
const CATEGORY_RANGES: Record<NotificationCategory, [number, number]> = {
  prayer: [1, 999],
  jumuah: [1000, 1099],
  kahf: [1100, 1199],
  reminder: [1200, 1299],
};

/**
 * Exactly the settings a prayer schedule is built from — nothing else in
 * Settings changes what gets scheduled.
 *
 * Narrowed rather than taking the whole object so the compiler, not a comment,
 * keeps useNotifications' dependency list honest: depending on all of
 * `settings` meant a theme change or a distance-unit change rebuilt all ~80
 * alarms.
 */
export type PrayerScheduleSettings = Pick<
  Settings,
  'notifications' | 'athan' | 'calculationMethod' | 'asrCalculation'
>;

export async function scheduleNotifications(
  coordinates: Coordinates,
  settings: PrayerScheduleSettings
): Promise<void> {
  if (!settings.notifications.enabled) {
    await cancelAllNotifications();
    return;
  }

  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) {
    // Clear the prayer range on the way out. Returning before this left
    // whatever was already armed in place — from a run when permission was
    // still granted, or from a previous install — so a user who has just
    // revoked notifications could still be woken by the old schedule.
    console.warn('Notification permission not granted');
    await cancelByCategory('prayer');
    return;
  }

  // Channels carry the sound on Android 8+, so they have to exist before any
  // notification that names one is posted.
  await ensureBuiltInSoundChannels();
  const reminderSound = settings.notifications.reminderSound;
  const phoneSoundReady = await ensureReminderSoundChannel(reminderSound);

  // Cancel only prayer-range notifications, not other categories
  await cancelByCategory('prayer');

  const now = new Date();
  const notifications: ScheduleOptions['notifications'] = [];

  // Schedule notifications for multiple days, recalculating prayer times each day
  for (let dayOffset = END_REMINDER_FIRST_DAY; dayOffset < DAYS_TO_SCHEDULE; dayOffset++) {
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + dayOffset);
    // Asked at noon: the prayer times only depend on the calendar day, but
    // before Fajr calculatePrayerTimes hands back *last* night's sunnah times,
    // and the Isha window has to close at the midnight that follows this
    // evening's Isha, not the one already behind us.
    targetDate.setHours(12, 0, 0, 0);

    const { prayers, sunnahTimes } = calculatePrayerTimes(
      coordinates,
      targetDate,
      settings.calculationMethod,
      settings.asrCalculation,
    );

    const timeOf = (name: PrayerName): Date | undefined => prayers.find((p) => p.name === name)?.time;
    // When each window closes. Sunrise is not a prayer, so it has no window to
    // close; Isha's preferred time runs to Islamic midnight, the midpoint of
    // the night, which is the same instant the Middle of Night row shows.
    const windowEnd: Record<PrayerName, Date | undefined> = {
      fajr: timeOf('sunrise'),
      sunrise: undefined,
      dhuhr: timeOf('asr'),
      asr: timeOf('maghrib'),
      maghrib: timeOf('isha'),
      isha: sunnahTimes?.middleOfTheNight,
    };

    for (const prayer of prayers) {
      if (!isCorePrayer(prayer.name)) continue;

      const prayerSettings = settings.notifications.prayers[prayer.name];
      if (!prayerSettings.enabled) continue;

      const prayerTime = new Date(prayer.time);
      const reminderChannelId = resolveReminderChannelId(prayerSettings.sound, reminderSound, phoneSoundReady);

      // Schedule reminder notification (X minutes before). Yesterday is only
      // walked for the end reminders: every start time of a past day is past.
      if (dayOffset >= 0 && prayerSettings.reminderMinutes > 0) {
        const reminderTime = new Date(prayerTime.getTime() - prayerSettings.reminderMinutes * 60000);

        if (reminderTime > now) {
          notifications.push({
            id: getNotificationId(prayer.name, dayOffset, false),
            title: prayer.label,
            body: PRAYER_MESSAGES[prayer.name].reminder,
            schedule: {
              at: reminderTime,
              allowWhileIdle: true,
            },
            sound: 'default',
            channelId: reminderChannelId,
            smallIcon: 'ic_stat_icon',
          });
        }
      }

      // Schedule at-time notification
      if (dayOffset >= 0 && prayerSettings.atPrayerTime && prayerTime > now) {
        const sound = getSoundForNotification(prayerSettings.sound);
        const channelId = resolveChannelId(prayer.name, prayerSettings.sound, settings.athan);
        notifications.push({
          id: getNotificationId(prayer.name, dayOffset, true),
          title: prayer.label,
          body: PRAYER_MESSAGES[prayer.name].atTime,
          schedule: {
            at: prayerTime,
            allowWhileIdle: true,
          },
          sound: sound || 'default',
          channelId,
          smallIcon: 'ic_stat_icon',
          });
      }

      // Schedule "before it ends" reminders (X minutes before the window closes)
      const end = windowEnd[prayer.name];
      if (end && isValidPrayerTime(end) && prayerSettings.endReminderMinutes.length > 0) {
        for (const minutes of END_REMINDER_OPTIONS) {
          if (!prayerSettings.endReminderMinutes.includes(minutes)) continue;
          const reminderTime = new Date(end.getTime() - minutes * 60000);
          // A window shorter than the lead time (Maghrib to Isha near the
          // equator can be under 40 minutes) would otherwise announce the end
          // of a prayer that has not begun.
          if (reminderTime <= prayerTime || reminderTime <= now) continue;
          notifications.push({
            id: getEndReminderNotificationId(prayer.name, dayOffset, minutes),
            title: prayer.label,
            body: endReminderMessage(prayer.label, minutes),
            schedule: {
              at: reminderTime,
              allowWhileIdle: true,
            },
            sound: 'default',
            channelId: reminderChannelId,
            smallIcon: 'ic_stat_icon',
          });
        }
      }
    }
  }

  if (notifications.length > 0) {
    try {
      await LocalNotifications.schedule({ notifications });
      console.log(`Scheduled ${notifications.length} notifications for ${DAYS_TO_SCHEDULE} days`);
    } catch (error) {
      console.error('Failed to schedule notifications:', error);
    }
  }
}

export async function cancelAllNotifications(): Promise<void> {
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map((n) => ({ id: n.id })),
      });
    }
  } catch (error) {
    console.error('Failed to cancel notifications:', error);
  }
}

// Cancel all notifications within a specific category's ID range
export async function cancelByCategory(category: NotificationCategory): Promise<void> {
  try {
    const pending = await LocalNotifications.getPending();
    const [min, max] = CATEGORY_RANGES[category];
    const toCancel = pending.notifications.filter((n) => n.id >= min && n.id <= max);
    if (toCancel.length > 0) {
      await LocalNotifications.cancel({
        notifications: toCancel.map((n) => ({ id: n.id })),
      });
    }
  } catch (error) {
    console.error(`Failed to cancel ${category} notifications:`, error);
  }
}

export async function cancelNotification(prayer: PrayerName): Promise<void> {
  try {
    // Cancel all notifications for this prayer (across all days)
    const pending = await LocalNotifications.getPending();
    const baseId = PRAYER_BASE_IDS[prayer];
    const toCancel = pending.notifications.filter((n) => {
      // Check if notification ID belongs to this prayer
      return Math.floor(n.id / 100) * 100 === baseId;
    });
    
    if (toCancel.length > 0) {
      await LocalNotifications.cancel({
        notifications: toCancel.map((n) => ({ id: n.id })),
      });
    }
  } catch (error) {
    console.error(`Failed to cancel notification for ${prayer}:`, error);
  }
}

// Listen for notification clicks
export function setupNotificationListeners(
  onNotificationClick?: (prayerName: PrayerName) => void
): () => void {
  const listener = LocalNotifications.addListener(
    'localNotificationActionPerformed',
    (notification) => {
      const id = notification.notification.id;
      // Extract prayer from notification ID (first digit * 100 is the base)
      const baseId = Math.floor(id / 100) * 100;
      const prayerName = Object.entries(PRAYER_BASE_IDS).find(
        ([, base]) => base === baseId
      )?.[0] as PrayerName | undefined;

      if (prayerName && onNotificationClick) {
        onNotificationClick(prayerName);
      }
    }
  );

  return () => {
    listener.then((l) => l.remove());
  };
}

// Get pending notifications count (useful for debugging)
export async function getPendingNotificationsCount(): Promise<number> {
  try {
    const pending = await LocalNotifications.getPending();
    return pending.notifications.length;
  } catch (error) {
    console.error('Failed to get pending notifications:', error);
    return 0;
  }
}

// Schedule Jumuah notifications
export async function scheduleJumuahNotifications(
  jumuahSettings: JumuahSettings
): Promise<void> {
  // First cancel existing Jumuah notifications
  await cancelJumuahNotifications();

  if (!jumuahSettings.enabled || jumuahSettings.times.length === 0) {
    return;
  }

  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) {
    console.warn('Notification permission not granted');
    return;
  }

  const now = new Date();
  const notifications: ScheduleOptions['notifications'] = [];

  // Find next Fridays for the next N weeks
  for (let weekOffset = 0; weekOffset < WEEKS_TO_SCHEDULE_JUMUAH; weekOffset++) {
    // Find the next Friday
    const nextFriday = new Date(now);
    const daysUntilFriday = (5 - now.getDay() + 7) % 7; // 5 = Friday
    nextFriday.setDate(now.getDate() + daysUntilFriday + (weekOffset * 7));

    // Schedule notification for each Jumuah time
    jumuahSettings.times.slice(0, MAX_JUMUAH_TIMES).forEach((time, timeIndex) => {
      const [khutbahHour, khutbahMinute] = time.khutbah.split(':').map(Number);
      
      // Create khutbah time, then subtract reminder minutes using proper date arithmetic
      const khutbahTime = new Date(nextFriday);
      khutbahTime.setHours(khutbahHour, khutbahMinute, 0, 0);
      const reminderTime = new Date(khutbahTime.getTime() - jumuahSettings.reminderMinutes * 60000);

      // Only schedule if in the future
      if (reminderTime > now) {
        const notificationId = JUMUAH_BASE_ID + (weekOffset * JUMUAH_WEEK_STRIDE) + timeIndex;
        
        const masjidText = jumuahSettings.masjidName 
          ? ` at ${jumuahSettings.masjidName}` 
          : '';
        
        notifications.push({
          id: notificationId,
          title: "Jumu'ah Prayer",
          body: `Khutbah starting soon${masjidText}`,
          schedule: {
            at: reminderTime,
            allowWhileIdle: true,
          },
          sound: 'default',
          smallIcon: 'ic_stat_icon',
          });
      }
    });
  }

  if (notifications.length > 0) {
    try {
      await LocalNotifications.schedule({ notifications });
      console.log(`Scheduled ${notifications.length} Jumuah notifications for ${WEEKS_TO_SCHEDULE_JUMUAH} weeks`);
    } catch (error) {
      console.error('Failed to schedule Jumuah notifications:', error);
    }
  }
}

// Surah Kahf notification IDs (1100–1199 range)
const SURAH_KAHF_BASE_ID = 1100;
/**
 * Ids per scheduled week: one for the Thursday-Maghrib opener plus up to
 * MAX_KAHF_REMINDERS repeats. WEEKS_TO_SCHEDULE_KAHF * KAHF_WEEK_STRIDE has to
 * stay inside the 100-wide block cancelSurahKahfNotifications() sweeps.
 *
 * The stride used to be 10, which forced the repeat loop to stop after eight
 * reminders. At the finest interval the app offers (2h) that covered 16h of a
 * ~24h window — the last reminder landing around 11:37 against a ~19:15
 * Maghrib, leaving the whole of Friday afternoon uncovered, which is exactly
 * when "have you read Surah Al-Kahf today?" is worth asking. 25 covers a full
 * 24h window at 2h intervals with room to spare.
 */
const KAHF_WEEK_STRIDE = 25;
const MAX_KAHF_REMINDERS = KAHF_WEEK_STRIDE - 1;

// Weeks ahead to schedule Surah Kahf notifications
const WEEKS_TO_SCHEDULE_KAHF = 4;

// Schedule Surah Kahf reminders
// Islamic day starts at Maghrib, so Thursday Maghrib = start of Islamic Friday
// Reminders fire at Thursday Maghrib, then repeat every N hours until Friday Maghrib
export async function scheduleSurahKahfNotifications(
  coordinates: Coordinates,
  surahKahfSettings: SurahKahfSettings,
  calculationMethod: Settings['calculationMethod'],
  asrCalculation: Settings['asrCalculation'],
): Promise<void> {
  await cancelSurahKahfNotifications();

  if (!surahKahfSettings.enabled) {
    return;
  }

  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) {
    console.warn('Notification permission not granted');
    return;
  }

  const now = new Date();
  const notifications: ScheduleOptions['notifications'] = [];

  for (let weekOffset = 0; weekOffset < WEEKS_TO_SCHEDULE_KAHF; weekOffset++) {
    // Find the Thursday that opens the relevant Islamic Friday. On Friday
    // itself that window is already in progress (it runs until Friday
    // Maghrib), so anchor to yesterday's Thursday rather than next week's —
    // past notifications in the window are filtered out below.
    const firstThursday = new Date(now);
    const daysToThursday = now.getDay() === 5 ? -1 : (4 - now.getDay() + 7) % 7;
    firstThursday.setDate(now.getDate() + daysToThursday);
    const nextThursday = new Date(firstThursday);
    nextThursday.setDate(firstThursday.getDate() + (weekOffset * 7));

    // Get Thursday Maghrib (Islamic Friday begins)
    const { prayers: thursdayPrayers } = calculatePrayerTimes(
      coordinates,
      nextThursday,
      calculationMethod,
      asrCalculation,
    );
    const thursdayMaghrib = thursdayPrayers.find(p => p.name === 'maghrib');
    if (!thursdayMaghrib) continue;
    const maghribTime = new Date(thursdayMaghrib.time);

    // Get Friday Maghrib (Islamic Friday ends)
    const nextFriday = new Date(nextThursday);
    nextFriday.setDate(nextThursday.getDate() + 1);
    const { prayers: fridayPrayers } = calculatePrayerTimes(
      coordinates,
      nextFriday,
      calculationMethod,
      asrCalculation,
    );
    const fridayMaghrib = fridayPrayers.find(p => p.name === 'maghrib');
    if (!fridayMaghrib) continue;
    const endTime = new Date(fridayMaghrib.time);

    // First notification: Thursday Maghrib
    if (maghribTime > now) {
      notifications.push({
        id: SURAH_KAHF_BASE_ID + (weekOffset * KAHF_WEEK_STRIDE),
        title: 'Surah Al-Kahf',
        body: "Jumu'ah has begun! Don't forget to read Surah Al-Kahf",
        schedule: {
          at: maghribTime,
          allowWhileIdle: true,
        },
        sound: 'default',
        smallIcon: 'ic_stat_icon',
      });
    }

    // Repeat reminders every N hours until Friday Maghrib
    if (surahKahfSettings.repeatIntervalHours > 0) {
      const intervalMs = surahKahfSettings.repeatIntervalHours * 60 * 60 * 1000;
      let reminderTime = new Date(maghribTime.getTime() + intervalMs);
      let reminderIndex = 1;

      while (reminderTime < endTime && reminderIndex <= MAX_KAHF_REMINDERS) {
        if (reminderTime > now) {
          notifications.push({
            id: SURAH_KAHF_BASE_ID + (weekOffset * KAHF_WEEK_STRIDE) + reminderIndex,
            title: 'Surah Al-Kahf Reminder',
            body: 'Have you read Surah Al-Kahf today?',
            schedule: {
              at: reminderTime,
              allowWhileIdle: true,
            },
            sound: 'default',
            smallIcon: 'ic_stat_icon',
              });
        }
        reminderTime = new Date(reminderTime.getTime() + intervalMs);
        reminderIndex++;
      }
    }
  }

  if (notifications.length > 0) {
    try {
      await LocalNotifications.schedule({ notifications });
      console.log(`Scheduled ${notifications.length} Surah Kahf notifications for ${WEEKS_TO_SCHEDULE_KAHF} weeks`);
    } catch (error) {
      console.error('Failed to schedule Surah Kahf notifications:', error);
    }
  }
}

// Cancel all Surah Kahf notifications
export async function cancelSurahKahfNotifications(): Promise<void> {
  try {
    const pending = await LocalNotifications.getPending();
    const kahfNotifications = pending.notifications.filter((n) => {
      return n.id >= SURAH_KAHF_BASE_ID && n.id < 1200;
    });
    if (kahfNotifications.length > 0) {
      await LocalNotifications.cancel({
        notifications: kahfNotifications.map((n) => ({ id: n.id })),
      });
    }
  } catch (error) {
    console.error('Failed to cancel Surah Kahf notifications:', error);
  }
}

// Cancel all Jumuah notifications
export async function cancelJumuahNotifications(): Promise<void> {
  try {
    const pending = await LocalNotifications.getPending();
    const jumuahNotifications = pending.notifications.filter((n) => {
      // Jumuah notifications are in the 1000–1099 range
      return n.id >= JUMUAH_BASE_ID && n.id < 1100;
    });
    
    if (jumuahNotifications.length > 0) {
      await LocalNotifications.cancel({
        notifications: jumuahNotifications.map((n) => ({ id: n.id })),
      });
    }
  } catch (error) {
    console.error('Failed to cancel Jumuah notifications:', error);
  }
}