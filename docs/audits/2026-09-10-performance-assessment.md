# OnTime — performance assessment

**Date:** 2026-09-10
**Branch:** `perf/startup-and-overlay-cost`, off `main` @ `a17e466`
**Baseline held:** `tsc -b` clean · **380/380 tests** (was 372) · ESLint **18 errors + 1 warning**, unmoved · `npm run build` succeeds · suite green under UTC / Asia/Karachi / Pacific/Kiritimati / America/New_York.

This is the first assessment of this app driven by measurement rather than by
reading. Sections 1–2 say how it was measured and what the numbers are; §3 is
the ranked findings; §4 what was fixed; §5 what was deliberately left; §6 the
review model's own record.

---

## 1. How this was measured, and what the numbers are not

> **Superseded in part.** A device became available later the same day and §8
> reports what it said. Two conclusions below did not survive it: that the
> globe home screen is where the app's startup cost lives, and that reopening
> the qibla screen is now free. Read §8 before quoting anything in §1–§3.

No device was attached when §1–§7 were written (`adb devices` empty), so
**nothing in them is a device measurement**. Everything below comes from headless Chrome driven over
CDP against `vite preview` of a production build, in a 412×915 viewport at
DPR 2.625, with `Emulation.setCPUThrottlingRate: 4`.

Two consequences, both important before quoting any number in this file:

- **CPU numbers are a proxy, not a prediction.** 4× throttle on this desktop is
  a stand-in for a mid-range phone. The Pixel 10 Pro XL in `docs` is faster
  than that; a budget device is slower. What the numbers are good for is
  *ratios* and *attribution* — which phase costs what, and whether a change
  moved it.
- **GPU numbers are worthless.** Headless Chrome runs SwiftShader, a software
  rasteriser. Every texture upload and every rendered frame is inflated by an
  unknown factor. So the trustworthy figures below are the ones that are pure
  CPU: JavaScript parse, JSON decode, and canvas 2D path work. The
  three.js frame costs are reported only as "there is something here", never as
  a magnitude.

**Every figure here is a single run.** No repeats, no medians. Treat a
difference under about 15% as noise — one of the "before" runs in the table
below came back at 1511ms where its neighbours were ~820ms. The differences
quoted as wins are the ones large enough and repeatable enough in shape to
survive that. The reopen figures additionally assume the qibla overlay actually
closed between passes, which the harness did not assert; that it did is
inferred from the saving matching the coastline work's measured cost on both
home views.

Long tasks (>50ms of uninterrupted main-thread work) are the unit throughout,
because on this app they are what a user feels: the globe not appearing, the
qibla screen arriving late, the tap that does not respond.

The harness is three short Playwright scripts. They are not committed — they
drive a preview server and depend on a `playwright-core` from a sibling
project. Reproducing means rebuilding them; the recipe is: preview the built
`dist`, seed `CapacitorStorage.ontime_onboarding_complete` and
`ontime_settings` in an init script, throttle CPU 4×, and read `longtask`
performance entries.

### The startup picture

| | main | this branch |
|---|---|---|
| **List home**, boot | 52ms blocking, 1 task | **0ms, no tasks** |
| **Globe home**, boot | 1360ms in 14 tasks, biggest 423ms | 1243ms in 12 tasks |
| Qibla, first open | ~1071ms | ~866ms |
| Qibla, reopened | ~819ms | **~550ms** |

First contentful paint is ~210ms in both home views and was never the problem.
Everything expensive happens after it.

**The list home screen is already clean.** Zero blocking work after first paint.
Every startup cost in this app belongs to the globe.

### Where the globe's 1.3 seconds actually goes

Marks placed around the globe's own init, at 4× throttle:

| Phase | Cost | Trustworthy? |
|---|---|---|
| Scene chunk parse and module init | ~183ms | yes, pure CPU |
| `globe.gl` construction | ~68ms | mostly |
| Deferred init + base earth JPEG decode | ~117ms | mostly |
| First full render at surface-ready | ~397ms | **no**, SwiftShader |
| ~15 further frames while the loop settles | ~800ms | **no**, SwiftShader |

So roughly **370ms is CPU work that will scale with the device**, and the
remaining second is GPU work that needs a real device to size. The honest
statement is: *the globe's bundle and init cost about a third of a second of
CPU on a mid-range phone, and its first second of rendering is unquantified.*

