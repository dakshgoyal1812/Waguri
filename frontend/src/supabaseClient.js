import { createClient } from '@supabase/supabase-js';

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

export const ALLOWED_EMAILS = [
  'dakshgoyal1812@gmail.com',
  'goyaldaksh284@gmail.com',
  'dakshgoyal1234567@gmail.com',
];

export function isEmailAllowed(email) {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();
  return ALLOWED_EMAILS.some((allowed) => allowed.trim().toLowerCase() === clean);
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
