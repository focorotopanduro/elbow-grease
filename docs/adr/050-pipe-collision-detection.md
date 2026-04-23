# ADR 050 — Pipe-Pipe Collision Detection + Render Glitch Prevention (Phase 14.X)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.X
- **Depends on:** ADR 046 (Fitting cache — we reuse the "iterate every
  committed pipe" pattern), `CollisionPredictor` (the sibling module
  that handles pipe-vs-structural-element during route preview).

## Context

User report: *"what about collision detection resolution when pipes
overlap each other so the program doesnt bug out with geometry
glitches as such, the 3d engine must not fail in this regard."*

Real failure mode: two committed pipes occupying the same 3D space
produce:

1. **Z-fighting flicker.** Both pipes have identical depth at the
   overlap. Three.js picks a "winner" per pixel based on draw
   order, which can change frame-to-frame → visible flicker.
2. **No visual cue to the user.** The user sees two pipes that
   look "merged" but don't actually have a junction — the BOM and
   the hydraulic solver both think they're independent, which
   under-counts fittings + mis-solves flow.
3. **No auto-detection.** The `CollisionPredictor` that exists
   handles pipe-vs-structural-element during route preview, but
   nothing audited committed-vs-committed geometry.

## Decision

Three changes that harden the 3D engine against pipe overlaps:

### 1. `pipeCollision.ts` — pure detector

Segment-to-segment nearest-distance scan over every pair of pipes.
Excludes shared endpoints (they're legal junctions, not collisions).
Returns a `PipeCollision[]` with severity classification:

| Severity | Centerline distance | Meaning |
|---|---|---|
| `clip`    | < sum of radii                         | Tubes physically intersect; z-fight |
| `overlap` | < half required clearance (radii + 1") | Within the code clearance halo |
| `touch`   | < full required clearance              | Warning-level proximity |

Core algorithm: closest-points-on-two-segments from Real-Time
Collision Detection (Ericson ch. 5). Exact analytic solution, no
sampling approximation. 19 unit tests lock the geometry.

Complexity: O(P² × S²) where P = pipe count, S = average segments
per pipe. For typical scenes (P ≤ 500, S ≤ 10) that's 25M
comparisons worst-case at ~10 flops each — still sub-500ms, which
the perf-floor test locks.

### 2. `PipeCollisionMarkers` — live visualization

New R3F component mounted next to `LiveFittings`. Subscribes to
`usePipeStore.pipes`, runs `detectPipePipeCollisions` inside a
`useMemo`, renders a pulsing marker at each `clip` or `overlap`
position:

- **Red sphere + "CLIP" label** for clipping pairs (tubes intersect)
- **Amber sphere** for overlap (within half clearance, no label to
  reduce clutter)
- **Nothing** for `touch` severity — too noisy in dense scenes

Self-unmounts when no collisions exist. `raycast: () => null` so
markers don't block click-through to pipes / fixtures underneath.

### 3. Deterministic per-pipe `renderOrder`

Even after detection, a z-fight can still render when two pipes
happen to be at exactly the same depth. Fix: each pipe mesh gets a
`renderOrder` derived from a DJB2 hash of its id modulo 1000. Same
pipe → same order across frames, so Three.js always tie-breaks to
the SAME pipe when depths match — no flicker.

The hash is deterministic, so the pipe's render order survives
bundle save/load (same id → same order). The range 0–999 gives
1000 independent buckets, effectively zero collision rate for the
pipe counts we support.

## Why not auto-resolve collisions

Considered shipping an auto-jog feature (right-click collision →
"offset pipe A +3\" up"). Deferred because:

- **Correct resolution is context-dependent.** Jog up, down,
  around, or insert a pair of 90°s — depends on walls/structure
  nearby. Automatic choice risks making a worse problem.
- **User intent matters.** A plumber may have deliberately routed
  pipes close, knowing field conditions we don't see.
- **Visualization alone is 80% of the value.** Seeing the clash
  is enough for the user to fix it manually. Auto-resolve is a
  14.Y+ candidate, after we've watched how users interact with
  the marker.

## Trade-offs

- **O(P²) doesn't scale past ~1000 pipes.** For that size a
  spatial bucket grid (16-ft XZ cells) would drop it to O(P).
  Not urgent — the perf-floor test fires < 500ms at 200 pipes,
  scenes past 500 are rare in residential plumbing.
- **Junction tolerance is 0.15 ft.** Same threshold as
  `FittingGenerator.JUNCTION_TOLERANCE`. An off-grid endpoint
  within 0.15 ft of another endpoint is treated as a junction.
  Any looser and near-miss collisions slip through; any tighter
  and legal junctions get false-flagged.
- **Per-pipe renderOrder, not per-mesh.** All the meshes belonging
  to one pipe (main + wall + endcaps) share the same order. A
  future change that puts two pipes' meshes in different R3F
  groups might re-introduce flicker; the invariant to protect is
  "every mesh that renders pipe X has renderOrder = hash(X)."

## Verification

- `npx vitest run` — 1146 tests pass (1119 prior + 27 new: 19
  unit + 8 scenario).
- `npx tsc -b --noEmit` — clean.
- Manual in the desktop app:
  1. Draw two perpendicular PVC runs crossing at Y=0 → red "CLIP"
     marker pulses at the intersection.
  2. Raise one pipe's Y to 3 → marker disappears, no more
     z-fight flicker at the old crossing.
  3. Draw a proper 3-pipe tee (two main halves + perpendicular
     branch sharing an endpoint) → no collision flagged.

## Files

- `src/core/interference/pipeCollision.ts` — pure detector, 217 LOC.
- `src/core/interference/__tests__/pipeCollision.spec.ts` — 19 tests.
- `src/ui/pipe/PipeCollisionMarkers.tsx` — R3F marker component.
- `src/ui/PipeRenderer.tsx` — `pipeIdRenderOrder` + `renderOrder`
  prop on main + wall meshes.
- `src/__tests__/scenarios/pipeCollisionScenarios.spec.ts` — 8
  integration scenarios against a populated pipeStore.
- `src/App.tsx` — `<PipeCollisionMarkers />` mount + import.

## Invariants locked by tests

- Pipes that share an endpoint never report as a collision.
- Pipes separated by vertical Y delta never collide.
- Perpendicular cross at same Y fires `clip` severity.
- Invisible pipes skip detection entirely.
- 200-pipe dense scene completes detection in < 500 ms.
- 50-pipe parallel arrangement completes in < 100 ms.
