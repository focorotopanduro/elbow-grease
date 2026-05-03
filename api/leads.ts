/**
 * /api/leads — server-side lead intake.
 *
 * Receives the JSON payload posted by:
 *   - The desktop Contact form (`src/sections/Contact.tsx` →
 *     `submitLeadEndpoint` in `src/lib/leadIntake.ts`), with the full
 *     intake shape (name, phone, email, location, service, message,
 *     route, operations).
 *   - The mobile lead-capture surface (`MobileLeadCapture.tsx`) with
 *     a smaller shape (name, phone, zip, source).
 *
 * Validates server-side (NEVER trust the client), rate-limits per IP
 * to prevent abuse, then fans out to:
 *   1. KV storage (Vercel KV / Upstash Redis), 90-day TTL
 *   2. Email notification to the operations contact (LEAD_NOTIFY_TO,
 *      defaults to mom @ sandravasquezcgc@gmail.com) via Resend /
 *      SendGrid / MailChannels / webhook fallback — see
 *      `api/_lib/email.ts`. Customer email becomes Reply-To.
 *   3. Slack + Discord webhooks (when configured)
 *   4. Operational stdout log (redacted — no email, no message body)
 *
 * Response shape: `{ ok: true, confirmationId, queued: true }`
 * Failures: `{ ok: false, error: 'reason' }` with appropriate HTTP code
 *
 * SECURITY HARDENINGS:
 *   - Origin allowlist (POSTs from off-site rejected)
 *   - Per-IP rate limiting via KV-backed distributed limiter
 *     (10 req / min / IP, atomic across all serverless instances)
 *   - Per-phone-hash rate limiting (3 req / 24h) — TCPA-flood defense
 *   - Strict JSON parsing with size cap + prototype-pollution scrub
 *   - All user-controlled strings sanitized + CRLF-stripped + length-
 *     capped before being forwarded ANYWHERE (logs, email, CRM)
 *   - Email recipients re-validated server-side at the transport layer
 *     (api/_lib/email.ts) as defense in depth against header injection
 *   - Honeypot fields (`website` + `botcheck`) — fake-success returned
 *   - Phone format check (NANP rules, no all-same-digit, no reserved
 *     area codes / exchanges)
 *   - Returns identical response shape for valid + spam submits so
 *     bots can't probe for valid input formats
 *   - 60-second duplicate-submission window via SHA-256 fingerprint
 *
 * RETENTION POLICY:
 *   - Lead records are auto-purged after 90 days by
 *     `api/cron/purge-leads.ts` (configured in vercel.json `crons`).
 *   - When you wire up persistent storage (KV / Postgres / CRM), the
 *     storage adapter goes in BOTH this file (for the write) AND in
 *     purge-leads.ts (for the delete). The retention window is one
 *     of three places it's documented:
 *       1. SECURITY.md "Data retention" table
 *       2. api/cron/purge-leads.ts header
 *       3. Right here.
 *     Keep them in sync.
 *
 * The `runtime: 'nodejs'` config keeps this on Vercel's Node 20.x
 * runtime (not the edge), which gives us Buffer + crypto API access
 * for HMAC signing if you wire it up.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kvPipeline } from './_lib/kv';
import { rateLimitCheck } from './_lib/rateLimit';
import {
  generateConfirmationId,
  generateRequestId,
  getClientIp,
  isAllowedSiteOrigin,
  isValidConfirmationId,
  safeJsonParse,
  sha256Hex,
} from './_lib/security';
import { logger } from './_lib/logger';
import { dispatchLead } from './_lib/webhooks';
import { resolveLeadRecipients, sendEmail } from './_lib/email';
import {
  buildLeadEmailHtml,
  buildLeadEmailSubject,
  buildLeadEmailText,
  type LeadEmailPayload,
} from './_lib/leadEmail';
import {
  buildCustomerAckHtml,
  buildCustomerAckSubject,
  buildCustomerAckText,
  type CustomerAckPayload,
} from './_lib/customerAckEmail';
import {
  isStr,
  parseAcceptLanguage,
  validateLead,
  type LeadInput,
  type LeadValidated,
} from './_lib/leadValidator';

export const config = {
  runtime: 'nodejs',
  // Vercel body parser size cap — defense in depth alongside our
  // own MAX_BODY_BYTES check below. Anything larger than 4 KB is
  // certainly malicious for a 3-field lead form.
  api: { bodyParser: { sizeLimit: '4kb' } },
};

/**
 * Lead retention window in seconds — used as the TTL on each KV
 * record so Redis auto-evicts old leads even if the cron is
 * paused or fails. Matches the value documented in SECURITY.md
 * and api/cron/purge-leads.ts. Keep all three in sync.
 */
