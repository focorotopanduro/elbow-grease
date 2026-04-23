# ADR 039 — Per-Material Hanger & Support Spacing (Phase 14.H)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 14.H
- **Depends on:** Phase 14.D (trap + cleanout planner), Phase 13.A (BOM accuracy).

## Context

The existing BOM rolled up pipe hangers as a single blind line item:

```ts
// BOMExporter.ts line 366 (pre-14.H)
const supportCount = Math.ceil(totalHorizLength / 4); // one every 4ft
```

One hanger every 4 ft, priced at $1.50 with 5 min of labor each, regardless of pipe material. That's accurate for PVC but systematically wrong for every other material:

| Material | Actual IPC spacing | Old "4 ft" count | Direction of error |
|---|---|---|---|
| PVC / ABS | 4 ft | correct | — |
| Cast iron | 5 ft + every joint | −20% | over-count |
| Copper L/M | 6 ft | −33% | over-count |
| CPVC small | 3 ft | +33% | under-count |
| PEX | 32 in (2.67 ft) | +50% | under-count |
| Galvanized steel | 12 ft | −67% | large over-count |
| Ductile iron | 10 ft | −60% | over-count |

Plus: no vertical riser clamps at all (IPC 308.7), no extra support at horizontal bends (IPC 308.9), no end-of-run support, all materials lumped into a single `HANGER-STRAP` row with material "Steel / assorted."

Phase 14.H fixes every cell above.

## Decision

Ship a pure `hangerPlanner` module that produces BOMItem[] rows directly, plus a 14.D-style hook into BOMExporter to swap in planner output.

### 1. `hangerPlanner.ts` — pure module (31 tests)

```ts
planHangers(pipes, rules?)       → HangerPlan
planToBOMItems(plan)             → BOMItem[]
```

Four hanger-reason codes map to four IPC sections:

| Reason | Code | Trigger |
|---|---|---|
| `horizontal_spacing` | IPC 308.5 | Midspan every N ft on a horizontal run (N per material) |
| `end_of_horizontal` | IPC 308.5 | ~0.5 ft from each termination of a ≥ 1 ft horizontal run |
| `direction_change` | IPC 308.9 | At any horizontal vertex where the bend exceeds 45° |
| `riser_floor` | IPC 308.7 | Every N ft on a vertical run (typically story height) |

Two hanger kinds:
- `horizontal_hanger` — strap / clevis / J-hook (material-dependent pricing)
- `riser_clamp` — vertical support (heavier, metallic riser clamps cost more)

