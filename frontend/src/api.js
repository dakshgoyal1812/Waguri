// API client connecting frontend to backend endpoints (PRD section 10).
// In dev: proxies /api via Vite proxy to backend port.
// In prod (Vercel): uses NEXT_PUBLIC_API_URL or VITE_API_URL or relative /api.

// PRD section 11 names NEXT_PUBLIC_API_URL; Vite builds use VITE_API_URL. Both work
// (vite.config.js envPrefix exposes NEXT_PUBLIC_* at build time). Empty = same-origin
// /api (useful behind a proxy).
const BASE_URL = (import.meta.env.VITE_API_URL || import.meta.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

async function handleResponse(res) {
  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data.error) errorMsg = data.error;
    } catch {
      // ignore
    }
    const err = new Error(errorMsg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function sendMessage({ conversationId, personaId, userId, message }) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: conversationId,
      persona_id: personaId,
      user_id: userId || 'local-user',
      message,
    }),
  });
  return handleResponse(res);
}

// Feeling layer: ask the backend for a spontaneous in-character line after the
// user has been quiet for a while.
export async function fetchIdleComment({ conversationId, personaId, idleSeconds }) {
  const res = await fetch(`${BASE_URL}/api/idle-comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: conversationId,
      persona_id: personaId,
      idle_seconds: idleSeconds,
    }),
  });
  return handleResponse(res);
}

export async function getConversationHistory(conversationId, { page = 1, limit = 50 } = {}) {
  const res = await fetch(`${BASE_URL}/api/conversations/${conversationId}/history?page=${page}&limit=${limit}`);
  return handleResponse(res);
}

export async function getPersona(personaId) {
  const url = personaId
    ? `${BASE_URL}/api/persona?id=${encodeURIComponent(personaId)}`
    : `${BASE_URL}/api/persona`;
  const res = await fetch(url);
  return handleResponse(res);
}

// Mint a FRESH audio URL for a message's text. The backend audio cache is
// in-memory, so audio_url values from earlier messages die on restart — this
// re-synthesizes on demand and keeps the avatar's lip-sync always working.
export async function synthesizeToUrl(text, mood) {
  const res = await fetch(`${BASE_URL}/api/tts/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mood }),
  });
  return handleResponse(res);
}

// Game layer: she plays WITH you through her normal voice/mood pipeline.
export async function startGame(game, conversationId) {
  const res = await fetch(`${BASE_URL}/api/game/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game, conversation_id: conversationId }),
  });
  return handleResponse(res);
}

export async function gameMove({ sessionId, move, choice, answer }) {
  const res = await fetch(`${BASE_URL}/api/game/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, move, choice, answer }),
  });
  return handleResponse(res);
}

// STT fallback for browsers without the Web Speech API (recorded blob upload).
export async function speechToText(blob) {
  const res = await fetch(`${BASE_URL}/api/stt`, {
    method: 'POST',
    headers: {
      'Content-Type': blob.type || 'audio/webm',
      'x-file-name': 'speech.webm',
      'x-audio-type': blob.type || 'audio/webm',
    },
    body: blob,
  });
  return handleResponse(res);
}

export async function checkBackendHealth() {
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    if (!res.ok) return { ok: false };
    return res.json();
  } catch {
    return { ok: false };
  }
}
