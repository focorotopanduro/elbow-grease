# ADR 081 — Coupling Orientation + Bushing Fitting (Phases 14.AD.11 + 14.AD.12)

- **Status:** Accepted
- **Date:** 2026-04-20
- **Phases:** 14.AD.11 (coupling axis alignment), 14.AD.12 (bushing)

## Context

Two remaining items from the AD backlog, shipped together
because they're both catalog/geometry plumbing rather than new
logic.

### AD.11 — coupling axis alignment

When `generateJunctionFittings` emits a `coupling` for an inline
(< 5° bend) 2-endpoint junction, it was computing orientation
via `bendQuaternion(dirA, travelOut)`. Problem: for an inline
joint, `dirA` and `travelOut` are parallel. `bendQuaternion`'s
cross-product plane normal goes to zero, and the function falls
through to identity `[0, 0, 0, 1]` (line 102 of FittingGenerator.ts).

Identity rotation applied to the coupling geometry (which is
built along local +X via `body.rotateZ(π/2)` in `getCouplingGeo`)
means the coupling always renders along world +X, regardless of
the actual pipe direction. Pipes oriented along Y or Z had
couplings lying perpendicular to them.

### AD.12 — bushing fitting

A **bushing** is a reducing adapter with:
- A **spigot** (male, pipe-OD straight cylinder) on the LARGE side
  — slips INTO an existing fitting's socket
- A **hub** (female, full socket with stop ring) on the SMALL side
  — pipe of the smaller diameter inserts into it

Different from a reducing coupling (two hubs between two pipe
ends). Bushings are the standard way to adapt a fitting outlet
down a size without needing a separate reducer coupling — e.g.,
a 2" tee outlet reduced to 1.5" pipe via a 2"×1.5" bushing that
slips into the tee's 2" socket.

Not in the catalog pre-AD.12. BOM export + IFC export +
geometry dispatch all lacked an entry.

## Decision

### AD.11 — `alignAxisToPipe` helper

New function in `FittingGenerator.ts`:

```ts
function alignAxisToPipe(pipeDir: THREE.Vector3): [x, y, z, w] {
  const target = pipeDir.clone().normalize();
  const fromAxis = new THREE.Vector3(1, 0, 0);  // local +X
  if (target.dot(fromAxis) < -0.9999) {
    return [0, 1, 0, 0]; // antiparallel: clean 180° around +Y
  }
  const quat = new THREE.Quaternion().setFromUnitVectors(fromAxis, target);
  return [quat.x, quat.y, quat.z, quat.w];
}
```

Rotates local +X to the pipe direction. The antiparallel case
(pipe direction is -X) is explicitly handled with a stable
180° Y-axis rotation — `setFromUnitVectors` on exactly opposing
vectors sometimes picks an arbitrary perpendicular axis which
can produce visually unpredictable flipping across renders.

Coupling emission in the 2-endpoint inline branch now calls
`alignAxisToPipe(dirA)` instead of `bendQuaternion(dirA, travelOut)`.

### AD.12 — bushing catalog + geometry

Five catalog surfaces updated:

| File | Entry added |
|---|---|
| `GraphEdge.ts` FITTING_TYPES | `'bushing'` |
| `GraphEdge.ts` FITTING_EQ_LENGTH | friction-loss row |
| `IFCSchema.ts` FITTING_TO_IFC | `'IfcPipeFitting'` |
| `IFCSchema.ts` FITTING_PREDEFINED | `'TRANSITION'` |
| `BOMExporter.ts` FITTING_COSTS | Q1 2025 Ferguson PVC pricing |
| `BOMExporter.ts` LABOR_HR_PER_FITTING | install hours |

