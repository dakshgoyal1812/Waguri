// Security hardening regression suite.
// Spawns the backend in PRODUCTION mode (no WAGURI_TEST) and proves the
// historical bypasses stay closed:
//   1. Anonymous chat / data access            -> 401
//   2. x-test-user-id identity spoofing        -> 401 (test-only escape hatch)
//   3. Claimed admin email on admin routes     -> 403 (the "type anything" bypass)
//   4. Unauthenticated memory vault access     -> 401
//   5. Wrong vault password                    -> 401, right password -> vault token
//   6. Vault token without a verified session  -> 401 (token alone is not enough)
//   7. Cron routes without ADMIN_TOKEN         -> 401
//   8. Public: /api/health stays open          -> 200
import { startProc, stopProc, waitFor, check, done, TEST_ENV } from './util.js';

const BACK = 'http://127.0.0.1:8091';
const PROD_ENV = { ...TEST_ENV };
delete PROD_ENV.WAGURI_TEST; // production-like: no test identities

let backend;
try {
  backend = await startProc('backend-prod-mode', 'node', ['src/server.js'], {
    ...PROD_ENV,
    PORT: '8091',
    LLM_PROVIDER_TIERS: 'openrouter',
    LLM_BASE_URL_OPENROUTER: 'http://127.0.0.1:9099/v1', // unreachable; chat would 502 — irrelevant, auth gates first
    LLM_MODELS_OPENROUTER: 'mock-model-a',
    OPENROUTER_API_KEYS: 'sk-test-key',
    TTS_PROVIDERS: 'none',
  }, (l) => l.includes('[waguri-backend] listening'));
  await waitFor(`${BACK}/api/health`);

  // 1. Anonymous access to every sensitive route must be rejected
  const chatRes = await fetch(`${BACK}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'bypass attempt' }),
  });
  check('POST /api/chat without session -> 401', chatRes.status === 401, `status=${chatRes.status}`);

  const histRes = await fetch(`${BACK}/api/conversations/latest`);
  check('GET /api/conversations/latest without session -> 401', histRes.status === 401, `status=${histRes.status}`);

  const alarmsRes = await fetch(`${BACK}/api/alarms?user_id=dakshgoyal1812@gmail.com`);
  check('GET /api/alarms without session -> 401', alarmsRes.status === 401, `status=${alarmsRes.status}`);

  // 2. Test-mode identity spoofing must NOT work in production mode
  const spoofRes = await fetch(`${BACK}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user-id': 'victim@example.com' },
    body: JSON.stringify({ message: 'spoof attempt' }),
  });
  check('x-test-user-id spoofing rejected in prod mode -> 401', spoofRes.status === 401, `status=${spoofRes.status}`);

  // 3. Claimed admin email must NOT grant admin API access (the fixed bypass)
  const claimedAdd = await fetch(`${BACK}/api/admin/allowed-users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'attacker@example.com', adminEmail: 'dakshgoyal1812@gmail.com' }),
  });
  check('POST allowed-users with CLAIMED adminEmail -> rejected (401 unauthenticated)', [401, 403].includes(claimedAdd.status), `status=${claimedAdd.status}`);

  const claimedList = await fetch(`${BACK}/api/admin/allowed-users?adminEmail=dakshgoyal1812@gmail.com`);
  check('GET allowed-users with CLAIMED adminEmail -> 403', claimedList.status === 403, `status=${claimedList.status}`);

  const testIdInProd = await fetch(`${BACK}/api/admin/allowed-users`, {
    headers: { 'x-test-user-id': 'dakshgoyal1812@gmail.com' },
  });
  check('x-test-user-id does not grant admin in prod mode -> rejected (401/403)', [401, 403].includes(testIdInProd.status), `status=${testIdInProd.status}`);

  const personaWrite = await fetch(`${BACK}/api/persona`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Hacked' }),
  });
  check('POST /api/persona without auth -> 403', personaWrite.status === 403, `status=${personaWrite.status}`);

  // 4. Memory vault is locked without credentials
  const memRes = await fetch(`${BACK}/api/memory`);
  check('GET /api/memory without session -> 401', memRes.status === 401, `status=${memRes.status}`);

  // 5. Unlock endpoint: wrong password rejected, correct password mints a token
  const badUnlock = await fetch(`${BACK}/api/memory/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong-password' }),
  });
  check('POST /api/memory/unlock wrong password -> 401', badUnlock.status === 401, `status=${badUnlock.status}`);

  const goodUnlock = await fetch(`${BACK}/api/memory/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Daksh@2009' }),
  });
  const unlockData = await goodUnlock.json();
  check('POST /api/memory/unlock correct password -> 200 + vault token',
    goodUnlock.status === 200 && typeof unlockData.vault_token === 'string' && unlockData.vault_token.length > 20,
    JSON.stringify(unlockData));

  // 6. The vault token alone (no verified session) must NOT open the vault
  const tokenOnly = await fetch(`${BACK}/api/memory`, {
    headers: { 'x-vault-token': unlockData.vault_token || '' },
  });
  check('GET /api/memory with vault token but NO session -> 401', tokenOnly.status === 401, `status=${tokenOnly.status}`);

  // 7. Cron/maintenance routes require the ADMIN_TOKEN
  const triggerAuto = await fetch(`${BACK}/api/push/trigger-auto`);
  check('POST /api/push/trigger-auto without token -> 401', triggerAuto.status === 401, `status=${triggerAuto.status}`);

  const noTokPool = await fetch(`${BACK}/api/keypool/status`);
  check('GET /api/keypool/status without token -> 401', noTokPool.status === 401, `status=${noTokPool.status}`);

  // 8. Public endpoints stay public
  const healthRes = await fetch(`${BACK}/api/health`);
  check('GET /api/health stays public -> 200', healthRes.status === 200, `status=${healthRes.status}`);

  // 9. Test mode (WAGURI_TEST=1) still permits the test identity escape hatch
  // (covered by run-m1/m4/m6 which exercise chat with default test identity).
} catch (e) {
  check('harness completed without error', false, e.message);
} finally {
  await stopProc(backend);
}
done('test-security-hardening.js');
