// Autonomous Push Notification Scheduler for Waguri
// Handles:
// 1. Time-of-day slots: Morning (8:30-10:30), Lunch (13:00-14:30), Evening (18:00-19:30), Night (22:30-23:45) IST.
// 2. Inactivity alerts: If Daksh hasn't chatted for > 2.5 hours during daytime, Waguri sends a spontaneous "Miss You" text!
// 3. Cooldown & deduplication: Never double-sends or spams the user's phone.

export function createPushScheduler({ storage, pushService, callLLM, getPersona }) {
  // Track fired slots per date (e.g. '2026-10-02-morning')
  const firedSlots = new Set();
  let lastPushTimestamp = 0;
  let tickerHandle = null;

  function getISTInfo() {
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const istMinutesTotal = (utcHours * 60 + utcMinutes + 330) % 1440;
    const istHour = Math.floor(istMinutesTotal / 60);
    const istMinute = istMinutesTotal % 60;
    const istDate = new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
    return { istHour, istMinute, istDate, nowMs: now.getTime() };
  }

  function getActiveSlot(istHour, istMinute) {
    const timeVal = istHour + istMinute / 60;
    if (timeVal >= 8.5 && timeVal < 10.5) return 'morning';
    if (timeVal >= 13.0 && timeVal < 14.5) return 'lunch';
    if (timeVal >= 18.0 && timeVal < 19.5) return 'evening';
    if (timeVal >= 22.5 && timeVal < 23.75) return 'night';
    return null;
  }

  // Core evaluation function
  async function evaluateAndSend({ force = false, slotOverride = null } = {}) {
    const subs = await storage.listPushSubscriptions();
    if (!subs.length) {
      return { sent: 0, reason: 'no_subscriptions', message: 'No registered push devices' };
    }

    const { istHour, istMinute, istDate, nowMs } = getISTInfo();
    const minCooldownMs = 2 * 3600 * 1000; // 2 hours minimum throttle between any auto notifications

    // Check both memory and DB for last push time (survives Render reboots / spin-downs)
    const dbLastPushTime = await storage.getLastPushNotificationTime?.();
    const effectiveLastPushTime = Math.max(lastPushTimestamp, dbLastPushTime || 0);

    if (!force && effectiveLastPushTime && (nowMs - effectiveLastPushTime < minCooldownMs)) {
      return {
        sent: 0,
        reason: 'cooldown_active',
        remainingMinutes: Math.round((minCooldownMs - (nowMs - effectiveLastPushTime)) / 60000),
      };
    }

    const persona = getPersona ? await getPersona() : { name: 'Waguri', user_name: 'Daksh' };
    const partner = persona.user_name || 'Daksh';

    // If slotOverride is explicitly 'inactivity', trigger inactivity message directly
    if (slotOverride === 'inactivity') {
      const prompt = [
        `You are ${persona.name}. You noticed your boyfriend ${partner} hasn't chatted with you in hours.`,
        `Send ONE short, caring, slightly pouting or cute girlfriend text to his phone notification in natural Delhi Hinglish.`,
        `Ask where he is busy, tell him you miss talking to him, or ask him to text you back.`,
        `Keep it under 14 words. Single sentence only. No emotion tags.`,
      ].join('\n');

      const result = await pushService.sendAutoGirlfriendMessage({ customPrompt: prompt });
      lastPushTimestamp = nowMs;
      await storage.recordPushNotification?.({ slot: 'manual-inactivity' });
      return { sent: result.sent || 0, trigger: 'inactivity_manual', text: result };
    }

    const activeSlot = slotOverride || getActiveSlot(istHour, istMinute);

    // Case 1: Active Scheduled Time-of-Day Slot (Morning, Lunch, Evening, Night)
    if (activeSlot && ['morning', 'lunch', 'evening', 'night'].includes(activeSlot)) {
      const slotKey = `${istDate}-${activeSlot}`;
      if (!force && firedSlots.has(slotKey)) {
        return { sent: 0, reason: 'slot_already_fired_today', slot: activeSlot };
      }

      firedSlots.add(slotKey);
      lastPushTimestamp = nowMs;

      let prompt = '';
      if (activeSlot === 'morning') {
        prompt = `You are ${persona.name}, texting your boyfriend ${partner} a good morning notification in Delhi Hinglish. Wish him warmly with love, ask about breakfast/plans (1 short sweet sentence, under 14 words). No tags.`;
      } else if (activeSlot === 'lunch') {
        prompt = `You are ${persona.name}, texting your boyfriend ${partner} around lunchtime in Delhi Hinglish. Ask lovingly if he had lunch or tell him to take a break and eat (1 short sentence, under 14 words). No tags.`;
      } else if (activeSlot === 'evening') {
        prompt = `You are ${persona.name}, texting your boyfriend ${partner} in the evening in Delhi Hinglish. Ask how his day was or suggest bakery snacks/chatting (1 short sentence, under 14 words). No tags.`;
      } else if (activeSlot === 'night') {
        prompt = `You are ${persona.name}, texting your boyfriend ${partner} at bedtime in Delhi Hinglish. Sweet goodnight message, remind him to sleep on time and dream of you (1 short sentence, under 14 words). No tags.`;
      }

      const result = await pushService.sendAutoGirlfriendMessage({ customPrompt: prompt });
      await storage.recordPushNotification?.({ slot: slotKey });
      return { sent: result.sent || 0, trigger: `slot_${activeSlot}`, text: result };
    }

    // Case 2: Inactivity Check ("Miss You" / "Kahan ho?")
    // Only check between 10:00 AM and 22:00 PM IST (never disturb sleep)
    if (istHour >= 10 && istHour < 22) {
      const lastUserMsgTime = await storage.getLastUserMessageTime?.();
      const inactivityThresholdMs = 2.5 * 3600 * 1000; // 2.5 hours of user silence

      if (lastUserMsgTime && (nowMs - lastUserMsgTime >= inactivityThresholdMs)) {
        const block = Math.floor(istHour / 3);
        const inactivityKey = `${istDate}-inactivity-${block}`;

        if (!force && firedSlots.has(inactivityKey)) {
          return { sent: 0, reason: 'inactivity_already_fired_for_block' };
        }

        firedSlots.add(inactivityKey);
        lastPushTimestamp = nowMs;

        const hoursAway = Math.max(2, Math.round((nowMs - lastUserMsgTime) / 3600000));

        const prompt = [
          `You are ${persona.name}. You noticed your boyfriend ${partner} hasn't chatted with you in ${hoursAway} hours.`,
          `Send ONE short, caring, slightly pouting or cute girlfriend text to his phone in natural Delhi Hinglish.`,
          `Ask where he is busy, tell him you miss talking to him, or ask him to text you back.`,
          `Keep it under 14 words. Single sentence only. No emotion tags.`,
        ].join('\n');

        const result = await pushService.sendAutoGirlfriendMessage({ customPrompt: prompt });
        await storage.recordPushNotification?.({ slot: inactivityKey });
        return { sent: result.sent || 0, trigger: 'inactivity_miss_you', hoursInactive: hoursAway, text: result };
      }
    }

    return {
      sent: 0,
      reason: 'no_slot_or_inactivity_trigger',
      istHour,
      istMinute,
      activeSlot: getActiveSlot(istHour, istMinute),
    };
  }

  function start(intervalMs = 300_000) { // check every 5 minutes
    if (tickerHandle) clearInterval(tickerHandle);
    tickerHandle = setInterval(() => {
      evaluateAndSend({ force: false }).catch((err) => {
        console.error('[scheduler] auto-push error:', err.message);
      });
    }, intervalMs);
    console.log('[scheduler] auto-push background ticker started (5 min interval)');
  }

  function stop() {
    if (tickerHandle) {
      clearInterval(tickerHandle);
      tickerHandle = null;
    }
  }

  return {
    evaluateAndSend,
    start,
    stop,
    getISTInfo,
    getStatus: () => {
      const { istHour, istMinute } = getISTInfo();
      return {
        firedSlotsCount: firedSlots.size,
        firedSlots: Array.from(firedSlots),
        lastPushTimestamp,
        lastPushAgoMin: lastPushTimestamp ? Math.round((Date.now() - lastPushTimestamp) / 60000) : null,
        ist: getISTInfo(),
        activeSlotNow: getActiveSlot(istHour, istMinute),
      };
    },
  };
}
