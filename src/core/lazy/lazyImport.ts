/**
 * lazyImport — cached dynamic-import utility for heavy, one-shot
 * modules (exporters, serializers, analyzers).
 *
 * Why a wrapper over the raw `import()` expression?
 *
 *   1. CACHE. A button's hover pre-warm must share its Promise with
 *      the eventual click, or we'd fetch the chunk twice.
 *   2. ERROR PIPELINE. Failures route through the Phase 10.A logger
 *      so crashes land in the God Mode "Logs" tab.
 *   3. CHUNK NAMING. Vite honors `/* webpackChunkName: "x" *\/`
 *      (yes, despite the prefix) — docs `lazyName` here so the
 *      chunk file is inspectable, not `index-xHaSh.js`.
 *
 * Usage pattern:
 *
 *   // 1. Declare a loader (idempotent, cached):
 *   const loadSvgExporter = makeLazyLoader(
 *     'svg-exporter',
 *     () => import('../../engine/export/SVGExporter'),
 *   );
 *
 *   // 2. Pre-warm on hover:
 *   <button onMouseEnter={() => loadSvgExporter.prewarm()}
 *           onClick={async () => {
 *     const mod = await loadSvgExporter.get();
 *     mod.exportToSVG(...);
 *   }} />
 *
 * Invariants:
 *   • Calling `.prewarm()` multiple times resolves to the SAME Promise.
 *   • `.get()` returns the same Promise as `.prewarm()` if one is
 *     already in flight.
 *   • Errors are logged then re-thrown so callers can show UI state.
 *   • A failed load stays failed — subsequent `.get()` re-tries by
 *     invoking the factory again (user may have regained network).
 */

import { logger } from '@core/logger/Logger';

const log = logger('LazyImport');

// ── Types ──────────────────────────────────────────────────────

export interface LazyLoader<T> {
  /** Trigger the load without awaiting. Idempotent. */
  prewarm: () => void;
  /** Load (or await in-flight load) and return the module. */
  get: () => Promise<T>;
  /** Has the module finished loading successfully at least once? */
  isReady: () => boolean;
  /** Reset cache — next `.get()` refetches. Test-only. */
  reset: () => void;
}

// ── Factory ────────────────────────────────────────────────────

export function makeLazyLoader<T>(
  lazyName: string,
  factory: () => Promise<T>,
): LazyLoader<T> {
  let cached: Promise<T> | null = null;
  let ready = false;

  const load = (): Promise<T> => {
    if (cached) return cached;
    log.debug(`chunk load start: ${lazyName}`);
    const started = performance.now();
    cached = factory().then(
      (mod) => {
        ready = true;
        log.info(`chunk ready: ${lazyName}`, { ms: performance.now() - started });
        return mod;
      },
      (err) => {
        // Clear cache on failure so a retry can succeed if conditions change.
        cached = null;
        ready = false;
        log.error(`chunk load failed: ${lazyName}`, err);
        throw err;
      },
    );
    return cached;
  };

  return {
    prewarm: () => { void load(); },
    get: load,
    isReady: () => ready,
    reset: () => { cached = null; ready = false; },
  };
}

// ── Hover pre-warm timer helper ───────────────────────────────

/**
 * Attach to an element's `onMouseEnter`/`onMouseLeave` to trigger
 * a lazy loader's pre-warm after `delayMs` of sustained hover.
 * If the mouse leaves before the delay, the timer cancels — no load.
 *
 *   const hover = useHoverPrewarm(loader, 500);
 *   <button onMouseEnter={hover.onEnter} onMouseLeave={hover.onLeave}
 *           onClick={async () => (await loader.get()).run()} />
 *
 * Cheap: no React state, no re-renders. Uses a ref-like closure.
 */
export interface HoverPrewarm {
  onEnter: () => void;
  onLeave: () => void;
}

export function hoverPrewarm<T>(
  loader: LazyLoader<T>,
  delayMs: number = 500,
): HoverPrewarm {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    onEnter: () => {
      if (loader.isReady() || timer) return;
      timer = setTimeout(() => {
        timer = null;
        loader.prewarm();
      }, delayMs);
    },
    onLeave: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
