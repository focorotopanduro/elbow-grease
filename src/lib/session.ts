/**
 * Session identification — per-tab attribution only.
 *
 * PRIVACY POSTURE (post April-2026 moral pivot):
 * We REMOVED the persistent visitor_id concept. Cross-session tracking
 * isn't necessary to operate the service — Beit Building Contractors
 * doesn't need to know "this is the same person who visited last
 * Tuesday" to call them back when they fill the form.
 *
 * What remains: SESSION_ID — per-tab via sessionStorage, dies when
 * the tab closes. Lets us reconstruct a single visit's funnel for
 * debugging without ever building a per-person profile.
 *
 * Falls back silently to in-memory IDs when storage is unavailable
 * (private browsing, quota full, SSR).
 *
 * Format: short URL-safe random IDs (`s1-LZ4G7K-A8X2K9`) — readable
 * in dashboards, no PII, deterministic shape.
 */

const SESSION_KEY = 'beit:sid:v1';
const SESSION_LAST_SEEN_KEY = 'beit:sid:lastseen:v1';
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

/** Generate a compact ~10-char ID. */
function generateId(): string {
  const epoch = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `s1-${epoch}-${rand}`;
}

let memorySessionId: string | null = null;

/**
 * Get or create the per-tab session ID. Resets if the user has
 * been idle for 30+ minutes since their last tracked event.
 */
export function getSessionId(): string {
  if (typeof window === 'undefined') return memorySessionId ??= generateId();
  try {
    const lastSeenRaw = window.sessionStorage.getItem(SESSION_LAST_SEEN_KEY);
    const existingId = window.sessionStorage.getItem(SESSION_KEY);
    const now = Date.now();

    if (
      existingId &&
      lastSeenRaw &&
      now - Number(lastSeenRaw) < SESSION_IDLE_TIMEOUT_MS
    ) {
      // Bump last-seen so the timeout window slides forward
      window.sessionStorage.setItem(SESSION_LAST_SEEN_KEY, String(now));
      return existingId;
    }

    // Stale or missing — start a fresh session
    const fresh = generateId();
    window.sessionStorage.setItem(SESSION_KEY, fresh);
    window.sessionStorage.setItem(SESSION_LAST_SEEN_KEY, String(now));
    return fresh;
  } catch {
    return memorySessionId ??= generateId();
  }
}
