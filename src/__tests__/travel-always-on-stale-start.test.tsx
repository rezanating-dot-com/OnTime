import { render, act, fireEvent } from '@testing-library/react';
import { Preferences } from '@capacitor/preferences';
import { ThemeProvider } from '../context/ThemeContext';
import { SettingsProvider, useSettings } from '../context/SettingsContext';
import { LocationProvider } from '../context/LocationContext';
import { TravelProvider, useTravel } from '../context/TravelContext';
import type { TravelState } from '../types';

// Issue #47: "Always On" did nothing when the stored trip start was older than
// Max Travel Days, because that stamp had been written by something that was
// not the start of a trip.

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })),
});

const DAY = 24 * 60 * 60 * 1000;
const TORONTO = { latitude: 43.6532, longitude: -79.3832, cityName: 'Toronto' };
const MONTREAL = { latitude: 45.5019, longitude: -73.5674, cityName: 'Montreal' }; // ~500 km

const homeInToronto = (over: Record<string, unknown> = {}) => ({
  travel: {
    enabled: false,
    homeBase: { coordinates: { latitude: TORONTO.latitude, longitude: TORONTO.longitude }, cityName: 'Toronto' },
    override: 'auto',
    distanceThresholdKm: 88.7,
    jamaDhuhrAsr: false,
    jamaMaghribIsha: false,
    maxTravelDays: 4,
    travelStartDate: null,
    autoConfirmed: false,
    ...over,
  },
});

function renderAt(saved: Record<string, unknown>, where: typeof TORONTO) {
  let latest: TravelState | null = null;
  function Harness({ onState }: { onState: (s: TravelState) => void }) {
    const t = useTravel();
    const { isLoading } = useSettings();
    if (!isLoading) onState(t.travelState);
    return (
      <>
        <button onClick={() => t.setTravelOverride('force_on')}>always on</button>
        <button onClick={() => t.setTravelOverride('force_off')}>always off</button>
        <button onClick={t.toggleTravelEnabled}>toggle</button>
      </>
    );
  }

  vi.mocked(Preferences.get).mockImplementation(async ({ key }) => {
    if (key === 'ontime_settings') return { value: JSON.stringify(saved) };
    if (key === 'ontime_location') {
      return { value: JSON.stringify({ coordinates: { latitude: where.latitude, longitude: where.longitude }, cityName: where.cityName }) };
    }
    return { value: null };
  });
  vi.mocked(Preferences.set).mockResolvedValue(undefined);

  const view = render(
    <ThemeProvider>
      <SettingsProvider>
        <LocationProvider>
          <TravelProvider>
            <Harness onState={(st) => { latest = st; }} />
          </TravelProvider>
        </LocationProvider>
      </SettingsProvider>
    </ThemeProvider>,
  );
  return { view, state: () => latest! };
}

const savedTravel = () => {
  const writes = vi.mocked(Preferences.set).mock.calls
    .map(([arg]) => arg)
    .filter((arg) => arg.key === 'ontime_settings');
  return JSON.parse(writes[writes.length - 1].value).travel;
};

describe('User story: tapping Always On on a trip turns travel mode on', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('works when Travel Mode was switched on at home more than Max Travel Days ago', async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * DAY).toISOString();
    let r!: ReturnType<typeof renderAt>;
    await act(async () => {
      r = renderAt(homeInToronto({ enabled: true, travelStartDate: fiveDaysAgo }), MONTREAL);
    });

    await act(async () => { fireEvent.click(r.view.getByText('always on')); });
    expect(r.state().isTraveling).toBe(true);
  });

  it('works when Always On was last used at home weeks ago, then switched off', async () => {
    const threeWeeksAgo = new Date(Date.now() - 21 * DAY).toISOString();
    let r!: ReturnType<typeof renderAt>;
    await act(async () => {
      r = renderAt(homeInToronto({ override: 'force_off', travelStartDate: threeWeeksAgo }), MONTREAL);
    });

    await act(async () => { fireEvent.click(r.view.getByText('always on')); });
    expect(r.state().isTraveling).toBe(true);
  });

  it('keeps the start of a trip already in progress, so the allowance is not extended', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * DAY).toISOString();
    let r!: ReturnType<typeof renderAt>;
    await act(async () => {
      r = renderAt(homeInToronto({ enabled: true, autoConfirmed: true, travelStartDate: twoDaysAgo }), MONTREAL);
    });
    expect(r.state().isTraveling).toBe(true);

    await act(async () => { fireEvent.click(r.view.getByText('always on')); });
    expect(savedTravel().travelStartDate).toBe(twoDaysAgo);
  });

  it('switching Travel Mode on at home does not start a trip clock', async () => {
    let r!: ReturnType<typeof renderAt>;
    await act(async () => {
      r = renderAt(homeInToronto(), TORONTO);
    });

    await act(async () => { fireEvent.click(r.view.getByText('toggle')); });
    const t = savedTravel();
    expect(t.enabled).toBe(true);
    expect(t.travelStartDate).toBe(null);
  });
});
