# ADR 066 — Fixture → Worker Graph Wiring Scaffold (Phase 14.AC.6)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AC.6
- **Depends on:** ADR 063 (graph mutation batching), ADR 064
  (PerfHUD telemetry).

## Context

A survey during 14.AC.5 revealed a long-standing correctness gap:

**Fixtures never reach the simulation worker.** `SimulationBridge.
wireEventBus()` subscribes to `PIPE_COMPLETE` + `pipe:removed`
but has zero handlers for `FIXTURE_PLACED` / `FIXTURE_REMOVED` /
`FIXTURE_PARAMS_CHANGED`. The solver sees a DAG of junction nodes
with `dfu: 0` everywhere; DFU / WSFU propagation produces zeros
at every pipe endpoint; compliance silently passes undersized
stacks because there's no fixture load to violate limits; BOM
pricing omits fixtures entirely.

`setGraph(nodes, edges)` exists on the bridge with a packed-SAB
variant that DOES support fixture nodes — but **nothing in the
app calls it**. `FixtureInstance.connectedPipeIds` exists as dead
code (methods `attachPipe` / `detachPipe` are never invoked).

This isn't a perf issue; it's correctness. The shipped app has
been producing compliance + BOM output that doesn't reflect
fixture load.

Fixing this properly is a multi-phase effort:

- **14.AC.6 (this phase)** — plumb fixture events to the worker
  as isolated graph nodes. Flag-gated; off by default. No
  behaviour change for existing users.
- **14.AC.7 (queued)** — connect fixture nodes to pipe waypoints
  so DFU actually propagates downstream.
- **14.AC.8 (queued)** — project-load graph rehydration so
  existing scenes get their fixtures into the graph on open.
- **14.AC.9 (queued)** — verify end-to-end: BOM / compliance
  output changes as expected on a known-good fixture scene,
  then flip the flag default to on.

This ADR covers 14.AC.6 only.

## Decision

Ship the scaffold. Flag-gated. No behaviour change by default.

### 1. `fixtureGraph` feature flag

`src/store/featureFlagStore.ts`:

```ts
fixtureGraph: boolean;  // default false
```

When OFF: the bridge handlers exist and fire but early-return.
When ON: fixture events queue graph mutations for the next
`BATCH_MUTATE` flush.

### 2. `mutationBatching.ts` extensions

```ts
interface FixtureCommit {
  id: string;
  subtype: FixtureSubtype;
  position: Vec3;
  system: SystemType;
}

fixtureNodeId(id) → `fx-${id}`                         // ID convention
fixtureToNode(commit) → GraphNode                      // pure builder
defaultSystemForFixture(subtype) → SystemType          // heuristic

composeMutationBatch(pipes, removedNodes, removedEdges, fixtures?=[])
```

Signature change is **backwards compatible**: `fixtures` is the
fourth positional parameter with a default of `[]`, so every
existing 3-arg call still works. Add+remove cancellation extends
symmetrically — a fixture added and removed in the same batch
nets to nothing, same invariant as the pipe path.

`fixtureToNode` populates DFU + supply from the same
`DFU_TABLE` / `SUPPLY_TABLE` that the existing `createFixtureNode`
factory reads, so a fixture built via this path accumulates
identically. Deliberate: we don't want the solver to see
different DFU values depending on which code path built the node.

### 3. Bridge handlers

All three handlers are always subscribed (one `getFlag()` read
per event is cheaper than resubscribe juggling on flag toggles):

| Event | Flag ON behaviour |
|---|---|
| `FIXTURE_PLACED` | push to `pendingFixtureCommits` + record position, `queueSolve()` |
| `FIXTURE_REMOVED` | push `fx-{id}` to `pendingRemovedNodeIds` + drop position, `queueSolve()` |
| `FIXTURE_PARAMS_CHANGED` | remove + re-add in same batch (cancellation handles the common case where nothing graph-relevant changed) |

`setPosition` on the fixture store does NOT emit an event today —
a separate latent gap, out of scope here. Fixture moves don't
reach the solver graph. That matches the pre-14.AC.6 reality
(nothing reached the graph), so no regression.

