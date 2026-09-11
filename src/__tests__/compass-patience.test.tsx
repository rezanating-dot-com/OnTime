import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Preferences } from '@capacitor/preferences';
import { HomeGlobeScreen } from '../components/HomeGlobeScreen';
import { ThemeProvider } from '../context/ThemeContext';
import { SettingsProvider } from '../context/SettingsContext';
import { LocationProvider } from '../context/LocationContext';
import { TravelProvider } from '../context/TravelContext';

/**
 * User story: my phone has no compass, and the app stops telling me to wave it.
 *
 * "Hold the phone flat and sweep a figure-8" is good advice for a few seconds
 * and wrong after that. A phone with no magnetometer never calibrates however
 * long you wave it, and the line drawn on the globe and the bearing under it
 * are both still true without one. Left up, the hint is the largest text on
 * the screen and it reads as a fault.
 */
vi.mock('../components/three/Scenes', () => ({
  HomeGlobeView: () => <div data-testid="globe-canvas" />,
}));

// No readings ever arrive, which is what a device without a magnetometer and
// a desktop browser both look like.
vi.mock('../hooks/useQibla', () => ({
  useQibla: () => ({
    qiblaDirection: 58.4,
    deviceHeading: 0,
    rotationAngle: 0,
    isCalibrated: false,
    accuracy: 0,
    error: null,
    isListening: true,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  });
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(Preferences.get).mockResolvedValue({ value: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const HINT = /sweep a figure-8/;

async function show() {
  await act(async () => {
    render(
      <ThemeProvider>
        <SettingsProvider>
          <LocationProvider>
            <TravelProvider>
              <HomeGlobeScreen prayers={[]} qiblaMode />
            </TravelProvider>
          </LocationProvider>
        </SettingsProvider>
      </ThemeProvider>,
    );
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
}

describe('User story: the compass hint on a phone that has no compass', () => {
  it('asks for a figure-8 at first', async () => {
    await show();
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it('stops asking once it is clear no reading is coming', async () => {
    await show();
    expect(screen.getByText(HINT)).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });

    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it('still shows the bearing, which holds with or without a compass', async () => {
    await show();
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });

    // Split across text nodes by the interpolated degrees, so match on the
    // whole line rather than on one node. The wrapper matches too once the
    // hint above it is gone, hence all rather than one.
    expect(
      screen.getAllByText((_, el) => el?.textContent?.trim() === 'Qibla 58° ENE from north').length,
    ).toBeGreaterThan(0);
  });
});
