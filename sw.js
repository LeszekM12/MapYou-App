const CACHE = 'mapty-v1';

const PRECACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/icon.png',
  '/logo.png',
];

// Install — pre-cache app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first, fallback to cache
// Map tiles always go network-only (no point caching them)
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET and map tile/API requests — always fetch live
  if (e.request.method !== 'GET') return;
  if (url.hostname.includes('tile.openstreetmap') ||
      url.hostname.includes('nominatim') ||
      url.hostname.includes('router.project-osrm') ||
      url.hostname.includes('unpkg.com') ||
      url.hostname.includes('fonts.googleapis') ||
      url.hostname.includes('bigdatacloud')) return;

  // App shell — cache first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
