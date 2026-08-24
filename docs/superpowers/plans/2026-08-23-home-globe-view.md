# Full-Page Home Globe View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick, at onboarding and later in Settings, between the existing prayer **List** home screen and a new full-page immersive **Globe** home screen (starfield, a live day/night earth, and real cloud cover from NASA satellite imagery), switchable anytime via a header toggle.

**Architecture:** A new top-level `Settings.homeView` field drives which of two mutually-exclusive layouts `App.tsx` renders. The Globe layout is a full-bleed background layer (`HomeGlobeScreen` → `HomeGlobeView` → a new `HomeGlobe` three.js class extending the existing `Base3D`), with the app's *existing* header and countdown components rendered on top in a new boxless "glow" style variant. No new HUD components are built — the same `CountdownTimer`/`IslamicCountdownTimer` gain a `glow` prop.

**Tech Stack:** React + TypeScript, three.js (already a dependency, via the existing `Base3D` pattern), `@capacitor/core` (`CapacitorHttp`), `@capacitor/filesystem`, `@capacitor/preferences` — all already installed, no new dependencies. Vitest + Testing Library for tests (existing setup).

**Spec:** `docs/superpowers/specs/2026-08-23-home-globe-view-design.md` — read it alongside this plan; it has the full rationale, the visual-fidelity mockup link, and the hand-verified NASA GIBS facts this plan's Task 3 codes against.

## Global Constraints

- New `Settings` field: `homeView: 'globe' | 'list'`, default `'list'` for both fresh installs and existing users (backward-compatible migration).
- No new npm dependencies of any kind.
- GIBS endpoint (hand-verified working, returns `image/jpeg` + `access-control-allow-origin: *`): `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=VIIRS_SNPP_CorrectedReflectance_TrueColor&STYLES=&FORMAT=image/jpeg&HEIGHT=512&WIDTH=1024&SRS=EPSG:4326&BBOX=-180,-90,180,90&TIME=<YYYY-MM-DD>`.
- Cloud image caching follows `src/services/athanService.ts`'s existing download pattern exactly: `CapacitorHttp.get({url, ...})` → `Filesystem.mkdir` (best-effort) + `Filesystem.writeFile` under `Directory.External`, to a **fixed filename** (overwritten each fetch, storage never grows).
- Header/HUD chrome in Globe mode is **fixed light-on-dark**, regardless of the user's chosen app theme (`light`/`dark`/`rose`/`desert`/`forest`/`ocean`) — the backdrop is always a dark starfield. The accent color (`var(--color-primary)`) is the one exception and keeps following the theme.
- The chosen HUD treatment is **glow**: no card background/border on the floating prayer info, just light-on-dark text with a soft drop shadow. (A frosted-glass alternative was compared in the design mockup and not chosen.)
- `HomeGlobeScreen` must be unmounted whenever the Qibla, Dashboard, or Settings modal is open — same rule `SunDomeCard` already follows at `App.tsx:238`, same reason (no hidden live GL context under a modal).
- Follow the codebase's established test conventions exactly: jsdom has no WebGL, so three.js scene classes (`homeGlobe.ts`) are never unit-tested directly — only their React host's data-prep is tested, by mocking `../components/three/Scenes` (see `src/__tests__/sun-dome-card.test.tsx` for the exact pattern already in use).

---

### Task 1: Home view setting

**Files:**
- Modify: `src/types/index.ts` (add `homeView` to the `Settings` interface)
- Modify: `src/context/SettingsContext.tsx` (default, migration merge, `updateHomeView`, context type)
- Test: `src/__tests__/home-view-settings.test.ts`

**Interfaces:**
- Produces: `Settings.homeView: 'globe' | 'list'`; `useSettings().updateHomeView(view: 'globe' | 'list'): void`. Every later task that reads or writes the home view uses these exact names.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/home-view-settings.test.ts`:

```ts
import { Preferences } from '@capacitor/preferences';
import { render, act } from '@testing-library/react';
import { SettingsProvider, useSettings } from '../context/SettingsContext';
import type { Settings } from '../types';

const settingsRef = { current: null as Settings | null };
const updateRef = { current: null as ((v: 'globe' | 'list') => void) | null };

function SettingsInspector() {
  const { settings, updateHomeView } = useSettings();
  settingsRef.current = settings;
  updateRef.current = updateHomeView;
  return null;
}

function renderInspector() {
  settingsRef.current = null;
  updateRef.current = null;
  return render(
    <SettingsProvider>
      <SettingsInspector />
    </SettingsProvider>,
  );
}

describe('Settings: homeView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to "list" on first launch (no saved data)', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });

    await act(async () => {
      renderInspector();
    });

    expect(settingsRef.current!.homeView).toBe('list');
  });

  it('restores a saved "globe" value', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: JSON.stringify({ homeView: 'globe' }) });

    await act(async () => {
      renderInspector();
    });

    expect(settingsRef.current!.homeView).toBe('globe');
  });

  it('fills in the default when loading settings saved before this field existed', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({
      value: JSON.stringify({ calculationMethod: 'Karachi' }),
    });

    await act(async () => {
      renderInspector();
    });

    expect(settingsRef.current!.homeView).toBe('list');
  });

  it('updateHomeView persists the new value', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });

    await act(async () => {
      renderInspector();
    });

    await act(async () => {
      updateRef.current!('globe');
    });

    expect(settingsRef.current!.homeView).toBe('globe');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/home-view-settings.test.ts`
Expected: FAIL — `updateHomeView` is not a function / `homeView` is `undefined` (the field and updater don't exist yet).

- [ ] **Step 3: Add the field to the `Settings` type**

In `src/types/index.ts`, extend the `Settings` interface (it currently ends at `designStyle: DesignStyle;`):

```ts
export interface Settings {
  calculationMethod: CalculationMethod;
  asrCalculation: AsrCalculation;
  optionalPrayers: OptionalPrayersSettings;
  notifications: NotificationSettings;
  jumuah: JumuahSettings;
  travel: TravelSettings;
  display: DisplaySettings;
  athan: AthanSettings;
  surahKahf: SurahKahfSettings;
  previousLocations: SavedLocation[];
  distanceUnit: 'miles' | 'km';
  designStyle: DesignStyle;
  homeView: 'globe' | 'list';
}
```

- [ ] **Step 4: Wire the default, migration merge, and updater in `SettingsContext.tsx`**

In `src/context/SettingsContext.tsx`, add `homeView: 'list',` to the `defaultSettings` object (right after `designStyle: 'classic',`):

```ts
const defaultSettings: Settings = {
  calculationMethod: 'NorthAmerica', // ISNA
  asrCalculation: 'Standard',
  optionalPrayers: {
    showSunrise: true,
    showMiddleOfNight: true,
    showLastThirdOfNight: true,
  },
  notifications: {
    enabled: true,
    defaultSound: 'default',
    defaultReminderMinutes: 15,
    prayers: {
      fajr: { ...defaultPrayerNotification, sound: 'adhan_fajr' },
      sunrise: { ...defaultPrayerNotification, enabled: false },
      dhuhr: { ...defaultPrayerNotification },
      asr: { ...defaultPrayerNotification },
      maghrib: { ...defaultPrayerNotification },
      isha: { ...defaultPrayerNotification },
    },
  },
  jumuah: defaultJumuahSettings,
  travel: defaultTravelSettings,
  display: defaultDisplaySettings,
  athan: defaultAthanSettings,
  surahKahf: defaultSurahKahfSettings,
  previousLocations: [],
  distanceUnit: 'miles',
  designStyle: 'classic',
  homeView: 'list',
};
```

In `loadSettings()`, add `homeView` to the merge object (right after the existing `designStyle: parsed.designStyle || 'classic',` line):

```ts
          previousLocations: parsed.previousLocations || [],
          distanceUnit: parsed.distanceUnit || 'miles',
          designStyle: parsed.designStyle || 'classic',
          homeView: parsed.homeView === 'globe' ? 'globe' : 'list',
```

Add the updater, right after `updateDesignStyle` (around line 314):

```ts
  const updateDesignStyle = useCallback((style: DesignStyle) => {
    setSettings((prev) => ({ ...prev, designStyle: style }));
  }, []);

  const updateHomeView = useCallback((view: 'globe' | 'list') => {
    setSettings((prev) => ({ ...prev, homeView: view }));
  }, []);
```

Add `updateHomeView` to the `SettingsContextType` interface (right after `updateDesignStyle: (style: DesignStyle) => void;`):

```ts
  updateDesignStyle: (style: DesignStyle) => void;
  updateHomeView: (view: 'globe' | 'list') => void;
```

Add `updateHomeView` to both the `contextValue` object and its `useMemo` dependency array (right after every `updateDesignStyle,` occurrence — there are two, one in the object and one in the deps list):

```ts
  const contextValue = useMemo(() => ({
    settings,
    updateCalculationMethod,
    updateAsrCalculation,
    updateOptionalPrayers,
    updateNotifications,
    updateDefaultSound,
    updateDefaultReminderMinutes,
    updatePrayerNotification,
    updateJumuah,
    updateTravel,
    updateSurahKahf,
    updateDisplay,
    updateAthan,
    updateDistanceUnit,
    updateDesignStyle,
    updateHomeView,
    addPreviousLocation,
    removePreviousLocation,
    isLoading,
  }), [
    settings,
    isLoading,
    updateCalculationMethod,
    updateAsrCalculation,
    updateOptionalPrayers,
    updateNotifications,
    updateDefaultSound,
    updateDefaultReminderMinutes,
    updatePrayerNotification,
    updateJumuah,
    updateTravel,
    updateSurahKahf,
    updateDisplay,
    updateAthan,
    updateDistanceUnit,
    updateDesignStyle,
    updateHomeView,
    addPreviousLocation,
    removePreviousLocation,
  ]);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/home-view-settings.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/context/SettingsContext.tsx src/__tests__/home-view-settings.test.ts