An early hypothesis that the map tiles were the cost was **wrong and is
recorded so it is not re-derived**: the globe fetches only 16 Esri tiles
totalling 167kB on a cold start. Tiles are not the problem.

### What is in the bundles

Measured from rollup's own module table, raw (pre-minification) bytes:

| Chunk | Minified | What dominates it |
|---|---|---|
| Scene chunk | 1.95MB | `three` 3.8MB raw, **`h3-js` 480kB raw**, `three-globe` 215kB, then d3-geo, earcut, tinycolor |
| City list | 2.08MB | one generated data module, lazy behind the search box |
| Coastlines | 546kB | `world-atlas`, lazy behind the qibla screen |
| Startup chunk | 398kB → **325kB** | react-dom 548kB raw, app code 201kB, **Font Awesome 115kB raw** |

`h3-js` is Uber's hexagonal-grid library. `three-globe` imports it for a hex-bin
layer this app does not use, and because `three-globe` ships as one
pre-bundled module, the import cannot be shaken out. See §5 for why it was left
alone anyway.

Code splitting is in good shape: the scene code, the city list and the
coastlines are all lazy and none is on the list-view path. One caveat in §5.

---

## 2. The one thing worth knowing about the qibla screen

Opening the qibla screen builds a 4096×2048 map of the world by rasterising
Natural Earth's coastlines. That is 1421 rings and 60,629 vertices. Split:

- **240ms** walking those vertices into a path,
- **1ms** filling and stroking that path onto the canvas.

The expensive half depends only on the geometry. The cheap half is the only
part that depends on the theme's colours. It was doing both, every time — on
every open, and again on every theme change. Now the path is built once per
session. This is the single largest measured win in the assessment.

The texture was **not** shrunk to 2048. A screenshot at the qibla globe's zoom
limit shows the visible hemisphere spanning roughly 2180 device pixels against
2048 texels, so halving it would show on the coastlines.

---

## 3. Findings, ranked

Severity here means *measured cost to a user*, not code tidiness.

### P1 — The globe home screen is the whole of the app's startup cost

1360ms of blocking work against the list view's 52ms. Two thirds of it is
unquantified GPU work that needs a device. **This is the open question this
assessment could not close**, and it is the one that needs `adb` and the
Pixel. See §7.

### P1 — The coastline map was redrawn from scratch on every qibla open — **fixed**

240ms of avoidable main-thread work per open and per theme change. Details in
§2.

### P2 — An icon framework in the startup chunk for one icon — **fixed**

Font Awesome's SVG core shipped so the qibla button could show a Kaaba, next to
two dozen icons in this app that are already inline SVG. Removing it takes the
startup chunk from 398kB to 325kB and its gzipped size from 120kB to 97kB —
23%, on the chunk that is parsed before either home screen appears.

### P2 — A minute timer ran for every user, on every theme, forever — **fixed**

The Auto theme follows Maghrib and Fajr. The timer that tracked them ran
regardless of the chosen theme: 1,440 wake-ups a day recomputing a value that
System, Light, Dark and the four palettes all ignore. This is the only finding
in the assessment that costs battery rather than latency, and it is the one
most likely to matter over a day of real use, even though it never appears in
a startup trace.

### P2 — The prayer boundary could get permanently stuck — **fixed**

A correctness bug, found while reading for performance, with a
performance-shaped cause. The guard that stops a stuck prayer time spinning the
app refused a second attempt at the same target *forever*. A backward clock
correction while a boundary timer is pending gets in: timers count elapsed
time, so one armed for 12:00 fires after its full delay whatever the clock says,
and can fire while the clock reads 11:55. The recalculation then produces the
same instant, nothing re-arms, and the watchdog behind it is locked out. The
passed prayer stays on screen until midnight.

Rare, and the trigger is narrower than the review model claimed — it asserted
ordinary early timer firing, which the existing +250ms guard already handles.
Reachable, though, and now covered by a test that steps the clock backwards.

### P3 — Repeated work whose inputs never changed — **fixed**

- The prayer list asked storage for today's checkmarks one prayer at a time:
  five sequential native-bridge round-trips before the first mark could appear.
- The stored tracking blob was re-fetched and re-parsed on every read — seven
  times over opening the list and then the dashboard.
- Clearing the city search box rebuilt its sixteen suggestions by scanning all
  33,203 cities once per name: half a million comparisons, each time the box
  went empty.
