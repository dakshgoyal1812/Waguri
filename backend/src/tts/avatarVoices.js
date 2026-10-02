// Character Voice Profiles for Waguri 3D Anime Models.
// Each avatar has a distinct acoustic personality (pitch, speed, tone)
// that cleanly layers with dynamic emotion prosody in Edge TTS / Azure.

export const AVATAR_VOICES = {
  waguri: {
    name: 'Waguri',
    pitchDeltaHz: 2,
    rateDeltaPct: 1,
    tone: 'Sweet, warm & caring girlfriend',
  },
  zero: {
    name: 'Zero',
    pitchDeltaHz: -5,
    rateDeltaPct: 0,
    tone: 'Cool, calm & confident heroine',
  },
  vrm3: {
    name: 'Aoi',
    pitchDeltaHz: 6,
    rateDeltaPct: 6,
    tone: 'Bright, energetic high school girl',
  },
  vrm4: {
    name: 'Elysia',
    pitchDeltaHz: 3,
    rateDeltaPct: -5,
    tone: 'Ethereal, gentle & soothing forest elf',
  },
  vrm6: {
    name: 'Yuna',
    pitchDeltaHz: 9,
    rateDeltaPct: 8,
    tone: 'Vibrant, hyper-cute & bubbly anime idol',
  },
  vrm7: {
    name: 'Kuroha',
    pitchDeltaHz: -7,
    rateDeltaPct: -4,
    tone: 'Deep, cool & mysterious gothic beauty',
  },
  vrm8: {
    name: 'Hikari',
    pitchDeltaHz: 4,
    rateDeltaPct: -8,
    tone: 'Soft, whispering & dreamy warmth',
  },
  vrm9: {
    name: 'Chiyo',
    pitchDeltaHz: 7,
    rateDeltaPct: 4,
    tone: 'Cute, playful & sweet student',
  },
};

/**
 * Combines baseline mood prosody ({ rate, pitch }) with the avatar's specific voice traits.
 * Example: Mood pitch '+6Hz' + Yuna '+9Hz' => '+15Hz'
 *          Mood rate '+3%' + Elysia '-5%' => '-2%'
 */
export function combineProsody(moodProsody = {}, avatarId = 'waguri') {
  const profile = AVATAR_VOICES[avatarId] || AVATAR_VOICES.waguri;
  let pitchHz = profile.pitchDeltaHz;
  let ratePct = profile.rateDeltaPct;

  if (moodProsody.pitch) {
    const match = String(moodProsody.pitch).match(/([+-]?\d+)\s*Hz/i);
    if (match) pitchHz += parseInt(match[1], 10);
  }

  if (moodProsody.rate) {
    const match = String(moodProsody.rate).match(/([+-]?\d+)\s*%/);
    if (match) ratePct += parseInt(match[1], 10);
  }

  const signPitch = pitchHz >= 0 ? `+${pitchHz}Hz` : `${pitchHz}Hz`;
  const signRate = ratePct >= 0 ? `+${ratePct}%` : `${ratePct}%`;

  return {
    pitch: signPitch,
    rate: signRate,
  };
}
