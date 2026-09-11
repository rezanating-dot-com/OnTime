import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Preferences } from '@capacitor/preferences';
import { SettingsModal } from '../components/SettingsModal';
import { ThemeProvider } from '../context/ThemeContext';
import { SettingsProvider, useSettings } from '../context/SettingsContext';
import { LocationProvider } from '../context/LocationContext';
import { TravelProvider } from '../context/TravelContext';
import type { Settings } from '../types';
import pkg from '../../package.json';

/**
 * SettingsModal's own draft state, and the settings writes it makes. The
 * modal returns null when closed but stays mounted for the app's lifetime, so
 * anything it holds in useState outlives a close unless something clears it.
 */
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

const deleteAthanFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../services/athanService', () => ({
  fetchAthanCatalog: vi.fn().mockResolvedValue([]),
  downloadAthan: vi.fn(),
  deleteAthanFile,
  selectAthan: vi.fn().mockResolvedValue('channel-x'),
  playAthanPreview: vi.fn().mockResolvedValue(undefined),
  stopAthanPreview: vi.fn().mockResolvedValue(undefined),
}));

let latestSettings: Settings | null = null;

function SettingsCapture() {
  const { settings } = useSettings();
  // In an effect rather than during render: assigning to a captured object
  // mid-render trips react-hooks/immutability, and this runs before any
  // assertion either way.
  useEffect(() => {
    latestSettings = settings;
  });
  return null;
}

function renderModal(savedSettings?: Partial<Settings>) {
  vi.mocked(Preferences.get).mockImplementation(async ({ key }) => {
    if (key === 'ontime_settings' && savedSettings) return { value: JSON.stringify(savedSettings) };
    return { value: null };
  });
  latestSettings = null;
  const onBackRef = { current: null };
  let open = true;
  const view = render(
    <ThemeProvider>
      <SettingsProvider>
        <LocationProvider>
          <TravelProvider>
            <SettingsCapture />
            <SettingsModal isOpen={open} onClose={() => {}} onBackRef={onBackRef} />
          </TravelProvider>
        </LocationProvider>
      </SettingsProvider>
    </ThemeProvider>,
  );
  const setOpen = (next: boolean) => {
    open = next;
    view.rerender(
      <ThemeProvider>
        <SettingsProvider>
          <LocationProvider>
            <TravelProvider>
              <SettingsCapture />
              <SettingsModal isOpen={open} onClose={() => {}} onBackRef={onBackRef} />
            </TravelProvider>
          </LocationProvider>
        </SettingsProvider>
      </ThemeProvider>,
    );
  };
  return { ...view, setOpen, getCaptured: () => latestSettings };
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteAthanFile.mockResolvedValue(undefined);
});

describe('About screen version (ST-10)', () => {
  it('reports the version the app actually ships as', async () => {
    const user = userEvent.setup();
    await act(async () => { renderModal(); });
    await user.click(await screen.findByText('About'));

    // This screen once carried "1.0.0" written into it by hand, while the rest
    // of the app shipped as something else entirely — so a user quoting a
    // version in a review or a support mail quoted one that never existed.
    //
    // Read from package.json rather than written here, because a version
    // written here is the same mistake one file along: it went stale the first
    // time the app was released after this test was added, and shipped red.
    expect(screen.queryByText(/Version 1\.0\.0/)).not.toBeInTheDocument();
    expect(await screen.findByText(`Version ${pkg.version}`)).toBeInTheDocument();
  });
});

describe('Manual coordinates (ST-7)', () => {
  const openManual = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByText('Location'));
    await user.click(await screen.findByText('Coordinates'));
  };

  it('refuses an out-of-range latitude instead of silently closing', async () => {
    const user = userEvent.setup();
    const r = renderModal();
    await act(async () => {});
    await openManual(user);

    await user.type(await screen.findByPlaceholderText('Latitude'), '999');
    await user.type(screen.getByPlaceholderText('Longitude'), '10');
    await user.click(screen.getByText('Save Location'));

    // The panel stays open with the fields intact and says what is wrong,
    // rather than collapsing as if it had saved.
    expect(screen.getByPlaceholderText('Latitude')).toBeInTheDocument();
    expect(screen.getByText(/between -90 and 90/i)).toBeInTheDocument();
    expect(r.getCaptured()!.previousLocations).toHaveLength(0);
  });

  it('saves a valid coordinate and remembers it like the other location paths', async () => {
    const user = userEvent.setup();
    const r = renderModal();
    await act(async () => {});
    await openManual(user);

    await user.type(await screen.findByPlaceholderText('Latitude'), '43.65');
    await user.type(screen.getByPlaceholderText('Longitude'), '-79.38');
    await user.type(screen.getByPlaceholderText(/City name/i), 'Toronto');
    await act(async () => { await user.click(screen.getByText('Save Location')); });

    // The GPS and search paths both call addPreviousLocation; this one never
    // did, so a hand-entered place could not be reused or promoted to a travel
    // home base.
    const saved = r.getCaptured()!.previousLocations;
    expect(saved).toHaveLength(1);
    expect(saved[0].cityName).toBe('Toronto');
  });
});