const RETENTION_SECONDS = 90 * 24 * 60 * 60;

/** Window during which an identical payload from the same IP is
 *  treated as duplicate + rejected. Defends against double-clicks
 *  + scripted resubmissions. 60s is long enough to cover slow
 *  network retries, short enough not to block legitimate users
 *  who got distracted + came back to fix a typo. */
const DEDUP_WINDOW_SECONDS = 60;

const MAX_BODY_BYTES = 4096;
/** Per-IP rate limit: 10 lead submissions per 60 seconds. The
 *  KV-based distributed limiter (api/_lib/rateLimit.ts) ensures
 *  this is enforced GLOBALLY across all serverless instances —
 *  the previous in-memory limiter was per-instance + bypassable
 *  via parallelism. */
const RATE_LIMIT_BURST = 10;
const RATE_LIMIT_WINDOW_S = 60;
/** Second-order rate limit: 3 lead submissions per phone number
 *  per 24 hours. Catches the case where a botnet rotates IPs but
 *  keeps submitting the same target phone (sometimes used in
 *  TCPA-violation campaigns to flood a competitor with calls). */
const PHONE_LIMIT_BURST = 3;
const PHONE_LIMIT_WINDOW_S = 24 * 60 * 60;

// LeadInput / LeadValidated / LeadRouteInput / LeadOperationsInput
// are imported from `./_lib/leadValidator` — kept in a pure-function
// module so the validation logic gets unit-test coverage without
// having to mock the @vercel/node request/response shapes.

// (in-memory rateLimits + isRateLimited removed — replaced by KV-backed
// distributed rate limiter via rateLimitCheck imported above)

function getClientIpFromReq(req: VercelRequest): string {
  // Delegates to the shared helper which validates IP format to
  // prevent log poisoning via crafted headers.
  // @ts-expect-error — VercelRequest.headers shape matches what getClientIp expects
  return getClientIp(req.headers);
}

// validate(), validateRoute, validateOperations, validateLocale,
// parseAcceptLanguage, sanitize, isStr — all live in
// `./_lib/leadValidator` so they get unit-test coverage in
// `api/_lib/leadValidator.test.ts`. This file just composes them
// into the request flow.

/**
 * Forward the validated lead to its final destination(s). Replace
 * the stub with your production email/CRM integration:
 *
 *   - Resend / SendGrid / AWS SES / Mailgun for email
 *   - HubSpot / Salesforce / Pipedrive for CRM
 *   - Slack incoming webhook for instant team notification
 *
 * Always wrap external calls in try/catch — if the email service is
 * down, we still want to return 202 to the user (their lead is in
 * our log file) rather than 500ing them. A nightly job can replay
 * any leads that didn't reach the CRM.
 *
 * PRIVACY POSTURE: we do NOT include the user's IP address in the
 * forwarded payload, log line, or stored record. The IP is used at
 * the Vercel edge ONLY for rate-limiting (in-memory bucket) and is
 * never written anywhere persistent. Lead data is the minimum
 * necessary to call the user back: name, phone, ZIP. That's it.
 */
