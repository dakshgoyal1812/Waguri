import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Volume2, VolumeX, Mic, MicOff, MessageCircle, ImageIcon, ShieldCheck, Sparkles, Bell, BellRing, Clock, UserRound, Brain, Shirt } from 'lucide-react';
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
import MemoryInspector from './components/MemoryInspector.jsx';
import MemoryPasswordModal from './components/MemoryPasswordModal.jsx';
import AvatarStudioModal from './components/AvatarStudioModal.jsx';
import { isAdminEmail, DEFAULT_BYPASS_USER } from './supabaseClient.js';
import { sendMessage, checkBackendHealth, getPersona, fetchIdleComment, getConversationHistory, getLatestConversation, synthesizeToUrl } from './api.js';
import { useVoiceInput } from './useVoiceInput.js';
import { BUNDLED_AVATARS, DEFAULT_VRM_URL, getCustomVrmBlob } from './lib/vrmStore.js';
import { isPushSupported, getExistingSubscription, subscribeToPush, unsubscribeFromPush, sendTestNotification, showLocalNotification } from './lib/pushClient.js';
import { loadAvatarCustomization, saveAvatarCustomization } from './lib/avatarCustomization.js';

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

  const [currentPath, setCurrentPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateTo = (path) => {
    window.history.pushState(null, '', path);
    setCurrentPath(path);
  };

  const [currentEmotion, setCurrentEmotion] = useState('happy');
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeAudioUrl, setActiveAudioUrl] = useState(null);
  const [autoPlayAudio, setAutoPlayAudio] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
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
  const [isWallpaperPickerOpen, setIsWallpaperPickerOpen] = useState(false);
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const [isAdminPortalOpen, setIsAdminPortalOpen] = useState(false);
  const [isAlarmModalOpen, setIsAlarmModalOpen] = useState(false);
  const [isMemoryPasswordModalOpen, setIsMemoryPasswordModalOpen] = useState(false);
  const [isAvatarStudioOpen, setIsAvatarStudioOpen] = useState(false);

  const handleOpenMemory = () => {
    try {
      if (sessionStorage.getItem('waguri_memory_unlocked') === 'true') {
        navigateTo('/memory');
        return;
      }
    } catch {}
    setIsMemoryPasswordModalOpen(true);
  };

  // Active avatar (VRM). The id persists; bundled ids resolve to /public URLs,
  // custom ids to IndexedDB blobs served via object URLs.
  const [activeVrmId, setActiveVrmId] = useState(
    () => localStorage.getItem('waguri_active_vrm') || 'waguri'
  );
  useEffect(() => {
    try { localStorage.setItem('waguri_active_vrm', activeVrmId); } catch { /* private mode */ }
  }, [activeVrmId]);

  // 3D Avatar Customization (Clothes, Eyes, Hair, Skin, Glow)
  const [avatarCustomization, setAvatarCustomization] = useState(() =>
    loadAvatarCustomization(activeVrmId)
  );

  useEffect(() => {
    setAvatarCustomization(loadAvatarCustomization(activeVrmId));
  }, [activeVrmId]);

  const handleCustomizationChange = (newConfig) => {
    setAvatarCustomization(newConfig);
    saveAvatarCustomization(activeVrmId, newConfig);
  };

  const handleResetCustomization = () => {
    const resetConfig = {
      presetId: 'original',
      topsColor: null,
      bottomsColor: null,
      shoesColor: null,
      outfitGlow: false,
      outfitGlowColor: '#00f0ff',
      outfitGlowIntensity: 0.5,
      eyeColor: null,
      eyeHighlightColor: null,
      hairColor: null,
      skinTone: null,
    };
    setAvatarCustomization(resetConfig);
    saveAvatarCustomization(activeVrmId, resetConfig);
  };

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

  // Radial action menu (social-fab): open state + refs
  const [fabOpen, setFabOpen] = useState(false);
  const fabMenuRef = useRef(null);
  const dialRef = useRef(null);

  useEffect(() => {
    if (!fabOpen) return;
    const onOutside = (e) => {
      if (fabMenuRef.current && !fabMenuRef.current.contains(e.target)) setFabOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [fabOpen]);

  // 360° Interactive Rotary Wheel / Dial state for action buttons
  const [dialRotation, setDialRotation] = useState(0);
  const [isDialDragging, setIsDialDragging] = useState(false);
  const [isDialRolling, setIsDialRolling] = useState(false);
  const dialDragRef = useRef({
    isDown: false,
    hasDragged: false,
    startAngle: 0,
    prevAngle: 0,
    accumulatedDelta: 0,
    velocity: 0,
    lastTime: 0,
    currentRotation: 0,
    rafId: null,
    lastHapticAngle: 0,
  });

  // Inertia animation cleanup
  useEffect(() => {
    return () => {
      if (dialDragRef.current.rafId) {
        cancelAnimationFrame(dialDragRef.current.rafId);
      }
    };
  }, []);

  // Update CSS custom property directly for 120 FPS smooth hardware acceleration
  const applyRotation = (rot) => {
    dialDragRef.current.currentRotation = rot;
    if (fabMenuRef.current) {
      fabMenuRef.current.style.setProperty('--dial-rot', `${rot}deg`);
    }
  };

  // Reset rotation to 0 whenever the user opens the dial menu so it always expands in default clean position
  useEffect(() => {
    if (fabOpen) {
      if (dialDragRef.current.rafId) {
        cancelAnimationFrame(dialDragRef.current.rafId);
        dialDragRef.current.rafId = null;
      }
      dialDragRef.current.currentRotation = 0;
      dialDragRef.current.velocity = 0;
      dialDragRef.current.hasDragged = false;
      setIsDialRolling(false);
      setDialRotation(0);
      applyRotation(0);
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
    dialDragRef.current.isDown = true;
    dialDragRef.current.hasDragged = false;
    dialDragRef.current.startAngle = angle;
    dialDragRef.current.prevAngle = angle;
    dialDragRef.current.accumulatedDelta = 0;
    dialDragRef.current.velocity = 0;
    dialDragRef.current.lastTime = performance.now();
    dialDragRef.current.lastHapticAngle = dialDragRef.current.currentRotation;

    setIsDialDragging(true);
    setIsDialRolling(false);

    const onPointerMove = (moveEvent) => {
      if (!dialDragRef.current.isDown) return;
      if (moveEvent.cancelable) {
        moveEvent.preventDefault();
      }

      const currentAngle = getPointerAngle(moveEvent.clientX, moveEvent.clientY);
      let delta = currentAngle - dialDragRef.current.prevAngle;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;

      const now = performance.now();
      const dt = Math.max(1, now - dialDragRef.current.lastTime);

      dialDragRef.current.accumulatedDelta += Math.abs(delta);
      if (dialDragRef.current.accumulatedDelta > 5) {
        dialDragRef.current.hasDragged = true;
      }

      // Smooth velocity filtering
      const instantVelocity = delta / dt;
      dialDragRef.current.velocity = dialDragRef.current.velocity * 0.4 + instantVelocity * 0.6;
      dialDragRef.current.prevAngle = currentAngle;
      dialDragRef.current.lastTime = now;

      const newRot = dialDragRef.current.currentRotation + delta;
      applyRotation(newRot);

      // Subtle haptic tick every 25 degrees on mobile
      if (Math.abs(newRot - dialDragRef.current.lastHapticAngle) >= 25) {
        dialDragRef.current.lastHapticAngle = newRot;
        try {
          if (navigator.vibrate) navigator.vibrate(4);
        } catch {}
      }
    };

    const onPointerUp = () => {
      if (!dialDragRef.current.isDown) return;
      dialDragRef.current.isDown = false;
      setIsDialDragging(false);

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      const wasDragged = dialDragRef.current.hasDragged;
      if (wasDragged) {
        setTimeout(() => {
          dialDragRef.current.hasDragged = false;
        }, 140);
      }

      // Inertia momentum with gentle friction decay
      let v = dialDragRef.current.velocity * 16;
      v = Math.max(-14, Math.min(14, v));

      if (Math.abs(v) > 0.15) {
        setIsDialRolling(true);
        const friction = 0.93;
        const step = () => {
          v *= friction;
          if (Math.abs(v) < 0.03) {
            dialDragRef.current.rafId = null;
            setIsDialRolling(false);
            setDialRotation(dialDragRef.current.currentRotation);
            return;
          }
          const nextRot = dialDragRef.current.currentRotation + v;
          applyRotation(nextRot);
          dialDragRef.current.rafId = requestAnimationFrame(step);
        };
        dialDragRef.current.rafId = requestAnimationFrame(step);
      } else {
        setDialRotation(dialDragRef.current.currentRotation);
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  // Run a menu action, then fold the fan away — unless user was spinning the dial!
  const handleFabAction = (fn) => {
    if (dialDragRef.current.hasDragged || isDialDragging || isDialRolling) {
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

  // Full-app Authentication Gate: Bypassed for direct access
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
          <GoogleAuth onUserChange={setAuthUser} onLoadingChange={setAuthLoading} compact />
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
          <button
            type="button"
            className="memory-topbar-btn"
            onClick={handleOpenMemory}
            title="RAG Memory Inspector (Brain & Memories)"
            aria-label="Memory Inspector"
          >
            <Brain size={15} />
            <span className="memory-topbar-btn-text">Memory</span>
          </button>
          <button
            type="button"
            className="wardrobe-topbar-btn"
            onClick={() => setIsAvatarStudioOpen(true)}
            title="3D Wardrobe & Avatar Studio (Customize Clothes, Eyes, Hair)"
            aria-label="3D Wardrobe Studio"
          >
            <Sparkles size={15} />
            <span className="wardrobe-topbar-btn-text">Wardrobe</span>
          </button>
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

      {/* The avatar herself — full stage (hidden when on /memory to eliminate WebGL composite lag) */}
      <div style={{ display: currentPath === '/memory' ? 'none' : 'contents' }}>
        <AvatarCanvas
          currentEmotion={currentEmotion}
          audioElement={audioRef.current}
          isSpeaking={isSpeaking}
          chatOpen={chatOpen}
          vrmUrl={vrmUrl}
          customization={avatarCustomization}
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
      </div>





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
        className={`social-fab ${fabOpen ? 'open' : ''} ${isDialDragging ? 'is-dragging' : ''} ${isDialRolling ? 'is-rolling' : ''}`}
        ref={fabMenuRef}
        style={{ '--dial-rot': `${dialRotation}deg` }}
      >
        <div
          className="social-fab__list"
          ref={dialRef}
          onPointerDown={handleDialPointerDown}
        >
          {/* Visual rotary dial track ring */}
          <div className="social-fab__dial-ring" aria-hidden="true" />

          {/* 1. Chat Panel */}
          <button
            className={`social-fab__button chat ${chatOpen ? 'active' : ''}`}
            style={{ '--index': 0 }}
            onClick={() => handleFabAction(() => setChatOpen((o) => !o))}
            title={chatOpen ? 'Hide chat' : 'Show chat'}
            aria-label="Toggle chat panel"
          >
            <MessageCircle size={19} />
            <span className="social-fab__tooltip">Chat</span>
          </button>

          {/* 2. Hands-Free Mic */}
          <button
            className={`social-fab__button mic ${handsFree ? 'mic-active' : ''} ${voice.isSpeaking ? 'speaking' : ''}`}
            style={{ '--index': 1 }}
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
            <span className="social-fab__tooltip">Mic</span>
          </button>

          {/* 3. Voice Audio Auto-play */}
          <button
            className={`social-fab__button voice ${autoPlayAudio ? 'active' : ''}`}
            style={{ '--index': 2 }}
            onClick={() => handleFabAction(() => setAutoPlayAudio(!autoPlayAudio))}
            title={autoPlayAudio ? 'Her voice ON' : 'Her voice MUTED'}
            aria-label="Toggle voice auto-play"
          >
            {autoPlayAudio ? <Volume2 size={19} /> : <VolumeX size={19} />}
            <span className="social-fab__tooltip">Voice</span>
          </button>

          {/* 4. 3D Avatar Companion */}
          <button
            className={`social-fab__button avatar ${isAvatarPickerOpen ? 'active' : ''}`}
            style={{ '--index': 3 }}
            onClick={() => handleFabAction(() => setIsAvatarPickerOpen(true))}
            title="3D Avatar Companion (Change model & voice)"
            aria-label="Change 3D Avatar Companion"
          >
            <UserRound size={19} />
            <span className="social-fab__tooltip">Avatar</span>
          </button>

          {/* 5. 3D Wardrobe & Clothes Studio */}
          <button
            className={`social-fab__button wardrobe ${isAvatarStudioOpen ? 'active' : ''}`}
            style={{ '--index': 4 }}
            onClick={() => handleFabAction(() => setIsAvatarStudioOpen(true))}
            title="3D Wardrobe & Clothes Studio (Customize Outfit, Eyes, Hair)"
            aria-label="3D Wardrobe Studio"
          >
            <Shirt size={19} />
            <span className="social-fab__tooltip">Wardrobe</span>
          </button>

          {/* 6. Stage Wallpaper */}
          <button
            className={`social-fab__button wallpaper ${isWallpaperPickerOpen ? 'active' : ''}`}
            style={{ '--index': 5 }}
            onClick={() => handleFabAction(() => setIsWallpaperPickerOpen(true))}
            title="Stage Wallpaper (Change background)"
            aria-label="Change Stage Wallpaper"
          >
            <ImageIcon size={19} />
            <span className="social-fab__tooltip">Wallpaper</span>
          </button>

          {/* 7. Alarms & Voice Reminders */}
          <button
            className={`social-fab__button alarm ${isAlarmModalOpen ? 'active' : ''}`}
            style={{ '--index': 6 }}
            onClick={() => handleFabAction(() => setIsAlarmModalOpen(true))}
            title="Alarms & Voice Reminders"
            aria-label="Alarms & Voice Reminders"
          >
            <Clock size={19} />
            <span className="social-fab__tooltip">Alarms</span>
          </button>

          {/* 8. Girlfriend Notifications */}
          <button
            className={`social-fab__button notif ${pushSubscribed ? 'active' : ''}`}
            style={{ '--index': 7 }}
            onClick={() => handleFabAction(handleTogglePush)}
            disabled={pushLoading}
            title={
              pushLoading
                ? 'Connecting alerts...'
                : pushSubscribed
                ? 'Notifications Active! Click to test alert'
                : 'Enable girlfriend push notifications'
            }
            aria-label="Phone Notifications"
          >
            {pushSubscribed ? <BellRing size={19} /> : <Bell size={19} />}
            <span className="social-fab__tooltip">Alerts</span>
          </button>

          {/* 9. Memory Inspector (Brain & RAG vectors - password gated) */}
          <button
            className={`social-fab__button memory ${currentPath === '/memory' ? 'active' : ''}`}
            style={{ '--index': 8 }}
            onClick={() => handleFabAction(handleOpenMemory)}
            title="Memory Inspector (Brain & RAG memories)"
            aria-label="Memory Inspector"
          >
            <Brain size={19} />
            <span className="social-fab__tooltip">Memory</span>
          </button>

          {/* 10. Admin Access Portal (only visible to authorized admin accounts) */}
          {isAdminEmail(authUser?.email) && (
            <button
              className={`social-fab__button admin ${isAdminPortalOpen ? 'active' : ''}`}
              style={{ '--index': 9 }}
              onClick={() => handleFabAction(() => setIsAdminPortalOpen(true))}
              title="Admin Portal (Whitelist & Users)"
              aria-label="Admin Access Portal"
            >
              <ShieldCheck size={19} />
              <span className="social-fab__tooltip">Admin</span>
            </button>
          )}
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
        isOpen={isWallpaperPickerOpen}
        onClose={() => setIsWallpaperPickerOpen(false)}
        background={background}
        onApply={setBackground}
      />

      <VRMPicker
        isOpen={isAvatarPickerOpen}
        onClose={() => setIsAvatarPickerOpen(false)}
        activeId={activeVrmId}
        onSelect={(id) => setActiveVrmId(id)}
        onOpenStudio={() => setIsAvatarStudioOpen(true)}
      />

      <AdminPortal
        isOpen={isAdminPortalOpen}
        onClose={() => setIsAdminPortalOpen(false)}
        adminEmail={authUser?.email}
        onOpenMemory={() => {
          setIsAdminPortalOpen(false);
          handleOpenMemory();
        }}
      />

      <AlarmModal
        isOpen={isAlarmModalOpen}
        onClose={() => setIsAlarmModalOpen(false)}
        activeVrmId={activeVrmId}
        onPlayAlarmAudio={(url) => playUrl(url)}
      />

      <AvatarStudioModal
        isOpen={isAvatarStudioOpen}
        onClose={() => setIsAvatarStudioOpen(false)}
        activeAvatarName={BUNDLED_AVATARS.find((a) => a.id === activeVrmId)?.name || 'Custom Model'}
        customization={avatarCustomization}
        onChangeCustomization={handleCustomizationChange}
        onReset={handleResetCustomization}
      />



      <MemoryPasswordModal
        isOpen={isMemoryPasswordModalOpen}
        onClose={() => setIsMemoryPasswordModalOpen(false)}
        onSuccess={() => {
          setIsMemoryPasswordModalOpen(false);
          navigateTo('/memory');
        }}
      />

      {/* RAG Memory Inspector Route: /memory (Passcode protected: Daksh@2009) */}
      {currentPath === '/memory' && (
        (() => {
          let isUnlocked = false;
          try {
            isUnlocked = sessionStorage.getItem('waguri_memory_unlocked') === 'true';
          } catch {}

          if (isUnlocked) {
            return (
              <MemoryInspector
                onBack={() => navigateTo('/')}
                currentUserId={authUser?.email || 'local-user'}
              />
            );
          }

          return (
            <MemoryPasswordModal
              isOpen={true}
              onClose={() => navigateTo('/')}
              onSuccess={() => {
                // Trigger re-render to view MemoryInspector
                setCurrentPath('/memory');
              }}
            />
          );
        })()
      )}
    </div>
  );
}
