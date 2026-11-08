# senrigan build rules

Rules for whoever (or whatever) writes the templates of a static site that
will be checked with `senrigan`. Paste this into the assistant at the start of
the project, or keep it next to the repo. Every rule maps to a check; a site
built by these rules passes `senrigan ./dist` and `senrigan <url>` with nothing
left to fix.

Reference stack: Astro, static output. The rules are stack-agnostic.

## The principle

A crawler reads the served HTML once, top to bottom, without running your
JavaScript, and decides from that what the page is about, whether it is the
canonical copy, and whether it is worth keeping. Every page must answer those
three questions in its `<head>` and its heading skeleton, by itself, with no
help from the rest of the site.

## DO — every page

- One `<html lang="…">` with the page's language (BCP 47: `en`, `el`,
  `en-GB`). Bilingual sites: the attribute changes per route.
- `<meta name="viewport" content="width=device-width, initial-scale=1">`.
  Never `user-scalable=no` or `maximum-scale=1`.
- One `<title>`, 15–60 characters, unique per page, the page's own name
  first and the site name last (`Post title · site`). Never the site name
  alone on inner pages.
- One `<meta name="description">`, 50–160 characters, unique per page,
  written for a human reading a results page. Fall back to the summary, then
  the site default; never leave it empty on an indexable page.
- One `<link rel="canonical">`, absolute, `https`, the same host as the
  site, pointing at the page itself — including the trailing-slash form you
  chose. Translated pages are not duplicates: each canonical points at its
  own language version, and hreflang does the linking.
- A trailing-slash policy, chosen once, applied everywhere: canonicals,
  sitemap, internal links, redirects. Mixed styles cost a redirect hop per
  link and split signals between two URLs.
- Exactly one `<h1>`, the visible title of the page. A logo or wordmark in an
  `<h1>` is fine only on the home page and only with an accessible name
  (`aria-label` on the SVG, `alt` on the image).
- Headings descend one level at a time: `h1 → h2 → h3`. The first heading
  after the `h1` is an `h2`. A heading that exists for layout only is a
  `<p>` or a `<div>`, not an empty `<hN>`.
- Markdown content starts at `##`: the `#` level belongs to the template's
  `<h1>`. Enforce it in the CMS field hint and strip a leading `#` at build.
- Every `<img>` has `alt` (`alt=""` when decorative) and `width` + `height`.
  Everything below the fold gets `loading="lazy" decoding="async"`; the hero
  stays eager, ideally `fetchpriority="high"`.
- Internal links use root-relative paths in the policy style (`/posts/x/`),
  never the absolute URL of a staging host, never `rel="nofollow"`.
- Anchor text names the destination. Not "click here", "here", "read more",
  "εδώ", "κλικ", "περισσότερα". A link that wraps only an image takes the
  image's `alt`; an icon link gets `aria-label`.
- External links that open a new tab carry `rel="noopener noreferrer"`.
- All resources `https://`. Not one `http://` in `src`, `href`, `srcset`,
  CSS `url()` or JSON-LD.
- Content in the served HTML. If a block is rendered by JavaScript, render
  it at build instead, or accept that crawlers index it last or never.

## DO — indexing

- Index what has its own copy. `noindex, follow` on: search results, 404,
  `/version`, pagination beyond page 1 when the pages carry nothing unique,
  thank-you pages, text-only mirrors of pages that already exist.
- A tag / category page is indexable when it has its own title,
  description and an `<h1>` with the tag name; otherwise `noindex, follow`.
- A page with `noindex` is not in the sitemap. A page in the sitemap is
  indexable, answers 200 at exactly the listed URL (no redirect), and is
  linked from somewhere on the site.
- `noindex` goes in a `<meta name="robots">` or an `X-Robots-Tag` header,
  never in `robots.txt` (a blocked page cannot be read, so its `noindex`
  cannot be seen either).

## DO — site-wide files

- `robots.txt` with a `Sitemap:` line carrying the absolute sitemap URL.
  Block crawling only of what must not be fetched; never `Disallow` an
  admin path (that is kekkai's rule, it holds here too).
- One sitemap (or index) with every indexable URL on the canonical host, in
  the policy slash style, with `<lastmod>` only when it is a real content
  date — omit it rather than stamp the build time on every entry.
- Multilingual: every language version is its own `<url>` entry (or an
  `xhtml:link` set), not an afterthought behind a redirect.
- `favicon.ico` (any size, it is requested blindly), `apple-touch-icon.png`
  at the root (180×180), a `<link rel="icon">` set and a web manifest that
  all answer 200.
- Optional `llms.txt`: an H1, a blockquote summary, markdown links that
  resolve, served as `text/plain` or `text/markdown`.

## DO — structured data and social

- One JSON-LD `@graph` per page, `@context: "https://schema.org"`, with:
  `WebSite` (name, url) and the publisher `Person`/`Organization` (name,
  url, logo/image, `sameAs`) on every page; `WebPage` /
  `CollectionPage` / `AboutPage` for the page type; `BreadcrumbList` on
  every inner page (positions from 1, `name` and `item` on every element
  but the last); `BlogPosting`/`Article` on posts with `headline`,
  `datePublished`, `dateModified`, `author`, `image`, `inLanguage`,
  `mainEntityOfPage`.
- Structured data describes the visible page: `headline` equals the `<h1>`
  (or is a shorter form of it), `datePublished` equals the `<time
  datetime>` the reader sees, the image is the one on the page.
- `og:title`, `og:description`, `og:image` (absolute, https, 1200×630, with
  `og:image:alt`), `og:url` equal to the canonical, `og:type` (`website` /
  `article`), `og:locale`; `twitter:card` (`summary_large_image` when there
  is an image).

## DON'T

- No second `<h1>` from the content, the sidebar, the footer or a widget.
- No heading used as a label for UI chrome ("saved", "share", "menu") —
  use a `<p>`, a `<span>` or `aria-label`.
- No canonical to the home page from every inner page, no relative
  canonical, no canonical with a query string.
- No `<meta name="robots" content="noindex">` on templates shared by
  content pages "just for now".
- No sitemap entries for redirects, 404s, noindex pages, staging hosts.
- No `Disallow: /` left over from staging.
- No `rel="nofollow"` on your own links, no `nofollow` in the robots meta
  of indexable pages.
- No `http://` anywhere in the output.
- No images without dimensions; no `alt` that repeats the filename.
- No `rel="next"`/`prev` as the only pagination signal: pages 2+ need real
  links in the HTML.
- No structured data for things not on the page (reviews, FAQs, events
  that are not visibly there).
- No title or description generated by concatenating every tag; no two
  pages sharing either.
