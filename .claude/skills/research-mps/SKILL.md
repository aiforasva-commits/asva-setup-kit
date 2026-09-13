---
name: research-mps
description: Research UK MPs' public record on AI safety and draft ASVA scorecard rating recommendations (grade + justification + sources) for review. Use when the user asks to research MPs, generate/refresh ASVA rating recommendations, score MPs, or work through the MP rating backlog. Runs a batch at a time and posts drafts to the review page — it never publishes ratings directly.
---

# Research MPs → draft ASVA rating recommendations

This skill drafts ASVA scorecard ratings for current UK MPs from **publicly
available information**, and files each as a *pending recommendation* for human
review at `/goldenpath.html`. It NEVER publishes a rating to the live site — only a
human clicking **Confirm** on the review page does that.

It works **one batch at a time** (default 30 MPs) so a full pass over the ~650
seats spreads across several runs — this keeps each run within a Claude Pro
allowance window. Re-running simply picks up the next unreviewed batch.

## Configuration

Two values are needed. Prefer environment variables; if unset, ask the user.

- **Site origin** — env `ASVA_SITE_ORIGIN` (e.g. `https://asva-scorecard.pages.dev`
  or the production domain `https://aisafetyvoteralliance.co.uk`). This is where
  the API endpoints live.
- **Agent secret** — env `ASVA_AGENT_SECRET`, matching the `AGENT_INGEST_SECRET`
  set in Cloudflare. Sent as `Authorization: Bearer <secret>`.

Set both as **environment variables** on the session so they persist across runs
— that way the secret never has to be pasted into chat. If either is unset, ask
the user once; never print the secret and never commit it.

**Network access.** Research needs web search plus the ability to *fetch* the
reference sites below. If the session's egress policy blocks a domain, WebFetch
returns `EGRESS_BLOCKED` and grading falls back to search-result snippets only
(shallower, and signatory lists like ControlAI can't be opened directly). For
full-depth research, allow outbound HTTPS to this standing allowlist:

- **Official record (websites)** — `members.parliament.uk`,
  `questions-statements.parliament.uk`, `hansard.parliament.uk`,
  `bills.parliament.uk`, `committees.parliament.uk`,
  `publications.parliament.uk`, `edm.parliament.uk`, `votes.parliament.uk`,
  `commonslibrary.parliament.uk`, `lordslibrary.parliament.uk`, `gov.uk`
- **Official record (JSON APIs — prefer these for finding exact words).** The
  Parliament websites often bot-block a plain fetch (Hansard returns 403), but the
  matching JSON APIs are reliable and searchable — use them to locate the exact
  contribution/question/vote, then cite the human-readable website permalink for
  the reviewer: `hansard-api.parliament.uk` (debates + spoken contributions),
  `members-api.parliament.uk` (member id → constituency/house),
  `commonsvotes-api.parliament.uk` (division results + how each MP voted),
  `questions-statements-api.parliament.uk` (written questions/statements),
  `bills-api.parliament.uk` (bill stages/sponsors). No API key is needed.
- **Voting/record trackers** — `theyworkforyou.com`, `parallelparliament.co.uk`,
  `publicwhip.org.uk`, `whocanivotefor.co.uk`
- **AI-safety orgs & campaigns** — `controlai.org` (campaign-statement
  signatories), `safe.ai`, `pauseai.info` (incl. the `dear-sir-demis-2025`
  open letter), `pauseai.uk` (the `/campaigns` signatory list),
  `longtermresilience.org`,
  `cser.ac.uk`, `turing.ac.uk`, `adalovelaceinstitute.org`,
  `instituteforgovernment.org.uk`, `aisafetyvoteralliance.co.uk`
- **National & political press** — `bbc.co.uk`, `theguardian.com`,
  `thetimes.com`, `telegraph.co.uk`, `ft.com`, `independent.co.uk`,
  `inews.co.uk`, `standard.co.uk`, `politicshome.com`, `politico.eu`,
  `conservativehome.com`, `labourlist.org`, `libdemvoice.org`,
  `newstatesman.com`, `spectator.co.uk`
- **Tech press & socials** — `techcrunch.com`, `theregister.com`, `wired.com`,
  `sifted.eu`, `x.com`, `twitter.com`, `facebook.com`, `linkedin.com`,
  `youtube.com`, `bsky.app`
- **Reference & case-by-case** — `en.wikipedia.org` (a *lead only* — follow its
  references to a primary source and cite that; never cite Wikipedia itself, see
  the grounding rules), plus each MP's own website and local news titles (unique
  domains — allow as they come up)

