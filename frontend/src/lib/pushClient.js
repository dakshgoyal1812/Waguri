// Push notification client for Waguri.
//
// TWO delivery paths (the phone CANNOT use web push!):
//  1. Native Android/iOS (Capacitor APK): the WebView has no PushManager, so we
//     use @capacitor/push-notifications (FCM/APNs). The device token is stored
//     on the backend as a subscription with endpoint `fcm://<token>`.
//  2. Web PWA (browser / installed PWA): standard VAPID web push via sw.js.
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { BASE_URL } from '../lib/apiBase.js';
import { getAuthHeaders } from '../supabaseClient.js';

const NATIVE_TOKEN_KEY = 'waguri_fcm_token';
const NATIVE_ENABLED_KEY = 'waguri_native_push_enabled';

const isNativePlatform = () => Capacitor.isNativePlatform();

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

export function getPushSupportDetails() {
  // Native app: FCM push is always available (plugin handles permissions)
  if (isNativePlatform()) return { supported: true, reason: 'native' };

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
    return {
      supported: false,
      reason: 'no_push_manager',
      message: 'Push Notifications are not supported in this browser. On Android, install the Waguri APK or add the website to your Home Screen (Install App) for notifications.',
    };
  }
  return { supported: true, reason: 'ok' };
}

export function isPushSupported() {
  return getPushSupportDetails().supported;
}

export function getNotificationPermission() {
  if (isNativePlatform()) return 'native';
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

async function saveSubscriptionOnServer(userId, subscription) {
  const res = await fetch(`${BASE_URL}/api/push/subscribe`, {
    method: 'POST',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      user_id: userId, // informational only; the server binds to the verified JWT identity
      subscription,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to save push subscription on server (${res.status})`);
  }
}

// ------------------------- Native (FCM) path ---------------------------------

async function ensureNativeChannel() {
  try {
    await PushNotifications.createChannel({
      id: 'waguri',
      name: 'Waguri',
      description: 'Waguri alerts & reminders',
      importance: 4, // HIGH
      visibility: 1, // public on lock screen
      vibration: true,
    });
  } catch (err) {
    console.warn('[push] createChannel notice (non-Android?):', err?.message || err);
  }
}

/**
 * Register the device for FCM push and persist the token on the backend.
 * Resolves with the pseudo-subscription { endpoint: 'fcm://<token>' }.
 */
export async function registerNativePush(userId = 'local-user') {
  await ensureNativeChannel();

  // Android 13+ requires the POST_NOTIFICATIONS runtime permission BEFORE
  // registering — without it FCM messages arrive but silently never display.
  try {
    const permStatus = await PushNotifications.requestPermissions();
    if (permStatus?.receive !== 'granted') {
      throw new Error('Notification permission was not granted. Enable Waguri notifications in Android Settings → Apps → Waguri → Notifications.');
    }
  } catch (err) {
    if (err?.message?.includes('permission')) throw err;
    // Some platforms/devices reject requestPermissions outright — try to register anyway.
    console.warn('[push] requestPermissions notice:', err?.message || err);
  }

  const registration = await new Promise((resolve, reject) => {
    let settled = false;
    const regTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Push registration timed out. Check your internet connection and try again.'));
      }
    }, 20000);

    const regListener = PushNotifications.addListener('registration', (token) => {
      if (settled) return;
      settled = true;
      clearTimeout(regTimeout);
      cleanup();
      resolve(token);
    });
    const errListener = PushNotifications.addListener('registrationError', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(regTimeout);
      cleanup();
      reject(new Error(err?.error || 'Push registration failed on this device'));
    });
    const cleanup = () => {
      try { regListener.remove(); } catch {}
      try { errListener.remove(); } catch {}
    };

    PushNotifications.register().catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(regTimeout);
      cleanup();
      reject(err);
    });
  });

  const deviceToken = registration?.value;
  if (!deviceToken) throw new Error('Push registration returned no device token');

  const subscription = {
    endpoint: `fcm://${deviceToken}`,
    keys: { p256dh: 'fcm', auth: 'fcm' },
    platform: 'fcm',
  };
  await saveSubscriptionOnServer(userId, subscription);

  try {
    localStorage.setItem(NATIVE_TOKEN_KEY, deviceToken);
    localStorage.setItem(NATIVE_ENABLED_KEY, 'true');
  } catch { /* private mode */ }

  return subscription;
}

// Foreground delivery + tap handling (registered once, on app boot)
if (isNativePlatform()) {
  try {
    // While the app is OPEN, FCM does not show a system notification — post it
    // ourselves as a local notification so the behaviour matches web push.
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('[push] foreground notification:', notification?.title);
      LocalNotifications.schedule({
        notifications: [{
          id: Math.floor(Math.random() * 2_000_000_000),
          title: notification?.title || 'Waguri ❤️',
          body: notification?.body || '',
          schedule: { at: new Date(Date.now() + 50) },
        }],
      }).catch(() => {});
      try {
        window.dispatchEvent(new CustomEvent('waguri-push-received', { detail: notification }));
      } catch {}
    });

    // Tapping a notification opens/resumes the app — route to the payload URL
    // (e.g. /?alarm=... triggers Waguri's spoken alarm greeting). Covers both
    // system notification taps and local (foreground) notification taps.
    const handleTap = (url) => {
      if (url && url !== '/') {
        setTimeout(() => { window.location.href = url; }, 300);
      }
    };
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      handleTap(action?.notification?.data?.url);
    });
    LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      try {
        const url = action?.notification?.extras?.url || action?.notification?.extra?.url;
        handleTap(url);
      } catch {}
    });
  } catch (err) {
    console.warn('[push] native listener setup failed:', err?.message || err);
  }
}

