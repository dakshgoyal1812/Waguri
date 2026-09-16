// Mood palette seed — the "feeling layer" as DATA (edit rows in Supabase, no
// redeploy). vrm_expression maps to a VRM expressionManager preset; voice_rate /
// voice_pitch are SSML prosody strings applied to TTS; trigger_keywords are the
// reply-text fallback when the LLM emitted no [emotion] tag. Lower priority wins.
export const waguriMoods = [
  { name: 'happy', vrm_expression: 'happy', voice_rate: '+6%', voice_pitch: '+12Hz', trigger_keywords: ['hehe', 'yay', 'glad', 'happy', '😊', '♪', 'ehehe'], priority: 10 },
  { name: 'excited', vrm_expression: 'happy', voice_rate: '+16%', voice_pitch: '+28Hz', trigger_keywords: ['amazing', 'wow', 'incredible', 'can\'t believe', '🎉', 'so good', 'best ever'], priority: 5 },
  { name: 'surprised', vrm_expression: 'surprised', voice_rate: '+12%', voice_pitch: '+22Hz', trigger_keywords: ['what!', 'really?', 'no way', 'ehh?!', 'whoa', '😱'], priority: 8 },
  { name: 'curious', vrm_expression: 'surprised', voice_rate: '+4%', voice_pitch: '+8Hz', trigger_keywords: ['?', 'wonder', 'tell me', 'how come', 'why is', 'hmm'], priority: 20 },
  { name: 'sad', vrm_expression: 'sad', voice_rate: '-12%', voice_pitch: '-10Hz', trigger_keywords: ['sad', 'sorry', 'miss you', '*sigh*', 'aww', 'that\'s too bad'], priority: 12 },
  { name: 'angry', vrm_expression: 'angry', voice_rate: '+8%', voice_pitch: '-6Hz', trigger_keywords: ['hmph', 'meanie', 'not fair', 'grr'], priority: 14 },
  { name: 'relaxed', vrm_expression: 'relaxed', voice_rate: '-6%', voice_pitch: '-4Hz', trigger_keywords: ['mm~', 'cozy', 'comfy', 'sleepy', 'nice and'], priority: 22 },
  { name: 'neutral', vrm_expression: 'neutral', voice_rate: null, voice_pitch: null, trigger_keywords: [], priority: 999 },
];
