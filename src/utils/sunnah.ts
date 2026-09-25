import type { PrayerName } from '../types';

/**
 * The regular sunnah rawatib around each fard prayer — the 12 rak'ah of the
 * hadith. One source of truth: the list view prints these strings in full, the
 * globe HUD condenses them through sunnahSummary().
 */
export const SUNNAH_PRAYERS: Record<PrayerName, { before?: string; after?: string; notes?: string }> = {
  fajr: { before: '2 rak\'at Sunnah' },
  sunrise: {},
  dhuhr: { before: '4 rak\'at Sunnah', after: '2 rak\'at Sunnah' },
  asr: { before: '4 rak\'at (optional)' },
  maghrib: { after: '2 rak\'at Sunnah' },
  isha: { after: '2 rak\'at Sunnah + Witr', notes: 'Tahajjud available until Fajr' },
};

/** Travelling drops most rawatib — Fajr's two and Witr are kept. */
export const SUNNAH_PRAYERS_TRAVEL: Record<PrayerName, { before?: string; after?: string; notes?: string }> = {
  fajr: { before: '2 rak\'at Sunnah' },
  sunrise: {},
  dhuhr: {},
  asr: {},
  maghrib: {},
  isha: { after: 'Witr' },
};

export function getSunnahPrayers(isTraveling: boolean) {
  return isTraveling ? SUNNAH_PRAYERS_TRAVEL : SUNNAH_PRAYERS;
}

/**
 * The same rawatib as numbers, for views that lay them out themselves:
 * rak'ah before and after the fard (0 for none), and whether Witr follows.
 */
export function sunnahCounts(prayer: PrayerName, isTraveling: boolean): { before: number; after: number; witr: boolean } {
  const entry = getSunnahPrayers(isTraveling)[prayer] ?? {};
  const rakat = (s?: string) => {
    const n = s?.match(/^(\d+)/);
    return n ? Number(n[1]) : 0;
  };
  return {
    before: rakat(entry.before),
    after: rakat(entry.after),
    witr: /witr/i.test(`${entry.before ?? ''} ${entry.after ?? ''}`),
  };
}

/**
 * The same rawatib as one short clause for the globe HUD: "4 + 2 sunnah",
 * "2 sunnah + witr". Null when this prayer has none to mention.
 */
export function sunnahSummary(prayer: PrayerName, isTraveling: boolean): string | null {
  const { before, after, witr } = sunnahCounts(prayer, isTraveling);
  const counts = [before, after].filter((n) => n > 0);
  if (!counts.length) return witr ? 'witr' : null;
  return `${counts.join(' + ')} sunnah${witr ? ' + witr' : ''}`;
}