WebSearch works regardless of this list; only WebFetch depends on it.

**Flag blocked-but-useful domains.** When a fetch you actually wanted returns
`EGRESS_BLOCKED`, note the domain and why it looked useful — don't silently drop
it. Collect these across the run and list them in the run report under
"Suggested access for future sweeps" so the user can widen the allowlist before
the next batch. Never let a blocked fetch turn into a fabricated fact: if you
couldn't read it, don't cite it.

## Steps

### 1. Pull the next batch
```
GET {ASVA_SITE_ORIGIN}/api/research/queue?limit=30
Authorization: Bearer {ASVA_AGENT_SECRET}
```
The response:
```
{
  total_mps, phase,                // phase = "unscored" (initial sweep) | "refresh"
  unscored_remaining, refresh_remaining, pending_review,
  remaining,                       // remaining in the current phase
  returned,
  mps: [{ constituency, mp_name, party, majority }]   // ordered MOST-MARGINAL FIRST
}
```
The queue orders seats by marginality (smallest majority first) and only returns
seats that still need work: unscored ones first, and — once none remain — a
refresh pass over already-scored seats. Seats awaiting review are skipped.

**Show the plan first (do this every run).** Before doing any research, print a
short table of the batch in the exact order it will be worked:

| # | Constituency | MP | Majority | Party |

…followed by one line: `phase: <phase> · this run: <returned> · remaining in
phase: <remaining> · awaiting review: <pending_review>`. This is how the user
sees the order and count for the run. If `remaining` is 0 in both phases, say the
work is complete and stop.

The user may request a different batch size — pass it as `?limit=`. Keep it ≤ 50
on a Pro plan to stay within the allowance.

### 2. Research each MP
Use **both** tools, for different jobs: **web search** to *discover* what an MP
said or did (news, interviews, a debate they spoke in), and the **Parliament JSON
APIs** to *pin it to the exact record* (the specific Hansard contribution, written
question, or division). Web search finds the quote; the API turns it into a
citation that lands the reader on the words.

**Cite the exact words — never make the reviewer or the public dig.** A source
must open directly onto the evidence it backs, not a page someone then has to
search. So:
- For something said in the House, find it via `hansard-api.parliament.uk`
  (`/search/contributions/Spoken.json?queryParameters.searchTerm=…&queryParameters.house=Commons`
  → each result has `MemberName`, `ContributionText`, `SittingDate`,
  `DebateSection`, `DebateSectionExtId`, `ContributionExtId`). Cite the
  human-readable **deep link to that contribution**, not the debate landing page:
  `https://hansard.parliament.uk/Commons/<YYYY-MM-DD>/debates/<DebateSectionExtId>/<TitleSlug>#contribution-<ContributionExtId>`.
- For a written question, cite its `questions-statements.parliament.uk` page (found
  via `questions-statements-api.parliament.uk`), not a search.
- For a vote, cite the specific division and how the MP voted, found via
  `commonsvotes-api.parliament.uk` (`/data/divisions.json?queryParameters.searchTerm=…`,
  then `/data/division/<id>.json` for the Aye/No lists).
- For a news quote, link the article at the exact page — not the outlet's front page.
Resolve the MP once with `members-api.parliament.uk` (name/constituency → member
id) so you are searching the right person.

For each MP, look for, in rough priority order:

