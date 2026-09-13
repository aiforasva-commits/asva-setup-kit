// scripts/fetch-data.js
// Runs at build time:
//   1. Fetches Candidates + Constituencies tabs from the published Google Sheet
//   2. Fetches 2024 GE results from Parliament's election results API (baseline)
//   3. Writes data.json with the complete hexMap
//
// By-elections are handled manually: mark the new MP with 'C' in the sheet and
// fill the majority + by-election date columns — the sheet marker overrides the
// GE baseline (see the hexMap build below).
//
// In Google Sheets: File → Share → Publish to web → publish each tab as CSV.
// The published-to-web URLs are committed as defaults below so the build always
// has them (non-sensitive URLs, and this repo is private). Set the matching
// GOOGLE_SHEET_*_URL env vars to override — e.g. to point the build at a test
// sheet. They are intentionally NOT Cloudflare dashboard vars/secrets: secrets
// aren't exposed at build time, and a wrangler.toml [vars] copy collides with
// the Function's runtime bindings on deploy.

import { writeFileSync, readFileSync } from 'fs';

const CANDIDATES_URL     = process.env.GOOGLE_SHEET_CANDIDATES_URL
  || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQtB8nRucg3b1UmBPL0dDveJIch6jsBWTNSHkaxt7RooNzibEMh7AeINTNrMP-u1tdySdiz-eKFk1Ra/pub?gid=0&single=true&output=csv';
const CONSTITUENCIES_URL = process.env.GOOGLE_SHEET_CONSTITUENCIES_URL
  || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQtB8nRucg3b1UmBPL0dDveJIch6jsBWTNSHkaxt7RooNzibEMh7AeINTNrMP-u1tdySdiz-eKFk1Ra/pub?gid=1621774169&single=true&output=csv';

if (!CANDIDATES_URL || !CONSTITUENCIES_URL) {
  console.error(
    'Error: GOOGLE_SHEET_CANDIDATES_URL and GOOGLE_SHEET_CONSTITUENCIES_URL must both be set.'
  );
  process.exit(1);
}

// ── CSV parser (handles quoted fields containing commas or newlines) ───────────
function parseCSV(raw) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch   = raw[i];
    const next = raw[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"')             { inQuotes = false; }
      else                             { field += ch; }
    } else {
      if      (ch === '"')  { inQuotes = true; }
      else if (ch === ',')  { row.push(field); field = ''; }
      else if (ch === '\r' && next === '\n') {
        row.push(field); field = '';
        rows.push(row);  row = []; i++;
      }
      else if (ch === '\n' || ch === '\r') {
        row.push(field); field = '';
        rows.push(row);  row = [];
      }
      else { field += ch; }
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function fetchCSV(url, label) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Error: Failed to fetch ${label} (${res.status} ${res.statusText})`);
    process.exit(1);
  }
  // Decode the body explicitly as UTF-8. Some build runtimes decode a
  // charset-less CSV response as Latin-1, which double-encodes accented names
  // (e.g. "Dáire" → "DÃ¡ire"); reading the raw bytes and decoding UTF-8
  // ourselves keeps names correct regardless of the runtime's default.
  const buf = await res.arrayBuffer();
  return new TextDecoder('utf-8').decode(new Uint8Array(buf));
}

// Repairs UTF-8-decoded-as-Latin-1 mojibake (e.g. "DÃ¡ire" → "Dáire") that an
// upstream export can bake into its text. Only rewrites a string that is made
// entirely of Latin-1 characters, contains a high one, and decodes as clean
// UTF-8 when read back as bytes — so a correctly-encoded name is left untouched.
function fixMojibake(s) {
  if (!s) return s;
  if (![...s].every(c => c.charCodeAt(0) <= 0xFF)) return s;
  if (!s.split('').some(c => c.charCodeAt(0) >= 0x80)) return s;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(s, 'latin1'));
  } catch {
    return s;   // reading it back as bytes isn't valid UTF-8 → it wasn't mojibake
  }
}

// Normalise a name or constituency for fuzzy matching
function normName(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ŵ]/g, 'w')
    .replace(/[ŷ]/g, 'y')
    .replace(/[''`]/g, "'")
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9 ']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Strip parliamentary honorifics before name comparison
function stripHonorifics(s) {
  return (s || '')
    .replace(/^(The\s+)?(Rt\.?\s+Hon\.?\s+)?(Sir|Dame|Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss|Prof(?:essor)?)\s+/i, '')
    .trim();
}



