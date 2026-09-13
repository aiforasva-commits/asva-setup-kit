# MP ASVA-rating agent

An assisted workflow for rating MPs on the AI Safety Scorecard. It:

1. **Researches** current MPs from publicly available information (a Claude Code
   skill, run on your Claude subscription — no metered API bill).
2. **Drafts** a recommended grade + justification bullets + source links for each,
   stored as *pending* recommendations.
3. Lets you **Confirm or Reject** each one with a click on a private review page.
4. **Publishes** confirmed ratings to the live scorecard on the next build.

Nothing the agent produces is shown publicly until you confirm it. You can also
edit any rating by hand at any time (in the review page, or directly in Supabase).

---

## How the pieces fit together

```
Claude Code (research-mps skill)          you, in a browser
        │  web search per MP                     │
        ▼                                        ▼
 POST /api/recommendations/ingest        /goldenpath.html  (magic-link login)
        │  (Bearer AGENT_INGEST_SECRET)          │  GET /api/recommendations
        ▼                                        │  POST /api/recommendations/confirm|reject
 Supabase: mp_recommendations  ───review───►  Supabase: mp_ratings (live)
                                                 │
                                                 ▼
                                   GET /api/current-ratings  (runtime)
                                                 │
                                                 ▼
                        scorecard.html + overview.html overlay the
                              confirmed grade instantly (no rebuild)
```

