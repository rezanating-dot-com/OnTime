import { Preferences } from '@capacitor/preferences';
import type { PrayerName } from '../types';

const TRACKING_KEY = 'ontime_prayer_tracking';

export type PrayerStatus = 'ontime' | 'missed' | 'untracked';

export interface PrayerRecord {
  date: string; // YYYY-MM-DD
  prayer: PrayerName;
  status: PrayerStatus;
  trackedAt: string; // ISO timestamp
}

export interface DailyRecord {
  date: string;
  prayers: Partial<Record<PrayerName, PrayerStatus>>;
}

export interface TrackingData {
  records: PrayerRecord[];
}

/**
 * Bumped whenever the meaning of a record's `date` changes, so a one-off repair
 * can tell "already migrated" from "written by an older build". Blobs saved
 * before it existed simply lack the field, which is exactly the set that needs
 * migrating.
 */
const DAY_KEY_SCHEMA = 2;

/** The persisted shape: the public data plus the migration marker. */
interface StoredTrackingData extends TrackingData {
  dayKeySchema?: number;
}

/** How many days of history to keep, today included. */
const RETENTION_DAYS = 30;

// Day keys use the LOCAL calendar date, not UTC (toISOString): east of UTC,
// between local midnight and the UTC offset hour, the UTC date is still
// yesterday, which would file last night's Isha under yesterday and show
// today's rows with stale checkmarks. Prayer days roll over at local midnight.
function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// Get today's date as YYYY-MM-DD
export function getTodayKey(): string {
  return localDateKey(new Date());
}

// Get date key for a specific date
export function getDateKey(date: Date): string {
  return localDateKey(date);
}

// The local day key for `daysBack` days before today. Day 0 is today, so a
// window of N days spans N-1 back to 0 — getting that wrong is what made
// getStats(7) count eight calendar days against the seven cards on screen.
function dayKeyNDaysBack(daysBack: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysBack);
  return localDateKey(date);
}

// Records written before the UTC→local day-key change carry a UTC-derived
// `date`, which no longer matches the local key lookups use — east of UTC that
// silently orphans every prayer tracked between local midnight and the offset
// hour. `trackedAt` is the authoritative instant, so the right key is
// recoverable.
//
// This has to run exactly once. Recomputing it on every load re-derived each
// record's day in whatever timezone the device happens to be in *now*, so a user
// who flew west found last night's checkmark filed under the previous day — and
// this app ships Travel Mode, so crossing timezones is a designed journey.
function migrateDayKeys(data: StoredTrackingData): TrackingData {
  const { records } = data;
  if (data.dayKeySchema === DAY_KEY_SCHEMA) return { records };

  const rekeyed = records.map((record) => {
    const trackedAt = new Date(record.trackedAt);
    if (Number.isNaN(trackedAt.getTime())) return record;
    const localKey = localDateKey(trackedAt);
    return localKey === record.date ? record : { ...record, date: localKey };
  });

  // Re-keying can collapse two records onto the same day and prayer. Keep the
  // most recently tracked, or getStats double-counts the pair while
  // getPrayerStatus's `find` returns whichever was written first.
  const newest = new Map<string, PrayerRecord>();
  for (const record of rekeyed) {
    const key = `${record.date}|${record.prayer}`;
    const existing = newest.get(key);
    if (!existing || Date.parse(record.trackedAt) > Date.parse(existing.trackedAt)) {
      newest.set(key, record);
    }
  }
  const migrated = [...newest.values()];

  // Saved whether or not anything changed, so the marker lands and the repair
  // never runs again.
  void saveTrackingData({ records: migrated });
  return { records: migrated };
}

/**
 * The blob, parsed, for the rest of the session.
 *
 * Every read in this module used to go to native storage and re-parse: the
 * prayer table asked five times on mount, and opening the dashboard asked
 * twice more. The stored value only ever changes through saveTrackingData
 * below, so the parse can happen once. A promise rather than a value, because
 * those five reads start together and would otherwise all miss.
 */
let cached: Promise<TrackingData> | null = null;

/**
 * Drop the parsed blob. For tests, and for anything that ever writes this key
 * without going through saveTrackingData.
 */
export function resetTrackingCache(): void {
  cached = null;
}

async function readTrackingData(): Promise<TrackingData> {
  try {
    const { value } = await Preferences.get({ key: TRACKING_KEY });
    if (value) {
      return migrateDayKeys(JSON.parse(value) as StoredTrackingData);
    }
  } catch (error) {
    console.error('Failed to load tracking data:', error);
  }
  return { records: [] };
}

// Load all tracking data
export async function loadTrackingData(): Promise<TrackingData> {
  cached ??= readTrackingData();
  // A shallow copy: trackPrayer reassigns `records` on what it gets back, and
  // must not be reassigning it on the cache.
  return { records: (await cached).records };
}

