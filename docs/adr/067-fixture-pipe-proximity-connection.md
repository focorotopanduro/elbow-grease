# ADR 067 — Fixture → Pipe Proximity Connection (Phase 14.AC.7)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AC.7
- **Depends on:** ADR 066 (fixture graph scaffold), ADR 063
  (graph mutation batching).

## Context

14.AC.6 landed fixture graph nodes in the worker DAG as a scaffold —
the `fixtureGraph` feature flag routed `FIXTURE_PLACED` / `REMOVED`
/ `PARAMS_CHANGED` into the batched mutation path, but the fixture
nodes sat isolated: no edges connected to them, so DFU / WSFU
propagation had nothing to propagate through.

This phase closes the loop: when a pipe is committed, if either
endpoint is near a known fixture position, the pipe's edge
references the fixture's graph node directly instead of creating a
waypoint junction. The solver now sees a connected chain:

```
 fixture (DFU: 4)  →  edge  →  wp-pipe-1  →  edge  →  fixture/drain
 type: fixture       diameter/length       junction              type: fixture
```

DFU accumulates upstream from leaves. Pipe sizing, compliance
checks, and (eventually) BOM pricing run against a graph that
reflects real fixture load.

Still flag-gated (`fixtureGraph: false` default). 14.AC.8 will
handle project-load rehydration; 14.AC.9 flips the default once
end-to-end verified on a golden scene.

## Decision

Proximity substitution at `PIPE_COMPLETE` time. No new events, no
new stores. Two extension points:

### 1. `PipeCommit` gains endpoint overrides

```ts
interface PipeCommit {
  id, points, diameter, material, system?,
  startNodeOverride?: string;   // Phase 14.AC.7
  endNodeOverride?: string;
}
```

When an override is set, `pipeToMutations`:

- Skips the corresponding endpoint waypoint node.
- Wires the corresponding edge's `from` (or `to`) to the override
  ID directly.

Interior waypoints are unaffected. Edge IDs stay on the
`edge-{pipeId}-{i}` convention — indices never shift. Back-compat
is automatic: an omitted override means the legacy all-waypoint
shape.

### 2. Bridge proximity lookup at PIPE_COMPLETE

```ts
const FIXTURE_SNAP_TOLERANCE_FT = 0.1;  // ~1.2 inches

private findFixtureNodeAt(pt): string | undefined {
  // iterate fixturePositionIndex, Euclidean 3D distance, first
  // match wins (Map iteration is insertion order, so earlier-
  // placed fixtures take precedence — stable for tests)
}
```

Flow on `PIPE_COMPLETE`:

1. If `fixtureGraph` flag off → overrides undefined, legacy behaviour.
2. If on:
   - `startNodeOverride = findFixtureNodeAt(points[0])` or undefined
   - `endNodeOverride = findFixtureNodeAt(points[last])` or undefined
3. Construct the commit with overrides.
4. Run `pipeToMutations(commit)` up front just to capture the
   **exact** node + edge IDs this pipe will create. Store in
   `pipeIdIndex` so a future `pipe:removed` surgically removes
   only what the pipe added — **not the fixture node(s)**.

### Tolerance rationale

**0.1 ft (~1.2 inches).** Tighter than the 0.3 ft draw-snap grid,
which means two fixtures at adjacent grid cells can't both claim
the same pipe endpoint. Loose enough to absorb minor drift from
fixture bounding-box positioning.

