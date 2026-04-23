# ADR 055 — Riser Templates (Phase 14.Z)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.Z
- **Depends on:** 14.Y.1 (fixture registry), 14.Y.2 (geometry).

## Context

Audit of the original Python Elbow Grease
(`C:\LOVEDECIDES\WiLeads\elbow_grease`) surfaced four features
not yet in the Tauri/TypeScript rewrite:

- **Riser templates** — pre-built multi-floor stacks
- **DXF export** — AutoCAD interop
- **Branded bid package PDF** — cover + proposal + BOM + compliance
- **Condensate discharge rule (R-014)** — HVAC direct-to-DWV check

Riser templates landed first because (a) high contractor value —
multi-story stacks are the most repeated piece of geometry a
plumber draws, (b) self-contained scope that fits in one iteration,
(c) exercises the 14.Y fixture additions (water heater + cleanout
+ expansion tank all appear in the templates).

DXF + bid packaging + condensate rule are queued for next iteration.

## Decision

Ship a pure catalog module + a tiny picker panel.

### `src/core/fixtures/riserTemplates.ts` — 4 templates

| Id | Scope | Key components |
|---|---|---|
| `two_story_dwv` | 2 floors × 9ft | 3" drain stack, 2" vent stack, wet-vent takeoff at floor 1, cleanout at base |
| `three_story_dwv` | 3 floors × 9ft | 4" drain (upsized for higher DFU), 2" vent, wet-vent takeoffs at floors 1 & 2, cleanout at base |
| `two_story_supply` | 2 floors × 9ft | 3/4" PEX cold + hot risers with 1/2" branch tees at floor 1 |
| `water_heater_stub` | 1 floor pre-piped | 3/4" PEX cold inlet + hot outlet at tank-top height, 1/2" expansion-tank tee + tank fixture |

Each template is a pure function `(anchor: Vec3) → RiserResult`:

```ts
interface RiserResult {
  pipes: RiserPipe[];      // fully-formed, ready for pipeStore.addPipe
  fixtures: RiserFixture[]; // ditto for fixtureStore
  warnings: string[];
}
```

Anchor is the BASE of the stack (slab for DWV / floor for supply).
All entity positions are translated from the anchor, so the same
template dropped at different origins produces geometrically
congruent stacks (tested).

### `src/ui/fixtures/RiserPlacementPanel.tsx` — picker

Alt+Shift+R opens a glassmorphic modal listing the four templates
with their descriptions + floor/height metadata. Click a row →
the riser commits at:

- The selected fixture's position, if one is selected
- Otherwise at the active floor's slab with X = Z = 0

Commits bypass `pipeStore.addPipe` and `fixtureStore.addFixture`
(which would re-mint ids + re-infer system) in favor of direct
`setState` so the pre-picked system classification (waste / vent /
cold_supply / hot_supply) and ids from the template survive
verbatim.

Esc closes without placing.

### Why not a radial wheel entry

Considered exposing risers via the existing FixtureWheel (Ctrl+F).
Rejected because:

- FixtureWheel places ONE fixture; risers are multi-entity.
- The wheel's sector model doesn't carry enough context (description,
  floor count, height) — users would need to remember which
  generic "Riser 2" label meant what.
- A modal list with descriptions is more discoverable for a feature
  plumbers reach for infrequently (once per job typically).

## Trade-offs

- **Anchor-only placement** — no "pick floor, pick X/Z" flow yet.
  User drops at the selected-fixture position or at origin, then
  uses Ctrl+drag (Phase 14.O group translate) to move the whole
  assembly. Acceptable for 95% of use cases; a cursor-follow
  ghost preview is a polish item for later.
- **4 templates, not 10+** — residential-focused set. Commercial
  stacks (4–6-story, 6" main), restaurant grease lines, multi-
  manifold risers all defer. Catalog is trivially extensible:
  add a new entry to `RISER_CATALOG` + a `build*` function, the
  picker picks it up automatically.
- **No parameterization in the picker** — user can't specify
  "2-story + extra fixture branches on floor 1." The template is
  fixed; tweaks happen post-placement by selecting pipes/fixtures
  and editing them directly. Parameterized templates (accepting
  floor count + branch config + material) are a 14.AA candidate.
- **Commits bypass public store actions** — same rationale as
  14.Y.3's `autoRouteSelectedFixture`. The template has already
  made correct decisions we shouldn't have `addPipe` overwrite.
  Stable, idempotent, traced by logger.

## Verification

- `npx vitest run` — 1233 tests pass (1213 prior + 20 new in
  `riserTemplates.spec.ts`).
- `npx tsc -b --noEmit` — clean.
- Manual in the desktop app:
  1. Launch → empty scene.
  2. **Alt+Shift+R** → picker modal opens.
  3. Click **2-story DWV stack** → modal closes, a vertical 3"
     drain + 2" vent stack appears from Y=0 up to Y=18 with a
     cleanout fixture at the base.
  4. Alt+Shift+R → **Water heater stub** → cold + hot stubs + an
     expansion-tank fixture appear.
  5. Select any resulting pipe + Ctrl+click others → drag the
     whole riser to its final position.

## Files

- `src/core/fixtures/riserTemplates.ts` — 255 LOC pure module with
  catalog + 4 builder functions + dispatcher.
- `src/core/fixtures/__tests__/riserTemplates.spec.ts` — 20 tests.
- `src/ui/fixtures/RiserPlacementPanel.tsx` — 210 LOC modal +
  keyboard hook + commit helpers.
- `src/App.tsx` — `<RiserPlacementPanel />` mount + import.
- `docs/adr/055-riser-templates.md` — this document.

## What's queued (remaining from audit)

- **14.AA.1 — DXF export** — convert scene to AutoCAD DXF with
  layer attribution per system. High contractor demand.
- **14.AA.2 — Branded bid package PDF** — multi-page proposal
  with company logo + cover + itemized BOM + compliance summary.
  Existing `PrintableProposal` covers much of the individual
  pages; the bid packaging is the "combine + brand" layer.
- **14.AA.3 — Condensate discharge rule (R-014)** — HVAC
  condensate into DWV check. Blocked on adding a `condensate`
  system type or a pipe tag for HVAC origin.

Each is a standalone phase. Roadmap continues when the user asks.
