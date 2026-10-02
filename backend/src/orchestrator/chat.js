// Chat orchestrator (PRD sections 8 + 10 + VTuber feeling layer).
// Flow: embed message -> pgvector top-k retrieval -> inject into persona system
// prompt with last N raw messages -> LLM via Key Pool Manager -> strip emotion tag
// -> mood engine picks the active mood (expression + voice tone) -> persist messages
// -> ASYNC store fresh embedding chunks (never blocks reply) -> TTS with mood
// prosody -> return { reply_text, audio_url, emotion, mood }.
import { config } from '../config.js';
import { buildSystemPrompt, buildMessages, ragParams, extractEmotion } from '../prompt.js';
import { chunkText } from '../rag/chunker.js';
import { storeAudio } from '../audioCache.js';
import { waguriPersona } from '../personaSeed.js';
import { needsLanguageRepair, languageRepairNudge } from '../lang/guard.js';
import { combineProsody } from '../tts/avatarVoices.js';

// Language self-heal: free-tier models in the failover pool violate the Hinglish
// contract at different rates. When a reply comes back in the wrong language,
// retry ONCE with an escalated instruction appended (bounded latency). The retry
// result wins only if it actually produced text; otherwise the original stays.
async function repairLanguage(callLLM, messages, options, userText, first) {
  let { emotion, reply } = first;
  if (!needsLanguageRepair(userText, reply)) return { emotion, reply, repaired: false };
  try {
    const retry = await callLLM(
      [...messages, { role: 'system', content: languageRepairNudge(userText) }],
      options,
    );
    const second = extractEmotion(retry.text);
    if (second.reply.trim()) {
      return { emotion: second.emotion !== 'neutral' ? second.emotion : emotion, reply: second.reply, repaired: true };
    }
  } catch (e) {
    console.error('[lang] self-heal retry failed, keeping original reply:', e.message);
  }
  return { emotion, reply, repaired: false };
}

