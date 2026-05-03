# SEO Rollout — 13-Phase Build Summary

This document summarises the complete autonomous SEO build executed across 13 phases. Use it as the master reference for what's already shipped (everything code-side) vs what's still pending (real-world content the owner provides).

**Validation commands:**

```bash
npm run check:nap        # Verify NAP consistency across all on-site files
npm run build:sitemap    # Regenerate public/sitemap.xml from manifest + MDX
npm run build:blog-routes # Regenerate per-post HTML files from MDX
npx tsc -b               # TypeScript type-check
npm run build            # Full production build (runs prebuild → tsc → vite)
```

---

## Phase 1 — Technical SEO foundation

**Files created:**
- `src/data/site-routes.json` — single-source-of-truth route manifest
- `src/data/routes.ts` — typed wrapper + helper functions
- `src/components/SEO.tsx` — declarative head injection (per-route title/description/canonical/OG/Twitter)
- `scripts/build-sitemap.mjs` — sitemap generator from manifest

**Files updated:**
- `public/sitemap.xml` — auto-generated, now lists 12 indexable routes
- `public/robots.txt` — tightened (added `/admin`, `/assets`, blocked aggressive scrapers)
- `package.json` — `prebuild`, `build:sitemap`, `build:blog-routes` scripts

## Phase 2 — OpenGraph + Twitter Card

Absorbed into the SEO component built in Phase 1. Per-route OG title/description/image/url + Twitter `summary_large_image` injection. Default OG image (`/og-image.jpg`) verified at 1200×630.

## Phase 3 — Schema.org LocalBusiness foundation

**Files created:**
- `src/data/business.ts` — canonical NAP, founder, hours, areaServed (13 cities/counties), licenses, services, sameAs pipeline
- `src/data/schemas/local-business.ts` — 7-entity `@graph`: Organization, multi-type LocalBusiness+RoofingContractor+GeneralContractor, Place, Person founder, WebSite, ImageObject logo, ImageObject primaryimage
- `src/data/schemas/index.ts` — barrel exports
- `src/components/JsonLd.tsx` — declarative head injection with cleanup

**Files updated:**
- `src/App.tsx` — mounts comprehensive schema graph
- `index.html` — static schema fallback updated for non-JS crawlers

## Phase 4 — Service + Review schema

**Files created:**
- `src/data/reviews.ts` — 3 real testimonials, single source of truth
- `src/data/schemas/services.ts` — per-service Service entities with `hasOfferCatalog`, capability Offers, audience PeopleAudience, eligibleRegion
- `src/data/schemas/reviews.ts` — `AggregateRating` linked to LocalBusiness via `@id`, per-Review entities

**Files updated:**
- `src/sections/Testimonials.tsx` — refactored to source from `reviews.ts`, added aggregate rating display
- `src/sections/Testimonials.css` — added `.testimonials__aggregate*` styling
- `src/data/schemas/local-business.ts` — `aggregateRating` ref by `@id`

## Phase 5 — FAQ section + FAQPage schema

**Files created:**
- `src/data/faqs.ts` — 12 sales-grade Q&As (insurance, inspection, timeline, warranty, license verification, hurricane emergency, service area, financing, estimate process, payment, scope, why-Beit)
- `src/sections/FAQ.tsx` — full WAI-ARIA accordion (Up/Down/Home/End keyboard nav, `inert` on closed panels)
- `src/sections/FAQ.css` — cream-themed styling with grid 0fr→1fr smooth height transitions
- `src/data/schemas/faq.ts` — FAQPage with Q/A entities

**Files updated:**
- `src/App.tsx` — FAQ section mounted between Testimonials and Contact

## Phase 6 — Per-city page template

**Files created:**
- `src/data/cities/types.ts` — CityData interface
- `src/data/cities/orlando.ts` — placeholder Orlando data (replaced in Phase 7)
- `src/data/cities/index.ts` — CITIES barrel + `getCityBySlug` helper
- `src/data/schemas/breadcrumbs.ts` — reusable `buildBreadcrumbList`
- `src/data/schemas/city.ts` — WebPage + BreadcrumbList + City + service-area Place
- `src/pages/CityPage.tsx` — CityHero / CityServices / CityWhyUs / CityProjects / Testimonials (filtered) / FAQ (filtered) / CityMap
- `src/pages/CityPage.css` — cream/dark alternating sections
- `src/pages/city-mount.tsx` — generic entrypoint
- `orlando-roofing.html` — Vite MPA entry

