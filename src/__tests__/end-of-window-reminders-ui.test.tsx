import { useEffect } from 'react';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Preferences } from '@capacitor/preferences';
import { SettingsModal } from '../components/SettingsModal';
import { ThemeProvider } from '../context/ThemeContext';
import { SettingsProvider, useSettings } from '../context/SettingsContext';
import { LocationProvider } from '../context/LocationContext';
import { TravelProvider } from '../context/TravelContext';
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
    play: vi.fn().mockResolvedValue(undefined),
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

describe('the "Before it ends" row in prayer notification settings', () => {
  it('appears on every prayer card, but not on sunrise', async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderSettingsModal({
        notifications: { enabled: true, prayers: { sunrise: { enabled: true } } },
      });
    });
    await openPrayerNotifications(user);

    const rows = screen.getAllByRole('group', { name: /before it ends/i });
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Fajr: before it ends',
      'Dhuhr: before it ends',
      'Asr: before it ends',
      'Maghrib: before it ends',
      'Isha: before it ends',
    ]);
    const options = within(rows[0]).getAllByRole('button').map((b) => b.textContent);
    expect(options).toEqual(['5 min', '10 min', '15 min', '20 min', '30 min', '45 min', '60 min']);
  });

  it('starts with nothing selected', async () => {
    const user = userEvent.setup();
    await act(async () => { renderSettingsModal(); });
    await openPrayerNotifications(user);

    const row = screen.getByRole('group', { name: 'Dhuhr: before it ends' });
    for (const button of within(row).getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('tapping a minute turns it on, tapping again turns it off, and the setting follows', async () => {
    const user = userEvent.setup();
    let result: ReturnType<typeof renderSettingsModal>;
    await act(async () => { result = renderSettingsModal(); });
    await openPrayerNotifications(user);

    const row = screen.getByRole('group', { name: 'Dhuhr: before it ends' });
    const fifteen = within(row).getByRole('button', { name: '15 min' });
    const thirty = within(row).getByRole('button', { name: '30 min' });

    await user.click(fifteen);
    await user.click(thirty);
    expect(fifteen).toHaveAttribute('aria-pressed', 'true');
    expect(thirty).toHaveAttribute('aria-pressed', 'true');
    expect(result!.getCaptured()!.notifications.prayers.dhuhr.endReminderMinutes).toEqual([15, 30]);
    // Only Dhuhr changed.
    expect(result!.getCaptured()!.notifications.prayers.asr.endReminderMinutes).toEqual([]);

    await user.click(fifteen);
    expect(fifteen).toHaveAttribute('aria-pressed', 'false');
    expect(result!.getCaptured()!.notifications.prayers.dhuhr.endReminderMinutes).toEqual([30]);
  });

  it('shows what was saved last time', async () => {
    const user = userEvent.setup();
    await act(async () => {
      renderSettingsModal({
        notifications: { enabled: true, prayers: { asr: { enabled: true, endReminderMinutes: [10, 60] } } },
      });
    });
    await openPrayerNotifications(user);

    const row = screen.getByRole('group', { name: 'Asr: before it ends' });
    expect(within(row).getByRole('button', { name: '10 min' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(row).getByRole('button', { name: '60 min' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(row).getByRole('button', { name: '15 min' })).toHaveAttribute('aria-pressed', 'false');
  });
});
