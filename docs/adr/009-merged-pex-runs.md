# ADR 009 — Merged PEX Runs (Phase 7.B)

- **Status:** Accepted
- **Date:** 2026-04-17
- **Phase:** 7.B of 7
- **Depends on:** ADR 007 (`PexBendClassifier`)

## Context

User request, verbatim:

> *"uponor must behave organically by uniting and reconciling pipes which are drawn in 45 degree turns any which direction, when drawn in 90 degree turns then put a 90 degree fittings there instead of a bend, otherwise, smothen out the edges of those specific pipe to unite them and create uponor pipe feel that is realistic and is taken off for the plumbing in an amazing way!"*

Until this phase each committed pipe rendered its own `TubeGeometry`. Two adjacent PEX pipes sharing an endpoint showed a visible seam — a tell-tale sign the software was treating them as unrelated entities. In real life, PEX flexes through a gentle bend and reads as one continuous line.

The PEX bend classifier from Phase 6 (ADR 007) already tells us which corner types should smooth-merge. Phase 7.B turns that classification into render-time geometry consolidation.

## Decision

Introduce `mergePexRuns`: a pure function that walks committed pipes and outputs a `MergeResult` mapping every pipe to a `PipeRunGroup`. Two pipes merge into the same group iff ALL of:

1. Both are PEX.
2. Same diameter (a size change is a reducer fitting).
3. Same plumbing system.
4. Shared endpoint (within 0.05 ft ≈ 0.6 in).
5. Bend angle at the shared endpoint classifies as `smooth_bend` or `smooth_curve` (not `fitting_90`, not `sharp_bend`).
6. The shared endpoint is touched by **exactly 2** pipes — tees (3+ incidences) don't merge.

The result is fed into `PipeRenderer`:

