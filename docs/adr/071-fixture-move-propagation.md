# ADR 071 — Fixture Move Propagation (Phase 14.AC.11)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AC.11
- **Depends on:** ADR 066 (scaffold), ADR 068 (rehydration),
  ADR 069 (default on).

## Context

`fixtureStore.setPosition(id, position)` was a silent mutator —
it wrote the new position to Zustand but emitted no event. The
`SimulationBridge` never heard about the move, so a fixture
moved on the canvas kept its worker-graph `elevation` at the
stale initial value. Solver state drifted from UI state on
every drag. Pre-14.AC.6 this was invisible because nothing
flowed through the bridge anyway; post-14.AC.9 it's a real
correctness gap.

In the middle of implementing this phase I ALSO found a
related bug: my first-draft move handler used the same "remove
+ re-add inside one batch" pattern as `FIXTURE_PARAMS_CHANGED`,
expecting `composeMutationBatch`'s cancellation to elide the
no-op case. It didn't work, for two independent reasons — and
the fix for one is the fix for both.

## Decision

### 1. `fixtureStore.setPosition` emits `EV.FIXTURE_MOVED`

New event on the `EV` roster:

```ts
FIXTURE_MOVED: 'fixture:moved',  // { id, subtype, position }
```

`setPosition` reads the fixture's subtype + new position and
emits before returning. Missing-id still silently no-ops (same
as `removeFixture`'s ghost-id handling).

### 2. Bridge handler — in-place replace, NOT remove + re-add

This is the critical piece. The initial draft pushed both:

```ts
this.pendingRemovedNodeIds.push('fx-' + id);   // ← wrong
this.queueFixturePlacement(...);
```

Two things go wrong with that:

**Bug A — cancellation is too eager.** `composeMutationBatch`
walks the added list and drops any entry whose ID also appears
in the removal list, then walks the removal list and drops any
ID that was added. Both sides cancel → empty batch → no update
lands → worker's node stays at old elevation. Correct for a
commit-then-undo pair, wrong for a move where the add is
semantically newer than the remove.

**Bug B — removeNode cascades into edge destruction.** Even if
cancellation were fixed, `dag.removeNode()` in the worker
removes all connected edges before removing the node itself.
So a fixture with a live pipe connected loses its pipe edges
on every move. The edges aren't in the batch (they were added
in a previous debounce), so they don't come back.

**The fix for both bugs is the same: don't queue a removal at
all.** `dag.addNode()` is idempotent — it calls `this.nodes.set(id, node)`
which replaces the object in-place, and the edge adjacency set
initialization is guarded with `if (!this.outgoing.has(id))`,
so existing edges stay wired. A move is just an add with the
updated data; the worker sees a replace, not a delete+create.

Applied the same simplification to `FIXTURE_PARAMS_CHANGED`,
which had the same latent bug — it had just never been triggered
because nobody moved a fixture with connected pipes while
changing params.

### 3. Stale-move guard

Added a precondition on `FIXTURE_MOVED`:

```ts
if (!this.fixturePositionIndex.has(payload.id)) return;
```

A move event arriving after the fixture was removed (stale
queue, cross-session replay) no-ops instead of resurrecting
the fixture. `FIXTURE_REMOVED` already deletes from the index,
so the gate is clean.

### Edge cases covered by tests

| Scenario | Behaviour |
|---|---|
| `setPosition` on an existing fixture | emits `FIXTURE_MOVED` with new pos |
| `setPosition` on an unknown id | no emission |
| Rapid moves | every emission reflects its own position |
| Bridge, flag on | batch re-adds fixture with updated elevation, NO removal |
| Bridge, flag off | no batch |
| Move + pipe commit in same tick | pipe proximity sees new position |
| Move + pipe commit at OLD position | pipe doesn't snap (fixture moved away) |
| Stale move after remove | ignored, no resurrection |
| Pipe connected to moved fixture | edges preserved (critical regression guard) |

The "preserves pipe connection" test is explicit: any future
refactor that reintroduces `pendingRemovedNodeIds.push('fx-…')`
in the move path fails the assertion immediately. Named so
diagnostics point at the right layer.

## Trade-offs

- **PARAMS_CHANGED now always produces a batch.** Pre-AC.11
  the remove + re-add could cancel to an empty batch on a
  cosmetic param change. Now every PARAMS_CHANGED costs one
  extra BATCH_MUTATE payload (~200 bytes). Trivial; the only
  alternative was accepting the edge-destruction bug.
- **No UPDATE_NODE message.** Could have added one for
  clarity, but adding a dedicated command to the protocol
  surface felt heavier than leveraging `addNode`'s existing
  idempotent semantics. Revisit if the protocol accrues more
  update paths.
- **Position index as liveness signal.** Using
  `fixturePositionIndex.has(id)` as "is this fixture live?"
  couples two concerns (position tracking + lifecycle). A
  dedicated `placedFixtureIds: Set<string>` would be cleaner;
  deferred because the index-as-lifecycle-signal pattern is
  already used elsewhere in the bridge and refactoring it is
  out of scope.
- **Move doesn't re-check proximity connections on existing
  pipes.** A pipe drawn from the fixture when it was at
  [0,0,0] keeps its `fx-{id}` edge connection even after the
  fixture moves to [10,0,0]. The pipe's geometric endpoints
  (from `pipe.points`) stay at [0,0,0]. That's a graph-vs-
  geometry drift that's arguably wrong — but moving the
  fixture also doesn't move the pipe, so visually the pipe
  stays where it was drawn. Rehooking connections on move
  is a future phase if users report it.

## Verification

- `npx vitest run` — 1543 tests pass (1534 prior + 9 new).
  Pre-existing `fittingCachePerf.spec.ts` timing test was
  flaky under full-suite load; passes clean in isolation.
- `npx tsc -b --noEmit` — clean.
- One pre-existing AC.6 test updated: PARAMS_CHANGED used to
  assert cancellation (empty batch); now asserts the re-add
  semantics.

## Files

- `src/core/events.ts` — `EV.FIXTURE_MOVED` added.
- `src/store/fixtureStore.ts` — `setPosition` emits.
- `src/engine/worker/SimulationBridge.ts` — `FIXTURE_MOVED`
  handler, stale-move guard, PARAMS_CHANGED simplified to
  match new "just re-add" pattern.
- `src/engine/worker/__tests__/fixtureMove.spec.ts` — 9 tests.
- `src/engine/worker/__tests__/fixtureGraphWiring.spec.ts` —
  PARAMS_CHANGED test updated for AC.11 semantics.
- `docs/adr/071-fixture-move-propagation.md` — this document.

## What's queued

- **14.AC.12** — post-bake telemetry review after AC.9 + AC.10
  + AC.11 ship together for 2–4 weeks. Validate bid totals,
  compliance warning stability, and cache/batch metrics.
- **14.AC.13** — per-subtype variant tiers (premium vs basic
  toilet on the same bid) if customers ask.
- **14.AC.14** — reconnect proximity on fixture move. Pipes
  connected to a fixture at its old position retain their
  `fx-{id}` edge after the fixture moves. Geometrically
  floating. Fix: on `FIXTURE_MOVED`, walk connected pipes and
  decide if they should disconnect (pipe geometry no longer
  ends at fixture) — may require user-facing UX.
