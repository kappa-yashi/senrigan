#!/usr/bin/env node
// senrigan (千里眼) — static site visibility & structure check (SEO, structured data, link topology).
// Zero dependencies. Node 18+.
//
//   senrigan https://www.example.com        scan the live site (read-only GETs + a few HEADs)
//   senrigan ./dist [--base https://host]   scan a build output folder
//
// Options:
//   --json              machine-readable output
//   --summary           print only warnings and failures, one line each, plus the counts
//   --out <file>        also write the report to a file (.json → JSON, .md → markdown, else plain text)
//   --strict            warnings count as failures (exit 1)
//   --pages N           live: how many inner pages to scan from the sitemap (default 8)
//   --semantic          Layer 5: keyword / title overlap per page (opt-in, informational)
//   --no-probe          live: skip the root-asset probes (favicons, llms.txt, manifest) and link HEADs
//   --base <url>        dist: the public origin, so absolute canonicals / og:url can be judged
//   --dist              force dist mode for a folder
//
// Only scan sites you own or are allowed to test.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, dirname, sep } from 'node:path';

// ───────────────────────────── cli ─────────────────────────────
const argv = process.argv.slice(2);
const opt = { json: false, summary: false, out: '', strict: false, pages: 8, semantic: false, probe: true, base: '', mode: '' };
const KNOWN_FLAGS = ['--json', '--summary', '--out', '--strict', '--pages', '--semantic', '--no-probe', '--base', '--dist', '-h', '--help'];
const similar = (a) => KNOWN_FLAGS.map((f) => [f, [...f].filter((ch, i) => a[i] === ch).length / Math.max(f.length, a.length)]).sort((x, y) => y[1] - x[1])[0];
let target = '';
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('-') && !KNOWN_FLAGS.includes(a)) { const [guess, score] = similar(a); console.error(`unknown option ${a}${score > 0.6 ? ` — did you mean ${guess}?` : ''}`); process.exit(2); }
  if (a === '--json') opt.json = true;
  else if (a === '--summary') opt.summary = true;
  else if (a === '--out') opt.out = argv[++i] || '';
  else if (a === '--strict') opt.strict = true;
  else if (a === '--pages') opt.pages = Number(argv[++i]) || 8;
  else if (a === '--semantic') opt.semantic = true;
  else if (a === '--no-probe') opt.probe = false;
  else if (a === '--base') opt.base = (argv[++i] || '').replace(/\/+$/, '');
  else if (a === '--dist') opt.mode = 'dist';
  else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else target = a;
}
if (!target) { usage(); process.exit(2); }

function usage() {
  console.log(`senrigan (千里眼) — static site visibility & structure check

  senrigan https://www.example.com      live scan (read-only GET/HEAD requests)
  senrigan ./dist [--base https://host] scan a build folder

  --json  --summary  --out <file.md|.json|.txt>  --strict  --pages N  --semantic  --no-probe  --base <url>  --dist`);
}

// ───────────────────────────── report ─────────────────────────────
const results = []; // { section, level: pass|warn|fail|info, id, msg, detail? }
const cur = { section: '' };
const section = (s) => { cur.section = s; };
const pass = (id, msg, detail) => results.push({ section: cur.section, level: 'pass', id, msg, detail });
const warn = (id, msg, detail) => results.push({ section: cur.section, level: 'warn', id, msg, detail });
const fail = (id, msg, detail) => results.push({ section: cur.section, level: 'fail', id, msg, detail });
const info = (id, msg, detail) => results.push({ section: cur.section, level: 'info', id, msg, detail });

