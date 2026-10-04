import express from 'express';
import { requireAdmin } from '../auth/admin.js';
import {
  requireAuth,
  resolveIdentity,
  createRateLimiter,
  checkVaultPassword,
  signVaultToken,
  verifyVaultToken,
  isValidAdminToken,
} from '../auth/supabaseAuth.js';
import { embed as defaultEmbed } from '../rag/embeddings.js';

let activeStorage = null;
let activeEmbedder = null;
const cacheInvalidationListeners = new Set();

// Brute-force protection for the vault passcode endpoint (per IP).
const unlockLimiter = createRateLimiter({ windowMs: 5 * 60_000, max: 8 });

/**
 * Register a listener to be notified when memory entries are edited or deleted.
 */
export function onMemoryCacheInvalidate(fn) {
  cacheInvalidationListeners.add(fn);
  return () => cacheInvalidationListeners.delete(fn);
}

/**
 * Invalidate any in-process memory cache.
 */
export function invalidateMemoryCache() {
  for (const fn of cacheInvalidationListeners) {
    try { fn(); } catch (err) {
      console.warn('[memory-cache] cache invalidation listener threw:', err.message);
    }
  }
}

/**
 * Configure the active storage instance used by the memory inspector.
 */
export function setMemoryStorage(storage) {
  activeStorage = storage;
}

/**
 * Configure a custom embedder function or instance.
 */
export function setMemoryEmbedder(embedder) {
  activeEmbedder = embedder;
}

async function getStorage() {
  if (activeStorage) return activeStorage;
  // Lazy-load storage if not explicitly provided
  const { createStorage } = await import('../db/index.js');
  activeStorage = await createStorage();
  return activeStorage;
}

async function runEmbed(text) {
  if (activeEmbedder) {
    if (typeof activeEmbedder.embed === 'function') {
      return activeEmbedder.embed(text);
    }
    if (typeof activeEmbedder === 'function') {
      return activeEmbedder(text);
    }
  }
  return defaultEmbed(text);
}

/**
 * Factory function to create an isolated Memory Router instance.
 */