### 4. What isolated fixture nodes mean for the solver

Flag ON: the graph gains `type: 'fixture'` nodes with their real
`dfu` / `supply` values. They have **no outgoing edges** —
nothing connects to them yet. The DFU accumulator visits them as
leaves with `accumulatedDFU = dfu` (self). Nothing propagates
upstream because there's nothing to propagate upstream TO.

So even with the flag on, BOM + compliance output is
**unchanged from flag-off state for all existing scenes**. The
fixture nodes exist in the graph but are inert. Wiring them
into the pipe waypoint 0 substitution is what 14.AC.7 will do.

This deliberate inertness is why this phase ships as a scaffold
and not an end-user change.

## Trade-offs

- **Solver correctness remains broken until 14.AC.7.** Users
  flipping the flag on in God Mode get no observable behaviour
  change; they'd need to wait for the connection phase. That's
  the point — this phase is about getting the plumbing right
  before committing to semantic changes.
- **Flag toggled mid-session only affects new events.** A user
  who flips `fixtureGraph: true` while 20 fixtures are already
  placed sees only subsequent placements in the graph. A future
  "rehydrate from fixtureStore" helper (14.AC.8) will catch up
  existing fixtures on flag-on or project-load. Documented in
  one of the tests so nobody confuses this for a bug.
- **`defaultSystemForFixture` is a heuristic.** Most DWV fixtures
  route to `waste`, water-side equipment (water heater, hose
  bibb, PRV, backflow preventer, expansion tank) to
  `cold_supply`. The connection phase should derive system
  from the pipe each fixture attaches to rather than from a
  subtype lookup — which means this helper is a scaffolding
  convenience that 14.AC.7 will likely retire.
- **Position index lives on the bridge.** 14.AC.7 may prefer to
  read positions from a new `setGraph`-style full-scene
  rehydration path instead. If so, the index goes away. Not
  a regression risk: it's a ~20-line cache, cheap to rip out.

## Verification

- `npx vitest run` — 1487 pass (1468 prior + 19 new).
  - 9 pure-module tests (`fixtureToNode`, `composeMutationBatch`
    fixture path, `defaultSystemForFixture`, `fixtureNodeId`).
  - 10 bridge integration tests (flag gating, batch correctness,
    mid-session flag toggle, unknown-fixture no-op).
- `npx tsc -b --noEmit` — clean.
- One existing assertion guards the 3-arg legacy call shape of
  `composeMutationBatch` — so any future change that breaks the
  back-compat would trip this test immediately.

## Files

- `src/store/featureFlagStore.ts` — `fixtureGraph: boolean`
  flag + default `false`.
- `src/engine/worker/mutationBatching.ts` — `FixtureCommit`
  type, `fixtureNodeId`, `fixtureToNode`,
  `defaultSystemForFixture`, `composeMutationBatch` extended
  with optional 4th param.
- `src/engine/worker/SimulationBridge.ts` — three new event
  handlers (flag-gated), `pendingFixtureCommits` queue,
  `fixturePositionIndex` map, `queueFixturePlacement` helper,
  `flushPendingMutations` updated to include fixtures.
- `src/engine/worker/__tests__/fixtureGraphWiring.spec.ts` —
  19 tests.
- `docs/adr/066-fixture-graph-wiring-scaffold.md` — this
  document.

## What's queued

- **14.AC.7** — connect fixture nodes to pipe waypoints.
  Option A: proximity (pipe start point within 0.1 ft of a known
  fixture → substitute fixture node for `wp-{pipeId}-0`).
  Option B: explicit attach/detach via
  `fixtureStore.attachPipe(pipeId)` called at commit time.
  Must be chosen before shipping.
- **14.AC.8** — project-load rehydration: on bundle open + on
  `fixtureGraph` flip-on, iterate `fixtureStore.fixtures`
  and emit synthetic placements so the worker catches up.
- **14.AC.9** — flip the flag default once 14.AC.7 + 14.AC.8
  land and are verified against a golden fixture scene. BOM
  + compliance output change at this point; ADR will document
  the before/after numbers for at least one reference project.
