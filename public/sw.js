/**
 * Beit Building service worker — Tier 6 PWA.
 *
 * Strategy:
 *   - Network-only for /api/* (form submissions, analytics events,
 *     CSP reports — must always hit the live backend, no caching ever)
 *   - Network-first for HTML navigations (always fresh content if
 *     online; falls back to cache then offline.html if not)
 *   - Cache-first for static assets (JS, CSS, fonts, images, manifest)
 *
 * Activation:
 *   - skipWaiting() so new SW versions apply on first reload after
 *     deploy, not after closing every tab
 *   - clients.claim() so the new SW controls existing tabs immediately
 *   - Old caches cleared during activate
 *
 * Versioning:
 *   - Bump VERSION on each deploy that changes pre-cached assets.
 *   - Or compute the version from a build hash via a Vite plugin
 *     (deferred — manual bump is fine for monthly-ish deploys).
 *
 * Runtime cache cap: 50 entries, FIFO eviction. Not strictly LRU but
 * close enough for our scale.
 */

const VERSION = 'BBC_CACHE_v2026_05_03';
const PRECACHE = `${VERSION}-precache`;
const RUNTIME = `${VERSION}-runtime`;
const RUNTIME_MAX_ENTRIES = 50;

const PRECACHE_URLS = [
  '/',
  '/logo-mark.png',
  '/logo-mark.webp',
  '/logo-mark@1x.png',
  '/logo-mark@2x.png',
  '/og-image.jpg',
  '/manifest.webmanifest',
  '/offline.html',
];

/* ─── install ────────────────────────────────────────────────────────── */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE)
      // `addAll` is atomic — if any URL fails, the entire install
      // fails. We still want the SW to install even if one optional
      // asset 404s, so do them individually.
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch(() => {
              /* swallow individual failures; a missing icon shouldn't
                 break the entire SW install */
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

/* ─── activate ───────────────────────────────────────────────────────── */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Drop any cache from prior versions
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/* ─── fetch ──────────────────────────────────────────────────────────── */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // SW only cares about same-origin requests. Cross-origin (fonts,
  // CDNs, third-party widgets like Calendly) bypass the SW entirely.
  if (url.origin !== self.location.origin) return;

  // Only GET. POST / PUT / etc. always hit the network.
  if (request.method !== 'GET') return;

  // /api/* is network-only. Forms, analytics events, CSP reports —
  // none of these should ever be cached.
  if (url.pathname.startsWith('/api/')) return;

  // HTML navigations — network-first with offline fallback. Keeps
  // content fresh when online; provides a graceful experience when not.
  if (
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html')
  ) {
    event.respondWith(handleNavigate(request));
    return;
  }

  // Static assets — cache-first with runtime cache backfill.
  event.respondWith(handleStaticAsset(request));
});

/* ─── strategies ─────────────────────────────────────────────────────── */

async function handleNavigate(request) {
  try {
    const networkResp = await fetch(request);
    if (networkResp && networkResp.ok) {
      // Cache successful HTML for next-time fallback. Don't await —
      // let it happen in background.
      const clone = networkResp.clone();
      caches
        .open(RUNTIME)
        .then((cache) => cache.put(request, clone))
        .catch(() => {
          /* quota / private mode — silently skip */
        });
    }
    return networkResp;
  } catch {
    // Offline path — try the runtime cache first (last successful
    // fetch of this exact URL). Then fall through to the precached
    // home page. Final fallback: offline.html.
    const runtimeHit = await caches.match(request);
    if (runtimeHit) return runtimeHit;
    const precacheHit = await caches.match('/');
    if (precacheHit) return precacheHit;
    const offline = await caches.match('/offline.html');
    if (offline) return offline;
    // Last resort: a synthesized minimal response
    return new Response(
      '<h1>Offline</h1><p>Please check your connection and try again.</p>',
      { headers: { 'Content-Type': 'text/html' } },
    );
  }
}

async function handleStaticAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResp = await fetch(request);
    // Only cache successful, finalized responses.
    if (networkResp && networkResp.ok && networkResp.status === 200) {
      const url = new URL(request.url);
      // Cache hashed Vite build assets + obvious static-asset extensions.
      // Skip anything that looks like a query-tagged dev resource.
      if (
        url.pathname.startsWith('/assets/') ||
        /\.(png|jpe?g|webp|svg|woff2?|ttf|otf|css|js|ico|json)$/i.test(
          url.pathname,
        )
      ) {
        const clone = networkResp.clone();
        caches
          .open(RUNTIME)
          .then(async (cache) => {
            await cache.put(request, clone);
            await trimCache(cache, RUNTIME_MAX_ENTRIES);
          })
          .catch(() => {
            /* silent */
          });
      }
    }
    return networkResp;
  } catch {
    // Network failed — there's no cached version (we already checked).
    // Return a 504 so the browser shows its native offline state.
    return new Response('', { status: 504, statusText: 'Gateway Timeout' });
  }
}

/**
 * Cap the runtime cache at maxEntries. Evicts oldest entries first
 * (FIFO — `cache.keys()` returns insertion order). Not strictly LRU
 * but close enough for a small cap on a low-traffic site.
 */
async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  // Drop the oldest entry, then recurse if still over.
  await cache.delete(keys[0]);
  await trimCache(cache, maxEntries);
}

/* ─── messages — for client-driven cache busting ─────────────────────── */

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
