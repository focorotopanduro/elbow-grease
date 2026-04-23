# ADR 058 — Condensate SystemType + R-014 Validation (Phase 14.AA.3)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AA.3 (final of the 14.AA port pass from original
  Python Elbow Grease)
- **Depends on:** 14.Y.1 (fixture registry with receptor subtypes
  — floor drain, utility sink, etc.), existing `SystemType` taxonomy.

## Context

Last item from the original Elbow Grease audit: the **R-014
condensate discharge rule**. From the original CSV:

> *FBC 2023 § 314.2.1.1 / IPC 2021 § 314.2.1.1*
> *"HVAC equipment condensate shall not be directly connected to
>  the DWV system. Condensate shall discharge to an approved
>  receptor — floor drain, hub drain, trapped and vented receptor,
>  or an air-gap device."*

Why: condensate lines are low-flow, intermittent, and unpressurized.
Connecting them directly to a drain line lets sewer gases migrate
up through the HVAC system into conditioned space. The air gap
at an approved receptor breaks that migration path.

## Decision

Two pieces: a taxonomy extension + a pure validator.

### 1. `SystemType` extended with `'condensate'`

`GraphNode.ts` now:

```ts
export type SystemType =
  'waste' | 'vent' | 'cold_supply' | 'hot_supply' | 'storm' | 'condensate';
```

Ripple: every `Record<SystemType, X>` in the codebase must gain a
`condensate` entry. Eight files + the SharedDagBuffer enum needed
an update:

| File | Added |
|---|---|
| `store/layerStore.ts` | Color `#9575cd`, label "Condensate", keybind `d`, default-visible, solo/showAll branches |
| `ui/LayerPanel.tsx` | `pipeCounts.condensate = 0` initializer |
| `ui/pipe/PipeMaterial.ts` | PEX color map adds condensate variant |
| `engine/export/DXFExporter.ts` | AIA layer `P-CNDS`, AutoCAD color 150 (violet) |
| `engine/export/IFCSchema.ts` | `SYSTEM_TO_IFC.condensate = { predefined: 'CONDENSATE' }` |
| `engine/export/SVGExporter.ts` | Purple 4-2 dashed style |
| `core/selection/massEdit.ts` | `humanSystem` label |
| `engine/worker/SharedDagBuffer.ts` | `SYSTEM_TYPE.condensate = 5` byte code |

As a bonus, `SharedDagBuffer.FIXTURE_SUBTYPE` was also caught +
extended to include the nine Phase 14.Y fixture additions
(water_heater, tankless_water_heater, bidet, etc.) — those were
referenced in the type union but missing from the binary packer.
Quiet bug fix surfaced by the ripple.

### 2. `condensateValidation.ts` — pure rule

```ts
validateCondensateDischarge(pipes, fixtures) → CondensateViolation[]
reportCondensate(pipes, fixtures) → CondensateReport
```

Algorithm:

1. For every `condensate` pipe (visible), take its two endpoints.
2. For each endpoint, check if an **approved receptor fixture's
   drain port** is at the same world position (within the same
   `JUNCTION_TOL = 0.15 ft` tolerance the rest of the codebase
   uses). If yes — clean, no violation.
3. Otherwise, check every `waste` / `storm` pipe's endpoints. If
   one coincides with our condensate endpoint, that's a direct-
   to-DWV violation → emit a `CondensateViolation` with the FBC
   code reference and actionable message.

**Approved receptors** (per FBC + field practice):

- `floor_drain`
- `cleanout_access` (hub cleanout)
- `utility_sink`
- `mop_sink`
- `laundry_tub`

Each receptor has a `drain`-role connection point in the
`ConnectionPoints` registry. We transform the port's local coord
through the fixture's rotation + position to get the receptor's
world point, then compare to the condensate endpoint.

**Violation severity** = `'critical'`. Message includes the pipe
id of the target drain + the code reference + actionable remedy
("Insert a receptor fixture or reroute to an existing one").

