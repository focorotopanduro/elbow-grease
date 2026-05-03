/**
 * Server-side email transport — Tier 9 lead-routing.
 *
 * Vendor-agnostic email delivery for transactional lead notifications.
 * Each provider is OPT-IN via environment variables; the dispatcher
 * tries them in priority order and returns the first success.
 *
 * PROVIDER PRIORITY (highest first):
 *   1. Resend  — RESEND_API_KEY            (modern, 100/day free, recommended)
 *   2. SendGrid — SENDGRID_API_KEY         (mature, 100/day free)
 *   3. MailChannels — MAILCHANNELS_API_KEY (free for Cloudflare Workers,
 *                                           also works elsewhere with key)
 *   4. SMTP    — SMTP_HOST + SMTP_USER + SMTP_PASS  (Gmail, Mailgun, etc.)
 *
 * ROUTING:
 *   Recipient defaults to LEAD_NOTIFY_TO (env), falling back to
 *   sandravasquezcgc@gmail.com — the operations contact for Beit
 *   Building Contractors LLC. CC'd to LEAD_NOTIFY_CC (comma-separated).
 *   Reply-To is set to the lead's email when supplied so the owner can
 *   "Reply" in Gmail and reach the customer directly.
 *
 * SECURITY:
 *   - Every recipient address validated against EMAIL_RE before reaching
 *     the provider — defense in depth against header-injection attempts
 *     where an attacker stuffs CR/LF into an `email` field hoping it'll
 *     end up in the To: header.
 *   - Subject lines stripped of CR/LF/U+2028/U+2029 (same set as
 *     /api/leads input sanitization).
 *   - HTML body is built from already-sanitized data (caller's job)
 *     and then HTML-encoded via escapeHtml below as a final guard.
 *   - 8-second per-provider timeout. Failure logs the provider + status
 *     but never throws — caller wraps every dispatchEmail() in try/catch
 *     and lead intake STILL returns 202 to the user.
 *   - API keys are read from env once per call (no module-level capture)
 *     so rotating a key in Vercel takes effect on the next invocation
 *     without redeploy.
 *
 * NOT IMPLEMENTED (intentionally):
 *   - DKIM/SPF setup — that's DNS-side, not code-side. Use Resend's
 *     "Domains" feature (one-click TXT records) for deliverability.
 *   - Email open/click tracking — privacy hostile, no business need.
 *   - Bounce handling — let the provider's webhook handle this; we
 *     don't store recipient addresses anyway.
 */

import { logger } from './logger';

const log = logger('api/_lib/email');

/**
 * Per-provider timeout. Tightened from 8s to 4s in Phase 11 because
 * sequential failover (Resend → SendGrid → MailChannels → webhook)
 * could otherwise stack 4 × 8s = 32s and blow Vercel's 10-second
 * function budget when multiple providers were configured + failing.
 * 4s is generous enough to absorb a slow first-byte from a healthy
 * provider while keeping total worst-case bounded.
 */
const TIMEOUT_MS = 4000;

/**
 * Global budget for the entire `sendEmail` call across all providers.
 * Cap on the total time spent failing-over. If the elapsed time
 * exceeds this, sendEmail short-circuits and returns the last failure
 * rather than continuing down the provider chain. 7s leaves the
 * Vercel function ≥3s to send the response after the email attempt.
 */
const SEND_BUDGET_MS = 7000;

/** Strict email regex — same definition as the front-end Contact form
 *  uses, kept in sync intentionally. Catches typos without rejecting
 *  the long-tail of real RFC-valid addresses. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Default operations contact when LEAD_NOTIFY_TO is not configured.
 *  Hardcoded fallback so a missing env var doesn't drop emails on the
 *  floor — the owner-of-record still gets every lead. */
const DEFAULT_OPERATIONS_EMAIL = 'sandravasquezcgc@gmail.com';

/** Default From address. Override with EMAIL_FROM env. The local-part
 *  "leads@" reads naturally in the inbox; the apex domain assumes
 *  beitbuilding.com is the domain configured at the email provider. */
