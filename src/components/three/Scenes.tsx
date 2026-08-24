import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Base3D } from './base3d';
import { needsRelativePosition } from '../../utils/layout';
import { SunDome, type SunDomeData } from './sunDome';
import { QiblaGlobe, type QiblaGlobeData } from './qiblaGlobe';
import { HomeGlobe, type HomeGlobeData } from './homeGlobe';
import { KaabaMini } from './kaabaMini';

/**
 * React hosts for the WebGL views. Everything three.js is reachable only
 * through this module, so lazily importing it keeps the renderer out of the
 * startup bundle.
 */

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
  Scene: new (host: HTMLElement, data: T) => Base3D<T>;
  data: T;
  className?: string;
  style?: CSSProperties;
  /** Shown instead of the canvas if WebGL is unavailable. */
  fallback?: React.ReactNode;
}

function SceneHost<T>({ Scene, data, className, style, fallback = null }: SceneHostProps<T>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<Base3D<T> | null>(null);
  const dataRef = useRef(data);
  const supported = supportsWebGL();
  const [adjusted, setAdjusted] = useState(false);

  const reset = useCallback(() => {
    viewRef.current?.resetView();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !supported) return;

    let view: Base3D<T>;
    try {
      view = new Scene(host, dataRef.current);
      view.onAdjustedChange = setAdjusted;
      view.mount();
    } catch (err) {
      // Locked-down webviews can still refuse a context after probing clean.
      console.warn('3D view unavailable', err);
      return;
    }

    viewRef.current = view;
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
      {adjusted && (
        <button
          onClick={reset}
          className="absolute top-2 right-2 z-10 rounded-full px-3 py-1.5 text-xs font-medium
                     bg-[var(--color-card)] text-[var(--color-muted)]
                     border border-[var(--color-border)] shadow-sm"
        >
          Reset view
        </button>
      )}
    </div>
  );
}

export function SunDomeView(props: { data: SunDomeData; className?: string; style?: CSSProperties }) {
  return <SceneHost Scene={SunDome} {...props} />;
}

export function QiblaGlobeView(props: {
  data: QiblaGlobeData;
  className?: string;
  style?: CSSProperties;
  fallback?: React.ReactNode;
}) {
  return <SceneHost Scene={QiblaGlobe} {...props} />;
}

export function HomeGlobeView(props: {
  data: HomeGlobeData;
  className?: string;
  style?: CSSProperties;
  fallback?: React.ReactNode;
}) {
  return <SceneHost Scene={HomeGlobe} {...props} />;
}

export function KaabaMiniView(props: { className?: string; style?: CSSProperties }) {
  return <SceneHost Scene={KaabaMini} data={undefined as void} {...props} />;
}

export type { SunDomeData, QiblaGlobeData, HomeGlobeData };
