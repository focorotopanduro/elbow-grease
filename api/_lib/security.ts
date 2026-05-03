import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Server-side security helpers — used by every API endpoint.
 *
 * Different from the client-side `src/lib/security.ts` which handles
 * mailto:/XSS/JSON-LD escaping. THIS file handles SERVER concerns:
 * timing-safe secret comparison, request IDs for log correlation,
 * payload hashing for dedup, prototype-pollution-safe JSON parsing,
 * and structured input validation.
 */

/**
 * Constant-time string comparison. The naive `a === b` comparison
 * short-circuits on the first mismatched character, which leaks
 * timing information that an attacker can use to recover the secret
 * one character at a time.
 *
 * Compares as UTF-8 bytes via `Buffer.from(s, 'utf8')` — gives the
 * actual byte length so multi-byte characters can't silently truncate
 * (the previous Buffer.alloc(maxLen) + write() approach would drop
 * trailing bytes if the UTF-8 encoding exceeded the allocated size).
 *
 * If lengths differ, do a dummy `timingSafeEqual` against itself
 * before returning false — this keeps the response time roughly
 * proportional to input length regardless of branch taken, so an
 * attacker can't distinguish "wrong length" from "wrong content".
 *
 * Use this for ANY secret comparison: CRON_SECRET, API key checks,
 * webhook signatures, etc.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    // Dummy compare to normalize timing — operating on aBuf vs aBuf
    // ensures equal-length operands so timingSafeEqual doesn't throw
    // (which itself would be a different timing signature).
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Generate a request ID for log correlation. Format:
 * `req-{timestamp36}-{random}` — readable in dashboards, sortable
 * by time, no PII.
 *
 * 64 bits of randomness via `randomBytes(8)` → 16 hex chars. Birthday-
 * paradox collision risk only at ~4 billion IDs (vs ~65k for the
 * previous 4-byte implementation). Future-proofs the codebase for
 * sustained traffic.
 */
export function generateRequestId(): string {
  const epoch = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(8).toString('hex').toUpperCase();
  return `req-${epoch}-${rand}`;
}

/**
 * Generate a fresh server-side confirmation ID with cryptographic
 * randomness. Used by /api/leads as the fallback when the client-
 * supplied confirmationId fails strict format validation, OR when
 * no confirmationId is provided at all.
 *
 * Format: `BBC-{epoch36}-{12hex}` — 48 bits of randomness in the
 * suffix, collision-free even at sustained Cat-5 traffic peaks.
 * The previous fallback used Date.now() alone, which would collide
 * for any two requests landing in the same millisecond.
 */
export function generateConfirmationId(): string {
  const epoch = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(6).toString('hex').toUpperCase();
  return `BBC-${epoch}-${rand}`;
}

/**
 * Strict format check for client-supplied confirmation IDs. If the
 * client posts a confirmationId in the lead payload, we accept it
 * ONLY when it matches this regex — otherwise we generate a fresh
 * server-side ID via generateConfirmationId.
 *
 * Why strict: the confirmation ID becomes part of the KV key
 * (`lead:<id>`). An attacker submitting `confirmationId: "../etc/X"`
 * could otherwise abuse the key namespace (overwrite legitimate
 * leads, conflict with other key prefixes, pollute the time-index).
 * Restricting to `BBC-{alphanumeric+hyphens}` of bounded length
 * eliminates that vector.
 */
const CONFIRMATION_ID_REGEX = /^BBC-[A-Z0-9-]{4,40}$/;
export function isValidConfirmationId(id: unknown): id is string {
  return typeof id === 'string' && CONFIRMATION_ID_REGEX.test(id);
}

/**
 * Hash a string with SHA-256 → hex. Used for:
 *   - Duplicate-submission detection (hash a normalized payload,
 *     reject if same hash seen in last N seconds)
 *   - Audit logging (hash PII so the log line proves a submission
 *     occurred without exposing the data itself)
 *
 * Note: SHA-256 is NOT salted — these hashes are NOT for password
 * storage. They're identifiers / fingerprints only.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Parse a JSON body with prototype-pollution defense.
 *
 * Standard `JSON.parse` returns objects whose prototype chain leads
 * to Object.prototype. An attacker can submit:
 *   {"__proto__": {"isAdmin": true}}
 * which (in vulnerable code that mass-assigns) pollutes the global
 * Object.prototype, affecting every other object in the process.
 *
 * The defense: use a reviver that strips `__proto__`, `constructor`,
 * and `prototype` keys at every level. The result is a clean object
 * with only the data the caller actually intended.
 *
 * Returns null on parse failure (caller decides how to respond).
 * Caller should ALWAYS narrow the result via type checks before use.
 */
export function safeJsonParse(text: string): unknown {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text, (key, value) => {
      // Strip prototype-pollution vectors at every level
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      return value;
    });
  } catch {
    return null;
  }
}

/**
 * Get the client IP from a Vercel request, with anti-spoof checks.
 *
 * Vercel sets `x-forwarded-for` after stripping any client-supplied
 * value, so the FIRST entry in that header is trustworthy. But a
 * locally-running dev server might pass it through unverified, so we
 * also validate the format.
 */
export function getClientIp(headers: Record<string, string | string[] | undefined>): string {
  const xff = headers['x-forwarded-for'];
  let candidate: string | undefined;
  if (typeof xff === 'string') candidate = xff.split(',')[0]?.trim();
  else if (Array.isArray(xff)) candidate = xff[0];
  if (!candidate) return 'unknown';
  // Basic IPv4/IPv6 sanity — anything else gets logged as 'unknown'
  // so an attacker can't inject log poison via the IP field.
  if (!/^[a-fA-F0-9.:]{1,45}$/.test(candidate)) return 'unknown';
  return candidate;
}

const TRUSTED_SITE_ORIGINS = new Set([
  'https://beitbuilding.com',
  'https://www.beitbuilding.com',
]);

/**
 * Strict Origin allowlist for browser-postable API endpoints.
 *
 * Important: do not allow `*.vercel.app` broadly. Attackers can create
 * their own Vercel project and post from that origin. Preview deployments
 * are allowed only when their exact URL is provided by Vercel's runtime
 * env (`VERCEL_URL` / `VERCEL_BRANCH_URL`) or an operator adds an exact
 * origin to `ADDITIONAL_ALLOWED_ORIGINS`.
 */
export function isAllowedSiteOrigin(origin: unknown): origin is string {
  if (typeof origin !== 'string' || origin.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (parsed.origin !== origin) return false;
  if (TRUSTED_SITE_ORIGINS.has(parsed.origin)) return true;

  return configuredApiOrigins().has(parsed.origin);
}

function configuredApiOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const envName of ['VERCEL_URL', 'VERCEL_BRANCH_URL']) {
    const normalized = normalizeOrigin(process.env[envName]);
    if (normalized) origins.add(normalized);
  }
  const extra = process.env.ADDITIONAL_ALLOWED_ORIGINS ?? '';
  for (const raw of extra.split(',')) {
    const normalized = normalizeOrigin(raw.trim());
    if (normalized) origins.add(normalized);
  }
  return origins;
}

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
