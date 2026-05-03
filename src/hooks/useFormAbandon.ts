import { useEffect, useRef } from 'react';
import { track } from '../lib/analytics';

/**
 * Fires `sim_form_submit_error` with reason `abandoned` if the page
 * unloads while the user has typed something but has NOT submitted.
 *
 * Critical for funnel analysis — shows you which fields cause drop-
 * off and which sessions get to "almost converted" but never finish.
 *
 * Implementation notes:
 *   - Uses `pagehide` (more reliable than `beforeunload` on mobile
 *     Safari + during bfcache transitions).
 *   - Uses `sendBeacon` via the analytics layer so the event delivers
 *     during unload (regular fetch is cancelled).
 *   - Checks `submittedRef` — set by the consumer when a submit
 *     succeeds. We don't want to log an abandon for users who DID
 *     complete the funnel.
 *
 * @param hasContent — true when at least one field has a value
 * @param submittedRef — ref<boolean> the consumer flips to `true` on
 *                      successful submit so we skip the abandon event
 */
export function useFormAbandon(
  hasContent: boolean,
  submittedRef: React.MutableRefObject<boolean>
): void {
  const hasContentRef = useRef(hasContent);
  hasContentRef.current = hasContent;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handler = () => {
      if (submittedRef.current) return;
      if (!hasContentRef.current) return;
      track('sim_form_submit_error', {
        surface: 'mobile',
        reason: 'abandoned',
      });
    };

    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  }, [submittedRef]);
}
