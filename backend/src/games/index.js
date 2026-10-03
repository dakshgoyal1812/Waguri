// Game layer — she can PLAY with you (Neuro-sama style), speaking her moves
// through the normal voice pipeline.
//
// Architecture: game RULES are server-authoritative code (a waifu that hallucinates
// illegal moves is not fun); her DECISIONS and personality come from the LLM. Each
// reply flows through the same mood + TTS pipeline as chat, so she talks while
// playing. Sessions live in memory — single-user private app (restart = new game).
//
// Games: tictactoe (board), rps (scored rounds), twentyq (she guesses your thing).
import { needsLanguageRepair, languageRepairNudge } from '../lang/guard.js';
import { fetchTriviaQuestion } from '../tools/publicApis.js';

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
  // Shared reply tail: mood + TTS on her game banter, same shape as /api/chat.
  async function speakReply({ text, taggedEmotion, sessionId, game }) {
    const mood = moodEngine ? await moodEngine.detect(text, taggedEmotion, null) : null;
    const expression = moodEngine ? moodEngine.expressionFor(mood, taggedEmotion) : (taggedEmotion || 'neutral');
    let audioUrl = null;
    let ttsProvider = null;
    try {
      const prosody = moodEngine ? moodEngine.prosodyFor(mood) : {};
      // Race TTS with a 2.2s timeout so slow voice synthesis never blocks the game
      const synthPromise = synthesize(text, prosody);
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TTS timeout')), 2200));
      const { audio, mime, provider } = await Promise.race([synthPromise, timeoutPromise]);
      const id = publicBase.storeAudio(audio, mime);
      audioUrl = `${publicBase.base()}/api/audio/${id}`;
      ttsProvider = provider;
    } catch (e) {
      // voice is optional for play — game board updates swiftly
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

  // Fast in-character banter using token-limited single-shot LLM with quick fallback.
  async function banter(systemPrompt, fallback) {
    try {
      const persona = await getPersona();
      const prompt = [
        persona ? `You are ${persona.name}. Stay fully in character — playful, warm, teasing, never say you are an AI.` : 'Stay in character.',
        systemPrompt,
        'Your natural voice is Hinglish (Roman-script Hindi-English mix, like "Arre wah, jeet gayi main!"). ALWAYS reply in Hinglish.',
        'Start with an emotion tag [happy]/[sad]/[surprised]/[relaxed]/[neutral]. Keep it to 1 short sentence (under 12 words).',
      ].join('\n');
      const messages = [{ role: 'system', content: prompt }];
      const res = await callLLM(messages, { maxTokens: 38, timeoutMs: 2200 });
      const m = String(res.text).match(/^\s*\[(?:mood:\s*)?(happy|angry|sad|surprised|relaxed|neutral|excited|curious)\]\s*/i);
      let text = (m ? res.text.slice(m[0].length) : String(res.text).trim()).slice(0, MAX_TICTACTOE_NARRATE_CHARS);
      const emotion = m ? m[1].toLowerCase() : null;
      if (!needsLanguageRepair('', text)) return { text, emotion };
      return { text: fallback || text, emotion: emotion || 'happy' };
    } catch (e) {
      return { text: fallback, emotion: null };
    }
  }

  // ---------------- tic-tac-toe (smart, instant 0ms strategy) ----------------

  function ttHerMove(session) {
    const legal = session.board.map((v, i) => (v ? null : i + 1)).filter(v => v !== null);
    if (legal.length === 0) return null;

    // 1. Can Waguri ('O') win right now?
    for (const m of legal) {
      const test = [...session.board];
      test[m - 1] = 'O';
      if (ttWinner(test) === 'O') {
        session.board[m - 1] = 'O';
        return m;
      }
    }

    // 2. Can Human ('X') win on next turn? Block them with 90% probability
    for (const m of legal) {
      const test = [...session.board];
      test[m - 1] = 'X';
      if (ttWinner(test) === 'X') {
        if (Math.random() < 0.9) {
          session.board[m - 1] = 'O';
          return m;
        }
      }
    }

    // 3. Take center if open (square 5) with 75% probability
    if (legal.includes(5) && Math.random() < 0.75) {
      session.board[4] = 'O';
      return 5;
    }

    // 4. Take a corner if open
    const corners = [1, 3, 7, 9].filter(c => legal.includes(c));
    if (corners.length > 0 && Math.random() < 0.65) {
      const pick = corners[Math.floor(Math.random() * corners.length)];
      session.board[pick - 1] = 'O';
      return pick;
    }

    // 5. Any legal move
    const choice = legal[Math.floor(Math.random() * legal.length)];
    session.board[choice - 1] = 'O';
    return choice;
  }

  async function ttAfterMove(session, userMoveNum, herMoveNum) {
    const winner = ttWinner(session.board);
    let outcome = null;
    if (winner === 'O') { outcome = 'she_won'; session.score.her++; }
    else if (winner === 'X') { outcome = 'you_won'; session.score.you++; }
    else if (winner === 'draw') { outcome = 'draw'; session.score.draws++; }

    const outcomeText = outcome === 'she_won' ? 'You WON this round of tic-tac-toe.'
      : outcome === 'you_won' ? 'The human WON this round of tic-tac-toe.'
      : outcome === 'draw' ? 'The game is a draw.'
      : 'The game continues.';

    const moveLine = herMoveNum
      ? `The human just played square ${userMoveNum}, and you replied with square ${herMoveNum}. `
      : `The human just played square ${userMoveNum}. `;

    const fallbacks = {
      she_won: ['Yay! Main jeet gayi! Ek aur round khelein?', 'Haha dekha mera move! Main jeet gayi!'],
      you_won: ['Arre re, is baar tum jeet gaye! Mast move tha!', 'Arey wah, badhiya khele tum! Rematch?'],
      draw: ['Tie ho gaya! Dono ne kya mast khela!', 'Barabari ka muqabla! Ek baar aur?'],
      ongoing: ['Hmm, accha move hai! Ab dekho mera kamal~', 'Chalo dekhte hain agla move kya hota hai!'],
    };
    const defaultFallback = (fallbacks[outcome] || fallbacks.ongoing)[Math.floor(Math.random() * 2)];

    const ban = await banter(
      `We are playing tic-tac-toe. ${moveLine}${outcomeText} Score — you: ${session.score.her}, human: ${session.score.you}, draws: ${session.score.draws}. React in 1 short playful Hinglish sentence. Never draw the board; plain text only.` +
      (outcome ? ' Offer a rematch!' : ''),
      defaultFallback
    );
    session.lastMove = herMoveNum ?? null;
    session.finished = !!outcome;
    return { banterText: ban.text, emotion: ban.emotion, outcome, board: [...session.board] };
  }

  // ---------------- rock paper scissors (instant 0ms choice) ----------------
  const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

  async function rpsRound(session, userThrow) {
    const CHOICES = ['rock', 'paper', 'scissors'];
    let herThrow;
    if (!session.history || session.history.length === 0) {
      herThrow = CHOICES[Math.floor(Math.random() * 3)];
    } else {
      // Counter the user's previous throw 60% of the time, or surprise
      const last = session.history[session.history.length - 1].user;
      const counter = { rock: 'paper', paper: 'scissors', scissors: 'rock' };
      herThrow = Math.random() < 0.6 ? counter[last] : CHOICES[Math.floor(Math.random() * 3)];
    }

    let result;
    if (herThrow === userThrow) result = 'draw';
    else if (RPS_BEATS[herThrow] === userThrow) result = 'she_won';
    else result = 'you_won';
    if (result === 'she_won') session.score.her++;
    else if (result === 'you_won') session.score.you++;
    else session.score.draws++;
    session.history.push({ user: userThrow, her: herThrow, result });

    const fallbacks = {
      she_won: `Maine ${herThrow} throw kiya! Main jeet gayi round!`,
      you_won: `Maine ${herThrow} throw kiya! Arre tum jeet gaye!`,
      draw: `Maine bhi ${herThrow} kiya! Tie ho gaya haha!`,
    };

    const ban = await banter(
      `Rock-paper-scissors round: human threw ${userThrow}, you threw ${herThrow} — ${result === 'draw' ? 'a draw' : result === 'she_won' ? 'YOU won the round' : 'human won'}. Score — you: ${session.score.her}, human: ${session.score.you}. React in 1 short playful Hinglish sentence.`,
      fallbacks[result]
    );
    return { banterText: ban.text, emotion: ban.emotion, herThrow, result };
  }

  // ---------------- twenty questions ----------------
  async function twentyqTurn(session, userAnswer) {
    session.round++;
    if (session.currentQuestion) {
      session.qa.push({ question: session.currentQuestion, answer: userAnswer });
    }
    const qa = session.qa.map((q, i) => `Q${i + 1}: ${q.question} -> ${q.answer}`).join('\n') || '(no questions yet)';
    const finishedIn = session.round >= session.maxRounds;
    const ban = await banter(
      `20 questions game. Answers so far:\n${qa}\nHuman answered: "${userAnswer}".\n${finishedIn ? 'Make your final guess ("Mera guess hai: ...").' : `Ask next yes/no question (${session.round + 1}/${session.maxRounds}).`}`,
      finishedIn ? 'Mera guess hai... a cute puppy!' : 'Hmm, kya yeh koi living cheez hai?'
    );
    session.currentQuestion = ban.text;
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
        session = { kind: 'twentyq', round: 0, maxRounds: 20, qa: [], currentQuestion: null, finished: false };
      } else if (game === 'trivia') {
        const trivia = await fetchTriviaQuestion();
        session = {
          kind: 'trivia',
          round: 1,
          maxRounds: 5,
          score: { you: 0, her: 0 },
          current: trivia.success ? trivia : null,
          finished: false,
        };
      } else {
        const e = new Error(`unknown game: ${game} (tictactoe | rps | twentyq | trivia)`); e.status = 400; throw e;
      }
      sessions.set(sessionId, session);

      const openers = {
        tictactoe: 'Chalo tic-tac-toe khelte hain! Tum X ho aur pehla move tumhara — koi bhi square chuno!',
        rps: 'Rock paper scissors! Apna choice batao — dekhte hain tum mujhe hara pate ho ya nahi~',
        twentyq: 'Twenty questions khelte hain! Kuch bhi socho aur mere sawaalon ke jawab do. Pehla sawaal: kya yeh living cheez hai?',
        trivia: session?.current?.question
          ? `Chalo trivia quiz khelte hain! Pehla sawaal (${session.current.category}): "${session.current.question}" Options hain: ${session.current.options.join(', ')}. Batao tumhara jawab kya hai?`
          : 'Trivia quiz khelte hain! Batao tum ready ho?',
      };
      const openerText = openers[game] || 'Chalo khel shuru karte hain!';
      if (game === 'twentyq') session.currentQuestion = openerText;

      return {
        session_id: sessionId,
        game,
        state: publicState(session),
        ...(await speakReply({ text: openerText, taggedEmotion: 'happy', sessionId, game })),
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
          herMoveNum = ttHerMove(session);
        }
        outcomeResp = await ttAfterMove(session, n, herMoveNum);
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

      if (session.kind === 'trivia') {
        if (session.finished) { const e = new Error('game over — start a new round'); e.status = 409; throw e; }
        const userAns = String(answer || choice || move || '').trim().toLowerCase();
        const current = session.current;
        const correctLetter = (current?.correctLetter || '').toLowerCase();
        const correctAnswer = (current?.correctAnswer || '').toLowerCase();
        const isCorrect = userAns === correctLetter ||
          userAns === `option ${correctLetter}` ||
          (correctAnswer && (userAns === correctAnswer || userAns.includes(correctAnswer) || correctAnswer.includes(userAns)));

        if (isCorrect) session.score.you++;
        else session.score.her++;

        const finished = session.round >= session.maxRounds;
        session.finished = finished;

        let nextQ = null;
        if (!finished) {
          session.round++;
          nextQ = await fetchTriviaQuestion();
          session.current = nextQ.success ? nextQ : null;
        }

        const reactionPrompt = `Trivia quiz: user guessed "${userAns}". Correct answer was option ${current?.correctLetter?.toUpperCase()}) "${current?.correctAnswer}". User was ${isCorrect ? 'CORRECT' : 'WRONG'}. Score — Daksh: ${session.score.you}, Waguri: ${session.score.her}. ${finished ? 'Game over! Celebrate winner in 1 playful Hinglish sentence.' : `Next question: "${nextQ?.question}". Options: ${nextQ?.options?.join(', ')}`}`;
        const fallback = isCorrect
          ? (finished ? `Arre wah, bilkul sahi! Final score tumhara ${session.score.you}! Tum jeet gaye!` : `Sahi jawab! Next question: ${nextQ?.question || ''}`)
          : (finished ? `Arre re, galat! Sahi answer tha ${current?.correctAnswer}. Final score: ${session.score.you}!` : `Galat jawab tha! Sahi answer tha ${current?.correctAnswer}. Agla sawaal: ${nextQ?.question || ''}`);

        const ban = await banter(reactionPrompt, fallback);
        return {
          session_id: sessionId,
          game: 'trivia',
          state: publicState(session),
          correct: isCorrect,
          correct_answer: current?.correctAnswer,
          correct_letter: current?.correctLetter,
          finished,
          ...(await speakReply({ text: ban.text, taggedEmotion: ban.emotion || (isCorrect ? 'happy' : 'surprised'), sessionId, game: 'trivia' })),
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
  if (session.kind === 'trivia') {
    return {
      round: session.round,
      max_rounds: session.maxRounds,
      score: session.score,
      finished: session.finished,
      question: session.current?.question || null,
      options: session.current?.options || null,
      category: session.current?.category || null,
    };
  }
  return { round: session.round, max_rounds: session.maxRounds, finished: session.finished };
}

export { createGamesModule, ttWinner, ttBoardStr, publicState };
