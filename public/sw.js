/**
 * sw.js - Service worker. Runs in the background and sits between the page and
 * the network. It makes the app installable and lets pages open offline.
 */

// Bump this name when you change app files so old caches get replaced.
const CACHE = 'veggies-v1';

// The "app shell": files needed to show the interface.
const SHELL = ['/', '/index.html', '/app.js', '/style.css', '/manifest.webmanifest', '/icon.svg'];

// INSTALL: runs once when the service worker is first registered. Cache the shell.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// ACTIVATE: delete caches left over from older versions.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// FETCH: runs for every request the page makes. Strategy = "network first":
// try the network, save a copy, and fall back to the saved copy when offline.
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only GET requests can be cached. Posting a comment always goes to the server.
  if (req.method !== 'GET') return;

  const isApi = new URL(req.url).pathname.startsWith('/api/');

  event.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();                       // a response can only be read once
        caches.open(CACHE).then(c => c.put(req, copy)); // store the fresh copy
        return res;
      })
      .catch(() =>
        // Offline: use the cached copy; for the API with no copy, return an empty list.
        caches.match(req).then(hit =>
          hit || (isApi
            ? new Response('[]', { headers: { 'Content-Type': 'application/json' } })
            : caches.match('/index.html'))
        )
      )
  );
});