// ───────────────────────────── html helpers ─────────────────────────────
const lower = (h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', dagger: '†', Dagger: '‡', bull: '•', hellip: '…', permil: '‰', prime: '′', Prime: '″', lsaquo: '‹', rsaquo: '›', euro: '€', trade: '™', ndash: '–', mdash: '—', ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '', lrm: '', rlm: '', OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', Yuml: 'Ÿ', fnof: 'ƒ', circ: 'ˆ', tilde: '˜', larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔', hearts: '♥', sigmaf: 'ς', thetasym: 'ϑ', upsih: 'ϒ', piv: 'ϖ' };
// Latin-1 (U+00A0–U+00FF) and the Greek alphabet by name — page builders (Wix among them) encode Greek text as &alpha;&beta;…
'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(' ').forEach((n, i) => { ENT[n] = String.fromCodePoint(0xA0 + i); });
'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho _ Sigma Tau Upsilon Phi Chi Psi Omega'.split(' ').forEach((n, i) => { if (n !== '_') { ENT[n] = String.fromCodePoint(0x391 + i); ENT[n.toLowerCase()] = String.fromCodePoint(0x3B1 + i); } });
const decode = (s) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { try { return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)); } catch { return m; } }
  return ENT[e] ?? ENT[e.toLowerCase()] ?? m;
});
const attr = (attrs, name) => { const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')); return m ? decode(m[1] ?? m[2] ?? m[3]) : (new RegExp(`(?:^|\\s)${name}(?=\\s|$)`, 'i').test(attrs) ? '' : null); };
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const normKey = (u) => { try { const x = new URL(u, 'https://x/'); return normPath(x.pathname) + x.search; } catch { return normPath(String(u).split('#')[0]); } };
const normPath = (p) => { try { p = decodeURI(p); } catch { /* keep as is */ } return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p; };
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// Parse what matters for visibility: head, headings, images, links, JSON-LD, DOM shape, clean text.
function inspect(html) {
  const o = { lang: null, title: null, metas: [], links: [], canonical: null, robotsMeta: null, viewport: null, description: null, og: {}, twitter: {}, hreflang: [], headings: [], images: [], anchors: [], jsonld: [], jsonldErrors: [], times: [], nodes: 0, depth: 0, text: '', mainText: '', hasMain: false, scriptSrcs: [], styleHrefs: [], nextPrev: { next: null, prev: null }, generator: null, articleTag: false, assetHosts: new Set() };
  const htmlTag = html.match(/<html\b([^>]*)>/i); if (htmlTag) o.lang = attr(htmlTag[1], 'lang');
  const head = (html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i) || [, html])[1];
  o.title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]; o.title = o.title == null ? null : stripTags(o.title);
  for (const m of head.matchAll(/<meta\b([^>]*)>/gi)) {
    const a = m[1]; const name = (attr(a, 'name') || attr(a, 'property') || attr(a, 'http-equiv') || '').toLowerCase(); const content = attr(a, 'content');
    o.metas.push({ name, content });
    if (name === 'viewport') o.viewport = content;
    else if (name === 'description') o.description = content;
    else if (name === 'robots') o.robotsMeta = (content || '').toLowerCase();
    else if (name === 'generator') o.generator = content;
    else if (name.startsWith('og:')) o.og[name] = o.og[name] ?? content;
    else if (name.startsWith('twitter:')) o.twitter[name] = o.twitter[name] ?? content;
  }
  for (const m of head.matchAll(/<link\b([^>]*)>/gi)) {
    const a = m[1]; const rel = (attr(a, 'rel') || '').toLowerCase().split(/\s+/); const href = attr(a, 'href');
    o.links.push({ rel, href, attrs: a });
    if (rel.includes('canonical')) o.canonical = o.canonical ?? href;
    if (rel.includes('alternate') && attr(a, 'hreflang') != null) o.hreflang.push({ lang: attr(a, 'hreflang'), href });
    if (rel.includes('next')) o.nextPrev.next = href; if (rel.includes('prev')) o.nextPrev.prev = href;
    if (rel.includes('stylesheet')) o.styleHrefs.push(href);
  }
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const type = (attr(m[1], 'type') || '').toLowerCase(); const src = attr(m[1], 'src');
    if (type === 'application/ld+json') { try { o.jsonld.push(JSON.parse(m[2])); } catch (e) { o.jsonldErrors.push(String(e.message).slice(0, 80)); } continue; }
    if (src) o.scriptSrcs.push(src);
  }
  // body: strip script/style/comments/svg before the structural passes
  const body = (html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i) || [, html])[1];
  // an inline <svg> becomes its accessible name (aria-label or <title>), so a wordmark inside an <h1> or <a> still counts as text
  const svgName = (svg) => { const open = svg.match(/<svg\b([^>]*)>/i)?.[1] || ''; return attr(open, 'aria-label') || stripTags(svg.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') || ''; };
  const clean = body.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, '').replace(/<svg\b[\s\S]*?<\/svg>/gi, (svg) => ` ${svgName(svg)} `);
  // real heading tags and role="heading" elements, in document order (a <div role="heading" aria-level="1"> is still an h1 to assistive tech and to the outline)
  for (const m of clean.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>|<(div|span|p|strong|b)\b([^>]*\brole\s*=\s*["']heading["'][^>]*)>([\s\S]*?)<\/\4>/gi)) {
    if (m[1]) { o.headings.push({ level: Number(m[1]), text: stripTags(m[3].replace(/<img\b([^>]*)>/gi, (x, a) => attr(a, 'alt') || '')) || attr(m[2], 'aria-label') || '', attrs: m[2] }); continue; }
    const lvl = Number(attr(m[5], 'aria-level')) || 2; o.headings.push({ level: Math.min(6, Math.max(1, lvl)), text: stripTags(m[6]) || attr(m[5], 'aria-label') || '', attrs: m[5], role: true });
  }
  for (const m of clean.matchAll(/<img\b([^>]*)>/gi)) { const a = m[1]; o.images.push({ src: attr(a, 'src') || attr(a, 'data-src') || '', alt: attr(a, 'alt'), loading: (attr(a, 'loading') || '').toLowerCase(), decoding: (attr(a, 'decoding') || '').toLowerCase(), width: attr(a, 'width'), height: attr(a, 'height'), fetchpriority: attr(a, 'fetchpriority') }); }
  for (const m of clean.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = m[1]; const inner = m[2];
    const text = stripTags(inner.replace(/<img\b([^>]*)>/gi, (x, ia) => attr(ia, 'alt') || '')) || attr(a, 'aria-label') || attr(a, 'title') || '';
    o.anchors.push({ href: attr(a, 'href'), text, rel: (attr(a, 'rel') || '').toLowerCase(), target: (attr(a, 'target') || '').toLowerCase(), hasImg: /<img\b/i.test(inner), ariaLabel: attr(a, 'aria-label') });
  }
  for (const m of clean.matchAll(/<time\b([^>]*)>/gi)) { const d = attr(m[1], 'datetime'); if (d) o.times.push(d); }
  // DOM shape (a tolerant count: every start tag is a node, nesting from the tag stream)
  let depth = 0, max = 0, nodes = 0; const stack = [];
  for (const m of clean.matchAll(/<(\/?)([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>/g)) {
    const closing = m[1] === '/', name = m[2].toLowerCase(), self = m[3] === '/';
    if (closing) { const i = stack.lastIndexOf(name); if (i >= 0) { stack.length = i; depth = stack.length; } continue; }
    nodes++; if (VOID.has(name) || self) continue;
    if (['p', 'li', 'td', 'th', 'tr', 'option', 'dt', 'dd'].includes(name) && stack[stack.length - 1] === name) stack.pop(); // implicit close
    stack.push(name); depth = stack.length; if (depth > max) max = depth;
  }
  o.nodes = nodes; o.depth = max;
  // text
  const mainM = clean.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || clean.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  o.hasMain = !!mainM; o.articleTag = (clean.match(/<article\b/gi) || []).length === 1;
  for (const u of [...o.scriptSrcs, ...o.styleHrefs, ...o.images.map((i) => i.src)]) { try { if (isHttp(u)) o.assetHosts.add(new URL(u).host); } catch { /* ignore */ } }
  if (/\/wp-content\//.test(html)) o.assetHosts.add('wp-content'); if (/\/_astro\//.test(html)) o.assetHosts.add('_astro'); if (/\/_next\//.test(html)) o.assetHosts.add('_next');
  const noChrome = (mainM ? mainM[1] : clean).replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, '');
  o.mainText = stripTags(noChrome); o.text = stripTags(clean);
  o.markup = analyzeMarkup(clean, html.length, o.text);
  return o;
}

// ───────────────────────────── Layer 6: markup & accessibility ─────────────────────────────
// Divs are not penalised by search engines as such. What costs visibility is (1) content that machines cannot
// separate from chrome — LLMs, RAG pipelines, reader modes and snippet extraction lean on landmarks and text
// blocks; (2) navigation that crawlers cannot follow (a div with onclick is not a link); (3) render cost (CWV).
// The grade measures those three, plus the accessibility checks that can be made without rendering.
const ARIA_ROLES = new Set('alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img image insertion link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem'.split(' '));
const TEXT_BLOCKS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'dd', 'dt', 'blockquote', 'figcaption', 'caption', 'label', 'button', 'a', 'pre', 'code', 'summary', 'legend', 'q', 'cite', 'time', 'address', 'option', 'small', 'strong', 'em', 'b', 'i', 'mark', 'abbr']);
const BUILDERS = [['Elementor', /\belementor-/], ['Divi', /\bet_pb_/], ['WPBakery', /\b(?:vc_row|wpb_)/], ['Oxygen', /\b(?:ct-section|oxy-)/], ['Bricks', /\bbrxe-/], ['Beaver Builder', /\bfl-(?:row|col|module)/], ['Webflow', /\bw-(?:layout|nav|container|richtext)/], ['Wix', /\b(?:wixui-|comp-[a-z0-9]{6,})/], ['Framer', /\bframer-/], ['Squarespace', /\bsqs-/]];
function analyzeMarkup(clean, htmlLen, text) {
  // a tolerant tree: enough to see who wraps whom
  const root = { tag: '#root', attrs: '', kids: [], text: 0, parent: null }; let cur = root; const all = [];
  for (const m of clean.matchAll(/<(\/?)([a-zA-Z][\w:-]*)\b([^>]*?)(\/?)>|([^<]+)/g)) {
    if (m[5] !== undefined) { const t = m[5].replace(/&[a-z#0-9]+;/gi, ' ').trim(); if (t) { cur.text += t.length; (cur.textRuns ||= []).push(t.length); } continue; }
    const name = m[2].toLowerCase();
    if (m[1]) { let n = cur; while (n && n.tag !== name) n = n.parent; if (n && n.parent) cur = n.parent; continue; }
    if (['p', 'li', 'td', 'th', 'tr', 'option', 'dt', 'dd'].includes(name) && cur.tag === name && cur.parent) cur = cur.parent;
    const node = { tag: name, attrs: m[3] || '', kids: [], text: 0, parent: cur }; cur.kids.push(node); all.push(node);
    if (!VOID.has(name) && m[4] !== '/') cur = node;
  }
  const words = (text.match(/[\p{L}\p{N}]+/gu) || []).length || 1;
  const has = (t) => all.filter((n) => n.tag === t || new RegExp(`\\brole\\s*=\\s*["']${{ main: 'main', nav: 'navigation', header: 'banner', footer: 'contentinfo' }[t]}["']`, 'i').test(n.attrs)).length;
  const mains = has('main'), navs = has('nav'), headers = has('header'), footers = has('footer');
  // wrapper chains: div/span holding exactly one element child and no text of its own, nested
  const isWrap = (n) => (n.tag === 'div' || n.tag === 'span') && n.kids.length === 1 && !n.text && (n.kids[0].tag === 'div' || n.kids[0].tag === 'span');
  let chains = 0, longest = 0;
  for (const n of all) { if (!isWrap(n) || (n.parent && isWrap(n.parent))) continue; let len = 1, k = n; while (isWrap(k)) { k = k.kids[0]; len++; } if (len >= 4) { chains++; longest = Math.max(longest, len); } }
  // text that sits loose in div/span instead of a text block (p, li, h*, a, button…)
  let loose = 0, held = 0;
  for (const n of [root, ...all]) { if (!n.text) continue; let a = n, sem = false; while (a && a.tag !== '#root') { if (TEXT_BLOCKS.has(a.tag)) { sem = true; break; } if (!['div', 'span', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav', 'font', 'center'].includes(a.tag)) { sem = true; break; } if (a.tag !== 'div' && a.tag !== 'span') break; a = a.parent; } if (sem) held += n.text; else loose += n.text; }
  const looseShare = loose / Math.max(1, loose + held);
  const classes = all.map((n) => (attr(n.attrs, 'class') || '').split(/\s+/).filter(Boolean).length); const avgClasses = classes.reduce((x, y) => x + y, 0) / Math.max(1, classes.length);
  const inlineStyles = all.filter((n) => attr(n.attrs, 'style')).length;
  const builder = (BUILDERS.find(([, re]) => re.test(clean)) || [])[0] || '';
  // accessibility, static
  const ids = new Map(); for (const n of all) { const id = attr(n.attrs, 'id'); if (id) ids.set(id, (ids.get(id) || 0) + 1); }
  const dupIds = [...ids.entries()].filter(([, c]) => c > 1).map(([id]) => id);
  const labelFor = new Set(all.filter((n) => n.tag === 'label').map((n) => attr(n.attrs, 'for')).filter(Boolean));
  const inLabel = (n) => { let a = n.parent; while (a) { if (a.tag === 'label') return true; a = a.parent; } return false; };
  const named = (n) => attr(n.attrs, 'aria-label') || attr(n.attrs, 'aria-labelledby') || attr(n.attrs, 'title');
  const fields = all.filter((n) => (n.tag === 'input' && !/^(hidden|submit|button|image|reset)$/i.test(attr(n.attrs, 'type') || '')) || n.tag === 'select' || n.tag === 'textarea');
  const unlabeled = fields.filter((n) => !named(n) && !(attr(n.attrs, 'id') && labelFor.has(attr(n.attrs, 'id'))) && !inLabel(n)).length;
  const textOf = (n) => n.text + n.kids.reduce((x, k) => x + textOf(k) + (k.tag === 'img' && attr(k.attrs, 'alt') ? 1 : 0), 0);
  const nameless = all.filter((n) => (n.tag === 'button' && !named(n) && !textOf(n)) || (n.tag === 'input' && /^(submit|button|reset)$/i.test(attr(n.attrs, 'type') || '') && !attr(n.attrs, 'value') && !named(n))).length;
  const posTab = all.filter((n) => Number(attr(n.attrs, 'tabindex')) > 0).length;
  const focusable = (n) => (n.tag === 'a' && attr(n.attrs, 'href') != null) || ['button', 'input', 'select', 'textarea'].includes(n.tag) || (attr(n.attrs, 'tabindex') != null && Number(attr(n.attrs, 'tabindex')) >= 0);
  const hiddenFocus = all.filter((n) => /aria-hidden\s*=\s*["']?true/i.test(n.attrs) && focusable(n)).length;
  const iframesNoTitle = all.filter((n) => n.tag === 'iframe' && !attr(n.attrs, 'title')).length;
  const autoplay = all.filter((n) => n.tag === 'video' && attr(n.attrs, 'autoplay') != null && attr(n.attrs, 'muted') == null).length;
  const badRoles = [...new Set(all.map((n) => (attr(n.attrs, 'role') || '').split(/\s+/)[0]).filter((r) => r && !ARIA_ROLES.has(r) && !/^(doc|graphics)-/.test(r)))];
  // controls crawlers cannot follow
  // navigation: <nav>/<header>/role=navigation, or what page builders call it in class and id (menu, nav, header)
  const inNav = (n) => { let a = n.parent; while (a) { if (a.tag === 'nav' || a.tag === 'header' || /role\s*=\s*["']navigation/i.test(a.attrs) || /\b(?:class|id)\s*=\s*["'][^"']*\b[\w-]*(?:menu|navbar|nav|header)[\w-]*\b/i.test(a.attrs)) return true; a = a.parent; } return false; };
  const fake = all.filter((n) => (!['a', 'button', 'input', 'select', 'textarea', 'summary', 'label', 'form', 'body'].includes(n.tag) && (/\bonclick\s*=/i.test(n.attrs) || /role\s*=\s*["']link/i.test(n.attrs))) || (n.tag === 'a' && (attr(n.attrs, 'href') == null || /^javascript:/i.test(attr(n.attrs, 'href') || '')) && (/\bonclick\s*=/i.test(n.attrs) || textOf(n))));
  const fakeNav = fake.filter(inNav).length;
  const skip = (() => { const a = all.find((n) => n.tag === 'a' && attr(n.attrs, 'href') != null); return !!a && /^#/.test(attr(a.attrs, 'href')); })();
  // score
  const pen = []; const P = (pts, why) => { if (pts > 0) pen.push([pts, why]); };
  if (!mains) P(10, 'no <main>'); else if (mains > 1) P(5, `${mains} <main>`);
  if (!navs && all.filter((n) => n.tag === 'a').length >= 5) P(5, 'no <nav>');
  P(Math.min(25, chains * 2) + (longest >= 8 ? 5 : 0), chains ? `${chains} wrapper chain${chains > 1 ? 's' : ''} (longest ${longest})` : '');
  const npw = all.length / words; P(npw > 10 ? 30 : npw > 6 ? 20 : npw > 3 ? 10 : 0, `${npw.toFixed(1)} nodes per word`);
  P(looseShare > 0.75 ? 15 : looseShare > 0.5 ? 10 : 0, `${Math.round(looseShare * 100)}% of the text loose in div/span`);
  P(inlineStyles > 50 ? 5 : 0, `${inlineStyles} inline styles`);
  P(avgClasses > 4 ? 5 : 0, `${avgClasses.toFixed(1)} classes per element`);
  P(Math.min(15, unlabeled * 5), unlabeled ? `${unlabeled} form field${unlabeled > 1 ? 's' : ''} without a label` : '');
  P(Math.min(10, nameless * 5), nameless ? `${nameless} button${nameless > 1 ? 's' : ''} without a name` : '');
  P(dupIds.length ? 5 : 0, `${dupIds.length} duplicate id${dupIds.length > 1 ? 's' : ''}`);
  P(posTab ? 5 : 0, `${posTab} tabindex > 0`);
  P(hiddenFocus ? 5 : 0, `${hiddenFocus} focusable element${hiddenFocus > 1 ? 's' : ''} inside aria-hidden`);
  P(iframesNoTitle ? 3 : 0, `${iframesNoTitle} iframe${iframesNoTitle > 1 ? 's' : ''} without title`);
  P(autoplay ? 3 : 0, `${autoplay} autoplaying video${autoplay > 1 ? 's' : ''} with sound`);
  P(badRoles.length ? 3 : 0, `invalid role${badRoles.length > 1 ? 's' : ''}: ${badRoles.slice(0, 3).join(', ')}`);
  P(Math.min(30, fake.length * 15), fake.length ? `${fake.length} click target${fake.length > 1 ? 's' : ''} that are not links${fakeNav ? ` (${fakeNav} in the navigation)` : ''}` : '');
  const score = Math.max(0, 100 - pen.reduce((x, [p]) => x + p, 0));
  const flag = fakeNav || score < 50 ? 'RED' : score < 80 ? 'YELLOW' : 'GREEN';
  pen.sort((a, b) => b[0] - a[0]);
  return { score, flag, reasons: pen.map(([, w]) => w), nodes: all.length, words, npw, chains, longest, looseShare, landmarks: { main: mains, nav: navs, header: headers, footer: footers }, skip, builder, fake: fake.length, fakeNav, a11y: { unlabeled, nameless, dupIds: dupIds.length, posTab, hiddenFocus, iframesNoTitle, autoplay, badRoles } };
}

// ───────────────────────────── shared page checks (Layers 1, 2, 4, 5) ─────────────────────────────
const ctx = { origin: '', https: true, mode: 'live', local: false, aliasOrigin: '', platform: '', redirectedFrom: '', productSite: '', kekkai: [], markup: [], builder: '', pages: [], titles: new Map(), descs: new Map(), slashPolicy: null, hrefs: new Set(), sitemapUrls: new Set(), internalLinked: new Set(), linkTargets: new Map(), externalOrigins: new Set(), preconnects: new Set() };
// ── platform detection: the fix for most findings lives in a settings screen, and the screen differs per platform
function detectPlatform(h) {
  const g = (h.generator || '').toLowerCase(); const hosts = [...h.assetHosts].join(' ');
  if (/wix/.test(g) || /parastorage|wixstatic/.test(hosts)) return 'Wix';
  if (/webflow/.test(g) || /website-files\.com/.test(hosts)) return 'Webflow';
  if (/wordpress/.test(g) || /wp-content/.test(hosts)) return 'WordPress';
  if (/squarespace/.test(g) || /squarespace-cdn/.test(hosts)) return 'Squarespace';
  if (/shopify/.test(g) || /cdn\.shopify/.test(hosts)) return 'Shopify';
  if (/framer/.test(g) || /framerusercontent/.test(hosts)) return 'Framer';
  if (/astro/.test(g) || /_astro/.test(hosts)) return 'Astro';
  if (/next\.js/.test(g) || /_next/.test(hosts)) return 'Next.js';
  if (/hugo|gatsby|jekyll|eleventy|nuxt|sveltekit/.test(g)) return g.match(/hugo|gatsby|jekyll|eleventy|nuxt|sveltekit/)[0].replace(/^./, (c) => c.toUpperCase());
  return '';
}
const HINTS = {
  Webflow: { canonical: 'Site settings → SEO → "Global canonical tag URL" emits it on every page', icons: 'Webflow serves favicon/webclip via <link> only; the blind /favicon.ico request 404s unless you add a redirect', og: 'Page settings → Open Graph; og:url is not emitted by default', lang: 'Site settings → General → Language', h1: 'a heading styled as H1 is still an H1 — restyle with a class, keep one H1 element per page' },
  Wix: { noindex: 'Pages → page → SEO basics → "Let search engines index this page"', description: 'Wix auto-fills the description from page text when the field is empty — write one', canonical: 'Site languages: the primary language should serve at the root and canonicalise to itself', 'h-first': 'theme text styles map to h6 for small text — change the text style, not the content', dom: 'Wix markup is deep by construction; nothing to fix here' },
  WordPress: { title: 'the SEO plugin title template appends the site name + tagline — shorten the template', h1: 'page builders split one headline into two heading blocks — make the second a paragraph', 'img-dim': 'the media library knows the dimensions; a lazy-load plugin or theme filter is stripping them' },
  Astro: { 'canonical-slash': 'astro.config: trailingSlash + build.format must agree with the host redirect', slash: 'astro.config: trailingSlash + build.format', 'sitemap-gap': '@astrojs/sitemap with i18n configured, or a custom endpoint that walks every locale' },
};
// entities that make the legal pages part of the product (terms, licence, privacy are what the user agrees to)
const PRODUCT_RE = /"@type"\s*:\s*(?:\[[^\]]*)?"(SoftwareApplication|MobileApplication|WebApplication|VideoGame|Product|Service|ProfessionalService|FinancialService|Course|Event|Store|OnlineStore|MedicalClinic|LegalService)"/;
// things senrigan sees but kekkai owns: noted once, with the command to run
const LEGAL_LINK = (t) => (/Service$/.test(t) ? 'termsOfService' : /Application$|VideoGame/.test(t) ? 'license' : '');
function legalLinkCheck(t, ldText) {
  const prop = LEGAL_LINK(t); if (!prop) return;
  section('Machine-readable & social');
  if (!new RegExp(`"${prop}"`).test(ldText)) warn('terms-link', `the ${t} entity has no ${prop} — its legal pages are not connected to it in the graph (schema.org: ${prop === 'license' ? 'license is how a CreativeWork such as software points at its terms / EULA' : 'termsOfService belongs to Service'})`);
  else pass('terms-link', `${t} entity links its ${prop}`);
}
const KEKKAI = (why) => { if (!ctx.kekkai.includes(why)) ctx.kekkai.push(why); };
const H = (id) => { const h = HINTS[ctx.platform]?.[id]; return h ? ` [${ctx.platform}: ${h}]` : ''; };
const abs = (href, base) => { try { return new URL(href, base).href; } catch { return null; } };
const isHttp = (u) => /^https?:\/\//i.test(u || '');
const sameHost = (u) => { try { const h = new URL(u).host; return h === new URL(ctx.origin).host || (ctx.aliasOrigin && h === new URL(ctx.aliasOrigin).host); } catch { return false; } };
// when scanning a local preview, absolute URLs that name the production host are fetched from the local server instead
const toLocal = (u) => (ctx.local && ctx.aliasOrigin && u.startsWith(ctx.aliasOrigin) ? ctx.origin + u.slice(ctx.aliasOrigin.length) : u);
// paths that are usually archives / utilities: a tag or category detail page, pagination, search, 404, version…
const INDEX_NOINDEX_RE = /\/(?:tags?|categories|category|author|authors|archive)\/[^/?#]+|\/page\/\d+|\/(?:search|404|version|changelog|preview|drafts?|thanks|thank-you|login|admin)(?:\/|$)|\?(?:s|q|page|p)=/i;
const UTILITY_RE = /\/(?:search|404|version|changelog|preview|drafts?|thanks|thank-you|login|admin)(?:\/|$)|\?(?:s|q|page|p)=/i;
const BAD_ANCHOR_RE = /^(?:click here|here|read more|more|learn more|link|this|κλικ(?: εδώ)?|εδώ|πατήστε εδώ|διαβάστε περισσότερα|περισσότερα|δείτε (?:εδώ|περισσότερα))\.?$/i;

function pageChecks(h, pageUrl, label) {
  const L = label ? `${label}: ` : '';
  section('Head & rendering');
  if (!h.lang) fail('lang', `${L}<html> has no lang attribute${H('lang')}`); else if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(h.lang)) warn('lang', `${L}lang="${h.lang}" is not a BCP 47 tag`); else pass('lang', `${L}lang="${h.lang}"`);
  if (!h.viewport) fail('viewport', `${L}no <meta name="viewport"> — mobile rendering and mobile-first indexing suffer`); else if (!/width=device-width/i.test(h.viewport)) warn('viewport', `${L}viewport "${h.viewport}" lacks width=device-width`); else if (/user-scalable=no|maximum-scale=1(?:\.0)?\b/i.test(h.viewport)) warn('viewport', `${L}viewport blocks zoom (${h.viewport}) — accessibility flag`); else pass('viewport', `${L}viewport ok`);
  // title
  if (h.title == null || !h.title) fail('title', `${L}no <title>`);
  else {
    const n = [...h.title].length;
    if (n > 60) warn('title', `${L}title is ${n} chars — likely truncated in results: "${h.title.slice(0, 70)}…"${H('title')}`);
    const greek = (h.title.match(/[\u0370-\u03ff]/g) || []).length, latin = (h.title.match(/[a-z]/gi) || []).length;
    if (h.lang && !/^el/i.test(h.lang) && greek > latin) warn('lang-script', `${L}<html lang="${h.lang}"> but the title is Greek — the page language is declared wrong, or the title was copied from the other language`); else if (n < 15) warn('title', `${L}title is only ${n} chars: "${h.title}"`); else pass('title', `${L}title ${n} chars: "${h.title}"`);
    const prev = ctx.titles.get(h.title); if (prev && prev !== pageUrl) warn('title-dup', `${L}title duplicates ${prev}`); else ctx.titles.set(h.title, pageUrl);
  }
  // description
  if (h.description == null || !h.description.trim()) warn('description', `${L}no meta description — snippet will be guessed from the page`);
  else {
    const n = [...h.description].length;
    if (n > 160) warn('description', `${L}description is ${n} chars — truncated around 155–160${H('description')}`); else if (n < 50) info('description', `${L}description is short (${n} chars)`); else pass('description', `${L}description ${n} chars`);
    const prev = ctx.descs.get(h.description); if (prev && prev !== pageUrl) warn('description-dup', `${L}description duplicates ${prev}`); else ctx.descs.set(h.description, pageUrl);
  }
  // canonical
  const here = pageUrl ? new URL(pageUrl) : null;
  const FILE_RE = /\.(?:jpe?g|png|gif|webp|avif|svg|pdf|mp4|webm|zip|css|js)(?:[?#]|$)/i;
  if (!h.canonical) fail('canonical', `${L}no rel="canonical"${H('canonical')}`);
  else if (FILE_RE.test(h.canonical)) fail('canonical-file', `${L}canonical points at a file, not a page: ${h.canonical.slice(0, 90)} — the SEO field holds an image/asset URL`);
  else if (!isHttp(h.canonical)) fail('canonical', `${L}canonical is relative (${h.canonical}) — must be absolute`);
  else if (!/^https:/i.test(h.canonical) && ctx.https && !ctx.local) fail('canonical', `${L}canonical uses http:// (${h.canonical})`);
  else if (ctx.origin && !sameHost(h.canonical)) warn('canonical', `${L}canonical points to another host: ${h.canonical}${H('canonical')}`);
  else if (here) {
    const c = new URL(h.canonical);
    if (ctx.mode === 'dist' && /\.html?$/i.test(c.pathname) && normPath(c.pathname.replace(/\.html?$/i, '')) === normPath(here.pathname)) warn('canonical-html', `${L}canonical ${c.pathname} keeps the .html extension — hosts with clean URLs (Cloudflare Pages, Netlify, Vercel) answer it with a redirect, which makes it a canonical that does not serve the page; verify with a live scan`);
    else if (normPath(c.pathname) !== normPath(here.pathname)) warn('canonical', `${L}canonical ${c.pathname} is not self-referencing (page is ${here.pathname}) — fine only if this page is a deliberate duplicate`);
    else if (c.pathname !== here.pathname && ctx.redirectedFrom && new URL(ctx.redirectedFrom).pathname === c.pathname) fail('canonical-redirect', `${L}canonical ${c.pathname} is a URL that redirects to this page (${here.pathname}) — the page declares as canonical an address that does not serve it${H('canonical-slash')}`);
    else if (c.pathname !== here.pathname) warn('canonical-slash', `${L}canonical ${c.pathname} differs from the served path ${here.pathname} by a trailing slash — pick one policy and redirect the other${H('canonical-slash')}`);
    else if (c.search) warn('canonical', `${L}canonical carries a query string (${c.search})`);
    else pass('canonical', `${L}canonical self-referencing`);
    if (ctx.slashPolicy == null && c.pathname !== '/') ctx.slashPolicy = c.pathname.endsWith('/');
  } else pass('canonical', `${L}canonical absolute: ${h.canonical}`);
  // indexing matrix
  const noindex = /noindex/.test(h.robotsMeta || '');
  const path = here ? here.pathname : '';
  const full = path + (here ? here.search : '');
  const looksArchive = INDEX_NOINDEX_RE.test(full), utility = UTILITY_RE.test(full);
  const inSitemap = here && ctx.sitemapUrls.size ? ctx.sitemapUrls.has(normKey(here.href)) : null;
  if (noindex && inSitemap) fail('noindex', `${L}robots meta noindex (${h.robotsMeta}) yet the page is listed in the sitemap — one of the two is wrong`);
  else if (noindex && !looksArchive) warn('noindex', `${L}noindex on what looks like a content page (${h.robotsMeta}) — fine only if deliberate${H('noindex')}`);
  else if (noindex) info('noindex', `${L}noindex (expected for this path)`);
  else if (utility) warn('noindex', `${L}utility page (search / version / 404 …) is indexable — add noindex,follow`);
  else if (looksArchive && !h.description) warn('noindex', `${L}tag / archive page indexable without its own description — either give it unique copy or noindex,follow`);
  else if (looksArchive) info('noindex', `${L}archive page indexed with its own description — keep its copy unique`);
  else pass('noindex', `${L}indexable`);
  if (/nofollow/.test(h.robotsMeta || '') && !noindex) warn('nofollow-meta', `${L}robots meta nofollow — no link equity flows out of this page`);
  // hreflang
  if (h.hreflang.length) {
    const bad = h.hreflang.filter((x) => !/^(x-default|[a-z]{2,3}(-[A-Za-z]{2}|-[A-Za-z]{4})?)$/i.test(x.lang || ''));
    if (bad.length) fail('hreflang', `${L}hreflang with invalid code(s): ${bad.map((b) => b.lang).join(', ')}`);
    const rel = h.hreflang.filter((x) => !isHttp(x.href)); if (rel.length) fail('hreflang', `${L}hreflang href must be absolute: ${rel.map((r) => r.href).join(', ')}`);
    const files = h.hreflang.filter((x) => FILE_RE.test(x.href || '')); if (files.length) fail('hreflang-file', `${L}hreflang points at a file: ${files[0].href.slice(0, 80)} — the alternate-language field holds an asset URL`);
    if (!h.hreflang.some((x) => /^x-default$/i.test(x.lang))) warn('hreflang', `${L}no hreflang="x-default"`);
    const self = here && h.hreflang.find((x) => abs(x.href, pageUrl) && normPath(new URL(abs(x.href, pageUrl)).pathname) === normPath(here.pathname));
    if (here && !self) warn('hreflang', `${L}hreflang set does not include this page itself — every page in the set must list itself`);
    else if (self && h.lang && !/^x-default$/i.test(self.lang) && self.lang.split('-')[0].toLowerCase() !== h.lang.split('-')[0].toLowerCase()) warn('hreflang', `${L}<html lang="${h.lang}"> but this page's hreflang entry says ${self.lang}`);
    if (!bad.length && !rel.length) pass('hreflang', `${L}hreflang ${h.hreflang.length} entries (${h.hreflang.map((x) => x.lang).join(', ')})`);
    for (const x of h.hreflang) { const u = abs(x.href, pageUrl); if (u && pageUrl && !FILE_RE.test(u) && normKey(u) !== normKey(pageUrl)) ctx.hrefs.add(JSON.stringify({ from: pageUrl, to: u, lang: x.lang })); }
  }
  // resource hints
  for (const u of [...h.scriptSrcs, ...h.styleHrefs]) { if (isHttp(u) && !sameHost(u)) ctx.externalOrigins.add(new URL(u).origin); }
  for (const l of h.links) { if (l.rel.includes('preconnect') || l.rel.includes('dns-prefetch')) { const u = abs(l.href, pageUrl || ctx.origin || 'https://x/'); if (u) ctx.preconnects.add(new URL(u).origin); } }
  if (h.nextPrev.next || h.nextPrev.prev) info('next-prev', `${L}rel=next/prev present — harmless; Google has ignored them since 2019, Bing still reads them`);
  if (h.generator && !ctx.platform) info('generator', `${L}<meta name="generator"> "${h.generator}" — not an SEO issue (kekkai cares)`);

  section('Structure');
  const hs = h.headings;
  const h1s = hs.filter((x) => x.level === 1);
  if (h1s.length === 0) fail('h1', `${L}no <h1>`); else if (h1s.length > 1) fail('h1', `${L}${h1s.length} <h1> elements: ${h1s.map((x) => `"${x.text.slice(0, 40)}"${x.role ? ' (role="heading" aria-level="1")' : ''}`).join(', ')}${h1s.some((x) => x.role) ? ' — an ARIA heading is still a heading; two languages on one page need two routes with hreflang' : ''}${H('h1')}`);
  else if ([...h1s[0].text].length > 120 || ([...h1s[0].text].length > 70 && /[.;!?]$/.test(h1s[0].text))) warn('h1-body', `${L}the <h1> is a sentence, not a title (${[...h1s[0].text].length} chars: "${h1s[0].text.slice(0, 60)}…") — the first paragraph was put in the heading; the name of the thing belongs there`);
  else pass('h1', `${L}one <h1>: "${h1s[0].text.slice(0, 70)}"`);
  const empties = hs.filter((x) => !x.text); if (empties.length) fail('h-empty', `${L}${empties.length} empty heading tag(s) (h${empties.map((e) => e.level).join(', h')})`);
  const firstSub = hs.find((x) => x.level > 1); if (firstSub && firstSub.level !== 2) warn('h-first', `${L}first sub-heading is <h${firstSub.level}> ("${firstSub.text.slice(0, 40)}") — should be <h2>${H('h-first')}`);
  const jumps = []; for (let i = 1; i < hs.length; i++) if (hs[i].level > hs[i - 1].level + 1) jumps.push(`h${hs[i - 1].level}→h${hs[i].level} ("${hs[i].text.slice(0, 30)}")`);
  if (jumps.length) warn('h-jump', `${L}${jumps.length} heading level jump(s): ${jumps.slice(0, 3).join('; ')}`); else if (hs.length > 1 && !firstSub?.level !== 2) pass('h-order', `${L}heading levels descend without jumps (${hs.length} headings)`);
  if (h1s.length === 1 && hs[0].level !== 1) info('h1-first', `${L}the <h1> is not the first heading in the document (comes after an h${hs[0].level})`);
  // DOM shape — performance, informational for the verdict
  if (h.nodes > 1500 || h.depth > 32) warn('dom', `${L}DOM ${h.nodes} nodes, depth ${h.depth} — Lighthouse flags >1500 nodes / >32 deep (bloat, not a ranking factor by itself)${H('dom')}`); else info('dom', `${L}DOM ${h.nodes} nodes, depth ${h.depth}`);
  // images
  const imgs = h.images;
  if (imgs.length) {
    const noAlt = imgs.filter((i) => i.alt == null); if (noAlt.length) fail('img-alt', `${L}${noAlt.length}/${imgs.length} <img> without alt (decorative images need alt="")`, noAlt.slice(0, 4).map((i) => i.src).join('\n'));
    else pass('img-alt', `${L}all ${imgs.length} <img> carry alt`);
    const noDim = imgs.filter((i) => !i.width || !i.height); if (noDim.length) warn('img-dim', `${L}${noDim.length}/${imgs.length} <img> without width+height — layout shift (CLS)${H('img-dim')}`);
    const eager = imgs.filter((i) => i.loading !== 'lazy' && i.fetchpriority !== 'high'); if (imgs.length > 2 && eager.length > 2) info('img-lazy', `${L}${eager.length}/${imgs.length} <img> without loading="lazy" (keep the hero eager, lazy-load the rest)`);
    const noDec = imgs.filter((i) => i.decoding !== 'async'); if (noDec.length) info('img-decoding', `${L}${noDec.length}/${imgs.length} <img> without decoding="async"`);
  } else info('img', `${L}no <img> in the body`);
  // links: policy, anchors, rel, mixed content — collected for Layer 3
  const base = pageUrl || ctx.origin || 'https://x/';
  let internal = 0, slashMis = 0, nofollowInternal = 0, blankNoOpener = 0, badAnchor = [], mixedSrc = 0, mixedHref = 0, emptyAnchor = 0;
  for (const a of h.anchors) {
    if (!a.href || /^(#|mailto:|tel:|javascript:)/i.test(a.href)) continue;
    const u = abs(a.href, base); if (!u) continue;
    if (/^\/cdn-cgi\//.test(new URL(u).pathname)) { ctx.edgeLinks = (ctx.edgeLinks || 0) + 1; continue; } // Cloudflare edge paths (email obfuscation rewrites mailto: links) — not site links
    const isInt = ctx.mode === 'dist' ? !isHttp(a.href) || sameHost(u) : sameHost(u);
    if (isInt) {
      internal++; const key = normKey(u); ctx.internalLinked.add(key); if (!ctx.linkTargets.has(key)) ctx.linkTargets.set(key, u.split('#')[0]);
      const p = new URL(u).pathname;
      if (ctx.slashPolicy != null && p !== '/' && !/\.[a-z0-9]{2,5}$/i.test(p) && p.endsWith('/') !== ctx.slashPolicy) slashMis++;
      if (/\bnofollow\b/.test(a.rel)) nofollowInternal++;
    } else {
      if (a.target === '_blank' && !/\bnoopener\b/.test(a.rel) && !/\bnoreferrer\b/.test(a.rel)) blankNoOpener++;
      if (/^http:\/\//i.test(u) && ctx.https) mixedHref++;
    }
    if (!a.text) { if (!a.hasImg) emptyAnchor++; } else if (BAD_ANCHOR_RE.test(a.text)) badAnchor.push(a.text);
  }
  for (const i of h.images) if (/^http:\/\//i.test(i.src)) mixedSrc++;
  for (const s of [...h.scriptSrcs, ...h.styleHrefs]) if (/^http:\/\//i.test(s || '')) mixedSrc++;
  ctx.pages.push({ url: pageUrl, label, internal, slashMis, nofollowInternal, blankNoOpener, badAnchor, mixedSrc, mixedHref, emptyAnchor, h });

  section('Machine-readable & social');
  if (h.jsonldErrors.length) fail('jsonld-syntax', `${L}JSON-LD does not parse: ${h.jsonldErrors[0]}`);
  const nodesLd = []; const push = (n) => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(push); if (n['@graph']) push(n['@graph']); if (n['@type']) nodesLd.push(n); };
  h.jsonld.forEach(push);
  const LEGAL_RE = /\/(?:privacy|terms|legal|cookies?|accessibility|imprint|impressum|gdpr|politiki|oroi|aporrit|prosvasim)[^/]*(?:\/|$)/i;
  const BLOG_RE = /\/(?:blog|posts?|news|articles?|journal|stories|arthra|nea)\/[^/?#]+/i;
  const ldTypesStr = JSON.stringify(h.jsonld);
  const legal = LEGAL_RE.test(path);
  if (!h.jsonld.length && !h.jsonldErrors.length) {
    if (legal && ctx.productSite) warn('jsonld-legal', `${L}legal page without JSON-LD on a ${ctx.productSite} site — the terms and the privacy policy are part of what the ${ctx.productSite} offers: give the page a WebPage node (isPartOf the WebSite, about the ${ctx.productSite})${LEGAL_LINK(ctx.productSite) ? ` and point the ${ctx.productSite} at it with ${LEGAL_LINK(ctx.productSite)}` : ''}`);
    else if (legal) info('jsonld', `${L}no JSON-LD (legal page of a non-product site)`);
    else warn('jsonld', `${L}no JSON-LD — no rich results, no entity for the knowledge graph`);
  }
  else if (nodesLd.length) {
    if ((BLOG_RE.test(path) || (h.articleTag && h.times.length)) && !/"(?:CollectionPage|ItemList|SearchResultsPage)"/.test(ldTypesStr) && !/"(?:Article|BlogPosting|NewsArticle|TechArticle|ScholarlyArticle)"/.test(ldTypesStr)) warn('jsonld-article', `${L}looks like an article (${BLOG_RE.test(path) ? 'blog path' : '<article> + <time>'}) but the JSON-LD has no Article/BlogPosting — no article rich results, no Discover`);
    const types = nodesLd.map((n) => [].concat(n['@type']).join('/'));
    const noCtx = h.jsonld.filter((b) => !b['@context']); if (noCtx.length) fail('jsonld-context', `${L}JSON-LD block without @context`);
    pass('jsonld', `${L}JSON-LD types: ${[...new Set(types)].join(', ')}`);
    const REQ = { Article: ['headline', 'datePublished', 'author'], BlogPosting: ['headline', 'datePublished', 'author'], NewsArticle: ['headline', 'datePublished', 'author'], Organization: ['name', 'url'], Person: ['name'], WebSite: ['name', 'url'], WebPage: ['name'], BreadcrumbList: ['itemListElement'], Product: ['name', 'image'], FAQPage: ['mainEntity'], Event: ['name', 'startDate', 'location'] };
    const h1 = h1s[0]?.text;
    for (const n of nodesLd) {
      for (const t of [].concat(n['@type'])) {
        const req = REQ[t]; if (!req) continue;
        const miss = req.filter((k) => n[k] == null || n[k] === ''); if (miss.length) warn('jsonld-fields', `${L}${t} is missing ${miss.join(', ')}`);
        if (/Article|BlogPosting/.test(t)) {
          if (!n.image) warn('jsonld-image', `${L}${t} without image — Discover / rich results want one`);
          if (n.headline && h1 && norm(n.headline) !== norm(h1) && !norm(h1).includes(norm(n.headline)) && !norm(n.headline).includes(norm(h1))) warn('jsonld-h1', `${L}${t}.headline "${String(n.headline).slice(0, 50)}" ≠ visible <h1> "${h1.slice(0, 50)}" — structured data must describe the visible page`);
          if (n.headline && [...String(n.headline)].length > 110) info('jsonld-headline', `${L}${t}.headline is ${[...String(n.headline)].length} chars (Google truncates around 110)`);
          if (n.datePublished) { const d = String(n.datePublished).slice(0, 10); if (isNaN(Date.parse(n.datePublished))) warn('jsonld-date', `${L}datePublished "${n.datePublished}" is not ISO 8601`); else if (h.times.length && !h.times.some((t2) => t2.slice(0, 10) === d)) info('jsonld-date', `${L}datePublished ${d} does not match any visible <time datetime> (${h.times.slice(0, 2).join(', ')})`); }
          if (n.dateModified && n.datePublished && Date.parse(n.dateModified) < Date.parse(n.datePublished)) warn('jsonld-date', `${L}dateModified is earlier than datePublished`);
        }
        if (t === 'BreadcrumbList' && Array.isArray(n.itemListElement)) {
          const items = n.itemListElement; const bad = items.filter((it, i) => it.position !== i + 1 || !it.name || (!it.item && i < items.length - 1));
          if (bad.length) warn('breadcrumb', `${L}BreadcrumbList: ${bad.length} item(s) with wrong position, no name or no item URL`); else pass('breadcrumb', `${L}BreadcrumbList ${items.length} items`);
        }
      }
    }
  }
  // Open Graph / Twitter
  const og = h.og; const need = ['og:title', 'og:description', 'og:image', 'og:url'];
  const missOg = need.filter((k) => !og[k]);
  if (missOg.length === need.length) warn('og', `${L}no Open Graph tags — shares fall back to whatever the platform scrapes${H('og')}`);
  else if (missOg.length) warn('og', `${L}Open Graph missing ${missOg.join(', ')}${H('og')}`);
  else {
    pass('og', `${L}og:title / description / image / url present${og['og:type'] ? ` (type ${og['og:type']})` : ''}`);
    if (!isHttp(og['og:image'])) fail('og-image', `${L}og:image must be an absolute URL (${og['og:image']})`); else if (/^http:/i.test(og['og:image'])) warn('og-image', `${L}og:image is http:// — many scrapers refuse it`);
    if (h.canonical && og['og:url'] && normPath(og['og:url']) !== normPath(h.canonical)) warn('og-url', `${L}og:url (${og['og:url']}) ≠ canonical (${h.canonical})`);
    if (!og['og:type']) info('og-type', `${L}no og:type (website / article)`);
    if (!og['og:image:alt'] && !h.twitter['twitter:image:alt']) info('og-image-alt', `${L}no og:image:alt / twitter:image:alt`);
  }
  if (!h.twitter['twitter:card']) info('twitter', `${L}no twitter:card (X falls back to a small summary card)`); else if (h.twitter['twitter:card'] === 'summary_large_image' && !(h.twitter['twitter:image'] || og['og:image'])) warn('twitter', `${L}twitter:card=summary_large_image without an image`);

  if (opt.semantic) semantic(h, L);
  markupChecks(h, L);
}
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// ───────────────────────────── Layer 6 report ─────────────────────────────
const FLAG_ICON = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴' };
function markupChecks(h, L) {
  const m = h.markup; if (!m) return;
  section('Markup & accessibility');
  ctx.markup.push({ page: L.replace(/: $/, '') || '/', ...m });
  if (m.builder && !ctx.builder) ctx.builder = m.builder;
  const msg = `${L}${m.flag} ${m.score}${m.reasons.length ? ` — ${m.reasons.slice(0, 3).join(', ')}` : ''}${m.builder ? ` [${m.builder}]` : ''}`;
  const detail = [`nodes ${m.nodes}, words ${m.words}, ${m.npw.toFixed(1)} nodes/word, wrapper chains ${m.chains} (longest ${m.longest}), ${Math.round(m.looseShare * 100)}% loose text`, `landmarks: main ${m.landmarks.main}, nav ${m.landmarks.nav}, header ${m.landmarks.header}, footer ${m.landmarks.footer}${m.skip ? ', skip link' : ''}`, ...m.reasons.slice(3).map((r) => `also: ${r}`)].join('\n');
  results.push({ section: cur.section, level: m.flag === 'GREEN' ? 'pass' : 'warn', id: 'markup', msg, detail: m.flag === 'GREEN' ? undefined : detail, flag: m.flag, score: m.score });
  if (m.fakeNav) fail('fake-link', `${L}${m.fakeNav} navigation item(s) are click handlers, not links — crawlers cannot follow them; the pages behind them are reachable only through the sitemap`);
}

// ───────────────────────────── Layer 5: semantic (opt-in) ─────────────────────────────
const STOP = new Set(('a an the and or but of to in on at for with by from as is are was were be been it its this that these those not no you your we our they their he she his her i me my us them what which who how when where why all any can will just do does did so than then there here also more most very into over about up out if only own same such too s t can com www http https ' +
  'και να το η ο οι τα του της των τον την στο στη στην στον στις στους σε με για από ως που πως πώς ότι δεν μη μην θα αν είναι ήταν έχει έχουν ένα μια μία ένας αυτό αυτή αυτά αυτός αυτοί εγώ εσύ εμείς εσείς τους τις μας σας μου σου κάτι κάθε πιο πολύ όλα όλοι όπως αλλά όμως γιατί ενώ μετά πριν πάνω κάτω εδώ εκεί τώρα ήδη ακόμα μόνο ή είτε ούτε δηλαδή λοιπόν επίσης ' +
  'min read λεπτά ανάγνωση ανάγνωσης').split(/\s+/).map((w) => w.normalize('NFD').replace(/[̀-ͯ]/g, '')));
const stemEl = (w) => w.length > 5 ? w.replace(/(ματος|ματα|ουσα|ουσε|ηκαν|ησαν|οντας|ωντας|ομαι|εσαι|εται|ουμε|ετε|ουν|ους|ιας|ιες|εις|ηση|εια|ικο|ικη|ικα|ωση|ας|ες|ος|ου|ων|ης|ης|ει|οι|α|η|ο|ι|ε)$/, '') : w;
const stemEn = (w) => w.length > 5 ? w.replace(/(ations?|ingly|ness|ments?|ings?|edly|ies|ers?|ed|ly|es|s)$/, '') : w;
const tokens = (s) => norm(s).split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)).map((w) => (/[Ͱ-Ͽ]/.test(w) ? stemEl(w) : stemEn(w)));
function semantic(h, L) {
  section('Semantic (--semantic)');
  const ldTypes = JSON.stringify(h.jsonld);
  if (/"CollectionPage"|"ItemList"|"SearchResultsPage"/.test(ldTypes) && !/"Article"|"BlogPosting"|"NewsArticle"/.test(ldTypes)) { info('semantic', `${L}listing page (CollectionPage / ItemList) — keyword analysis skipped, card text would dominate`); return; }
  const tks = tokens(h.mainText); if (tks.length < 80) { info('semantic', `${L}only ${tks.length} content tokens — too thin for keyword analysis`); return; }
  const freq = new Map(); for (const t of tks) freq.set(t, (freq.get(t) || 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const titleT = new Set(tokens(h.title || '')); const h1T = new Set(tokens(h.headings.find((x) => x.level === 1)?.text || ''));
  const hit = top.filter(([t]) => titleT.has(t) || [...titleT].some((x) => x.startsWith(t) || t.startsWith(x))).length;
  const hitH1 = top.filter(([t]) => h1T.has(t)).length;
  const msg = `${L}top terms: ${top.map(([t, n]) => `${t}(${n})`).join(' ')} — ${hit}/5 echoed in the title, ${hitH1}/5 in the h1`;
  if (hit === 0 && hitH1 === 0) warn('intent', `${msg} → possible intent mismatch: the title promises something the text is not about`); else info('intent', msg);
  if (!h.hasMain) info('main', `${L}no <main>/<article> — the whole body was used as content (navigation words may dominate)`);
}

// ───────────────────────────── live mode ─────────────────────────────
const UA = 'senrigan/0.4.0 (+static site visibility check; read-only)';
async function get(url, { redirect = 'manual', method = 'GET' } = {}) {
  url = toLocal(url);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { method, redirect, headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'en,el;q=0.8' }, signal: ctl.signal });
    const buf = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await r.arrayBuffer());
    return { status: r.status, headers: lower(Object.fromEntries(r.headers.entries())), text: buf.toString('utf8'), url, bytes: buf.length };
  } catch (e) { return { status: 0, headers: {}, text: '', url, error: e.cause?.code || e.name || String(e) }; }
  finally { clearTimeout(t); }
}
async function follow(url, max = 6) {
  const chain = []; let r;
  for (let i = 0; i < max; i++) { r = await get(url); chain.push({ url, status: r.status, location: r.headers.location }); if (r.status >= 300 && r.status < 400 && r.headers.location) { url = new URL(r.headers.location, url).href; continue; } break; }
  return { final: r, chain };
}
// HEAD with GET fallback (some edges answer 405 to HEAD)
async function status(url) { let r = await get(url, { method: 'HEAD' }); if (r.status === 405 || r.status === 0) r = await get(url); return r; }
const soft404 = (r) => r.status === 200 && /<title[^>]*>[^<]*(not found|404|δεν βρέθηκε)/i.test(r.text);

function parseRobots(txt) {
  const groups = []; let g = null;
  for (let line of txt.split(/\r?\n/)) {
    line = line.replace(/#.*$/, '').trim(); if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!g || g.rules.length) { g = { agents: [], rules: [] }; groups.push(g); } g.agents.push(v.toLowerCase()); }
    else if ((k === 'allow' || k === 'disallow') && g) g.rules.push({ allow: k === 'allow', path: v });
    else if (k === 'sitemap') groups.sitemaps = [...(groups.sitemaps || []), v];
  }
  return groups;
}
const robotsMatch = (rule, path) => { const re = new RegExp('^' + rule.path.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\$$/, '$')); return re.test(path); };
function robotsAllows(groups, path, agent = 'googlebot') {
  const named = groups.filter((x) => x.agents.includes(agent)); const gs = named.length ? named : groups.filter((x) => x.agents.includes('*')); if (!gs.length) return true;
  let best = null; for (const r of gs.flatMap((x) => x.rules)) { if (!r.path) continue; if (robotsMatch(r, path)) { if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r; } }
  return best ? best.allow : true;
}
async function loadSitemap(url, depth = 0, seen = new Set()) {
  if (seen.has(url) || depth > 2) return { urls: [], errors: [] }; seen.add(url);
  const r = await get(url); if (r.status !== 200) return { urls: [], errors: [`${url} → ${r.status || r.error}`] };
  const urls = [], errors = [];
  if (/<sitemapindex/i.test(r.text)) { for (const m of r.text.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/gi)) { const sub = await loadSitemap(decode(m[1]), depth + 1, seen); urls.push(...sub.urls); errors.push(...sub.errors); } }
  else for (const m of r.text.matchAll(/<url>([\s\S]*?)<\/url>/gi)) { const loc = m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/i)?.[1]; const lastmod = m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i)?.[1]; const alts = [...m[1].matchAll(/<xhtml:link[^>]*hreflang\s*=\s*"([^"]+)"[^>]*href\s*=\s*"([^"]+)"/gi)].map((a) => ({ lang: a[1], href: decode(a[2]) })); if (loc) urls.push({ loc: decode(loc), lastmod, alts, from: url }); }
  return { urls, errors };
}

async function liveScan(input) {
  const u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  section('Reach');
  const { final: doc, chain } = await follow(u.href);
  if (doc.status === 0) { fail('fetch', `cannot fetch ${u.href}: ${doc.error}`); return; }
  if (chain.length > 1) info('redirects', `redirect chain: ${chain.map((c) => `${c.status} ${c.url}`).join(' → ')} → ${doc.status}`);
  if (doc.status !== 200) { fail('status', `${u.href} answered ${doc.status}`); return; }
  const finalUrl = new URL(doc.url); ctx.origin = finalUrl.origin; ctx.https = finalUrl.protocol === 'https:'; ctx.mode = 'live';
  pass('status', `${finalUrl.href} 200 (${doc.bytes} bytes)`);
  if (doc.bytes > 1_500_000) warn('html-size', `home HTML is ${(doc.bytes / 1e6).toFixed(1)} MB — crawlers truncate very large documents and render budgets suffer; inline SVGs, inline CSS/JS or embedded data are the usual cause`);
  else if (doc.bytes > 500_000) info('html-size', `home HTML is ${Math.round(doc.bytes / 1024)} KB — on the heavy side for a static page`);
  const ct = doc.headers['content-type'] || ''; if (!/text\/html/i.test(ct)) warn('content-type', `document Content-Type is "${ct}"`); if (!/charset=/i.test(ct) && !/<meta[^>]+charset/i.test(doc.text)) warn('charset', 'no charset in Content-Type nor <meta charset>');
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/.test(finalUrl.hostname);
  if (local) { const canon = doc.text.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']*)["']/i)?.[1] || doc.text.match(/<link[^>]+href\s*=\s*["']([^"']*)["'][^>]*rel\s*=\s*["']canonical["']/i)?.[1]; if (canon && isHttp(canon) && !/\.(?:jpe?g|png|gif|webp|svg|pdf)(?:[?#]|$)/i.test(canon)) ctx.aliasOrigin = new URL(canon).origin; ctx.local = true; info('local', `local address — host checks (https, www alias) skipped${ctx.aliasOrigin ? `; absolute URLs on ${new URL(ctx.aliasOrigin).host} are fetched from here` : ''}`); ctx.https = true; }
  else {
    if (!ctx.https) { warn('https', 'site served over http:// — https is a ranking signal and a prerequisite for most features'); KEKKAI('transport: the site is not on https'); }
    const other = finalUrl.hostname.startsWith('www.') ? finalUrl.hostname.slice(4) : `www.${finalUrl.hostname}`;
    const o = await get(`https://${other}/`);
    if (o.status === 200) { warn('alias', `https://${other}/ also serves 200 — two hosts, one content; 301 one to the other (canonicals alone are a hint, not a rule)`); KEKKAI('transport: two hosts answer 200 — the redirect and HSTS are kekkai territory'); }
    else if (o.status >= 300 && o.status < 400) pass('alias', `${other} → ${o.status} → ${o.headers.location || '?'}`);
    if (!finalUrl.hostname.startsWith('www.') && finalUrl.hostname.split('.').length === 2) { info('apex-primary', `the primary host is the apex (${finalUrl.hostname}) — neutral for search, but www gives cookie isolation from subdomains and a plain CNAME for any CDN`); KEKKAI(`infrastructure: the apex ${finalUrl.hostname} is the primary host`); }
    else info('alias', `https://${other}/ answers ${o.status || o.error}`);
  }
  const xr = doc.headers['x-robots-tag']; if (xr && /noindex/i.test(xr)) fail('x-robots', `X-Robots-Tag: ${xr} on the home page`); else if (xr) info('x-robots', `X-Robots-Tag: ${xr}`);

  // Layer 0
  section('Root assets');
  const rob = await get(`${ctx.origin}/robots.txt`);
  let groups = [];
  if (rob.status !== 200) warn('robots', `robots.txt answers ${rob.status || rob.error} — crawlers assume "allow all", but a 5xx makes Google stop crawling entirely`);
  else {
    groups = parseRobots(rob.text);
    if (!groups.length) warn('robots', 'robots.txt has no User-agent group');
    else {
      const starGroups = groups.filter((g) => g.agents.includes('*')); const starRules = starGroups.flatMap((g) => g.rules);
      if (starRules.some((r) => !r.allow && r.path === '/') && !starRules.some((r) => r.allow && r.path === '/')) fail('robots', `robots.txt: "Disallow: /" for all agents — the whole site is blocked from crawling (group: ${starGroups.map((g) => g.agents.join(', ')).join(' | ')})`);
      pass('robots', `robots.txt: ${groups.length} group(s), ${groups.reduce((n, g) => n + g.rules.length, 0)} rule(s)${groups.sitemaps ? `, ${groups.sitemaps.length} Sitemap line(s)` : ''}`);
      if (!groups.sitemaps) warn('robots-sitemap', 'robots.txt has no "Sitemap:" line — add the absolute sitemap URL');
      const aiBlocked = groups.filter((g) => !g.agents.includes('*') && g.rules.some((r) => !r.allow && r.path === '/')).flatMap((g) => g.agents);
      if (aiBlocked.length) info('robots-ai', `${aiBlocked.length} named agent(s) fully blocked: ${aiBlocked.join(', ')} (a decision, not a finding)`);
    }
  }
  const smUrls = (groups.sitemaps || []).map((s) => abs(s, ctx.origin)).filter(Boolean); if (!smUrls.length) smUrls.push(`${ctx.origin}/sitemap-index.xml`, `${ctx.origin}/sitemap.xml`);
  let sitemap = { urls: [], errors: [] }; const smUsedList = []; const seenLoc = new Set();
  const declared = (groups.sitemaps || []).length > 0;
  for (const s of smUrls) { const r = await loadSitemap(s); if (r.urls.length) { smUsedList.push(s); for (const u of r.urls) if (!seenLoc.has(u.loc)) { seenLoc.add(u.loc); sitemap.urls.push(u); } if (!declared) break; } else sitemap.errors.push(...r.errors); }
  if (!sitemap.urls.length) fail('sitemap', `no usable sitemap (${sitemap.errors.slice(0, 2).join('; ') || 'empty'})`);
  else {
    pass('sitemap', `sitemap${smUsedList.length > 1 ? 's' : ''} ${smUsedList.map((u) => new URL(u).pathname).join(' + ')}: ${sitemap.urls.length} URLs`);
    const foreign = sitemap.urls.filter((x) => !sameHost(x.loc)); if (foreign.length) fail('sitemap-host', `${foreign.length} sitemap URL(s) on another host, e.g. ${foreign[0].loc} — Google ignores them`);
    const httpUrls = sitemap.urls.filter((x) => /^http:/i.test(x.loc)); if (httpUrls.length && ctx.https && !ctx.local) warn('sitemap-scheme', `${httpUrls.length} sitemap URL(s) use http://`);
    const badMod = sitemap.urls.filter((x) => x.lastmod && isNaN(Date.parse(x.lastmod))); if (badMod.length) warn('sitemap-lastmod', `${badMod.length} invalid <lastmod> value(s), e.g. "${badMod[0].lastmod}"`);
    const noMod = sitemap.urls.filter((x) => !x.lastmod); if (noMod.length === sitemap.urls.length) info('sitemap-lastmod', 'no <lastmod> anywhere — Google uses it when it is accurate; omit rather than fake');
    const future = sitemap.urls.filter((x) => x.lastmod && Date.parse(x.lastmod) > Date.now() + 864e5); if (future.length) warn('sitemap-lastmod', `${future.length} <lastmod> in the future`);
    const sameMod = new Set(sitemap.urls.map((x) => x.lastmod).filter(Boolean)); if (sitemap.urls.length > 5 && sameMod.size === 1) warn('sitemap-lastmod', `every URL has the same <lastmod> (${[...sameMod][0]}) — a build timestamp, not a content date; Google learns to ignore it`);
    const blocked = sitemap.urls.filter((x) => !robotsAllows(groups, new URL(x.loc).pathname)); if (blocked.length) fail('sitemap-robots', `${blocked.length} sitemap URL(s) are blocked by robots.txt, e.g. ${blocked[0].loc}`);
    const slashes = sitemap.urls.map((x) => new URL(x.loc).pathname).filter((p) => p !== '/' && !/\.[a-z0-9]{2,5}$/i.test(p)); const withSlash = slashes.filter((p) => p.endsWith('/')).length;
    if (slashes.length && withSlash && withSlash !== slashes.length) warn('sitemap-slash', `sitemap mixes trailing-slash styles (${withSlash} with, ${slashes.length - withSlash} without)`);
    for (const x of sitemap.urls) ctx.sitemapUrls.add(normKey(x.loc));
  }
  if (opt.probe) {
    const favs = ['/favicon.ico', '/apple-touch-icon.png'];
    const htmlHead = inspect(doc.text);
    const iconLinks = htmlHead.links.filter((l) => l.rel.some((r) => /icon/.test(r)));
    for (const l of iconLinks) { const iu = abs(l.href, doc.url); if (iu && sameHost(iu)) favs.push(new URL(iu).pathname); }
    const seenF = new Set(); const missing = [];
    for (const p of favs) { if (seenF.has(p)) continue; seenF.add(p); const r = await status(ctx.origin + p); if (r.status !== 200) missing.push(`${p} → ${r.status || r.error}`); }
    if (missing.length) { const hard = missing.filter((m) => !/apple-touch-icon\.png/.test(m) || !iconLinks.some((l) => /apple-touch-icon/.test(l.rel.join(' ')))); (hard.some((m) => /favicon\.ico|href/.test(m)) ? warn : info)('icons', `icon request(s) failing: ${missing.join(', ')} — browsers and Apple devices request these blindly; silent 404s cost crawl budget`); }
    else pass('icons', `favicon.ico + apple-touch-icon + declared icons all 200`);
    if (!iconLinks.some((l) => l.rel.includes('apple-touch-icon'))) info('icons', 'no <link rel="apple-touch-icon"> — iOS requests /apple-touch-icon.png anyway');
    const man = htmlHead.links.find((l) => l.rel.includes('manifest')); if (man) { const r = await status(abs(man.href, doc.url)); if (r.status !== 200) warn('manifest', `manifest ${man.href} → ${r.status}`); }
    for (const p of ['/llms.txt', '/llms-full.txt']) {
      const r = await get(ctx.origin + p);
      if (r.status !== 200 || soft404(r) || /<html/i.test(r.text.slice(0, 300))) { if (p === '/llms.txt') info('llms', 'no /llms.txt (optional: a markdown index for AI agents / RAG)'); continue; }
      const issues = []; if (!/^#\s+\S/m.test(r.text)) issues.push('no H1');
      if (!/^>\s+\S/m.test(r.text) && p === '/llms.txt') issues.push('no blockquote summary after the H1');
      const links = [...r.text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((l) => !/^mailto:/.test(l)); let dead = 0; const check = links.slice(0, 12);
      for (const l of check) { const lu = abs(l, ctx.origin + p); if (!lu || !sameHost(lu)) continue; const s = await status(lu); if (s.status >= 400 || s.status === 0) dead++; }
      if (dead) issues.push(`${dead}/${check.length} checked links dead`);
      if (/text\/html/i.test(r.headers['content-type'] || '')) issues.push(`served as ${r.headers['content-type']}, should be text/plain or text/markdown`);
      if (issues.length) warn('llms', `${p}: ${issues.join('; ')}`); else pass('llms', `${p}: H1, ${links.length} links, ${check.length} checked ok`);
    }
  }

  // Layer 1/2/4 on the home page
  const home = inspect(doc.text);
  ctx.productSite = (doc.text.match(PRODUCT_RE) || [])[1] || '';
  if (ctx.productSite) legalLinkCheck(ctx.productSite, JSON.stringify(home.jsonld));
  ctx.platform = detectPlatform(home); if (ctx.platform) { section('Reach'); info('platform', `platform: ${ctx.platform}${home.generator ? ` (generator meta)` : ' (asset hosts)'} — hints in [brackets] point at that platform's settings`); }
  pageChecks(home, doc.url, '/');
  if (home.text.length < 200) warn('thin', '/: less than 200 characters of text in the served HTML — if the content arrives with JavaScript, crawlers see an empty page first');

  // inner pages from the sitemap (spread across the list), then from links if no sitemap
  const list = sitemap.urls.map((x) => x.loc).filter((l) => normKey(l) !== normKey(doc.url) && sameHost(l));
  const stride = (arr, n) => { const out = []; if (!arr.length || n <= 0) return out; const step = Math.max(1, Math.floor(arr.length / n)); for (let i = 0; i < arr.length && out.length < n; i += step) out.push(arr[i]); return out; };
  // one bucket per first path segment (language prefix ignored), filled round-robin, archives capped at a third: a 120-URL sitemap of /service-page/* still yields studio, contact, artists
  const seg = (l) => { const parts = new URL(l).pathname.split('/').filter(Boolean); if (parts.length > 1 && /^[a-z]{2}(-[a-z]{2})?$/i.test(parts[0])) parts.shift(); return parts.length > 1 ? parts[0] : '_top'; };
  const buckets = new Map(); for (const l of list) { const k = seg(l); (buckets.get(k) || buckets.set(k, []).get(k)).push(l); }
  for (const [k, arr] of buckets) buckets.set(k, stride(arr, Math.max(2, Math.ceil(opt.pages / buckets.size))));
  const pick = []; let nArch = 0; const maxArch = Math.floor(opt.pages / 3);
  for (let round = 0; pick.length < opt.pages && [...buckets.values()].some((a) => a.length > round); round++) for (const arr of buckets.values()) { const l = arr[round]; if (!l || pick.length >= opt.pages) continue; const isArch = INDEX_NOINDEX_RE.test(new URL(l).pathname); if (isArch && nArch >= maxArch) continue; if (isArch) nArch++; pick.push(l); }
  if (!list.length) { for (const [k, p] of ctx.linkTargets) { if (pick.length >= opt.pages) break; if (k !== normKey(doc.url) && !/\.[a-z0-9]{2,5}$/i.test(new URL(p).pathname)) pick.push(p); } }
  const fetched = new Map([[normKey(doc.url), 200]]);
  for (const p of pick) {
    const { final: r, chain: ch } = await follow(p); fetched.set(normKey(p), r.status);
    const path = new URL(p).pathname;
    if (r.status !== 200) { section('Reach'); fail('inner', `${path} answers ${r.status || r.error}${ch.length > 1 ? ` (via ${ch.map((c) => c.status).join('→')})` : ''} but is listed in the sitemap`); continue; }
    if (!/text\/html/i.test(r.headers['content-type'] || '')) { section('Reach'); info('inner', `${path}: ${r.headers['content-type'] || 'unknown type'} — not an HTML page, skipped`); continue; }
    if (ch.length > 1) { section('Reach'); warn('inner-redirect', `${path} redirects (${ch.map((c) => c.status).join('→')} → ${new URL(r.url).pathname}) — the sitemap should list final URLs only`); }
    const xr2 = r.headers['x-robots-tag']; if (xr2 && /noindex/i.test(xr2)) { section('Reach'); fail('x-robots', `${path}: X-Robots-Tag ${xr2} yet listed in the sitemap`); }
    const h = inspect(r.text); ctx.redirectedFrom = ch.length > 1 ? p : ''; pageChecks(h, r.url, path); ctx.redirectedFrom = '';
    if (h.mainText.length < 300 && !INDEX_NOINDEX_RE.test(path)) { section('Structure'); info('thin', `${path}: only ${h.mainText.length} chars of main content`); }
  }

  // Layer 3
  section('Links & network');
  const P = ctx.pages;
  const tot = (k) => P.reduce((n, p) => n + p[k], 0);
  if (tot('mixedSrc')) { fail('mixed', `${tot('mixedSrc')} http:// resource(s) (img/script/css) on https pages — blocked or downgraded by browsers`); KEKKAI('mixed content on https pages'); }
  if (tot('mixedHref')) warn('mixed-href', `${tot('mixedHref')} link(s) to http:// URLs — each is a hop through a redirect, or a dead site`);
  if (!tot('mixedSrc') && !tot('mixedHref')) pass('mixed', 'no mixed content, no http:// links');
  if (ctx.edgeLinks) info('edge-links', `${ctx.edgeLinks} link(s) rewritten by Cloudflare email obfuscation (/cdn-cgi/l/email-protection) — mailto: links that need JavaScript to work; crawlers see no address, which is usually the point`);
  if (tot('blankNoOpener')) warn('noopener', `${tot('blankNoOpener')} external target="_blank" link(s) without rel="noopener" — modern browsers imply it, old ones leak window.opener`);
  if (tot('nofollowInternal')) warn('nofollow', `${tot('nofollowInternal')} internal link(s) carry rel="nofollow" — you are telling Google not to pass equity to your own pages`); else pass('nofollow', 'no internal nofollow');
  if (tot('slashMis')) warn('slash', `${tot('slashMis')} internal link(s) disagree with the canonical trailing-slash policy (${ctx.slashPolicy ? 'with' : 'without'} slash) — each one is a 301/308 hop`); else if (ctx.slashPolicy != null) pass('slash', `internal links follow the trailing-slash policy (${ctx.slashPolicy ? 'with' : 'without'})`);
  const bad = P.flatMap((p) => p.badAnchor); if (bad.length) warn('anchor', `${bad.length} generic anchor text(s): ${[...new Set(bad)].slice(0, 5).map((b) => `"${b}"`).join(', ')} — anchors describe the destination`);
  if (tot('emptyAnchor')) warn('anchor-empty', `${tot('emptyAnchor')} link(s) with no text, no image alt, no aria-label`);
  if (!bad.length && !tot('emptyAnchor')) pass('anchor', 'anchor texts descriptive');
  // broken internal links (HEAD a sample of the collected set)
  if (opt.probe) {
    const cand = [...ctx.linkTargets.values()].filter((l) => !fetched.has(normKey(l)) && !/\.(jpg|jpeg|png|webp|avif|gif|svg|pdf|zip|mp4|webm|css|js|xml|txt|ico|woff2?)$/i.test(new URL(l).pathname)).slice(0, 40);
    let broken = [], redir = 0;
    for (const l of cand) { const r = await status(l); fetched.set(normKey(l), r.status); if (r.status >= 400 || r.status === 0) broken.push(`${new URL(l).pathname} → ${r.status || r.error}`); else if (r.status >= 300) redir++; }
    if (broken.length) fail('broken', `${broken.length}/${cand.length} internal link(s) broken`, broken.slice(0, 8).join('\n')); else if (cand.length) pass('broken', `${cand.length} internal link targets checked, none broken${redir ? ` (${redir} redirect)` : ''}`);
  }
  // orphans / sitemap gaps
  if (ctx.sitemapUrls.size) {
    const linkedNotInSitemap = [...ctx.internalLinked].filter((k) => !ctx.sitemapUrls.has(k) && (fetched.get(k) ?? 200) === 200 && !/\.[a-z0-9]{2,5}$/i.test(k) && !INDEX_NOINDEX_RE.test(k) && !k.includes('?'));
    if (linkedNotInSitemap.length) warn('sitemap-gap', `${linkedNotInSitemap.length} linked page(s) not in the sitemap`, linkedNotInSitemap.slice(0, 8).join('\n'));
    const notLinked = [...ctx.sitemapUrls].filter((s) => !ctx.internalLinked.has(s) && s !== normKey(doc.url));
    if (notLinked.length && P.length > 1) info('orphan', `${notLinked.length}/${ctx.sitemapUrls.size} sitemap URLs were not linked from the ${P.length} scanned pages (full crawl would tell; true orphans rank poorly)`);
    else if (P.length > 1) pass('orphan', 'every sitemap URL is linked from the scanned pages');
  }
  // hreflang reciprocity
  const pairs = [...ctx.hrefs].map((s) => JSON.parse(s)); const seenAlt = new Map(); let recipBad = [];
  for (const p of pairs.slice(0, 24)) {
    if (!seenAlt.has(p.to)) { const r = await get(p.to); seenAlt.set(p.to, r.status === 200 ? inspect(r.text).hreflang.map((x) => abs(x.href, p.to)).filter(Boolean).map(normKey) : null); }
    const back = seenAlt.get(p.to); if (back === null) recipBad.push(`${new URL(p.to).pathname} not reachable`); else if (!back.includes(normKey(p.from))) recipBad.push(`${new URL(p.to).pathname} does not point back to ${new URL(p.from).pathname}`);
  }
  if (pairs.length) { if (recipBad.length) fail('hreflang-recip', `hreflang not reciprocal: ${recipBad.length} pair(s)`, [...new Set(recipBad)].slice(0, 6).join('\n')); else pass('hreflang-recip', `hreflang reciprocal across ${Math.min(pairs.length, 24)} pair(s)`); }
  // resource hints
  const missHint = [...ctx.externalOrigins].filter((o2) => !ctx.preconnects.has(o2)); if (missHint.length) info('preconnect', `external origins without preconnect: ${missHint.join(', ')}`);
}

// ───────────────────────────── dist mode ─────────────────────────────
function walk(dir) { const out = []; for (const e of readdirSync(dir)) { const p = join(dir, e); const s = statSync(p); if (s.isDirectory()) out.push(...walk(p)); else out.push(p); } return out; }
function distScan(dir) {
  ctx.mode = 'dist'; ctx.origin = opt.base || ''; ctx.https = !opt.base || /^https:/i.test(opt.base);
  const files = walk(dir); const rel = (p) => '/' + relative(dir, p).split(sep).join('/');
  const htmls = files.filter((f) => /\.html?$/i.test(f));
  section('Root assets');
  if (!opt.base) info('base', 'no --base <url>: canonical / og:url host checks and sitemap host checks are skipped');
  if (!htmls.length) { fail('dist', `no HTML files under ${dir}`); return; }
  // a route is what the host serves: dir/index.html → /dir/, page.html → /page (clean URLs: Cloudflare Pages, Netlify, Vercel)
  const routeOf = (f) => { const r = rel(f); return r.endsWith('/index.html') ? r.slice(0, -'index.html'.length) : r.replace(/\.html?$/i, ''); };
  ctx.cleanHtml = htmls.some((f) => !/\/index\.html?$/i.test(rel(f)) && !/\/404\.html?$/i.test(rel(f)));
  const firstHome = htmls.find((f) => rel(f) === '/index.html');
  if (firstHome) { const t = readFileSync(firstHome, 'utf8'); ctx.productSite = (t.match(PRODUCT_RE) || [])[1] || ''; if (ctx.productSite) { legalLinkCheck(ctx.productSite, t); section('Root assets'); } }
  const routes = new Map(htmls.map((f) => [normPath(routeOf(f)), f]));
  // routes that opt out of indexing are deliberately hidden (an admin page, a utility) — they are never orphans or sitemap gaps, and never printed
  const hidden = new Set([...routes].filter(([, f]) => /<meta[^>]+name\s*=\s*["']robots["'][^>]*noindex/i.test(readFileSync(f, 'utf8').slice(0, 20000))).map(([r]) => r));
  const robotsF = files.find((f) => rel(f) === '/robots.txt');
  let groups = [];
  if (!robotsF) warn('robots', 'no robots.txt in the output'); else { groups = parseRobots(readFileSync(robotsF, 'utf8')); if (!groups.sitemaps) warn('robots-sitemap', 'robots.txt without a Sitemap: line'); else pass('robots', `robots.txt with ${groups.sitemaps.length} Sitemap line(s)`); const star = groups.find((g) => g.agents.includes('*')); if (star && star.rules.some((r) => !r.allow && r.path === '/')) fail('robots', 'robots.txt: Disallow: / for everyone'); }
  const smF = files.filter((f) => /^\/sitemap[^/]*\.xml$/i.test(rel(f)));
  const smUrls = [];
  for (const f of smF) { const t = readFileSync(f, 'utf8'); for (const m of t.matchAll(/<url>([\s\S]*?)<\/url>/gi)) { const loc = m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/i)?.[1]; const lastmod = m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i)?.[1]; if (loc) smUrls.push({ loc: decode(loc), lastmod }); } }
  if (!smF.length) fail('sitemap', 'no sitemap*.xml in the output');
  else if (!smUrls.length) info('sitemap', `${smF.length} sitemap file(s) but no <url> entries here (an index pointing elsewhere?)`);
  else {
    pass('sitemap', `${smF.length} sitemap file(s), ${smUrls.length} URLs`);
    const paths = smUrls.map((x) => { try { return new URL(x.loc).pathname; } catch { return x.loc; } });
    const missing = paths.filter((p) => !routes.has(normPath(p)) && !routes.has(normPath(p + '/')) && !routes.has(normPath(p.replace(/\.html?$/i, '')))); if (missing.length) fail('sitemap-404', `${missing.length} sitemap URL(s) have no file in the output`, missing.slice(0, 8).join('\n'));
    if (opt.base) { const foreign = smUrls.filter((x) => { try { return new URL(x.loc).origin !== opt.base; } catch { return true; } }); if (foreign.length) fail('sitemap-host', `${foreign.length} sitemap URL(s) not on ${opt.base}, e.g. ${foreign[0].loc}`); }
    const badMod = smUrls.filter((x) => x.lastmod && isNaN(Date.parse(x.lastmod))); if (badMod.length) warn('sitemap-lastmod', `${badMod.length} invalid <lastmod>`);
    const sameMod = new Set(smUrls.map((x) => x.lastmod).filter(Boolean)); if (smUrls.length > 5 && sameMod.size === 1) warn('sitemap-lastmod', `every URL has the same <lastmod> — a build timestamp, not a content date`);
    const blocked = paths.filter((p) => !robotsAllows(groups, p)); if (blocked.length) fail('sitemap-robots', `${blocked.length} sitemap URL(s) blocked by robots.txt, e.g. ${blocked[0]}`);
    const slashes = paths.filter((p) => p !== '/' && !/\.[a-z0-9]{2,5}$/i.test(p)); const withSlash = slashes.filter((p) => p.endsWith('/')).length; if (slashes.length && withSlash && withSlash !== slashes.length) warn('sitemap-slash', `sitemap mixes trailing-slash styles (${withSlash} with, ${slashes.length - withSlash} without)`);
    for (const p of paths) ctx.sitemapUrls.add(normPath(p.replace(/\.html?$/i, '')));
    const gap = [];
    for (const [r, f] of routes) if (!ctx.sitemapUrls.has(r) && !/\/404$|\/404\.html$/.test(r) && !INDEX_NOINDEX_RE.test(r) && !hidden.has(r)) gap.push(r || '/');
    if (gap.length) warn('sitemap-gap', `${gap.length} indexable HTML route(s) not in the sitemap`, gap.slice(0, 8).join('\n'));
  }
  for (const p of ['/favicon.ico', '/apple-touch-icon.png']) if (!files.some((f) => rel(f) === p)) info('icons', `${p} not in the output — devices request it blindly (404 each time)`);
  const llms = files.find((f) => rel(f) === '/llms.txt'); if (llms) { const t = readFileSync(llms, 'utf8'); const issues = []; if (!/^#\s+\S/m.test(t)) issues.push('no H1'); const links = [...t.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]); const dead = links.filter((l) => !isHttp(l) && !/^mailto:/.test(l) && !routes.has(normPath(l.split('#')[0])) && !files.some((f) => rel(f) === l.split('#')[0])).length; if (dead) issues.push(`${dead} relative link(s) without a file`); if (issues.length) warn('llms', `llms.txt: ${issues.join('; ')}`); else pass('llms', `llms.txt: H1, ${links.length} links`); }

  // pages: all of them, but only the first N verbose; the rest aggregated
  const ordered = [...routes.entries()].sort((a, b) => a[0].length - b[0].length);
  const sample = ordered.slice(0, Math.max(opt.pages, 1));
  let linkedSet = new Set(); const brokenInternal = []; const agg = new Map(); // failures on the non-sampled pages, grouped
  for (const [r, f] of ordered) {
    const html = readFileSync(f, 'utf8'); const h = inspect(html);
    const pageUrl = opt.base ? opt.base + (routeOf(f)) : null;
    if (sample.some(([sr]) => sr === r)) pageChecks(h, pageUrl, r || '/');
    else { // silent aggregate: keep the hard failures, one line per kind
      const prevLen = results.length; pageChecks(h, pageUrl, r || '/');
      const added = results.splice(prevLen);
      for (const x of added) if (x.level === 'fail') { const key = `${x.section}|${x.id}|${x.msg.replace(/^[^:]*: /, '').replace(/\d+/g, 'N').slice(0, 40)}`; const e = agg.get(key) || { section: x.section, id: x.id, msg: x.msg.replace(/^[^:]*: /, ''), pages: [] }; e.pages.push(r || '/'); agg.set(key, e); }
    }
    for (const a of h.anchors) {
      if (!a.href || /^(#|mailto:|tel:|javascript:|https?:)/i.test(a.href) && !(opt.base && a.href.startsWith(opt.base))) continue;
      let p = a.href.startsWith(opt.base || '\u0000') ? a.href.slice(opt.base.length) : a.href; p = p.split('#')[0].split('?')[0]; if (!p) continue;
      if (!p.startsWith('/')) { try { p = new URL(p, 'https://x' + (routeOf(f))).pathname; } catch { continue; } }
      linkedSet.add(normPath(p.replace(/\.html?$/i, '')));
      const exists = routes.has(normPath(p)) || routes.has(normPath(p.replace(/\.html?$/i, ''))) || files.some((ff) => rel(ff) === p) || files.some((ff) => rel(ff) === p.replace(/\/$/, '') + '.html');
      if (!exists) brokenInternal.push(`${r || '/'} → ${p}`);
    }
  }
  for (const e of agg.values()) { section(e.section); fail(e.id, `${e.pages.length} more page(s): ${e.msg}`, e.pages.slice(0, 6).join('\n') + (e.pages.length > 6 ? `\n… ${e.pages.length - 6} more` : '')); }
  section('Links & network');
  if (brokenInternal.length) fail('broken', `${brokenInternal.length} internal link(s) point to no file in the output`, [...new Set(brokenInternal)].slice(0, 10).join('\n')); else pass('broken', 'every internal link resolves to a file in the output');
  const P = ctx.pages; const tot = (k) => P.reduce((n, p) => n + p[k], 0);
  if (tot('mixedSrc')) fail('mixed', `${tot('mixedSrc')} http:// resource(s) in the output`); if (tot('mixedHref')) warn('mixed-href', `${tot('mixedHref')} link(s) to http:// URLs`);
  if (tot('blankNoOpener')) warn('noopener', `${tot('blankNoOpener')} external target="_blank" link(s) without rel="noopener"`);
  if (tot('nofollowInternal')) warn('nofollow', `${tot('nofollowInternal')} internal link(s) with rel="nofollow"`);
  if (tot('slashMis')) warn('slash', `${tot('slashMis')} internal link(s) disagree with the canonical trailing-slash policy`);
  const bad = P.flatMap((p) => p.badAnchor); if (bad.length) warn('anchor', `${bad.length} generic anchor text(s): ${[...new Set(bad)].slice(0, 5).map((b) => `"${b}"`).join(', ')}`);
  if (tot('emptyAnchor')) warn('anchor-empty', `${tot('emptyAnchor')} link(s) with no text, image alt or aria-label`);
  const orphans = [...routes.keys()].filter((r) => r && !linkedSet.has(r) && !/\/404(?:\.html)?$/.test(r) && !INDEX_NOINDEX_RE.test(r) && !hidden.has(r)); if (orphans.length) warn('orphan', `${orphans.length} HTML route(s) linked from nowhere in the output (orphans)`, orphans.slice(0, 10).join('\n')); else pass('orphan', 'no orphan routes');
  if (ordered.length > sample.length) info('scope', `${ordered.length} HTML files: ${sample.length} reported in full, the rest only for failures (--pages N to widen)`);
}

// ───────────────────────────── run ─────────────────────────────
const isDir = !/^https?:\/\//i.test(target) && existsSync(target) && statSync(target).isDirectory();
if (isDir) distScan(target); else await liveScan(target);

// ── markup grade for the site: median of the scanned pages, worst pages named
const markupSite = (() => {
  const ms = ctx.markup; if (!ms.length) return null;
  const sorted = ms.map((m) => m.score).sort((a, b) => a - b); const mid = sorted.length / 2; const median = Math.round(sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2);
  const n = { GREEN: 0, YELLOW: 0, RED: 0 }; for (const m of ms) n[m.flag]++;
  const flag = ms.some((m) => m.fakeNav) || median < 50 ? 'RED' : median < 80 ? 'YELLOW' : 'GREEN';
  const reasons = new Map(); for (const m of ms) for (const r of m.reasons.slice(0, 3)) { const k = r.replace(/\s*\(.*?\)/g, '').replace(/^\d+(\.\d+)?%?\s*(of the\s*)?/, '').replace(/\b\d+(\.\d+)?\b\s*/g, '').trim(); reasons.set(k, (reasons.get(k) || 0) + 1); }
  const common = [...reasons.entries()].sort((a, b) => b[1] - a[1]).filter(([, c]) => c >= Math.ceil(ms.length / 2)).slice(0, 3).map(([k]) => k);
  return { median, flag, n, pages: ms.length, common };
})();
if (markupSite) {
  section('Markup & accessibility');
  const s2 = markupSite; const builder = ctx.builder ? ` · built with ${ctx.builder}` : '';
  results.push({ section: 'Markup & accessibility', level: 'info', id: 'markup-site', msg: `site markup ${s2.flag} ${s2.median} (median of ${s2.pages} page${s2.pages > 1 ? 's' : ''}: ${s2.n.GREEN} green, ${s2.n.YELLOW} yellow, ${s2.n.RED} red)${builder}${s2.common.length ? ` — recurring: ${s2.common.join('; ')}` : ''}` });
}
// ── title template: a long shared suffix on every title is a template eating the budget
{
  const titles = [...ctx.titles.keys()]; if (titles.length >= 5) {
    const tail = (t) => { const parts = t.split(/\s+[|\-–—·:]\s+/); return parts.length > 1 ? parts.slice(1).join(' ') : ''; };
    const freq = new Map(); for (const t of titles) { const x = tail(t); if (x) freq.set(x, (freq.get(x) || 0) + 1); }
    const [common, n] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
    if (n >= 5 && [...common].length > 25) { section('Head & rendering'); info('title-template', `title template appends "${common.slice(0, 60)}" (${[...common].length} chars) on ${n} pages — that budget is taken from every page's own words`); }
  }
}
// ── site-wide collapse: the same finding on most scanned pages is one finding about the template, not N findings about pages
{
  const labelOf = (r) => r.msg.match(/^(\/\S*): /)?.[1] ?? null;
  const labels = new Set(results.map(labelOf).filter(Boolean)); const nPages = labels.size;
  if (nPages >= 3) {
    const groups = new Map();
    results.forEach((r, i) => { const l = labelOf(r); if (!l || r.id === 'markup') return; const key = `${r.section}|${r.id}|${r.level}`; const g = groups.get(key) || { idx: [], pages: new Set(), first: r }; g.idx.push(i); g.pages.add(l); groups.set(key, g); });
    const drop = new Set(); const add = new Map();
    for (const g of groups.values()) {
      const n = g.pages.size; if (n < 3 || n < Math.ceil(nPages * 0.6)) continue;
      g.idx.forEach((i) => drop.add(i));
      const raw = g.first.msg.replace(/^\/\S*: /, '');
      const GENERIC = { thin: 'thin main content (under 300 chars)', 'img-lazy': 'images without loading="lazy"', 'img-decoding': 'images without decoding="async"', 'og-type': 'no og:type', 'og-image-alt': 'no og:image:alt', twitter: 'no twitter:card', lang: 'lang attribute set', viewport: 'viewport ok', title: 'title within 15–60 chars', description: 'description within 50–160 chars', canonical: 'canonical self-referencing', noindex: 'indexable', hreflang: 'hreflang set present', h1: 'one <h1>', 'h-order': 'heading levels descend without jumps', 'img-alt': 'every <img> carries alt', jsonld: 'JSON-LD present', og: 'og:title / description / image / url present', breadcrumb: 'BreadcrumbList valid', dom: 'DOM size within limits', img: 'no <img> in the body' };
      const soft = g.first.level === 'pass' || g.first.level === 'info';
      const msg = soft ? (GENERIC[g.first.id] || raw.replace(/:\s*".*$/, '').replace(/\s*\(.*?\)\s*$/, '').replace(/\b\d+(?:\/\d+)?\s*/g, '').replace(/\s{2,}/g, ' ').trim()) : `e.g. ${raw}`;
      const pagesList = [...g.pages];
      add.set(g.idx[0], { section: g.first.section, level: g.first.level, id: g.first.id, msg: `${n}/${nPages} pages: ${msg}${soft ? '' : ' — site-wide: fix the template or the setting, not the pages'}`, detail: soft ? undefined : pagesList.slice(0, 5).join('\n') + (n > 5 ? `\n… ${n - 5} more` : '') });
    }
    const out = []; results.forEach((r, i) => { if (add.has(i)) out.push(add.get(i)); if (!drop.has(i)) out.push(r); });
    results.length = 0; results.push(...out);
  }
}
// ── severity tiers: what a finding costs, not just whether it is wrong
//   INVISIBLE — the site or the page cannot enter the index (or tells the engine another URL is the real one)
//   DILUTED   — it can be indexed, but its signals are split, contradictory or lost
//   DEGRADED  — it is indexed as it is, but shown worse than it could be
const INVISIBLE = new Set(['fetch', 'status', 'robots', 'x-robots', 'noindex', 'canonical-file', 'canonical-redirect', 'hreflang-file', 'sitemap-robots', 'inner', 'sitemap-404', 'sitemap-host']);
const DILUTED = new Set(['alias', 'https', 'canonical', 'canonical-slash', 'canonical-html', 'title-dup', 'description-dup', 'hreflang', 'hreflang-recip', 'lang', 'lang-script', 'h1', 'h-empty', 'slash', 'sitemap', 'sitemap-slash', 'sitemap-scheme', 'sitemap-gap', 'inner-redirect', 'broken', 'orphan', 'nofollow', 'nofollow-meta', 'mixed', 'jsonld-syntax', 'jsonld-context', 'jsonld-h1', 'jsonld-article', 'jsonld-legal', 'terms-link', 'og-url', 'thin', 'fake-link']);
const tierOf = (r) => (r.level === 'pass' || r.level === 'info') ? '' : INVISIBLE.has(r.id) && !(r.id === 'noindex' && r.level === 'warn' && !/sitemap/.test(r.msg)) ? 'INVISIBLE' : DILUTED.has(r.id) ? 'DILUTED' : 'DEGRADED';
for (const r of results) r.tier = tierOf(r);
const tiers = { INVISIBLE: 0, DILUTED: 0, DEGRADED: 0 }; for (const r of results) if (r.tier) tiers[r.tier]++;
const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
for (const r of results) counts[r.level]++;
const failed = counts.fail > 0 || (opt.strict && counts.warn > 0);
const mode = isDir ? 'build output' : 'live';
const verdict = tiers.INVISIBLE ? `SIGHT OBSCURED — ${tiers.INVISIBLE} finding(s) keep pages out of the index. A site that cannot be found is as lost as one that was broken into; fix these first.`
  : failed ? `SIGHT OBSCURED — fix the ✖ items, then ${isDir ? 'scan the live site' : 'run again against the live site'}.`
  : isDir ? 'SIGHT CLEAR — build output consistent. Next: scan the live site.' : 'SIGHT CLEAR — no failures. Re-run after deploy; Search Console is the only verdict that counts.';
const tierLine = `INVISIBLE ${tiers.INVISIBLE} · DILUTED ${tiers.DILUTED} · DEGRADED ${tiers.DEGRADED}${markupSite ? ` · MARKUP ${markupSite.flag} ${markupSite.median}` : ''}`;
const kekkaiCmd = `npx github:kappa-yashi/kekkai ${isDir ? target : target}`;
const plainMark = { pass: '✔', warn: '!', fail: '✖', info: '·' };
function render(fmt, color) {
  const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const mark = { pass: c(32, '✔'), warn: c(33, '!'), fail: c(31, '✖'), info: c(90, '·') };
  const ORDER = { INVISIBLE: 0, DILUTED: 1, DEGRADED: 2, '': 3 };
  const shown = opt.summary ? results.filter((r) => r.level === 'fail' || r.level === 'warn').sort((a, b) => ORDER[a.tier] - ORDER[b.tier]) : results;
  const invisible = results.filter((r) => r.tier === 'INVISIBLE');
  const tag = (r) => (r.tier === 'INVISIBLE' ? 'INVISIBLE ' : '');
  const lines = [];
  if (fmt === 'md') {
    lines.push(`# senrigan (千里眼) — ${mode} scan of ${target}`, '', `**${tierLine}** · ${counts.pass} pass · ${counts.warn} warn · ${counts.fail} fail · ${counts.info} info`, '', `> ${verdict}`, '');
    if (invisible.length && !opt.summary) { lines.push('## Out of the index — fix first', ''); for (const r of invisible) lines.push(`- ${plainMark[r.level]} ${r.msg}`); lines.push(''); }
    let last = ''; for (const r of shown) { if (r.section !== last) { lines.push('', `## ${r.section}`, ''); last = r.section; } lines.push(`- ${r.id === 'markup' && r.flag ? FLAG_ICON[r.flag] : plainMark[r.level]} ${opt.summary && r.tier ? `**${r.tier}** ` : tag(r) ? '**INVISIBLE** ' : ''}${r.msg}${r.detail && r.level !== 'pass' ? `\n  \`${String(r.detail).replace(/\n/g, ' · ')}\`` : ''}`); }
    if (ctx.kekkai.length) lines.push('', '## Hand-off to kekkai (結界)', '', ...ctx.kekkai.map((k) => `- ${k}`), '', `Visibility and security are one boundary: \`${kekkaiCmd}\``);
    else lines.push('', `Visibility is half of it — check the security boundary too: \`${kekkaiCmd}\``);
    return lines.join('\n') + '\n';
  }
  const flagColor = (f) => (f === 'RED' ? 31 : f === 'YELLOW' ? 33 : 32);
  lines.push('', `senrigan (千里眼) — ${mode} scan of ${target}`, '', `  ${c(tiers.INVISIBLE ? 31 : 90, `INVISIBLE ${tiers.INVISIBLE}`)} · ${c(tiers.DILUTED ? 33 : 90, `DILUTED ${tiers.DILUTED}`)} · ${c(90, `DEGRADED ${tiers.DEGRADED}`)}${markupSite ? ` · ${c(flagColor(markupSite.flag), `MARKUP ${markupSite.flag} ${markupSite.median}`)}` : ''}`, '');
  if (invisible.length && !opt.summary) { lines.push(c(1, '  Out of the index — fix first')); for (const r of invisible) lines.push(`    ${mark[r.level]} ${r.msg}`); lines.push(''); }
  let last = '';
  for (const r of shown) {
    if (!opt.summary && r.section !== last) { lines.push(c(1, `  ${r.section}`)); last = r.section; }
    const t = opt.summary && r.tier ? c(r.tier === 'INVISIBLE' ? 31 : r.tier === 'DILUTED' ? 33 : 90, `${r.tier.padEnd(9)} `) : tag(r) ? c(31, 'INVISIBLE ') : '';
    const msgOut = r.id === 'markup' && r.flag ? r.msg.replace(new RegExp(`\\b${r.flag} ${r.score}\\b`), c(flagColor(r.flag), `${r.flag} ${r.score}`)) : r.msg;
    lines.push(`    ${mark[r.level]} ${t}${opt.summary ? `[${r.section}] ` : ''}${msgOut}`);
    if (!opt.summary && r.detail && r.level !== 'pass') for (const l of String(r.detail).split('\n')) lines.push(c(90, `        ${l}`));
  }
  lines.push('', `  ${c(32, counts.pass + ' pass')}  ${c(33, counts.warn + ' warn')}  ${c(31, counts.fail + ' fail')}  ${c(90, counts.info + ' info')}   ${tierLine}`, '', `  ${c(failed ? 31 : 32, verdict)}`, '');
  if (ctx.kekkai.length) { lines.push(c(1, '  Hand-off to kekkai (結界)')); for (const k of ctx.kekkai) lines.push(`    → ${k}`); lines.push(`    Visibility and security are one boundary: ${kekkaiCmd}`, ''); }
  else lines.push(c(90, `  Visibility is half of it — check the security boundary too: ${kekkaiCmd}`), '');
  return lines.join('\n');
}
const jsonOut = () => JSON.stringify({ target, mode: isDir ? 'dist' : 'live', counts, tiers, markup: markupSite, ok: !failed, kekkai: ctx.kekkai, results }, null, 2);
if (opt.json) console.log(jsonOut()); else console.log(render('text', process.stdout.isTTY));
if (opt.out) { const { writeFileSync } = await import('node:fs'); writeFileSync(opt.out, opt.out.endsWith('.json') ? jsonOut() : opt.out.endsWith('.md') ? render('md', false) : render('text', false)); console.error(`report written to ${opt.out}`); }
process.exit(failed ? 1 : 0);
