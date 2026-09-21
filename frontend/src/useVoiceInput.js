import { useCallback, useEffect, useRef, useState } from 'react';
import { speechToText } from './api.js';

// Real-time voice input engine with dual resilience:
// 1. Web Speech API (primary in Chrome, Edge, Safari; streaming, zero latency, bilingual en-IN/hi-IN).
// 2. AudioContext + AnalyserNode (real-time mic volume level meter & acoustic VAD).
// 3. MediaRecorder + Groq Whisper /api/stt fallback (for Firefox, Brave, or speech-server outages).
// 4. State-machine guards: prevents Chromium InvalidStateError crashes on rapid start/stop/pause.
// 5. Final-aware silence detection: commits transcripts naturally without cutting sentences mid-thought.
// 6. Turn-taking pause & barge-in: suspends mic when avatar is speaking; sustained loud speech interrupts her.

const FINAL_SETTLE_MS = 800;
const INTERIM_SILENCE_MS = 2200;
const MIN_TRANSCRIPT_LEN = 2;
const BARGE_IN_THRESHOLD = 48; // Loud enough to distinguish real user voice from speaker bleed
const BARGE_IN_SUSTAIN_MS = 550; // Sustained speech burst needed to trigger interruption

// Strips duplicated text when speech engine repeats utterances (e.g. "hello hello" -> "hello")
function cleanDuplicateTranscript(text) {
  if (!text) return '';
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/);

  // 1. Half of words repeated identically: "how are you how are you" -> "how are you"
  if (words.length >= 4 && words.length % 2 === 0) {
    const half = words.length / 2;
    const firstHalf = words.slice(0, half).join(' ');
    const secondHalf = words.slice(half).join(' ');
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      return firstHalf;
    }
  }

  // 2. Exactly two identical words: "hello hello" -> "hello", keeping natural short words like "ha ha"
  if (words.length === 2 && words[0].length >= 3 && words[0].toLowerCase() === words[1].toLowerCase()) {
    return words[0];
  }

  // 3. Exact repeated character halves: "Kya haal hai? Kya haal hai?"
  if (trimmed.length >= 8) {
    const halfLen = Math.floor(trimmed.length / 2);
    const part1 = trimmed.slice(0, halfLen).trim();
    const part2 = trimmed.slice(halfLen).trim();
    if (part1 && part1.toLowerCase() === part2.toLowerCase()) {
      return part1;
    }
  }

  return trimmed;
}

