// lib/comms-templates.js
// Single source of truth for every transactional email ASVA sends automatically.
//
// Both the live senders and the admin "Communications" viewer import from here,
// so the Golden Path preview always shows exactly what actually goes out. To
// change an email, edit its builder below — nothing else needs to change. To add
// a new automatic comm in future, add its builder and a COMMS entry, and it
// appears in the viewer automatically.
//
// Senders that use these:
//   • functions/api/pledge.js        → confirmationEmailHTML, updateEmailHTML
//   • functions/api/admin/login.js   → loginEmailHTML
// Viewer that renders previews from them:
//   • functions/api/admin/comms.js   → COMMS (GET, admin-only)

import { escapeHTML } from './email.js';

// ── Subjects (kept here so the viewer and the senders share one string) ───────
export const SUBJECTS = {
  signupConfirm:     'Confirm your ASVA membership',
  detailsUpdate:     'Confirm your updated ASVA details',
  adminLogin:        'Your ASVA review-page login link',
  memberLogin:       'Your ASVA scorecard-edit login link',
  memberConfirmed:   'Your suggested scorecard edit has been published',
  memberRejected:    'An update on your suggested scorecard edit',
};

// ── Email bodies ──────────────────────────────────────────────────────────────
// Sent immediately after someone signs the pledge (double opt-in). They are not
// counted as a member until they click the link.
export function confirmationEmailHTML(firstName, confirmUrl) {
  const name = escapeHTML(firstName);
  const url = escapeHTML(confirmUrl);
  return `
    <div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:560px;margin:0;text-align:left;">
      <p>Hi ${name}</p>
      <p>Please confirm your email address to complete your ASVA membership:</p>
      <p style="margin:28px 0;">
        <a href="${url}" style="background:#CC1133;color:#ffffff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block;">Confirm my email</a>
      </p>
      <p style="font-size:13px;color:#666;">Or copy this link into your browser:<br>${url}</p>
      <p style="font-size:13px;color:#666;">If you did not sign the AI safety pledge, you can safely ignore this email.</p>
    </div>`;
}

// Sent when an already-confirmed member re-submits the pledge form with changed
// details. The edit is staged and only applied once this link is clicked.
export function updateEmailHTML(firstName, confirmUrl) {
  const name = escapeHTML(firstName);
  const url = escapeHTML(confirmUrl);
  return `
    <div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:560px;margin:0;text-align:left;">
      <p>Hi ${name}</p>
      <p>We have received updated details for your ASVA membership. Confirm the change to update your record:</p>
      <p style="margin:28px 0;">
        <a href="${url}" style="background:#CC1133;color:#ffffff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block;">Confirm my updated details</a>
      </p>
      <p style="font-size:13px;color:#666;">Or copy this link into your browser:<br>${url}</p>
      <p style="font-size:13px;color:#666;">If you did not request this change, you can safely ignore this email and your details will stay as they are.</p>
    </div>`;
}

// Sent to the fixed ASVA admin address when someone requests access to the
// MP-rating review page (Golden Path).
export function loginEmailHTML(verifyUrl) {
  const url = escapeHTML(verifyUrl);
  return `
    <div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:560px;margin:0;text-align:left;">
      <p>Here is your one-time link to open the ASVA MP-rating review page:</p>
      <p style="margin:28px 0;">
        <a href="${url}" style="background:#CC1133;color:#ffffff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block;">Open the review page</a>
      </p>
      <p style="font-size:13px;color:#666;">Or copy this link into your browser:<br>${url}</p>
      <p style="font-size:13px;color:#666;">This link expires in 15 minutes and can only be used once. If you did not request it, you can safely ignore this email.</p>
    </div>`;
}

// ── Member scorecard-edit flow (functions/api/member/*, functions/api/member-submissions/*) ──
// Sent to a confirmed member's own inbox when they ask to log in from the
// scorecard to propose an edit to their MP's rating. Never sent anywhere the
// address doesn't already belong to (see lib/member-auth.js).
export function memberLoginEmailHTML(verifyUrl) {
  const url = escapeHTML(verifyUrl);
  return `
    <div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:560px;margin:0;text-align:left;">
      <p>Here is your one-time link to suggest an edit to your MP's ASVA scorecard rating:</p>
      <p style="margin:28px 0;">
        <a href="${url}" style="background:#CC1133;color:#ffffff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block;">Continue to the edit form</a>
      </p>
      <p style="font-size:13px;color:#666;">Or copy this link into your browser:<br>${url}</p>
      <p style="font-size:13px;color:#666;">This link expires in 15 minutes and can only be used once. If you did not request it, you can safely ignore this email.</p>
    </div>`;
}