Friction loss and labor are slightly below the reducer coupling
equivalents — bushings have one glue joint (the spigot slips
into the host fitting's socket directly, no second joint prep).
Costs are lower because of less material (one hub instead of two).

### `getBushingGeo` geometry

```
[spigot] → [cone] → [hub]  (along +X axis)
   big      transition    small
   OD       small↔big     OD + socket + stop ring
```

Positioned so the spigot end is at local -X (inserts backward
into the host fitting) and the hub end is at local +X. The
fitting's instance quaternion aligns the whole assembly with
the pipe axis at the junction.

Uses the same `getSocketDepthFt` / `getHubOuterRadiusFt` /
`getOuterDiameterFt` helpers as every other fitting so it
participates in the AD.6 dimensional-fidelity pass automatically.

### Dispatch

```ts
case 'bushing':
  geometry = getBushingGeo(mat, diam, sample.diameter2 ?? diam);
  break;
```

Note that `generateJunctionFittings` does NOT yet emit `bushing`.
The emitter for 2-endpoint diameter-mismatch junctions still
uses `reducer` (two hubs between two pipe ends), which is the
correct fitting for that topology. Bushings apply when a pipe
meets an existing fitting's socket at a mismatched diameter —
a more complex scene-level pattern that's future work. For now,
`bushing` is a catalog-complete fitting type available for
explicit user placement + for the BOM + IFC export pipelines,
without changing the auto-emission logic.

## Trade-offs

- **AD.11 `setFromUnitVectors` antiparallel handling.** In real
  plumbing, inline couplings (< 5° bend) never have pipe A and
  pipe B pointing in opposite directions — that's a 180° turn,
  which would be classified as "not inline" upstream. The
  antiparallel guard is defensive against corrupt data /
  synthetic test scenes.
- **AD.12 auto-emission deferred.** Detecting "pipe meeting a
  fitting's outlet at a different diameter" requires scene-
  level knowledge of what fittings exist and what their outlets
  are. That's a bigger change than this phase's scope.
  Meanwhile, the reducer emitter remains for pipe-to-pipe
  diameter mismatches (correct), and bushings are available
  via direct assembly tools or future emitter work.
- **Bushing pricing is catalog-listed but no emitter → no BOM
  line item emitted today.** A bushing appears in a BOM only if
  user-placed via future assembly tools or imported from an
  external CAD bundle. No behavior regression; the table is
  ready for the day the emitter lands.
- **AD.11 helper could be generic.** `alignAxisToPipe` is
  named after its first consumer (coupling). If caps or
  bushings ever need auto-emission with proper orientation,
  they'd reuse the same helper. Renaming to
  `axisAlignQuaternion` would be more accurate but would touch
  the consuming callsite; deferred for now.

## Verification

- `npx vitest run` — 1640 tests pass (1626 prior + 8 new +
  existing AD.10 / fitting generator tests that expanded with
  the bushing type addition but didn't require new bodies).
- `npx tsc -b --noEmit` — clean. Adding `'bushing'` to
  `FITTING_TYPES` forced the TS compiler to surface missing
  entries in `IFCSchema.FITTING_TO_IFC` and
  `FITTING_PREDEFINED` — caught by the exhaustive `Record<…>`
  constraint. That's the guardrail working as intended.

## Files

- `src/ui/pipe/FittingGenerator.ts` — `alignAxisToPipe` helper;
  coupling emission in 2-endpoint branch switched to use it.
- `src/ui/pipe/FittingMeshes.tsx` — `getBushingGeo` new
  function; dispatch switch routes `bushing`.
- `src/engine/graph/GraphEdge.ts` — `'bushing'` added to
  `FITTING_TYPES`; `FITTING_EQ_LENGTH.bushing` row populated.
- `src/engine/export/IFCSchema.ts` — `FITTING_TO_IFC.bushing`
  + `FITTING_PREDEFINED.bushing` entries.
- `src/engine/export/BOMExporter.ts` — `FITTING_COSTS.bushing`
  + `LABOR_HR_PER_FITTING.bushing` rows.
- `src/ui/pipe/__tests__/couplingAndBushing.spec.ts` — 8 new
  tests.
- `docs/adr/081-coupling-orientation-and-bushing.md` — this
  document.

## What's queued

The AD series backlog is now small:

- **AD.13** — visual-diff regression test harness for geometry
  changes. None of the phases after AD.10 have pixel-level
  tests; a future screenshot-diff tool would catch rendering
  regressions that the unit tests miss.
- **AD.14** — consolidate duplicated `JUNCTION_TOLERANCE = 0.1`
  constant (appears in FittingGenerator + PipeRenderer +
  PipeInstanceRenderer).
- **AD.15** — galvanized steel threaded engagement per NPT spec
  (currently a flat 0.9× multiplier).
- **AD.16** — emitter for bushing (pipe meeting fitting-outlet
  at mismatched diameter).
