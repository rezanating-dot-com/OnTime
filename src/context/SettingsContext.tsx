import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { Preferences } from '@capacitor/preferences';
import type { Settings, CalculationMethod, AsrCalculation, PrayerName, OptionalPrayersSettings, PrayerNotificationSettings, NotificationSound, JumuahSettings, SurahKahfSettings, TravelSettings, DisplaySettings, AthanSettings, SavedLocation, DesignStyle } from '../types';

const SETTINGS_KEY = 'ontime_settings';

// A rejected read leaves us holding defaults that are not what's on disk, so
// persisting them would overwrite the user's profile. Cold-start bridge failures
// are transient, so retry briefly before giving up and staying read-only.
const LOAD_RETRIES = 2;
const LOAD_RETRY_DELAY_MS = 400;

const defaultPrayerNotification: PrayerNotificationSettings = {
  enabled: true,
  reminderMinutes: 15,
  atPrayerTime: true,
  sound: 'default',
};

const defaultJumuahSettings: JumuahSettings = {
  enabled: false,
  masjidName: '',
  times: [{ khutbah: '13:00', iqamah: '13:30' }],
  reminderMinutes: 30,
};

const defaultDisplaySettings: DisplaySettings = {
  showCurrentPrayer: true,
  showNextPrayer: true,
  showSunnahCard: true,
  hijriOffset: 0,
};

export const defaultAthanSettings: AthanSettings = {
  downloadedAthans: [],
  selectedAthanId: null,
  selectedFajrAthanId: null,
  currentChannelId: null,
  currentFajrChannelId: null,
};

export const defaultSurahKahfSettings: SurahKahfSettings = {
  enabled: false,
  repeatIntervalHours: 0,
};

export const defaultTravelSettings: TravelSettings = {
  enabled: false,
  homeBase: null,
  override: 'auto',
  distanceThresholdKm: 88.7,
  jamaDhuhrAsr: false,
  jamaMaghribIsha: false,
  maxTravelDays: 0,
  travelStartDate: null,
  autoConfirmed: false,
  promptDismissed: false,
  offerSuppressed: false,
};

const defaultSettings: Settings = {
  calculationMethod: 'NorthAmerica', // ISNA
  asrCalculation: 'Standard',
  optionalPrayers: {
    showSunrise: true,
    showMiddleOfNight: true,
    showLastThirdOfNight: true,
  },
  notifications: {
    enabled: true,
    defaultSound: 'default',
    defaultReminderMinutes: 15,
    prayers: {
      fajr: { ...defaultPrayerNotification, sound: 'adhan_fajr' },
      sunrise: { ...defaultPrayerNotification, enabled: false },
      dhuhr: { ...defaultPrayerNotification },
      asr: { ...defaultPrayerNotification },
      maghrib: { ...defaultPrayerNotification },
      isha: { ...defaultPrayerNotification },
    },
  },
  jumuah: defaultJumuahSettings,
  travel: defaultTravelSettings,
  display: defaultDisplaySettings,
  athan: defaultAthanSettings,
  surahKahf: defaultSurahKahfSettings,
  previousLocations: [],
  distanceUnit: 'miles',
  designStyle: 'classic',
  homeView: 'globe',
};

interface SettingsContextType {
  settings: Settings;
  updateCalculationMethod: (method: CalculationMethod) => void;
  updateAsrCalculation: (method: AsrCalculation) => void;
  updateOptionalPrayers: (key: keyof OptionalPrayersSettings, value: boolean) => void;
  updateNotifications: (enabled: boolean) => void;
  updateDefaultSound: (sound: NotificationSound) => void;
  updateDefaultReminderMinutes: (minutes: number) => void;
  updatePrayerNotification: (prayer: PrayerName, updates: Partial<PrayerNotificationSettings>) => void;
  updateJumuah: (updates: Partial<JumuahSettings>) => void;
  updateTravel: (updates: Partial<TravelSettings>) => void;
  updateSurahKahf: (updates: Partial<SurahKahfSettings>) => void;
  updateDisplay: (updates: Partial<DisplaySettings>) => void;
  updateAthan: (
    updates: Partial<AthanSettings> | ((prev: AthanSettings) => Partial<AthanSettings>),
  ) => void;
  updateDistanceUnit: (unit: 'miles' | 'km') => void;
  updateDesignStyle: (style: DesignStyle) => void;
  updateHomeView: (view: 'globe' | 'list') => void;
  addPreviousLocation: (loc: SavedLocation) => void;
  removePreviousLocation: (index: number) => void;
  isLoading: boolean;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  // Unlocked only once a read has actually succeeded. Until then "defaults" and
  // "the user's real settings we failed to load" are indistinguishable, and
  // writing would silently erase their profile.
  const [canSave, setCanSave] = useState(false);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  // Save settings whenever they change
  useEffect(() => {
    if (canSave) {
      saveSettings(settings);
    }
  }, [settings, canSave]);