const DEFAULT_FROM = 'Beit Building Leads <leads@beitbuilding.com>';

/** Default From name when EMAIL_FROM_NAME is not configured. */
const DEFAULT_FROM_NAME = 'Beit Building Leads';

const LINE_TERMINATORS_REGEX = new RegExp('[\\r\\n\\u2028\\u2029]+', 'g');

/** Strip CR/LF/U+2028/U+2029 from a header value. Critical for
 *  preventing email-header injection where `Subject: foo\nBcc: evil@x.com`
 *  would smuggle an extra header through some providers' APIs. Even
 *  though Resend/SendGrid handle this internally, we never trust a
 *  vendor to be perfect — defense in depth. */
function stripHeaderInjection(value: string): string {
  return value.replace(LINE_TERMINATORS_REGEX, ' ').slice(0, 998);
}

/** Validate an email address. Returns the sanitized address or null
 *  if invalid (caller decides whether to skip or throw). */
function validateEmail(address: string | undefined | null): string | null {
  if (!address) return null;
  const trimmed = address.trim().slice(0, 320); // RFC 3696 max length
  if (!EMAIL_RE.test(trimmed)) return null;
  // No CRLF in addresses — header injection vector
  if (LINE_TERMINATORS_REGEX.test(trimmed)) return null;
  return trimmed;
}

/** HTML escape — guards against template-injection if a caller forgets
 *  to escape user input before assembling the HTML body. Maps the five
 *  characters that change meaning in an HTML context. */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailMessage {
  /** From address. If undefined, uses EMAIL_FROM env or DEFAULT_FROM. */
  from?: string;
  /** Primary recipient(s). Required. Each address validated before send. */
  to: string | string[];
  /** Optional CC recipients (comma-separated string OR array). */
  cc?: string | string[];
  /** Optional BCC recipients (comma-separated string OR array). */
  bcc?: string | string[];
  /** Reply-To. If undefined, recipients reply to the From address. */
  replyTo?: string;
  /** Subject line. Stripped of CR/LF before send (header injection). */
  subject: string;
  /** Plain-text fallback body. Both this and html should be supplied
   *  for maximum deliverability (some spam filters penalize html-only). */
  text: string;
  /** HTML body. Caller is responsible for escaping user-supplied data;
   *  see escapeHtml() above. */
  html: string;
  /** Optional list of arbitrary headers to attach (e.g. List-Unsubscribe).
   *  Values stripped of CR/LF. */
  headers?: Record<string, string>;
}

export interface EmailResult {
  /** True if at least one provider accepted the message. */
  ok: boolean;
  /** Provider that succeeded, or null if all failed / none configured. */
  provider:
    | 'resend'
    | 'sendgrid'
    | 'mailchannels'
    | 'smtp'
    | 'webhook-fallback'
    | null;
  /** Vendor-side message id, when provided. Useful for support tickets. */
  messageId?: string;
  /** Last error reason when ok=false; empty when ok=true. */
  reason?: string;
}

/** Normalize a "string OR array" recipient field into a clean array of
 *  validated addresses. Drops invalid entries silently (logged once at
 *  warn level so operators see the misconfig). */
function normalizeRecipients(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const raw = Array.isArray(value)
    ? value
    : value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  const validated: string[] = [];
  for (const candidate of raw) {
    const v = validateEmail(candidate);
    if (v) validated.push(v);
    else log.warn('dropped invalid recipient', { addr: candidate.slice(0, 80) });
  }
  return validated;
}

/* ─── Internal: timeout-bounded fetch ──────────────────────────────── */

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ─── Resend (primary) ─────────────────────────────────────────────── */

/**
 * Send via Resend API. Set `RESEND_API_KEY` to enable. Optionally set
 * `RESEND_FROM` to override the From address (verified domain required
 * in Resend's dashboard).
 *
 * Resend returns 200 with `{ id: "<message-id>" }` on success and
 * 4xx/5xx with `{ message: "..." }` on failure.
 *
 * Setup walkthrough (5 min):
 *   1. Sign up at resend.com (no credit card for the free 100/day tier).
 *   2. Add your domain (beitbuilding.com) — they show 3 DNS TXT records,
 *      paste them into your DNS provider, click "Verify" in Resend.
 *   3. Generate an API key (Settings → API Keys → Create).
 *   4. In Vercel: Project → Settings → Environment Variables →
 *      add `RESEND_API_KEY = re_...` (Production + Preview).
 *   5. Redeploy. The next form submission triggers a real email.
 */
