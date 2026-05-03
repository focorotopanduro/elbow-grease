# Beit Building Website — 9-Tier Build Summary

End-to-end audit of every change shipped across the 9-tier optimization roadmap.
Use this doc to onboard new contributors, hand off to the owner for action items,
or reference what's automated vs. what still needs hands-on work.

**Site:** https://www.beitbuilding.com
**Stack:** React 18 + Vite 5 + TypeScript MPA · Vercel deploy · Vercel KV (Upstash)
**Build status:** ✅ `tsc -b` clean · ✅ `vite build` clean · ✅ `npm run check:nap` clean
**Build date:** 2026-04-27

---

## Tier overview at a glance

| Tier | Theme | Key deliverable | Status |
| --- | --- | --- | --- |
| 1.1 | Lead form persistence | localStorage TTL + cross-tab sync | ✅ |
| 1.2 | Mobile sticky CTA | Bottom-bar Call+Quote on ≤720px | ✅ |
| 1.3 | Booking widget | Calendly/Cal.com dual-provider | ✅ |
| 1.4 | Before/after slider | Pointer + keyboard + a11y | ✅ |
| 1.5 | Credentials wall | 6-card trust-signal section | ✅ |
| 2 | SEO foundation | LocalBusiness schema, citations, blog plan, sitemap | ✅ |
| 3 | Performance | Lazy-load, native Web Vitals, CLS budgets | ✅ |
| 4 | Conversion polish | A/B framework + form abandonment + persistence | ✅ |
| 5 | Trust + authority | Project portfolio + modal + awards + guarantees | ✅ |
| 6 | PWA + mobile | Manifest, SW, offline page, install prompt | ✅ |
| 7 | Insights | CSP hardening, global errors, analytics summary | ✅ |
| 8 | Automation | Slack/Discord webhooks, review cron, photo pipeline | ✅ |

---

## Tier 1 — Lead conversion (5 sub-tiers)

### Tier 1.1 · Form persistence + abandonment

**What shipped:**
- `src/hooks/useFormPersistence.ts` — localStorage with TTL + cross-tab `storage` event sync, per-form key namespacing.
- `src/hooks/useFormAbandon.ts` — `pagehide` + `sendBeacon` fires `lead_form_abandon` when user leaves with non-empty form.
- `src/sections/Contact.tsx` refactored to controlled inputs with both hooks wired in. "(saved)" indicators show when restoration happened and field is still untouched.

**Owner-visible behavior:** if a user fills 60% of the form, navigates away, then returns within 24h, their data is still there. Abandonment events also flow into `/api/events` so you can quantify drop-off.

### Tier 1.2 · Mobile sticky CTA

**What shipped:**
- `src/components/MobileStickyCta.tsx` + `.css` — fixed bottom bar, only renders ≤720px viewport.
- IntersectionObserver auto-hides when Contact section enters viewport (avoids button stacking).
- Two buttons: gold Call (tel:) + cream Get Quote (anchor to `#contact`).

**No owner action needed.**

### Tier 1.3 · Booking widget

**What shipped:**
- `src/components/BookingWidget.tsx` + `.css` — dual-provider Calendly OR Cal.com with `detectProvider()`.
- Lazy-loads each provider's script via dynamic `<script>` injection on first mount.
- 4-state machine (`idle` | `loading` | `ready` | `booked`).
- postMessage listeners for `calendly.event_scheduled` + `cal:bookingSuccessful` → fires `booking_completed` analytics event.
- Returns `null` when neither `VITE_CALENDLY_URL` nor `VITE_CALCOM_URL` is configured (fail-closed).

**Owner action:** if you want online scheduling, sign up for Calendly OR Cal.com, paste the embed URL into Vercel env vars (`VITE_CALENDLY_URL` or `VITE_CALCOM_URL`), and redeploy. CSP allowlist for both providers is already in `vercel.json`.

### Tier 1.4 · Before/after image slider

