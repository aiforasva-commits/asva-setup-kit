# Setting up your own copy of this scorecard

This file is written **to Claude**, running in Claude Code on behalf of someone
setting up their own AI-safety voter scorecard for their own country, using
this repository as a starting point. If you're the human: the easiest way to
use this is to open this repo in Claude Code (or paste this file into a Claude
Pro chat) and say "read SETUP.md and walk me through it." Claude should read
the referenced files, do the mechanical work (find/replace, running scripts),
and ask the human for the things only they can provide (account logins,
domain choice, org name).

Do the steps in order — later steps assume earlier ones are done.

---

## 0. What the human needs before you start

Ask for these up front if they haven't been provided:

- A **GitHub account**, with this repo already copied into it (see step 1).
- A **Cloudflare account** (free tier works) — this site deploys as a
  Cloudflare Pages project with Cloudflare Functions for the backend.
- A **Supabase account** (free tier works) — the database.
- A **Google account** — the representative/candidate data is maintained in a
  Google Sheet and published as CSV; no Google Cloud project or API key needed.
- A **domain name** for the site.
- An email address to send from. A plain **Gmail address** is enough (see
  `docs/gmail-confirmation-setup.md`) — no custom email-sending service required.
- Ongoing access to **Claude Code** (Pro subscription is sufficient) — the
  representative-research workflow (step 8) runs as a Claude Code skill, not a
  metered API, so there's no separate AI bill.

## 1. Get your own copy of the code

Don't just copy the files — get a real, separate GitHub repo so Cloudflare
Pages can deploy from it:

- If this repo has been marked as a **GitHub template repository**, the
  human clicks "Use this template" → "Create a new repository" on GitHub.
  This gives a brand-new repo with a clean history (just this snapshot, none
  of the original org's commit log).
- If it hasn't been marked as a template, ask the human to fork it or ask the
  repo owner to enable the "Template repository" checkbox in Settings →
  General, then use that button instead of a fork (a fork stays formally
  linked to the original repo, which isn't what you want for an independent
  country site).

Once the new repo exists, clone it and do everything below there.

## 2. Read this before changing anything: what's genuinely UK-specific

This codebase was built for the **UK Parliament**: 650 single-member
geographic constituencies, each electing one MP. Before rebranding, form a
view (and check it with the human) on whether your country's legislature has
the same basic shape — one representative per geographic seat. If it does
(most single-member-district systems), everything below translates directly.
If it doesn't (proportional/party-list systems, multi-member districts,
non-geographic representation), the "one grade per seat, one hex per seat"
model needs rethinking before writing code — say so, rather than forcing a
UK-shaped model onto a different electoral system.

Assuming a compatible system, here's exactly what's UK-specific and what each
piece needs:

