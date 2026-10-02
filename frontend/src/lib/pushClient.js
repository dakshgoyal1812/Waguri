// Client-side Web Push subscription helper for Waguri PWA
import { BASE_URL } from '../api.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64(buffer) {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function getPushSupportDetails() {
  if (typeof window === 'undefined') return { supported: false, reason: 'ssr' };
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  if (isIOS && !isStandalone) {
    return {
      supported: false,
      reason: 'ios_not_installed',
      message: 'On iPhone / iPad, please add Waguri to your Home Screen first (Tap Share ⎋ -> "Add to Home Screen"), then open from your Home Screen to enable notifications.',
    };
  }
  if (!('serviceWorker' in navigator)) {
    return { supported: false, reason: 'no_sw', message: 'Service Workers are not supported on this browser.' };
  }
  if (!('Notification' in window)) {
    return { supported: false, reason: 'no_notification', message: 'Notifications are not supported on this browser.' };
  }
  if (!('PushManager' in window)) {
    return { supported: false, reason: 'no_push_manager', message: 'Push Notifications are not supported on this browser.' };
  }
  return { supported: true, reason: 'ok' };
}

export function isPushSupported() {
  return getPushSupportDetails().supported;
}

export function getNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function ensureServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      reg = await navigator.serviceWorker.register('/sw.js');
    }
    // Give SW up to 5s to become ready, otherwise return registration as-is
    const readyPromise = navigator.serviceWorker.ready;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('SW ready timeout')), 5000)
    );
    return await Promise.race([readyPromise, timeoutPromise]).catch(() => reg);
  } catch (err) {
    console.warn('[push] ensureServiceWorker notice:', err);
    return null;
  }
}

export async function getExistingSubscription() {
  if (!isPushSupported()) return null;
  try {
    const reg = await ensureServiceWorker();
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch (err) {
    console.warn('[push] failed to get existing subscription:', err);
    return null;
  }
}

export async function subscribeToPush(userId = 'local-user') {
  const support = getPushSupportDetails();
  if (!support.supported) {
    throw new Error(support.message || 'Push notifications are not supported on this browser/device.');
  }

  // Request permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notification permission is blocked. Please tap the lock / site settings icon in your browser URL bar and allow Notifications.'
      : 'Notification permission was dismissed.');
  }

  // Ensure Service Worker is registered and active
  const reg = await ensureServiceWorker();
  if (!reg) {
    throw new Error('Service Worker could not be activated for push notifications.');
  }

  // Fetch VAPID public key from backend
  const resKey = await fetch(`${BASE_URL}/api/push/vapid-public-key`);
  if (!resKey.ok) {
    throw new Error(`Failed to retrieve VAPID key from backend (${resKey.status})`);
  }
  const { publicKey } = await resKey.json();
  if (!publicKey) throw new Error('VAPID public key is missing on backend');

  try { await reg.update(); } catch {}

  let sub = await reg.pushManager.getSubscription();

  // If existing subscription was created with a different VAPID key, renew it
  if (sub && sub.options?.applicationServerKey) {
    const existingKeyBase64 = arrayBufferToBase64(sub.options.applicationServerKey);
    const cleanPublic = publicKey.trim().replace(/^["']|["']$/g, '').replace(/=+$/, '');
    if (existingKeyBase64 && existingKeyBase64 !== cleanPublic) {
      console.log('[push] VAPID key changed, renewing subscription...');
      try { await sub.unsubscribe(); } catch {}
      sub = null;
    }
  }

  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  // Register or re-register subscription on backend
  const resSub = await fetch(`${BASE_URL}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      subscription: sub.toJSON(),
    }),
  });

  if (!resSub.ok) {
    throw new Error(`Failed to save push subscription on server (${resSub.status})`);
  }

  return sub;
}

export async function unsubscribeFromPush() {
  if (!isPushSupported()) return false;
  try {
    const reg = await ensureServiceWorker();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      await fetch(`${BASE_URL}/api/push/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      return await sub.unsubscribe();
    }
  } catch (err) {
    console.warn('[push] unsubscribe error:', err);
  }
  return false;
}

export async function sendTestNotification(userId = 'local-user') {
  const reg = await ensureServiceWorker().catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;

  const res = await fetch(`${BASE_URL}/api/push/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      endpoint: sub?.endpoint || null,
      title: 'Waguri ❤️',
      message: 'Suno na! Push notifications phone par perfectly work kar rahe hain ✨',
    }),
  });

  if (!res.ok) {
    throw new Error(`Test notification request failed (${res.status})`);
  }
  return await res.json();
}

export async function showLocalNotification(title = 'Waguri ❤️', body = 'Test Notification: Device par notifications successfully allow ho gayi hain! ✨') {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const reg = await ensureServiceWorker();
    if (reg && reg.showNotification) {
      await reg.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        vibrate: [200, 100, 200],
        tag: 'waguri-direct-test',
        renotify: true,
        data: { url: '/' },
      });
      return true;
    }
    // Fallback to window Notification constructor
    new Notification(title, {
      body,
      icon: '/icons/icon-192.png',
      tag: 'waguri-direct-test',
    });
    return true;
  } catch (err) {
    console.warn('[push] direct showNotification fallback notice:', err);
    return false;
  }
}
