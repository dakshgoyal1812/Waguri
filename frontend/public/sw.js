// Waguri AI Persona Companion — PWA Service Worker (v7)
// v7: Ultra-fast PWA performance, separate 3D model cache (VRM/GLB), chunk asset caching
const SHELL_CACHE = 'waguri-shell-v7';
const MODELS_CACHE = 'waguri-models-v1';

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
    caches.open(SHELL_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches (preserving models cache) and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== MODELS_CACHE)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch:
//  - API calls and non-GET requests always hit the network.
//  - 3D models (.vrm, .glb) use CACHE-FIRST in dedicated MODELS_CACHE for instant avatar loading.
//  - Hashed bundles (/assets/*) use CACHE-FIRST with network fallback for zero-latency UI boot.
//  - App shell navigations are NETWORK-FIRST with offline shell fallback.
//  - Other same-origin static assets use STALE-WHILE-REVALIDATE.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. NEVER cache dynamic backend API requests
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 2. Non-GET requests pass through
  if (event.request.method !== 'GET') {
    return;
  }

  // 3. 3D Avatar Models & Room meshes (.vrm / .glb): Cache-First for instant switching
  if (/\.(vrm|glb)($|\?)/i.test(url.pathname)) {
    event.respondWith(
      caches.open(MODELS_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) {
          return cached;
        }
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          return cached || new Response('Model offline unavailable', { status: 503 });
        }
      })
    );
    return;
  }

  // 4. Vite built hashed assets (/assets/*.js, /assets/*.css): Cache-First for instant PWA boot
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const clone = networkResponse.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 5. App shell navigations: network-first with offline fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(SHELL_CACHE).then((cache) => {
              cache.put('/index.html', responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 6. Same-origin static resources: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
              const responseToCache = networkResponse.clone();
              caches.open(SHELL_CACHE).then((cache) => {
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
