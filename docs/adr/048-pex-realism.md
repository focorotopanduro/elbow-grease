# ADR 048 — PEX / Uponor Realism Pass (Phase 14.V)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.V
- **Depends on:** 14.U (PEX bend fittings wired in).

## Context

After 14.U shipped bend-fitting emission for PEX, the user asked
three clarifying questions that turned into three separate gaps:

1. **"Does PEX at 90° emit a fitting — is bend_90 the Uponor?"** —
   Yes on behavior, no on visual. `bend_90` is a generic rigid
   torus; at a glance you couldn't tell ProPEX from PVC ell.
2. **"Make it look blue… turn red at the water heater… halfinch
   or threequarter inch"** — PEX supply wasn't rendering with
   its system color (blue/red) because new pipes defaulted to
   `system: 'waste'`. And the default draw diameter was 2" (a
   DWV size) regardless of material.
3. **"Multi-vertex tight arcs"** — a smooth-looking pseudo-arc
   drawn with 10 short segments would pass the per-vertex check
   in 14.U while physically kinking. Needed a leg-length-aware
   bend radius validator.

## Decision

Four sub-changes shipped as Phase 14.V:

### 1. New `pex_elbow_90` fitting type + distinct geometry

Added to `FITTING_TYPES` in `GraphEdge.ts`. Dedicated geometry
in `FittingMeshes.tsx` via `buildPexElbow90`: a shorter-radius
torus (1.5× OD vs. rigid's 1.3×) with **expansion-ring collars**
— wider cylindrical bands outboard of each hub that visually
echo the crimped stainless/brass ProPEX ring.

Priced separately in `BOMExporter.ts`:
- Material: $3.50–$22 per fitting (0.5"–2"), ~4× a PVC ell
- Labor: 0.15–0.50 hr, ~50% slower than PVC 90° (expansion-
  tool cycle)
- Friction equivalent-length in `FITTING_EQ_LENGTH`: slightly
  higher K than rigid bend_90 (step-down bore)

IFC mappings added (`IfcPipeFitting` / `BEND` predefined).

`generatePexBendFittings` now emits `pex_elbow_90` instead of
`bend_90` for PEX — so the BOM, the renderer, and the
fitting-cache all see the right type end-to-end.

### 2. `arcRadiusValidator.ts` — multi-vertex bend integrity

Pure module (16 tests). Computes local bend radius at each
internal vertex using:

```
R ≈ min(leg1, leg2) / 2 / tan(deflection / 2)
```

Catches the case `classifyBend` misses: short segments + moderate
deflection that collectively violate the 6× OD Uponor minimum
bend radius. Emits `ArcViolation` records with
`severity = R/minR` so callers can color-grade (< 0.5 = critical
kink, 0.5–1 = marginal).

Hooked into `generatePexBendFittings` AFTER the per-vertex pass —
vertices already flagged by the classifier are skipped (no
duplicate fitting at the same point).

### 3. PEX defaults = cold supply, 3/4"

Two tiny but visible changes:

- `pipeStore.addPipe` infers `system: 'cold_supply'` for PEX / CPVC
  / copper / copper-M (supply-side materials). Previously all
  pipes defaulted to `'waste'`, making PEX render white via
  the existing `PEX_SYSTEM_COLOR` lookup (which already had the
  correct blue and red entries — they just never fired because
  the system never got set).
- `interactionStore.setDrawMaterial` now re-sizes the draw
  diameter when the material changes:
  - Switching to a supply material with > 1" current → drops to
    0.75" (Uponor AquaPEX main default)
  - Switching back to a DWV material with < 1.5" current →
    bumps to 2"

Net effect: pick PEX from the wheel → diameter snaps to 3/4" →
pipe renders in blue. Exactly the user's spec.

### 4. `pex_elbow_90` BOM / IFC / friction coverage

The `pex_elbow_90` type is added wherever `FittingType` is a
`Record` key: `FITTING_EQ_LENGTH`, `FITTING_TO_IFC`,
`FITTING_PREDEFINED`, `FITTING_COSTS`, `LABOR_HR_PER_FITTING`.
Type exhaustiveness check in the existing BOM data-coverage spec
locks this.

## Trade-offs

- **No hot_supply auto-classification yet.** Blue for cold works
  because that's the default. Red-for-hot requires a water
  heater fixture that propagates `hot_supply` downstream to
  connected pipes — that's a full feature (see Phase 14.W plan
  below) and sits one phase ahead.
