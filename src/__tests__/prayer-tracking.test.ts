// Unmock the tracking service so we test the real implementation
vi.unmock('../services/prayerTrackingService');

import { Preferences } from '@capacitor/preferences';
import {
  trackPrayer,
  getPrayerStatus,
  getDailyRecord,
  getRecentRecords,
  getStats,
  getTodayKey,
  getDateKey,
  loadTrackingData,
  getTodayStatuses,
  resetTrackingCache,
} from '../services/prayerTrackingService';

// Not exported by the service; the literal key its blob lives under.
const TRACKING_KEY = 'ontime_prayer_tracking';

describe('User story: I can track whether I prayed on time', () => {
  let storage: Record<string, string> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    storage = {};
    // The service keeps the parsed blob for the session; each test starts from
    // empty storage, so it has to start from an empty cache too.
    resetTrackingCache();

    vi.mocked(Preferences.get).mockImplementation(async ({ key }) => {
      return { value: storage[key] || null };
    });
    vi.mocked(Preferences.set).mockImplementation(async ({ key, value }) => {
      storage[key] = value;
    });
  });

  it('tracks a prayer as on-time', async () => {
    await trackPrayer('fajr', 'ontime');
    const status = await getPrayerStatus('fajr');
    expect(status).toBe('ontime');
  });

  it('tracks a prayer as missed', async () => {
    await trackPrayer('dhuhr', 'missed');
    const status = await getPrayerStatus('dhuhr');
    expect(status).toBe('missed');
  });

  it('returns untracked for a prayer not yet tracked', async () => {
    const status = await getPrayerStatus('asr');
    expect(status).toBe('untracked');
  });

  it('overwrites a previous tracking for the same prayer and date', async () => {
    await trackPrayer('fajr', 'missed');
    expect(await getPrayerStatus('fajr')).toBe('missed');

    await trackPrayer('fajr', 'ontime');
    expect(await getPrayerStatus('fajr')).toBe('ontime');
  });

  it('removes record when untracking a prayer', async () => {
    await trackPrayer('fajr', 'ontime');
    expect(await getPrayerStatus('fajr')).toBe('ontime');

    await trackPrayer('fajr', 'untracked');
    expect(await getPrayerStatus('fajr')).toBe('untracked');
  });

  it('returns a daily record with all tracked prayers for today', async () => {
    await trackPrayer('fajr', 'ontime');
    await trackPrayer('dhuhr', 'ontime');
    await trackPrayer('asr', 'missed');

    const record = await getDailyRecord();
    expect(record.date).toBe(getTodayKey());
    expect(record.prayers.fajr).toBe('ontime');
    expect(record.prayers.dhuhr).toBe('ontime');
    expect(record.prayers.asr).toBe('missed');
    expect(record.prayers.maghrib).toBeUndefined();
  });

  it('calculates correct stats', async () => {
    await trackPrayer('fajr', 'ontime');
    await trackPrayer('dhuhr', 'ontime');
    await trackPrayer('asr', 'ontime');
    await trackPrayer('maghrib', 'missed');
    await trackPrayer('isha', 'ontime');

    const stats = await getStats(7);
    expect(stats.totalTracked).toBe(5);
    expect(stats.onTime).toBe(4);
    expect(stats.missed).toBe(1);
    expect(stats.percentage).toBe(80);
  });

  it('returns 0% when nothing is tracked', async () => {
    const stats = await getStats(7);
    expect(stats.totalTracked).toBe(0);
    expect(stats.percentage).toBe(0);
  });

  it('returns recent records for N days', async () => {
    await trackPrayer('fajr', 'ontime');

    const records = await getRecentRecords(3);
    expect(records.length).toBe(3);
    expect(records[0].prayers.fajr).toBe('ontime');
    expect(Object.keys(records[1].prayers).length).toBe(0);
  });

  it('counts the same window it displays (ST-2)', async () => {
    // A missed prayer exactly 7 days back sits outside a 7-day window that
    // starts 6 days back. getStats used to subtract `days` and compare
    // inclusively, so it counted an eighth day that no card showed and reported
    // 50% for a week the user can see is perfect.
    const sevenDaysBack = new Date();
    sevenDaysBack.setDate(sevenDaysBack.getDate() - 7);

    await trackPrayer('fajr', 'missed', sevenDaysBack);
    await trackPrayer('dhuhr', 'ontime');

    const cards = await getRecentRecords(7);
    const stats = await getStats(7);

    expect(cards).toHaveLength(7);
    expect(cards.some((c) => c.date === getDateKey(sevenDaysBack))).toBe(false);
    expect(stats.totalTracked).toBe(1);
    expect(stats.onTime).toBe(1);
    expect(stats.percentage).toBe(100);
  });

  it('repairs a legacy day key exactly once, then leaves it alone (ST-5)', async () => {
    // A blob from before the schema marker existed, whose day key disagrees
    // with its own trackedAt — the shape the old UTC keying produced.
    const isha = new Date();
    isha.setHours(12, 0, 0, 0);
    const legacyKey = getDateKey(new Date(isha.getTime() - 86_400_000));
    storage[TRACKING_KEY] = JSON.stringify({
      records: [{ date: legacyKey, prayer: 'isha', status: 'ontime', trackedAt: isha.toISOString() }],
    });

    const first = await loadTrackingData();
    expect(first.records[0].date).toBe(getDateKey(isha));
    expect(JSON.parse(storage[TRACKING_KEY]).dayKeySchema).toBeTruthy();

    // Now the device has changed timezone and the app has been relaunched.
    // Re-deriving trackedAt would file this prayer under a different day than
    // it was actually prayed, so the marker has to short-circuit the repair and
    // leave the record where it is. The reset stands in for the relaunch: the
    // service holds the parsed blob for a session, and this edit goes in behind
    // its back.
    const blob = JSON.parse(storage[TRACKING_KEY]);
    blob.records[0].date = legacyKey;
    storage[TRACKING_KEY] = JSON.stringify(blob);
    resetTrackingCache();

    const second = await loadTrackingData();
    expect(second.records[0].date).toBe(legacyKey);
  });

  it('collapses records that re-key onto the same day and prayer (ST-5)', async () => {
    // Two records for one prayer, written a second apart, both keyed to a day
    // that no longer matches. Re-keying lands them on the same date+prayer, so
    // getStats would double-count the pair and getPrayerStatus's find would
    // return whichever came first. The newest has to win.
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    storage[TRACKING_KEY] = JSON.stringify({
      records: [
        { date: 'stale', prayer: 'fajr', status: 'missed', trackedAt: new Date(noon.getTime() - 1000).toISOString() },
        { date: 'stale', prayer: 'fajr', status: 'ontime', trackedAt: noon.toISOString() },
      ],
    });

    const data = await loadTrackingData();
    expect(data.records).toHaveLength(1);
    expect(data.records[0].status).toBe('ontime');
    expect(data.records[0].date).toBe(getDateKey(noon));
  });
});