- The twelve-entry calculation-method table was rebuilt on every prayer-time
  calculation, and a week of notification scheduling makes fifteen of those.
- Two render loops allocated vectors per frame, and a shared base-class helper
  allocated two per call — which is per marker per frame in any view using it.

### P2 — Isha's label floats with no line under it on interval methods — **open**

Not on this branch. On `fix/solar-ring-half-arcs`, which was checked out when
this session began. That branch halved each solar ring so a prayer's line is
only drawn over the longitudes at that prayer's time of day — correct — but
Isha's label still anchors to the eastern half of the Fajr ring, which is now
the half that is no longer drawn. Umm al-Qura and Qatar set Isha at Maghrib
plus a fixed interval with no solar angle, so those users get a floating "Isha"
pill over the globe with nothing beneath it.

The label is on the right half of the sky; only its line is missing. The right
anchor is the terminator's evening side with the usual stagger, because for an
interval method Isha genuinely *is* Maghrib plus N minutes. Left for the owner:
it is a different branch and label placement is a visual call.

Found by DeepSeek, which got the mechanism right and the consequence wrong — it
claimed the label lands on the morning side, which it does not.

### P3 — 5MB of dead assets in the Android build directory

`android/app/src/main/assets/public/` still holds `earth-base-4k.jpg` (1.1MB)
and `earth-base-8k.jpg` (4.0MB) from an older build. Neither exists in `public/`
any more. The directory is gitignored build output and `cap sync` copies into
it rather than mirroring, so nothing removes them — and a build made now would
pack all 5MB into the AAB. Clear the directory before the next `cap sync`.

---

## 4. What changed

| Commit | What |
|---|---|
| `1cbcf22` | the DeepSeek review script the qwen workflow said to build, plus its log |
| `946bfab` | the coastline path cached — the largest measured win |
| `e46c4b8` | six repeated-work fixes: the Auto timer, the batched tracking read and its cache, the city suggestions, the method table, two per-frame allocations |
| `6ffac29` | the prayer boundary recovering after a backward clock correction |
| `87745d0` | Font Awesome out, the Kaaba drawn |
| `a893f3e` | two findings from DeepSeek's review of this branch, both in code written in it |

Eight tests added. Every fix was verified by reverting it in place and
confirming the intended test failed — the batch-6 convention. Two of those
mutation checks earned their keep: without the theme gate the timer is armed
twice on Dark, and with the old one-shot boundary guard restored the app is
left showing a prayer that has already passed.

---

## 5. Left alone, deliberately

**`h3-js`, 480kB raw of unused hex-grid code.** Stubbing it out via a Vite alias
was considered and rejected. The measured yield is about 10% of a 183ms parse,
and `three-globe` already carries a patch in `patches/` noting that
`fromKapsule()` runs layer init on a throw-away instance at module load — so a
throwing stub risks breaking the globe outright. Bad trade.

**The lazy modals load at startup anyway.** Settings, Dashboard and Qibla are
`lazy`, but they are rendered unconditionally with an `isOpen` prop, so React
fetches all three chunks (79kB) during boot. Real, and confirmed by resource
timing — but the list view measures **zero** blocking work, so there is nothing
to fix, and mounting them conditionally would reset the settings-draft state
that batch 6 just fixed.

**A `<style>` block per table row.** Reported as High by the review model.
Overstated: React does not touch a text node whose string is unchanged, so there
is no per-render stylesheet re-parse. Duplication, not repeated work.

**Ground view and the sun dome.** The review model spent top findings on the
compass-rate render path and on per-frame allocations in the sun dome. Both
features are commented out of the app. Recorded as latent: if ground view comes
back, its compass path rebuilds the globe's data object on every sensor reading;
if the sun dome comes back, it declares itself continuously animating so its
render loop never parks, and it allocates about a dozen vectors per frame.

**Identity-based effect dependencies** in `App` and `TravelContext`. Real, and
accurately described. Each costs a handful of operations per user action.

**A precomputed coastline path shipped as an asset.** The remaining 240ms on
the *first* qibla open is a JavaScript loop over 60,629 vertices. Emitting the
path at build time and letting the browser parse it natively should be much
faster, and would also drop the 546kB `world-atlas` chunk and the
`topojson-client` dependency. That is a build-pipeline change with a new shipped
asset, too large to bolt onto this branch. It is the best remaining lead.

---

