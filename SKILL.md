---
name: senrigan
description: "senrigan (千里眼) — static site visibility & structure check, and the build rules that make a site pass it. Two uses — (1) BUILDING: when starting or extending a static site (Astro or similar), when writing the head template, the page templates, the sitemap, the structured data or the i18n routing, apply reference/build-rules.md while writing the code; (2) CHECKING: scan a live URL or a dist/ folder for title/description/canonical/hreflang, heading hierarchy, images, link topology, sitemap and robots consistency, JSON-LD and Open Graph, then fix in the guide's order. Use before a site goes live, after any change to the head template, the content model or the sitemap, or when asked \"is this site SEO-ready?\" / \"why is this page not indexed?\"."
---

# senrigan (千里眼) — static site visibility & structure check

*Senrigan* is the eye that sees a thousand miles. This skill looks at a
static site the way a crawler does — served HTML, no JavaScript, one page at
a time — and reports what the machines are told, what they are told twice,
and what they are not told at all.

It is the sister of **kekkai** (結界). kekkai checks that the build discloses
nothing about how the site is made; senrigan checks that it discloses
everything about what the site *is*. Both run before a release; they never
contradict each other (a canonical, a sitemap and structured data are
content, not disclosure).

## Scope

- Static output (Astro is the reference) on any host. The checks are
  framework-agnostic.
- The scan is read-only: GETs on pages and root files, HEADs on a sample of
  links. Only scan sites you own or are allowed to test.
- Not covered: rankings, traffic, field Core Web Vitals, anything that needs
  Search Console or a rendering browser.

## Two modes

**Building.** Whenever the work is *writing* the templates of a static site
(new project, new page type, the head component, the sitemap, i18n routes,
the CMS content model), read `reference/build-rules.md` first and write to
it. The rules are DO/DON'T lines, one per check. Do not wait to be asked for
an SEO review; a site written by the rules has nothing to fix later. If a
design decision collides with a rule (a wordmark as the home `<h1>`, an
indexed tag page), satisfy the rule's intent — an accessible name, a unique
description — rather than dropping the check.

**Checking.** The workflow below.

## Workflow

1. **Run the scanner.** It needs Node 18+ and nothing else.

   ```bash
   node bin/senrigan.mjs https://www.example.com                  # live
   node bin/senrigan.mjs ./dist --base https://www.example.com    # build output
   node bin/senrigan.mjs ./dist --base https://www.example.com --pages 20 --semantic --out senrigan.md
   ```

   `--json` for machine output, `--summary` for failures and warnings only,
   `--strict` to make warnings fail, `--pages N` to widen the sample,
   `--semantic` for the keyword / title overlap, `--out report.md` to keep
   the report. A local preview (`http://127.0.0.1:…`) works: production
   URLs found in the sitemap and hreflang are fetched from the local server.

   If the skill was installed without the script, fetch it from
   `https://github.com/kappa-yashi/senrigan` (`bin/senrigan.mjs`, zero
   dependencies) or run `npx github:kappa-yashi/senrigan <target>`.

2. **Read the report top to bottom.** `✖` is a failure, `!` a weakness worth
   a decision, `·` a fact. Exit code 1 means sight is obscured. In `dist/`
   mode repeated failures are grouped (`248 more page(s): no canonical`):
   one template is wrong, not 248 pages — fix the template.

3. **Fix in this order** (later steps depend on earlier ones):
   1. one URL per page: host, https, trailing slash, canonical (guide PART 1)
   2. the indexing matrix: what is indexed, what is `noindex`, what is in
      the sitemap — the three must agree (PART 2)
   3. the head template: lang, title, description, viewport, hreflang (PART 3)
   4. the heading skeleton and images, in the templates and in the content
      rules (PART 4)
   5. link topology: broken, orphan, nofollow, anchor text, mixed content
      (PART 5)
   6. structured data and social cards, cross-checked against the visible
      page (PART 6)
   7. root files: robots, sitemap, icons, llms.txt (PART 7)
   8. semantic pass per important page, by hand, with `--semantic` as a hint
      (PART 8)

4. **Verify against the live response, then against Search Console.** After
   deploy, run the live scan again; then request indexing for the changed
   URLs and read the coverage report a few days later. The scanner says
   what the page tells the crawler; Search Console says what the crawler did
   with it.

## How to read the important findings

