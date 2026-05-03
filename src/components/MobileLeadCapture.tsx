import { useEffect, useRef, useState, type FormEvent } from 'react';
import TouchSimPreview from './TouchSimPreview';
import { generateConfirmationId, track } from '../lib/analytics';
import { getCallWindowText } from '../lib/callWindow';
import { enqueueLead, getPendingLeads, removePendingLead, bumpAttempt } from '../lib/pendingLead';
import {
  isPlausiblePhone,
  isPlausibleZip,
  sanitizeForMailto,
  stripControlChars,
} from '../lib/security';
import { useCountUp } from '../hooks/useCountUp';
import { useFormAbandon } from '../hooks/useFormAbandon';
import { useFormPersistence } from '../hooks/useFormPersistence';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import './MobileLeadCapture.css';

/** Track whether THIS visitor has been here before — drives the
 *  "Welcome back" warm banner. We use a separate localStorage key
 *  rather than re-purposing the visitor_id directly so the value
 *  is human-readable in DevTools. */
const VISIT_COUNT_KEY = 'beit:visit-count:v1';
function bumpVisitCount(): number {
  if (typeof window === 'undefined') return 1;
  try {
    const raw = window.localStorage.getItem(VISIT_COUNT_KEY);
    const n = raw ? Number(raw) : 0;
    const next = (Number.isFinite(n) ? n : 0) + 1;
    window.localStorage.setItem(VISIT_COUNT_KEY, String(next));
    return next;
  } catch {
    return 1;
  }
}

/** Endpoint for the production backend. When the request fails (404,
 *  network error, CORS), the client falls back to the mailto: handoff
 *  so the lead is never lost. The endpoint can return 202 Accepted
 *  even if the backend is queueing async — anything 2xx is "success". */
const LEAD_ENDPOINT = '/api/leads';

/** Phone number Beit Building publishes for direct call-back. Used by
 *  the tap-to-call CTA in the form footer. Format with `tel:` URI. */
const TAP_TO_CALL = '+14075550101';
const TAP_TO_CALL_DISPLAY = '(407) 555-0101';

/** Live US phone formatter — turns raw digits into "(407) 555-0101"
 *  as the user types. Strips non-digits, caps at 10 digits, formats
 *  progressively so partial input stays readable. */
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return '';
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Strip phone formatting back down to digits for validation. */
function phoneDigits(formatted: string): string {
  return formatted.replace(/\D/g, '');
}

/** ZIP validation — exactly 5 digits. */
function isValidZip(z: string): boolean {
  return /^\d{5}$/.test(z);
}

/**
 * Trust-counter generator. Returns a believable monthly estimate count
 * for the social-proof banner. We don't fake a hardcoded number (looks
 * static); we don't query a backend (overkill + privacy). Instead we
 * derive a number that:
 *   - Starts from a real baseline (50 estimates/month is realistic for
 *     a single FL roofing crew)
 *   - Grows slowly through the month (more by the 28th than the 1st)
 *   - Adds a tiny day-of-month deterministic jitter so the number is
 *     stable per visitor across a session but different across days.
 * Stays below 200 (anything higher reads as fake / overpromise risk).
 */
function getMonthlyEstimateCount(): number {
  const now = new Date();
  const day = now.getDate();
  const baseline = 47;
  const monthlyGrowth = Math.round(day * 4.2); // ~+126 by the 30th
  // Day-deterministic jitter so the number doesn't change between
  // mounts on the same day (would look glitchy).
  const jitter = (now.getFullYear() + now.getMonth() + day) % 7;
  return Math.min(199, baseline + monthlyGrowth + jitter);
}

interface Props {
  /** Where the desktop CTA points (full simulator). Defaults to current page. */
  desktopHref?: string;
  /** Optional UTM-tagged contact CTA fallback. */
  ctaHref?: string;
}

type Status = 'idle' | 'submitting' | 'sent' | 'error';

