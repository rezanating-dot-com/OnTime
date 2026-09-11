import { render, screen, act, waitFor } from '@testing-library/react';
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
  HomeGlobeScreen: ({ covered, qiblaMode }: { covered?: boolean; qiblaMode?: boolean }) => (
    <div
      data-testid="home-globe-screen"
      data-covered={String(!!covered)}
      data-qibla={String(!!qiblaMode)}
    />
  ),
}));

// jsdom has no WebGL; stand in for the three.js layer so SunDomeCard's lazy
// Scenes import doesn't probe canvas getContext() and print noisy warnings
// (mirrors sun-dome-card.test.tsx's mock).
vi.mock('../components/three/Scenes', () => ({
  SunDomeView: () => <div data-testid="sun-dome" />,
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

  it('draws the qibla on the globe already up, rather than covering it with another one', async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderApp({ homeView: 'globe' });
    });
    const globe = await screen.findByTestId('home-globe-screen');
    expect(globe).toHaveAttribute('data-qibla', 'false');
    expect(globe).toHaveAttribute('data-covered', 'false');

    await user.click(screen.getByLabelText('Show qibla direction'));

    // The same globe, now drawing the line. Nothing is laid over it: the
    // screen this replaced carried a second globe of its own.
    const after = screen.getByTestId('home-globe-screen');
    expect(after).toHaveAttribute('data-qibla', 'true');
    expect(after).toHaveAttribute('data-covered', 'false');
  });

  it('brings the globe up for someone who asked for the qibla from the list, and puts the list back after', async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderApp({ homeView: 'list' });
    });
    expect(screen.queryByTestId('home-globe-screen')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Show qibla direction'));

    const globe = await screen.findByTestId('home-globe-screen');
    expect(globe).toHaveAttribute('data-qibla', 'true');

    await user.click(screen.getByLabelText('Show qibla direction'));

    await waitFor(() => expect(screen.queryByTestId('home-globe-screen')).not.toBeInTheDocument());
  });

  it('flags the globe covered while Settings is open', async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderApp({ homeView: 'globe' });
    });
    await screen.findByTestId('home-globe-screen');

    await user.click(screen.getByLabelText('Open settings'));

    expect(screen.getByTestId('home-globe-screen')).toHaveAttribute('data-covered', 'true');
  });

  it('portals the location map popup outside the header in Globe mode, so it does not inherit the glow HUD text colors', async () => {
    const user = userEvent.setup();

    let result: ReturnType<typeof renderApp> | undefined;
    await act(async () => {
      result = renderApp({ homeView: 'globe' });
    });
    await screen.findByTestId('home-globe-screen');
    const { container } = result!;

    await user.click(screen.getByText('Toronto'));

    const openInMaps = await screen.findByText('Open in Maps');
    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    expect(header?.contains(openInMaps)).toBe(false);
    expect(container.contains(openInMaps)).toBe(false);
    expect(document.body.contains(openInMaps)).toBe(true);
  });

  it('stops the full-screen content column from swallowing touches in Globe mode', async () => {
    // The globe canvas sits below the content column in stacking order; a
    // column that captures pointer events would make one-finger spin and
    // pinch zoom dead. It must be pointer-events-none, with the header
    // re-enabled so its buttons stay tappable.
    let result: ReturnType<typeof renderApp> | undefined;
    await act(async () => {
      result = renderApp({ homeView: 'globe' });
    });
    await screen.findByTestId('home-globe-screen');

    const column = result!.container.querySelector('.max-w-lg');
    expect(column).not.toBeNull();
    expect(column?.className).toContain('pointer-events-none');
    expect(column?.className).not.toContain('overflow-y-auto');

    const header = result!.container.querySelector('header');
    expect(header?.className).toContain('pointer-events-auto');
  });

  it('keeps the content column interactive and scrollable in List mode', async () => {
    let result: ReturnType<typeof renderApp> | undefined;
    await act(async () => {
      result = renderApp({ homeView: 'list' });
    });

    const column = result!.container.querySelector('.max-w-lg');
    expect(column?.className).toContain('overflow-y-auto');
    expect(column?.className).not.toContain('pointer-events-none');
  });
});
