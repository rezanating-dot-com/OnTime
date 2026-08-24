import { useState, useEffect, useCallback, type MutableRefObject } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../context/ThemeContext';
import { useLocation } from '../context/LocationContext';
import { useTravel } from '../context/TravelContext';
import { CALCULATION_METHODS } from '../services/prayerService';
import { CitySearch } from './CitySearch';
import {
  fetchAthanCatalog,
  downloadAthan,
  deleteAthanFile,
  selectAthan,
  playAthanPreview,
  stopAthanPreview,
} from '../services/athanService';
import { AthanPlugin } from '../plugins/athanPlugin';
import { formatDistance } from '../utils/distance';
import type { CalculationMethod, PrayerName, NotificationSound, CityEntry, AthanCatalogEntry, AthanFile } from '../types';

type SettingsCategory = 'main' | 'location' | 'calculation' | 'appearance' | 'notifications' | 'notifications-prayers' | 'notifications-athan' | 'notifications-jumuah' | 'notifications-kahf' | 'travel' | 'about' | 'travel-home-search' | 'athan-catalog';

const PRAYER_LABELS: Record<PrayerName, string> = {
  fajr: 'Fajr',
  sunrise: 'Sunrise',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

const BUILT_IN_SOUND_OPTIONS: { value: NotificationSound; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'adhan', label: 'Adhan (Built-in)' },
  { value: 'adhan_fajr', label: 'Adhan Fajr (Built-in)' },
  { value: 'silent', label: 'Silent' },
];

const REMINDER_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBackRef?: MutableRefObject<(() => void) | null>;
}