### Why a standalone validator instead of the IPC rule engine

The existing `ComplianceEngine` is a triple-store + PCSP
constraint solver — powerful for numeric checks (slope, velocity,
pressure) but overkill for a topological connectivity rule that's
"pipe X's endpoint coincides with pipe Y's endpoint AND no
receptor Z is at that point." Standalone pure module keeps the
rule readable + independently testable + doesn't shoehorn
topology into a numeric solver.

If future rules have similar connectivity shape (e.g. "every
waste pipe must trace back to a stack") they can follow this
pattern.

## Trade-offs

- **Not wired into `ComplianceEngine.solve` yet.** The validator
  is a standalone pure function callable from anywhere. Next
  iteration can add a `compliancePanel` section that calls
  `reportCondensate` on every scene change. For now, BOM exporters
  + the bid package can import it directly.
- **"Approved receptor" list is residential-focused.** Roof
  drains + hub drains + catch basins + some air-gap-specific
  fixtures aren't in the registry yet. If a user models a
  commercial condensate manifold dumping into a roof drain, the
  rule will false-positive. Add subtypes as they come up.
- **Rule detects endpoint-to-endpoint only.** A condensate pipe
  T-ing into the MIDDLE of a drain pipe (not endpoint) isn't
  detected. Matches `pipeCollision` + `hotSupplyPropagation`
  consistency — "junctions are endpoint-shared." The field
  practice fix (split the drain pipe + add a proper tee) puts
  the endpoints in the right place.
- **Invisible pipes excluded.** If the user hides a pipe via
  layer toggles, the rule doesn't fire on it. Keeps visual
  consistency with what the user sees.

## Verification

- `npx vitest run` — 1274 tests pass (1259 prior + 15 new in
  `condensateValidation.spec.ts`).
- `npx tsc -b --noEmit` — clean.
- Manual checkpoint: SystemType ripple propagated to every
  Record-typed consumer; no runtime fallbacks needed because TS
  exhaustiveness checked each map at compile time.

## Files

- `src/engine/graph/GraphNode.ts` — SystemType union gains `condensate`.
- `src/engine/compliance/condensateValidation.ts` — pure rule, 155 LOC.
- `src/engine/compliance/__tests__/condensateValidation.spec.ts` —
  15 tests (clean / direct-to-waste / direct-to-storm / receptor
  at junction / receptor too far / non-receptor fixture doesn't
  clear / invisibility filter / multi-endpoint).
- `src/engine/worker/SharedDagBuffer.ts` — `SYSTEM_TYPE` enum +
  `FIXTURE_SUBTYPE` enum both extended.
- `src/store/layerStore.ts` — color, label, keybind, soloSystem,
  showAllSystems, default-visible entry.
- `src/ui/LayerPanel.tsx` — pipe-count initializer.
- `src/ui/pipe/PipeMaterial.ts` — `PEX_SYSTEM_COLOR.condensate`.
- `src/engine/export/DXFExporter.ts` — `P-CNDS` AIA layer.
- `src/engine/export/IFCSchema.ts` — `SYSTEM_TO_IFC.condensate`.
- `src/engine/export/SVGExporter.ts` — purple dashed style.
- `src/core/selection/massEdit.ts` — `humanSystem` map.
- `docs/adr/058-condensate-rule.md` — this document.

## 14.AA port complete

All three items from the original Elbow Grease audit have shipped:

| Sub | Scope | Status | ADR |
|---|---|---|---|
| 14.AA.1 | DXF export | ✅ | 056 |
| 14.AA.2 | Branded bid package PDF | ✅ | 057 |
| 14.AA.3 | Condensate discharge rule R-014 | ✅ | 058 |

The rewrite now has feature parity + the PCSP compliance engine +
the modern 3D pipeline + all 22 fixture subtypes the original
delivered. Next iteration's focus is the user's call.