| File | What it does | What you need to do |
|---|---|---|
| `hex-layout.json` | Hand-built hex-grid geometry for the UK's 650 constituencies (`name`, `code`, `gss`, `cx`/`cy`, `pts` per seat) | Replace with an equivalent file for your legislature's seats, **or** skip the hex map and use a simple list/table view instead (much less work — see step 3) |
| `scripts/fetch-data.js` → `ELECTION_BASELINE_URL` | Pulls the baseline "who currently holds each seat" data from `electionresults.parliament.uk` | Point at your country's equivalent official results source, or drop this and rely entirely on the Google Sheet's `CurrentMP`/`Majority` columns (simpler, more manual) |
| `scripts/build-signatory-snapshot.js`, `lib/signatory-snapshot.js` | Tracks which MPs signed two specific UK AI-safety campaigns (ControlAI, PauseAI) | Specific to those campaigns existing in the UK; either find/build equivalent campaign trackers for your country or remove this feature entirely (it's additive, not load-bearing) |
| `.claude/skills/research-mps/`, `docs/research-allowlist.md` | The Claude Code skill (and its web-access allowlist) that researches each MP's public record | Rewrite the source list for your country's parliament/press/civil-society sites — this is a text edit to the skill's prompt and the allowlist, not a code change |
| Everywhere in the UI/API (`current-mps.js`, `local-mp.js`, "MP" in copy) | Terminology | Cosmetic — safe to leave the internal code/table names (`mp_ratings`, `/api/current-mps`) as-is; only the public-facing copy needs to say "MP" → your legislature's term if you want it to read naturally |

## 3. Decide: hex map or simple list

The hex map (`hex-layout.json` + the map rendering in `scorecard.html`/
`overview.html`) is the single hardest thing to redo — it's hand-tuned
geometry, not generated. Two honest options:

- **Redraw it.** Only worth it if you want the visual national map as a
  centrepiece and have (or can generate) each seat's approximate
  centroid/shape.
- **Ship without it first.** The site works as a searchable list/table of
  seats without the map; add the map later once the rest is proven out. This
  is almost always the faster path to a working "clone and go" site.

Confirm with the human which they want before touching the map code.

## 4. Rebrand

Find every occurrence of the original org's identity:

```bash
grep -rli "ASVA\|AI Safety Voter Alliance\|aisafetyvoteralliance\.co\.uk" \
  --include="*.html" --include="*.js" --include="*.json" --include="*.md" .
```

Go through the matches and replace, file by file (a blind sed across the
whole repo risks corrupting the SQL comments and doc files that explain
*why* something is built the way it is — read each hit):

- **Org name and acronym** in page titles, headers, copy, `og-banner.png`
  alt text, `site.webmanifest`, `llms.txt`, `package.json`'s `name` field.
- **Domain** (`aisafetyvoteralliance.co.uk`) in `sitemap.xml`, `robots.txt`,
  `llms.txt`, and any absolute URLs in the HTML `<meta>` tags.
- **Contact email** (`contact@aisafetyvoteralliance.co.uk`) — this also
  appears as a code *default* (e.g. in `functions/api/admin/login.js`) for
  when `ADMIN_EMAIL` isn't set. Better to just set the `ADMIN_EMAIL` env var
  in step 6 than to edit the fallback.
- **Logo and icon files** — these need genuinely new images, not text
  substitution: `ASVA_Logo.png`, `ASVA_Logo_Hero.png`,
  `ASVA_Logo_transparent.png`, `asva-shield.svg`, `favicon.ico`,
  `favicon-16.png`, `favicon-32.png`, `favicon.svg`, `apple-touch-icon.png`,
  `icon-192.png`, `icon-512.png`, `og-banner.png`. Ask the human for
  replacements, or generate placeholders and flag them as placeholders.
- **Social links** in `confirmed.html` and `share.html`.

## 5. Data sources

### The Google Sheet

`scripts/fetch-data.js` expects two published-to-web CSV tabs with a specific
column layout. Two ready-made templates are provided so you don't have to
reverse-engineer the shape from the parser:

- `docs/setup-pack/sheet-template-constituencies.csv` — one seat name per row.
- `docs/setup-pack/sheet-template-candidates.csv` — one row per
  candidate/representative, with the exact header names the build script
  looks for (column *order* mostly doesn't matter — it matches most columns
  by header text — but keep the header row exactly as given).

Have the human:
1. Create a new Google Sheet.
2. Import each CSV as its own tab (File → Import → Upload), named however
   they like — the tab *name* doesn't matter, only its published URL does.
3. Delete the example row and start entering real seats/candidates.
4. File → Share → Publish to web → publish each tab as CSV → copy each URL.
5. Set `GOOGLE_SHEET_CANDIDATES_URL` and `GOOGLE_SHEET_CONSTITUENCIES_URL` to
   those two URLs (used at build time — see `.dev.vars.example`).

### The election-results baseline (optional)

If you kept `scripts/fetch-data.js`'s call to an official results API (step
2), update `ELECTION_BASELINE_URL` to your country's equivalent. If there
isn't a clean equivalent, delete that call and rely entirely on the sheet's
`CurrentMP`/`Majority`/`ByElectionDate` columns — it's more manual but has no
external dependency.