export function SettingsModal({ isOpen, onClose, onBackRef }: SettingsModalProps) {
  const [category, setCategory] = useState<SettingsCategory>('main');
  
  const {
    settings,
    updateCalculationMethod,
    updateAsrCalculation,
    updateOptionalPrayers,
    updateNotifications,
    updatePrayerNotification,
    updateJumuah,
    updateSurahKahf,
    updateDisplay,
    updateAthan,
    updateDistanceUnit,
    updateDesignStyle,
    updateHomeView,
    addPreviousLocation,
    removePreviousLocation,
  } = useSettings();
  const { theme, setTheme } = useTheme();
  const { location, setManualLocation, getGPSLocation, error: locationError } = useLocation();
  const { travelState, setHomeBase, clearHomeBase, setTravelOverride, toggleJama, toggleTravelEnabled } = useTravel();
  const { updateTravel } = useSettings();

  const [locationMethod, setLocationMethod] = useState<'search' | 'gps' | 'manual' | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const [manualCity, setManualCity] = useState('');

  // Athan state
  const [catalog, setCatalog] = useState<AthanCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [useSeparateFajr, setUseSeparateFajr] = useState(
    settings.athan.selectedFajrAthanId !== null && settings.athan.selectedFajrAthanId !== settings.athan.selectedAthanId
  );

  // Stop preview on category change or modal close
  const stopPreview = useCallback(() => {
    if (previewingId) {
      stopAthanPreview().catch(() => {});
      setPreviewingId(null);
    }
  }, [previewingId]);

  useEffect(() => {
    return () => { stopPreview(); };
  }, [category, stopPreview]);

  useEffect(() => {
    if (!isOpen) stopPreview();
  }, [isOpen, stopPreview]);

  // Listen for preview complete
  useEffect(() => {
    let handle: ReturnType<typeof AthanPlugin.addListener> | null = null;
    handle = AthanPlugin.addListener('previewComplete', () => {
      setPreviewingId(null);
    });
    return () => { handle?.then(h => h.remove()); };
  }, []);

  // Auto-navigate back to hub if notifications get disabled while on a sub-page
  useEffect(() => {
    if (!settings.notifications.enabled && category.startsWith('notifications-')) {
      setCategory('notifications');
    }
  }, [settings.notifications.enabled, category]);

  const handleBack = useCallback(() => {
    if (category === 'main') {
      onClose();
      return;
    }
    if (category === 'travel-home-search') {
      setCategory('travel');
      return;
    }
    if (category === 'athan-catalog') {
      setCategory('notifications-athan');
      return;
    }
    if (category.startsWith('notifications-')) {
      setCategory('notifications');
      return;
    }
    setCategory('main');
  }, [category, onClose]);

  // Expose back handler to parent for hardware back button
  useEffect(() => {
    if (onBackRef) {
      onBackRef.current = isOpen ? handleBack : null;
    }
  }, [onBackRef, isOpen, handleBack]);

  if (!isOpen) return null;

  const handleSaveManualLocation = () => {
    const lat = parseFloat(manualLat);
    const lng = parseFloat(manualLng);

    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      setManualLocation(
        { latitude: lat, longitude: lng },
        manualCity || 'Custom Location'
      );
      setManualLat('');
      setManualLng('');
      setManualCity('');
    }
  };

  const handleClose = () => {
    setCategory('main');
    onClose();
  };

  // Get summary text for each category
  const getLocationSummary = () => location.cityName;
  const getCalculationSummary = () => {
    const method = CALCULATION_METHODS.find(m => m.value === settings.calculationMethod);
    return method?.label || settings.calculationMethod;
  };
  const getAppearanceSummary = () => {
    const themeLabels = { light: 'Light', dark: 'Dark', system: 'System', auto: 'Auto (Prayer)', desert: 'Desert', rose: 'Rose', forest: 'Forest', ocean: 'Ocean' };
    const designLabels = { classic: 'Classic', islamic: 'Islamic' };
    return `${themeLabels[theme]} \u00B7 ${designLabels[settings.designStyle] || 'Classic'}`;
  };
  const getJumuahSummary = () => {
    if (!settings.jumuah.enabled) return 'Off';
    return settings.jumuah.masjidName || 'Enabled';
  };
  const getNotificationsSummary = () => {
    if (!settings.notifications.enabled) return 'Off';
    const parts: string[] = [];
    const enabledCount = Object.values(settings.notifications.prayers).filter(p => p.enabled).length;
    parts.push(`${enabledCount} prayers`);
    if (settings.jumuah.enabled) parts.push("Jumu'ah");
    if (settings.surahKahf.enabled) parts.push('Kahf');
    return parts.join(', ');
  };
  const getAthanSummary = () => {
    const selected = settings.athan.downloadedAthans.find(a => a.id === settings.athan.selectedAthanId);
    if (selected) return selected.muezzinName;
    return 'Default';
  };
  const getSurahKahfSummary = () => {
    if (!settings.surahKahf.enabled) return 'Off';
    if (settings.surahKahf.repeatIntervalHours > 0) return `Every ${settings.surahKahf.repeatIntervalHours}h`;
    return 'At Maghrib';
  };
  const getTravelSummary = () => {
    if (!settings.travel.enabled) return 'Off';
    if (travelState.isTraveling) return 'Traveling';
    return 'Enabled';
  };

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] safe-area-top safe-area-bottom animate-slide-in flex flex-col">
      {/* Sticky Header */}
      <div className="flex-shrink-0 bg-[var(--color-background)] border-b border-[var(--color-border)]">
        <div className="max-w-lg mx-auto px-6 py-4 flex items-center justify-between">
          {category !== 'main' ? (
            <button
              onClick={handleBack}
              className="p-2 -ml-2 rounded-full hover:bg-[var(--color-card)] transition-colors flex items-center gap-2"
            >
              <svg className="w-5 h-5 text-[var(--color-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span className="text-[var(--color-text)] font-medium">Back</span>
            </button>
          ) : (
            <h2 className="text-xl font-semibold text-[var(--color-text)]">Settings</h2>
          )}
          <button
            onClick={handleClose}
            className="p-2 rounded-full hover:bg-[var(--color-card)] transition-colors"
          >
            <svg className="w-5 h-5 text-[var(--color-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-6 py-6 pb-10">

        {/* Main Categories List */}
        {category === 'main' && (
          <div className="flex flex-col gap-4">
            <CategoryItem
              icon={<LocationIcon />}
              title="Location"
              summary={getLocationSummary()}
              onClick={() => setCategory('location')}
            />
            <CategoryItem
              icon={<CalculationIcon />}
              title="Prayer Calculation"
              summary={getCalculationSummary()}
              onClick={() => setCategory('calculation')}
            />
            <CategoryItem
              icon={<AppearanceIcon />}
              title="Appearance"
              summary={getAppearanceSummary()}
              onClick={() => setCategory('appearance')}
            />
            <CategoryItem
              icon={<NotificationIcon />}
              title="Notifications"
              summary={getNotificationsSummary()}
              onClick={() => setCategory('notifications')}
            />
            <CategoryItem
              icon={<TravelIcon />}
              title="Travel Mode"
              summary={getTravelSummary()}
              onClick={() => setCategory('travel')}
            />
            <CategoryItem
              icon={<AboutIcon />}
              title="About"
              summary="v1.0.0"
              onClick={() => setCategory('about')}
            />
          </div>
        )}

        {/* Location Settings */}
        {category === 'location' && (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Location</h3>

            {/* Method Picker */}
            <div className="p-4 rounded-lg bg-[var(--color-card)]">
              <p className="text-sm text-[var(--color-muted)] mb-2">Set Location</p>
              <div className="flex gap-2">
                <ToggleButton
                  active={locationMethod === 'search'}
                  onClick={() => setLocationMethod(locationMethod === 'search' ? null : 'search')}
                >
                  Search
                </ToggleButton>
                <ToggleButton
                  active={locationMethod === 'gps'}
                  onClick={() => setLocationMethod(locationMethod === 'gps' ? null : 'gps')}
                >
                  Use GPS
                </ToggleButton>
                <ToggleButton
                  active={locationMethod === 'manual'}
                  onClick={() => setLocationMethod(locationMethod === 'manual' ? null : 'manual')}
                >
                  Coordinates
                </ToggleButton>
              </div>
            </div>

            {/* Travel mode info */}
            <div className="flex items-start gap-2.5 px-1">
              <svg className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                Setting a home location enables travel mode. When you're more than {formatDistance(settings.travel.distanceThresholdKm, settings.distanceUnit)} from home, prayers are automatically shortened (Qasr) per Islamic travel rulings.
              </p>
            </div>

            {/* GPS */}
            {locationMethod === 'gps' && (
              <div className="p-4 rounded-lg bg-[var(--color-card)] flex flex-col gap-3">
                <p className="text-sm text-[var(--color-muted)]">Detect your location using GPS</p>
                <button
                  onClick={async () => {
                    setGpsLoading(true);
                    setGpsError(null);
                    try {
                      const loc = await getGPSLocation();
                      setManualLocation(loc.coordinates, loc.cityName, loc.countryCode);
                      addPreviousLocation({
                        coordinates: loc.coordinates,
                        cityName: loc.cityName,
                        countryCode: loc.countryCode,
                        savedAt: new Date().toISOString(),
                      });
                      setLocationMethod(null);
                    } catch (err) {
                      setGpsError(err instanceof Error ? err.message : 'Failed to get location');
                    } finally {
                      setGpsLoading(false);
                    }
                  }}
                  disabled={gpsLoading}
                  className="w-full py-3 bg-[var(--color-primary)] text-white rounded-lg font-medium disabled:opacity-50"
                >
                  {gpsLoading ? 'Locating...' : 'Detect My Location'}
                </button>
                {gpsError && (
                  <p className="text-sm text-red-500">{gpsError}</p>
                )}
                {locationError && !gpsError && (
                  <p className="text-sm text-red-500">{locationError}</p>
                )}
              </div>
            )}

            {/* Search City */}
            {locationMethod === 'search' && (
              <CitySearch onSelect={(city: CityEntry) => {
                setManualLocation(
                  { latitude: city.lat, longitude: city.lng },
                  city.n,
                  city.c,
                );
                addPreviousLocation({
                  coordinates: { latitude: city.lat, longitude: city.lng },
                  cityName: city.n,
                  countryCode: city.c,
                  savedAt: new Date().toISOString(),
                });
                setLocationMethod(null);
              }} />
            )}

            {/* Manual Coordinates */}
            {locationMethod === 'manual' && (
              <div className="p-4 rounded-lg bg-[var(--color-card)] flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="City name (e.g., New York)"
                  value={manualCity}
                  onChange={(e) => setManualCity(e.target.value)}
                  className="w-full p-3 rounded-lg bg-[var(--color-background)] text-[var(--color-text)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
                <div className="flex gap-3">
                  <input
                    type="number"
                    placeholder="Latitude"
                    value={manualLat}
                    onChange={(e) => setManualLat(e.target.value)}
                    step="0.0001"
                    min="-90"
                    max="90"
                    className="flex-1 p-3 rounded-lg bg-[var(--color-background)] text-[var(--color-text)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  />
                  <input
                    type="number"
                    placeholder="Longitude"
                    value={manualLng}
                    onChange={(e) => setManualLng(e.target.value)}
                    step="0.0001"
                    min="-180"
                    max="180"
                    className="flex-1 p-3 rounded-lg bg-[var(--color-background)] text-[var(--color-text)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  />
                </div>
                <button
                  onClick={() => {
                    handleSaveManualLocation();
                    setLocationMethod(null);
                  }}
                  disabled={!manualLat || !manualLng}
                  className="w-full py-3 bg-[var(--color-primary)] text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Location
                </button>
              </div>
            )}

            {/* Previous Locations */}
            {settings.previousLocations.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-[var(--color-muted)] mb-2">Previous Locations</h4>
                <div className="rounded-lg bg-[var(--color-card)] overflow-hidden divide-y divide-[var(--color-border)]">
                  {settings.previousLocations.map((loc, index) => {
                    const isHome = settings.travel.homeBase?.cityName === loc.cityName &&
                      Math.abs((settings.travel.homeBase?.coordinates.latitude ?? 0) - loc.coordinates.latitude) < 0.01;
                    const isCurrent = location.cityName === loc.cityName &&
                      Math.abs(location.coordinates.latitude - loc.coordinates.latitude) < 0.01;
                    return (
                      <div key={`${loc.cityName}-${index}`} className="px-4 py-3 flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-medium truncate ${isCurrent ? 'text-[var(--color-primary)]' : 'text-[var(--color-text)]'}`}>
                              {loc.cityName}
                            </p>
                            {isHome && (
                              <span className="text-[10px] bg-[var(--color-primary)]/10 text-[var(--color-primary)] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">Home</span>
                            )}
                            {isCurrent && (
                              <span className="text-[10px] bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">Current</span>
                            )}
                          </div>
                          <p className="text-xs text-[var(--color-muted)]">
                            {loc.coordinates.latitude.toFixed(2)}, {loc.coordinates.longitude.toFixed(2)}
                            {loc.countryCode ? ` · ${loc.countryCode}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                          {/* Use as current location */}
                          {!isCurrent && (
                            <button
                              onClick={() => {
                                setManualLocation(loc.coordinates, loc.cityName, loc.countryCode);
                              }}
                              className="p-2 rounded-lg hover:bg-[var(--color-background)] transition-colors"
                              title="Use this location"
                            >
                              <svg className="w-4 h-4 text-[var(--color-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                              </svg>
                            </button>
                          )}
                          {/* See on map */}
                          <button
                            onClick={() => {
                              const label = encodeURIComponent(loc.cityName);
                              window.open(
                                `geo:${loc.coordinates.latitude},${loc.coordinates.longitude}?q=${loc.coordinates.latitude},${loc.coordinates.longitude}(${label})`,
                                '_system'
                              );
                            }}
                            className="p-2 rounded-lg hover:bg-[var(--color-background)] transition-colors"
                            title="See on map"
                          >
                            <svg className="w-4 h-4 text-[var(--color-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
                            </svg>
                          </button>
                          {/* Set as home */}
                          {!isHome && (
                            <button
                              onClick={() => {
                                setHomeBase({
                                  coordinates: loc.coordinates,
                                  cityName: loc.cityName,
                                  countryCode: loc.countryCode,
                                });
                                if (!settings.travel.enabled) {
                                  toggleTravelEnabled();
                                }
                              }}
                              className="p-2 rounded-lg hover:bg-[var(--color-background)] transition-colors"
                              title="Set as home"
                            >
                              <svg className="w-4 h-4 text-[var(--color-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                              </svg>
                            </button>
                          )}
                          {/* Delete */}
                          <button
                            onClick={() => removePreviousLocation(index)}
                            className="p-2 rounded-lg hover:bg-red-500/10 transition-colors"
                            title="Remove"
                          >
                            <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Calculation Settings */}
        {category === 'calculation' && (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Prayer Calculation</h3>
            
            {/* Calculation Method */}
            <div>
              <label className="block text-sm text-[var(--color-muted)] mb-2">Calculation Method</label>
              <select
                value={settings.calculationMethod}
                onChange={(e) => updateCalculationMethod(e.target.value as CalculationMethod)}
                className="w-full p-3 rounded-lg bg-[var(--color-card)] text-[var(--color-text)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              >
                {CALCULATION_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label} - {method.description}
                  </option>
                ))}
              </select>
            </div>

            {/* Asr Calculation */}
            <div>
              <label className="block text-sm text-[var(--color-muted)] mb-2">Asr Calculation</label>
              <div className="flex gap-2">
                <ToggleButton
                  active={settings.asrCalculation === 'Standard'}
                  onClick={() => updateAsrCalculation('Standard')}
                >
                  Standard (Shafi'i)
                </ToggleButton>
                <ToggleButton
                  active={settings.asrCalculation === 'Hanafi'}
                  onClick={() => updateAsrCalculation('Hanafi')}
                >
                  Hanafi
                </ToggleButton>
              </div>
            </div>

            {/* Additional Times */}
            <div>
              <label className="block text-sm text-[var(--color-muted)] mb-2">Additional Times</label>
              <div className="flex flex-col gap-2">
                <ToggleRow
                  label="Sunrise"
                  description="Ishraq prayer time"
                  checked={settings.optionalPrayers.showSunrise}
                  onChange={(checked) => updateOptionalPrayers('showSunrise', checked)}
                />
                <ToggleRow
                  label="Middle of Night"
                  description="Halfway between Maghrib and Fajr"
                  checked={settings.optionalPrayers.showMiddleOfNight}
                  onChange={(checked) => updateOptionalPrayers('showMiddleOfNight', checked)}
                />
                <ToggleRow
                  label="Last Third of Night"
                  description="Optimal time for Tahajjud/Qiyam"
                  checked={settings.optionalPrayers.showLastThirdOfNight}
                  onChange={(checked) => updateOptionalPrayers('showLastThirdOfNight', checked)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Appearance Settings */}
        {category === 'appearance' && (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Appearance</h3>
            
            <div>
              <label className="block text-sm text-[var(--color-muted)] mb-2">Theme</label>
              <div className="grid grid-cols-3 gap-2">
                <ThemeOption
                  active={theme === 'light'}
                  onClick={() => setTheme('light')}
                  label="Light"
                  swatches={['#F5F6F8', '#FFFFFF', '#4361EE', '#E2E5EB']}
                  colors={{ bg: '#FFFFFF', text: '#111318', border: '#E2E5EB', primary: '#4361EE' }}
                />
                <ThemeOption
                  active={theme === 'dark'}
                  onClick={() => setTheme('dark')}
                  label="Dark"
                  swatches={['#0A0C10', '#16181D', '#6B8AFF', '#2A2E38']}
                  colors={{ bg: '#16181D', text: '#F5F6F8', border: '#2A2E38', primary: '#6B8AFF' }}
                />
                <ThemeOption
                  active={theme === 'desert'}
                  onClick={() => setTheme('desert')}
                  label="Desert"
                  swatches={['#1C1510', '#2A2018', '#C8954C', '#3D3024']}
                  colors={{ bg: '#2A2018', text: '#F2E8D9', border: '#3D3024', primary: '#C8954C' }}
                />
                <ThemeOption
                  active={theme === 'rose'}
                  onClick={() => setTheme('rose')}
                  label="Rose"
                  swatches={['#160D14', '#241A22', '#D4619C', '#3A2836']}
                  colors={{ bg: '#241A22', text: '#F5EAF0', border: '#3A2836', primary: '#D4619C' }}
                />
                <ThemeOption
                  active={theme === 'forest'}
                  onClick={() => setTheme('forest')}
                  label="Forest"
                  swatches={['#0C1510', '#162118', '#4CAF6A', '#253D2C']}
                  colors={{ bg: '#162118', text: '#E8F2EC', border: '#253D2C', primary: '#4CAF6A' }}
                />
                <ThemeOption
                  active={theme === 'ocean'}
                  onClick={() => setTheme('ocean')}
                  label="Ocean"
                  swatches={['#0A1018', '#141E2C', '#4A9EC8', '#1E3348']}
                  colors={{ bg: '#141E2C', text: '#E4EEF5', border: '#1E3348', primary: '#4A9EC8' }}
                />
                <ThemeOption
                  active={theme === 'system'}
                  onClick={() => setTheme('system')}
                  label="System"
                  description="Match your device"
                  colors={{ bg: '#16181D', text: '#F5F6F8', border: '#2A2E38', primary: '#6B8AFF' }}
                />
                <ThemeOption
                  active={theme === 'auto'}
                  onClick={() => setTheme('auto')}
                  label="Auto"
                  description="Follows prayer times"
                  colors={{ bg: '#16181D', text: '#F5F6F8', border: '#2A2E38', primary: '#6B8AFF' }}
                />
              </div>
              {theme === 'auto' && (
                <p className="text-sm text-[var(--color-muted)] mt-3">
                  Dark mode activates after Maghrib, light mode returns after Fajr
                </p>
              )}
            </div>

            {/* Design Style */}
            <div>
              <label className="block text-sm text-[var(--color-muted)] mb-2">Design Style</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => updateDesignStyle('classic')}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    settings.designStyle === 'classic'
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                      : 'border-[var(--color-border)] bg-[var(--color-card)]'
                  }`}
                >
                  <div className="text-sm font-medium text-[var(--color-text)]">Classic</div>
                  <div className="text-xs text-[var(--color-muted)] mt-0.5">Clean, utilitarian</div>
                </button>
                <button
                  onClick={() => updateDesignStyle('islamic')}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    settings.designStyle === 'islamic'
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                      : 'border-[var(--color-border)] bg-[var(--color-card)]'
                  }`}
                >
                  <div className="text-sm font-medium text-[var(--color-text)]">Islamic</div>
                  <div className="text-xs text-[var(--color-muted)] mt-0.5">Geometric patterns, Arabic</div>
                </button>
              </div>
            </div>

            {/* Home View */}
            <div>
              <label className="block text-sm text-[var(--color-muted)] mb-2">Home View</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => updateHomeView('globe')}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    settings.homeView === 'globe'
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                      : 'border-[var(--color-border)] bg-[var(--color-card)]'
                  }`}
                >
                  <div className="text-sm font-medium text-[var(--color-text)]">Globe</div>
                  <div className="text-xs text-[var(--color-muted)] mt-0.5">Immersive full-page view</div>
                </button>
                <button
                  onClick={() => updateHomeView('list')}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    settings.homeView === 'list'
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                      : 'border-[var(--color-border)] bg-[var(--color-card)]'
                  }`}
                >
                  <div className="text-sm font-medium text-[var(--color-text)]">List</div>
                  <div className="text-xs text-[var(--color-muted)] mt-0.5">Today's dashboard</div>
                </button>
              </div>
            </div>

            {/* Display Cards */}
            <div>
              <label className="block text-sm text-[var(--color-muted)] mb-2">Display Cards</label>
              <div className="flex flex-col gap-2">
                <ToggleRow
                  label="Current Prayer"
                  description="Show current prayer with time remaining"
                  checked={settings.display.showCurrentPrayer}
                  onChange={(v) => updateDisplay({ showCurrentPrayer: v })}
                />
                <ToggleRow
                  label="Next Prayer"
                  description="Show next prayer countdown"
                  checked={settings.display.showNextPrayer}
                  onChange={(v) => updateDisplay({ showNextPrayer: v })}
                />
                <ToggleRow
                  label="Sunnah Prayers"
                  description="Show sunnah/rawatib prayer info"
                  checked={settings.display.showSunnahCard}
                  onChange={(v) => updateDisplay({ showSunnahCard: v })}
                />
              </div>
            </div>
          </div>
        )}

        {/* Jumuah Settings */}
        {category === 'notifications-jumuah' && (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Jumu'ah (Friday Prayer)</h3>
            
            <ToggleRow
              label="Enable Jumu'ah Reminder"
              description="Get notified before Friday prayer"
              checked={settings.jumuah.enabled}
              onChange={(checked) => updateJumuah({ enabled: checked })}
            />
            
            {settings.jumuah.enabled && (
              <>
                {/* Masjid Name */}
                <div className="p-4 rounded-lg bg-[var(--color-card)]">
                  <label className="block text-sm text-[var(--color-muted)] mb-2">Masjid Name</label>
                  <input
                    type="text"
                    placeholder="e.g., Islamic Center of Example"
                    value={settings.jumuah.masjidName}
                    onChange={(e) => updateJumuah({ masjidName: e.target.value })}
                    className="w-full p-3 rounded-lg bg-[var(--color-background)] text-[var(--color-text)] border border-[var(--color-border)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  />
                </div>

                {/* Jumuah Times */}
                {settings.jumuah.times.map((time, index) => (
                  <div key={index} className="p-4 rounded-lg bg-[var(--color-card)]">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-medium text-[var(--color-text)]">
                        {settings.jumuah.times.length > 1 ? `Jumu'ah ${index + 1}` : "Jumu'ah Time"}
                      </span>
                      {settings.jumuah.times.length > 1 && (
                        <button
                          onClick={() => {
                            const newTimes = settings.jumuah.times.filter((_, i) => i !== index);
                            updateJumuah({ times: newTimes });
                          }}
                          className="text-red-500 text-sm font-medium"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="block text-xs text-[var(--color-muted)] mb-1">Khutbah</label>
                        <input
                          type="time"
                          value={time.khutbah}
                          onChange={(e) => {
                            const newTimes = [...settings.jumuah.times];
                            newTimes[index] = { ...newTimes[index], khutbah: e.target.value };
                            updateJumuah({ times: newTimes });
                          }}
                          className="w-full p-3 rounded-lg bg-[var(--color-background)] text-[var(--color-text)] border border-[var(--color-border)]"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-[var(--color-muted)] mb-1">Iqamah</label>
                        <input
                          type="time"
                          value={time.iqamah}
                          onChange={(e) => {
                            const newTimes = [...settings.jumuah.times];
                            newTimes[index] = { ...newTimes[index], iqamah: e.target.value };
                            updateJumuah({ times: newTimes });
                          }}
                          className="w-full p-3 rounded-lg bg-[var(--color-background)] text-[var(--color-text)] border border-[var(--color-border)]"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                {/* Add Another Jumuah */}
                <button
                  onClick={() => {
                    const newTimes = [...settings.jumuah.times, { khutbah: '14:00', iqamah: '14:30' }];
                    updateJumuah({ times: newTimes });
                  }}
                  className="p-4 rounded-lg bg-[var(--color-card)] text-[var(--color-primary)] font-medium hover:bg-[var(--color-border)] transition-colors text-center"
                >
                  + Add Another Jumu'ah Time
                </button>

                {/* Reminder Time */}
                <div className="p-4 rounded-lg bg-[var(--color-card)]">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[var(--color-text)] font-medium">Reminder</p>
                      <p className="text-sm text-[var(--color-muted)]">Minutes before khutbah</p>
                    </div>
                    <select
                      value={settings.jumuah.reminderMinutes}
                      onChange={(e) => updateJumuah({ reminderMinutes: parseInt(e.target.value) })}
                      className="px-4 py-2 rounded-lg bg-[var(--color-background)] text-[var(--color-text)] border border-[var(--color-border)]"
                    >
                      <option value={15}>15 min</option>
                      <option value={30}>30 min</option>
                      <option value={45}>45 min</option>
                      <option value={60}>1 hour</option>
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Surah Kahf Settings */}
        {category === 'notifications-kahf' && (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Surah Al-Kahf Reminder</h3>

            <div className="flex items-start gap-2.5 px-1">
              <svg className="w-4 h-4 text-[var(--color-primary)] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <p className="text-xs text-[var(--color-muted)] leading-relaxed">
                In the Islamic calendar, the day begins at Maghrib. So Friday starts at Thursday's Maghrib time and ends at Friday's Maghrib. You'll be reminded at Thursday Maghrib, with optional repeat reminders until Friday Maghrib.
              </p>
            </div>

            <ToggleRow
              label="Enable Surah Al-Kahf Reminder"
              description="Reminded at Thursday Maghrib every week"
              checked={settings.surahKahf.enabled}
              onChange={(checked) => updateSurahKahf({ enabled: checked })}
            />

            {settings.surahKahf.enabled && (
              <div className="p-4 rounded-lg bg-[var(--color-card)]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[var(--color-text)] font-medium">Repeat Reminder</p>
                    <p className="text-sm text-[var(--color-muted)]">Keep reminding until Friday Maghrib</p>
                  </div>
                  <select
                    value={settings.surahKahf.repeatIntervalHours}
                    onChange={(e) => updateSurahKahf({ repeatIntervalHours: parseInt(e.target.value) })}
                    className="px-4 py-2 rounded-lg bg-[var(--color-background)] text-[var(--color-text)] border border-[var(--color-border)]"
                  >
                    <option value={0}>Off</option>
                    <option value={2}>Every 2 hours</option>
                    <option value={4}>Every 4 hours</option>
                    <option value={6}>Every 6 hours</option>
                    <option value={8}>Every 8 hours</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Notifications Hub */}
        {category === 'notifications' && (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Notifications</h3>

            <ToggleRow
              label="Enable Notifications"
              description="Get notified for prayer times"
              checked={settings.notifications.enabled}
              onChange={(checked) => updateNotifications(checked)}
            />

            {settings.notifications.enabled && (
              <div className="flex flex-col gap-4">
                <CategoryItem
                  icon={<NotificationIcon />}
                  title="Prayer Notifications"
                  summary={`${Object.values(settings.notifications.prayers).filter(p => p.enabled).length} prayers enabled`}
                  onClick={() => setCategory('notifications-prayers')}
                />
                <CategoryItem
                  icon={<AthanIcon />}
                  title="Athan Sounds"
                  summary={getAthanSummary()}
                  onClick={() => setCategory('notifications-athan')}
                />
                <CategoryItem
                  icon={<MosqueIcon />}
                  title="Jumu'ah"
                  summary={getJumuahSummary()}
                  onClick={() => setCategory('notifications-jumuah')}
                />
                <CategoryItem
                  icon={<BookIcon />}
                  title="Surah Al-Kahf"
                  summary={getSurahKahfSummary()}
                  onClick={() => setCategory('notifications-kahf')}
                />
              </div>
            )}
          </div>
        )}

        {/* Prayer Notifications */}
        {category === 'notifications-prayers' && (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Prayer Notifications</h3>

            <div className="flex flex-col gap-3">
              <p className="text-sm text-[var(--color-muted)]">
                Configure notifications for each prayer
              </p>
              {(Object.keys(PRAYER_LABELS) as PrayerName[]).map((prayer) => {
                const prayerSettings = settings.notifications.prayers[prayer];
                return (
                  <div
                    key={prayer}
                    className="p-4 rounded-lg bg-[var(--color-card)]"
                  >
                    <div
                      className="flex items-center justify-between mb-2 cursor-pointer"
                      onClick={() => updatePrayerNotification(prayer, { enabled: !prayerSettings.enabled })}
                    >
                      <span className="font-medium text-[var(--color-text)]">
                        {PRAYER_LABELS[prayer]}
                      </span>
                      <div className={`
                        relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-200
                        ${prayerSettings.enabled ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}
                      `}>
                        <div className={`
                          absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200
                          ${prayerSettings.enabled ? 'translate-x-5' : 'translate-x-0'}
                        `} />
                      </div>
                    </div>

                    {prayerSettings.enabled && (
                      <div className="flex flex-col gap-3 pt-3 border-t border-[var(--color-border)]">
                        {/* At Prayer Time */}
                        <div
                          className="flex items-center justify-between cursor-pointer"
                          onClick={() => updatePrayerNotification(prayer, { atPrayerTime: !prayerSettings.atPrayerTime })}
                        >
                          <span className="text-sm text-[var(--color-muted)]">At prayer time</span>
                          <div className={`
                            relative w-9 h-5 rounded-full flex-shrink-0 transition-colors duration-200
                            ${prayerSettings.atPrayerTime ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}
                          `}>
                            <div className={`
                              absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200
                              ${prayerSettings.atPrayerTime ? 'translate-x-4' : 'translate-x-0'}
                            `} />
                          </div>
                        </div>

                        {/* Reminder */}
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-[var(--color-muted)]">Reminder before</span>
                          <select
                            value={prayerSettings.reminderMinutes}
                            onChange={(e) => updatePrayerNotification(prayer, { reminderMinutes: parseInt(e.target.value) })}
                            className="px-3 py-1.5 text-sm rounded-lg bg-[var(--color-background)] text-[var(--color-text)] border border-[var(--color-border)]"
                          >
                            {REMINDER_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Sound */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-[var(--color-muted)] flex-shrink-0">Sound</span>
                          <select
                            value={prayerSettings.sound}
                            onChange={(e) => updatePrayerNotification(prayer, { sound: e.target.value as NotificationSound })}
                            className="px-3 py-1.5 text-sm rounded-lg bg-[var(--color-background)] text-[var(--color-text)] border border-[var(--color-border)] max-w-[60%] truncate"
                          >
                            {BUILT_IN_SOUND_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                            {settings.athan.downloadedAthans.length > 0 && (
                              <optgroup label="Downloaded Athans">
                                {settings.athan.downloadedAthans.map((athan) => (
                                  <option key={athan.id} value={`athan:${athan.id}`}>
                                    {athan.muezzinName} — {athan.title}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Athan Settings */}
        {category === 'notifications-athan' && (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Athan Sounds</h3>

            {/* Browse & Download */}
            <button
              onClick={() => setCategory('athan-catalog')}
              className="w-full p-4 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:opacity-90 transition-opacity text-center"
            >
              Browse & Download Athans
            </button>

            {/* Downloaded athans list */}
            {settings.athan.downloadedAthans.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-[var(--color-muted)]">
                  {useSeparateFajr ? 'Main Athan' : 'Selected Athan'}
                </p>

                {/* Default sound option */}
                <div
                  onClick={() => {
                    if (settings.athan.currentChannelId) {
                      AthanPlugin.deleteChannel({ channelId: settings.athan.currentChannelId }).catch(() => {});
                    }
                    updateAthan({ selectedAthanId: null, currentChannelId: null });
                  }}
                  className={`flex items-center gap-3 p-4 rounded-lg cursor-pointer transition-colors ${
                    !settings.athan.selectedAthanId
                      ? 'bg-[var(--color-primary)]/10 border border-[var(--color-primary)]'
                      : 'bg-[var(--color-card)] hover:bg-[var(--color-border)]'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    !settings.athan.selectedAthanId ? 'border-[var(--color-primary)]' : 'border-[var(--color-muted)]'
                  }`}>
                    {!settings.athan.selectedAthanId && (
                      <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-primary)]" />
                    )}
                  </div>
                  <span className="text-[var(--color-text)] font-medium">Use default sound</span>
                </div>

                {/* Downloaded athans */}
                {settings.athan.downloadedAthans.map((athan) => (
                  <div
                    key={athan.id}
                    className={`flex items-center gap-3 p-4 rounded-lg transition-colors ${
                      settings.athan.selectedAthanId === athan.id
                        ? 'bg-[var(--color-primary)]/10 border border-[var(--color-primary)]'
                        : 'bg-[var(--color-card)]'
                    }`}
                  >
                    {/* Radio button */}
                    <div
                      onClick={async () => {
                        const channelId = await selectAthan(athan, settings.athan.currentChannelId, 'main');
                        updateAthan({ selectedAthanId: athan.id, currentChannelId: channelId });
                      }}
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 cursor-pointer ${
                        settings.athan.selectedAthanId === athan.id ? 'border-[var(--color-primary)]' : 'border-[var(--color-muted)]'
                      }`}
                    >
                      {settings.athan.selectedAthanId === athan.id && (
                        <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-primary)]" />
                      )}
                    </div>

                    {/* Info */}
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={async () => {
                        const channelId = await selectAthan(athan, settings.athan.currentChannelId, 'main');
                        updateAthan({ selectedAthanId: athan.id, currentChannelId: channelId });
                      }}
                    >
                      <p className="text-[var(--color-text)] font-medium truncate">{athan.muezzinName}</p>
                      <p className="text-sm text-[var(--color-muted)] truncate">
                        {athan.title}{athan.duration ? ` - ${athan.duration}` : ''}
                      </p>
                    </div>

                    {/* Preview button */}
                    <button
                      onClick={() => {
                        if (previewingId === athan.id) {
                          stopAthanPreview().catch(() => {});
                          setPreviewingId(null);
                        } else {
                          stopPreview();
                          playAthanPreview(athan.filename).then(() => setPreviewingId(athan.id)).catch(() => {});
                        }
                      }}
                      className="p-2 rounded-lg hover:bg-[var(--color-border)] transition-colors flex-shrink-0"
                    >
                      {previewingId === athan.id ? (
                        <svg className="w-5 h-5 text-[var(--color-primary)]" fill="currentColor" viewBox="0 0 24 24">
                          <rect x="6" y="4" width="4" height="16" rx="1" />
                          <rect x="14" y="4" width="4" height="16" rx="1" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-[var(--color-muted)]" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>

                    {/* Delete button */}
                    <button
                      onClick={async () => {
                        stopPreview();
                        await deleteAthanFile(athan.filename).catch(() => {});
                        const newDownloaded = settings.athan.downloadedAthans.filter(a => a.id !== athan.id);
                        const updates: Partial<typeof settings.athan> = { downloadedAthans: newDownloaded };
                        if (settings.athan.selectedAthanId === athan.id) {
                          if (settings.athan.currentChannelId) {
                            AthanPlugin.deleteChannel({ channelId: settings.athan.currentChannelId }).catch(() => {});
                          }
                          updates.selectedAthanId = null;
                          updates.currentChannelId = null;
                        }
                        if (settings.athan.selectedFajrAthanId === athan.id) {
                          if (settings.athan.currentFajrChannelId) {
                            AthanPlugin.deleteChannel({ channelId: settings.athan.currentFajrChannelId }).catch(() => {});
                          }
                          updates.selectedFajrAthanId = null;
                          updates.currentFajrChannelId = null;
                        }
                        updateAthan(updates);
                      }}
                      className="p-2 rounded-lg hover:bg-red-500/10 transition-colors flex-shrink-0"
                    >
                      <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                ))}

                {/* Separate Fajr toggle */}
                <div className="mt-2">
                  <ToggleRow
                    label="Separate Fajr Athan"
                    description="Use a different athan for Fajr prayer"
                    checked={useSeparateFajr}
                    onChange={(checked) => {
                      setUseSeparateFajr(checked);
                      if (!checked) {
                        if (settings.athan.currentFajrChannelId) {
                          AthanPlugin.deleteChannel({ channelId: settings.athan.currentFajrChannelId }).catch(() => {});
                        }
                        updateAthan({ selectedFajrAthanId: null, currentFajrChannelId: null });
                      }
                    }}
                  />
                </div>

                {/* Fajr athan selection */}
                {useSeparateFajr && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-[var(--color-muted)]">Fajr Athan</p>
                    {settings.athan.downloadedAthans.map((athan) => (
                      <div
                        key={`fajr-${athan.id}`}
                        onClick={async () => {
                          const channelId = await selectAthan(athan, settings.athan.currentFajrChannelId, 'fajr');
                          updateAthan({ selectedFajrAthanId: athan.id, currentFajrChannelId: channelId });
                        }}
                        className={`flex items-center gap-3 p-4 rounded-lg cursor-pointer transition-colors ${
                          settings.athan.selectedFajrAthanId === athan.id
                            ? 'bg-[var(--color-primary)]/10 border border-[var(--color-primary)]'
                            : 'bg-[var(--color-card)] hover:bg-[var(--color-border)]'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          settings.athan.selectedFajrAthanId === athan.id ? 'border-[var(--color-primary)]' : 'border-[var(--color-muted)]'
                        }`}>
                          {settings.athan.selectedFajrAthanId === athan.id && (
                            <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-primary)]" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[var(--color-text)] font-medium truncate">{athan.muezzinName}</p>
                          <p className="text-sm text-[var(--color-muted)] truncate">{athan.title}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {settings.athan.downloadedAthans.length === 0 && (
              <div className="p-6 rounded-lg bg-[var(--color-card)] text-center">
                <p className="text-[var(--color-muted)]">No athans downloaded yet.</p>
                <p className="text-sm text-[var(--color-muted)] mt-1">
                  Browse the catalog to download athan audio.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Athan Catalog Browser */}
        {category === 'athan-catalog' && (
          <AthanCatalogPanel
            catalog={catalog}
            setCatalog={setCatalog}
            catalogLoading={catalogLoading}
            setCatalogLoading={setCatalogLoading}
            catalogError={catalogError}
            setCatalogError={setCatalogError}
            downloadedAthans={settings.athan.downloadedAthans}
            onDownloaded={(athanFile) => {
              updateAthan({
                downloadedAthans: [...settings.athan.downloadedAthans, athanFile],
              });
            }}
          />
        )}

        {/* Travel Mode Settings */}
        {category === 'travel' && (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Travel Mode</h3>

            {/* Master Toggle */}
            <ToggleRow
              label="Enable Travel Mode"
              description="Detect travel and shorten prayers (Qasr)"
              checked={settings.travel.enabled}
              onChange={() => toggleTravelEnabled()}
            />

            {settings.travel.enabled && (
              <>
                {/* Detection Mode */}
                <div className="p-4 rounded-lg bg-[var(--color-card)]">
                  <p className="text-sm text-[var(--color-muted)] mb-2">Detection Mode</p>
                  <div className="flex gap-2">
                    <ToggleButton
                      active={settings.travel.override === 'auto'}
                      onClick={() => setTravelOverride('auto')}
                    >
                      Auto
                    </ToggleButton>
                    <ToggleButton
                      active={settings.travel.override === 'force_on'}
                      onClick={() => setTravelOverride('force_on')}
                    >
                      Always On
                    </ToggleButton>
                    <ToggleButton
                      active={settings.travel.override === 'force_off'}
                      onClick={() => setTravelOverride('force_off')}
                    >
                      Always Off
                    </ToggleButton>
                  </div>
                </div>

                {/* Distance Unit */}
                <div className="p-4 rounded-lg bg-[var(--color-card)]">
                  <p className="text-sm text-[var(--color-muted)] mb-2">Distance Unit</p>
                  <div className="flex gap-2">
                    <ToggleButton
                      active={settings.distanceUnit === 'miles'}
                      onClick={() => updateDistanceUnit('miles')}
                    >
                      Miles
                    </ToggleButton>
                    <ToggleButton
                      active={settings.distanceUnit === 'km'}
                      onClick={() => updateDistanceUnit('km')}
                    >
                      Kilometers
                    </ToggleButton>
                  </div>
                </div>

                {/* Home Base */}
                <div className="p-4 rounded-lg bg-[var(--color-card)]">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[var(--color-text)] font-medium">Home Base</p>
                    {settings.travel.homeBase && (
                      <button
                        onClick={() => clearHomeBase()}
                        className="text-red-500 text-sm font-medium"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {settings.travel.homeBase && (
                    <div className="mb-3">
                      <div className="rounded-lg overflow-hidden mb-2">
                        <iframe
                          title="Home base location"
                          src={`https://www.openstreetmap.org/export/embed.html?bbox=${settings.travel.homeBase.coordinates.longitude - 0.06},${settings.travel.homeBase.coordinates.latitude - 0.04},${settings.travel.homeBase.coordinates.longitude + 0.06},${settings.travel.homeBase.coordinates.latitude + 0.04}&layer=mapnik&marker=${settings.travel.homeBase.coordinates.latitude},${settings.travel.homeBase.coordinates.longitude}`}
                          className="w-full h-36 border-0"
                        />
                      </div>
                      <p className="text-sm text-[var(--color-text)]">{settings.travel.homeBase.cityName}</p>
                      <p className="text-xs text-[var(--color-muted)]">
                        {settings.travel.homeBase.coordinates.latitude.toFixed(4)}, {settings.travel.homeBase.coordinates.longitude.toFixed(4)}
                      </p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        setGpsLoading(true);
                        setGpsError(null);
                        try {
                          const loc = await getGPSLocation();
                          setHomeBase({
                            coordinates: loc.coordinates,
                            cityName: loc.cityName,
                            countryCode: loc.countryCode,
                          });
                        } catch (err) {
                          setGpsError(err instanceof Error ? err.message : 'Failed to get location');
                        } finally {
                          setGpsLoading(false);
                        }
                      }}
                      disabled={gpsLoading}
                      className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {gpsLoading ? 'Locating...' : 'Use GPS Location'}
                    </button>
                    <button
                      onClick={() => setCategory('travel-home-search')}
                      className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-[var(--color-background)] text-[var(--color-text)] hover:bg-[var(--color-border)] transition-colors"
                    >
                      Search City
                    </button>
                  </div>
                  {gpsError && (
                    <p className="text-sm text-red-500 mt-2">{gpsError}</p>
                  )}
                </div>

                {/* Jama Toggles — combined card */}
                <div className="rounded-lg bg-[var(--color-card)] overflow-hidden">
                  <div
                    onClick={() => toggleJama('dhuhrAsr')}
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-[var(--color-border)] transition-colors"
                  >
                    <div className="mr-4">
                      <p className="text-[var(--color-text)] font-medium">Combine Dhuhr + Asr</p>
                      <p className="text-sm text-[var(--color-muted)]">Jama' — pray both together</p>
                    </div>
                    <div className={`
                      relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-200
                      ${settings.travel.jamaDhuhrAsr ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}
                    `}>
                      <div className={`
                        absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200
                        ${settings.travel.jamaDhuhrAsr ? 'translate-x-5' : 'translate-x-0'}
                      `} />
                    </div>
                  </div>
                  <div className="mx-4 border-t border-[var(--color-border)]" />
                  <div
                    onClick={() => toggleJama('maghribIsha')}
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-[var(--color-border)] transition-colors"
                  >
                    <div className="mr-4">
                      <p className="text-[var(--color-text)] font-medium">Combine Maghrib + Isha</p>
                      <p className="text-sm text-[var(--color-muted)]">Jama' — pray both together</p>
                    </div>
                    <div className={`
                      relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-200
                      ${settings.travel.jamaMaghribIsha ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}
                    `}>
                      <div className={`
                        absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200
                        ${settings.travel.jamaMaghribIsha ? 'translate-x-5' : 'translate-x-0'}
                      `} />
                    </div>
                  </div>
                </div>

                {/* Max Travel Days + Qasr/Jama Info */}
                <div className="p-4 rounded-lg bg-[var(--color-card)]">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[var(--color-text)] font-medium">Max Travel Days</p>
                      <p className="text-sm text-[var(--color-muted)]">After this, Qasr stops</p>
                    </div>
                    <select
                      value={settings.travel.maxTravelDays}
                      onChange={(e) => updateTravel({ maxTravelDays: parseInt(e.target.value) })}
                      className="px-4 py-2 rounded-lg bg-[var(--color-background)] text-[var(--color-text)] border border-[var(--color-border)]"
                    >
                      <option value={0}>Unlimited</option>
                      <option value={4}>4 days</option>
                      <option value={10}>10 days</option>
                      <option value={15}>15 days</option>
                    </select>
                  </div>

                  <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                    <p className="text-sm font-medium text-[var(--color-text)] mb-1">What is Qasr?</p>
                    <p className="text-sm text-[var(--color-muted)] leading-relaxed">
                      Qasr (shortening) is a concession for travelers to shorten the 4-rak'ah prayers (Dhuhr, Asr, and Isha) to 2 rak'ah each. This applies when you travel approximately 80+ km from your home city. Fajr (2 rak'ah) and Maghrib (3 rak'ah) are not shortened.
                    </p>
                    <p className="text-sm font-medium text-[var(--color-text)] mt-3 mb-1">What is Jama'?</p>
                    <p className="text-sm text-[var(--color-muted)] leading-relaxed">
                      Jama' (combining) allows a traveler to combine Dhuhr with Asr, or Maghrib with Isha, praying them together at the time of either prayer. This is separate from Qasr — you can shorten without combining, or do both.
                    </p>
                    <p className="text-sm font-medium text-[var(--color-text)] mt-3 mb-1">Sunnah prayers while traveling</p>
                    <p className="text-sm text-[var(--color-muted)] leading-relaxed">
                      Most scholars agree that the Sunnah Rawatib (regular sunnah prayers) are dropped while traveling, except for the 2 rak'ah before Fajr and the Witr prayer, which the Prophet (peace be upon him) never left.
                    </p>
                  </div>
                </div>

                {/* Current Status */}
                {travelState.isTraveling && (
                  <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <p className="text-amber-600 font-medium text-sm">Currently Traveling</p>
                    {travelState.distanceFromHomeKm !== null && (
                      <p className="text-amber-600/70 text-xs mt-1">
                        {formatDistance(travelState.distanceFromHomeKm, settings.distanceUnit)} from home
                        {travelState.isAutoDetected && ' (auto-detected)'}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Travel Home City Search */}
        {category === 'travel-home-search' && (
          <CitySearch onSelect={(city: CityEntry) => {
            setHomeBase({
              coordinates: { latitude: city.lat, longitude: city.lng },
              cityName: city.n,
              countryCode: city.c,
            });
            setCategory('travel');
          }} />
        )}

        {/* About */}
        {category === 'about' && (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">About</h3>
            
            <div className="p-6 rounded-lg bg-[var(--color-card)] text-center">
              <img src="/logo.png" alt="OnTime" className="w-20 h-20 mx-auto mb-4 rounded-lg" />
              <h4 className="text-xl font-semibold text-[var(--color-text)]">OnTime</h4>
              <p className="text-[var(--color-muted)] mt-1">Version 1.0.0</p>
            </div>
            
            <div className="p-4 rounded-lg bg-[var(--color-card)]">
              <p className="text-sm text-[var(--color-muted)]">
                Prayer times calculated using adhan-js library with high precision astronomical algorithms.
              </p>
            </div>
            
            <div className="p-4 rounded-lg bg-[var(--color-card)]">
              <p className="text-sm text-[var(--color-text)] font-medium mb-1">Features</p>
              <ul className="text-sm text-[var(--color-muted)] space-y-1">
                <li>- Accurate prayer times calculation</li>
                <li>- Multiple calculation methods</li>
                <li>- Qibla compass</li>
                <li>- Prayer tracking & statistics</li>
                <li>- Customizable notifications</li>
                <li>- Jumu'ah reminders</li>
              </ul>
            </div>
          </div>
        )}
        </div>
      </div>

      <style>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in {
          animation: slide-in 0.25s ease-out;
        }
      `}</style>
    </div>
  );
}

// Category Item Component
function CategoryItem({ 
  icon, 
  title, 
  summary, 
  onClick 
}: { 
  icon: React.ReactNode; 
  title: string; 
  summary: string; 
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-4 p-4 rounded-lg bg-[var(--color-card)] hover:bg-[var(--color-border)] transition-colors text-left w-full"
    >
      <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)]">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[var(--color-text)]">{title}</p>
        <p className="text-sm text-[var(--color-muted)] truncate">{summary}</p>
      </div>
      <svg className="w-5 h-5 text-[var(--color-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

// Theme Option Component
function ThemeOption({
  active,
  onClick,
  label,
  swatches,
  description,
  colors,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  swatches?: string[];
  description?: string;
  colors: { bg: string; text: string; border: string; primary: string };
}) {
  return (
    <button
      onClick={onClick}
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
        borderColor: active ? colors.primary : colors.border,
        borderWidth: active ? '2px' : '1px',
      }}
      className="p-3 rounded-lg flex flex-col items-center gap-1 transition-all border"
    >
      {swatches ? (
        <div className="flex gap-1">
          {swatches.map((color, i) => (
            <div
              key={i}
              className="w-5 h-5 rounded-full"
              style={{ backgroundColor: color, border: '1px solid rgba(128,128,128,0.3)' }}
            />
          ))}
        </div>
      ) : (
        <span className="text-[11px] opacity-60 leading-tight">{description}</span>
      )}
      <span className="font-medium text-sm">{label}</span>
    </button>
  );
}

function ToggleButton({ 
  active, 
  onClick, 
  children 
}: { 
  active: boolean; 
  onClick: () => void; 
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex-1 px-4 py-3 rounded-lg text-sm font-medium transition-all
        ${active
          ? 'bg-[var(--color-primary)] text-white'
          : 'bg-[var(--color-card)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-border)]'
        }
      `}
    >
      {children}
    </button>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between p-4 rounded-lg bg-[var(--color-card)] cursor-pointer hover:bg-[var(--color-border)] transition-colors"
    >
      <div className="mr-4">
        <p className="text-[var(--color-text)] font-medium">{label}</p>
        <p className="text-sm text-[var(--color-muted)]">{description}</p>
      </div>
      <div className={`
        relative w-11 h-6 rounded-full flex-shrink-0 transition-colors duration-200
        ${checked ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}
      `}>
        <div className={`
          absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200
          ${checked ? 'translate-x-5' : 'translate-x-0'}
        `} />
      </div>
    </div>
  );
}

// Icons
function LocationIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
    </svg>
  );
}

function CalculationIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
    </svg>
  );
}

function AppearanceIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 005.304 0l6.401-6.402M6.75 21A3.75 3.75 0 013 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 003.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008z" />
    </svg>
  );
}

function MosqueIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c-1.5 2-3 3.5-3 5.5a3 3 0 106 0c0-2-1.5-3.5-3-5.5zM4 21v-6a8 8 0 0116 0v6M8 21v-4M16 21v-4" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  );
}

function NotificationIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  );
}

function TravelIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
    </svg>
  );
}

function AboutIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  );
}

function AthanIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
    </svg>
  );
}

// Athan Catalog Panel Component
function AthanCatalogPanel({
  catalog,
  setCatalog,
  catalogLoading,
  setCatalogLoading,
  catalogError,
  setCatalogError,
  downloadedAthans,
  onDownloaded,
}: {
  catalog: AthanCatalogEntry[];
  setCatalog: (c: AthanCatalogEntry[]) => void;
  catalogLoading: boolean;
  setCatalogLoading: (l: boolean) => void;
  catalogError: string | null;
  setCatalogError: (e: string | null) => void;
  downloadedAthans: AthanFile[];
  onDownloaded: (file: AthanFile) => void;
}) {
  const [downloadingUrls, setDownloadingUrls] = useState<string[]>([]);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [audioRef] = useState(() => ({ current: null as HTMLAudioElement | null }));

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [audioRef]);

  const togglePreview = (url: string) => {
    if (previewUrl === url) {
      // Stop current preview
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPreviewUrl(null);
    } else {
      // Stop previous and start new
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(url);
      audio.onended = () => {
        setPreviewUrl(null);
        audioRef.current = null;
      };
      audio.play().catch(() => setPreviewUrl(null));
      audioRef.current = audio;
      setPreviewUrl(url);
    }
  };

  useEffect(() => {
    if (catalog.length === 0 && !catalogLoading) {
      setCatalogLoading(true);
      setCatalogError(null);
      fetchAthanCatalog()
        .then((entries) => setCatalog(entries))
        .catch((err) => setCatalogError(err instanceof Error ? err.message : 'Failed to load catalog'))
        .finally(() => setCatalogLoading(false));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isDownloaded = (url: string) =>
    downloadedAthans.some((a) => a.sourceUrl === url);

  const handleDownload = async (entry: AthanCatalogEntry) => {
    if (downloadingUrls.includes(entry.sourceUrl) || isDownloaded(entry.sourceUrl)) return;

    setDownloadError(null);
    setDownloadingUrls(prev => [...prev, entry.sourceUrl]);
    try {
      const file = await downloadAthan(entry);
      onDownloaded(file);
    } catch (err) {
      console.error('Download failed:', err);
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadingUrls(prev => prev.filter(u => u !== entry.sourceUrl));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold text-[var(--color-text)]">Athan Catalog</h3>

      {catalogLoading && (
        <div className="p-6 rounded-lg bg-[var(--color-card)] text-center">
          <p className="text-[var(--color-muted)]">Loading catalog...</p>
        </div>
      )}

      {catalogError && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-red-500 text-sm">{catalogError}</p>
          <button
            onClick={() => {
              setCatalogLoading(true);
              setCatalogError(null);
              fetchAthanCatalog()
                .then((entries) => setCatalog(entries))
                .catch((err) => setCatalogError(err instanceof Error ? err.message : 'Failed to load catalog'))
                .finally(() => setCatalogLoading(false));
            }}
            className="mt-2 text-sm font-medium text-[var(--color-primary)]"
          >
            Retry
          </button>
        </div>
      )}

      {downloadError && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-red-500 text-sm">{downloadError}</p>
        </div>
      )}

      {!catalogLoading && !catalogError && catalog.length === 0 && (
        <div className="p-6 rounded-lg bg-[var(--color-card)] text-center">
          <p className="text-[var(--color-muted)]">No athans found in the catalog.</p>
        </div>
      )}

      {catalog.map((entry, idx) => {
        const downloaded = isDownloaded(entry.sourceUrl);
        const downloading = downloadingUrls.includes(entry.sourceUrl);

        return (
          <div
            key={idx}
            className="flex items-center gap-3 p-4 rounded-lg bg-[var(--color-card)]"
          >
            {/* Preview button */}
            <button
              onClick={() => togglePreview(entry.sourceUrl)}
              className="p-2 rounded-lg hover:bg-[var(--color-border)] transition-colors flex-shrink-0"
            >
              {previewUrl === entry.sourceUrl ? (
                <svg className="w-5 h-5 text-[var(--color-primary)]" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-[var(--color-muted)]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <div className="flex-1 min-w-0">
              <p className="text-[var(--color-text)] font-medium truncate">{entry.muezzinName}</p>
              <p className="text-sm text-[var(--color-muted)] truncate">
                {entry.title}{entry.duration ? ` - ${entry.duration}` : ''}
              </p>
            </div>

            {downloaded ? (
              <span className="text-xs font-medium text-green-600 bg-green-500/10 px-2.5 py-1 rounded-full flex-shrink-0">
                Downloaded
              </span>
            ) : (
              <button
                onClick={() => handleDownload(entry)}
                disabled={downloading}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 flex-shrink-0"
              >
                {downloading ? 'Downloading...' : 'Download'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
