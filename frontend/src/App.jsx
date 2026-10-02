import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, VolumeX, Mic, MicOff, MessageCircle, ImageIcon, ShieldCheck, Sparkles, Bell, BellRing, Clock } from 'lucide-react';
import AvatarCanvas from './components/AvatarCanvas.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import BackgroundPicker from './components/BackgroundPicker.jsx';
import VRMPicker from './components/VRMPicker.jsx';
import WaveBackground from './components/WaveBackground.jsx';
import MidnightSkyBackground from './components/MidnightSkyBackground.jsx';
import PaperBackground from './components/PaperBackground.jsx';
import SunsetBackground from './components/SunsetBackground.jsx';
import GoogleAuth from './components/GoogleAuth.jsx';
import AdminPortal from './components/AdminPortal.jsx';
import AlarmModal from './components/AlarmModal.jsx';
import { isAdminEmail } from './supabaseClient.js';
import { sendMessage, checkBackendHealth, getPersona, fetchIdleComment, getConversationHistory, getLatestConversation, synthesizeToUrl } from './api.js';
import { useVoiceInput } from './useVoiceInput.js';
import { BUNDLED_AVATARS, DEFAULT_VRM_URL, getCustomVrmBlob } from './lib/vrmStore.js';
import { isPushSupported, getExistingSubscription, subscribeToPush, unsubscribeFromPush, sendTestNotification, showLocalNotification } from './lib/pushClient.js';

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

  const [conversationId, setConversationId] = useState(null);

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
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    if (isPushSupported()) {
      getExistingSubscription().then((sub) => {
        if (sub) setPushSubscribed(true);
      }).catch(() => {});
    }
  }, []);

  // Sync push subscription with logged-in user email
  useEffect(() => {
    if (authUser?.email && pushSubscribed) {
      subscribeToPush(authUser.email).catch((err) => {
        console.warn('[push] silent user sync notice:', err?.message);
      });
    }
  }, [authUser?.email, pushSubscribed]);

  const handleTogglePush = async () => {
    if (pushLoading) return;
    setPushLoading(true);
    try {
      if (pushSubscribed) {
        const sendTest = window.confirm(
          'Notifications are currently ON! ✨\n\n• Click OK to send a test alert to your device.\n• Click Cancel to turn notifications OFF.'
        );
        if (sendTest) {
          try {
            await sendTestNotification(authUser?.email || 'local-user');
          } catch {
            await showLocalNotification('Waguri ❤️', 'Test Alert: Device par notifications active hain! ✨');
          }
          alert('✨ Test notification sent! Check your phone / device notification tray.');
        } else {
          await unsubscribeFromPush();
          setPushSubscribed(false);
          alert('Notifications have been turned off.');
        }
      } else {
        await subscribeToPush(authUser?.email || 'local-user');
        setPushSubscribed(true);
        try {
          await sendTestNotification(authUser?.email || 'local-user');
        } catch {
          await showLocalNotification('Waguri ❤️', '🎉 Notifications Active: Waguri aapko sweet alerts bhejegi!');
        }
        alert('🎉 Notifications enabled! Waguri will now text you on your phone notification bar.');
      }
    } catch (err) {
      console.error('[push] error:', err);
      alert(err.message || 'Notification setup failed');
    } finally {
      setPushLoading(false);
    }
  };

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
  const [isBgPickerOpen, setIsBgPickerOpen] = useState(false);
  const [bgPickerTab, setBgPickerTab] = useState('background');
  const [isAdminPortalOpen, setIsAdminPortalOpen] = useState(false);
  const [isAlarmModalOpen, setIsAlarmModalOpen] = useState(false);

  // Active avatar (VRM). The id persists; bundled ids resolve to /public URLs,
  // custom ids to IndexedDB blobs served via object URLs.
  const [activeVrmId, setActiveVrmId] = useState(
    () => localStorage.getItem('waguri_active_vrm') || 'waguri'
  );
  useEffect(() => {
    try { localStorage.setItem('waguri_active_vrm', activeVrmId); } catch { /* private mode */ }
  }, [activeVrmId]);

  const [vrmUrl, setVrmUrl] = useState(DEFAULT_VRM_URL);
  // Object URLs are cached per avatar id so switching back is instant; they
  // live for the whole session (blobs stay in IndexedDB across sessions).
  const vrmObjectUrlsRef = useRef(new Map());
  useEffect(() => {
    let cancelled = false;
    const bundled = BUNDLED_AVATARS.find((a) => a.id === activeVrmId);
    if (bundled) {
      setVrmUrl(bundled.url);
      return;
    }
    getCustomVrmBlob(activeVrmId)
      .then((blob) => {
        if (!blob) throw new Error('avatar not found');
        let url = vrmObjectUrlsRef.current.get(activeVrmId);
        if (!url) {
          url = URL.createObjectURL(blob);
          vrmObjectUrlsRef.current.set(activeVrmId, url);
        }
        if (!cancelled) setVrmUrl(url);
      })
      .catch((err) => {
        console.warn('[waguri] saved avatar unavailable, using default:', err.message);
        if (!cancelled) setActiveVrmId('waguri');
      });
    return () => { cancelled = true; };
  }, [activeVrmId]);

  // 360° Interactive Rotary Wheel / Dial state for action buttons
  const [dialRotation, setDialRotation] = useState(0);
  const [isDialDragging, setIsDialDragging] = useState(false);
  const dialDragRef = useRef({
    isDown: false,
    hasDragged: false,
    startAngle: 0,
    prevAngle: 0,
    accumulatedDelta: 0,
    velocity: 0,
    lastTime: 0,
    rafId: null,
  });

  // Inertia animation cleanup
  useEffect(() => {
    return () => {
      if (dialDragRef.current.rafId) {
        cancelAnimationFrame(dialDragRef.current.rafId);
      }
    };
  }, []);

  // Reset rotation to 0 whenever the user opens the dial menu so it always expands in default clean position
  useEffect(() => {
    if (fabOpen) {
      if (dialDragRef.current.rafId) {
        cancelAnimationFrame(dialDragRef.current.rafId);
        dialDragRef.current.rafId = null;
      }
      setDialRotation(0);
      dialDragRef.current.hasDragged = false;
    }
  }, [fabOpen]);

  const getPointerAngle = (clientX, clientY) => {
    if (!fabMenuRef.current) return 0;
    const rect = fabMenuRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const rad = Math.atan2(clientY - cy, clientX - cx);
    return (rad * 180) / Math.PI;
  };

  const handleDialPointerDown = (e) => {
    if (!fabOpen) return;
    if (dialDragRef.current.rafId) {
      cancelAnimationFrame(dialDragRef.current.rafId);
      dialDragRef.current.rafId = null;
    }
    const angle = getPointerAngle(e.clientX, e.clientY);
    dialDragRef.current = {
      isDown: true,
      hasDragged: false,
      startAngle: angle,
      prevAngle: angle,
      accumulatedDelta: 0,
      velocity: 0,
      lastTime: performance.now(),
      rafId: null,
    };
    setIsDialDragging(true);
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {}
  };

  const handleDialPointerMove = (e) => {
    if (!dialDragRef.current.isDown) return;
    const currentAngle = getPointerAngle(e.clientX, e.clientY);
    let delta = currentAngle - dialDragRef.current.prevAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;

    const now = performance.now();
    const dt = Math.max(1, now - dialDragRef.current.lastTime);

    dialDragRef.current.accumulatedDelta += Math.abs(delta);
    if (dialDragRef.current.accumulatedDelta > 4) {
      dialDragRef.current.hasDragged = true;
    }

    dialDragRef.current.velocity = delta / dt;
    dialDragRef.current.prevAngle = currentAngle;
    dialDragRef.current.lastTime = now;

    setDialRotation((prev) => prev + delta);
  };

  const handleDialPointerUp = (e) => {
    if (!dialDragRef.current.isDown) return;
    dialDragRef.current.isDown = false;
    setIsDialDragging(false);

    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {}

    const wasDragged = dialDragRef.current.hasDragged;
    if (wasDragged) {
      setTimeout(() => {
        dialDragRef.current.hasDragged = false;
      }, 120);
    }

    // Apply smooth inertia if released with an angular spin flick
    let v = dialDragRef.current.velocity * 16;
    v = Math.max(-10, Math.min(10, v));

    if (Math.abs(v) > 0.25) {
      const step = () => {
        v *= 0.92;
        if (Math.abs(v) < 0.03) {
          dialDragRef.current.rafId = null;
          return;
        }
        setDialRotation((prev) => prev + v);
        dialDragRef.current.rafId = requestAnimationFrame(step);
      };
      dialDragRef.current.rafId = requestAnimationFrame(step);
    }
  };

  // Radial action menu (social-fab): open state + close on outside tap
  const [fabOpen, setFabOpen] = useState(false);
  const fabMenuRef = useRef(null);
  useEffect(() => {
    if (!fabOpen) return;
    const onOutside = (e) => {
      if (fabMenuRef.current && !fabMenuRef.current.contains(e.target)) setFabOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [fabOpen]);

  // Run a menu action, then fold the fan away — unless user was spinning the dial!
  const handleFabAction = (fn) => {
    if (dialDragRef.current.hasDragged) {
      return;
    }
    fn();
    setFabOpen(false);
  };

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

  // Theme: light only — the dark-mode toggle was removed by request.
  // (No theme state; the CSS light palette is the default.)

  const [background, setBackground] = useState(() => {
    try { return JSON.parse(localStorage.getItem('waguri_background')) || { id: 'room', custom: '' }; }
    catch { return { id: 'room', custom: '' }; }
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
    // Barge-in: sustained speech while she is talking stops her voice, which
    // unpauses the mic so the user's next words are actually captured.
    onSpeechStart: () => { if (isSpeaking || activeAudioUrl) handleStopAudio(); },
    lang: voiceLang,
  });

  const toggleMic = () => {
    if (isSpeaking) {
      handleStopAudio();
    }
    const willBeEnabled = !handsFree;
    setHandsFree(willBeEnabled);
    if (willBeEnabled) {
      // Synchronously call start() on user interaction to unlock AudioContext on iOS/mobile PWAs
      voice.start();
    } else {
      voice.stop();
    }
  };

  const audioRef = useRef(null);
  // Text of the message currently being voiced — if its stored audio_url turns out
  // dead (backend restart wiped the in-memory cache), we re-synthesize from this.
  const voiceFallbackTextRef = useRef(null);
  // Feeling-layer bookkeeping: user activity timestamps drive the idle loop.
  const lastActivityRef = useRef(Date.now());
  const idleBusyRef = useRef(false);

  const getStorageKey = (uid) => `waguri_conversation_id_${uid || 'local-user'}`;

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
        localStorage.removeItem(getStorageKey(params.userId));
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

  // Persist conversationId in user-scoped localStorage
  useEffect(() => {
    const uid = authUser?.email || 'local-user';
    if (conversationId) {
      localStorage.setItem(getStorageKey(uid), conversationId);
    }
  }, [conversationId, authUser]);

  // Conversation history is strictly partitioned per account:
  // When authUser changes (login, logout, account switch), immediately reset messages
  // and load only the target user's conversation.
  useEffect(() => {
    const uid = authUser?.email || 'local-user';
    const storedId = localStorage.getItem(getStorageKey(uid));

    // Reset message state immediately to prevent any cross-account visual leak
    setMessages([WELCOME_MESSAGE]);

    if (storedId) {
      setConversationId(storedId);
      getConversationHistory(storedId, { limit: 50, userId: uid })
        .then((h) => {
          const items = (h.items || []).map((m) => ({ role: m.role, content: m.content }));
          if (items.length) setMessages([WELCOME_MESSAGE, ...items]);
        })
        .catch((err) => {
          console.warn('[waguri] history load skipped / stale:', err.message);
          localStorage.removeItem(getStorageKey(uid));
          setConversationId(null);
          getLatestConversation(uid).then((res) => {
            if (res?.conversation_id) {
              setConversationId(res.conversation_id);
              const items = (res.items || []).map((m) => ({ role: m.role, content: m.content }));
              if (items.length) setMessages([WELCOME_MESSAGE, ...items]);
            }
          }).catch(() => {});
        });
    } else {
      setConversationId(null);
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
  }, [authUser]);

  // Periodic background health ping to keep backend warm
  useEffect(() => {
    checkBackendHealth().catch(() => {});
    const timer = setInterval(() => {
      checkBackendHealth().catch(() => {});
    }, 20000);
    return () => clearInterval(timer);
  }, []);

  // Unprompted idle speech is disabled per user preference ("vrna n bole" — speaks only in response to user)

  // Handle URL params when user taps an Alarm push notification (Option 5)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const alarmId = urlParams.get('alarm');
    const alarmTitle = urlParams.get('title');

    if (alarmId) {
      window.history.replaceState({}, document.title, window.location.pathname);
      const alarmGreeting = `Wake up sleepyhead! Tumhara alarm "${alarmTitle || 'Morning Wakeup'}" baj raha hai! ❤️ Waguri is right here with you!`;
      const botMsg = {
        role: 'assistant',
        content: `⏰ ${alarmGreeting}`,
        emotion: 'happy',
      };
      setMessages((prev) => [...prev, botMsg]);
      setCurrentEmotion('happy');

      synthesizeToUrl(alarmGreeting, 'happy', activeVrmId)
        .then((res) => {
          if (res?.audio_url) {
            handlePlayAudio(res.audio_url, 'happy', alarmGreeting);
          }
        })
        .catch((err) => console.warn('Alarm speech failed:', err));
    }
  }, [activeVrmId]);

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
        const { audio_url } = await synthesizeToUrl(fallbackText, emotion, activeVrmId);
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
        avatarId: activeVrmId,
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

  // Helper to render active stage or auth background
  const renderBackground = () => {
    if (background.id === 'room') {
      return (
        <div className="bg-room-container" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
          {/* Laptop / Desktop ambience behind 3D room */}
          <div
            className="bg-room-desktop-ambience"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(ellipse at 50% 30%, rgba(254, 243, 199, 0.25) 0%, rgba(30, 27, 75, 0.85) 100%), #1e1b4b',
              pointerEvents: 'none',
            }}
          />
          {/* Phone / Mobile aesthetic anime cozy room wallpaper */}
          <div className="bg-room-mobile-wallpaper">
            <div className="bg-room-mobile-glow" />
            <div className="bg-room-mobile-overlay" />
          </div>
        </div>
      );
    }
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
    return <PaperBackground />;
  };

  // Full-app Authentication Gate: Private access only
  if (authLoading) {
    return (
      <div className="auth-gate-container">
        <div className="bg-layer">
          {renderBackground()}
        </div>
        <div className="ambient-glow" />
        <div className="auth-gate-card">
          <div className="auth-gate-avatar">
            <img src="/logo.png" alt="Waguri Logo" className="auth-gate-logo-img" />
          </div>
          <div className="auth-gate-spinner" />
          <h2 className="auth-gate-title">WAGURI</h2>
          <p className="auth-gate-subtitle">Verifying authorization…</p>
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
      <div className="auth-gate-container">
        <div className="bg-layer">
          {renderBackground()}
        </div>
        <div className="ambient-glow" />
        <div className="auth-gate-card">
          <div className="auth-gate-header">
            <div className="auth-gate-avatar">
              <img src="/logo.png" alt="Waguri Logo" className="auth-gate-logo-img" />
            </div>
            <h1 className="auth-gate-title">WAGURI</h1>
            <span className="auth-gate-badge">Private Access</span>
          </div>
          <p className="auth-gate-subtitle">
            Welcome to Waguri! Sign in with your authorized email or Google account to continue.
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
    <div className="stage">
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
          <div className="logo-avatar">
            <img src="/logo.png" alt="Waguri Logo" className="logo-img" />
          </div>
          <span className="logo-text">WAGURI</span>
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
              <span className="admin-portal-btn-text">Admin Portal</span>
            </button>
          )}
          {installPrompt && (
            <button
              className="install-pwa-btn"
              onClick={handleInstallApp}
              title="Install Waguri App on your device"
            >
              <span className="install-pwa-btn-text">📱 Install App</span>
            </button>
          )}
          <button
            type="button"
            className={`push-notif-btn ${pushSubscribed ? 'active' : ''}`}
            onClick={handleTogglePush}
            disabled={pushLoading}
            title={pushSubscribed ? 'Notifications Active! Tap to send test alert to phone' : 'Enable girlfriend push notifications'}
          >
            {pushSubscribed ? <BellRing size={15} /> : <Bell size={15} />}
            <span className="push-notif-btn-text">
              {pushLoading ? 'Connecting...' : pushSubscribed ? 'Alerts On' : 'Enable Alerts'}
            </span>
          </button>
        </div>
      </header>

      {/* The avatar herself — full stage */}
      <AvatarCanvas
        currentEmotion={currentEmotion}
        audioElement={audioRef.current}
        isSpeaking={isSpeaking}
        chatOpen={chatOpen}
        vrmUrl={vrmUrl}
        showRoom={background?.id === 'room'}
        onTouchReaction={(type) => {
          if (type === 'headPat') {
            setCurrentEmotion('relaxed');
            setTimeout(() => {
              setCurrentEmotion((prev) => (prev === 'relaxed' ? 'happy' : prev));
            }, 2500);
          } else if (type === 'shoulderTap') {
            setCurrentEmotion('surprised');
            setTimeout(() => {
              setCurrentEmotion((prev) => (prev === 'surprised' ? 'happy' : prev));
            }, 1400);
          }
        }}
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

      {/* radial action menu (bottom-right, social-clock style):
          collapsed to one trigger; expands into a colored button fan on
          hover (desktop) or trigger tap (touch), spinning out like a clock */}
      <div
        className={`social-fab ${fabOpen ? 'open' : ''} ${isDialDragging ? 'is-dragging' : ''}`}
        ref={fabMenuRef}
        style={{ '--dial-rot': `${dialRotation}deg` }}
      >
        <div
          className="social-fab__list"
          ref={dialRef}
          onPointerDown={handleDialPointerDown}
          onPointerMove={handleDialPointerMove}
          onPointerUp={handleDialPointerUp}
          onPointerCancel={handleDialPointerUp}
        >
          {/* Visual rotary dial track ring */}
          <div className="social-fab__dial-ring" aria-hidden="true" />
          <button
            className={`social-fab__button chat ${chatOpen ? 'active' : ''}`}
            onClick={() => handleFabAction(() => setChatOpen((o) => !o))}
            title={chatOpen ? 'Hide chat' : 'Show chat'}
            aria-label="Toggle chat panel"
          >
            <MessageCircle size={19} />
          </button>
          <button
            className={`social-fab__button mic ${handsFree ? 'mic-active' : ''} ${voice.isSpeaking ? 'speaking' : ''}`}
            onClick={() => handleFabAction(toggleMic)}
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
            className="social-fab__button alarm"
            onClick={() => handleFabAction(() => setIsAlarmModalOpen(true))}
            title="Alarms & Voice Reminders (Option 5)"
            aria-label="Alarms & Voice Reminders"
          >
            <Clock size={19} />
          </button>
          <button
            className={`social-fab__button voice ${autoPlayAudio ? 'active' : ''}`}
            onClick={() => handleFabAction(() => setAutoPlayAudio(!autoPlayAudio))}
            title={autoPlayAudio ? 'Her voice ON' : 'Her voice MUTED'}
            aria-label="Toggle voice auto-play"
          >
            {autoPlayAudio ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <button
            className="social-fab__button bg"
            onClick={() => handleFabAction(() => setIsBgPickerOpen(true))}
            title="Stage background & Avatar"
            aria-label="Stage background & Avatar"
          >
            <ImageIcon size={19} />
          </button>
        </div>
        <button
          type="button"
          className={`social-fab__trigger ${handsFree ? 'mic-live' : ''}`}
          onClick={() => setFabOpen((o) => !o)}
          aria-label="Toggle actions menu"
          aria-expanded={fabOpen}
          title="Actions"
        >
          <Sparkles size={18} />
        </button>
      </div>

      {/* Modals */}
      <BackgroundPicker
        isOpen={isBgPickerOpen}
        onClose={() => setIsBgPickerOpen(false)}
        background={background}
        onApply={setBackground}
        activeVrmId={activeVrmId}
        onSelectVrm={(id) => setActiveVrmId(id)}
        initialTab={bgPickerTab}
      />

      <AdminPortal
        isOpen={isAdminPortalOpen}
        onClose={() => setIsAdminPortalOpen(false)}
        adminEmail={authUser?.email}
      />

      <AlarmModal
        isOpen={isAlarmModalOpen}
        onClose={() => setIsAlarmModalOpen(false)}
        activeVrmId={activeVrmId}
        onPlayAlarmAudio={(url) => playUrl(url)}
      />
    </div>
  );
}
