// Language self-heal guard (Hinglish contract).
//
// The persona's contract is: ALWAYS answer in natural Hinglish (Roman-script
// Hindi-English mix); only Devanagari input may get a Devanagari reply. Free-tier
// models in the failover pool ignore instructions at different rates, so the
// orchestrator runs this guard over every brain reply and retries ONCE with an
// escalated instruction when the contract is violated (bounded latency: max 2
// LLM calls per turn).
const DEVANAGARI_RE = /[\u0900-\u097F]/;

// Distinctive Roman-Hindi words unlikely to appear inside a plain-English
// sentence. Conservative on purpose: a miss (English slips through) costs one
// retry; a false positive (Hinglish counted as English) would loop needlessly.
const HINGLISH_MARKERS = new Set([
  // interjections / fillers
  'yaar', 'yaarr', 'arre', 'arey', 'achha', 'acha', 'accha', 'ekdum', 'wah', 'waah',
  'arreyya', 'haww', 'matlab', 'waghera', 'waisa', 'waise', 'bhai',
  // yes/no/negation + common verbs (incl. common conjugations)
  'haan', 'han', 'haanji', 'nahi', 'nahin', 'hoon', 'hun', 'hain',
  'tha', 'thi', 'hoga', 'hogi', 'honge', 'raha', 'rahi', 'rahe', 'rhi',
  'kar', 'karo', 'karna', 'karni', 'karta', 'karti', 'karte', 'karunga', 'karungi', 'karke',
  'khati', 'khata', 'khate', 'khana', 'khaya', 'jaungi', 'jaunga', 'jaana', 'jana',
  'aaungi', 'dekh', 'dekho', 'dekha', 'suno', 'suna', 'chalo', 'chal',
  'chalein', 'chahiye', 'sakte', 'sakta', 'sakti', 'padhti', 'padhta', 'padhai', 'padh',
  // pronouns / determiners
  'tum', 'tumhe', 'tumhara', 'tumhari', 'tera', 'teri', 'mera', 'meri', 'mere', 'apna', 'apni',
  'aap', 'aapko', 'humne', 'maine', 'mujhe', 'tujhe', 'isko', 'usko', 'kisko',
  // question words
  'kya', 'kyun', 'kyu', 'kab', 'kahan', 'kahaan', 'kaun', 'kaise', 'kaisa', 'kaisi', 'kitna', 'kitni',
  // time / place / quantity (avoid English collisions: 'the', 'sun', 'hi', 'to', 'ya', 'tab')
  'aaj', 'kal', 'abhi', 'phir', 'jab', 'bahut', 'bohot', 'thoda', 'thodi', 'zyada',
  'jaldi', 'bilkul', 'sab', 'sabhi', 'kuch', 'koi', 'bhi', 'aur', 'hum',
  'wala', 'wali', 'walon', 'apne', 'yahan', 'wahan', 'idhar', 'udhar',
  // everyday nouns she actually uses
  'chai', 'paani', 'pani', 'roti', 'samosa', 'tikki', 'halwa', 'mithai', 'dost', 'dosti',
  'khush', 'pareshan', 'maza', 'mazaa', 'dil', 'yaad', 'pyaar', 'pyar', 'bakwaas',
  'jhoot', 'sach', 'kaam', 'ghar', 'bazaar', 'mausam', 'barish', 'dhoop', 'raat', 'subah',
  'shaam', 'bhookh', 'neend', 'sapna',
]);

export function hasDevanagari(text) {
  return DEVANAGARI_RE.test(String(text || ''));
}

// True when the text already satisfies the Hinglish voice (Devanagari counts —
// it is the allowed reply for Devanagari input).
export function looksHinglish(text) {
  const t = String(text || '');
  if (hasDevanagari(t)) return true;
  const words = t.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.some((w) => HINGLISH_MARKERS.has(w));
}

// Decide whether `reply` violates the language contract given the user's input.
//   - user wrote Devanagari  -> reply must contain Devanagari (simple Hindi)
//   - any other input        -> reply must be Hinglish (some Roman Hindi marker)
// Empty replies are NOT a language problem (empty-reply failover handles those).
export function needsLanguageRepair(userText, reply) {
  const r = String(reply || '').trim();
  if (!r) return false;
  if (hasDevanagari(userText)) return !hasDevanagari(r);
  return !looksHinglish(r);
}

// Escalated instruction appended as an extra system message on the ONE repair
// retry. Explicit about what went wrong so even weak models comply.
export function languageRepairNudge(userText) {
  if (hasDevanagari(userText)) {
    return [
      'CRITICAL LANGUAGE FIX: your previous reply was NOT in Hindi.',
      `Rewrite that same reply now in SIMPLE HINDI written in Devanagari script (the human writes in Hindi). Keep the same meaning and personality. Same emotion tag at the start. No English sentences.`,
    ].join(' ');
  }
  return [
    'CRITICAL LANGUAGE FIX: your previous reply was in plain English, which is FORBIDDEN.',
    'Rewrite that same reply now in natural Hinglish — the casual Roman-script Hindi-English mix Delhi friends text in (e.g. "Arre yaar, bilkul! Main bhi wahi soch rahi thi 😄").',
    'Keep the same meaning and personality. Keep the emotion tag at the start. NEVER write a reply that is 100% plain English.',
  ].join(' ');
}
