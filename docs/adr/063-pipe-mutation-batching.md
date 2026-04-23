# ADR 063 — Pipe Graph Mutation Batching (Phase 14.AC.3)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AC.3
- **Depends on:** ADR 061 (pipe game-loop coalescing), ADR 062
  (segment-extract cache), Phase 3 SAB transport.

## Context

`SimulationBridge.queueSolve()` already coalesces `SOLVE_REQUEST`
calls into a single firing per 50 ms debounce window — that part
has been fine since Phase 10.D. What was NOT coalesced is the
per-segment graph mutation chatter:

For every committed pipe the bridge fired:

- 1 × `ADD_NODE` postMessage per waypoint
- 1 × `ADD_EDGE` postMessage per segment

Each postMessage pays:

1. structured-clone serialization of the payload,
2. a main-thread → worker boundary crossing,
3. a worker-side handler that posts a `GRAPH_UPDATED` response
   — one per mutation.

For a 4-pipe riser drop (3 points each), that was **40 thread
crossings** before the eventual `SOLVE_REQUEST`. For a
paste-20-pipes operation (4 points each), **160 crossings**.

The same batch reality surfaced on the removal side, where the old
`removePipeFromGraph` enumerated `wp-{id}-{0..50}` / `edge-{id}-
{0..50}` as individual `REMOVE_*` postMessages — 101 crossings
per undo no matter how short the pipe actually was.

## Decision

Queue graph mutations inside the bridge and flush exactly one
`BATCH_MUTATE` message per debounce window, immediately before the
`SOLVE_REQUEST`.

### 1. Pure module `src/engine/worker/mutationBatching.ts`

```ts
pipeToMutations(pipe) → { nodes, edges }
pipeGraphIds(pipeId, pointCount) → { nodeIds, edgeIds }
composeMutationBatch(addedPipes, removedNodeIds, removedEdgeIds)
  → GraphMutationBatch
isEmptyBatch(batch) → boolean
nodeIdAt(pipeId, i) / edgeIdAt(pipeId, i)  // stable id format
```

`composeMutationBatch` also implements **add+remove cancellation**:
if a pipe is added AND removed within the same window (ephemeral
route: user commits then immediately undoes), neither its adds nor
its removal IDs survive. No worker trip for the no-op.

Pure functions — zero imports from React, Zustand, or the event
bus. Tests exercise every branch without the bridge.

### 2. Message addition `SIM_MSG.BATCH_MUTATE`

One constant added to `src/engine/graph/MessageBus.ts`. Payload
shape matches `GraphMutationBatch`. Phase 3's SAB path remains
untouched — that's for full-graph transfer, not per-mutation deltas.

### 3. Bridge: queue + flush

```ts
class SimulationBridge {
  private pendingPipeCommits: PipeCommit[] = [];
  private pendingRemovedNodeIds: string[] = [];
  private pendingRemovedEdgeIds: string[] = [];
  private pipeIdIndex = new Map<string, { nodeIds: string[]; edgeIds: string[] }>();

  // on PIPE_COMPLETE → push to pendingPipeCommits + index, queueSolve()
  // on pipe:removed → exact-id lookup via pipeIdIndex, queueSolve()
  // queueSolve's debounce fire → flushPendingMutations() → postToWorker(BATCH_MUTATE)
  //                              → postToWorker(SOLVE_REQUEST)
}
```

`pipeIdIndex` replaces the old 0..50 enumeration with exact IDs
from the commit — a pipe with 3 points emits 3 node removals + 2
edge removals, not 51 + 50. Unknown pipes (cross-session undo,
malformed history) fall back to a conservative 0..64 range.

### 4. Worker handler

One new case in `simulation.worker.ts`:

```ts
case SIM_MSG.BATCH_MUTATE: {
  const b = msg.payload as BatchMutatePayload;
  for (const id of b.edgeIdsToRemove) dag.removeEdge(id);
  for (const id of b.nodeIdsToRemove) dag.removeNode(id);
  for (const node of b.nodesToAdd)    dag.addNode(node);
  for (const edge of b.edgesToAdd)    dag.addEdge(edge);
  postResult(SIM_MSG.GRAPH_UPDATED, { nodeCount, edgeCount });
  break;
}
```