// ── Load hex layout (committed static file) ───────────────────────────────────
let hexLayout;
try {
  hexLayout = JSON.parse(readFileSync('hex-layout.json', 'utf8'));
  console.log(`hex-layout.json loaded: ${hexLayout.length} hexagons`);
} catch (e) {
  console.error('Error: hex-layout.json not found or invalid — cannot build hexMap');
  process.exit(1);
}

// ── General Election baseline — UPDATE THIS after each new GE ────────────────
// The number in the URL is the GE number: 6 = 2024, 7 = next election, etc.
// Find the new URL at: https://electionresults.parliament.uk
const ELECTION_BASELINE_URL = 'https://electionresults.parliament.uk/general-elections/6/candidacies.csv';

async function fetch2024Results() {
  const map = {};
  try {
    const text = await fetchCSV(ELECTION_BASELINE_URL, 'GE baseline results');
    const [_header, ...rows] = parseCSV(text);
    for (const row of rows) {
      const constituencyName = (row[18] || '').trim();
      const familyName       = (row[33] || '').trim();
      const givenName        = (row[34] || '').trim();
      const partyAbbr        = (row[40] || '').trim();
      const majority         = parseInt(row[51] || '0', 10) || 0;
      const resultPos        = (row[52] || '').trim();
      if (resultPos !== '1' || !constituencyName) continue;
      map[normName(constituencyName)] = {
        mpName:  fixMojibake(`${givenName} ${familyName}`.trim()),
        party:   partyAbbr || 'Ind',
        majority,
      };
    }
    console.log(`2024 GE results: ${Object.keys(map).length} winners fetched`);
  } catch (e) {
    console.warn(`Warning: Could not fetch 2024 GE results — ${e.message}`);
  }
  return map;
}

// ── Confirmed ASVA ratings from Supabase (optional overlay) ───────────────────
// If SUPABASE_URL + SUPABASE_ANON_KEY are set at build time, confirmed ratings
// produced by the MP-rating agent (see docs/mp-rating-agent.md) override the
// sheet grade for the current MP in each seat, and supply that MP's bullets and
// evidence. Without these vars the build behaves exactly as before (sheet only),
// so the overlay can be adopted incrementally. The anon key is sufficient —
// mp_ratings grants public SELECT (grades are public) and nothing else.
const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

async function fetchConfirmedRatings() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.log('Supabase ratings overlay: skipped (SUPABASE_URL / SUPABASE_ANON_KEY not set)');
    return [];
  }
  try {
    const base = SUPABASE_URL.replace(/\/$/, '');
    const res  = await fetch(
      `${base}/rest/v1/mp_ratings?select=constituency,mp_name,grade,bullets,sources,updated_at`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (!res.ok) {
      console.warn(`Supabase ratings overlay: fetch failed (${res.status} ${res.statusText}) — using sheet grades only`);
      return [];
    }
    const rows = await res.json();
    console.log(`Supabase ratings overlay: ${Array.isArray(rows) ? rows.length : 0} confirmed rating(s) fetched`);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn(`Supabase ratings overlay: ${e.message} — using sheet grades only`);
    return [];
  }
}

// ── Fetch everything in parallel ──────────────────────────────────────────────
const [candidatesText, constituenciesText, ge2024, confirmedRatings] = await Promise.all([
  fetchCSV(CANDIDATES_URL,     'Candidates'),
  fetchCSV(CONSTITUENCIES_URL, 'Constituencies'),
  fetch2024Results(),
  fetchConfirmedRatings(),
]);

