// Splits text into overlapping chunks for memory_vectors (PRD section 8 step 6:
// each exchange becomes fresh embedding chunk(s)).
export function chunkText(text, { size = 500, overlap = 50 } = {}) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks = [];
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
  let current = '';
  for (const s of sentences) {
    if (current.length + s.length > size && current) {
      chunks.push(current.trim());
      current = current.slice(Math.max(0, current.length - overlap));
    }
    current += s;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
