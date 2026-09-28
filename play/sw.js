// Service worker for the web app (/bears-and-co/play/), registered by
// components/web/WebShell.web.tsx. It only caches, so a second visit (and
// one offline) opens instantly: no install prompt, no manifest, and nothing
// is sent anywhere.
//
// - The page (index.html): network first, the cached copy when offline.
// - Hashed build files (_expo/…, assets/…: the bundle, fonts, images, and
//   whichever sound set is played), and the favicon: cache first. The hashed
//   names change whenever their content does, so a cached copy is never
//   stale; the favicon is re-fetched with each new build's cache.
// - Each build registers this file as sw.js?v=<bundle file name>, which makes
//   a new deploy install a new worker with its own cache; the old caches are
//   deleted when it activates.

const VERSION = new URL(self.location.href).searchParams.get('v') || 'unversioned';
const PREFIX = 'bears-and-co-play-';
const CACHE = PREFIX + VERSION;
const SCOPE = self.registration.scope; // …/bears-and-co/play/
const PAGE = new URL('./', SCOPE).href;
const FAVICON = new URL('favicon.ico', SCOPE).href;
const HASHED = /^(_expo|assets)\//;

const inScope = (url) => url.origin === self.location.origin && url.href.startsWith(SCOPE);
const isHashed = (url) => inScope(url) && HASHED.test(url.href.slice(SCOPE.length));
// Hashed files, plus the favicon (refreshed with every new build's cache).
const isCacheFirst = (url) => isHashed(url) || url.href === FAVICON;

self.addEventListener('install', (event) => {
  // The page and its bundle, so even the next visit can open offline.
  const bundle = VERSION.endsWith('.js') ? [new URL(`_expo/static/js/web/${VERSION}`, SCOPE).href] : [];
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([PAGE, FAVICON, ...bundle]))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  // Known to be offline: skip the doomed network attempt (and its console
  // error) and open the cached copy straight away.
  if (self.navigator.onLine === false) {
    const cached = await cache.match(PAGE);
    if (cached) return cached;
  }
  try {
    const response = await fetch(request);
    // /play/ and /play/?embed=1 are the same page; keep one copy.
    if (response.ok) cache.put(PAGE, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(PAGE);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!inScope(url)) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  } else if (isCacheFirst(url)) {
    event.respondWith(cacheFirst(request));
  }
});

// The page lists what it loaded before this worker was in control (the very
// first visit), so those files are cached too. Only hashed files in scope.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'cache-urls' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        data.urls
          .filter((u) => typeof u === 'string')
          .map((u) => new URL(u, SCOPE))
          .filter(isHashed)
          .map((url) => cache.match(url.href).then((hit) => hit || cache.add(url.href).catch(() => {}))),
      ),
    ),
  );
});
