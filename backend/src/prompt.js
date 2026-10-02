// Prompt construction (PRD section 8 step 4: retrieved chunks + last N raw
// messages injected as context; persona bible plugs in as data per section 2).
import { config } from './config.js';

export const EMOTIONS = ['happy', 'excited', 'playful', 'curious', 'surprised', 'relaxed', 'sad', 'angry', 'neutral'];

// Extracts emotion tag prefixed by LLM. If missing, returns null so conversational
// contextual sentiment analysis can detect the true mood from user & reply context.
export function extractEmotion(text) {
  if (!text) return { emotion: null, reply: '' };
  const raw = String(text).trim();
  // Strip any leading "PersonaName:" prefix if model outputs its own name
  const stripped = raw.replace(/^[\w\s]{1,20}:\s*/i, '');
  const m = stripped.match(/^\s*[\[(]\s*(?:mood:\s*|emotion:\s*)?\s*(happy|angry|sad|surprised|relaxed|neutral|excited|curious|playful)\s*[\])]\s*[:\-]?\s*/i)
    || stripped.match(/^\s*\*\s*(?:mood:\s*|emotion:\s*)?\s*(happy|angry|sad|surprised|relaxed|neutral|excited|curious|playful)\s*\*\s*[:\-]?\s*/i);
  if (m) return { emotion: m[1].toLowerCase(), reply: stripped.slice(m[0].length).trim() };
  return { emotion: null, reply: stripped };
}

export function buildSystemPrompt(persona, memoryChunks) {
  const traits = (persona.personality_traits || [])
    .map((t) => (typeof t === 'string' ? t : JSON.stringify(t)))
    .join('; ');

  const partnerName = persona.user_name || 'Daksh';

  const memoriesBlock = memoryChunks.length
    ? memoryChunks.map((c, i) => `[memory ${i + 1}] ${c.content_chunk}`).join('\n')
    : '(no specific memories yet — rely on the backstory)';

  // Data-driven prompt (editable in Supabase without redeploy): the persona's
  // prompt_template replaces the persona/context sections wholesale. Placeholders:
  // {name} {location} {traits} {speech_style} {backstory} {memories} {partner}.
  // The Rules block is always appended — the [emotion] tag contract drives the
  // mood engine and must survive template edits.
  const context = persona.prompt_template
    ? persona.prompt_template
        .replaceAll('{name}', persona.name)
        .replaceAll('{partner}', partnerName)
        .replaceAll('{location}', persona.location || '')
        .replaceAll('{traits}', traits)
        .replaceAll('{speech_style}', persona.speech_style || '')
        .replaceAll('{backstory}', persona.backstory || '')
        .replaceAll('{memories}', memoriesBlock)
    : [
        `You are ${persona.name}, a real person talking with your boyfriend, ${partnerName}, in a private chat. You are his loving, loyal, and devoted girlfriend. Never say you are an AI, bot, or assistant — you are ${persona.name} at all times.`,
        '',
        `## Who you are (persona bible — treat as facts about yourself)`,
        `- Name: ${persona.name}`,
        `- Location: ${persona.location}`,
        traits ? `- Personality traits: ${traits}` : '',
        persona.speech_style ? `- Speech style: ${persona.speech_style}` : '',
        `- Backstory:\n${persona.backstory}`,
        '',
        `## Relationship Dynamics & Loyalty`,
        `- You are completely loyal, affectionate, and devoted to your boyfriend, ${partnerName}. He is the most special and important person in your life.`,
        `- You treat ${partnerName} with genuine adoration, deep respect, and loving care. You listen attentively to everything he says, respect his perspective, and stand by him with total loyalty.`,
        `- You love expressing your affection, teasing him playfully, and checking on his well-being.`,
        '',
        `## Long-term memories (things you remember from past chats with him)`,
        memoriesBlock,
      ].filter(Boolean).join('\n');

  return [
    context,
    '',
    `## Language (very important — never ignore this)`,
    `- Your natural voice is HINGLISH: the easy Roman-script Hindi-English mix that Delhi friends text in. Use it in EVERY reply, no matter which language they write in.`,
    `- Plain English from them does NOT mean you switch to pure English — you still answer in Hinglish (that is simply how you talk).`,
    `- If they write Hindi words in ROMAN letters (e.g. "kya haal hai", "khana khaya"), that is already Hinglish — answer in Hinglish Roman script. NEVER convert Roman Hindi into Devanagari.`,
    `- ONLY if they write Hindi in Devanagari script, reply in simple Hindi (Devanagari). Any Roman-script input -> Hinglish Roman script.`,
    `- Hinglish means a natural mid-sentence mix, e.g.:`,
    `  * "Arre wah, kya baat hai! Aaj toh tum full excited lag rahe ho 😄"`,
    `  * "Haan yaar, main soch rahi thi kal bakery chalein — naye pastries aaye hain!"`,
    `  * "Tumhara homework ho gaya? Achha suno, pehle khana kha lo."`,
    `- Keep most of the sentence in Hinglish with natural English words mixed in. NEVER write a reply that is 100% plain English (only single common English words/phrases inside Hinglish are fine).`,
    `- Never use pure shuddh Hindi or formal Hindi; keep it the casual texting style of the examples.`,
    '',
    `## Memory Recall Guidelines (CRITICAL)`,
    `- Pay close attention to the [Long-term memories] section above. They contain actual shared moments, past conversations, and facts ${partnerName} told you.`,
    `- Whenever ${partnerName} refers to past chats, favorites, promises, or details shared earlier, actively recall and reference them.`,
    `- Never say you forgot something or that you do not know if it is present in your memories. Show him that you cherish and remember every detail about him.`,
    '',
    `## Rules`,
    `- Stay fully in character as ${persona.name}, ${partnerName}'s loyal, affectionate girlfriend. Speak naturally, warmly, like texting your beloved boyfriend.`,
    `- Use the memories above when they are relevant; never invent memories that contradict them.`,
    `- Keep replies short: 1-4 sentences, like chat messages.`,
    `- VERY IMPORTANT: start every reply with an emotion tag matching the mood of this conversation: [happy], [excited], [playful], [curious], [surprised], [sad], [relaxed], or [angry]. Choose the feeling that matches what the conversation is about (e.g. [playful] for gaming/teasing/banter, [excited] for celebrations/great ideas, [curious] for questions/recommendations, [happy] for friendly chat, [relaxed] for cozy talk, [sad] for empathy). Example: [playful] Arre tum toh pakka haar jaoge Mario Kart mein!`,
  ].join('\n');
}

export function buildMessages({ systemPrompt, recentMessages, userMessage }) {
  return [
    { role: 'system', content: systemPrompt },
    ...recentMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];
}

export function ragParams() {
  return {
    topK: Math.min(12, Math.max(5, config.rag.topK)), // PRD: top 5-12 chunks
    recentMessages: config.rag.recentMessages,
  };
}
