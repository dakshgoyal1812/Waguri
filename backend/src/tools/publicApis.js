// Public APIs Tool Integration (Zero-Key, 100% Free):
// 1. Weather: Open-Meteo Geocoding + Weather API (real-time weather, temperature, humidity)
// 2. Anime: AniList GraphQL + Jikan v4 MyAnimeList fallback (scores, synopsis, genres, recommendations)
// 3. Facts / Trivia: Wikipedia REST API (smart factual overviews) & Open Trivia DB (interactive quiz)
// 4. Jokes / Fun: JokeAPI (safe-mode) + Official Joke API fallback (funny jokes, banter)
//
// All external calls are wrapped with tight timeouts (<=2.5s), in-memory TTL caching,
// and safe fallbacks so chat latency is never impacted.

const CACHE_TTL_MS = {
  weather: 10 * 60 * 1000,    // 10 minutes
  anime: 60 * 60 * 1000,      // 1 hour
  wiki: 2 * 60 * 60 * 1000,   // 2 hours
  trivia: 10 * 1000,          // 10 seconds (fresh questions)
  joke: 10 * 1000,            // 10 seconds (fresh jokes)
};

const cache = new Map(); // key -> { value, expiresAt }

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function setCached(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// Simple HTML entity decoder for Trivia & Wikipedia outputs
export function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&eacute;/g, 'é')
    .replace(/&deg;/g, '°')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec));
}

