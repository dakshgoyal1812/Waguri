// Boot-time persona seeding: POST /api/persona with the PRD section 15 bible.
// Usage: node scripts/seed-persona.js [BASE_URL]
const base = process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:8080';
const { waguriPersona } = await import('../src/personaSeed.js');

const res = await fetch(`${base.replace(/\/$/, '')}/api/persona`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(waguriPersona),
});
const body = await res.json();
if (!res.ok) {
  console.error('SEED FAILED:', res.status, JSON.stringify(body));
  process.exit(1);
}
console.log('PERSONA SEEDED:', JSON.stringify({ id: body.id, name: body.name, location: body.location }));
