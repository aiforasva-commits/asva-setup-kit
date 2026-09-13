// functions/api/ratings/update.js
// POST /api/ratings/update
// Body: { constituency, mp_name?, grade, bullets?, sources? }
// Amends a LIVE rating (mp_ratings) directly — used by the "Live ratings" editor
// on /goldenpath.html so a rating can be corrected after it has been confirmed,
// without going into Supabase by hand. Requires a valid admin session.

import { requireAdmin, makeSupabase, json } from '../../../lib/admin-auth.js';
import { normalizeGrade, sanitizeBullets, sanitizeSources } from '../../../lib/ratings.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const session = await requireAdmin(context);
  if (!session) return json({ error: 'Not authenticated' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  let body;
  try { body = await context.request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const constituency = String(body.constituency ?? '').trim();
  if (!constituency) return json({ error: 'Missing constituency' }, 400);

  const grade = normalizeGrade(body.grade);
  if (!grade) return json({ error: 'Invalid grade' }, 400);

  // Preserve the existing MP name unless one is supplied. mp_ratings.mp_name is
  // NOT NULL, so an update to a row that somehow lacks a name still needs one.
  let mpName = body.mp_name ? String(body.mp_name).trim() : '';
  if (!mpName) {
    const { data: existing } = await supabase
      .from('mp_ratings').select('mp_name').eq('constituency', constituency).maybeSingle();
    mpName = existing?.mp_name || constituency;
  }

  // Saving a rating by hand IS a human review, so stamp human_reviewed_at: this
  // moves a "Live Claude rating" into "Live Human Reviewed" (and keeps one that
  // was already reviewed there). Only the listed columns are written; the upsert
  // leaves rationale/party/model (and signatory_fixed_at) on the row untouched.
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('mp_ratings')
    .upsert({
      constituency,
      mp_name:           mpName,
      grade,
      bullets:           sanitizeBullets(body.bullets),
      sources:           sanitizeSources(body.sources),
      updated_by:        'manual',
      updated_at:        now,
      human_reviewed_at: now,
    }, { onConflict: 'constituency' });

  if (error) {
    console.error('ratings update error:', error.message || error);
    return json({ error: 'Failed to save rating' }, 500);
  }

  return json({ success: true, constituency, grade, updated_at: now, human_reviewed_at: now });
}
