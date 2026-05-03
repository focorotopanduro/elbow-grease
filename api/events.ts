/**
 * /api/events — analytics beacon receiver.
 *
 * Receives the raw beacon stream sent by `lib/analytics.ts` via
 * `navigator.sendBeacon`. Mirrors the gtag/fbq stream so you have
 * an independent first-party log of every funnel event (in case
 * GA / Meta drop events, get blocked by ad-blockers, or change
 * their schema unexpectedly).
 *
 * Returns 204 No Content immediately — beacons are fire-and-forget
 * and we don't want to make the client wait. The actual logging /
 * forwarding happens after we send the response.
 *
 * Origin allowlist + per-IP rate limit + body size cap match the
 * /api/leads function so the surface is consistent.
 *
 * STORAGE: the stub logs to stdout. In production replace with:
 *   - A managed log sink (Datadog, Logflare, BetterStack)
 *   - A row in your warehouse (BigQuery, Snowflake)
 *   - A push to Kafka / EventBridge for downstream processing
 *
 * The event payload is small + ephemeral; you don't need to store
 * it forever. A 30-day TTL is plenty for funnel analysis.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rateLimitCheck } from './_lib/rateLimit';
import { generateRequestId, getClientIp, isAllowedSiteOrigin, safeJsonParse } from './_lib/security';
import { logger } from './_lib/logger';

export const config = {
  runtime: 'nodejs',
  api: { bodyParser: { sizeLimit: '8kb' } },
};

const MAX_BODY_BYTES = 8192;

const RATE_BURST = 60; // higher than /api/leads — analytics fires often
const RATE_WINDOW_S = 5;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const reqId = generateRequestId();
  const log = logger('api/events', { reqId });
  res.setHeader('X-Request-Id', reqId);

  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    res.status(415).end();
    return;
  }

  const origin = req.headers.origin;
  if (origin && !isAllowedSiteOrigin(origin)) {
    res.status(403).end();
    return;
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  const cl = Number(req.headers['content-length'] ?? 0);
  if (cl > MAX_BODY_BYTES) {
    res.status(413).end();
    return;
  }

  // Distributed KV rate limit — same shape as /api/leads but with
  // a higher burst (analytics fires often, leads should not).
  // @ts-expect-error — VercelRequest.headers shape compatible
  const ip = getClientIp(req.headers);
  const limit = await rateLimitCheck({
    prefix: 'event-ip',
    bucket: ip,
    limit: RATE_BURST,
    windowSeconds: RATE_WINDOW_S,
  });
  if (limit.limited) {
    // Don't 429 — beacon clients won't retry, so we'd lose the event.
    // Return 204 so the client thinks it succeeded; we just drop it.
    res.status(204).end();
    return;
  }

  // Respond immediately — beacons are fire-and-forget
  res.status(204).end();

  // Parse + log AFTER responding so client never waits on us.
  // PRIVACY: IP is used at the edge for rate-limiting only and
  // intentionally never reaches the log line. The body itself is
  // already PII-free per the analytics layer's stripping rules.
  // safeJsonParse strips __proto__/constructor keys to defend
  // against prototype-pollution from a compromised client.
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  const body = safeJsonParse(rawBody);
  if (body === null) return; // malformed — silently drop, don't log noise
  // Tier 7 — server-side PII strip. Defense in depth: the client
  // analytics layer should NEVER send these fields, but if a future
  // bug or compromised client tries to, we drop them at the edge
  // before they reach any log sink.
  log.info('event', { body: stripPiiFields(body) });
}

/**
 * Top-level PII fields that get dropped before logging. The list is
 * intentionally narrow — over-stripping would remove legitimate
 * payload fields that happen to share a name (the form's actual lead
 * fields go through /api/leads, never /api/events). Only event
 * payloads should ever flow here, and event payloads should never
 * contain raw PII per the analytics policy in src/lib/analytics.ts.
 */
const PII_FIELDS = new Set([
  'name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'phone_number',
  'address',
  'street',
  'street_address',
  'zip',
  'zip_code',
  'postal_code',
  'ssn',
  'license',
  'credit_card',
  'card_number',
]);

function stripPiiFields(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (PII_FIELDS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}
