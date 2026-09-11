import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { useRef } from 'react';
import { render, screen, act } from '@testing-library/react';
import { Preferences } from '@capacitor/preferences';
import { TravelPromptDialog } from '../components/TravelPromptDialog';
import { ThemeProvider } from '../context/ThemeContext';
import { SettingsProvider } from '../context/SettingsContext';
import { LocationProvider } from '../context/LocationContext';
import { TravelProvider } from '../context/TravelContext';

/**
 * ST-14: the two z-[100] dialogs sit above every z-50 overlay and were
 * invisible to App's back-button state machine, which runs
 * settings -> qibla -> minimizeApp(). Back therefore minimised
 * the app with the dialog still on screen.
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

/** Home base in Mecca, user in Toronto: far enough that the offer is raised. */
const AWAY = {
  travel: {
    enabled: false,
    homeBase: { coordinates: { latitude: 21.4225, longitude: 39.8262 }, cityName: 'Mecca' },
    override: 'auto',
    distanceThresholdKm: 88.7,
    jamaDhuhrAsr: false,
    jamaMaghribIsha: false,
    maxTravelDays: 0,
    travelStartDate: null,
    autoConfirmed: false,
    promptDismissed: false,
    offerSuppressed: false,
  },
};

/** Stands in for App: holds the ref the dialog registers into. */
function Host() {
  const dialogBackRef = useRef<(() => void) | null>(null);
  return (
    <>
      <button onClick={() => dialogBackRef.current?.()}>press back</button>
      <TravelPromptDialog onBackRef={dialogBackRef} />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Preferences.get).mockImplementation(async ({ key }) => {
    if (key === 'ontime_settings') return { value: JSON.stringify(AWAY) };
    if (key === 'ontime_location') {
      return {
        value: JSON.stringify({
          coordinates: { latitude: 43.6532, longitude: -79.3832 },
          cityName: 'Toronto',
        }),
      };
    }
    return { value: null };
  });
  vi.mocked(Preferences.set).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Android back and the travel prompt (ST-14)', () => {
  it('dismisses the dialog instead of falling through to minimizeApp', async () => {
    await act(async () => {
      render(
        <ThemeProvider>
          <SettingsProvider>
            <LocationProvider>
              <TravelProvider>
                <Host />
              </TravelProvider>
            </LocationProvider>
          </SettingsProvider>
        </ThemeProvider>,
      );
    });

    expect(await screen.findByText(/Looks like you're traveling/)).toBeInTheDocument();

    await act(async () => { screen.getByText('press back').click(); });

    expect(screen.queryByText(/Looks like you're traveling/)).not.toBeInTheDocument();
  });

  it('registers nothing while it is not on screen', async () => {
    // At home: no offer, so back must fall through to whatever App does next
    // rather than being swallowed by a dialog that is not there.
    vi.mocked(Preferences.get).mockImplementation(async ({ key }) => {
      if (key === 'ontime_settings') return { value: JSON.stringify(AWAY) };
      if (key === 'ontime_location') {
        return {
          value: JSON.stringify({
            coordinates: { latitude: 21.43, longitude: 39.83 },
            cityName: 'Mecca',
          }),
        };
      }
      return { value: null };
    });

    let registered: (() => void) | null = null;
    function Probe() {
      const ref = useRef<(() => void) | null>(null);
      return (
        <>
          <button onClick={() => { registered = ref.current; }}>read ref</button>
          <TravelPromptDialog onBackRef={ref} />
        </>
      );
    }

    await act(async () => {
      render(
        <ThemeProvider>
          <SettingsProvider>
            <LocationProvider>
              <TravelProvider>
                <Probe />
              </TravelProvider>
            </LocationProvider>
          </SettingsProvider>
        </ThemeProvider>,
      );
    });

    await act(async () => { screen.getByText('read ref').click(); });
    expect(registered).toBeNull();
  });
});
