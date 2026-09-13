// lib/signatory-status.js
// Both-campaign signatory coverage. Every scorecard card should state, explicitly,
// whether the MP signed BOTH the ControlAI campaign statement AND a PauseAI open
// letter — signed or not — each with a bullet and the list URL as its source. When
// a card names only one campaign, the silence on the other is ambiguous (a reader
// can't tell "not signed" from "not checked"); this module removes that ambiguity.
//
// It works off the authoritative constituency lists in lib/signatory-snapshot.js
// (built offline against the Parliament Members API), so status is a plain lookup —
// no fuzzy name matching at runtime. Used by:
//   • the confirmed direct-patch endpoint (functions/api/ratings/signatory-fix.js),
//   • the pending-draft ingest/backfill path,
// and the same rules the research-mps skill now follows when drafting.
//
// Design stance: SAFE and CONSERVATIVE. It only ever
//   • ADDS a missing campaign bullet + its list source, or
//   • CORRECTS a card's own clear "signed / not signed" claim that contradicts the
//     authoritative list (the exact inconsistency this fixes), or
//   • ADDS a missing list source next to a claim that is already correct.
// It NEVER rewrites a bullet whose meaning is entangled with other content, never
// removes substantive bullets/sources, and reports (rather than silently drops)
// anything it can't fit under the ≤5-bullet / ≤6-source caps. If nothing needs
// changing, it returns changed:false so callers leave the row untouched.

import { SIGNATORY_SNAPSHOT } from './signatory-snapshot.js';

export const BULLET_CAP = 5;
export const SOURCE_CAP = 6;

// A bullet "names" a campaign when its name appears adjacent ("ControlAI",
// "Control AI"); kept tight enough not to fire on "controls on AI".
const CONTROLAI_RE = /control\s*ai/i;
const PAUSEAI_RE   = /pause\s*ai/i;

// A campaign source is "present" when a cited URL is on the campaign's own host.
const CONTROLAI_HOST_RE = /(^|\.)controlai\./i;
const PAUSEAI_HOST_RE    = /(^|\.)pauseai\./i;

// A bullet reads as a signatory-STATUS statement (not just a passing mention) when
// it uses signatory vocabulary. Only such bullets are candidates for polarity
// reading / in-place correction — anything vaguer is treated as entangled.
const STATUS_WORD_RE = /signator|\bsign|\bsigned|listed|letter|statement|campaign|backed|endorse|member/i;

