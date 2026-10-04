// Single source of truth for the backend base URL, shared by api.js and
// supabaseClient.js (kept dependency-free so both can import it without cycles).
//
// In dev: proxies /api via Vite proxy to backend port.
// In prod (Vercel): uses NEXT_PUBLIC_API_URL or VITE_API_URL or relative /api.
// If unset in production, defaults to the live Render backend.
export const PROD_DEFAULT_BACKEND = 'https://waguri-zhf3.onrender.com';
export const BASE_URL = (
  import.meta.env.VITE_API_URL ||
  import.meta.env.NEXT_PUBLIC_API_URL ||
  (import.meta.env.DEV ? '' : PROD_DEFAULT_BACKEND)
).replace(/\/$/, '');