// -------------------------------------------------------------
// 1. WEATHER (Open-Meteo: No Key, 100% Free)
// -------------------------------------------------------------
const WMO_WEATHER_CODES = {
  0: 'Clear sky (saaf aasman)',
  1: 'Mainly clear (halki dhoop)',
  2: 'Partly cloudy (thode baadal)',
  3: 'Overcast (baadal chhaye hue)',
  45: 'Foggy (kohra)',
  48: 'Depositing rime fog',
  51: 'Light drizzle (halki boondabaandi)',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain (halki baarish)',
  63: 'Moderate rain (baarish)',
  65: 'Heavy rain (tez baarish)',
  71: 'Slight snow fall (barafbaari)',
  73: 'Moderate snow fall',
  75: 'Heavy snow fall',
  80: 'Slight rain showers (bochar)',
  81: 'Moderate rain showers',
  82: 'Violent rain showers (tez bochar)',
  95: 'Thunderstorm (aandhi toofan / bijli chamakna)',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

export async function fetchWeather(city = 'Delhi') {
  const cleanCity = String(city).trim() || 'Delhi';
  const cacheKey = `weather:${cleanCity.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    // 1. Geocoding
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanCity)}&count=1&language=en&format=json`;
    const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(2500) });
    if (!geoRes.ok) throw new Error(`Geocoding HTTP ${geoRes.status}`);
    const geoData = await geoRes.json();
    const match = geoData.results?.[0];
    if (!match) {
      return { success: false, error: `City '${cleanCity}' not found` };
    }

    const { latitude, longitude, name, country, admin1 } = match;

    // 2. Current Weather
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=auto`;
    const wRes = await fetch(weatherUrl, { signal: AbortSignal.timeout(2500) });
    if (!wRes.ok) throw new Error(`Weather HTTP ${wRes.status}`);
    const wData = await wRes.json();
    const curr = wData.current || {};

    const condition = WMO_WEATHER_CODES[curr.weather_code] || 'Pleasant';
    const result = {
      success: true,
      city: name,
      admin: admin1 || '',
      country: country || '',
      temperature: `${curr.temperature_2m}°C`,
      feels_like: `${curr.apparent_temperature}°C`,
      humidity: `${curr.relative_humidity_2m}%`,
      condition,
      wind_speed: `${curr.wind_speed_10m} km/h`,
      precipitation: `${curr.precipitation || 0} mm`,
    };

    setCached(cacheKey, result, CACHE_TTL_MS.weather);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// -------------------------------------------------------------
// 2. ANIME (AniList GraphQL + Jikan v4 Fallback: No Key, Free)
// -------------------------------------------------------------
export async function fetchAnime(query = 'Naruto', isRecommendation = false) {
  const cleanQuery = String(query).trim();
  const cacheKey = `anime:${isRecommendation ? 'top' : cleanQuery.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // A. Try AniList GraphQL (Fast, reliable, rich metadata)
  try {
    if (isRecommendation) {
      const topQuery = `query {
        Page(page: 1, perPage: 3) {
          media(type: ANIME, sort: TRENDING_DESC) {
            id
            title { romaji english }
            meanScore
            episodes
            genres
            description(asHtml: false)
          }
        }
      }`;
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Waguri/2.0' },
        body: JSON.stringify({ query: topQuery }),
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        const data = await res.json();
        const list = data.data?.Page?.media || [];
        if (list.length > 0) {
          const recommendations = list.map((m) => ({
            title: m.title?.english || m.title?.romaji,
            score: m.meanScore ? `${(m.meanScore / 10).toFixed(1)}/10` : 'N/A',
            episodes: m.episodes || 'Ongoing',
            genres: (m.genres || []).slice(0, 3).join(', '),
            synopsis: (m.description || '').replace(/<[^>]*>?/gm, '').slice(0, 160) + '...',
          }));
          const result = { success: true, isRecommendation: true, recommendations };
          setCached(cacheKey, result, CACHE_TTL_MS.anime);
          return result;
        }
      }
    } else {
      const singleQuery = `query ($search: String) {
        Media(search: $search, type: ANIME) {
          id
          title { romaji english native }
          meanScore
          episodes
          status
          genres
          description(asHtml: false)
        }
      }`;
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Waguri/2.0' },
        body: JSON.stringify({ query: singleQuery, variables: { search: cleanQuery } }),
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        const data = await res.json();
        const m = data.data?.Media;
        if (m) {
          const result = {
            success: true,
            title: m.title?.english || m.title?.romaji,
            romajiTitle: m.title?.romaji,
            score: m.meanScore ? `${(m.meanScore / 10).toFixed(1)}/10` : 'N/A',
            episodes: m.episodes || 'Ongoing',
            status: m.status,
            genres: (m.genres || []).slice(0, 4).join(', '),
            synopsis: (m.description || '').replace(/<[^>]*>?/gm, '').slice(0, 250) + '...',
          };
          setCached(cacheKey, result, CACHE_TTL_MS.anime);
          return result;
        }
      }
    }
  } catch (err) {
    // proceed to Jikan fallback
  }

  // B. Fallback to Jikan v4
  try {
    const jikanUrl = isRecommendation
      ? 'https://api.jikan.moe/v4/top/anime?limit=3'
      : `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(cleanQuery)}&limit=1`;
    const jRes = await fetch(jikanUrl, {
      headers: { 'User-Agent': 'Waguri/2.0' },
      signal: AbortSignal.timeout(2500),
    });
    if (jRes.ok) {
      const jData = await jRes.json();
      if (isRecommendation && Array.isArray(jData.data) && jData.data.length > 0) {
        const recommendations = jData.data.slice(0, 3).map((a) => ({
          title: a.title_english || a.title,
          score: a.score ? `${a.score}/10` : 'N/A',
          episodes: a.episodes || 'Ongoing',
          genres: (a.genres || []).map((g) => g.name).slice(0, 3).join(', '),
          synopsis: (a.synopsis || '').slice(0, 160) + '...',
        }));
        const result = { success: true, isRecommendation: true, recommendations };
        setCached(cacheKey, result, CACHE_TTL_MS.anime);
        return result;
      }
      const item = jData.data?.[0];
      if (item) {
        const result = {
          success: true,
          title: item.title_english || item.title,
          score: item.score ? `${item.score}/10` : 'N/A',
          episodes: item.episodes || 'Ongoing',
          status: item.status,
          genres: (item.genres || []).map((g) => g.name).slice(0, 4).join(', '),
          synopsis: (item.synopsis || '').slice(0, 250) + '...',
        };
        setCached(cacheKey, result, CACHE_TTL_MS.anime);
        return result;
      }
    }
  } catch (err) {
    // Both providers failed or network offline
  }

  return { success: false, error: `Could not fetch anime info for '${cleanQuery}'` };
}