- **Signatory checks — always run these, every MP.** Check each public
  signatory list for the MP's name and record the result either way (signed
  *or* confirmed-not-listed):
  - The **ControlAI campaign statement** — `controlai.org`.
  - The **PauseAI politician open letters.** There are two rosters to check, on
    two different sites — check **both**:
    - **`pauseai.uk` — the current UK campaign.** The `https://pauseai.uk/campaigns`
      page carries a `Parliamentary signatories` section for the live campaign
      (currently the June 2026 open letter to the **Prime Minister** on frontier
      AI risk). The page shows a "under a media embargo" banner, but **the names
      are still served** — the section loads them client-side from a JSON API, so
      do not conclude the roster is empty from the banner or from the raw HTML
      (which only shows "Loading signatories…"). Fetch the roster directly as
      JSON: `https://pauseai.uk/api/signatories` returns a flat array of
      `{name, party, constituency}` objects (constituency is empty for Peers).
      This is the authoritative, name-checkable list for the current pauseai.uk
      campaign — check every MP against it. Note it covers MPs **and Peers**; the
      Peers are out of this skill's MP-only scope.
    - **`pauseai.info` — the earlier letter.** The June 2026 letter to Google
      DeepMind is a flat, name-checkable roster at
      `https://pauseai.info/dear-sir-demis-2025` (MPs, MSPs, Senedd MS, MLAs and
      Peers, each with title). Check that page by name directly.

    Re-check `https://pauseai.uk/campaigns` each pass in case a newer campaign has
    replaced the current one — if the letter it describes has changed, the
    `/api/signatories` roster will have changed with it, and the letter's name in
    your source titles should follow.

  Being a signatory is a positive signal; *not* appearing is itself a finding
  worth recording (see the ControlAI-proof rule below). Confirm presence/absence
  against the actual lists (the `/api/signatories` JSON and the `pauseai.info`
  roster), not just a search snippet. Both fetch cleanly in most sessions; if
  `pauseai.uk` is egress-blocked, fall back to web search for the current letter
  and still check the `pauseai.info` roster directly.

  **State BOTH campaigns on every card — signed or not. Never leave one silent.**
  Each draft must carry an explicit ControlAI finding *and* an explicit PauseAI
  finding: a bullet for each, plus that campaign's list URL as a source. A card
  that names only one campaign is ambiguous — a reader cannot tell whether the
  other was *not signed* or simply *not checked*, and the missing line wrongly
  implies a status either way. So every card gets two signatory bullets (e.g.
  `Signed the ControlAI campaign statement` **and** `Not a PauseAI campaign
  signatory`), whatever the mix of signed/not. Treat PauseAI as one campaign: an
  MP counts as a PauseAI signatory if they are on **either** letter; name the
  specific letter they signed (`Signed PauseAI letter to the Prime Minister` /
  `… to Google DeepMind`), or `Not a PauseAI campaign signatory` if on neither.
  (The ingest endpoint enforces this automatically via `lib/signatory-status.js`
  and will add a missing campaign bullet + source, but draft it correctly yourself
  so the reviewer sees the real finding, not a backfilled default.)
- **Signing is a floor, not the whole finding — dig for the rest of the record.**
  A signature is worth at least a B, but many signatories have done far more, and
  filing a bare "signed → B" for an MP who is actually an active champion is the
  exact failure this skill must avoid. **For every signatory, before you grade,
  run the governance-work searches below** — has the MP secured or led a
  Westminster Hall / Commons debate on AI safety, tabled an EDM or written
  questions on AI risk, sponsored a relevant bill, sat on a relevant
  committee/APPG, or spoken publicly and repeatedly on catastrophic AI risk?
  Search the MP's name together with terms like "AI safety debate", "artificial
  intelligence" on Hansard/TheyWorkForYou/Parallel Parliament, and "written
  question artificial intelligence". A signatory with clear active governance
  work is an **A**, not a B (see the rubric). Securing and leading a parliamentary
  debate on AI safety is, on its own, strong evidence for an A.
- Public statements recognising **or dismissing** AI / extinction-level risk.
- Engagement with AI governance: APPGs, committees, inquiries, letters, EDMs.
- Support for — **or opposition to** — licensing, oversight, independent testing
  of frontier AI, and binding regulation.
- Any relevant votes, bill sponsorship, or ministerial positions on AI.

**Look as hard for opposition as for support — the method skews positive.**
The signatory lists surface *supporters*; an anti-regulation MP appears on no
list, so if you only mine the positive sources you will systematically miss the
D/E/F end and mis-file those MPs as `?`. So for every MP, actively run the
*negative* searches too, not just the positive ones. Search the MP's name with
"AI regulation" alongside terms like `oppose`, `against`, `red tape`, `stifle
innovation`, `over-regulation`, `pro-innovation`, `deregulate`, `growth`, `Big
Tech`; look for votes or speeches **against** stronger oversight, opposition to
an AI Bill or to binding rules, "innovation/growth before safety" framing,
dismissing AI risk as hype or "doomerism", ministerial or front-bench records
pushing acceleration, and relevant industry/lobbying interests in the Register of
Members' Financial Interests.

