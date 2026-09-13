// functions/api/member-submissions/confirm.js
// POST /api/member-submissions/confirm
// Body: { id, grade?, bullets?, sources? }
// Approves a pending member submission. The optional fields let an admin edit
// the grade/bullets/sources at the moment of confirming, exactly like
// recommendations/confirm.js; anything omitted falls back to what the member
// proposed. Writes into mp_ratings — the live table — and marks the
// submission confirmed. Since this IS a human review, it stamps
// human_reviewed_at directly.
//
// Emails the member the outcome (lib/comms-templates.js
// memberSubmissionConfirmedHTML), noting whether the admin changed anything
// before publishing so they aren't surprised the live card differs from what
// they wrote. Requires a valid admin session.

import { requireAdmin, makeSupabase, json } from '../../../lib/admin-auth.js';
import { normalizeGrade, sanitizeBullets, sanitizeSources } from '../../../lib/ratings.js';
import { sendEmail, confirmationEnabled } from '../../../lib/email.js';
import { memberSubmissionConfirmedHTML, SUBJECTS } from '../../../lib/comms-templates.js';

// Order-sensitive equality is fine here — reordering bullets/sources before
// confirming already counts as a change worth flagging as "amended".
function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const session = await requireAdmin(context);
  if (!session) return json({ error: 'Not authenticated' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  let body;
  try { body = await context.request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const id = String(body.id ?? '').trim();
  if (!id) return json({ error: 'Missing submission id' }, 400);

  const { data: sub, error: subError } = await supabase
    .from('member_submissions')
    .select('id, constituency, mp_name, member_email, member_name, proposed_grade, bullets, sources, status')
    .eq('id', id)
    .maybeSingle();

  if (subError) {
    console.error('member submission confirm load error:', subError.message || subError);
    return json({ error: 'Failed to load submission' }, 500);
  }
  if (!sub) return json({ error: 'Submission not found' }, 404);
  if (sub.status !== 'pending') return json({ error: `Already ${sub.status}` }, 409);

  const grade = normalizeGrade(body.grade ?? sub.proposed_grade);
  if (!grade) return json({ error: 'Invalid grade' }, 400);

  const bullets = body.bullets !== undefined ? sanitizeBullets(body.bullets) : sanitizeBullets(sub.bullets);
  const sources = body.sources !== undefined ? sanitizeSources(body.sources) : sanitizeSources(sub.sources);
  const now     = new Date().toISOString();

  const amended = !sameValue(grade, sub.proposed_grade) ||
                  !sameValue(bullets, sub.bullets) ||
                  !sameValue(sources, sub.sources);

  const { error: upsertError } = await supabase
    .from('mp_ratings')
    .upsert({
      constituency:      sub.constituency,
      mp_name:           sub.mp_name,
      grade,
      bullets,
      sources,
      updated_by:        'member-confirmed',
      updated_at:        now,
      human_reviewed_at: now,
    }, { onConflict: 'constituency' });

  if (upsertError) {
    console.error('member submission confirm upsert error:', upsertError.message || upsertError);
    return json({ error: 'Failed to save rating' }, 500);
  }

  const { error: markError } = await supabase
    .from('member_submissions')
    .update({ status: 'confirmed', confirmed_grade: grade, amended, reviewed_at: now })
    .eq('id', id);

  if (markError) {
    // The rating is already live; log but don't fail the request.
    console.error('member submission confirm mark error:', markError.message || markError);
  }

  try {
    if (confirmationEnabled(context.env)) {
      await sendEmail(
        context.env,
        sub.member_email,
        SUBJECTS.memberConfirmed,
        memberSubmissionConfirmedHTML(sub.member_name, sub.mp_name, amended)
      );
    }
  } catch (e) {
    console.error('member submission confirm-email failed:', e?.message || e);
  }

  return json({ success: true, constituency: sub.constituency, grade, amended });
}
