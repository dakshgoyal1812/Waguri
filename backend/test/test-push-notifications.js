// Test suite for Web Push Notification Service & Scheduler
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/db/memory.js';
import { createPushService } from '../src/push/index.js';
import { createPushScheduler } from '../src/push/scheduler.js';

console.log('► Testing Push Subscriptions Storage Operations...');
const storage = createMemoryStorage();

// 1. Storage Operations
const sub1 = await storage.upsertPushSubscription({
  user_id: 'daksh@example.com',
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-token-1',
  p256dh: 'BNcRdreALRF8FsII...',
  auth: 'tBHItDaA...',
});
assert.equal(sub1.user_id, 'daksh@example.com');
assert.equal(sub1.endpoint, 'https://fcm.googleapis.com/fcm/send/device-token-1');

const sub2 = await storage.upsertPushSubscription({
  user_id: 'local-user',
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-token-2',
  p256dh: 'CPcRdreALRF8FsII...',
  auth: 'uCHItDaA...',
});

let userSubs = await storage.listPushSubscriptions('daksh@example.com');
assert.equal(userSubs.length, 1);
assert.equal(userSubs[0].endpoint, 'https://fcm.googleapis.com/fcm/send/device-token-1');

let allSubs = await storage.listPushSubscriptions();
assert.equal(allSubs.length, 2);

console.log('✔ Storage operations passed.');

// 2. Push Service Tests
console.log('► Testing Push Service Send & Fallback Logic...');
const sentPayloads = [];
const mockStorage = {
  ...storage,
  async listPushSubscriptions(userId) {
    return storage.listPushSubscriptions(userId);
  },
  async recordPushNotification({ slot }) {
    await storage.recordPushNotification({ slot });
  },
};

const pushService = createPushService({
  storage: mockStorage,
  callLLM: async ([sys]) => ({ text: 'Good morning Daksh! Nashta kar liya na? ✨' }),
  getPersona: async () => ({ name: 'Waguri', user_name: 'Daksh' }),
  sendToSub: async (sub, payload) => {
    sentPayloads.push({ endpoint: sub.endpoint, payload });
    return { success: true, endpoint: sub.endpoint };
  },
});

// Test manual notification (should not set last_notified_at cooldown)
const testBeforeTime = await storage.getLastPushNotificationTime();
assert.equal(testBeforeTime, null);

const manualRes = await pushService.sendNotification({
  userId: 'non-existent-user', // Should fallback to all subscriptions!
  isTest: true,
  tag: 'waguri-manual-test',
  title: 'Test Title',
  body: 'Test Body',
});
assert.equal(manualRes.sent, 2, 'Fallback should send to all active devices');
assert.equal(sentPayloads.length, 2);

const testAfterTime = await storage.getLastPushNotificationTime();
assert.equal(testAfterTime, null, 'Manual test must not update last_notified_at cooldown');

// Test targeted endpoint notification
sentPayloads.length = 0;
const targetedRes = await pushService.sendNotification({
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-token-1',
  isTest: true,
  title: 'Targeted Title',
  body: 'Targeted Body',
});
assert.equal(targetedRes.sent, 1);
assert.equal(sentPayloads[0].endpoint, 'https://fcm.googleapis.com/fcm/send/device-token-1');

// Test auto girlfriend message
const autoRes = await pushService.sendAutoGirlfriendMessage({ userId: null });
assert.equal(autoRes.sent, 2);
const autoTime = await storage.getLastPushNotificationTime();
assert.ok(autoTime > 0, 'Autonomous message should record last_notified_at');

console.log('✔ Push Service send & fallback passed.');

// 3. Scheduler Tests
console.log('► Testing Autonomous Scheduler Slots & Throttling...');
const scheduler = createPushScheduler({
  storage,
  pushService,
  callLLM: async () => ({ text: 'Lunch kiya kya baby? 💕' }),
  getPersona: async () => ({ name: 'Waguri', user_name: 'Daksh' }),
});

// Force morning slot
const morningRes = await scheduler.evaluateAndSend({ force: true, slotOverride: 'morning' });
assert.equal(morningRes.sent, 2);
assert.equal(morningRes.trigger, 'slot_morning');

// Second call for same slot on same day should be rejected as already fired
const duplicateMorning = await scheduler.evaluateAndSend({ force: false, slotOverride: 'morning' });
assert.equal(duplicateMorning.sent, 0);
assert.equal(duplicateMorning.reason, 'slot_already_fired_today');

// Force inactivity slot
const inactivityRes = await scheduler.evaluateAndSend({ force: true, slotOverride: 'inactivity' });
assert.equal(inactivityRes.sent, 2);
assert.equal(inactivityRes.trigger, 'inactivity_manual');

console.log('✔ Autonomous scheduler passed.');
console.log('All Push Notification unit & integration tests completed successfully! 🎉');
