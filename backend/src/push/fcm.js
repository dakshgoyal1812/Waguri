// Firebase Cloud Messaging (FCM HTTP v1) sender for the native Android app.
//
// Why: the Capacitor Android WebView does NOT implement the Web Push API, so the
// APK cannot receive web-push notifications. The native app instead registers an
// FCM device token via @capacitor/push-notifications; the backend stores it as a
// push subscription whose endpoint is `fcm://<token>` and delivers to it here.
//
// Zero new dependencies: the OAuth2 service-account flow (RS256 JWT -> access
// token) is implemented with node:crypto, then FCM HTTP v1 is a plain fetch.
// Configure with the FCM_SERVICE_ACCOUNT_JSON env var (raw JSON or base64 of the
// Firebase service-account private key file).
import crypto from 'node:crypto';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SEND_URL = (projectId) => `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

let serviceAccount = null;
let cachedAccessToken = null; // { token, expiresAt }

function parseServiceAccount() {
  const raw = (process.env.FCM_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  try {
    let json = raw;
    // Accept base64-encoded JSON for easier env-var handling
    if (!raw.startsWith('{')) {
      json = Buffer.from(raw, 'base64').toString('utf8');
    }
    const parsed = JSON.parse(json);
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
      console.error('[fcm] service account JSON missing client_email/private_key/project_id');
      return null;
    }
    return parsed;
  } catch (err) {
    console.error('[fcm] could not parse FCM_SERVICE_ACCOUNT_JSON:', err.message);
    return null;
  }
}

export function isFcmConfigured() {
  if (serviceAccount === null) serviceAccount = parseServiceAccount();
  return !!serviceAccount;
}

// Sign a JWT assertion with the service account private key (RS256).
function mintJwtAssertion(sa, nowMs = Date.now()) {
  const b64url = (buf) => Buffer.from(buf).toString('base64url');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(nowMs / 1000);
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: FCM_SCOPE,
    aud: OAUTH_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  signer.end();
  const sig = signer.sign(sa.private_key).toString('base64url');
  return `${header}.${claims}.${sig}`;
}

async function getAccessToken() {
  if (serviceAccount === null) serviceAccount = parseServiceAccount();
  const sa = serviceAccount;
  if (!sa) throw new Error('FCM not configured: FCM_SERVICE_ACCOUNT_JSON missing');

  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: mintJwtAssertion(sa),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`FCM OAuth token exchange failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error('FCM OAuth response missing access_token');
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return cachedAccessToken.token;
}

/**
 * Deliver a notification to a native FCM device token.
 * Mirrors the web-push payload shape used by the Waguri service worker.
 * @returns {Promise<{success: boolean, error?: string, status?: number, unregistered?: boolean}>}
 */
export async function sendFcmNotification(deviceToken, { title, body, icon, tag, url = '/', timestamp }) {
  if (!isFcmConfigured()) {
    return { success: false, error: 'FCM not configured: FCM_SERVICE_ACCOUNT_JSON missing' };
  }
  try {
    const accessToken = await getAccessToken();
    const res = await fetch(FCM_SEND_URL(serviceAccount.project_id), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title: title || 'Waguri ❤️', body: body || '' },
          data: {
            // FCM data payload values must be strings
            url: String(url || '/'),
            tag: String(tag || `waguri-${Date.now()}`),
            icon: String(icon || '/icons/icon-192.png'),
            timestamp: String(timestamp || Date.now()),
          },
          android: { priority: 'HIGH' },
        },
      }),
    });

    if (res.ok) return { success: true };

    const errText = await res.text().catch(() => '');
    // 404/410 or UNREGISTERED means this device token is dead — caller cleans up.
    const unregistered =
      res.status === 404 ||
      res.status === 410 ||
      /UNREGISTERED|INVALID_ARGUMENT.*registration token/i.test(errText);
    return { success: false, error: errText.slice(0, 300), status: res.status, unregistered };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
