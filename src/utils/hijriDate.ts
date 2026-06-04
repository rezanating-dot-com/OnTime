const HIJRI_FORMATTER_LOCALE = 'en-u-ca-islamic-umalqura';
const GREGORIAN_FORMATTER_LOCALE = 'en-US';

function clamp(offset: number): number {
  if (offset > 2) return 2;
  if (offset < -2) return -2;
  return offset | 0;
}

export function formatHijriLine(now: Date, offset: number): string | null {
  try {
    const adjusted = new Date(now);
    adjusted.setDate(now.getDate() + clamp(offset));

    const hijriParts = new Intl.DateTimeFormat(HIJRI_FORMATTER_LOCALE, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).formatToParts(adjusted);

    const get = (type: string) =>
      hijriParts.find((p) => p.type === type)?.value;

    const day = get('day');
    const monthRaw = get('month');
    const yearRaw = get('year');

    if (!day || !monthRaw || !yearRaw) return null;

    const year = parseInt(yearRaw, 10);
    if (Number.isNaN(year)) return null;

    // Sanity check: if Intl silently fell back to a Gregorian calendar, the year
    // will be close to the Gregorian year. Hijri years are ~579 less.
    if (Math.abs(year - now.getFullYear()) < 3) return null;

    // U+02BB MODIFIER LETTER TURNED COMMA appears in ICU month names like "Dhuʻl-Hijjah".
    const month = monthRaw.replace(/ʻ/g, '');

    const gregorian = new Intl.DateTimeFormat(GREGORIAN_FORMATTER_LOCALE, {
      month: 'short',
      day: 'numeric',
    }).format(now);

    return `${day} ${month} ${year} · ${gregorian}`;
  } catch {
    return null;
  }
}