// ── Parse Constituencies tab ──────────────────────────────────────────────────
const [_conHeader, ...conRows] = parseCSV(constituenciesText);
const constituencies = conRows
  .map(row => (row[0] || '').trim())
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  .map(name => ({ name }));

// ── Parse Candidates tab ──────────────────────────────────────────────────────
const [candHeaderRow, ...candRows] = parseCSV(candidatesText);

// Find key columns by header name so the sheet column order doesn't matter
const hdr = candHeaderRow.map(h => (h || '').trim().toLowerCase());

// Return the first header column matching any of the given strings/regexes/predicates,
// or `fallback` if none match. Lets columns be inserted without breaking the mapping.
function findCol(fallback, ...matchers) {
  for (const m of matchers) {
    const idx = hdr.findIndex(h => {
      if (m instanceof RegExp)      return m.test(h);
      if (typeof m === 'function')  return m(h);
      return h === m;
    });
    if (idx >= 0) return idx;
  }
  return fallback;
}

// The leading block (constituency … evidence 3 URL) has a stable position.
const COL = {
  constituency: 0,
  name:         1,
  party:        2,
  grade:        3,
  b1: 4, b2: 5, b3: 6, b4: 7, b5: 8,
  ev1: 9, ev1url: 10, ev2: 11, ev2url: 12, ev3: 13, ev3url: 14,
};
// Fourth evidence column + its URL — added later, so locate it by header (with the
// most likely inserted-after-ev3url positions as a fallback).
COL.ev4    = findCol(15, 'evidence4', 'evidence 4', h => /evidence\s*4\b/.test(h) && !/(url|link)/.test(h));
COL.ev4url = findCol(16, 'evidence4url', 'evidence 4 url', 'evidence4 url', h => /evidence\s*4\b/.test(h) && /(url|link)/.test(h));
// Everything after the evidence block shifts when columns are inserted, so detect by
// header and fall back to positions relative to the last evidence column.
COL.lastUpdated    = findCol(Math.max(COL.ev4url, 14) + 1, /last\s*updated/, /date\s*updated/, /^updated$/);
COL.currentMp      = findCol(COL.lastUpdated + 1, 'currentmp', 'current_mp', 'current mp');
COL.majority       = findCol(COL.lastUpdated + 2, 'majority');
COL.byelectiondate = findCol(COL.lastUpdated + 3, 'byelectiondate', 'byelection date', 'by-election date', 'by election date');

console.log(`Candidates CSV: ev4 col=${COL.ev4}, ev4url col=${COL.ev4url}, lastUpdated col=${COL.lastUpdated}, currentMp col=${COL.currentMp}, majority col=${COL.majority}, byelectiondate col=${COL.byelectiondate}`);

const candidatesMap = {};