export function createMemoryRouter(options = {}) {
  const router = express.Router();

  // POST /unlock — exchange the vault passcode for a short-lived vault token.
  // The passcode is checked SERVER-SIDE (constant-time) and rate-limited per IP,
  // so it is never stored in or verifiable from the client bundle.
  router.post('/unlock', unlockLimiter, async (req, res) => {
    try {
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!password) {
        return res.status(400).json({ error: 'password is required' });
      }
      if (!checkVaultPassword(password)) {
        return res.status(401).json({ error: 'Incorrect vault password. Access denied.' });
      }
      // Identify who unlocked: verified JWT identity when presented, else anonymous.
      const identity = await resolveIdentity(req).catch(() => null);
      const email = identity?.email || 'vault-user';
      res.json({ ok: true, vault_token: signVaultToken(email), expires_in_ms: options.vaultTokenTtlMs || undefined });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Unlock failed' });
    }
  });

  // Everything below requires EITHER a valid vault token (minted by /unlock,
  // bound to the verified Supabase identity) OR the server-side ADMIN_TOKEN
  // (maintenance scripts + tests). Client-claimed emails are never trusted.
  const authMiddleware = options.authMiddleware || options.requireAdmin || defaultVaultAuth;
  router.use(authMiddleware);

  async function defaultVaultAuth(req, res, next) {
    // 1. Legacy/server-side path: ADMIN_TOKEN header (constant-time checked).
    if (isValidAdminToken(req.get('x-admin-token'))) {
      req.memoryAccess = { full: true };
      return next();
    }
    // 2. Interactive path: verified Supabase identity + vault token.
    const identity = await resolveIdentity(req).catch(() => null);
    if (!identity) {
      return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    }
    const vault = verifyVaultToken(req.get('x-vault-token'));
    if (!vault) {
      return res.status(401).json({ error: 'Vault locked. Unlock with the memory password first.' });
    }
    if (vault.email !== identity.email && !identity.isAdmin) {
      return res.status(403).json({ error: 'Vault token does not match the signed-in account' });
    }
    req.memoryAccess = { full: identity.isAdmin, email: identity.email };
    return next();
  }

  const getTargetStorage = async () => options.storage || await getStorage();
  const getTargetEmbed = async (text) => {
    if (options.embedder) {
      if (typeof options.embedder.embed === 'function') return options.embedder.embed(text);
      if (typeof options.embedder === 'function') return options.embedder(text);
    }
    return runEmbed(text);
  };

  // GET / — Paginated memory listing with optional text search (NEVER returns embeddings)
  router.get('/', async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
      const q = String(req.query.q || '').replace(/[%_,]/g, '').trim();
      const before = req.query.before ? String(req.query.before).trim() : null;
      const userId = req.query.user_id || req.get('x-user-id') || null;

      const storage = await getTargetStorage();
      const data = await storage.listMemoryVectors({ limit, before, q, userId });
      const nextCursor = data.length === limit ? data.at(-1)?.created_at : null;

      res.json({ items: data, next: nextCursor });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to list memories' });
    }
  });

  // POST / — Add a custom memory chunk for a user
  router.post('/', async (req, res) => {
    try {
      const text = String(req.body?.content_chunk || req.body?.text || '').trim();
      if (!text || text.length > 2000) {
        return res.status(400).json({ error: 'Text must be between 1 and 2000 characters' });
      }
      const userId = req.body?.user_id || req.query.user_id || req.get('x-user-id') || 'local-user';

      const storage = await getTargetStorage();

      // Find or create a conversation for this user to associate the memory
      let conv = await storage.getLatestConversation?.(userId);
      if (!conv) {
        const defaultPersona = await storage.getDefaultPersona?.();
        conv = await storage.createConversation?.({
          persona_id: defaultPersona?.id || 'waguri-default',
          user_id: userId,
        });
      }

      if (!conv || !conv.id) {
        return res.status(500).json({ error: 'Could not resolve conversation for user' });
      }

      // Re-embed with active embedder
      const embedding = await getTargetEmbed(text);
      const inserted = await storage.insertMemoryVector({
        conversation_id: conv.id,
        content_chunk: text,
        embedding,
      });

      invalidateMemoryCache();
      res.status(201).json({
        id: inserted.id,
        content_chunk: text,
        conversation_id: conv.id,
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to create custom memory' });
    }
  });

  // PATCH /:id — Validate 1-2000 chars, RE-EMBED with embedder, then update
  router.patch('/:id', async (req, res) => {
    try {
      const text = String(req.body?.content_chunk || '').trim();
      if (!text || text.length > 2000) {
        return res.status(400).json({ error: 'Text must be between 1 and 2000 characters' });
      }

      // IMPORTANT: re-embed, otherwise semantic search still matches the OLD text
      const embedding = await getTargetEmbed(text);
      const storage = await getTargetStorage();
      const updated = await storage.updateMemoryVector(req.params.id, { content_chunk: text, embedding });
      if (!updated) {
        return res.status(404).json({ error: 'Memory not found' });
      }

      invalidateMemoryCache();
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to update memory' });
    }
  });

  // DELETE /:id — Remove memory row
  router.delete('/:id', async (req, res) => {
    try {
      const storage = await getTargetStorage();
      const deleted = await storage.deleteMemoryVector(req.params.id);
      invalidateMemoryCache();
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to delete memory' });
    }
  });

  // POST /bulk-delete — Remove up to 100 memory rows by id
  router.post('/bulk-delete', async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 100) : [];
      if (!ids.length) {
        return res.status(400).json({ error: 'No ids provided' });
      }

      const storage = await getTargetStorage();
      const count = await storage.bulkDeleteMemoryVectors(ids);
      invalidateMemoryCache();
      res.json({ deleted: count });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to bulk delete memories' });
    }
  });

  // GET /export — Export memories as JSON attachment (never includes embeddings)
  router.get('/export', async (req, res) => {
    try {
      const userId = req.query.user_id || req.get('x-user-id') || null;
      const storage = await getTargetStorage();
      const data = await storage.exportMemoryVectors(userId);
      res.setHeader('Content-Disposition', 'attachment; filename="waguri-memories.json"');
      res.setHeader('Content-Type', 'application/json');
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message || 'Failed to export memories' });
    }
  });

  return router;
}

const defaultRouter = createMemoryRouter();
export default defaultRouter;
