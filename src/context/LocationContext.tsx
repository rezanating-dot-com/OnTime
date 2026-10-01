import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { Geolocation } from '@capacitor/geolocation';
import { Preferences } from '@capacitor/preferences';
import type { LocationData, Coordinates } from '../types';

const LOCATION_KEY = 'ontime_location';

/**
 * Whether a permission result is good enough to locate the user.
 *
 * `location` reports granted only when the app holds BOTH coarse and fine
 * accuracy, so on Android 12+ a user who picks "Approximate" comes back denied
 * there while `coarseLocation` is granted. Treating that as a refusal left the
 * app stuck on its default city even though a usable ~1-3 km fix was already in
 * hand — and prayer times only need city-level accuracy.
 */
function canLocate(status: { location?: string; coarseLocation?: string }): boolean {
  return status.location === 'granted' || status.coarseLocation === 'granted';
}

async function loadSavedLocation(): Promise<LocationData | null> {
  try {
    const { value } = await Preferences.get({ key: LOCATION_KEY });
    if (value) {
      return JSON.parse(value) as LocationData;
    }
  } catch (err) {
    console.error('Failed to load saved location:', err);
  }
  return null;
}

/** Shown for the moment between getting a GPS fix and learning its name. */
const LOCATING_LABEL = 'Locating…';

/**
 * Nominatim gets no timeout of its own, and a bare fetch will wait as long as
 * the platform feels like it. Five seconds is generous for a reverse geocode and
 * short enough that a captive portal or a dead connection does not strand the
 * location screen.
 */
const GEOCODE_TIMEOUT_MS = 5000;

// Default to Mecca if no location is available
const defaultLocation: LocationData = {
  coordinates: { latitude: 21.4225, longitude: 39.8262 },
  cityName: 'Mecca',
  countryCode: 'SA',
};

interface LocationContextType {
  location: LocationData;
  isLoading: boolean;
  error: string | null;
  refreshLocation: () => Promise<LocationData | undefined>;
  setManualLocation: (coords: Coordinates, cityName: string, countryCode?: string) => void;
  getGPSLocation: () => Promise<LocationData>;
}

const LocationContext = createContext<LocationContextType | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<LocationData>(defaultLocation);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load the saved location once; onboarding handles the first GPS request.
  useEffect(() => {
    loadSavedLocation().then((savedLocation) => {
      if (savedLocation) {
        setLocation(savedLocation);
      }
      setIsLoading(false);
    });
  }, []);

  async function saveLocation(loc: LocationData) {
    try {
      await Preferences.set({
        key: LOCATION_KEY,
        value: JSON.stringify(loc),
      });
    } catch (err) {
      console.error('Failed to save location:', err);
    }
  }

  async function refreshLocation(): Promise<LocationData | undefined> {
    setError(null);

    try {
      // Check permissions first
      let permission = await Geolocation.checkPermissions();

      if (!canLocate(permission)) {
        // Request permission
        permission = await Geolocation.requestPermissions();
        if (!canLocate(permission)) {
          setError('Location permission denied');
          return undefined;
        }
      }

      const position = await Geolocation.getCurrentPosition({
        // High accuracy needs ACCESS_FINE_LOCATION. Requesting it on an
        // "Approximate" grant makes the fix sit until the timeout instead of
        // returning the coarse one, which is plenty for prayer times.
        enableHighAccuracy: permission.location === 'granted',
        timeout: 10000,
      });

      const coords: Coordinates = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };

      // Apply the fix immediately, then fill in the name. Reverse geocoding used
      // to block this: a stalled Nominatim request — captive portal, congested
      // mobile data — held perfectly good coordinates hostage, so onboarding sat
      // on "Finding your location…" and prayer times stayed on the default city
      // even though the position was already in hand.
      const located: LocationData = { coordinates: coords, cityName: LOCATING_LABEL };
      setLocation(located);
      await saveLocation(located);

      // Best-effort. reverseGeocode never throws — it times out and falls back to
      // a generic label — so the coordinates above always stand.
      const { displayName, shortName, countryCode } = await reverseGeocode(coords);

      const newLocation: LocationData = {
        coordinates: coords,
        cityName: displayName,
        shortName,
        countryCode,
      };

      setLocation(newLocation);
      await saveLocation(newLocation);
      return newLocation;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get location';
      setError(message);
      console.error('Location error:', err);
      return undefined;
    }
  }

  async function reverseGeocode(
    coords: Coordinates
  ): Promise<{ displayName: string; shortName?: string; countryCode?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
    try {
      // Free Nominatim reverse geocoding. There is no User-Agent header: it is a
      // forbidden header name in fetch, so the one that used to be set here was
      // silently dropped and only looked like compliance with Nominatim's
      // "identify your app" request.
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${coords.latitude}&lon=${coords.longitude}&format=json`,
        { signal: controller.signal }
      );

      if (response.ok) {
        const data = await response.json();
        const addr = data.address || {};
        const city = addr.city || addr.town || addr.village || addr.county || '';
        const suburb = addr.suburb || addr.neighbourhood || '';
        const road = addr.road || '';
        const state = addr.state || '';
        const countryCode = addr.country_code ? addr.country_code.toUpperCase() : undefined;

        let displayName: string;
        if (suburb && city) {
          displayName = `${suburb}, ${city}`;
        } else if (road && city) {
          displayName = `${road}, ${city}`;
        } else if (city && state) {
          displayName = `${city}, ${state}`;
        } else if (city) {
          displayName = city;
        } else {
          displayName = 'Unknown Location';
        }

        return { displayName, shortName: city || undefined, countryCode };
      }
    } catch (err) {
      // Includes the abort from our own timeout, which on a bad connection is
      // the ordinary case rather than anything alarming.
      console.warn('Reverse geocoding failed:', err instanceof Error ? err.message : err);
    } finally {
      clearTimeout(timeout);
    }

    return { displayName: 'Current Location' };
  }

  function setManualLocation(coords: Coordinates, cityName: string, countryCode?: string) {
    // A manually picked city is already short enough to use as-is.
    const newLocation: LocationData = { coordinates: coords, cityName, shortName: cityName, countryCode };
    setLocation(newLocation);
    saveLocation(newLocation);
    setError(null);
  }

  async function getGPSLocation(): Promise<LocationData> {
    let permission = await Geolocation.checkPermissions();

    if (!canLocate(permission)) {
      permission = await Geolocation.requestPermissions();
      if (!canLocate(permission)) {
        throw new Error('Location permission denied');
      }
    }

    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: permission.location === 'granted',
      timeout: 10000,
    });

    const coords: Coordinates = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };

    const { displayName, shortName, countryCode } = await reverseGeocode(coords);

    return { coordinates: coords, cityName: displayName, shortName, countryCode };
  }

  return (
    <LocationContext.Provider
      value={{
        location,
        isLoading,
        error,
        refreshLocation,
        setManualLocation,
        getGPSLocation,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const context = useContext(LocationContext);
  if (!context) {
    throw new Error('useLocation must be used within a LocationProvider');
  }
  return context;
}