// -------------------------------------------------------------
// 3. FACTS & TRIVIA (Wikipedia REST API & Open Trivia DB: Free)
// -------------------------------------------------------------
export async function fetchWikipediaSummary(topic) {
  const cleanTopic = String(topic || '').trim();
  if (!cleanTopic) return { success: false, error: 'Topic is required' };

  const cacheKey = `wiki:${cleanTopic.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    // 1. Direct REST summary
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanTopic.replace(/\s+/g, '_'))}`;
    const res = await fetch(summaryUrl, {
      headers: { 'User-Agent': 'WaguriCompanion/2.0 (contact@waguri.app)' },
      signal: AbortSignal.timeout(2500),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.extract) {
        const result = {
          success: true,
          title: data.title,
          description: data.description || '',
          extract: data.extract.slice(0, 350),
        };
        setCached(cacheKey, result, CACHE_TTL_MS.wiki);
        return result;
      }
    }

    // 2. If direct 404, search for closest title via OpenSearch
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(cleanTopic)}&limit=1&namespace=0&format=json`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': 'WaguriCompanion/2.0 (contact@waguri.app)' },
      signal: AbortSignal.timeout(2000),
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const resolvedTitle = searchData?.[1]?.[0];
      if (resolvedTitle) {
        const secondRes = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(resolvedTitle.replace(/\s+/g, '_'))}`,
          {
            headers: { 'User-Agent': 'WaguriCompanion/2.0 (contact@waguri.app)' },
            signal: AbortSignal.timeout(2000),
          }
        );
        if (secondRes.ok) {
          const secondData = await secondRes.json();
          if (secondData.extract) {
            const result = {
              success: true,
              title: secondData.title,
              description: secondData.description || '',
              extract: secondData.extract.slice(0, 350),
            };
            setCached(cacheKey, result, CACHE_TTL_MS.wiki);
            return result;
          }
        }
      }
    }
  } catch (err) {
    // Wikipedia request error
  }

  return { success: false, error: `Wikipedia summary not found for '${cleanTopic}'` };
}

const FALLBACK_TRIVIA_QUESTIONS = [
  {
    category: 'Science: Computers',
    difficulty: 'easy',
    question: 'What does the acronym CPU stand for?',
    correct_answer: 'Central Processing Unit',
    incorrect_answers: ['Central Process Unit', 'Computer Personal Unit', 'Central Processor Utility'],
  },
  {
    category: 'Geography',
    difficulty: 'medium',
    question: 'Which is the longest river in the world?',
    correct_answer: 'Nile',
    incorrect_answers: ['Amazon', 'Yangtze', 'Mississippi'],
  },
  {
    category: 'Science & Nature',
    difficulty: 'easy',
    question: 'What planet is known as the Red Planet?',
    correct_answer: 'Mars',
    incorrect_answers: ['Venus', 'Jupiter', 'Mercury'],
  },
  {
    category: 'Entertainment: Anime & Manga',
    difficulty: 'easy',
    question: 'In "Naruto", what is the name of Naruto\'s signature spiraling sphere attack?',
    correct_answer: 'Rasengan',
    incorrect_answers: ['Chidori', 'Amaterasu', 'Shinra Tensei'],
  },
  {
    category: 'General Knowledge',
    difficulty: 'easy',
    question: 'How many days are there in a leap year?',
    correct_answer: '366',
    incorrect_answers: ['365', '364', '367'],
  },
];

export async function fetchTriviaQuestion() {
  let item = null;
  try {
    const res = await fetch('https://opentdb.com/api.php?amount=1&type=multiple', {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.results) && data.results.length > 0) {
        item = data.results[0];
      }
    }
  } catch (err) {
    // Open Trivia DB rate limited or offline
  }

  if (!item) {
    item = FALLBACK_TRIVIA_QUESTIONS[Math.floor(Math.random() * FALLBACK_TRIVIA_QUESTIONS.length)];
  }

  const question = decodeHtmlEntities(item.question);
  const correctAnswer = decodeHtmlEntities(item.correct_answer);
  const incorrect = (item.incorrect_answers || []).map(decodeHtmlEntities);

  // Shuffle options
  const all = [correctAnswer, ...incorrect].sort(() => Math.random() - 0.5);
  const letters = ['A', 'B', 'C', 'D'];
  const options = all.map((opt, i) => `${letters[i]}) ${opt}`);
  const correctIndex = all.indexOf(correctAnswer);
  const correctLetter = letters[correctIndex] || 'A';

  return {
    success: true,
    category: decodeHtmlEntities(item.category),
    difficulty: item.difficulty,
    question,
    options,
    correctLetter,
    correctAnswer,
  };
}