describe('Draft state across a close (ST-8)', () => {
  it('forgets a half-finished coordinates entry when the modal is closed', async () => {
    const user = userEvent.setup();
    const r = renderModal();
    await act(async () => {});
    await user.click(await screen.findByText('Location'));
    await user.click(await screen.findByText('Coordinates'));
    await user.type(await screen.findByPlaceholderText('Latitude'), '43.65');

    await act(async () => { r.setOpen(false); });
    await act(async () => { r.setOpen(true); });

    // Reopening lands on the hub, not wherever the user left off …
    expect(screen.queryByPlaceholderText('Latitude')).not.toBeInTheDocument();
    expect(await screen.findByText('Appearance')).toBeInTheDocument();

    // … and Location no longer has the coordinates panel pre-opened with the
    // abandoned text still in it, as if the attempt were still in progress.
    await user.click(await screen.findByText('Location'));
    expect(screen.queryByPlaceholderText('Latitude')).not.toBeInTheDocument();

    await user.click(await screen.findByText('Coordinates'));
    expect(await screen.findByPlaceholderText('Latitude')).toHaveValue(null);
  });
});

describe('Separate Fajr athan toggle (ST-6)', () => {
  const withAthans = {
    athan: {
      downloadedAthans: [
        { id: 'a', muezzinName: 'Muezzin A', filename: 'a.mp3', url: 'https://x/a.mp3' },
        { id: 'b', muezzinName: 'Muezzin B', filename: 'b.mp3', url: 'https://x/b.mp3' },
      ],
      selectedAthanId: 'a',
      selectedFajrAthanId: null,
      currentChannelId: 'ch-a',
      currentFajrChannelId: null,
    },
  } as Partial<Settings>;

  it('stays on when the main athan is changed underneath it', async () => {
    const user = userEvent.setup();
    renderModal(withAthans);
    await act(async () => {});
    await user.click(await screen.findByText('Notifications'));
    await user.click(await screen.findByText(/Athan Sound/i));

    await act(async () => { await user.click(await screen.findByText('Separate Fajr Athan')); });
    expect(await screen.findByText('Fajr Athan')).toBeInTheDocument();

    // A-11's resync effect depended on selectedAthanId too, so picking a
    // different main athan discarded the local-only edit and the panel
    // vanished from under the user mid-flow.
    await act(async () => { await user.click(screen.getAllByText('Muezzin B')[0]); });

    // The panel is what tells the user the toggle is on.
    expect(screen.queryByText('Fajr Athan')).toBeInTheDocument();
  });
});

describe('Deleting a downloaded athan (NT-7)', () => {
  const withSelectedPerPrayer = {
    athan: {
      downloadedAthans: [{ id: 'a', muezzinName: 'Muezzin A', filename: 'a.mp3', url: 'https://x/a.mp3' }],
      selectedAthanId: 'a',
      selectedFajrAthanId: null,
      currentChannelId: 'ch-a',
      currentFajrChannelId: null,
    },
    notifications: {
      enabled: true,
      defaultSound: 'default',
      defaultReminderMinutes: 15,
      prayers: {
        fajr: { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'athan:a' },
        sunrise: { enabled: false, reminderMinutes: 0, atPrayerTime: false, sound: 'default' },
        dhuhr: { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'athan:a' },
        asr: { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default' },
        maghrib: { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default' },
        isha: { enabled: true, reminderMinutes: 15, atPrayerTime: true, sound: 'default' },
      },
    },
  } as Partial<Settings>;

  const openDelete = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByText('Notifications'));
    await user.click(await screen.findByText(/Athan Sound/i));
    return screen.getByRole('button', { name: /delete muezzin a/i });
  };

  it('clears every per-prayer reference to the athan it just deleted', async () => {
    const user = userEvent.setup();
    const r = renderModal(withSelectedPerPrayer);
    await act(async () => {});
    const del = await openDelete(user);
    await act(async () => { await user.click(del); });

    const prayers = r.getCaptured()!.notifications.prayers;
    expect(prayers.fajr.sound).not.toBe('athan:a');
    expect(prayers.dhuhr.sound).not.toBe('athan:a');
    // Untouched prayers stay as they were.
    expect(prayers.asr.sound).toBe('default');
  });

  it('keeps the entry when the file could not be deleted, so the audio is not orphaned', async () => {
    deleteAthanFile.mockRejectedValue(new Error('read-only storage'));
    const user = userEvent.setup();
    const r = renderModal(withSelectedPerPrayer);
    await act(async () => {});
    const del = await openDelete(user);
    await act(async () => { await user.click(del); });

    // Removing the settings entry unconditionally left the mp3 on disk with no
    // UI row that could ever remove it.
    expect(r.getCaptured()!.athan.downloadedAthans).toHaveLength(1);
    expect(await screen.findByText(/could not be deleted/i)).toBeInTheDocument();
  });
});
