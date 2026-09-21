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
  - **Alex Sobel's Artificial Superintelligence Bill** — official record at
    `bills-api.parliament.uk/api/v1/Bills/4288` (the `bills.parliament.uk` page
    itself bot-blocks a plain fetch; use the API, or search "Artificial
    Superintelligence Bill" `bills.parliament.uk`). Alex Sobel (Leeds Central
    and Headingley) is the sole *official* sponsor on the parliamentary record,
    but a cross-party group of MPs has separately and publicly backed the bill
    via a letter to the PM, reported by name in press coverage (e.g. BritBrief,
    MLex, Pinsent Masons, Startup Fortune — search "<MP name>" Sobel
    superintelligence bill, or "Artificial Superintelligence Bill" MPs backing
    list). **Treat a confirmed named backer exactly like a ControlAI
    signatory** for grading (see the rubric) — it's at least as x-risk-specific
    as a campaign statement. Unlike ControlAI/PauseAI there is no single
    canonical list to prove *absence* from, so this is a positive-only check:
    cite the specific press article naming the MP when found, but don't add a
    "did not back it" bullet or source when not found (there's nothing
    authoritative to point to) — the combined ControlAI/PauseAI bullet already
    covers the absence case.
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
  finding, plus each campaign's list URL as a source. A card that names only one
  campaign is ambiguous — a reader cannot tell whether the other was *not signed*
  or simply *not checked*, and the missing line wrongly implies a status either
  way. Treat PauseAI as one campaign for this presence check: an MP counts as a
  PauseAI signatory if they are on **either** letter (which one determines the
  B-grade floor — see the rubric); name the specific letter they signed
  (`Signed PauseAI letter to the Prime Minister` / `… to Google DeepMind`), or
  `Not a PauseAI campaign signatory` if on neither.

  **One bullet when both say the same thing, two when they don't.** If the MP is
  on **neither** list, say so in a single bullet: `Not a ControlAI or PauseAI
  signatory` — not two separate "not a signatory" bullets. If they're on **both**
  (ControlAI and either PauseAI letter), say so in one bullet too: `Signed both
  ControlAI and PauseAI campaigns` (the sources still cite each list/letter
  individually, so which PauseAI letter isn't lost). Only when the two campaigns
  actually differ — signed one, not the other — do you need two bullets (e.g.
  `Signed the ControlAI campaign statement` **and** `Not a PauseAI campaign
  signatory`). This keeps the mandatory signatory coverage to **one** bullet
  whenever it can be, leaving more of the 4-bullet cap for the substantive
  record. (The ingest endpoint enforces the ControlAI/PauseAI half of this
  automatically via `lib/signatory-status.js` — including the same-polarity
  merge — and will add or combine a campaign bullet + source as needed, but
  draft it correctly yourself so the reviewer sees the real finding, not a
  backfilled default. It does **not** know about Sobel's Bill, so folding that
  in is on you.)

  **Fold in a confirmed Sobel's Bill backer, don't give it a separate bullet.**
  When the MP is a named backer, add it to whichever signatory bullet you're
  already writing rather than spending a second slot on it — e.g. `Signed
  ControlAI statement & backs Sobel's superintelligence bill`, or, if that's
  their only qualifying signal, `Backs Sobel's superintelligence bill` on its
  own. Since there's no "not backing" bullet for this one (see above), a
  non-backer's card is unaffected — just the usual ControlAI/PauseAI bullet.
- **X/Twitter check — always run this, every MP.** Search the MP's own X
  account for AI-related posts, not just whatever turns up incidentally in
  general web search. An MP's own posts are often the clearest and most
  current evidence of their real stance — including off-the-cuff dismissive
  lines (e.g. calling AI risk overstated, "bullshit", or hype) that a
  signatory-list sweep would never surface, as well as posts actively backing
  safeguards, the AI Safety Institute, or independent testing.
  - Resolve the MP's handle from their `members.parliament.uk` profile (it
    lists social links) or their own website; if not listed, search `"<MP
    name>" MP X account`.
  - Search `site:x.com "<MP name>" AI` (or `from:<handle> AI` if the handle is
    known) via WebSearch to surface AI-mentioning posts. Look for both
    supportive and dismissive/pro-acceleration framing — the same both-ways
    lens as the rest of this step.
  - Cite a genuine AI-related post with `Post on X by MP` (source style below)
    and link the **specific post**, never the bare profile page.
  - Record the negative result too: if the search turns up no AI-related posts
    from the MP's own account, say so in a bullet (e.g. `No AI-related posts
    found on X`) rather than silently omitting the check — there's no single
    canonical "not listed" proof URL for this one (unlike the signatory
    lists), so the bullet itself is the record that the check was run.
  - `x.com`/`twitter.com` fetches can be blocked or rate-limited — if so, rely
    on WebSearch snippets and don't skip the check; flag the domain under
    "Suggested access for future sweeps" if a specific post you wanted to open
    couldn't be fetched.
- **Signing is a floor only for the sources that explicitly name
  extinction/superintelligence risk — and even then it's a floor, not the
  whole finding.** Of the signatory sources checked above, three qualify as
  explicitly invoking extinction-level or superintelligence risk: the
  **ControlAI campaign statement**, the **PauseAI letter to the Prime
  Minister** (the `pauseai.uk` `/campaigns` roster), and being a **confirmed
  named backer of Alex Sobel's Artificial Superintelligence Bill** (see
  above — treated identically to a ControlAI signature). Any **one** of those
  three is worth at least a B (see the rubric). The earlier **PauseAI letter
  to Google DeepMind** (`pauseai.info`) does not itself invoke extinction/
  superintelligence risk, so signing *only* that letter does not reach B on
  its own — still record it as a positive signal, but it supports at most a C
  alongside the rest of the record.
  Many qualifying signatories have done far more than sign, and filing a bare
  "signed → B" for an MP who is actually an active champion is the exact
  failure this skill must avoid. **For every qualifying signatory, before you
  grade, run the governance-work searches below** — but the bar for A is
  higher than "any AI activity": has the MP secured or led a debate
  **specifically framed around catastrophic/extinction-level AI risk or
  superintelligence** (not AI regulation in general), tabled an EDM or written
  questions **specifically on x-risk or superintelligence**, sponsored a bill
  **targeting frontier-AI/superintelligence risk** (e.g. a bill to restrict or
  prohibit superintelligent systems), taken a specific, cited action **on
  x-risk specifically** within a relevant committee/APPG (see the membership
  rule below), or repeatedly and specifically spoken publicly about
  extinction-level AI risk? Search the MP's name together with terms like
  "superintelligence", "extinction risk", "existential risk", "AI safety
  debate" on Hansard/TheyWorkForYou/Parallel Parliament, and "written question
  artificial intelligence risk". **General AI governance/regulation work that
  never specifically addresses x-risk or superintelligence does not qualify
  for A, however active it is** — see the x-risk rule in the rubric below. A
  qualifying signatory with x-risk-specific active governance work is an
  **A**, not a B. Securing and leading a debate specifically on catastrophic/
  extinction-level AI risk is, on its own, strong evidence for an A.
- Public statements recognising **or dismissing** AI / extinction-level risk.
- Engagement with AI governance: an APPG/committee **action** on AI, inquiries,
  letters, EDMs (see the membership rule below — bare membership doesn't count).
- Support for — **or opposition to** — licensing, oversight, independent testing
  of frontier AI, and binding regulation.
- Any relevant votes, bill sponsorship, or ministerial positions on AI.

**Committee/APPG membership rule — bare membership is never evidence, only a
cited action is.** Many relevant-sounding committees (e.g. Science, Innovation
and Technology) cover dozens of topics beyond AI, and APPG rosters are often
padded with MPs who signed up but never engaged. So being *listed* as a member
proves nothing about an MP's own stance and must never by itself contribute to
a grade, a bullet, or a source. What counts is a specific, cited action the MP
personally took *on AI* within that committee/APPG: chairing or leading an
AI-focused inquiry, questioning a witness about AI risk in a session (cite the
transcript on `committees.parliament.uk`), giving oral/written evidence on AI,
or authoring/co-authoring a committee report section on AI. Search for the
action itself (e.g. "<MP name> committee AI questions", the committee's AI
inquiry page for their name) rather than stopping at a membership list. If all
you can find is that the MP sits on a relevant committee/APPG with no specific
AI action attached, that is not a finding — leave it out rather than filing it
as engagement.

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
- **Sources are capped at 4 too — spend them on what drives the grade.** (Full
  rule under "How many sources" below — 4 is the exception, not the target;
  never pad to the cap.) The reviewer can delete a surplus source in one
  click, but a missing one means they have to go find it themselves, so still
  err generous *within* the cap: **every claim in the rationale or a bullet
  should have a URL backing it in `sources`** wherever the slots allow without
  padding. The two campaign list URLs (see the
  ControlAI-proof rule below) usually claim 2 of the 4 on their own — even
  when the bullet itself combines into one, both list links stay as separate
  sources — leaving 2 for the substantive record. When there are more
  distinct facts than slots (e.g. a committee action, a speech, a vote, and a
  written question all cited in the rationale), prioritise the source(s)
  behind whichever fact is actually driving the grade over background colour;
  a lone source is only acceptable for a genuinely single-fact finding such as
  a pure signatory B.
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

**The x-risk rule — apply this before choosing between A/B/C.** ASVA exists to
track engagement with *catastrophic/extinction-level* AI risk and
superintelligence specifically — not AI policy in general. **Without evidence
of a position or active work specifically on superintelligence or
extinction-level risk, no MP can be graded above a C**, however active they
are on AI more broadly. General AI-policy engagement — copyright, jobs,
deepfakes, adoption, safety testing in general, "AI regulation" as a topic —
does not by itself clear the bar for A or B; it has to be *about* x-risk or
superintelligence specifically. This is what separates B from C below, and
what A requires on top of a qualifying signature.

- **A / B / C** — increasing alignment with ASVA's safety principles, gated by
  the x-risk rule above.
  - **A** = strong, active champion who has *done* things specifically on
    superintelligence/extinction risk, not just signed: signed a **qualifying**
    campaign statement (the ControlAI statement, the PauseAI letter to the
    Prime Minister, or confirmed backing of Alex Sobel's Artificial
    Superintelligence Bill — see the signatory rule above; the PauseAI letter
    to Google DeepMind does not qualify on its own) **and** shown active
    governance work that is itself specifically about x-risk/superintelligence
    — secured or led a debate framed around catastrophic/extinction-level AI
    risk, tabled an EDM or written questions specifically on x-risk or
    superintelligence, sponsored a bill targeting frontier-AI/superintelligence
    risk, took a specific, cited committee/APPG action on x-risk specifically
    (never bare membership — see the membership rule above), or repeatedly and
    specifically spoken publicly about extinction-level AI risk. Securing and
    leading a parliamentary debate specifically on catastrophic/extinction-level
    AI risk is itself strong evidence for an A. **Careful with Sobel's Bill
    specifically:** *backing* it (the ~40-MP letter) only satisfies the
    signature half of A — it is not itself the separate active-work item, so a
    backer with nothing else found is a B, not an A. *Sponsoring* it is
    different: Alex Sobel himself authored and introduced the bill, which is
    both the qualifying signature and substantial active work on its own
    (same as "sponsored a bill targeting frontier-AI/superintelligence risk"
    above) — strong evidence for an A in his specific case.
  - **B** = is a signatory of the ControlAI campaign statement, the PauseAI
    letter to the Prime Minister, **or** a confirmed named backer of Alex
    Sobel's Artificial Superintelligence Bill — nothing more is required for
    B, since all three explicitly name extinction/superintelligence risk. A
    signature only on the PauseAI letter to Google DeepMind does not reach B
    on its own (see the signatory rule above).
  - **C** = some positive engagement, but it falls short of B/A because either
    it doesn't specifically address x-risk/superintelligence (general
    AI-safety/regulation support, statements, or committee work), or the only
    signature found is on the PauseAI letter to Google DeepMind.
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
conservative" flatten a well-evidenced strong record:** if a qualifying
signatory has clear, **x-risk-specific** active governance work (see the
x-risk rule above), grade the **A** — under-grading a genuine champion to B
is as much an error as over-grading. **The same holds at the bottom of the
scale:** don't soften a well-evidenced anti-regulation record up to a `?` or C —
a documented D/E/F is as important to record as an A. And when **refreshing an already-scored
seat, never propose a grade below its current live grade unless you have specific
new evidence that justifies the drop** — a thinner search this run is not a reason
to downgrade, so if you can't beat the existing grade with evidence, leave it at
least where it is. **The x-risk rule is the one exception:** if the existing
live grade's own bullets/sources don't actually support it under the current
rubric (e.g. an A resting on general committee membership or non-x-risk work
with no qualifying signature, or a B resting only on the PauseAI letter to
Google DeepMind), that mismatch *is* the specific reason needed to correct it
— re-grade it down to what the existing record actually supports and say so
plainly in the rationale ("previously graded under a looser rubric — the
record shows X, which supports C, not A"), rather than leaving a stale
over-grade in place by default.

### 4. Build the batch payload
For each MP produce:
```json
{
  "constituency": "<exactly as returned by the queue>",
  "mp_name": "<as returned by the queue>",
  "party": "<as returned, or corrected if clearly wrong>",
  "recommended_grade": "A|B|C|?|DNR|D|E|F",
  "rationale": "<one sentence: why this grade>",
  "bullets": ["<one short phrase — see Bullet style>", "... at most 4, hard cap"],
  "sources": [{ "title": "<source-type wording — see Source style>", "url": "https://..." }]
  // at most 4, hard cap — same limit as bullets. One source per distinct fact
  // you relied on where the 4 slots allow; the two campaign list URLs usually
  // claim 2 of them (see the ControlAI-proof rule). Never leave a
  // rationale/bullet claim unsourced if a slot can still cover it.
}
```
Keep `constituency` byte-identical to the queue value — it is the key the review
and build steps match on.

**Bullet style — keep them scorecard-length, capped at 4.** Each bullet is a
single short phrase of roughly 3–8 words, one idea, no trailing full stop,
written to read as a chip on the scorecard — not a sentence. **Every card
carries at most 4 bullets — no exceptions, this is a hard cap, not a
guideline. But 4 should be the exception, not the target.** Reaching 4 is only
right when either the record genuinely won't condense to 3 (see amalgamate
below — try that first) or there are truly 4 separate, individually
interesting findings each backed by its own link. Never add a 4th bullet just
to fill the slot — a thin or generic finding (a general overview/profile page,
routine constituency casework, anything not specifically bearing on the grade)
doesn't merit one; 3 honest bullets beat 4 where the last is padding. The
mandatory ControlAI/PauseAI signatory coverage claims one slot when it combines
(see above — neither signed, or both signed) or two when it doesn't (signed
one, not the other); the X/Twitter check (also always run) claims one more
when it found something to say either way. That leaves one to two slots —
sometimes just one — for the entire substantive governance record (or the
opposition record, for a D–F). When the record supports more than fits:
- **Amalgamate first.** Combine closely related findings into one composite
  bullet rather than dropping them — e.g. `Tabled EDM & written questions on
  AI risk` instead of two separate bullets, or `Led AI-risk debate; sits on
  AI APPG` if both are genuinely x-risk-specific. A slightly denser bullet
  beats a lost finding.
- **Otherwise choose the best, not the first.** If findings don't amalgamate
  cleanly, keep only the strongest/most specific ones — the ones that most
  directly drive the grade — and leave the rest to the `rationale`. Never pick
  bullets by recency or the order you found them; pick by how much each one is
  doing to justify the
  grade.
Never put sub-clauses, sources, or reviewer asides in a bullet; uncertainty
and "a reviewer could go X" notes belong in `rationale`, never in `bullets`.

Good (style to match):
`Backed safer AI standards` · `Spoke publicly on AI risk` · `Open to further AI
safeguards` · `Opposed stronger AI oversight in debate` · `Downplayed AI risks
in interviews` · `Co-sponsored AI safety motion` · `Supported delay to AI
regulation` · `Argued AI risk is overstated` · `Backed cross-party AI committee`
· `Supports independent testing` · `No public statements on AI safety found` ·
`Not a ControlAI or PauseAI signatory` · `Signed both ControlAI and PauseAI
campaigns` · `Insufficient public record to grade` · `Voted against stronger
oversight` · `Called for stronger oversight` · `Dismissed AI risk as "bullshit"
on X` · `No AI-related posts found on X`

For a `?` ("Not Scored") draft, keep bullets factual about the *absence* of a
record (e.g. `No public statements on AI safety found`, `Not a ControlAI or
PauseAI signatory` — or, if the mix differs, the two separate bullets). Only
use a "did not respond"
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
- Alex Sobel's Artificial Superintelligence Bill → `Bill sponsored by MP` if
  they're Sobel himself (link `bills.parliament.uk/bills/4288`); for a named
  backer, cite the specific press article that names them, titled
  `Named backer of Sobel's superintelligence bill (press report)` — there's no
  canonical list, so (per the check above) this only ever appears for a
  confirmed positive finding, never as proof of absence.
