import { useEffect } from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { SettingsModal } from '../components/SettingsModal';
import { ThemeProvider } from '../context/ThemeContext';
import { SettingsProvider, useSettings } from '../context/SettingsContext';
import { LocationProvider } from '../context/LocationContext';
import { TravelProvider } from '../context/TravelContext';
import { AthanPlugin } from '../plugins/athanPlugin';
import type { Settings } from '../types';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

vi.mock('../plugins/athanPlugin', () => ({
  AthanPlugin: {
    isPlaying: vi.fn().mockResolvedValue({ isPlaying: false }),
    stop: vi.fn().mockResolvedValue(undefined),
    createAthanChannel: vi.fn().mockResolvedValue(undefined),
    deleteChannel: vi.fn().mockResolvedValue(undefined),
    playPreview: vi.fn().mockResolvedValue(undefined),
    stopPreview: vi.fn().mockResolvedValue(undefined),
    getExternalFilesDir: vi.fn().mockResolvedValue({ path: '/data/files' }),
    canScheduleExactAlarms: vi.fn().mockResolvedValue({ value: true }),
    openExactAlarmSettings: vi.fn().mockResolvedValue(undefined),
    isIgnoringBatteryOptimizations: vi.fn().mockResolvedValue({ value: true }),
    requestIgnoreBatteryOptimizations: vi.fn().mockResolvedValue(undefined),
    startCompass: vi.fn().mockResolvedValue(undefined),
    stopCompass: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    pickNotificationSound: vi.fn(),
    createSoundChannel: vi.fn().mockResolvedValue(undefined),
  },
}));

function SettingsCapture({ onSettings }: { onSettings: (s: Settings) => void }) {
  const { settings } = useSettings();
  useEffect(() => { onSettings(settings); }, [settings, onSettings]);
  return null;
}

function renderSettingsModal(savedSettings?: Record<string, unknown>) {
  vi.mocked(Preferences.get).mockImplementation(async ({ key }) => {
    if (key === 'ontime_settings' && savedSettings) return { value: JSON.stringify(savedSettings) };
    return { value: null };
  });
  let captured: Settings | null = null;
  const result = render(
    <ThemeProvider>
      <SettingsProvider>
        <LocationProvider>
          <TravelProvider>
            <SettingsCapture onSettings={(s) => { captured = s; }} />
            <SettingsModal isOpen={true} onClose={() => {}} onBackRef={{ current: null }} />
          </TravelProvider>
        </LocationProvider>
      </SettingsProvider>
    </ThemeProvider>,
  );
  return { ...result, getCaptured: () => captured };
}

async function openPrayerNotifications(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText('Notifications'));
  await user.click(await screen.findByText('Prayer Notifications'));
  await screen.findByText('Configure notifications for each prayer');
}

const reminderSoundButton = () => screen.getByRole('button', { name: /reminder sound/i });

describe('the Reminder sound row', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    vi.mocked(AthanPlugin.createSoundChannel).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows Default until a sound is picked', async () => {
    const user = userEvent.setup();
    await act(async () => { renderSettingsModal(); });
    await openPrayerNotifications(user);

    expect(reminderSoundButton()).toHaveTextContent('Default');
  });

  it('opens the phone\'s picker and keeps the sound chosen there', async () => {
    vi.mocked(AthanPlugin.pickNotificationSound).mockResolvedValue({
      cancelled: false, kind: 'system', uri: 'content://media/internal/audio/media/60', title: 'Gentle Gong',
    });
    const user = userEvent.setup();
    let result: ReturnType<typeof renderSettingsModal>;
    await act(async () => { result = renderSettingsModal(); });
    await openPrayerNotifications(user);

    await user.click(reminderSoundButton());

    expect(AthanPlugin.pickNotificationSound).toHaveBeenCalledWith({ existing: 'default' });
    expect(await screen.findByRole('button', { name: /reminder sound.*gentle gong/i })).toBeInTheDocument();
    expect(result!.getCaptured()!.notifications.reminderSound).toMatchObject({
      kind: 'system', title: 'Gentle Gong', uri: 'content://media/internal/audio/media/60',
    });
  });

  it('shows the sound saved last time', async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderSettingsModal({
        notifications: {
          enabled: true,
          reminderSound: { kind: 'system', uri: 'content://media/internal/audio/media/66', title: 'Ping', channelId: 'ontime_reminder_x' },
        },
      });
    });
    await openPrayerNotifications(user);

    expect(reminderSoundButton()).toHaveTextContent('Ping');
  });

  it('shows None as Silent', async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderSettingsModal({ notifications: { enabled: true, reminderSound: { kind: 'silent' } } });
    });
    await openPrayerNotifications(user);

    expect(reminderSoundButton()).toHaveTextContent('Silent');
  });

  it('leaves the setting alone when the picker is backed out of', async () => {
    vi.mocked(AthanPlugin.pickNotificationSound).mockResolvedValue({ cancelled: true });
    const user = userEvent.setup();
    let result: ReturnType<typeof renderSettingsModal>;
    await act(async () => { result = renderSettingsModal(); });
    await openPrayerNotifications(user);

    await user.click(reminderSoundButton());

    expect(reminderSoundButton()).toHaveTextContent('Default');
    expect(result!.getCaptured()!.notifications.reminderSound).toEqual({ kind: 'default' });
  });

  it('says so, and keeps the old sound, when the phone refuses the new one', async () => {
    vi.mocked(AthanPlugin.pickNotificationSound).mockResolvedValue({
      cancelled: false, kind: 'system', uri: 'content://media/external/audio/media/9', title: 'My Tune',
    });
    vi.mocked(AthanPlugin.createSoundChannel).mockRejectedValue(new Error('denied'));
    const user = userEvent.setup();
    await act(async () => { renderSettingsModal(); });
    await openPrayerNotifications(user);

    await user.click(reminderSoundButton());

    expect(await screen.findByText(/couldn't use that sound/i)).toBeInTheDocument();
    expect(reminderSoundButton()).toHaveTextContent('Default');
  });

  it('is not offered off Android, where app alerts cannot use the phone\'s sounds', async () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    const user = userEvent.setup();
    await act(async () => { renderSettingsModal(); });
    await openPrayerNotifications(user);

    expect(screen.queryByRole('button', { name: /reminder sound/i })).not.toBeInTheDocument();
  });
});
