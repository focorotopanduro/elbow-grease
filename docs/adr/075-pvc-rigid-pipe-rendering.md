# ADR 075 — PVC (and Other Rigid Materials) Straight-Segment Rendering (Phase 14.AD.4)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AD.4

## Context

User-reported correctness bug. A 2" PVC pipe committed with a 45°
vertex rendered as:

- A **smoothly curved tube** passing through the vertex
- Plus what visually read as **two detached fitting ghosts** at the
  vertex instead of one angular 45° elbow

PVC is a rigid material. It should render as straight cylindrical
segments joined at the vertex, with the angular void filled by one
elbow fitting (`bend_45` for DWV, `elbow_45` for the copper/CPVC
naming convention). The smoothing is only correct for PEX, which
actually bends in the field.

### Root cause

`PipeRenderer.tsx → FullPipe` constructed its tube geometry via:

```ts
const cp = new THREE.CurvePath<THREE.Vector3>();
for (let i = 1; i < vecs.length; i++) {
  cp.add(new THREE.LineCurve3(vecs[i - 1]!, vecs[i]!));
}
const main = new THREE.TubeGeometry(cp, segs, radius, 12, false);
```

A `CurvePath` of straight `LineCurve3` segments wrapped in one
`TubeGeometry`. Intuitively this should produce a straight tube per
segment — the LineCurve's tangent doesn't change along its length.
But `TubeGeometry` computes its radial cross-section using Frenet
frames sampled along the COMPOUND curve. At the vertex between two
LineCurves, the Frenet frame rotates discontinuously to realign
with the new tangent direction. `TubeGeometry` interpolates this
rotation across the sample points around the vertex, producing
visibly smoothed tube geometry around every bend.

The result: a compound smooth tube that curves around every vertex.
The elbow fitting (correctly emitted by `generateBendFittings` — one
per bend) sits at the vertex position, but because the tube is
smoothly curving through that same region and the torus-arc elbow
geometry doesn't follow the same curve path, its two hub shoulders
stick out of the tube surface, reading as "two weird fittings"
ghosting near the bend.

This was NOT a fitting-generation bug (the generator emits exactly
one `bend_45` per vertex). It was a **pipe rendering bug** upstream.

### Why this didn't manifest for every user

Two mitigating factors:

- **PipeInstanceRenderer** (the "fast" mode — toggled via Q key or
  the toolbar) renders pipes as individual cylinder InstancedMesh
  segments. It's already correct. Users who kept quality on
  default-fast never saw the bug.
- **3D quality mode** routes through `FullPipe`. The user hit this
  path. Default is 3D.

So the bug was visible for default-installation users with rigid
materials. Which is most of the shipping audience.

## Decision

Split the geometry builder into two clearly-named branches and
route per-material:

```ts
if (flexible) {
  // Single TubeGeometry along a Catmull-Rom curve — silky PEX
  return buildFlexibleTube(...);
}
// One TubeGeometry PER SEGMENT, merged into one BufferGeometry —
// rigid pipes meet at crisp angular corners at every vertex.
return buildRigidTubes(...);
```

Per-segment `TubeGeometry(LineCurve3, 1, r, 12, false)` — each
segment is a straight tube with no Frenet smoothing possible (a
single LineCurve3 has only one tangent vector, so there's nothing
to interpolate). Merged into one BufferGeometry via the existing
`mergeGeometries` helper for draw-call efficiency — one main + one
wall mesh per pipe, same as before.

### Why this is correct

- **Geometric:** each segment's cross-section stays perpendicular
  to its own constant tangent. Adjacent segments meet at their
  shared vertex with exact angular alignment. No smoothing anywhere.
- **Fitting fit:** the elbow fitting's torus arc sits at the vertex
  with its inner radius matching the angular void between adjacent
  segments. The hub shoulders align with the pipe axes on either
  side. Visually the three parts (pipe / elbow / pipe) read as one
  continuous piped assembly, which is how real plumbing looks.
- **Performance:** per-segment meshes would add draw calls; merging
  keeps draw count identical to before. Slightly more vertex data
  (12 radial × (n_segments × 2) rings vs 12 × (curve_sampling + 1))
  but negligible for typical scenes.

### Extraction into `buildPipeGeometry` helper

Pulled the useMemo body into a pure function
(`src/ui/pipe/buildPipeGeometry.ts`) so the routing rules are
testable in isolation without a React/R3F harness. 20 regression
tests lock the invariants:

- Rigid materials always take the per-segment path (`isRigid: true`).
- Flexible materials take the smooth path (`isRigid: false`).
- Rigid vertex count is deterministically 26 per segment —
  catches the Catmull-Rom path accidentally running on rigid.
- Flexible vertex count is >> rigid for equivalent point count —
  catches branches being swapped.
- Degenerate (<2 points) returns null.

These are the sharp edges. A future refactor that re-introduces
the single-TubeGeometry-over-compound-curve pattern on rigid trips
`isRigid: true` + vertex-count expectations with a named failure.

## Trade-offs

- **One more small module.** `buildPipeGeometry.ts` adds ~90 LOC
  as a pure helper. Worth the separation for testability.
- **Slightly more vertex memory per rigid pipe.** Two rings per
  segment instead of sampling a smooth curve. For a 5-segment
  pipe: 5 × 26 = 130 vertices per main tube vs ~270 for the
  previous smooth curve. Actually the rigid path is LOWER memory
  in practice — the old path over-sampled with
  `segs = max(4, (n-1)*4)` × 13 radial.
- **`PipeInstanceRenderer` still the right choice for large scenes.**
  For 500+ pipes users should run in fast mode. This fix makes 3D
  mode correct; it doesn't remove the case for instanced rendering
  at scale.
- **Did NOT address pipe-end-to-fitting-hub overlap.** Real plumbing
  has the pipe terminating at the fitting's socket depth from the
  vertex, not at the vertex. The current renderer draws pipe to the
  vertex and lets the elbow's hub overlay the last inch. Visually
  acceptable but not geometrically precise. Fix in a later phase if
  contractors report the visual difference matters (e.g. for
  close-up walkthrough views).
- **No live app-integration test.** Testing React+R3F rendering
  with real THREE geometry requires a heavy harness. The 20 pure
  tests on the extracted helper cover the routing + vertex-count
  invariants.

## Verification

- `npx vitest run` — 1582 tests pass (1562 prior + 20 new).
  Two pre-existing flaky timing tests (`CommandBus` dispatch p95,
  `fittingCachePerf` 2× cheaper) surfaced under heavy full-suite
  load; both pass green in isolation. Unrelated to this change.
- `npx tsc -b --noEmit` — clean.

## Files

- `src/ui/pipe/buildPipeGeometry.ts` — new pure helper.
- `src/ui/PipeRenderer.tsx` — `FullPipe` now delegates to the
  helper; dead `isFlexibleMaterial` import + inline merge removed.
- `src/ui/pipe/__tests__/buildPipeGeometry.spec.ts` — 20 tests.
- `docs/adr/075-pvc-rigid-pipe-rendering.md` — this document.

## What's queued

- **14.AD.5** — pipe-end-to-fitting-hub socket-depth alignment.
  Real PVC assemblies terminate the pipe at the fitting's socket
  depth, not at the vertex. Retract pipe segments by
  `getSocketDepthFt(material, diameter)` at every bend vertex;
  render elbow hubs covering the retraction.
- **14.AD.6** — post-bake measurement on a realistic scene to
  confirm the AD.1–AD.4 wins actually show up in frame-time
  profiles.
