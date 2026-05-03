import { track } from './analytics';

/**
 * Scroll-depth observer — fires `scroll_depth` analytics events at
 * 25 / 50 / 75 / 100 % thresholds, ONCE each per session. Critical
 * ad-ROI signal: shows you which ad campaigns bring users who
 * actually read past the fold vs bounce immediately.
 *
 * Idempotent — safe to call from React.useEffect. Uses passive
 * scroll listeners + requestAnimationFrame for jank-free measurement.
 */
let scrollWatcherStarted = false;
export function startScrollDepthTracking(): void {
  if (scrollWatcherStarted || typeof window === 'undefined') return;
  scrollWatcherStarted = true;

  const milestones = [25, 50, 75, 100] as const;
  const fired = new Set<number>();
  let rafScheduled = false;

  const measure = () => {
    rafScheduled = false;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const viewport = window.innerHeight;
    const doc = document.documentElement.scrollHeight;
    const denom = doc - viewport;
    if (denom <= 0) return;
    const pct = Math.min(100, Math.round((scrollY / denom) * 100));
    for (const m of milestones) {
      if (pct >= m && !fired.has(m)) {
        fired.add(m);
        track('scroll_depth', { depth_pct: m });
      }
    }
    // Once we've fired all milestones, detach the listener to free
    // the scroll handler.
    if (fired.size === milestones.length) {
      window.removeEventListener('scroll', onScroll);
    }
  };

  const onScroll = () => {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(measure);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  // Fire once on mount in case page is already scrolled (refresh /
  // hash navigation)
  measure();
}

/**
 * CTA click tracker — wrap any link/button with `onClick={trackCta(...)}`
 * to log a `cta_click` event with consistent payload schema.
 *
 *   <a href="/#contact" onClick={trackCta('book_inspection', 'cta_strip')}>
 *
 * Composes with existing onClick handlers if you want both:
 *   onClick={(e) => { trackCta('book', 'hero')(e); customStuff(e); }}
 *
 * The event fires synchronously BEFORE navigation happens, which is
 * why it relies on sendBeacon (queues at the network layer, survives
 * unload) instead of fetch (cancelled on nav).
 */
export function trackCta(
  cta: string,
  placement: string,
  extra: Record<string, unknown> = {}
) {
  return (e?: { currentTarget?: HTMLElement | EventTarget | null }) => {
    let destination: string | undefined;
    const target = e?.currentTarget as HTMLAnchorElement | undefined;
    if (target?.href) destination = target.href;
    track('cta_click', { cta, placement, destination, ...extra });
  };
}
