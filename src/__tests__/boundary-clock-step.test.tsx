import { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { AllProviders } from '../test/helpers';
import { usePrayerTimes } from '../hooks/usePrayerTimes';

/**
 * User story: my phone corrects its clock backwards while I have the app open,
 * and the next prayer still arrives.
 *
 * The hook arms a timer at the next prayer's instant, with a five-second
 * watchdog behind it for the cases a timer alone cannot cover — sleep, being
 * backgrounded, a clock correction. A timer counts *elapsed* time, so one armed
 * for 12:00 fires after its full delay no matter what the clock has been set to
 * meanwhile: after a backward correction it can fire while the clock still
 * reads 11:55.
 *
 * The recalculation that follows then rebuilds the same instant, so the effect's
 * dependency does not change and it never re-arms. Everything after that
 * depended on the watchdog — and the guard that stops a stuck target spinning
 * the effect used to refuse a second attempt at the same target *forever*,
 * which locked the watchdog out too. The prayer that had already passed stayed
 * on screen until midnight.
 */
interface Sample {
  nextMs: number | null;
}

function Probe({ onCommit }: { onCommit: (sample: Sample) => void }) {
  const data = usePrayerTimes();
  useEffect(() => {
    onCommit({ nextMs: data.nextPrayerTime?.getTime() ?? null });
  });
  return null;
}

async function mountProbe(onCommit: (sample: Sample) => void) {
  let unmount = () => {};
  await act(async () => {
    ({ unmount } = render(
      <AllProviders>
        <Probe onCommit={onCommit} />
      </AllProviders>,
    ));
  });
  return unmount;
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const FIVE_MINUTES = 5 * 60_000;

describe('a prayer boundary across a backward clock correction', () => {
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

  it('still moves on to the next prayer', async () => {
    // Learn the target the providers' coordinates actually produce, rather
    // than assuming one.
    vi.setSystemTime(new Date(2026, 3, 24, 10, 0, 0));
    let probe: Sample[] = [];
    let unmount = await mountProbe((s) => probe.push(s));
    const target = probe.at(-1)!.nextMs!;
    expect(target).toBeTruthy();
    act(() => unmount());

    // Remount a minute before that prayer, so the timer it arms is short.
    vi.setSystemTime(new Date(target - 60_000));
    probe = [];
    unmount = await mountProbe((s) => probe.push(s));
    expect(probe.at(-1)!.nextMs).toBe(target);

    // The clock is corrected five minutes backwards. Nothing re-renders: the
    // hook has no idea this happened.
    vi.setSystemTime(new Date(target - 60_000 - FIVE_MINUTES));

    // The timer armed above fires on schedule — after its own 60s — and the
    // clock now reads five minutes before the prayer. The recalculation it
    // triggers lands on the same instant, so nothing re-arms.
    await tick(61_000);
    expect(probe.at(-1)!.nextMs).toBe(target);

    // Let the clock run past the prayer. Only the watchdog is left to notice.
    await tick(FIVE_MINUTES + 30_000);

    expect(probe.at(-1)!.nextMs!).toBeGreaterThan(target);

    act(() => unmount());
  });
});