If real-world data shows false negatives (plumber's pipe ending
slightly off a fixture's connection point), the tolerance loosens
in one line. Starting tight and relaxing is safer than starting
loose and tightening.

### Edge cases handled by tests

| Scenario | Behaviour |
|---|---|
| Pipe starts on fixture | first edge `from = fx-{id}`, no `wp-…-0` |
| Pipe ends on fixture | last edge `to = fx-{id}`, no last waypoint |
| Pipe from fixture to fixture | only interior waypoints, both edges substituted |
| 2-point pipe fixture-to-fixture | zero nodes created, one edge |
| Pipe far from fixtures | legacy all-waypoint shape |
| Just-inside tolerance | snaps |
| Just-outside tolerance | doesn't snap |
| Pipe removed | only waypoints + edges go; fixture stays |
| Two pipes from same fixture | both edges converge on `fx-{id}` |
| Fixture placed AFTER pipe drawn (same tick) | no retroactive connection |
| Fixture removed, pipe redrawn | no ghost connection |
| Flag OFF | no substitution regardless of proximity |

## Trade-offs

- **No retroactive connection.** A pipe drawn before its fixture
  stays connected to its `wp-…-0` junction. The user has to
  redraw or wait for 14.AC.8's rehydration to normalize. This is
  acceptable for the scaffold phase — in practice users place
  fixtures before routing to them, and a redraw is one undo away.
- **First-match tie-breaking.** Two fixtures both within
  tolerance of the same pipe endpoint: the earlier-placed one
  wins. Stable for tests; unlikely in practice because the 0.1 ft
  tolerance is tighter than any normal fixture-to-fixture spacing.
- **Interior-waypoint fixtures are ignored.** A fixture at a
  pipe's middle point doesn't get substituted. Rare, and would
  complicate the graph topology significantly (a 3-way tee on a
  fixture node). If a future use case surfaces, it's additive
  work.
- **System assignment unchanged.** Pipe's `system` is still
  whatever the bridge defaults to (waste); the connected
  fixture's system on the fixture node is what DFU propagation
  uses. A pipe connecting a water_heater (cold_supply) to a tank
  drain produces a graph with a cold_supply fixture node and a
  waste-typed edge. Solver handles this correctly because
  propagation follows edges, not system tags. Real system
  inference can be a later phase.
- **Pre-existing AC.6 test updated.** One mixed-batch test was
  relying on the old isolated-node shape; moved the test fixture
  to a far-away position so its assertion still holds under
  AC.7's behaviour.

## Verification

- `npx vitest run` — 1503 tests pass (1487 prior + 16 new: 6
  pure `pipeToMutations` override tests + 10 bridge proximity
  integration tests). One AC.6 test updated to use a far-away
  fixture so the mixed-batch assertion survives AC.7's
  substitution.
- `npx tsc -b --noEmit` — clean.
- Integration check I did NOT run: full solver output against a
  fixture-connected graph vs a junction-only graph. That's a
  14.AC.9 concern — this phase ships the plumbing (flag-gated),
  and the behaviour change only materializes when a user opts
  in.

## Files

- `src/engine/worker/mutationBatching.ts` — `PipeCommit` gains
  `startNodeOverride` / `endNodeOverride` fields;
  `makeSegmentEdge` signature takes explicit from/to IDs;
  `pipeToMutations` skips override-covered waypoints and passes
  override IDs through to the edge.
- `src/engine/worker/SimulationBridge.ts` —
  `FIXTURE_SNAP_TOLERANCE_FT` constant, `findFixtureNodeAt`
  method, `PIPE_COMPLETE` handler now looks up endpoint
  substitutions (flag-gated) and feeds the commit through
  `pipeToMutations` up front to capture the exact node/edge IDs
  for the `pipeIdIndex` removal cache.
- `src/engine/worker/__tests__/fixtureProximityConnection.spec.ts` —
  16 tests.
- `src/engine/worker/__tests__/fixtureGraphWiring.spec.ts` —
  one mixed-batch test updated to place fixture far from pipe
  endpoints.
- `docs/adr/067-fixture-pipe-proximity-connection.md` — this
  document.

## What's queued

- **14.AC.8** — project-load rehydration. On `.elbow` bundle open
  + on `fixtureGraph` flag-on transition, iterate
  `fixtureStore.fixtures` and `pipeStore.pipes` and emit synthetic
  placements / commits so the worker catches up. Required to make
  the flag useful for scenes that predate 14.AC.6.
- **14.AC.9** — flip `fixtureGraph` default to `true`. Ship with
  golden-scene before/after BOM + compliance numbers documenting
  the correctness improvement.
- **14.AC.10** — BOM pricing gains fixture line items (currently
  BOM reads edges only; once fixtures are in the graph, they
  should roll up into the BOM export).
- **14.AC.11** — proximity tolerance tuning based on real usage
  telemetry. Current 0.1 ft is a ceiling, not an average; watch
  for false-negative reports and loosen if warranted.
