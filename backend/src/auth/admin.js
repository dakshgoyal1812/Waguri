import { config } from '../config.js';

/**
 * Middleware requiring valid x-admin-token matching config.adminToken.
 * Protects administrative and private inspection routes.
 */
export const requireAdmin = (req, res, next) => {
  if (!config.adminToken) {
    return res.status(403).json({ error: 'ADMIN_TOKEN not configured; endpoint disabled' });
  }
  if (req.get('x-admin-token') !== config.adminToken) {
    return res.status(401).json({ error: 'invalid admin token' });
  }
  next();
};
