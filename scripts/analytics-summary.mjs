/**
 * analytics-summary — funnel + Web Vitals reporter for the Beit
 * analytics event stream.
 *
 * STATUS: STUB — events currently flow to Vercel runtime logs (via
 * api/_lib/logger.ts), which are not directly queryable from this
 * script. To make this report real, wire a queryable sink first:
 *
 *   - **Vercel KV** (recommended for Beit's volume): ~$10/mo Redis-
 *     compatible store. `kv.zadd('events', score, JSON.stringify(event))`
 *     in api/events.ts. This script then `kv.zrangebyscore('events',
 *     last24hStart, now)` to fetch events.
 *
 *   - **Vercel Postgres**: relational, can JOIN to leads table.
 *     `INSERT INTO events (ts, event, payload, session_id) VALUES (...)`.
 *
 *   - **Log-streaming**: Logflare / BetterStack / Datadog provide REST
 *     APIs to query log lines back. Configure log forwarding in Vercel
 *     project settings.
 *
 * Once one of those is wired, replace the `fetchEvents()` stub below
 * with the real query. Everything downstream (funnel breakdown, CTA
 * placement ranking, Web Vitals percentiles) already works against
 * the canonical event shape.
 *
 * USAGE (once wired):
 *   npm run analytics:summary             # Default: last 7 days
 *   npm run analytics:summary -- 24h      # Last 24 hours
 *   npm run analytics:summary -- 30d      # Last 30 days
 *   npm run analytics:summary -- 24h -v   # Verbose — include event-by-event listing
 *
 * Outputs:
 *   - Total events
 *   - Funnel breakdown (page_view → qualified_visit → cta_click → lead_*)
 *   - Top CTA placements
 *   - Web Vitals p50 / p75 / p90 per metric
 *   - Error rate (page_error / page_view)
 */

import process from 'node:process';

/* ─── Argument parsing ────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const verbose = args.includes('-v') || args.includes('--verbose');
const windowArg = args.find((a) => /^\d+[hd]$/.test(a)) ?? '7d';

function parseWindow(w) {
  const m = w.match(/^(\d+)([hd])$/);
  if (!m) return 7 * 24 * 3600 * 1000;
  const n = Number(m[1]);
  const unit = m[2];
  return unit === 'h' ? n * 3600 * 1000 : n * 24 * 3600 * 1000;
}

const windowMs = parseWindow(windowArg);
const sinceMs = Date.now() - windowMs;

/* ─── Event fetcher (STUB — replace once a sink is wired) ─────────────── */

/**
 * Fetch all events fired since `sinceMs` epoch milliseconds.
 *
 * Replace this with a real query against the chosen sink. Examples:
 *
 *   // Vercel KV (Redis-compatible)
 *   import { kv } from '@vercel/kv';
 *   const raw = await kv.zrangebyscore('events', sinceMs, '+inf');
 *   return raw.map((s) => JSON.parse(s));
 *
 *   // Vercel Postgres
 *   import { sql } from '@vercel/postgres';
 *   const { rows } = await sql`SELECT * FROM events WHERE ts >= ${new Date(sinceMs)}`;
 *   return rows;
 *
 *   // Logflare REST API
 *   const resp = await fetch(`https://api.logflare.app/api/sources/${SOURCE_ID}/events?` +
 *                            `min_timestamp=${sinceMs}`,
 *                            { headers: { 'X-API-KEY': process.env.LOGFLARE_KEY } });
 *   return (await resp.json()).events;
 */
async function fetchEvents(_sinceMs) {
  // STUB — return empty array so the script runs end-to-end without
  // crashing. Replace with one of the sinks above.
  return [];
}

/* ─── Aggregations ────────────────────────────────────────────────────── */

