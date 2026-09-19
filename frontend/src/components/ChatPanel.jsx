import React, { useState, useRef, useEffect } from 'react';
import { Send, Volume2, MessageCircle, Clock, Database, Mic, MicOff } from 'lucide-react';

const SUGGESTIONS = [
  'What bakery sweets do you recommend today? 🍰',
  'Tell me about your school life in Delhi! 📚',
  'Do you want to play Mario Kart together? 🎮',
  'How did you and Daksh meet? ✨',
];

// airi-style contextual thinking lines, rotated while she is generating
const THINKING_LINES = [
  'Crafting an empathetic response…',
  'Thinking of what to say…',
  'Choosing the perfect words…',
  'Feeling the mood of the moment…',
  'Remembering what matters here…',
];

const EMOTION_EMOJIS = {
  happy: '😊',
  angry: '😠',
  sad: '😔',
  surprised: '😲',
  relaxed: '😌',
  neutral: '😐',
  // mood-engine extras (from the moods table)
  excited: '🤩',
  curious: '🤔',
  playful: '😜',
};

export default function ChatPanel({
  messages,
  onSendMessage,
  isLoading,
  onPlayAudio,
  onStopAudio = () => {},
  activeAudioUrl,
  isPlayingAudio,
  persona,
  micSupported = false,
  isListening = false,
  isSpeaking = false,
  volumeLevel = 0,
  isProcessing = false,
  interim = '',
  voiceError = null,
  handsFree = false,
  onToggleMic = () => {},
  onResetVoiceError = () => {},
}) {
  const [inputText, setInputText] = useState('');
  const [thinkingIdx, setThinkingIdx] = useState(0);
  const messagesEndRef = useRef(null);

  // rotate the contextual thinking line while she generates
  useEffect(() => {
    if (!isLoading) return;
    setThinkingIdx((i) => (i + 1) % THINKING_LINES.length);
    const t = setInterval(() => setThinkingIdx((i) => (i + 1) % THINKING_LINES.length), 2200);
    return () => clearInterval(t);
  }, [isLoading]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSubmit = (e) => {
    e?.preventDefault();
    const text = inputText.trim();
    if (!text || isLoading) return;
    setInputText('');
    onSendMessage(text);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="chat-section">
      {/* Header */}
      <div className="chat-header">
        <div className="persona-mini-card">
          <div className="persona-avatar-sm">W</div>
          <div className="persona-meta">
            <h2>{persona?.name || 'Waguri'}</h2>
            <p>{persona?.location || 'Delhi, India'} • {persona?.personality_traits?.[0] || '148cm cute student'}</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              gap: '12px',
              padding: '20px',
            }}
          >
            <div
              style={{
                width: '54px',
                height: '54px',
                borderRadius: '50%',
                background: 'rgba(244, 114, 182, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-pink)',
              }}
            >
              <MessageCircle size={26} />
            </div>
            <div>
              <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Say hello to Waguri!
              </p>
              <p style={{ fontSize: '0.8rem' }}>
                She remembers your conversations with RAG long-term memory.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isUser = msg.role === 'user';
          const isPlayingThis = activeAudioUrl === msg.audio_url && isPlayingAudio;
          const emotion = msg.emotion || 'neutral';
          const emoji = EMOTION_EMOJIS[emotion] || '🌸';

          return (
            <div key={idx} className={`message-bubble-wrapper ${isUser ? 'user' : 'assistant'}`}>
              <div className="message-meta">
                <span>{isUser ? 'You' : persona?.name || 'Waguri'}</span>
                {!isUser && msg.emotion && (
                  <span className="emotion-tag">
                    {emoji} {emotion}
                  </span>
                )}
                {!isUser && msg.latency_ms && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                    <Clock size={10} /> {msg.latency_ms}ms
                  </span>
                )}
                {!isUser && msg.memories_used > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: 'var(--accent-purple)' }}>
                    <Database size={10} /> {msg.memories_used} mem
                  </span>
                )}
              </div>

              <div className="message-bubble">{msg.content}</div>

              {/* Every reply can be voiced: if the stored audio URL died (backend
                  restart), App re-synthesizes it from the message text. */}
              {!isUser && (
                <div className="audio-controls-row">
                  <button
                    className="audio-play-btn"
                    onClick={() => {
                      if (isPlayingThis) {
                        onStopAudio?.();
                      } else {
                        onPlayAudio(msg.audio_url, msg.emotion, msg.content);
                      }
                    }}
                    title={isPlayingThis ? 'Click to stop speaking' : 'Play voice audio'}
                  >
                    <Volume2 size={13} style={{ animation: isPlayingThis ? 'pulse 1s infinite' : 'none' }} />
                    <span>{isPlayingThis ? 'Speaking...' : 'Play Voice'}</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {isLoading && (
          <div className="message-bubble-wrapper assistant chat-heart-loading-wrapper" aria-live="polite">
            <div className="message-meta">
              <span>{persona?.name || 'Waguri'}</span>
              <span className="thinking-text">{THINKING_LINES[thinkingIdx % THINKING_LINES.length]}</span>
            </div>
            <div className="message-bubble chat-heart-bubble">
              <svg
                className="heart"
                viewBox="-5 -5 278 56"
                version="1.1"
                id="svg5"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <filter id="blur">
                    <feGaussianBlur stdDeviation="1.6" />
                  </filter>
                </defs>
                <g transform="translate(29.1 -127.42)" id="layer1">
                  <path
                    pathLength="1"
                    d="M-28.73 167.2c26.43 9.21 68.46-9.46 85.45-12.03 18.45-2.78 32.82 4.86 28.75 9.83-3.82 4.66-25.77-21.18-14.81-31.5 9.54-8.98 17.64 10.64 16.42 17.06-1.51-6.2 2.95-26.6 14.74-22.11 11.7 4.46-4.33 49.03-15.44 44.08-6.97-3.1 15.44-16.26 26.1-16 23.03.56 55.6 27.51 126.63 3.36"
                    id="line"
                  />
                </g>
                <g transform="translate(29.1 -127.42)" id="layer2">
                  <path
                    pathLength="1"
                    d="M-28.73 167.2c26.43 9.21 68.46-9.46 85.45-12.03 18.45-2.78 32.82 4.86 28.75 9.83-3.82 4.66-25.77-21.18-14.81-31.5 9.54-8.98 17.64 10.64 16.42 17.06-1.51-6.2 2.95-26.6 14.74-22.11 11.7 4.46-4.33 49.03-15.44 44.08-6.97-3.1 15.44-16.26 26.1-16 23.03.56 55.6 27.51 126.63 3.36"
                    id="point"
                    filter="url(#blur)"
                  />
                </g>
              </svg>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts & Input */}
      <div className="chat-input-area">
        <div className="quick-prompts">
          {SUGGESTIONS.map((item, idx) => (
            <button
              key={idx}
              className="quick-pill"
              onClick={() => onSendMessage(item)}
              disabled={isLoading}
            >
              {item}
            </button>
          ))}
        </div>

        <form className="input-bar" onSubmit={handleSubmit}>
          {micSupported && (
            <button
              type="button"
              className={`mic-btn ${handsFree ? 'active' : ''} ${isSpeaking ? 'speaking' : ''}`}
              onClick={onToggleMic}
              title={
                voiceError
                  ? `${voiceError} (click to retry)`
                  : handsFree
                  ? isSpeaking
                    ? 'Hearing your voice…'
                    : 'Hands-free voice ON — speak anytime (click to turn off)'
                  : 'Enable microphone to talk to her'
              }
              aria-label="Toggle voice input"
            >
              {handsFree ? <Mic size={16} /> : <MicOff size={16} />}
            </button>
          )}
          <input
            type="text"
            className="chat-input"
            placeholder={isListening ? 'Listening… or type a message' : 'Say something…'}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={!inputText.trim() || isLoading}
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </form>

        {(isPlayingAudio || isListening || interim || isProcessing) && (
          <div className="voice-caption" role="status">
            <div className="voice-caption-indicator">
              <span className={`voice-dot ${isPlayingAudio ? 'speaking' : isSpeaking ? 'active' : ''}`} />
              <span className="voice-caption-label">
                {isPlayingAudio
                  ? `${persona?.name || 'Waguri'} is speaking…`
                  : isProcessing
                  ? 'Transcribing…'
                  : isSpeaking
                  ? 'Hearing your voice…'
                  : 'Mic active — speak anytime'}
              </span>
            </div>
            {isListening && !isPlayingAudio && (
              <div className="mic-volume-bars" title={`Volume: ${volumeLevel}%`}>
                <span style={{ height: `${Math.max(4, Math.min(14, (volumeLevel / 100) * 14))}px` }} />
                <span style={{ height: `${Math.max(4, Math.min(18, (volumeLevel / 100) * 18))}px` }} />
                <span style={{ height: `${Math.max(4, Math.min(14, (volumeLevel / 100) * 14))}px` }} />
              </div>
            )}
            {interim && <span className="voice-caption-text">"{interim}"</span>}
          </div>
        )}
        {voiceError && (
          <div className="voice-caption voice-error" role="alert">
            <span>⚠️ {voiceError}</span>
            <button
              type="button"
              className="voice-error-dismiss"
              onClick={onResetVoiceError}
              title="Dismiss error"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