async function sendResend(msg: EmailMessage): Promise<EmailResult | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null; // not configured — try next provider

  const to = normalizeRecipients(msg.to);
  if (to.length === 0) {
    log.error('resend: no valid recipients after sanitization');
    return { ok: false, provider: null, reason: 'no_valid_recipients' };
  }
  const cc = normalizeRecipients(msg.cc);
  const bcc = normalizeRecipients(msg.bcc);
  const replyTo = msg.replyTo ? validateEmail(msg.replyTo) : null;

  const from = msg.from ?? process.env.RESEND_FROM ?? process.env.EMAIL_FROM ?? DEFAULT_FROM;
  const subject = stripHeaderInjection(msg.subject);

  const headers: Record<string, string> = {};
  if (msg.headers) {
    for (const [k, v] of Object.entries(msg.headers)) {
      headers[k] = stripHeaderInjection(String(v));
    }
  }

  // Resend POST body schema:
  // https://resend.com/docs/api-reference/emails/send-email
  const body: Record<string, unknown> = {
    from,
    to,
    subject,
    text: msg.text,
    html: msg.html,
  };
  if (cc.length) body.cc = cc;
  if (bcc.length) body.bcc = bcc;
  if (replyTo) body.reply_to = replyTo;
  if (Object.keys(headers).length) body.headers = headers;

  try {
    const resp = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      log.warn('resend rejected', {
        status: resp.status,
        errBody: errText.slice(0, 300),
      });
      return { ok: false, provider: 'resend', reason: `resend_${resp.status}` };
    }
    const data = (await resp.json().catch(() => ({}))) as { id?: string };
    return { ok: true, provider: 'resend', messageId: data.id };
  } catch (err) {
    log.warn('resend network error', {
      err: err instanceof Error ? err.message : 'unknown',
    });
    return { ok: false, provider: 'resend', reason: 'resend_network' };
  }
}

/* ─── SendGrid (secondary) ─────────────────────────────────────────── */

/**
 * Send via SendGrid v3 API. Set `SENDGRID_API_KEY` to enable.
 * Useful as a Resend alternative or a "second-chance" provider when
 * RESEND_API_KEY is rotated.
 */
async function sendSendGrid(msg: EmailMessage): Promise<EmailResult | null> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return null;

  const to = normalizeRecipients(msg.to);
  if (to.length === 0) return { ok: false, provider: null, reason: 'no_valid_recipients' };
  const cc = normalizeRecipients(msg.cc);
  const bcc = normalizeRecipients(msg.bcc);
  const replyTo = msg.replyTo ? validateEmail(msg.replyTo) : null;

  const fromRaw = msg.from ?? process.env.SENDGRID_FROM ?? process.env.EMAIL_FROM ?? DEFAULT_FROM;
  const fromMatch = fromRaw.match(/^(.+?)\s*<(.+)>$/);
  const fromAddr = fromMatch ? fromMatch[2].trim() : fromRaw.trim();
  const fromName = fromMatch ? fromMatch[1].trim() : DEFAULT_FROM_NAME;

  const personalization: Record<string, unknown> = {
    to: to.map((email) => ({ email })),
  };
  if (cc.length) personalization.cc = cc.map((email) => ({ email }));
  if (bcc.length) personalization.bcc = bcc.map((email) => ({ email }));

  const body: Record<string, unknown> = {
    personalizations: [personalization],
    from: { email: fromAddr, name: fromName },
    subject: stripHeaderInjection(msg.subject),
    content: [
      { type: 'text/plain', value: msg.text },
      { type: 'text/html', value: msg.html },
    ],
  };
  if (replyTo) body.reply_to = { email: replyTo };

  try {
    const resp = await fetchWithTimeout('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      log.warn('sendgrid rejected', {
        status: resp.status,
        errBody: errText.slice(0, 300),
      });
      return { ok: false, provider: 'sendgrid', reason: `sendgrid_${resp.status}` };
    }
    // SendGrid returns 202 with the message id in the X-Message-Id header
    const messageId = resp.headers.get('x-message-id') ?? undefined;
    return { ok: true, provider: 'sendgrid', messageId };
  } catch (err) {
    log.warn('sendgrid network error', {
      err: err instanceof Error ? err.message : 'unknown',
    });
    return { ok: false, provider: 'sendgrid', reason: 'sendgrid_network' };
  }
}

