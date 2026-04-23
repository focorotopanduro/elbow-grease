# ADR 068 — Worker Graph Rehydration (Phase 14.AC.8)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AC.8
- **Depends on:** ADR 066 (fixture graph scaffold), ADR 067
  (proximity connection).

## Context

14.AC.6 + 14.AC.7 wired fixture events through the bridge so live
placements flow into the worker DAG. Two gaps remained:

1. **Bundle open bypasses the event bus.** `Bundle.applyBundle`
   writes to pipeStore + fixtureStore directly via `setState`.
   Neither `PIPE_COMPLETE` nor `FIXTURE_PLACED` fires. The
   worker's DAG stays empty regardless of flag state after
   opening a `.elbow` project.

2. **Mid-session flag flip strands existing fixtures.** A user
   with the `fixtureGraph` flag off places 10 fixtures, then
   toggles the flag on in God Mode. The bridge's fixture
   handlers *now* honor new events — but the 10 existing
   fixtures were never queued. The graph represents only the
   fixtures placed after the flip.

Both failure modes leave the solver with a half-populated DAG
that can't produce correct DFU / WSFU propagation.

## Decision

One bridge-level method, one utility, one call site in Bundle,
one subscription in the bridge constructor.

### 1. `SimulationBridge.rehydrateFromStores(fixtures, pipes)`

Public method on the bridge. Takes plain record snapshots — no
store import coupling. Flag-gated: no-op when `fixtureGraph` is
off, matching the pre-14.AC.6 contract for legacy users.

Order of operations matters:

1. **Queue fixtures first** — fills `fixturePositionIndex`.
2. **Queue pipes next** — proximity lookup (from 14.AC.7) now
   sees the rehydrated fixtures and splices endpoint overrides
   on the first pass. Fixture-connected scenes arrive in the
   worker with their connections intact.
3. `queueSolve()` — one batched flush at the 50 ms debounce
   tick, producing ONE `BATCH_MUTATE` for the entire scene
   regardless of pipe + fixture count.

Also records the exact node/edge IDs per pipe in `pipeIdIndex`,
so a post-rehydration `pipe:removed` does surgical removal —
same invariant as the live PIPE_COMPLETE handler.

### 2. `rehydrateWorkerGraph()` utility

`src/engine/worker/rehydrateWorkerGraph.ts`. Reads `pipeStore`
+ `fixtureStore` and calls the bridge method. Thin glue — the
indirection exists so callers that already have store imports
(bundle, sample scene seeders) get a one-liner.

### 3. `Bundle.applyBundle` invokes rehydration

Dynamic import at the end of `applyBundle`:

```ts
void import('../../engine/worker/rehydrateWorkerGraph').then(
  (m) => m.rehydrateWorkerGraph(),
).catch((err) => {
  log.warn('worker rehydration skipped', err);
});
```

Dynamic to keep the Bundle module test-friendly — existing
Bundle tests that don't exercise the bridge stay green because
the import only resolves when applyBundle actually runs in a
bridge-present environment. The catch swallows any "bridge not
initialized" errors that could surface during SSR / tests so
bundle open never hard-fails on a peripheral subsystem.

### 4. Flag-flip subscription

Bridge constructor subscribes to `useFeatureFlagStore`:

```ts
useFeatureFlagStore.subscribe((state, prev) => {
  if (!prev.fixtureGraph && state.fixtureGraph) {
    void this.rehydrateFromCurrentStores();
  }
});
```

Fires ONLY on the false → true transition. `rehydrateFromCurrentStores`
dynamically imports the stores and calls `rehydrateFromStores` —
this indirection keeps the bridge decoupled from Zustand's module
graph at construction time.

`destroy()` unsubscribes so the singleton can be replaced in
tests without stale subscribers firing on test teardown.

## Edge cases covered by tests

| Scenario | Behaviour |
|---|---|
| Flag off, rehydrate called | no-op, zero batches |
| Flag on, 1 fixture + 1 pipe ending at fixture | 1 batch, edge spliced to fx-id |
| Flag on, empty stores | no-op |
| Flag on, 10 fixtures + 10 pipes each attached | 1 batch with all of them |
| Flag on, pipe without nearby fixture | all-waypoint shape preserved |
| Flag false → true mid-session | existing store state replayed |
| Flag set to same value (true → true) | no spurious rehydration |
| Flag true → false → true | second flip triggers another rehydration |
| `bridge.destroy()` then flag flip | no stale subscriber fires |

## Trade-offs

- **One flush per rehydration.** A 500-pipe scene on bundle open
  produces one `BATCH_MUTATE` with ~2000 nodes/edges. Structured
  clone at that size is ~15 ms — measurable but well under any
  interactive budget. Not worth SAB-fying this path alone.
- **Dynamic imports in hot-ish code.** The Bundle.applyBundle
  hook uses `import()` to preserve test isolation. The promise
  resolves almost instantly in browsers (module is already in
  the bundle graph), but it IS async — rehydration lags the
  bundle apply by one microtask turn. Acceptable because solve
  is 50 ms debounced anyway.
- **`fixtureStore.setPosition` still doesn't emit an event.**
  Pre-existing gap from ADR 066. A fixture moved AFTER rehydration
  doesn't update its graph node position. Out of scope here;
  14.AC.11 or later should add `FIXTURE_MOVED`.
- **No fixture-connection updates on rehydration for pipes that
  don't end AT a fixture.** If a user connects a pipe within
  tolerance but not exactly, rehydration plays the same
  proximity check the live path does. Consistent: rehydrated
  scenes look exactly like scenes built fresh under the flag.
- **Sample-scene seed at boot does NOT auto-rehydrate.** `App.tsx`'s
  `seedFromList()` is pre-bridge, fires on store creation
  before the bridge exists. If a user flips `fixtureGraph` on,
  the seeded demo fixtures catch up via the flag-flip path.
  Explicit call to `rehydrateWorkerGraph()` could be added to
  the boot path if the demo scene ships with the flag on by
  default — but we're not doing that yet.

## Verification

- `npx vitest run` — 1512 tests pass (1503 prior + 9 new:
  5 `rehydrateFromStores` direct-call + 4 flag-flip subscription).
- `npx tsc -b --noEmit` — clean.
- Manual path I did NOT run: end-to-end bundle open → worker
  graph assertion. That needs a full worker environment;
  14.AC.9 will set it up when flipping the flag default on.

## Files

- `src/engine/worker/SimulationBridge.ts` — `rehydrateFromStores`
  method (public), `wireFlagFlip` + `rehydrateFromCurrentStores`
  (private), `flagUnsubscribe` field, `destroy` cleanup.
- `src/engine/worker/rehydrateWorkerGraph.ts` — utility function
  new file.
- `src/core/bundle/Bundle.ts` — `applyBundle` calls the utility
  via dynamic import at tail.
- `src/engine/worker/__tests__/rehydrateWorkerGraph.spec.ts` —
  9 tests.
- `docs/adr/068-worker-graph-rehydration.md` — this document.

## What's queued

- **14.AC.9** — flip `fixtureGraph` default to `true`. Should
  ship with a golden `.elbow` scene documenting before/after
  BOM + compliance numbers. Verifies end-to-end that rehydration
  produces identical solver output to a freshly-drawn
  equivalent.
- **14.AC.10** — BOM pricing includes fixture line items (reads
  `type: 'fixture'` nodes from the DAG and rolls them into the
  materials export).
- **14.AC.11** — `fixtureStore.setPosition` emits
  `FIXTURE_MOVED`; bridge handles it as remove + re-add in one
  batch.
