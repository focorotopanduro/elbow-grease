import { kvPipeline } from './kv';

/**
 * KV-backed distributed rate limiter — works correctly under
 * Vercel's serverless model where multiple instances spin up under
 * load. The previous in-memory rate limiter could be bypassed by
 * an attacker simply hitting the endpoint in parallel: each instance
 * had its own counter, so 10 instances meant 10× the actual limit.
 *
 * This implementation uses Redis INCR + EXPIRE for atomic, instance-
 * agnostic counting. Every call hits the same shared counter
 * regardless of which serverless instance handles the request.
 *
 * ALGORITHM — fixed-window counter:
 *   1. Build a key from `prefix:bucketId:windowStart`
 *   2. INCR the key (atomic)
 *   3. If first hit (count == 1), EXPIRE the key to windowSeconds
 *   4. Return { limited, count, resetAt }
 *
 * Fixed-window has a known boundary-burst issue (a bad actor can fire
 * 2× the limit at the window boundary). For lead intake at 10/min
 * that's at most 20 reqs in 2 seconds — still acceptable, and the
 * simplicity is worth the trade. If we later need stricter limits,
 * upgrade to a sliding-window with sorted-set entries.
 *
 * GRACEFUL DEGRADATION — if KV is unavailable (env vars missing or
 * Redis transient failure), the limiter FAILS OPEN: requests are
 * allowed through. Reasoning: the upstream Vercel edge has its own
 * DDoS protection; we'd rather lose a rate-limit window than reject
 * legitimate users when our storage layer hiccups. Logged as warn.
 *
 * USAGE:
 *   const result = await rateLimitCheck({
 *     prefix: 'lead',
 *     bucket: ip,
 *     limit: 10,
 *     windowSeconds: 60,
 *   });
 *   if (result.limited) return res.status(429).json({ error: 'rate_limited' });
 */

interface RateLimitOptions {
  /** Namespace prefix so different endpoints don't share counters
   *  (e.g. 'lead' vs 'event'). */
  prefix: string;
  /** Bucket identifier — typically IP, but could be phone number,
   *  user ID, etc. for second-order rate limiting. */
  bucket: string;
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in seconds. Counter resets at the start of each
   *  window. */
  windowSeconds: number;
}

interface RateLimitResult {
  /** True if the request should be REJECTED (over the limit). */
  limited: boolean;
  /** Current count in this window (1 = first request). */
  count: number;
  /** Unix-ms timestamp when the current window resets + counter
   *  starts over. Useful for `Retry-After` HTTP header. */
  resetAt: number;
  /** Whether the limiter actually applied the check or failed open
   *  due to KV unavailability. Log this — sustained `false` means
   *  KV is down. */
  applied: boolean;
}

/**
 * Sanitize a bucket value for use in a Redis key. Strips characters
 * that could enable key-collision attacks (colons, whitespace) and
 * caps length so an attacker can't pad the key with junk to bypass.
 */
function sanitizeBucket(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64) || 'unknown';
}

export async function rateLimitCheck(opts: RateLimitOptions): Promise<RateLimitResult> {
  const { prefix, bucket, limit, windowSeconds } = opts;
  const cleanBucket = sanitizeBucket(bucket);

  const now = Date.now();
  const windowStart = Math.floor(now / (windowSeconds * 1000)) * (windowSeconds * 1000);
  const resetAt = windowStart + windowSeconds * 1000;
  const key = `rl:${prefix}:${cleanBucket}:${windowStart}`;

  try {
    // CRITICAL: INCR + EXPIRE in a SINGLE pipeline so they go in one
    // network round-trip. Two-call sequence had a race window: if
    // INCR succeeds but EXPIRE fails (network blip), the counter key
    // persists indefinitely with no TTL — eventually the count
    // crosses the limit and the bucket is PERMANENTLY locked out
    // because we only set EXPIRE on count==1.
    //
    // Using EXPIRE ... NX makes it safe to send EXPIRE on every
    // request: it only sets the TTL if the key has no current TTL.
    // Defends against the sliding-TTL attack (where every request
    // would push the expiry forward, never letting the window reset)
    // AND fixes the orphan-key bug above.
    //
    // EXPIRE NX requires Redis 7.0+. Upstash supports it.
    const results = await kvPipeline([
      ['INCR', key],
      ['EXPIRE', key, windowSeconds, 'NX'],
    ]);
    const count = results[0] as number | null;
    if (count == null) {
      // KV unavailable — fail open (see header docstring)
      return { limited: false, count: 0, resetAt, applied: false };
    }
    return {
      limited: count > limit,
      count,
      resetAt,
      applied: true,
    };
  } catch {
    // Redis hiccup — fail open
    return { limited: false, count: 0, resetAt, applied: false };
  }
}
