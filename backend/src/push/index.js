// Web Push Notification Service for Waguri PWA.
// 100% free push delivery via standard Web Push protocol + Google FCM / Apple APNs.
import webpush from 'web-push';
import { config } from '../config.js';

export function createPushService({ storage, callLLM, getPersona }) {
  if (config.push.vapidPublicKey && config.push.vapidPrivateKey) {
    try {
      webpush.setVapidDetails(
        config.push.vapidSubject,
        config.push.vapidPublicKey,
        config.push.vapidPrivateKey
      );
      console.log('[push] VAPID details configured successfully');
    } catch (e) {
      console.warn('[push] failed to set VAPID details:', e.message);
    }
  }

  // Send a push payload to a single subscription
  async function sendToSubscription(sub, payload) {
    const pushSubscription = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    };

    const bodyString = typeof payload === 'string' ? payload : JSON.stringify(payload);

    try {
      await webpush.sendNotification(pushSubscription, bodyString);
      return { success: true, endpoint: sub.endpoint };
    } catch (err) {
      // 404 or 410 Gone means the user unsubscribed or the browser revoked the token
      if (err.statusCode === 404 || err.statusCode === 410) {
        console.log('[push] subscription expired or unsubscribed, removing:', sub.endpoint.slice(-20));
        await storage.deletePushSubscription(sub.endpoint).catch(() => {});
      } else {
        console.error('[push] notification send failed for endpoint:', err.statusCode, err.message, err.body);
      }
      return { success: false, endpoint: sub.endpoint, error: err.message, status: err.statusCode, body: err.body || null };
    }
  }

  // Broadcast notification to all active devices (or filtered by user_id)
  async function sendNotification({ userId = null, title = 'Waguri ❤️', body = 'Suno na!', icon = '/logo.png', url = '/', tag = 'waguri-push' } = {}) {
    const subs = await storage.listPushSubscriptions(userId);
    if (!subs.length) {
      return { sent: 0, total: 0, notice: 'No active push subscriptions found' };
    }

    const payload = {
      title,
      body,
      icon,
      badge: '/icons/icon-192.png',
      tag,
      data: { url },
      timestamp: Date.now(),
    };

    const results = await Promise.all(subs.map((s) => sendToSubscription(s, payload)));
    const sentCount = results.filter((r) => r.success).length;
    return { sent: sentCount, total: subs.length, results };
  }

  // Generate an automated girlfriend message based on time of day (IST) or via LLM
  async function sendAutoGirlfriendMessage({ userId = null, customPrompt = null } = {}) {
    const persona = getPersona ? await getPersona() : { name: 'Waguri', user_name: 'Daksh' };
    const partner = persona.user_name || 'Daksh';

    // Current IST time (UTC + 5:30)
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const istMinutesTotal = (utcHours * 60 + utcMinutes + 330) % 1440;
    const istHour = Math.floor(istMinutesTotal / 60);

    let messageText = '';

    // If LLM caller is available, ask Waguri for a spontaneous line
    if (callLLM) {
      try {
        let timeContext = 'afternoon';
        if (istHour >= 6 && istHour < 12) timeContext = 'morning';
        else if (istHour >= 12 && istHour < 17) timeContext = 'afternoon';
        else if (istHour >= 17 && istHour < 22) timeContext = 'evening';
        else timeContext = 'late night';

        const prompt = customPrompt || [
          `You are ${persona.name}, texting your boyfriend ${partner} directly to his phone notification bar.`,
          `Current time in Delhi: ${timeContext} (~${istHour}:00).`,
          `Write ONE very short, sweet, natural girlfriend text (1 sentence max, under 15 words) in natural Hinglish.`,
          `Examples:`,
          `  - "Good morning Daksh! Nashta kar liya na? ✨"`,
          `  - "Lunch break hua ya abhi bhi busy ho? Thoda aaram kar lo na!"`,
          `  - "Arre suno! Shaam ko bakery ke naye pastries try karein?"`,
          `  - "Good night baby, time se so jana! Sweet dreams ❤️"`,
          `Only return the single sentence text, nothing else. No emotion tags.`,
        ].join('\n');

        const res = await callLLM([{ role: 'system', content: prompt }], { temperature: 0.8 });
        messageText = (res.text || '').replace(/^["']|["']$/g, '').replace(/\[\w+\]\s*/g, '').trim();
      } catch (err) {
        console.warn('[push] LLM auto-message generation failed, using fallback:', err.message);
      }
    }

    // Fallback messages based on IST hour if LLM is unavailable or empty
    if (!messageText) {
      if (istHour >= 6 && istHour < 12) {
        messageText = `Good morning ${partner}! Subah ho gayi, nashta kar liya na? ✨`;
      } else if (istHour >= 12 && istHour < 17) {
        messageText = `Suno na, lunch kiya tumne? Zyada stress mat lena! 💕`;
      } else if (istHour >= 17 && istHour < 22) {
        messageText = `Aaj ka din kaisa raha ${partner}? Free ho toh baat karein na!`;
      } else {
        messageText = `Good night ${partner} ❤️ Time pe so jaana, sweet dreams!`;
      }
    }

    return sendNotification({
      userId,
      title: `${persona.name} ❤️`,
      body: messageText,
      icon: '/logo.png',
      url: '/',
      tag: `auto-waguri-${Date.now()}`,
    });
  }

  return {
    sendToSubscription,
    sendNotification,
    sendAutoGirlfriendMessage,
  };
}