(`scripts/fetch-data.js` can also bake ratings into `data.json` at build time if
run with the Supabase vars set — optional; the runtime overlay is the live path
because Cloudflare doesn't expose secrets to the build.)

Source of truth for **confirmed ratings** is Supabase (`mp_ratings`). The Google
Sheet remains the source for constituency/hex data and for any candidates who are
not the current MP.

---

## Data model (see `supabase/mp_ratings.sql`)

- **`mp_ratings`** — live confirmed ratings, one row per constituency. Public
  SELECT only; all writes go through the Cloudflare Functions. The build reads
  this. Edit by hand here to override the agent anytime.
- **`mp_recommendations`** — draft ratings awaiting review (`pending` /
  `confirmed` / `rejected`). Never shown publicly.
- **`admin_sessions`** — one-time magic-link tokens and activated review sessions.
- **`member_submissions`** (see `supabase/member_submissions.sql`) — edits a
  confirmed ASVA member suggested from a card on `/scorecard.html`. A separate
  table from `mp_recommendations` — see "Member submissions" below for why.
- **`member_login_sessions`** (see `supabase/member_sessions.sql`) — the
  member-facing counterpart to `admin_sessions`, entirely separate from it (own
  cookie, own table, shorter session, no "remember me").

---

## One-time setup

1. **Run the migration.** Paste `supabase/mp_ratings.sql` into the Supabase SQL
   editor and run it. If you want members to be able to suggest edits from the
   scorecard (see "Member submissions" below), also run
   `supabase/member_sessions.sql` and `supabase/member_submissions.sql`.

2. **Seed existing ratings** — *optional, and usually unnecessary.* The research
   queue already skips any seat that carries a real grade (A–F or DNR) in the
   live `data.json`, so **MPs you've already scored in the sheet are not
   re-researched** without any seeding. You only need this step if you want your
   existing grades stored as `mp_ratings` rows (e.g. to manage them via the
   review page / Supabase instead of the sheet). If so, run it **locally** (it
   fetches your Google Sheet, which cloud build environments may be blocked from
   reaching):
   ```bash
   npm install
   npm run build                 # produces data.json from the sheet
   npm run import-ratings        # seeds real grades (A–F, DNR) into mp_ratings
   ```
   Credentials come from your local `.dev.vars` (`SUPABASE_URL` +
   `SUPABASE_SERVICE_ROLE_KEY`) automatically; or pass them inline. Preview first
   with `npm run import-ratings -- --dry-run`. Re-running is safe (idempotent).

3. **Set environment variables.**

   In **Cloudflare Pages** (Settings → Variables and secrets):
   - `AGENT_INGEST_SECRET` — a long random string, added as a **Secret**.
   - `ADMIN_EMAIL` — optional; defaults to `contact@aisafetyvoteralliance.co.uk`.
     (On projects where the dashboard is secrets-only, adding it as a Secret is
     fine; or just skip it and rely on the default.)
   - You already have `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a Gmail
     sender configured for the pledge flow — the magic-link login and the
     runtime ratings overlay reuse them. **No build variable is needed:**
     confirmed ratings reach the live site at runtime via `/api/current-ratings`
     (see below), so they appear immediately without a rebuild.

   In the **Claude Code environment** that runs the research skill:
   - `ASVA_AGENT_SECRET` — the **same** value as `AGENT_INGEST_SECRET`.
   - `ASVA_SITE_ORIGIN` — e.g. `https://asva-scorecard.pages.dev` or your domain.

---

## Everyday use

### Generate recommendations (the "agent")
In a Claude Code session, run the research skill:

> run the research-mps skill

It pulls the next batch of MPs, researches each with web search, and files drafts
for review. It works **~30 MPs per run** so the first full pass over all ~650
seats takes several runs — do a batch after each allowance reset, or schedule a
weekly session (e.g. with `/loop`).

**Order & phases.** Seats are worked **most-marginal first** (smallest majority),
since a rating matters most where the seat is competitive. The queue runs in two
phases: `unscored` (seats with no grade yet) until every one is done, then
`refresh` (re-checking already-scored seats, again most-marginal first). Seats
awaiting your review are skipped until you Confirm/Reject them.

**Seeing the plan.** At the start of every run the skill prints the batch it will
research — the constituencies in order, each MP, and the seat's majority — plus
how many remain in the phase. So you can always see the order and number before
it starts; there's nothing separate to open.

### Review and publish
Go to **`/goldenpath.html`**, click **Email me a login link**, open the link from the
ASVA inbox, then for each recommendation:
- adjust the grade / bullets / sources if needed,
- **Confirm & publish** (writes to `mp_ratings`), or **Reject** (re-queues it).

Confirmed ratings appear on the scorecard at the **next site build/deploy**.

### Edit a rating by hand
Either change the grade/bullets/sources on the review page before confirming, or
edit the `mp_ratings` row directly in Supabase's table editor. The agent never
overwrites a live rating — it only proposes drafts.

---

## API reference

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/admin/login` | none (rate-limited) | Email a magic login link to `ADMIN_EMAIL` |
| `GET  /api/admin/verify?token=` | magic token | Activate a review session, set cookie |
| `POST /api/admin/logout` | session cookie | End the session |
| `POST /api/admin/refresh` | session cookie | Slide the session expiry + re-issue the cookie (8 h, or 30 d when `remember`); powers the review page's "Keep me signed in" |
| `GET  /api/recommendations?status=` | session cookie | List recommendations (default `pending`) |
| `POST /api/recommendations/confirm` | session cookie | Publish a rating (with optional edits) |
| `POST /api/recommendations/reject` | session cookie | Discard a draft |
| `POST /api/recommendations/ingest` | `AGENT_INGEST_SECRET` | Skill files a batch of drafts |
| `POST /api/recommendations/backfill-sources[?dryRun=1]` | `AGENT_INGEST_SECRET` | Bring PENDING drafts up to both-campaign signatory coverage |
| `POST /api/ratings/signatory-fix[?dryRun=1&limit=N]` | `AGENT_INGEST_SECRET` | Bring LIVE confirmed ratings up to both-campaign coverage (no re-review) |
| `POST /api/ratings/update` | session cookie | Amend a live rating by hand (marks it human-reviewed) |
| `GET  /api/ratings/list` | session cookie | Every live rating with full context, for the review tabs |
| `GET  /api/research/queue?limit=` | `AGENT_INGEST_SECRET` | Next batch of MPs needing research |
| `GET  /api/current-ratings` | none (public) | Confirmed ratings for the scorecard/map overlay |
| `POST /api/member/login` | none (rate-limited, by IP and by target email) | Email a magic login link to a confirmed member's own address, if the typed email matches one |
| `GET  /api/member/verify?token=` | magic token | Activate a member session, set cookie, redirect back to the scorecard card the member started from |
| `POST /api/member/logout` | member session cookie | End the member session |
| `GET  /api/member/session?constituency=` | member session cookie | Current member + any pending submission they have for that seat (for prefill) |
| `POST /api/member-submissions/create` | member session cookie | Stage a member's suggested edit (upserts their pending submission for that seat) |
| `GET  /api/member-submissions?status=` | session cookie (admin) | List member submissions (default `pending`) |
| `POST /api/member-submissions/confirm` | session cookie (admin) | Publish a member's suggestion (with optional edits) to `mp_ratings` |
| `POST /api/member-submissions/reject` | session cookie (admin) | Discard a member's suggestion, with an optional reason emailed to them |

### Live ratings: Claude vs human-reviewed

A live rating (`mp_ratings`) is either a **Live Claude rating** — published to the
map but not yet checked by a person (`human_reviewed_at IS NULL`) — or **Live
Human Reviewed** once someone Saves it on `/goldenpath.html` or Confirms it from
Pending review (`human_reviewed_at` set). Both are equally live on the public map;
the flag only splits the two review tabs. When a draft goes live it also carries
its `rationale`/`party`/`model` across so that context shows on the Claude card.
Adding these columns and publishing the current pending drafts as Claude ratings
is a one-off migration: `supabase/human_reviewed.sql`.

---

## Member submissions

Confirmed ASVA members can suggest an edit to their own MP's rating directly
from a card on `/scorecard.html` — a "Submit a member edit" button next to the
existing "email us" link (which stays, for anyone who isn't a member or would
rather not log in). The flow:

1. The member types their email and gets a one-time login link, exactly like
   the admin flow but sent to **their own address on file**, never an
   arbitrary typed destination — the endpoint only sends when the email
   matches an existing confirmed row in `members` (see `lib/member-auth.js`
   and `functions/api/member/login.js` for the anti-abuse details: rate-limited
   by IP *and* by target email, and the response never reveals whether an
   email matched, so it can't be used to check who's a member or to spam a
   stranger's inbox).
2. Clicking the link opens a short style guide (`member-edit-guide.html`) and
   an edit form — the same grade/bullets/sources editor as the admin review
   page (`editable-list.js`, shared by both) — pre-filled with their own
   pending submission for that seat if they already have one, else the current
   live values.
3. Submitting stages it as a `pending` row in `member_submissions` — nothing
   is ever written to the live `mp_ratings` table directly. A member
   resubmitting for a seat they already have a pending edit on **replaces it
   in place** rather than piling up duplicates.
4. It shows up in the **Member Submissions** tab on `/goldenpath.html`,
   alongside a current-vs-proposed diff (`base_grade`/`base_bullets`/
   `base_sources` — a snapshot taken at submission time — against the
   member's proposed values), plus their name/email and any note they left.
   Confirm/Reject work exactly like a recommendation, writing into
   `mp_ratings` and marking `human_reviewed_at` on confirm.
5. The member gets an outcome email either way: on confirm, whether it was
   published exactly as submitted or with amendments (`amended`, set by
   diffing what was actually saved against what they proposed); on reject, an
   optional short reason the admin can add.

This is deliberately a **separate table and queue** from `mp_recommendations`:
that table allows only one *pending* draft per seat (so the research skill
refreshes rather than duplicates its own drafts), which would collide with
several members reasonably proposing edits for the same seat at once, or with
whatever the agent already has pending there. Nothing a member submits is
ever shown publicly, or to other members — only to an admin, on
`/goldenpath.html`.

---

## Signatory coverage (both campaigns on every card)

Every card must state, explicitly, whether the MP signed **both** the ControlAI
campaign statement **and** a PauseAI open letter — signed or not — each with a
bullet and the list URL as its source. A card that names only one campaign is
ambiguous: silence on the other reads as "not signed" (or "signed") when it may
just be "not checked".

- **Authority.** `lib/signatory-snapshot.js` holds the current-MP signatory lists
  per campaign, keyed by constituency. It is generated by
  `node scripts/build-signatory-snapshot.js` (ControlAI member IDs resolved via the
  Parliament Members API; PauseAI-PM from `pauseai.uk/api/signatories`; the PauseAI
  DeepMind letter from `scripts/data/pauseai-deepmind-signatories.txt`). Re-run it
  to refresh after campaigns change; it prints any signer that doesn't resolve to a
  current seat.
- **Merge rules.** `lib/signatory-status.js` (`enforceCoverage`) adds a missing
  campaign bullet + source, corrects a card's own clear claim that contradicts the
  roster, never rewrites an entangled bullet (reported as `flagged`), and reports
  anything that won't fit the ≤5-bullet / ≤6-source caps (`capped`) rather than
  dropping it. It is idempotent — a correct card is left untouched.
- **Where it runs.** New drafts get coverage at **ingest**; existing pending drafts
  via **backfill-sources**; live confirmed ratings via **ratings/signatory-fix**
  (which stamps `signatory_fixed_at` — see `supabase/signatory_fixed_at.sql`). The
  "Live ratings" tab on `/goldenpath.html` has a **Signatory-fixed only** filter and
  a per-card badge so you can review exactly the cards that pass changed.

---

## Cost note

Because research runs **inside Claude Code**, it draws on your Claude subscription
allowance — there is **no Anthropic API key and no separate metered billing**.
The trade-off is the Pro allowance size, which is why research is batched. If you
ever want a full sweep in one go, that is where a larger plan or a one-off metered
API run would come in, but neither is required for normal use.
