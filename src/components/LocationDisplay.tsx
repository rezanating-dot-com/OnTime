import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from '../context/LocationContext';
import { useSettings } from '../context/SettingsContext';
import { formatHijriLine } from '../utils/hijriDate';

interface LocationDisplayProps {
  onRefresh?: () => void;
}

export function LocationDisplay({ onRefresh }: LocationDisplayProps) {
  const { location, isLoading, error, refreshLocation } = useLocation();
  const [showMap, setShowMap] = useState(false);
  const { settings } = useSettings();
  // The date this subtitle is showing. Its own state, with its own timer, for
  // the same reason the globe keeps a minute tick: this component used to
  // re-render every second because App did, and that per-second render is
  // exactly what was taken out of App. Left riding on it, the Hijri date would
  // have gone stale at midnight and stayed stale until Fajr moved the app.
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const schedule = (): ReturnType<typeof setTimeout> => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setDate(midnight.getDate() + 1);
      midnight.setHours(0, 0, 0, 0);
      return setTimeout(() => {
        setToday(new Date());
        timer = schedule();
      }, midnight.getTime() - now.getTime());
    };
    let timer = schedule();
    return () => clearTimeout(timer);
  }, []);

  const hijriLine = useMemo(
    () => formatHijriLine(today, settings.display.hijriOffset),
    [settings.display.hijriOffset, today]
  );

  const handleTap = () => {
    if (error) {
      refreshLocation().then(() => onRefresh?.());
      return;
    }
    setShowMap(true);
  };

  const handleOpenInMaps = () => {
    const { latitude, longitude } = location.coordinates;
    const label = encodeURIComponent(location.cityName);
    // geo: URI works on Android, falls back to Google Maps on web
    window.open(`geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`, '_system');
  };

  return (
    <>
      <button
        onClick={handleTap}
        disabled={isLoading}
        className="flex flex-col items-center gap-0.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
          </svg>
          <span className="text-sm font-medium">
            {isLoading ? 'Loading...' : error ? 'Tap to retry' : location.cityName}
          </span>
          {isLoading && (
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
        </div>
        {hijriLine && !isLoading && !error && (
          <span className="text-[11px] opacity-80 leading-tight">{hijriLine}</span>
        )}
      </button>

      {/* Map Popup — portaled to document.body so it escapes the header's
          local CSS-variable overrides (e.g. the Home Globe glow HUD) and
          resolves --color-text/--color-muted from the theme's actual root
          definitions instead. */}
      {showMap && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowMap(false)}
        >
          <div
            className="w-[90%] max-w-md bg-[var(--color-card)] rounded-lg overflow-hidden border border-[var(--color-border)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="font-semibold text-[var(--color-text)]">{location.cityName}</p>
                <p className="text-xs text-[var(--color-muted)]">
                  {location.coordinates.latitude.toFixed(4)}, {location.coordinates.longitude.toFixed(4)}
                </p>
              </div>
              <button
                onClick={() => setShowMap(false)}
                className="p-1.5 rounded-full hover:bg-[var(--color-background)] transition-colors"
              >
                <svg className="w-5 h-5 text-[var(--color-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Map */}
            <iframe
              title="Location map"
              width="100%"
              height="250"
              style={{ border: 0 }}
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${location.coordinates.longitude - 0.05},${location.coordinates.latitude - 0.03},${location.coordinates.longitude + 0.05},${location.coordinates.latitude + 0.03}&layer=mapnik&marker=${location.coordinates.latitude},${location.coordinates.longitude}`}
            />

            {/* Open in Maps button */}
            <div className="px-4 py-3">
              <button
                onClick={handleOpenInMaps}
                className="w-full py-2.5 rounded-lg bg-[var(--color-primary)] text-white font-medium text-sm hover:opacity-90 transition-opacity"
              >
                Open in Maps
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