**What shipped:**
- `src/components/BeforeAfterSlider.tsx` + `.css` — pointer events with `setPointerCapture`, full keyboard a11y (Arrow ±5%, Shift+Arrow ±10%, PageUp/Down ±25%, Home/End).
- WAI-ARIA slider role with `aria-valuenow`/`aria-valuetext`.
- CSS `clip-path: inset(...)` for the before-image overlay.
- `src/sections/BeforeAfterGallery.tsx` + `.css` — section with 3 placeholder pairs, auto-fit grid, dark theme.

**Owner action:** source 3+ before/after photo pairs (per `docs/before-after-todo.md`), drop into `public/images/before-after/`, register in `BeforeAfterGallery.tsx`. Pipeline in `docs/photo-pipeline.md`.

### Tier 1.5 · Credentials wall

**What shipped:**
- `src/sections/CredentialsWall.tsx` + `.css` — 6 credential cards (CCC1337413, CGC1534077, FL Licensed, Insured+Bonded, 12+ Years Local TODO, Bilingual EN/ES).
- IntersectionObserver fires `credentials_viewed` once per session.
- Custom inline SVG icons (no external icon font, no extra requests).
- `src/components/AwardsRow.tsx` + `.css` — 6-entry registry with `live: boolean` honesty flag (ONLY Florida-Licensed is `live: true`; FRSA/GAF Master Elite/Owens Corning/BBB/NRCA are `live: false` with TODO notes — they will not render until earned).
- `src/components/GuaranteeChip.tsx` + `.css` — 3 visual variants (gold/cream/orange) for inline guarantee/warranty mentions.

**Owner action:** when you join FRSA, become a GAF Master Elite, BBB-accredit, etc., flip the corresponding entry's `live: false` → `true` in `AwardsRow.tsx`. The card will appear automatically. **Do not flip a flag until the credential is real.**

---

## Tier 2 — SEO foundation (prior chain)

### Schema + structure
- `src/components/JsonLd.tsx` — generic JSON-LD emitter.
- `src/data/schemas/business.ts` — LocalBusiness + RoofingContractor + GeneralContractor entity graph with both license numbers, address, phone, geo coordinates, business hours.
- `src/data/schemas/city.ts` — per-city Service schemas for Orlando, Winter Park, Oviedo, Kissimmee, Sanford.
- `src/data/schemas/faq.ts`, `breadcrumb.ts`, `review.ts`, `blog.ts` — schema helpers per page type.
- `src/components/SEO.tsx` — per-page `<title>` / meta / canonical / OG tags.

### Sitemap + crawl
- `scripts/build-sitemap.mjs` — generates `public/sitemap.xml` from declared routes + cities + blog posts. Runs in `prebuild`.
- `scripts/build-blog-routes.mjs` — discovers `.mdx` posts, generates HTML entry per post for the Vite MPA build.
- `public/robots.txt` — sitemap reference + crawl rules.

### Local SEO content
- `src/pages/cities/*.tsx` — Orlando, Winter Park, Oviedo, Kissimmee, Sanford pages with localized hero, neighborhoods, and city-specific service mentions.
- `src/pages/blog/*.mdx` (planned per `docs/blog-content-plan.md`) — MDX pipeline configured in `vite.config.ts` with `@mdx-js/rollup` + `remark-frontmatter` + `remark-mdx-frontmatter` + `rehype-slug`.

### Owner-action docs
- `docs/google-business-profile-setup.md` — step-by-step GBP claim, NAP consistency, photo upload, post cadence.
- `docs/citations-master-list.md` — S-tier directories (Yelp / BBB / Angi / Houzz / FRSA / etc.) ranked by impact.
- `docs/blog-content-plan.md` — 12-post topical-cluster plan with target keywords + outlines.
- `docs/review-request-templates.md` — English + Spanish post-job review-request copy (used by the Tier 8 cron).
- `docs/seo-rollout-summary.md` — what shipped vs. what owner does.
- `docs/orlando-photo-todo.md` + `docs/city-photo-todo.md` + `docs/blog-photo-todo.md` — photo briefs per page type.

### NAP consistency check
- `scripts/nap-audit.mjs` — scans the codebase for phone, address, license numbers and reports any divergence. Owner runs `npm run check:nap` before each deploy. Currently 19 files scanned, all consistent.