| finding | what it means | fix |
|---|---|---|
| canonical points at a file | an image URL was pasted into the canonical / alternate field | the canonical is the page's own URL; the image goes in og:image |
| canonical is a URL that redirects here | `/human` declared, `/human/` served (or `.html` vs clean URL) — the canonical never answers 200 | align canonical, sitemap and links with what the host actually serves |
| `lang` disagrees with the title's script | language declared wrong, or a title copied across languages | lang from the route; translate the title |
| `<h1>` is a sentence | the first paragraph sits in the heading | the name of the thing in the `<h1>`, the sentence in a `<p>` |
| article page without Article schema | the page's JSON-LD is only the business entity | add `BlogPosting`/`Article` with headline = h1, dates, author, image |
| N/N pages: … — site-wide | the template, not the pages | fix it once; the bracketed hint names the platform setting |
| `noindex` yet listed in the sitemap | you ask for indexing and refuse it in the same breath | drop it from the sitemap, or remove the noindex |
| utility page indexable | `/search`, `/version`, `/404` compete with real pages | `noindex, follow` in the template |
| N more pages: no canonical / no h1 | a whole route family shares a template without them | fix the template; text-only mirrors get a canonical to the HTML page or `noindex` |
| canonical not self-referencing | the page tells Google another URL is the real one | per-page canonical from the route, not a constant |
| canonical ≠ served path by a slash | two URLs, one page, a redirect per link | choose the policy; `trailingSlash` in the framework + redirects at the host |
| title / description duplicates another page | the two pages compete; one gets dropped | per-page values from the content, site default only as last resort |
| hreflang not reciprocal | the set is ignored entirely | every language page lists all languages including itself and `x-default` |
| `<html lang>` disagrees with hreflang | mixed signals about the page language | lang from the route's locale |
| 2 `<h1>` / no `<h1>` / h1→h3 jump | the heading skeleton is the outline crawlers and screen readers use | one `<h1>` in the template; content starts at `##`; UI labels are not headings |
| empty heading tag | an outline entry with no text | remove it or give it text |
| `<img>` without alt | invisible to image search and to screen readers | descriptive `alt`; `alt=""` for decoration |
| `<img>` without width/height | layout shift | dimensions from the image pipeline |
| internal links disagree with the slash policy | every click is a 301/308 first | normalise links at build; a lint in the content |
| broken internal link | a dead end for crawlers and readers | fix or remove; dist mode finds them before deploy |
| linked page not in the sitemap | discoverable but not declared (often the second language) | generate the sitemap from the same route list the pages come from |
| orphan route | exists, nothing links to it | link it (nav, related, archive) or remove it |
| generic anchor text | the link carries no meaning about its target | name the destination |
| `http://` resource | blocked as mixed content; `http://` links lose a hop | `https://` everywhere |
| JSON-LD does not parse | all structured data on the page is discarded | fix the syntax (trailing commas, unescaped quotes); generate it, do not hand-write it |
| `headline` ≠ visible `<h1>` | structured data describing a different page | derive both from the same field |
| `datePublished` ≠ visible date | mixed signals; eligible for manual action | one date source |
| BreadcrumbList positions / items wrong | breadcrumb rich result dropped | positions from 1, `item` URL on every element but the last |
| Open Graph missing / `og:image` relative | shares show no card or a broken image | absolute https image, 1200×630, `og:url` = canonical |
| sitemap `<lastmod>` identical everywhere | a build timestamp; Google stops trusting it | real content dates, or no `<lastmod>` |
| sitemap URL blocked by robots.txt | declared and forbidden at once | fix one of the two |
| icon requests failing | silent 404s on every visit | `favicon.ico` + `apple-touch-icon.png` at the root |
| top terms not echoed in title/h1 (`--semantic`) | the title may promise something else | read the page; rewrite the title or the intro, not the keywords |

## Reference

`reference/visibility.md` is the long-form guide (CC BY 4.0): URL policy,
the indexing matrix, the head template, heading and image rules, link
topology, structured data with an Astro `@graph` example, root files, the
semantic pass. Read the part that matches the finding; do not read it all
for a green report.

## What this skill does not do

- It does not execute JavaScript. What a client-side router injects after
  load is invisible to it, and nearly invisible to crawlers at first pass.
- It does not know your rankings or your traffic; it never promises a
  position. It removes the reasons a page would be ignored.
- Lengths are character counts, not pixels. Keyword analysis is a hint.
- It is not kekkai: it says nothing about headers, CSP or disclosure. Run
  both.