**Dig deeper the moment you see an anti-regulation signal.** A single dismissive
line or one anti-oversight vote is a lead, not the conclusion — chase it the same
way you chase a signatory's active work. Pull the Hansard / TheyWorkForYou /
Parallel Parliament record, read the surrounding quote so you are not misreading
a nuance, and look for a *pattern* (repeated statements, a consistent voting
record, a ministerial position). Genuine, evidenced opposition to effective
AI-safety governance is a **D/E/F** (see the rubric) — do not soften it to a C or
`?` because the finding is negative; a documented anti-regulation stance is
exactly what the scorecard exists to record. (Absence of any record is still a
`?`, never a low grade — a low grade needs evidence, just as a high one does.)

**Grounding rules — do not skip:**
- Only use facts you can tie to a **real source URL returned by search**. Never
  invent a quote, a position, or a URL. If search returns nothing substantive,
  that is itself the finding (see `?` below).
- Prefer primary/reputable sources: Hansard, parliament.uk, TheyWorkForYou,
  the MP's own site/social, ControlAI, established news outlets.
- **Never cite Wikipedia as a source.** Wikipedia is not credible evidence for a
  rating — do not put a `wikipedia.org` URL in `sources`. It is fine as a *lead*:
  follow its "References" to the primary source (Hansard, the MP's site, a named
  outlet) and cite **that** instead. If the only thing you can find for a fact is
  a Wikipedia article, treat the fact as unsourced — drop it, or let the finding
  fall to `?` — rather than citing Wikipedia.
- **Lean towards over-including sources, not under-including.** The reviewer can
  delete a surplus source in one click, but a missing one means they have to go
  and find it themselves — so err on the generous side. **Every claim in the
  rationale or a bullet must have a URL backing it in `sources`.** If the
  rationale mentions a committee role, a signature, a speech, a vote and a
  written question, that is potentially five sources — include a link for each
  distinct fact you relied on, not just your single favourite. Capture roughly
  **2–6** source URLs (more when the record is rich); a lone source is only
  acceptable for a genuinely single-fact finding such as a pure signatory B.
- Before finalising each MP, do a quick self-check: read your rationale and
  bullets and confirm **no asserted fact is left without a matching source**. A
  nice summary with a thin source list is the failure mode to avoid — if you
  found it, cite it.

**ControlAI-proof rule — cite the signatory list even for non-signers.** The
ControlAI signatory page is the evidence *both* ways: it shows who has signed
and, by their absence, who has not. So whenever you conclude an MP is **not** a
ControlAI signatory, still include the ControlAI signatory-list URL as a source
— it is the proof of the absence. Do the same for the PauseAI lists when
absence is what you're asserting. Never state "not a signatory" without linking
the list that shows it.

### 3. Choose a grade (ASVA rubric — from the Founding Statement)
Grades A–F, plus DNR and `?`:

- **A / B / C** — increasing alignment with ASVA's safety principles.
  - **A** = strong, active champion who has *done* things, not just signed:
    signed a campaign statement (ControlAI / PauseAI) **and** shown active
    governance work — secured or led a debate on AI safety, tabled an EDM or
    written questions on AI risk, sponsored a relevant bill, sat on a relevant
    committee/APPG, or repeatedly spoken publicly on catastrophic AI risk.
    Securing and leading a parliamentary debate on AI safety is itself strong
    evidence for an A.
  - **B** = clear positive alignment but lighter on active work — e.g. a
    signatory with little else found on the record, or supportive statements
    without sustained governance activity.
  - **C** = some positive engagement but limited.
- **D / E / F** — inadequate engagement with, or active opposition to, effective
  AI-safety governance — the mirror of A–C, and just as evidence-based.
  - **D** = leans against effective safety governance — e.g. consistently
    prioritises "innovation/growth" over safeguards, or is dismissive of AI
    safety concerns, without a hard record of opposition.
  - **E** = actively works against safety governance — e.g. voted or campaigned
    against binding regulation, an AI Bill, or independent oversight.
  - **F** = clear, vocal opposition to, or dismissal of, AI risk and its
    regulation — e.g. calls AI risk hype / "doomerism", champions deregulation
    or an "AI arms race", or leads against safeguards.
  A D–F needs the same standard of evidence as an A–C: cite the vote, the quote,
  the record. Never infer opposition from silence — that is a `?`.
- **`?`** ("Not Scored") — **the default when there is simply not enough public
  information to grade them.** Use this whenever search turns up nothing
  substantive on their AI-safety stance. This keeps the seat effectively
  *unscored* rather than judging them; it does not imply anything negative.
- **DNR** ("Did Not Respond") — **reserved for after ASVA has actually contacted
  the MP and they have not replied.** Do **not** assign DNR from research alone
  — a thin public record is a `?`, not a DNR. Only use DNR when the task
  explicitly tells you an MP was contacted and did not respond.