**Owner action:**
1. Claim GBP per `docs/google-business-profile-setup.md` (~30 min).
2. Submit S-tier citations per `docs/citations-master-list.md` (~2 hours over a week).
3. Verify ownership in Google Search Console + Bing Webmaster Tools (per `docs/search-console-setup.md`).
4. Submit `https://www.beitbuilding.com/sitemap.xml`.
5. Source photos per the three photo-todo docs.
6. Pick 3-4 top-priority blog posts from `docs/blog-content-plan.md` and start drafting.

---

## Tier 3 — Performance

**What shipped:**
- `src/lib/webVitals.ts` — native `PerformanceObserver` capturing LCP, CLS, INP, FCP, TTFB. NO `web-vitals` npm dep (saves ~5kB). Reports via `sendBeacon` to `/api/events`.
- Lazy-loading via `React.lazy` + `Suspense` in `App.tsx`:
  - **Eager:** Hero, Services, SolutionsGrid, ServiceFeatures, About, Stats, Testimonials, Contact (above-the-fold or LCP-critical).
  - **Lazy:** BeforeAfterGallery, ProjectPortfolio, CredentialsWall, FAQ, BookingWidget.
- `DeferredFallback` component with explicit `height={N}` per section to prevent CLS on first lazy mount.
- Image lazy loading: `<img loading="lazy" decoding="async">` on every below-fold image.
- Self-hosted fonts in `public/fonts/` with `font-display: swap` to remove the third-party FOIT.

**Verification:**
- `docs/performance-baseline.md` — LCP/CLS/INP targets per device class. Baseline: home page main bundle dropped 27kB → 20.5kB after lazy split.
- Run `npm run analytics:summary` post-launch to see real-user Web Vitals distribution.

**Owner action:** none — this tier is fully shipped and self-monitoring once analytics traffic accrues.

---

## Tier 4 — Conversion polish

**What shipped:**
- `src/lib/experiments.ts` — first-party A/B test framework. FNV-1a session-deterministic variant assignment, sessionStorage cache, URL `?exp_<id>=<variant>` override for QA. NO third-party split testing dep.
- `src/sections/Hero.tsx` wired to `useExperiment('hero_cta_copy_v1')` with 3 variants. Tracked impressions + clicks include `:${variant}` suffix on the CTA event name (so the analytics-summary script can attribute per-variant conversion).
- `useFormPersistence` + `useFormAbandon` (also Tier 1.1) — partially-completed forms persist 24h; abandonment fires telemetry.
- Confirmation ID generator in Contact form: `BBC-<6char>-<3char>` displayed inline on submit success.
- `getCallWindowText()` shows "We'll call you within ~30 minutes" on weekday business hours, "next business morning" otherwise.
- Pulse animation on the first unfilled required field after first submit attempt (CSS `@keyframes pulse-required`).

**Owner action:** the active experiment is `hero_cta_copy_v1` — let it run ~14 days post-launch, then check `npm run analytics:summary` for the winning variant. Set the winning variant as the only entry in `EXPERIMENTS` to ship it permanently.

`docs/experiments.md` — how to add new experiments, override variants for QA, archive completed experiments.

---

## Tier 5 — Trust + authority

**What shipped:**
- `src/data/projects.ts` — `ProjectEntry` type + 6 placeholder entries + helpers (`filterProjects`, `getProjectsSorted`, `getProjectBySlug`, `getAvailableServices`, `getAvailableCities`, `labelForService`, `labelForCity`, `formatProjectDate`).
- `src/sections/ProjectPortfolio.tsx` + `.css` — two filter rows (services + cities), card grid, lazy-mounted, fires `view_project` + `filter_change` events.
- `src/components/ProjectModal.tsx` + `.css` — full a11y dialog: `role="dialog"`, `aria-modal`, focus trap with Tab/Shift+Tab edge cycling, Escape closes, Arrow Left/Right navigates between projects, body scroll lock, `returnFocusRef` pattern.
- Modal embeds `BeforeAfterSlider` when both `beforeImage` + `afterImage` exist.
- Modal sidebar: `<dl>` with date/location/service/tags + "Get a Quote Like This" CTA pre-filling `#contact?service=...&location=...`.
- `src/data/reviews.ts` extended with `photoUrl?`, `verifiedBadge?: 'google'|'facebook'|'bbb'|null`, `projectType?` (all back-compat optional).
- `src/sections/Testimonials.tsx` renders new fields conditionally — photo avatar variant, verified pill color-tinted by source, project-type tag at top of card.

