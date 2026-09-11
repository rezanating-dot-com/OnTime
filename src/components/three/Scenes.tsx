import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { needsRelativePosition } from '../../utils/layout';
import { SunDome, type SunDomeData } from './sunDome';
import { HomeGlobe, type HomeGlobeData } from './homeGlobe';

/**
 * React hosts for the WebGL views. Everything three.js is reachable only
 * through this module, so lazily importing it keeps the renderer out of the
 * startup bundle.
 */

/** Structural contract a scene class must satisfy — Base3D and globe.gl-backed
 *  views both conform to it. */
export interface SceneView<T> {
  mount(): void;
  update(data: T): void;
  dispose(): void;
  resetView(): void;
}

/**
 * Whether this device can give us a GL context at all. A property of the
 * device rather than of a render, so it's resolved once and cached.
 */
let webglSupport: boolean | null = null;
function supportsWebGL(): boolean {
  if (webglSupport === null) {
    try {
      const probe = document.createElement('canvas');
      webglSupport = !!(probe.getContext('webgl2') || probe.getContext('webgl'));
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}

interface SceneHostProps<T> {
  Scene: new (host: HTMLElement, data: T) => SceneView<T>;
  data: T;
  className?: string;
  style?: CSSProperties;
  /** Shown instead of the canvas if WebGL is unavailable. */
  fallback?: React.ReactNode;
  /** Skip the built-in controls; the caller draws its own (see HomeGlobeScreen). */
  hideControls?: boolean;
  /** Called with the mounted view, so a parent can set callbacks on it. */
  onView?: (view: SceneView<T>) => void;
}

function SceneHost<T>({ Scene, data, className, style, fallback = null, hideControls, onView }: SceneHostProps<T>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<SceneView<T> | null>(null);
  const dataRef = useRef(data);
  const onViewRef = useRef(onView);
  useEffect(() => {
    onViewRef.current = onView;
  });
  const supported = supportsWebGL();

  const reset = useCallback(() => {
    viewRef.current?.resetView();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !supported) return;

    let built: SceneView<T> | null = null;
    try {
      built = new Scene(host, dataRef.current);
      built.mount();
    } catch (err) {
      // Locked-down webviews can still refuse a context after probing clean.
      // mount() installs two controls listeners, a ResizeObserver, an
      // IntersectionObserver, a visibilitychange listener, a loading-manager
      // subscription and three canvas pointer listeners — a throw part-way
      // through leaves every one of them attached to a half-built scene that
      // nothing else can reach, so tear down what did get installed before
      // giving up. dispose() is written to tolerate a partial mount.
      console.warn('3D view unavailable', err);
      try {
        built?.dispose();
      } catch (disposeErr) {
        console.warn('3D view cleanup failed', disposeErr);
      }
      return;
    }

    const view = built;
    viewRef.current = view;
    onViewRef.current?.(view);
    return () => {
      viewRef.current = null;
      view.dispose();
    };
  }, [Scene, supported]);

  // Runs after the mount effect, so a remount always picks up the latest data
  // from the ref while mounting stays independent of data changes.
  useEffect(() => {
    dataRef.current = data;
    viewRef.current?.update(data);
  }, [data]);

  if (!supported) return <>{fallback}</>;

  // The reset button needs a positioned ancestor, but forcing position here
  // would override a caller that positions this itself.
  const addRelative = needsRelativePosition(className, style?.position);

  return (
    <div className={className} style={addRelative ? { position: 'relative', ...style } : style}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} aria-hidden="true" />
      {!hideControls && (
        <div className="absolute bottom-4 right-4 z-10 flex flex-col items-end gap-2">
          <button
            onClick={reset}
            className="rounded-full px-3 py-1.5 text-xs font-medium
                       bg-[var(--color-card)] text-[var(--color-muted)]
                       border border-[var(--color-border)] shadow-sm"
          >
            Reset view
          </button>
        </div>
      )}
    </div>
  );
}

export function SunDomeView(props: { data: SunDomeData; className?: string; style?: CSSProperties }) {
  return <SceneHost Scene={SunDome} {...props} />;
}

export function HomeGlobeView(props: {
  data: HomeGlobeData;
  className?: string;
  style?: CSSProperties;
  fallback?: React.ReactNode;
  onView?: (view: HomeGlobe) => void;
}) {
  const { onView, ...rest } = props;
  return (
    <SceneHost
      Scene={HomeGlobe}
      {...rest}
      onView={onView as unknown as (view: SceneView<HomeGlobeData>) => void}
      // The home globe styles its own cluster for the night sky — the card
      // colours here would render as white pills over it.
      hideControls
    />
  );
}

export type { SunDomeData, HomeGlobeData };
