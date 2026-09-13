// functions/api/member-submissions/create.js
// POST /api/member-submissions
// Body: { constituency, mp_name, grade, bullets, sources, note? }
// Requires a member session (see lib/member-auth.js). Saves a member's
// suggested edit to their MP's rating as a PENDING row in member_submissions —
// nothing here ever touches the live mp_ratings table directly; it only
// becomes live once an admin confirms it on /goldenpath.html (see
// member-submissions/confirm.js).
//
// A member resubmitting for a seat they already have a pending edit on
// REPLACES it in place (member_submissions_one_pending_per_member_seat),
// rather than piling up near-duplicates in the review queue.

import { requireMember, makeSupabase, json } from '../../../lib/member-auth.js';
import { adminEmail } from '../../../lib/admin-auth.js';
import { normalizeGrade, sanitizeBullets, sanitizeSources } from '../../../lib/ratings.js';
import { sendEmail, confirmationEnabled } from '../../../lib/email.js';
import { newMemberSubmissionSubject, newMemberSubmissionAdminHTML } from '../../../lib/comms-templates.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const member = await requireMember(context);
  if (!member) return json({ error: 'Not authenticated' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  let body;
  try { body = await context.request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const constituency = String(body.constituency ?? '').trim().slice(0, 200);
  const mpName        = String(body.mp_name ?? '').trim().slice(0, 200);
  if (!constituency || !mpName) return json({ error: 'Missing constituency or MP name' }, 400);

  const grade = normalizeGrade(body.grade);
  if (!grade) return json({ error: 'Invalid grade' }, 400);

  const bullets = sanitizeBullets(body.bullets);
  const sources = sanitizeSources(body.sources);
  const note    = body.note ? String(body.note).trim().slice(0, 1000) : null;

  // Snapshot the live rating (if any) as the "current" side of the diff shown
  // to the reviewer — see member_submissions.sql.
  const { data: live } = await supabase
    .from('mp_ratings')
    .select('grade, bullets, sources')
    .eq('constituency', constituency)
    .maybeSingle();

  const record = {
    constituency,
    mp_name:        mpName,
    member_id:      member.id,
    member_email:   member.email,
    member_name:    member.first_name,
    proposed_grade: grade,
    bullets,
    sources,
    note,
    base_grade:     live?.grade ?? null,
    base_bullets:   live?.bullets ?? [],
    base_sources:   live?.sources ?? [],
    status:         'pending',
  };

  const findExisting = () => supabase
    .from('member_submissions')
    .select('id')
    .eq('member_id', member.id)
    .eq('constituency', constituency)
    .eq('status', 'pending')
    .maybeSingle();

  const { data: existing } = await findExisting();

  let saveError;
  if (existing) {
    ({ error: saveError } = await supabase.from('member_submissions').update(record).eq('id', existing.id));
  } else {
    ({ error: saveError } = await supabase.from('member_submissions').insert([record]));
    if (saveError && saveError.code === '23505') {
      // Lost a race with a concurrent submission from this same member/seat —
      // fall back to updating whichever row won.
      const { data: raced } = await findExisting();
      if (raced) ({ error: saveError } = await supabase.from('member_submissions').update(record).eq('id', raced.id));
    }
  }

  if (saveError) {
    console.error('member submission save error:', saveError.message || saveError);
    return json({ error: 'Failed to save your submission' }, 500);
  }

  // Best-effort admin notification. A failed send must never fail the
  // member's request — their submission is already saved either way.
  try {
    if (confirmationEnabled(context.env)) {
      const origin = new URL(context.request.url).origin;
      await sendEmail(
        context.env,
        adminEmail(context.env),
        newMemberSubmissionSubject(mpName, constituency),
        newMemberSubmissionAdminHTML(member.first_name, mpName, constituency, `${origin}/goldenpath.html`)
      );
    }
  } catch (e) {
    console.error('member submission admin-notify failed:', e?.message || e);
  }

  return json({ success: true });
}
