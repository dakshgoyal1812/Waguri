// Mock Azure Speech TTS REST endpoint for the TTS rotation test (PRD section 9.4).
// GET /__stats returns call counts per key. Behavior mirrors mock-openrouter.
import http from 'node:http';

const port = parseInt(process.env.MOCK_PORT || '9099', 10);
const failKeys = (process.env.MOCK_FAIL_KEYS || '').split(',').filter(Boolean);
const failStatus = parseInt(process.env.MOCK_FAIL_STATUS || '429', 10);

const stats = { requests: 0, perKey: {} };

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/__stats') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(stats));
    return;
  }
  req.on('data', () => {});
  req.on('end', () => {
    stats.requests++;
    const key = req.headers['ocp-apim-subscription-key'] || '(none)';
    stats.perKey[key] = (stats.perKey[key] || 0) + 1;
    if (failKeys.includes(key)) {
      res.statusCode = failStatus;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'mock azure quota exceeded' } }));
      return;
    }
    // Minimal valid-ish MP3 frame payload
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Requestid', 'mock-azure-' + stats.requests);
    res.end(Buffer.from([0xff, 0xf3, 0x40, 0xc4, 0x00, 0x00, 0x00, 0x00]));
  });
});

server.listen(port, () => console.log(`[mock-azure] on :${port}`));