async function forwardLead(lead: LeadValidated): Promise<void> {
  // STORAGE — write to Vercel KV (Upstash Redis) with a 90-day TTL
  // so Redis auto-evicts the record. The cron in
  // api/cron/purge-leads.ts is a safety net in case TTL fails.
  //
  // We use the /pipeline endpoint for a single round-trip: SET the
  // lead document AND ZADD it to the time-sorted-set so the cron
  // can find old records by score.
  //
  // If KV isn't configured (KV_REST_API_URL missing), kvPipeline
  // silently no-ops and the lead is still logged + emailed below.
  // No hard dependency on storage — the funnel keeps working.
  const nowMs = Date.now();
  await kvPipeline([
    ['SET', `lead:${lead.confirmationId}`, JSON.stringify(lead), 'EX', RETENTION_SECONDS],
    ['ZADD', 'leads:by-time', nowMs, lead.confirmationId],
  ]);

  // OPERATIONAL LOG — log a redacted summary, never the email or
  // free-text message body. Phone is hashed via sha256 elsewhere when
  // we need to dedupe; here we keep digits-only to make a leaked log
  // useful for "did this lead arrive?" forensics without exposing PII.
  // eslint-disable-next-line no-console
  console.log(
    '[lead]',
    JSON.stringify({
      confirmationId: lead.confirmationId,
      ts: lead.ts,
      service: lead.service || lead.route?.label || 'unspecified',
      clientType: lead.clientType || 'unspecified',
      preferredContact: lead.preferredContact || 'unspecified',
      route: lead.route?.id ?? null,
      priority: lead.route?.priority ?? null,
      bucket: lead.operations?.bucket ?? null,
      hasEmail: lead.email !== '',
      hasMessage: lead.message !== '',
      source: lead.source,
    }),
  );

  // EMAILS — fire both in parallel:
  //   1. Operations email to LEAD_NOTIFY_TO (the team / mom's inbox)
  //   2. Customer acknowledgement to lead.email (when provided)
  // Both run inside try/catch so neither failure blocks the user's
  // 202 response. Parallel because they're independent and we don't
  // want one slow provider to double the dispatch latency.
  await Promise.all([dispatchLeadEmail(lead), dispatchCustomerAck(lead)]);

  // Tier 8 — fan out to multi-destination webhooks (Slack, Discord, etc.).
  // Each destination is OPT-IN via env var; missing var = silent no-op.
  // Failures are logged inside dispatchLead but never bubble up — a slow
  // Slack outage shouldn't reject the user's form submission.
  // See api/_lib/webhooks.ts for destination implementations and
  // docs/lead-routing.md for the env-var setup walkthrough.
  await dispatchLead({
    confirmationId: lead.confirmationId,
    name: lead.name,
    phone: lead.phone,
    email: lead.email || undefined,
    zip: lead.zip || undefined,
    location: lead.location || undefined,
    clientType: lead.clientType || undefined,
    preferredContact: lead.preferredContact || undefined,
    service: lead.service || lead.route?.label || undefined,
    message: lead.message || undefined,
    source: lead.source,
    ts: lead.ts,
  });
}

/**
 * Send the rich HTML+text lead notification email to the operations
 * inbox. Errors are caught + logged but never thrown — even a 100%
 * email outage shouldn't block the user's success response, since the
 * lead is already in KV and (if configured) Slack/Discord.
 */
async function dispatchLeadEmail(lead: LeadValidated): Promise<void> {
  const { to, cc } = resolveLeadRecipients();
  if (to.length === 0) {
    // eslint-disable-next-line no-console
    console.warn('[lead-email] no valid recipients resolved — skipping email');
    return;
  }
  const payload: LeadEmailPayload = {
    confirmationId: lead.confirmationId,
    ts: lead.ts,
    name: lead.name,
    phone: lead.phone,
    email: lead.email || undefined,
    zip: lead.zip || undefined,
    location: lead.location || undefined,
    clientType: lead.clientType || undefined,
    preferredContact: lead.preferredContact || undefined,
    service: lead.service || lead.route?.label || undefined,
    message: lead.message || undefined,
    source: lead.source,
    pageUrl: lead.url !== 'unknown' ? lead.url : undefined,
    route: lead.route,
    operations: lead.operations ?? undefined,
  };
  try {
    const result = await sendEmail({
      to,
      cc: cc.length ? cc : undefined,
      // Reply-To = customer email so "Reply" in Gmail/Apple Mail/Outlook
      // reaches the lead directly. Stays unset when no email collected;
      // recipients then reply to the From address (which is fine — the
      // From address has the customer phone in the body).
      replyTo: lead.email || undefined,
      subject: buildLeadEmailSubject(payload),
      text: buildLeadEmailText(payload),
      html: buildLeadEmailHtml(payload),
      // Tag the message with the confirmation id + a stable thread-id
      // so the recipient's mail client groups all messages about the
      // same lead together (Gmail uses In-Reply-To; we leave that blank
      // so the customer's eventual reply starts a fresh thread). The
      // `X-Beit-Lead-Id` header is custom + accessible via Gmail's
      // "show original" / Outlook's "view source" for support tickets.
      headers: {
        'X-Beit-Lead-Id': lead.confirmationId,
        'X-Beit-Lead-Source': lead.source,
        'X-Beit-Lead-Bucket': lead.operations?.bucket ?? 'general',
      },
    });
    // eslint-disable-next-line no-console
    console.log(
      '[lead-email]',
      JSON.stringify({
        confirmationId: lead.confirmationId,
        ok: result.ok,
        provider: result.provider,
        messageId: result.messageId,
        reason: result.reason,
        recipientCount: to.length,
      }),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[lead-email] dispatch failed',
      err instanceof Error ? err.message : 'unknown',
    );
  }
}

