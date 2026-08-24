import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { Preferences } from '@capacitor/preferences';
import type { Settings, CalculationMethod, AsrCalculation, PrayerName, OptionalPrayersSettings, PrayerNotificationSettings, NotificationSound, JumuahSettings, SurahKahfSettings, TravelSettings, DisplaySettings, AthanSettings, SavedLocation, DesignStyle } from '../types';

const SETTINGS_KEY = 'ontime_settings';

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
  homeView: 'list',
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
  updateAthan: (updates: Partial<AthanSettings>) => void;
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

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  // Save settings whenever they change
  useEffect(() => {
    if (!isLoading) {
      saveSettings(settings);
    }
  }, [settings, isLoading]);

  async function loadSettings() {
    try {
      const { value } = await Preferences.get({ key: SETTINGS_KEY });
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
        
        // Deep merge to handle new settings fields
        setSettings({
          ...defaultSettings,
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
          homeView: parsed.homeView === 'globe' ? 'globe' : 'list',
        });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setIsLoading(false);
    }
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

  const updateAthan = useCallback((updates: Partial<AthanSettings>) => {
    setSettings((prev) => ({
      ...prev,
      athan: {
        ...prev.athan,
        ...updates,
      },
    }));
  }, []);

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