// ------------------------- Web Push path -------------------------------------

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
  // Native: report "subscribed" from the persisted flag so the toggle state and
  // the auto re-subscribe effect on login behave correctly across restarts.
  if (isNativePlatform()) {
    try {
      if (localStorage.getItem(NATIVE_ENABLED_KEY) === 'true') {
        return { endpoint: `fcm://${localStorage.getItem(NATIVE_TOKEN_KEY) || 'persisted'}` };
      }
    } catch {}
    return null;
  }

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
  if (isNativePlatform()) {
    return registerNativePush(userId);
  }

  const support = getPushSupportDetails();
  if (!support.supported) {
    throw new Error(support.message || 'Push notifications are not supported on this device.');
  }

  // Request permission first (must happen inside a user gesture chain)
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        throw new Error(
          perm === 'denied'
            ? 'Notification permission is blocked. Please tap the lock / site settings icon in your browser URL bar and allow Notifications.'
            : 'Notification permission was dismissed.'
        );
      }
    } catch (err) {
      throw new Error(
        Notification.permission === 'denied'
          ? 'Notification permission is blocked. Please tap the lock / site settings icon in your browser URL bar and allow Notifications.'
          : 'Notification permission was dismissed.'
      );
    }
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

  // Register or re-register subscription on backend (bound to the verified JWT identity)
  await saveSubscriptionOnServer(userId, sub.toJSON());

  return sub;
}

export async function unsubscribeFromPush() {
  if (isNativePlatform()) {
    try {
      const token = localStorage.getItem(NATIVE_TOKEN_KEY);
      if (token) {
        await fetch(`${BASE_URL}/api/push/unsubscribe`, {
          method: 'POST',
          headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ endpoint: `fcm://${token}` }),
        }).catch(() => {});
      }
      localStorage.removeItem(NATIVE_TOKEN_KEY);
      localStorage.removeItem(NATIVE_ENABLED_KEY);
      return true;
    } catch (err) {
      console.warn('[push] native unsubscribe error:', err);
    }
    return false;
  }

  if (!isPushSupported()) return false;
  try {
    const reg = await ensureServiceWorker();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      await fetch(`${BASE_URL}/api/push/unsubscribe`, {
        method: 'POST',
        headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
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
  const reg = isNativePlatform() ? null : await ensureServiceWorker().catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;

  const res = await fetch(`${BASE_URL}/api/push/test`, {
    method: 'POST',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
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
    if (reg) {
      await reg.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'waguri-local-test' });
      return true;
    }
    new Notification(title, { body, icon: '/icons/icon-192.png' });
    return true;
  } catch (err) {
    console.warn('[push] local notification error:', err);
    return false;
  }
}