- **PEX-A vs PEX-B still one material.** Uponor AquaPEX is PEX-A;
  PEX-B (e.g. Viega MANABLOC) has different bend radius (10× OD
  cold). For now one material with PEX-A spec. Splitting is a
  MATERIAL_REGISTRY pass.
- **`pex_elbow_90` uses the generic material for color.** Ghost
  render in `LiveFittings` uses the `ghostMat` amber tint; real
  committed elbows use `getPipeMaterial(material, system)` which
  returns the blue PEX_SYSTEM_COLOR for cold_supply. Could tune
  the elbow to a slightly darker / brass-tinted variant later.

## Verification

- `npx vitest run` — 1095 tests pass (1073 prior + 22 new
  across `arcRadiusValidator.spec.ts` and FittingGenerator
  updates for the new type).
- `npx tsc -b --noEmit` — clean (including the IFC schema
  Record exhaustiveness guards).
- Manual in the desktop app:
  1. Pick PEX → diameter auto-drops to 3/4". Draw a right-angle
     run → pipe renders **blue**; ghost elbow + committed elbow
     show the distinctive collared ProPEX visual.
  2. Pick PVC → diameter bumps back to 2" (DWV default).
  3. Draw a 3-vertex pseudo-arc with short segments (e.g. 0.3 ft
     legs each at 45°) → `arcRadiusValidator` flags them red
     with the Uponor minimum-bend-radius warning.

## Files

- `src/engine/graph/GraphEdge.ts` — `pex_elbow_90` added to
  `FITTING_TYPES` + friction table.
- `src/engine/export/BOMExporter.ts` — cost + labor rows.
- `src/engine/export/IFCSchema.ts` — IFC + predefined rows.
- `src/ui/pipe/FittingGenerator.ts` — `generatePexBendFittings`
  emits the new type; arc-validator integration loop.
- `src/ui/pipe/FittingMeshes.tsx` — `getPexElbow90Geo` +
  `buildPexElbow90` + dispatch case.
- `src/ui/pipe/LiveFittings.tsx` — geometry dispatch + labels
  ("ProPEX 90°", "ProPEX tee").
- `src/core/pipe/arcRadiusValidator.ts` — pure module + public
  API (16 tests in `__tests__`).
- `src/store/pipeStore.ts` — `addPipe` supply-vs-DWV default
  system + `isSupplyDefaultMaterial` helper.
- `src/store/interactionStore.ts` — `setDrawMaterial` re-sizes
  the draw diameter per material family.

## Plan for Phase 14.W (next)

User ask: *"a feature that allows you to auto-route a fixture's
connections when prompted… HD and really accurate to look like"*
and *"route the water heater's water design in a way that looks
really realistic"*.

Proposed scope for 14.W, to be designed separately:

- Fixture subtype registry carries connection points (cold, hot,
  drain, vent) with local-space positions.
- Add `water_heater` to `FixtureSubtype` union (currently only
  in the UI wheel, not the data model).
- `autoRouteFixture(fixtureId)` action:
  - Finds the nearest supply main / water-heater outlet for each
    required connection.
  - Generates PEX (cold + hot) home-runs with appropriate bends.
  - Generates DWV trap + vent stub.
  - Commits the new pipes via the normal `addPipe` path (so cache,
    compliance, BOM, all see them the same as hand-drawn).
- Hot-supply propagation: when a PEX pipe's endpoint sits at a
  water heater's hot outlet, classify it + everything downstream
  as `hot_supply` (red).
- UI entry point: right-click a fixture → "Auto-route
  connections"; also exposed via Ctrl+R when a fixture is selected.

14.W is the next iteration.