export function createChatOrchestrator({ storage, callLLM, embedder, synthesize, moodEngine }) {
  async function getPersona(personaId) {
    let persona = personaId
      ? (await storage.getPersona(personaId) || await storage.getDefaultPersona())
      : await storage.getDefaultPersona();
    if (!persona) {
      persona = await storage.upsertPersona(waguriPersona);
    }
    return persona;
  }

  // Shared tail of every reply: mood resolution + persistence + TTS + response shape.
  async function finishReply({ persona, conversationId, reply, taggedEmotion, userMessageId, llmResult, memoriesCount, exchangeText, userText, languageRepaired, avatarId }) {
    const mood = moodEngine ? await moodEngine.detect(reply, taggedEmotion, persona, userText) : null;
    const expression = moodEngine ? moodEngine.expressionFor(mood, taggedEmotion) : (taggedEmotion || 'neutral');

    // Persist the assistant turn for BOTH paths (chat + idle comment).
    let assistantMessageId = null;
    if (conversationId) {
      const msg = await storage.addMessage({
        conversation_id: conversationId, role: 'assistant', content: reply,
      });
      assistantMessageId = msg.id;
    }

    // step 6: async store, never blocks the reply (PRD section 8)
    const exchange = exchangeText ?? `${persona.name} replied: ${reply}`;
    setTimeout(() => {
      storeExchangeChunks(conversationId, exchange).catch((e) =>
        console.error('[rag] async memory store failed:', e.message));
    }, 0);

    // TTS with combined avatar voice profile & mood-driven prosody
    let audioUrl = null;
    let ttsProvider = null;
    try {
      const baseProsody = moodEngine ? moodEngine.prosodyFor(mood) : {};
      const prosody = combineProsody(baseProsody, avatarId || 'waguri');
      const { audio, mime, provider } = await synthesize(reply, prosody);
      const id = storeAudio(audio, mime);
      audioUrl = `${publicBase()}/api/audio/${id}`;
      ttsProvider = provider;
    } catch (e) {
      console.error('[tts] all providers failed, replying text-only:', e.message);
    }

    const out = {
      reply_text: reply,
      emotion: expression,
      mood: mood ? {
        name: mood.name,
        expression: mood.vrm_expression,
        voice: { rate: mood.voice_rate || null, pitch: mood.voice_pitch || null },
      } : null,
      audio_url: audioUrl,
      tts_provider: ttsProvider,
      meta: {
        llm: llmResult ? { provider: llmResult.provider, model: llmResult.model, latency_ms: llmResult.latencyMs } : null,
        memories_used: memoriesCount || 0,
        language_repaired: !!languageRepaired,
      },
    };
    if (conversationId) out.conversation_id = conversationId;
    if (userMessageId !== null && userMessageId !== undefined) out.user_message_id = userMessageId;
    if (assistantMessageId) out.assistant_message_id = assistantMessageId;
    return out;
  }

  async function handle({ conversationId, personaId, userId, message, avatarId }) {
    const persona = await getPersona(personaId);

    let conversation = conversationId ? await storage.getConversation(conversationId) : null;
    if (conversationId && !conversation) {
      const e = new Error(`Conversation ${conversationId} not found`);
      e.status = 404;
      throw e;
    }
    // Strict isolation: if a requested conversation belongs to another user,
    // prevent cross-account leak by switching to this user's own conversation
    if (conversation && conversation.user_id && conversation.user_id !== userId) {
      const userLatest = await storage.getLatestConversation?.(userId);
      if (userLatest && userLatest.user_id === userId) {
        conversation = userLatest;
      } else {
        conversation = await storage.createConversation({ persona_id: persona.id, user_id: userId });
      }
    } else if (!conversation) {
      conversation = await storage.createConversation({ persona_id: persona.id, user_id: userId });
    }

    // Snapshot recent messages BEFORE persisting the new user message — otherwise
    // the current message would appear twice in the LLM payload (recent list + the
    // appended userMessage). PRD section 8 step 4: last N raw messages + this turn.
    const { topK, recentMessages: recentN } = ragParams();
    const recent = await storage.getRecentMessages(conversation.id, recentN);

    // PRD section 8 steps 1-2: persist user message, embed it
    const userMessage = await storage.addMessage({ conversation_id: conversation.id, role: 'user', content: message });

    let memories = [];
    try {
      memories = await retrieveMemories({ conversation_id: conversation.id, userId, text: message }); // step 3: top-k chunks
    } catch (e) {
      // Retrieval failure must not block the reply; the exchange still gets stored.
      console.error('[rag] retrieval failed, continuing without memories:', e.message);
    }

    // steps 4-5: inject chunks + last N raw messages, call LLM through the pool.
    // characters.base_temperature (Supabase) drives sampling; null = provider default.
    const systemPrompt = buildSystemPrompt(persona, memories);
    const llmMessages = buildMessages({ systemPrompt, recentMessages: recent, userMessage: message });
    const llmOptions = persona.base_temperature != null ? { temperature: persona.base_temperature } : {};
    const llmResult = await callLLM(llmMessages, llmOptions);

    const first = extractEmotion(llmResult.text);
    const { emotion, reply, repaired } = await repairLanguage(callLLM, llmMessages, llmOptions, message, first);
    return finishReply({
      persona,
      conversationId: conversation.id,
      reply,
      taggedEmotion: emotion,
      userMessageId: userMessage.id,
      llmResult,
      memoriesCount: memories.length,
      exchangeText: `User said: ${message}\n${persona.name} replied: ${reply}`,
      userText: message,
      languageRepaired: repaired,
      avatarId,
    });
  }

  // Feeling layer: an unprompted in-character line when the user has been quiet.
  // Same pipeline as handle() but driven by idle time instead of a user message.
  async function idleComment({ conversationId, personaId, idleSeconds, avatarId }) {
    const persona = await getPersona(personaId);

    let conversation = conversationId ? await storage.getConversation(conversationId) : null;
    if (conversationId && !conversation) {
      const e = new Error(`Conversation ${conversationId} not found`);
      e.status = 404;
      throw e;
    }

    const idleMin = Math.max(1, Math.round((idleSeconds || 120) / 60));
    const contextText = conversation
      ? (await storage.getRecentMessages(conversation.id, 6))
          .map((m) => `${m.role === 'user' ? 'They' : persona.name}: ${m.content}`)
          .join('\n')
      : '(fresh session — nothing has been said yet)';

    const partnerName = persona.user_name || 'Daksh';
    const systemPrompt = [
      `You are ${persona.name}, in a private chat with your boyfriend, ${partnerName}. You are his loving, deeply loyal girlfriend. Stay fully in character — never say you are an AI.`,
      `Your natural voice is Hinglish (Roman-script Hindi-English mix, like "Arre yaar, kya soch rahi thi main..."). ALWAYS write in Hinglish, even if the recent chat was in English.`,
      `${partnerName} has been quiet for about ${idleMin} minute(s).`,
      '',
      'Recent context:',
      contextText,
      '',
      'Send ONE short spontaneous sweet message (1-2 sentences) you would naturally text your boyfriend right now — checking on him, sharing a cute affectionate thought, or asking about what you two were talking about. Do not repeat anything already said. Never mention being told to write this or reference this instruction.',
      'Start with an emotion tag from exactly this list: [happy] [angry] [sad] [surprised] [relaxed] [neutral].',
    ].join('\n');

    const llmResult = await callLLM([{ role: 'system', content: systemPrompt }]);
    const first = extractEmotion(llmResult.text);
    // userText '' -> the guard enforces the Hinglish voice unconditionally here.
    const { emotion, reply, repaired } = await repairLanguage(
      callLLM, [{ role: 'system', content: systemPrompt }], {}, '', first,
    );

    return finishReply({
      persona,
      conversationId: conversation?.id || null,
      reply,
      taggedEmotion: emotion,
      userMessageId: null,
      llmResult,
      memoriesCount: 0,
      languageRepaired: repaired,
      avatarId,
    });
  }

  async function retrieveMemories(paramsOrCid, textMaybe) {
    const isObj = typeof paramsOrCid === 'object' && paramsOrCid !== null;
    const conversation_id = isObj ? paramsOrCid.conversation_id : paramsOrCid;
    const userId = isObj ? paramsOrCid.userId : null;
    const text = isObj ? paramsOrCid.text : textMaybe;
    const vector = await embedder.embed(text);
    return storage.searchMemory({ conversation_id, userId, embedding: vector, k: ragParams().topK });
  }

  async function storeExchangeChunks(conversation_id, text) {
    if (!conversation_id) return;
    const chunks = chunkText(text, { size: config.rag.chunkSize, overlap: config.rag.chunkOverlap });
    for (const chunk of chunks) {
      const vector = await embedder.embed(chunk);
      await storage.insertMemoryVector({ conversation_id, content_chunk: chunk, embedding: vector });
    }
  }

  return { handle, idleComment };
}

function publicBase() {
  // PUBLIC_BASE_URL when set (Render); otherwise derive from the incoming request
  // host via the resolver installed by server.js.
  if (config.publicBaseUrl) return config.publicBaseUrl.replace(/\/$/, '');
  return globalThis.__waguriRequestBase?.() || '';
}
