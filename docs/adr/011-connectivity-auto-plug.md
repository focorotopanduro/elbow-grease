# ADR 011 — Connectivity Tracker + Auto-Plug on Delete (Phase 7.D)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 7.D of 7
- **Depends on:** ADR 002 (CommandBus), ADR 007 (CapPlug geometry)
- **Unblocks:** ADR 009's deferred fitting-suppression (Phase 7.B.ii)

## Context

User request, verbatim:

> *"deleting a prior pipe doesnt reset what comes after, that end just gets capped off with a poug and ring around the plug and left there."*

Before this phase, pipe deletion was a silent destructive act: the pipe vanished and any adjoining geometry (neighbors, fittings, fixtures) had no way of knowing about the disappearance. The user wanted a real-world plumbing behavior where the surviving neighbor's now-dangling endpoint shows a visible cap — the same metal cap + retaining ring a plumber would physically install to seal an unused fitting.

The CapPlug geometry was already built in Phase 6 (ADR 007) but unmounted because there was no way to know WHICH endpoints needed capping. Phase 7.D fills in that missing piece with a spatial connectivity index, and wires the cap renderer.

## Decision

Three new modules:

### 1. `pipeConnectivityStore.ts`

Zustand store holding `endpointIndex: Record<posKey, EndpointIncidence[]>`. Position keys are quantized to 3 decimal places (≈ 0.001 ft). Incidences record `{pipeId, which ('start'|'end'), position, interiorPoint}`.

Queries:
- `incidencesAt(pos)` — all pipes touching a position (within `JOIN_EPSILON_FT = 0.05 ft`). Checks the 27-cell neighborhood of the query position to tolerate rounding across cell boundaries.
- `isConnected(pos)` — shorthand: "> 1 pipe touches here".

Actions:
- `indexPipe(pipeId, points)` — strips any stale incidence then adds fresh entries for both endpoints.
- `unindexPipe(pipeId)` — linear scan + filter.

### 2. `cappedEndpointStore.ts`

Zustand store of `Record<capId, CappedEndpoint>` where `CappedEndpoint` carries position, outward normal, pipe diameter, system, and a timestamp.

Stable id: `cap_${posKey(position)}`. Makes `addCap` idempotent and `removeCapAt(pos)` a lookup.

Floating-point safety: `removeCapAt` also does a neighborhood scan within `JOIN_EPSILON_FT` so a re-added pipe with slightly drifted coordinates still clears the cap.

### 3. `ConnectivityManager.ts`

The glue layer. Single boot function subscribes to CommandBus entries:

