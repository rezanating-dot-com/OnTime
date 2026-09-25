import { createContext, useContext, useMemo, useState, useEffect, type ReactNode } from 'react';
import { useSettings } from './SettingsContext';
import { useLocation } from './LocationContext';
import { calculateDistanceKm } from '../utils/distance';
import type { TravelState, HomeBaseLocation, TravelSettings } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

// setTimeout's delay is a 32-bit signed int; anything longer fires immediately,
// which would expire a long trip on the spot.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * The instant a trip started, as a full ISO timestamp.
 *
 * This used to be `.split('T')[0]` — a bare UTC date — which `new Date()` then
 * parsed back as UTC *midnight*, rounding the start down by however much of the
 * UTC day had already elapsed. "4 days" therefore allowed between 3.00 and
 * 4.00 real days depending on the time of day, in every timezone, silently
 * dropping up to a day of a religiously-defined allowance. The stored field
 * stays a string and old bare-date values still parse, so no migration needed.
 */
function tripStartInstant(): string {
  return new Date().toISOString();
}

interface TravelContextType {
  travelState: TravelState;
  setHomeBase: (home: HomeBaseLocation) => void;
  clearHomeBase: () => void;
  setTravelOverride: (override: TravelSettings['override']) => void;
  toggleJama: (pair: 'dhuhrAsr' | 'maghribIsha') => void;
  toggleTravelEnabled: () => void;
  confirmTravel: () => void;
  dismissTravel: () => void;
}

const defaultTravelState: TravelState = {
  isTraveling: false,
  travelPending: false,
  distanceFromHomeKm: null,
  isAutoDetected: false,
  qasr: { dhuhr: false, asr: false, isha: false },
  jamaDhuhrAsr: false,
  jamaMaghribIsha: false,
};

const TravelContext = createContext<TravelContextType | null>(null);

