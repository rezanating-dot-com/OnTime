/**
 * Service worker that caches the globe's satellite tiles on disk.
 *
 * The earth surface (Esri World Imagery) is static, so tiles are served
 * cache-first: each one is downloaded exactly once, then read from CacheStorage
 * on every later launch or zoom. Everything else — including the app's own
 * assets, so a version bump can never serve a stale bundle — passes through
 * untouched.
 *
 * The moon texture used to be cached here too. It ships with the app now, so
 * this worker's only remaining third party is the tile server.
 *
 * Android only, in practice: capacitor.config.ts sets androidScheme 'https', so
 * the WebView origin is https://localhost and service workers work. iOS uses
 * capacitor://localhost under WKWebView, where they do not, and main.tsx
 * swallows the failed registration — so on iOS tiles are simply fetched each
 * time, exactly as before this worker existed.
 */

const CACHE_NAME = 'ontime-tiles-v2';
const STATIC_HOSTS = ['server.arcgisonline.com'];

/**
 * How many tiles to keep. At roughly 15 KB each this is about 9 MB, bounding a
 * cache that previously grew without limit for the life of the install.
 *
 * A cold start needs none of it any more: homeGlobe.ts only switches the tile
 * engine on once the camera drops below the altitude at which Esri finally
 * beats the bundled Blue Marble (0.25 with the 8192 photo, 0.5 with the 4096
 * one — see earthBaseTexture.ts), and the default framing is well above both.
 * So this cache now covers zooming and panning at close range, and nothing
 * else.
 */
const MAX_CACHED_TILES = 600;

/**
 * Drop the oldest entries once over budget. `cache.keys()` is insertion-ordered,
 * so this is FIFO rather than true LRU — a hit does not move an entry to the
 * back. For map tiles that is the right trade: the entries at the front are from
 * an earlier session or a region the user has since left.
 */
async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_CACHED_TILES;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete superseded caches. activate only ever called clients.claim(), so
      // bumping CACHE_NAME orphaned the previous one permanently and every
      // version's worth of tiles stayed on disk for the life of the install.
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let hostname;
  try {
    hostname = new URL(request.url).hostname;
  } catch {
    return;
  }
  if (!STATIC_HOSTS.includes(hostname)) return;

  // Cache-first — static imagery, download once, serve from disk afterwards.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;

      const response = await fetch(request);
      if (response && response.ok) {
        // Held with waitUntil rather than left floating: respondWith settles the
        // moment the response is returned, after which the worker can be
        // terminated mid-write. An un-awaited put therefore failed silently some
        // fraction of the time and those tiles re-downloaded on the next launch.
        event.waitUntil(
          cache.put(request, response.clone()).then(() => trimCache(cache))
        );
      }
      return response;
    })
  );
});