- `pipe.add(id, points)` → index the pipe + run self-heal on both endpoints (remove any cap sitting at that position).
- `pipe.remove(id)` → capture the pipe's former incidences, unindex, then for each former endpoint check the remaining incidence count. If exactly 1 neighbor survives there, it's orphaned — push a `CappedEndpoint` record with outward normal computed from `interiorPoint → endpoint`.
- `pipe.insertAnchor(pipeId)` → re-index the pipe (endpoints haven't actually changed, but cheap defensive re-index keeps the invariant exact if the action ever extends to endpoint movement).

### 4. `CappedEndpoints.tsx` renderer

Iterates `cappedEndpointStore.caps`, renders one `<CapPlug>` per record. Floor visibility + system visibility honored via `useLayerStore` and `useFloorParams`.

## Key design choices

### 1. Spatial index keyed by quantized position, NOT by pipe id

Alternative: a per-pipe `neighbors: pipeId[]` adjacency list. Rejected because the fundamental query is "what's at THIS position" — a pipe adjacency list would need to linearly scan through all pipes to find who's at `(5, 0, 0)`. Position-first indexing makes the orphan-detection pass O(1) per endpoint.

### 2. Single-writer invariant via CommandBus

Both stores are written ONLY by `ConnectivityManager`, which in turn only runs in response to CommandBus entries. This means:

- No race where a direct pipeStore setter bypasses connectivity tracking (Phase 1's `commandBus` flag gates the legacy path).
- Every connectivity mutation shows up in the God Mode log as a side effect of a user command — the cap that appeared "after I deleted that pipe" is traceable back to the exact `pipe.remove` dispatch in 1 click.

### 3. Self-heal on re-add instead of manual uncap action

Alternative: add an "uncap" button to `PipeInspector` (the user clicks a cap, inspector appears, click to remove). Rejected because it's friction — the PHYSICAL reality is that if you run a pipe to a capped endpoint, the cap comes off. Software should mirror that. User re-adds pipe → cap disappears.

Manual uncap can be added later as a "cap ghost" state for users who want to KEEP the cap visible even after reconnecting (rare but possible for drawing-review purposes). For now, re-add = auto-uncap.

### 4. Outward normal from interior→endpoint direction

The CapPlug needs an outward-facing vector to orient itself. The cleanest signal is "the direction from the pipe's interior toward the endpoint" — i.e. `endpoint - interiorPoint`. For a pipe with points `[A, B, C, D]` ending at `D`:

- Start endpoint: interior is `B`, outward = `A - B`.
- End endpoint: interior is `C`, outward = `D - C`.

Works for any polyline length ≥ 2. Zero-length edge case (degenerate pipes) is handled by the `CapPlug` component's own defensive normalization.

### 5. Tee preservation

When a junction has 3+ pipes and one is removed, the remaining 2+ are still connected. The orphan detection runs on `remaining.length !== 1`, which filters tees OUT correctly — tested in `tee junction (3-way): removing ONE leaves the other 2 still connected — no cap`.

## Alternatives considered

### A. Store connectivity as derived state in pipeStore

Add a `connectedTo: Record<endpoint, pipeId[]>` field per pipe, maintained by pipeStore's own actions. Rejected:

- pipeStore already does a lot. Adding connectivity would bloat every mutation with neighbor updates.
- The connectivity query shape (`incidencesAt(pos)`) is position-centric, not pipe-centric. A pipe-keyed store would force every consumer to scan pipes.
- Coupling connectivity to pipeStore makes it hard to add manifolds (Phase 7.C) as connectivity sources later — a standalone store can index multiple entity types.

### B. O(N²) recomputation on every render

Give up the index entirely; on every frame, compute "who's connected to whom" by pairwise comparison. Rejected even though it'd be "correct" — 500 pipes × 2 endpoints × O(N) pairwise = 500,000 checks per render. Unacceptable.

### C. Put connectivity in the existing `pipeStore.pivotSession`-style session

Rejected because connectivity lives across the entire session, not just during a user action. A dedicated store matches the lifecycle.

### D. Wire the CapPlug directly inside pipeStore.removePipe

Rejected: mixes rendering concerns into the data layer. The store has no business knowing about 3D components.

## Consequences

### Positive

- **The user's ask works.** Delete a pipe that has a neighbor → the neighbor's orphaned end grows a visible plug + retaining ring in the pipe's system color.
- **Self-heal.** Re-run a pipe to the capped point → cap disappears. No user action needed.
- **Tee-safe.** 3-way junctions preserved correctly; removing one of three at a tee doesn't cap either survivor.
- **Testable.** 11 Vitest cases cover index correctness, orphan detection, self-heal, tee preservation, idempotency, and floating-point drift.
- **Unblocks Phase 7.B.ii.** The `FittingRenderer` can now consult `pipeConnectivityStore.incidencesAt(vertex)` to decide "is this vertex a real tee junction" (emit fitting) vs "merged PEX continuation" (suppress).
- **Zero new runtime deps.**

### Negative

- **Boot ordering matters.** `ConnectivityManager` must boot AFTER `CommandBus` so its subscription catches every pipe command. Documented in App.tsx boot sequence.
- **Manifolds not yet indexed.** Phase 7.C's manifolds don't register their port positions with `pipeConnectivityStore`, so a pipe drawn to a manifold port isn't recorded as "connected to manifold". This means deleting that pipe DOES cap its free end as if the manifold weren't there. Tracked as a tiny follow-up: add manifold port incidences in `ConnectivityManager` on `manifold.add`/`manifold.mergeNeighbors`.
- **No undo for cap appearance.** Undoing a `pipe.remove` currently does NOT auto-remove the cap that got pushed. The cap persists as a stale artifact. Fix is straightforward (cappedEndpointStore.addCap snapshot in the pipe.remove undo path) but left for a v0.1.4 polish commit.

### Neutral

- **The Phase 6 `CapPlug` finally renders in production.** It's been dead code since that commit; Phase 7.D turns the lights on.

## Rollout

- **This commit:** boot wiring + stores + renderer + tests. No feature flag — the system is strictly additive (capps only appear when pipes are deleted, which only happens when the user acts).
- **Follow-ups:** manifold-port indexing (Phase 7.D.i); undo snapshot for auto-cap (Phase 7.D.ii); manual uncap button in PipeInspector if a user asks for it (Phase 7.D.iii).

## Rollback

- **Dev:** revert the ConnectivityManager boot in App.tsx. The stores remain but are never populated; `CappedEndpoints` renders nothing (empty iteration).
- **Surgical:** remove the `bootConnectivityManager()` call specifically — shouldn't require other changes.

## Metrics

| Metric | Target | Actual |
|---|---|---|
| Two-pipe connected pair detected | yes | **yes** ✓ |
| Orphan cap appears after delete | yes | **yes** ✓ |
| No false caps on isolated-pipe delete | yes | **yes** ✓ |
| Tee junction preserved on single removal | yes | **yes** ✓ |
| Self-heal on re-add | yes | **yes** ✓ |
| Cap id idempotent | yes | **yes** ✓ |
| Floating-point drift within epsilon handled | yes | **yes** ✓ |
| Full suite | all green | **141/141** ✓ |
| TypeScript | 0 errors | **0** ✓ |
| New runtime deps | 0 | **0** ✓ |

## References

- Source: `src/store/pipeConnectivityStore.ts`, `src/store/cappedEndpointStore.ts`, `src/core/pipe/ConnectivityManager.ts`, `src/ui/pipe/CappedEndpoints.tsx`
- Test: `src/core/pipe/__tests__/ConnectivityManager.spec.ts`
- Depends on: ADR 002 (CommandBus subscriptions), ADR 007 (`CapPlug` geometry, `JOIN_EPSILON_FT` convention)
- Unblocks: ADR 009's Phase 7.B.ii (fitting suppression at merged PEX vertices)
