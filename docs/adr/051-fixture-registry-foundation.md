# ADR 051 — Fixture Registry Foundation (Phase 14.Y.1)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.Y.1 (of the four-part 14.Y fixture-auto-route rollout)
- **Depends on:** existing `ConnectionPoints.ts`, `FixtureParams.ts`,
  `FixtureFlowProfile.ts`, `GraphNode.ts` tables.

## The 14.Y roadmap

User ask: *"auto-route a fixture's connections when prompted… HD
and really accurate… include the fixtures that are missing, like
the water heater… miniatures as accurate as possible to industry
standards… keep it light on the system… the most accurate fixture
and plumbing sim in the market."*

Single phase is too much to ship safely. The 14.Y rollout is
split into four focused sub-phases:

| Sub | Scope | Ships |
|---|---|---|
| **14.Y.1** | Fixture subtype registry, connection points for every subtype, DFU/WSFU/flow profiles for new subtypes, param schemas. Foundation everything else depends on. | **This ADR** |
| 14.Y.2  | 3D geometries for the new subtypes (water heater tank cylinder, tankless rectangle, bidet bowl, etc.) | Next iteration |
| 14.Y.3  | `autoRouteFixture(fixtureId)` pure pathfinder + UI entry point (right-click menu + Ctrl+R). | After 14.Y.2 |
| 14.Y.4  | Hot-supply propagation from water heater outlet + red/blue dominion rendering. | Last |

Sub-phase boundaries chosen so each one leaves the app in a
testable, shippable state.

## 14.Y.1 — what shipped

### Nine new `FixtureSubtype` values

Added to `FixtureSubtype` in `GraphNode.ts`:

| Subtype | Industry standard | Representative dims |
|---|---|---|
| `water_heater` | ASME / A.O. Smith / Rheem 40/50/75 gal | 22" × 60" tank (50 gal default) |
| `tankless_water_heater` | Rheem RTGH-95 / Rinnai RU199iN | 18"W × 26"H × 10"D wall mount |
| `bidet` | ASME A112.19.2 floor-mount | 24"W × 14"D × 15"H |
| `laundry_tub` | Common fiberglass single-comp | 24"W × 20"D × 34"H |
| `utility_sink` | Commercial slop sink | 36"W × 24"D × 36"H |
| `expansion_tank` | 2-gal residential pressure vessel | 8" ∅ × 11"H |
| `backflow_preventer` | Watts 009 RPZ | 12"L × 4"D × 6"H inline |
| `pressure_reducing_valve` | Watts N45B | 6"L × 3"D × 4"H inline |
| `cleanout_access` | 4" DWV accessible cleanout | 6"L × 4" ∅ |

All dimensions sourced from manufacturer cut sheets + ASME A112
tables. Stored in `ConnectionPoints.ts` as per-subtype geometry
computers (`waterHeaterGeometry`, `tanklessWaterHeaterGeometry`,
`bidetGeometry`, etc.).

### Connection points

Each new fixture carries typed `ConnectionPoint` records in
LOCAL (pre-rotation) coords:

- **Water heater**: `cold` inlet, `hot` outlet, `overflow` (T&P
  relief), `drain` (service spigot at base).
- **Tankless**: `cold` in, `hot` out, `gas` stub, `overflow` (T&P).
- **Bidet**: `drain`, `cold`, `hot`.
- **Laundry tub / Utility sink**: `drain`, `cold`, `hot`.
- **Expansion tank**: single `inline` port.
- **Backflow preventer**: `in` + `out` + `relief`.
- **Pressure-reducing valve**: `in` + `out`.
- **Cleanout access**: `in` + `out` + `plug`.

These are the anchors the 14.Y.3 auto-router will target.

### DFU / SUPPLY / FLOW tables extended

`DFU_TABLE`, `SUPPLY_TABLE` (both in `GraphNode.ts`), and
`FLOW_PROFILES` (in `FixtureFlowProfile.ts`) all gained entries
for every new subtype. Key decisions:

- **Water heater DFU = 0.** It's a supply appliance, not a
  drainage fixture — its own T&P relief feeds a floor drain, but
  that's modeled separately. The inlet WSFU is 3 for a 50-gal
  tank (sized for recovery), 8 for tankless (sized for peak
  simultaneous demand).
- **Tankless inlet = 3/4"**, same as tank-style — required for the
  higher peak flow.
- **Inline devices** (expansion tank, backflow, PRV, cleanout)
  report 0 WSFU + 0 flow. They're carriers, not loads.
- **Bidet / laundry tub / utility sink** get real WSFU + DFU
  values matching the existing per-fixture patterns.

### Param schemas

`PARAM_SCHEMA` now has 22 entries (13 original + 9 new). The
water heater gets a real schema with `capacityGal`, `energy`
(gas / electric), and `expansionTank` toggle; the others use a
minimal placement-only schema that 14.Y.2 will fill out when it
adds the 3D geometry + params to edit.

## What's deliberately NOT in 14.Y.1

- **3D geometry** (building the tanks / inline bodies in Three
  meshes) — 14.Y.2.
- **Auto-route command** (`autoRouteFixture(id)`) — 14.Y.3.
- **Hot-supply propagation** (red pipes downstream of water heater
  hot outlet) — 14.Y.4.
- **Fixture wheel / placement UI** — users can't actually PLACE
  these fixtures through the UI yet. They exist in the data model
  and all supporting tables, waiting for 14.Y.2's geometry + wheel
  entries.

## Trade-offs

- **MINIMAL_PLACEMENT_ONLY schema** for 8 of the 9 new fixtures.
  Reasonable placeholder; 14.Y.2 will add per-fixture param
  sections (bidet spray config, inline valve orientation,
  cleanout direction, etc.).
- **Emoji icons** for the new fixtures are imprecise (🔥 for
  water heater, ⚡ for tankless, 🫧 for expansion tank). Good
  enough for MVP — 14.Y.2's geometry render will be the real
  visual identity.
- **Water heater energy is a 2-value enum** (gas / electric).
  Real codes include heat pump, solar-thermal, indirect — not
  modeled. If a user needs them, we add to the enum.

## Verification

- `npx vitest run` — 1171 tests pass (1146 prior + 25 new in
  `fixtureRegistry.spec.ts`).
- `npx tsc -b --noEmit` — clean. The PARAM_SCHEMA /
  SUPPLY_TABLE / DFU_TABLE / FLOW_PROFILES /
  SUBTYPE_ICON / SUBTYPE_LABEL records are all exhaustive
  over the expanded `FixtureSubtype` union (locked by TS).

## Files

- `src/engine/graph/GraphNode.ts` — 9 new subtypes, DFU + SUPPLY
  table rows.
- `src/engine/demand/FixtureFlowProfile.ts` — 9 new flow profiles.
- `src/core/fixtures/ConnectionPoints.ts` — 9 new geometry
  computers + dispatcher cases.
- `src/core/fixtures/FixtureParams.ts` — `WATER_HEATER` schema +
  `MINIMAL_PLACEMENT_ONLY` schema + 9 new `PARAM_SCHEMA` rows.
- `src/ui/fixtures/FixtureParamWindow.tsx` — `SUBTYPE_ICON` +
  `SUBTYPE_LABEL` extended.
- `src/core/fixtures/__tests__/fixtureRegistry.spec.ts` — 25 tests.
- `docs/adr/051-fixture-registry-foundation.md` — this document.

## What's locked by tests for 14.Y.2+

- Every `FixtureSubtype` has non-zero footprint + at least one
  connection point.
- Water heater exposes cold, hot, T&P overflow, and service drain.
- Tankless exposes cold, hot, gas.
- Inline devices have specific expected port ids (`in`, `out`,
  `relief`, etc.).
- DFU_TABLE, SUPPLY_TABLE, FLOW_PROFILES, PARAM_SCHEMA are
  exhaustive over the union.
- Capacity parameter affects water heater footprint.

These are the contracts the next sub-phases can rely on.