## 6. The review model's record

Six reviews, every finding verified against the code and dispositioned in
`docs/ds-review-log.jsonl`. Across the four cold-read performance passes it
landed **8 of 27 findings** as actionable. On the review of *this branch's own
diff* it landed **2 of 2**, including one that matters: the script's header
promised it would only transmit source files, and its `--file` path did not
enforce it — the file it would most readily have sent is the one holding the
API key.

Two failure modes, both worth knowing before trusting one:

- **It cannot tell that a feature is switched off.** Two of four perf reviews
  led with findings about unreachable code.
- **It asserts consequences that do not follow from its own correct
  mechanism.** It found the right mechanism for the Isha label and the wrong
  consequence; the right mechanism for the boundary guard and the wrong trigger.

It is markedly better on a diff than on a cold read, which is what the logicly
pilot found too, and it is much better at saying "this is already optimal" than
its size would suggest. Reviewing a branch costs seconds and cents.

One operational note that will otherwise cost an hour: `deepseek-flash` bills
its reasoning against the same token budget as its answer, and on an 89k-char
prompt it spent 32,000 and then 64,000 reasoning tokens and returned **empty
content** both times. 64,000 is the API's ceiling. Thinking is off by default
in the script for this reason.

---

## 7. Open, and waiting on a device

**The globe's first second is unmeasured.** Two thirds of the globe home
screen's blocking work is GPU, and SwiftShader makes those numbers meaningless.
Everything in §3 that is ranked P1 rests on this gap. What is needed: the Pixel
attached, and the CDP-over-adb profiling this project already knows is the only
method that does not mislead for this app.

Specifically worth checking on device:

1. Globe home cold start, from launch to the globe appearing.
2. Whether the globe's render loop really costs ~15 frames of settling, or
   whether that is entirely a software-rasteriser artefact.
3. Three WebGL contexts are alive at once with the qibla screen open over the
   globe home — the home globe (parked), the qibla globe, and the Kaaba card.
   That is bounded and correct by design, but it is memory worth watching on a
   mid-range device.
4. Whether the 240ms coastline walk is closer to 60ms or 300ms on real
   hardware, which decides whether the precomputed-path work in §5 is worth
   doing.

---

## 8. What the device said

Measured the same evening on a **Pixel 10 Pro XL, Android 17**, over CDP on the
debug WebView, using the same instrument as the headless harness: a `longtask`
PerformanceObserver installed via `Page.addScriptToEvaluateOnNewDocument`
before a reload. Two builds compared — current `main`, and `a17e466`, the
commit this assessment started from.

Everything below is on one fast phone. A budget device is several times slower,
and the ratios matter more than the absolute numbers.

### A finding the device did not produce, but the owner did

Twice reported from the app: the surface goes low-res when you zoom out. It
does. The tile engine picks its level from camera altitude, a level L carries
256 × 2^L pixels around the equator, and at the default framing of 2.5 it picked
level 2 — a thousand pixels around the whole equator — and painted it over a
photo worth two thousand. **The streamed mosaic was half the resolution of the
thing it covered**, on every launch.

Neither harness would have found this: it is not slow, it is just wrong, and
both instruments here measure time. #27 fixes it. Recorded because it is the
most user-visible thing in this whole assessment and it came from someone
looking at the screen.

### The headless harness overstated the globe, but was right about it

**This section replaces an earlier version of itself that was wrong.** The
first pass reported the globe and the list costing the same on device and
concluded that §1's headline was an artefact. That conclusion came from a
broken instrument: the harness seeded the home view by writing
`CapacitorStorage.ontime_settings` into `localStorage`, which works in a
browser and does nothing at all on Android, where Capacitor Preferences is
SharedPreferences. Every "list home" run on the phone was the globe measured
against itself. The seed now goes through the app's own view toggle, which
persists the way a tap does.

With that fixed, on the same device in one session:

| Boot, blocked main thread | headless @4× | Pixel 10 Pro XL |
|---|---|---|
| List home | 0ms | **~82ms** (n=3, 66–93) |
| Globe home, before the surface fix | 1243ms in 12 tasks | **~275ms** (n=4, 252–292) |
| Globe home, current | — | **~359ms** (n=4, 329–417) |