git commit -m "feat: add homeView setting (globe/list) with default and migration"
```

---

### Task 2: Sub-solar point calculation

**Files:**
- Modify: `src/services/solarGeometry.ts` (add `subSolarPoint`)
- Test: `src/__tests__/solar-geometry.test.ts` (add cases)

**Interfaces:**
- Consumes: `solarDeclination(date: Date): number` and `D2R`/`R2D` (already exist in `solarGeometry.ts`).
- Produces: `subSolarPoint(date: Date): { latitude: number; longitude: number }` — used by Task 7/8's `homeGlobe.ts` to compute the sun direction for the day/night terminator.

- [ ] **Step 1: Write the failing test**

Add to the end of `src/__tests__/solar-geometry.test.ts` (create the `describe` block; the file already exists and tests other exports from the same module — follow its existing import style, which is `import { ... } from '../services/solarGeometry';`):

```ts
import { subSolarPoint, solarDeclination } from '../services/solarGeometry';

describe('subSolarPoint', () => {
  it('matches solarDeclination for the sub-solar latitude', () => {
    const date = new Date(Date.UTC(2026, 5, 21, 12, 0, 0)); // June solstice, noon UTC
    const point = subSolarPoint(date);
    expect(point.latitude).toBeCloseTo(solarDeclination(date), 10);
  });

  it('places the sub-solar longitude near 0° at 12:00 UTC', () => {
    const date = new Date(Date.UTC(2026, 2, 20, 12, 0, 0));
    const point = subSolarPoint(date);
    expect(Math.abs(point.longitude)).toBeLessThan(1);
  });

  it('places the sub-solar longitude near 180° at 00:00 UTC', () => {
    const date = new Date(Date.UTC(2026, 2, 20, 0, 0, 0));
    const point = subSolarPoint(date);
    expect(Math.abs(Math.abs(point.longitude) - 180)).toBeLessThan(1);
  });

  it('wraps longitude to stay within [-180, 180]', () => {
    const date = new Date(Date.UTC(2026, 2, 20, 23, 0, 0)); // 23:00 UTC → expect ~-165°, not -195°
    const point = subSolarPoint(date);
    expect(point.longitude).toBeGreaterThanOrEqual(-180);
    expect(point.longitude).toBeLessThanOrEqual(180);
    expect(point.longitude).toBeCloseTo(-165, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/solar-geometry.test.ts`
Expected: FAIL — `subSolarPoint` is not exported.

- [ ] **Step 3: Implement `subSolarPoint`**

Add to the end of `src/services/solarGeometry.ts`:

```ts
/**
 * The lat/lon currently directly under the sun. Ignores the equation of
 * time (up to ~16 min real-world skew) — invisible on a globe this size,
 * and it keeps the function a one-liner off the UTC clock.
 */
export function subSolarPoint(date: Date): { latitude: number; longitude: number } {
  const latitude = solarDeclination(date);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const longitude = normalizeLongitude(-(utcHours - 12) * 15);
  return { latitude, longitude };
}

function normalizeLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/solar-geometry.test.ts`
Expected: PASS (all cases, including the pre-existing ones in the file)

- [ ] **Step 5: Commit**

```bash
git add src/services/solarGeometry.ts src/__tests__/solar-geometry.test.ts
git commit -m "feat: add subSolarPoint for the home globe's day/night terminator"
```

---

### Task 3: Cloud imagery service

**Files:**
- Create: `src/services/cloudImagery.ts`
- Test: `src/__tests__/cloud-imagery.test.ts`

**Interfaces:**
- Produces: `getCloudImagery(now: Date): Promise<CloudImageResult>` where `CloudImageResult = { base64Jpeg: string | null; date: string; source: 'fresh' | 'cached' | 'procedural' }`, and `extractCloudAlpha(image: HTMLImageElement): HTMLCanvasElement`. Task 8's `homeGlobe.ts` calls both by these exact names.

This follows `src/services/athanService.ts`'s existing download-and-cache convention (`CapacitorHttp` + `Filesystem` under `Directory.External`) rather than a plain `fetch()`, for consistency with the rest of the codebase.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/cloud-imagery.test.ts` (mirrors `src/__tests__/athan-download.test.ts`'s mocking pattern exactly):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Preferences } from '@capacitor/preferences';

const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockReadFile = vi.fn();

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
  Directory: {
    External: 'EXTERNAL',
  },
}));

const mockHttpGet = vi.fn();

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: {
    get: (...args: unknown[]) => mockHttpGet(...args),
  },
  registerPlugin: () => ({}),
}));

import { getCloudImagery } from '../services/cloudImagery';

const NOW = new Date('2026-08-23T15:00:00.000Z');
const TODAY = '2026-08-23';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Preferences.get).mockResolvedValue({ value: null });
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockReadFile.mockRejectedValue(new Error('not found'));
  mockHttpGet.mockResolvedValue({ data: 'freshbase64data' });
});

