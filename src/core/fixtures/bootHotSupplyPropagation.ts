/**
 * bootHotSupplyPropagation — Phase 14.Y.4
 *
 * Subscribes to pipeStore + fixtureStore and re-runs
 * `applyHotSupplyClassification` whenever either changes. Any
 * pipe whose system needs to flip (cold → hot when reached,
 * hot → cold when disconnected) is updated via
 * `pipeStore.setSystem`.
 *
 * Debounced: fires at most once per ~100 ms, so a bulk operation
 * that mutates 50 pipes only triggers ONE propagation pass.
 *
 * Feedback-loop safe: `applyHotSupplyClassification` is
 * idempotent — if every pipe is already correctly classified, it
 * returns an empty change list, and we stop without firing
 * pipeStore.setSystem. The second tick (triggered by our own
 * updates) finds no changes and terminates.
 */

import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { applyHotSupplyClassification } from './hotSupplyPropagation';
import { logger } from '@core/logger/Logger';

const log = logger('HotSupplyPropagation');

// ── Debounce helper ──────────────────────────────────────────

function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): ((...args: A) => void) & { flush: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;
  const debounced = ((...args: A): void => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (lastArgs) fn(...lastArgs);
      lastArgs = null;
    }, waitMs);
  }) as ((...args: A) => void) & { flush: () => void; cancel: () => void };
  debounced.flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (lastArgs) fn(...lastArgs);
    lastArgs = null;
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  return debounced;
}

// ── Propagator ────────────────────────────────────────────────

let runningCount = 0; // prevents reentrancy during our own setSystem calls

function runPropagation(): void {
  if (runningCount > 0) return;
  runningCount++;
  try {
    const pipes = Object.values(usePipeStore.getState().pipes);
    const fixtures = Object.values(useFixtureStore.getState().fixtures);
    const changes = applyHotSupplyClassification(pipes, fixtures);
    if (changes.length === 0) return;
    const setSystem = usePipeStore.getState().setSystem;
    for (const c of changes) {
      setSystem(c.pipeId, c.newSystem);
    }
    log.info('hot-supply propagation applied', {
      count: changes.length,
      toHot: changes.filter((c) => c.newSystem === 'hot_supply').length,
      toCold: changes.filter((c) => c.newSystem === 'cold_supply').length,
    });
  } finally {
    runningCount--;
  }
}

const debouncedRun = debounce(runPropagation, 100);

// ── Boot ─────────────────────────────────────────────────────

let unsubscribers: Array<() => void> = [];
let booted = false;

export function bootHotSupplyPropagation(): void {
  if (booted) return;
  booted = true;

  // Initial pass: reclassify the scene as it stands right now.
  // This handles bundle load, recovery, and fresh launch with
  // DEMO_FIXTURES already seeded.
  debouncedRun();

  unsubscribers.push(
    usePipeStore.subscribe((state, prev) => {
      if (state.pipes !== prev.pipes) debouncedRun();
    }),
  );
  unsubscribers.push(
    useFixtureStore.subscribe((state, prev) => {
      if (state.fixtures !== prev.fixtures) debouncedRun();
    }),
  );

  log.info('hot-supply propagation booted');
}

/** Test helper — stop subscriptions + reset boot flag. */
export function __stopHotSupplyPropagation(): void {
  debouncedRun.cancel();
  for (const u of unsubscribers) u();
  unsubscribers = [];
  booted = false;
}

/** Test / debug helper — force a sync run regardless of debounce. */
export function __flushHotSupplyPropagation(): void {
  debouncedRun.flush();
}
