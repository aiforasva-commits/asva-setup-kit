// functions/api/pledge.js
// Handles POST requests from pledge.html and writes to the 'members' table in Supabase.
// Credentials stay server-side — never exposed in the browser.

import { createClient } from '@supabase/supabase-js';
import { sendEmail, confirmationEnabled } from '../../lib/email.js';
import { confirmationEmailHTML, updateEmailHTML, SUBJECTS } from '../../lib/comms-templates.js';
import { normalizeEmail } from '../../lib/normalize-email.js';

// ── Rate limiting helpers ─────────────────────────────────────────────────────
const RATE_LIMIT_MAX     = 5;
const RATE_LIMIT_WINDOW  = 10 * 60 * 1000; // 10 minutes in ms

async function hashIP(ip) {
  const data = new TextEncoder().encode(ip + ':asva-rl');
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Email canonicalisation ────────────────────────────────────────────────────
// normalizeEmail() (lib/normalize-email.js) collapses alias forms of the SAME
// inbox to one value so a person can't be counted as multiple members by
// tweaking their address. The de-dup lookup and the UNIQUE index both key on
// this value; the raw email (as typed) is still stored separately and used
// for the confirmation email, which delivers fine to any of these alias forms.

// ── Server-side constituency backfill ─────────────────────────────────────────
// Address-mode signups derive their constituency in the browser from postcodes.io
// (see pledge.html) and send it as `constituency`. That client lookup is async and
// best-effort: a network hiccup, a submit that races the fetch, or a postcode
// postcodes.io can't map all leave `constituency` empty while address + postcode
// still satisfy server validation — so the member is stored with NO constituency.
// Such a member is invisible to the whole national overview: member-counts.js and
// latest-member.js both key on constituency, and confirmed.html falls back to its
// generic "your constituency" wording. Resolve it here from the postcode so every
// signup that carries a postcode is counted. Uses the SAME postcodes.io field the
// client uses, so the resolved name matches the hex-grid names the overview keys
// on. Fails open (returns null) — a lookup outage must never block a signup.
async function constituencyFromPostcode(postcode) {
  const raw = String(postcode ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return null;
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(raw)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 200 || !data.result) return null;
    return data.result.parliamentary_constituency_2024 || data.result.parliamentary_constituency || null;
  } catch {
    return null;
  }
}

// ── Confirmation emails (double opt-in) ───────────────────────────────────────
// The actual sending (Gmail SMTP → Gmail API → Resend, tried in order) lives in
// lib/email.js and is shared with the admin magic-link login. The templates and
// subjects live in lib/comms-templates.js (the single source of truth the admin
// Communications viewer also renders from). If no sender backend is configured,
// confirmationEnabled() returns false and signups are stored confirmed
// immediately (the original behaviour); see onRequest below.

// The editable member fields from a submitted pledge form. Shared by the initial
// insert, the in-place refresh of an unconfirmed re-signup, and the
// pending_update payload stored for a confirmed member's edit. Absent optional
// fields are set to null so that on update, switching input (e.g. from a typed
// address to a picked constituency) clears the value that no longer applies.
// Email is deliberately excluded — it's the identity key; a changed email is a
// different canonical inbox and therefore a new member, not an edit.
function buildMemberFields(body) {
  return {
    first_name:    String(body.first_name).trim(),
    last_name:     String(body.last_name).trim(),
    pledge_level:  body.pledge_level,
    contact_pref:  body.contact_pref,
    address_line1: body.address_line1 ? String(body.address_line1).trim() : null,
    address_line2: body.address_line2 ? String(body.address_line2).trim() : null,
    city:          body.city ? String(body.city).trim() : null,
    postcode:      body.postcode ? String(body.postcode).trim().toUpperCase() : null,
    constituency:  body.constituency ? String(body.constituency).trim() : null,
  };
}

function sendConfirmationEmail(env, to, firstName, confirmUrl) {
  return sendEmail(env, to, SUBJECTS.signupConfirm, confirmationEmailHTML(firstName, confirmUrl));
}

function sendUpdateEmail(env, to, firstName, confirmUrl) {
  return sendEmail(env, to, SUBJECTS.detailsUpdate, updateEmailHTML(firstName, confirmUrl));
}

// Returns true if the request should be blocked. Fails open on any DB error so
// a Supabase outage never prevents legitimate submissions.
async function isRateLimited(supabase, ipHash) {
  try {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW).toISOString();

    const { data } = await supabase
      .from('rate_limits')
      .select('attempts, window_start')
      .eq('ip_hash', ipHash)
      .maybeSingle();

    if (!data || data.window_start < windowStart) {
      // No record yet, or the window has expired — start a fresh window
      await supabase.from('rate_limits').upsert(
        { ip_hash: ipHash, attempts: 1, window_start: new Date().toISOString() },
        { onConflict: 'ip_hash' }
      );
      return false;
    }

    if (data.attempts >= RATE_LIMIT_MAX) {
      return true; // blocked
    }

    await supabase
      .from('rate_limits')
      .update({ attempts: data.attempts + 1 })
      .eq('ip_hash', ipHash);

    return false;
  } catch {
    return false; // fail open — never block legitimate users due to a DB error
  }
}

