# senrigan (千里眼) — build output scan of /home/claude/site/kappayashi-site-main/dist

**67 pass · 9 warn · 6 fail · 19 info** — SIGHT OBSCURED — fix the ✖ items, then scan the live site.


## Root assets

- ! 58 indexable HTML route(s) not in the sitemap
  `/el/about · /el · /el/lab · /el/lab/media-controls · /el/lab/separator · /el/lab/session-manager · /el/lab/wallpapers · /el/lab/workspace-switcher`

## Structure

- ! /: 14/14 <img> without width+height — layout shift (CLS)
- ! /el: 14/14 <img> without width+height — layout shift (CLS)
- ! /lab: 5/5 <img> without width+height — layout shift (CLS)

## Head & rendering

- ! /txt: no meta description — snippet will be guessed from the page
- ✖ /txt: no rel="canonical"

## Structure

- ✖ /txt: no <h1>

## Machine-readable & social

- ! /txt: no JSON-LD — no rich results, no entity for the knowledge graph
- ! /txt: no Open Graph tags — shares fall back to whatever the platform scrapes

## Semantic (--semantic)

- ! /txt: top terms: engineer(6) linux(6) explor(5) digital(5) music(5) — 0/5 echoed in the title, 0/5 in the h1 → possible intent mismatch: the title promises something the text is not about

## Head & rendering

- ! /tags: description is 288 chars — truncated around 155–160
- ✖ 248 more page(s): no rel="canonical"
  `/txt/el · /txt/tags · /txt/about · /txt/el/tags · /txt/tags/ai · /txt/el/about · … 242 more`

## Structure

- ✖ 448 more page(s): no <h1>
  `/txt/el · /tags/ai · /tags/gnu · /tags/idm · /tags/x11 · /txt/tags · … 442 more`
- ✖ 1 more page(s): 2 <h1> elements: "Το Χρονικό του Πυρήνα, οι Διανομές & Το ", "Η Σύμπραξη (1991 - 1993): Ο Πυρήνας συνα"
  `/el/posts/chronicle-kernel-distros-ai-paradox`

## Links & network

- ✖ 1 internal link(s) point to no file in the output
  `/version → /el/version/`
