import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Preferences } from '@capacitor/preferences';
import App from '../App';
import { ThemeProvider } from '../context/ThemeContext';
import { SettingsProvider } from '../context/SettingsContext';
import { LocationProvider } from '../context/LocationContext';
import { TravelProvider } from '../context/TravelContext';

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

vi.mock('../components/HomeGlobeScreen', () => ({
  HomeGlobeScreen: () => <div data-testid="home-globe-screen" />,
}));

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

describe('User story: I can switch between List and Globe home views', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the prayer list and no globe layer by default', async () => {
    await act(async () => {
      renderApp({ homeView: 'list' });
    });

    expect(screen.queryByTestId('home-globe-screen')).not.toBeInTheDocument();
    const toggle = await screen.findByLabelText('Switch to globe view');
    expect(toggle).toBeInTheDocument();
  });

  it('shows the globe layer and hides the prayer list when homeView is globe', async () => {
    await act(async () => {
      renderApp({ homeView: 'globe' });
    });

    expect(await screen.findByTestId('home-globe-screen')).toBeInTheDocument();
    const toggle = await screen.findByLabelText('Switch to list view');
    expect(toggle).toBeInTheDocument();
  });

  it('the header toggle switches between views', async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderApp({ homeView: 'list' });
    });

    const toggle = await screen.findByLabelText('Switch to globe view');
    await user.click(toggle);

    expect(await screen.findByTestId('home-globe-screen')).toBeInTheDocument();
  });

  it('hides the globe layer while the Qibla compass is open', async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderApp({ homeView: 'globe' });
    });
    await screen.findByTestId('home-globe-screen');

    const qiblaBtn = screen.getByLabelText('Open qibla compass');
    await user.click(qiblaBtn);

    expect(screen.queryByTestId('home-globe-screen')).not.toBeInTheDocument();
  });
});
