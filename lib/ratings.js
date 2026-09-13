// lib/ratings.js
// Validation/sanitisation shared by the recommendation ingest endpoint (writes
// drafts) and the confirm endpoint (writes the live rating). Keeps the accepted
// shape of a rating identical whichever door it comes through.

// The scorecard rubric — same set fetch-data.js / scorecard.html understand.
export const VALID_GRADES = ['A', 'B', 'C', '?', 'DNR', 'D', 'E', 'F'];

// Map a few common spellings onto the canonical grade, mirroring the GRADE_NORM
// in scripts/fetch-data.js. Returns null if it isn't a recognised grade.
export function normalizeGrade(g) {
  const raw = String(g ?? '').trim().toUpperCase();
  const alias = {
    'NO RESPONSE': 'DNR', 'NO_RESPONSE': 'DNR', 'DID NOT RESPOND': 'DNR',
    'NOT SCORED': '?', 'NOT_SCORED': '?', 'TBC': '?',
  };
  const g2 = alias[raw] ?? raw;
  return VALID_GRADES.includes(g2) ? g2 : null;
}

// ≤5 non-empty trimmed bullet strings.
export function sanitizeBullets(bullets) {
  if (!Array.isArray(bullets)) return [];
  return bullets
    .map(b => String(b ?? '').trim())
    .filter(Boolean)
    .slice(0, 5);
}

// ≤6 sources of the form { title, url } with an http(s) URL. Anything without a
// valid absolute URL is dropped, so nothing on the site links to a bad target.
export const MAX_SOURCES = 6;
export function sanitizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  const out = [];
  for (const s of sources) {
    if (!s) continue;
    const url   = String(s.url ?? '').trim();
    const title = String(s.title ?? '').trim();
    let parsed;
    try { parsed = new URL(url); } catch { continue; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    out.push({ title: title || parsed.hostname, url });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}