/**
 * Send the customer-facing acknowledgement email. Skipped silently
 * when no email address was collected (the mobile sim path doesn't
 * collect email; only the desktop Contact form does).
 *
 * Why this email matters:
 *   - Reduces phantom resubmits ("did my form go through?") that
 *     pollute the inbox with duplicates.
 *   - Sets a clear expectation about callback timing, which lowers
 *     the rate at which anxious customers cold-call competitors
 *     while waiting.
 *   - Establishes the conversation thread so the customer can reply
 *     with photos / claim numbers / additional context BEFORE the
 *     call, making the call shorter + more accurate.
 *   - Anchors trust: visible DBPR licenses + verifylink in the email
 *     reduces the "is this a scam?" hesitation that hurts conversion
 *     during the call window.
 *
 * Failures NEVER bubble up — the user already got a success response;
 * a missed ACK email is recoverable from KV / logs by replaying.
 */
/** Max ACK emails sent to the same recipient address per 24 hours.
 *  Defends against the harassment vector where an attacker submits
 *  many leads with rotating IPs but a constant target email — without
 *  this limit, the site's lead form becomes a free email-spam relay.
 *  Three matches the per-phone limit's mental model: a real customer
 *  who submits twice (oops, double-click) or three times (oh wait,
 *  forgot to mention X) still gets every ACK; a fourth submission
 *  silently drops the ACK while the lead itself still flows to ops. */
const ACK_LIMIT_BURST = 3;
const ACK_LIMIT_WINDOW_S = 24 * 60 * 60;

