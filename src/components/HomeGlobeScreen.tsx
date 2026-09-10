import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation } from '../context/LocationContext';
import { useSettings } from '../context/SettingsContext';
import { twilightAnglesFor, asrShadowFactor as shadowFactorFor } from '../services/prayerService';
import { useQibla } from '../hooks/useQibla';
import { GlobeLoader, GLOBE_LOADER_FADE_MS } from './GlobeLoader';
import type { PrayerTime } from '../types';
import type { HomeGlobe } from './three/homeGlobe';

const HomeGlobeView = lazy(() =>
  import('./three/Scenes').then((m) => ({ default: m.HomeGlobeView }))
);

/**
 * Always-dark space backdrop, independent of the app's light/dark theme —
 * the globe is meant to read as a night sky regardless of theme, the same
 * reasoning that already justifies the fixed HUD colours in
 * CountdownTimer/IslamicCountdownTimer. Used both as the wrapper's own
 * background (visible while the WebGL canvas is transparent, per
 * base3d.ts's `alpha: true` renderer) and as SceneHost's `fallback`, so a
 * WebGL-unavailable device still shows an intentional dark scene instead of
 * a blank rect.
 */
const SPACE_BACKDROP = 'radial-gradient(ellipse at 50% 40%, #0d1424 0%, #03050a 70%)';

/** Glass over the night sky, matching the HUD rather than the app's cards. */
const CONTROL_CLASS = 'pointer-events-auto rounded-full px-3.5 py-2 text-[12.5px] font-medium leading-none';
const CONTROL_STYLE: CSSProperties = {
  background: 'rgba(10,15,26,0.55)',
  border: '1px solid rgba(245,246,248,0.16)',
  color: 'rgba(245,246,248,0.92)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  textShadow: '0 1px 6px rgba(0,0,0,0.6)',
};
/* Ground view is a mode, not an action — lit in the qibla line's own cyan.
   Parked alongside its commented-out button below.
const CONTROL_ACTIVE_STYLE: CSSProperties = {
  ...CONTROL_STYLE,
  background: 'rgba(34,211,238,0.18)',
  border: '1px solid rgba(34,211,238,0.5)',
  color: '#a5f3fc',
}; */

/**
 * Full-page ambient background for the Home Globe view: starfield, earth,
 * day/night terminator, solar prayer lines. Purely visual — the header and
 * countdown HUD render on top of this as siblings in App.tsx, not inside it.
 */
