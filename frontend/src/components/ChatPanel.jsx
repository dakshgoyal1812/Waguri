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
  activeAudioUrl,
  isPlayingAudio,
  persona,
  micSupported = false,
  isListening = false,
  interim = '',
  voiceError = null,
  handsFree = false,
  onToggleMic = () => {},
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
                    onClick={() => onPlayAudio(msg.audio_url, msg.emotion, msg.content)}
                    title="Play voice audio"
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
          <div className="thinking-line" aria-live="polite">
            <span className="thinking-name">{persona?.name || 'Waguri'}</span>
            {THINKING_LINES[thinkingIdx % THINKING_LINES.length]}
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
              className={`mic-btn ${handsFree ? 'active' : ''}`}
              onClick={onToggleMic}
              title={handsFree ? 'Hands-free voice ON — speak anytime' : 'Enable hands-free voice'}
              aria-label="Toggle hands-free voice"
            >
              {handsFree ? <Mic size={16} /> : <MicOff size={16} />}
            </button>
          )}
          <input
            type="text"
            className="chat-input"
            placeholder="Say something..."
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

        {(isListening || interim) && (
          <div className="voice-caption" role="status">
            <span className="voice-caption-label">🎤 {isListening ? 'listening…' : ''}</span>
            {interim && <span className="voice-caption-text">{interim}</span>}
          </div>
        )}
        {voiceError && (
          <div className="voice-caption" role="alert" style={{ color: '#f87171' }}>{voiceError}</div>
        )}
      </div>
    </div>
  );
}