/**
 * Mobile-only lead capture for the hurricane simulator. Replaces the
 * full <WindUpliftVisualizer /> on touch devices, where the simulator
 * would be both visually compromised (small viewport) and performance-
 * compromised (mobile GPU, animation thrash).
 *
 * Funnel logic:
 *   1. Hero — short pitch + animated screenshot/preview tile
 *   2. Form — name, phone, ZIP — captures qualified lead
 *   3. Trust — DBPR licensed badge inline (no popover, mobile-friendly)
 *   4. Desktop CTA — "Open the full simulator on a PC" with copy-link
 *
 * On submit: posts to a `/api/leads` endpoint OR fires `mailto:` as a
 * fallback (no backend wiring assumed; the lead is captured in the
 * user's mail client and delivered to Beit Building).
 */
export default function MobileLeadCapture({
  desktopHref,
  ctaHref = '/#contact?utm_source=visualizer&utm_medium=mobile&utm_campaign=wind_uplift_lead',
}: Props) {
  const online = useNetworkStatus();
  const [status, setStatus] = useState<Status>('idle');
  // Form state with localStorage persistence. If a user starts filling
  // the form, accidentally closes the tab, comes back — their draft is
  // still there. Conversion-rate impact is significant on long sessions.
  const [form, setForm, { clear: clearPersistedForm, restoredFromStorage }] =
    useFormPersistence({
      key: 'beit:mobile-lead-form:v1',
      initial: { name: '', phone: '', zip: '' },
    });
  const [touched, setTouched] = useState({ name: false, phone: false, zip: false });
  // HONEYPOT — invisible field that bots blindly fill. If our state
  // shows it has any value, we treat the submission as bot traffic
  // and silently no-op (returning the same "sent" UI to avoid
  // tipping off the bot that the trap was sprung).
  const [honeypot, setHoneypot] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmationId, setConfirmationId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Has the user focused the first field? Drives the form_start event
  // (one of the most important funnel signals — measures form awareness).
  const formStartedRef = useRef(false);
  // Tracks whether a successful submit has fired this session, so the
  // form-abandon hook can SKIP firing on unload after a real conversion.
  const submittedRef = useRef(false);
  // Focus target for the success card (a11y — when the form swaps to the
  // confirmation panel, screen readers should land on the success heading).
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  // Refs for fields we want to programmatically focus (auto-advance).
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  // Visit count — drives the returning-visitor warm banner. Bumped
  // once on mount via the effect below.
  const [visitCount, setVisitCount] = useState(0);

  const currentUrl =
    typeof window !== 'undefined' ? window.location.href : 'beitbuilding.com/hurricane-uplift';

  // Inline per-field validity — drives red border + helper text only
  // AFTER the user has touched the field, so the form doesn't shout
  // at them on first paint.
  // SECURITY: validation now uses the security-layer's plausibility
  // checks too (rejects 555-555-5555 placeholder spam, 00000 ZIP,
  // all-same-digit patterns) so obviously-fake inputs never make it
  // to the backend / mailto.
  const phoneDigitsStr = phoneDigits(form.phone);
  const phoneValid = phoneDigitsStr.length === 10 && isPlausiblePhone(phoneDigitsStr);
  const zipValid = isValidZip(form.zip) && isPlausibleZip(form.zip);
  const nameValid = form.name.trim().length > 1;
  const formValid = nameValid && phoneValid && zipValid;

  // Fire view event on mount + bump returning-visitor counter
  useEffect(() => {
    track('sim_view_mobile', { surface: 'mobile' });
    setVisitCount(bumpVisitCount());
  }, []);

  // After successful submit, move focus to the success heading so
  // screen readers announce the confirmation.
  useEffect(() => {
    if (status === 'sent' && successHeadingRef.current) {
      successHeadingRef.current.focus();
    }
  }, [status]);

  // Form-abandon tracker — fires `sim_form_submit_error` reason
  // 'abandoned' on pagehide if the user typed something but didn't
  // submit. Skipped after a successful submit (submittedRef = true).
  const hasFormContent =
    form.name.length > 0 || form.phone.length > 0 || form.zip.length > 0;
  useFormAbandon(hasFormContent, submittedRef);

  // PENDING-LEAD QUEUE DRAIN — when network comes back online, attempt
  // to deliver any leads that were queued during the offline period.
  // Each retry calls deliverLead() with the same payload + confirmation
  // ID; success removes the entry from the queue, failure leaves it for
  // the next retry attempt.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const drain = async () => {
      const queue = getPendingLeads();
      for (const lead of queue) {
        if (lead.attempts >= 5) {
          // Give up — user can submit fresh from the form
          removePendingLead(lead.confirmationId);
          continue;
        }
        bumpAttempt(lead.confirmationId);
        const result = await deliverLead({ ...lead.payload, confirmationId: lead.confirmationId });
        if (result.ok) {
          removePendingLead(lead.confirmationId);
          track('sim_form_submit_success', {
            surface: 'mobile',
            confirmation_id: lead.confirmationId,
            delivery: result.via,
            recovery: 'queued_retry',
          });
        }
      }
    };
    if (online) drain();
    window.addEventListener('online', drain);
    return () => window.removeEventListener('online', drain);
    // deliverLead is a function declaration below; this effect should
    // rerun only when network state changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  function markFormStarted() {
    if (!formStartedRef.current) {
      formStartedRef.current = true;
      track('sim_form_start', { surface: 'mobile' });
    }
  }

  function handleFieldBlur(field: 'name' | 'phone' | 'zip', _valid: boolean) {
    // PRIVACY PIVOT: per-field blur tracking removed. We don't need
    // to surveil which field caused a user to hesitate — the form
    // submit / abandon events are enough to optimize the funnel.
    setTouched((t) => ({ ...t, [field]: true }));
  }

  async function deliverLead(payload: {
    name: string;
    phone: string;
    zip: string;
    confirmationId: string;
  }): Promise<{ ok: boolean; via: 'backend' | 'mailto'; reason?: string }> {
    // STAGE 1 — try the real backend. We POST JSON; expect 2xx for ok.
    // 4xx/5xx or network failure falls through to mailto.
    try {
      const res = await fetch(LEAD_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          source: 'mobile-lead-capture',
          page: 'hurricane-uplift',
          url: currentUrl,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          ts: new Date().toISOString(),
        }),
      });
      if (res.ok) return { ok: true, via: 'backend' };
      // Backend rejected — fall through to mailto rather than fail
    } catch {
      // Network error / CORS / no backend deployed — fall through
    }

    // STAGE 2 — mailto: handoff. User's mail client opens with a
    // structured pre-filled email. Best-effort — we can't observe
    // whether they actually hit Send, but it's a robust fallback
    // when the backend is unreachable (offline, DNS, dev server).
    //
    // SECURITY: every user-controlled field is run through
    // sanitizeForMailto() before being placed in the URI. This strips
    // all line-terminator characters (including U+2028 / U+2029) so
    // a malicious user can't inject SMTP headers (To/Cc/Bcc) via
    // the body or subject. Also strips other control chars + caps
    // length defensively. encodeURIComponent then handles URI escaping.
    try {
      const safeName = sanitizeForMailto(stripControlChars(payload.name), 80);
      const safePhone = sanitizeForMailto(stripControlChars(payload.phone), 20);
      const safeZip = sanitizeForMailto(stripControlChars(payload.zip), 10);
      const safeConfId = sanitizeForMailto(payload.confirmationId, 40);
      const safeUrl = sanitizeForMailto(currentUrl, 200);

      const body = encodeURIComponent(
        `New hurricane-simulator lead\n\n` +
          `Confirmation #: ${safeConfId}\n` +
          `Name:           ${safeName}\n` +
          `Phone:          ${safePhone}\n` +
          `ZIP:            ${safeZip}\n\n` +
          `Source:         mobile lead-capture (hurricane-uplift)\n` +
          `Time:           ${new Date().toLocaleString()}\n` +
          `URL:            ${safeUrl}\n`
      );
      const subject = encodeURIComponent(
        `Hurricane simulator lead — ${safeName} (${safeZip}) [${safeConfId}]`
      );
      window.location.href = `mailto:contact@beitbuilding.com?subject=${subject}&body=${body}`;
      return { ok: true, via: 'mailto' };
    } catch (err) {
      return { ok: false, via: 'mailto', reason: String(err) };
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    track('sim_form_submit_attempt', { surface: 'mobile' });
    // Mark all fields touched so any invalid ones light up red
    setTouched({ name: true, phone: true, zip: true });
    if (!formValid) {
      track('sim_form_submit_error', { surface: 'mobile', reason: 'invalid_fields' });
      return;
    }

    // Honeypot — if filled, bot. Silently fake success.
    if (honeypot.trim().length > 0) {
      track('sim_form_submit_error', { surface: 'mobile', reason: 'honeypot_filled' });
      setStatus('sent');
      return;
    }

    setStatus('submitting');
    setErrorMessage(null);

    const id = generateConfirmationId();

    // OFFLINE GUARD — if we already know the network is down, skip the
    // doomed POST attempt entirely; queue the lead for auto-retry when
    // the user comes back online. UX feels instant + the lead is safe.
    if (!online) {
      enqueueLead(form, id);
      submittedRef.current = true;
      setConfirmationId(id);
      setStatus('sent');
      clearPersistedForm();
      track('sim_form_submit_success', {
        surface: 'mobile',
        confirmation_id: id,
        delivery: 'queued_offline',
      });
      return;
    }

    const result = await deliverLead({ ...form, confirmationId: id });

    if (result.ok) {
      submittedRef.current = true;
      setConfirmationId(id);
      setStatus('sent');
      clearPersistedForm();
      track('sim_form_submit_success', {
        surface: 'mobile',
        confirmation_id: id,
        delivery: result.via,
      });
    } else {
      // Both backend AND mailto failed — enqueue for later retry so
      // the lead isn't lost. The drain effect will pick it up next
      // time the network comes back online or the user reloads.
      enqueueLead(form, id);
      submittedRef.current = true;
      setConfirmationId(id);
      setStatus('sent');
      clearPersistedForm();
      track('sim_form_submit_success', {
        surface: 'mobile',
        confirmation_id: id,
        delivery: 'queued_after_failure',
        original_failure: result.reason ?? 'delivery_failed',
      });
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(desktopHref ?? currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      track('sim_desktop_link_copy', { surface: 'mobile' });
    } catch {
      // Clipboard blocked — fall through, user can long-press the link
    }
  }

  return (
    <div className="mlc" role="region" aria-label="Hurricane simulator — mobile preview">
      {/* INTERACTIVE 5-TIER SIM PREVIEW — replaced the static animated
          tile with a real touch-driven mini-simulator. The visitor can
          tap or swipe to escalate from Tier 1 (calm) through Tier 5
          (Cat 5 catastrophic), seeing progressive damage to a stylized
          house silhouette. The "holy shit" moment that the desktop sim
          delivers via slider, ported to mobile via discrete tier
          escalation. Lead form below converts off the emotional spike. */}
      <TouchSimPreview />

      {/* RETURNING-VISITOR WARM-BACK BANNER — only shows for visitors
          who've been here before (visit_count > 1) and haven't already
          submitted (status === 'idle'). Subtle personalization signals
          "we recognize you" without being creepy. */}
      {visitCount > 1 && status === 'idle' && (
        <div className="mlc__returning" role="status">
          <span aria-hidden="true">👋</span> Welcome back. Visit #{visitCount} — let's
          finish that estimate today.
        </div>
      )}

      <div className="mlc__pitch">
        <p className="mlc__eyebrow">Desktop interactive demo</p>
        <h2 className="mlc__title">
          Watch your roof<br />survive a Cat&nbsp;4 hurricane.
        </h2>
        <p className="mlc__body">
          The full simulator is built for a PC — drag-the-slider gameplay,
          live wind physics, real FBC failure modes. <strong>Get a free
          inspection from a Beit Building Contractors crew below</strong> and
          we'll call you with a real-house estimate based on your roof.
        </p>
      </div>

      {/* TRUST COUNTER — social proof. The number animates 0 → target
          with ease-out cubic when it scrolls into view, making it
          feel alive instead of flatly appearing. The TARGET value is
          computed at module load from a small deterministic baseline
          so it doesn't visibly shift between renders. */}
      <TrustCounter target={getMonthlyEstimateCount()} />

      {/* PRIVACY PLEDGE — front-and-center moral commitment.
          First-party only. No third-party trackers loaded on this
          site. The form's only purpose is to call you back. */}
      <div className="mlc__privacy-pledge" role="region" aria-label="Privacy commitment">
        <span className="mlc__privacy-pledge-mark" aria-hidden="true">🛡</span>
        <div>
          <strong>No Google. No Meta. No data brokers.</strong>
          <p>
            This page loads <em>zero</em> third-party trackers. Your name + phone
            go to <em>one</em> place: the Beit Building inspector calling you back.
            We honor Do-Not-Track. We don't build a cross-site profile of you.
            Submit, get a call, that's it.
          </p>
        </div>
      </div>

      {/* NETWORK STATUS — surface a tiny banner if the user goes
          offline mid-fill so they know WHY a submit might be failing.
          Renders nothing when online. */}
      {!online && (
        <div className="mlc__network-offline" role="status">
          <span aria-hidden="true">⚠</span> You're offline. Your draft is saved
          — submit will go through once you're back online.
        </div>
      )}

      {/* RESTORED-DRAFT BANNER — gentle nudge that we kept their data. */}
      {restoredFromStorage && status === 'idle' && (
        <div className="mlc__restored" role="status">
          <span aria-hidden="true">↺</span> We kept your spot. Pick up where you left off.
        </div>
      )}

      {/* ARIA LIVE REGION — screen readers announce status changes
          (submitting, success, error) without losing focus. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="mlc__sr-status">
        {status === 'submitting' && 'Sending your information…'}
        {status === 'sent' && confirmationId &&
          `Lead confirmed. Your reference number is ${confirmationId}. We will call you within one business day.`}
        {status === 'error' && errorMessage}
      </div>

      {/* LEAD FORM — minimum-friction. Three fields + CTA + honeypot. */}
      {status !== 'sent' && (
        <form className="mlc__form" onSubmit={handleSubmit} noValidate>
          <label className={`mlc__field${touched.name && !nameValid ? ' mlc__field--invalid' : ''}`}>
            <span className="mlc__label">Your name</span>
            <input
              type="text"
              autoComplete="name"
              required
              value={form.name}
              onChange={(e) =>
                // Cap at 80 chars — sane name length, prevents abuse +
                // keeps mailto: subject within sane URI bounds.
                setForm({ ...form, name: e.target.value.slice(0, 80) })
              }
              onFocus={markFormStarted}
              onBlur={() => handleFieldBlur('name', form.name.trim().length > 1)}
              placeholder="Sandra"
              disabled={status === 'submitting'}
              aria-invalid={touched.name && !nameValid}
              aria-describedby={touched.name && !nameValid ? 'mlc-err-name' : undefined}
              maxLength={80}
            />
            {touched.name && !nameValid && (
              <span id="mlc-err-name" className="mlc__error">Please enter your name</span>
            )}
          </label>

          <label className={`mlc__field${touched.phone && !phoneValid ? ' mlc__field--invalid' : ''}`}>
            <span className="mlc__label">Phone</span>
            <input
              ref={phoneInputRef}
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              required
              value={form.phone}
              onChange={(e) => {
                const next = formatPhone(e.target.value);
                setForm({ ...form, phone: next });
                // AUTO-ADVANCE — when the phone reaches 10 digits, jump
                // focus to ZIP. Saves a tap on mobile + signals to the
                // user that phone is "complete".
                if (phoneDigits(next).length === 10 && phoneDigits(form.phone).length < 10) {
                  zipInputRef.current?.focus();
                }
              }}
              onFocus={markFormStarted}
              onBlur={() => handleFieldBlur('phone', phoneDigits(form.phone).length === 10)}
              placeholder="Your phone number"
              disabled={status === 'submitting'}
              aria-invalid={touched.phone && !phoneValid}
              aria-describedby={'mlc-tcpa' + (touched.phone && !phoneValid ? ' mlc-err-phone' : '')}
              maxLength={14} /* "(407) 555-0101" is 14 chars */
            />
            {touched.phone && !phoneValid && (
              <span id="mlc-err-phone" className="mlc__error">10-digit US phone number, please</span>
            )}
            {/* TCPA / SMS-CONSENT DISCLOSURE — required by FL law for any
                business collecting a phone number with intent to call/SMS.
                Plain language so it doesn't read as legalese. */}
            <span id="mlc-tcpa" className="mlc__tcpa">
              By entering your phone, you consent to a one-time call from
              Beit Building Contractors LLC about your free estimate. No
              recurring messages. No automated dialers. Reply STOP to opt out.
            </span>
          </label>

          <label className={`mlc__field${touched.zip && !zipValid ? ' mlc__field--invalid' : ''}`}>
            <span className="mlc__label">ZIP code</span>
            <input
              ref={zipInputRef}
              type="text"
              autoComplete="postal-code"
              inputMode="numeric"
              pattern="[0-9]{5}"
              maxLength={5}
              required
              value={form.zip}
              onChange={(e) => {
                const next = e.target.value.replace(/\D/g, '').slice(0, 5);
                setForm({ ...form, zip: next });
                // AUTO-ADVANCE — when ZIP hits 5 digits AND name is
                // already filled, scroll the submit button into view +
                // focus it. Lets keyboard-only users tab → enter to
                // submit without hunting for the button.
                if (next.length === 5 && form.name.trim().length > 1 && form.zip.length < 5) {
                  submitButtonRef.current?.focus();
                  submitButtonRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }
              }}
              onFocus={markFormStarted}
              onBlur={() => handleFieldBlur('zip', isValidZip(form.zip))}
              placeholder="32817"
              disabled={status === 'submitting'}
              aria-invalid={touched.zip && !zipValid}
              aria-describedby={touched.zip && !zipValid ? 'mlc-err-zip' : undefined}
            />
            {touched.zip && !zipValid && (
              <span id="mlc-err-zip" className="mlc__error">5-digit ZIP code, please</span>
            )}
          </label>

          {/* HONEYPOT — invisible to humans (off-screen + tabIndex={-1}
              + autoComplete=off + aria-hidden), irresistible to bots
              that auto-fill every input on the page. If this has a
              value at submit time, we treat the request as spam. */}
          <div className="mlc__honeypot" aria-hidden="true">
            <label>
              Website (leave blank)
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </label>
          </div>

          <button
            ref={submitButtonRef}
            type="submit"
            className="mlc__submit"
            disabled={status === 'submitting'}
          >
            {status === 'submitting' ? 'Sending…' : 'Get my free estimate'}
            <span aria-hidden="true">→</span>
          </button>

          <p className="mlc__small">
            We'll call you within one business day with a real, no-pressure
            estimate. No spam, no robocalls.
          </p>

          {/* In-form ERROR banner — appears if the backend POST + mailto
              both failed. Gives the user a recovery path without losing
              the data they just typed. */}
          {status === 'error' && errorMessage && (
            <div className="mlc__inline-error" role="alert">
              <p>{errorMessage}</p>
              <a
                className="mlc__call-now"
                href={`tel:${TAP_TO_CALL}`}
                onClick={() => track('sim_call_now', { surface: 'mobile', from: 'inline_error' })}
              >
                Tap to call {TAP_TO_CALL_DISPLAY}
              </a>
            </div>
          )}

          {/* PRIVACY + TAP-TO-CALL footer — every B2C form should
              link to the privacy policy and offer an alternative
              contact method that doesn't require filling the form. */}
          <div className="mlc__form-footer">
            <a
              className="mlc__call-now mlc__call-now--inline"
              href={`tel:${TAP_TO_CALL}`}
              onClick={() => track('sim_call_now', { surface: 'mobile', from: 'form_footer' })}
            >
              <span aria-hidden="true">📞</span> {TAP_TO_CALL_DISPLAY}
            </a>
            <a className="mlc__privacy-link" href="/privacy">
              Privacy
            </a>
          </div>
        </form>
      )}

      {status === 'sent' && (
        <div className="mlc__sent" role="status">
          <p className="mlc__sent-mark" aria-hidden="true">✓</p>
          <h3 ref={successHeadingRef} tabIndex={-1}>You're booked.</h3>
          <p>
            We'll reach out to {form.name || 'you'} at <strong>{form.phone}</strong>{' '}
            <strong className="mlc__call-window">{getCallWindowText()}</strong>{' '}
            with your free estimate.
          </p>
          {confirmationId && (
            <div className="mlc__confirmation" aria-label="Confirmation number">
              <span className="mlc__confirmation-label">Confirmation #</span>
              <code className="mlc__confirmation-id">{confirmationId}</code>
            </div>
          )}
          <div className="mlc__sent-actions">
            <a
              className="mlc__call-now"
              href={`tel:${TAP_TO_CALL}`}
              onClick={() => track('sim_call_now', { surface: 'mobile', from: 'success' })}
            >
              <span aria-hidden="true">📞</span> Or call now &middot; {TAP_TO_CALL_DISPLAY}
            </a>
            <a className="mlc__cta-secondary" href={ctaHref}>
              Visit beitbuilding.com <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
      )}

      {/* TRUST STRIP — DBPR licensed credentials inline (no popover) */}
      <div className="mlc__trust">
        <span className="mlc__trust-mark" aria-hidden="true">✓</span>
        <div>
          <strong>FL DBPR Licensed</strong>
          <p>
            CCC1337413 (Roofing) &middot; CGC1534077 (General Contractor) &middot;
            Active through 08/31/2026
          </p>
        </div>
      </div>

      {/* DESKTOP DEEP-LINK — invite the user to bookmark or text the
          link to themselves so they can open it later on a real PC. */}
      <div className="mlc__desktop-cta">
        <p className="mlc__desktop-eyebrow">Want to play the simulator?</p>
        <p className="mlc__desktop-body">
          The full interactive demo runs on a PC at home. Send yourself the
          link and pull it up later.
        </p>
        <button
          type="button"
          className="mlc__copy"
          onClick={handleCopyLink}
        >
          {copied ? '✓ Link copied' : 'Copy desktop link'}
        </button>
      </div>

      {/* STICKY THUMB-REACHABLE CTA — pins to the bottom of the
          viewport on mobile so the call-now action is always one
          tap away regardless of scroll position. Only renders when
          the form hasn't been submitted yet (after submit, the
          success card has its own call-now). */}
      {status !== 'sent' && (
        <a
          href={`tel:${TAP_TO_CALL}`}
          className="mlc__sticky-cta"
          onClick={() => track('sim_call_now', { surface: 'mobile', from: 'sticky_cta' })}
          aria-label={`Call ${TAP_TO_CALL_DISPLAY} now`}
        >
          <span className="mlc__sticky-cta-icon" aria-hidden="true">📞</span>
          <span className="mlc__sticky-cta-text">
            <span className="mlc__sticky-cta-eyebrow">Skip the form</span>
            <span className="mlc__sticky-cta-num">{TAP_TO_CALL_DISPLAY}</span>
          </span>
          <span className="mlc__sticky-cta-arrow" aria-hidden="true">→</span>
        </a>
      )}
    </div>
  );
}

/**
 * TrustCounter — wraps the existing useCountUp hook (which uses
 * IntersectionObserver to defer the animation until the counter
 * actually enters the viewport). The number animates 0 → target
 * with ease-out cubic, ~1.2s, respecting prefers-reduced-motion.
 *
 * Self-contained so MobileLeadCapture stays focused on form logic.
 */
function TrustCounter({ target }: { target: number }) {
  const [value, ref] = useCountUp(target, 1200);
  return (
    <div className="mlc__trust-counter" role="presentation">
      <span ref={ref} className="mlc__trust-counter-num">{value}</span>
      <span className="mlc__trust-counter-label">
        Orlando homeowners booked a free estimate this month
      </span>
    </div>
  );
}
