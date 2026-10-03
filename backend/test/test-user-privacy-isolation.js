// Test Suite: User Chat & Email Privacy Isolation
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createMemoryStorage } from '../src/db/memory.js';

console.log('--- Running User Privacy & Email Isolation Tests ---');

// 1. Verify single email verification endpoint doesn't leak all users
{
  const storage = createMemoryStorage();
  await storage.addAllowedUser('alice@test.com', 'admin');
  await storage.addAllowedUser('bob@test.com', 'admin');

  const ADMIN_EMAILS = ['dakshgoyal1812@gmail.com'];

  const app = express();
  app.use(express.json());

  app.get('/api/auth/verify-access', async (req, res) => {
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email parameter required' });
    if (ADMIN_EMAILS.includes(email)) return res.json({ ok: true, allowed: true, isAdmin: true });
    const list = await storage.listAllowedUsers();
    const isAllowed = list.some((u) => {
      const e = (typeof u === 'string' ? u : u.email).trim().toLowerCase();
      return e === email;
    });
    return res.json({ ok: true, allowed: isAllowed, isAdmin: false });
  });

  app.get('/api/admin/allowed-users', async (req, res) => {
    const adminEmail = (req.query.adminEmail || req.get('x-admin-email') || '').trim().toLowerCase();
    const isAdmin = ADMIN_EMAILS.includes(adminEmail);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Unauthorized: only primary admins can manage access' });
    }
    const list = await storage.listAllowedUsers();
    res.json({ ok: true, users: list, admin_emails: ADMIN_EMAILS });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Test Alice checking her own access
  const resAlice = await fetch(`${baseUrl}/api/auth/verify-access?email=alice@test.com`);
  const dataAlice = await resAlice.json();
  assert.equal(dataAlice.ok, true);
  assert.equal(dataAlice.allowed, true);
  assert.equal(dataAlice.isAdmin, false);
  assert.equal(dataAlice.users, undefined, 'Must NEVER return the user list in verification response');

  // Test Charlie (not in whitelist)
  const resCharlie = await fetch(`${baseUrl}/api/auth/verify-access?email=charlie@test.com`);
  const dataCharlie = await resCharlie.json();
  assert.equal(dataCharlie.ok, true);
  assert.equal(dataCharlie.allowed, false);
  assert.equal(dataCharlie.users, undefined, 'Must NEVER return the user list');

  // Test unauthenticated access to /api/admin/allowed-users (must be 403 Forbidden)
  const resForbidden = await fetch(`${baseUrl}/api/admin/allowed-users`);
  assert.equal(resForbidden.status, 403, 'Unauthenticated user list access must return 403 Forbidden');
  const forbiddenData = await resForbidden.json();
  assert.equal(forbiddenData.users, undefined, 'Must not return users when unauthorized');

  // Test non-admin user trying to access /api/admin/allowed-users
  const resAliceDenied = await fetch(`${baseUrl}/api/admin/allowed-users?adminEmail=alice@test.com`);
  assert.equal(resAliceDenied.status, 403, 'Non-admin user must return 403 Forbidden');

  // Test primary admin accessing /api/admin/allowed-users
  const resAdmin = await fetch(`${baseUrl}/api/admin/allowed-users?adminEmail=dakshgoyal1812@gmail.com`);
  assert.equal(resAdmin.status, 200, 'Admin must receive 200 OK');
  const adminData = await resAdmin.json();
  assert.equal(adminData.ok, true);
  assert(Array.isArray(adminData.users));
  assert.equal(adminData.users.length, 4);

  await new Promise((resolve) => server.close(resolve));
  console.log('✓ Endpoint security & user email privacy passed');
}

// 2. Latest conversation user isolation test
{
  const storage = createMemoryStorage();
  const convUser1 = await storage.createConversation({ persona_id: 'p1', user_id: 'user1@test.com' });
  await storage.addMessage({ conversation_id: convUser1.id, role: 'user', content: 'Secret message from User 1' });

  const convUser2 = await storage.createConversation({ persona_id: 'p1', user_id: 'user2@test.com' });
  await storage.addMessage({ conversation_id: convUser2.id, role: 'user', content: 'Secret message from User 2' });

  // User 1 requests their latest conversation
  const latest1 = await storage.getLatestConversation('user1@test.com');
  assert.equal(latest1.id, convUser1.id);
  assert.equal(latest1.user_id, 'user1@test.com');
  const hist1 = await storage.getHistory(latest1.id, { page: 1, limit: 10 });
  assert.equal(hist1.items[0].content, 'Secret message from User 1');

  // User 2 requests their latest conversation
  const latest2 = await storage.getLatestConversation('user2@test.com');
  assert.equal(latest2.id, convUser2.id);
  assert.equal(latest2.user_id, 'user2@test.com');
  const hist2 = await storage.getHistory(latest2.id, { page: 1, limit: 10 });
  assert.equal(hist2.items[0].content, 'Secret message from User 2');

  // Cross-user history check
  const crossUserHist = await storage.getConversation(convUser1.id);
  assert.equal(crossUserHist.user_id, 'user1@test.com');
  assert.notEqual(crossUserHist.user_id, 'user2@test.com');

  console.log('✓ Conversation history strict per-account isolation passed');
}

console.log('ALL USER PRIVACY & EMAIL ISOLATION TESTS PASSED! 🎉');
