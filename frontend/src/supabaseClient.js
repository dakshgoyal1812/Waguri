import { createClient } from '@supabase/supabase-js';
import { fetchAllowedUsers } from './api.js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  '';

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

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

export const ADMIN_EMAILS = [
  'dakshgoyal1234567@gmail.com',
  'dakshgoyal1812@gmail.com',
];

export const ALLOWED_EMAILS = [
  'dakshgoyal1812@gmail.com',
  'goyaldaksh284@gmail.com',
  'dakshgoyal1234567@gmail.com',
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

  // Check cached dynamic allowed users from localStorage
  try {
    const cached = JSON.parse(localStorage.getItem('waguri_allowed_users') || '[]');
    if (Array.isArray(cached) && cached.some((e) => (typeof e === 'string' ? e : e.email).trim().toLowerCase() === clean)) {
      return true;
    }
  } catch {
    // ignore json error
  }

  // Check hardcoded defaults
  return ALLOWED_EMAILS.some((allowed) => allowed.trim().toLowerCase() === clean);
}

export async function verifyEmailAccess(email) {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();

  // Admin emails are unconditionally allowed
  if (isAdminEmail(clean)) return true;

  try {
    const data = await fetchAllowedUsers();
    if (data?.users && Array.isArray(data.users)) {
      const emailList = data.users.map((u) => (typeof u === 'string' ? u : u.email).trim().toLowerCase());
      try {
        localStorage.setItem('waguri_allowed_users', JSON.stringify(emailList));
      } catch {}
      return emailList.includes(clean);
    }
  } catch (err) {
    console.warn('[auth] Dynamic whitelist check offline, using local verification:', err.message);
  }

  return isEmailAllowed(clean);
}

export async function signInWithGoogle() {
  if (!isSupabaseConfigured) {
    alert(
      'Supabase credentials missing: Please verify SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in your .env file.'
    );
    return;
  }
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

export async function signOutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('Sign Out Error:', error);
  }
}
