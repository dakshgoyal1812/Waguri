import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App as CapApp } from '@capacitor/app';
import { BASE_URL } from './lib/apiBase.js';

// SECURITY: only the publishable/anonymous key belongs in the browser. The
// Supabase SECRET key must never be referenced by frontend code — it is for the
// backend only (see backend/src/auth/supabaseAuth.js).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';

const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes('<') &&
  !supabaseAnonKey.includes('<')
);

// Fallback dummy client if unconfigured so app doesn't crash on boot
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : {
      auth: {
        async getSession() {
          return { data: { session: null } };
        },
        onAuthStateChange(cb) {
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        async signInWithOAuth() {
          alert('Supabase URL or Publishable/Anon Key is not configured in .env yet.');
          return { error: new Error('Supabase not configured') };
        },
        async signOut() {
          return { error: null };
        },
      },
    };

// SECURITY NOTE: there is deliberately NO "bypass user" and NO client-side
// session creation anywhere in this module. The only trusted session is the
// Supabase auth session (a cryptographically signed JWT verified by the backend
// on every API call). Anything written to localStorage by old versions was
// forgeable, so it is purged below.
const LEGACY_INSECURE_KEYS = [
  'waguri_auth_user', // forged-able client-side session (removed)
  'adminToken', // hardcoded admin token leak (removed)
  'waguri_admin_token', // hardcoded admin token leak (removed)
];

export function purgeLegacyAuthKeys() {
  for (const key of LEGACY_INSECURE_KEYS) {
    try { localStorage.removeItem(key); } catch {}
    try { sessionStorage.removeItem(key); } catch {}
  }
}
purgeLegacyAuthKeys();

export const ADMIN_EMAILS = [
  'dakshgoyal1812@gmail.com',
  'dakshgoyal903@gmail.com',
  'dakshgoyal1234567@gmail.com',
  'goyaldaksh284@gmail.com',
  'goelrishika01@gmail.com',
];

export const ALLOWED_EMAILS = [
  'dakshgoyal1812@gmail.com',
  'dakshgoyal903@gmail.com',
  'dakshgoyal1234567@gmail.com',
  'goyaldaksh284@gmail.com',
  'goelrishika01@gmail.com',
  'smartqueue70@gmail.com',
  'diby9693@gmail.com',
];

export function isAdminEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();
  return ADMIN_EMAILS.some((admin) => admin.trim().toLowerCase() === clean);
}

export function isEmailAllowed(email) {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();

  // Admin emails are unconditionally allowed
  if (isAdminEmail(clean)) return true;

  // Check hardcoded defaults
  return ALLOWED_EMAILS.some((allowed) => allowed.trim().toLowerCase() === clean);
}

export async function verifyEmailAccess(email) {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();

  // Admin emails are unconditionally allowed
  if (isAdminEmail(clean)) return true;

  try {
    const res = await fetch(`${BASE_URL}/api/auth/verify-access?email=${encodeURIComponent(clean)}`);
    if (res.ok) {
      const data = await res.json();
      if (typeof data?.allowed === 'boolean') {
        return data.allowed;
      }
    }
  } catch (err) {
    console.warn('[auth] Remote email verification offline, using local verification:', err.message);
  }

  return isEmailAllowed(clean);
}

/**
 * Current Supabase access token (JWT) — the ONLY credential the app sends to the
 * backend. The backend verifies it against Supabase on every protected call.
 */
export async function getAccessToken() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch {
    return null;
  }
}

/**
 * Headers carrying the verified session token. Merge into every backend fetch:
 *   headers: await getAuthHeaders({ 'Content-Type': 'application/json' })
 */
export async function getAuthHeaders(extra = {}) {
  const token = await getAccessToken();
  if (!token) return { ...extra };
  return { ...extra, Authorization: `Bearer ${token}` };
}

export async function signUpWithEmail(email, password) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase credentials missing: Please verify SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
  }
  return await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo: window.location.origin,
    },
  });
}

export async function signInWithEmail(email, password) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase credentials missing: Please verify SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
  }
  return await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
}

export async function signInWithOtp(email) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase credentials missing: Please verify SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
  }
  return await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      emailRedirectTo: window.location.origin,
    },
  });
}

export async function verifyEmailOtp(email, token, type = 'signup') {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase credentials missing: Please verify SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
  }
  const cleanEmail = email.trim();
  const cleanToken = token.trim();
  // Attempt with specified type first ('signup', 'email', or 'magiclink')
  let res = await supabase.auth.verifyOtp({
    email: cleanEmail,
    token: cleanToken,
    type,
  });
  if (res.error && type === 'signup') {
    // Fallback: in case Supabase issued the token as an email/magiclink token
    const fallback = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: 'email',
    });
    if (!fallback.error) return fallback;
  }
  return res;
}

export async function resendVerificationEmail(email) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase credentials missing: Please verify SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
  }
  return await supabase.auth.resend({
    type: 'signup',
    email: email.trim(),
    options: {
      emailRedirectTo: window.location.origin,
    },
  });
}

export async function resetPasswordForEmail(email) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase credentials missing: Please verify SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
  }
  return await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: window.location.origin,
  });
}

export async function signInWithGoogle() {
  if (!isSupabaseConfigured) {
    alert(
      'Supabase credentials missing: Please verify SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in your .env file.'
    );
    return;
  }

  const isNative = Capacitor.isNativePlatform();

  if (isNative) {
    // Native Mobile (Android APK): open external Chrome Custom Tab to bypass WebView 403 disallowed_useragent
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'com.waguri.app://auth-callback',
          skipBrowserRedirect: true,
        },
      });

      if (error) {
        console.error('Google Sign-In Error:', error);
        alert(`Google Sign-In failed: ${error.message}`);
        return;
      }

      if (data?.url) {
        await Browser.open({ url: data.url, windowName: '_system' });
      }
      return data;
    } catch (err) {
      console.error('Native Google Sign-In caught error:', err);
      alert(`Google Sign-In error: ${err.message}`);
      return;
    }
  }

  // Web Browser: standard OAuth redirect
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  });

  if (error) {
    console.error('Google Sign-In Error:', error);
    alert(`Google Sign-In failed: ${error.message}`);
  }
  return data;
}

// Native Capacitor Deep Link Handler for OAuth Callbacks
if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
  CapApp.addListener('appUrlOpen', async ({ url }) => {
    try {
      await Browser.close();
    } catch {}

    if (url && (url.includes('code=') || url.includes('access_token='))) {
      try {
        const dummyUrl = new URL(url.replace('com.waguri.app://', 'https://localhost/'));
        const code = dummyUrl.searchParams.get('code');
        if (code) {
          await supabase.auth.exchangeCodeForSession(code);
          return;
        }

        const hash = dummyUrl.hash.replace(/^#/, '');
        if (hash) {
          const hashParams = new URLSearchParams(hash);
          const access_token = hashParams.get('access_token');
          const refresh_token = hashParams.get('refresh_token');
          if (access_token && refresh_token) {
            await supabase.auth.setSession({ access_token, refresh_token });
            return;
          }
        }
      } catch (err) {
        console.error('[auth] appUrlOpen error:', err);
      }
    }
  });
}

export async function signOutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('Sign Out Error:', error);
  }
}