Order is deliberate: remove edges first (so we don't leave orphan
edges referencing nodes about to die), then remove nodes, then add
nodes (parents must exist before children), then add edges. One
`GRAPH_UPDATED` at the end replaces the N responses the per-mutation
path used to emit.

### Instrumentation

`bridge.lastBatchSent: GraphMutationBatch | null` exposes the most
recent flush for test assertions + a future dev-build perf overlay.

### Before / after

| Scenario | Prior crossings | Now |
|---|---:|---:|
| 1-pipe, 3-point commit | 10 (3 add-node + 2 add-edge + 5 responses) | 2 (1 BATCH + 1 response) |
| 4-pipe riser drop | 40 | 2 |
| 20-pipe paste | 160 | 2 |
| Single pipe undo (known) | 202 | 2 |
| Single pipe undo (unknown) | 202 | 2 |
| Commit + immediate undo | 12 | 0 BATCH (empty cancel) + 1 SOLVE |

## Trade-offs

- **Debounce window remains 50 ms.** A burst that straddles a flush
  (commit at t=0, commit at t=55ms) will produce two batches. That's
  identical to prior solve behaviour — we didn't regress anything.
- **`ADD_NODE` / `ADD_EDGE` / `REMOVE_NODE` / `REMOVE_EDGE`
  messages still exist.** Phase 3 SET_GRAPH_SAB path and any future
  direct-mutation tooling can still use them. The bridge just
  doesn't emit them from the commit path.
- **`BATCH_MUTATE` payload size scales with pipes.** 20 pipes × 4
  points × ~200 bytes per node ≈ 16 KB — well within structured
  clone overhead norms. If this grows problematic we can route
  through the SAB transport, but current measurements show no
  signal there.
- **`pipeIdIndex` grows with unique pipe commits.** Entries evict
  on `pipe:removed`. A bridge instance that never receives removes
  would leak — in practice the singleton bridge processes every
  commit and removal over a session, so leakage is bounded by
  unique active pipe count.
- **No change to solve debouncing.** We still send one
  `SOLVE_REQUEST` per window. The saving is in the pre-solve
  chatter.

## Verification

- `npx vitest run` — 1443 tests pass (1410 prior + 33 new: 25
  mutationBatching + 8 SimulationBridge batching).
- `npx tsc -b --noEmit` — clean.
- The bridge test asserts the regression guard: during a 10-pipe
  burst **zero** `ADD_NODE` / `ADD_EDGE` messages fire. If anyone
  refactors the commit path back to per-mutation postMessage, that
  assertion fails immediately.

## Files

- `src/engine/worker/mutationBatching.ts` — 183 LOC new (pure).
- `src/engine/graph/MessageBus.ts` — `BATCH_MUTATE` constant added.
- `src/engine/worker/SimulationBridge.ts` — queued-flush rewrite:
  `pendingPipeCommits` + `pendingRemovedNodeIds` +
  `pendingRemovedEdgeIds` + `pipeIdIndex`, `queueSolve()` flushes
  then solves, `PIPE_COMPLETE` / `pipe:removed` handlers now push
  to queues instead of posting per-segment.
- `src/engine/worker/simulation.worker.ts` — new `BATCH_MUTATE`
  case.
- `src/engine/worker/__tests__/mutationBatching.spec.ts` — 25
  tests.
- `src/engine/worker/__tests__/simulationBridge.batch.spec.ts` —
  8 integration tests (main-thread fallback).
- `docs/adr/063-pipe-mutation-batching.md` — this document.

## What's queued

- **14.AC.4** — dev-build perf overlay surfacing
  `bridge.lastBatchSent`, `SegmentExtractCache.lastHits /
  lastMisses / lastEvictions`, rAF coalescer queue depth.
- **14.AC.5** — similar batching pass for fixture mutations
  (`FIXTURE_PLACED` / `FIXTURE_REMOVED` currently still per-event).