// Sent when an admin confirms a member's suggested edit on /goldenpath.html.
// `amended` distinguishes "published exactly as you wrote it" from "published,
// but a reviewer changed some of it first" so the member isn't surprised to
// see the live card differ from what they submitted.
export function memberSubmissionConfirmedHTML(memberName, mpName, amended) {
  const name = escapeHTML(memberName);
  const mp   = escapeHTML(mpName);
  const body = amended
    ? `Thanks for the suggestion — a reviewer has published it on the scorecard for ${mp}, with some amendments before it went live.`
    : `Thanks for the suggestion — it has been published on the scorecard for ${mp} exactly as you submitted it.`;
  return `
    <div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:560px;margin:0;text-align:left;">
      <p>Hi ${name}</p>
      <p>${body}</p>
      <p style="font-size:13px;color:#666;">Thank you for helping keep the scorecard accurate — you're welcome to submit another edit any time something changes.</p>
    </div>`;
}

// Sent when an admin rejects a member's suggested edit. `reason` is an
// optional free-text note the reviewer can add; kept short and non-technical
// since it's shown verbatim to the member.
export function memberSubmissionRejectedHTML(memberName, mpName, reason) {
  const name = escapeHTML(memberName);
  const mp   = escapeHTML(mpName);
  const reasonBlock = reason
    ? `<p>The reviewer's note: <em>${escapeHTML(reason)}</em></p>`
    : '';
  return `
    <div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:560px;margin:0;text-align:left;">
      <p>Hi ${name}</p>
      <p>Thanks for suggesting an edit to the scorecard for ${mp}. A reviewer looked at it but decided not to publish it this time.</p>
      ${reasonBlock}
      <p style="font-size:13px;color:#666;">You're welcome to submit another edit any time — for example with additional sources, or once something changes.</p>
    </div>`;
}

// Sent to the fixed ASVA admin address whenever a member submits (or replaces)
// an edit, so it doesn't sit unseen until someone happens to open Golden Path.
export function newMemberSubmissionSubject(mpName, constituency) {
  return `New member submission — ${mpName} (${constituency})`;
}

export function newMemberSubmissionAdminHTML(memberName, mpName, constituency, reviewUrl) {
  const name = escapeHTML(memberName);
  const mp   = escapeHTML(mpName);
  const cons = escapeHTML(constituency);
  const url  = escapeHTML(reviewUrl);
  return `
    <div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:560px;margin:0;text-align:left;">
      <p>${name} suggested an edit to the ASVA scorecard rating for ${mp} (${cons}).</p>
      <p style="margin:28px 0;">
        <a href="${url}" style="background:#CC1133;color:#ffffff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block;">Review on Golden Path</a>
      </p>
    </div>`;
}

// ── Partner newsletter export (functions/api/partners/export.js) ──────────────
// The daily email to the partner distributions (ControlAI, PauseAI): the new
// opted-in members not yet shared, as a readable table plus a copyable CSV, with
// a provenance/consent header. Kept here so both the live sender and the Golden
// Path Communications preview render from this one source.