/**
 * User story: I open the prayer list. The checkmarks for today's five prayers
 * appear together, without the app going back to storage once per prayer.
 */
describe('reading today’s statuses', () => {
  let storage: Record<string, string> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    storage = {};
    resetTrackingCache();
    vi.mocked(Preferences.get).mockImplementation(async ({ key }) => ({ value: storage[key] || null }));
    vi.mocked(Preferences.set).mockImplementation(async ({ key, value }) => {
      storage[key] = value;
    });
  });

  it('reports every asked-for prayer, tracked or not', async () => {
    await trackPrayer('fajr', 'ontime');
    await trackPrayer('asr', 'missed');

    const statuses = await getTodayStatuses(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);

    expect(statuses).toEqual({
      fajr: 'ontime',
      dhuhr: 'untracked',
      asr: 'missed',
      maghrib: 'untracked',
      isha: 'untracked',
    });
  });

  it('goes to storage once for the whole set, not once per prayer', async () => {
    await trackPrayer('fajr', 'ontime');
    vi.mocked(Preferences.get).mockClear();

    await getTodayStatuses(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);

    expect(vi.mocked(Preferences.get).mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('does not hand back a status from another day', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await trackPrayer('isha', 'ontime', yesterday);

    const statuses = await getTodayStatuses(['isha']);

    expect(statuses.isha).toBe('untracked');
  });
});
