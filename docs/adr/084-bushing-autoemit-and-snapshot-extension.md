# ADR 084 — Bushing Auto-Emitter + Fast-Mode & Material Snapshots (Phases 14.AD.16–18)

- **Status:** Accepted
- **Date:** 2026-04-20
- **Phases:** 14.AD.16, 14.AD.17, 14.AD.18
- **Follows:** ADR 082 (AD.13 snapshot harness), ADR 083 (AD.14+15)

## Context

Three items from the AD backlog, shipped together because each
was small on its own and they all extend the regression-harness
contract built in AD.13:

### AD.16 — Mismatched-diameter tee junction had no bushing

`FittingGenerator.generateJunctionFittings` emits exactly one
fitting per detected junction. At a 3-pipe junction where the
branch is smaller than the main run (e.g. 2" × 2" × 1"), the
emitter pushed a `tee` sized to the main and stopped. Result:
the renderer drew a 2" tee outlet directly abutting a 1" pipe
body with no visible transition — the pipe appeared to enter
the hub at the wrong diameter. Real installs insert a reducing
bushing (threaded hub + tapered spigot) between the tee outlet
and the small pipe.

There was also a latent bug adjacent to this: when the `(i, j)`
pair itself had mismatched diameters AND a third pipe met at
the same point, the `isReducer` branch fired first, emitting a
lone `reducer` fitting instead of a `tee` — swallowing the
multi-pipe junction classification entirely. Pre-AD.16 this was
rare enough to go unnoticed; AD.16 surfaced it.

### AD.17 — Fast-mode render path had no dimensional lock

ADR 082 (AD.13) locked the 3D-mode render path via BufferGeometry
hashes for every canonical pipe + fitting shape. The fast-mode
path (`PipeInstanceRenderer` → `SegmentExtractCache` →
InstancedMesh) never builds BufferGeometry — instead it produces
`SegmentInstance[]` records that the shader consumes
per-instance. A drift in `buildPipeEntry`'s retraction math
(AD.8's junction-hint branch) would flip the fast-mode visual
without tripping any AD.13 snapshot.

### AD.18 — Material property drift had no regression net

Material definitions (`PipeMaterial.ts` — metalness, roughness,
color blends, emissive, polygon offset) are where "the pipe
looks wrong" most often originates AFTER geometry is correct.
None of the existing snapshot suites touch the material
factory.

The backlog line for AD.18 was "optional pixel-diff layer for
shader/material regression." A true pixel-diff layer would
need headless-gl or a puppeteer-driven screenshot pipeline —
substantial dependency surface for a small class of
regressions. Scoped down to **structured property
fingerprints**: capture every field of `MeshStandardMaterial`
that affects the rendered output, quantize + hash. This catches
~95% of real regressions (someone changes `metalness: 0.8` to
`0.5`, the snapshot fires) without any new runtime dependency.
Pure shader-program regressions still fall through this net;
if one hits, we can add a targeted pixel-diff layer then.

## Decision

### AD.16 — Bushing auto-emitter in `generateJunctionFittings`

In the 3+ endpoint else-branch of the junction loop, after the
tee is pushed:

```ts
for (const branchPipe of allPipes) {
  if (branchPipe.id === bigger.id) continue;
  if (branchPipe.material !== bigger.material) continue;
  if (branchPipe.diameter >= bigger.diameter - 0.1) continue;
  // ...find the pipe's outbound direction at ptB
  const pos = ptB + branchDir * (odBigger * 1.4); // one port-offset
  fittings.push({
    type: 'bushing',
    position: pos,
    quaternion: alignAxisToPipe(branchDir),
    diameter: bigger.diameter,        // spigot side (main)
    diameter2: branchPipe.diameter,   // hub side (branch)
    material,
    pipeId: branchPipe.id,
  });
}
```

Guards:

| Guard | Rationale |
|---|---|
| Same material | Material mismatch = transition fitting (e.g. dielectric union), not a bushing — different SKU, different geometry. Refuse to bridge that gap automatically. |
| Diameter delta > 0.1" | Matches the existing reducer-vs-tee discriminator. Noise-level mismatches don't get a SKU. |
| Endpoint match | Only pipes that physically terminate at the junction need a reduction. Pipes passing through don't branch off here. |
| 3+ endpoints only | 2-pipe endpoint-to-endpoint with mismatch = reducer coupling. 4-way = cross (reducing-cross not modeled). Bushings only make sense at a tee-class junction. |

The pre-existing `isReducer` condition was simultaneously
tightened to require `endpointCount === 2` so it no longer
steals the tee + bushing path at 3-pipe mismatched junctions.

### AD.17 — SegmentInstance snapshots for fast-mode path

New module `segmentInstanceHash` (actually added as new
functions in `geometryHash.ts` — same FNV-1a primitive):

- `hashSegmentInstances(segments) → 16-hex`: every
  per-instance field (pipeId, start, end, diameter, material,
  opacity, colorOverride) quantized + FNV-1a hashed in order.
- `fingerprintSegmentInstances(segments)`: human-readable
  dimensional summary (segment count, total length, AABB
  spans, distinct diameters/materials, ghosted flag).

New spec `segmentInstanceSnapshot.spec.ts` covers:

- Straight pipes with/without junction-hint retraction
- Multi-segment L-bends and U-bends (internal-vertex retraction)
- Every material type
- PEX's flexible-no-retract contract
- Diameter ladder (0.5" → 6")
- Floor ghosting (opacity + colorOverride)
- Gated-out pipes (null entry)

28 tests, 50 snapshots. Together with AD.13's pipe + fitting
snapshots, every visible rendering path now has a dimensional
regression net.

### AD.18 — Material property fingerprints

Added to `geometryHash.ts`:

- `fingerprintMaterial(mat)`: 13 structured fields — color,
  emissive, metalness, roughness, emissiveIntensity, opacity,
  transparent, side, depthWrite, polygonOffset +
  factor/units, toneMapped.
- `hashMaterial(mat)`: FNV-1a of the fingerprint.

Uses a `MaterialLike` interface so the module stays free of a
hard `three` type-dependency.

New spec `materialSnapshot.spec.ts`:

- Main material per pipe type × default system
- PEX × every system (color changes by system)
- Plastic diameter-tint ladder (0.5" → 6")
- Selected (highlight) variant per type
- Wall-shell (rim) per diameter
- Preview (live draw) material
- Sanity checks: cache hit identity, diameter differentiation,
  material differentiation, PEX hot vs cold.

45 tests, 82 snapshots.

## What each fix delivers

| Concern | Before | After |
|---|---|---|
| 3-pipe junction with small branch | Tee only; pipe appears to enter oversized hub | Tee + auto-emitted bushing at the branch outlet |
| Mismatched-diameter 3-pipe junction | Reducer swallows the tee classification | Proper tee + bushing |
| Fast-mode render regression net | None | 28 snapshot tests, 50 fingerprints+hashes |
| Material property regression net | None | 45 snapshot tests, 82 fingerprints+hashes |

## Trade-offs

- **Bushing auto-emit is same-material only.** Transition
  fittings (e.g. copper-to-PVC) are a separate SKU class with
  different geometry (dielectric union). Refusing to bridge
  material gaps automatically is the safe default — a user
  drawing across a material boundary needs to think about
  dielectric isolation, and silently emitting a "bushing" that
  isn't the right part is worse than emitting nothing.

- **4-way cross with mismatched diameter still emits plain
  cross.** Reducing-cross is a rare SKU and the geometry
  needs different hub sizing per outlet. Deferred until a
  real install surfaces it. Guarded by an explicit check in
  AD.16 tests.

- **AD.18 fingerprint catches structured drift only.** A
  custom `ShaderMaterial` with a bugged fragment shader would
  pass (since we only read standard `MeshStandardMaterial`
  fields). That class of regression is out of scope here;
  `PipeMaterial.ts` only uses `MeshStandardMaterial`, so the
  coverage matches the actual attack surface.

- **No auto-migration of prior committed pipes through AD.16.**
  Existing scenes saved before this phase reload into a graph
  that now auto-emits bushings at qualifying junctions. That
  changes BOM output on replay. Considered acceptable: the
  saved scene now reflects a more physically-correct
  materials list.

## Snapshot regeneration

AD.16's changes to `generateJunctionFittings` emit additional
fittings at some junction clusters but do NOT change the
geometry of any existing fitting. Fitting snapshots
(AD.13.c) are keyed per-fitting-type-and-dimension, so the
bushing geometry was already locked in ADR 081 (AD.12). **Zero
snapshots regenerated for AD.16, AD.17, AD.18.**

## Verification

- `npx vitest run src/ui/pipe` — 446 tests pass (all previous
  + 9 AD.16 emitter tests + 28 AD.17 snapshot tests + 45 AD.18
  material tests).
- `npx tsc -b --noEmit` — clean.
- No snapshot-file mutations beyond the 50 + 82 newly written
  baselines for AD.17 + AD.18.

## Files

- `src/ui/pipe/FittingGenerator.ts` — AD.16 bushing emission
  in the 3+ endpoint else-branch; `isReducer` tightened to
  require `endpointCount === 2`.
- `src/ui/pipe/geometryHash.ts` — adds
  `hashSegmentInstances`, `fingerprintSegmentInstances`,
  `hashMaterial`, `fingerprintMaterial`.
- `src/ui/pipe/__tests__/couplingAndBushing.spec.ts` — 9
  new AD.16 tests.
- `src/ui/pipe/perf/__tests__/segmentInstanceSnapshot.spec.ts`
  — new; 28 tests, 50 AD.17 snapshots.
- `src/ui/pipe/perf/__tests__/__snapshots__/segmentInstanceSnapshot.spec.ts.snap`
  — new.
- `src/ui/pipe/__tests__/materialSnapshot.spec.ts` — new; 45
  tests, 82 AD.18 snapshots.
- `src/ui/pipe/__tests__/__snapshots__/materialSnapshot.spec.ts.snap`
  — new.
- `docs/adr/084-bushing-autoemit-and-snapshot-extension.md` —
  this document.

## What's queued

- **AD.19** — reducing-cross geometry (deferred trade-off from
  AD.16).
- **AD.20** — transition fittings (dielectric union, PVC-
  copper adapter) as a first-class type with its own
  auto-emitter at material boundaries.
- **AD.21** — shader-program pixel-diff layer iff a real
  shader regression surfaces that AD.18's structured
  fingerprint misses.
