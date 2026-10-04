// API client connecting frontend to backend endpoints (PRD section 10).
// In dev: proxies /api via Vite proxy to backend port.
// In prod (Vercel): uses NEXT_PUBLIC_API_URL or VITE_API_URL or relative /api.
//
// SECURITY: every request attaches the Supabase access token via
// getAuthHeaders(). The backend verifies that token and derives the identity
// from it — client-sent user_id strings are ignored by the server.
import { getAuthHeaders } from './supabaseClient.js';
import { BASE_URL, PROD_DEFAULT_BACKEND } from './lib/apiBase.js';

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

export async function sendMessage({ conversationId, personaId, userId, message, avatarId }) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      conversation_id: conversationId,
      persona_id: personaId,
      user_id: userId || 'local-user', // informational only; server uses the JWT identity
      message,
      avatar_id: avatarId,
    }),
  });
  return handleResponse(res);
}

// Feeling layer: ask the backend for a spontaneous in-character line after the
// user has been quiet for a while.
export async function fetchIdleComment({ conversationId, personaId, idleSeconds, avatarId }) {
  const res = await fetch(`${BASE_URL}/api/idle-comment`, {
    method: 'POST',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      conversation_id: conversationId,
      persona_id: personaId,
      idle_seconds: idleSeconds,
      avatar_id: avatarId,
    }),
  });
  return handleResponse(res);
}

export async function getConversationHistory(conversationId, { page = 1, limit = 50, userId } = {}) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (userId) query.set('user_id', userId);
  const res = await fetch(`${BASE_URL}/api/conversations/${conversationId}/history?${query.toString()}`, {
    headers: await getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function getLatestConversation(userId = 'local-user') {
  const res = await fetch(`${BASE_URL}/api/conversations/latest?user_id=${encodeURIComponent(userId)}`, {
    headers: await getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function getPersona(personaId) {
  const url = personaId
    ? `${BASE_URL}/api/persona?id=${encodeURIComponent(personaId)}`
    : `${BASE_URL}/api/persona`;
  const res = await fetch(url, { headers: await getAuthHeaders() });
  return handleResponse(res);
}

// Mint a FRESH audio URL for a message's text. The backend audio cache is
// in-memory, so audio_url values from earlier messages die on restart — this
// re-synthesizes on demand and keeps the avatar's lip-sync always working.
export async function synthesizeToUrl(text, mood, avatarId) {
  const res = await fetch(`${BASE_URL}/api/tts/url`, {
    method: 'POST',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ text, mood, avatar_id: avatarId }),
  });
  return handleResponse(res);
}

// --- Alarms & Reminders API (Option 5: Background Web Push) ---
export async function fetchAlarms(userId = 'local-user') {
  const res = await fetch(`${BASE_URL}/api/alarms?user_id=${encodeURIComponent(userId)}`, {
    headers: await getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function saveAlarm(alarm) {
  const res = await fetch(`${BASE_URL}/api/alarms`, {
    method: 'POST',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(alarm),
  });
  return handleResponse(res);
}

export async function deleteAlarm(id) {
  const res = await fetch(`${BASE_URL}/api/alarms/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function toggleAlarm(id, enabled) {
  const res = await fetch(`${BASE_URL}/api/alarms/${encodeURIComponent(id)}/toggle`, {
    method: 'POST',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ enabled }),
  });
  return handleResponse(res);
}

export async function testAlarmPush({ title, message, type = 'alarm', userId = 'local-user' } = {}) {
  const res = await fetch(`${BASE_URL}/api/alarms/test`, {
    method: 'POST',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title, message, type, user_id: userId }),
  });
  return handleResponse(res);
}

// Game layer: she plays WITH you through her normal voice/mood pipeline.
export async function startGame(game, conversationId) {
  const res = await fetch(`${BASE_URL}/api/game/start`, {
    method: 'POST',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ game, conversation_id: conversationId }),
  });
  return handleResponse(res);
}

export async function gameMove({ sessionId, move, choice, answer }) {
  const res = await fetch(`${BASE_URL}/api/game/move`, {
    method: 'POST',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ session_id: sessionId, move, choice, answer }),
  });
  return handleResponse(res);
}

// STT fallback for browsers without the Web Speech API (recorded blob upload).
export async function speechToText(blob, lang) {
  const headers = await getAuthHeaders({
    'Content-Type': blob.type || 'audio/webm',
    'x-file-name': 'speech.webm',
    'x-audio-type': blob.type || 'audio/webm',
  });
  if (lang) headers['x-audio-lang'] = lang.startsWith('hi') ? 'hi' : 'en';

  const primaryUrl = `${BASE_URL}/api/stt`;
  try {
    const res = await fetch(primaryUrl, {
      method: 'POST',
      headers,
      body: blob,
    });
    if (!res.ok && BASE_URL === '' && PROD_DEFAULT_BACKEND) {
      const fallbackRes = await fetch(`${PROD_DEFAULT_BACKEND}/api/stt`, {
        method: 'POST',
        headers,
        body: blob,
      });
      return handleResponse(fallbackRes);
    }
    return handleResponse(res);
  } catch (err) {
    if (BASE_URL === '' && PROD_DEFAULT_BACKEND) {
      try {
        const fallbackRes = await fetch(`${PROD_DEFAULT_BACKEND}/api/stt`, {
          method: 'POST',
          headers,
          body: blob,
        });
        return handleResponse(fallbackRes);
      } catch {
        // preserve original error
      }
    }
    throw err;
  }
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

// Verify if an individual email address has access (safe, does not reveal other users)
export async function checkEmailAccess(email) {
  const clean = (email || '').trim().toLowerCase();
  const res = await fetch(`${BASE_URL}/api/auth/verify-access?email=${encodeURIComponent(clean)}`);
  return handleResponse(res);
}

// Admin access whitelist management (backend requires a verified admin session)
export async function fetchAllowedUsers() {
  const res = await fetch(`${BASE_URL}/api/admin/allowed-users`, {
    headers: await getAuthHeaders(),
  });
  return handleResponse(res);
}

export async function addAllowedUser(email) {
  const res = await fetch(`${BASE_URL}/api/admin/allowed-users`, {
    method: 'POST',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email }),
  });
  return handleResponse(res);
}

export async function removeAllowedUser(email) {
  const res = await fetch(`${BASE_URL}/api/admin/allowed-users`, {
    method: 'DELETE',
    headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email }),
  });
  return handleResponse(res);
}
