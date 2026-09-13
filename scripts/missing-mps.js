// scripts/missing-mps.js
// Compares all current UK MPs (from Parliament Members API) against the
// candidates listed in the ASVA Google Sheet, then writes missing-mps.md
// listing every MP not yet in the sheet, sorted by election date.
//
// Usage:
//   GOOGLE_SHEET_CANDIDATES_URL=<url> node scripts/missing-mps.js

import { writeFileSync } from 'fs';

const CANDIDATES_URL = process.env.GOOGLE_SHEET_CANDIDATES_URL;

if (!CANDIDATES_URL) {
  console.error('Error: GOOGLE_SHEET_CANDIDATES_URL must be set.');
  process.exit(1);
}

// ── CSV parser ────────────────────────────────────────────────────────────────
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

// Normalise a name for comparison (lowercase, strip punctuation/diacritics)
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

function stripHonorifics(s) {
  return (s || '')
    .replace(/^(The\s+)?(Rt\.?\s+Hon\.?\s+)?(Sir|Dame|Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss|Prof(?:essor)?)\s+/i, '')
    .trim();
}

// ── Fetch all current MPs from Parliament Members API (paginated) ─────────────
const PARLIAMENT_MEMBERS = 'https://members-api.parliament.uk/api/Members/Search';
const TAKE = 100;

async function fetchCurrentMPs() {
  const params = `House=1&IsCurrentMember=true&take=${TAKE}`;
  const mps = [];

  const absorb = items => {
    for (const item of (items || [])) {
      const v   = item.value;
      const con = v.latestHouseMembership?.membershipFrom;
      if (con) {
        mps.push({
          name:        v.nameDisplayAs,
          party:       v.latestParty?.name || 'Unknown',
          partyAbbr:   v.latestParty?.abbreviation || '?',
          constituency: con,
          startDate:   v.latestHouseMembership?.membershipStartDate?.slice(0, 10) || null,
        });
      }
    }
  };

  const firstRes = await fetch(`${PARLIAMENT_MEMBERS}?${params}&skip=0`, {
    headers: { Accept: 'application/json' },
  });
  if (!firstRes.ok) throw new Error(`Parliament Members API ${firstRes.status}`);
  const firstData = await firstRes.json();
  absorb(firstData.items);

  const total = firstData.totalResults || 0;
  if (total > TAKE) {
    const pages = [];
    for (let skip = TAKE; skip < total; skip += TAKE) {
      pages.push(
        fetch(`${PARLIAMENT_MEMBERS}?${params}&skip=${skip}`, { headers: { Accept: 'application/json' } })
          .then(r => r.ok ? r.json() : { items: [] })
      );
    }
    for (const page of await Promise.all(pages)) absorb(page.items);
  }

  console.log(`Parliament Members API: ${mps.length} current MPs fetched`);
  return mps;
}

// ── Fetch candidates from Google Sheet ────────────────────────────────────────
async function fetchCandidateNames() {
  const res = await fetch(CANDIDATES_URL);
  if (!res.ok) {
    console.error(`Error: Failed to fetch candidates CSV (${res.status})`);
    process.exit(1);
  }
  const text = await res.text();
  const [_header, ...rows] = parseCSV(text);
  const names = new Set();
  for (const row of rows) {
    const name = (row[1] || '').trim();
    if (name) names.add(normName(stripHonorifics(name)));
  }
  console.log(`Google Sheet: ${names.size} candidate names found`);
  return names;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const [allMPs, sheetNames] = await Promise.all([
  fetchCurrentMPs(),
  fetchCandidateNames(),
]);

const GE_2024 = '2024-07-04';

const missing = allMPs
  .filter(mp => !sheetNames.has(normName(stripHonorifics(mp.name))))
  .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

const byElection = missing.filter(mp => mp.startDate && mp.startDate > GE_2024);
const ge2024     = missing.filter(mp => !mp.startDate || mp.startDate <= GE_2024);

console.log(`\nMPs not in Google Sheet: ${missing.length} (${ge2024.length} from 2024 GE, ${byElection.length} by-election)`);

// ── Build Markdown output ─────────────────────────────────────────────────────
const now = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function tableRows(mps) {
  return mps.map(mp =>
    `| ${mp.name} | ${mp.constituency} | ${mp.party} | ${formatDate(mp.startDate)} |`
  ).join('\n');
}

const md = `# MPs not yet in the ASVA Google Sheet

Generated: ${now}

**${missing.length} MPs** are not currently listed as candidates in the scorecard sheet (${ge2024.length} from the 2024 General Election, ${byElection.length} elected via by-election).

${byElection.length > 0 ? `## By-election seats (${byElection.length})

| MP Name | Constituency | Party | Elected |
|---------|-------------|-------|---------|
${tableRows(byElection)}

` : ''}## 2024 General Election (${ge2024.length})

| MP Name | Constituency | Party | Elected |
|---------|-------------|-------|---------|
${tableRows(ge2024)}
`;

writeFileSync('missing-mps.md', md);
console.log(`\nmissing-mps.md written (${missing.length} MPs listed)`);
