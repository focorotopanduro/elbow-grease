/**
 * rehydrateWorkerGraph — Phase 14.AC.8
 *
 * Bridge between "stores just got a wholesale update" events (bundle
 * open, demo scene seed, import) and the SimulationBridge's batched
 * graph-mutation queue. Without this, the worker's DAG stays empty
 * after a `.elbow` bundle opens because `Bundle.applyBundle` writes
 * directly to Zustand stores via `setState` and never emits
 * `PIPE_COMPLETE` / `FIXTURE_PLACED`.
 *
 * Flag-gated via `fixtureGraph` — when off, this is a noop, matching
 * the pre-14.AC.6 behaviour for legacy users.
 *
 * This helper is the single place callers touch: bundle load,
 * explicit "reload scene" buttons, sample-scene seeders. Each
 * invocation fires one batched flush; the 50ms debounce coalesces
 * rehydration + subsequent edits into a single `BATCH_MUTATE`.
 */

import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { getSimulationBridge } from './SimulationBridge';

/**
 * Replay the current `pipeStore` + `fixtureStore` state into the
 * worker graph. Call after `applyBundle()`, after `seedFromList`
 * (if the seeded scene is post-boot), or anywhere else that
 * bypasses the event bus to write store state directly.
 */
export function rehydrateWorkerGraph(): void {
  const bridge = getSimulationBridge();
  bridge.rehydrateFromStores(
    useFixtureStore.getState().fixtures,
    usePipeStore.getState().pipes,
  );
}
