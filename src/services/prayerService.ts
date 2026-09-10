import {
  Coordinates,
  CalculationMethod,
  PrayerTimes,
  SunnahTimes,
  Prayer,
  Qibla,
  CalculationParameters,
  Madhab,
} from 'adhan';
import type {
  CalculationMethod as CalcMethodType,
  AsrCalculation,
  PrayerTime,
  PrayerTimesData,
  PrayerName,
  AllPrayerNames,
  SunnahTimesData,
  Coordinates as CoordsType,
} from '../types';

const PRAYER_LABELS: Record<AllPrayerNames, string> = {
  fajr: 'Fajr',
  sunrise: 'Sunrise',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
  middleOfNight: 'Middle of Night',
  lastThirdOfNight: 'Last Third',
  tahajjud: 'Tahajjud',
};

// Module scope, not rebuilt per call. Each entry still has to be a function:
// adhan hands back a fresh parameters object that callers then mutate (madhab,
// below), so they cannot share one instance.
const METHOD_PARAMETERS: Record<CalcMethodType, () => CalculationParameters> = {
  MuslimWorldLeague: () => CalculationMethod.MuslimWorldLeague(),
  Egyptian: () => CalculationMethod.Egyptian(),
  Karachi: () => CalculationMethod.Karachi(),
  UmmAlQura: () => CalculationMethod.UmmAlQura(),
  Dubai: () => CalculationMethod.Dubai(),
  MoonsightingCommittee: () => CalculationMethod.MoonsightingCommittee(),
  NorthAmerica: () => CalculationMethod.NorthAmerica(),
  Kuwait: () => CalculationMethod.Kuwait(),
  Qatar: () => CalculationMethod.Qatar(),
  Singapore: () => CalculationMethod.Singapore(),
  Tehran: () => CalculationMethod.Tehran(),
  Turkey: () => CalculationMethod.Turkey(),
};

function getCalculationParameters(method: CalcMethodType): CalculationParameters {
  return METHOD_PARAMETERS[method]();
}

/**
 * Twilight angles for a calculation method, in degrees below the horizon, from
 * the same parameter table `calculatePrayerTimes` uses — so the globe's drawn
 * rings and the actual computed times can't drift apart.
 *
 * `isha` is null for the interval-based methods (Umm al-Qura, Qatar), where
 * Isha is Maghrib plus a fixed number of minutes and no solar angle exists.
 * Those return that interval instead, in minutes, which is enough to place
 * Isha on the globe: it is the terminator as it stood that many minutes ago.
 */
export function twilightAnglesFor(method: CalcMethodType): {
  fajr: number;
  isha: number | null;
  ishaIntervalMin: number | null;
} {
  const params = getCalculationParameters(method);
  const interval = params.ishaInterval > 0 ? params.ishaInterval : null;
  const isha = interval !== null || params.ishaAngle <= 0 ? null : params.ishaAngle;
  return { fajr: params.fajrAngle, isha, ishaIntervalMin: interval };
}

/**
 * Asr shadow factor: how many times an object's length its shadow must reach,
 * beyond its noon length. 1 is the standard (Shafi'i) rule, 2 is Hanafi.
 */
export function asrShadowFactor(asrCalc: AsrCalculation): number {
  return asrCalc === 'Hanafi' ? 2 : 1;
}

/**
 * Prayers that don't occur at extreme latitudes arrive from adhan as Invalid
 * Date (midnight sun / polar night). Anything that renders or compares a prayer
 * time has to check this first: every comparison against NaN is false, so an
 * invalid time slips through `time <= now` guards and ends up rendered as a
 * countdown to nothing.
 */
