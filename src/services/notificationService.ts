import { LocalNotifications, type ScheduleOptions } from '@capacitor/local-notifications';
import type { PrayerName, AllPrayerNames, Settings, NotificationSound, JumuahSettings, SurahKahfSettings, AthanSettings, Coordinates } from '../types';
import { calculatePrayerTimes } from './prayerService';

// Base IDs for each prayer (we'll add offsets for reminder vs at-time)
const PRAYER_BASE_IDS: Record<PrayerName, number> = {
  fajr: 100,
  sunrise: 200,
  dhuhr: 300,
  asr: 400,
  maghrib: 500,
  isha: 600,
};

// Jumuah notification IDs (700-799 range)
const JUMUAH_BASE_ID = 700;

// Offset for at-time notifications (reminder = base, at-time = base + 1)
const AT_TIME_OFFSET = 1;

// Days ahead to schedule notifications (limited by Android)
const DAYS_TO_SCHEDULE = 7;

// Weeks ahead to schedule Jumuah notifications
const WEEKS_TO_SCHEDULE_JUMUAH = 4;

const PRAYER_MESSAGES: Record<PrayerName, { reminder: string; atTime: string }> = {
  fajr: { reminder: 'Fajr prayer coming soon', atTime: 'Time for Fajr prayer' },
  sunrise: { reminder: 'Sunrise is approaching', atTime: 'The sun has risen' },
  dhuhr: { reminder: 'Dhuhr prayer coming soon', atTime: 'Time for Dhuhr prayer' },
  asr: { reminder: 'Asr prayer coming soon', atTime: 'Time for Asr prayer' },
  maghrib: { reminder: 'Maghrib prayer coming soon', atTime: 'Time for Maghrib prayer' },
  isha: { reminder: 'Isha prayer coming soon', atTime: 'Time for Isha prayer' },
};

// Map built-in sound types to actual sound file names
const BUILT_IN_SOUNDS: Record<string, string | undefined> = {
  default: undefined, // Uses system default
  adhan: 'adhan.wav',
  adhan_fajr: 'adhan_fajr.wav',
  silent: 'silent.wav',
};

// Check if a prayer name is a core prayer (not optional)
function isCorePrayer(name: AllPrayerNames): name is PrayerName {
  return name in PRAYER_BASE_IDS;
}

// Generate unique notification ID for a prayer on a specific day
function getNotificationId(prayer: PrayerName, dayOffset: number, isAtTime: boolean): number {
  const baseId = PRAYER_BASE_IDS[prayer];
  const timeOffset = isAtTime ? AT_TIME_OFFSET : 0;
  return baseId + (dayOffset * 10) + timeOffset;
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
  return BUILT_IN_SOUNDS[sound];
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
    // Fallback: use the main channel if any athan is selected
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
  return undefined;
}

export async function scheduleNotifications(
  coordinates: Coordinates,
  settings: Settings
): Promise<void> {
  if (!settings.notifications.enabled) {
    await cancelAllNotifications();
    return;
  }

  const hasPermission = await requestNotificationPermission();
  if (!hasPermission) {
    console.warn('Notification permission not granted');
    return;
  }

  // Cancel existing notifications first
  await cancelAllNotifications();

  const now = new Date();
  const notifications: ScheduleOptions['notifications'] = [];

  // Schedule notifications for multiple days, recalculating prayer times each day
  for (let dayOffset = 0; dayOffset < DAYS_TO_SCHEDULE; dayOffset++) {
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + dayOffset);

    const { prayers } = calculatePrayerTimes(
      coordinates,
      targetDate,
      settings.calculationMethod,
      settings.asrCalculation,
    );

    for (const prayer of prayers) {
      if (!isCorePrayer(prayer.name)) continue;

      const prayerSettings = settings.notifications.prayers[prayer.name];
      if (!prayerSettings.enabled) continue;

      const prayerTime = new Date(prayer.time);

      // Schedule reminder notification (X minutes before)
      if (prayerSettings.reminderMinutes > 0) {
        const reminderTime = new Date(prayerTime.getTime() - prayerSettings.reminderMinutes * 60000);

        if (reminderTime > now) {
          const sound = getSoundForNotification(prayerSettings.sound);
          const channelId = resolveChannelId(prayer.name, prayerSettings.sound, settings.athan);
          notifications.push({
            id: getNotificationId(prayer.name, dayOffset, false),
            title: prayer.label,
            body: PRAYER_MESSAGES[prayer.name].reminder,
            schedule: {
              at: reminderTime,
              allowWhileIdle: true,
            },
            sound: sound || 'default',
            channelId,
            smallIcon: 'ic_stat_icon',
            largeIcon: 'ic_launcher',
          });
        }
      }

      // Schedule at-time notification
      if (prayerSettings.atPrayerTime && prayerTime > now) {
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
          largeIcon: 'ic_launcher',
        });
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
    jumuahSettings.times.forEach((time, timeIndex) => {
      const [khutbahHour, khutbahMinute] = time.khutbah.split(':').map(Number);
      
      // Create khutbah time, then subtract reminder minutes using proper date arithmetic
      const khutbahTime = new Date(nextFriday);
      khutbahTime.setHours(khutbahHour, khutbahMinute, 0, 0);
      const reminderTime = new Date(khutbahTime.getTime() - jumuahSettings.reminderMinutes * 60000);

      // Only schedule if in the future
      if (reminderTime > now) {
        const notificationId = JUMUAH_BASE_ID + (weekOffset * 10) + timeIndex;
        
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
          largeIcon: 'ic_launcher',
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

// Surah Kahf notification IDs (800-899 range)
const SURAH_KAHF_BASE_ID = 800;

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
    // Find the upcoming Thursday (or today if Thursday)
    const firstThursday = new Date(now);
    const daysToThursday = (4 - now.getDay() + 7) % 7;
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
        id: SURAH_KAHF_BASE_ID + (weekOffset * 10),
        title: 'Surah Al-Kahf',
        body: "Jumu'ah has begun! Don't forget to read Surah Al-Kahf",
        schedule: {
          at: maghribTime,
          allowWhileIdle: true,
        },
        sound: 'default',
        smallIcon: 'ic_stat_icon',
        largeIcon: 'ic_launcher',
      });
    }

    // Repeat reminders every N hours until Friday Maghrib
    if (surahKahfSettings.repeatIntervalHours > 0) {
      const intervalMs = surahKahfSettings.repeatIntervalHours * 60 * 60 * 1000;
      let reminderTime = new Date(maghribTime.getTime() + intervalMs);
      let reminderIndex = 1;

      while (reminderTime < endTime && reminderIndex < 9) {
        if (reminderTime > now) {
          notifications.push({
            id: SURAH_KAHF_BASE_ID + (weekOffset * 10) + reminderIndex,
            title: 'Surah Al-Kahf Reminder',
            body: 'Have you read Surah Al-Kahf today?',
            schedule: {
              at: reminderTime,
              allowWhileIdle: true,
            },
            sound: 'default',
            smallIcon: 'ic_stat_icon',
            largeIcon: 'ic_launcher',
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
      return n.id >= SURAH_KAHF_BASE_ID && n.id < 900;
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
      // Jumuah notifications are in the 700-799 range
      return n.id >= JUMUAH_BASE_ID && n.id < 800;
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
