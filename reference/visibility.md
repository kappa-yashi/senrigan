# Static site visibility — the senrigan guide

*What a crawler is told, what it is told twice, and what it is never told.*

Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — reuse
and adapt freely, credit **kappa.yashi**, link to
`https://github.com/kappa-yashi/senrigan`.

Reference stack: Astro, static output, any edge host. Everything here is
framework-agnostic; the code samples are Astro because that is what the
scanner was written against.

---

## PART 0 — How a crawler reads a static page

A crawler fetches the HTML, reads it once without running your JavaScript,
and answers three questions from the `<head>` and the heading skeleton:

1. **Which URL is this?** (canonical, host, slash, hreflang)
2. **May I keep it?** (robots meta, X-Robots-Tag, robots.txt, sitemap)
3. **What is it about?** (title, description, `<h1>`, headings, alt text,
   structured data)

**Visibility is not decoration.** A site nobody can find fails as
completely as one that was broken into; the breach announces itself, the
invisibility never does. The scanner therefore ranks findings by cost —
INVISIBLE (out of the index), DILUTED (indexed with split or contradictory
signals), DEGRADED (indexed, shown worse than it could be) — and the first
tier is not optional on any site that wants to be read by people, search
engines or language models.

Rendering with JavaScript happens later, in a separate queue, sometimes days
later, sometimes never for a low-priority site. A static site has no excuse:
everything the page is must be in the served HTML.

The scanner reproduces exactly that first pass. Its eight sections are the
eight parts below.

---

## PART 1 — One URL per page

Every page has exactly one address. Everything else is a redirect to it.

**Host.** Make `www` the primary host and 301 the apex to it. Search engines
do not prefer either, but `www` keeps cookies off every other subdomain and
can be a plain CNAME, so any CDN, failover or host change is a DNS edit
rather than an apex-flattening workaround. Whichever you pick, the other
answers with a 301 — two hosts that both answer 200 split every signal. Both certificates valid.
`http://` 301s to `https://`. (kekkai checks the redirects and HSTS;
senrigan checks that the canonicals agree with the choice.)

**Trailing slash.** Pick one style, apply it to canonicals, sitemap,
internal links and the host redirects. In Astro:

```js
// astro.config.mjs
export default defineConfig({
  site: 'https://www.example.com',
  trailingSlash: 'always',      // or 'never' — then build.format: 'file'
  build: { format: 'directory' },
});
```

Then make the host redirect the other form (Cloudflare Pages and Netlify do
it for `directory` output; verify with the live scan — a 308 per link is a
real cost).

**Canonical.** Absolute, `https`, on the chosen host, in the chosen slash
style, pointing at the page itself. Built from the route, never a constant:

```astro
---
const canonical = new URL(Astro.url.pathname, Astro.site).href;
---
<link rel="canonical" href={canonical}>
```

A translated page is not a duplicate: `/el/about/` canonicalises to itself,
and hreflang (PART 3) links it to `/about/`. A text-only or AMP-style mirror
*is* a duplicate: it canonicalises to the HTML page, or carries `noindex`.

---

## PART 2 — The indexing matrix

Three things say whether a page should be indexed. They must agree.

| | indexable content page | archive / tag page | utility page (search, 404, version, thank-you) | hidden page (admin, preview) |
|---|---|---|---|---|
| robots meta | none (or `index, follow`) | `index` if it has unique copy, else `noindex, follow` | `noindex, follow` | `noindex, nofollow` + `X-Robots-Tag` |
| in sitemap | yes | only if indexed | no | no |
| linked from the site | yes | yes | yes (search, 404 not needed) | no |

Rules that follow:

- `noindex` **and** in the sitemap is a contradiction; the scanner fails it.
- `noindex` lives in the page (`<meta name="robots">`) or the response
  (`X-Robots-Tag`). Never in `robots.txt`: a URL blocked from crawling can
  still be indexed from its links, with no title, and its `noindex` is never
  seen.
- Pagination: page 1 is the archive; pages 2+ are indexable only when the
  template gives them their own title (`… — page 3`) and they are linked
  with real `<a>` elements. `rel="next"/"prev"` is harmless but Google has
  ignored it since 2019.
- Tag pages are worth indexing on a small site only when each has a real
  description and an `<h1>` with the tag name. A hundred thin tag pages
  dilute the site; `noindex, follow` keeps the links flowing without the
  pages competing.

---

## PART 3 — The head template

One component, used by every layout, fed by the page's data with sensible
fallbacks. What it must emit:

