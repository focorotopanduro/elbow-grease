import { track } from './analytics';

/**
 * Global error capture — installs window-level handlers for two
 * categories of uncaught failures that React's ErrorBoundary CANNOT
 * catch:
 *
 *   1. **Unhandled promise rejections** — `await fetch(...)` without
 *      a try/catch, awaited mutations that throw outside React's
 *      render path, etc. These would otherwise log a `Uncaught (in
 *      promise)` to the console + vanish.
 *
 *   2. **Window-level synchronous errors** — typically third-party
 *      scripts (analytics, embed widgets, browser extensions) that
 *      throw outside the React tree. Without this handler they show
 *      in DevTools but never reach your dashboards.
 *
 * Both fire `page_error` analytics events with a `source` field so
 * you can split them in your dashboard. The handlers are idempotent
 * (safe to call from any useEffect; subsequent calls are no-ops).
 *
 * NOT a replacement for proper try/catch in your app code — this is
 * the safety net for everything OUTSIDE your control.
 */

let installed = false;

export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // Unhandled promise rejection
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
        ? reason
        : 'Unhandled promise rejection';
    track('page_error', {
      source: 'unhandledrejection',
      reason: message.slice(0, 500),
    });
  });

  // Synchronous window error
  window.addEventListener('error', (event) => {
    // Filter out errors in cross-origin scripts where we have no
    // useful info — the browser hides the message + stack as a
    // security measure ("Script error.")
    if (event.message === 'Script error.' && !event.filename) return;

    track('page_error', {
      source: 'window_error',
      reason: event.message?.slice(0, 500) ?? 'Unknown error',
      filename: event.filename?.slice(0, 200),
      line: event.lineno,
      col: event.colno,
    });
  });
}
