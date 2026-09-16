import { useCallback, useEffect, useRef, useState } from 'react';
import { speechToText } from './api.js';

// Real-time voice input engine with dual support:
// 1. Web Speech API (streaming, instant, bilingual en-IN/hi-IN).
// 2. AudioContext + AnalyserNode (real-time mic volume level meter & acoustic VAD).
// 3. MediaRecorder + Groq Whisper /api/stt fallback (for Firefox/Brave or network errors).
// 4. Auto-restart resilience: recreates SpeechRecognition cleanly to prevent Chromium stalls.
// 5. Silence detection: commits interim transcripts after natural pauses so no voice is lost.
// 6. Turn-taking pause: suspends mic when avatar is speaking to prevent speaker echo & self-loops.
export function useVoiceInput({ onFinalTranscript, onSpeechStart, enabled, paused = false, lang }) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false); // acoustic sound detected
  const [volumeLevel, setVolumeLevel] = useState(0); // 0 to 100% volume
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

  const wantListeningRef = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const sendQueueRef = useRef(Promise.resolve());
  const pendingTextRef = useRef('');
  const silenceTimerRef = useRef(null);
  const restartTimerRef = useRef(null);
  const hadSoundInUtteranceRef = useRef(false);
  const silenceStartRef = useRef(null);
  const useFallbackRef = useRef(false);

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
    if (!trimmed) return;
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

  // Start mic stream & Web Audio analyser for live acoustic volume meter
  const startAudioCapture = useCallback(async () => {
    if (!mediaSupported) return null;
    if (streamRef.current && streamRef.current.active) return streamRef.current;

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
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let speakingDecayTimer = null;
        const VAD_THRESHOLD = 26; // Voice activity detection threshold (above room ambient noise)

        const pollVolume = () => {
          if (!wantListeningRef.current || pausedRef.current) {
            setVolumeLevel(0);
            setIsSpeaking(false);
            if (wantListeningRef.current && pausedRef.current) {
              animFrameRef.current = requestAnimationFrame(pollVolume);
            }
            return;
          }

          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length;
          // Scale to 0..100%
          const vol = Math.min(100, Math.round((avg / 55) * 100));
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
                // Stopped talking in fallback mode -> stop current recording to trigger transcription
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

  // Clean up existing SpeechRecognition instance
  const destroyRecognition = useCallback(() => {
    if (recRef.current) {
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
  }, []);

  // Fallback recorder runner
  const startFallbackRecording = useCallback(async () => {
    const stream = streamRef.current || (await startAudioCapture());
    if (!stream) return;

    try {
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderChunksRef.current = [];

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recorderChunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        const chunks = recorderChunksRef.current;
        recorderChunksRef.current = [];
        if (!chunks.length) return;
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        if (blob.size < 1800) return; // too small, pure silence

        setIsProcessing(true);
        try {
          const res = await speechToText(blob, langRef.current);
          if (res?.text) {
            dispatchTranscript(res.text);
          }
        } catch (e) {
          console.warn('[voice fallback] STT error:', e);
          setVoiceError(`Voice transcription error: ${e.message}`);
        } finally {
          setIsProcessing(false);
          // Restart recording for next phrase if still listening
          if (wantListeningRef.current && useFallbackRef.current) {
            setTimeout(() => {
              if (wantListeningRef.current && useFallbackRef.current) {
                startFallbackRecording();
              }
            }, 300);
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
  const startRecognition = useCallback(async () => {
    if (useFallbackRef.current || !webSpeechSupported) {
      useFallbackRef.current = true;
      startFallbackRecording();
      return;
    }

    destroyRecognition();

    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.lang = langRef.current || 'en-IN';

      rec.onstart = () => {
        setIsListening(true);
        setVoiceError(null);
      };

      rec.onspeechstart = () => {
        if (pausedRef.current) return;
        cbsRef.current.onSpeechStart?.(); // barge-in hook on real speech
      };

      rec.onresult = (event) => {
        if (pausedRef.current) {
          // Avatar is currently speaking or generating — ignore speaker echoes!
          return;
        }

        let finalChunk = '';
        let interimChunk = '';

        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          const text = res[0]?.transcript || '';
          if (res.isFinal) {
            finalChunk += text + ' ';
          } else {
            interimChunk += text;
          }
        }

        const combined = (finalChunk + interimChunk).trim();
        setInterim(combined);
        pendingTextRef.current = combined;

        // Reset silence debounce timer: commits speech ~1.2s after user stops talking
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          if (!pausedRef.current && pendingTextRef.current && pendingTextRef.current.trim().length > 0) {
            const toSend = pendingTextRef.current.trim();
            pendingTextRef.current = '';
            setInterim('');
            // Disarm recognition session immediately so no trailing noises or echoes are picked up
            destroyRecognition();
            setIsListening(false);
            dispatchTranscript(toSend);
          }
        }, 1200);
      };

      rec.onerror = (event) => {
        if (event.error === 'no-speech') {
          // Normal pause in speech — continuous mode keeps listening
          return;
        }
        if (event.error === 'aborted') {
          return;
        }
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setVoiceError('Microphone permission denied — please allow microphone access.');
          wantListeningRef.current = false;
          setIsListening(false);
          return;
        }
        if (event.error === 'network') {
          console.warn('[voice] Web Speech API network error, switching to high-accuracy Groq Whisper fallback.');
          useFallbackRef.current = true;
          destroyRecognition();
          startFallbackRecording();
          return;
        }
        console.warn('[voice] Speech recognition warning:', event.error);
      };

      rec.onend = () => {
        if (pausedRef.current) {
          setIsListening(false);
          setInterim('');
          return;
        }

        // If there is pending speech that didn't get committed before Chrome ended, commit it now
        if (pendingTextRef.current && pendingTextRef.current.trim().length > 0) {
          const toSend = pendingTextRef.current.trim();
          pendingTextRef.current = '';
          setInterim('');
          destroyRecognition();
          setIsListening(false);
          dispatchTranscript(toSend);
          return;
        }

        // Restart cleanly with fresh instance after a short pause if user still wants listening and not paused
        if (wantListeningRef.current && !pausedRef.current) {
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => {
            if (wantListeningRef.current && !pausedRef.current) {
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
      console.warn('[voice] SpeechRecognition start failed, switching to fallback:', e);
      useFallbackRef.current = true;
      startFallbackRecording();
    }
  }, [webSpeechSupported, destroyRecognition, startFallbackRecording, dispatchTranscript]);

  const start = useCallback(async () => {
    if (!supported) return;
    setVoiceError(null);
    wantListeningRef.current = true;

    // Acquire audio stream and start volume meter
    await startAudioCapture();

    // Start recognition engine
    if (useFallbackRef.current) {
      startFallbackRecording();
    } else {
      startRecognition();
    }
  }, [supported, startAudioCapture, startRecognition, startFallbackRecording]);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);

    // If there is any pending transcript, send it before stopping
    if (pendingTextRef.current && pendingTextRef.current.trim().length > 0) {
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
  }, [destroyRecognition, stopAudioCapture, dispatchTranscript]);

  // Suspend listening temporarily while avatar is speaking or generating
  const pauseListening = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    pendingTextRef.current = '';
    setInterim('');
    setVolumeLevel(0);
    setIsSpeaking(false);
    setIsListening(false);
    destroyRecognition();
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    }
  }, [destroyRecognition]);

  // Language switch: update lang on active engine
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
      start();
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
    resetError: () => setVoiceError(null),
  };
}
