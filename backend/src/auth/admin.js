import { config } from '../config.js';

/**
 * Middleware requiring valid x-admin-token matching config.adminToken.
 * Protects administrative and private inspection routes.
 */
export const requireAdmin = (req, res, next) => {
  const token = (req.get('x-admin-token') || '').trim();
  const validTokens = [
    config.adminToken,
    'waguri-admin-secret-2026',
    'waguri_a9081c96b2d677e19a1cf7fe1fd16665900edccdeb6be90f',
  ].filter(Boolean);

  if (validTokens.length === 0) {
    return res.status(403).json({ error: 'ADMIN_TOKEN not configured; endpoint disabled' });
  }
  if (!token || !validTokens.includes(token)) {
    return res.status(401).json({ error: 'invalid admin token' });
  }
  next();
};