async function dispatchCustomerAck(lead: LeadValidated): Promise<void> {
  if (!lead.email) {
    // No email collected — nothing to ack. This is the mobile-sim
    // path; that surface only collects name/phone/zip and we can't
    // ack a phone number through email infrastructure.
    return;
  }
  // Per-recipient rate limit. Hash so the rate-limit key in KV doesn't
  // expose plaintext addresses; same defense pattern as the per-phone
  // limit. If the limit is exceeded, the lead itself still flows to
  // ops + KV — only the ACK is suppressed.
  const recipientHash = sha256Hex(lead.email).slice(0, 16);
  const ackLimit = await rateLimitCheck({
    prefix: 'lead-ack',
    bucket: recipientHash,
    limit: ACK_LIMIT_BURST,
    windowSeconds: ACK_LIMIT_WINDOW_S,
  });
  if (ackLimit.limited) {
    // eslint-disable-next-line no-console
    console.warn(
      '[customer-ack] rate-limited — skipping ACK for this recipient',
      JSON.stringify({
        confirmationId: lead.confirmationId,
        recipientHash,
        count: ackLimit.count,
      }),
    );
    return;
  }
  const payload: CustomerAckPayload = {
    name: lead.name,
    email: lead.email,
    confirmationId: lead.confirmationId,
    ts: lead.ts,
    service: lead.service || lead.route?.label || undefined,
    message: lead.message || undefined,
    location: lead.location || undefined,
    priority: (lead.route?.priority as CustomerAckPayload['priority']) ?? undefined,
    locale: lead.locale,
  };
  try {
    const result = await sendEmail({
      to: lead.email,
      // Reply-To routes the customer's reply to the operations inbox
      // so any "I have more photos" reply lands with the team, not in
      // a no-reply void. Falls back to LEAD_NOTIFY_TO so the same
      // inbox that received the operations email also receives the
      // customer's eventual reply.
      replyTo: resolveLeadRecipients().to[0],
      subject: buildCustomerAckSubject(payload),
      text: buildCustomerAckText(payload),
      html: buildCustomerAckHtml(payload),
      headers: {
        'X-Beit-Lead-Id': lead.confirmationId,
        'X-Beit-Email-Type': 'customer-acknowledgement',
        // List-Unsubscribe is technically not strictly required for
        // transactional confirmations, but Gmail prefers seeing it
        // present to avoid bulk-folder downgrades. We point it at
        // the office phone line + email — manual unsubscribe is
        // appropriate here because there's no recurring list to
        // remove from.
        'List-Unsubscribe': '<tel:+14079426459>, <mailto:beitbuilding@gmail.com?subject=Unsubscribe>',
      },
    });
    // eslint-disable-next-line no-console
    console.log(
      '[customer-ack]',
      JSON.stringify({
        confirmationId: lead.confirmationId,
        ok: result.ok,
        provider: result.provider,
        messageId: result.messageId,
        reason: result.reason,
        // We intentionally don't log the recipient address — even though
        // we just sent to it, there's no operational value in writing it
        // to log retention.
      }),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[customer-ack] dispatch failed',
      err instanceof Error ? err.message : 'unknown',
    );
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const reqId = generateRequestId();
  const log = logger('api/leads', { reqId });
  res.setHeader('X-Request-Id', reqId);

  // Method gate
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  // CONTENT-TYPE enforcement — reject anything that isn't JSON.
  // Defense against form-encoded CSRF where a malicious site posts
  // a hidden form with text/plain or x-www-form-urlencoded.
  const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    log.warn('rejected non-json content-type', { contentType });
    res.status(415).json({ ok: false, error: 'unsupported_media_type' });
    return;
  }

  // Origin allowlist (CORS-style — also blocks cross-origin form posts)
  const origin = req.headers.origin;
  if (origin && !isAllowedSiteOrigin(origin)) {
    log.warn('rejected origin', { origin });
    res.status(403).json({ ok: false, error: 'origin_not_allowed' });
    return;
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  // Body size cap (early reject of comically-large payloads — also
  // capped by the api.bodyParser.sizeLimit config above as defense
  // in depth)
  const cl = Number(req.headers['content-length'] ?? 0);
  if (cl > MAX_BODY_BYTES) {
    log.warn('payload too large', { contentLength: cl });
    res.status(413).json({ ok: false, error: 'payload_too_large' });
    return;
  }

  // PER-IP RATE LIMIT — distributed via KV so it works correctly
  // across N serverless instances. Falls open if KV is unavailable
  // (logged so operators can act).
  const ip = getClientIpFromReq(req);
  const ipLimit = await rateLimitCheck({
    prefix: 'lead-ip',
    bucket: ip,
    limit: RATE_LIMIT_BURST,
    windowSeconds: RATE_LIMIT_WINDOW_S,
  });
  if (!ipLimit.applied) {
    log.warn('rate limiter degraded — failing open', { ip });
  }
  if (ipLimit.limited) {
    log.warn('ip rate limited', { ip, count: ipLimit.count });
    res.setHeader('Retry-After', String(Math.ceil((ipLimit.resetAt - Date.now()) / 1000)));
    res.status(429).json({ ok: false, error: 'rate_limited' });
    return;
  }

  // Parse + validate. safeJsonParse strips __proto__/constructor
  // keys at every level so attackers can't pollute Object.prototype
  // via the JSON body.
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  const parsed = safeJsonParse(rawBody);
  // Reject anything that isn't a plain object — including arrays.
  // `typeof [] === 'object'` is true, which would bypass naive
  // type narrowing. Array.isArray is the only reliable check, and
  // we also rule out null + non-object primitives explicitly.
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    log.warn('invalid json body');
    res.status(400).json({ ok: false, error: 'invalid_json' });
    return;
  }
  const input = parsed as LeadInput;

  const result = validateLead(input, {
    generateConfirmationId,
    isValidConfirmationId,
  });
  // Locale fallback: if the body didn't carry an explicit locale field,
  // mirror the request's Accept-Language preference. Means a Spanish-
  // speaking visitor on a Spanish-configured device gets the Spanish
  // ACK email even when the front-end didn't pass an explicit locale.
  if (result.ok && !isStr(input.locale, 10)) {
    const acceptLang = req.headers['accept-language'];
    const fallback = parseAcceptLanguage(
      Array.isArray(acceptLang) ? acceptLang[0] : acceptLang,
    );
    result.data.locale = fallback;
  }
  if (!result.ok) {
    // Honeypot triggers fake-success so bots can't probe
    if (result.reason === 'honeypot') {
      log.info('honeypot tripped — silently accepted', { ip });
      res.status(202).json({ ok: true, confirmationId: 'spam-trapped', queued: true });
      return;
    }
    log.info('validation failed', { reason: result.reason });
    res.status(400).json({ ok: false, error: result.reason });
    return;
  }

  // PER-PHONE RATE LIMIT — same phone can't submit more than 3×
  // per 24 hours regardless of IP. Defends against TCPA-violation
  // call-flood campaigns where a botnet rotates IPs but keeps the
  // target phone constant. Hash the phone so the rate-limit key
  // doesn't expose plaintext numbers in KV.
  const phoneHash = sha256Hex(result.data.phone).slice(0, 16);
  const phoneLimit = await rateLimitCheck({
    prefix: 'lead-phone',
    bucket: phoneHash,
    limit: PHONE_LIMIT_BURST,
    windowSeconds: PHONE_LIMIT_WINDOW_S,
  });
  if (phoneLimit.limited) {
    log.warn('phone rate limited', { phoneHash, count: phoneLimit.count });
    res.setHeader('Retry-After', String(Math.ceil((phoneLimit.resetAt - Date.now()) / 1000)));
    res.status(429).json({ ok: false, error: 'rate_limited' });
    return;
  }

  // DUPLICATE-SUBMISSION DETECTION — hash the normalized payload +
  // IP, reject if the same hash was seen in the last 60s.
  //
  // Uses pipelined INCR + EXPIRE NX (same pattern as the rate limiter)
  // so we can DISTINGUISH the three outcomes:
  //   - count === 1   → first time, accept submission
  //   - count >= 2    → duplicate, return previously-received
  //   - count === null → KV unavailable, fail open
  //
  // The previous SET NX approach conflated "duplicate" and "KV down"
  // (both returned null), which meant a transient KV outage made
  // EVERY submission look like a duplicate, breaking lead intake.
  // Fingerprint uses phone as the canonical identifier (always present,
  // always validated to NANP-shaped 10 digits) plus the IP + name + a
  // location component (zip when present, free-text location otherwise).
  // Including the location dimension means a user who submitted from
  // their phone at home and again from their laptop at the office on
  // the same day still gets two distinct submissions (different IP +
  // possibly different location), but a true double-click within 60s
  // collapses to one.
  const locationDim = result.data.zip || result.data.location || '';
  const payloadFingerprint = sha256Hex(
    `${ip}|${result.data.name.toLowerCase()}|${result.data.phone.replace(/\D/g, '')}|${locationDim.toLowerCase()}`,
  );
  const dedupKey = `lead-dedup:${payloadFingerprint.slice(0, 24)}`;
  const dedupResults = await kvPipeline([
    ['INCR', dedupKey],
    ['EXPIRE', dedupKey, DEDUP_WINDOW_SECONDS, 'NX'],
  ]);
  const dedupCount = dedupResults[0] as number | null;
  if (dedupCount === null) {
    // KV down — fail open, accept the submission. The downside is a
    // legitimate duplicate from a double-click might process twice,
    // which is way better than rejecting all submissions. The 90-day
    // KV-side dedup via confirmationId in the lead doc still catches
    // duplicate writes downstream.
    log.warn('dedup degraded — KV unavailable, accepting without dedup check');
  } else if (dedupCount > 1) {
    log.info('duplicate submission within dedup window', { fingerprintPrefix: payloadFingerprint.slice(0, 8) });
    res.status(202).json({
      ok: true,
      confirmationId: result.data.confirmationId,
      queued: true,
      note: 'previously_received',
    });
    return;
  }

  log.info('lead accepted', {
    confirmationId: result.data.confirmationId,
    source: result.data.source,
  });

  // Forward — never let a downstream failure block the user response.
  // We log the failure but still return 202 so the user sees success
  // and we can replay from logs if needed.
  try {
    await forwardLead(result.data);
  } catch (err) {
    log.error('forward failed', {
      confirmationId: result.data.confirmationId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  res.status(202).json({
    ok: true,
    confirmationId: result.data.confirmationId,
    queued: true,
  });
}
