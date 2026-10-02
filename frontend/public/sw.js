// Waguri AI Persona Companion — PWA Service Worker (v6)
// v6: Optimized Web Push notifications & icons
const CACHE_NAME = 'waguri-shell-v6';
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

// Fetch:
//  - API calls and non-GET requests always hit the network.
//  - Page navigations are NETWORK-FIRST (fresh UI on every visit; cached
//    shell only serves as the offline fallback).
//  - Same-origin static assets stay stale-while-revalidate (instant load,
//    quietly refreshed for the next visit).
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

  // 3. App shell navigations: network-first with offline fallback to the shell
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put('/index.html', responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 4. Same-origin static resources: stale-while-revalidate
  if (url.origin === self.location.origin) {
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
          .catch(() => cachedResponse || null);

        return cachedResponse || fetchPromise;
      })
    );
  }
});

// ==========================================
// Web Push Notifications
// ==========================================
self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || 'Waguri ❤️';
  const isAlarm = (payload.tag && payload.tag.includes('alarm')) || (title && (title.includes('Alarm') || title.includes('Wakeup')));
  const options = {
    body: payload.body || 'Suno na, kahan ho? Ek baar baat karo na! ✨',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-192.png',
    vibrate: isAlarm ? [500, 250, 500, 250, 500, 250, 500] : [200, 100, 200],
    tag: payload.tag || (isAlarm ? `waguri-alarm-${Date.now()}` : 'waguri-girlfriend-notification'),
    renotify: true,
    requireInteraction: !!isAlarm,
    data: {
      url: payload.data?.url || payload.url || '/',
      isAlarm,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If PWA window already open, focus it and navigate to alarm target URL
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client && targetUrl && targetUrl !== '/') {
            try { client.navigate(targetUrl); } catch {}
          }
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
