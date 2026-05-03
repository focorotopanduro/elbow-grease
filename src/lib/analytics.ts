import { getSessionId } from './session';

/**
 * Analytics — FIRST-PARTY ONLY.
 *
 * ════════════════════════════════════════════════════════════════
 *   POLICY: NO THIRD-PARTY TRACKERS. EVER.
 * ════════════════════════════════════════════════════════════════
 * This file MUST NOT be modified to send events to:
 *   - Google Analytics (gtag.js / Google Tag Manager)
 *   - Meta Pixel (fbq, Facebook Conversions API)
 *   - TikTok Pixel
 *   - LinkedIn Insight Tag
 *   - Hotjar / FullStory / Mouseflow (session replay)
 *   - Any "marketing tag" / CDP / customer-data platform that
 *     forwards visitor data outside our infrastructure.
 *
 * The reasoning is moral, not technical:
 *   Beit Building Contractors collects analytics ONLY to operate
 *   the lead-gen service (measure whether ads bring engaged
 *   visitors; spot pages that bounce; debug funnel friction).
 *   We do not need — and refuse to enable — third-party companies
 *   building cross-site profiles of our visitors using our page
 *   as a data source.
 *
 * If you find yourself wanting Google/Meta data: use their
 * dashboards on YOUR ads (the ad platforms know who clicked their
 * own ads without needing a pixel on our page). Optimize ads via
 * those platforms' attribution; optimize the site via our
 * first-party events.
 * ════════════════════════════════════════════════════════════════
 *
 * PRIVACY POSTURE:
 *   - Events go to ONE destination: our own /api/events endpoint
 *     on the same origin (Vercel function we control).
 *   - No persistent cross-session identifier. Per-tab `session_id`
 *     only, dies when the tab closes.
 *   - Respects Do-Not-Track + Global Privacy Control. If signaled,
 *     `track()` is a hard no-op for the entire session.
 *   - No PII in any payload. The form-submit event includes only
 *     a random `confirmation_id` (a receipt with no embedded data),
 *     never the actual name/phone/ZIP.
 *
 * What we DO track (anonymous, first-party, per-tab):
 *   - Page views (which surface mounted)
 *   - Form lifecycle: started / submitted / abandoned (no field-level)
 *   - Engagement: qualified visit, scroll depth
 *   - Errors: chunk-load failures, page errors, web vitals
 *   - CTA clicks (placement only, no destination URL params)
 *
 * What we INTENTIONALLY DON'T track:
 *   - Per-field blur events (was overkill + felt surveillance-y)
 *   - User name / phone / ZIP in the analytics payload
 *   - Persistent visitor identification across sessions
 *   - IP addresses (Vercel edge sees them for rate-limit; never stored)
 *
 * Both vendor adapters are NO-OPS when their global is missing, so
 * adding/removing a tracker is a one-line CMS change rather than a
 * code deploy. The funnel events themselves are stable across
 * vendors — same event name, same payload schema everywhere.
 *
 * Funnel events for the hurricane lead capture:
 *   - `sim_view_mobile`           : MobileLeadCapture mounted
 *   - `sim_view_desktop`          : Full sim mounted
 *   - `sim_form_start`            : User focused the first field
 *   - `sim_form_field_blur`       : Field validation tick (per field)
 *   - `sim_form_submit_attempt`   : Submit clicked (incl. invalid attempts)
 *   - `sim_form_submit_success`   : Lead actually delivered (HTTP 2xx or mailto fired)
 *   - `sim_form_submit_error`     : Backend rejected + mailto failed
 *   - `sim_desktop_link_copy`     : User tapped "copy desktop link"
 *   - `sim_chunk_load_error`      : Lazy chunk failed to fetch
 *   - `sim_call_now`              : User tapped tap-to-call CTA
 *
 * Each event has a stable shape:
 *   {
 *     name: SimEvent,
 *     ts:   number,                        // Date.now() at fire time
 *     surface: 'mobile' | 'desktop',       // which experience fired it
 *     ...payload                           // event-specific keys
 *   }
 */

// NO third-party tracker globals declared here. The previous version
// declared Window.gtag and Window.fbq to support optional GA4 + Meta
// Pixel tags. Removed in the privacy pivot — see policy header above.

export type SimEvent =
  // Hurricane sim funnel (deferred but events stay in the schema for
  // when the sim re-launches; analytics endpoint accepts them already).
  | 'sim_view_mobile'
  | 'sim_view_desktop'
  | 'sim_form_start'
  | 'sim_form_field_blur'  // RESERVED — kept in type for back-compat but no longer fired
  | 'sim_form_submit_attempt'
  | 'sim_form_submit_success'
  | 'sim_form_submit_error'
  | 'sim_desktop_link_copy'
  | 'sim_chunk_load_error'
  | 'sim_call_now'
  | 'sim_qualified_visit'
  // Main-site lead-funnel events (Tier 1.1 wave). Distinct from sim_*
  // so the funnels can be analyzed independently.
  | 'lead_form_start'
  | 'lead_form_submit_attempt'
  | 'lead_form_submit_success'
  | 'lead_form_submit_error'
  | 'lead_form_mailto_fallback'
  | 'lead_form_abandon'
  | 'lead_form_restored'      // user returned to a persisted draft
  | 'page_view'               // top-level page mount, replaces ad-hoc view events
  // Cross-cutting infrastructure
  | 'page_error'
  | 'web_vital'
  | 'scroll_depth'
  | 'cta_click'
  | 'network_offline'
  | 'network_online'
  // Tier 6 — PWA / service worker lifecycle
  | 'sw_install'
  | 'sw_update_available';

