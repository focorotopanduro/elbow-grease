/**
 * /api/cron/purge-leads — daily lead-data retention enforcement.
 *
 * Runs once per day (configured in vercel.json `crons` block) and
 * deletes any lead records older than 90 days from whatever
 * persistent store you wire up. The 90-day window is documented
 * in SECURITY.md "Data retention" — long enough to call back +
 * follow up, short enough to limit breach blast radius.
 *
 * AUTHENTICATION:
 * Vercel Cron jobs send a `Authorization: Bearer <CRON_SECRET>`
 * header where CRON_SECRET is an env var YOU configure in the
 * Vercel project settings. The handler rejects any request that
 * doesn't present the matching secret — prevents random visitors
 * from triggering the purge by hitting the URL directly.
 *
 * To set up:
 *   1. In Vercel project settings → Environment Variables, add
 *      `CRON_SECRET` with a strong random value (e.g. `openssl rand -hex 32`).
 *   2. The `crons` block in vercel.json schedules this endpoint.
 *   3. First run happens 24 hours after deploy; subsequent runs daily.
 *
 * STORAGE BACKEND:
 * Currently a STUB. The handler validates the request, logs an
 * audit entry, and returns a structured response with a count of 0
 * (no records to purge yet because we haven't wired up persistent
 * storage). When you connect a real store, uncomment the relevant
 * adapter block and add the env vars.
 *
 * Three storage paths are pre-stubbed with commented code:
 *   - Vercel KV (Redis-compatible, simplest for low volume)
 *   - Vercel Postgres (relational, easier to query for the inspector
 *     dashboard you might build later)
 *   - External CRM webhook (delete-by-ID call to Jobber / HubSpot /
 *     wherever leads ultimately land)
 *
 * AUDITING:
 * Every purge run emits a structured log line `[purge-leads]` with
 * { ts, purgedCount, cutoffMs, durationMs } so you can `grep` Vercel
 * function logs to verify the cron is firing + working. The annual-
 * review checklist in SECURITY.md includes "verify lead-purge logs".
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kvAvailable, kvCommand, kvPipeline } from '../_lib/kv';
import { timingSafeStringEqual } from '../_lib/security';
import { logger } from '../_lib/logger';

export const config = { runtime: 'nodejs' };

const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

interface PurgeReport {
  ok: true;
  purgedCount: number;
  cutoffMs: number;
  cutoffISO: string;
  retentionDays: number;
  durationMs: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const startedAt = Date.now();

  // Method gate — cron only triggers GET, but reject everything else
  // explicitly so a misconfigured deploy that exposes this URL via
  // POST doesn't accidentally allow probing.
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  // AUTH — Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`.
  // We compare in constant time using crypto.timingSafeEqual via
  // the shared timingSafeStringEqual helper. The naive `===` would
  // short-circuit on the first mismatched character + leak the
  // secret one character at a time over many polling attempts.
  // If CRON_SECRET isn't set, REJECT (don't run a destructive
  // operation without auth — fail closed).
  const log = logger('api/cron/purge-leads');
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error('CRON_SECRET env var not configured — refusing to run');
    res.status(500).json({ ok: false, error: 'cron_secret_not_configured' });
    return;
  }
  const authHeader = req.headers.authorization ?? '';
  const expectedHeader = `Bearer ${expected}`;
  if (!timingSafeStringEqual(authHeader, expectedHeader)) {
    log.warn('unauthorized purge attempt', { hasAuth: authHeader.length > 0 });
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const cutoffMs = Date.now() - RETENTION_MS;
  const cutoffISO = new Date(cutoffMs).toISOString();
  let purgedCount = 0;

  try {
    // ┌────────────────────────────────────────────────────────────┐
    // │ STORAGE ADAPTER — Vercel KV (Upstash Redis)                │
    // │                                                              │
    // │ Each lead is written by /api/leads with a 90-day TTL, so    │
    // │ Redis already auto-evicts records as they age out. This     │
    // │ cron is a SAFETY NET that handles two cases TTL alone       │
    // │ doesn't cover:                                               │
    // │   1. The time-sorted-set (`leads:by-time`) doesn't have an  │
    // │      auto-TTL — entries pile up there forever unless we     │
    // │      explicitly remove them. ZREMRANGEBYSCORE handles that. │
    // │   2. If a future code change ever forgets to set EX on a    │
    // │      lead doc write, the cron will catch it and delete the  │
    // │      stale `lead:*` keys via DEL.                            │
    // │                                                              │
    // │ Strategy: read the time-index for IDs older than the cutoff,│
    // │ delete each lead doc in a pipeline, then trim the index.    │
    // └────────────────────────────────────────────────────────────┘
    if (!kvAvailable()) {
      // No storage configured (env vars missing) → nothing to purge.
      // Still return success so the cron health check stays green.
    } else {
      // ZRANGEBYSCORE returns the IDs whose timestamp score is older
      // than the cutoff. Limit to 1000 per run so a backlog doesn't
      // exceed the cron's 10-second budget on slow days.
      const ids = (await kvCommand(
        'ZRANGEBYSCORE',
        'leads:by-time',
        '-inf',
        cutoffMs,
        'LIMIT',
        0,
        1000
      )) as unknown;

      const expiredIds: string[] = Array.isArray(ids) ? (ids as string[]) : [];

      if (expiredIds.length > 0) {
        // Pipeline: DEL each stale lead doc + trim the time-index in
        // a single round-trip. If any DEL fails (record already
        // TTL-evicted), KV returns 0 — that's fine, we just remove
        // the index entry anyway.
        await kvPipeline([
          ...expiredIds.map((id) => ['DEL', `lead:${id}`] as const),
          ['ZREMRANGEBYSCORE', 'leads:by-time', '-inf', cutoffMs] as const,
        ]);
        purgedCount = expiredIds.length;
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[purge-leads] storage error', err);
    res.status(500).json({
      ok: false,
      error: 'storage_error',
      reason: err instanceof Error ? err.message : 'unknown',
    });
    return;
  }

  const report: PurgeReport = {
    ok: true,
    purgedCount,
    cutoffMs,
    cutoffISO,
    retentionDays: RETENTION_DAYS,
    durationMs: Date.now() - startedAt,
  };

  // Structured audit log — `grep [purge-leads]` in Vercel function
  // logs to verify cron is firing + working. The annual-review
  // checklist in SECURITY.md includes confirming this log.
  // eslint-disable-next-line no-console
  console.log('[purge-leads]', JSON.stringify(report));

  res.status(200).json(report);
}
