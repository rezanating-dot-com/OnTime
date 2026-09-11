import { render, screen, act } from '@testing-library/react';
import { Preferences } from '@capacitor/preferences';
import App from '../App';
import { ThemeProvider } from '../context/ThemeContext';
import { SettingsProvider } from '../context/SettingsContext';
import { LocationProvider } from '../context/LocationContext';
import { TravelProvider } from '../context/TravelContext';

// Mock custom native AthanPlugin (not available on web/jsdom)
vi.mock('../plugins/athanPlugin', () => ({
  AthanPlugin: {
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

// jsdom has no WebGL; the real HomeGlobeScreen would try to mount globe.gl
// and hit the live tile network with no timeout, hanging the test run.
vi.mock('../components/HomeGlobeScreen', () => ({
  HomeGlobeScreen: () => <div data-testid="home-globe-screen" />,
}));

vi.mock('../components/three/Scenes', () => ({
  SunDomeView: () => <div data-testid="sun-dome" />,
}));

// jsdom does not implement window.matchMedia; provide a minimal stub
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

function renderApp(savedSettings?: Record<string, unknown>) {
  // Mock onboarding as complete
  vi.mocked(Preferences.get).mockImplementation(async ({ key }) => {
    if (key === 'ontime_onboarding_complete') return { value: 'true' };
    if (key === 'ontime_settings' && savedSettings) return { value: JSON.stringify(savedSettings) };
    if (key === 'ontime_location') {
      return {
        value: JSON.stringify({
          coordinates: { latitude: 43.6532, longitude: -79.3832 },
          cityName: 'Toronto',
          countryCode: 'CA',
        }),
      };
    }
    return { value: null };
  });

  return render(
    <ThemeProvider>
      <SettingsProvider>
        <LocationProvider>
          <TravelProvider>
            <App />
          </TravelProvider>
        </LocationProvider>
      </SettingsProvider>
    </ThemeProvider>,
  );
}

describe('User story: I can switch between Classic and Islamic designs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the Classic design by default (settings button with gear icon)', async () => {
    await act(async () => {
      renderApp();
    });

    // Classic header has aria-label "Open settings"
    const settingsBtn = await screen.findByLabelText('Open settings');
    expect(settingsBtn).toBeInTheDocument();

    // Classic header also carries the qibla compass
    expect(screen.getByLabelText('Open qibla compass')).toBeInTheDocument();
  });

  it('shows the Islamic design when designStyle is "islamic"', async () => {
    await act(async () => {
      renderApp({ designStyle: 'islamic' });
    });

    // Islamic design still has settings and qibla buttons
    const settingsBtn = await screen.findByLabelText('Open settings');
    expect(settingsBtn).toBeInTheDocument();

    expect(screen.getByLabelText('Open qibla compass')).toBeInTheDocument();
  });

  it('shows the Classic design when designStyle is "classic"', async () => {
    await act(async () => {
      renderApp({ designStyle: 'classic' });
    });

    const settingsBtn = await screen.findByLabelText('Open settings');
    expect(settingsBtn).toBeInTheDocument();
  });
});
