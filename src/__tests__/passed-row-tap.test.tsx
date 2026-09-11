import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Preferences } from '@capacitor/preferences';
import { PrayerTable } from '../components/PrayerTable';
import { IslamicPrayerTable } from '../components/IslamicPrayerTable';
import { ThemeProvider } from '../context/ThemeContext';
import { SettingsProvider } from '../context/SettingsContext';
import { LocationProvider } from '../context/LocationContext';
import { TravelProvider } from '../context/TravelContext';
import type { PrayerTime } from '../types';

/**
 * User story: I tap a prayer that has already been, and the row answers.
 *
 * Tapping the name of a prayer that had passed used to open the "prayed on
 * time?" prompt. With that gone the row had nothing left to say, and the
 * obvious failure is a row that goes dead to the tap while every row below it
 * still opens its countdown. A passed row reads "Passed", which both designs
 * already have a colour for.
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

const at = (h: number, m: number) => new Date(2026, 8, 10, h, m, 0);

const PRAYERS: PrayerTime[] = [
  { name: 'fajr', label: 'Fajr', time: at(5, 12) },
  { name: 'dhuhr', label: 'Dhuhr', time: at(12, 24) },
  { name: 'asr', label: 'Asr', time: at(15, 41) },
  { name: 'maghrib', label: 'Maghrib', time: at(19, 24) },
  { name: 'isha', label: 'Isha', time: at(20, 51) },
];

beforeEach(() => {
  vi.useFakeTimers();
  // Mid-afternoon: Fajr and Dhuhr have been, Asr has not.
  vi.setSystemTime(new Date(2026, 8, 10, 14, 0, 0));
  vi.mocked(Preferences.get).mockResolvedValue({ value: null });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const wrap = (table: React.ReactNode) => (
  <ThemeProvider>
    <SettingsProvider>
      <LocationProvider>
        <TravelProvider>{table}</TravelProvider>
      </LocationProvider>
    </SettingsProvider>
  </ThemeProvider>
);

describe('User story: tapping a prayer that has already been', () => {
  it('Classic: a passed row opens its countdown and says Passed', async () => {
    await act(async () => {
      render(wrap(<PrayerTable prayers={PRAYERS} currentPrayer={'dhuhr'} nextPrayerTime={at(15, 41)} />));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    await act(async () => { screen.getByText('Fajr').click(); });
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });

  it('Classic: an upcoming row still counts down', async () => {
    await act(async () => {
      render(wrap(<PrayerTable prayers={PRAYERS} currentPrayer={'dhuhr'} nextPrayerTime={at(15, 41)} />));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    await act(async () => { screen.getByText('Asr').click(); });
    // 14:00 to 15:41 is 1h 41m, less the 50ms settled above, and the countdown
    // floors to whole minutes. Hence 40 rather than 41.
    expect(screen.getByText('1h 40m left')).toBeInTheDocument();
  });

  it('Islamic: a passed row opens its countdown and says Passed', async () => {
    await act(async () => {
      render(wrap(<IslamicPrayerTable prayers={PRAYERS} currentPrayer={'dhuhr'} nextPrayerTime={at(15, 41)} />));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    await act(async () => { screen.getByText('Fajr').click(); });
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });
});
