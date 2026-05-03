/**
 * /api/health — uptime + readiness probe.
 *
 * Returns 200 OK with a small JSON payload that uptime monitors
 * (UptimeRobot, BetterStack, Pingdom) can poll cheaply. Includes:
 *   - `ok: true`               — simple boolean for monitor logic
 *   - `version`                — git SHA (set via VERCEL_GIT_COMMIT_SHA)
 *   - `uptimeMs`               — process uptime (cold-start = small)
 *   - `region`                 — Vercel deployment region for routing debug
 *   - `ts`                     — server time (drift detection)
 *
 * No DB / no external calls — health endpoint must NEVER depend on
 * downstream systems (otherwise a Resend outage would look like
 * the entire site is down).
 *
 * Cache-Control: no-store so monitors always get a fresh response
 * (otherwise Vercel's edge cache could serve a stale 200 during
 * an outage and we wouldn't see it).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kvAvailable, kvCommand } from './_lib/kv';

export const config = { runtime: 'nodejs' };

const startedAt = Date.now();

/**
 * KV liveness check — cached for 30s so a monitor polling the
 * health endpoint every 60s doesn't hammer Redis with PING calls.
 * If KV is misconfigured, the result is `'disabled'` (not an error
 * — a deployment without KV is a valid configuration). If KV is
 * configured but unreachable, the result is `'down'` and the
 * overall health response degrades to status 503.
 */
type KvStatus = 'up' | 'down' | 'disabled';
let kvCache: { status: KvStatus; checkedAt: number } | null = null;
const KV_CHECK_TTL_MS = 30_000;

async function checkKvHealth(): Promise<KvStatus> {
  if (kvCache && Date.now() - kvCache.checkedAt < KV_CHECK_TTL_MS) {
    return kvCache.status;
  }
  if (!kvAvailable()) {
    kvCache = { status: 'disabled', checkedAt: Date.now() };
    return 'disabled';
  }
  try {
    const pong = await kvCommand('PING');
    const status: KvStatus = pong === 'PONG' || pong === 'pong' ? 'up' : 'down';
    kvCache = { status, checkedAt: Date.now() };
    return status;
  } catch {
    kvCache = { status: 'down', checkedAt: Date.now() };
    return 'down';
  }
}

/**
 * Email provider status — derived from env vars only (no external
 * call; we never want a Resend rate limit to make /api/health fail).
 *
 * - `configured` = at least one provider env var is set, so an actual
 *   email send WILL be attempted by /api/leads
 * - `disabled`  = no provider configured. Leads still flow to KV +
 *   webhooks, but no inbox notification is sent. This is a valid dev
 *   state but a production-incident-worthy state for prod.
 *
 * The `recipient` field reports which mailbox is configured to receive
 * the lead notifications (`LEAD_NOTIFY_TO`, falling back to default).
 * Useful for verifying the env was set correctly after a redeploy.
 */
type EmailStatus = 'configured' | 'disabled';

function checkEmailHealth(): { status: EmailStatus; provider: string; recipient: string } {
  const providers: string[] = [];
  if (process.env.RESEND_API_KEY) providers.push('resend');
  if (process.env.SENDGRID_API_KEY) providers.push('sendgrid');
  if (process.env.MAILCHANNELS_API_KEY) providers.push('mailchannels');
  if (process.env.EMAIL_WEBHOOK_URL) providers.push('webhook');
  return {
    status: providers.length > 0 ? 'configured' : 'disabled',
    provider: providers[0] ?? 'none',
    // Show only the local-part + masked domain — leaking the full
    // recipient on a public health endpoint would tell harvesters who
    // to phish. Format: `s***@***il.com`.
    recipient: maskEmail(process.env.LEAD_NOTIFY_TO ?? 'sandravasquezcgc@gmail.com'),
  };
}

function maskEmail(addr: string): string {
  const first = addr.split(',')[0]?.trim() ?? addr;
  const at = first.indexOf('@');
  if (at < 1) return '***';
  const local = first.slice(0, at);
  const domain = first.slice(at + 1);
  const localMasked = local.length > 1 ? `${local[0]}${'*'.repeat(Math.max(2, local.length - 1))}` : '*';
  const dotIdx = domain.lastIndexOf('.');
  const domainBase = dotIdx > 0 ? domain.slice(0, dotIdx) : domain;
  const tld = dotIdx > 0 ? domain.slice(dotIdx) : '';
  const domainMasked =
    domainBase.length > 2
      ? `${'*'.repeat(domainBase.length - 2)}${domainBase.slice(-2)}`
      : '**';
  return `${localMasked}@${domainMasked}${tld}`;
}

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  const kv = await checkKvHealth();
  const email = checkEmailHealth();
  // Status code logic: 200 when everything is operational, 503 when
  // a critical dependency is degraded. KV being 'disabled' is fine
  // (the API gracefully falls through to mailto: handoff). Email
  // 'disabled' is also a valid state — we never auto-fail health on
  // it. Operators can alert on `email.status: "disabled"` separately
  // when they want strict production gating.
  const operational = kv !== 'down';
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(operational ? 200 : 503).json({
    ok: operational,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? 'dev',
    uptimeMs: Date.now() - startedAt,
    region: process.env.VERCEL_REGION ?? 'local',
    ts: new Date().toISOString(),
    deps: {
      kv,
      email,
    },
  });
}
