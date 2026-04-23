# ADR 082 — Geometry Snapshot Harness (Phase 14.AD.13)

- **Status:** Accepted
- **Date:** 2026-04-20
- **Phase:** 14.AD.13 (fractalized into sub-phases a–e)

## Context

The AD series (AD.4 → AD.12) shipped ~50 code changes touching
pipe + fitting geometry. Every change was verified by hand-
crafted correctness tests (e.g. "vertex count = N", "type is
bend_45, not tee"), but none of those tests lock the _shape of
the output BufferGeometry_ as a whole. A hypothetical future
regression where a geometry builder emits the right vertex count
but in a shifted position, or with rotated normals, would slip
past every existing assertion.

Classic solution: visual-diff regression tests. Render the scene,
screenshot, compare against a stored baseline. Problem: headless
WebGL rendering is expensive, flaky across driver/GPU
differences, and jsdom doesn't expose a real WebGL context to
begin with.

Alternative that's simpler and more targeted: hash the
BufferGeometry output deterministically, snapshot the hash,
and let vitest's built-in snapshot facility handle storage +
diff. You lose the "does it LOOK right" check at the pixel
level, but you gain the "has this geometry changed" check with
zero flakiness.

## Decision

Fractalized into 5 sub-phases, each a self-contained layer:

### AD.13.a — `hashBufferGeometry` primitive

`src/ui/pipe/geometryHash.ts` exports:

```ts
hashBufferGeometry(geo: THREE.BufferGeometry): string  // 16 hex chars
fingerprintBufferGeometry(geo): DimensionalFingerprint
```

Implementation details pinned by 19 unit tests in
`geometryHash.spec.ts`:

- **Deterministic:** same input → same hash, across 100
  iterations + across fresh allocations of identical shapes.
- **Quantized to 1 µft (6 decimal places):** float drift below
  that threshold is swallowed (benign rebuild noise vs.
  meaningful geometric change).
- **Signed-zero safe:** +0 and -0 hash identically.
- **NaN/Infinity defensive:** treated as 0 so corrupted input
  doesn't propagate random hashes.
- **Attribute-presence sensitive:** geometry with vs. without
  normals produces different hashes; indexed vs. non-indexed
  produces different hashes.
- **Position- + rotation-sensitive:** same shape translated or
  rotated produces a different hash.

The hash function is a 64-bit FNV-1a implemented directly
(split into two 32-bit lanes) — no Web Crypto dependency, no
Promise contamination, runs synchronously in any JS runtime.

### AD.13.b — Pipe geometry snapshots

`pipeGeometrySnapshot.spec.ts` covers a matrix of pipe inputs:

- **Materials:** all 8 rigid materials + 1 flexible (PEX). Each
  exercises a distinct rendering path (rigid per-segment merge
  vs. smooth Catmull-Rom).
- **Diameters:** 0.75", 2", 4" — covers the spec's small /
  medium / large bands which have different hub multipliers.
- **Shapes:** straight, 45° bend, 90° bend, multi-bend, very-
  short. Last catches the degenerate segment guard in AD.6.
- **Retraction flags:** for rigid, all 4 combos of
  (retractStart, retractEnd). For flexible, a regression guard
  asserts flags are IGNORED.

Total: **150 tests, 147 snapshots**. Runs in ~250ms.

### AD.13.c — Fitting geometry snapshots

`fittingGeometrySnapshot.spec.ts` covers every `FittingType` in
the catalog:

- **General matrix:** 16 types × 3 materials × 3 diameters = 144
  snapshots.
- **Reducer pairs:** 3 diameter transitions × 2 materials = 6.
- **Bushing pairs** (AD.12): 3 diameter transitions.
- **PEX-specific:** `pex_elbow_90` × 3 diameters.
- **Manifolds:** 4 port counts × 1 diameter.
- **Cast iron spot check:** 5 types × 2 diameters — dramatic hub
  oversize worth isolating.
- **Unknown-type fallback:** asserts it routes to elbow_90.
- **Coverage contract:** iterates the entire `FITTING_TYPES`
  tuple, hashes each, and asserts no type (except elbow_90
  synonyms) collides with the elbow_90 fallback. Catches the
  case where a new type is added to the catalog but no dispatch
  case is wired.

Total: **172 tests, 170 snapshots**. Runs in ~700ms.

New export: `getFittingGeometryByType(type, material, diameter, diameter2?)`
in `FittingMeshes.tsx` — single dispatcher mirroring the switch
inside `buildGroups`. Without this, each internal geometry builder
would need its own export just for testability.

### AD.13.d — Dimensional fingerprint (orthogonal check)

Already integrated into AD.13.b/c: every snapshot stores both
`hash` (vertex content) AND `dim` (AABB span + volume + vertex/
index count). Two snapshots that differ only in `hash` but not
`dim` represent a topology change with zero visual impact (e.g.
vertex reorder, normal recomputation, merge order) — useful
diagnostic information in the snapshot diff, surfacing
intentional refactors as distinct from dimensional changes.

### AD.13.e — Update workflow

When an intentional geometry change lands:

```sh
npx vitest run src/ui/pipe/__tests__/pipeGeometrySnapshot.spec.ts -u
npx vitest run src/ui/pipe/__tests__/fittingGeometrySnapshot.spec.ts -u
```

This regenerates the `.snap` files. Review the diff as part of
the commit. If a snapshot changed that you didn't intend to
touch, that's the whole point — investigate before committing.

`vitest -u` is the standard flag; no custom tooling needed.

## What this harness catches vs. misses

**Catches:**
- Any vertex moving more than 1 µft (0.0003 mm)
- Any vertex added or removed
- Any normal recomputation that flips direction
- Any topology change (indexed vs non-indexed, different index
  order at the same position set)
- Any dispatch-routing change (e.g. a new FittingType aliased to
  the wrong builder)
- Any cascade impact: a change to `PipeStandards` socket depth
  flips every fitting snapshot that uses socket depth, immediately
  showing the blast radius.

**Misses:**
- Shader / material changes (we hash geometry, not materials)
- Runtime rotation applied via instance matrix (the geometry is
  built in local space; the instance quaternion is tested
  separately by `junctionElbow.spec.ts` etc.)
- GPU-driver-specific AA or z-fighting
- Lighting / environment map effects

These are real but well out of scope for a geometry harness. A
future AD.13.f / AD.14 could layer pixel-diff tests on top using
a headless WebGL context for scenes where the miss categories
matter (e.g. Uponor crimp-ring visual appearance on PEX
elbows).

## Trade-offs

- **Snapshot file size.** 317 snapshots stored as JSON in two
  `.snap` files. Each is ~100 bytes (hash string + small object
  literal). Total committed bytes: ~40 KB. Negligible.
- **Deterministic THREE.js.** THREE's `CylinderGeometry`,
  `TorusGeometry`, etc. are deterministic given identical input
  params. No random jitter, no tessellation randomization. If a
  future THREE major version changes internal vertex ordering
  (unlikely — they maintain that as stable for save/load
  compatibility), every snapshot re-generates. We accept that
  cost since THREE major upgrades are already a manual review.
- **Doesn't exercise the instance-matrix path.** Fittings are
  rendered via `InstancedMesh` with per-instance transforms.
  The harness tests the local-space geometry; instance-matrix
  correctness is tested separately via `junctionElbow.spec.ts`
  and similar quaternion-assertion tests.
- **Coverage contract caveat.** The "every FittingType has a
  dispatch" guard in `fittingGeometrySnapshot.spec.ts` only
  covers types buildable at diameter=2. A type that only exists
  at specific diameters (e.g. hypothetical 6"-only fitting)
  would need its own case. Not an issue today; documented for
  the future.

## Verification

- `npx vitest run` — 1981 tests pass (1640 prior + 341 new:
  19 hash-primitive + 150 pipe snapshots + 172 fitting
  snapshots).
- `npx tsc -b --noEmit` — clean.
- Re-ran each snapshot spec twice back-to-back — every snapshot
  holds stable. Determinism verified.

## Files

- `src/ui/pipe/geometryHash.ts` — 188 LOC. Pure primitive.
- `src/ui/pipe/__tests__/geometryHash.spec.ts` — 19 tests.
- `src/ui/pipe/__tests__/pipeGeometrySnapshot.spec.ts` — 150
  tests, accompanying auto-generated
  `__snapshots__/pipeGeometrySnapshot.spec.ts.snap`.
- `src/ui/pipe/__tests__/fittingGeometrySnapshot.spec.ts` — 172
  tests, accompanying auto-generated
  `__snapshots__/fittingGeometrySnapshot.spec.ts.snap`.
- `src/ui/pipe/FittingMeshes.tsx` — new `getFittingGeometryByType`
  exported dispatcher. Internal geometry builders unchanged;
  `buildGroups` still uses its own switch (not refactored to
  call the new dispatcher — would add a function call per
  fitting per render without gain).
- `docs/adr/082-geometry-snapshot-harness.md` — this document.

## What's queued

- **AD.14** — consolidate duplicated `JUNCTION_TOLERANCE = 0.1`
  constant across FittingGenerator + PipeRenderer +
  PipeInstanceRenderer.
- **AD.15** — galvanized steel threaded engagement per NPT spec.
- **AD.16** — bushing auto-emitter when pipe meets fitting-outlet
  at mismatched diameter.
- **AD.17** — dimensional snapshots for `buildPipeEntry` output
  in `segmentExtractCache.ts` (fast-mode rendering equivalent to
  the AD.13.b coverage in 3D mode).
- **AD.18** — optional pixel-diff layer for shader/material
  regression catching.
