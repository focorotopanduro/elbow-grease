/**
 * /api/cron/send-review-requests — daily review-request automation.
 *
 * Tier 8 deliverable. Triggers daily at 10am ET (configured in
 * vercel.json `crons` block). For each lead whose status is
 * 'completed' AND completion_date is 2-5 days ago AND no review
 * request has been sent yet, fires the post-job review-request
 * email template (English or Spanish based on customer.lang).
 *
 * AUTHENTICATION:
 * Same Bearer-token pattern as purge-leads.ts. Vercel Cron sends
 * `Authorization: Bearer ${CRON_SECRET}`; we compare in constant
 * time. Without CRON_SECRET configured, the function fails closed.
 *
 * IDEMPOTENCY:
 * Each lead's KV record gets a `review_requested: true` flag once
 * the email is sent. Re-running the cron same-day is safe — already-
 * flagged leads are skipped.
 *
 * BATCH LIMIT:
 * 50 emails per run to stay under typical email-provider rate limits
 * (Resend: 100/sec on free tier, but conservative is better). If the
 * backlog exceeds 50, the rest catch up on the next day's run.
 *
 * STATUS: STUB — the storage backend doesn't yet track lead lifecycle
 * status. The current /api/leads only stores the intake payload; there's
 * no `status` or `completion_date` field. To make this cron functional:
 *
 *   1. Extend the lead schema in /api/leads to include status fields:
 *        status: 'new' | 'contacted' | 'quoted' | 'completed' | 'lost'
 *        statusUpdatedAt: ISO timestamp
 *        completionDate?: ISO timestamp
 *        lang?: 'en' | 'es'
 *        reviewRequested?: boolean
 *   2. Build an admin UI / API for the owner to flip status as work
 *      progresses (or integrate with a CRM that pushes status changes).
 *   3. Configure an email provider (Resend / SendGrid / SES) and add
 *      EMAIL_FROM + EMAIL_API_KEY env vars.
 *   4. Replace the STUB sections below with real reads + sends.
 *
 * Until then, this cron runs cleanly, finds no eligible leads, and
 * logs a structured no-op report. Safer than crashing or sending
 * unintended emails from incomplete data.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kvAvailable } from '../_lib/kv';
import { timingSafeStringEqual } from '../_lib/security';
import { logger } from '../_lib/logger';

export const config = { runtime: 'nodejs' };

/** Window: leads whose completion_date falls in [now-5d, now-2d]. */
const MIN_AGE_DAYS = 2;
const MAX_AGE_DAYS = 5;
/** Cap per run to avoid email-provider rate limits. */
const BATCH_LIMIT = 50;

interface ReviewRequestReport {
  ok: true;
  /** How many leads were eligible (status=completed, age 2-5d, not yet flagged). */
  eligibleCount: number;
  /** How many emails were attempted. */
  attemptedCount: number;
  /** How many succeeded. */
  sentCount: number;
  /** How many failed (network / provider rejection). */
  failedCount: number;
  /** Future implementation cap; surfaced now so operators see the configured ceiling. */
  batchLimit: number;
  durationMs: number;
  /** True when the storage backend or email provider isn't wired yet. */
  stub: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const startedAt = Date.now();
  const log = logger('api/cron/send-review-requests');

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  // Same Bearer auth as purge-leads
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error('CRON_SECRET env var not configured — refusing to run');
    res.status(500).json({ ok: false, error: 'cron_secret_not_configured' });
    return;
  }
  const authHeader = req.headers.authorization ?? '';
  const expectedHeader = `Bearer ${expected}`;
  if (!timingSafeStringEqual(authHeader, expectedHeader)) {
    log.warn('unauthorized review-request cron attempt', {
      hasAuth: authHeader.length > 0,
    });
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  // Compute the eligibility window
  const now = Date.now();
  const minTs = now - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const maxTs = now - MIN_AGE_DAYS * 24 * 60 * 60 * 1000;

  const eligibleCount = 0;
  const attemptedCount = 0;
  const sentCount = 0;
  const failedCount = 0;
  const stub = true;

  try {
    if (!kvAvailable()) {
      log.info('storage backend not available — review-request cron is a no-op');
    } else {
      // ┌────────────────────────────────────────────────────────────┐
      // │ STUB — storage schema doesn't yet track lead lifecycle.    │
      // │                                                              │
      // │ When the lead schema is extended (see file header):         │
      // │                                                              │
      // │   const ids = await kvCommand(                              │
      // │     'ZRANGEBYSCORE',                                         │
      // │     'leads:by-completion',                                   │
      // │     minTs,                                                   │
      // │     maxTs,                                                   │
      // │     'LIMIT', 0, BATCH_LIMIT                                 │
      // │   );                                                         │
      // │                                                              │
      // │   for (const id of ids) {                                   │
      // │     const lead = JSON.parse(                                │
      // │       await kvCommand('GET', `lead:${id}`)                  │
      // │     );                                                       │
      // │     if (!lead || lead.reviewRequested) continue;            │
      // │     eligibleCount++;                                         │
      // │     attemptedCount++;                                        │
      // │     try {                                                    │
      // │       await sendReviewEmail(lead);                          │
      // │       await kvCommand('SET', `lead:${id}`, JSON.stringify({ │
      // │         ...lead, reviewRequested: true                      │
      // │       }), 'KEEPTTL');                                        │
      // │       sentCount++;                                           │
      // │     } catch (err) {                                          │
      // │       failedCount++;                                         │
      // │     }                                                        │
      // │   }                                                          │
      // │                                                              │
      // │ The sendReviewEmail() helper would use the templates in     │
      // │ docs/review-request-templates.md, picking English or        │
      // │ Spanish based on lead.lang.                                  │
      // └────────────────────────────────────────────────────────────┘
      log.info('review-request cron is a stub until lead lifecycle schema lands', {
        windowMinISO: new Date(minTs).toISOString(),
        windowMaxISO: new Date(maxTs).toISOString(),
        batchLimit: BATCH_LIMIT,
      });
    }
  } catch (err) {
    log.error('storage error during review-request cron', {
      err: err instanceof Error ? err.message : 'unknown',
    });
    res.status(500).json({
      ok: false,
      error: 'storage_error',
      reason: err instanceof Error ? err.message : 'unknown',
    });
    return;
  }

  const report: ReviewRequestReport = {
    ok: true,
    eligibleCount,
    attemptedCount,
    sentCount,
    failedCount,
    batchLimit: BATCH_LIMIT,
    durationMs: Date.now() - startedAt,
    stub,
  };

  // eslint-disable-next-line no-console
  console.log('[send-review-requests]', JSON.stringify(report));
  res.status(200).json(report);
}