for (const row of candRows) {
  const constituency  = (row[COL.constituency]  || '').trim();
  const name          = fixMojibake((row[COL.name] || '').trim());
  const party         = (row[COL.party]         || '').trim();
  const rawGrade      = (row[COL.grade]         || '?').trim().toUpperCase();
  const GRADE_NORM    = { 'NO RESPONSE': 'DNR', 'NO_RESPONSE': 'DNR', 'DID NOT RESPOND': 'DNR', 'NOT SCORED': '?', 'NOT_SCORED': '?' };
  const grade         = GRADE_NORM[rawGrade] ?? rawGrade;
  const b1            = (row[COL.b1]            || '').trim();
  const b2            = (row[COL.b2]            || '').trim();
  const b3            = (row[COL.b3]            || '').trim();
  const b4            = (row[COL.b4]            || '').trim();
  const b5            = (row[COL.b5]            || '').trim();
  const ev1           = (row[COL.ev1]           || '').trim();
  const ev1url        = (row[COL.ev1url]        || '').trim();
  const ev2           = (row[COL.ev2]           || '').trim();
  const ev2url        = (row[COL.ev2url]        || '').trim();
  const ev3           = (row[COL.ev3]           || '').trim();
  const ev3url        = (row[COL.ev3url]        || '').trim();
  const ev4           = (row[COL.ev4]           || '').trim();
  const ev4url        = (row[COL.ev4url]        || '').trim();
  const lastUpdated   = (row[COL.lastUpdated]   || '').trim();
  const currentMp       = (row[COL.currentMp]      || '').trim();
  const sheetMajority   = (row[COL.majority]       || '').trim();
  const sheetByElecDate = (row[COL.byelectiondate] || '').trim();

  if (!constituency || !name) continue;

  if (!candidatesMap[constituency]) candidatesMap[constituency] = [];
  candidatesMap[constituency].push({
    name,
    party,
    grade,
    current_mp:      currentMp.toUpperCase() === 'C',
    majority:        parseInt(sheetMajority.replace(/,/g, ''), 10) || null,
    byelection_date: sheetByElecDate || null,
    bullet1:      b1,
    bullet2:      b2,
    bullet3:      b3,
    bullet4:      b4,
    bullet5:      b5,
    evidence1:    ev1,
    evidence1_url: ev1url,
    evidence2:    ev2,
    evidence2_url: ev2url,
    evidence3:    ev3,
    evidence3_url: ev3url,
    evidence4:    ev4,
    evidence4_url: ev4url,
    last_updated: lastUpdated,
  });
}

// ── Build hexMap ──────────────────────────────────────────────────────────────
// Priority order for current MP data:
//   1. Candidate explicitly marked current_mp='C' in the Google Sheet (handles by-elections)
//   2. 2024 GE election results CSV (baseline for all other seats)
// The sheet's 'C' marker is the most reliable source — it's maintained by the user
// and requires no external API calls that can be rate-limited or blocked.
let byElecCount  = 0;
let noMpCount    = 0;
let noGradeCount = 0;

const hexMap = hexLayout.map(hex => {
  const key        = normName(hex.name);
  const ge         = ge2024[key] || {};
  const candidates = candidatesMap[hex.name] || [];

  // Check if the sheet explicitly marks a current MP (column 'currentMp' = 'C')
  const sheetMP = candidates.find(c => c.current_mp);

  let mpName, party, majority, isByElec, startDate, asvaGrade;

  if (sheetMP) {
    // Sheet has an explicit current MP — use them directly (grade already known)
    mpName    = sheetMP.name;
    party     = sheetMP.party || ge.party || null;
    asvaGrade = sheetMP.grade || null;
    startDate = sheetMP.byelection_date || null;
    // It's a by-election if the sheet MP doesn't match the 2024 GE winner
    const sheetNorm = normName(stripHonorifics(sheetMP.name));
    const geNorm    = normName(stripHonorifics(ge.mpName || ''));
    isByElec  = !!(ge.mpName && sheetNorm !== geNorm);
    // For by-elections use the majority from the sheet; for GE seats use the GE result
    majority  = isByElec ? (sheetMP.majority ?? null) : (ge.majority ?? null);
    if (isByElec) {
      byElecCount++;
      console.log(`  [BY-ELEC] "${hex.name}": ${ge.mpName} → ${sheetMP.name} (${sheetMP.grade || '?'})`);
    }
  } else {
    // Fall back to 2024 GE data with name-based grade lookup
    mpName    = ge.mpName   || null;
    party     = ge.party    || null;
    majority  = ge.majority ?? null;
    isByElec  = false;
    startDate = null;
    asvaGrade = null;
    if (mpName && candidates.length) {
      const mpNorm = normName(stripHonorifics(mpName));
      const match  = candidates.find(c => normName(stripHonorifics(c.name)) === mpNorm);
      if (match) {
        asvaGrade = match.grade;
      } else {
        noGradeCount++;
        console.warn(`  [NO GRADE] "${hex.name}" — MP: "${mpName}" — sheet has: ${candidates.map(c => `"${c.name}"`).join(', ')}`);
      }
    }
  }

  if (!mpName) {
    noMpCount++;
    console.warn(`  [NO MP] "${hex.name}"`);
  }

  return {
    name:     hex.name,
    code:     hex.code,
    gss:      hex.gss,
    cx:       hex.cx,
    cy:       hex.cy,
    pts:      hex.pts,
    mpName,
    party,
    majority,
    isByElec,
    startDate,
    members:  0,
    asvaGrade,
  };
});

