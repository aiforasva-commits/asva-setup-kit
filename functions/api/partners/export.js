// functions/api/partners/export.js
// POST /api/partners/export           — send the batch (used by the daily cron)
// GET  /api/partners/export?dry_run=1 — preview the batch without sending/stamping
//
// Sends the batch of NEW opted-in members (name + email) to the partner
// newsletter distributions (ControlAI, PauseAI) and stamps them so they are
// never sent twice. "New" = confirmed, opted in to AI safety news, and not yet
// exported (partner_exported_at IS NULL — see supabase/partner_export.sql).
//
// Auth (either is accepted):
//   • Authorization: Bearer <AGENT_INGEST_SECRET>  — for the scheduled job.
//   • A valid admin session cookie                 — so the site owner can run a
//     manual send / dry-run from the browser while logged into /goldenpath.html.
//
// Recipients come from PARTNER_EXPORT_EMAILS (comma-separated), so a second
// partner address can be added with no code change. The email is sent once per
// recipient via the shared sender (lib/email.js). Members are stamped only when
// EVERY configured recipient's send succeeds — if any fails, nothing is stamped
// and the whole batch is retried on the next run (the partners de-duplicate on
// their side, so a rare re-send is harmless; a dropped member would not be).

import { requireAdmin, agentSecretOk, makeSupabase, json } from '../../../lib/admin-auth.js';
import { sendEmail, confirmationEnabled } from '../../../lib/email.js';
import { partnerExportCsv, partnerExportHTML, partnerExportSubject } from '../../../lib/comms-templates.js';

const OPTED_IN = 'urgent_and_updates';   // the "send me AI safety news" contact pref
const MAX_BATCH = 5000;                   // safety cap; daily volumes are far smaller

function recipients(env) {
  return (env.PARTNER_EXPORT_EMAILS || '')
    .split(',')
    .map(s => s.trim())
    .filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;
  if (method !== 'POST' && method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  // Either auth path is accepted.
  const authed = agentSecretOk(context) || (await requireAdmin(context)) != null;
  if (!authed) return json({ error: 'Unauthorized' }, 401);

  const supabase = makeSupabase(env);
  if (!supabase) return json({ error: 'Server not configured' }, 500);

  const dryRun = new URL(request.url).searchParams.get('dry_run') === '1' || method === 'GET';

  // Fetch the pending batch: confirmed, opted-in, not yet exported.
  const { data: members, error } = await supabase
    .from('members')
    .select('id, first_name, last_name, email, confirmed_at, signed_at')
    .eq('confirmed', true)
    .eq('contact_pref', OPTED_IN)
    .is('partner_exported_at', null)
    .order('signed_at', { ascending: true })
    .limit(MAX_BATCH);

  if (error) {
    console.error('partner export select error:', error.message || error);
    return json({ error: 'Failed to read members' }, 500);
  }

  const batch = members || [];
  const csv = partnerExportCsv(batch);

  if (dryRun) {
    return json({ dry_run: true, count: batch.length, recipients: recipients(env), csv }, 200, { 'Cache-Control': 'no-store' });
  }

  // Nothing to send → no email, no stamp. Keeps the partners' inboxes quiet.
  if (batch.length === 0) return json({ sent: false, count: 0, reason: 'no new members' });

  const to = recipients(env);
  if (!to.length) {
    return json({ error: 'No recipients configured. Set PARTNER_EXPORT_EMAILS.' }, 501);
  }
  if (!confirmationEnabled(env)) {
    return json({ error: 'No email sender configured (Gmail SMTP / Gmail API / Resend).' }, 501);
  }

  const dateLabel = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London',
  });
  const subject = partnerExportSubject(batch.length, dateLabel);
  const html = partnerExportHTML(batch, dateLabel);

  // Send once per recipient; require ALL to succeed before stamping.
  const results = [];
  let allOk = true;
  for (const addr of to) {
    let ok = false;
    try {
      ok = await sendEmail(env, addr, subject, html);
    } catch (e) {
      console.error('partner export send threw for', addr, e?.message || e);
    }
    results.push({ to: addr, ok });
    if (!ok) allOk = false;
  }

  if (!allOk) {
    // Leave the batch unstamped so the next run retries every recipient.
    console.error('partner export: at least one recipient failed — not stamping', results);
    return json({ sent: false, count: batch.length, recipients: results, error: 'Send failed for one or more recipients' }, 502);
  }

  // All sends succeeded — stamp the batch so these members are never re-sent.
  const now = new Date().toISOString();
  const ids = batch.map(m => m.id);
  const { error: stampError } = await supabase
    .from('members')
    .update({ partner_exported_at: now })
    .in('id', ids);

  if (stampError) {
    // Sent but not stamped: the same batch will go out again next run. Surfaced
    // loudly so it can be reconciled; a duplicate is preferable to a drop.
    console.error('partner export: sent but FAILED to stamp — batch may re-send next run:', stampError.message || stampError);
    return json({ sent: true, count: batch.length, recipients: results, warning: 'Sent but failed to record export; may re-send next run' }, 200);
  }

  return json({ sent: true, count: batch.length, recipients: results }, 200, { 'Cache-Control': 'no-store' });
}
