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
import { isFajrAdhan } from '../utils/fajrAdhan';
import type { AthanCatalogEntry, AthanFile, Settings } from '../types';

/**
 * Fajr Adhan ships with no recording (#17): none we could bundle has the line
 * only said at Fajr. Instead the prayer row offers to download one from
 * Assabile's catalog, the same way the athan list already does, and uses it
 * for Fajr as soon as it is saved.
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
    deleteChannel: vi.fn().mockResolvedValue(undefined),
    canScheduleExactAlarms: vi.fn().mockResolvedValue({ value: true }),
    isIgnoringBatteryOptimizations: vi.fn().mockResolvedValue({ value: true }),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  },
}));

const CATALOG: AthanCatalogEntry[] = [
  { muezzinName: 'Mishary Rashid Alafasy', title: 'Adhan Al Fajr Al Kuwait', duration: '03:07', sourceUrl: 'https://x/fajr-kuwait.mp3' },
  { muezzinName: 'Adhan Al Fajr, Umm Al Quwain', title: '', duration: '03:10', sourceUrl: 'https://x/fajr-uaq.mp3' },
  { muezzinName: 'Mishary Rashid Alafasy', title: 'Adhan', duration: '02:50', sourceUrl: 'https://x/general.mp3' },
];

const athan = vi.hoisted(() => ({
  downloadAthan: vi.fn(),
  selectAthan: vi.fn(),
}));

vi.mock('../services/athanService', () => ({
  fetchAthanCatalog: vi.fn().mockImplementation(async () => CATALOG),
  downloadAthan: athan.downloadAthan,
  deleteAthanFile: vi.fn().mockResolvedValue(undefined),
  selectAthan: athan.selectAthan,
  playAthanPreview: vi.fn().mockResolvedValue(undefined),
  stopAthanPreview: vi.fn().mockResolvedValue(undefined),
}));

let latestSettings: Settings | null = null;
function SettingsCapture() {
  const { settings } = useSettings();
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
  render(
    <ThemeProvider>
      <SettingsProvider>
        <LocationProvider>
          <TravelProvider>
            <SettingsCapture />
            <SettingsModal isOpen onClose={() => {}} onBackRef={{ current: null }} />
          </TravelProvider>
        </LocationProvider>
      </SettingsProvider>
    </ThemeProvider>,
  );
}

async function openPrayerNotifications(user: ReturnType<typeof userEvent.setup>) {
  await act(async () => {});
  await user.click(await screen.findByText('Notifications'));
  await user.click(await screen.findByText('Prayer Notifications'));
}

const savedKuwait: AthanFile = {
  id: 'f1',
  muezzinName: 'Mishary Rashid Alafasy',
  title: 'Adhan Al Fajr Al Kuwait',
  filename: 'f1.mp3',
  duration: '03:07',
  sourceUrl: 'https://x/fajr-kuwait.mp3',
  downloadedAt: '2026-10-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  athan.downloadAthan.mockResolvedValue(savedKuwait);
  athan.selectAthan.mockResolvedValue('athan_fajr_f1');
});

describe('telling a Fajr adhan from a general one', () => {
  it('finds Fajr in the title or, with no muezzin given, in the whole line', () => {
    expect(isFajrAdhan(CATALOG[0])).toBe(true);
    expect(isFajrAdhan(CATALOG[1])).toBe(true);
    expect(isFajrAdhan(CATALOG[2])).toBe(false);
    // A muezzin whose name merely contains the letters is not a Fajr adhan.
    expect(isFajrAdhan({ muezzinName: 'Omru Sobhe', title: 'Adhan' })).toBe(false);
  });
});

describe('Fajr Adhan with no recording saved', () => {
  it('says what it plays instead, and offers a download', async () => {
    const user = userEvent.setup();
    renderModal();
    await openPrayerNotifications(user);

    // Fajr defaults to Fajr Adhan, so a fresh install sees this.
    expect(screen.getByText(/No Fajr adhan saved yet, so this plays the phone's plain tone/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download one' })).toBeInTheDocument();
  });

  it('lists only Fajr adhans, and uses the one downloaded for Fajr', async () => {
    const user = userEvent.setup();
    renderModal();
    await openPrayerNotifications(user);
    await user.click(screen.getByRole('button', { name: 'Download one' }));

    expect(await screen.findByText('Fajr Adhans')).toBeInTheDocument();
    expect(screen.getByText(/Adhan Al Fajr Al Kuwait/)).toBeInTheDocument();
    expect(screen.getByText('Adhan Al Fajr, Umm Al Quwain')).toBeInTheDocument();
    expect(screen.queryByText(/^Adhan - 02:50$/)).not.toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getAllByRole('button', { name: 'Download' })[0]);
    });

    expect(athan.downloadAthan).toHaveBeenCalledWith(CATALOG[0]);
    expect(athan.selectAthan).toHaveBeenCalledWith(savedKuwait, null, 'fajr');
    expect(latestSettings!.athan.downloadedAthans.map((a) => a.id)).toEqual(['f1']);
    expect(latestSettings!.athan.selectedFajrAthanId).toBe('f1');
    expect(latestSettings!.athan.currentFajrChannelId).toBe('athan_fajr_f1');
    expect(await screen.findByText('Used for Fajr')).toBeInTheDocument();
  });

  it('offers one already downloaded for Fajr without downloading it again', async () => {
    const user = userEvent.setup();
    renderModal({
      athan: {
        downloadedAthans: [savedKuwait],
        selectedAthanId: null,
        selectedFajrAthanId: null,
        currentChannelId: null,
        currentFajrChannelId: null,
      },
    } as Partial<Settings>);
    await openPrayerNotifications(user);
    await user.click(screen.getByRole('button', { name: 'Download one' }));

    await act(async () => {
      await user.click(await screen.findByRole('button', { name: 'Use for Fajr' }));
    });

    expect(athan.downloadAthan).not.toHaveBeenCalled();
    expect(latestSettings!.athan.selectedFajrAthanId).toBe('f1');
  });

  it('stops offering once a Fajr adhan is saved', async () => {
    const user = userEvent.setup();
    renderModal({
      athan: {
        downloadedAthans: [savedKuwait],
        selectedAthanId: null,
        selectedFajrAthanId: 'f1',
        currentChannelId: null,
        currentFajrChannelId: 'athan_fajr_f1',
      },
    } as Partial<Settings>);
    await openPrayerNotifications(user);

    expect(screen.queryByText(/No Fajr adhan saved yet/)).not.toBeInTheDocument();
  });
});
