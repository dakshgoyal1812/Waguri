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
  const silenceTimerRef = useRef(null);
  const restartTimerRef = useRef(null);
  const startRetryTimerRef = useRef(null);
  const hadSoundInUtteranceRef = useRef(false);
  const silenceStartRef = useRef(null);
  const useFallbackRef = useRef(false);
  const networkErrorCountRef = useRef(0);

  const langRef = useRef(lang);
  langRef.current = lang;
  const cbsRef = useRef({ onFinalTranscript, onSpeechStart });
  cbsRef.current = { onFinalTranscript, onSpeechStart };

  const webSpeechSupported = typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition) != null;
  const mediaSupported = typeof window !== 'undefined' &&
    window.navigator?.mediaDevices?.getUserMedia != null;
  const supported = webSpeechSupported || mediaSupported;

  // Dispatch text sequentially without dropping phrases
  const dispatchTranscript = useCallback((text) => {
    const trimmed = text?.trim();
    if (!trimmed || trimmed.length < MIN_TRANSCRIPT_LEN) return;
    setInterim('');
    pendingTextRef.current = '';
    sendQueueRef.current = sendQueueRef.current
      .then(async () => {
        await cbsRef.current.onFinalTranscript?.(trimmed);
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
        setVoiceError('Microphone permission blocked. Please click the lock or camera icon in your address bar to allow mic access.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setVoiceError('No microphone detected on your device.');
      } else {
        setVoiceError(`Microphone error: ${err.message || err.name}`);
      }
      return null;
    }
  }, [mediaSupported]);

  // Clean up existing SpeechRecognition instance safely
  const destroyRecognition = useCallback(() => {
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
                console.warn('[voice fallback] STT error:', e);
                // Non-fatal error; don't brick the session
                setVoiceError(`Voice transcription notice: ${e.message}`);
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
      setVoiceError(`Could not start audio recording: ${e.message}`);
    }
  }, [startAudioCapture, dispatchTranscript]);

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
        networkErrorCountRef.current = 0; // reset error count on successful start
      };

      rec.onspeechstart = () => {
        if (pausedRef.current) return;
        cbsRef.current.onSpeechStart?.();
      };

      rec.onresult = (event) => {
        if (pausedRef.current) return;

        let finalChunk = '';
        let interimChunk = '';
        let lastIsFinal = false;

        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          const text = res[0]?.transcript || '';
          if (res.isFinal) {
            finalChunk += text + ' ';
            lastIsFinal = true;
          } else {
            interimChunk += text;
            lastIsFinal = false;
          }
        }

        const combined = (finalChunk + interimChunk).trim();
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
            const toSend = pendingTextRef.current.trim();
            pendingTextRef.current = '';
            setInterim('');
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
          setVoiceError('Microphone permission denied — please allow microphone access in your browser.');
          wantListeningRef.current = false;
          setIsListening(false);
          recStateRef.current = 'idle';
          return;
        }

        if (event.error === 'audio-capture') {
          setVoiceError('Microphone capture failed. Please check your microphone hardware connection.');
          recStateRef.current = 'idle';
          return;
        }

        if (event.error === 'network') {
          networkErrorCountRef.current += 1;
          console.warn(`[voice] SpeechRecognition network error (attempt ${networkErrorCountRef.current}/3)`);
          destroyRecognition();

          // Transient network error: retry Web Speech up to 2 times before falling back to Whisper
          if (networkErrorCountRef.current < 3 && wantListeningRef.current && !pausedRef.current) {
            if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
            restartTimerRef.current = setTimeout(() => {
              if (wantListeningRef.current && !pausedRef.current) {
                startRecognition(0);
              }
            }, 600);
            return;
          }

          console.warn('[voice] Switching to Groq Whisper STT fallback.');
          useFallbackRef.current = true;
          startFallbackRecording();
          return;
        }

        console.warn('[voice] Speech recognition event error:', event.error);
      };

      rec.onend = () => {
        recStateRef.current = 'idle';

        if (pausedRef.current) {
          setIsListening(false);
          setInterim('');
          return;
        }

        // Commit any pending speech that wasn't committed before onend
        if (pendingTextRef.current && pendingTextRef.current.trim().length >= MIN_TRANSCRIPT_LEN) {
          const toSend = pendingTextRef.current.trim();
          pendingTextRef.current = '';
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
  }, [webSpeechSupported, destroyRecognition, startFallbackRecording, dispatchTranscript]);

  const start = useCallback(() => {
    if (!supported) return;
    setVoiceError(null);
    wantListeningRef.current = true;

    // SYNCHRONOUSLY initialize/resume AudioContext to capture the user gesture on mobile PWAs
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
    }

    if (useFallbackRef.current) {
      startFallbackRecording();
    } else {
      // Web Speech API MUST be started synchronously to inherit the user gesture token on iOS/PWAs
      startRecognition();
      // Fire visual volume meter capture in parallel, provided we didn't instantly fallback
      if (!useFallbackRef.current) {
        startAudioCapture().catch(() => {});
      }
    }
  }, [supported, startAudioCapture, startRecognition, startFallbackRecording]);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    if (startRetryTimerRef.current) clearTimeout(startRetryTimerRef.current);

    // Commit any pending transcript before stopping
    if (pendingTextRef.current && pendingTextRef.current.trim().length >= MIN_TRANSCRIPT_LEN) {
      const toSend = pendingTextRef.current.trim();
      pendingTextRef.current = '';
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
