// Master test runner executing PRD Milestones 1 through 6
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const tests = [
  { name: 'Milestone 1: Backend skeleton & core chat', file: 'test/run-m1.js' },
  { name: 'Milestone 2: pgvector RAG memory recall', file: 'test/run-m2.js' },
  { name: 'Milestone 3: Key Pool Manager & LLM failover', file: 'test/run-m3.js' },
  { name: 'Milestone 4: Multi-provider TTS pool & regional rotation', file: 'test/run-m4.js' },
  { name: 'Milestone 6: Load-test failover & zero-downtime invisibility', file: 'test/run-m6.js' },
  { name: 'Account Chat Isolation & AES-256-GCM Encryption', file: 'test/test-account-chat-isolation.js' },
  { name: 'PWA Web Push Notifications & Autonomous Scheduler', file: 'test/test-push-notifications.js' },
];

console.log('====================================================');
console.log('   Waguri Persona-Twin: All Milestones Verification  ');
console.log('====================================================\n');

let failed = 0;

for (const t of tests) {
  process.stdout.write(`► Running ${t.name} (${t.file})... `);
  const start = Date.now();
  const res = spawnSync(process.execPath, [t.file], {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf-8',
  });
  const dur = Date.now() - start;

  if (res.status === 0) {
    console.log(`PASS (${dur}ms)`);
  } else {
    console.log(`FAILED (${dur}ms)`);
    console.error(res.stdout);
    console.error(res.stderr);
    failed++;
  }
}

console.log('\n====================================================');
if (failed === 0) {
  console.log('ALL MILESTONE TEST SUITES PASSED CLEANLY! 🎉');
  process.exit(0);
} else {
  console.error(`FAILED: ${failed} milestone suite(s) failed.`);
  process.exit(1);
}
