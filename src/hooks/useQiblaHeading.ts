import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { useQibla } from './useQibla';
import { headingInstruction } from '../utils/heading';

/** Below this the magnetometer reading isn't trustworthy and needs a figure-eight. */
const CALIBRATED_ACCURACY = 2;

export interface QiblaHeadingState {
  /** False off-device, where there is no magnetometer to read. */
  supported: boolean;
  /** True when the sensor exists but couldn't be read. */
  unavailable: boolean;
  calibrated: boolean;
  /** Degrees still to turn; positive is to your right. */
  rotation: number;
  aligned: boolean;
  /** Bearing to the Kaaba, degrees clockwise from true north. */
  qiblaDirection: number;
  /** Where the phone is pointing, degrees clockwise from true north. */
  deviceHeading: number;
}

/**
 * The single owner of the compass.
 *
 * Everything the qibla needs comes out of here, deliberately: useQibla's
 * reference count dedupes the *native* sensor, but each instance of it still
 * registers its own listener and holds its own state, so a second consumer
 * means every heading event lands twice. Its own note warns of a worse
 * consequence — with two alive, the count never reaches zero on a restart, so
 * the native magnetic declination would stop refreshing when you move.
 *
 * `enabled` gates the sensor: the globe this feeds stays mounted for as long
 * as the globe view is up, and running the magnetometer from launch would be
 * a permanent battery drain.
 */
export function useQiblaHeading(enabled = true): QiblaHeadingState {
  const { qiblaDirection, deviceHeading, accuracy, error, startListening, stopListening } = useQibla();
  const supported = Capacitor.isNativePlatform();
  const wasAligned = useRef(false);

  // startListening's identity tracks the coordinates, so this restarts the
  // compass when the user's location changes — which is the whole point.
  // The deps used to be [supported, enabled] behind an eslint-disable and the
  // comment "the hook re-reads location itself". That was half true: the
  // *bearing* is re-derived every render, but nothing re-invoked
  // startListening, so AthanPlugin.startCompass({latitude, longitude}) was
  // never called again and the native magnetic declination stayed at whatever
  // it was on the first start — a heading error of up to 10-20 degrees the
  // moment any in-screen location switch exists.
  useEffect(() => {
    if (!supported || !enabled) return;
    startListening();
    return () => {
      stopListening();
    };
  }, [supported, enabled, startListening, stopListening]);

  // Derived here rather than taken from the hook's `rotationAngle`: that value
  // is computed inside the sensor callback, which captured the bearing as it
  // was when the listener started. Location resolves after this screen mounts
  // (the app falls back to Makkah until GPS answers), so the captured bearing
  // goes stale. Both parts below are recomputed on every reading.
  const rotation = qiblaDirection - deviceHeading;
  const calibrated = accuracy >= CALIBRATED_ACCURACY;
  const { aligned } = headingInstruction(rotation);

  // A short buzz the moment you line up, so you don't have to watch the screen
  // while you turn.
  useEffect(() => {
    if (!supported) return;
    if (aligned && calibrated && !wasAligned.current) {
      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
    }
    wasAligned.current = aligned && calibrated;
  }, [aligned, calibrated, supported]);

  return { supported, unavailable: !!error, calibrated, rotation, aligned, qiblaDirection, deviceHeading };
}