- A committee / inquiry / APPG **action** (never bare membership — see the
  membership rule above) → `<Committee> evidence` / `APPG inquiry evidence`

Match the wording to the actual URL (an `x.com` link is a `Post on X`, a
`labourlist.org` piece the MP wrote is an `Article by MP`). Do **not** reuse the
outlet's headline as the title, e.g. don't write
`ConservativeHome: Only the Conservatives can turn Britain into a science and
technology superpower` — write `Article in ConservativeHome`.

**How many sources — capped at 4, same as bullets, and 4 should be the
exception.** List a distinct source for *each* fact the rationale/bullets lean
on, not just the strongest one: if you cite a committee role, a signature and
a quote, that is three separate entries. Land on 3 as the normal case; only
reach the 4th slot when it's genuinely earned — either the record won't
condense to 3 distinct facts, or there really are 4 separate, individually
interesting findings each with its own direct link. **Never add a 4th source
just to fill the slot.** A generic overview/profile page, a duplicate angle on
a fact another source already covers, or anything not specifically backing a
grade-relevant claim does not merit the 4th slot — leave it at 3. When a
single URL covers several facts, one entry is fine, which helps stay under the
cap. Within the cap, over-including a genuinely distinct, relevant source is
still the preferred error versus under-including: the reviewer removes a
surplus source in one click, whereas a missing one costs them a hunt — but
once 4 is reached (or 3 genuinely covers it), stop, and let any further fact
ride on the rationale text alone rather than padding with a weak link. Even
the thinnest card carries more than one source: a pure signatory B still
cites the list it's on, and a `?` carries the two campaign signatory-list
URLs **plus** the MP's parliamentary-record link (see the `?` rule above) —
never the signatory lists alone.

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
