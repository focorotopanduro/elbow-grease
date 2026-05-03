# Analytics Event Taxonomy

Every event the Beit Building Contractors website fires through the first-party analytics layer. Use this as the reference when querying logs, building dashboards, or interpreting funnel data.

## Privacy posture (review before adding events)

- **First-party only** — events flow from `src/lib/analytics.ts` → `navigator.sendBeacon` → `/api/events` Vercel function → log sink. NO third-party trackers (no GA4, no Meta Pixel, no Hotjar). The policy comment at the top of `analytics.ts` is the source of truth; PRs that re-add a third-party tracker should be REJECTED.
- **Per-tab session id only** — `s1-LZ4G7K-A8X2K9` format, dies when the tab closes. No persistent visitor identifier across sessions.
- **DNT/GPC respected** — `navigator.doNotTrack === '1'` or `navigator.globalPrivacyControl === true` makes every `track()` call a hard no-op for the session.
- **Rate-limited** — 30 events of the same name per 5-second window per session, dropped client-side beyond that.
- **PII-stripped server-side** — `/api/events` drops any `name`/`email`/`phone`/`address`/etc fields before logging (defense-in-depth even if the client ever forgets).

---

## Funnel sequence

The canonical conversion funnel for the home page + city pages:

```
page_view
   │
   ▼
qualified_visit  (after 30 sec engaged time — useQualifiedVisit hook)
   │
   ▼
scroll_depth     (25/50/75/100% milestones — startScrollDepthTracking)
   │
   ▼
cta_click        (placement-tagged; many variants — see catalogue below)
   │
   ▼
lead_form_start  (first focus on any Contact form field)
   │
   ▼
lead_form_submit_attempt
   │
   ▼
┌──────────────────────────────┐
│ lead_form_submit_success     │   ← qualified lead delivered
│ lead_form_submit_error       │   ← network/backend failure
│ lead_form_abandon            │   ← pagehide before submit
└──────────────────────────────┘
```

For the booking-widget alternative path:

```
cta_click(open_calendar)  →  cta_click(booking_completed)
```

For the blog reading path:

```
page_view (blog index or post)  →  scroll_depth  →  cta_click(book_quote/blog_post_end | call_phone/blog_post_end)
```

---

## Event catalogue

### Site-wide infrastructure

#### `page_view`
- **Triggered:** Every entrypoint mount (home, city, blog index, blog post).
- **Payload:** `{ surface: 'desktop' | 'mobile', route: string, city?: string, blog_slug?: string, blog_category?: string }`
- **Business meaning:** Primary impression metric. The denominator for every funnel rate.

#### `web_vital`
- **Triggered:** Once per metric per page load when the observation window closes (`pagehide` / `visibilitychange` to hidden).
- **Payload:** `{ metric: 'LCP'|'CLS'|'INP'|'FCP'|'TTFB', value: number, rating: 'good'|'needs-improvement'|'poor' }`
- **Business meaning:** Real-user Core Web Vitals. Track p50/p75/p90. Google Search ranking penalises the p75.

#### `scroll_depth`
- **Triggered:** Once per session at 25/50/75/100% scroll milestones.
- **Payload:** `{ depth_pct: 25|50|75|100 }`
- **Business meaning:** Engagement quality signal. Visitors who hit 75%+ are top-of-funnel-converted; ad campaigns whose visitors only hit 25% have a creative-fit problem.

#### `network_offline` / `network_online`
- **Triggered:** Browser online/offline event listeners (via `useNetworkStatus`).
- **Payload:** `{}`
- **Business meaning:** Diagnostic. Helps explain spikes in `lead_form_submit_error` events.

#### `page_error`
- **Triggered:** Unhandled promise rejection or window error caught by `installGlobalErrorHandlers()`.
- **Payload:** `{ source: 'unhandledrejection'|'window_error', reason: string, filename?: string, line?: number, col?: number }`
- **Business meaning:** Production error monitoring. Alert on rate change > 2x baseline.

---

### Lead-form funnel (Contact section)

#### `lead_form_restored`
- **Triggered:** Mount of Contact.tsx when a saved draft was restored from localStorage. Also fires (with `cleared: true`) when the user clicks "Clear & start over."
- **Payload:** `{ surface: 'desktop' | 'mobile', cleared?: true }`
- **Business meaning:** Measures how often the form-persistence feature is rescuing returning visitors.

#### `lead_form_start`
- **Triggered:** First field focus on the Contact form (once per session).
- **Payload:** `{ surface: 'desktop' | 'mobile' }`
- **Business meaning:** Form-engagement rate. `lead_form_start / page_view` is the conversion funnel's first non-trivial step.

#### `lead_form_submit_attempt`
- **Triggered:** Submit button click on the Contact form (regardless of validation state).
- **Payload:** `{ surface, email_valid: boolean }`
- **Business meaning:** `lead_form_submit_attempt / lead_form_start` measures form completion. `email_valid: false` ratio reveals validation friction.

#### `lead_form_submit_success`
- **Triggered:** Web3Forms backend returns `success: true`.
- **Payload:** `{ surface, confirmation_id: 'BBC-XXXX-XXXX' }`
- **Business meaning:** **The primary conversion event.** Match the `confirmation_id` to the email-delivered lead receipt for end-to-end tracing.

#### `lead_form_submit_error`
- **Triggered:** Backend returned non-success OR network threw.
- **Payload:** `{ surface, reason: string }` (reason capped at 500 chars)
- **Business meaning:** Funnel-loss diagnostic. Alert if `lead_form_submit_error` exceeds 2% of `lead_form_submit_attempt`.

