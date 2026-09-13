// functions/api/member-submissions/reject.js
// POST /api/member-submissions/reject
// Body: { id, reason? }
// Discards a pending member submission without touching the live rating.
// Marking it rejected (rather than deleting) keeps a history. `reason` is an
// optional short note shown verbatim to the member in their outcome email
// (lib/comms-templates.js memberSubmissionRejectedHTML) — keep it polite and
// non-technical, since it's the member's only feedback on why their
// suggestion wasn't used. Requires a valid admin session.

import { requireAdmin, makeSupabase, json } from '../../../lib/admin-auth.js';
import { sendEmail, confirmationEnabled } from '../../../lib/email.js';
import { memberSubmissionRejectedHTML, SUBJECTS } from '../../../lib/comms-templates.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const session = await requireAdmin(context);
  if (!session) return json({ error: 'Not authenticated' }, 401);

  const supabase = makeSupabase(context.env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  let body;
  try { body = await context.request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const id     = String(body.id ?? '').trim();
  const reason = body.reason ? String(body.reason).trim().slice(0, 1000) : null;
  if (!id) return json({ error: 'Missing submission id' }, 400);

  const { data, error } = await supabase
    .from('member_submissions')
    .update({ status: 'rejected', reject_reason: reason, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending') // only a pending submission can be rejected
    .select('id, mp_name, member_email, member_name')
    .maybeSingle();

  if (error) {
    console.error('member submission reject error:', error.message || error);
    return json({ error: 'Failed to reject submission' }, 500);
  }
  if (!data) return json({ error: 'Submission not found or not pending' }, 404);

  try {
    if (confirmationEnabled(context.env)) {
      await sendEmail(
        context.env,
        data.member_email,
        SUBJECTS.memberRejected,
        memberSubmissionRejectedHTML(data.member_name, data.mp_name, reason)
      );
    }
  } catch (e) {
    console.error('member submission reject-email failed:', e?.message || e);
  }

  return json({ success: true });
}