export async function onRequest(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle CORS preflight
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow POST
  if (context.request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: corsHeaders }
    );
  }

  // Check env vars
  const supabaseUrl = (context.env.SUPABASE_URL || '').trim();
  const supabaseKey = (context.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !supabaseKey) {
    return new Response(
      JSON.stringify({ error: 'Missing Supabase configuration' }),
      { status: 500, headers: corsHeaders }
    );
  }

  // Parse body
  let body;
  try {
    body = await context.request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: corsHeaders }
    );
  }

  // ── Honeypot — real users never fill this in ─────────────────────────────
  if (body.website) {
    return new Response(
      JSON.stringify({ error: 'Bad request' }),
      { status: 400, headers: corsHeaders }
    );
  }

  // ── Turnstile verification ────────────────────────────────────────────────
  const turnstileSecret = (context.env.TURNSTILE_SECRET_KEY || '').trim();
  if (turnstileSecret) {
    const token = (body['cf-turnstile-response'] || '').trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: 'Security check required' }),
        { status: 400, headers: corsHeaders }
      );
    }
    const ip = context.request.headers.get('CF-Connecting-IP') || '';
    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(turnstileSecret)}&response=${encodeURIComponent(token)}&remoteip=${encodeURIComponent(ip)}`,
    });
    const verifyData = await verifyRes.json();
    if (!verifyData.success) {
      return new Response(
        JSON.stringify({ error: 'Security check failed — please try again' }),
        { status: 403, headers: corsHeaders }
      );
    }
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const supabaseForRL = createClient(supabaseUrl, supabaseKey);
  const ip            = context.request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash        = await hashIP(ip);

  if (await isRateLimited(supabaseForRL, ipHash)) {
    return new Response(
      JSON.stringify({ error: 'Too many submissions — please try again later' }),
      { status: 429, headers: corsHeaders }
    );
  }

  // Basic server-side validation
  const { first_name, last_name, email, address_line1, postcode, contact_pref, pledge_level, constituency } = body;
  const hasAddress = address_line1 && postcode;
  const hasConstituency = !!constituency;
  if (!first_name || !last_name || !email || (!hasAddress && !hasConstituency) || !contact_pref || !pledge_level) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields' }),
      { status: 400, headers: corsHeaders }
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(
      JSON.stringify({ error: 'Invalid email address' }),
      { status: 400, headers: corsHeaders }
    );
  }
  const validLevels = ['L1', 'L2'];
  if (!validLevels.includes(pledge_level)) {
    return new Response(
      JSON.stringify({ error: 'Invalid pledge level' }),
      { status: 400, headers: corsHeaders }
    );
  }
  const validPrefs = ['urgent_and_updates', 'urgent_only'];
  if (!validPrefs.includes(contact_pref)) {
    return new Response(
      JSON.stringify({ error: 'Invalid contact preference' }),
      { status: 400, headers: corsHeaders }
    );
  }

  // Backfill a missing constituency from the postcode before anything is stored.
  // An address-mode signup can reach here with a postcode but no constituency if
  // the browser's postcodes.io lookup didn't land (see constituencyFromPostcode).
  // Resolving it here — for the initial insert AND the returning-member update
  // paths below, all of which read body.constituency via buildMemberFields — is
  // what keeps such a member from vanishing from the national overview and the
  // personalised confirmation page. Skipped when a constituency is already set.
  if (!constituency && postcode) {
    const resolved = await constituencyFromPostcode(postcode);
    if (resolved) body.constituency = resolved;
  }

  // Insert into Supabase
  try {
    const supabase = supabaseForRL;

    // Double opt-in is active only when a sender backend is configured
    // (Gmail or Resend — see confirmationEnabled). Without one, signups are
    // stored confirmed immediately (the original behaviour) and none of the
    // confirmation columns are touched — so this code is safe to deploy
    // before the SQL migration has been run.
    const emailEnabled   = confirmationEnabled(context.env);
    const siteOrigin     = new URL(context.request.url).origin;
    const cleanEmail     = email.trim().toLowerCase();
    const canonicalEmail = normalizeEmail(email);

    // De-dup on the canonical form so alias addresses for the same inbox
    // (e.g. sarah@ and sarah+asva@ / s.arah@ on Gmail) resolve to one member.
    const { data: existing } = await supabase
      .from('members')
      .select(emailEnabled ? 'id, first_name, confirmed, confirm_token' : 'id')
      .eq('email_canonical', canonicalEmail)
      .maybeSingle();

    if (existing) {
      const fields = buildMemberFields(body);
      const now    = new Date().toISOString();

      // Unconfirmed re-signup: they aren't counted yet, so refresh their stored
      // details in place and re-send the standard confirmation email. This
      // recovers a lost or undelivered first email and captures any corrections
      // made on the second submission.
      if (emailEnabled && existing.confirmed === false) {
        const token = existing.confirm_token || crypto.randomUUID();
        await supabase
          .from('members')
          .update({ ...fields, confirm_token: token, confirm_sent_at: now })
          .eq('id', existing.id);
        // The re-signup is already saved; a mail hiccup must not surface as a
        // save failure, so send in its own try/catch. They can resubmit to
        // trigger a fresh link if it doesn't arrive.
        try {
          await sendConfirmationEmail(
            context.env, cleanEmail,
            fields.first_name,
            `${siteOrigin}/api/confirm?token=${token}`
          );
        } catch (mailErr) {
          console.error('Re-signup saved but confirmation email failed:', mailErr?.message || mailErr);
        }
        return new Response(
          JSON.stringify({ success: true, confirmation_sent: true }),
          { status: 200, headers: corsHeaders }
        );
      }

      // Confirmed member editing their details: stage the new details as a
      // pending update and email a fresh confirm link. Nothing on the live
      // record changes until /api/confirm applies it, so an unconfirmed edit
      // (or someone entering an address that isn't theirs) can never silently
      // alter a real membership.
      if (emailEnabled && existing.confirmed === true) {
        const token = crypto.randomUUID();
        const { error: stageError } = await supabase
          .from('members')
          .update({ pending_update: fields, confirm_token: token, confirm_sent_at: now })
          .eq('id', existing.id);
        if (stageError) {
          // Most likely the pending_update column doesn't exist yet
          // (supabase/pending_update.sql not run). Fall back to the pre-edit
          // behaviour — treat as an existing member and change nothing — rather
          // than erroring on a returning member. No update email is sent.
          console.error('Could not stage pending update — has pending_update.sql been run?', stageError.message || stageError);
          return new Response(
            JSON.stringify({ success: true, already_member: true }),
            { status: 200, headers: corsHeaders }
          );
        }
        // The edit is staged; don't let a mail hiccup report a save failure.
        try {
          await sendUpdateEmail(
            context.env, cleanEmail,
            fields.first_name,
            `${siteOrigin}/api/confirm?token=${token}`
          );
        } catch (mailErr) {
          console.error('Edit staged but update email failed:', mailErr?.message || mailErr);
        }
        return new Response(
          JSON.stringify({ success: true, update_confirmation_sent: true }),
          { status: 200, headers: corsHeaders }
        );
      }

      // Email confirmation disabled (no sender backend configured): keep the
      // original behaviour of silently treating the duplicate as an existing
      // member — there's no way to confirm an edit without email.
      return new Response(
        JSON.stringify({ success: true, already_member: true }),
        { status: 200, headers: corsHeaders }
      );
    }

    const record = {
      ...buildMemberFields(body),
      email:           cleanEmail,
      email_canonical: canonicalEmail,
      pledge_signed:   true,
      signed_at:       new Date().toISOString(),
    };

    let confirmToken = null;
    if (emailEnabled) {
      confirmToken           = crypto.randomUUID();
      record.confirmed       = false;
      record.confirm_token   = confirmToken;
      record.confirm_sent_at = new Date().toISOString();
    }

    const { error } = await supabase.from('members').insert([record]);

    if (error) {
      // Unique violation on email_canonical (Postgres 23505): a concurrent
      // submission registered this inbox between our existence check above and
      // this insert. That's the duplicate we wanted to block — treat it as an
      // already-existing member (the other request owns sending confirmation).
      if (error.code === '23505') {
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: corsHeaders }
        );
      }
      throw error;
    }

    // Send after the insert so a mail failure never loses the signup — the
    // member can resubmit the form to trigger the resend path above. Isolate it
    // in its own try/catch: the row is already saved, so a transient email
    // error must NOT bubble to the 500 handler and tell the signer we couldn't
    // save their signature when in fact we did.
    if (confirmToken) {
      try {
        await sendConfirmationEmail(
          context.env, cleanEmail, first_name.trim(),
          `${siteOrigin}/api/confirm?token=${confirmToken}`
        );
      } catch (mailErr) {
        console.error('Signup saved but confirmation email failed to send:', mailErr?.message || mailErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, confirmation_sent: !!confirmToken }),
      { status: 200, headers: corsHeaders }
    );

  } catch (error) {
    // Log the full Postgres error (code/message/details/hint) so the real cause
    // is visible in the Function logs rather than a bare stack. A not-null
    // violation (23502) here means the row left a NOT NULL column null — most
    // likely an address column on a "Select my constituency" signup, which
    // sends no address. See supabase/nullable_address.sql for that fix.
    console.error('Supabase insert error:', {
      code:    error?.code,
      message: error?.message,
      details: error?.details,
      hint:    error?.hint,
    });
    return new Response(
      JSON.stringify({ error: 'Failed to save — please try again' }),
      { status: 500, headers: corsHeaders }
    );
  }
}