```astro
---
// Seo.astro — props: title, description, image, imageAlt, type, noindex, lang, alternates, published, modified
const site = 'Example';                                  // from a settings file
const fullTitle = Astro.props.title ? `${Astro.props.title} · ${site}` : site;
const description = Astro.props.description ?? defaults.description;
const canonical = new URL(Astro.url.pathname, Astro.site).href;
const image = new URL(Astro.props.image ?? defaults.image, Astro.site).href;  // always absolute
---
<title>{fullTitle}</title>
<meta name="description" content={description}>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href={canonical}>
{Astro.props.noindex && <meta name="robots" content="noindex, follow">}
{alternates.map(a => <link rel="alternate" hreflang={a.lang} href={a.href}>)}
<link rel="alternate" hreflang="x-default" href={alternates.find(a => a.lang === defaultLang).href}>
<meta property="og:type" content={Astro.props.type ?? 'website'}>
<meta property="og:title" content={fullTitle}>
<meta property="og:description" content={description}>
<meta property="og:image" content={image}>
<meta property="og:image:alt" content={Astro.props.imageAlt ?? defaults.imageAlt}>
<meta property="og:url" content={canonical}>
<meta property="og:locale" content={localeOf(lang)}>
<meta name="twitter:card" content="summary_large_image">
```

Rules the scanner enforces on the result:

- `<html lang>` is the route's language and matches the page's own hreflang
  entry.
- **Title**: 15–60 characters; page name first, site name last; unique.
  Length is a proxy — Google truncates around 600 px — but a 61-character
  title is rarely shown whole.
- **Description**: 50–160 characters, unique, a sentence someone would click.
  Missing means Google writes one from the page; it usually picks badly.
- **Hreflang**: absolute URLs; valid codes (`en`, `el`, `en-GB`); every page
  of the set lists every page *including itself*; `x-default` points at the
  version for everyone else; the other pages link back (the live scan
  fetches them). One missing back-link invalidates the whole set.
- Fonts and scripts from other origins get `<link rel="preconnect">` (and
  `crossorigin` for fonts). Self-hosting removes the need and satisfies
  kekkai as well.

---

## PART 4 — The heading skeleton and the images

Headings are the outline. Crawlers and screen readers read the outline
before the text.

Four rules:

1. **Exactly one `<h1>`** — the visible title of the page. The home page may
   use the wordmark, with an accessible name (`aria-label` on the inline
   SVG or `alt` on the image); the scanner reads that name as the heading
   text.
2. **No level jumps.** `h2 → h4` is a hole in the outline. Style with CSS,
   not by picking the heading that happens to look right.
3. **The first sub-heading is an `h2`.** A sidebar or widget that opens with
   an `h3` ("saved", "share") is using a heading as a label; make it a `<p>`
   with a class, or `aria-label` the region.
4. **No empty headings.** An `<h2>` holding only an icon, or nothing, is an
   outline entry with no text.

The usual source of a second `<h1>` is the content itself: a markdown author
starts with `# Title`. Enforce "content starts at `##`" in the CMS field
hint, and strip or demote a leading `#` at build:

```js
// remark plugin or a pre-render pass
body = body.replace(/^#\s+(.+)$/m, '## $1');
```

Images:

- `alt` on every `<img>`. Descriptive for content images (what the picture
  shows, not the filename); `alt=""` for decoration. Image search indexes
  alt text; screen readers read it.
- `width` and `height` on every `<img>` — the browser reserves the box, no
  layout shift. The image pipeline knows the dimensions; emit them.
- `loading="lazy" decoding="async"` below the fold; the hero stays eager,
  with `fetchpriority="high"`.

DOM size is reported against the Lighthouse limits (1 500 nodes, depth 32).
It is a performance signal, not a ranking factor; the scanner never fails a
page on it.

---

## PART 5 — Link topology

Links are how authority moves and how crawlers discover pages.

- **Broken internal links.** `dist` mode resolves every `href` against the
  output files; live mode HEADs a sample. A link to a page that does not
  exist is a dead end; fix it before deploy, not after Search Console
  complains.
- **Orphans.** A route nothing links to is found only through the sitemap
  and ranks accordingly. Link it from a nav, an archive, a related-posts
  block, or remove it.
- **Sitemap gaps.** The reverse: pages linked from the site but absent from
  the sitemap. The usual victim is the second language. Generate the sitemap
  from the same route list the pages are built from (Astro: the
  `@astrojs/sitemap` integration with `i18n` configured, or a custom
  endpoint that walks the collections).
- **Trailing-slash consistency.** Every internal link in the policy style.
  A lint at build (`grep -r 'href="/[^"]*[^/"]"' dist` for the "always"
  policy) catches content links.
