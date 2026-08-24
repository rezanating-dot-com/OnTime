import { render, screen } from '@testing-library/react';
import { CountdownTimer } from '../components/CountdownTimer';
import { IslamicCountdownTimer } from '../components/IslamicCountdownTimer';
import type { DisplaySettings } from '../types';

const display: DisplaySettings = {
  showCurrentPrayer: true,
  showNextPrayer: true,
  showSunnahCard: true,
};

const baseProps = {
  currentPrayer: 'dhuhr' as const,
  currentPrayerTime: new Date(2026, 7, 23, 13, 0, 0),
  nextPrayer: 'asr',
  nextPrayerTime: new Date(2026, 7, 23, 17, 0, 0),
  hours: 1,
  minutes: 30,
  seconds: 0,
  display,
};

describe('CountdownTimer glow variant', () => {
  it('keeps the card background by default', () => {
    const { container } = render(<CountdownTimer {...baseProps} />);
    // Plain substring check on the rendered markup — avoids escaping the
    // Tailwind arbitrary-value class's brackets/parens as a CSS selector.
    expect(container.innerHTML).toContain('bg-[var(--color-card)]');
  });

  it('drops the card background/border when glow is true', () => {
    const { container } = render(<CountdownTimer {...baseProps} glow />);
    expect(container.innerHTML).not.toContain('bg-[var(--color-card)]');
    expect(screen.getByText('Next Prayer')).toBeInTheDocument();
  });
});

describe('IslamicCountdownTimer glow variant', () => {
  it('renders the Girih-pattern card by default', () => {
    const { container } = render(<IslamicCountdownTimer {...baseProps} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('drops the Girih pattern and card chrome when glow is true', () => {
    const { container } = render(<IslamicCountdownTimer {...baseProps} glow />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText(/Next/)).toBeInTheDocument();
  });
});
