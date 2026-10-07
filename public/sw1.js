/**
 * sw.js - Service worker (hardened for Google Chrome).
 * Runs in the background between the page and the network. It makes the app
 * installable and lets pages open offline.
 */

// Bump this name when you change app files so Chrome replaces the old cache.
const CACHE = 'veggies-v2';

// The "app shell": files needed to show the interface offline.
const SHELL = ['/', '/index.html', '/app.js', '/style.css', '/manifest.webmanifest', '/icon.svg'];

// INSTALL: runs once when this version is first registered.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' skips Chrome's HTTP cache so we never store stale copies.
      .then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// ACTIVATE: delete old caches and switch on Chrome's navigation preload.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));

    // Navigation preload lets Chrome start the page request while the service
    // worker is still waking up, so the first load is not delayed.
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

// FETCH: runs for every request the page makes.
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignore anything we should not touch. Doing nothing here lets Chrome handle it normally.
  if (req.method !== 'GET') return;               // posts (new comments) always go to the server
  if (url.origin !== self.location.origin) return; // other sites, and chrome-extension:// URLs
  if (req.headers.has('range')) return;            // partial (206) responses cannot be cached

  event.respondWith(networkFirst(event));
});

/** "Network first": try the network, keep a copy, fall back to the copy when offline. */
async function networkFirst(event) {
  const req = event.request;
  const url = new URL(req.url);

  try {
    // Use the preloaded response if Chrome made one, otherwise fetch normally.
    const res = (await event.preloadResponse) || (await fetch(req));

    // Only cache good same-origin responses (not 404/500 errors or redirects).
    if (res.ok && res.type === 'basic') {
      const copy = res.clone(); // clone now: a response body can only be read once
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(req, copy)));
    }
    return res;
  } catch {
    // Offline. First look for an exact cached match. For page loads, ignore the
    // ?query part so "/?utm=x" still finds the cached "/".
    const cached = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (cached) return cached;

    // Page navigation with no cached copy: show the app shell.
    if (req.mode === 'navigate') return caches.match('/index.html');

    // Comments API with nothing cached: an empty list lets the page show "No comments yet".
    if (url.pathname.startsWith('/api/')) {
      return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
    }

    return Response.error(); // anything else: a normal network error
  }
}