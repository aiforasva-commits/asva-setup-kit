// scripts/build-constituency-pages.js
//
// Runs at build time, right after fetch-data.js has written data.json.
// Generates one static page per constituency — scorecard/<slug>/index.html —
// so a crawler that doesn't execute JavaScript (most AI crawlers, unlike
// Googlebot) can read the current MP's name, grade and evidence directly,
// instead of the empty app shell that scorecard.html otherwise serves until
// its client-side JS fetches /data.json.
//
// scorecard.html is the single template this reads from: the shared <head>
// tags and card markup are spliced from the live file's own text, not a
// hand-maintained copy, so a future edit to that file's shell (nav, OG tags,
// card layout) is picked up by the very next build automatically. If
// scorecard.html changes in a way that breaks one of the anchors below, this
// throws and fails the build — by design, so a silently stale or broken set
// of 650 pages can never ship unnoticed. See the comment at the top of
// scorecard.html's <head> for the other half of this coupling.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';

const SITE = 'https://aisafetyvoteralliance.co.uk';
const OUTPUT_ROOT = 'scorecard';

const data     = JSON.parse(readFileSync('data.json', 'utf8'));
const template = readFileSync('scorecard.html', 'utf8');

// ── Mirrors of the client-side helpers in scorecard.html's render() ─────────
// (grade ordering / labels / escaping — kept in sync by hand; see the note at
// the top of this file and in scorecard.html)
const GRADE_ORDER = { A: 0, B: 1, C: 2, '?': 3, DNR: 4, D: 5, E: 6, F: 7 };
const GRADE_LABEL = { '?': 'TBC', DNR: '?' };

function gradeKey(g) {
  const gg = (g || '?').toString().trim().toUpperCase() || '?';
  return gg in GRADE_ORDER ? GRADE_ORDER[gg] : 999;
}

