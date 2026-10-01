import { AthanPlugin } from '../plugins/athanPlugin';
import type { ReminderSound } from '../types';

/**
 * Channel id for a phone sound. Stable per sound, so picking the same one
 * again reuses its channel, and distinct across sounds, because Android fixes
 * a channel's sound when it is created and a new sound needs a new channel.
 */
export function reminderChannelIdFor(uri: string): string {
  let hash = 5381;
  for (let i = 0; i < uri.length; i++) {
    hash = ((hash << 5) + hash + uri.charCodeAt(i)) | 0;
  }
  return `ontime_reminder_${(hash >>> 0).toString(36)}`;
}

/** The name Android shows for the channel in the app's notification settings. */
export function reminderChannelNameFor(title: string): string {
  return `Prayer reminders (${title})`;
}

function existingFor(current: ReminderSound): string {
  return current.kind === 'system' ? current.uri : current.kind;
}

/**
 * Let the user pick the reminder sound with Android's own picker.
 *
 * Resolves to the new sound, or null if they backed out. Throws, leaving the
 * current sound and its channel untouched, if the phone will not make a
 * channel for the picked sound.
 */
export async function chooseReminderSound(current: ReminderSound): Promise<ReminderSound | null> {
  const picked = await AthanPlugin.pickNotificationSound({ existing: existingFor(current) });
  if (picked.cancelled) return null;

  let next: ReminderSound;
  if (picked.kind === 'system') {
    const channelId = reminderChannelIdFor(picked.uri);
    // The replacement first, as with the athan channels: a reminder posted
    // between the two steps must find a channel that exists.
    await AthanPlugin.createSoundChannel({
      channelId,
      channelName: reminderChannelNameFor(picked.title),
      soundUri: picked.uri,
    });
    next = { kind: 'system', uri: picked.uri, title: picked.title, channelId };
  } else {
    next = { kind: picked.kind };
  }

  if (current.kind === 'system' && !(next.kind === 'system' && next.channelId === current.channelId)) {
    // A leftover channel only clutters the app's notification settings;
    // failing the switch over it would be worse.
    await AthanPlugin.deleteChannel({ channelId: current.channelId }).catch(() => {});
  }
  return next;
}