// -------------------------------------------------------------
// 4. JOKES / FUN (JokeAPI + Official Joke API: Free)
// -------------------------------------------------------------
export async function fetchJoke() {
  // A. JokeAPI (safe-mode prevents inappropriate content)
  try {
    const res = await fetch('https://v2.jokeapi.dev/joke/Any?safe-mode&type=single,twopart', {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const data = await res.json();
      if (!data.error) {
        if (data.type === 'single' && data.joke) {
          return { success: true, type: 'single', jokeText: data.joke, category: data.category };
        }
        if (data.type === 'twopart' && data.setup && data.delivery) {
          return {
            success: true,
            type: 'twopart',
            setup: data.setup,
            delivery: data.delivery,
            jokeText: `${data.setup} ... ${data.delivery}`,
            category: data.category,
          };
        }
      }
    }
  } catch (err) {
    // Fallback
  }

  // B. Fallback to Official Joke API
  try {
    const fRes = await fetch('https://official-joke-api.appspot.com/random_joke', {
      signal: AbortSignal.timeout(2500),
    });
    if (fRes.ok) {
      const fData = await fRes.json();
      if (fData.setup && fData.punchline) {
        return {
          success: true,
          type: 'twopart',
          setup: fData.setup,
          delivery: fData.punchline,
          jokeText: `${fData.setup} ... ${fData.punchline}`,
          category: fData.type,
        };
      }
    }
  } catch (err) {
    // Both joke APIs failed
  }

  return { success: false, error: 'Could not fetch joke from online services' };
}

// -------------------------------------------------------------
// INTENT DETECTION & CONTEXT ENRICHMENT
// -------------------------------------------------------------

// Checks if the user message matches Weather, Anime, Trivia, Joke, or Wikipedia Fact
export function detectToolIntent(message, personaLocation = 'Delhi') {
  if (!message || typeof message !== 'string') return null;
  const text = message.trim();

  // 1. Weather Intent
  // e.g. "Delhi me mausam kaisa hai?", "weather report", "temperature kya hai", "aaj baarish hogi?"
  const weatherPattern = /\b(weather|mausam|temperature|baarish|rain|raining|thand|garmi|humidity|forecast|dhoop|kohra|fog)\b/i;
  if (weatherPattern.test(text)) {
    // Try to extract city: "in <city>", "<city> me", "<city> ka mausam"
    let city = personaLocation || 'Delhi';
    const cityInMatch = text.match(/\bin\s+([A-Za-z\s]+?)(?:\?|\.|$|\s+(?:today|now|tomorrow))/i);
    const cityMeMatch = text.match(/([A-Za-z]+)\s+(?:me|mein|ka|ki|ke)\s+(?:mausam|weather|temperature)/i);
    const cityBeforeWeather = text.match(/([A-Za-z]+)\s+weather/i);

    if (cityInMatch && cityInMatch[1]) {
      city = cityInMatch[1].trim();
    } else if (cityMeMatch && cityMeMatch[1]) {
      city = cityMeMatch[1].trim();
    } else if (cityBeforeWeather && cityBeforeWeather[1] && !['the', 'today', 'live', 'real'].includes(cityBeforeWeather[1].toLowerCase())) {
      city = cityBeforeWeather[1].trim();
    }

    return { tool: 'weather', query: city };
  }

  // 2. Joke / Fun Intent
  // e.g. "ek joke sunao", "tell me a joke", "hasao mujhe", "koi funny baat sunao", "koi chutkula"
  const jokePattern = /\b(joke|chutkula|hasao|funny|hansi|laugh|tell me a joke|koi joke)\b/i;
  if (jokePattern.test(text)) {
    return { tool: 'joke' };
  }

  // 3. Trivia / Quiz Intent
  // e.g. "chalo quiz khele", "trivia pucho", "sawaal pucho", "ask me a question", "test my knowledge"
  const triviaPattern = /\b(trivia|quiz|sawaal pucho|question pucho|quiz khelein|quiz khele|test my knowledge|sawaal-jawab)\b/i;
  if (triviaPattern.test(text)) {
    return { tool: 'trivia' };
  }

  // 4. Anime Intent
  // e.g. "anime recommend karo", "top anime batao", "Jujutsu Kaisen kaisa hai", "Death Note ki story"
  const animeKeywords = /\b(anime|manga|otaku|jujutsu kaisen|naruto|one piece|death note|attack on titan|aot|demon slayer|frieren|dragon ball|bleach|solo leveling|chainsaw man|tokyo ghoul|haikyuu|hunter x hunter|steins gate|my hero academia)\b/i;
  if (animeKeywords.test(text)) {
    const isRec = /\b(recommend|recommendation|top|best|kuch naya|sugggest|koi accha)\b/i.test(text);
    // Extract anime name if not generic recommendation
    let animeName = 'Naruto';
    const specificMatch = text.match(/(?:about|discuss|kaisa hai|dekha hai|story of|plot of|regarding)\s+([A-Za-z0-9\s]+?)(?:\?|\.|$|\s+(?:anime|kaisa|batao))/i)
      || text.match(/\b(jujutsu kaisen|naruto|one piece|death note|attack on titan|demon slayer|frieren|dragon ball|bleach|solo leveling|chainsaw man|tokyo ghoul|haikyuu|hunter x hunter|steins gate)\b/i);

    if (specificMatch && specificMatch[1]) {
      animeName = specificMatch[1].trim();
    } else if (!isRec) {
      // Clean up common prompt words to get title
      const cleaned = text.replace(/\b(anime|batao|kaisa hai|kya hai|dekha hai|hai|ke baare me|tell me about)\b/gi, '').trim();
      if (cleaned.length > 2) animeName = cleaned;
    }

    return { tool: 'anime', query: animeName, isRecommendation: isRec };
  }

  // 5. Wikipedia Fact Intent
  // e.g. "Quantum computing kya hai?", "Albert Einstein kaun the?", "Eiffel Tower kahan hai?", "explain black hole"
  const factPrefixPattern = /(?:who is|what is|tell me about|explain|meaning of|history of|facts about|wikipedia summary of|tell me facts about)\s+([A-Za-z0-9\s]+?)(?:\?|\.|$)/i;
  const factSuffixPattern = /([A-Za-z0-9\s]+?)\s+(?:kya hai|kya hota hai|kaun the|kaun hai|kahan hai|ke baare me batao)(?:\?|\.|$)/i;

  const prefixMatch = text.match(factPrefixPattern);
  const suffixMatch = text.match(factSuffixPattern);
  const matchedTopic = prefixMatch?.[1] || suffixMatch?.[1];

  if (matchedTopic && matchedTopic.trim().length > 2) {
    const topic = matchedTopic.trim().replace(/\b(in hindi|in detail|detail me|short me)\b/gi, '').trim();
    if (topic && !['tum', 'main', 'you', 'me', 'we', 'love', 'yeh', 'ye'].includes(topic.toLowerCase())) {
      return { tool: 'wiki', query: topic };
    }
  }

  return null;
}

// Executes detected tool and formats instruction snippet for the persona prompt
export async function getEnrichedContext(message, persona = {}) {
  const personaLocation = persona.location || 'Delhi';
  const partnerName = persona.user_name || 'Daksh';
  const intent = detectToolIntent(message, personaLocation);
  if (!intent) return null;

  try {
    if (intent.tool === 'weather') {
      const weather = await fetchWeather(intent.query);
      if (weather.success) {
        return {
          type: 'weather',
          summary: `${weather.city}: ${weather.temperature}, ${weather.condition}`,
          contextText: [
            `[REAL-TIME LIVE WEATHER TOOL DATA (verified from Open-Meteo)]:`,
            `- Location: ${weather.city}, ${weather.country}`,
            `- Current Temperature: ${weather.temperature} (Feels like: ${weather.feels_like})`,
            `- Condition: ${weather.condition}`,
            `- Humidity: ${weather.humidity}, Wind: ${weather.wind_speed}`,
            `Instruction: Tell ${partnerName} the real-time weather of ${weather.city} naturally in your sweet Hinglish companion voice. Mention the temperature and condition casually.`,
          ].join('\n'),
        };
      }
    }

    if (intent.tool === 'anime') {
      const anime = await fetchAnime(intent.query, intent.isRecommendation);
      if (anime.success) {
        if (anime.isRecommendation && anime.recommendations) {
          const recText = anime.recommendations.map((r, i) => `${i + 1}. ${r.title} (Score: ${r.score}, Genres: ${r.genres})`).join('; ');
          return {
            type: 'anime',
            summary: `Anime recommendations: ${anime.recommendations.map((r) => r.title).join(', ')}`,
            contextText: [
              `[LIVE ANIME TOOL DATA (verified from MyAnimeList/AniList)]:`,
              `- Top Recommendations: ${recText}`,
              `Instruction: Recommend these anime to ${partnerName} with enthusiasm in your sweet Hinglish voice! Ask if he has watched any of them.`,
            ].join('\n'),
          };
        }

        return {
          type: 'anime',
          summary: `${anime.title}: Score ${anime.score}, ${anime.genres}`,
          contextText: [
            `[LIVE ANIME TOOL DATA (verified from MyAnimeList/AniList)]:`,
            `- Title: ${anime.title}`,
            `- MAL/AniList Score: ${anime.score}`,
            `- Episodes: ${anime.episodes}, Status: ${anime.status || 'Finished'}`,
            `- Genres: ${anime.genres}`,
            `- Synopsis: ${anime.synopsis}`,
            `Instruction: Discuss ${anime.title} with ${partnerName} in your friendly Hinglish voice. Mention its rating/vibe and ask his thoughts on it!`,
          ].join('\n'),
        };
      }
    }

    if (intent.tool === 'trivia') {
      const trivia = await fetchTriviaQuestion();
      if (trivia.success) {
        return {
          type: 'trivia',
          summary: `Trivia: ${trivia.question}`,
          contextText: [
            `[LIVE TRIVIA QUIZ TOOL DATA (from Open Trivia DB)]:`,
            `- Category: ${trivia.category} (${trivia.difficulty})`,
            `- Question: ${trivia.question}`,
            `- Options: ${trivia.options.join(' | ')}`,
            `- Correct Answer: Option ${trivia.correctLetter} (${trivia.correctAnswer})`,
            `Instruction: Play a playful trivia quiz with ${partnerName}! Ask him this question enthusiastically in Hinglish, clearly list the options (A, B, C, D), and challenge him playfully to guess the right answer. DO NOT reveal the correct answer yet!`,
          ].join('\n'),
        };
      }
    }

    if (intent.tool === 'joke') {
      const joke = await fetchJoke();
      if (joke.success) {
        return {
          type: 'joke',
          summary: `Joke: ${joke.jokeText?.slice(0, 50)}...`,
          contextText: [
            `[LIVE JOKE TOOL DATA (from JokeAPI)]:`,
            `- Joke content: "${joke.jokeText}"`,
            `Instruction: Tell this joke to ${partnerName} in your charming, playful Hinglish texting style. Add a cute giggle or playful remark!`,
          ].join('\n'),
        };
      }
    }

    if (intent.tool === 'wiki') {
      const wiki = await fetchWikipediaSummary(intent.query);
      if (wiki.success) {
        return {
          type: 'wiki',
          summary: `Wiki: ${wiki.title} - ${wiki.description}`,
          contextText: [
            `[LIVE WIKIPEDIA FACT TOOL DATA (verified)]:`,
            `- Topic: ${wiki.title}`,
            `- Description: ${wiki.description}`,
            `- Summary: ${wiki.extract}`,
            `Instruction: Explain this topic to ${partnerName} in simple, smart, and friendly Hinglish. Break down the factual information clearly without sounding like a robotic encyclopedia.`,
          ].join('\n'),
        };
      }
    }
  } catch (err) {
    console.error('[publicApis] getEnrichedContext error:', err.message);
  }

  return null;
}
