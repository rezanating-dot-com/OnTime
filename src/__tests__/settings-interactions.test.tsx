import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Preferences } from '@capacitor/preferences';
import { SettingsModal } from '../components/SettingsModal';
import { ThemeProvider } from '../context/ThemeContext';
import { SettingsProvider, useSettings } from '../context/SettingsContext';
import { LocationProvider } from '../context/LocationContext';
import { TravelProvider } from '../context/TravelContext';
import type { Settings } from '../types';

// Stub matchMedia for ThemeContext
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

// Mock athan plugin (used by notification hook which SettingsModal may trigger)
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

// Ref-based capture so getCaptured() always returns the latest rendered settings
const settingsRef = { current: null as Settings | null };

function SettingsCapture() {
  const { settings } = useSettings();
  settingsRef.current = settings;
  return null;
}

function renderSettingsModal(savedSettings?: Partial<Settings>) {
  vi.mocked(Preferences.get).mockImplementation(async ({ key }) => {
    if (key === 'ontime_settings' && savedSettings) return { value: JSON.stringify(savedSettings) };
    return { value: null };
  });

  settingsRef.current = null;
  const onBackRef = { current: null };

  const result = render(
    <ThemeProvider>
      <SettingsProvider>
        <LocationProvider>
          <TravelProvider>
            <SettingsCapture />
            <SettingsModal isOpen={true} onClose={() => {}} onBackRef={onBackRef} />
          </TravelProvider>
        </LocationProvider>
      </SettingsProvider>
    </ThemeProvider>,
  );

  return { ...result, getCaptured: () => settingsRef.current };
}

describe('User story: I can customize my app settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the settings modal when opened', async () => {
    await act(async () => {
      renderSettingsModal();
    });

    // "Appearance" is visible as a category item in the main settings list
    const heading = await screen.findByText('Appearance');
    expect(heading).toBeInTheDocument();
  });

  it('shows the design style picker with Classic and Islamic options', async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderSettingsModal();
    });

    // Navigate into the Appearance sub-page to see the design style picker
    const appearanceItem = await screen.findByText('Appearance');
    await user.click(appearanceItem);

    const classic = await screen.findByText('Classic');
    const islamic = await screen.findByText('Islamic');
    expect(classic).toBeInTheDocument();
    expect(islamic).toBeInTheDocument();
  });

  it('switching to Islamic design updates the setting', async () => {
    const user = userEvent.setup();
    let result: ReturnType<typeof renderSettingsModal>;

    await act(async () => {
      result = renderSettingsModal({ designStyle: 'classic' });
    });

    // Navigate into Appearance sub-page
    const appearanceItem = await screen.findByText('Appearance');
    await user.click(appearanceItem);

    const islamicBtn = await screen.findByText('Islamic');
    await user.click(islamicBtn);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Read captured settings after interaction completes
    expect(result!.getCaptured()!.designStyle).toBe('islamic');
  });

  it('shows calculation method section', async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderSettingsModal();
    });

    // Navigate into Prayer Calculation sub-page
    const calcItem = await screen.findByText('Prayer Calculation');
    await user.click(calcItem);

    // "Calculation Method" is a label inside the calculation sub-page
    const methodSection = await screen.findByText('Calculation Method');
    expect(methodSection).toBeInTheDocument();
  });

  it('shows the display cards section with toggle options', async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderSettingsModal();
    });

    // Navigate into Appearance sub-page where Display Cards lives
    const appearanceItem = await screen.findByText('Appearance');
    await user.click(appearanceItem);

    // "Display Cards" is a label inside the appearance sub-page
    const displaySection = await screen.findByText('Display Cards');
    expect(displaySection).toBeInTheDocument();
  });

  it('shows the home view picker with Globe and List options', async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderSettingsModal();
    });

    const appearanceItem = await screen.findByText('Appearance');
    await user.click(appearanceItem);

    const globe = await screen.findByText('Globe');
    const list = await screen.findByText('List');
    expect(globe).toBeInTheDocument();
    expect(list).toBeInTheDocument();
  });

  it('switching to Globe home view updates the setting', async () => {
    const user = userEvent.setup();
    let result: ReturnType<typeof renderSettingsModal>;

    await act(async () => {
      result = renderSettingsModal({ homeView: 'list' });
    });

    const appearanceItem = await screen.findByText('Appearance');
    await user.click(appearanceItem);

    const globeBtn = await screen.findByText('Globe');
    await user.click(globeBtn);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result!.getCaptured()!.homeView).toBe('globe');
  });
});
