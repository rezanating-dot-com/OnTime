import { AthanPlugin } from '../plugins/athanPlugin';
import { chooseReminderSound, reminderChannelIdFor } from '../services/reminderSoundService';
import type { ReminderSound } from '../types';

vi.mock('../plugins/athanPlugin', () => ({
  AthanPlugin: {
    pickNotificationSound: vi.fn(),
    createSoundChannel: vi.fn().mockResolvedValue(undefined),
    deleteChannel: vi.fn().mockResolvedValue(undefined),
  },
}));

const GONG_URI = 'content://media/internal/audio/media/60';
const PING_URI = 'content://media/internal/audio/media/66';

const gong: ReminderSound = {
  kind: 'system',
  uri: GONG_URI,
  title: 'Gentle Gong',
  channelId: reminderChannelIdFor(GONG_URI),
};

describe('choosing the reminder sound from the phone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AthanPlugin.createSoundChannel).mockResolvedValue(undefined);
    vi.mocked(AthanPlugin.deleteChannel).mockResolvedValue(undefined);
  });

  it('gives each sound its own stable channel id', () => {
    expect(reminderChannelIdFor(GONG_URI)).toBe(reminderChannelIdFor(GONG_URI));
    expect(reminderChannelIdFor(GONG_URI)).not.toBe(reminderChannelIdFor(PING_URI));
    expect(reminderChannelIdFor(GONG_URI)).toMatch(/^ontime_reminder_[a-z0-9]+$/);
  });

  it('opens the picker on the sound in use', async () => {
    vi.mocked(AthanPlugin.pickNotificationSound).mockResolvedValue({ cancelled: true });

    await chooseReminderSound(gong);
    expect(AthanPlugin.pickNotificationSound).toHaveBeenCalledWith({ existing: GONG_URI });

    await chooseReminderSound({ kind: 'default' });
    expect(AthanPlugin.pickNotificationSound).toHaveBeenLastCalledWith({ existing: 'default' });

    await chooseReminderSound({ kind: 'silent' });
    expect(AthanPlugin.pickNotificationSound).toHaveBeenLastCalledWith({ existing: 'silent' });
  });

  it('returns null and changes nothing when the picker is backed out of', async () => {
    vi.mocked(AthanPlugin.pickNotificationSound).mockResolvedValue({ cancelled: true });

    expect(await chooseReminderSound(gong)).toBeNull();
    expect(AthanPlugin.createSoundChannel).not.toHaveBeenCalled();
    expect(AthanPlugin.deleteChannel).not.toHaveBeenCalled();
  });

  it('makes a channel for a picked phone sound, then retires the old one', async () => {
    vi.mocked(AthanPlugin.pickNotificationSound).mockResolvedValue({ cancelled: false, kind: 'system', uri: PING_URI, title: 'Ping' });

    const chosen = await chooseReminderSound(gong);

    expect(chosen).toEqual({ kind: 'system', uri: PING_URI, title: 'Ping', channelId: reminderChannelIdFor(PING_URI) });
    expect(AthanPlugin.createSoundChannel).toHaveBeenCalledWith({
      channelId: reminderChannelIdFor(PING_URI),
      channelName: 'Prayer reminders (Ping)',
      soundUri: PING_URI,
    });
    expect(AthanPlugin.deleteChannel).toHaveBeenCalledWith({ channelId: gong.channelId });
    // Replacement first: a reminder posted between the two lands somewhere real.
    expect(vi.mocked(AthanPlugin.createSoundChannel).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(AthanPlugin.deleteChannel).mock.invocationCallOrder[0]);
  });

  it('keeps the channel when the same sound is picked again', async () => {
    vi.mocked(AthanPlugin.pickNotificationSound).mockResolvedValue({ cancelled: false, kind: 'system', uri: GONG_URI, title: 'Gentle Gong' });

    expect(await chooseReminderSound(gong)).toEqual(gong);
    expect(AthanPlugin.deleteChannel).not.toHaveBeenCalled();
  });

  it('maps the picker\'s Default and None, retiring a phone sound channel no longer used', async () => {
    vi.mocked(AthanPlugin.pickNotificationSound).mockResolvedValue({ cancelled: false, kind: 'default' });
    expect(await chooseReminderSound(gong)).toEqual({ kind: 'default' });
    expect(AthanPlugin.deleteChannel).toHaveBeenCalledWith({ channelId: gong.channelId });

    vi.mocked(AthanPlugin.pickNotificationSound).mockResolvedValue({ cancelled: false, kind: 'silent' });
    expect(await chooseReminderSound({ kind: 'default' })).toEqual({ kind: 'silent' });
    expect(AthanPlugin.createSoundChannel).not.toHaveBeenCalled();
  });

  it('keeps the old sound and its channel when the new channel cannot be made', async () => {
    vi.mocked(AthanPlugin.pickNotificationSound).mockResolvedValue({ cancelled: false, kind: 'system', uri: PING_URI, title: 'Ping' });
    vi.mocked(AthanPlugin.createSoundChannel).mockRejectedValue(new Error('denied'));

    await expect(chooseReminderSound(gong)).rejects.toThrow();
    expect(AthanPlugin.deleteChannel).not.toHaveBeenCalled();
  });

  it('still switches when retiring the old channel fails', async () => {
    vi.mocked(AthanPlugin.pickNotificationSound).mockResolvedValue({ cancelled: false, kind: 'default' });
    vi.mocked(AthanPlugin.deleteChannel).mockRejectedValue(new Error('gone'));

    expect(await chooseReminderSound(gong)).toEqual({ kind: 'default' });
  });
});
