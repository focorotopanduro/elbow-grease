import { track } from './analytics';

/**
 * Web Vitals reporter — pipes Core Web Vitals to analytics using only
 * the native `PerformanceObserver`. No `web-vitals` npm dep (~6 kB
 * gzipped saved). The metric set is the subset Google uses for
 * Core Web Vitals + page-experience search ranking:
 *
 *   - LCP (Largest Contentful Paint)        ≤ 2.5s "good"
 *   - CLS (Cumulative Layout Shift)         ≤ 0.10 "good"
 *   - INP (Interaction to Next Paint)       ≤ 200ms "good"
 *   - FCP (First Contentful Paint)          ≤ 1.8s "good"
 *   - TTFB (Time to First Byte)             ≤ 800ms "good"
 *
 * Usage: call `reportWebVitals()` once on page mount. Each metric
 * reports ONCE when its observation window closes (page hidden /
 * unload), not on every change — so you don't get 60 LCP events per
 * second.
 *
 * Each fires a `web_vital` event with shape:
 *   { metric, value, rating: 'good'|'needs-improvement'|'poor' }
 */

type Rating = 'good' | 'needs-improvement' | 'poor';

const THRESHOLDS: Record<string, [number, number]> = {
  // [good_max, poor_min]
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

function rate(metric: string, value: number): Rating {
  const t = THRESHOLDS[metric];
  if (!t) return 'good';
  if (value <= t[0]) return 'good';
  if (value <= t[1]) return 'needs-improvement';
  return 'poor';
}

function emit(metric: string, value: number) {
  track('web_vital', {
    metric,
    value: Math.round(value * 1000) / 1000,
    rating: rate(metric, value),
  });
}

/**
 * Start observing Core Web Vitals. Idempotent — safe to call from
 * a useEffect (it short-circuits if already observing).
 */
let started = false;
export function reportWebVitals(): void {
  if (started || typeof window === 'undefined' || !('PerformanceObserver' in window)) return;
  started = true;

  // ── LCP — fires the LARGEST observation when the page is hidden ──
  let lcpValue = 0;
  try {
    const lcpObs = new PerformanceObserver((entries) => {
      const list = entries.getEntries();
      const last = list[list.length - 1] as (PerformanceEntry & { startTime: number }) | undefined;
      if (last) lcpValue = last.startTime;
    });
    lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
    onPageHidden(() => {
      if (lcpValue > 0) emit('LCP', lcpValue);
      lcpObs.disconnect();
    });
  } catch { /* unsupported browser */ }

  // ── CLS — sum of layout-shift entries (excluding user-initiated) ──
  let clsValue = 0;
  try {
    const clsObs = new PerformanceObserver((entries) => {
      for (const e of entries.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number }>) {
        if (!e.hadRecentInput && typeof e.value === 'number') {
          clsValue += e.value;
        }
      }
    });
    clsObs.observe({ type: 'layout-shift', buffered: true });
    onPageHidden(() => {
      emit('CLS', clsValue);
      clsObs.disconnect();
    });
  } catch { /* unsupported */ }

  // ── INP — slowest interaction-to-next-paint ──
  let worstINP = 0;
  try {
    const inpObs = new PerformanceObserver((entries) => {
      for (const e of entries.getEntries() as Array<PerformanceEntry & { duration: number; interactionId?: number }>) {
        if (e.interactionId && e.duration > worstINP) worstINP = e.duration;
      }
    });
    // 'event' type was added later — wrap in try
    inpObs.observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit & { durationThreshold: number });
    onPageHidden(() => {
      if (worstINP > 0) emit('INP', worstINP);
      inpObs.disconnect();
    });
  } catch { /* unsupported */ }

  // ── FCP — fires once at first contentful paint ──
  try {
    const fcpObs = new PerformanceObserver((entries) => {
      for (const e of entries.getEntries()) {
        if (e.name === 'first-contentful-paint') {
          emit('FCP', e.startTime);
          fcpObs.disconnect();
          return;
        }
      }
    });
    fcpObs.observe({ type: 'paint', buffered: true });
  } catch { /* unsupported */ }

  // ── TTFB — from Navigation Timing API ──
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav && typeof nav.responseStart === 'number' && typeof nav.requestStart === 'number') {
      emit('TTFB', nav.responseStart - nav.requestStart);
    }
  } catch { /* unsupported */ }
}

/** Run a callback when the page is being hidden (the canonical
 *  "report final values" moment for LCP + CLS + INP). */
function onPageHidden(cb: () => void): void {
  const handler = () => {
    if (document.visibilityState === 'hidden') {
      cb();
      document.removeEventListener('visibilitychange', handler);
    }
  };
  document.addEventListener('visibilitychange', handler);
  // Also fire on pagehide (mobile Safari may skip visibilitychange)
  window.addEventListener('pagehide', () => cb(), { once: true });
}
