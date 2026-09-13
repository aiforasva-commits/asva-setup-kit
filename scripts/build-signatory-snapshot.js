// scripts/build-signatory-snapshot.js
// Regenerates lib/signatory-snapshot.js — the authoritative list of which CURRENT
// MPs have signed each public AI-safety campaign, keyed by constituency. Run it to
// refresh coverage after campaigns gain signatories or a new PauseAI letter opens:
//
//   node scripts/build-signatory-snapshot.js
//
// Sources (all public):
//   • ControlAI   — https://controlai.org/statement embeds a members.parliament.uk
//                   member ID per signatory; each ID is resolved to house +
//                   constituency via members-api.parliament.uk. Commons members are
//                   kept as MP signatories; Lords are recorded as peers (audit only).
//   • PauseAI PM  — https://pauseai.uk/api/signatories → {name,party,constituency};
//                   MPs kept by their given constituency.
//   • PauseAI DM  — the roster in scripts/data/pauseai-deepmind-signatories.txt
//                   (that page is JS-rendered; refresh the txt from it by hand),
//                   MP entries matched to the current-MP roster by normalised name.
//
// The current-MP roster (for name→constituency matching and validation) comes from
// the deployed data.json. Every signer must resolve to a real current seat; the
// script prints any that don't so they can be reconciled before committing.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SITE = process.env.ASVA_SITE_ORIGIN || 'https://aisafetyvoteralliance.co.uk';

const stripAccents = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, "");
const TITLES = new Set(['sir','dr','dame','rt','hon','mr','mrs','ms','the','lord','lady','baroness','rev','revd']);
const ROLES  = new Set(['mp','msp','ms','mla','mc','td','peer','bishop']);
function normName(s) {
  let toks = stripAccents(String(s)).toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  while (toks.length && TITLES.has(toks[0])) toks = toks.slice(1);
  while (toks.length && ROLES.has(toks[toks.length - 1])) toks = toks.slice(0, -1);
  return toks.join(' ').trim();
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.text();
}

async function main() {
  // Current-MP roster.
  const { hexMap } = await getJson(`${SITE}/data.json`);
  const roster = (hexMap || []).filter(h => h && h.name && h.mpName);
  const consSet = new Set(roster.map(h => h.name));
  const name2cons = new Map();
  for (const h of roster) name2cons.set(normName(h.mpName), h.name);

  const unresolved = [];

  // ── ControlAI: name+memberId from the page, resolved via the Members API ──
  const ctrlHtml = await getText('https://controlai.org/statement');
  const pairRe = /"([^"]{2,80}?)"\s*,\s*\{"type":\d+,"value":\d+\}\s*,\s*"https:\/\/members\.parliament\.uk\/member\/(\d+)[^"]*"/g;
  const seen = new Set();
  const ctrlIds = [];
  for (const m of ctrlHtml.matchAll(pairRe)) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    ctrlIds.push({ name: m[1], memberId: m[2] });
  }
  const controlaiSigned = new Set();
  const controlaiPeers = [];
  for (const { name, memberId } of ctrlIds) {
    let v;
    try { v = (await getJson(`https://members-api.parliament.uk/api/Members/${memberId}`)).value; }
    catch { unresolved.push(`ControlAI member ${memberId} (${name}): API error`); continue; }
    const lm = v?.latestHouseMembership || {};
    if (lm.house === 2) { controlaiPeers.push(v.nameDisplayAs); continue; }   // Lords: out of scope
    if (lm.house === 1) {
      if (consSet.has(lm.membershipFrom)) controlaiSigned.add(lm.membershipFrom);
      else unresolved.push(`ControlAI: ${v.nameDisplayAs} → "${lm.membershipFrom}" not in current roster`);
    }
  }

  // ── PauseAI PM (current campaign): constituency given directly ──
  const pm = await getJson('https://pauseai.uk/api/signatories');
  const pauseaiPmSigned = new Set();
  for (const s of pm) {
    const c = String(s.constituency || '').trim();
    if (!c) continue;   // Peer
    if (consSet.has(c)) pauseaiPmSigned.add(c);
    else if (name2cons.has(normName(s.name))) pauseaiPmSigned.add(name2cons.get(normName(s.name)));
    else unresolved.push(`PauseAI-PM: ${s.name} → "${c}" not in current roster`);
  }

  // ── PauseAI DeepMind: MP entries from the committed roster file, by name ──
  const dmFile = fs.readFileSync(path.join(HERE, 'data', 'pauseai-deepmind-signatories.txt'), 'utf8');
  const pauseaiDeepmindSigned = new Set();
  for (const line of dmFile.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !/,\s*MP$/.test(t)) continue;
    const nm = t.replace(/,\s*MP$/, '').trim();
    if (name2cons.has(normName(nm))) pauseaiDeepmindSigned.add(name2cons.get(normName(nm)));
    else unresolved.push(`PauseAI-DeepMind: ${nm} → no matching current MP`);
  }

  if (unresolved.length) {
    console.error('\n⚠  UNRESOLVED signers (reconcile before committing):');
    for (const u of unresolved) console.error('   - ' + u);
    console.error('');
  }

  const arr = (set) => '[\n' + [...set].sort().map(c => '    ' + JSON.stringify(c)).join(',\n') + ',\n  ]';
  const today = new Date().toISOString().slice(0, 10);
  const out = `// lib/signatory-snapshot.js
// AUTHORITATIVE snapshot of which CURRENT MPs have signed each public AI-safety
// campaign, keyed by constituency. GENERATED by scripts/build-signatory-snapshot.js
// — do not edit by hand; re-run the script to refresh. See lib/signatory-status.js.

export const SIGNATORY_SNAPSHOT = {
  generatedAt: ${JSON.stringify(today)},
  controlai: {
    listUrl: 'https://controlai.org/statement',
    signed: ${arr(controlaiSigned)},
  },
  pauseaiPm: {
    listUrl: 'https://pauseai.uk/campaigns',
    signed: ${arr(pauseaiPmSigned)},
  },
  pauseaiDeepmind: {
    listUrl: 'https://pauseai.info/dear-sir-demis-2025',
    signed: ${arr(pauseaiDeepmindSigned)},
  },
  // Peers who signed ControlAI — recorded for audit; out of MP-only scope.
  controlaiPeers: ${arr(new Set(controlaiPeers))},
};

export default SIGNATORY_SNAPSHOT;
`;
  fs.writeFileSync(path.join(ROOT, 'lib', 'signatory-snapshot.js'), out);
  console.log(`Wrote lib/signatory-snapshot.js — ControlAI ${controlaiSigned.size} MPs (+${controlaiPeers.length} peers), ` +
    `PauseAI-PM ${pauseaiPmSigned.size}, PauseAI-DeepMind ${pauseaiDeepmindSigned.size}, unresolved ${unresolved.length}.`);
  if (unresolved.length) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