- Merged-group **lead** → renders one `MergedPexRun` component with a single `CatmullRomCurve3` through all group points.
- Merged-group **non-leads** → skip rendering (their geometry is covered by the lead's tube).
- **Singleton pipes** → legacy `FullPipe` render path, unchanged.

Selection: if any pipe in a merged group is selected, the whole tube paints as selected. Individual pipe hitboxes from `PipeHitboxes` still work — so clicking one pipe in a run selects exactly that pipe, while the visual mesh that shows the selection spans the run.

## Key design choices

### 1. Union-Find, not a BFS on every render

Union-Find with path compression + rank union gives amortized O(α(N)) — essentially constant — per union operation. For 500 pipes we do ≤ 500 unions plus O(V) vertex adjacency work. The whole merge runs well inside the ~8ms budget we're targeting for large scenes.

Alternatives:
- **Graph BFS** from each pipe → O(P²) worst case; throwaway overhead for the grouping alone.
- **Recursive merge on every mutation** → fragile; easy to leave stale state if a reducer is introduced into an existing group.
- **Incremental Union-Find persisted in the store** → adds a store, adds cross-store consistency; not worth it until we have pipe-connectivity tracking (Phase 7.D).

### 2. `smooth_curve` also merges (not just `smooth_bend`)

The classifier returns `smooth_curve` for deflections below 15° — essentially "the user drew a nearly-straight run that happens to zigzag 3°". Those absolutely should merge; not merging leaves a visible seam for no plumbing reason. Flat-out boundary of 15° cutoff between `smooth_curve` and `smooth_bend` means the merge logic handles the full [0°, 90°-tol) range.

### 3. Lead pipe = first inserted pipe in the group

Union-Find's root isn't insertion-ordered by default. Walking `groupOf` in insertion order and picking `members[0]` gives a STABLE lead: the same group always has the same lead across re-computes. Stable leads matter because React keys the rendered component by lead ID — a changing lead would thrash the component remount cycle.

### 4. `CatmullRomCurve3` with tension 0.4

Matches `FullPipe`'s singleton-PEX path. Tension 0.4 keeps the curve close to anchor points (essentially "stiff flex" — reads as intentional plumbing, not a noodle). Segment count scales with point count: `max(32, mergedPoints.length * 20)` — enough resolution for long merged runs without catastrophic triangle counts.

### 5. Closed loops bail to singletons

A group with no "terminal endpoint" (every vertex has exactly 2 incidences) is a closed loop — which physically makes no sense in a PEX water supply but could theoretically happen with a test scene. The walker detects this (no terminal found) and returns the first pipe's points, meaning the merge REPORTS a group but the rendered run only covers one pipe. Better than crashing or infinite-looping.

Tests cover this as the "PEX square at 90° corners → 4 singletons" case (90° corners fail the merge filter anyway, so the walker never runs on a true loop — but the defense-in-depth stays).

### 6. Selection aggregates up to the group

If any pipe in a merged group has `selected: true`, the merged tube paints with the selected material. Simplification vs. splitting-at-select-time. The user's mental model matches: "I clicked on this run, the run is lit up."

## Alternatives considered

### A. Mesh merging via `BufferGeometryUtils.mergeGeometries`

THREE has a mesh merger that concatenates geometries with different materials. Rejected: (a) merged mesh loses per-pipe raycast granularity — you'd need an instance ID per vertex to recover which pipe got clicked; (b) the merged result is still N separate tubes rendered as one draw call, not a single CatmullRom — no visual seam reduction at the boundaries.

### B. Fit a single curve per group via spline interpolation

Replace the anchor points with a smooth control-point optimization (a.k.a. spline fitting). Rejected: CatmullRom IS a spline interpolation and it passes through the anchors, which is what we want. Control-point fitting would DEPART from grid points — users would lose the ability to trust the drawing matches the grid.

### C. Post-process the existing FullPipe tube to "smooth" its seam

In the fragment shader, detect the seam and blur it. Rejected: the seam isn't just visible — it's geometrically real (two tubes meeting at different orientations produce a normal-vector discontinuity even if the OD matches). Shader tricks can hide this on a still image but not across rotation.

## Consequences

### Positive

- **PEX looks like PEX.** Adjacent runs at 45° read as one continuous flex line with no visual seam.
- **Cheap.** Union-Find + a walk per group. Performance budget easily met at 500+ pipes.
- **Non-invasive.** `FullPipe` unchanged. Merge logic is additive. Flag-off (no merge result) behavior: every pipe is a singleton, renders as today.
- **Testable.** 13 cases covering all the edge conditions the merge classifier can encounter.

### Negative

- **Fittings still render at merged vertices** (not addressed this phase). When two PEX pipes merge at 45°, the `FittingRenderer` may still emit a fitting at the shared point based on its own heuristics. For PEX this usually produces a small elbow which looks harmless visually, but philosophically shouldn't appear. **Tracked as Phase 7.B.ii:** extend `FittingCatalog` / `FittingMeshes` to consult the bend classifier and suppress fittings at `smooth_bend`/`smooth_curve` vertices on PEX runs.
- **Selection across the run.** If a user click-selects the merged tube (not a specific pipe via PipeHitboxes), the render lights up the whole group — but the underlying `selectedId` is only the lead pipe's id. `PipeInspector` shows only the lead pipe's data. For Phase 7.B this is acceptable; a follow-up can surface "run" as a first-class selection concept.
- **Mutating one pipe in a group rebuilds the whole group's geometry.** Expected behavior, documented in the complexity budget. Geometry construction is O(segments); at 500 pipes / 50 merged groups this is microseconds per change.

### Neutral

- **Colors and materials assume uniformity across the group.** The merge filter guarantees this (same diameter + material + system), so no inconsistency can arise.

## Metrics

| Metric | Target | Actual |
|---|---|---|
| Two PEX pipes at 45° → one group | yes | **yes** ✓ |
| Two PEX pipes at 90° → no merge | yes | **yes** ✓ |
| Two rigid pipes at 45° → no merge | yes | **yes** ✓ |
| Different diameters → no merge | yes | **yes** ✓ |
| Tee (3-way) → no merge | yes | **yes** ✓ |
| Chain of 3 PEX pipes → one group of 3 | yes | **yes** ✓ |
| Closed loop → safe fallback | yes | **yes** ✓ |
| Lead pipe is stable across recomputes | yes | **yes** ✓ |
| TypeScript | 0 errors | **0** ✓ |
| Full test suite | all green | **107/107** ✓ |
| New runtime deps | 0 | **0** ✓ |

## Rollout

- **This commit:** PipeRenderer uses merge on every recompute. No flag — the behavior is strictly additive (singleton rendering is preserved for non-mergeable pipes).
- **Follow-up v0.1.4:** fitting-suppression at `smooth_bend` PEX vertices (Phase 7.B.ii).

## Rollback

- **Dev:** revert the PipeRenderer delta; `mergePexRuns.ts` and its tests remain as inert utilities (still tree-shaken out by Vite if no one imports).

## References

- Source: `src/core/pipe/mergePexRuns.ts`, `src/ui/PipeRenderer.tsx::MergedPexRun`
- Test: `src/core/pipe/__tests__/mergePexRuns.spec.ts`
- Depends on: `src/core/pipe/PexBendClassifier.ts` (bend classification)
- Follow-up (7.B.ii): fitting-suppression logic in `FittingMeshes.tsx`