function countByEvent(events) {
  const counts = new Map();
  for (const e of events) {
    const name = e.event ?? 'unknown';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function funnelBreakdown(events) {
  const counts = countByEvent(events);
  return {
    page_views: counts.get('page_view') ?? 0,
    qualified_visits: counts.get('sim_qualified_visit') ?? 0, // shared name across sim + main
    scroll_50: events.filter((e) => e.event === 'scroll_depth' && e.depth_pct >= 50).length,
    cta_clicks: counts.get('cta_click') ?? 0,
    lead_form_starts: counts.get('lead_form_start') ?? 0,
    lead_form_attempts: counts.get('lead_form_submit_attempt') ?? 0,
    lead_form_successes: counts.get('lead_form_submit_success') ?? 0,
    lead_form_errors: counts.get('lead_form_submit_error') ?? 0,
    lead_form_abandons: counts.get('lead_form_abandon') ?? 0,
  };
}

function topCtaPlacements(events, top = 10) {
  const tally = new Map();
  for (const e of events) {
    if (e.event !== 'cta_click') continue;
    const key = `${e.cta}@${e.placement}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top);
}

function webVitalsPercentiles(events) {
  const byMetric = new Map();
  for (const e of events) {
    if (e.event !== 'web_vital' || typeof e.value !== 'number') continue;
    const arr = byMetric.get(e.metric) ?? [];
    arr.push(e.value);
    byMetric.set(e.metric, arr);
  }
  const result = {};
  for (const [metric, values] of byMetric) {
    values.sort((a, b) => a - b);
    result[metric] = {
      count: values.length,
      p50: values[Math.floor(values.length * 0.5)],
      p75: values[Math.floor(values.length * 0.75)],
      p90: values[Math.floor(values.length * 0.9)],
    };
  }
  return result;
}

/* ─── Format + print ──────────────────────────────────────────────────── */

function formatNumber(n) {
  return new Intl.NumberFormat('en-US').format(n);
}

function rate(num, denom) {
  if (denom === 0) return '—';
  return `${((num / denom) * 100).toFixed(1)}%`;
}

function printSeparator(title) {
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  if (title) console.log(`  ${title}`);
  console.log(line);
}

async function main() {
  printSeparator(`Beit analytics summary — last ${windowArg}`);
  console.log(`Window:      ${new Date(sinceMs).toISOString()} → now`);

  const events = await fetchEvents(sinceMs);
  console.log(`Events:      ${formatNumber(events.length)}`);

  if (events.length === 0) {
    console.log('');
    console.log('  No events returned. This script is a STUB until a queryable');
    console.log('  storage sink is wired. See docs/analytics-events.md for sink');
    console.log('  options (Vercel KV / Postgres / Logflare).');
    console.log('');
    console.log('  Until then, monitor events live via:');
    console.log('    npx vercel logs --follow | grep \'"source":"api/events"\'');
    process.exit(0);
  }

  /* Funnel */
  printSeparator('Conversion funnel');
  const f = funnelBreakdown(events);
  console.log(`  page_view                  ${formatNumber(f.page_views)}`);
  console.log(`  qualified_visit            ${formatNumber(f.qualified_visits)}  (${rate(f.qualified_visits, f.page_views)})`);
  console.log(`  scroll_depth ≥ 50%         ${formatNumber(f.scroll_50)}  (${rate(f.scroll_50, f.page_views)})`);
  console.log(`  cta_click                  ${formatNumber(f.cta_clicks)}  (${rate(f.cta_clicks, f.page_views)})`);
  console.log(`  lead_form_start            ${formatNumber(f.lead_form_starts)}  (${rate(f.lead_form_starts, f.page_views)})`);
  console.log(`  lead_form_submit_attempt   ${formatNumber(f.lead_form_attempts)}  (${rate(f.lead_form_attempts, f.lead_form_starts)} of starts)`);
  console.log(`  lead_form_submit_success   ${formatNumber(f.lead_form_successes)}  (${rate(f.lead_form_successes, f.lead_form_attempts)} of attempts)`);
  console.log(`  lead_form_submit_error     ${formatNumber(f.lead_form_errors)}`);
  console.log(`  lead_form_abandon          ${formatNumber(f.lead_form_abandons)}`);

  /* CTAs */
  printSeparator('Top CTA placements');
  const cta = topCtaPlacements(events, 12);
  if (cta.length === 0) {
    console.log('  (no cta_click events in window)');
  } else {
    for (const [key, count] of cta) {
      console.log(`  ${key.padEnd(48)} ${formatNumber(count)}`);
    }
  }

  /* Web Vitals */
  printSeparator('Core Web Vitals (p50 / p75 / p90)');
  const wv = webVitalsPercentiles(events);
  if (Object.keys(wv).length === 0) {
    console.log('  (no web_vital events in window)');
  } else {
    for (const [metric, p] of Object.entries(wv)) {
      console.log(`  ${metric.padEnd(8)} n=${p.count.toString().padStart(4)} p50=${p.p50?.toFixed(0).padStart(5)} p75=${p.p75?.toFixed(0).padStart(5)} p90=${p.p90?.toFixed(0).padStart(5)}`);
    }
  }

  /* Errors */
  const errorCount = events.filter((e) => e.event === 'page_error').length;
  printSeparator('Errors');
  console.log(`  page_error                 ${formatNumber(errorCount)}  (${rate(errorCount, f.page_views)} of page_views)`);

  if (verbose) {
    printSeparator('Verbose — full event listing');
    for (const e of events) {
      console.log(`  ${new Date(e.ts ?? 0).toISOString()}  ${e.event}  ${JSON.stringify({ ...e, ts: undefined, event: undefined })}`);
    }
  }
}

main().catch((err) => {
  console.error('analytics-summary failed:', err.message);
  process.exit(1);
});