#### `lead_form_abandon`
- **Triggered:** `pagehide` event fired with form having content AND `submittedRef.current === false`.
- **Payload:** `{ surface, reason: 'abandoned' }`
- **Business meaning:** "Almost-converted" pool. Visitors who hit this are the highest-value retargeting cohort if/when retargeting is added.

---

### CTA clicks (`cta_click`)

Single event name with `cta` + `placement` payload fields. Sub-types catalogued below; each fires via `trackCta(cta, placement)` from `src/lib/interactions.ts`.

#### Phone, email, directions

| `cta` | `placement` | Where it fires |
| --- | --- | --- |
| `call_phone` | `floating_cta` | FloatingCTA orange button |
| `call_phone` | `footer` | Footer phone link |
| `call_phone` | `contact_section` | Contact section phone channel |
| `call_phone` | `blog_post_end` | Blog post end-CTA phone |
| `email` | `footer` | Footer email link |
| `email` | `contact_section` | Contact section email channel |
| `directions` | `footer` | Footer Maps link |
| `directions` | `contact_section` | Contact section address link |
| `whatsapp` | `floating_cta` | FloatingCTA WhatsApp button |
| `view_gbp` | `footer` | Footer "View us on Google" (renders only when GBP_URL set) |

#### Hero / Nav / Section CTAs

| `cta` | `placement` |
| --- | --- |
| `book_quote` | `hero_primary` |
| `explore_services` | `hero_secondary` |
| `scroll_to_services` | `hero_scroll` |
| `book_quote` | `blog_post_end` |
| `book_quote` | `city_hero_primary:<slug>` (slug-suffixed) |
| `call_phone` | `city_hero_primary:<slug>` (when storm-damage page uses tel: as primary) |
| `book_quote` | `city_hero_secondary:<slug>` |

#### Booking widget

| `cta` | `placement` |
| --- | --- |
| `open_calendar` | `booking_widget` (with `provider: 'calendly'|'cal-com'`) |
| `booking_completed` | `booking_widget` (postMessage from embed) |

#### Trust signals

| `cta` | `placement` |
| --- | --- |
| `before_after_drag` | `before_after_slider` (debounced — once per slider per render) |
| `credentials_viewed` | `credentials_wall` (IntersectionObserver, once per session) |
| `credentials_<id>` | `credentials_wall` (per-card click — `credentials_ccc-license`, `credentials_cgc-license`, etc.) |

---

### Reserved / legacy

#### `sim_*` family (deferred hurricane simulator)
The `sim_view_mobile`, `sim_view_desktop`, `sim_form_start`, `sim_form_submit_*`, `sim_call_now`, `sim_qualified_visit`, `sim_chunk_load_error`, `sim_desktop_link_copy` events remain in the SimEvent type for back-compat but are NOT fired by the live site (the simulator is in /src/HurricaneUpliftPage.tsx but excluded from production builds). When the simulator re-launches, these events go live without code changes.

#### `sim_form_field_blur`
RESERVED but never fired — kept in the type so older clients don't crash if they call it. The privacy pivot removed per-field tracking as overkill.

---

## Querying events

### Storage destination (current state)

Events flow from the browser → `/api/events` → `logger.info('event', { body })` → Vercel's runtime log stream → Vercel CLI / Vercel Dashboard log viewer. There is **no warehouse / KV sink yet**.

For queryable analytics, wire one of:

- **Vercel KV** (Redis-compatible, fast, ~$10/mo for typical small-business volume)
- **Vercel Postgres** (relational, can JOIN with leads table, ~$10-30/mo)
- **Logflare or BetterStack** (managed log sinks, drop-in, queryable via SQL)
- **ClickHouse Cloud** (best for high-volume analytics queries, more expensive)

The choice depends on volume. For Beit's expected ~1000-5000 events/day, Vercel KV or Postgres is sufficient. ClickHouse only justifies once you cross ~10k events/day.

Once a sink is wired, update `api/events.ts` to write there instead of (or in addition to) `log.info`. Then update `scripts/analytics-summary.mjs` to read from it.

### Manual review (interim)

Until a sink is wired:

```bash
# Stream events from Vercel logs in real time
npx vercel logs --follow

# Filter to events only
npx vercel logs --follow | grep '"source":"api/events"'
```

For ad-hoc queries, copy a chunk of log lines into a file and use `jq`:

```bash
cat events.log | jq -r 'select(.body.event=="lead_form_submit_success") | .ts'
```

---

## Adding a new event

1. Add the event name to the `SimEvent` union in `src/lib/analytics.ts`.
2. Decide if it has structured payload fields. If yes, document them in this file under a new heading.
3. Fire via `track('your_event_name', { ... })` or `trackCta('cta-name', 'placement')`.
4. Verify in dev console — `import.meta.env.DEV` mode prints `[analytics] your_event_name { ... }` so you can confirm the payload shape before deploy.
5. Update `docs/analytics-events.md` (this file) so future humans know what the event means.

## Removing / renaming events

The analytics endpoint accepts any event name client-side, but the SimEvent union is the canonical list. Removing an event is a 2-step:

1. Stop firing it in code (delete the `track()` call sites).
2. Remove the union member after a deprecation window of 30 days minimum (clients with stale bundles may still fire it). Old events get silently rate-limited; they don't break anything.

Renames work the same — fire BOTH the old and new event for 30 days, then drop the old.
