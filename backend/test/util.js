// Shared test harness: spawn processes with env, wait for readiness, assert, cleanup.
import { spawn } from 'node:child_process';

export function startProc(name, cmd, args, env, readyProbe) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const logs = [];
    const collect = (d) => {
      const line = d.toString();
      logs.push(line);
      if (readyProbe && readyProbe(line)) {
        readyProbe = null;
        resolve({ child, logs, name });
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('exit', (code) => {
      if (readyProbe) reject(new Error(`${name} exited early (code ${code}):\n${logs.join('')}`));
    });
  });
}

export function stopProc(p) {
  if (!p) return;
  return new Promise((resolve) => {
    p.child.on('exit', resolve);
    if (process.platform === 'win32') {
      // /T kills the process tree — without it the shell wrapper dies and orphans node
      spawn('taskkill', ['/F', '/T', '/PID', String(p.child.pid)]);
      setTimeout(resolve, 2000);
    } else {
      p.child.kill();
      setTimeout(() => { try { p.child.kill('SIGKILL'); } catch {} ; resolve(); }, 2000);
    }
  });
}

export async function waitFor(url, timeoutMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

let failures = 0;
export function check(label, cond, detail = '') {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
}
export function done(file) {
  console.log(failures === 0 ? `\n=== ${file}: ALL PASS ===` : `\n=== ${file}: ${failures} FAILURE(S) ===`);
  process.exit(failures === 0 ? 0 : 1);
}

export const TEST_ENV = {
  WAGURI_TEST: '1',
  APP_ENCRYPTION_KEY: 'a'.repeat(64),
  ADMIN_TOKEN: 'test-admin-token',
  STORAGE_ADAPTER: 'memory',
  EMBEDDINGS_PROVIDER: 'hash-test',
  EMBEDDINGS_DIM: '384',
};
