# ADR 010 — Manifold Drag-Merge (Phase 7.C)

- **Status:** Accepted (core functional; placement UX simplified for MVP)
- **Date:** 2026-04-17
- **Phase:** 7.C of 7
- **Depends on:** ADR 002 (CommandBus), ADR 007 (navFrozen)

## Context

User request, verbatim:

> *"once I pull a bunch of manifolds together, they merge into a 2 outlet manifold, or 3, or 4, or 5, depending how many I put together as they snap onto the next pipe if I drage them paralel to each other as they touch, I want ot be able to have this be a feature where I can physically draw pipes."*

The QuickPlumb gesture the user describes: place small manifold primitives, drag them into contact, have them auto-merge into larger multi-port manifolds. The underlying plumbing reality this models is a PEX home-run supply manifold — a single trunk with N evenly-spaced outlets, sized in standard 2-to-6-port increments.

This phase establishes the Manifold entity + the merge rule + a renderer + a drag flow. It is deliberately MVP-scoped on placement (a keyboard drop) because weapon-wheel integration is its own phase.

## Decision

Three new files plus wiring:

### 1. `ManifoldGeometry.ts` — pure math

Defines:
- `Manifold` interface: `{ id, center, yawRad, portCount, system, material, portDiameterIn, floorY }`
- `trunkLengthFt(portCount)` — scales with port count at fixed spacing (3")
- `computePortPositions(m)` — yaw-aware world positions of each port + outward normal
- `trunkEndpoints(m)` — world positions of trunk's left/right end
- `checkManifoldMerge(a, b)` → `{ canMerge, aEnd, bEnd, gapFt, reason }`
- `computeMerged(a, b, check)` → new Manifold with combined port count

No Three.js imports; fully unit-testable.

### 2. `manifoldStore.ts` — Zustand entity store

Actions: `addManifold`, `removeManifold`, `moveManifold`, `selectManifold`, `tryMergeWithNeighbors`, `mergeInto`. All mutations also exposed as CommandBus handlers so the God Mode console (Phase 1) logs every drag + merge as a correlated chain.

### 3. `ManifoldRenderer.tsx` — 3D + drag

Per-manifold visuals: rectangular trunk body + N port tubes with collars + optional selection ring. Drag handler: pointerdown on trunk captures grab offset → window `pointermove` updates `manifold.move` → window `pointerup` dispatches `manifold.mergeNeighbors` which runs the merge check against every other manifold and, if eligible, consumes the neighbor.

Navigation freeze (`navFrozen` from Phase 6) auto-asserted during drag — orbit can't fight the gesture.

### The merge rule (six ANDed conditions)

```
  same material            (both PEX for MVP)
  same port diameter
  same plumbing system
  same floor elevation      (within 0.05 ft)
  yaws parallel             (within 2° — 180° flip is allowed, same axis)
  perpendicular offset      (within 0.12 ft — stays colinear)
  endpoint gap              (within 0.2 ft — "they touch")
  combined port count       (≤ 5 — MAX_PORT_COUNT)
```

Any failure yields a `reason` string. The God Mode console will show these on future `manifold.mergeNeighbors` misses when the user drags an eligible pair but the constraints don't meet — diagnostic gold.

### Merge survivors keep source id

`tryMergeWithNeighbors(sourceId)` always folds the neighbor INTO the source. The surviving manifold retains `sourceId`, so the user's selection (and any future undo) follows the dragged entity rather than hopping to a new id.

## Key design choices

### A. End-to-end merge, not side-by-side stacking

The user wrote "parallel to each other as they touch." Two interpretations exist: (1) colinear, end-to-end, ports in one continuous row — a 4-port manifold looks like two 2-ports glued left-to-right; (2) side-by-side, two parallel rows of ports. I chose (1). Reasons:

- Real PEX manifolds ship as single-piece extrusions with ports on one face. Stacking two end-to-end approximates what you'd buy — stacking side-by-side doesn't correspond to any real product.
- Port spacing stays uniform across the merged body, which is what downstream pipe-routing expects.
- The constraint math is simpler: "colinear, one near the other" is one condition; "parallel but offset" needs extra orientation decisions.

Side-by-side stacking can be a later extension if needed.

### B. Port count capped at 5

The user said "2, 3, 4, or 5." Six-port-plus manifolds exist commercially but are usually distinct product SKUs, not "a merged 2+4." Cap at 5 enforces this business rule and prevents runaway merging (a user who drags a 4-port near a 3-port and expects "7" would be surprised — the cap produces a REJECTION instead).

### C. Absolute merge atomicity via CommandBus snapshot

`manifold.mergeNeighbors` snapshots ALL manifolds pre-apply. Undo restores the complete pre-merge state in one step. This is heavier than snapshotting just the affected pair — but a single drag can trigger a chain of merges (drag a 2-port into a 2-port that's next to another 2-port → 4-port with neighbor still detached → one more drag + 5-port, etc.). The snapshot-all strategy tolerates any merge-chain topology without per-step undo.

### D. Placement is a keyboard drop for MVP

The user asked for weapon-wheel integration: select a fitting sector, click to place a manifold. That requires:

1. Adding a "Manifold" sector to the FittingWheel with a subtype for port count.
2. Adding a Canvas-level pointermove handler that shows a placement ghost.
3. Committing on click, canceling on Escape.

All straightforward but ~150 additional lines + wheel icon + catalog entries. Scoped to a follow-up phase (7.C.ii) so Phase 7.C ships the core merge-and-drag in one coherent commit.

**MVP workaround**: press `M` → a 2-port manifold appears at world origin. The user can then select + drag it. Placement at a specific cursor position via the `M` key can be a future refinement; for now the user can drag the spawned manifold to wherever they want it.

## Alternatives considered

### I. Proximity-check continuously during drag (live merge hints)

Show a ghost "this would merge" preview as the user drags close. Rejected: adds a per-move neighbor check across all manifolds — O(N) per event. At 60Hz and 50 manifolds, 3,000 merge-checks/sec. Acceptable but overkill for an action that fires once per gesture. Commit-time check is O(N) once.

### II. Multi-segment manifolds (non-rectangular shapes)

Bent manifolds that wrap corners are real products. Modeled as an elongated trunk with ports on the outside of a curve. Rejected for MVP: no use cases surfaced, and the "merge two together" action makes less geometric sense on bent trunks (orientation matching becomes ambiguous).

### III. Store port connections to pipes as first-class

A full implementation would track which port connects to which pipe endpoint. Rejected for this phase: that's the pipe-connectivity graph that Phase 7.D builds. For now, users draw pipes to port tip positions manually — the extender-drag workflow from Phase 6/7.A covers this naturally.

## Consequences

### Positive

- **The merge rule works.** 23 Vitest cases pin every condition: yaw mismatch, perpendicular offset, port cap, system/material/diameter/floor differences, physical gap, combined-port-count cap. Cover all 6 rejection reasons.
- **Drag feels right.** Pointerdown-and-move follows the grab point; ports + collars move with the body; selection ring appears under the trunk; navigation freezes automatically.
- **Command-bus-native.** Every drag step is a logged `manifold.move`; every merge is a `manifold.mergeNeighbors` with the full pre-merge state as undo snapshot.
- **Zero new runtime deps.**

### Negative

- **Placement is currently a keyboard drop, not a weapon-wheel sector.** Follow-up Phase 7.C.ii covers the wheel integration.
- **Pipes don't auto-route to merged manifold's ports.** When a manifold merges, its port count grows and port positions shift — any pipes the user previously drew to the old port positions stay at their old coordinates. Pipe reconciliation is tracked in Phase 7.D (connectivity).
- **No snap-ghost preview during drag.** User sees the manifold follow the cursor and then, on release, it either stays put OR is absorbed into a neighbor. A future refinement can show a ghost indicator ("this will merge into X") while dragging within the snap threshold.

### Neutral

- **Selection across merged body is per-entity, not per-port.** Clicking a merged 4-port selects the whole manifold. Per-port selection (for re-routing individual feeds) is a future concern.

## Rollout

- **This commit:** Manifold entity + renderer + drag-merge live. `M` key spawns a 2-port at origin. No feature flag — the ManifoldRenderer returns null when the store is empty, so the feature is inert until the user presses `M`.
- **v0.1.4 (follow-up):** ghost preview during drag; FittingWheel integration for placement.
- **Integration with Phase 7.D (connectivity):** merged manifolds will become first-class endpoints in the pipe connectivity graph, enabling auto-plug on delete and smart pipe-routing hints.

## Rollback

- **User:** dragging doesn't drop new manifolds unless `M` is pressed; if undesired behavior appears, remove all manifolds and the store is empty → no renderer output.
- **Dev:** revert the ManifoldRenderer mount in App.tsx + handler registration. `ManifoldGeometry.ts` + `manifoldStore.ts` remain as dormant modules.

## Metrics

| Metric | Target | Actual |
|---|---|---|
| Geometry tests | all pass | **23/23** ✓ |
| trunkLengthFt scales + clamps | yes | **yes** ✓ |
| Port positions yaw-correct | yes | **yes** ✓ |
| Merge accepts colinear touching pairs | yes | **yes** ✓ |
| Merge rejects 6 distinct reasons | all 6 | **all 6** ✓ |
| Combined port cap enforced | yes | **yes** ✓ |
| Merged center between outer ends | yes | **yes** ✓ |
| Survivor retains source id | yes | **yes** ✓ |
| Full test suite | all green | **130/130** ✓ |
| Phase 1-7.B regressions | 0 | **0** ✓ |
| TypeScript errors | 0 | **0** ✓ |
| Vite build | green | **built in 24.03s** ✓ |
| New runtime deps | 0 | **0** ✓ |

## References

- Source: `src/core/manifold/ManifoldGeometry.ts`, `src/store/manifoldStore.ts`, `src/ui/manifold/ManifoldRenderer.tsx`, `src/core/commands/handlers/manifoldHandlers.ts`
- Test: `src/core/manifold/__tests__/ManifoldGeometry.spec.ts`
- Mount: `src/App.tsx` (ManifoldRenderer + M-key handler)
- Commands: `manifold.add`, `manifold.remove`, `manifold.move`, `manifold.select`, `manifold.mergeNeighbors`