When uncertain between two grades, pick the more conservative (lower-confidence)
one and say so in the rationale — the human reviewer makes the final call. A
lack of evidence is a `?`, never a low letter grade. **But do not let "be
conservative" flatten a well-evidenced strong record:** if a signatory has clear
active governance work, grade the **A** — under-grading a genuine champion to B
is as much an error as over-grading. **The same holds at the bottom of the
scale:** don't soften a well-evidenced anti-regulation record up to a `?` or C —
a documented D/E/F is as important to record as an A. And when **refreshing an already-scored
seat, never propose a grade below its current live grade unless you have specific
new evidence that justifies the drop** — a thinner search this run is not a reason
to downgrade, so if you can't beat the existing grade with evidence, leave it at
least where it is.

### 4. Build the batch payload
For each MP produce:
```json
{
  "constituency": "<exactly as returned by the queue>",
  "mp_name": "<as returned by the queue>",
  "party": "<as returned, or corrected if clearly wrong>",
  "recommended_grade": "A|B|C|?|DNR|D|E|F",
  "rationale": "<one sentence: why this grade>",
  "bullets": ["<one short phrase — see Bullet style>", "... up to 4"],
  "sources": [{ "title": "<source-type wording — see Source style>", "url": "https://..." }]
  // include one source per distinct fact you relied on — err on the side of MORE
  // sources (2–6 typical); the reviewer prunes surplus far more easily than they
  // chase a missing link. Never leave a rationale/bullet claim unsourced.
}
```
Keep `constituency` byte-identical to the queue value — it is the key the review
and build steps match on.

**Bullet style — keep them scorecard-length.** Each bullet is a single short
phrase of roughly 3–8 words, one idea, no trailing full stop, written to read as
a chip on the scorecard — not a sentence. Two of the (max five) bullets are the
mandatory ControlAI and PauseAI signatory findings; use the remaining room (up to
~3) for the substantive record, and don't pad. Never put sub-clauses, sources, or
reviewer asides in a bullet; uncertainty and "a reviewer could go X" notes belong
in `rationale`, never in `bullets`.

Good (style to match):
`Backed safer AI standards` · `Spoke publicly on AI risk` · `Open to further AI
safeguards` · `Opposed stronger AI oversight in debate` · `Downplayed AI risks
in interviews` · `Co-sponsored AI safety motion` · `Supported delay to AI
regulation` · `Argued AI risk is overstated` · `Backed cross-party AI committee`
· `Supports independent testing` · `No public statements on AI safety found` ·
`Not a ControlAI campaign signatory` · `Insufficient public record to grade` ·
`Voted against stronger oversight` · `Called for stronger oversight`

For a `?` ("Not Scored") draft, keep bullets factual about the *absence* of a
record (e.g. `No public statements on AI safety found`, `Not a ControlAI campaign
signatory`, `Not a PauseAI campaign signatory`). Only use a "did not respond"
style bullet once the task tells you
ASVA has actually contacted the MP — that is the DNR case, not research alone.

**Always give a `?` card a record link, never just the signatory lists.** A `?`
means "nothing substantive found" — so the reader needs a way to verify that for
themselves. Every `?` draft must include, as a source, the MP's own parliamentary
record: resolve them with `members-api.parliament.uk` and cite
`https://members.parliament.uk/member/<id>` (title `Parliamentary profile on
parliament.uk`), or their `theyworkforyou.com` record if that better shows the
(lack of) AI footprint. A card whose only sources are the two campaign
signatory-list URLs is not finished — add the record link.

Too long (do NOT do this): `Founding Chairman of the APPG on the Fourth
Industrial Revolution and long-standing tech-acceleration champion; proposed a
'National Institute for AI and Robotics'.` — split into `Founded 4IR APPG` /
`Champions AI acceleration` instead, or drop detail that isn't about AI safety.

**Source style — name the source *type*, not the headline.** The house style
(see the confirmed ratings for Iqbal Mohamed and Alex Sobel) is a short `title`
that tells the reader *what kind of source it is and who it's by* — never a
pasted article headline and never a bare domain. Keep it to a few words, no
trailing full stop. The pattern is `<source-type> [by MP | in <Outlet>]`:

