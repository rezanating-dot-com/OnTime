import { useEffect, useMemo, useState } from 'react';
import { useLocation } from '../context/LocationContext';
import { useSettings } from '../context/SettingsContext';
import { formatHijriLine } from '../utils/hijriDate';

interface LocationDisplayProps {
  onRefresh?: () => void;
}

export function LocationDisplay({ onRefresh }: LocationDisplayProps) {
  const { location, isLoading, error, refreshLocation } = useLocation();
  const { settings, isLoading: settingsLoading } = useSettings();
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

  // Tapping this used to open a card with a map of where you are, loaded from
  // OpenStreetMap. The globe behind it now shows the same thing, drawn from
  // the same coordinates and without asking anyone else for a picture, so the
  // card went and the app has one fewer server it talks to. What is left is
  // the one case where a tap still has something to do: retrying a location
  // that failed.
  const content = (
    <>
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
      {hijriLine && !isLoading && !settingsLoading && !error && (
        <span className="text-[11px] text-[var(--color-muted)] opacity-80 leading-tight">{hijriLine}</span>
      )}
    </>
  );

  const shell = 'flex flex-col items-center gap-0.5 text-[var(--color-muted)]';

  // A button only while there is something to press it for. Left as one
  // always, it invites a tap that now does nothing.
  if (!error) return <div className={shell}>{content}</div>;

  return (
    <button
      onClick={() => refreshLocation().then(() => onRefresh?.())}
      disabled={isLoading}
      className={`${shell} hover:text-[var(--color-text)] transition-colors`}
    >
      {content}
    </button>
  );
}