- **`rel="nofollow"` on internal links** tells Google not to pass equity to
  your own pages. Remove it.
- **Anchor text** names the destination. "Read more" repeated forty times
  on an archive tells the crawler forty times that forty pages are about
  "read more". A card's title is the anchor; the "read more" is decoration
  with `aria-hidden` or `tabindex="-1"`.
- **External links** opening a new tab: `rel="noopener noreferrer"`. Modern
  browsers imply `noopener` for `_blank`; the attribute is still the
  explicit statement.
- **Mixed content.** `http://` in `src` is blocked by browsers on an `https`
  page — the image or script does not load, and the crawler notices. In
  `href` it is a redirect hop or a dead site.
- **Thin served HTML.** A page whose `<main>` has a few hundred characters
  before JavaScript runs is a page the crawler sees as thin, however rich it
  becomes after load. Render at build.

---

## PART 6 — Structured data and social cards

**JSON-LD** — one `<script type="application/ld+json">` per page carrying a
`@graph`. Generate it from the same data the template uses; never hand-write
it in content.

```js
// one graph, every page
const graph = [
  { '@type': 'WebSite', '@id': `${site}#website`, url: site, name, inLanguage: lang, publisher: { '@id': `${site}#publisher` } },
  { '@type': 'Person', '@id': `${site}#publisher`, name: author, url: site, image: avatar, sameAs: profiles },
  { '@type': isPost ? 'WebPage' : 'CollectionPage', '@id': `${canonical}#webpage`, url: canonical, name: fullTitle, description, isPartOf: { '@id': `${site}#website` }, inLanguage: lang, breadcrumb: { '@id': `${canonical}#breadcrumb` } },
  { '@type': 'BreadcrumbList', '@id': `${canonical}#breadcrumb`, itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, ...(i < crumbs.length - 1 && { item: c.url }) })) },
  ...(isPost ? [{ '@type': 'BlogPosting', '@id': `${canonical}#article`, headline: title, description, image, datePublished: published, dateModified: modified ?? published, author: { '@id': `${site}#publisher` }, publisher: { '@id': `${site}#publisher` }, mainEntityOfPage: { '@id': `${canonical}#webpage` }, inLanguage: lang, keywords: tags }] : []),
];
```

What the scanner checks, and why:

- **Parses.** One trailing comma and the whole block is discarded silently.
- **`@context`** on every block.
- **Required fields per type.** Missing `headline` / `datePublished` /
  `author` / `image` on an article means no rich result and no Discover.
- **Cross-checks against the visible page.** `headline` must equal the
  `<h1>` (or be a shorter form of it); `datePublished` must match the
  `<time datetime>` readers see; `dateModified` is never earlier than
  `datePublished`. Structured data that describes something the page does
  not show is the one thing that earns a manual action. Derive the title,
  the date and the image for the JSON-LD from the same fields the template
  renders.
- **Breadcrumbs**: positions from 1, `name` everywhere, `item` on every
  element but the last.

**Open Graph / Twitter** — `og:title`, `og:description`, `og:image`
(absolute `https`, 1200×630, with `og:image:alt`), `og:url` equal to the
canonical, `og:type`, `og:locale`; `twitter:card` (`summary_large_image`
when there is an image; the `og:*` tags are read as fallbacks, so the
`twitter:*` duplicates are optional). A relative `og:image` produces a
card with no picture on every platform.

A client-side router that swaps pages must also swap the JSON-LD and the
social meta — or, simpler, let the crawler see each page as a full
document, which it does anyway.

---

## PART 7 — Root files

**robots.txt**

```
User-agent: *
Allow: /

Sitemap: https://www.example.com/sitemap-index.xml
```

- Block crawling only of what must not be *fetched*. Do not `Disallow` an
  admin path (it advertises it — kekkai's rule); do not use it for
  `noindex` (PART 2).
- Blocking AI crawlers (`GPTBot`, `ClaudeBot`, `CCBot`, `Google-Extended`,
  `PerplexityBot`…) is a decision; the scanner lists it and does not judge.
- A `robots.txt` answering 5xx stops Google crawling the site entirely
  until it recovers; a 404 means "allow all".
- Each crawler obeys the one group that names it and ignores `*` when such a
  group exists. So read the file crawler by crawler, not line by line. Some
  site builders ship a **default-deny** template: `Disallow: /` under `*`,
  with Googlebot and bingbot allowed by name. Google and Bing crawl it fine.
  But it also shuts out every crawler it does not name: ChatGPT search
  (`OAI-SearchBot`), Apple, DuckDuckGo, Yandex, and the link-preview fetchers
  of X, LinkedIn, Facebook and WhatsApp. A shared link then shows no card.
  If the intent was "no AI training", write it the other way round:

```
User-agent: *
Allow: /