export function HomeGlobeScreen({ prayers, covered = false }: { prayers: PrayerTime[]; covered?: boolean }) {
  const { location } = useLocation();
  const { settings } = useSettings();
  // The globe draws a ring per solar event, and those angles come from the
  // calculation method and the Asr madhab rather than from the prayer times
  // alone — two users on different methods get different rings for one sky.
  const twilight = twilightAnglesFor(settings.calculationMethod);
  const [now, setNow] = useState(() => new Date());
  const [groundMode, setGroundMode] = useState(false);
  const { deviceHeading, qiblaDirection, accuracy, error, startListening, stopListening } = useQibla();
  const smoothRot = useRef<number | null>(null);
  const [rot, setRot] = useState(0);
  const viewRef = useRef<HomeGlobe | null>(null);
  const coveredRef = useRef(covered);
  // The loader stays up until the globe has drawn its first complete frame,
  // then fades and is unmounted (its animations must not outlive the load).
  const [surfaceReady, setSurfaceReady] = useState(false);
  const [loaderGone, setLoaderGone] = useState(false);

  useEffect(() => {
    coveredRef.current = covered;
    viewRef.current?.setCovered(covered);
  }, [covered]);

  useEffect(() => {
    if (!surfaceReady) return;
    const t = setTimeout(() => setLoaderGone(true), GLOBE_LOADER_FADE_MS);
    return () => clearTimeout(t);
  }, [surfaceReady]);

  // The sun moves a quarter of a degree a minute; a per-minute tick is
  // plenty, lined up with the start of each minute so it never drifts.
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const ms = 60000 - (Date.now() % 60000);
      timeout = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, ms);
    };
    schedule();
    return () => clearTimeout(timeout);
  }, []);

  // Run the compass only while in ground view — and not under an overlay.
  useEffect(() => {
    if (groundMode && !covered) startListening();
    else {
      stopListening();
      smoothRot.current = null;
    }
  }, [groundMode, covered, startListening, stopListening]);

  const onView = useCallback((view: HomeGlobe) => {
    viewRef.current = view;
    view.onGroundModeChange = setGroundMode;
    view.onSurfaceReady = () => setSurfaceReady(true);
    view.setCovered(coveredRef.current);
  }, []);

  // Smoothed degrees still to turn (positive = to your right). Updated in an
  // effect after commit — mutating the ref during render would be impure
  // under StrictMode's double-render. Layout (not passive) effect: entering
  // ground view would otherwise paint one frame of the stale pre-toggle angle
  // before snapping to the real heading.
  useLayoutEffect(() => {
    let rawRot = 0;
    if (groundMode && accuracy >= 2 && deviceHeading != null) {
      rawRot = ((qiblaDirection - deviceHeading + 540) % 360) - 180;
    }
    if (smoothRot.current === null) smoothRot.current = rawRot;
    else {
      let d = rawRot - smoothRot.current;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      smoothRot.current += d * 0.3;
    }
    const next = Math.round(smoothRot.current);
    setRot((prev) => (prev === next ? prev : next));
  }, [groundMode, accuracy, deviceHeading, qiblaDirection]);

  return (
    // Not aria-hidden as a whole: the view controls below are real buttons, and
    // the ground-view guidance is spoken guidance. Only the decorative layers
    // opt out.
    <div
      className="absolute inset-0 z-0"
      style={{ background: SPACE_BACKDROP, visibility: covered ? 'hidden' : 'visible' }}
    >
      {/* One scrim for the whole top HUD (header + prayer info). Snow, ice and
          desert in the satellite imagery are near-white, so light text over them
          survived on drop shadows alone; this darkens the sky it sits on and
          fades out before the earth's middle. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-[1]"
        style={{ height: 340, background: 'linear-gradient(to bottom, rgba(3,5,10,0.82) 0%, rgba(3,5,10,0.55) 45%, transparent 100%)' }}
      />
      {!loaderGone && <GlobeLoader fading={surfaceReady} />}
      <Suspense fallback={null}>
        <HomeGlobeView
          data={{
            now,
            latitude: location.coordinates.latitude,
            longitude: location.coordinates.longitude,
            prayers,
            fajrTwilightDeg: twilight.fajr,
            ishaTwilightDeg: twilight.isha,
            ishaIntervalMin: twilight.ishaIntervalMin,
            asrShadowFactor: shadowFactorFor(settings.asrCalculation),
            groundMode,
            deviceHeading,
            qiblaDirection,
          }}
          // Cross-fades in against the loader once the first complete frame
          // exists — until then the canvas holds a black sphere with the
          // prayer lines already drawn on it, which is not a globe yet.
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            opacity: surfaceReady ? 1 : 0,
            transition: `opacity ${GLOBE_LOADER_FADE_MS}ms ease-out`,
          }}
          fallback={<div className="absolute inset-0" style={{ background: SPACE_BACKDROP }} />}
          onView={onView}
        />
      </Suspense>

      {/* View controls. One cluster rather than pills in opposite corners, and
          styled for the night sky: the shared SceneHost buttons use the app's
          card colours, which render as white lozenges over the globe in a light
          theme. The wrapper stays click-through so it never eats a drag. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-5 z-10 flex justify-center gap-2 px-3">
        {/* Ground view is switched off for now — the machinery below (groundMode,
            the compass guidance, HomeGlobe's ground camera) is left intact, so
            restoring it is just this button. */}
        {/* <button
          onClick={() => setGroundMode((v) => !v)}
          className={CONTROL_CLASS}
          style={groundMode ? CONTROL_ACTIVE_STYLE : CONTROL_STYLE}
          aria-pressed={groundMode}
        >
          {groundMode ? 'Exit ground' : 'Ground view'}
        </button> */}
        <button onClick={() => viewRef.current?.focusOnLocation()} className={CONTROL_CLASS} style={CONTROL_STYLE}>
          My location
        </button>
        <button onClick={() => viewRef.current?.resetView()} className={CONTROL_CLASS} style={CONTROL_STYLE}>
          Reset view
        </button>
      </div>

      {/* Compass guidance while in ground view */}
      {groundMode && (
        <div
          className="pointer-events-none absolute top-[22%] left-1/2 z-10 -translate-x-1/2 rounded-full px-4 py-1.5 text-center text-sm font-medium"
          style={{ textShadow: '0 1px 8px rgba(0,0,0,0.9)' }}
        >
          {error ? (
            <span className="text-white/80">Compass unavailable — check location permission</span>
          ) : accuracy < 2 ? (
            <span className="text-white/80">Hold your phone flat · sweep it in a figure-8 to calibrate</span>
          ) : Math.abs(rot) < 4 ? (
            <span className="text-emerald-400">✓ Facing the Qibla</span>
          ) : (
            <span className="text-white/90">
              Turn {Math.abs(rot)}° {rot > 0 ? 'right' : 'left'}
            </span>
          )}
        </div>
      )}

      {/* Required attribution for the Esri imagery. */}
      <div
        className="absolute inset-x-0 bottom-1 px-3 z-0 text-[9px] leading-tight text-white/30 pointer-events-none select-none truncate"
        aria-hidden="true"
      >
        Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community · NASA Blue Marble
      </div>
    </div>
  );
}
