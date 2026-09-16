import React, { useState } from 'react';
import { X, Gamepad2, Dices } from 'lucide-react';
import { startGame, gameMove } from '../api.js';

const GAMES = [
  { id: 'tictactoe', label: 'Tic-Tac-Toe', emoji: '⭕' },
  { id: 'rps', label: 'Rock-Paper-Scissors', emoji: '✊' },
  { id: 'twentyq', label: '20 Questions', emoji: '❓' },
];

// She PLAYS with you: rules run server-side (she can never cheat the board), but
// every move/result is narrated by her LLM brain and arrives as chat + voice
// through the normal pipeline, so she talks while playing.
export default function GamePanel({
  isOpen, onClose, conversationId, onPlayAudio, onGameMessage,
}) {
  const [sessionId, setSessionId] = useState(null);
  const [game, setGame] = useState(null);
  const [state, setState] = useState(null);
  const [lastLine, setLastLine] = useState(null);
  const [busy, setBusy] = useState(false);
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
    setBusy(true); setError(null);
    try {
      const resp = await startGame(id, conversationId);
      setSessionId(resp.session_id);
      setGame(resp.game);
      setState(resp.state);
      deliver(resp);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  const act = async (payload) => {
    if (!sessionId || busy) return;
    setBusy(true); setError(null);
    try {
      const resp = await gameMove({ sessionId, ...payload });
      setState(resp.state);
      deliver(resp);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '85vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Gamepad2 size={20} color="var(--accent-pink)" />
            <h3>Play with {`Waguri`}</h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close modal"><X size={18} /></button>
        </div>

        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          She narrates every move out loud — rules are enforced by the server, sass comes from her brain.
        </p>

        {/* game picker */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {GAMES.map((g) => (
            <button
              key={g.id}
              className="quick-pill"
              disabled={busy}
              style={game === g.id ? { borderColor: 'var(--accent-pink)', color: 'var(--accent-pink)' } : undefined}
              onClick={() => begin(g.id)}
            >
              {g.emoji} {g.label}
            </button>
          ))}
        </div>

        {error && (
          <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', color: '#f87171', fontSize: '0.82rem' }}>
            {error}
          </div>
        )}

        {lastLine && (
          <div style={{ padding: '10px 12px', background: 'rgba(167, 139, 250, 0.1)', border: '1px solid rgba(167, 139, 250, 0.25)', borderRadius: '8px', fontSize: '0.86rem', color: 'var(--text-primary)' }}>
            <span style={{ color: 'var(--accent-purple)', fontWeight: 700, marginRight: '6px' }}>Waguri:</span>
            {lastLine.text}
          </div>
        )}

        {/* tic-tac-toe board */}
        {game === 'tictactoe' && state && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 64px)', gap: '6px' }}>
              {state.board.map((cell, i) => (
                <button
                  key={i}
                  className="form-input"
                  style={{
                    height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.6rem', fontWeight: 700, cursor: cell || state.finished || busy ? 'default' : 'pointer',
                    color: cell === 'X' ? 'var(--accent-pink)' : 'var(--accent-purple)',
                    padding: 0, textAlign: 'center',
                  }}
                  disabled={!!cell || state.finished || busy}
                  onClick={() => act({ move: i + 1 })}
                >
                  {cell}
                </button>
              ))}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              You (X) {state.score.you} · Draws {state.score.draws} · Waguri (O) {state.score.her}
            </div>
            {state.finished && (
              <button className="btn-primary" disabled={busy} onClick={() => begin('tictactoe')}>
                <Dices size={15} /> Rematch
              </button>
            )}
          </div>
        )}

        {/* rps */}
        {game === 'rps' && state && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              {[['rock', '✊'], ['paper', '✋'], ['scissors', '✌️']].map(([id, emoji]) => (
                <button key={id} className="quick-pill" disabled={busy} style={{ fontSize: '1.4rem', padding: '10px 18px' }} onClick={() => act({ choice: id })}>
                  {emoji}
                </button>
              ))}
            </div>
            {state.last && (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                You: {state.last.user} · Her: {state.last.her} —{' '}
                <b style={{ color: state.last.result === 'she_won' ? 'var(--accent-purple)' : state.last.result === 'you_won' ? 'var(--accent-pink)' : 'var(--text-muted)' }}>
                  {state.last.result === 'she_won' ? 'she wins the round' : state.last.result === 'you_won' ? 'you win the round' : 'draw'}
                </b>
              </div>
            )}
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              You {state.score.you} · Draws {state.score.draws} · Waguri {state.score.her} ({state.rounds} rounds)
            </div>
          </div>
        )}

        {/* twentyq */}
        {game === 'twentyq' && state && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Question {Math.min(state.round + 1, state.max_rounds)} of {state.max_rounds} — answer out loud or with the buttons:
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[['yes', '👍 Yes'], ['maybe', '🤔 Kind of'], ['no', '👎 No']].map(([id, label]) => (
                <button key={id} className="quick-pill" disabled={busy} onClick={() => act({ answer: id })}>{label}</button>
              ))}
            </div>
            {state.finished && (
              <button className="btn-primary" disabled={busy} onClick={() => begin('twentyq')}>
                <Dices size={15} /> New round
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