`DEFAULT_HANGER_RULES` encodes the per-material spacing table sourced from IPC 308.5 + manufacturer recommendations (PEX supports at 32" per UPC/IPC footnote (g)). Every number is in the rules object, not hardcoded — commercial contractors or non-IPC jurisdictions can override.

### 2. `planToBOMItems` aggregation

Groups individual hanger requirements by `(kind, material, diameter)` into BOMItem rows:

```
HANGER-PVC_SCH40-2         | 12 ea × $1.25 = $15.00 | 0.96 hr
HANGER-COPPER_TYPE_L-0.75  |  6 ea × $2.25 = $13.50 | 0.48 hr
HANGER-PEX-0.5             | 18 ea × $0.85 = $15.30 | 1.44 hr
RISER-CLAMP-PVC_SCH40-4    |  2 ea × $3.50 =  $7.00 | 0.36 hr
```

Unit costs distinguish metallic (higher) from plastic (lower) within each kind. Labor: 0.08 hr horizontal, 0.18 hr riser. Values calibrated to 2025 Orlando residential pricing, consistent with the 13.A/14.D tables.

### 3. `BOMExporter` integration

Extended `generateBOM` with a new optional `opts` bag:

```ts
generateBOM(pipes, fittings, pricingProfile?, opts?: {
  supportItemsOverride?: BOMItem[];
}): BOMReport
```

When `supportItemsOverride` is supplied, the inline HANGER-STRAP rollup is skipped and the passed-in rows are appended as-is. Backward-compatible: any caller that doesn't know about Phase 14.H keeps the legacy 4-ft behavior unchanged.

The two canonical call sites (ExportPanel's CSV/JSON + printProposal's PDF) now compute `planHangers(pipes)` + `planToBOMItems(plan)` and pass the result as `supportItemsOverride`.

### 4. Compliance panel extension

`TrapCleanoutPanel` (Ctrl+Shift+L) grew a third section: **Hangers & supports · N**, grouped by reason (horizontal spacing / end-of-run / direction change / riser floor), with a per-(material, diameter) rollup inside each group:

```
Hangers & supports · 24
  Horizontal spacing (per material)   IPC 308.5 · 18
    PVC Sch 40 2″    ×12
    Copper Type L ¾″  ×6
  End-of-run support                  IPC 308.5 · 4
    PVC Sch 40 2″    ×2
    Copper Type L ¾″  ×2
  Vertical riser (story interval)     IPC 308.7 · 2
    PVC Sch 40 3″    ×2
```

Panel title + empty-state copy updated accordingly. Footer count string now reads "N p-traps + M cleanouts + K hangers already in your BOM."

### Files

```
src/core/compliance/hangerPlanner.ts                      Pure planner + BOMItem aggregator (31 tests)
src/core/compliance/__tests__/hangerPlanner.spec.ts
docs/adr/039-per-material-hangers.md

src/engine/export/BOMExporter.ts           (mod) +GenerateBOMOptions + supportItemsOverride hook
src/ui/ExportPanel.tsx                     (mod) CSV + JSON exports pass plan as override
src/core/print/printProposal.ts            (mod) proposal PDF BOM uses per-material supports
src/ui/compliance/TrapCleanoutPanel.tsx    (mod) +Hangers section (IPC 308)
```

## Consequences

**Good:**
- BOM reflects real install cost for every material, not just PVC. A 3-bath PEX supply + cast iron drain job used to undercount PEX hangers by ~50% and overcount cast iron hangers by ~20% — now both are right within a unit or two.
- Riser clamps appear as their own line item, correctly priced higher and slower to install than horizontal hangers. Previously they were missing entirely; the contractor had to remember to add them manually.
- End-of-run and direction-change supports (IPC 308.5 last-paragraph + 308.9) are also auto-added. These are small counts but they're what inspectors look for.
- 31 tests pin every material spacing, every IPC section, every edge (short runs, zero-length segments, direction changes at 30° vs 60°, material fallback, dedupe).
- Compliance panel now reviews the three major auto-generated categories in one place.
- Backward-compatible BOM API: every existing caller that doesn't know about 14.H gets the old behavior unchanged (BOMExporter tests unmodified, all 707+ pre-existing tests green).

**Accepted costs:**
- Hanger counts can diverge from the legacy "one per 4 ft" rollup by ±50% depending on material mix. A contractor reviewing a pre-14.H proposal against a post-14.H proposal will see the support subtotal shift. This is a CORRECTION, not a regression — but worth documenting in the change-order diff when the first revision after 14.H lands. Phase 14.G's revision compare panel makes this visible.
- Per-(material, diameter) rollup can produce many small rows on a mixed-material job (e.g. 12-row BOM on a 3-material 4-diameter house). The compliance panel's rollup groups by reason, so the review surface stays readable; the raw BOM CSV/JSON carries all rows for procurement accuracy.
- Default spacing values are IPC-residential; commercial or industrial jobs may have stricter requirements (seismic bracing, insulation-carrier hangers, etc.). Custom `HangerRules` covers simple overrides; anything beyond "adjust the number" is a v2 rule-expression engine.
- No per-diameter override inside the default rules (e.g. small copper spacing is actually tighter than large copper). For MVP a single number per material captures 90% of residential cases; v2 can add a diameter-dependent lookup.
- Direction-change detection reuses the pTrapCleanoutPlanner logic (angle > 45° between two horizontal segments). Doesn't catch cumulative direction-creep across multiple small bends. Same limitation as 14.D — acceptable for residential.

**Non-consequences:**
- No changes to pricing engine (14.A), proposal layout (14.B), assembly templates (14.C), PDF backdrops (14.E), fixture gizmo (14.F), or revisions (14.G).
- No schema bump on `.elbow` bundles — planner runs on-demand at export time, nothing stored.
- No new runtime dependencies. Zero bundle growth beyond the ~2 KB gz of new planner code.
- Legacy `HANGER-STRAP` output preserved for any code path that doesn't know about supportItemsOverride.

## Alternatives considered

**Extend `FittingType` with `hanger_strap` + `riser_clamp` and emit `FittingInstance[]`.** Considered. Would match Phase 14.D's p-trap/cleanout pattern. Rejected because:
1. Hangers are category: 'support' in the BOM, not 'fitting'. Shoehorning them as FittingInstance distorts the categorization.
2. FittingInstance carries quaternions + pipeIds that are meaningless for a per-material rollup.
3. The BOMExporter aggregation keys by (type, diameter), not (type, material, diameter) — it would lump all-material hangers into single rows, losing the per-material price differential that's the whole point.

Direct `BOMItem[]` output sidesteps all three.

**Use the flat 4-ft rollup and just multiply the count by a material-specific factor.** Simpler but loses the reason codes (no way to distinguish "I need a midspan hanger" from "I need a riser clamp at the floor"). The compliance panel wants the reason breakdown for the "did you remember these?" review surface.

**Use IPC Chapter 7 full hanger spacing rules including insulation carriers + anti-vibration.** Out of scope for residential. Would add 200 LOC of rules with marginal return. Keep it lean.

**Compute hangers from the actual hanger_strap fittings in FittingGenerator.** FittingGenerator doesn't produce hangers today (checked). Producing them there would couple spacing math to rendering concerns. Better to keep the planner pure + independent.

**Persist the planned hangers as scene entities (like fixtures).** Would let the user manually tweak a specific hanger's position. Rejected for MVP — the planner is deterministic, so editing a computed value means diverging from the plan, which needs an override-mechanism we don't have. v2 could add a "lock this hanger at X" override table.

## Validation

- `Vitest`:
  - `src/core/compliance/__tests__/hangerPlanner.spec.ts` — **31 tests**: per-material horizontal spacing (PVC @ 4, PEX @ 2.67, copper @ 6, cast iron @ 5, fallback, short runs), vertical riser clamps (PVC vs PEX, short run, reason + code), end-of-horizontal supports (both ends, skipped on short runs), direction-change (90° fires, 30° skipped, vert-horiz transition uses different rule, toggle respected), dedupe of coincident hangers, plan summary (by reason + kind), trivial inputs (empty, < 2 points, zero-length), `planToBOMItems` aggregation (single-material grouping, multi-material rows, horizontal vs riser separate, metallic vs plastic cost, labor hours), and the low-level helpers (`classifySegment`, `angleDegBetween`, `humanMaterial`).
  - All prior tests continue to pass (BOM, pricing, proposals, compliance planner, revisions, templates, PDFRenderer, rotation gizmo, etc.).
- `tsc --noEmit` — clean.
- `vite build` — clean. No new runtime deps.
- Manual plan:
  - Draw a 2-bath with a PEX supply riser + PVC drains + copper stubs. Press Ctrl+Shift+L.
  - Hangers section shows three material-distinct rollups.
  - Export CSV → separate HANGER-PEX-*, HANGER-PVC_SCH40-*, HANGER-COPPER_TYPE_L-* rows instead of a single HANGER-STRAP row.
  - Verify riser-clamp rows appear when the PEX supply has a tall vertical run.
  - Print proposal R2 → change-order diff (Phase 14.G) surfaces the corrected hanger counts vs R1 if it was printed pre-14.H.
