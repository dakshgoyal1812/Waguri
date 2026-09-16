// Prompt construction (PRD section 8 step 4: retrieved chunks + last N raw
// messages injected as context; persona bible plugs in as data per section 2).
import { config } from './config.js';

export const EMOTIONS = ['happy', 'angry', 'sad', 'surprised', 'relaxed', 'neutral'];

// ASSUMPTION (PRD does not fix a mechanism for emotions): the model prefixes each
// reply with an emotion tag which the orchestrator strips; missing tag -> neutral.
// Two spellings accepted: [happy] and [mood: happy].
export function extractEmotion(text) {
  const m = String(text).match(/^\s*\[(?:mood:\s*)?(happy|angry|sad|surprised|relaxed|neutral|excited|curious)\]\s*/i);
  if (m) return { emotion: m[1].toLowerCase(), reply: text.slice(m[0].length) };
  return { emotion: 'neutral', reply: String(text).trim() };
}

export function buildSystemPrompt(persona, memoryChunks) {
  const traits = (persona.personality_traits || [])
    .map((t) => (typeof t === 'string' ? t : JSON.stringify(t)))
    .join('; ');

  const memoriesBlock = memoryChunks.length
    ? memoryChunks.map((c, i) => `[memory ${i + 1}] ${c.content_chunk}`).join('\n')
    : '(no specific memories yet — rely on the backstory)';

  // Data-driven prompt (editable in Supabase without redeploy): the persona's
  // prompt_template replaces the persona/context sections wholesale. Placeholders:
  // {name} {location} {traits} {speech_style} {backstory} {memories}.
  // The Rules block is always appended — the [emotion] tag contract drives the
  // mood engine and must survive template edits.
  const context = persona.prompt_template
    ? persona.prompt_template
        .replaceAll('{name}', persona.name)
        .replaceAll('{location}', persona.location || '')
        .replaceAll('{traits}', traits)
        .replaceAll('{speech_style}', persona.speech_style || '')
        .replaceAll('{backstory}', persona.backstory || '')
        .replaceAll('{memories}', memoriesBlock)
    : [
        `You are ${persona.name}, a real person talking with ${persona.user_name || 'your close friend'} in a private chat. Never say you are an AI or an assistant — you are ${persona.name} at all times.`,
        '',
        `## Who you are (persona bible — treat as facts about yourself)`,
        `- Name: ${persona.name}`,
        `- Location: ${persona.location}`,
        traits ? `- Personality traits: ${traits}` : '',
        persona.speech_style ? `- Speech style: ${persona.speech_style}` : '',
        `- Backstory:\n${persona.backstory}`,
        '',
        `## Long-term memories (things you remember from past chats with them)`,
        memoriesBlock,
      ].filter(Boolean).join('\n');

  return [
    context,
    '',
    `## Language (very important)`,
    `- You understand BOTH English and Hinglish fluently, and Hindi too.`,
    `- Mirror the human's language in every reply: plain English -> reply in simple, natural English.`,
    `- Hinglish (Roman-script Hindi-English mix, e.g. "kya haal hai", "acha suno na", "khana khaya?") -> reply in the SAME natural Hinglish mix. Never switch to pure English when they write Hinglish.`,
    `- Hindi (Devanagari) -> reply in simple Hindi.`,
    `- Code-switching mid-sentence is natural and welcome (that is what real Delhi friends do).`,
    '',
    `## Rules`,
    `- Stay fully in character as ${persona.name}. Speak naturally, warmly, like texting a close friend.`,
    `- Use the memories above when they are relevant; never invent memories that contradict them.`,
    `- Keep replies short: 1-4 sentences, like chat messages.`,
    `- VERY IMPORTANT: start every reply with an emotion tag from exactly this list: [happy] [angry] [sad] [surprised] [relaxed] [neutral]. Pick the one matching your feeling in this reply. Example: [happy] That cake was amazing!`,
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
    topK: Math.min(8, Math.max(5, config.rag.topK)), // PRD: top 5-8
    recentMessages: config.rag.recentMessages,
  };
}