if (byElecCount)  console.log(`${byElecCount} by-election seat(s) detected from sheet 'C' markers`);

if (noMpCount)    console.warn(`${noMpCount} hex(es) had no MP data`);
if (noGradeCount) console.warn(`${noGradeCount} MP(s) in sheet whose name didn't match — check spelling`);

// ── Apply the confirmed-ratings overlay ───────────────────────────────────────
// A confirmed rating overrides the current MP's sheet grade for its seat and
// supplies that MP's bullets + evidence. Matched to the seat by constituency
// name; the current MP's card is updated in place, or created if the sheet has
// no row for them. Non-current candidates are never touched by the overlay.
if (confirmedRatings.length) {
  const hexByKey = {};
  for (const hex of hexMap) hexByKey[normName(hex.name)] = hex;

  let applied = 0, unmatched = 0;
  for (const r of confirmedRatings) {
    const key = normName(r.constituency);
    const hex = hexByKey[key];
    if (!hex) { unmatched++; console.warn(`  [RATING NO SEAT] "${r.constituency}" — no matching hex`); continue; }

    hex.asvaGrade = r.grade;

    const bullets = Array.isArray(r.bullets) ? r.bullets : [];
    const sources = Array.isArray(r.sources) ? r.sources : [];
    const fields = {
      grade: r.grade,
      bullet1: bullets[0] || '', bullet2: bullets[1] || '', bullet3: bullets[2] || '',
      bullet4: bullets[3] || '', bullet5: bullets[4] || '',
      evidence1: sources[0]?.title || '', evidence1_url: sources[0]?.url || '',
      evidence2: sources[1]?.title || '', evidence2_url: sources[1]?.url || '',
      evidence3: sources[2]?.title || '', evidence3_url: sources[2]?.url || '',
      evidence4: sources[3]?.title || '', evidence4_url: sources[3]?.url || '',
      evidence5: sources[4]?.title || '', evidence5_url: sources[4]?.url || '',
      evidence6: sources[5]?.title || '', evidence6_url: sources[5]?.url || '',
      last_updated: (r.updated_at || '').slice(0, 10),
    };

    const list = candidatesMap[hex.name] || (candidatesMap[hex.name] = []);
    const mpNorm = normName(stripHonorifics(r.mp_name || hex.mpName || ''));
    const cand = list.find(c => c.current_mp) ||
                 list.find(c => normName(stripHonorifics(c.name)) === mpNorm);
    if (cand) {
      Object.assign(cand, fields);
    } else {
      list.push({
        name: r.mp_name || hex.mpName || '', party: hex.party || '',
        current_mp: true, majority: hex.majority ?? null, byelection_date: hex.startDate || null,
        ...fields,
      });
    }
    applied++;
  }
  console.log(`Supabase ratings overlay: applied to ${applied} seat(s)${unmatched ? `, ${unmatched} unmatched` : ''}`);
}

// ── Write output ──────────────────────────────────────────────────────────────
writeFileSync('data.json', JSON.stringify({ constituencies, candidates: candidatesMap, hexMap }));

const total = Object.values(candidatesMap).reduce((n, c) => n + c.length, 0);
console.log(
  `data.json written: ${constituencies.length} constituencies, ${total} candidates, ${hexMap.length} hex cells`
);
