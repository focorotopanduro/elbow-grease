/**
 * /api/csp-report — receives Content-Security-Policy violation reports
 * from the browser. Browsers POST a JSON blob whenever a page tries
 * to load / execute something that the CSP forbids.
 *
 * Two report formats exist (browsers are split):
 *   - Legacy (`Content-Type: application/csp-report`):
 *     `{ "csp-report": { "blocked-uri": "...", "violated-directive": "..." } }`
 *   - Modern Reporting API (`Content-Type: application/reports+json`):
 *     `[{ "type": "csp-violation", "body": { ... } }]`
 *
 * We accept both shapes + log them through the structured logger so
 * production CSP violations show up in the dashboard. A spike in
 * `csp_violation` events typically means:
 *   - Someone tried to inject a third-party tracker (CSP blocked it)
 *   - A new browser extension is interfering with the page
 *   - A dependency was updated to load a new external resource that
 *     isn't yet whitelisted (legitimate, you'd need to update CSP)
 *
 * SECURITY:
 *   - Returns 204 No Content immediately — never makes the browser
 *     wait on us, never leaks information back about what was logged
 *   - Body size capped at 8 KB (CSP reports are small JSON)
 *   - No origin check (browsers send these without an Origin header,
 *     and reports come from anywhere on the internet by design)
 *   - Heavy rate limiting because this endpoint is publicly-postable
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rateLimitCheck } from './_lib/rateLimit';
import { getClientIp, safeJsonParse } from './_lib/security';
import { logger } from './_lib/logger';

export const config = {
  runtime: 'nodejs',
  api: { bodyParser: { sizeLimit: '8kb' } },
};

const RATE_BURST = 100; // CSP reports can spike on a bad deploy
const RATE_WINDOW_S = 60;

interface CspReportLegacy {
  'csp-report': {
    'document-uri'?: string;
    'violated-directive'?: string;
    'blocked-uri'?: string;
    'source-file'?: string;
    'line-number'?: number;
    'column-number'?: number;
    referrer?: string;
  };
}

interface CspReportModern {
  type: string;
  body: {
    documentURL?: string;
    effectiveDirective?: string;
    blockedURL?: string;
    sourceFile?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  // @ts-expect-error — VercelRequest.headers shape compatible
  const ip = getClientIp(req.headers);
  const limit = await rateLimitCheck({
    prefix: 'csp-report',
    bucket: ip,
    limit: RATE_BURST,
    windowSeconds: RATE_WINDOW_S,
  });
  // ALWAYS respond 204 — never let an attacker probe for what's logged
  res.status(204).end();
  if (limit.limited) return;

  // Process AFTER responding so we never block the browser
  const log = logger('api/csp-report');
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
  const parsed = safeJsonParse(rawBody);
  if (parsed == null) return;

  const reports: Array<CspReportLegacy | CspReportModern> = Array.isArray(parsed)
    ? (parsed as CspReportModern[])
    : [parsed as CspReportLegacy];

  for (const r of reports) {
    if ('csp-report' in r && r['csp-report']) {
      const v = r['csp-report'];
      log.warn('csp_violation', {
        directive: v['violated-directive'],
        blocked: v['blocked-uri'],
        document: v['document-uri'],
        source: v['source-file'],
        line: v['line-number'],
      });
    } else if ('body' in r && r.body && r.type === 'csp-violation') {
      const v = r.body;
      log.warn('csp_violation', {
        directive: v.effectiveDirective,
        blocked: v.blockedURL,
        document: v.documentURL,
        source: v.sourceFile,
        line: v.lineNumber,
      });
    }
  }
}