  async function loadSettings() {
    let value: string | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        ({ value } = await Preferences.get({ key: SETTINGS_KEY }));
        break;
      } catch (error) {
        // The read itself failed, so the on-disk profile is unknown and saving
        // the defaults we are holding would overwrite it. Cold-start bridge
        // failures are transient, so retry briefly — and if it never succeeds,
        // give up read-only rather than destroy data we could not load.
        console.error('Failed to read settings:', error);
        if (attempt >= LOAD_RETRIES) {
          setIsLoading(false);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, LOAD_RETRY_DELAY_MS));
      }
    }

    try {
      if (value) {
        const parsed = JSON.parse(value);
        
        // Handle migration from old format (where prayers were booleans)
        const migratedPrayers = { ...defaultSettings.notifications.prayers };
        if (parsed.notifications?.prayers) {
          for (const prayer of Object.keys(defaultSettings.notifications.prayers) as PrayerName[]) {
            const prayerSetting = parsed.notifications.prayers[prayer];
            if (typeof prayerSetting === 'boolean') {
              // Migrate from old boolean format
              migratedPrayers[prayer] = {
                ...defaultSettings.notifications.prayers[prayer],
                enabled: prayerSetting,
              };
            } else if (prayerSetting && typeof prayerSetting === 'object') {
              // New format - merge with defaults
              migratedPrayers[prayer] = {
                ...defaultSettings.notifications.prayers[prayer],
                ...prayerSetting,
              };
            }
          }
        }
        
        // Deep merge to handle new settings fields. Functional, and layered
        // over whatever is already in state rather than over the raw defaults:
        // a plain setSettings discards any update issued before the load
        // resolves. Not reachable today — the only pre-load writers are
        // TravelContext's guarded reset and user-paced onboarding — but any
        // future auto-write on launch would inherit the loss.
        setSettings((current) => ({
          ...current,
          ...parsed,
          optionalPrayers: {
            ...defaultSettings.optionalPrayers,
            ...parsed.optionalPrayers,
          },
          notifications: {
            ...defaultSettings.notifications,
            ...parsed.notifications,
            prayers: migratedPrayers,
          },
          jumuah: {
            ...defaultJumuahSettings,
            ...parsed.jumuah,
          },
          travel: {
            ...defaultTravelSettings,
            ...parsed.travel,
          },
          display: {
            ...defaultDisplaySettings,
            ...parsed.display,
          },
          athan: {
            ...defaultAthanSettings,
            ...parsed.athan,
          },
          surahKahf: {
            ...defaultSurahKahfSettings,
            enabled: parsed.surahKahf?.enabled ?? defaultSurahKahfSettings.enabled,
            repeatIntervalHours: parsed.surahKahf?.repeatIntervalHours ?? defaultSurahKahfSettings.repeatIntervalHours,
          },
          previousLocations: parsed.previousLocations || [],
          distanceUnit: parsed.distanceUnit || 'miles',
          designStyle: parsed.designStyle || 'classic',
          // Only an explicit 'list' keeps the list: the globe is the default, so
          // a missing or unrecognised value falls to it. Reading it this way
          // round is what makes the choice sticky — a user who picked the list
          // keeps the list, while everyone who never chose gets the globe.
          homeView: parsed.homeView === 'list' ? 'list' : 'globe',
        }));
      }
    } catch (error) {
      // Absent or unparseable data: the read itself succeeded, so there is no
      // intact profile left to protect and defaults are safe to persist.
      console.error('Failed to parse saved settings:', error);
    }
    setCanSave(true);
    setIsLoading(false);
  }

  async function saveSettings(newSettings: Settings) {
    try {
      await Preferences.set({
        key: SETTINGS_KEY,
        value: JSON.stringify(newSettings),
      });
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }

  const updateCalculationMethod = useCallback((method: CalculationMethod) => {
    setSettings((prev) => ({ ...prev, calculationMethod: method }));
  }, []);

  const updateAsrCalculation = useCallback((method: AsrCalculation) => {
    setSettings((prev) => ({ ...prev, asrCalculation: method }));
  }, []);

  const updateOptionalPrayers = useCallback((key: keyof OptionalPrayersSettings, value: boolean) => {
    setSettings((prev) => ({
      ...prev,
      optionalPrayers: { ...prev.optionalPrayers, [key]: value },
    }));
  }, []);

  const updateNotifications = useCallback((enabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, enabled },
    }));
  }, []);

  const updateDefaultSound = useCallback((sound: NotificationSound) => {
    setSettings((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, defaultSound: sound },
    }));
  }, []);

  const updateDefaultReminderMinutes = useCallback((minutes: number) => {
    setSettings((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, defaultReminderMinutes: minutes },
    }));
  }, []);

  const updatePrayerNotification = useCallback((prayer: PrayerName, updates: Partial<PrayerNotificationSettings>) => {
    setSettings((prev) => ({
      ...prev,
      notifications: {
        ...prev.notifications,
        prayers: {
          ...prev.notifications.prayers,
          [prayer]: {
            ...prev.notifications.prayers[prayer],
            ...updates,
          },
        },
      },
    }));
  }, []);

  const updateJumuah = useCallback((updates: Partial<JumuahSettings>) => {
    setSettings((prev) => ({
      ...prev,
      jumuah: {
        ...prev.jumuah,
        ...updates,
      },
    }));
  }, []);

  const updateTravel = useCallback((updates: Partial<TravelSettings>) => {
    setSettings((prev) => ({
      ...prev,
      travel: {
        ...prev.travel,
        ...updates,
      },
    }));
  }, []);

  const updateSurahKahf = useCallback((updates: Partial<SurahKahfSettings>) => {
    setSettings((prev) => ({
      ...prev,
      surahKahf: {
        ...prev.surahKahf,
        ...updates,
      },
    }));
  }, []);

  const updateDisplay = useCallback((updates: Partial<DisplaySettings>) => {
    setSettings((prev) => ({
      ...prev,
      display: {
        ...prev.display,
        ...updates,
      },
    }));
  }, []);

  const updateAthan = useCallback(
    (updates: Partial<AthanSettings> | ((prev: AthanSettings) => Partial<AthanSettings>)) => {
      setSettings((prev) => ({
        ...prev,
        athan: {
          ...prev.athan,
          // The functional form matters for anything derived from the current
          // athan list: building `[...settings.athan.downloadedAthans, file]`
          // at the call site captures the array as it was when that callback
          // was created, so two downloads finishing together each append to
          // the same pre-first snapshot and one entry is lost.
          ...(typeof updates === 'function' ? updates(prev.athan) : updates),
        },
      }));
    },
    [],
  );

  const updateDistanceUnit = useCallback((unit: 'miles' | 'km') => {
    setSettings((prev) => ({ ...prev, distanceUnit: unit }));
  }, []);

  const updateDesignStyle = useCallback((style: DesignStyle) => {
    setSettings((prev) => ({ ...prev, designStyle: style }));
  }, []);

  const updateHomeView = useCallback((view: 'globe' | 'list') => {
    setSettings((prev) => ({ ...prev, homeView: view }));
  }, []);

  const addPreviousLocation = useCallback((loc: SavedLocation) => {
    setSettings((prev) => {
      // Don't add duplicates (same city name and close coordinates)
      const isDuplicate = prev.previousLocations.some(
        (p) => p.cityName === loc.cityName &&
          Math.abs(p.coordinates.latitude - loc.coordinates.latitude) < 0.01 &&
          Math.abs(p.coordinates.longitude - loc.coordinates.longitude) < 0.01
      );
      if (isDuplicate) return prev;
      // Keep max 20 previous locations
      const updated = [loc, ...prev.previousLocations].slice(0, 20);
      return { ...prev, previousLocations: updated };
    });
  }, []);

  const removePreviousLocation = useCallback((index: number) => {
    setSettings((prev) => ({
      ...prev,
      previousLocations: prev.previousLocations.filter((_, i) => i !== index),
    }));
  }, []);

  const contextValue = useMemo(() => ({
    settings,
    updateCalculationMethod,
    updateAsrCalculation,
    updateOptionalPrayers,
    updateNotifications,
    updateDefaultSound,
    updateDefaultReminderMinutes,
    updatePrayerNotification,
    updateJumuah,
    updateTravel,
    updateSurahKahf,
    updateDisplay,
    updateAthan,
    updateDistanceUnit,
    updateDesignStyle,
    updateHomeView,
    addPreviousLocation,
    removePreviousLocation,
    isLoading,
  }), [
    settings,
    isLoading,
    updateCalculationMethod,
    updateAsrCalculation,
    updateOptionalPrayers,
    updateNotifications,
    updateDefaultSound,
    updateDefaultReminderMinutes,
    updatePrayerNotification,
    updateJumuah,
    updateTravel,
    updateSurahKahf,
    updateDisplay,
    updateAthan,
    updateDistanceUnit,
    updateDesignStyle,
    updateHomeView,
    addPreviousLocation,
    removePreviousLocation,
  ]);

  return (
    <SettingsContext.Provider value={contextValue}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}