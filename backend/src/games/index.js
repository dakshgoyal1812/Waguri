// Game layer — she can PLAY with you (Neuro-sama style), speaking her moves
// through the normal voice pipeline.
//
// Architecture: game RULES are server-authoritative code (a waifu that hallucinates
// illegal moves is not fun); her DECISIONS and personality come from the LLM. Each
// reply flows through the same mood + TTS pipeline as chat, so she talks while
// playing. Sessions live in memory — single-user private app (restart = new game).
//
// Games: tictactoe (board), rps (scored rounds), twentyq (she guesses your thing).

const MAX_TICTACTOE_NARRATE_CHARS = 400;

// ---- pure tic-tac-toe rules (module scope: testable without the LLM) ----
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function ttWinner(b) {
  for (const [a, c, d] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  return b.every(Boolean) ? 'draw' : null;
}
function ttBoardStr(b) {
  return [0, 3, 6].map(r => [0, 1, 2].map(c => b[r + c] || '.').join(' ')).join('\n');
}

function createGamesModule({ callLLM, synthesize, moodEngine, getPersona, publicBase }) {
  const sessions = new Map(); // sessionId -> game session
  let seq = 0;
  const newId = () => `game-${Date.now().toString(36)}-${(++seq).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // Shared reply tail: mood + TTS on her game banter, same shape as /api/chat.
  async function speakReply({ text, taggedEmotion, sessionId, game }) {
    const mood = moodEngine ? await moodEngine.detect(text, taggedEmotion, null) : null;
    const expression = moodEngine ? moodEngine.expressionFor(mood, taggedEmotion) : (taggedEmotion || 'neutral');
    let audioUrl = null;
    let ttsProvider = null;
    try {
      const prosody = moodEngine ? moodEngine.prosodyFor(mood) : {};
      const { audio, mime, provider } = await synthesize(text, prosody);
      const id = publicBase.storeAudio(audio, mime);
      audioUrl = `${publicBase.base()}/api/audio/${id}`;
      ttsProvider = provider;
    } catch (e) {
      // voice is optional for play — the board still works text-only
    }
    return {
      session_id: sessionId,
      game,
      reply_text: text,
      emotion: expression,
      mood: mood ? { name: mood.name, expression: mood.vrm_expression, voice: { rate: mood.voice_rate || null, pitch: mood.voice_pitch || null } } : null,
      audio_url: audioUrl,
      tts_provider: ttsProvider,
    };
  }

  // Ask her LLM brain for an in-character line; strips tags. Never throws —
  // a narration failure falls back to a plain line so the game continues.
  async function banter(systemPrompt, fallback) {
    try {
      const persona = await getPersona();
      const prompt = [
        persona ? `You are ${persona.name}. Stay fully in character — playful, warm, never say you are an AI.` : 'Stay in character.',
        systemPrompt,
        'Start with an emotion tag [happy]/[sad]/[surprised]/[relaxed]/[neutral]. Keep it to 1-2 short sentences.',
      ].join('\n');
      const res = await callLLM([{ role: 'system', content: prompt }]);
      const m = String(res.text).match(/^\s*\[(?:mood:\s*)?(happy|angry|sad|surprised|relaxed|neutral|excited|curious)\]\s*/i);
      return {
        text: (m ? res.text.slice(m[0].length) : String(res.text).trim()).slice(0, MAX_TICTACTOE_NARRATE_CHARS),
        emotion: m ? m[1].toLowerCase() : null,
      };
    } catch (e) {
      return { text: fallback, emotion: null };
    }
  }

  // ---------------- tic-tac-toe (rules in module scope above) ----------------

  async function ttHerMove(session) {
    // Her choice: LLM picks from the legal moves (she can be clever or sloppy —
    // that is personality). Illegal/no parse -> random legal move so rules hold.
    const legal = session.board.map((v, i) => (v ? null : i + 1)).filter(v => v !== null);
    let choice = null;
    try {
      const res = await callLLM([{
        role: 'system',
        content: `Tic-tac-toe. You are 'O', the human is 'X'. Board (rows, . = empty):\n${ttBoardStr(session.board)}\nLegal move numbers: ${legal.join(', ')}\nPick your move. Reply with ONLY the move number (1-9).`,
      }]);
      const n = parseInt(String(res.text).match(/\d+/)?.[0], 10);
      if (legal.includes(n)) choice = n;
    } catch { /* fall through to random */ }
    if (choice === null) choice = legal[Math.floor(Math.random() * legal.length)];
    session.board[choice - 1] = 'O';
    return choice;
  }

  async function ttAfterMove(session, herMoveNum) {
    let winner = ttWinner(session.board);
    let line = '';
    if (!winner && herMoveNum) line = `you played ${herMoveNum}, `;
    let outcome = null;
    if (winner === 'O') { outcome = 'she_won'; session.score.her++; }
    else if (winner === 'X') { outcome = 'you_won'; session.score.you++; }
    else if (winner === 'draw') { outcome = 'draw'; session.score.draws++; }

    const outcomeText = outcome === 'she_won' ? 'You WON this round of tic-tac-toe.'
      : outcome === 'you_won' ? 'The human WON this round of tic-tac-toe.'
      : outcome === 'draw' ? 'The game is a draw.'
      : 'The game continues.';
    const ban = await banter(
      `We are playing tic-tac-toe. ${line ? `The human just played square ${herMoveNum}. ` : ''}${outcomeText} Score — you: ${session.score.her}, human: ${session.score.you}, draws: ${session.score.draws}. React to the move/result in character.` +
      (outcome ? ' Offer a rematch!' : ''),
      outcome === 'she_won' ? 'Yay, I win!' : outcome === 'you_won' ? 'Ahh you got me!' : 'Good move!'
    );
    session.lastMove = herMoveNum ?? null;
    session.finished = !!outcome;
    return { banterText: ban.text, emotion: ban.emotion, outcome, board: [...session.board] };
  }

  // ---------------- rock paper scissors ----------------
  const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

  async function rpsRound(session, userThrow) {
    // She picks blind (no peeking at the user's current throw) but remembers the
    // round history — she can try to read patterns, Neuro-style.
    const history = session.history.map((h, i) => `Round ${i + 1}: human ${h.user}, you ${h.her} (${h.result})`).join('\n') || '(first round)';
    let herThrow = null;
    try {
      const res = await callLLM([{
        role: 'system',
        content: `Rock-paper-scissors vs the human. History:\n${history}\nChoose your throw for THIS round (you cannot see their current choice). Reply with ONLY one word: rock, paper, or scissors.`,
      }]);
      const t = String(res.text).toLowerCase().match(/rock|paper|scissors/)?.[0];
      if (t) herThrow = t;
    } catch { /* fall through */ }
    if (!herThrow) herThrow = ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)];

    let result;
    if (herThrow === userThrow) result = 'draw';
    else if (RPS_BEATS[herThrow] === userThrow) result = 'she_won';
    else result = 'you_won';
    if (result === 'she_won') session.score.her++;
    else if (result === 'you_won') session.score.you++;
    else session.score.draws++;
    session.history.push({ user: userThrow, her: herThrow, result });

    const ban = await banter(
      `Rock-paper-scissors round result: human threw ${userThrow}, you threw ${herThrow} — ${result === 'draw' ? 'a draw' : result === 'she_won' ? 'YOU won the round' : 'the HUMAN won the round'}. Score — you: ${session.score.her}, human: ${session.score.you}, draws: ${session.score.draws}. React in character and tease/playful about their pattern if any.`,
      `I threw ${herThrow}!`
    );
    return { banterText: ban.text, emotion: ban.emotion, herThrow, result };
  }

  // ---------------- twenty questions ----------------
  // She guesses; the human answers yes/no/kindof. Server tracks round count.
  async function twentyqTurn(session, userAnswer) {
    session.round++;
    const qa = session.qa.map((q, i) => `Q${i + 1}: ${q.question} -> ${q.answer}`).join('\n') || '(no questions yet)';
    const finishedIn = session.round >= session.maxRounds;
    const ban = await banter(
      `You are playing 20 questions: the human thinks of something, you guess it with yes/no questions. Answers so far:\n${qa}\nThe human just answered: "${userAnswer}".\n${finishedIn ? 'That was your LAST question — you must now make your FINAL GUESS of what the thing is (say "My guess is: ...").' : `Ask your next yes/no question (question ${session.round + 1} of ${session.maxRounds}).`}`,
      finishedIn ? 'My guess is... a cat!' : 'Hmm, is it alive?'
    );
    session.qa.push({ question: ban.text, answer: userAnswer });
    session.finished = finishedIn;
    return { banterText: ban.text, emotion: ban.emotion };
  }

  // ---------------- public API ----------------
  return {
    async start({ game, conversationId }) {
      const sessionId = newId();
      let session;
      if (game === 'tictactoe') {
        session = { kind: 'tictactoe', board: Array(9).fill(''), score: { you: 0, her: 0, draws: 0 }, finished: false, lastMove: null };
      } else if (game === 'rps') {
        session = { kind: 'rps', score: { you: 0, her: 0, draws: 0 }, history: [], finished: false };
      } else if (game === 'twentyq') {
        session = { kind: 'twentyq', round: 0, maxRounds: 20, qa: [], finished: false };
      } else {
        const e = new Error(`unknown game: ${game} (tictactoe | rps | twentyq)`); e.status = 400; throw e;
      }
      sessions.set(sessionId, session);

      const openers = {
        tictactoe: "Let's play tic-tac-toe! You are X and you go first — pick a square 1 to 9!",
        rps: 'Rock paper scissors! Throw your pick — best of luck reading my soul~',
        twentyq: "Twenty questions! Think of something — anything — and answer my yes/no questions. Ready? First one: is it alive?",
      };
      // Opener through her voice; LLM banter if available, canned line otherwise.
      const ban = await banter(
        game === 'tictactoe' ? 'Invite the human to play tic-tac-toe. They are X and move first, squares are numbered 1-9.'
        : game === 'rps' ? 'Invite the human to play rock-paper-scissors.'
        : 'Start 20 questions: tell them to think of something secret, then ask your first yes/no question.',
        openers[game]
      );
      return {
        session_id: sessionId,
        game,
        state: publicState(session),
        ...(await speakReply({ text: ban.text, taggedEmotion: ban.emotion || 'happy', sessionId, game })),
      };
    },

    async move({ sessionId, move, choice, answer }) {
      const session = sessions.get(sessionId);
      if (!session) { const e = new Error('game session not found or expired'); e.status = 404; throw e; }

      if (session.kind === 'tictactoe') {
        if (session.finished) { const e = new Error('game over — start a new round'); e.status = 409; throw e; }
        const n = parseInt(move, 10);
        if (!n || n < 1 || n > 9 || session.board[n - 1]) {
          const e = new Error('illegal move: pick an empty square 1-9'); e.status = 400; throw e;
        }
        session.board[n - 1] = 'X';
        const winner = ttWinner(session.board);
        let herMoveNum = null;
        let outcomeResp = null;
        if (!winner) {
          herMoveNum = await ttHerMove(session);
        }
        outcomeResp = await ttAfterMove(session, herMoveNum);
        return {
          session_id: sessionId,
          game: 'tictactoe',
          state: publicState(session),
          your_move: n,
          her_move: herMoveNum,
          outcome: outcomeResp.outcome,
          board_str: ttBoardStr(session.board),
          ...(await speakReply({ text: outcomeResp.banterText, taggedEmotion: outcomeResp.emotion || (outcomeResp.outcome === 'she_won' ? 'happy' : outcomeResp.outcome === 'you_won' ? 'sad' : 'neutral'), sessionId, game: 'tictactoe' })),
        };
      }

      if (session.kind === 'rps') {
        const userThrow = String(choice || '').toLowerCase();
        if (!RPS_BEATS[userThrow]) { const e = new Error('choice must be rock, paper or scissors'); e.status = 400; throw e; }
        const r = await rpsRound(session, userThrow);
        return {
          session_id: sessionId,
          game: 'rps',
          state: publicState(session),
          your_throw: userThrow,
          her_throw: r.herThrow,
          round_result: r.result,
          ...(await speakReply({ text: r.banterText, taggedEmotion: r.emotion || (r.result === 'she_won' ? 'happy' : r.result === 'you_won' ? 'sad' : 'neutral'), sessionId, game: 'rps' })),
        };
      }

      // twentyq
      const ans = String(answer || 'maybe').toLowerCase();
      if (!['yes', 'no', 'maybe'].includes(ans)) { const e = new Error('answer must be yes, no or maybe'); e.status = 400; throw e; }
      const t = await twentyqTurn(session, ans);
      return {
        session_id: sessionId,
        game: 'twentyq',
        state: publicState(session),
        ...(await speakReply({ text: t.banterText, taggedEmotion: t.emotion || 'neutral', sessionId, game: 'twentyq' })),
      };
    },

    state(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return null;
      return { session_id: sessionId, game: session.kind, state: publicState(session) };
    },

    _sessions: sessions,
  };
}

function publicState(session) {
  if (session.kind === 'tictactoe') {
    return { board: session.board, score: session.score, finished: session.finished, last_move: session.lastMove };
  }
  if (session.kind === 'rps') {
    return { score: session.score, rounds: session.history.length, last: session.history[session.history.length - 1] || null };
  }
  return { round: session.round, max_rounds: session.maxRounds, finished: session.finished };
}

export { createGamesModule, ttWinner, ttBoardStr, publicState };
