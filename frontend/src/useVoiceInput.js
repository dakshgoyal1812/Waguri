import { useCallback, useEffect, useRef, useState } from 'react';

// Real-time voice input via the Web Speech API (Chrome/Edge; free, streams interim
// results). Hands-free: listens continuously, auto-sends each finished utterance,
// and restarts itself. Barge-in: onStart fires the moment the user begins talking
// so the app can duck her audio. Fallback path (recorded blob -> /api/stt) lives
// in the component, not here — this hook only handles the live recognition engine.
export function useVoiceInput({ onFinalTranscript, onSpeechStart, enabled, lang }) {
  const [isListening, setIsListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [voiceError, setVoiceError] = useState(null);
  const recRef = useRef(null);
  const wantListeningRef = useRef(false);
  const busyRef = useRef(false); // a final transcript is being processed
  const langRef = useRef(lang);
  langRef.current = lang; // applied on every (re)start — bilingual EN/Hinglish/Hindi
  const cbsRef = useRef({ onFinalTranscript, onSpeechStart });
  cbsRef.current = { onFinalTranscript, onSpeechStart };

  const supported = typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition) != null;

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    setIsListening(false);
    setInterim('');
  }, []);

  const start = useCallback(() => {
    if (!supported) return;
    setVoiceError(null);
    try {
      if (!recRef.current) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';

        rec.onstart = () => {
          setIsListening(true);
          cbsRef.current.onSpeechStart?.(); // barge-in hook
        };
        rec.onresult = (event) => {
          let interimText = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const r = event.results[i];
            if (r.isFinal) {
              const text = r[0].transcript.trim();
              if (text && !busyRef.current) {
                busyRef.current = true;
                cbsRef.current.onFinalTranscript(text).finally(() => { busyRef.current = false; });
              }
            } else {
              interimText += r[0].transcript;
            }
          }
          setInterim(interimText);
        };
        rec.onerror = (event) => {
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            setVoiceError('Microphone permission denied — allow mic access to talk to her.');
            wantListeningRef.current = false;
            setIsListening(false);
          } else if (event.error === 'no-speech') {
            // harmless: continuous mode just keeps listening
          } else {
            setVoiceError(`Voice input error: ${event.error}`);
          }
        };
        rec.onend = () => {
          // Chrome stops the engine after pauses; hands-free mode restarts it.
          if (wantListeningRef.current) {
            try { rec.start(); } catch { /* start races stop — next onend retries */ }
          } else {
            setIsListening(false);
          }
        };
        recRef.current = rec;
      }
      wantListeningRef.current = true;
      recRef.current.lang = langRef.current || navigator.language || 'en-US';
      recRef.current.start();
    } catch (e) {
      setVoiceError(`Could not start voice input: ${e.message}`);
    }
  }, [supported]);

  // Language switch while live: restart the engine with the new recognition
  // language (en-IN handles Hinglish; hi-IN for Hindi).
  useEffect(() => {
    if (wantListeningRef.current && recRef.current) {
      try {
        recRef.current.stop(); // onend restarts with the updated lang
      } catch { /* engine already stopped */ }
    }
  }, [lang]);

  // Toggling `enabled` from outside controls hands-free mode.
  useEffect(() => {
    if (enabled) start();
    else stop();
  }, [enabled, start, stop]);

  useEffect(() => () => {
    wantListeningRef.current = false;
    try { recRef.current?.abort(); } catch { /* engine gone */ }
  }, []);

  return { supported, isListening, interim, voiceError, start, stop };
}