**Files updated:**
- `vite.config.ts` — Orlando registered, Phase-8 cities prepped
- `src/data/site-routes.json` — Orlando flipped to `live`
- `src/sections/FAQ.tsx` — props-driven (faqs, eyebrow, titleNode, leadNode, sectionId)
- `src/sections/Testimonials.tsx` — props-driven (reviews, eyebrow, titleNode)
- `src/data/schemas/faq.ts` + `reviews.ts` — accept filtered subsets

## Phase 7 — Orlando real content

**Files updated:**
- `src/data/cities/orlando.ts` — production content: 3-paragraph intro (Florida climate / local-vs-storm-chaser / two-license advantage), 4 polished why-us pillars, 4 service highlights with neighborhood references (Audubon Park, Lake Nona, Conway, MetroWest, Avalon Park), 15 alphabetised neighborhoods, hurricane risk note (Ian + Nicole 2022), FAQ ids audited (project-timeline replaces service-area)
- `vercel.json` — CSP updated: `frame-src https://www.google.com` + maps `img-src` allowed for Map embed

**Files created:**
- `docs/orlando-photo-todo.md` — full photo brief (folder layout, naming convention, image specs, per-tile capture briefs)

## Phase 8 — Winter Park, Oviedo, Oviedo Storm Damage

**Files created:**
- `src/data/cities/winter-park.ts` — historic-home angle (Park Ave, Olde Winter Park, slate/cedar/clay)
- `src/data/cities/oviedo.ts` — family-suburban / Seminole County angle (~25-min response, school-district)
- `src/data/cities/oviedo-storm-damage.ts` — emergency 24/7 angle (mitigation-first, claim docs, carrier mediation)
- `winter-park-roofing.html`, `oviedo-roofing.html`, `oviedo-storm-damage.html` — per-city HTML entries
- `docs/city-photo-todo.md` — consolidated photo brief

**Files updated:**
- `src/data/cities/types.ts` — added `primaryCtaHref` / `secondaryCtaHref` for storm-damage phone-first CTA
- `src/pages/CityPage.tsx` — uses CTA href overrides
- `src/data/cities/index.ts` — all 4 cities registered
- `vite.config.ts` — all 4 city HTMLs registered
- `src/data/site-routes.json` — 3 new cities flipped to `live`
- `oviedo-storm-damage.html` static schema includes `@type: EmergencyService` + 24/7 hours

## Phase 9 — Blog infrastructure (MDX)

**Dependencies added:**
- `@mdx-js/rollup`, `remark-frontmatter`, `remark-mdx-frontmatter`, `rehype-slug`, `@types/mdx`

**Files created:**
- `src/types/mdx.d.ts` — module-style declarations + `PostFrontmatter` interface
- `src/data/blog.ts` — Post[] from `import.meta.glob`, helpers (`getPostBySlug`, `getPostsByCategory`, `getRelatedPosts`, etc.)
- `src/data/schemas/article.ts` — BlogPosting + BreadcrumbList + Blog index graph
- `src/pages/BlogIndex.tsx/css` — listing with category filter
- `src/pages/BlogPost.tsx/css` — hero + auto-TOC with IntersectionObserver scroll-spy + prose typography + related posts + end-of-post CTA
- `src/pages/blog-mount.tsx` — generic entrypoint
- `src/content/blog/welcome.mdx` — placeholder post
- `blog.html` — index entry
- `scripts/build-blog-routes.mjs` — per-post HTML generator with frontmatter parser

**Files updated:**
- `vite.config.ts` — MDX plugin, dynamic `discoverBlogPostEntries()`
- `scripts/build-sitemap.mjs` — auto-merges live MDX posts
- `src/data/site-routes.json` — `/blog` flipped to `live`

## Phase 10 — Flagship blog post (hurricane insurance claim)

**Files created:**
- `src/content/blog/florida-hurricane-roof-insurance-claim-guide.mdx` — ~3,200 words, 11 sections, 5 Beit Tip callouts, real F.S. citations (627.70131, 627.7011, 626.9744), real DBPR licenses, real carrier names (Citizens Property Insurance), recent storms (Ian, Nicole, Idalia)
- `docs/blog-photo-todo.md` — per-post photo brief

## Phase 11 — Evergreen content plan + post #1 (materials guide)

**Files created:**
- `docs/blog-content-plan.md` — 8-post evergreen roadmap (priority-ordered with target keyword, volume/difficulty tier, outline, internal-link targets, photo brief shorthand for each)
- `src/content/blog/florida-roofing-materials-guide-2026.mdx` — ~2,150 words covering tile/shingle/metal/flat membrane, decision matrix, maintenance, Central FL 2026 cost ranges, 4 Beit Tip callouts, real codes (FBC 7th Ed, ASCE 7-22, ASTM D7158, UL 2218), real brands (GAF, Owens Corning, CertainTeed, Westlake Royal, Eagle, Crown, McElroy, MBCI, ATAS, Pac-Clad)