- MP's own writing → `Article by MP`
- MP's website / press release → `Article on MP's website`
- A named news/press outlet → `Article in <Outlet>` (e.g. `Article in the Guardian`,
  `Article in Portsmouth News`)
- A social post → `Post on X by MP` (or `… by <author>` if not the MP)
- Hansard → `Hansard (record of MP's words in Parliament)` — link the **exact
  contribution** (the `#contribution-<ExtId>` deep link), so the reader lands on
  the words, not the top of a long debate
- A parliamentary bill / amendment → `Bill sponsored by MP` / `Amendment tabled by MP`
- Voting/record trackers → `Record on TheyWorkForYou` · `Record on Parallel Parliament`
- The ControlAI campaign → `Listed in ControlAI Campaign Statement` when signed,
  or `ControlAI Campaign Statement signatory list` when citing it as proof the
  MP is *not* listed
- A PauseAI politician open letter — name whichever letter you actually checked
  and cite its page. For the current pauseai.uk campaign (the letter to the
  Prime Minister) the reader-facing page is `https://pauseai.uk/campaigns` →
  `Signed PauseAI letter to the Prime Minister` when signed, or `PauseAI letter
  to the Prime Minister signatory list` when citing it as proof the MP is *not*
  listed. For the earlier DeepMind letter use `https://pauseai.info/dear-sir-demis-2025`
  → `Signed PauseAI letter to Google DeepMind` / `PauseAI letter to Google
  DeepMind signatory list`. (Cite the `/campaigns` page, not the raw
  `/api/signatories` endpoint, so a human reviewer can open it.)
- A committee / inquiry / APPG → `<Committee> evidence` / `APPG membership`

Match the wording to the actual URL (an `x.com` link is a `Post on X`, a
`labourlist.org` piece the MP wrote is an `Article by MP`). Do **not** reuse the
outlet's headline as the title, e.g. don't write
`ConservativeHome: Only the Conservatives can turn Britain into a science and
technology superpower` — write `Article in ConservativeHome`.

**How many sources — err generous.** List a distinct source for *each* fact the
rationale/bullets lean on, not just the strongest one: if you cite a committee
role, a signature and a quote, that is three separate entries. When a single URL
covers several facts, one entry is fine — but a rich record should carry
several links. Over-including is the preferred error: the reviewer removes a
surplus source in one click, whereas a missing one costs them a hunt. Even the
thinnest card carries more than one source: a pure signatory B still cites the
list it's on, and a `?` carries the two campaign signatory-list URLs **plus** the
MP's parliamentary-record link (see the `?` rule above) — never the signatory
lists alone.

### 5. Post the batch for review
```
POST {ASVA_SITE_ORIGIN}/api/recommendations/ingest
Authorization: Bearer {ASVA_AGENT_SECRET}
Content-Type: application/json

{ "recommendations": [ ...the batch... ] }
```
Include `"model"` on each item if you can (which model drafted it). The response
returns `{ ingested, skipped }`. Report any `skipped` entries (usually an invalid
grade or missing field) so they can be re-run.

### 6. Report and offer the next batch
Tell the user: how many were drafted, how many remain in the backlog, and that
the drafts are waiting at `/goldenpath.html` for Confirm/Reject. Offer to run the next
batch if allowance remains, or suggest scheduling the next run after their
allowance resets.

If any wanted fetches were blocked this run, add a **"Suggested access for
future sweeps"** line listing those domains (deduplicated), so the user can add
them to the environment's egress allowlist before the next batch.

## Example (one MP, curl)

```bash
curl -s "$ASVA_SITE_ORIGIN/api/research/queue?limit=30" \
  -H "Authorization: Bearer $ASVA_AGENT_SECRET"

# ...research each MP with web search, assemble batch.json...

curl -s -X POST "$ASVA_SITE_ORIGIN/api/recommendations/ingest" \
  -H "Authorization: Bearer $ASVA_AGENT_SECRET" \
  -H "Content-Type: application/json" \
  --data @batch.json
```

## Scheduling (optional)
To run automatically "just after the allowance resets", the user can schedule a
recurring Claude Code session (e.g. the `/loop` skill or a Routine) that invokes
this skill weekly. Each firing does one batch on the subscription allowance — no
Anthropic API key and no metered API billing are involved.

## Guardrails
- This skill only ever writes **drafts**. Nothing reaches the public scorecard
  until a human confirms it on the review page.
- If you cannot reach the endpoints (401 → wrong/blank secret; 5xx → server), stop
  and report; do not fabricate a "done" result.
- Do not delete or modify existing confirmed ratings.
