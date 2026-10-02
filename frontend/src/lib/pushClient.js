// Client-side Web Push subscription helper for Waguri PWA
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

export function isPushSupported() {
  return typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
}

export function getNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function getExistingSubscription() {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch (err) {
    console.warn('[push] failed to get existing subscription:', err);
    return null;
  }
}

export async function subscribeToPush(userId = 'local-user') {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported on this browser/device.');
  }

  // Request permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(permission === 'denied'
      ? 'Notification permission was denied. Please allow notifications in your browser/phone settings.'
      : 'Notification permission was dismissed.');
  }

  // Fetch VAPID public key from backend
  const resKey = await fetch('/api/push/vapid-public-key');
  if (!resKey.ok) {
    throw new Error('Failed to retrieve VAPID key from backend');
  }
  const { publicKey } = await resKey.json();
  if (!publicKey) throw new Error('VAPID public key is missing on backend');

  const reg = await navigator.serviceWorker.ready;
  try { await reg.update(); } catch {}

  let sub = await reg.pushManager.getSubscription();

  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  // Register subscription on backend
  const resSub = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      subscription: sub.toJSON(),
    }),
  });

  if (!resSub.ok) {
    throw new Error('Failed to save push subscription on server');
  }

  return sub;
}

export async function unsubscribeFromPush() {
  if (!isPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      return await sub.unsubscribe();
    }
  } catch (err) {
    console.warn('[push] unsubscribe error:', err);
  }
  return false;
}

export async function sendTestNotification(userId = 'local-user') {
  const res = await fetch('/api/push/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      title: 'Waguri ❤️',
      message: 'Suno na! Push notifications phone par perfectly work kar rahe hain ✨',
    }),
  });
  return await res.json();
}

export async function showLocalNotification(title = 'Waguri ❤️', body = 'Test Notification: Device par notifications successfully allow ho gayi hain! ✨') {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, {
      body,
      icon: '/logo.png',
      badge: '/icons/icon-192.png',
      vibrate: [200, 100, 200],
      tag: 'waguri-direct-test',
      renotify: true,
      data: { url: '/' },
    });
    return true;
  } catch (err) {
    console.warn('[push] direct showNotification failed:', err);
    return false;
  }
}