export interface TrackPayload {
  /** Which experience surface fired the event (for cohort splitting). */
  surface?: 'mobile' | 'desktop';
  /** Validation status (for field_blur events): 'valid' | 'invalid'. */
  field_status?: 'valid' | 'invalid';
  /** Field name (for field_blur events). */
  field?: string;
  /** Confirmation # generated for the lead (for submit_success). */
  confirmation_id?: string;
  /** Reason string for failures (for submit_error / chunk_load_error). */
  reason?: string;
  /** Free-form metadata for one-off events. */
  [key: string]: unknown;
}

/**
 * Fire a tracking event. Safe to call from any context — silently
 * no-ops on the server / when no tracker is configured.
 */
/**
 * Endpoint for raw beacon delivery (independent of gtag/fbq tags).
 * Fires via `navigator.sendBeacon()` when available, which queues the
 * request for delivery EVEN IF the page is being unloaded — so we
 * never lose the "user clicked CTA → navigated away" event the way
 * a regular fetch() would (browsers cancel in-flight fetches on
 * navigation). Falls back to fetch when beacon is unavailable.
 */
const BEACON_ENDPOINT = '/api/events';

function shouldSendBeacon(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.VITE_ENABLE_DEV_BEACONS === 'true') return true;
  if (['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) {
    return false;
  }
  return !import.meta.env.DEV;
}

function sendBeacon(name: SimEvent, payload: TrackPayload): void {
  try {
    if (!shouldSendBeacon()) return;
    const body = JSON.stringify({ event: name, ...payload });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      // sendBeacon is fire-and-forget + survives unload; queues at the
      // browser network layer immediately and POSTs when network is free
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(BEACON_ENDPOINT, blob);
      return;
    }
    // Fallback: fetch with keepalive (also survives unload on most
    // modern browsers, but more fragile than sendBeacon)
    if (typeof fetch === 'function') {
      void fetch(BEACON_ENDPOINT, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
      }).catch(() => { /* silent — beacon is best-effort */ });
    }
  } catch {
    /* never let analytics break the user experience */
  }
}

/**
 * Do-Not-Track + Global Privacy Control respect.
 *
 * If the browser advertises DNT=1 or GPC=1, EVERY analytics call
 * becomes a no-op for this session. Cached at module load (the
 * setting can't change without a page reload anyway).
 *
 * Note: Apple Safari removed `navigator.doNotTrack` in 2019 because
 * it was used as a fingerprinting vector. We check it anyway for the
 * minority of browsers that still expose it. The newer Global Privacy
 * Control signal (`navigator.globalPrivacyControl`) is the modern
 * equivalent + has legal weight in some US states (CA, CO).
 */
function isDoNotTrackOn(): boolean {
  if (typeof navigator === 'undefined') return false;
  // Global Privacy Control — modern signal
  if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true) {
    return true;
  }
  // Legacy DNT — '1' or 'yes' (some older browsers)
  const dnt =
    (navigator as Navigator & { doNotTrack?: string }).doNotTrack ??
    (window as Window & { doNotTrack?: string }).doNotTrack;
  return dnt === '1' || dnt === 'yes';
}
const DNT_ON = typeof window !== 'undefined' ? isDoNotTrackOn() : false;

/**
 * Client-side rate limiter — protects against runaway tracking calls.
 * If a single event name fires more than RATE_BURST times in
 * RATE_WINDOW_MS, subsequent calls are dropped silently. Prevents:
 *   - A buggy scroll listener firing the same event 1000×/sec
 *   - A retry loop hammering the beacon endpoint
 *   - Malicious code from a compromised dependency flooding GA4
 *     (which would burn quota + look suspicious in the dashboard)
 *
 * The limiter is per-event-name, not global — so an interaction
 * burst on one CTA doesn't stop unrelated events from firing.
 * Counters reset every RATE_WINDOW_MS, so legitimate slow rates
 * are unaffected.
 */
const RATE_WINDOW_MS = 5_000;
const RATE_BURST = 30;
const eventCounts = new Map<SimEvent, { count: number; windowStart: number }>();

function isRateLimited(name: SimEvent): boolean {
  const now = Date.now();
  const entry = eventCounts.get(name);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    eventCounts.set(name, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_BURST;
}

export function track(name: SimEvent, payload: TrackPayload = {}): void {
  if (typeof window === 'undefined') return;

  // PRIVACY: respect Do-Not-Track / Global Privacy Control. The user
  // said no — we say nothing. Hard return; no event reaches gtag,
  // fbq, or our own beacon.
  if (DNT_ON) return;

  // Field-blur tracking removed in the privacy pivot (was overkill +
  // surveillance-y). Keep the type member for back-compat but no-op
  // any attempts to fire it from older callers.
  if (name === 'sim_form_field_blur') return;

  // Drop if this event has fired too many times in the rate window
  if (isRateLimited(name)) return;

  const enriched: TrackPayload = {
    ...payload,
    ts: Date.now(),
    // session_id only — no persistent visitor_id. Funnel is
    // attributed per-visit, not per-person. The session id dies
    // when the tab closes.
    session_id: getSessionId(),
  };

  // FIRST-PARTY ONLY — beacon to our own /api/events endpoint.
  // No gtag, no fbq, no third-party trackers. See the policy header
  // at the top of this file for the reasoning. Future PRs that
  // re-add Google/Meta/etc trackers should be REJECTED.
  sendBeacon(name, enriched);

  // Dev console — the build strips this in production
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[analytics]', name, enriched);
  }
}

/**
 * Generate a short user-friendly confirmation ID for lead receipts.
 * Format: `BBC-{epoch36}-{rand36}` → "BBC-LZ4G7K-A8X2".
 * Deterministic neither side wants — just a recognizable receipt.
 */
export function generateConfirmationId(): string {
  const epoch = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BBC-${epoch}-${rand}`;
}
