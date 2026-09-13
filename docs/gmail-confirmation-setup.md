# Sending confirmation emails from Gmail

This sets up the pledge form's confirmation emails to send genuinely from
`aiforasva@gmail.com`, using Gmail's normal free account limit (about 500
emails/day — far more than needed for one email per signup).

**Time:** ~5–10 minutes, one-time. **Cost:** free. Nobody but you needs to do
this — it has to be done from your own Google Account.

---

## 1. Run the database migration first

Before turning on confirmation emails at all: open your Supabase project →
**SQL Editor** → **New query** → paste the contents of
`supabase/email_confirmation.sql` → **Run**.

This adds the columns the confirmation flow needs and keeps every existing
member counted (they're marked confirmed automatically). Do this once,
regardless of which sender option below you use.

---

## 2. Turn on 2-Step Verification (if not already on)

App Passwords require it. Go to
[myaccount.google.com/security](https://myaccount.google.com/security),
signed in as `aiforasva@gmail.com`, and turn on **2-Step Verification** if
it isn't already. Skip this step if it's already enabled.

## 3. Create an App Password

1. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
   (still signed in as `aiforasva@gmail.com`). If that link asks you to
   search for it instead: Google Account → **Security** → search "App
   Passwords" in the search box at the top.
2. Enter a name to remember it by, e.g. `ASVA Scorecard` → **Create**.
3. Google shows a 16-character password (four groups of four, e.g. `abcd
   efgh ijkl mnop`). Copy it — you won't be able to see it again (though
   you can always revoke it and generate a new one).

This password is scoped to sending mail via this one integration — it's not
your real Google password, and you can revoke it any time from the same
App Passwords page without affecting your normal login.

## 4. Add the two values to Cloudflare

1. Go to your Cloudflare Pages project → **Settings** → **Environment
   variables** → **Production** (repeat for **Preview** if you use preview
   deploys).
2. Add these two variables:

   | Variable | Value |
   |---|---|
   | `GMAIL_USER` | `aiforasva@gmail.com` |
   | `GMAIL_APP_PASSWORD` | the 16-character password from step 3 (with or without the spaces — either works) |

3. **Encrypt** `GMAIL_APP_PASSWORD` (Cloudflare offers this as a toggle when
   adding a variable) — it's a credential.
4. Redeploy the site (or push any commit) so the new variables take effect.

## 5. Test it

Sign the pledge on the live site with an email address you can check. You
should receive "Confirm your ASVA membership" within a few seconds, sent
from `aiforasva@gmail.com`. Click the link and confirm you land on the
"Email confirmed" page, and that the constituency's member count on the map
increases by one.

---

## If something goes wrong

- **No email arrives, no error on the site:** the form always succeeds even
  if the email fails to send (so a mail outage never loses a signup) — check
  the Cloudflare Pages **Functions** logs for `Gmail SMTP send failed` to see
  what went wrong.
- **"Authentication failed" in the logs:** double-check `GMAIL_APP_PASSWORD`
  was copied correctly and that 2-Step Verification is still on — turning it
  off automatically invalidates all App Passwords for the account.
- **Want to switch to a real domain later:** buy the domain, verify it with
  Resend, set `RESEND_API_KEY` + `EMAIL_FROM`, and remove `GMAIL_USER` /
  `GMAIL_APP_PASSWORD` (or leave them — Gmail is tried first, so removing
  them is what actually switches the sender). Five-minute change; nothing
  about existing members or in-flight confirmation links depends on which
  sender is configured.

---

## Alternative: Gmail API via OAuth (not recommended)

An earlier version of this guide used Google Cloud Console + OAuth
(`GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` /
`GMAIL_FROM_ADDRESS`) instead of an App Password. It still works as a
fallback tier in the code, but **the App Password approach above is
strictly better for this use case** — the OAuth route has a real limitation
worth understanding if you're deciding between them:

Google classifies `gmail.send` as a "sensitive" scope. For any app that
hasn't completed Google's full verification review, the refresh token
expires on a **fixed 7-day clock from the moment you authorize it** —
regardless of activity, and regardless of whether the app's "publishing
status" is Testing or Production. The only way to get a token that doesn't
expire is to complete Google's verification process: a public privacy
policy, provable domain ownership, and a review that can take days to
weeks. Without that, confirmation emails would silently stop working every
week.

The App Password route has none of this — it's a different, older Google
mechanism (used by mail clients, not OAuth apps) that isn't subject to the
sensitive-scope review process at all.

If you specifically want the OAuth route anyway (e.g. you'd rather not
enable 2-Step Verification, or you're already deep into Google Cloud
Console for another reason), the setup is: create a Google Cloud project →
enable the Gmail API → configure the **Google Auth Platform** (Google's
2024 rename/restructure of "OAuth consent screen" — now a short wizard
followed by **Branding / Audience / Data Access / Clients** tabs) → add the
`gmail.send` scope under **Data Access** → add yourself as a test user under
**Audience** → create OAuth client credentials under **Clients** with
redirect URI `https://developers.google.com/oauthplayground` → use the
[OAuth Playground](https://developers.google.com/oauthplayground) to
exchange an authorization code for a refresh token (gear icon → your own
credentials → scope `https://www.googleapis.com/auth/gmail.send` →
Authorize → Exchange authorization code for tokens). Set all four
`GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` /
`GMAIL_FROM_ADDRESS` variables in Cloudflare, and repeat the token exchange
weekly (or complete Google's verification) to keep it working.
