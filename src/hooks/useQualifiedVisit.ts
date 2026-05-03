import { useEffect } from 'react';
import { track } from '../lib/analytics';

/**
 * Fires a `sim_qualified_visit` analytics event after the user has
 * been ENGAGED (tab visible + page focused) for N consecutive seconds.
 *
 * "Qualified" = past the bounce threshold. A visitor who closed the
 * tab in 3 seconds didn't see anything; one who stayed 30+ seconds
 * with the page in focus actually engaged with the content. This
 * event is the primary signal for ad-spend ROI calculation:
 *
 *   ad_clicks → page_views → qualified_visits → form_submits
 *
 * Implementation: a setTimeout starts on mount, but pauses when the
 * tab is hidden + resumes when visible again. So a visitor who
 * switches tabs after 10s and comes back 5 minutes later still gets
 * counted at the 30s mark of cumulative-visible time.
 *
 * Idempotent — fires at most once per page load.
 *
 * @param surface 'mobile' | 'desktop' — passed to the event payload
 * @param thresholdMs default 30000 (30 seconds)
 */
export function useQualifiedVisit(
  surface: 'mobile' | 'desktop',
  thresholdMs = 30_000
): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let elapsed = 0;
    let lastTick = Date.now();
    let timer: number | null = null;
    let fired = false;

    const tick = () => {
      const now = Date.now();
      elapsed += now - lastTick;
      lastTick = now;
      if (elapsed >= thresholdMs && !fired) {
        fired = true;
        track('sim_qualified_visit', {
          surface,
          threshold_ms: thresholdMs,
          actual_ms: elapsed,
        });
        if (timer) window.clearInterval(timer);
        return;
      }
    };

    const start = () => {
      lastTick = Date.now();
      if (timer == null) timer = window.setInterval(tick, 1000);
    };

    const stop = () => {
      if (timer != null) {
        // Final tick to capture time-since-last-tick before pausing
        tick();
        window.clearInterval(timer);
        timer = null;
      }
    };

    const onVisChange = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) start();
      else stop();
    };

    // Start if visible + focused at mount
    if (document.visibilityState === 'visible' && document.hasFocus()) start();

    document.addEventListener('visibilitychange', onVisChange);
    window.addEventListener('focus', onVisChange);
    window.addEventListener('blur', onVisChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisChange);
      window.removeEventListener('focus', onVisChange);
      window.removeEventListener('blur', onVisChange);
    };
  }, [surface, thresholdMs]);
}
