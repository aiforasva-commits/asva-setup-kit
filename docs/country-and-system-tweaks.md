# What's actually different when you're not doing the UK

This kit was built for one specific system — 650 UK constituencies, one MP each, first-past-the-post. That shape is baked into more of the code than it looks like at first glance, so before you start rebranding, it's worth going through what genuinely changes depending on where you're setting up and how your legislature works.

## First: does your legislature even look like this?

Everything here assumes **one representative per geographic seat**. If your country elects people that way — most of the US, Canada, India, most of Westminster-derived systems — you're fine, skip to the next section.

If it doesn't — proportional representation, party-list seats, mixed systems like Germany's or New Zealand's, multi-member districts — stop and think about what "grade" even means before touching any code. A grade per seat doesn't make sense if five parties' worth of people represent the same seat, or if half your legislature was elected off a party list with no geographic tie at all. You've got a few honest options: grade parties instead of people, grade only the geographic half of a mixed system, or pick a different unit entirely (grade by list position, by party). None of these are a code change first — they're a decision about what the site is actually rating, and it changes the data model, not just the branding.

Bicameral countries add another wrinkle: do you rate both houses, or just the one people vote for directly? An appointed or indirectly-elected upper house (Senate appointments, House of Lords, etc.) usually isn't worth rating on a voter-facing site — there's no vote to change. Worth deciding up front rather than halfway through data entry.

## The hex map

Realistic expectation: don't redraw this for launch. It's hand-placed geometry for 650 specific shapes, not something that regenerates from a shapefile without real work, and it's the single most time-consuming thing in the whole repo. Ship the list/table view first. If your country's map is a point of national pride and you want it eventually, that's a separate project, not a step-one task.

## Where "who currently holds this seat" data comes from

The UK has `electionresults.parliament.uk` — a clean, structured, official results feed the build script pulls from automatically. Not every country has an equivalent that's actually machine-readable. Check what your national electoral commission publishes and how:

- Clean open API or downloadable dataset → point the build script at it, mostly plug and play.
- Results published only as PDFs, or spread across regional bodies with no central source → don't fight it. Drop the automated pull and enter results manually into the Google Sheet. More manual work up front, no ongoing dependency to babysit.
- Frequent by-elections / special elections that change seat-holders mid-term → whichever route you pick, decide who's responsible for noticing and updating.

## Researching and grading your representatives

This is the part that's genuinely different work per country, not just relabeling. The UK research skill leans on a specific ecosystem: `theyworkforyou.com` for voting records, `parliament.uk`'s API for structured data, established AI-safety campaigns (ControlAI, PauseAI) with public signatory lists, and a curated list of national press.

For your country you need real equivalents of each of these, not translations:

- **A voting-record source.** Does your legislature publish how individuals voted, or only party-line results? Some countries don't record individual votes at all outside committee, which changes what you can actually grade someone on.
- **A structured data source for basic facts** (who represents what seat, contact details, party). Government open-data portals are the first place to check.
- **AI-safety-specific asks or campaigns** your representatives could plausibly have taken a position on. If none exist yet in your country, this feature has nothing to plug into — that's fine, it's additive, but don't force it.
- **A press list** — the outlets your researchers should trust when a claim needs a second source, and just as importantly, ones to be wary of. This list is opinionated by nature; it'll need updating over time as you find gaps (the UK one grew after a specific source turned out to live on a different domain than expected).

None of this is a find-and-replace job. Budget real time for someone who understands your country's political media landscape to build this list, not just an engineer.

## Legal and compliance — don't assume the UK's rules travel

The pledge form, email confirmation flow, and data retention choices in this codebase were built against UK/GDPR assumptions. Depending on where you're launching:

- Consent language and what counts as valid opt-in for email may differ (GDPR vs. CAN-SPAM vs. whatever your country's equivalent is, if any).
- Data residency — some organisations or jurisdictions care where the Supabase project's underlying data actually lives.
- If you're collecting home addresses to match people to their seat, check whether that counts as sensitive personal data locally and what retention/deletion obligations follow.

This isn't a "read the docs and copy a clause" exercise — get someone who actually knows the local rules to look at the pledge and confirmation copy before launch.

## Branding

Straightforward but not zero-effort: new logo, favicon set, hero image, and any copy that currently says "MP" needs your legislature's actual term (Deputy, Representative, Member of Congress, TD, whatever it is locally) — not just cosmetically, but consistently, since it shows up in emails and confirmation pages too. Placeholder art generated along the way should be flagged clearly as placeholder so it doesn't accidentally ship.

## One thing that stays the same

The underlying plumbing — Supabase schema, the pledge/confirmation email flow, session handling, Cloudflare Functions — has nothing UK-specific baked into it. That part really is copy-and-configure. It's the electoral shape, the data sources, and the research process that need real thought per country.
