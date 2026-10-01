import { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Motion } from '@capacitor/motion';
import { AthanPlugin } from '../plugins/athanPlugin';
import { calculateQiblaDirection } from '../services/prayerService';
import { useLocation } from '../context/LocationContext';

/**
 * The native compass is a singleton: AthanPlugin.startCompass() registers the
 * plugin object with SensorManager, and stopCompass() does a blanket
 * unregisterListener(this). Two useQibla instances drive it — the qibla
 * overlay's and the home globe's ground view — and closing the overlay hands
 * the sensor from one to the other. Whichever order React happens to run the
 * two effects in, the leaving consumer must not be able to kill the sensor the
 * arriving one has just started, so the native calls are reference-counted
 * here: start on 0 -> 1, stop on 1 -> 0.
 *
 * (Ground view is unreachable in the shipped build — the only button that sets
 * groundMode is commented out — so this is a trap being closed rather than a
 * live bug. Note the one thing the count changes: with two consumers alive, a
 * restart for a new location never reaches 0, so the native declination would
 * not refresh. Ground view and the overlay show the same place, so that costs
 * nothing today.)
 */
let nativeCompassUsers = 0;

async function acquireNativeCompass(latitude: number, longitude: number): Promise<void> {
  nativeCompassUsers++;
  if (nativeCompassUsers !== 1) return;
  try {
    await AthanPlugin.startCompass({ latitude, longitude });
  } catch (err) {
    // startCompass rejects when the sensor service is unavailable. Give the
    // count back before rethrowing: left incremented, every later start would
    // see "someone else already holds it", skip the native call, and turn a
    // transient sensor failure into a compass that stays dead for the life of
    // the process.
    nativeCompassUsers--;
    throw err;
  }
}

function releaseNativeCompass(): void {
  if (nativeCompassUsers === 0) return;
  nativeCompassUsers--;
  if (nativeCompassUsers === 0) AthanPlugin.stopCompass();
}

interface QiblaData {
  qiblaDirection: number; // Direction to Qibla from True North
  deviceHeading: number; // Current device heading (true north)
  rotationAngle: number; // How much to rotate the compass arrow
  isCalibrated: boolean;
  accuracy: number; // 0=unreliable, 1=low, 2=medium, 3=high
  error: string | null;
}

export function useQibla() {
  const { location } = useLocation();
  const [data, setData] = useState<QiblaData>({
    qiblaDirection: 0,
    deviceHeading: 0,
    rotationAngle: 0,
    isCalibrated: false,
    accuracy: 0,
    error: null,
  });
  const [isListening, setIsListening] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  // Refs mirror the async in-flight state — checking the `isListening` state
  // alone races: two overlapping startListening calls could both pass the
  // check and register two native listeners, leaking the first.
  const listeningRef = useRef(false);
  const startingRef = useRef(false);
  // Set when stopListening() lands while startListening() is still awaiting
  // native registration: the pending start must tear its own listener down on
  // resume instead of activating one the caller already asked to stop.
  const stopRequestedRef = useRef(false);
  // Compass sensors fire faster than the screen repaints. Keep only the
  // latest reading and flush it at most once per animation frame.
  const pendingRef = useRef<QiblaData | null>(null);
  const flushRafRef = useRef(0);

  // Calculate Qibla direction based on current location
  const qiblaDirection = calculateQiblaDirection(location.coordinates);

  const scheduleFlush = useCallback(() => {
    if (flushRafRef.current) return;
    flushRafRef.current = requestAnimationFrame(() => {
      flushRafRef.current = 0;
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next) setData(next);
    });
  }, []);

  const teardown = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    listeningRef.current = false;
    setIsListening(false);
  }, []);

  const startListening = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    stopRequestedRef.current = false;

    try {
      // Restart rather than early-return when already active: the location
      // (and with it the magnetic declination fed to the native compass and
      // the qibla bearing baked into the listener) may have changed.
      if (listeningRef.current) teardown();

      const platform = Capacitor.getPlatform();
      const latitude = location.coordinates.latitude;
      const longitude = location.coordinates.longitude;

      if (platform === 'android') {
        // Android: use native SensorManager via AthanPlugin for accurate heading
        const listener = await AthanPlugin.addListener('compassHeading', (event) => {
          const heading = event.heading;
          const accuracy = event.accuracy ?? 0;
          pendingRef.current = {
            qiblaDirection,
            deviceHeading: heading,
            rotationAngle: qiblaDirection - heading,
            isCalibrated: accuracy >= 2,
            accuracy,
            error: null,
          };
          scheduleFlush();
        });

        // Pass user coordinates so native layer can compute magnetic declination
        try {
          await acquireNativeCompass(latitude, longitude);
        } catch (err) {
          // cleanupRef is not assigned yet, so this listener is the one thing
          // nothing else can reach.
          listener.remove();
          throw err;
        }

        cleanupRef.current = () => {
          listener.remove();
          releaseNativeCompass();
        };
      } else {
        // iOS: use Capacitor Motion plugin (webkitCompassHeading available)
        const handle = await Motion.addListener('orientation', (event) => {
          const compassHeading = (event as unknown as Record<string, number>).webkitCompassHeading;

          if (compassHeading !== undefined) {
            pendingRef.current = {
              qiblaDirection,
              deviceHeading: compassHeading,
              rotationAngle: qiblaDirection - compassHeading,
              isCalibrated: true,
              accuracy: 3,
              error: null,
            };
          } else {
            // No true-north reading. Without webkitCompassHeading the only
            // heading on offer is the orientation event's alpha, which on iOS
            // is measured from wherever the phone happened to point when the
            // listener started, not from north. Turning that into a heading
            // gave a confident wrong answer, and since it could never count as
            // calibrated the screen asked for a figure-8 that could not help.
            // Say the compass is unavailable instead.
            pendingRef.current = {
              qiblaDirection,
              deviceHeading: 0,
              rotationAngle: 0,
              isCalibrated: false,
              accuracy: 0,
              error: 'No true-north heading on this device',
            };
          }
          scheduleFlush();
        });

        cleanupRef.current = () => {
          handle.remove();
        };
      }

      if (stopRequestedRef.current) {
        cleanupRef.current?.();
        cleanupRef.current = null;
        return;
      }

      listeningRef.current = true;
      setIsListening(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to access motion sensors';
      setData((prev) => ({
        ...prev,
        error: message,
        isCalibrated: false,
      }));
    } finally {
      startingRef.current = false;
    }
  }, [qiblaDirection, location.coordinates.latitude, location.coordinates.longitude, scheduleFlush, teardown]);

  const stopListening = useCallback(() => {
    if (startingRef.current) stopRequestedRef.current = true;
    teardown();
  }, [teardown]);

  // Cleanup on unmount. This is the safety net for a consumer whose own effect
  // has no cleanup function, so it has to cover the same race stopListening
  // does.
  useEffect(() => {
    return () => {
      if (flushRafRef.current) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = 0;
      }
      // Arm the guard the pending start checks before it activates. During
      // `await AthanPlugin.addListener(...)` cleanupRef is still null, so
      // clearing it below cannot reach a listener that does not exist yet:
      // without this the start completed and registered with no owner left to
      // tear it down. This is the residue of the C-2 fix, which covered
      // stop-during-start but not unmount-during-start.
      if (startingRef.current) stopRequestedRef.current = true;
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      listeningRef.current = false;
    };
  }, []);

  return {
    ...data,
    qiblaDirection,
    isListening,
    startListening,
    stopListening,
  };
}