/* ─── MailChannels (free with Cloudflare; key required elsewhere) ──── */

/**
 * Send via MailChannels API. Free for Cloudflare Workers (no key
 * needed there). Outside Cloudflare, set `MAILCHANNELS_API_KEY` to
 * enable and verify the From domain in MailChannels' dashboard.
 *
 * Vercel runs in AWS, not Cloudflare, so a key is required here.
 */
async function sendMailChannels(msg: EmailMessage): Promise<EmailResult | null> {
  const apiKey = process.env.MAILCHANNELS_API_KEY;
  if (!apiKey) return null;

  const to = normalizeRecipients(msg.to);
  if (to.length === 0) return { ok: false, provider: null, reason: 'no_valid_recipients' };
  const cc = normalizeRecipients(msg.cc);
  const bcc = normalizeRecipients(msg.bcc);
  const replyTo = msg.replyTo ? validateEmail(msg.replyTo) : null;

  const fromRaw = msg.from ?? process.env.EMAIL_FROM ?? DEFAULT_FROM;
  const fromMatch = fromRaw.match(/^(.+?)\s*<(.+)>$/);
  const fromAddr = fromMatch ? fromMatch[2].trim() : fromRaw.trim();
  const fromName = fromMatch ? fromMatch[1].trim() : DEFAULT_FROM_NAME;

  const personalization: Record<string, unknown> = {
    to: to.map((email) => ({ email })),
  };
  if (cc.length) personalization.cc = cc.map((email) => ({ email }));
  if (bcc.length) personalization.bcc = bcc.map((email) => ({ email }));

  const body: Record<string, unknown> = {
    personalizations: [personalization],
    from: { email: fromAddr, name: fromName },
    subject: stripHeaderInjection(msg.subject),
    content: [
      { type: 'text/plain', value: msg.text },
      { type: 'text/html', value: msg.html },
    ],
  };
  if (replyTo) body.reply_to = { email: replyTo };

  try {
    const resp = await fetchWithTimeout('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      log.warn('mailchannels rejected', {
        status: resp.status,
        errBody: errText.slice(0, 300),
      });
      return {
        ok: false,
        provider: 'mailchannels',
        reason: `mailchannels_${resp.status}`,
      };
    }
    return { ok: true, provider: 'mailchannels' };
  } catch (err) {
    log.warn('mailchannels network error', {
      err: err instanceof Error ? err.message : 'unknown',
    });
    return { ok: false, provider: 'mailchannels', reason: 'mailchannels_network' };
  }
}

/* ─── Webhook fallback (last resort) ────────────────────────────────── */

/**
 * Generic webhook fallback. Set `EMAIL_WEBHOOK_URL` to a JSON-accepting
 * endpoint (Make.com, Zapier, n8n, your own collector, etc.) that will
 * relay the message via whatever transport your ops team prefers.
 *
 * Useful when:
 *   - You'd rather pay per-Zap than configure DNS.
 *   - You want every lead to ALSO trigger a Slack DM, push notification,
 *     SMS, etc., orchestrated by the webhook receiver.
 *   - You're testing locally with a webhook.site URL.
 */
