import { render, act, screen } from '@testing-library/react';
import { AllProviders } from '../test/helpers';
import { LocationDisplay } from '../components/LocationDisplay';
import { formatHijriLine } from '../utils/hijriDate';

/**
 * User story: I leave the app open past midnight, and the date under my city
 * is tomorrow's when I look again.
 *
 * The Hijri subtitle originally leaned on something that no longer exists: the
 * whole tree re-rendered once a second, so any stale date corrected itself
 * within a tick. Taking that per-second render out of App is one of the things
 * that made the app cheap to leave open — which means this subtitle now needs
 * its own reason to change, or it shows yesterday's date from midnight until
 * the first prayer boundary moves the app.
 */
describe('User story: the Hijri date past midnight', () => {
  beforeAll(() => {
    // jsdom does not implement window.matchMedia, which ThemeContext needs.
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

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances on its own when the calendar day turns', async () => {
    // Late evening, so midnight is a short wait away.
    const evening = new Date(2026, 8, 10, 23, 45, 0);
    vi.setSystemTime(evening);

    const tonight = formatHijriLine(evening, 0)!;
    const tomorrow = formatHijriLine(new Date(2026, 8, 11, 0, 1, 0), 0)!;
    // Guard the fixture itself: if these matched, the assertion below could not
    // tell a working timer from a broken one.
    expect(tomorrow).not.toBe(tonight);

    await act(async () => {
      render(
        <AllProviders>
          <LocationDisplay />
        </AllProviders>,
      );
    });

    // Settings load asynchronously and the subtitle waits on them; findBy* would
    // sit on a real-timer poll that never advances under fake timers.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByText(tonight)).toBeInTheDocument();

    // Twenty minutes, which crosses midnight.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    });

    expect(screen.getByText(tomorrow)).toBeInTheDocument();
    expect(screen.queryByText(tonight)).not.toBeInTheDocument();
  });
});
