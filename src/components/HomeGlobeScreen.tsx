import { lazy, Suspense, useEffect, useMemo, useState } from 'react';

const HomeGlobeView = lazy(() =>
  import('./three/Scenes').then((m) => ({ default: m.HomeGlobeView }))
);

/**
 * Full-page ambient background for the Home Globe view: starfield, earth,
 * day/night terminator, live clouds. Purely visual — the header and
 * countdown HUD render on top of this as siblings in App.tsx, not inside it.
 * No location dependency: the terminator is computed from the sub-solar
 * point in absolute lat/lon space, not relative to the user.
 */
export function HomeGlobeScreen() {
  const [now, setNow] = useState(() => new Date());

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

  // Memoized so the scene only re-renders/re-ticks on the per-minute cadence
  // above, not on every second-tick re-render from the parent App component.
  const data = useMemo(() => ({ now }), [now]);

  return (
    <div
      className="absolute inset-0 z-0"
      style={{ background: 'radial-gradient(ellipse at 50% 40%, #0d1424 0%, #03050a 100%)' }}
      aria-hidden="true"
    >
      <Suspense fallback={null}>
        <HomeGlobeView data={data} style={{ display: 'block', width: '100%', height: '100%' }} fallback={null} />
      </Suspense>
    </div>
  );
}