// One CSV field, RFC-4180 quoted: wrap in quotes and double any internal quote
// when the value contains a comma, quote or newline.
function csvField(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function partnerExportCsv(members) {
  const lines = ['First name,Last name,Email'];
  for (const m of members) {
    lines.push([csvField(m.first_name), csvField(m.last_name), csvField(m.email)].join(','));
  }
  return lines.join('\n');
}

export function partnerExportSubject(count, dateLabel) {
  return `ASVA — ${count} new member${count === 1 ? '' : 's'} — ${dateLabel}`;
}

export function partnerExportHTML(members, dateLabel) {
  const csv = partnerExportCsv(members);
  const rows = members.map(m => `
    <tr>
      <td style="padding:4px 12px 4px 0;">${escapeHTML(m.first_name)} ${escapeHTML(m.last_name)}</td>
      <td style="padding:4px 12px 4px 0;">${escapeHTML(m.email)}</td>
    </tr>`).join('');

  // Provenance / consent header — makes the partner's own UK GDPR Article 14
  // duty (telling recipients where their data came from) trivial to meet.
  return `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;color:#111;line-height:1.5;">
  <p><strong>ASVA member list — ${escapeHTML(dateLabel)}</strong></p>
  <p style="background:#f4f6fb;border:1px solid #d9e0ef;border-radius:6px;padding:10px 12px;">
    These ${members.length} contact${members.length === 1 ? '' : 's'} were collected by the AI Safety Voter
    Alliance (aisafetyvoteralliance.co.uk) under explicit opt-in consent to receive AI safety news from
    ControlAI and PauseAI. Source: ASVA member sign-up. Each person has confirmed their email address
    (double opt-in) and can withdraw at any time.
  </p>
  <table style="border-collapse:collapse;margin:12px 0;">
    <thead><tr>
      <th style="text-align:left;padding:4px 12px 4px 0;border-bottom:1px solid #ccc;">Name</th>
      <th style="text-align:left;padding:4px 12px 4px 0;border-bottom:1px solid #ccc;">Email</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="margin-top:16px;">CSV (select and copy for bulk import):</p>
  <pre style="background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:12px;overflow:auto;font-size:13px;white-space:pre;">${escapeHTML(csv)}</pre>
</div>`;
}

// ── Resubmission screen (on pledge.html) ──────────────────────────────────────
// The on-page message an already-confirmed member sees after re-submitting the
// pledge form with changed details: their edit is staged and a confirm link
// emailed. Mirrors the update-confirmation state of the #successCard on
// pledge.html, rendered self-contained (inline styles) so the preview shows
// correctly in the scriptless Communications iframe without the site stylesheet.
export function resubmitScreenHTML(email) {
  const addr = escapeHTML(email);
  return `<div style="font-family:system-ui,Arial,sans-serif;background:#fbfaf7;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e7e4dd;border-radius:26px;box-shadow:0 6px 18px rgba(0,0,0,.06);overflow:hidden;">
    <div style="text-align:center;padding:48px 24px;">
      <div style="font-size:56px;margin-bottom:16px;">✉️</div>
      <h2 style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:400;margin:0 0 10px;color:#1a1a2e;">Almost done, check your email</h2>
      <p style="font-size:18px;color:#6b6b76;margin:0;line-height:1.5;">
        You're already a member, so we've sent a confirmation link to ${addr}. We'll update your details as
        soon as you click it. If it doesn't arrive, check spam or sign the pledge again for a fresh link.
      </p>
    </div>
  </div>
</div>`;
}

// ── Sample values for previews ────────────────────────────────────────────────
// The dynamic parts of each email, filled with example data so the viewer can
// render a realistic preview without any real member or token.
export const SAMPLE = {
  firstName:  'Alex',
  email:      'alex.rivera@example.com',
  confirmUrl: 'https://aisafetyvoteralliance.co.uk/api/confirm?token=EXAMPLE-TOKEN',
  verifyUrl:  'https://aisafetyvoteralliance.co.uk/api/admin/verify?token=EXAMPLE-TOKEN',
  memberVerifyUrl: 'https://aisafetyvoteralliance.co.uk/api/member/verify?token=EXAMPLE-TOKEN',
  mpName:     'Ian Byrne',
  constituency: 'Liverpool West Derby',
  reviewUrl:  'https://aisafetyvoteralliance.co.uk/goldenpath.html',
  rejectReason: 'Thanks for this — the bullet about the US superintelligence letter needs a source link before we can publish it.',
  // Example rows for the partner-export preview when nothing is queued.
  partnerMembers: [
    { first_name: 'Alex',  last_name: 'Rivera', email: 'alex.rivera@example.com' },
    { first_name: 'Sam',   last_name: 'Okafor', email: 'sam.okafor@example.com' },
    { first_name: 'Priya', last_name: 'Nair',   email: 'priya.nair@example.com' },
  ],
};

// ── Catalogue used by the admin Communications viewer ─────────────────────────
// Order here is the order shown in the tab. `editPath` names the file to edit
// to change the item permanently — the viewer surfaces it in the source pane.
export const COMMS = [
  {
    id: 'signup-confirm',
    name: 'Sign-up confirmation',
    kind: 'email',
    trigger: 'Sent as soon as someone signs the pledge. They must click the link before they are counted as a member (double opt-in).',
    fields: ['First name', 'Confirmation link'],
    subject: SUBJECTS.signupConfirm,
    editPath: 'lib/comms-templates.js',
    render: (s = SAMPLE) => confirmationEmailHTML(s.firstName, s.confirmUrl),
  },
  {
    id: 'details-update',
    name: 'Details-update confirmation',
    kind: 'email',
    trigger: 'Sent when an existing, already-confirmed member re-submits the pledge form with changed details. The edit is only applied once they click the link.',
    fields: ['First name', 'Confirmation link'],
    subject: SUBJECTS.detailsUpdate,
    editPath: 'lib/comms-templates.js',
    render: (s = SAMPLE) => updateEmailHTML(s.firstName, s.confirmUrl),
  },
  {
    id: 'resubmit-screen',
    name: 'Resubmission screen',
    kind: 'page',
    trigger: 'Shown on the pledge page when an already-confirmed member re-submits the form with changed details. Their edit is staged and a confirm link emailed (the "Details-update confirmation" above); they see this screen until they click it.',
    fields: ['Email address'],
    editPath: 'pledge.html',
    render: (s = SAMPLE) => resubmitScreenHTML(s.email),
  },
  {
    id: 'admin-login',
    name: 'Admin login link',
    kind: 'email',
    trigger: 'Sent to the fixed ASVA admin address when someone requests access to this review page (Golden Path).',
    fields: ['Login link'],
    subject: SUBJECTS.adminLogin,
    editPath: 'lib/comms-templates.js',
    render: (s = SAMPLE) => loginEmailHTML(s.verifyUrl),
  },
  {
    id: 'member-login',
    name: 'Member scorecard-edit login link',
    kind: 'email',
    trigger: 'Sent to a confirmed member\'s own inbox when they ask (from a card on the scorecard) to log in and suggest an edit to their MP\'s rating. Only sent when the typed email matches an existing confirmed member.',
    fields: ['Login link'],
    subject: SUBJECTS.memberLogin,
    editPath: 'lib/comms-templates.js',
    render: (s = SAMPLE) => memberLoginEmailHTML(s.memberVerifyUrl),
  },
  {
    id: 'member-submission-confirmed',
    name: 'Member edit — confirmed',
    kind: 'email',
    trigger: 'Sent to the member when an admin confirms their suggested MP-rating edit on Golden Path. Wording differs depending on whether the admin changed anything before publishing.',
    fields: ['First name', 'MP name', 'Amended (yes/no)'],
    subject: SUBJECTS.memberConfirmed,
    editPath: 'lib/comms-templates.js',
    render: (s = SAMPLE) => memberSubmissionConfirmedHTML(s.firstName, s.mpName, true),
  },
  {
    id: 'member-submission-rejected',
    name: 'Member edit — rejected',
    kind: 'email',
    trigger: 'Sent to the member when an admin rejects their suggested MP-rating edit on Golden Path, with an optional reviewer note.',
    fields: ['First name', 'MP name', 'Reviewer note (optional)'],
    subject: SUBJECTS.memberRejected,
    editPath: 'lib/comms-templates.js',
    render: (s = SAMPLE) => memberSubmissionRejectedHTML(s.firstName, s.mpName, s.rejectReason),
  },
  {
    id: 'member-submission-admin-notify',
    name: 'New member submission (to admin)',
    kind: 'email',
    trigger: 'Sent to the fixed ASVA admin address whenever a member submits or replaces a suggested MP-rating edit, so it doesn\'t sit unseen until Golden Path is next opened.',
    fields: ['Member first name', 'MP name', 'Constituency', 'Golden Path link'],
    subject: newMemberSubmissionSubject(SAMPLE.mpName, SAMPLE.constituency),
    editPath: 'lib/comms-templates.js',
    render: (s = SAMPLE) => newMemberSubmissionAdminHTML(s.firstName, s.mpName, s.constituency, s.reviewUrl),
  },
];

// ── Pages shown alongside the emails ─────────────────────────────────────────
// Not emails, but part of the same confirmation flow: the web page a member
// lands on after clicking a link in one of the emails above. Its content is the
// live .html file itself — the viewer reads that file (via the Pages ASSETS
// binding) so the preview can never drift from what is actually served. Because
// the preview iframe runs no scripts, the page shows in its confirmed
// ("success") state, which is the default markup; the same page also handles
// the invalid- and error-link states via its own script at runtime.
export const PAGES = [
  {
    id: 'confirm-page',
    name: 'Email-confirmation page',
    kind: 'page',
    trigger: 'The page people land on after clicking the confirm link in their sign-up or details-update email. Shown here in its confirmed state; the same page also handles invalid or expired links.',
    fields: ['Constituency scorecard link', 'AI-safety-news line (only when opted in)'],
    // Where the live page is served, and the file to edit to change it.
    path: 'confirmed.html',
    previewUrl: '/confirmed.html?status=ok',
    editPath: 'confirmed.html',
  },
];