## 6. Supabase

Create a new Supabase project, then run these files **in the Supabase SQL
editor, in this exact order** — several of them `ALTER TABLE` a table a later
file creates, and this order isn't documented anywhere else, so don't
improvise it:

1. `supabase/members.sql` — creates the base `members` table + its
   row-level-security posture (**read the comments in this file carefully**
   — it holds PII and is deliberately locked down to zero public policies).
2. `supabase/email_canonical.sql`
3. `supabase/email_confirmation.sql`
4. `supabase/nullable_address.sql`
5. `supabase/pending_update.sql`
6. `supabase/partner_export.sql` (skip if you won't use the partner-export
   feature — see `.dev.vars.example`'s `PARTNER_EXPORT_EMAILS` section)
7. `supabase/rate_limits.sql`
8. `supabase/mp_ratings.sql` — creates `mp_ratings`, `mp_recommendations`,
   `admin_sessions`.
9. `supabase/human_reviewed.sql` (must run after step 8)
10. `supabase/signatory_fixed_at.sql` (must run after step 8; skip if you
    dropped the signatory-tracking feature)
11. `supabase/member_sessions.sql` (must run after step 1 — foreign-keys to
    `members`)
12. `supabase/member_submissions.sql` (must run after step 11)

Then grab the project's `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
`SUPABASE_ANON_KEY` (Settings → API) for step 7.

## 7. Secrets

Copy `.dev.vars.example` to `.dev.vars` locally (gitignored — never commit
it) and fill it in; set the **same** variables in Cloudflare Pages
(Settings → Environment variables), marking anything sensitive as a
**Secret**, not a plain variable:

| Variable | Required? | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Yes | From step 6 |
| `SUPABASE_ANON_KEY` | Only if building locally with the ratings overlay | Public-safe (grades are public) |
| `AGENT_INGEST_SECRET` | Yes, if using the research skill (step 8) | Generate any long random string; set the **same** value here and as `ASVA_AGENT_SECRET` in the Claude Code environment that runs the research skill |
| `ADMIN_EMAIL` | Recommended | Your own contact address — see step 4 |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Yes, for email | See `docs/gmail-confirmation-setup.md` — the simplest working option |
| `PARTNER_EXPORT_EMAILS` | Only if using partner export | Leave unset to disable the feature entirely |
| `CF_DEPLOY_HOOK_URL` | Optional | Powers the "Redeploy site" button on the admin page |

`GOOGLE_SHEET_CANDIDATES_URL` / `GOOGLE_SHEET_CONSTITUENCIES_URL` are
**build-time only** (see step 5) — set locally for testing, but they don't
need to be Cloudflare secrets since the published-to-web URLs aren't
sensitive.

## 8. Deploy

1. In Cloudflare Pages, create a project connected to the new GitHub repo.
   Build command: `npm run build` (runs `scripts/fetch-data.js`). Output
   directory: `.` (already set in `wrangler.toml`).
2. Point the domain (step 0) at the Cloudflare Pages project.
3. Trigger a deploy and confirm `data.json` was generated (check the build
   log for `data.json written: N constituencies, ...`).

## 9. Smoke test before calling it done

- Home page loads with the new branding, not ASVA's.
- The scorecard/list page shows the seats from the Google Sheet.
- Submitting the pledge form creates a row in Supabase `members` and sends a
  confirmation email.
- `/goldenpath.html` → "Email me a login link" → the link arrives and logs in.
- `robots.txt` / `sitemap.xml` / `llms.txt` point at the new domain, not the
  old one.

## 10. Ongoing operation (once live)

Read `docs/mp-rating-agent.md` for the day-to-day workflow: running the
representative-research skill, reviewing and confirming drafted ratings on
`/goldenpath.html`, and (optionally) the member-submitted-edits and
partner-export features. All of it works the same way once steps 1–9 are
done — nothing further to set up.
