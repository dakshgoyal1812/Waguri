import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, VolumeX, Gamepad2, Mic, MicOff, MessageCircle, ImageIcon, ShieldCheck, Sun, Moon } from 'lucide-react';
import AvatarCanvas from './components/AvatarCanvas.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import GamePanel from './components/GamePanel.jsx';
import BackgroundPicker from './components/BackgroundPicker.jsx';
import WaveBackground from './components/WaveBackground.jsx';
import MidnightSkyBackground from './components/MidnightSkyBackground.jsx';
import PaperBackground from './components/PaperBackground.jsx';
import SunsetBackground from './components/SunsetBackground.jsx';
import GoogleAuth from './components/GoogleAuth.jsx';
import AdminPortal from './components/AdminPortal.jsx';
import { isAdminEmail } from './supabaseClient.js';
import { sendMessage, checkBackendHealth, getPersona, fetchIdleComment, getConversationHistory, getLatestConversation, synthesizeToUrl } from './api.js';
import { useVoiceInput } from './useVoiceInput.js';

// Natural emotion cycle pool for automatic, subtle idle expression transitions
const IDLE_EMOTION_POOL = ['relaxed', 'happy', 'neutral', 'curious', 'relaxed', 'happy'];

// Feeling layer: first spontaneous line after 2 min of silence; each fired comment
// re-arms the timer, so the cadence stays ~2 min for as long as the user is away.
const IDLE_FIRST_MS = 120_000;

// Simple UI greeting only — Waguri's actual personality (persona bible, traits,
// backstory) lives in Supabase and is fetched from the backend, never hardcoded.
const WELCOME_MESSAGE = {
  role: 'assistant',
  content: 'Hi there! I am Waguri ✨ say something to me!',
  emotion: 'happy',
};