So §1's headline stands after all: the globe is where the startup cost lives,
at three to four times the list view. What headless got wrong was the size —
it put the globe's excess over the list at 1243ms where the device says about
195ms, an exaggeration of roughly six times. **The caveat in §1 was right, the
correction in the first draft of §8 was wrong, and the original conclusion was
right for the wrong confidence.**

The lesson worth keeping is not "headless lies" but "a seeding step that
silently no-ops produces confident numbers about the wrong thing". The seed
never errored. It just wrote to a store nothing read.

What the ~250ms actually is, from a CPU profile over the boot:

```
404.6ms  (program)              — script parse and compile, spread across the window
 39.6ms  (garbage collector)
 36.2ms  getShaderInfoLog       — WebGL shader compilation
 32.3ms  getProgramInfoLog      — WebGL program linking
 28.2ms  texSubImage2D          — first texture upload
 27.2ms  renderer setSize
 19.3ms  getContext             — creating the WebGL context
```

Most of it is script compile and WebGL setup. Both home views pay it, because
both boot the same bundle and the list view still initialises Capacitor's
native bridge.

**Before and after on device:** globe boot ~273ms before (n=3) against ~246ms
after (n=4). That is a real but small improvement, and it is inside the
run-to-run spread. The startup work in §4 did not move this device measurably.

### Reopening the qibla screen is not free, and the coastline was not the reason

§2 said reopening no longer costs anything measurable. On device it does:

| Qibla open | before (`a17e466`) | after (`main`) |
|---|---|---|
| First open | 463ms | ~430ms |
| Reopen | 641ms, 666ms (n=2) | ~536ms (n=6, 377–595) |

The baseline sample is two runs, which is too thin to size the difference
honestly. What is clear is that **a reopen still costs about half a second**,
with a single task of 320–360ms inside it. The coastline caching removed real
work — the 240ms path build is gone, and that is not in doubt — but it was
never the largest part of this on a device with a real GPU.

A profile of a reopen puts the remaining cost in one place:

```
200.7ms  getProgramInfoLog      — linking a fresh set of WebGL programs
 40.5ms  getContext
 13.7ms  getShaderInfoLog
```

Closing the qibla overlay unmounts its globe, so opening it again creates a new
WebGL context and recompiles and relinks every shader three.js needs. That is
the cost. It is the same shape of problem the home globe already solved by
staying mounted and parked under overlays (`globeCovered`), and the same fix
would work — at the price of a second live WebGL context for the life of the
app, which is a memory decision for the owner rather than a change to make
quietly. **This is now the largest known win left in the app.**

### The stale-assets story in `7bb9a34` was wrong about the cause

That commit says the 5MB of earth imagery in the Android assets folder was
"replaced some time ago by one smaller file". It was not. Those files are the
*newer* 4K and 8K textures from the unmerged `fix/offline-globe-texture`
branch, left behind by a branch switch on 2026-09-09.

The mechanism the commit describes is exactly right and the fix is arguably
more valuable than stated — switching branches is precisely how foreign assets
get stranded in a folder that `cap sync` copies into rather than mirrors. Only
the provenance was wrong.

### What §7 asked, answered

1. **Globe home cold start** — ~250ms of blocked main thread, the same as the
   list view.
2. **Is the globe's render-loop settling real?** No. It was SwiftShader.
3. **Three WebGL contexts with qibla open over globe home** — real, and now
   known to be expensive in a second way: the qibla one is rebuilt from scratch
   every time. Graphics memory sits around 300MB PSS on `main`.
4. **Is the coastline work worth having done?** Yes, but for less than §2
   claimed. It is 240ms at 4× throttle and a smaller share of a real device's
   half-second reopen.

### Still open

- The qibla overlay's WebGL context rebuild, above.
- ~~`fix/offline-globe-texture` (#21)~~ — **resolved by #27**, which took the
  free half of that PR (gate the tile stream on the altitude where tiles start
  beating the bundled photo) and paired it with a 4096 photo instead of an 8192
  one. Boot 275 → 359ms rather than 646ms, graphics memory 276 → 291MB rather
  than 435MB, and network requests on a globe-home boot 16 → 0 either way. The
  8192 upload was a single 412ms `texSubImage2D` on the main thread; compressed
  textures (KTX2/Basis) are the route back to it if it is ever wanted.
  #27 was opened quoting 280 → 320ms, measured across two sessions; the
  same-session A/B in this section puts the real cost at **+84ms**, not +40ms.
- None of this has been checked on a slow device, which is where all of it
  matters most.
