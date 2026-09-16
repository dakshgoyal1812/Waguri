// Mock OpenAI-compatible server (stands in for OpenRouter) for the failover tests
// (PRD milestone 6: "simulate 429s, confirm the switch is invisible").
//
// Behavior via env:
//   MOCK_PORT=9090
//   MOCK_FAIL_KEYS=k1,k2        these keys get MOCK_FAIL_STATUS (default 429)
//   MOCK_FAIL_STATUS=429
//   MOCK_FAIL_BODY=Rate limit exceeded: free-models-per-day
//   MOCK_ERROR_KEYS=k5          these get HTTP 500 (upstream failure case)
//   MOCK_DELAY_MS=0             artificial latency
// Success reply echoes the [memory ...] chunks it saw in the system prompt so the
// RAG test can assert what reached the model.
import http from 'node:http';

const port = parseInt(process.env.MOCK_PORT || '9090', 10);
const failKeys = (process.env.MOCK_FAIL_KEYS || '').split(',').filter(Boolean);
const errorKeys = (process.env.MOCK_ERROR_KEYS || '').split(',').filter(Boolean);
const failStatus = parseInt(process.env.MOCK_FAIL_STATUS || '429', 10);
const failBody = process.env.MOCK_FAIL_BODY || 'Rate limit exceeded: free-models-per-minute. Try again in 20s.';
const delayMs = parseInt(process.env.MOCK_DELAY_MS || '0', 10);

const stats = { requests: 0, perKey: {} };

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/__stats') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(stats));
    return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    stats.requests++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const auth = req.headers['authorization'] || '';
    const key = auth.startsWith('Bearer ') ? auth.slice(7) : '(none)';
    stats.perKey[key] = (stats.perKey[key] || 0) + 1;

    const json = (code, obj) => {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = code;
      res.end(JSON.stringify(obj));
    };

    if (failKeys.includes(key)) {
      return json(failStatus, { error: { message: failBody } });
    }
    if (errorKeys.includes(key)) {
      return json(500, { error: { message: 'upstream model unavailable (mock)' } });
    }

    let systemPrompt = '';
    try { systemPrompt = (JSON.parse(body).messages || []).find((m) => m.role === 'system')?.content || ''; } catch {}
    const memories = [...systemPrompt.matchAll(/^\[memory \d+\] (.*)$/gm)].map((m) => m[1]);
    const emotion = /^\s*\[emotion\]/m.test(systemPrompt) ? '' : '';
    json(200, {
      id: 'mock-cpl-' + stats.requests,
      choices: [{ index: 0, message: { role: 'assistant', content: `[happy] MOCK-OK memories=${memories.length} SAW::${memories.join('||')}` } }],
      usage: { total_tokens: 10 },
      _debug: { key_tail: key.slice(-6), emotion },
    });
  });
});

server.listen(port, () => console.log(`[mock-openrouter] on :${port}`));