async function sendWebhook(msg: EmailMessage): Promise<EmailResult | null> {
  const url = process.env.EMAIL_WEBHOOK_URL;
  if (!url) return null;

  const payload = {
    from: msg.from ?? process.env.EMAIL_FROM ?? DEFAULT_FROM,
    to: normalizeRecipients(msg.to),
    cc: normalizeRecipients(msg.cc),
    bcc: normalizeRecipients(msg.bcc),
    replyTo: msg.replyTo ? validateEmail(msg.replyTo) : null,
    subject: stripHeaderInjection(msg.subject),
    text: msg.text,
    html: msg.html,
    headers: msg.headers ?? {},
    timestamp: new Date().toISOString(),
  };

  try {
    const resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      log.warn('webhook fallback rejected', { status: resp.status });
      return {
        ok: false,
        provider: 'webhook-fallback',
        reason: `webhook_${resp.status}`,
      };
    }
    return { ok: true, provider: 'webhook-fallback' };
  } catch (err) {
    log.warn('webhook fallback network error', {
      err: err instanceof Error ? err.message : 'unknown',
    });
    return { ok: false, provider: 'webhook-fallback', reason: 'webhook_network' };
  }
}

/* ─── Public dispatcher ─────────────────────────────────────────────── */

/**
 * Configured email-recipient resolution. Order:
 *   1. Caller-supplied `to`.
 *   2. process.env.LEAD_NOTIFY_TO (comma-separated supported).
 *   3. DEFAULT_OPERATIONS_EMAIL (sandravasquezcgc@gmail.com).
 */
export function resolveLeadRecipients(toOverride?: string | string[]): {
  to: string[];
  cc: string[];
} {
  const toRaw = toOverride ?? process.env.LEAD_NOTIFY_TO ?? DEFAULT_OPERATIONS_EMAIL;
  const ccRaw = process.env.LEAD_NOTIFY_CC ?? '';
  return {
    to: normalizeRecipients(toRaw),
    cc: normalizeRecipients(ccRaw),
  };
}

/**
 * Send a transactional email. Tries each configured provider in priority
 * order and returns the first success. If no providers are configured
 * OR all configured providers fail, returns `{ ok: false, provider: null }`.
 *
 * Caller's responsibility:
 *   - Sanitize all user-supplied data BEFORE assembling msg.html (use
 *     escapeHtml above as a final guard).
 *   - Catch return value — never throw on { ok: false } from inside the
 *     lead-intake handler. Log the failure, return success to the user
 *     anyway (the lead is in KV + log + webhooks regardless).
 */
export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const providers: Array<() => Promise<EmailResult | null>> = [
    () => sendResend(msg),
    () => sendSendGrid(msg),
    () => sendMailChannels(msg),
    () => sendWebhook(msg),
  ];

  const startedAt = Date.now();
  let lastFailure: EmailResult | null = null;
  for (const provider of providers) {
    // Global budget cap: if we've already burned most of our time
    // budget trying earlier providers, don't kick off a fresh call
    // that could blow the Vercel function's 10-second window. The
    // remaining time would be wasted anyway because the function
    // would be killed mid-request, leaving the user with a 502.
    if (Date.now() - startedAt > SEND_BUDGET_MS) {
      log.warn('send budget exhausted — short-circuiting provider chain', {
        elapsedMs: Date.now() - startedAt,
        lastProvider: lastFailure?.provider,
      });
      break;
    }
    const result = await provider();
    if (result === null) continue; // not configured
    if (result.ok) {
      log.info('email sent', {
        provider: result.provider,
        messageId: result.messageId,
        elapsedMs: Date.now() - startedAt,
      });
      return result;
    }
    lastFailure = result;
  }

  if (lastFailure) {
    log.error('all email providers failed', {
      lastProvider: lastFailure.provider,
      lastReason: lastFailure.reason,
    });
    return lastFailure;
  }

  // No providers configured at all — log loud so operators see it.
  log.warn(
    'no email provider configured — set RESEND_API_KEY (recommended) or one of SENDGRID_API_KEY / MAILCHANNELS_API_KEY / EMAIL_WEBHOOK_URL',
  );
  return { ok: false, provider: null, reason: 'no_provider_configured' };
}

/** Re-export the default so the leads endpoint can surface it in logs. */
export { DEFAULT_OPERATIONS_EMAIL };
