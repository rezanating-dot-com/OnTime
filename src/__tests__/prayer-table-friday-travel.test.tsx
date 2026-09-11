import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Preferences } from '@capacitor/preferences';
import { PrayerTable } from '../components/PrayerTable';
import { IslamicPrayerTable } from '../components/IslamicPrayerTable';
import { ThemeProvider } from '../context/ThemeContext';
import { SettingsProvider } from '../context/SettingsContext';
import { LocationProvider } from '../context/LocationContext';
import { TravelProvider } from '../context/TravelContext';
import type { PrayerTime, Settings } from '../types';

/**
 * The Friday + Travel + Jama' corner of both tables, and the rows whose
 * "passed" state nothing was refreshing.
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

// A Friday. 2026-09-11 is a Friday; 11:00 local is before both the khutbah
// and Dhuhr, so nothing has passed at the start of a test.
const FRIDAY_MORNING = new Date(2026, 8, 11, 11, 0, 0);

const at = (h: number, m: number) => new Date(2026, 8, 11, h, m, 0);

const PRAYERS: PrayerTime[] = [
  { name: 'fajr', label: 'Fajr', time: at(5, 12) },
  { name: 'sunrise', label: 'Sunrise', time: at(6, 38) },
  { name: 'dhuhr', label: 'Dhuhr', time: at(12, 24) },
  { name: 'asr', label: 'Asr', time: at(15, 41) },
  { name: 'maghrib', label: 'Maghrib', time: at(19, 24) },
  { name: 'isha', label: 'Isha', time: at(20, 51) },
  { name: 'middleOfNight', label: 'Middle of Night', time: at(0, 30) },
  { name: 'lastThirdOfNight', label: 'Last Third of Night', time: at(2, 15) },
];

const SAVED: Partial<Settings> = {
  jumuah: {
    enabled: true,
    masjidName: '',
    // Deliberately before Dhuhr, which is the case the bug hides in.
    times: [{ khutbah: '13:00', iqamah: '13:30' }],
    reminderMinutes: 30,
  },
  travel: {
    enabled: true,
    homeBase: { coordinates: { latitude: 21.4225, longitude: 39.8262 }, cityName: 'Mecca' },
    override: 'force_on',
    distanceThresholdKm: 88.7,
    jamaDhuhrAsr: true,
    jamaMaghribIsha: false,
    maxTravelDays: 0,
    travelStartDate: null,
    autoConfirmed: true,
    promptDismissed: false,
    offerSuppressed: false,
  },
  optionalPrayers: { showSunrise: true, showMiddleOfNight: true, showLastThirdOfNight: true },
};

function renderTable(Table: typeof PrayerTable | typeof IslamicPrayerTable) {
  vi.mocked(Preferences.get).mockImplementation(async ({ key }) =>
    key === 'ontime_settings' ? { value: JSON.stringify(SAVED) } : { value: null },
  );
  return render(
    <ThemeProvider>
      <SettingsProvider>
        <LocationProvider>
          <TravelProvider>
            <Table prayers={PRAYERS} currentPrayer={null} nextPrayerTime={at(12, 24)} />
          </TravelProvider>
        </LocationProvider>
      </SettingsProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // shouldAdvanceTime, or testing-library's waitFor never resolves.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(FRIDAY_MORNING);
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ['PrayerTable', PrayerTable],
  ['IslamicPrayerTable', IslamicPrayerTable],
] as const)('%s: Friday + Travel + Jama (PM-11)', (_name, Table) => {
  it('shows the khutbah time on the row it labels Jumuah', async () => {
    let view!: ReturnType<typeof render>;
    await act(async () => { view = renderTable(Table); });

    // The non-travelling Friday branch substitutes label *and* time; the Jama'
    // branch substituted only the label, so the same screen rendered
    // "Jumuah + Asr  12:24 — 3:41 PM" against a 13:00 khutbah, contradicting
    // its own non-travelling rendering. The time is split across text nodes,
    // so read the row as text.
    const row = (await screen.findByText(/Jumuah \+ Asr/)).closest('div')!.parentElement!;
    expect(row.textContent).toContain('1:00');
    expect(row.textContent).not.toContain('12:24');
    view.unmount();
  });
});

describe('the Jumuah row between khutbah and Dhuhr (PM-9)', () => {
  it('reads as passed once the khutbah has started, not once Dhuhr arrives', async () => {
    // Travel off, so this is the plain Friday row rather than the Jama' pair.
    // The Islamic design is the one that shows a prayer has passed: the row
    // fades and its dot dims.
    vi.mocked(Preferences.get).mockImplementation(async ({ key }) =>
      key === 'ontime_settings'
        ? { value: JSON.stringify({ ...SAVED, travel: { ...SAVED.travel, override: 'force_off' } }) }
        : { value: null },
    );
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <ThemeProvider>
          <SettingsProvider>
            <LocationProvider>
              <TravelProvider>
                <IslamicPrayerTable prayers={PRAYERS} currentPrayer={null} nextPrayerTime={at(12, 24)} />
              </TravelProvider>
            </LocationProvider>
          </SettingsProvider>
        </ThemeProvider>,
      );
    });

    const name = await screen.findByText('Jumuah');
    // 11:00: the khutbah is still ahead, so the row is at full strength.
    expect(name.style.opacity).toBe('1');

    // 13:01: the khutbah has started, but Dhuhr (12:24) is the boundary that
    // refreshes this table and it is not the one this row is measured against.
    // Without a timer of its own nothing re-renders, and the row went on
    // looking upcoming for the whole gap. Deliberately no tap before this
    // point: tapping selects the row, which starts its own per-second
    // countdown and would re-render it for unrelated reasons.
    await act(async () => {
      vi.setSystemTime(new Date(2026, 8, 11, 13, 1, 0));
      await vi.advanceTimersByTimeAsync(61_000);
    });

    expect(screen.getByText('Jumuah').style.opacity).toBe('0.55');
    view.unmount();
  });
});