## Phase 12 — Google Business Profile + site integration

**Files created:**
- `docs/google-business-profile-setup.md` — full claim → verify → operate playbook
- `docs/review-request-templates.md` — English + Spanish + SMS templates, FTC-compliant, no review-gating
- `scripts/nap-audit.mjs` — regex-based NAP drift detection across 12 files

**Files updated:**
- `src/data/business.ts` — `GBP_URL` constant + auto-prepend SAME_AS pipeline
- `src/sections/Footer.tsx` — conditional "View us on Google" link
- `package.json` — `check:nap` script wired

## Phase 13 — Citation infrastructure (this phase)

**Files created:**
- `docs/citations-master-list.md` — 50 prioritised FL roofing citations (S/A/B/Florida-specific/Niche)
- `docs/citations-tracker.csv` — pre-populated tab-separated tracker
- `docs/seo-rollout-summary.md` — this document

**Files updated:**
- `src/data/business.ts` — `_STATIC_SAME_AS` documented as the citation onboarding pipeline
- `scripts/nap-audit.mjs` — extended with optional citation HTTP audit (reads `docs/citations-live.json` if present)

---

## Sitemap final state

12 indexable routes, 0 drafts:

- `/` (priority 1.0)
- `/privacy.html`, `/terms.html`, `/accessibility.html` (priority 0.3)
- 4 city pages: `/orlando-roofing`, `/winter-park-roofing`, `/oviedo-roofing`, `/oviedo-storm-damage` (priority 0.9)
- `/blog` (priority 0.7)
- 3 blog posts: `/blog/florida-hurricane-roof-insurance-claim-guide`, `/blog/florida-roofing-materials-guide-2026`, `/blog/welcome` (priority 0.7)

---

## What still requires the owner

The autonomous build shipped every file the codebase needs. The remaining work is real-world content + external execution:

### Content the owner provides

1. **Real project photos** — see `docs/orlando-photo-todo.md`, `docs/city-photo-todo.md`, `docs/blog-photo-todo.md`. The runtime renders graceful "Photo coming soon" placeholders until photos land at the documented paths.
2. **Real customer reviews with source attribution** — Phase 12 (GBP claim) brings in real Google reviews; once verified, add `datePublished` + `source` + `sourceUrl` fields to entries in `src/data/reviews.ts`.
3. **Subsequent evergreen blog posts (#2-8)** — drafted on cadence per `docs/blog-content-plan.md`. Each takes ~2-4 hours to draft + 30 min to publish.

### External actions the owner takes

1. **Claim Google Business Profile** — postcard-verified, 5-14 day wait. See `docs/google-business-profile-setup.md`. After verification, set `GBP_URL` in `src/data/business.ts`.
2. **Submit S-tier citations** (6 sources, ~4 hours total). See `docs/citations-master-list.md`. Track in `docs/citations-tracker.csv`.
3. **Submit A-tier citations** (10 sources, ~4 hours total). Same playbook.
4. **Quarterly B-tier batch** (~2 hours/quarter).
5. **Florida-specific membership applications** (FRSA, Orlando Chamber, Seminole Chamber, Oviedo Chamber). Each has an annual fee — pursue based on local-search ROI.
6. **Niche roofing programs** opportunistically (GAF Master Elite, etc.) when install volume justifies the application work.

### Ongoing maintenance

- **Weekly:** GBP post (1/week recommended for ranking)
- **Weekly:** Reply to every review (positive + negative) within 48h
- **Monthly:** Review GBP analytics; refresh photos
- **Quarterly:** B-tier citation batch; NAP audit (`npm run check:nap`)
- **Annually (May):** Refresh pre-storm reference photos; update blog posts with current code references

---

## Success metrics to track (90 days post-deploy)

| Metric | Source | Baseline | Target (90d) |
| --- | --- | --- | --- |
| Google Business Profile views | GBP dashboard | (post-claim) | grow 50% over 90d |
| Direct calls from GBP | GBP dashboard | (post-claim) | 5+/week |
| Organic search clicks | Google Search Console | current | +25% |
| Top-10 rankings — branded queries | GSC | (current) | 100% own brand keywords |
| Top-10 rankings — local commercial | GSC | (current) | "roofing Orlando", "roofing Winter Park" → top 10 |
| Reviews on GBP | GBP dashboard | 0 | 10+ verified |
| Citation count | citations tracker | 0 | 25+ live |

Set up Google Search Console (`https://search.google.com/search-console`) and Bing Webmaster Tools immediately after deploying — both are free and let you monitor ranking + impression data per query.
