# Research environment — network allowlist

Paste-ready domain list for the **Allowed domains** box of the research
environment's **Network access → Custom** policy (Claude Code on the web).
Used by the `research-mps` skill so WebFetch can open the reference sites it
grades MPs from.

## How to use

1. In the environment settings, set **Network access** to **Custom**.
2. Paste the block below into **Allowed domains** (select the whole block).
3. Keep **"Also include default list of common package managers"** ticked —
   this list is additive to it.
4. Save, then **start a fresh session** — a session's network policy is fixed
   at session start, so an existing session won't pick up the change.

Each domain is listed twice: the apex (`example.com`) and a wildcard
(`*.example.com`), so it works whether the site serves from the root or a
subdomain (`www.`, `members-api.`, etc.).

## Notes / known limits

- **`*.parliament.uk`** is the key entry: it covers the JSON API subdomains
  (`members-api.parliament.uk`, `commonsvotes-api.parliament.uk`) that return
  clean structured data and sidestep the Cloudflare bot-challenge on the HTML
  pages.
- **`hansard.parliament.uk` / `members.parliament.uk` HTML pages may still
  return 403** even when allowlisted — that is Cloudflare bot-protection at
  Parliament's site, not the egress policy. Prefer the API subdomains, or fall
  back to WebSearch snippets, for those.
- WebSearch reaches every domain regardless of this list; only WebFetch depends
  on it.
- The skill also wants each MP's own website and local news titles (unique
  domains) — add those case-by-case as they come up.
- **ControlAI's full signatory list lives on `controlai.com`** (the
  `/statement` page), not `controlai.org`, and several analysis pieces are on
  `controlai.news` and `substack.com` — all were blocked in the first run, so
  they are now included below. `*.controlai.com` also covers
  `ukbill.controlai.com`.

## Allowed domains (paste this block)

```
aisafetyvoteralliance.co.uk
*.aisafetyvoteralliance.co.uk
parliament.uk
*.parliament.uk
gov.uk
*.gov.uk
theyworkforyou.com
*.theyworkforyou.com
parallelparliament.co.uk
*.parallelparliament.co.uk
publicwhip.org.uk
*.publicwhip.org.uk
whocanivotefor.co.uk
*.whocanivotefor.co.uk
controlai.org
*.controlai.org
safe.ai
*.safe.ai
pauseai.info
*.pauseai.info
longtermresilience.org
*.longtermresilience.org
cser.ac.uk
*.cser.ac.uk
turing.ac.uk
*.turing.ac.uk
adalovelaceinstitute.org
*.adalovelaceinstitute.org
instituteforgovernment.org.uk
*.instituteforgovernment.org.uk
bbc.co.uk
*.bbc.co.uk
theguardian.com
*.theguardian.com
thetimes.com
*.thetimes.com
telegraph.co.uk
*.telegraph.co.uk
ft.com
*.ft.com
independent.co.uk
*.independent.co.uk
inews.co.uk
*.inews.co.uk
standard.co.uk
*.standard.co.uk
politicshome.com
*.politicshome.com
politico.eu
*.politico.eu
conservativehome.com
*.conservativehome.com
labourlist.org
*.labourlist.org
libdemvoice.org
*.libdemvoice.org
newstatesman.com
*.newstatesman.com
spectator.co.uk
*.spectator.co.uk
techcrunch.com
*.techcrunch.com
theregister.com
*.theregister.com
wired.com
*.wired.com
sifted.eu
*.sifted.eu
x.com
*.x.com
twitter.com
*.twitter.com
facebook.com
*.facebook.com
linkedin.com
*.linkedin.com
youtube.com
*.youtube.com
bsky.app
*.bsky.app
wikipedia.org
*.wikipedia.org
controlai.com
*.controlai.com
controlai.news
*.controlai.news
substack.com
*.substack.com
oecd.ai
*.oecd.ai
effectivealtruism.org
*.effectivealtruism.org
```