// Negative polarity: the bullet asserts the MP did NOT sign. Checked only on a
// clean status bullet, so "no"/"not" here really are about the signature.
const NEGATION_RE = /\bnot\b|\bnon\b|non-|\bnever\b|n['’]t\b|\bno\b|\byet to\b|\babsent\b/i;

function urlHost(u) { try { return new URL(String(u)).hostname; } catch { return ''; } }

// ── Authoritative status lookup ──────────────────────────────────────────────
// Returns the true signatory status for a constituency from the snapshot.
//   controlai.signed  — on the ControlAI statement
//   pauseai.signed    — on EITHER PauseAI letter
//   pauseai.letter    — 'pm' | 'deepmind' | null (which letter to name when signed;
//                       PM preferred when on both)
export function lookupStatus(constituency, snapshot = SIGNATORY_SNAPSHOT) {
  const c = String(constituency ?? '');
  const inList = (list) => Array.isArray(list) && list.includes(c);
  const pm = inList(snapshot.pauseaiPm?.signed);
  const dm = inList(snapshot.pauseaiDeepmind?.signed);
  return {
    controlai: { signed: inList(snapshot.controlai?.signed) },
    pauseai:   { signed: pm || dm, letter: pm ? 'pm' : (dm ? 'deepmind' : null) },
  };
}

// ── Canonical bullet + source wording, per campaign and polarity ─────────────
// Matches the house "source-type" style used across the research skill and the
// existing confirmed cards (e.g. "Not a ControlAI campaign signatory").
function controlaiItems(status, snapshot) {
  const url = snapshot.controlai.listUrl;
  return status.controlai.signed
    ? { bullet: 'Signed the ControlAI campaign statement',
        source: { title: 'Listed in ControlAI Campaign Statement', url } }
    : { bullet: 'Not a ControlAI campaign signatory',
        source: { title: 'ControlAI Campaign Statement signatory list', url } };
}

function pauseaiItems(status, snapshot) {
  if (!status.pauseai.signed) {
    return { bullet: 'Not a PauseAI campaign signatory',
             source: { title: 'PauseAI campaign signatory list', url: snapshot.pauseaiPm.listUrl } };
  }
  if (status.pauseai.letter === 'pm') {
    return { bullet: 'Signed PauseAI letter to the Prime Minister',
             source: { title: 'Signed PauseAI letter to the Prime Minister', url: snapshot.pauseaiPm.listUrl } };
  }
  return { bullet: 'Signed PauseAI letter to Google DeepMind',
           source: { title: 'Signed PauseAI letter to Google DeepMind', url: snapshot.pauseaiDeepmind.listUrl } };
}

// ── Core coverage pass over one card ─────────────────────────────────────────
// Given a card's bullets + sources and a constituency, return the bullets/sources
// that make BOTH campaigns explicit and correct, plus a breakdown of what it did.
//
// Returns:
//   { bullets, sources, changed,
//     added:     [{campaign, kind:'bullet'|'source'}],   // newly stated
//     corrected: [{campaign, from, to}],                 // wrong claim fixed
//     capped:    [{campaign, kind}],                      // needed but no room
//     flagged:   [{campaign, reason, detail}] }           // needs human eyes
export function enforceCoverage(constituency, bullets, sources, snapshot = SIGNATORY_SNAPSHOT) {
  const status = lookupStatus(constituency, snapshot);
  // Normalise the inputs the same way the outputs are built, so the "did anything
  // change?" check compares like with like (whitespace/empties are not a change).
  const inBullets = (Array.isArray(bullets) ? bullets : []).map(b => String(b ?? '')).filter(b => b.trim());
  const inSources = (Array.isArray(sources) ? sources : [])
    .filter(s => s && String(s.url ?? '').trim())
    .map(s => ({ title: String(s.title ?? '').trim(), url: String(s.url).trim() }));
  const outBullets = inBullets.slice();
  const outSources = inSources.slice();

  const added = [], corrected = [], capped = [], flagged = [];

  const campaigns = [
    { key: 'controlai', nameRe: CONTROLAI_RE, otherRe: PAUSEAI_RE,
      hostRe: CONTROLAI_HOST_RE, items: controlaiItems(status, snapshot), signed: status.controlai.signed },
    { key: 'pauseai', nameRe: PAUSEAI_RE, otherRe: CONTROLAI_RE,
      hostRe: PAUSEAI_HOST_RE, items: pauseaiItems(status, snapshot), signed: status.pauseai.signed },
  ];

  const sourcePresent = (hostRe) => outSources.some(s => hostRe.test(urlHost(s.url)));
  const addSource = (campaign, src) => {
    if (sourcePresent(campaign.hostRe)) return;            // already cited — leave it
    if (outSources.length >= SOURCE_CAP) { capped.push({ campaign: campaign.key, kind: 'source' }); return; }
    outSources.push({ title: src.title, url: src.url });
    added.push({ campaign: campaign.key, kind: 'source' });
  };

  for (const campaign of campaigns) {
    const mentions = outBullets
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => campaign.nameRe.test(b));

    if (mentions.length === 0) {
      // No mention at all → add the canonical bullet (if room) + its source.
      if (outBullets.length >= BULLET_CAP) {
        capped.push({ campaign: campaign.key, kind: 'bullet' });
      } else {
        outBullets.push(campaign.items.bullet);
        added.push({ campaign: campaign.key, kind: 'bullet' });
      }
      addSource(campaign, campaign.items.source);
      continue;
    }

    // Entangled: more than one bullet names it, or the one that does also names the
    // OTHER campaign, or it isn't a clear signatory-status bullet. Don't rewrite —
    // just make sure the list source is present, and flag for human review.
    const only = mentions.length === 1 ? mentions[0] : null;
    const clean = only && !campaign.otherRe.test(only.b) && STATUS_WORD_RE.test(only.b);
    if (!clean) {
      addSource(campaign, campaign.items.source);
      flagged.push({
        campaign: campaign.key,
        reason: mentions.length > 1 ? 'multiple-mentions'
              : (only && campaign.otherRe.test(only.b)) ? 'combined-bullet'
              : 'unclear-status-bullet',
        detail: mentions.map(m => m.b).join(' | '),
      });
      continue;
    }

    // Clean single status bullet → read its polarity and correct if it contradicts
    // the authoritative list.
    const claimsNotSigned = NEGATION_RE.test(only.b);
    const shouldSay = campaign.signed ? 'signed' : 'not';
    const says = claimsNotSigned ? 'not' : 'signed';
    if (says !== shouldSay) {
      const from = only.b;
      outBullets[only.i] = campaign.items.bullet;
      corrected.push({ campaign: campaign.key, from, to: campaign.items.bullet });
      // Drop any now-mislabelled list source for this campaign and re-add the right
      // one, so the source title matches the corrected claim (same host/URL).
      for (let k = outSources.length - 1; k >= 0; k--) {
        if (campaign.hostRe.test(urlHost(outSources[k].url))) outSources.splice(k, 1);
      }
      addSource(campaign, campaign.items.source);
    } else {
      // Already correct → just guarantee the proof source is present.
      addSource(campaign, campaign.items.source);
    }
  }

  // Compaction fallback. If the bullet cap blocked a campaign's "not a signatory"
  // bullet AND both campaigns are not signed, collapse the standalone negative
  // that IS present into one combined bullet ("Not a ControlAI or PauseAI
  // signatory"): it fits a single slot while still naming both, so a full card no
  // longer has to leave one campaign unstated. Both list sources stay. Only the
  // all-negative case combines cleanly, so mixed signed/not is left as-is.
  const cappedBullet = capped.some(c => c.kind === 'bullet');
  if (cappedBullet && !status.controlai.signed && !status.pauseai.signed) {
    const COMBINED = 'Not a ControlAI or PauseAI signatory';
    // A standalone, clean, negative bullet for exactly one of the two campaigns.
    const idx = outBullets.findIndex(b =>
      (CONTROLAI_RE.test(b) !== PAUSEAI_RE.test(b)) && STATUS_WORD_RE.test(b) && NEGATION_RE.test(b));
    if (idx !== -1 && !outBullets.some(b => CONTROLAI_RE.test(b) && PAUSEAI_RE.test(b))) {
      if (outBullets[idx] !== COMBINED) corrected.push({ campaign: 'both', from: outBullets[idx], to: COMBINED });
      outBullets[idx] = COMBINED;
      // Both campaigns are now named by this one bullet — clear their capped-bullet
      // entries, and make sure both list sources are present.
      for (let k = capped.length - 1; k >= 0; k--) if (capped[k].kind === 'bullet') capped.splice(k, 1);
      addSource(campaigns[0], campaigns[0].items.source);
      addSource(campaigns[1], campaigns[1].items.source);
    }
  }

  const changed =
    JSON.stringify(outBullets) !== JSON.stringify(inBullets) ||
    JSON.stringify(outSources) !== JSON.stringify(inSources);

  return { status, bullets: outBullets, sources: outSources, changed, added, corrected, capped, flagged };
}
