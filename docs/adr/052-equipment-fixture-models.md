# ADR 052 — Equipment Fixture 3D Models + Wheel Entries (Phase 14.Y.2)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.Y.2 (of four in 14.Y rollout)
- **Depends on:** ADR 051 (14.Y.1 registry foundation).

## Context

14.Y.1 added 9 new `FixtureSubtype` values with dimensional specs,
connection points, and demand tables — but no 3D geometry and no UI
entry point. Users couldn't actually place them.

14.Y.2 closes that gap: every new subtype now renders as a dedicated
3D mesh and appears in the fixture wheel.

## Decision

Nine new `ModelFC` components in `FixtureModels.tsx`, registered
through the existing `MODEL_MAP` dispatcher. Each is **≤ 12 meshes**
with shared materials, matching the user's constraint *"keep it
light on the system as we plan to scale."*

### Per-model design

| Subtype | Mesh count | Key identifying detail |
|---|---|---|
| `WaterHeaterModel` | 7 | Tall insulated cylinder, T&P horn on upper side, drain spigot at base, energy-specific top — **flue collar** (gas) vs **element cover** (electric) |
| `TanklessWaterHeaterModel` | 6 | Slim wall-mount box, faceplate + vent grille, cold/hot/gas stubs on bottom (gas stub is yellow to distinguish) |
| `BidetModel` | 5 | Porcelain base + oval bowl with dark cavity, rear faucet stem + spout |
| `LaundryTubModel` | 5 | Fiberglass-blue rectangular body, deep basin inset, rear faucet + spout |
| `UtilitySinkModel` | 5 | Heavier steel-gray commercial version with hose-bib supply instead of consumer faucet |
| `ExpansionTankModel` | 3 | Small Amtrol-blue cylinder with hemispherical top dome + inline connection |
| `BackflowPreventerModel` | 6 | Brass body + two test cocks on top + downward relief port + flanged inlet/outlet |
| `PressureReducingValveModel` | 4 | Brass body + adjusting bell cap + threaded nipples |
| `CleanoutAccessModel` | 3 | Orange DWV-PVC coupling + dark plug + hex head |

**Material palette** (shared across models for performance):

- `brassMaterial()` — `#c8a46a` metalness 0.85, used for valve
  bodies, stubs, test cocks, faucet spouts
- `steelMaterial(tint)` — `#e5eaf0` default, metalness 0.6, for
  caps + hardware
- Fixture porcelain / jacket colors match the real product
  families: Amtrol blue `#2a6fd6`, A.O. Smith jacket
  `#e8e1d0`, slop-sink gray `#6a7a8c`

### Water heater variant behavior

`WaterHeaterModel` reads two params: `capacityGal` and `energy`.

- **Capacity → footprint**: 40 gal → 20" × 58", 50 gal → 22" × 60",
  75 gal → 24" × 72". Matches real A.O. Smith / Rheem residential
  spec table. (Same calculation as in `waterHeaterGeometry` —
  14.Y.1 registry and 14.Y.2 model stay in sync.)
- **Energy → top detail**: `'gas'` shows a flue collar, `'electric'`
  shows an element-access cover on the side. Visual shorthand
  sufficient for schematic identification.

### FixtureWheel updates

`FixtureWheel.tsx` previously had a `water_heater` sector whose
subtypes were stubbed with `water_closet` (placeholder because the
real subtypes didn't exist yet). 14.Y.2 replaces those with real
subtypes + adds a new `valves` sector:

- **WH sector**: Tank 50gal, Tankless, Expansion Tank
- **Valves sector** (new): Backflow, PRV
- **Laundry sector**: adds Laundry Tub + Utility Sink alongside Standpipe
- **Misc sector**: adds Cleanout Access + Bidet

Users can now pick any of the 9 new subtypes through the normal
drop flow (Ctrl+F → pick → click canvas to place).

## Trade-offs

- **Mesh count per model** is constrained to keep total scene
  geometry manageable. A 100-fixture job adds ~500 extra meshes;
  each is shaded with a shared material so the draw-call count
  is bounded. If a future pass wants more realistic details
  (Uponor logo on the heater, model numbers on the valves), it
  can swap in per-material textures without changing the
  component tree.
- **No LOD yet.** At far camera zoom, the small valves look like
  fuzzy blobs. Acceptable for now — if perf bites on mega-scale
  scenes, we add a camera-distance-based simplification later.
- **Water heater geometry matches the registry but doesn't
  react to ALL params**: `expansionTank` toggle on the schema
  doesn't yet render a mini expansion tank on top of the heater
  (that would require composite positioning). Follow-up work if
  users ask.

## Verification

- `npx vitest run` — 1177 tests pass (1171 prior + 6 new in
  `newFixtureModels.spec.ts`).
- `npx tsc -b --noEmit` — clean.
- Manual in the desktop app:
  1. Ctrl+F → WH sector → Tank 50gal → click canvas → tall
     cylindrical tank appears with a flue collar on top.
  2. Ctrl+F → WH sector → Tankless → click → wall-mount slim
     rectangle with yellow gas stub.
  3. Ctrl+F → Valves → Backflow → click → brass RPZ body with
     relief port.
  4. Ctrl+F → Misc → Bidet → click → oval porcelain bowl with
     rear faucet.

## Files

- `src/ui/fixtures/FixtureModels.tsx` — 9 new model components,
  2 shared material helpers, MODEL_MAP expanded.
- `src/ui/radial/wheels/FixtureWheel.tsx` — WH sector fixed (real
  subtypes), Valves sector added, Laundry + Misc sectors expanded.
- `src/ui/fixtures/__tests__/newFixtureModels.spec.ts` — 6 tests.
- `docs/adr/052-equipment-fixture-models.md` — this document.

## What's queued

- **14.Y.3** — `autoRouteFixture(fixtureId)` pathfinder that
  consumes these connection points + the pipe network to
  generate home-runs automatically. Now that both the data and
  the visuals exist, the pathfinder has everything it needs to
  produce meaningful routes.
- **14.Y.4** — Hot-supply propagation downstream of water heater
  hot outlet.
