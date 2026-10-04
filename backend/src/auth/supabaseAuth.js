// Real server-side authentication for the Waguri backend.
//
// Threat model fixed here:
//  - Previously user_id was whatever string the client sent, so anyone could read
//    or write ANY account's data by guessing an email. Now every protected route
//    derives the identity from a Supabase access token (verified against the
//    Supabase Auth server) and ignores client-claimed identities entirely.
//  - Admin routes previously trusted a client-claimed "adminEmail" header. Now
//    admin access requires a verified JWT whose email is on config.adminEmails.
//  - Test mode (WAGURI_TEST=1, never set in prod) keeps unit tests working by
//    accepting x-test-user-id identities against in-memory storage.
import crypto from 'node:crypto';
import { config } from '../config.js';

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  '';

export function isAdminEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const clean = email.trim().toLowerCase();
  return config.adminEmails.includes(clean);
}

function identityFromSupabaseUser(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email) return null;
  return { id: user.id || email, email, isAdmin: isAdminEmail(email) };
}

// --- Supabase token verification with a small TTL cache -----------------------
// GET {SUPABASE_URL}/auth/v1/user with the caller's access token returns 200 +
// the user object only when the JWT is genuinely signed by this project and
// unexpired — that is the source of truth. Results are cached briefly per token
// so per-request network calls don't hammer Supabase under load.
const tokenCache = new Map(); // sha256(token) -> { identity, expiresAt }
const TOKEN_CACHE_TTL_MS = 5 * 60_000;
const TOKEN_CACHE_MAX = 5_000;

function cacheKey(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function pruneTokenCache(now = Date.now()) {
  for (const [k, v] of tokenCache) {
    if (v.expiresAt <= now) tokenCache.delete(k);
  }
  while (tokenCache.size > TOKEN_CACHE_MAX) {
    tokenCache.delete(tokenCache.keys().next().value);
  }
}

export async function verifySupabaseToken(token) {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return null;
  const key = cacheKey(token);
  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.identity;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_SECRET_KEY,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  const identity = identityFromSupabaseUser(user);
  if (!identity) return null;

  if (tokenCache.size >= TOKEN_CACHE_MAX) pruneTokenCache();
  tokenCache.set(key, { identity, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
  return identity;
}

/**
 * Resolve the caller's identity from the request.
 *  1. `Authorization: Bearer <supabase access token>` — verified with Supabase.
 *     An INVALID presented token denies the request (no silent fallback).
 *  2. Test mode only: x-test-user-id header or the legacy local-user default.
 *  3. Otherwise null (caller gets a 401).
 */
export async function resolveIdentity(req) {
  const authHeader = req.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (!token) return null;
    const identity = await verifySupabaseToken(token).catch(() => null);
    return identity; // null when invalid/expired — never fall through
  }
  if (config.isTestMode) {
    const testId = String(req.get('x-test-user-id') || '').trim().toLowerCase();
    if (testId) {
      return { id: testId, email: testId, isAdmin: isAdminEmail(testId) };
    }
    return { id: 'local-user', email: 'local-user', isAdmin: false };
  }
  return null;
}

/**
 * Express middleware: 401 unless the request carries a verified Supabase session.
 * Attaches req.user = { id, email, isAdmin }.
 */
export function requireAuth(req, res, next) {
  resolveIdentity(req)
    .then((identity) => {
      if (!identity) {
        return res.status(401).json({ error: 'Authentication required. Please sign in.' });
      }
      req.user = identity;
      next();
    })
    .catch(next);
}

/**
 * Express middleware: 403 unless the verified identity is a configured admin.
 * Resolves the identity itself when requireAuth has not run on this route.
 */
export function requireAdminUser(req, res, next) {
  const ensure = req.user ? Promise.resolve(req.user) : resolveIdentity(req);
  ensure
    .then((identity) => {
      if (!identity) {
        return res.status(401).json({ error: 'Authentication required. Please sign in.' });
      }
      req.user = identity;
      if (!identity.isAdmin) {
        return res.status(403).json({ error: 'Forbidden: admin account required' });
      }
      next();
    })
    .catch(next);
}

/**
 * Express middleware: verified admin JWT OR the server-side ADMIN_TOKEN header.
 * Used by maintenance routes so cron jobs and curl keep working while browser
 * callers must be signed in as admins.
 */
export function requireAnyAdmin(req, res, next) {
  if (req.user?.isAdmin) return next();
  if (isValidAdminToken(req.get('x-admin-token'))) return next();
  resolveIdentity(req)
    .then((identity) => {
      if (identity?.isAdmin) {
        req.user = identity;
        return next();
      }
      return res.status(403).json({ error: 'Forbidden: admin account or admin token required' });
    })
    .catch(next);
}

// --- ADMIN_TOKEN helpers (constant-time) --------------------------------------
function isValidAdminToken(presented) {
  if (!config.adminToken || typeof presented !== 'string') return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(config.adminToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- In-memory rate limiter -----------------------------------------------------
// Per-key sliding window. Good enough for a single Render instance; restarts
// reset counters which is acceptable for abuse mitigation (not accounting).
const limiterCleanup = new Set();

export function createRateLimiter({ windowMs = 60_000, max = 100, keyBy = (req) => req.ip } = {}) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) {
      if (v.resetAt <= now) hits.delete(k);
    }
  }, windowMs);
  timer.unref?.();
  limiterCleanup.add(timer);

  return function rateLimit(req, res, next) {
    const key = String(keyBy(req) || req.ip || 'unknown');
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    return next();
  };
}

// --- Memory Vault tokens ---------------------------------------------------------
// Unlocking the vault with the server-side passcode mints a short-lived HMAC
// token. The frontend then presents it on /api/memory/* calls, so the passcode
// itself is sent exactly once and the vault session expires automatically.
const vaultSecret = crypto
  .createHash('sha256')
  .update(`waguri-vault:${config.adminToken}:${config.encryptionKey}`)
  .digest();

export function signVaultToken(email, ttlMs = config.vaultTokenTtlMs) {
  const payload = `${email}.${Date.now() + ttlMs}`;
  const sig = crypto.createHmac('sha256', vaultSecret).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export function verifyVaultToken(token) {
  if (typeof token !== 'string' || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  let payload;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = crypto.createHmac('sha256', vaultSecret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const dot = payload.lastIndexOf('.');
  if (dot === -1) return null;
  const email = payload.slice(0, dot);
  const exp = Number(payload.slice(dot + 1));
  if (!email || !Number.isFinite(exp) || exp < Date.now()) return null;
  return { email };
}

export function checkVaultPassword(presented) {
  if (typeof presented !== 'string' || !config.memoryVaultPassword) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(config.memoryVaultPassword);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export { isValidAdminToken };