export default function App() {
  // Chat history lives in Supabase (via the backend), not in localStorage.
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);

  const [conversationId, setConversationId] = useState(
    () => localStorage.getItem('waguri_conversation_id') || null
  );

  // The persona (name/traits/backstory — the "soul") is server-side data.
  // Empty until the backend answers; the UI renders fine in the meantime.
  const [persona, setPersona] = useState(null);

  const [currentEmotion, setCurrentEmotion] = useState('happy');
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeAudioUrl, setActiveAudioUrl] = useState(null);
  const [autoPlayAudio, setAutoPlayAudio] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Automatic Emotion Engine:
  // - Speech and dialogue emotions are driven automatically by LLM replies / speech playback.
  // - While speaking or loading, the emotion locks to the reply's mood.
  // - During idle periods, Waguri organically and subtly cycles between cute, natural
  //   expressions (relaxed, happy, neutral, curious) every 14 seconds without any manual clicks.
  useEffect(() => {
    if (isSpeaking || isLoading) return;

    const IDLE_CYCLE_MS = 14000;
    const timer = setInterval(() => {
      setCurrentEmotion((prev) => {
        const pool = IDLE_EMOTION_POOL.filter((e) => e !== prev);
        return pool[Math.floor(Math.random() * pool.length)] || 'relaxed';
      });
    }, IDLE_CYCLE_MS);

    return () => clearInterval(timer);
  }, [isSpeaking, isLoading]);

  // Modals
  const [isGameOpen, setIsGameOpen] = useState(false);
  const [isBgPickerOpen, setIsBgPickerOpen] = useState(false);
  const [isAdminPortalOpen, setIsAdminPortalOpen] = useState(false);

  // PWA install prompt handler
  const [installPrompt, setInstallPrompt] = useState(null);
  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleInstallApp = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  };

  // Theme state: supports light and dark modes
  const [theme, setTheme] = useState(() => localStorage.getItem('waguri_theme') || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('waguri_theme', theme);
  }, [theme]);

  const [background, setBackground] = useState(() => {
    try { return JSON.parse(localStorage.getItem('waguri_background')) || { id: 'wave', custom: '' }; }
    catch { return { id: 'wave', custom: '' }; }
  });
  useEffect(() => {
    try { localStorage.setItem('waguri_background', JSON.stringify(background)); } catch { /* custom image too big for localStorage */ }
  }, [background]);

  // The chat card starts open (airi shows it by default) and can be hidden to
  // enjoy just her on the stage.
  const [chatOpen, setChatOpen] = useState(true);

  // Hands-free voice chat (Web Speech API).
  // Bilingual: en-IN recognizes Hinglish (Roman script) + Indian English; hi-IN
  // for spoken Hindi. The LLM mirrors whichever language the transcript uses.
  const [handsFree, setHandsFree] = useState(false);
  const [voiceLang, setVoiceLang] = useState(() => localStorage.getItem('waguri_voice_lang') || 'en-IN');
  useEffect(() => { localStorage.setItem('waguri_voice_lang', voiceLang); }, [voiceLang]);
  const sendRef = useRef(null); // bound to handleSendMessage once it exists below

  const handleStopAudio = useCallback(() => {
    try { audioRef.current?.pause(); } catch { /* nothing playing */ }
    setIsSpeaking(false);
    setActiveAudioUrl(null);
  }, []);

  const voice = useVoiceInput({
    enabled: handsFree,
    paused: isSpeaking || isLoading || !!activeAudioUrl,
    onFinalTranscript: (text) => sendRef.current?.(text),
    lang: voiceLang,
  });

  const toggleMic = () => {
    if (isSpeaking) {
      handleStopAudio();
    }
    setHandsFree((h) => !h);
  };

  const audioRef = useRef(null);
  // Text of the message currently being voiced — if its stored audio_url turns out
  // dead (backend restart wiped the in-memory cache), we re-synthesize from this.
  const voiceFallbackTextRef = useRef(null);
  // Feeling-layer bookkeeping: user activity timestamps drive the idle loop.
  const lastActivityRef = useRef(Date.now());
  const idleBusyRef = useRef(false);

  // A stored conversation_id can go stale (backend restart wiped memory storage,
  // Supabase reset, another device). On a 404 "not found", drop the stored id and
  // retry once with a fresh conversation instead of bricking the chat.
  const callWithStaleRecovery = async (apiFn, params) => {
    try {
      return await apiFn(params);
    } catch (err) {
      if (err?.status === 404 && params.conversationId) {
        console.warn('[waguri] stale conversation id, starting a fresh conversation');
        setConversationId(null);
        localStorage.removeItem('waguri_conversation_id');
        return apiFn({ ...params, conversationId: null });
      }
      throw err;
    }
  };

  // Persona is fetched from the backend (Supabase `personas` table in prod).
  useEffect(() => {
    getPersona()
      .then((p) => { if (p && p.name) setPersona(p); })
      .catch((err) => {
        console.warn('Could not fetch persona from server:', err.message);
        setPersona({ name: 'Waguri', personality_traits: [] });
      });
  }, []);

  // Persist conversationId in localStorage so page reloads do not orphan the conversation
  useEffect(() => {
    if (conversationId) {
      localStorage.setItem('waguri_conversation_id', conversationId);
    }
  }, [conversationId]);

  // Conversation history is server-side too: on load, pull it from Supabase so
  // the chat survives refreshes. If no conversationId is stored locally, fetch
  // the user's latest conversation from Supabase.
  useEffect(() => {
    if (conversationId) {
      getConversationHistory(conversationId, { limit: 50 })
        .then((h) => {
          const items = (h.items || []).map((m) => ({ role: m.role, content: m.content }));
          if (items.length) setMessages([WELCOME_MESSAGE, ...items]);
        })
        .catch((err) => console.warn('[waguri] history load skipped:', err.message));
    } else {
      const uid = authUser?.email || 'local-user';
      getLatestConversation(uid)
        .then((res) => {
          if (res?.conversation_id) {
            setConversationId(res.conversation_id);
            const items = (res.items || []).map((m) => ({ role: m.role, content: m.content }));
            if (items.length) setMessages([WELCOME_MESSAGE, ...items]);
          }
        })
        .catch((err) => console.warn('[waguri] latest conversation load skipped:', err.message));
    }
  }, [conversationId, authUser]);

  // Periodic background health ping to keep backend warm
  useEffect(() => {
    checkBackendHealth().catch(() => {});
    const timer = setInterval(() => {
      checkBackendHealth().catch(() => {});
    }, 20000);
    return () => clearInterval(timer);
  }, []);

  // Unprompted idle speech is disabled per user preference ("vrna n bole" — speaks only in response to user)

  // Audio Playback Handler. Stored audio URLs can die (the backend audio cache is
  // in-memory), so playback self-heals: on failure the voice is re-synthesized
  // from the message text via POST /api/tts/url — lip-sync then always works.
  const playUrl = (url) => {
    const el = audioRef.current;
    if (!el) return Promise.reject(new Error('audio element not ready'));
    el.src = url;
    el.crossOrigin = 'anonymous';
    return el.play();
  };

  const handlePlayAudio = async (audioUrl, emotion, fallbackText) => {
    if (emotion) setCurrentEmotion(emotion);
    voiceFallbackTextRef.current = fallbackText || null;

    if (audioUrl) {
      setActiveAudioUrl(audioUrl);
      setIsSpeaking(true);
      try {
        await playUrl(audioUrl);
        return;
      } catch (err) {
        console.warn('Audio play failed, re-synthesizing voice:', err.message);
      }
    }

    if (fallbackText) {
      try {
        setIsSpeaking(true);
        const { audio_url } = await synthesizeToUrl(fallbackText);
        // Cache the fresh URL on the in-memory message so replays skip synthesis.
        setMessages((prev) => prev.map((m) => (m.content === fallbackText && m.role === 'assistant' ? { ...m, audio_url } : m)));
        setActiveAudioUrl(audio_url);
        await playUrl(audio_url);
        return;
      } catch (err) {
        console.warn('Voice re-synthesis failed:', err.message);
      }
    }

    setActiveAudioUrl(null);
    setIsSpeaking(false);
  };

  const handleAudioEnded = () => {
    setIsSpeaking(false);
    setActiveAudioUrl(null);
  };

  // Chat Message Send Handler
  const handleSendMessage = async (userText) => {
    lastActivityRef.current = Date.now(); // user spoke — re-arm the idle loop
    const userMsg = { role: 'user', content: userText };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await callWithStaleRecovery(sendMessage, {
        conversationId,
        personaId: persona?.id,
        userId: authUser?.email || 'local-user',
        message: userText,
      });

      if (res.conversation_id && res.conversation_id !== conversationId) {
        setConversationId(res.conversation_id);
      }

      const emotion = res.emotion || res.mood?.expression || res.mood?.name || 'happy';
      setCurrentEmotion(emotion);

      const botMsg = {
        role: 'assistant',
        content: res.reply_text,
        emotion: emotion,
        audio_url: res.audio_url,
        latency_ms: res.meta?.llm?.latency_ms,
        memories_used: res.meta?.memories_used || 0,
      };

      setMessages((prev) => [...prev, botMsg]);

      // Auto-play TTS audio if enabled: Waguri speaks her entire reply automatically ("apna bole")
      if (autoPlayAudio && botMsg.audio_url) {
        setActiveAudioUrl(botMsg.audio_url);
        setIsSpeaking(true);
        handlePlayAudio(botMsg.audio_url, emotion, botMsg.content);
      }
    } catch (err) {
      console.error('Chat error:', err);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Arre! Something went wrong: ${err.message}`,
          emotion: 'sad',
        },
      ]);
      setCurrentEmotion('sad');
    } finally {
      setIsLoading(false);
    }
  };
  // Voice input sends through the same chat path (bound after definition).
  sendRef.current = handleSendMessage;

  const handleGameMessage = (msg) => {
    setMessages((prev) => [...prev, msg]);
    if (msg.emotion) setCurrentEmotion(msg.emotion);
  };

  // Helper to render active stage or auth background
  const renderBackground = () => {
    if (background.id === 'sunset') return <SunsetBackground />;
    if (background.id === 'midnight') return <MidnightSkyBackground />;
    if (background.id === 'paper') return <PaperBackground />;
    if (background.id === 'wave') {
      return (
        <>
          <PaperBackground />
          <WaveBackground />
        </>
      );
    }
    if (background.id === 'custom' && background.custom) {
      return <div className="bg-custom" style={{ backgroundImage: `url(${background.custom})` }} />;
    }
    if (background.id === 'transparent') {
      return null;
    }
    return theme === 'dark' ? <MidnightSkyBackground /> : <PaperBackground />;
  };

  // Full-app Authentication Gate: Private access only
  if (authLoading) {
    return (
      <div className="auth-gate-container" data-theme={theme}>
        <div className="bg-layer">
          {renderBackground()}
        </div>
        <div className="ambient-glow" />
        <div className="auth-gate-card">
          <div className="auth-gate-avatar">🌸</div>
          <div className="auth-gate-spinner" />
          <h2 className="auth-gate-title">WAGURI</h2>
          <p className="auth-gate-subtitle">Verifying Google authorization…</p>
          {/* Silent listener checking session */}
          <div style={{ display: 'none' }}>
            <GoogleAuth onUserChange={setAuthUser} onLoadingChange={setAuthLoading} />
          </div>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="auth-gate-container" data-theme={theme}>
        <div className="bg-layer">
          {renderBackground()}
        </div>
        <div className="ambient-glow" />
        <div className="auth-gate-card">
          <div className="auth-gate-header">
            <div className="auth-gate-avatar">🌸</div>
            <h1 className="auth-gate-title">WAGURI</h1>
            <span className="auth-gate-badge">Private Access</span>
          </div>
          <p className="auth-gate-subtitle">
            Welcome to Waguri! Access is private and restricted. Please sign in with your authorized Google account to continue.
          </p>
          <div className="auth-gate-btn-wrapper">
            <GoogleAuth onUserChange={setAuthUser} onLoadingChange={setAuthLoading} />
          </div>
          <div className="auth-gate-footer">
            <span>🔒 Authorized accounts only</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stage" data-theme={theme}>
      {/* stage background (sunset / paper / wave / midnight / transparent / custom) */}
      <div className="bg-layer">
        {renderBackground()}
      </div>
      <div className="ambient-glow" />

      {/* Hidden audio element for TTS playback & Web Audio analyser */}
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        onPlay={() => setIsSpeaking(true)}
        onPlaying={() => setIsSpeaking(true)}
        onEnded={handleAudioEnded}
        onError={() => {
          setIsSpeaking(false);
          setActiveAudioUrl(null);
        }}
      />

      {/* Top bar */}
      <header className="topbar">
        <div className="logo">
          <div className="logo-avatar">🌸</div>
          <span>WAGURI</span>
        </div>
        <div className="topbar-actions">
          <GoogleAuth onUserChange={setAuthUser} compact />
          {isAdminEmail(authUser?.email) && (
            <button
              type="button"
              className="admin-portal-topbar-btn"
              onClick={() => setIsAdminPortalOpen(true)}
              title="Open Admin Access Portal to manage whitelist"
              aria-label="Admin Access Portal"
            >
              <ShieldCheck size={15} />
              <span>Admin Portal</span>
            </button>
          )}
          {installPrompt && (
            <button
              className="install-pwa-btn"
              onClick={handleInstallApp}
              title="Install Waguri App on your device"
            >
              📱 Install App
            </button>
          )}
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            title={`Switch to ${theme === 'light' ? 'Dark Mode (Midnight Sky)' : 'Light Mode'}`}
            aria-label="Toggle theme"
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </header>

      {/* The avatar herself — full stage */}
      <AvatarCanvas
        currentEmotion={currentEmotion}
        audioElement={audioRef.current}
        isSpeaking={isSpeaking}
        chatOpen={chatOpen}
      />





      {/* floating chat card */}
      <aside className={`chat-card ${chatOpen ? 'open' : ''}`}>
        <ChatPanel
          messages={messages}
          onSendMessage={handleSendMessage}
          isLoading={isLoading}
          onPlayAudio={handlePlayAudio}
          onStopAudio={handleStopAudio}
          activeAudioUrl={activeAudioUrl}
          isPlayingAudio={isSpeaking}
          persona={persona}
          micSupported={voice.supported}
          isListening={voice.isListening}
          isSpeaking={voice.isSpeaking}
          volumeLevel={voice.volumeLevel}
          isProcessing={voice.isProcessing}
          interim={voice.interim}
          voiceError={voice.voiceError}
          handsFree={handsFree}
          onToggleMic={toggleMic}
          onResetVoiceError={voice.resetError}
        />
      </aside>

      {/* round action buttons (bottom-right, airi-style) */}
      <div className="fab-row">
        <button
          className={`fab ${chatOpen ? 'active' : ''}`}
          onClick={() => setChatOpen((o) => !o)}
          title={chatOpen ? 'Hide chat' : 'Show chat'}
          aria-label="Toggle chat panel"
        >
          <MessageCircle size={19} />
        </button>
        <button
          className={`fab ${handsFree ? 'mic-active' : ''} ${voice.isSpeaking ? 'speaking' : ''}`}
          onClick={toggleMic}
          title={
            voice.voiceError
              ? `${voice.voiceError} (click to retry)`
              : handsFree
              ? voice.isSpeaking
                ? 'Hearing your voice…'
                : 'Hands-free voice ON — speak anytime (click to mute)'
              : 'Enable hands-free voice'
          }
          aria-label="Toggle hands-free voice"
        >
          {handsFree ? <Mic size={19} /> : <MicOff size={19} />}
        </button>
        <button
          className="fab"
          onClick={() => setIsGameOpen(true)}
          title="Play a game with her"
          aria-label="Play games"
        >
          <Gamepad2 size={19} />
        </button>
        <button
          className={`fab ${autoPlayAudio ? 'active' : ''}`}
          onClick={() => setAutoPlayAudio(!autoPlayAudio)}
          title={autoPlayAudio ? 'Her voice ON' : 'Her voice MUTED'}
          aria-label="Toggle voice auto-play"
        >
          {autoPlayAudio ? <Volume2 size={19} /> : <VolumeX size={19} />}
        </button>
        <button
          className="fab"
          onClick={() => setIsBgPickerOpen(true)}
          title="Stage background"
          aria-label="Stage background"
        >
          <ImageIcon size={19} />
        </button>
      </div>

      {/* Modals */}
      <GamePanel
        isOpen={isGameOpen}
        onClose={() => setIsGameOpen(false)}
        conversationId={conversationId}
        onPlayAudio={handlePlayAudio}
        onGameMessage={handleGameMessage}
      />

      <BackgroundPicker
        isOpen={isBgPickerOpen}
        onClose={() => setIsBgPickerOpen(false)}
        background={background}
        onApply={setBackground}
      />

      <AdminPortal
        isOpen={isAdminPortalOpen}
        onClose={() => setIsAdminPortalOpen(false)}
        adminEmail={authUser?.email}
      />
    </div>
  );
}
