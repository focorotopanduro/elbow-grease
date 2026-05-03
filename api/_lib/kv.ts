/**
 * Tiny Vercel KV adapter — no `@vercel/kv` npm dependency required.
 *
 * Vercel KV (which wraps Upstash Redis) exposes a REST endpoint that
 * accepts pipeline-style commands as JSON arrays. By calling it
 * directly via `fetch`, we avoid adding a 50 kB+ dependency to the
 * serverless function bundle, keep cold-start time minimal, and
 * stay in full control of the network surface.
 *
 * SETUP — three steps, ~5 minutes:
 *   1. In Vercel project → Storage → Create Database → KV.
 *      Vercel auto-creates an Upstash Redis database + injects
 *      `KV_REST_API_URL` + `KV_REST_API_TOKEN` env vars into your
 *      serverless functions.
 *   2. Redeploy. The next /api/leads request will start writing to
 *      the database. Existing leads stay in the function logs.
 *   3. Done. The 90-day TTL is set per-write (see /api/leads), so
 *      Redis auto-evicts old records. The cron in
 *      /api/cron/purge-leads is a SAFETY NET that runs daily to
 *      catch any TTL-survivors via the time-index sorted set.
 *
 * GRACEFUL DEGRADATION:
 * If `KV_REST_API_URL` / `KV_REST_API_TOKEN` env vars are missing
 * (development, or you haven't set up the database yet), every
 * adapter call becomes a no-op + returns `null`. Lead intake still
 * succeeds (mailto: handoff still works); the lead just isn't
 * persisted to KV. Operators see a single warning log line on
 * cold-start, not a hard failure.
 *
 * SECURITY:
 *   - Token is a Bearer secret read from env (never hardcoded)
 *   - URL is locked to the Vercel-injected value (no untrusted input
 *     reaches the network call)
 *   - All command arguments are JSON-serialized then sent as a
 *     POST body — no command injection vector
 *   - Errors swallow + log, never throw upward (analytics + storage
 *     should never block the user response path)
 */

type KVValue = string | number | null;
type KVCommand = readonly (string | number)[];

const URL_KEY = 'KV_REST_API_URL';
const TOKEN_KEY = 'KV_REST_API_TOKEN';

let warned = false;

function getConfig(): { url: string; token: string } | null {
  const url = process.env[URL_KEY];
  const token = process.env[TOKEN_KEY];
  if (!url || !token) {
    if (!warned) {
      warned = true;
      // eslint-disable-next-line no-console
      console.warn(
        `[kv] ${URL_KEY} / ${TOKEN_KEY} not configured — lead persistence disabled. ` +
          `See api/_lib/kv.ts header for setup steps.`
      );
    }
    return null;
  }
  return { url, token };
}

/**
 * Run a single Redis command via the Vercel KV REST API.
 * Returns the parsed JSON response body's `result` field (string,
 * number, or null), or null on failure.
 */
export async function kvCommand(...args: KVCommand): Promise<KVValue> {
  const cfg = getConfig();
  if (!cfg) return null;

  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      // Only log status + command name (args[0]). Never log args[1+]
      // because they can contain user data (lead JSON, payload bodies).
      // eslint-disable-next-line no-console
      console.error(`[kv] command failed status=${res.status} cmd=${args[0]}`);
      return null;
    }
    const data = await res.json();
    return (data?.result as KVValue) ?? null;
  } catch (err) {
    // Log only the error message — never the full err object, which
    // can contain URLs, headers, or other context that's safe to leak
    // for debugging but unnecessary for ops alerts.
    const msg = err instanceof Error ? err.message : 'unknown';
    // eslint-disable-next-line no-console
    console.error(`[kv] network error: ${msg.slice(0, 120)}`);
    return null;
  }
}

/**
 * Run multiple Redis commands in a single round-trip via the
 * /pipeline endpoint. Saves latency when /api/leads writes the
 * lead doc + indexes it in the time-sorted-set in one shot.
 *
 * Returns an array of result values in the same order as the
 * input commands. Failures yield null entries; the function never
 * throws so callers can blanket-handle "best-effort persistence".
 */
export async function kvPipeline(commands: ReadonlyArray<KVCommand>): Promise<(KVValue)[]> {
  const cfg = getConfig();
  if (!cfg) return commands.map(() => null);

  try {
    const res = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(`[kv] pipeline failed status=${res.status}`);
      return commands.map(() => null);
    }
    const data = await res.json();
    if (!Array.isArray(data)) return commands.map(() => null);
    return data.map((item: { result?: KVValue }) => item?.result ?? null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    // eslint-disable-next-line no-console
    console.error(`[kv] pipeline network error: ${msg.slice(0, 120)}`);
    return commands.map(() => null);
  }
}

/**
 * Returns true when KV is configured (env vars present). Useful
 * for callers that want to skip storage operations entirely
 * during local dev or when intentionally running without persistence.
 */
export function kvAvailable(): boolean {
  return getConfig() !== null;
}
