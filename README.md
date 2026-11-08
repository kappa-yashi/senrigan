<img width="2048" height="1143" alt="Senrigan 千里眼-emblem-git-readme" src="https://github.com/user-attachments/assets/93277701-43e3-46ae-b23e-2ee0c485a374" />

# senrigan (千里眼)

Static site visibility & structure check.

In Japanese folklore, *senrigan* (千里眼) is clairvoyance — the eye that sees a
thousand *ri* away. Where [kekkai](https://github.com/kappa-yashi/kekkai)
(結界) asks *what does this site give away?*, senrigan asks the opposite
question: **what does this site fail to tell the machines?** It scans a
**live URL** or a **build folder** and reports what search engines, social
scrapers and AI crawlers actually see: the head, the heading skeleton, the
link topology, the sitemap, the structured data.

One file, zero dependencies, Node 18+. Reference stack: Astro, built to static
files. The checks are framework-agnostic.

```
npx github:kappa-yashi/senrigan https://www.example.com
npx github:kappa-yashi/senrigan ./dist --base https://www.example.com
```

or clone and run `node bin/senrigan.mjs <target>`.

## What it checks

**Layer 0 — root assets** (live and `dist/`)

- `robots.txt`: parsed per group; `Disallow: /` for everyone; a `Sitemap:`
  line; sitemap URLs that robots.txt itself blocks; AI crawlers blocked
  (listed as a decision, not a finding)
- sitemap (index files followed): URLs on another host or on `http://`,
  invalid or future `<lastmod>`, one identical `<lastmod>` everywhere (a build
  timestamp, which Google learns to ignore), mixed trailing-slash styles,
  listed URLs that redirect or 404, indexable pages that are not listed
- `favicon.ico`, `apple-touch-icon.png`, declared icons and the web manifest
  answer 200 (devices request them blindly; each 404 is wasted crawl)
- `llms.txt` / `llms-full.txt` when present: H1, summary blockquote, links
  resolve, served as text

**Layer 1 — head & rendering** (every scanned page)

- `<html lang>` present and a BCP 47 tag, agreeing with the page's own
  hreflang entry
- viewport with `width=device-width`, no zoom blocking
- `<title>`: present, 15–60 characters, unique across the scanned pages
- meta description: present, ≤160 characters, unique
- canonical: present, absolute, `https`, same host, self-referencing; a
  trailing-slash disagreement between canonical and served path is its own
  finding
- **indexing matrix**: `noindex` on a page that is also in the sitemap is a
  failure; `noindex` on a content-looking page is a warning; a utility page
  (search, version, 404…) without `noindex` is a warning; a tag / archive page
  is fine indexed when it has its own description
- hreflang: valid codes, absolute hrefs, `x-default`, the page lists itself,
  and (live) every alternate links back
- external script / font origins without `preconnect` (info);
  `rel=next/prev` noted as harmless (Google has ignored them since 2019)

**Layer 2 — structure**

- heading skeleton, four rules: exactly one `<h1>`; no level jumps
  (`h2 → h4`); the first sub-heading is an `<h2>`; no empty heading tags.
  Inline SVG wordmarks count by their `aria-label` / `<title>`
- DOM size against the Lighthouse limits (1 500 nodes, depth 32) — a
  warning, never the verdict
- images: missing `alt` is a failure (`alt=""` for decorative images is
  accepted); missing `width`/`height` (layout shift); `loading="lazy"` and
  `decoding="async"` counts
- internal links that disagree with the canonical trailing-slash policy
  (each one is a redirect hop)
- pages with almost no text in the served HTML (content that arrives with
  JavaScript is content crawlers meet last)

**Layer 3 — links & network**

- mixed content: `http://` in `src` is a failure on an `https` page; `http://`
  in `href` a warning
- external `target="_blank"` without `rel="noopener"`
- internal links carrying `rel="nofollow"`
- broken internal links (`dist/`: resolved against the output files; live: a
  sample checked with HEAD)
- orphans: routes nothing links to; linked pages missing from the sitemap;
  sitemap URLs the scanned pages never link to
- generic anchor text ("click here", "here", "read more", "εδώ", "κλικ",
  "διαβάστε περισσότερα"…) and links with no text, image alt or aria-label

**Layer 4 — machine-readable & social**

- JSON-LD parses; `@context` present; types listed; required fields per type
  (`Article`/`BlogPosting`: headline, datePublished, author, image;
  `Organization`/`Person`/`WebSite`: name, url; `BreadcrumbList`: positions,
  names, items)
- **cross-checks against the visible page**: `headline` vs the `<h1>`,
  `datePublished` vs `<time datetime>`, `dateModified` not before
  `datePublished`, headline length
- Open Graph: `og:title`, `og:description`, `og:image` (absolute, https),
  `og:url` matching the canonical, `og:type`; `twitter:card` and its image

**Layer 5 — semantic** (`--semantic`, opt-in, informational)

- the page's main text (`<main>`/`<article>`, navigation stripped) is
  tokenised with English and Greek stop-words and a light stemmer; the top
  five terms are compared with the title and the `<h1>`. Zero overlap is
  reported as a possible intent mismatch. Listing pages are skipped.

## Options

```
--json              machine-readable output
--summary           only warnings and failures, one line each, plus counts
--out <file>        also write the report (.json / .md / .txt)
--strict            warnings count as failures (exit 1)
--pages N           live: inner pages to scan from the sitemap (default 8); dist: pages reported in full
--semantic          Layer 5
--no-probe          live: skip icon / llms.txt / manifest probes and the link HEADs
--base <url>        dist: the public origin, so absolute URLs can be judged
--dist              force dist mode for a folder
```

Exit code 0 = sight clear, 1 = sight obscured, 2 = usage.

In `dist/` mode every HTML file is scanned; the first N are reported in
full and the rest contribute only failures, grouped (one line per kind with
example paths). Pages carrying `noindex` are treated as deliberately hidden:
they are never reported as orphans or sitemap gaps and their paths are never
printed.

## Local preview

Serve the build (`python -m http.server 4399 -d dist`) and scan
`http://127.0.0.1:4399`. Absolute URLs that name the production host (the
sitemap, hreflang, canonicals) are fetched from the local server; the
https / www checks are skipped.

## As a Claude skill

This repository is also a skill: `SKILL.md` tells Claude when to run the
scanner, how to read the report and in which order to fix things;
`reference/build-rules.md` holds the rules to write by (give it to whoever
writes the templates, human or assistant, before the first page);
`reference/visibility.md` is the long-form guide. Copy the folder to
`~/.claude/skills/senrigan` or add it to your project's skills.

## Limits

- It reads the HTML that is served. It does not execute JavaScript, so
  client-rendered content is invisible to it — as it is, at first, to most
  crawlers.
- It does not measure rankings, traffic, Core Web Vitals in the field or
  anything Search Console knows. Run it before deploy; read Search Console
  after.
- Title and description lengths are character counts; Google truncates by
  pixel width.
- Keyword analysis is a heuristic, with a simple Greek stemmer; it points,
  it does not judge.
- Only scan sites you own or are allowed to test.

## Licence

- Code (`bin/`, `package.json`) and `SKILL.md`: [MIT](LICENSE).
- The guide `reference/visibility.md`: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) —
  reuse and adapt it freely, credit **kappa.yashi** and link to the source.
