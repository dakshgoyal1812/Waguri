import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Middleware requiring valid x-admin-token matching config.adminToken.
 * Protects administrative and private inspection routes (cron + maintenance only —
 * browser users must use their Supabase session instead; see supabaseAuth.js).
 * Uses a constant-time comparison so response timing cannot leak the token.
 */
export const requireAdmin = (req, res, next) => {
  if (!config.adminToken) {
    return res.status(403).json({ error: 'ADMIN_TOKEN not configured; endpoint disabled' });
  }
  const presented = req.get('x-admin-token') || '';
  const a = Buffer.from(String(presented));
  const b = Buffer.from(config.adminToken);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    return res.status(401).json({ error: 'invalid admin token' });
  }
  next();
};