User-agent: GPTBot
User-agent: ClaudeBot
User-agent: CCBot
User-agent: Google-Extended
User-agent: Applebot-Extended
Disallow: /

Sitemap: https://www.example.com/sitemap-index.xml
```

**Sitemap**

- Every indexable URL, canonical host, policy slash style, nothing that
  redirects, 404s or carries `noindex`.
- `<lastmod>` only when it is a real content date. One identical timestamp
  on every entry is the build time; Google detects that and stops reading
  the field for the whole site. Omit it rather than fake it.
- Multilingual: each language version is its own `<url>` (optionally with
  `xhtml:link` alternates). In Astro with `@astrojs/sitemap`, set `i18n`
  in the integration; with a custom endpoint, walk every locale.
- URLs with non-ASCII paths are percent-encoded in the file; the scanner
  decodes before matching.

**Icons** — `favicon.ico` and `apple-touch-icon.png` at the root are
requested without being declared, by every browser and every iOS share
sheet. A 404 on each is silent and constant. Ship them, plus
`<link rel="icon">` entries and a manifest that answer 200.

**llms.txt** (optional) — a markdown index for AI agents: an H1, a
blockquote summary, sections of links with one-line descriptions, served as
`text/plain` or `text/markdown`. `llms-full.txt` is the same with the
content inlined. If you ship them, keep the links alive; the scanner HEADs
them.

---

## PART 8 — The semantic pass

`--semantic` tokenises the main text of each page (navigation stripped),
drops English and Greek stop-words, applies a light stemmer, and compares
the five most frequent terms with the title and the `<h1>`. Zero overlap is
flagged as a possible intent mismatch.

Read it as a prompt, not a verdict:

- A post whose top terms are nowhere near its title usually has a clever
  title. Clever is fine for the `<h1>`; the `<title>` and the description
  are where the plain words go.
- Listing pages are skipped: card text would dominate.
- Greek stemming is approximate (endings stripped, accents ignored).
  Compound subjects and loan words will look odd; the counts still point at
  what the page talks about.

The real semantic pass is manual: open the five pages that matter most,
read the title, the description and the first paragraph as a stranger
arriving from a results page, and ask whether they answer the query that
would have brought them. No tool does that for you.

---

## PART 9 — Markup is how machines read

No engine penalises a `<div>`. What costs visibility is markup that hides the
shape of the page:

- **Content vs chrome.** Language models, RAG pipelines, reader modes and
  snippet extraction look for `<main>`, `<article>`, headings and text blocks
  to decide what the page says. Text loose in nested divs, with the menu,
  the cookie banner and the footer at the same depth, is a page whose
  content has to be guessed.
- **Links that are not links.** A `<div onclick>` menu works for a mouse and
  does nothing for a crawler: no `href`, nothing to follow. The pages behind
  it are found only through the sitemap, if at all.
- **Render cost.** Every wrapper is a node to lay out. Page builders emit
  six to eight wrappers per widget; a 300-word page with 3 000 nodes pays for
  it in INP and LCP, which are ranking signals.

What the grade looks at, and what to do on a page builder:

| measure | healthy | builder fix |
|---|---|---|
| landmarks | one `main`, a `nav`, header, footer | set the container's HTML tag (Elementor: Container → HTML Tag) |
| wrapper chains | none ≥ 4 | flex containers instead of nested sections/columns; remove empty wrappers |
| nodes per word | < 3 | fewer widgets per text block; one text widget instead of five headings |
| loose text | < 50 % | text widgets that output `p`, not `div` |
| click targets | all `<a href>` | link fields, never "on click" actions for navigation |
| form fields | each with a label | enable visible labels or set `aria-label` |

## Checklist before a release

- [ ] `senrigan ./dist --base https://host` — sight clear
- [ ] `senrigan https://host --pages 12` after deploy — sight clear
- [ ] `kekkai` on the same two targets — boundary holds
- [ ] every new page type: one `<h1>`, own title and description, canonical,
      in the sitemap, linked from somewhere
- [ ] every new language route: hreflang set complete and reciprocal, in the
      sitemap
- [ ] JSON-LD validated once by hand in the Rich Results Test for the first
      page of each type
- [ ] share one URL in a chat app and look at the card
- [ ] Search Console: request indexing for changed URLs; read coverage in a
      week
