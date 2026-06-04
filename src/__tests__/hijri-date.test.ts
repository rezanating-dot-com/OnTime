import { afterEach, beforeEach, vi } from 'vitest';
import { formatHijriLine } from '../utils/hijriDate';

describe('User story: I see the current Hijri date alongside the Gregorian date', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-06-04 local time. This Gregorian date falls inside Dhul-Hijjah 1447 AH
    // under the Umm al-Qura calendar.
    vi.setSystemTime(new Date(2026, 5, 4, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns a "<day> <month> <year> · <gregorian>" string for a normal date', () => {
    const result = formatHijriLine(new Date(), 0);

    expect(result).not.toBeNull();
    // Shape: digits, space, month word(s), space, 4-digit Hijri year, " · ", short Gregorian
    expect(result).toMatch(/^\d{1,2} [A-Za-z' -]+ 14\d{2} · [A-Z][a-z]{2} \d{1,2}$/);
  });

  it('uses the unshifted Gregorian date in the trailing half regardless of offset', () => {
    const zero = formatHijriLine(new Date(), 0);
    const plusTwo = formatHijriLine(new Date(), 2);

    // Both results must end with the same Gregorian segment (after " · ").
    const gregZero = zero!.split(' · ')[1];
    const gregPlusTwo = plusTwo!.split(' · ')[1];
    expect(gregZero).toBe(gregPlusTwo);
  });

  it('shifts the Hijri day forward when offset is +1', () => {
    const zero = formatHijriLine(new Date(), 0)!;
    const plusOne = formatHijriLine(new Date(), 1)!;

    const dayZero = parseInt(zero.split(' ')[0], 10);
    const dayPlusOne = parseInt(plusOne.split(' ')[0], 10);

    // Either the day advanced by 1, or the month rolled over (zero-day must be 29 or 30, plus-one must be 1).
    expect(
      dayPlusOne === dayZero + 1 ||
      (dayZero >= 29 && dayPlusOne === 1)
    ).toBe(true);
  });

  it('shifts the Hijri day backward when offset is -1', () => {
    const zero = formatHijriLine(new Date(), 0)!;
    const minusOne = formatHijriLine(new Date(), -1)!;

    const dayZero = parseInt(zero.split(' ')[0], 10);
    const dayMinusOne = parseInt(minusOne.split(' ')[0], 10);

    // Either the day retreated by 1, or the month rolled back (zero-day must be 1, minus-one is end-of-month).
    expect(
      dayMinusOne === dayZero - 1 ||
      (dayZero === 1 && dayMinusOne >= 28)
    ).toBe(true);
  });

  it('clamps out-of-range offsets to ±2 defensively', () => {
    const clampedHigh = formatHijriLine(new Date(), 99);
    const expectedHigh = formatHijriLine(new Date(), 2);
    expect(clampedHigh).toBe(expectedHigh);

    const clampedLow = formatHijriLine(new Date(), -99);
    const expectedLow = formatHijriLine(new Date(), -2);
    expect(clampedLow).toBe(expectedLow);
  });

  it('strips the unicode modifier letter from Intl month names', () => {
    const result = formatHijriLine(new Date(), 0);
    // U+02BB MODIFIER LETTER TURNED COMMA — Intl returns "Dhuʻl-Hijjah", we want "Dhul-Hijjah".
    expect(result).not.toContain('ʻ');
  });

  it('returns null when Intl.DateTimeFormat throws', () => {
    const original = Intl.DateTimeFormat;
    // @ts-expect-error — overriding constructor for the test
    Intl.DateTimeFormat = vi.fn(() => {
      throw new Error('unsupported calendar');
    });

    try {
      const result = formatHijriLine(new Date(), 0);
      expect(result).toBeNull();
    } finally {
      Intl.DateTimeFormat = original;
    }
  });

  it('returns null when Intl silently falls back to a Gregorian-looking year', () => {
    const original = Intl.DateTimeFormat;
    // Pretend Intl ignored the calendar tag and returned the Gregorian year.
    // The sanity-check inside formatHijriLine returns null before the
    // Gregorian formatter is ever constructed, so we can fake every call.
    class FakeFormatter {
      formatToParts() {
        return [
          { type: 'day', value: '4' },
          { type: 'literal', value: ' ' },
          { type: 'month', value: 'June' },
          { type: 'literal', value: ' ' },
          { type: 'year', value: '2026' },
        ];
      }
      format() {
        return 'Jun 4';
      }
    }
    // @ts-expect-error — overriding constructor for the test
    Intl.DateTimeFormat = vi.fn(() => new FakeFormatter());

    try {
      const result = formatHijriLine(new Date(), 0);
      expect(result).toBeNull();
    } finally {
      Intl.DateTimeFormat = original;
    }
  });
});