export function isValidPrayerTime(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

// Resolve the device's current IANA timezone string
export function getTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function calculatePrayerTimes(
  coords: CoordsType,
  date: Date,
  method: CalcMethodType,
  asrCalc: AsrCalculation
): PrayerTimesData {
  const coordinates = new Coordinates(coords.latitude, coords.longitude);
  const params = getCalculationParameters(method);
  
  // Set Asr calculation method
  params.madhab = asrCalc === 'Hanafi' ? Madhab.Hanafi : Madhab.Shafi;

  const prayerTimes = new PrayerTimes(coordinates, date, params);
  
  // Calculate Sunnah times (Qiyam/Tahajjud)
  const sunnahTimes = new SunnahTimes(prayerTimes);

  const prayers: PrayerTime[] = [
    { name: 'fajr', label: PRAYER_LABELS.fajr, time: prayerTimes.fajr },
    { name: 'sunrise', label: PRAYER_LABELS.sunrise, time: prayerTimes.sunrise, isOptional: true },
    { name: 'dhuhr', label: PRAYER_LABELS.dhuhr, time: prayerTimes.dhuhr },
    { name: 'asr', label: PRAYER_LABELS.asr, time: prayerTimes.asr },
    { name: 'maghrib', label: PRAYER_LABELS.maghrib, time: prayerTimes.maghrib },
    { name: 'isha', label: PRAYER_LABELS.isha, time: prayerTimes.isha },
    // Sunnah/Optional prayers (night prayers - shown after Isha)
    { name: 'middleOfNight', label: PRAYER_LABELS.middleOfNight, time: sunnahTimes.middleOfTheNight, isOptional: true },
    { name: 'lastThirdOfNight', label: PRAYER_LABELS.lastThirdOfNight, time: sunnahTimes.lastThirdOfTheNight, isOptional: true },
  ];

  const sunnahTimesData: SunnahTimesData = {
    middleOfTheNight: sunnahTimes.middleOfTheNight,
    lastThirdOfTheNight: sunnahTimes.lastThirdOfTheNight,
  };

  // Resolved against `date`, not the wall clock. Called bare, adhan defaults
  // both to `new Date()`, which mixed two clocks inside one function: the
  // `> date.getTime()` future guard below compared a wall-clock answer against
  // a caller-supplied instant, and a pair like "current = Sunrise, next = Fajr
  // tomorrow" could come back for a date in the middle of the afternoon.
  const currentPrayerEnum = prayerTimes.currentPrayer(date);
  const nextPrayerEnum = prayerTimes.nextPrayer(date);

  const prayerEnumToName = (p: typeof Prayer[keyof typeof Prayer]): PrayerName | null => {
    switch (p) {
      case Prayer.Fajr: return 'fajr';
      case Prayer.Sunrise: return 'sunrise';
      case Prayer.Dhuhr: return 'dhuhr';
      case Prayer.Asr: return 'asr';
      case Prayer.Maghrib: return 'maghrib';
      case Prayer.Isha: return 'isha';
      default: return null;
    }
  };

  // At extreme latitudes adhan returns Invalid Date for prayers that don't
  // occur (midnight sun / polar night) — yet nextPrayer() can still name one
  // of them. Resolve current/next only against prayers with real times so the
  // countdown never renders NaN.
  const currentPrayerName = prayerEnumToName(currentPrayerEnum);
  const currentPrayer =
    currentPrayerName && isValidPrayerTime(prayerTimes[currentPrayerName]) ? currentPrayerName : null;

  const CORE_ORDER: PrayerName[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const nextValidIn = (times: PrayerTimes, after: Date): { name: PrayerName; time: Date } | null => {
    let best: { name: PrayerName; time: Date } | null = null;
    for (const name of CORE_ORDER) {
      const time = times[name];
      if (isValidPrayerTime(time) && time.getTime() > after.getTime() && (!best || time < best.time)) {
        best = { name, time };
      }
    }
    return best;
  };

  const adhanNextName = prayerEnumToName(nextPrayerEnum);
  const adhanNextTime = adhanNextName ? prayerTimes.timeForPrayer(nextPrayerEnum) : null;

  let next: { name: PrayerName; time: Date } | null = null;
  // Also require a future time: once every prayer today has passed, adhan
  // wraps to Fajr but timeForPrayer still returns this morning's (past) one.
  if (adhanNextName && adhanNextTime && isValidPrayerTime(adhanNextTime) && adhanNextTime.getTime() > date.getTime()) {
    next = { name: adhanNextName, time: adhanNextTime };
  } else {
    // Nothing valid left today (after Isha, or every remaining time invalid):
    // take the first valid prayer of tomorrow.
    next = nextValidIn(prayerTimes, date);
    if (!next) {
      const tomorrow = new Date(date);
      tomorrow.setDate(tomorrow.getDate() + 1);
      next = nextValidIn(new PrayerTimes(coordinates, tomorrow, params), date);
    }
  }

  return {
    prayers,
    sunnahTimes: sunnahTimesData,
    currentPrayer,
    nextPrayer: next?.name ?? null,
    nextPrayerTime: next?.time ?? null,
  };
}

export function calculateQiblaDirection(coords: CoordsType): number {
  const coordinates = new Coordinates(coords.latitude, coords.longitude);
  return Qibla(coordinates);
}

export function formatTime(date: Date): string {
  // Prayers that don't occur at extreme latitudes arrive as Invalid Date.
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function getTimeUntil(targetTime: Date): {
  hours: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
} {
  const now = new Date();
  const diff = targetTime.getTime() - now.getTime();

  // NaN (invalid target) or already passed: no countdown to show.
  if (!Number.isFinite(diff) || diff <= 0) {
    return { hours: 0, minutes: 0, seconds: 0, totalSeconds: 0 };
  }

  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { hours, minutes, seconds, totalSeconds };
}

export const CALCULATION_METHODS: { value: CalcMethodType; label: string; description: string }[] = [
  { value: 'NorthAmerica', label: 'ISNA', description: 'Islamic Society of North America' },
  { value: 'MuslimWorldLeague', label: 'MWL', description: 'Muslim World League' },
  { value: 'Egyptian', label: 'Egyptian', description: 'Egyptian General Authority' },
  { value: 'UmmAlQura', label: 'Umm Al-Qura', description: 'Umm Al-Qura University, Makkah' },
  { value: 'Dubai', label: 'Dubai', description: 'UAE' },
  { value: 'Karachi', label: 'Karachi', description: 'University of Islamic Sciences, Karachi' },
  { value: 'Kuwait', label: 'Kuwait', description: 'Kuwait' },
  { value: 'Qatar', label: 'Qatar', description: 'Qatar' },
  { value: 'Singapore', label: 'Singapore', description: 'Singapore' },
  { value: 'Tehran', label: 'Tehran', description: 'Institute of Geophysics, Tehran' },
  { value: 'Turkey', label: 'Turkey', description: 'Diyanet, Turkey' },
  { value: 'MoonsightingCommittee', label: 'Moonsighting', description: 'Moonsighting Committee' },
];

export { PRAYER_LABELS };