**Owner action:**
- Source 6+ real project photos per `docs/projects-photo-todo.md` and `docs/photo-pipeline.md`. Run `npm run optimize-images -- --source <folder> --city <slug> --slug <project-slug>`.
- Replace the 6 placeholder `ProjectEntry` records in `src/data/projects.ts` with real ones (slug, title, neighborhood, city, completedDate, summary, paths to optimized images).
- Backfill `photoUrl` + `verifiedBadge` on existing reviews where you have a Google/BBB review URL.

---

## Tier 6 — PWA + mobile

**What shipped:**
- `public/manifest.webmanifest` — rewritten from sim-scoped to main-site: `name: "Beit Building Contractors"`, `start_url: "/"`, `scope: "/"`, `display: "standalone"`, `theme_color: "#07060a"`, 3 shortcuts (Free Inspection / Call / Browse Services).
- `public/sw.js` — hand-rolled service worker, NO Workbox. `VERSION = 'BBC_CACHE_v1'`, network-first for HTML, cache-first for static assets, network-only for `/api/*`, FIFO 50-entry runtime cache, `skipWaiting` + `clients.claim`, install resilient (cache.add per URL with `.catch` swallow so a single 404 doesn't kill the whole precache).
- `public/offline.html` — branded offline fallback with prominent gold tel: button, "Try again" link, network-disconnect SVG.
- `src/components/InstallPrompt.tsx` + `.css` — dual-path: Web/Android single-tap install via existing `usePWAInstall` hook + iOS Safari Add-to-Home-Screen hint with Share+Plus icons. 5-second engagement delay before render. Suppression: offline / installed / dismissed-this-session (web) / dismissed-ever (iOS, localStorage).
- `src/main.tsx` PROD-only SW registration after `window.load`:
  ```ts
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => track('sw_install', { ... }))
        .catch(err => track('page_error', { source: 'sw_register', ... }));
    });
  }
  ```

**Verification:** Lighthouse PWA audit should pass installability checks. Visit on mobile Safari → tap Share → Add to Home Screen → app launches in standalone mode.

**Owner action:** none — PWA self-deploys with the next push.

---

## Tier 7 — Insights + hardening

**What shipped:**
- `src/lib/globalErrors.ts` — `installGlobalErrorHandlers()` captures `window.onerror` + `unhandledrejection` and reports via `sendBeacon` to `/api/events` as `page_error`.
- `vercel.json` — Content-Security-Policy header with strict allowlist:
  - `default-src 'self'`
  - `script-src` allows Calendly + Cal.com (Tier 1.3) + Web3Forms (front-end form fallback).
  - `connect-src` allows `/api/*` + Web3Forms + maps APIs.
  - `img-src 'self' data: https:` (broad for now — tighten when image inventory stabilizes).
  - **Blocked:** Google Analytics, Facebook Pixel, Hotjar, all third-party trackers (per first-party-only policy).
- `scripts/analytics-summary.mjs` — reads recent events from KV, prints aggregate funnel: page views → CTAs → form starts → submissions → confirmations. Per-experiment-variant breakdown if any active.
- `docs/analytics-events.md` — full event-name registry with payload shapes.
- `src/components/PageErrorBoundary.tsx` — React error boundary on each page entry; renders branded fallback + reports to `/api/events`.

**Owner action:** run `npm run analytics:summary` weekly post-launch to spot regressions or experiment winners.

---

## Tier 8 — Automation

### Lead routing — Slack + Discord

**What shipped:**
- `api/_lib/webhooks.ts`:
  - `sendSlack()` — Block Kit format with tel: link, escapeSlack helper, 5s timeout via AbortController.
  - `sendDiscord()` — embed format with brand-gold `#d4af37` accent, structured fields, message truncated to 1024 chars (Discord limit), 5s timeout.
  - `dispatchLead()` — parallel fan-out via `Promise.all`. Both opt-in via `SLACK_LEADS_WEBHOOK` / `DISCORD_LEADS_WEBHOOK` env vars; missing var = silent no-op.
- `api/leads.ts` — replaced commented Slack/Resend example block with actual `await dispatchLead({...})` call. Existing infra (KV storage, IP rate limiting, phone rate limiting, dedup, validation, 202 response) preserved.

**Owner action:**
1. Per `docs/lead-routing.md` § Slack: add an Incoming Webhook in Slack, copy URL → set `SLACK_LEADS_WEBHOOK` in Vercel env vars → redeploy.
2. Per `docs/lead-routing.md` § Discord: add a webhook in Discord channel settings, copy URL → set `DISCORD_LEADS_WEBHOOK` → redeploy.
3. Test via the curl in `docs/lead-routing.md` § Verifying webhooks in production.
4. (Optional) Sign up for Twilio + add SMS path per `docs/lead-routing.md` § Twilio. ~$2-4/mo.

### Review-request automation

**What shipped:**
- `api/cron/send-review-requests.ts` — Vercel cron stub:
  - Bearer auth (`timingSafeStringEqual` against `CRON_SECRET`).
  - Window: leads with `completion_date` in `[now-5d, now-2d]`.
  - `BATCH_LIMIT = 50` per run.
  - Status: STUB until lead lifecycle schema lands (status / completion_date / lang / reviewRequested fields).
  - Idempotent: `reviewRequested: true` flag prevents duplicate sends.
  - Logs structured no-op report `{ ok, eligibleCount, attemptedCount, sentCount, failedCount, durationMs, stub }`.
- `vercel.json` `crons[]` extended with `{ "path": "/api/cron/send-review-requests", "schedule": "0 14 * * *" }` (10am ET / 14:00 UTC daily).

**Owner action:** before this cron does real work, three things need to happen (see file header for code skeleton):
1. Extend lead schema in `/api/leads.ts` to include lifecycle fields.
2. Build a tiny admin UI (or CRM integration) for the owner to flip a lead's status as work progresses.
3. Configure an email provider (Resend/SendGrid/SES) and wire `EMAIL_FROM` + `EMAIL_API_KEY` env vars. Recommended: Resend for the cleanest API.
4. Set `CRON_SECRET` env var (any cryptographically random 32-byte string).

Until then, the cron runs cleanly, finds no eligible leads, and logs a no-op. **It will not send accidental emails.**

### Photo upload pipeline

**What shipped:**
- `scripts/optimize-images.mjs` — Sharp pipeline. CLI: `--source --city --slug --max-width [1600] --quality-jpg [84] --quality-webp [82] --verbose`. Validates `--city` against the project's city set (`orlando | winter-park | oviedo | kissimmee | sanford | other`).
- Outputs both `.jpg` (mozjpeg, progressive) and `.webp` (effort 5) to `public/images/projects/<city>/<slug>-<filename>.<ext>`.
- Auto-rotates via EXIF.
- Resizes max 1600px wide, aspect preserved, no upscaling.
- `package.json` scripts: `"optimize-images": "node scripts/optimize-images.mjs"`.

**Owner workflow** (per `docs/photo-pipeline.md`):
```bash
npm run optimize-images -- \
  --source "/path/to/Beit Photos/2026-04-22 — Audubon Park" \
  --city orlando \
  --slug audubon-park-tile-restoration
```
Then update `src/data/projects.ts` with the new `ProjectEntry`. Vercel auto-deploys on push.

### Wrap-up docs
- `docs/photo-pipeline.md` — capture → curate → optimize → register → deploy.
- `docs/lead-routing.md` — Slack / Discord / Twilio / SendGrid setup walkthroughs + verification curl + privacy notes.

---

## Aggregate metrics

| Category | Count |
| --- | --- |
| Total tier deliverables | 9 |
| New components | 11 (BookingWidget, BeforeAfterSlider, MobileStickyCta, ProjectModal, AwardsRow, GuaranteeChip, InstallPrompt, plus tier-2 SEO/JsonLd) |
| New sections | 4 (BeforeAfterGallery, CredentialsWall, ProjectPortfolio + Tier-2 city pages) |
| New hooks reused | 4 (useFormPersistence, useFormAbandon, usePWAInstall, useNetworkStatus) |
| New libs | 5 (analytics, webVitals, experiments, globalErrors, callWindow, session) |
| New API endpoints / handlers | 3 (leads.ts updated, events.ts existing, cron/send-review-requests.ts new) |
| New scripts | 5 (build-sitemap, build-blog-routes, nap-audit, analytics-summary, optimize-images) |
| New docs | 16 (this file + 15 others in `docs/`) |
| Third-party trackers added | **0** (first-party-only policy enforced) |
| `live: false` honesty flags | 5 awards / 6 placeholder projects (will not render until real) |

---

## Validation commands

Run before every deploy:

```bash
npm run check:nap        # NAP consistency audit (currently 19 files clean)
tsc -b                   # TypeScript build, exit 0 expected
npm run build            # Vite build, exit 0 expected (also runs prebuild = sitemap + blog routes)
```

Run weekly post-launch:

```bash
npm run analytics:summary   # real-user funnel + Web Vitals + experiment variants
```

Run after each new project:

```bash
npm run optimize-images -- --source <folder> --city <slug> --slug <project-slug>
```

---

## Owner next-action list (priority order)

### This week
1. **Deploy.** Push to main; Vercel auto-deploys. Verify live at https://www.beitbuilding.com.
2. **Claim GBP** per `docs/google-business-profile-setup.md` — biggest single SEO lift.
3. **Configure lead webhooks** — `SLACK_LEADS_WEBHOOK` + `DISCORD_LEADS_WEBHOOK` env vars in Vercel. Per `docs/lead-routing.md`. Real-time lead alerts within 3 seconds of submission.
4. **Set CRON_SECRET** — any 32-byte random string. Without it the purge-leads + review-request crons fail closed.
5. **Submit sitemap** to Google Search Console + Bing Webmaster Tools per `docs/search-console-setup.md`.

### This month
6. **Source 5-8 real project photos** for the portfolio per `docs/photo-pipeline.md`. Run `npm run optimize-images`. Replace placeholder entries in `src/data/projects.ts`.
7. **Source 3+ before/after pairs** per `docs/before-after-todo.md` for `BeforeAfterGallery`.
8. **Submit S-tier citations** per `docs/citations-master-list.md` — ~2 hours over a week, big local-search lift.
9. **Backfill review fields** — add `photoUrl` + `verifiedBadge` to existing reviews in `src/data/reviews.ts`.
10. **Pick a booking tool** — Calendly free or Cal.com free tier. Set `VITE_CALENDLY_URL` or `VITE_CALCOM_URL` env var.

### When ready
11. **Earn awards.** When you join FRSA / become GAF Master Elite / BBB-accredit, flip the `live: false` → `true` in `src/components/AwardsRow.tsx`. Card appears automatically.
12. **Wire SMS alerts** via Twilio per `docs/lead-routing.md` — ~$2-4/mo, 30-second notification for storm-season lead spikes.
13. **Wire review-request emails** — extend lead schema, add Resend/SendGrid, replace stub in `api/cron/send-review-requests.ts`.
14. **Write blog posts** from `docs/blog-content-plan.md` — start with the 3-4 highest-priority topical clusters.
15. **Run experiment 14 days post-launch** — check `npm run analytics:summary` for `hero_cta_copy_v1` winner. Promote winning variant by reducing `EXPERIMENTS[0].variants` to just the winner.

### Things you should NOT do
- ❌ Add Google Analytics, Facebook Pixel, Hotjar, or any third-party tracker. The first-party telemetry pipeline is intentionally complete.
- ❌ Flip an `AwardsRow` `live` flag for an award you haven't actually earned. Honesty policy.
- ❌ Commit `.env.local` or paste secrets into source. Use Vercel env vars.
- ❌ Skip the NAP audit. `npm run check:nap` before every deploy. Inconsistent NAP across pages tanks local SEO.

---

## Appendix — file map

```
src/
  components/
    BookingWidget.tsx               (Tier 1.3)
    BeforeAfterSlider.tsx           (Tier 1.4)
    MobileStickyCta.tsx             (Tier 1.2 / 4)
    ProjectModal.tsx                (Tier 5)
    AwardsRow.tsx                   (Tier 5)
    GuaranteeChip.tsx               (Tier 1.5)
    InstallPrompt.tsx               (Tier 6)
    SEO.tsx, JsonLd.tsx             (Tier 2)
    PageErrorBoundary.tsx           (Tier 7)
  sections/
    Hero.tsx                        (wired to A/B in Tier 4)
    Contact.tsx                     (refactored Tier 1.1 / 4)
    BeforeAfterGallery.tsx          (Tier 1.4)
    CredentialsWall.tsx             (Tier 1.5)
    ProjectPortfolio.tsx            (Tier 5)
    Testimonials.tsx                (extended Tier 5)
  hooks/
    useFormPersistence.ts           (Tier 1.1 / 4)
    useFormAbandon.ts               (Tier 1.1 / 4)
    usePWAInstall.ts                (existing, used Tier 6)
    useNetworkStatus.ts             (existing, used Tier 6)
  lib/
    analytics.ts                    (sendBeacon → /api/events)
    webVitals.ts                    (Tier 3)
    experiments.ts                  (Tier 4)
    globalErrors.ts                 (Tier 7)
    callWindow.ts                   (Tier 4)
    session.ts                      (sessionId stable across tabs)
  data/
    projects.ts                     (Tier 5)
    reviews.ts                      (extended Tier 5)
    schemas/                        (Tier 2)
  pages/
    cities/                         (Tier 2)
    blog/                           (Tier 2 + content plan)
api/
  leads.ts                          (Tier 8 dispatchLead wired)
  events.ts                         (first-party telemetry sink)
  _lib/
    webhooks.ts                     (Tier 8)
    kv.ts, security.ts, logger.ts   (existing infra reused)
  cron/
    purge-leads.ts                  (existing, Bearer auth)
    send-review-requests.ts         (Tier 8 stub)
public/
  manifest.webmanifest              (Tier 6, rewritten)
  sw.js                             (Tier 6)
  offline.html                      (Tier 6)
  sitemap.xml                       (Tier 2, generated)
  robots.txt                        (Tier 2)
scripts/
  build-sitemap.mjs                 (Tier 2)
  build-blog-routes.mjs             (Tier 2)
  nap-audit.mjs                     (Tier 2)
  analytics-summary.mjs             (Tier 7)
  optimize-images.mjs               (Tier 8)
  optimize-logos.mjs                (existing)
  verify-licenses.mjs               (existing)
docs/
  build-summary-tier1to8.md         (this file)
  google-business-profile-setup.md  (Tier 2)
  citations-master-list.md          (Tier 2)
  blog-content-plan.md              (Tier 2)
  review-request-templates.md       (Tier 2 / 8)
  search-console-setup.md           (Tier 2)
  seo-rollout-summary.md            (Tier 2)
  orlando-photo-todo.md             (Tier 2)
  city-photo-todo.md                (Tier 2)
  blog-photo-todo.md                (Tier 2)
  before-after-todo.md              (Tier 1.4)
  performance-baseline.md           (Tier 3)
  analytics-events.md               (Tier 7)
  experiments.md                    (Tier 4)
  projects-photo-todo.md            (Tier 5)
  photo-pipeline.md                 (Tier 8)
  lead-routing.md                   (Tier 8)
vercel.json                         (CSP + crons)
package.json                        (scripts + deps)
```

---

*End of build summary. The autonomous chain ends at Tier 8. No further `ScheduleWakeup` will fire.*