export function TravelProvider({ children }: { children: ReactNode }) {
  const { settings, updateTravel } = useSettings();
  const { location } = useLocation();
  // Hoisted so the hooks below can depend on exactly what they read: nothing
  // here uses any other part of settings, and depending on the whole object
  // re-ran the expiry timer and the home-arrival reset on every unrelated
  // settings edit.
  const { travel } = settings;
  const [dismissed, setDismissed] = useState(false);
  // The instant the expiry check compares against. Held in state rather than
  // read from the clock during render, so the memo below stays a pure function
  // of its inputs — and updating it is what makes that memo re-evaluate when a
  // trip runs out of days. It carries no trip identity, so a new trip needs no
  // reset: a start date is always written as "now", which is never earlier than
  // a check instant already in state.
  const [expiryCheckMs, setExpiryCheckMs] = useState(() => Date.now());

  const travelState = useMemo<TravelState>(() => {
    // Detection needs somewhere to measure from, and force_off is the opt-out.
    // It deliberately does NOT require travel.enabled: that switch defaulted to
    // off, so the feature meant to notice a journey could only ever run once the
    // user had already found and enabled it by hand. Being far from home is what
    // raises the offer now; accepting the offer is what switches travel on.
    if (!travel.homeBase || travel.override === 'force_off') {
      return defaultTravelState;
    }

    const distance = calculateDistanceKm(
      travel.homeBase.coordinates,
      location.coordinates,
    );

    let isTraveling = false;
    let isAutoDetected = false;
    let travelPending = false;

    if (travel.override === 'force_on') {
      isTraveling = true;
    } else if (distance >= travel.distanceThresholdKm) {
      if (travel.enabled && travel.autoConfirmed) {
        isTraveling = true;
        isAutoDetected = true;
      } else if (!dismissed && !travel.promptDismissed && !travel.offerSuppressed) {
        // Offer it — qasr is never applied without an explicit yes.
        travelPending = true;
      }
    }

    // Check max travel days expiration. `>=` so the trip is already expired at
    // the instant the timer below fires, rather than an epsilon after it.
    if (isTraveling && travel.maxTravelDays > 0 && travel.travelStartDate) {
      const startDate = new Date(travel.travelStartDate);
      const daysDiff = (expiryCheckMs - startDate.getTime()) / DAY_MS;
      if (daysDiff >= travel.maxTravelDays) {
        isTraveling = false;
      }
    }

    if (!isTraveling && !travelPending) {
      return {
        ...defaultTravelState,
        distanceFromHomeKm: distance,
      };
    }

    if (travelPending) {
      return {
        ...defaultTravelState,
        travelPending: true,
        distanceFromHomeKm: distance,
      };
    }

    return {
      isTraveling: true,
      travelPending: false,
      distanceFromHomeKm: distance,
      isAutoDetected,
      qasr: { dhuhr: true, asr: true, isha: true },
      jamaDhuhrAsr: travel.jamaDhuhrAsr,
      jamaMaghribIsha: travel.jamaMaghribIsha,
    };
  }, [travel, location, dismissed, expiryCheckMs]);

  // Expiry has to be re-evaluated by something that moves with the clock. The
  // memo above reads the start date, but nothing in its dependencies changes
  // with the mere passage of time, so a long-lived session never expired the
  // trip — the limit only took effect on restart or the next settings/location
  // change. Arm one timeout for the exact expiry instant rather than polling.
  useEffect(() => {
    const { travelStartDate, maxTravelDays } = travel;
    if (!travelStartDate || maxTravelDays <= 0) return;

    const start = new Date(travelStartDate).getTime();
    if (Number.isNaN(start)) return;
    const expiresAt = start + maxTravelDays * DAY_MS;

    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        setExpiryCheckMs(Date.now());
        return;
      }
      timer = setTimeout(arm, Math.min(remaining, MAX_TIMEOUT_MS));
    };
    // Deferred rather than called inline, so an already-expired trip updates the
    // check instant from the callback instead of during the effect body.
    timer = setTimeout(arm, 0);

    return () => clearTimeout(timer);
  }, [travel]);

  // Home again: forget this trip's confirmation and any "not now", so the next
  // journey is offered afresh. Deliberately keyed on being below the threshold
  // rather than on having crossed it: the previous distance lived in a ref, so
  // after a restart the first reading was always treated as "no previous" and
  // the reset was skipped — leaving a stale confirmation that would silently
  // switch qasr on at the start of the next trip, with no prompt.
  useEffect(() => {
    if (!travel.homeBase) return;

    const distance = calculateDistanceKm(
      travel.homeBase.coordinates,
      location.coordinates,
    );
    if (distance >= travel.distanceThresholdKm) return;

    // Note what this deliberately does *not* touch: offerSuppressed. Turning
    // Travel Mode off by hand used to write promptDismissed, and this effect —
    // which fires on that very same settings change, with the user normally at
    // home — cleared it again on the spot. The suppression was dead code
    // unless you switched off while already more than the threshold from home,
    // so a user who had deliberately disabled Travel Mode still got the offer
    // (and the id-1300 notification) on their next trip.
    if (travel.autoConfirmed || travel.promptDismissed) {
      updateTravel({ autoConfirmed: false, travelStartDate: null, promptDismissed: false });
    }
    if (dismissed) setDismissed(false);
  }, [travel, location, updateTravel, dismissed]);

  // Both of these change what "home" means, so the trip measured against the
  // old one is over. They have to say so explicitly: the arrived-home reset
  // early-returns on `!travel.homeBase` and only runs when the user is inside
  // the threshold, so anything left set here could not be repaired later.
  // Correcting a wrong home base while still away used to leave the offer
  // suppressed until the user physically travelled to the old one, and
  // changing home base mid-trip left travelStartDate from the previous
  // journey — measuring maxTravelDays from the wrong trip.
  function setHomeBase(home: HomeBaseLocation) {
    updateTravel({
      homeBase: home,
      travelStartDate: null,
      autoConfirmed: false,
      promptDismissed: false,
      offerSuppressed: false,
    });
    setDismissed(false);
  }

  function clearHomeBase() {
    updateTravel({
      homeBase: null,
      travelStartDate: null,
      autoConfirmed: false,
      promptDismissed: false,
      offerSuppressed: false,
    });
    setDismissed(false);
  }

  function setTravelOverride(override: TravelSettings['override']) {
    const updates: Partial<TravelSettings> = { override };
    // Forcing on starts a trip, unless one is already running: keep that
    // trip's start so the allowance isn't extended. Any other stored start is
    // left over from an earlier trip or an earlier Always On at home, and
    // keeping it expired the new trip on the spot (#47).
    if (override === 'force_on' && !travelState.isTraveling) {
      updates.travelStartDate = tripStartInstant();
    }
    updateTravel(updates);
  }

  function toggleJama(pair: 'dhuhrAsr' | 'maghribIsha') {
    if (pair === 'dhuhrAsr') {
      updateTravel({ jamaDhuhrAsr: !settings.travel.jamaDhuhrAsr });
    } else {
      updateTravel({ jamaMaghribIsha: !settings.travel.jamaMaghribIsha });
    }
  }

  function toggleTravelEnabled() {
    const newEnabled = !settings.travel.enabled;
    // No trip start here. Enabling the feature is not starting a trip, and is
    // usually done at home: stamping it measured Max Travel Days from that
    // moment. A trip's start is written when one begins, in confirmTravel or
    // on Always On.
    const updates: Partial<TravelSettings> = { enabled: newEnabled };
    // Switching it off by hand means "stop offering this" — a standing choice,
    // not this trip's "not now", so it survives coming home. Switching it back
    // on withdraws that.
    updates.offerSuppressed = !newEnabled;
    updateTravel(updates);
  }

  function confirmTravel() {
    updateTravel({
      enabled: true,
      autoConfirmed: true,
      travelStartDate: tripStartInstant(),
      promptDismissed: false,
      offerSuppressed: false,
    });
    setDismissed(false);
  }

  function dismissTravel() {
    setDismissed(true);
    // Persisted too, so "Not now" survives a restart instead of asking again.
    updateTravel({ promptDismissed: true });
  }

  return (
    <TravelContext.Provider
      value={{
        travelState,
        setHomeBase,
        clearHomeBase,
        setTravelOverride,
        toggleJama,
        toggleTravelEnabled,
        confirmTravel,
        dismissTravel,
      }}
    >
      {children}
    </TravelContext.Provider>
  );
}

export function useTravel() {
  const context = useContext(TravelContext);
  if (!context) {
    throw new Error('useTravel must be used within a TravelProvider');
  }
  return context;
}
