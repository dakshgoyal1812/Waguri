// Waguri AI Persona Companion — PWA Service Worker (v2)
const CACHE_NAME = 'waguri-shell-v2';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/logo.png',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

// Install: pre-cache app shell and immediately activate
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network-first for API; Cache-first with background revalidation for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. NEVER cache dynamic backend API requests (chat, tts, memory, audio endpoints)
  if (url.pathname.startsWith('/api/')) {
    return; // allow standard network fetch
  }

  // 2. Non-GET requests (POST, PUT, DELETE) pass through
  if (event.request.method !== 'GET') {
    return;
  }

  // 3. For app shell and static resources, Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If offline and request is navigation, fallback to /index.html
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return null;
        });

      return cachedResponse || fetchPromise;
    })
  );
});