describe('getCloudImagery', () => {
  it('fetches and caches fresh imagery when nothing is cached today', async () => {
    const result = await getCloudImagery(NOW);

    expect(result).toEqual({ base64Jpeg: 'freshbase64data', date: TODAY, source: 'fresh' });
    expect(mockHttpGet).toHaveBeenCalledTimes(1);
    expect(mockHttpGet.mock.calls[0][0].url).toContain(`TIME=${TODAY}`);
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({ data: 'freshbase64data', directory: 'EXTERNAL' }),
    );
    expect(vi.mocked(Preferences.set)).toHaveBeenCalledWith({
      key: 'ontime_cloud_imagery_date',
      value: TODAY,
    });
  });

  it('returns the cached file without fetching when already cached today', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: TODAY });
    mockReadFile.mockResolvedValue({ data: 'cachedbase64data' });

    const result = await getCloudImagery(NOW);

    expect(result).toEqual({ base64Jpeg: 'cachedbase64data', date: TODAY, source: 'cached' });
    expect(mockHttpGet).not.toHaveBeenCalled();
  });

  it('falls back to a stale cached file when the fetch fails', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: '2026-08-20' });
    mockHttpGet.mockRejectedValue(new Error('network down'));
    mockReadFile.mockResolvedValue({ data: 'stalebase64data' });

    const result = await getCloudImagery(NOW);

    expect(result).toEqual({ base64Jpeg: 'stalebase64data', date: '2026-08-20', source: 'cached' });
  });

  it('falls back to procedural when there is no cache and the fetch fails', async () => {
    mockHttpGet.mockRejectedValue(new Error('offline'));
    mockReadFile.mockRejectedValue(new Error('not found'));

    const result = await getCloudImagery(NOW);

    expect(result).toEqual({ base64Jpeg: null, date: TODAY, source: 'procedural' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/cloud-imagery.test.ts`
Expected: FAIL — cannot find module `../services/cloudImagery`.

- [ ] **Step 3: Implement `cloudImagery.ts`**

Create `src/services/cloudImagery.ts`:

```ts
import { CapacitorHttp } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';

const CLOUD_SUBDIR = 'cloud-imagery';
const CLOUD_FILENAME = 'latest.jpg';
const CLOUD_PATH = `${CLOUD_SUBDIR}/${CLOUD_FILENAME}`;
const CLOUD_DATE_KEY = 'ontime_cloud_imagery_date';

/**
 * NASA GIBS TrueColor mosaic. Verified by hand: returns image/jpeg,
 * access-control-allow-origin: *, ~150KB at this resolution, and same-day
 * imagery is already available (the /best/ path auto-resolves gaps).
 * There is no clean cloud-only layer in GIBS (Cloud_Fraction renders as a
 * discrete scientific color palette, not a grayscale mask) — clouds are
 * extracted from this real photo client-side by extractCloudAlpha below.
 */
const GIBS_URL =
  'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi' +
  '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap' +
  '&LAYERS=VIIRS_SNPP_CorrectedReflectance_TrueColor' +
  '&STYLES=&FORMAT=image/jpeg&HEIGHT=512&WIDTH=1024&SRS=EPSG:4326&BBOX=-180,-90,180,90';

export interface CloudImageResult {
  /** Raw base64 JPEG data (no `data:` prefix). Null only when source is 'procedural'. */
  base64Jpeg: string | null;
  /** YYYY-MM-DD (UTC) the imagery is dated. */
  date: string;
  source: 'fresh' | 'cached' | 'procedural';
}

function utcDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

async function readCachedImage(): Promise<string | null> {
  try {
    const { data } = await Filesystem.readFile({ path: CLOUD_PATH, directory: Directory.External });
    return data as string;
  } catch {
    return null;
  }
}

export async function getCloudImagery(now: Date): Promise<CloudImageResult> {
  const today = utcDateString(now);

  const { value: cachedDate } = await Preferences.get({ key: CLOUD_DATE_KEY });
  if (cachedDate === today) {
    const cached = await readCachedImage();
    if (cached) return { base64Jpeg: cached, date: today, source: 'cached' };
  }

  try {
    // responseType: 'blob' matters here — GIBS returns binary JPEG, not text/JSON.
    // Omitting it would make CapacitorHttp's native layer decode the response as
    // text on both Android and iOS, corrupting the image bytes. athanService.ts's
    // downloadAthan sets this same option for its own binary MP3 fetch.
    const response = await CapacitorHttp.get({ url: `${GIBS_URL}&TIME=${today}`, responseType: 'blob' });
    const base64Jpeg = response.data as string;

    try {
      await Filesystem.mkdir({ path: CLOUD_SUBDIR, directory: Directory.External, recursive: true });
    } catch {
      // Directory may already exist.
    }
    await Filesystem.writeFile({ path: CLOUD_PATH, data: base64Jpeg, directory: Directory.External });
    await Preferences.set({ key: CLOUD_DATE_KEY, value: today });

    return { base64Jpeg, date: today, source: 'fresh' };
  } catch {
    const stale = await readCachedImage();
    if (stale) return { base64Jpeg: stale, date: cachedDate ?? 'unknown', source: 'cached' };
    return { base64Jpeg: null, date: today, source: 'procedural' };
  }
}

/**
 * Extracts a white-RGBA cloud mask from a real satellite photo via HSV
 * thresholding: bright, low-saturation pixels (clouds) score near 1;
 * darker or more-saturated pixels (ocean, land, vegetation) score near 0.
 * Visually verified against a real fetched GIBS image during design — the
 * extracted mask closely tracked the actual cloud swirls.
 */
export function extractCloudAlpha(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);

  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = frame.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255;
    const g = px[i + 1] / 255;
    const b = px[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const v = max;
    const s = max === 0 ? 0 : (max - min) / max;
    const cloudScore = Math.min(1, Math.max(0, v - 0.55) * Math.max(0, 0.35 - s) * 12);
    px[i] = 255;
    px[i + 1] = 255;
    px[i + 2] = 255;
    px[i + 3] = Math.round(cloudScore * 255);
  }
  ctx.putImageData(frame, 0, 0);
  return canvas;
}
```

Note: `extractCloudAlpha` has no automated unit test — jsdom has no canvas 2D implementation by default, and this codebase's existing canvas-drawing code (`earthTexture.ts`'s `buildEarthTexture`) is likewise untested for the same reason. It was visually verified during design against a real fetched image (see the spec) and gets a manual smoke check in Task 8/10.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/cloud-imagery.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/cloudImagery.ts src/__tests__/cloud-imagery.test.ts
git commit -m "feat: add cloudImagery service (GIBS fetch/cache + HSV cloud extraction)"
```

---

### Task 4: Glow HUD style variant for the countdown cards

**Files:**
- Modify: `src/components/CountdownTimer.tsx`
- Modify: `src/components/IslamicCountdownTimer.tsx`
- Test: `src/__tests__/countdown-glow.test.tsx`

**Interfaces:**
- Produces: both components accept an optional `glow?: boolean` prop (default `false`/unset = today's exact existing behavior, so no existing test in the suite is affected). Task 10's `App.tsx` passes `glow={isGlobeHome}`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/countdown-glow.test.tsx`:

```ts
import { render, screen } from '@testing-library/react';
import { CountdownTimer } from '../components/CountdownTimer';
import { IslamicCountdownTimer } from '../components/IslamicCountdownTimer';
import type { DisplaySettings } from '../types';

const display: DisplaySettings = {
  showCurrentPrayer: true,
  showNextPrayer: true,
  showSunnahCard: true,
};

const baseProps = {
  currentPrayer: 'dhuhr' as const,
  currentPrayerTime: new Date(2026, 7, 23, 13, 0, 0),
  nextPrayer: 'asr',
  nextPrayerTime: new Date(2026, 7, 23, 17, 0, 0),
  hours: 1,
  minutes: 30,
  seconds: 0,
  display,
};

describe('CountdownTimer glow variant', () => {
  it('keeps the card background by default', () => {
    const { container } = render(<CountdownTimer {...baseProps} />);
    // Plain substring check on the rendered markup — avoids escaping the
    // Tailwind arbitrary-value class's brackets/parens as a CSS selector.
    expect(container.innerHTML).toContain('bg-[var(--color-card)]');
  });

  it('drops the card background/border when glow is true', () => {
    const { container } = render(<CountdownTimer {...baseProps} glow />);
    expect(container.innerHTML).not.toContain('bg-[var(--color-card)]');
    expect(screen.getByText('Next Prayer')).toBeInTheDocument();
  });
});

describe('IslamicCountdownTimer glow variant', () => {
  it('renders the Girih-pattern card by default', () => {
    const { container } = render(<IslamicCountdownTimer {...baseProps} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('drops the Girih pattern and card chrome when glow is true', () => {
    const { container } = render(<IslamicCountdownTimer {...baseProps} glow />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText(/Next/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/countdown-glow.test.tsx`
Expected: FAIL — TypeScript error / the `glow` prop has no effect yet (the "drops the card background" assertions fail because nothing changed).

- [ ] **Step 3: Add the `glow` prop to `CountdownTimer.tsx`**

Replace the full contents of `src/components/CountdownTimer.tsx` with:

```tsx
import { useState, useEffect } from 'react';
import type { PrayerName, TravelState, DisplaySettings } from '../types';

interface CountdownTimerProps {
  currentPrayer: PrayerName | null;
  currentPrayerTime: Date | null;
  nextPrayer: string | null;
  nextPrayerTime: Date | null;
  hours: number;
  minutes: number;
  seconds: number;
  isTraveling?: boolean;
  travelState?: TravelState;
  display: DisplaySettings;
  /** Boxless style for the Home Globe view: no card chrome, text floats with a drop shadow. */
  glow?: boolean;
}

// Sunnah prayers associated with each fard prayer
const SUNNAH_PRAYERS: Record<PrayerName, { before?: string; after?: string; notes?: string }> = {
  fajr: { before: '2 rak\'at Sunnah' },
  sunrise: {},
  dhuhr: { before: '4 rak\'at Sunnah', after: '2 rak\'at Sunnah' },
  asr: { before: '4 rak\'at (optional)' },
  maghrib: { after: '2 rak\'at Sunnah' },
  isha: { after: '2 rak\'at Sunnah + Witr', notes: 'Tahajjud available until Fajr' },
};

// When traveling, drop most rawatib — keep Fajr sunnah + Witr
const SUNNAH_PRAYERS_TRAVEL: Record<PrayerName, { before?: string; after?: string; notes?: string }> = {
  fajr: { before: '2 rak\'at Sunnah' },
  sunrise: {},
  dhuhr: {},
  asr: {},
  maghrib: {},
  isha: { after: 'Witr' },
};

const GLOW_TEXT_SHADOW = '0 2px 20px rgba(0,0,0,0.75), 0 1px 3px rgba(0,0,0,0.9)';
const GLOW_TEXT = 'rgba(245,246,248,0.96)';
const GLOW_MUTED = 'rgba(245,246,248,0.6)';
const GLOW_URGENT = '#ff8a75';

export function CountdownTimer({ currentPrayer, currentPrayerTime, nextPrayer, nextPrayerTime, hours, minutes, seconds, isTraveling = false, travelState, display, glow = false }: CountdownTimerProps) {
  const formatNumber = (n: number) => n.toString().padStart(2, '0');

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const currentLabel = currentPrayer ? capitalize(currentPrayer) : null;

  // Compute next prayer label for Jama' travel mode
  let nextLabel = nextPrayer ? capitalize(nextPrayer) : null;
  if (travelState?.isTraveling && nextPrayer) {
    if (nextPrayer === 'dhuhr' && travelState.jamaDhuhrAsr) {
      nextLabel = 'Dhuhr + Asr';
    }
    if (nextPrayer === 'maghrib' && travelState.jamaMaghribIsha) {
      nextLabel = 'Maghrib + Isha';
    }
  }

  // Elapsed time since current prayer started + progress through prayer window
  const [elapsed, setElapsed] = useState({ h: 0, m: 0, s: 0 });
  const [progress, setProgress] = useState(0); // 0 to 1 representing how far through the prayer window
  useEffect(() => {
    if (!currentPrayer || !currentPrayerTime || !display.showCurrentPrayer) return;

    const update = () => {
      const now = new Date();
      const diff = Math.max(0, Math.floor((now.getTime() - currentPrayerTime.getTime()) / 1000));
      setElapsed({
        h: Math.floor(diff / 3600),
        m: Math.floor((diff % 3600) / 60),
        s: diff % 60,
      });

      // Compute progress through prayer window (0 at start, 1 at end)
      if (nextPrayerTime) {
        const totalDuration = nextPrayerTime.getTime() - currentPrayerTime.getTime();
        const elapsedDuration = now.getTime() - currentPrayerTime.getTime();
        setProgress(totalDuration > 0 ? Math.min(1, Math.max(0, elapsedDuration / totalDuration)) : 0);
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [currentPrayer, currentPrayerTime, nextPrayerTime, display.showCurrentPrayer]);

  // Red urgency only kicks in past 60% of the prayer window
  const isUrgent = progress >= 0.6;
  // Border width scales from 1px to 2px only during urgent phase (card mode only)
  const borderWidth = isUrgent ? 1 + ((progress - 0.6) / 0.4) : 1;

  const sunnahSource = isTraveling ? SUNNAH_PRAYERS_TRAVEL : SUNNAH_PRAYERS;
  const sunnahInfo = currentPrayer ? sunnahSource[currentPrayer] : null;

  // Build list of prayable prayers
  const prayablePrayers: { name: string; type: 'fard' | 'sunnah' | 'nafl'; detail?: string }[] = [];

  if (currentPrayer && currentPrayer !== 'sunrise') {
    // Add sunnah before
    if (sunnahInfo?.before) {
      prayablePrayers.push({ name: `${currentLabel} Sunnah`, type: 'sunnah', detail: sunnahInfo.before });
    }
    // Add sunnah after
    if (sunnahInfo?.after) {
      prayablePrayers.push({ name: `${currentLabel} Sunnah`, type: 'sunnah', detail: sunnahInfo.after });
    }
  }

  // During sunrise, only Duha/Ishraq is available (after sun rises ~15min)
  if (currentPrayer === 'sunrise') {
    prayablePrayers.push({ name: 'Ishraq/Duha', type: 'nafl', detail: '2-8 rak\'at (after sunrise)' });
  }

  const naflPrayer = prayablePrayers.find(p => p.type === 'nafl');
  const regularPrayers = prayablePrayers.filter(p => p.type !== 'nafl');

  const cardClass = glow ? '' : 'bg-[var(--color-card)] rounded-lg p-3 border';
  const labelColor = glow ? GLOW_MUTED : 'var(--color-muted)';
  const textColor = glow ? GLOW_TEXT : 'var(--color-text)';
  const shadow = glow ? GLOW_TEXT_SHADOW : 'none';

  return (
    <div className="space-y-3">
      {/* Current Prayer Card */}
      {display.showCurrentPrayer && currentPrayer && currentPrayer !== 'sunrise' && (
        <div
          className={`${cardClass} relative z-[45] ${
            !glow && isUrgent ? 'border-red-500/50 current-prayer-glow' : !glow ? 'border-[var(--color-border)]' : ''
          }`}
          style={!glow && isUrgent ? { borderWidth: `${borderWidth}px` } : undefined}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: labelColor, textShadow: shadow }}>
                Current Prayer
              </p>
              <p className="text-lg font-semibold" style={{ color: textColor, textShadow: shadow }}>
                {currentLabel}
              </p>
            </div>
            {currentPrayerTime ? (
              <div className="flex items-baseline gap-0.5">
                <span className="text-2xl font-bold tabular-nums" style={{ color: glow && isUrgent ? GLOW_URGENT : textColor, textShadow: shadow }}>
                  {formatNumber(elapsed.h)}
                </span>
                <span className="text-lg" style={{ color: labelColor, textShadow: shadow }}>:</span>
                <span className="text-2xl font-bold tabular-nums" style={{ color: glow && isUrgent ? GLOW_URGENT : textColor, textShadow: shadow }}>
                  {formatNumber(elapsed.m)}
                </span>
                <span className="text-lg" style={{ color: labelColor, textShadow: shadow }}>:</span>
                <span className="text-2xl font-bold tabular-nums" style={{ color: labelColor, textShadow: shadow }}>
                  {formatNumber(elapsed.s)}
                </span>
                <span className="text-xs ml-1 self-center" style={{ color: labelColor, textShadow: shadow }}>ago</span>
              </div>
            ) : (
              <span className="text-sm font-medium text-[var(--color-primary)]">Active</span>
            )}
          </div>
        </div>
      )}

      {/* Sunnah Prayers Card */}
      {display.showSunnahCard && regularPrayers.length > 0 && (
        <div className={`${cardClass} ${glow ? '' : 'border-[var(--color-border)]'}`}>
          <div className="space-y-1.5">
            {regularPrayers.map((prayer, idx) => (
              <div key={idx} className="flex items-center justify-between">
                <span className={`text-sm ${prayer.type === 'fard' ? 'font-semibold' : ''}`} style={{ color: prayer.type === 'fard' ? textColor : labelColor, textShadow: shadow }}>
                  {prayer.name}
                </span>
                {prayer.detail && (
                  <span className="text-xs" style={{ color: labelColor, textShadow: shadow }}>{prayer.detail}</span>
                )}
              </div>
            ))}
          </div>
          {sunnahInfo?.notes && (
            <p className="text-xs mt-2 italic" style={{ color: labelColor, textShadow: shadow }}>{sunnahInfo.notes}</p>
          )}
        </div>
      )}

      {/* Next Prayer Countdown Card */}
      {display.showNextPrayer && nextPrayer && (
        <div className={`${cardClass} ${glow ? '' : 'border-[var(--color-border)]'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: labelColor, textShadow: shadow }}>
                Next Prayer
              </p>
              <p className="text-lg font-semibold" style={{ color: textColor, textShadow: shadow }}>
                {nextLabel}
              </p>
            </div>
            <div className="flex items-baseline gap-0.5">
              <span className="text-2xl font-bold tabular-nums" style={{ color: textColor, textShadow: shadow }}>
                {formatNumber(hours)}
              </span>
              <span className="text-lg" style={{ color: labelColor, textShadow: shadow }}>:</span>
              <span className="text-2xl font-bold tabular-nums" style={{ color: textColor, textShadow: shadow }}>
                {formatNumber(minutes)}
              </span>
              <span className="text-lg" style={{ color: labelColor, textShadow: shadow }}>:</span>
              <span className="text-2xl font-bold tabular-nums text-[var(--color-primary)]" style={{ textShadow: shadow }}>
                {formatNumber(seconds)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Ishraq/Duha Card */}
      {display.showSunnahCard && naflPrayer && (
        <div className={`${cardClass} ${glow ? '' : 'border-[var(--color-border)]'}`}>
          <p className="text-xs uppercase tracking-wide mb-2" style={{ color: labelColor, textShadow: shadow }}>
            Optional Prayer
          </p>
          <div className="flex items-center justify-between">
            <p className="text-lg font-semibold" style={{ color: textColor, textShadow: shadow }}>
              {naflPrayer.name}
            </p>
            <p className="text-sm" style={{ color: labelColor, textShadow: shadow }}>
              {naflPrayer.detail}
            </p>
          </div>
        </div>
      )}

      {/* If no next prayer and no prayable prayers, show current time label */}
      {!nextPrayer && prayablePrayers.length === 0 && currentPrayer && (
        <div className={`${cardClass} ${glow ? '' : 'border-[var(--color-border)]'} text-center`}>
          <p className="text-sm" style={{ color: labelColor, textShadow: shadow }}>
            {currentLabel} time
          </p>
        </div>
      )}

      <style>{`
        @keyframes prayer-glow {
          0%, 100% { box-shadow: 0 0 8px rgba(239, 68, 68, 0.15), 0 0 20px rgba(239, 68, 68, 0.08); }
          50% { box-shadow: 0 0 14px rgba(239, 68, 68, 0.3), 0 0 32px rgba(239, 68, 68, 0.12); }
        }
        .current-prayer-glow {
          animation: prayer-glow 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 4: Add the `glow` prop to `IslamicCountdownTimer.tsx`**

In `src/components/IslamicCountdownTimer.tsx`, add `glow?: boolean;` to `IslamicCountdownTimerProps` (after `display: DisplaySettings;`), add `glow = false` to the destructured props, and change the return statement's two-tier card + Ishraq/fallback cards to skip the Girih background/corner ornaments/gradient card and use text-shadow instead when `glow` is true:

```tsx
interface IslamicCountdownTimerProps {
  currentPrayer: PrayerName | null;
  currentPrayerTime: Date | null;
  nextPrayer: string | null;
  nextPrayerTime: Date | null;
  hours: number;
  minutes: number;
  seconds: number;
  isTraveling?: boolean;
  travelState?: TravelState;
  display: DisplaySettings;
  /** Boxless style for the Home Globe view: no card chrome, text floats with a drop shadow. */
  glow?: boolean;
}
```

```tsx
export function IslamicCountdownTimer({ currentPrayer, currentPrayerTime, nextPrayer, nextPrayerTime, hours, minutes, seconds, isTraveling = false, travelState, display, glow = false }: IslamicCountdownTimerProps) {
```

Replace the component's `return (...)` block with:

```tsx
  const GLOW_TEXT_SHADOW = '0 2px 20px rgba(0,0,0,0.75), 0 1px 3px rgba(0,0,0,0.9)';
  const glowText = glow ? 'rgba(245,246,248,0.96)' : 'var(--color-text)';
  const glowMuted = glow ? 'rgba(245,246,248,0.6)' : 'var(--color-muted)';
  const glowShadow = glow ? GLOW_TEXT_SHADOW : 'none';

  return (
    <div className="space-y-3.5">
      {/* ─── Unified Two-Tier Card ─── */}
      {(showCurrentTier || showNextTier) && (
        <div
          className="relative rounded-[20px] overflow-hidden"
          style={glow ? undefined : {
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 12%, transparent), color-mix(in srgb, var(--color-background) 70%, transparent))',
            border: `1px solid ${isUrgent && showCurrentTier ? 'rgba(220, 90, 70, 0.45)' : 'color-mix(in srgb, var(--color-primary) 28%, transparent)'}`,
            boxShadow: isUrgent && showCurrentTier
              ? '0 0 0 1px rgba(220, 90, 70, 0.2)'
              : 'none',
          }}
        >
          {/* Girih pattern background (card mode only — reads as noise floating over the globe) */}
          {!glow && (
            <div className="absolute inset-0 opacity-35">
              <GirihBackground opacity={0.08} id="current-bg"/>
            </div>
          )}

          {/* Corner ornaments (card mode only) */}
          {!glow && (
            <>
              <div className="absolute top-2.5 left-2.5"><CornerOrnament rotate={0}/></div>
              <div className="absolute top-2.5 right-2.5"><CornerOrnament rotate={90}/></div>
              <div className="absolute bottom-2.5 left-2.5"><CornerOrnament rotate={270}/></div>
              <div className="absolute bottom-2.5 right-2.5"><CornerOrnament rotate={180}/></div>
            </>
          )}

          {/* ── Top tier: Current prayer (compact) ── */}
          {showCurrentTier && (
            <div className="relative" style={{ padding: '16px 22px 12px' }}>
              {/* Row 1: NOW label + name + Arabic + urgency badge */}
              <div className="flex justify-between items-center">
                <div className="flex items-baseline gap-2.5">
                  <div className="text-[11px] tracking-[2.5px] uppercase font-medium" style={{ fontFamily: 'Inter, system-ui', color: glowMuted, textShadow: glowShadow }}>
                    Now
                  </div>
                  <div className="text-2xl leading-none tracking-wide" style={{ fontFamily: '"Cormorant Garamond", serif', fontWeight: 500, color: glowText, textShadow: glowShadow }}>
                    {currentLabel}
                  </div>
                  {currentArabic && (
                    <div className="text-base leading-none opacity-70" style={{ fontFamily: '"Amiri", serif', color: 'var(--color-primary)', textShadow: glowShadow }}>
                      {currentArabic}
                    </div>
                  )}
                </div>
                {isUrgent && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] shrink-0 ml-2"
                    style={glow ? { textShadow: glowShadow } : { background: 'rgba(220, 90, 70, 0.15)', border: '1px solid rgba(220, 90, 70, 0.35)' }}>
                    {!glow && <div className="w-1.5 h-1.5 rounded-full bg-[#dc5a46] islamic-pulse"/>}
                    <span className="text-[10px] font-semibold tracking-wide" style={{ fontFamily: 'Inter', color: glow ? '#ff8a75' : '#e88a76' }}>
                      ENDING SOON
                    </span>
                  </div>
                )}
              </div>

              {/* Row 2: Elapsed time + Sunnah info */}
              <div className="relative flex justify-between items-center mt-2">
                {currentPrayerTime ? (
                  <div className="flex items-baseline gap-1.5">
                    <div
                      className="leading-none"
                      style={{
                        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                        fontSize: 18, fontWeight: 500, letterSpacing: 0.5,
                        fontVariantNumeric: 'tabular-nums',
                        color: isUrgent ? (glow ? '#ff8a75' : '#e88a76') : glowText,
                        textShadow: glowShadow,
                      }}
                    >
                      {formatNumber(elapsed.h)}:{formatNumber(elapsed.m)}:{formatNumber(elapsed.s)}
                    </div>
                    <div className="text-[11px]" style={{ color: glowMuted, textShadow: glowShadow }}>ago</div>
                  </div>
                ) : (
                  <span className="text-sm font-medium" style={{ color: 'var(--color-primary)', textShadow: glowShadow }}>Active</span>
                )}

                {hasSunnah && (
                  <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: glowMuted, textShadow: glowShadow }}>
                    {!glow && <CrescentStar size={12}/>}
                    {sunnah!.before > 0 && (
                      <span style={{ color: glowText }}>
                        <span className="text-sm font-semibold" style={{ fontFamily: '"Cormorant Garamond", serif' }}>{sunnah!.before}</span>
                        <span className="opacity-70 ml-1">before</span>
                      </span>
                    )}
                    {sunnah!.before > 0 && sunnah!.after > 0 && (
                      <span className="opacity-40">&middot;</span>
                    )}
                    {sunnah!.after > 0 && (
                      <span style={{ color: glowText }}>
                        <span className="text-sm font-semibold" style={{ fontFamily: '"Cormorant Garamond", serif' }}>{sunnah!.after}</span>
                        <span className="opacity-70 ml-1">after</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Progress bar (card mode only — a bare bar reads oddly floating on the globe) */}
              {!glow && (
                <div className="relative mt-2.5 h-[3px] rounded-sm" style={{ background: 'color-mix(in srgb, var(--color-text) 8%, transparent)' }}>
                  <div
                    className="absolute inset-0 rounded-sm transition-all duration-1000"
                    style={{
                      width: `${Math.min(100, progress * 100)}%`,
                      background: isUrgent
                        ? 'linear-gradient(90deg, var(--color-primary), #dc5a46)'
                        : 'linear-gradient(90deg, var(--color-primary), var(--color-text))',
                      boxShadow: isUrgent ? '0 0 10px rgba(220, 90, 70, 0.4)' : 'none',
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Separator ── */}
          {showCurrentTier && showNextTier && !glow && (
            <div className="relative h-px" style={{ background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-primary) 25%, transparent), transparent)' }}/>
          )}

          {/* ── Bottom tier: Next prayer hero countdown ── */}
          {showNextTier && (
            <div className="relative text-center" style={{ padding: '14px 22px 18px' }}>
              <div className="text-[10px] tracking-[2.5px] uppercase font-medium mb-1.5" style={{ fontFamily: 'Inter, system-ui', color: glowMuted, textShadow: glowShadow }}>
                Next &middot; {nextLabel}
                {nextArabic && (
                  <span className="ml-1.5 opacity-60" style={{ fontFamily: '"Amiri", serif', fontSize: 13, color: 'var(--color-primary)', letterSpacing: 0 }}>
                    {nextArabic}
                  </span>
                )}
              </div>
              <div style={{
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontSize: 44, letterSpacing: 2, fontWeight: 300,
                fontVariantNumeric: 'tabular-nums',
                color: glowText,
                textShadow: glowShadow,
                lineHeight: 1,
              }}>
                {formatNumber(hours)}:{formatNumber(minutes)}:{formatNumber(seconds)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Ishraq/Duha Card (standalone, only during sunrise) ─── */}
      {display.showSunnahCard && isIshraqTime && (
        <div
          className="rounded-[14px] p-3"
          style={glow ? undefined : {
            background: 'color-mix(in srgb, var(--color-primary) 4%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-primary) 12%, transparent)',
          }}
        >
          <p className="text-xs uppercase tracking-wide mb-2" style={{ fontFamily: 'Inter', color: glowMuted, textShadow: glowShadow }}>
            Optional Prayer
          </p>
          <div className="flex items-center justify-between">
            <p className="text-lg" style={{ fontFamily: '"Cormorant Garamond", serif', fontWeight: 500, color: glowText, textShadow: glowShadow }}>
              Ishraq / Duha
            </p>
            <p className="text-sm" style={{ color: glowMuted, textShadow: glowShadow }}>
              2-8 rak'at (after sunrise)
            </p>
          </div>
        </div>
      )}

      {/* Fallback */}
      {!nextPrayer && !isIshraqTime && currentPrayer && !showCurrentTier && (
        <div className="rounded-[14px] p-3 text-center" style={glow ? undefined : {
          background: 'color-mix(in srgb, var(--color-primary) 4%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-primary) 12%, transparent)',
        }}>
          <p className="text-sm" style={{ color: glowMuted, textShadow: glowShadow }}>{currentLabel} time</p>
        </div>
      )}

      <style>{`
        @keyframes islamic-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.3); }
        }
        .islamic-pulse { animation: islamic-pulse 1.2s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
```

(Everything above the `return` statement — imports, constants, the `useState`/`useEffect` elapsed/progress logic, `sunnah`/`hasSunnah`/`showCurrentTier`/`showNextTier` derivations — is unchanged from the current file.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/countdown-glow.test.tsx`
Expected: PASS (all 4 tests)

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS — no existing test (e.g. any test rendering `CountdownTimer`/`IslamicCountdownTimer` without `glow`) should have changed behavior, since `glow` defaults to `false`.

- [ ] **Step 7: Commit**

```bash
git add src/components/CountdownTimer.tsx src/components/IslamicCountdownTimer.tsx src/__tests__/countdown-glow.test.tsx
git commit -m "feat: add boxless glow style variant to both countdown timers"
```

---

### Task 5: Onboarding home view step

**Files:**
- Modify: `src/components/OnboardingScreen.tsx`
- Test: `src/__tests__/onboarding-home-view.test.tsx`

**Interfaces:**
- Consumes: `useSettings().updateHomeView` (Task 1).
- Produces: nothing new consumed by later tasks — this is a leaf UI change.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/onboarding-home-view.test.tsx`:

```tsx
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingScreen } from '../components/OnboardingScreen';
import { SettingsProvider, useSettings } from '../context/SettingsContext';
import { LocationProvider } from '../context/LocationContext';
import { TravelProvider } from '../context/TravelContext';
import type { Settings } from '../types';

const settingsRef = { current: null as Settings | null };

function SettingsCapture() {
  const { settings } = useSettings();
  settingsRef.current = settings;
  return null;
}

function renderOnboarding(onComplete: () => void) {
  settingsRef.current = null;
  return render(
    <SettingsProvider>
      <LocationProvider>
        <TravelProvider>
          <SettingsCapture />
          <OnboardingScreen onComplete={onComplete} />
        </TravelProvider>
      </LocationProvider>
    </SettingsProvider>,
  );
}

async function skipToHomeViewStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Get Started'));
  await user.click(screen.getByText('Skip for now'));
  await user.click(screen.getByText("Skip — I'll set it manually"));
}

describe('OnboardingScreen home view step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the homeView step after skipping notifications and location', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

    await act(async () => {
      renderOnboarding(onComplete);
    });
    await skipToHomeViewStep(user);

    expect(await screen.findByText('Choose Your Home Screen')).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('choosing Globe saves homeView and completes onboarding', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

    await act(async () => {
      renderOnboarding(onComplete);
    });
    await skipToHomeViewStep(user);
    await screen.findByText('Choose Your Home Screen');

    await user.click(screen.getByText('Globe'));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(settingsRef.current?.homeView).toBe('globe');
  });

  it('choosing List saves homeView and completes onboarding', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

    await act(async () => {
      renderOnboarding(onComplete);
    });
    await skipToHomeViewStep(user);
    await screen.findByText('Choose Your Home Screen');

    await user.click(screen.getByText('List'));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(settingsRef.current?.homeView).toBe('list');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/onboarding-home-view.test.tsx`
Expected: FAIL — "Choose Your Home Screen" never appears (`skipLocation`/the locating handlers currently call `onComplete` directly).

- [ ] **Step 3: Implement the new step**

In `src/components/OnboardingScreen.tsx`:

Extend the step union and destructure `updateHomeView`:

```tsx
export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [step, setStep] = useState<'welcome' | 'notifications' | 'location' | 'locating' | 'homeView'>('welcome');

  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const { refreshLocation } = useLocation();
  const { addPreviousLocation, updateHomeView } = useSettings();
  const { setHomeBase } = useTravel();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

Reroute all four completion paths in `handleLocationPermission` and `skipLocation` from `onComplete` to `'homeView'`:

```tsx
  async function handleLocationPermission() {
    setStep('locating');
    setElapsed(0);

    // Start elapsed timer
    timerRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    try {
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted') {
        const result = await Geolocation.requestPermissions();
        if (result.location === 'denied') {
          if (timerRef.current) clearInterval(timerRef.current);
          setLocationStatus('Location denied — you can set it manually in Settings.');
          setTimeout(() => setStep('homeView'), 1500);
          return;
        }
      }
      setLocationStatus('Finding your location...');
      const loc = await refreshLocation();
      if (timerRef.current) clearInterval(timerRef.current);
      if (loc) {
        addPreviousLocation({
          coordinates: loc.coordinates,
          cityName: loc.cityName,
          countryCode: loc.countryCode,
          savedAt: new Date().toISOString(),
        });
        setHomeBase({
          coordinates: loc.coordinates,
          cityName: loc.cityName,
          countryCode: loc.countryCode,
        });
      }
      setLocationStatus('Location found!');
      setTimeout(() => setStep('homeView'), 600);
    } catch {
      if (timerRef.current) clearInterval(timerRef.current);
      setLocationStatus('Could not get location — you can set it in Settings.');
      setTimeout(() => setStep('homeView'), 1500);
    }
  }

  function skipLocation() {
    if (timerRef.current) clearInterval(timerRef.current);
    setStep('homeView');
  }
```

Add the new step's JSX, right after the `'locating'` step block and before the closing `</div>` that wraps all steps (i.e. right before line 215's `</div>` in the original file):

```tsx
        {step === 'homeView' && (
          <div className="animate-fade-in">
            <h2 className="text-2xl font-bold text-[var(--color-text)] mb-2">Choose Your Home Screen</h2>
            <p className="text-[var(--color-muted)] mb-8 leading-relaxed">
              You can always switch later from the header or Settings.
            </p>
            <button
              onClick={() => { updateHomeView('globe'); onComplete(); }}
              className="w-full py-4 mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] text-left px-4"
            >
              <div className="text-lg font-semibold text-[var(--color-text)]">Globe</div>
              <div className="text-sm text-[var(--color-muted)] mt-0.5">
                A full-page immersive view — stars, a live earth, and real cloud cover
              </div>
            </button>
            <button
              onClick={() => { updateHomeView('list'); onComplete(); }}
              className="w-full py-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] text-left px-4"
            >
              <div className="text-lg font-semibold text-[var(--color-text)]">List</div>
              <div className="text-sm text-[var(--color-muted)] mt-0.5">
                Today's dashboard — the prayer list, front and center
              </div>
            </button>
          </div>
        )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/onboarding-home-view.test.tsx`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/OnboardingScreen.tsx src/__tests__/onboarding-home-view.test.tsx
git commit -m "feat: add home view (globe/list) choice as an onboarding step"
```

---

### Task 6: Settings modal home view picker

**Files:**
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/__tests__/settings-interactions.test.tsx` (add cases)

**Interfaces:**
- Consumes: `useSettings().updateHomeView` (Task 1).

- [ ] **Step 1: Write the failing test**

Add to the end of the `describe('User story: I can customize my app settings', ...)` block in `src/__tests__/settings-interactions.test.tsx` (right before its closing `});`):

```tsx
  it('shows the home view picker with Globe and List options', async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderSettingsModal();
    });

    const appearanceItem = await screen.findByText('Appearance');
    await user.click(appearanceItem);

    const globe = await screen.findByText('Globe');
    const list = await screen.findByText('List');
    expect(globe).toBeInTheDocument();
    expect(list).toBeInTheDocument();
  });

  it('switching to Globe home view updates the setting', async () => {
    const user = userEvent.setup();
    let result: ReturnType<typeof renderSettingsModal>;

    await act(async () => {
      result = renderSettingsModal({ homeView: 'list' });
    });

    const appearanceItem = await screen.findByText('Appearance');
    await user.click(appearanceItem);

    const globeBtn = await screen.findByText('Globe');
    await user.click(globeBtn);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result!.getCaptured()!.homeView).toBe('globe');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/settings-interactions.test.tsx`
Expected: FAIL — no "Globe"/"List" text in the Appearance sub-page yet.

- [ ] **Step 3: Add the picker**

In `src/components/SettingsModal.tsx`, add `updateHomeView` to the `useSettings()` destructure:

```tsx
  const {
    settings,
    updateCalculationMethod,
    updateAsrCalculation,
    updateOptionalPrayers,
    updateNotifications,
    updatePrayerNotification,
    updateJumuah,
    updateSurahKahf,
    updateDisplay,
    updateAthan,
    updateDistanceUnit,
    updateDesignStyle,
    updateHomeView,
    addPreviousLocation,
    removePreviousLocation,
  } = useSettings();
```

Add a new picker block right after the existing "Design Style" block (after its closing `</div>` and before the "Display Cards" comment):

```tsx
            {/* Home View */}
            <div>
              <label className="block text-sm text-[var(--color-muted)] mb-2">Home View</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => updateHomeView('globe')}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    settings.homeView === 'globe'
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                      : 'border-[var(--color-border)] bg-[var(--color-card)]'
                  }`}
                >
                  <div className="text-sm font-medium text-[var(--color-text)]">Globe</div>
                  <div className="text-xs text-[var(--color-muted)] mt-0.5">Immersive full-page view</div>
                </button>
                <button
                  onClick={() => updateHomeView('list')}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    settings.homeView === 'list'
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                      : 'border-[var(--color-border)] bg-[var(--color-card)]'
                  }`}
                >
                  <div className="text-sm font-medium text-[var(--color-text)]">List</div>
                  <div className="text-xs text-[var(--color-muted)] mt-0.5">Today's dashboard</div>
                </button>
              </div>
            </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/settings-interactions.test.tsx`
Expected: PASS (all cases, including the two new ones and the pre-existing design-style ones)

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsModal.tsx src/__tests__/settings-interactions.test.tsx
git commit -m "feat: add home view picker to Settings > Appearance"
```

---

### Task 7: HomeGlobe scene — starfield, earth, day/night terminator

**Files:**
- Create: `src/components/three/homeGlobe.ts`

**Interfaces:**
- Consumes: `Base3D`, `THREE` (from `./base3d`); `buildEarthTexture` (from `./earthTexture`); `subSolarPoint`, `latLonToVec3`, `normalize`, `type Vec3` (from `../../services/solarGeometry`, Task 2).
- Produces: `export class HomeGlobe extends Base3D<HomeGlobeData>` and `export interface HomeGlobeData { now: Date }`. Task 8 extends this same file/class; Task 9's `Scenes.tsx` imports both names.

No automated unit test for this task — jsdom has no WebGL, and this codebase's existing three.js scene classes (`qiblaGlobe.ts`, `sunDome.ts`) are likewise untested directly (see Global Constraints). Correctness is verified by `npm run build`'s type-check and, once Task 10 wires it into the app, by manual device smoke testing.

- [ ] **Step 1: Implement `homeGlobe.ts`**

Create `src/components/three/homeGlobe.ts`:

```ts
import { Base3D, THREE } from './base3d';
import { buildEarthTexture } from './earthTexture';
import { subSolarPoint, latLonToVec3, normalize, type Vec3 } from '../../services/solarGeometry';

export interface HomeGlobeData {
  now: Date;
}

const STAR_COUNT = 1400;
const STAR_RADIUS = 40;
const NIGHT_COLOR = new THREE.Color('#0a1020');
/** Radians per second — a full rotation takes roughly 6.5 minutes. Slow, ambient. */
const EARTH_SPIN_SPEED = 0.016;

const v3 = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);

/** A 1x1 neutral-gray placeholder so the day/night shader always has a valid sampler bound. */
function placeholderTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([80, 80, 80, 255]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Full-page ambient globe for the Home screen: a starfield, a rotating earth
 * with real coastlines, and a live day/night terminator computed from the
 * actual sun position. No qibla/compass logic — this is the ambient view,
 * not a direction-finding tool (see QiblaGlobe for that).
 */
export class HomeGlobe extends Base3D<HomeGlobeData> {
  private earth!: THREE.Mesh;
  private earthMaterial!: THREE.ShaderMaterial;
  private textureToken = 0;

  protected build(): void {
    this.camera.position.set(0, 0.15, 3.4);
    this.buildStarfield();
    this.buildEarth();
  }

  protected configureControls(): void {
    this.controls.autoRotate = false; // the earth spins on its own in tick(); autoRotate would double it
    this.controls.minDistance = 2;
    this.controls.maxDistance = 6;
  }

  protected tick(seconds: number): void {
    this.earth.rotation.y = seconds * EARTH_SPIN_SPEED;
    this.updateSunDirection();
  }

  protected onData(): void {
    this.updateSunDirection();
  }

  protected applyColors(): void {
    this.refreshEarthTexture();
  }

  private buildStarfield(): void {
    const positions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      // Uniform random point on a sphere shell (Marsaglia-style: uniform u,v avoids pole clustering).
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      positions[i * 3] = STAR_RADIUS * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = STAR_RADIUS * Math.cos(phi);
      positions[i * 3 + 2] = STAR_RADIUS * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: '#ffffff', size: 0.045, sizeAttenuation: true });
    this.scene.add(new THREE.Points(geometry, material));
  }

  private buildEarth(): void {
    this.earthMaterial = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: placeholderTexture() },
        sunDirection: { value: new THREE.Vector3(0, 0, 1) },
        nightColor: { value: NIGHT_COLOR },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        void main() {
          vUv = uv;
          // Deliberately the raw OBJECT-space normal, not normalMatrix * normal
          // (which would put it in view space). sunDirection below is computed
          // in that same object-space frame (the earth's un-spun local frame),
          // so both sides of the fragment shader's dot product must match —
          // transforming just one of them would compare vectors in different
          // spaces and make the terminator drift with camera orbit and spin.
          vNormal = normal;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D dayMap;
        uniform vec3 sunDirection;
        uniform vec3 nightColor;
        varying vec2 vUv;
        varying vec3 vNormal;
        void main() {
          vec4 dayColor = texture2D(dayMap, vUv);
          float ndotl = dot(normalize(vNormal), normalize(sunDirection));
          float lightAmount = smoothstep(-0.15, 0.15, ndotl);
          vec3 color = mix(nightColor, dayColor.rgb, lightAmount);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), this.earthMaterial);
    this.scene.add(this.earth);
    this.refreshEarthTexture();
  }

  /** Redraw the coastline map in the current theme's colours. */
  private refreshEarthTexture(): void {
    const C = this.colors;
    const token = ++this.textureToken;
    buildEarthTexture({ ocean: C.card, land: C.muted, coast: C.muted, graticule: C.muted })
      .then((texture) => {
        if (token !== this.textureToken) {
          texture.dispose();
          return;
        }
        const prev = this.earthMaterial.uniforms.dayMap.value as THREE.Texture;
        prev?.dispose();
        this.earthMaterial.uniforms.dayMap.value = texture;
        this.earthMaterial.needsUpdate = true;
      })
      .catch((err) => console.warn('earth texture unavailable', err));
  }

  /** Recompute the sun direction in the earth mesh's current (spinning) local frame. */
  private updateSunDirection(): void {
    const { latitude, longitude } = subSolarPoint(this.data.now);
    const worldSun = v3(normalize(latLonToVec3(latitude, longitude)));
    const localSun = worldSun.clone().applyQuaternion(this.earth.quaternion.clone().invert());
    this.earthMaterial.uniforms.sunDirection.value.copy(localSun);
  }

  /**
   * Base3D.dispose() generically disposes each mesh's `.material.map`, but
   * this earth's texture lives in a ShaderMaterial uniform instead — the
   * generic path never sees it, so it would leak GPU memory on every
   * Home-screen unmount otherwise.
   */
  dispose(): void {
    (this.earthMaterial?.uniforms.dayMap.value as THREE.Texture | undefined)?.dispose();
    super.dispose();
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (this also confirms `Base3D`'s protected members — `scene`, `camera`, `controls`, `colors`, `data` — are used with correct types, matching `qiblaGlobe.ts`'s usage of the same base class).

- [ ] **Step 3: Commit**

```bash
git add src/components/three/homeGlobe.ts
git commit -m "feat: add HomeGlobe scene (starfield, earth, live day/night terminator)"
```

---

### Task 8: HomeGlobe scene — live cloud shell

**Files:**
- Modify: `src/components/three/homeGlobe.ts`

**Interfaces:**
- Consumes: `getCloudImagery`, `extractCloudAlpha` (from `../../services/cloudImagery`, Task 3).

No automated unit test, for the same reason as Task 7.

- [ ] **Step 1: Add the cloud shell**

In `src/components/three/homeGlobe.ts`, add the import:

```ts
import { getCloudImagery, extractCloudAlpha } from '../../services/cloudImagery';
```

Add a private field and call `buildCloudShell()`/`refreshClouds()` from `build()`:

```ts
export class HomeGlobe extends Base3D<HomeGlobeData> {
  private earth!: THREE.Mesh;
  private earthMaterial!: THREE.ShaderMaterial;
  private cloudMesh!: THREE.Mesh;
  private cloudMaterial!: THREE.MeshBasicMaterial;
  private textureToken = 0;
  private cloudToken = 0;

  protected build(): void {
    this.camera.position.set(0, 0.15, 3.4);
    this.buildStarfield();
    this.buildEarth();
    this.buildCloudShell();
    this.refreshClouds();
  }
```

Add the two new private methods (place them after `refreshEarthTexture`):

```ts
  private buildCloudShell(): void {
    this.cloudMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(1.012, 96, 64), this.cloudMaterial);
    this.scene.add(this.cloudMesh);
  }

  /**
   * Fetches (or reuses the day's cached) real satellite imagery and extracts
   * a cloud-only alpha mask from it. Called once per mount — a decorative
   * feature doesn't need to re-check within a session; the next app launch
   * re-checks naturally. Fails silently (clouds just stay invisible) since
   * the globe must never block or error on network conditions.
   */
  private refreshClouds(): void {
    const token = ++this.cloudToken;
    getCloudImagery(this.data.now)
      .then((result) => {
        if (token !== this.cloudToken) return;
        if (result.source === 'procedural' || !result.base64Jpeg) {
          this.cloudMaterial.opacity = 0;
          return;
        }
        const img = new Image();
        img.onload = () => {
          if (token !== this.cloudToken) return;
          const canvas = extractCloudAlpha(img);
          const texture = new THREE.CanvasTexture(canvas);
          this.cloudMaterial.map?.dispose();
          this.cloudMaterial.map = texture;
          this.cloudMaterial.opacity = 1;
          this.cloudMaterial.needsUpdate = true;
        };
        img.src = `data:image/jpeg;base64,${result.base64Jpeg}`;
      })
      .catch((err) => console.warn('cloud imagery unavailable', err));
  }
```

Keep the cloud shell rotating with the earth so cloud positions stay pinned to real lat/lon rather than drifting independently — this is the earth's own `tick()`, unchanged from Task 7, but now also needs to spin the cloud mesh:

```ts
  protected tick(seconds: number): void {
    this.earth.rotation.y = seconds * EARTH_SPIN_SPEED;
    this.cloudMesh.rotation.y = seconds * EARTH_SPIN_SPEED;
    this.updateSunDirection();
  }
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/three/homeGlobe.ts
git commit -m "feat: add live cloud shell to HomeGlobe, sourced from NASA GIBS"
```

---

### Task 9: HomeGlobeScreen React host

**Files:**
- Modify: `src/components/three/Scenes.tsx` (add `HomeGlobeView` export)
- Create: `src/components/HomeGlobeScreen.tsx`
- Test: `src/__tests__/home-globe-screen.test.tsx`

**Interfaces:**
- Consumes: `HomeGlobe`, `HomeGlobeData` (from `./three/homeGlobe`, Tasks 7–8). No location data — the terminator is computed from the sub-solar point in absolute lat/lon space (Task 2), not relative to the user, so this component needs no `LocationContext` dependency at all.
- Produces: `export function HomeGlobeScreen(): JSX.Element` — Task 10's `App.tsx` renders this directly, no props.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/home-globe-screen.test.tsx` (mirrors `src/__tests__/sun-dome-card.test.tsx`'s mocking pattern, minus the location provider `SunDomeCard` needs and this component doesn't):

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { HomeGlobeScreen } from '../components/HomeGlobeScreen';

const received: unknown[] = [];
vi.mock('../components/three/Scenes', () => ({
  HomeGlobeView: (props: { data: unknown }) => {
    received.push(props.data);
    return <div data-testid="home-globe" />;
  },
}));

const renderScreen = () => render(<HomeGlobeScreen />);

describe('HomeGlobeScreen', () => {
  beforeEach(() => {
    received.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts the globe once the lazy chunk resolves', async () => {
    renderScreen();
    await waitFor(() => expect(received.length).toBeGreaterThan(0));
  });

  it('passes a live Date to the scene', async () => {
    renderScreen();
    await waitFor(() => expect(received.length).toBeGreaterThan(0));
    const data = received[received.length - 1] as { now: Date };
    expect(data.now).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/home-globe-screen.test.tsx`
Expected: FAIL — cannot find module `../components/HomeGlobeScreen`.

- [ ] **Step 3: Export `HomeGlobeView` from `Scenes.tsx`**

In `src/components/three/Scenes.tsx`, add the import and export (following the exact `QiblaGlobeView` pattern already in the file):

```tsx
import { HomeGlobe, type HomeGlobeData } from './homeGlobe';
```

```tsx
export function HomeGlobeView(props: {
  data: HomeGlobeData;
  className?: string;
  style?: CSSProperties;
  fallback?: React.ReactNode;
}) {
  return <SceneHost Scene={HomeGlobe} {...props} />;
}
```

And add `HomeGlobeData` to the file's final `export type { ... }` line:

```tsx
export type { SunDomeData, QiblaGlobeData, HomeGlobeData };
```

- [ ] **Step 4: Implement `HomeGlobeScreen.tsx`**

Create `src/components/HomeGlobeScreen.tsx` (mirrors `SunDomeCard.tsx`'s per-minute tick and lazy-import pattern, but renders full-bleed instead of inside a card):

```tsx
import { lazy, Suspense, useEffect, useState } from 'react';

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

  return (
    <div className="absolute inset-0 z-0" aria-hidden="true">
      <Suspense fallback={null}>
        <HomeGlobeView data={{ now }} style={{ display: 'block', width: '100%', height: '100%' }} />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/home-globe-screen.test.tsx`
Expected: PASS (both tests)

- [ ] **Step 6: Commit**

```bash
git add src/components/three/Scenes.tsx src/components/HomeGlobeScreen.tsx src/__tests__/home-globe-screen.test.tsx
git commit -m "feat: add HomeGlobeScreen full-bleed React host for the globe scene"
```

---

### Task 10: App.tsx integration

**Files:**
- Modify: `src/App.tsx`
- Test: `src/__tests__/home-view-switching.test.tsx`

**Interfaces:**
- Consumes: `settings.homeView`, `updateHomeView` (Task 1); `HomeGlobeScreen` (Task 9); `glow` prop on `CountdownTimer`/`IslamicCountdownTimer` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/home-view-switching.test.tsx` (mirrors `src/__tests__/design-switching.test.tsx`'s full-App-render pattern exactly, plus mocks `HomeGlobeScreen` the way `sun-dome-card.test.tsx` mocks `Scenes` — one layer down, kept out of this test's concern):

```tsx
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Preferences } from '@capacitor/preferences';
import App from '../App';
import { ThemeProvider } from '../context/ThemeContext';
import { SettingsProvider } from '../context/SettingsContext';
import { LocationProvider } from '../context/LocationContext';
import { TravelProvider } from '../context/TravelContext';

vi.mock('../plugins/athanPlugin', () => ({
  AthanPlugin: {
    createAthanChannel: vi.fn().mockResolvedValue(undefined),
    deleteChannel: vi.fn().mockResolvedValue(undefined),
    playPreview: vi.fn().mockResolvedValue(undefined),
    stopPreview: vi.fn().mockResolvedValue(undefined),
    getExternalFilesDir: vi.fn().mockResolvedValue({ path: '/data/files' }),
    canScheduleExactAlarms: vi.fn().mockResolvedValue({ value: true }),
    openExactAlarmSettings: vi.fn().mockResolvedValue(undefined),
    isIgnoringBatteryOptimizations: vi.fn().mockResolvedValue({ value: true }),
    requestIgnoreBatteryOptimizations: vi.fn().mockResolvedValue(undefined),
    startCompass: vi.fn().mockResolvedValue(undefined),
    stopCompass: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  },
}));

vi.mock('../components/HomeGlobeScreen', () => ({
  HomeGlobeScreen: () => <div data-testid="home-globe-screen" />,
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

function renderApp(savedSettings?: Record<string, unknown>) {
  vi.mocked(Preferences.get).mockImplementation(async ({ key }) => {
    if (key === 'ontime_onboarding_complete') return { value: 'true' };
    if (key === 'ontime_settings' && savedSettings) return { value: JSON.stringify(savedSettings) };
    if (key === 'ontime_location') {
      return {
        value: JSON.stringify({
          coordinates: { latitude: 43.6532, longitude: -79.3832 },
          cityName: 'Toronto',
          countryCode: 'CA',
        }),
      };
    }
    return { value: null };
  });

  return render(
    <ThemeProvider>
      <SettingsProvider>
        <LocationProvider>
          <TravelProvider>
            <App />
          </TravelProvider>
        </LocationProvider>
      </SettingsProvider>
    </ThemeProvider>,
  );
}

describe('User story: I can switch between List and Globe home views', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the prayer list and no globe layer by default', async () => {
    await act(async () => {
      renderApp({ homeView: 'list' });
    });

    expect(screen.queryByTestId('home-globe-screen')).not.toBeInTheDocument();
    const toggle = await screen.findByLabelText('Switch to globe view');
    expect(toggle).toBeInTheDocument();
  });

  it('shows the globe layer and hides the prayer list when homeView is globe', async () => {
    await act(async () => {
      renderApp({ homeView: 'globe' });
    });

    expect(await screen.findByTestId('home-globe-screen')).toBeInTheDocument();
    const toggle = await screen.findByLabelText('Switch to list view');
    expect(toggle).toBeInTheDocument();
  });

  it('the header toggle switches between views', async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderApp({ homeView: 'list' });
    });

    const toggle = await screen.findByLabelText('Switch to globe view');
    await user.click(toggle);

    expect(await screen.findByTestId('home-globe-screen')).toBeInTheDocument();
  });

  it('hides the globe layer while the Qibla compass is open', async () => {
    const user = userEvent.setup();

    await act(async () => {
      renderApp({ homeView: 'globe' });
    });
    await screen.findByTestId('home-globe-screen');

    const qiblaBtn = screen.getByLabelText('Open qibla compass');
    await user.click(qiblaBtn);

    expect(screen.queryByTestId('home-globe-screen')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/home-view-switching.test.tsx`
Expected: FAIL — no `Switch to globe view` / `Switch to list view` button exists yet, and `HomeGlobeScreen` never renders.

- [ ] **Step 3: Wire it up in `App.tsx`**

Add the import (with the other component imports, near `SunDomeCard`):

```tsx
import { HomeGlobeScreen } from './components/HomeGlobeScreen';
```

After `const { settings } = useSettings();`, also destructure the updater:

```tsx
  const { settings, updateHomeView } = useSettings();
```

Right after `const isIslamic = settings.designStyle === 'islamic';` (which comes after the onboarding early-return), add:

```tsx
  const isGlobeHome = settings.homeView === 'globe';
  const showGlobeLayer = isGlobeHome && !isQiblaOpen && !isDashboardOpen && !isSettingsOpen;
  const headerGlowVars = isGlobeHome
    ? ({ '--color-muted': 'rgba(245,246,248,0.65)', '--color-text': 'rgba(245,246,248,0.95)' } as React.CSSProperties)
    : undefined;
  const headerGlowBg: React.CSSProperties | undefined = isGlobeHome
    ? { background: 'linear-gradient(to bottom, rgba(3,5,10,0.5), transparent)', backdropFilter: 'blur(6px)' }
    : undefined;
```

(No `import React` or `import type { CSSProperties }` needed — `App.tsx` already imports named values from `'react'`, which is enough for `@types/react`'s ambient `React` namespace to resolve `React.CSSProperties` as a type; `Scenes.tsx`'s existing `fallback?: React.ReactNode` relies on the exact same mechanism without importing `React` either. Verified by compiling a scratch file against this project's `tsconfig.json`.)

Render `HomeGlobeScreen` as a full-bleed sibling right after the `GirihBackground` block and before the `max-w-lg` column:

```tsx
      {/* Islamic design: full-screen girih pattern + vignette */}
      {isIslamic && (
        <>
          <div className="absolute inset-0 z-0">
            <GirihBackground opacity={0.04} id="screen-bg"/>
          </div>
          <div className="absolute inset-0 z-0 pointer-events-none" style={{
            background: 'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.08) 100%)',
          }}/>
        </>
      )}

      {showGlobeLayer && <HomeGlobeScreen />}

      <div className="max-w-lg mx-auto w-full flex-1 overflow-y-auto relative z-10">
```

Apply the header background/color overrides to both header variants. The islamic header's `<header>` tag becomes:

```tsx
          <header className="sticky top-0 z-40 safe-area-top px-5 pt-2 pb-3.5 flex items-center justify-between" style={{ ...headerGlowVars, ...(headerGlowBg ?? { background: 'var(--color-background)' }) }}>
```

The classic header's `<header>` tag becomes:

```tsx
          <header className={`sticky top-0 z-40 safe-area-top px-4 pt-2 pb-3 flex items-center justify-between ${isGlobeHome ? '' : 'bg-[var(--color-background)]'}`} style={{ ...headerGlowVars, ...headerGlowBg }}>
```

Add the new toggle button to the islamic header's right-side icon group (inside `<div className="flex gap-2">`, after the Qibla button and before the Dashboard button):

```tsx
              <button
                onClick={() => updateHomeView(isGlobeHome ? 'list' : 'globe')}
                className="flex items-center justify-center"
                style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: 'color-mix(in srgb, var(--color-primary) 6%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-primary) 15%, transparent)',
                }}
                aria-label={isGlobeHome ? 'Switch to list view' : 'Switch to globe view'}
              >
                {isGlobeHome ? (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="1.6">
                    <path strokeLinecap="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
                  </svg>
                ) : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="1.6">
                    <circle cx="12" cy="12" r="9"/>
                    <path d="M3 12h18M12 3c2.5 2.5 4 5.5 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.5-4-9s1.5-6.5 4-9z"/>
                  </svg>
                )}
              </button>
```

Add the equivalent to the classic header's right-side icon group (inside `<div className="flex items-center gap-1">`, after the Qibla button and before the Dashboard button):

```tsx
              <button
                onClick={() => updateHomeView(isGlobeHome ? 'list' : 'globe')}
                className="p-2 rounded-full hover:bg-[var(--color-card)] transition-colors"
                aria-label={isGlobeHome ? 'Switch to list view' : 'Switch to globe view'}
              >
                {isGlobeHome ? (
                  <svg className="w-5 h-5 text-[var(--color-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                    <path strokeLinecap="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-[var(--color-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                    <circle cx="12" cy="12" r="9"/>
                    <path d="M3 12h18M12 3c2.5 2.5 4 5.5 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.5-4-9s1.5-6.5 4-9z"/>
                  </svg>
                )}
              </button>
```

Hide `SunDomeCard` in Globe mode too (extend its existing guard):

```tsx
        {!isGlobeHome && !isQiblaOpen && !isDashboardOpen && !isSettingsOpen && <SunDomeCard prayers={prayers} />}
```

Pass `glow={isGlobeHome}` to both countdown components:

```tsx
            {isIslamic ? (
              <IslamicCountdownTimer
                currentPrayer={currentPrayer}
                currentPrayerTime={currentPrayer ? prayers.find(p => p.name === currentPrayer)?.time ?? null : null}
                nextPrayer={nextPrayer}
                nextPrayerTime={nextPrayerTime}
                hours={countdown.hours}
                minutes={countdown.minutes}
                seconds={countdown.seconds}
                isTraveling={travelState.isTraveling}
                travelState={travelState}
                display={settings.display}
                glow={isGlobeHome}
              />
            ) : (
              <CountdownTimer
                currentPrayer={currentPrayer}
                currentPrayerTime={currentPrayer ? prayers.find(p => p.name === currentPrayer)?.time ?? null : null}
                nextPrayer={nextPrayer}
                nextPrayerTime={nextPrayerTime}
                hours={countdown.hours}
                minutes={countdown.minutes}
                seconds={countdown.seconds}
                isTraveling={travelState.isTraveling}
                travelState={travelState}
                display={settings.display}
                glow={isGlobeHome}
              />
            )}
```

Hide the travel banner + prayer table block in Globe mode:

```tsx
        {/* Travel Banner + Prayer Table */}
        {!isGlobeHome && (
          <div className={`mb-5 ${travelState.isTraveling ? 'rounded-lg border-2 border-amber-500/30 overflow-hidden bg-[var(--color-card)]' : ''}`}>
            {travelState.isTraveling && (
              <div className="px-4 py-3 bg-amber-500/10">
                <div className="flex items-center gap-2">
                  <span className="text-amber-600 text-sm font-semibold">Travel Mode</span>
                  {travelState.distanceFromHomeKm !== null && (
                    <span className="text-amber-600/70 text-xs">
                      {formatDistance(travelState.distanceFromHomeKm, settings.distanceUnit)} from home
                    </span>
                  )}
                </div>
                <p className="text-amber-600/60 text-xs mt-0.5">Qasr prayers active — shortened to 2 rak'ah</p>
              </div>
            )}
            {isIslamic ? (
              <IslamicPrayerTable
                prayers={prayers}
                currentPrayer={currentPrayer}
                nextPrayerTime={nextPrayerTime}
              />
            ) : (
              <PrayerTable
                prayers={prayers}
                currentPrayer={currentPrayer}
                nextPrayerTime={nextPrayerTime}
              />
            )}
          </div>
        )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/home-view-switching.test.tsx`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS — in particular `design-switching.test.tsx` (which never sets `homeView`, so it defaults to `'list'` and every existing assertion holds unchanged).

- [ ] **Step 6: Type-check and build**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire the home globe view into App.tsx with a header toggle"
```

- [ ] **Step 8: Manual device smoke test**

On the GrapheneOS Pixel 6 Pro test device (or `npm run dev` in a browser as a first pass):

1. Fresh install (or clear app data) → onboarding → "Choose Your Home Screen" appears after the location step → pick Globe → lands on the full-page scene with stars, a rotating earth, and the countdown floating over it in glow style.
2. Compare the day/night terminator's position against the device's actual local time — the lit side should roughly match where the sun actually is.
3. Wait ~10–30s (or check on a slow connection) — clouds should fade in once the GIBS fetch resolves; toggle airplane mode on a fresh install to confirm the globe still renders (just without clouds) rather than erroring.
4. Tap the header toggle repeatedly — confirm it flips between Globe and List instantly with no crash.
5. From Globe mode, open Qibla, then Dashboard, then Settings, closing each — confirm the globe reappears correctly each time (no black screen, no duplicated canvases, no console GL context warnings).
6. In Settings → Appearance, switch the Home View picker and confirm it matches the header toggle's effect.
7. Cycle through a couple of the six app themes (Settings → Appearance → Theme) while in Globe mode — confirm the earth's map colors change with the theme, while the header/countdown text stays legible (light-on-dark) in every theme.

---

## Plan self-review

**Spec coverage:** every Decisions-table row in the spec maps to a task — onboarding placement (Task 5), settings field (Task 1), switching UI (Tasks 6, 10), Globe layout/glow HUD (Tasks 4, 10), List mode untouched (verified by Task 10's regression run), earth base map (Task 7), day/night terminator (Tasks 2, 7), cloud data source/caching/fallback (Task 3), network client (Task 3), WebGL exclusivity (Task 10), header/HUD chrome (Task 10).

**Type consistency:** `Settings.homeView: 'globe' | 'list'` (Task 1) is the type every later task reads/writes against (Tasks 5, 6, 10) — no other task introduces a conflicting shape. `CloudImageResult` and `getCloudImagery`/`extractCloudAlpha` (Task 3) are called with the same names and shapes in Task 8. `HomeGlobeData = { now: Date }` (Task 7) is unchanged by Task 8 and consumed as-is by Tasks 9–10. `glow?: boolean` (Task 4) is the exact prop name Task 10 passes.

**No placeholders:** every step above contains complete, real code — no TBDs, no "similar to Task N" hand-waving, no untyped references.
