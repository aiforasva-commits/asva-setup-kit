// functions/api/admin/comms.js
// GET /api/admin/comms  (admin session cookie required)
// Returns every automatically-sent communication, rendered with sample data, so
// the Golden Path "Communications" tab can preview exactly what goes out. The
// templates come from lib/comms-templates.js — the same source the live senders
// use — so the preview can never drift from reality.

import { requireAdmin, makeSupabase, json } from '../../../lib/admin-auth.js';
import { COMMS, PAGES, SAMPLE, partnerExportHTML, partnerExportSubject } from '../../../lib/comms-templates.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const session = await requireAdmin(context);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  const comms = COMMS.map(c => ({
    id:       c.id,
    name:     c.name,
    kind:     c.kind || 'email',
    trigger:  c.trigger,
    fields:   c.fields,
    subject:  c.subject,
    editPath: c.editPath,
    html:     c.render(),
  }));

  // Live partner-export preview: the ACTUAL next batch — confirmed, opted-in
  // members not yet exported — rendered from the same template the daily sender
  // uses, so this shows exactly what would go out next. Falls back to sample
  // rows when nothing is queued, so the format is always visible.
  try {
    const supabase = makeSupabase(context.env);
    let batch = [];
    if (supabase) {
      const { data } = await supabase
        .from('members')
        .select('first_name, last_name, email, signed_at')
        .eq('confirmed', true)
        .eq('contact_pref', 'urgent_and_updates')
        .is('partner_exported_at', null)
        .order('signed_at', { ascending: true })
        .limit(5000);
      batch = data || [];
    }
    const queued    = batch.length;
    const dateLabel = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
    const to        = (context.env.PARTNER_EXPORT_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
    const toText    = to.length ? to.join(', ') : '(no recipients configured yet — set PARTNER_EXPORT_EMAILS)';
    const rows      = queued ? batch : SAMPLE.partnerMembers;
    comms.push({
      id:       'partner-export',
      name:     'Partner member export',
      kind:     'email',
      trigger:  `Sent automatically each day to the partner newsletter distributions (ControlAI, PauseAI): the new opted-in, confirmed members not yet shared. Currently ${queued} queued for the next send → ${toText}.` + (queued ? '' : ' Showing example rows — nothing is queued right now.'),
      fields:   ['New member rows (name + email)'],
      subject:  partnerExportSubject(queued || rows.length, dateLabel),
      editPath: 'functions/api/partners/export.js',
      html:     partnerExportHTML(rows, dateLabel),
    });
  } catch (e) {
    console.error('comms partner-export preview failed:', e?.message || e);
  }

  // Pages are shown alongside the emails. Their HTML is the live .html file,
  // read here from the deployed static assets so the preview always matches
  // what is actually served. If the asset can't be read (e.g. no ASSETS binding
  // in local dev), fall back to the live URL so the entry still previews.
  const origin = new URL(context.request.url).origin;
  for (const p of PAGES) {
    let html = '';
    try {
      if (context.env && context.env.ASSETS) {
        const res = await context.env.ASSETS.fetch(new URL('/' + p.path, origin));
        if (res.ok) html = await res.text();
      }
    } catch (_) { /* fall through to previewUrl */ }
    comms.push({
      id:         p.id,
      name:       p.name,
      kind:       p.kind || 'page',
      trigger:    p.trigger,
      fields:     p.fields,
      subject:    null,
      editPath:   p.editPath,
      previewUrl: p.previewUrl,
      html,
    });
  }

  return json({ comms, sample: SAMPLE }, 200, { 'Cache-Control': 'no-store' });
}
