import React, { useState } from 'react';
import { X, Gamepad2, Dices } from 'lucide-react';
import { startGame, gameMove } from '../api.js';

const GAMES = [
  { id: 'tictactoe', label: 'Tic-Tac-Toe', emoji: '⭕' },
  { id: 'rps', label: 'Rock-Paper-Scissors', emoji: '✊' },
  { id: 'twentyq', label: '20 Questions', emoji: '❓' },
];

const RPS_EMOJIS = {
  rock: '✊',
  paper: '✋',
  scissors: '✌️',
};

export default function GamePanel({
  isOpen, onClose, conversationId, onPlayAudio, onGameMessage,
}) {
  const [sessionId, setSessionId] = useState(null);
  const [game, setGame] = useState(null);
  const [state, setState] = useState(null);
  const [lastLine, setLastLine] = useState(null);
  const [busy, setBusy] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [pendingChoice, setPendingChoice] = useState(null);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const deliver = (resp) => {
    setLastLine({ text: resp.reply_text, emotion: resp.emotion });
    onGameMessage?.({
      role: 'assistant',
      content: resp.reply_text,
      emotion: resp.emotion || 'neutral',
      audio_url: resp.audio_url,
      isGame: true,
      game: resp.game,
    });
    if (resp.audio_url) onPlayAudio?.(resp.audio_url, resp.emotion);
  };

  const begin = async (id) => {
    setBusy(true);
    setIsThinking(true);
    setError(null);
    setPendingChoice(null);
    try {
      const resp = await startGame(id, conversationId);
      setSessionId(resp.session_id);
      setGame(resp.game);
      setState(resp.state);
      deliver(resp);
    } catch (e) {
      setError(e.message || 'Failed to start game');
    } finally {
      setBusy(false);
      setIsThinking(false);
    }
  };

  // Optimistic move for Tic-Tac-Toe: reflect player mark in 0ms!
  const actMove = async (cellIndex) => {
    if (!sessionId || busy || !state || state.board[cellIndex] || state.finished) return;

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(12); } catch { /* ignore */ }
    }

    // Optimistic board update
    const previousBoard = [...state.board];
    const nextBoard = [...state.board];
    nextBoard[cellIndex] = 'X';
    setState((prev) => ({ ...prev, board: nextBoard }));

    setBusy(true);
    setIsThinking(true);
    setError(null);

    try {
      const resp = await gameMove({ sessionId, move: cellIndex + 1 });
      setState(resp.state);
      deliver(resp);
    } catch (e) {
      // Revert board on network failure
      setState((prev) => ({ ...prev, board: previousBoard }));
      setError(e.message || 'Move failed');
    } finally {
      setBusy(false);
      setIsThinking(false);
    }
  };

  // Optimistic throw for Rock-Paper-Scissors
  const actRps = async (choiceId) => {
    if (!sessionId || busy) return;

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(12); } catch { /* ignore */ }
    }

    setPendingChoice(choiceId);
    setBusy(true);
    setIsThinking(true);
    setError(null);

    try {
      const resp = await gameMove({ sessionId, choice: choiceId });
      setState(resp.state);
      deliver(resp);
    } catch (e) {
      setError(e.message || 'Round failed');
    } finally {
      setBusy(false);
      setIsThinking(false);
      setPendingChoice(null);
    }
  };

  // 20 Questions answer
  const actTwentyQ = async (answerId) => {
    if (!sessionId || busy) return;

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(12); } catch { /* ignore */ }
    }

    setBusy(true);
    setIsThinking(true);
    setError(null);

    try {
      const resp = await gameMove({ sessionId, answer: answerId });
      setState(resp.state);
      deliver(resp);
    } catch (e) {
      setError(e.message || 'Answer failed');
    } finally {
      setBusy(false);
      setIsThinking(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="game-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Gamepad2 size={20} color="var(--accent-pink)" />
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>Play with Waguri</h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <div className="game-modal-body">
          {/* Game picker */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {GAMES.map((g) => (
              <button
                key={g.id}
                type="button"
                className="quick-pill"
                disabled={busy}
                style={{
                  padding: '7px 14px',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  touchAction: 'manipulation',
                  ...(game === g.id ? { borderColor: 'var(--accent-pink)', color: 'var(--accent-pink)', background: 'var(--surface-hover)' } : {}),
                }}
                onClick={() => begin(g.id)}
              >
                {g.emoji} {g.label}
              </button>
            ))}
          </div>

          {error && (
            <div style={{
              padding: '8px 12px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '10px',
              color: '#f87171',
              fontSize: '0.8rem',
              textAlign: 'center',
            }}>
              {error}
            </div>
          )}

          {/* Waguri speech / banter card */}
          {lastLine && (
            <div className="game-banter-card">
              <span style={{ fontSize: '1.15rem', lineHeight: 1 }}>🌸</span>
              <div style={{ flex: 1 }}>
                <strong style={{ color: 'var(--accent-purple)', marginRight: '6px' }}>Waguri:</strong>
                <span>{lastLine.text}</span>
              </div>
            </div>
          )}

          {isThinking && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div className="game-thinking-badge">
                <span>💭 Waguri is thinking...</span>
              </div>
            </div>
          )}

          {/* Tic-Tac-Toe Board */}
          {game === 'tictactoe' && state && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <div className="ttt-grid">
                {state.board.map((cell, i) => {
                  const isX = cell === 'X';
                  const isO = cell === 'O';
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`ttt-cell ${isX ? 'cell-x' : isO ? 'cell-o' : ''}`}
                      disabled={!!cell || state.finished || busy}
                      onClick={() => actMove(i)}
                      aria-label={`Cell ${i + 1} ${cell || 'empty'}`}
                    >
                      {cell}
                    </button>
                  );
                })}
              </div>

              {/* Scoreboard */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '0.8rem', flexWrap: 'wrap' }}>
                <span className="quick-pill" style={{ pointerEvents: 'none', padding: '4px 10px', fontSize: '0.78rem' }}>
                  You (X): <b style={{ color: 'var(--accent-pink)', marginLeft: '4px' }}>{state.score.you}</b>
                </span>
                <span className="quick-pill" style={{ pointerEvents: 'none', padding: '4px 10px', fontSize: '0.78rem' }}>
                  Draws: <b style={{ marginLeft: '4px' }}>{state.score.draws}</b>
                </span>
                <span className="quick-pill" style={{ pointerEvents: 'none', padding: '4px 10px', fontSize: '0.78rem' }}>
                  Waguri (O): <b style={{ color: 'var(--accent-purple)', marginLeft: '4px' }}>{state.score.her}</b>
                </span>
              </div>

              {state.finished && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  style={{ touchAction: 'manipulation', padding: '9px 18px', marginTop: '4px' }}
                  onClick={() => begin('tictactoe')}
                >
                  <Dices size={16} /> Play Again
                </button>
              )}
            </div>
          )}

          {/* Rock-Paper-Scissors */}
          {game === 'rps' && state && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <div className="rps-grid">
                {[
                  ['rock', '✊', 'Rock'],
                  ['paper', '✋', 'Paper'],
                  ['scissors', '✌️', 'Scissors'],
                ].map(([id, emoji, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`rps-btn ${pendingChoice === id ? 'active' : ''}`}
                    disabled={busy}
                    onClick={() => actRps(id)}
                  >
                    <span className="rps-emoji">{emoji}</span>
                    <span className="rps-label">{label}</span>
                  </button>
                ))}
              </div>

              {state.last && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '8px 14px',
                  background: 'var(--surface-hover)',
                  borderRadius: '12px',
                  border: '1px solid var(--border-glass)',
                  width: '100%',
                  maxWidth: '300px',
                  margin: '2px auto',
                }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                    You {RPS_EMOJIS[state.last.user]} vs {RPS_EMOJIS[state.last.her]} Waguri
                  </div>
                  <span style={{
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    color: state.last.result === 'she_won' ? 'var(--accent-purple)' : state.last.result === 'you_won' ? 'var(--accent-pink)' : 'var(--text-muted)',
                  }}>
                    {state.last.result === 'she_won' ? '✨ Waguri wins this round!' : state.last.result === 'you_won' ? '🎉 You win this round!' : '🤝 It\'s a tie!'}
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '0.8rem', flexWrap: 'wrap' }}>
                <span className="quick-pill" style={{ pointerEvents: 'none', padding: '4px 10px', fontSize: '0.78rem' }}>
                  You: <b style={{ color: 'var(--accent-pink)', marginLeft: '4px' }}>{state.score.you}</b>
                </span>
                <span className="quick-pill" style={{ pointerEvents: 'none', padding: '4px 10px', fontSize: '0.78rem' }}>
                  Draws: <b style={{ marginLeft: '4px' }}>{state.score.draws}</b>
                </span>
                <span className="quick-pill" style={{ pointerEvents: 'none', padding: '4px 10px', fontSize: '0.78rem' }}>
                  Waguri: <b style={{ color: 'var(--accent-purple)', marginLeft: '4px' }}>{state.score.her}</b>
                </span>
              </div>
            </div>
          )}

          {/* 20 Questions */}
          {game === 'twentyq' && state && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                Question <b>{Math.min(state.round + 1, state.max_rounds)}</b> of {state.max_rounds}:
              </div>
              <div className="twentyq-grid">
                {[
                  ['yes', '👍', 'Yes'],
                  ['maybe', '🤔', 'Kind of'],
                  ['no', '👎', 'No'],
                ].map(([id, emoji, label]) => (
                  <button
                    key={id}
                    type="button"
                    className="twentyq-btn"
                    disabled={busy}
                    onClick={() => actTwentyQ(id)}
                  >
                    <span>{emoji}</span> {label}
                  </button>
                ))}
              </div>
              {state.finished && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  style={{ touchAction: 'manipulation', padding: '9px 18px', marginTop: '4px' }}
                  onClick={() => begin('twentyq')}
                >
                  <Dices size={16} /> New Round
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
