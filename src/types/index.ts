// Core 5 prayers + sunrise
export type PrayerName = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

// Optional/Sunnah prayers
export type OptionalPrayerName = 'middleOfNight' | 'lastThirdOfNight' | 'tahajjud';

// All prayer types combined
export type AllPrayerNames = PrayerName | OptionalPrayerName;

// Notification categories for scoped cancellation
export type NotificationCategory = 'prayer' | 'jumuah' | 'kahf' | 'reminder';

export interface PrayerTime {
  name: AllPrayerNames;
  label: string;
  time: Date;
  isOptional?: boolean;
}

export interface SunnahTimesData {
  middleOfTheNight: Date;
  lastThirdOfTheNight: Date;
}

export interface PrayerTimesData {
  prayers: PrayerTime[];
  sunnahTimes: SunnahTimesData | null;
  currentPrayer: PrayerName | null;
  nextPrayer: PrayerName | null;
  nextPrayerTime: Date | null;
}

export type CalculationMethod = 
  | 'MuslimWorldLeague'
  | 'Egyptian'
  | 'Karachi'
  | 'UmmAlQura'
  | 'Dubai'
  | 'MoonsightingCommittee'
  | 'NorthAmerica' // ISNA
  | 'Kuwait'
  | 'Qatar'
  | 'Singapore'
  | 'Tehran'
  | 'Turkey';

export type AsrCalculation = 'Standard' | 'Hanafi';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface LocationData {
  coordinates: Coordinates;
  /** Full display name, e.g. "Meade Boulevard, North Aurora". */
  cityName: string;
  /**
   * Just the settlement, e.g. "North Aurora". For places where the full name
   * is too long to fit, such as the label on the qibla globe. Absent on
   * locations saved before this field existed.
   */
  shortName?: string;
  countryCode?: string;
}

export interface OptionalPrayersSettings {
  showSunrise: boolean;
  showMiddleOfNight: boolean;
  showLastThirdOfNight: boolean;
}

// Built-in sounds + downloaded athan IDs (prefixed with 'athan:')
export type NotificationSound = 'default' | 'adhan' | 'adhan_fajr' | 'silent' | string;

export interface PrayerNotificationSettings {
  enabled: boolean;
  reminderMinutes: number; // Minutes before prayer (0 = disabled)
  atPrayerTime: boolean;   // Notify exactly at prayer time
  sound: NotificationSound;
}

export interface NotificationSettings {
  enabled: boolean;
  defaultSound: NotificationSound;
  defaultReminderMinutes: number;
  prayers: Record<PrayerName, PrayerNotificationSettings>;
}

export interface JumuahTime {
  khutbah: string;  // Time string "HH:MM" format
  iqamah: string;   // Time string "HH:MM" format
}

export interface JumuahSettings {
  enabled: boolean;
  masjidName: string;
  times: JumuahTime[];  // Some masjids have multiple Jumuah
  reminderMinutes: number;  // Minutes before khutbah to remind
}

export interface HomeBaseLocation {
  coordinates: Coordinates;
  cityName: string;
  countryCode?: string;
}

export interface TravelSettings {
  enabled: boolean;
  homeBase: HomeBaseLocation | null;
  override: 'auto' | 'force_on' | 'force_off';
  distanceThresholdKm: number;       // default 88.7
  jamaDhuhrAsr: boolean;              // combine Dhuhr+Asr
  jamaMaghribIsha: boolean;           // combine Maghrib+Isha
  maxTravelDays: number;              // 4, 10, 15, or 0=unlimited
  travelStartDate: string | null;     // ISO date
  autoConfirmed: boolean;             // user confirmed current auto-detected trip
}

export interface TravelState {
  isTraveling: boolean;
  travelPending: boolean;
  distanceFromHomeKm: number | null;
  isAutoDetected: boolean;
  qasr: { dhuhr: boolean; asr: boolean; isha: boolean };
  jamaDhuhrAsr: boolean;
  jamaMaghribIsha: boolean;
}

export interface DisplaySettings {
  showCurrentPrayer: boolean;
  showNextPrayer: boolean;
  showSunnahCard: boolean;
}

export interface SavedLocation {
  coordinates: Coordinates;
  cityName: string;
  countryCode?: string;
  savedAt: string; // ISO date
}

export interface SurahKahfSettings {
  enabled: boolean;
  repeatIntervalHours: number;    // 0 = no repeats (just Maghrib), 2/4/6 = remind every N hours until next Maghrib
}

export type DesignStyle = 'classic' | 'islamic';

export interface Settings {
  calculationMethod: CalculationMethod;
  asrCalculation: AsrCalculation;
  optionalPrayers: OptionalPrayersSettings;
  notifications: NotificationSettings;
  jumuah: JumuahSettings;
  travel: TravelSettings;
  display: DisplaySettings;
  athan: AthanSettings;
  surahKahf: SurahKahfSettings;
  previousLocations: SavedLocation[];
  distanceUnit: 'miles' | 'km';
  designStyle: DesignStyle;
  homeView: 'globe' | 'list';
}

export interface CityEntry {
  n: string;       // city name
  c: string;       // ISO country code
  a: string;       // admin/state/region
  lat: number;     // latitude
  lng: number;     // longitude
  p: number;       // population
}

export interface NotificationPreference {
  prayer: PrayerName;
  enabled: boolean;
  minutesBefore: number;
}

export interface AthanFile {
  id: string;
  muezzinName: string;
  title: string;
  filename: string;
  duration: string;
  sourceUrl: string;
  downloadedAt: string; // ISO date
}

export interface AthanCatalogEntry {
  muezzinName: string;
  title: string;
  duration: string;
  sourceUrl: string;
}

export interface AthanSettings {
  downloadedAthans: AthanFile[];
  selectedAthanId: string | null;
  selectedFajrAthanId: string | null;
  currentChannelId: string | null;
  currentFajrChannelId: string | null;
}