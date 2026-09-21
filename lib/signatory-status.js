// lib/signatory-status.js
// Both-campaign signatory coverage. Every scorecard card should state, explicitly,
// whether the MP signed BOTH the ControlAI campaign statement AND a PauseAI open
// letter — signed or not — each with a bullet and the list URL as its source. When
// a card names only one campaign, the silence on the other is ambiguous (a reader
// can't tell "not signed" from "not checked"); this module removes that ambiguity.
//
// When both campaigns land on the SAME polarity (signed both, or signed neither),
// that's stated as ONE combined bullet rather than two near-duplicate ones — e.g.
// "Not a ControlAI or PauseAI signatory" instead of a separate "Not a ControlAI…"
// and "Not a PauseAI…" bullet. A mixed pair (signed one, not the other) still needs
// two distinct bullets, since they say different things. Both list sources are
// always present either way.
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
//   • MERGES two clean, same-polarity standalone bullets into the one combined
//     bullet described above, or
//   • ADDS a missing list source next to a claim that is already correct.
// It NEVER rewrites a bullet whose meaning is entangled with other content, never
// removes substantive bullets/sources, and reports (rather than silently drops)
// anything it can't fit under the ≤5-bullet / ≤4-source caps. If nothing needs
// changing, it returns changed:false so callers leave the row untouched.

import { SIGNATORY_SNAPSHOT } from './signatory-snapshot.js';

export const BULLET_CAP = 5;
export const SOURCE_CAP = 4;

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

// One bullet for the same-polarity case (both signed, or neither) — see the
// module comment above for why this replaces two near-duplicate bullets.
const COMBINED_NEGATIVE = 'Not a ControlAI or PauseAI signatory';
const COMBINED_POSITIVE = 'Signed both ControlAI and PauseAI campaigns';

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

  // A campaign's mention state: 'missing' (no bullet names it), 'clean' (exactly one
  // bullet names only it, in clear signatory language — safe to replace/remove), or
  // 'entangled' (multiple mentions, or the bullet also names the OTHER campaign, or
  // it isn't clearly a status statement — never touched, just sourced + flagged).
  function analyze(campaign) {
    const mentions = outBullets.map((b, i) => ({ b, i })).filter(({ b }) => campaign.nameRe.test(b));
    if (mentions.length === 0) return { state: 'missing' };
    const only = mentions.length === 1 ? mentions[0] : null;
    const clean = only && !campaign.otherRe.test(only.b) && STATUS_WORD_RE.test(only.b);
    return clean ? { state: 'clean', index: only.i, bullet: only.b } : { state: 'entangled', mentions };
  }

  // When both campaigns can be stated the same way ("signed both" or "signed
  // neither"), the target is ONE combined bullet rather than two near-duplicates.
  const combinedText = status.controlai.signed === status.pauseai.signed
    ? (status.controlai.signed ? COMBINED_POSITIVE : COMBINED_NEGATIVE)
    : null;
  let combined = false;
  let states = null;

  if (combinedText && outBullets.includes(combinedText)) {
    // Already stated exactly this way — nothing to add/correct, and critically
    // don't run the per-campaign analysis below: it would see this one bullet
    // naming both campaigns and (rightly, for any OTHER bullet shaped like this)
    // treat it as entangled/needs-a-human-look, which would flag an already-fine
    // card on every single future pass.
    combined = true;
  } else {
    states = { controlai: analyze(campaigns[0]), pauseai: analyze(campaigns[1]) };
  }

  // ── Same-polarity combine ────────────────────────────────────────────────
  // Only when BOTH are combinable (missing or a clean standalone bullet — never
  // entangled) and the authoritative status agrees on both; a mixed signed/
  // not-signed pair always stays as two distinct statements, since they say
  // different things.
  const bothCombinable = states && states.controlai.state !== 'entangled' && states.pauseai.state !== 'entangled';

  if (!combined && combinedText && bothCombinable) {
    const existing = [states.controlai, states.pauseai].filter(s => s.state === 'clean');
    // Remove any existing clean standalone bullets for either campaign first
    // (descending index order so earlier splices don't shift later indices).
    existing.map(s => s.index).sort((a, b) => b - a).forEach(i => outBullets.splice(i, 1));
    if (outBullets.length >= BULLET_CAP) {
      capped.push({ campaign: 'both', kind: 'bullet' });
      // Couldn't fit the merge — put the removed bullet(s) back unchanged so
      // nothing is silently lost; the per-campaign pass below re-evaluates them.
      // Ascending-index order restores original positions correctly (each
      // insert only shifts what comes after it, which is exactly what a
      // lower-index-first re-insertion needs).
      existing.slice().sort((a, b) => a.index - b.index).forEach(s => outBullets.splice(s.index, 0, s.bullet));
    } else {
      outBullets.push(combinedText);
      if (existing.length) {
        corrected.push({ campaign: 'both', from: existing.map(s => s.bullet).join(' | '), to: combinedText });
      } else {
        added.push({ campaign: 'both', kind: 'bullet' });
      }
      combined = true;
    }
  }

  if (combined) {
    // Covers both paths above: freshly merged just now, or already stated this
    // way on entry — either way, make sure both list sources are present.
    addSource(campaigns[0], campaigns[0].items.source);
    addSource(campaigns[1], campaigns[1].items.source);
  } else {
    for (const campaign of campaigns) {
      const state = states[campaign.key];

      if (state.state === 'missing') {
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

      if (state.state === 'entangled') {
        // More than one bullet names it, or the one that does also names the
        // OTHER campaign, or it isn't a clear signatory-status bullet. Don't
        // rewrite — just make sure the list source is present, and flag for
        // human review.
        addSource(campaign, campaign.items.source);
        flagged.push({
          campaign: campaign.key,
          reason: state.mentions.length > 1 ? 'multiple-mentions'
                : campaign.otherRe.test(state.mentions[0].b) ? 'combined-bullet'
                : 'unclear-status-bullet',
          detail: state.mentions.map(m => m.b).join(' | '),
        });
        continue;
      }

      // Clean single status bullet → read its polarity and correct if it
      // contradicts the authoritative list.
      const claimsNotSigned = NEGATION_RE.test(state.bullet);
      const shouldSay = campaign.signed ? 'signed' : 'not';
      const says = claimsNotSigned ? 'not' : 'signed';
      if (says !== shouldSay) {
        const from = state.bullet;
        outBullets[state.index] = campaign.items.bullet;
        corrected.push({ campaign: campaign.key, from, to: campaign.items.bullet });
        // Drop any now-mislabelled list source for this campaign and re-add the
        // right one, so the source title matches the corrected claim.
        for (let k = outSources.length - 1; k >= 0; k--) {
          if (campaign.hostRe.test(urlHost(outSources[k].url))) outSources.splice(k, 1);
        }
        addSource(campaign, campaign.items.source);
      } else {
        // Already correct → just guarantee the proof source is present.
        addSource(campaign, campaign.items.source);
      }
    }
  }

  const changed =
    JSON.stringify(outBullets) !== JSON.stringify(inBullets) ||
    JSON.stringify(outSources) !== JSON.stringify(inSources);

  return { status, bullets: outBullets, sources: outSources, changed, added, corrected, capped, flagged };
}