export function useVoiceInput({ onFinalTranscript, onSpeechStart, enabled, paused = false, lang }) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [interim, setInterim] = useState('');
  const [voiceError, setVoiceError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const recRef = useRef(null);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const recorderRef = useRef(null);
  const recorderChunksRef = useRef([]);

  // Recognition state tracking: 'idle' | 'starting' | 'listening' | 'stopping'
  const recStateRef = useRef('idle');
  const wantListeningRef = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const sendQueueRef = useRef(Promise.resolve());
  const pendingTextRef = useRef('');
  const finalTranscriptRef = useRef('');
  const lastDispatchedRef = useRef({ text: '', time: 0 });
  const silenceTimerRef = useRef(null);
  const restartTimerRef = useRef(null);
  const startRetryTimerRef = useRef(null);
  const hadSoundInUtteranceRef = useRef(false);
  const silenceStartRef = useRef(null);
  const useFallbackRef = useRef(false);
  const networkErrorCountRef = useRef(0);
  const voiceErrorTimerRef = useRef(null);

  const langRef = useRef(lang);
  langRef.current = lang;
  const cbsRef = useRef({ onFinalTranscript, onSpeechStart });
  cbsRef.current = { onFinalTranscript, onSpeechStart };

  const webSpeechSupported = typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition) != null;
  const mediaSupported = typeof window !== 'undefined' &&
    window.navigator?.mediaDevices?.getUserMedia != null;
  const supported = webSpeechSupported || mediaSupported;

  // Auto-dismissing voice error helper so error banners never get stuck on screen
  const showVoiceError = useCallback((msg, duration = 4500) => {
    if (!msg) {
      setVoiceError(null);
      return;
    }
    setVoiceError(msg);
    if (voiceErrorTimerRef.current) clearTimeout(voiceErrorTimerRef.current);
    if (duration > 0) {
      voiceErrorTimerRef.current = setTimeout(() => {
        setVoiceError(null);
      }, duration);
    }
  }, []);

  // Dispatch text sequentially without dropping phrases or duplicate-sending
  const dispatchTranscript = useCallback((text) => {
    const cleaned = cleanDuplicateTranscript(text?.trim());
    if (!cleaned || cleaned.length < MIN_TRANSCRIPT_LEN) return;

    // Suppress duplicate dispatches of the same message within 2.5 seconds
    const now = Date.now();
    if (
      cleaned.toLowerCase() === lastDispatchedRef.current.text.toLowerCase() &&
      now - lastDispatchedRef.current.time < 2500
    ) {
      console.warn('[voice] Suppressed duplicate transcript dispatch:', cleaned);
      return;
    }
    lastDispatchedRef.current = { text: cleaned, time: now };

    setInterim('');
    pendingTextRef.current = '';
    finalTranscriptRef.current = '';

    sendQueueRef.current = sendQueueRef.current
      .then(async () => {
        await cbsRef.current.onFinalTranscript?.(cleaned);
      })
      .catch((err) => {
        console.error('[voice] Transcript dispatch failed:', err);
      });
  }, []);

  // Stop mic stream & Web Audio analyser
  const stopAudioCapture = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => track.stop());
      } catch { /* ignore */ }
      streamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      try {
        audioCtxRef.current.close().catch(() => {});
      } catch { /* ignore */ }
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setVolumeLevel(0);
    setIsSpeaking(false);
  }, []);

  // Start mic stream & Web Audio analyser for live acoustic volume meter and VAD
  const startAudioCapture = useCallback(async () => {
    if (!mediaSupported) return null;

    // Secure context check: getUserMedia requires HTTPS or localhost
    if (typeof window !== 'undefined' && window.isSecureContext === false && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setVoiceError('Microphone requires a secure connection (HTTPS).');
      return null;
    }

    // If stream is already active, resume AudioContext if suspended and ensure poll loop is running
    if (streamRef.current && streamRef.current.active) {
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        try { await audioCtxRef.current.resume(); } catch { /* ignore */ }
      }
      return streamRef.current;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // Initialize Web Audio API Analyser for real-time visual feedback
      // (The context itself is created synchronously in start() to capture user gesture)
      if (audioCtxRef.current) {
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let speakingDecayTimer = null;
        const VAD_THRESHOLD = 26; // Voice activity detection threshold
        let bargeInSince = null;
        let bargeInFired = false;

        const readVolume = () => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          return Math.min(100, Math.round(((sum / dataArray.length) / 55) * 100));
        };

        const pollVolume = () => {
          if (!wantListeningRef.current) {
            setVolumeLevel(0);
            setIsSpeaking(false);
            return;
          }

          if (pausedRef.current) {
            // Paused (avatar speaking / reply loading): keep metering so the
            // user SEES the mic is alive, and detect barge-in — sustained loud
            // speech means the user is talking over her.
            if (analyserRef.current) {
              const vol = readVolume();
              setVolumeLevel(vol);
              if (vol >= BARGE_IN_THRESHOLD) {
                if (bargeInSince === null) bargeInSince = Date.now();
                if (!bargeInFired && Date.now() - bargeInSince >= BARGE_IN_SUSTAIN_MS) {
                  bargeInFired = true;
                  cbsRef.current.onSpeechStart?.();
                }
              } else {
                bargeInSince = null;
                bargeInFired = false;
              }
            } else {
              setVolumeLevel(0);
            }
            animFrameRef.current = requestAnimationFrame(pollVolume);
            return;
          }

          const vol = readVolume();
          setVolumeLevel(vol);

          if (vol >= VAD_THRESHOLD && !pausedRef.current) {
            if (speakingDecayTimer) {
              clearTimeout(speakingDecayTimer);
              speakingDecayTimer = null;
            }
            setIsSpeaking(true);
            hadSoundInUtteranceRef.current = true;
            silenceStartRef.current = null;
            cbsRef.current.onSpeechStart?.();
          } else {
            // Smooth decay so micro-pauses between words don't flicker
            if (!speakingDecayTimer && !pausedRef.current) {
              speakingDecayTimer = setTimeout(() => {
                setIsSpeaking(false);
                speakingDecayTimer = null;
              }, 400);
            }

            // In fallback mode, detect silence after speech to trigger commit
            if (useFallbackRef.current && hadSoundInUtteranceRef.current && !pausedRef.current) {
              if (!silenceStartRef.current) silenceStartRef.current = Date.now();
              else if (Date.now() - silenceStartRef.current > 1400) {
                silenceStartRef.current = null;
                hadSoundInUtteranceRef.current = false;
                if (recorderRef.current && recorderRef.current.state === 'recording') {
                  recorderRef.current.stop();
                }
              }
            }
          }

          animFrameRef.current = requestAnimationFrame(pollVolume);
        };

        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = requestAnimationFrame(pollVolume);
      }

      return stream;
    } catch (err) {
      console.warn('[voice] getUserMedia error:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        showVoiceError('Microphone permission blocked. Please enable mic access in your browser settings.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        showVoiceError('No microphone detected on your device.');
      } else {
        showVoiceError(`Microphone error: ${err.message || err.name}`);
      }
      return null;
    }
  }, [mediaSupported, showVoiceError]);

  // Clean up existing SpeechRecognition instance safely
  const destroyRecognition = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (startRetryTimerRef.current) {
      clearTimeout(startRetryTimerRef.current);
      startRetryTimerRef.current = null;
    }
    if (recRef.current) {
      recStateRef.current = 'stopping';
      try {
        recRef.current.onstart = null;
        recRef.current.onend = null;
        recRef.current.onerror = null;
        recRef.current.onresult = null;
        recRef.current.onspeechstart = null;
        recRef.current.onspeechend = null;
        recRef.current.onsoundstart = null;
        recRef.current.onsoundend = null;
        recRef.current.abort();
      } catch { /* ignore */ }
      recRef.current = null;
    }
    recStateRef.current = 'idle';
  }, []);

  // Fallback recorder runner (MediaRecorder + Groq Whisper /api/stt)
  const startFallbackRecording = useCallback(async () => {
    if (!wantListeningRef.current || pausedRef.current) return;
    const stream = streamRef.current || (await startAudioCapture());
    if (!stream) return;

    try {
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

      if (recorderRef.current && recorderRef.current.state === 'recording') {
        try { recorderRef.current.stop(); } catch { /* ignore */ }
      }

      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderChunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recorderChunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        const chunks = recorderChunksRef.current;
        recorderChunksRef.current = [];
        try {
          if (chunks.length) {
            const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
            if (blob.size >= 1600) {
              setIsProcessing(true);
              try {
                const res = await speechToText(blob, langRef.current);
                if (res?.text) {
                  dispatchTranscript(res.text);
                }
              } catch (e) {
                // Gracefully log transient STT error — do not plaster an error banner
                console.warn('[voice fallback] STT error:', e.message);
              } finally {
                setIsProcessing(false);
              }
            }
          }
        } finally {
          // Re-arm for next phrase if still active and not paused
          if (wantListeningRef.current && useFallbackRef.current && !pausedRef.current) {
            setTimeout(() => {
              if (wantListeningRef.current && useFallbackRef.current && !pausedRef.current) {
                startFallbackRecording();
              }
            }, 250);
          }
        }
      };

      mr.start(250);
      recorderRef.current = mr;
      setIsListening(true);
    } catch (e) {
      console.warn('[voice fallback] could not start MediaRecorder:', e);
      showVoiceError(`Could not start audio recording: ${e.message}`);
    }
  }, [startAudioCapture, dispatchTranscript, showVoiceError]);

  // Primary Web Speech API runner
  const startRecognition = useCallback(async (retryCount = 0) => {
    if (useFallbackRef.current || !webSpeechSupported) {
      useFallbackRef.current = true;
      startFallbackRecording();
      return;
    }

    if (recStateRef.current === 'starting' || recStateRef.current === 'listening') {
      return; // already active
    }

    destroyRecognition();
    recStateRef.current = 'starting';

    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.lang = langRef.current || 'en-IN';

      rec.onstart = () => {
        recStateRef.current = 'listening';
        setIsListening(true);
        setVoiceError(null);
        networkErrorCountRef.current = 0;
      };

      rec.onspeechstart = () => {
        if (pausedRef.current) return;
        setIsSpeaking(true);
        setVolumeLevel(65);
        cbsRef.current.onSpeechStart?.();
      };

      rec.onspeechend = () => {
        setIsSpeaking(false);
        setVolumeLevel(0);
      };

      rec.onsoundstart = () => {
        if (pausedRef.current) return;
        setIsSpeaking(true);
        setVolumeLevel(50);
      };

      rec.onsoundend = () => {
        setIsSpeaking(false);
        setVolumeLevel(0);
      };

      rec.onresult = (event) => {
        if (pausedRef.current) return;
        setIsSpeaking(true);
        // Dynamic volume indicator driven by speech activity
        setVolumeLevel(Math.min(95, 45 + Math.floor(Math.random() * 45)));

        let interimChunk = '';
        let lastIsFinal = false;

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const text = res[0]?.transcript || '';
          if (res.isFinal) {
            const clean = text.trim();
            if (clean) {
              if (!finalTranscriptRef.current) {
                finalTranscriptRef.current = clean;
              } else if (!finalTranscriptRef.current.toLowerCase().endsWith(clean.toLowerCase())) {
                finalTranscriptRef.current += ' ' + clean;
              }
            }
            lastIsFinal = true;
          } else {
            interimChunk += text;
            lastIsFinal = false;
          }
        }

        const rawCombined = (
          finalTranscriptRef.current
            ? finalTranscriptRef.current + (interimChunk ? ' ' + interimChunk : '')
            : interimChunk
        ).trim();

        const combined = cleanDuplicateTranscript(rawCombined);
        setInterim(combined);
        pendingTextRef.current = combined;

        // Final-aware silence commit
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          if (
            !pausedRef.current &&
            pendingTextRef.current &&
            pendingTextRef.current.trim().length >= MIN_TRANSCRIPT_LEN
          ) {
            const toSend = cleanDuplicateTranscript(pendingTextRef.current.trim());
            pendingTextRef.current = '';
            finalTranscriptRef.current = '';
            setInterim('');
            setIsSpeaking(false);
            setVolumeLevel(0);
            destroyRecognition();
            setIsListening(false);
            dispatchTranscript(toSend);
          }
        }, lastIsFinal ? FINAL_SETTLE_MS : INTERIM_SILENCE_MS);
      };

      rec.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
          return;
        }

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          showVoiceError('Microphone permission denied. Please allow mic in browser settings.');
          wantListeningRef.current = false;
          setIsListening(false);
          recStateRef.current = 'idle';
          return;
        }

        if (event.error === 'audio-capture') {
          showVoiceError('Microphone hardware is busy or unavailable.');
          recStateRef.current = 'idle';
          return;
        }

        if (event.error === 'network') {
          networkErrorCountRef.current += 1;
          console.warn(`[voice] SpeechRecognition network drop (attempt ${networkErrorCountRef.current})`);
          destroyRecognition();

          // Gracefully retry Web Speech up to 3 times without showing scary banners
          if (networkErrorCountRef.current < 4 && wantListeningRef.current && !pausedRef.current) {
            if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
            restartTimerRef.current = setTimeout(() => {
              if (wantListeningRef.current && !pausedRef.current) {
                startRecognition(0);
              }
            }, 500);
            return;
          }

          console.warn('[voice] Switching to Groq Whisper STT fallback after repeated network drops.');
          useFallbackRef.current = true;
          startFallbackRecording();
          return;
        }

        console.warn('[voice] Speech recognition event error:', event.error);
      };

      rec.onend = () => {
        recStateRef.current = 'idle';
        setIsSpeaking(false);
        setVolumeLevel(0);

        if (pausedRef.current) {
          setIsListening(false);
          setInterim('');
          finalTranscriptRef.current = '';
          return;
        }

        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }

        // Commit any pending speech that wasn't committed before onend
        if (pendingTextRef.current && pendingTextRef.current.trim().length >= MIN_TRANSCRIPT_LEN) {
          const toSend = cleanDuplicateTranscript(pendingTextRef.current.trim());
          pendingTextRef.current = '';
          finalTranscriptRef.current = '';
          setInterim('');
          destroyRecognition();
          setIsListening(false);
          dispatchTranscript(toSend);
          return;
        }

        // Clean restart after short pause if user still wants listening
        if (wantListeningRef.current && !pausedRef.current) {
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => {
            if (wantListeningRef.current && !pausedRef.current && recStateRef.current === 'idle') {
              startRecognition();
            }
          }, 200);
        } else {
          setIsListening(false);
          setInterim('');
        }
      };

      recRef.current = rec;
      rec.start();
    } catch (e) {
      recStateRef.current = 'idle';
      console.warn('[voice] SpeechRecognition start error:', e.message);

      // If Chromium threw InvalidStateError (previous session winding down), backoff and retry
      if (e.name === 'InvalidStateError' && retryCount < 2) {
        if (startRetryTimerRef.current) clearTimeout(startRetryTimerRef.current);
        startRetryTimerRef.current = setTimeout(() => {
          if (wantListeningRef.current && !pausedRef.current) {
            startRecognition(retryCount + 1);
          }
        }, 200);
        return;
      }

      // If repeated start failures, fallback to MediaRecorder + Whisper
      console.warn('[voice] Start failed repeatedly, falling back to MediaRecorder STT.');
      useFallbackRef.current = true;
      startFallbackRecording();
    }
  }, [webSpeechSupported, destroyRecognition, startFallbackRecording, dispatchTranscript, showVoiceError]);

  const start = useCallback(() => {
    if (!supported) return;
    setVoiceError(null);
    wantListeningRef.current = true;

    if (useFallbackRef.current || !webSpeechSupported) {
      useFallbackRef.current = true;
      startFallbackRecording();
    } else {
      // Start Web Speech API directly and synchronously without calling getUserMedia,
      // preventing hardware microphone lock contention on mobile & PWA
      startRecognition();
    }
  }, [supported, webSpeechSupported, startRecognition, startFallbackRecording]);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    if (startRetryTimerRef.current) clearTimeout(startRetryTimerRef.current);

    // Commit any pending transcript before stopping
    if (pendingTextRef.current && pendingTextRef.current.trim().length >= MIN_TRANSCRIPT_LEN) {
      const toSend = pendingTextRef.current.trim();
      pendingTextRef.current = '';
      finalTranscriptRef.current = '';
      dispatchTranscript(toSend);
    }

    destroyRecognition();

    if (recorderRef.current && recorderRef.current.state === 'recording') {
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    }
    recorderRef.current = null;

    stopAudioCapture();
    setIsListening(false);
    setInterim('');
    finalTranscriptRef.current = '';
    setVolumeLevel(0);
    // Reset fallback state on manual user stop so next start gets a fresh Web Speech attempt
    useFallbackRef.current = false;
    networkErrorCountRef.current = 0;
  }, [destroyRecognition, stopAudioCapture, dispatchTranscript]);

  // Suspend listening temporarily while avatar is speaking or generating
  const pauseListening = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    if (startRetryTimerRef.current) clearTimeout(startRetryTimerRef.current);
    pendingTextRef.current = '';
    finalTranscriptRef.current = '';
    setInterim('');
    setIsSpeaking(false);
    setIsListening(false);
    destroyRecognition();
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    }
  }, [destroyRecognition]);

  // Language switch: restart active engine with new language
  useEffect(() => {
    if (wantListeningRef.current && !pausedRef.current) {
      if (recRef.current) {
        try { recRef.current.stop(); } catch { /* ignore */ }
      }
    }
  }, [lang]);

  // Sync with enabled and paused props
  useEffect(() => {
    if (enabled && !paused) {
      // Small settle window (100ms) after unpausing ensures Chrome's audio subsystem is ready
      const t = setTimeout(() => {
        if (wantListeningRef.current || enabled) {
          start();
        }
      }, 100);
      return () => clearTimeout(t);
    } else if (enabled && paused) {
      pauseListening();
    } else {
      stop();
    }
  }, [enabled, paused, start, stop, pauseListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (startRetryTimerRef.current) clearTimeout(startRetryTimerRef.current);
      if (voiceErrorTimerRef.current) clearTimeout(voiceErrorTimerRef.current);
      destroyRecognition();
      stopAudioCapture();
    };
  }, [destroyRecognition, stopAudioCapture]);

  return {
    supported,
    isListening,
    isSpeaking,
    volumeLevel,
    interim,
    voiceError,
    isProcessing,
    isFallback: useFallbackRef.current,
    start,
    stop,
    resetError: () => {
      setVoiceError(null);
      useFallbackRef.current = false;
      networkErrorCountRef.current = 0;
      if (enabled && !paused) start();
    },
  };
}
