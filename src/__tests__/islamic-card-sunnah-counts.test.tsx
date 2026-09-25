import { render } from '@testing-library/react';
import { IslamicCountdownTimer } from '../components/IslamicCountdownTimer';
import type { DisplaySettings, PrayerName } from '../types';

// Issue #49: the Islamic card kept its own sunnah table, which said 2 after
// Fajr (a time when voluntary prayer is not offered), 4 before Isha, and
// dropped Witr. It must say what the other views say.

const display: DisplaySettings = { showCurrentPrayer: true, showNextPrayer: true, showSunnahCard: true };

function cardText(currentPrayer: PrayerName, isTraveling = false): string {
  const { container } = render(
    <IslamicCountdownTimer
      currentPrayer={currentPrayer}
      currentPrayerTime={new Date(Date.now() - 10 * 60_000)}
      nextPrayer="dhuhr"
      nextPrayerTime={new Date(Date.now() + 3 * 3600_000)}
      hours={3}
      minutes={0}
      seconds={0}
      isTraveling={isTraveling}
      display={display}
    />,
  );
  return container.textContent ?? '';
}

describe('User story: the Islamic card tells me the right sunnah for the prayer', () => {
  it('Fajr: 2 before, nothing after', () => {
    const text = cardText('fajr');
    expect(text).toMatch(/2\s*before/);
    expect(text).not.toMatch(/\d\s*after/);
  });

  it('Dhuhr: 4 before, 2 after', () => {
    const text = cardText('dhuhr');
    expect(text).toMatch(/4\s*before/);
    expect(text).toMatch(/2\s*after/);
  });

  it('Isha: 2 after and Witr, nothing before', () => {
    const text = cardText('isha');
    expect(text).not.toMatch(/\d\s*before/);
    expect(text).toMatch(/2\s*after/);
    expect(text).toMatch(/witr/i);
  });

  it('Isha while travelling: Witr is kept', () => {
    const text = cardText('isha', true);
    expect(text).toMatch(/witr/i);
    expect(text).not.toMatch(/\d\s*(before|after)/);
  });
});