function escHTML(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

// Constituency name -> URL slug. Diacritics are stripped (not transliterated
// beyond that) so e.g. "Ynys Môn" -> "ynys-mon".
function slugify(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Same card markup as the client's render() in scorecard.html, minus the
// inline grade colour (resolved client-side from CSS custom properties via
// getComputedStyle, which isn't available here) — the live re-render fills
// that in moments after the page's own JS boots, same as it already does for
// every shared ?constituency= link today.
function cardHtml(r) {
  const g = (r.grade || '?').toUpperCase();
  const bullets = [];
  for (let i = 1; i <= 5; i++) {
    const t = (r[`bullet${i}`] || '').trim();
    if (t) bullets.push(`<li>${escHTML(t)}</li>`);
  }
  const evidences = [];
  for (let i = 1; i <= 6; i++) {
    const text = (r[`evidence${i}`] || '').trim();
    const url  = (r[`evidence${i}_url`] || '').trim();
    if (text) {
      evidences.push(url
        ? `<li><a href="${escHTML(url)}" target="_blank" rel="noopener noreferrer">${escHTML(text)}</a></li>`
        : `<li>${escHTML(text)}</li>`
      );
    }
  }
  const lastUpdated = (r.last_updated || '').trim();

  return `
    <div class="card${g === '?' ? ' grade-q' : ''}" data-grade="${escHTML(g)}" data-name="${escHTML(r.name)}" onclick="toggleCard(this)">
      <div class="card-summary">
        <div class="cell leftStrip">
          <div class="pill">${escHTML(GRADE_LABEL[g] || g)}</div>
        </div>
        <div class="cell middle">
          <div class="name">${escHTML(r.name)}${r.current_mp ? '<span class="current-mp-tag">Current MP</span>' : ''}</div>
          ${bullets.length ? `<ul>${bullets.join('')}</ul>` : ''}
        </div>
        ${r.current_mp ? `
        <div class="cell mp-badge-cell">
          <svg viewBox="0 0 20 24" width="28" height="34" fill="#1a1a2e" xmlns="http://www.w3.org/2000/svg">
            <polygon points="2,8 2,5 5.5,7 10,2 14.5,7 18,5 18,8"/>
            <rect x="1" y="8" width="18" height="2"/>
            <rect x="2" y="10" width="2.5" height="10"/>
            <rect x="6.5" y="10" width="2.5" height="10"/>
            <rect x="11" y="10" width="2.5" height="10"/>
            <rect x="15.5" y="10" width="2.5" height="10"/>
            <rect x="1" y="13.5" width="18" height="1.5"/>
            <rect x="1" y="17" width="18" height="1.5"/>
          </svg>
          Current MP
        </div>` : ''}
        <div class="cell right">
          ${escHTML(r.party)}
          <span class="chevron">▼</span>
        </div>
      </div>
      <div class="card-expanded">
        <div class="expanded-meta">
          ${lastUpdated ? `<span>Last updated: ${escHTML(lastUpdated)}</span>` : '<span></span>'}
        </div>
        ${evidences.length ? `<ul class="evidence-list">${evidences.join('')}</ul>` : ''}
        <div class="card-links-row">
          <a href="mailto:contact@aisafetyvoteralliance.co.uk?subject=Scorecard%20update%20for%20${encodeURIComponent(r.name)}"
             class="suggest-link">
            Something to add or something we got wrong? Let us know by email →
          </a>
        </div>
      </div>
    </div>`;
}

function buildMeta(constituencyName, list) {
  const current = list.find(c => c.current_mp);
  if (!current) {
    return {
      title: `${constituencyName} — AI Safety Scorecard | ASVA`,
      description: `Find ${constituencyName}'s MP's AI safety grade and the evidence behind it, then pledge your vote.`,
      hasContent: false,
    };
  }
  const grade = (current.grade || '?').toUpperCase();
  const gradeKnown = grade !== '?';
  return {
    title: `${current.name} — AI Safety Grade for ${constituencyName} | ASVA`,
    description: gradeKnown
      ? `See ${current.name}'s AI safety grade (${grade}) as ${constituencyName}'s MP, and the evidence behind it — then pledge your vote.`
      : `Find out where ${current.name}, ${constituencyName}'s MP, stands on AI safety, and the evidence behind it — then pledge your vote.`,
    hasContent: gradeKnown,
  };
}

// ── Validate the anchors we're about to splice around still exist ───────────
// If scorecard.html's shell has changed since these were written, fail here
// rather than silently emit 650 wrong or broken pages.
const ANCHORS = {
  // These pages live one directory level deeper than scorecard.html
  // (scorecard/<slug>/ vs. scorecard.html at the site root), so every
  // relative reference in the shared template — app.css, editable-list.js,
  // nav links, favicons — would otherwise resolve one level too deep and
  // 404. A <base> tag is the standard fix: it makes every relative URL in
  // the page resolve against the site root regardless of the page's own
  // location, with no need to rewrite each reference individually.
  charset:               '<meta charset="utf-8" />',
  title:                 '<title>ASVA - Scorecard</title>',
  ogTwitterTitle:        'content="ASVA - Scorecard"',
  description:           `content="Find your MP's AI safety grade and the evidence behind it, then pledge your vote."`,
  ogUrl:                 'content="https://aisafetyvoteralliance.co.uk/scorecard"',
  canonical:              'href="https://aisafetyvoteralliance.co.uk/scorecard"',
  body:                  '<body class="page-scorecard">',
  sheetWrap:             '<div class="sheetWrap" id="sheetWrap" style="display:none">',
  noConstituencyPrompt:  '<div id="noConstituencyPrompt" style="',
  titleConstituency:     '<div class="constituency" id="titleConstituency">—</div>',
  shareBtnHidden:        '<button type="button" class="sc-share-btn" id="scShareBtn" hidden>',
  cards: `<div class="cards" id="cards">
        <div class="loading">Loading...</div>
      </div>`,
};
for (const [key, anchor] of Object.entries(ANCHORS)) {
  if (!template.includes(anchor)) {
    throw new Error(
      `build-constituency-pages: expected anchor "${key}" not found in scorecard.html — ` +
      `the shared template has changed and this script's ANCHORS need updating to match. Aborting build.`
    );
  }
}

function buildPage(constituencyName, slug, list, meta) {
  let html = template;
  // Root-relative (not the full absolute SITE URL) so this also works
  // correctly against whatever origin the page is actually served from —
  // including local `wrangler pages dev` testing — rather than hardcoding
  // the production domain and silently pointing local asset loads at it.
  html = html.replace(ANCHORS.charset, `${ANCHORS.charset}\n  <base href="/">`);
  html = html.replace(ANCHORS.title, `<title>${escHTML(meta.title)}</title>`);
  html = html.replaceAll(ANCHORS.ogTwitterTitle, `content="${escHTML(meta.title)}"`);
  html = html.replaceAll(ANCHORS.description, `content="${escHTML(meta.description)}"`);
  html = html.replace(ANCHORS.ogUrl, `content="${SITE}/scorecard/${slug}/"`);
  html = html.replace(ANCHORS.canonical, `href="${SITE}/scorecard/${slug}/"`);
  html = html.replace(ANCHORS.body, `<body class="page-scorecard" data-ssr-constituency="${escHTML(constituencyName)}">`);
  html = html.replace(ANCHORS.sheetWrap, '<div class="sheetWrap" id="sheetWrap">');
  html = html.replace(ANCHORS.noConstituencyPrompt, `<div id="noConstituencyPrompt" style="display:none;`);
  html = html.replace(ANCHORS.titleConstituency, `<div class="constituency" id="titleConstituency">${escHTML(constituencyName)}</div>`);
  html = html.replace(ANCHORS.shareBtnHidden, '<button type="button" class="sc-share-btn" id="scShareBtn">');

  const cardsHtml = list.length
    ? list.map(r => cardHtml(r)).join('')
    : '<div class="empty">No candidates found for this constituency.</div>';
  html = html.replace(ANCHORS.cards, `<div class="cards" id="cards">${cardsHtml}</div>`);

  return html;
}

// ── Generate one page per constituency ───────────────────────────────────────
if (existsSync(OUTPUT_ROOT)) rmSync(OUTPUT_ROOT, { recursive: true, force: true });
mkdirSync(OUTPUT_ROOT);

// The Candidates sheet carries a template/demo row (fake names like "Bilbo
// Baggins" and "Frankie Dangerous", placeholder evidence text) used to show
// editors the expected format. It's harmless sitting in data.json, but this
// script would otherwise publish it as a real public page and put it in the
// sitemap, actively inviting Google to crawl an obviously fake entry on the
// live domain — so skip it explicitly. It's still reachable via the site's
// search box today regardless (independent of this script); the sheet is the
// right place to remove it if it's no longer needed as a template.
const SKIP_CONSTITUENCIES = new Set(['Example Constituency']);

const seenSlugs   = new Map(); // slug -> constituency name, to catch collisions
const sitemapUrls = [];
let indexed = 0, thin = 0, skipped = 0;
const today = new Date().toISOString().slice(0, 10);

for (const { name } of data.constituencies) {
  if (SKIP_CONSTITUENCIES.has(name)) { skipped++; continue; }
  const slug = slugify(name);
  if (!slug) throw new Error(`build-constituency-pages: "${name}" produced an empty slug`);
  if (seenSlugs.has(slug)) {
    throw new Error(
      `build-constituency-pages: slug collision "${slug}" between "${seenSlugs.get(slug)}" and "${name}" — ` +
      `pick a disambiguating slug scheme before continuing.`
    );
  }
  seenSlugs.set(slug, name);

  const list = (data.candidates[name] || []).slice().sort((a, b) => {
    const ka = gradeKey(a.grade), kb = gradeKey(b.grade);
    if (ka !== kb) return ka - kb;
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  });

  const meta = buildMeta(name, list);
  const html = buildPage(name, slug, list, meta);

  mkdirSync(`${OUTPUT_ROOT}/${slug}`, { recursive: true });
  writeFileSync(`${OUTPUT_ROOT}/${slug}/index.html`, html);

  if (meta.hasContent) {
    const current = list.find(c => c.current_mp);
    const lastUpdated = (current && current.last_updated || '').slice(0, 10);
    const lastmod = /^\d{4}-\d{2}-\d{2}$/.test(lastUpdated) ? lastUpdated : today;
    sitemapUrls.push({ loc: `${SITE}/scorecard/${slug}/`, lastmod });
    indexed++;
  } else {
    // Not yet graded — the page still exists (a visitor who searches for it
    // gets a real page), it's just excluded from the sitemap so we're not
    // inviting search engines to crawl and judge a near-empty placeholder.
    thin++;
  }
}

console.log(
  `Constituency pages: ${indexed + thin} generated, ${indexed} sitemapped, ${thin} not yet graded (generated but excluded from the sitemap)` +
  (skipped ? `, ${skipped} skipped (template/demo row)` : '')
);

// ── Regenerate sitemap.xml (top-level pages + every sitemapped constituency) ─
// NOTE: this list of top-level pages is small and stable — update it by hand
// if a new one is added. The constituency URLs below are the ones actually
// worth maintaining a script for.
const TOP_LEVEL_PAGES = ['', 'why-ai-safety', 'pledge', 'overview', 'scorecard', 'founding-statement', 'about', 'privacy'];

const urlXml = ({ loc, lastmod }) => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
const allUrls = [
  ...TOP_LEVEL_PAGES.map(p => ({ loc: `${SITE}/${p}`, lastmod: today })),
  ...sitemapUrls,
];

writeFileSync('sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${allUrls.map(urlXml).join('\n')}\n</urlset>\n`
);
console.log(`sitemap.xml written: ${allUrls.length} URLs`);
