import React, { useState, useRef, useEffect } from 'react';
import { Send, Phone, Plus, ThumbsUp, ThumbsDown, ChevronDown, PhoneCall } from 'lucide-react';

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
  const [showPrompts, setShowPrompts] = useState(false);
  const [reactions, setReactions] = useState({}); // { [msgIdx]: 'up' | 'down' }
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

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

  const handleScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const isUp = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
    setShowScrollBottom(isUp);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSubmit = (e) => {
    e?.preventDefault();
    const text = inputText.trim();
    if (!text || isLoading) return;
    setInputText('');
    setShowPrompts(false);
    onSendMessage(text);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleReaction = (idx, type) => {
    setReactions((prev) => ({
      ...prev,
      [idx]: prev[idx] === type ? null : type,
    }));
  };

  return (
    <div className="replika-chat-overlay">
      {/* Messages Scroll Area with top gradient fade mask */}
      <div
        className="replika-messages-container"
        ref={messagesContainerRef}
        onScroll={handleScroll}
      >
        {/* Session Timestamp at the top */}
        <div className="session-timestamp">TODAY · COMPANION SESSION</div>

        {/* Safety / System Disclaimer */}
        <div className="system-disclaimer">
          Messages are AI generated · Waguri is your AI companion
        </div>

        {messages.map((msg, idx) => {
          const isUser = msg.role === 'user';
          const isCallMsg = msg.content && (msg.content.includes('Call ended') || msg.content.includes('Voice session'));

          if (isCallMsg) {
            return (
              <div key={idx} className="call-summary-card">
                <PhoneCall size={14} />
                <span>{msg.content}</span>
                <PhoneCall size={14} />
              </div>
            );
          }

          if (isUser) {
            return (
              <div key={idx} className="replika-msg-row user">
                <div className="user-pill-bubble">
                  {msg.content}
                </div>
              </div>
            );
          }

          // Companion Spoken Message: Rendered as plain floating speech text near her
          return (
            <div key={idx} className="replika-msg-row assistant">
              <div className="companion-floating-speech">
                <div className="companion-speech-text">{msg.content}</div>
                {/* Low-opacity reaction buttons */}
                <div className="companion-reactions">
                  <button
                    type="button"
                    className={`reaction-btn ${reactions[idx] === 'up' ? 'active' : ''}`}
                    onClick={() => toggleReaction(idx, 'up')}
                    title="Good response"
                    aria-label="Thumbs up"
                  >
                    <ThumbsUp size={13} />
                  </button>
                  <button
                    type="button"
                    className={`reaction-btn ${reactions[idx] === 'down' ? 'active' : ''}`}
                    onClick={() => toggleReaction(idx, 'down')}
                    title="Bad response"
                    aria-label="Thumbs down"
                  >
                    <ThumbsDown size={13} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="replika-msg-row assistant">
            <div className="companion-floating-speech loading">
              <div className="companion-thinking-label">
                {persona?.name || 'Waguri'} · {THINKING_LINES[thinkingIdx % THINKING_LINES.length]}
              </div>
              <div className="chat-heart-bubble">
                <svg
                  className="heart"
                  viewBox="-5 -5 278 56"
                  version="1.1"
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
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Floating Scroll to Latest Button */}
      {showScrollBottom && (
        <button
          type="button"
          className="scroll-latest-btn"
          onClick={scrollToBottom}
          title="Scroll to latest"
          aria-label="Scroll to latest message"
        >
          <ChevronDown size={18} />
        </button>
      )}

      {/* Quick Prompts Drawer */}
      {showPrompts && (
        <div className="replika-prompts-popover">
          <div className="prompts-header">Quick Topics</div>
          <div className="prompts-list">
            {SUGGESTIONS.map((item, idx) => (
              <button
                key={idx}
                className="prompt-chip"
                onClick={() => {
                  setShowPrompts(false);
                  onSendMessage(item);
                }}
                disabled={isLoading}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pill-Shaped Input Bar (Fixed Bottom, Safe-Area Aware) */}
      <div className="replika-input-container">
        <form className="pill-input-bar" onSubmit={handleSubmit}>
          {/* Left Icon: Phone / Call button */}
          <button
            type="button"
            className={`pill-icon-btn call-btn ${handsFree ? 'active' : ''} ${isSpeaking ? 'speaking' : ''}`}
            onClick={onToggleMic}
            title={handsFree ? 'Mute call' : 'Start voice call'}
            aria-label="Voice call"
          >
            <Phone size={18} />
          </button>

          {/* Center: Text input */}
          <input
            type="text"
            className="pill-input-field"
            placeholder={isListening ? 'Listening…' : 'Talk to me'}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />

          {/* Right Icon: '+' when empty, Send when typing */}
          {inputText.trim() ? (
            <button
              type="submit"
              className="pill-icon-btn send-btn"
              disabled={isLoading}
              title="Send message"
              aria-label="Send message"
            >
              <Send size={16} />
            </button>
          ) : (
            <button
              type="button"
              className={`pill-icon-btn plus-btn ${showPrompts ? 'open' : ''}`}
              onClick={() => setShowPrompts((p) => !p)}
              title="Topics & suggestions"
              aria-label="Toggle suggestions"
            >
              <Plus size={18} />
            </button>
          )}
        </form>

        {/* Voice status caption if active */}
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

