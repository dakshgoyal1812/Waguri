// Clean text before sending to TTS engines (Edge TTS, Fish Audio, Google).
// Emojis, roleplay asterisks (*smiles*, *giggles*), and markdown characters
// must NEVER be read aloud by the speech synthesizer.

export function cleanTextForTTS(text) {
  if (!text || typeof text !== 'string') return '';

  const cleaned = text
    // 0. Remove any leftover emotion/mood brackets: [happy], [ sad], [mood: excited], etc.
    .replace(/\[\s*(?:mood:\s*|emotion:\s*)?(?:happy|angry|sad|surprised|relaxed|neutral|excited|curious|playful)\s*\]/gi, ' ')
    // 1. Remove roleplay asterisks: *giggles*, *blushes*, *smiles*, *whispers*, etc.
    .replace(/\*[^*]+\*/g, ' ')
    // 2. Remove parenthesized actions: (giggles), (laughs), (acting cute)
    .replace(/\([^)]{1,30}\)/g, ' ')
    // 3. Remove all Unicode Emojis, Dingbats, Pictographs, Emoticons, Variation Selectors
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier_Base}|\p{Emoji_Component}|[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{1F900}-\u{1F9FF}]/gu, '')
    // 4. Remove Markdown formatting characters
    .replace(/[#*`~_]/g, '')
    // 5. Remove any leftover web links
    .replace(/https?:\/\/\S+/g, '')
    // 6. Normalize multiple punctuation or spaces
    .replace(/[,.]{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  // If text was only emojis/actions, return a natural conversational vocalization
  return cleaned || 'Aww!';
}