// Save tracking data
async function saveTrackingData(data: TrackingData): Promise<void> {
  try {
    // Every write stamps the current schema, so a save can't drop the marker
    // and send the next load back through the migration.
    const stored: StoredTrackingData = { records: data.records, dayKeySchema: DAY_KEY_SCHEMA };
    await Preferences.set({
      key: TRACKING_KEY,
      value: JSON.stringify(stored),
    });
    cached = Promise.resolve({ records: data.records });
  } catch (error) {
    console.error('Failed to save tracking data:', error);
    // The write failed, so the cache would be ahead of what is on disk.
    cached = null;
  }
}

// Track a prayer
export async function trackPrayer(
  prayer: PrayerName,
  status: PrayerStatus,
  date?: Date
): Promise<void> {
  const data = await loadTrackingData();
  const dateKey = date ? getDateKey(date) : getTodayKey();
  
  // Remove any existing record for this prayer on this date
  data.records = data.records.filter(
    (r) => !(r.date === dateKey && r.prayer === prayer)
  );
  
  // Add new record (only if not untracked)
  if (status !== 'untracked') {
    data.records.push({
      date: dateKey,
      prayer,
      status,
      trackedAt: new Date().toISOString(),
    });
  }
  
  // Keep the last RETENTION_DAYS days of records, today included.
  const cutoffDate = dayKeyNDaysBack(RETENTION_DAYS - 1);
  data.records = data.records.filter((r) => r.date >= cutoffDate);
  
  await saveTrackingData(data);
}

// Get status for a specific prayer on a specific date
export async function getPrayerStatus(
  prayer: PrayerName,
  date?: Date
): Promise<PrayerStatus> {
  const data = await loadTrackingData();
  const dateKey = date ? getDateKey(date) : getTodayKey();
  
  const record = data.records.find(
    (r) => r.date === dateKey && r.prayer === prayer
  );
  
  return record?.status || 'untracked';
}

/**
 * Today's status for several prayers at once.
 *
 * The prayer table wants all five, and asking prayer by prayer meant five
 * sequential awaits before the first checkmark could appear.
 */
export async function getTodayStatuses(
  prayers: readonly PrayerName[],
  date?: Date
): Promise<Record<string, PrayerStatus>> {
  const data = await loadTrackingData();
  const dateKey = date ? getDateKey(date) : getTodayKey();

  const wanted = new Set<string>(prayers);
  const statuses: Record<string, PrayerStatus> = {};
  for (const prayer of prayers) statuses[prayer] = 'untracked';
  for (const record of data.records) {
    if (record.date === dateKey && wanted.has(record.prayer)) {
      statuses[record.prayer] = record.status;
    }
  }
  return statuses;
}

// Get all records for a specific date
export async function getDailyRecord(date?: Date): Promise<DailyRecord> {
  const data = await loadTrackingData();
  const dateKey = date ? getDateKey(date) : getTodayKey();
  
  const dayRecords = data.records.filter((r) => r.date === dateKey);
  
  const prayers: Partial<Record<PrayerName, PrayerStatus>> = {};
  for (const record of dayRecords) {
    prayers[record.prayer] = record.status;
  }
  
  return { date: dateKey, prayers };
}

// Get records for the last N days
export async function getRecentRecords(days: number = 7): Promise<DailyRecord[]> {
  const data = await loadTrackingData();
  const results: DailyRecord[] = [];
  
  for (let i = 0; i < days; i++) {
    const dateKey = dayKeyNDaysBack(i);
    
    const dayRecords = data.records.filter((r) => r.date === dateKey);
    const prayers: Partial<Record<PrayerName, PrayerStatus>> = {};
    for (const record of dayRecords) {
      prayers[record.prayer] = record.status;
    }
    
    results.push({ date: dateKey, prayers });
  }
  
  return results;
}

// Get statistics
export interface PrayerStats {
  totalTracked: number;
  onTime: number;
  missed: number;
  percentage: number;
}

export async function getStats(days: number = 7): Promise<PrayerStats> {
  const data = await loadTrackingData();
  
  // Exactly the window getRecentRecords(days) displays: today plus the days-1
  // before it. Counting one day further back than the cards on screen is how
  // the weekly score came to disagree with them — an eighth, invisible day
  // could pull a 100% week down to 50%.
  const cutoffKey = dayKeyNDaysBack(days - 1);

  const recentRecords = data.records.filter((r) => r.date >= cutoffKey);
  
  const onTime = recentRecords.filter((r) => r.status === 'ontime').length;
  const missed = recentRecords.filter((r) => r.status === 'missed').length;
  const total = onTime + missed;
  
  return {
    totalTracked: total,
    onTime,
    missed,
    percentage: total > 0 ? Math.round((onTime / total) * 100) : 0,
  };
}
