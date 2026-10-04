// FCM (native Android push) path tests:
//  1. Unconfigured FCM reports gracefully (no crash).
//  2. Malformed service account keys fail gracefully.
//  3. fcm:// subscriptions persist through storage and reach the push service
//     sender (they must not be filtered out or rejected by key validation).
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/db/memory.js';
import { isFcmConfigured, sendFcmNotification } from '../src/push/fcm.js';
import { createPushService } from '../src/push/index.js';

console.log('--- Running FCM Native Push Tests ---');

delete process.env.FCM_SERVICE_ACCOUNT_JSON;

// 1. Unconfigured: must report not-configured without crashing
assert.equal(isFcmConfigured(), false, 'FCM must be unconfigured without env var');
const noCfg = await sendFcmNotification('dummy-token', { title: 't', body: 'b' });
assert.equal(noCfg.success, false);
assert.match(noCfg.error, /not configured/i);
console.log('✓ unconfigured FCM degrades gracefully');

// 2. Malformed private key: graceful failure (no throw)
process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'sa@waguri.iam.gserviceaccount.com',
  private_key: 'not-a-real-key',
  project_id: 'waguri-app',
});
const badKey = await sendFcmNotification('dummy-token', { title: 't', body: 'b' });
assert.equal(badKey.success, false);
assert.ok(badKey.error, 'must return an error, never throw');
console.log('✓ malformed service account fails gracefully');

// 3. fcm:// subscriptions round-trip through storage and reach the sender
const storage = createMemoryStorage();
await storage.upsertPushSubscription({
  user_id: 'user@test.com',
  endpoint: 'fcm://e2e-device-token-abc',
  p256dh: 'fcm',
  auth: 'fcm',
});
const listed = await storage.listPushSubscriptions('user@test.com');
assert.equal(listed.length, 1);
assert.equal(listed[0].endpoint, 'fcm://e2e-device-token-abc');

let deliveredTo = null;
const pushService = createPushService({
  storage,
  callLLM: null,
  getPersona: async () => ({ name: 'Waguri' }),
  sendToSub: async (sub, payload) => {
    deliveredTo = { endpoint: sub.endpoint, payload };
    return { success: true, endpoint: sub.endpoint };
  },
});
const result = await pushService.sendNotification({
  userId: 'user@test.com',
  title: 'Waguri ❤️',
  body: 'native test',
  tag: 'fcm-test',
});
assert.equal(result.sent, 1, 'FCM subscription must receive the push');
assert.equal(deliveredTo.endpoint, 'fcm://e2e-device-token-abc');
assert.equal(deliveredTo.payload.title, 'Waguri ❤️');
console.log('✓ fcm:// endpoints persist and reach the delivery layer');

console.log('=== FCM Native Push Tests: ALL PASS ===');
