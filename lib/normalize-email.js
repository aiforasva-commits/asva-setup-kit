// lib/normalize-email.js
// Shared with functions/api/pledge.js (member sign-up/de-dup) and
// functions/api/member/login.js (looking a member up by the email they type
// to request a login link) — both need the exact same canonical form so a
// member is found regardless of which alias of their inbox they use.
//
// Collapses alias forms of the SAME inbox to one value:
//   • lowercase + trim (matches how the raw email is stored)
//   • drop the "+tag" subaddress from the local part — Gmail, Outlook, iCloud,
//     Fastmail and others all deliver "user+tag@" to "user@"
//   • for gmail.com / googlemail.com only: remove dots from the local part
//     (Gmail ignores them, so "s.arah@" == "sarah@") and fold googlemail.com
//     onto gmail.com (same inbox). Dots are significant on other providers, so
//     they are left untouched there.
export function normalizeEmail(email) {
  const cleaned = String(email ?? '').trim().toLowerCase();
  const at = cleaned.lastIndexOf('@');
  if (at === -1) return cleaned; // not an address shape — de-dup on the raw value
  let local = cleaned.slice(0, at);
  let domain = cleaned.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus !== -1) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replaceAll('.', '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}
