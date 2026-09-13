// scripts/import-ratings.js
// One-time (idempotent) seed of the CURRENT sheet grades into Supabase mp_ratings,
// so existing ratings become the baseline that the review page and manual editing
// build on. Safe to re-run: it upserts by constituency.
//
// Reads data.json (build it first with `npm run build`), then for every seat that
// has a real grade (A–F or DNR — '?'/unscored seats are left to the sheet/agent),
// writes the current MP's grade + bullets + evidence into mp_ratings.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-ratings.js
//   add --dry-run to preview without writing.

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');

// Convenience: if the Supabase vars aren't already in the environment, load them
// from a local .dev.vars file (the same file wrangler uses for `npm run dev`), so
// you don't have to paste the service-role key on the command line. Existing
// environment variables always win.
function loadDevVars() {
  let raw;
  try { raw = readFileSync('.dev.vars', 'utf8'); } catch { return; }
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq === -1) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}
loadDevVars();

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  console.error('(either as environment variables or in a local .dev.vars file).');
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync('data.json', 'utf8'));
} catch {
  console.error('Error: data.json not found. Run `npm run build` first.');
  process.exit(1);
}

const { hexMap = [], candidates = {} } = data;

// Grades worth seeding — a real assessment, not "not scored".
const REAL_GRADES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'DNR']);

function stripHonorifics(s) {
  return (s || '').replace(/^(The\s+)?(Rt\.?\s+Hon\.?\s+)?(Sir|Dame|Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss|Prof(?:essor)?)\s+/i, '').trim();
}
function normName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

const rows = [];
for (const hex of hexMap) {
  const grade = (hex.asvaGrade || '').toUpperCase();
  if (!hex.mpName || !REAL_GRADES.has(grade)) continue;

  // Find the current MP's card to lift bullets + evidence.
  const list = candidates[hex.name] || [];
  const mpNorm = normName(stripHonorifics(hex.mpName));
  const cand = list.find(c => c.current_mp) ||
               list.find(c => normName(stripHonorifics(c.name)) === mpNorm) || {};

  const bullets = [];
  for (let i = 1; i <= 5; i++) { const b = (cand[`bullet${i}`] || '').trim(); if (b) bullets.push(b); }

  const sources = [];
  for (let i = 1; i <= 6; i++) {
    const t = (cand[`evidence${i}`] || '').trim();
    const u = (cand[`evidence${i}_url`] || '').trim();
    if (u) sources.push({ title: t || '', url: u });
  }

  rows.push({
    constituency: hex.name,
    mp_name:      hex.mpName,
    grade,
    bullets,
    sources,
    updated_by:   'sheet-import',
  });
}

console.log(`Prepared ${rows.length} rating(s) to seed from data.json.`);
if (DRY_RUN) {
  for (const r of rows.slice(0, 10)) console.log(`  ${r.grade}  ${r.mp_name} — ${r.constituency} (${r.bullets.length} bullets, ${r.sources.length} sources)`);
  if (rows.length > 10) console.log(`  … and ${rows.length - 10} more`);
  console.log('Dry run — nothing written.');
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
let written = 0;
// Upsert in chunks so a large seed doesn't hit request-size limits.
for (let i = 0; i < rows.length; i += 100) {
  const chunk = rows.slice(i, i + 100);
  const { error } = await supabase.from('mp_ratings').upsert(chunk, { onConflict: 'constituency' });
  if (error) {
    console.error('Upsert error:', error.message || error);
    process.exit(1);
  }
  written += chunk.length;
  console.log(`  upserted ${written}/${rows.length}`);
}
console.log(`Done. Seeded ${written} rating(s) into mp_ratings.`);
