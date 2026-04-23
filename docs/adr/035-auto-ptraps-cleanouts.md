# ADR 035 — Auto P-Traps & Cleanouts (Phase 14.D)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 14.D
- **Depends on:** ADR 030 (BOM Accuracy), ADR 031 (BOM Data Freshness), ADR 032 (Pricing Engine).

## Context

The BOM is structurally accurate (Phase 13.A/B, 151 coverage tests) and bid-ready (Phase 14.A). But one blind spot remained: the contractor's drawing is just pipes + fixtures. Code-required **p-traps and cleanouts** don't appear in the drawing — they're implicit obligations imposed by the plumbing code.

Concretely, for each non-integral-trap fixture, the code (IPC 1002.1) requires an external p-trap on its drain outlet. For each drain run, the code requires cleanouts at specific locations (IPC 708): change-of-direction, long-run intervals, stack bases, end-of-run. None of this appears in the contractor's pipe sketch, but every item costs real money and real labor hours.

Missing them from the BOM means:
1. The material takeoff is *short*. Contractor orders 4 cleanout adapters instead of the 9 the inspector will demand.
2. The bid is *under*. Labor hours for installing p-traps + cleanouts aren't counted — actual install is slower than the bid claims.
3. The proposal is vulnerable to "you didn't include X." A mid-job change order for code-required items is a trust killer.

## Decision

Ship one pure module + one panel. The planner detects all trap/cleanout requirements from the scene geometry + code rules and emits `FittingInstance[]` that the existing BOMExporter aggregates natively.

### 1. `pTrapCleanoutPlanner.ts` — pure detection

```ts
planPTrapsAndCleanouts(pipes, fixtures, rules?) → TrapCleanoutPlan
planToFittings(plan)                             → FittingInstance[]
```

Pure function. No React, no Zustand, no Three.js, no access to the PCSP compliance solver. 40 unit tests exercise every rule in isolation + combination.

### Code rules implemented

| Rule | Code ref | Trigger |
|---|---|---|
| P-trap required | IPC 1002.1 | Every fixture whose subtype isn't `water_closet`, `floor_drain`, or `hose_bibb` |
| Cleanout at horizontal bend > 45° | IPC 708.1.1 | Vertex angle > threshold between two horizontal segments |
| Cleanout at stack base | IPC 708.1.2 | Vertex transitioning vertical ↔ horizontal |
| Cleanout at drain end | IPC 708.1.4 | Endpoint not on a fixture and not joined to another pipe |
| Cleanout every 100 ft | IPC 708.1.5 | Unbroken horizontal run exceeds 100 ft → inject every 100 ft |

All thresholds live in `DEFAULT_PLANNER_RULES`. A contractor working under a different jurisdiction (NY, CA) edits the rules; planner output adapts automatically — no code change.

### Why this shape rather than the existing ComplianceEngine

The existing `src/engine/compliance/ComplianceEngine.ts` is a PCSP constraint solver backed by an RDF-style KnowledgeGraph. Powerful, but heavyweight — every new rule becomes an RDF binding + constraint template. For trap/cleanout detection, the logic is small and the data shape is uniform (scene geometry in, fitting list out). A pure planner function is both easier to test and easier to compose with the rest of Phase 14.

Future work can surface planner warnings inside the ComplianceEngine by adapting each `PTrapRequirement` / `CleanoutRequirement` into a `ComplianceViolation` with `severity: 'error'` — but that's a UI integration task, not a data-model change.

### 2. BOM integration via `FittingInstance[]`

The planner produces a plan; `planToFittings(plan)` converts it into `FittingInstance[]`. The existing `BOMExporter.generateBOM(pipes, fittings, profile?)` already knows how to aggregate, price, and labor-hour these types:

- `FITTING_COSTS.p_trap` — $8–$14 per unit by diameter
- `FITTING_COSTS.cleanout_adapter` — $4–$14 per unit by diameter
- `LABOR_HR_PER_FITTING.p_trap` — 0.25–0.40 hr
- `LABOR_HR_PER_FITTING.cleanout_adapter` — 0.20–0.75 hr

Values already calibrated to 2025 Orlando residential pricing (ADR 030, 031).

**Integration points:**
- `src/ui/ExportPanel.tsx` CSV + JSON handlers — appends `planToFittings(plan)` to the `generateAllFittings(pipes)` output before calling `generateBOM`.
- `src/core/print/printProposal.ts` — same pattern, so the proposal PDF reflects true total.
- **Not modified:** IFC export (visual 3D geometry positioning is a separate v2 task; sending an unpositioned cleanout into a BIM viewer would confuse it), PhaseBOMPanel (phase-scoped BOMs operate on already-filtered subsets and have their own provenance rules).

Callers who don't pass fixtures get the old behavior — the planner is opt-in at the integration layer, never forced on any downstream consumer.

### Material inference for p-traps

A p-trap's material should match the fixture's drain pipe. The planner finds the nearest drain-system pipe (waste/storm, any point) to the fixture position and inherits its material. If no drain pipe exists (empty or supply-only scene), it falls back to `rules.defaultDrainMaterial` (PVC Schedule 40 for FL residential). Cleanouts just take the material of the pipe they sit on.

### 3. `TrapCleanoutPanel` — read-only review surface (Ctrl+Shift+L)

Non-destructive compliance preview. Lists every detected p-trap + every detected cleanout, each tagged with its IPC code reference and plain-English description:

```
P-Traps · 8
IPC 1002.1
┌────────────────────────────────────────────────┐
│ Lavatory                      1.5″ · PVC Sch 40 │
│ lavatory requires an external p-trap on its…    │
│ at (5.0, 0, 3.2)                                │
└────────────────────────────────────────────────┘
…

Cleanouts · 5
  Base of vertical stack                IPC 708.1.2 · 1
  Horizontal direction change > 45°     IPC 708.1.1 · 2
  Max spacing (100 ft) on long run      IPC 708.1.5 · 1
  End of drain run                      IPC 708.1.4 · 1
```

The panel is a review surface, not an editor. The plan is already folded into the BOM at export time — the contractor opens this panel to verify "yes, the auto-detector caught everything the inspector will look for."

Plan is recomputed on scene change while the panel is open; when closed, the memo returns `null` so there's zero compute overhead.

### Files

```
src/core/compliance/pTrapCleanoutPlanner.ts              Pure planner + plan→fittings (40 tests)
src/core/compliance/__tests__/pTrapCleanoutPlanner.spec.ts
src/ui/compliance/TrapCleanoutPanel.tsx                  Ctrl+Shift+L review panel
src/ui/ExportPanel.tsx                                   (mod) CSV + JSON folds in planner output
src/core/print/printProposal.ts                          (mod) PDF proposal includes planner output
src/core/input/ShortcutRegistry.ts                       (mod) Ctrl+Shift+L registered
src/App.tsx                                              (mod) TrapCleanoutPanel mounted
```

## Consequences

**Good:**
- The BOM now reflects code-required items automatically. A contractor's CSV includes every p-trap + every cleanout the inspector will demand — no guesswork, no omissions.
- Bid accuracy improves: labor hours for trap + cleanout installs (0.2–0.8 hr each) roll into the total. A typical 2-bath job adds ~4 hours of labor that used to be implicit.
- Proposal PDFs are honest about the full job cost — no mid-job change orders for code items.
- Compliance panel is a "did you remember?" safety net before submission. Reviews at the code-ref level so the contractor can cite IPC in conversations with inspectors or customers.
- Pure planner means the rules are testable without DOM + worker; 40 tests cover every IPC rule independently.
- FL rules aren't hardcoded — every threshold lives in `DEFAULT_PLANNER_RULES`. Other jurisdictions customize without forking the code.

**Accepted costs:**
- P-trap positions are approximate — the planner places them at the fixture's own position (the contractor places the physical trap below the fixture, a few inches away). Accurate for material + labor counting; not suitable for 3D visualization. Visual placement is a v2 enhancement.
- Cleanout positions are exact in the math (injected on the polyline), but we don't render them as 3D fittings in the scene. The BOM count is what matters; the 3D rendering is v2 and needs quaternion work.
- No partial-credit for existing p-traps already drawn by the user. If a contractor manually draws a p-trap fitting into their scene, the planner will *also* suggest one — duplicating the count in the BOM. Real-world risk is low (users don't hand-draw traps; the whole point of the planner is that they shouldn't have to). Can be fixed in v2 by having the planner look at nearby fittings before emitting a requirement.
- Cleanouts on vent pipes are skipped (vents terminate at the roof with caps). Rare edge cases (vents with changes of direction at floor level, commercial-scale vent manifolds) may need cleanouts; flag as v2 if we hear about it from real jobs.
- Direction-change detection uses segment-angle only, not curvature. A pipe with three 30° bends close together doesn't trigger a cleanout even though the aggregate direction change is 90°. Mitigation: FittingGenerator already emits bend fittings for each 30° turn separately; the real install gets cleanout-adapters on the largest bends anyway. Known limitation, acceptable for MVP.
- Material inference is "nearest point" — doesn't follow pipe connectivity. A fixture that's geometrically close to a water-supply pipe but physically drained to a different waste run will infer the supply material if the supply happens to be closer. The planner filters out supply systems explicitly to avoid this, so the real risk is only if two waste pipes of different materials both reach the fixture — a rare case.

**Non-consequences:**
- No change to pipe / fixture stores, simulation engine, renderer, compliance engine, or existing exports. The planner is purely additive at the BOM-input layer.
- No schema bump on `.elbow` bundles. Plan is computed on-demand at export time.
- No bundle growth — zero new dependencies.

## Alternatives considered

**Register new rules in ComplianceEngine's PCSP solver.** Considered, rejected for MVP. The PCSP path requires an RDF binding for each rule + a constraint template + a remediation action — five to ten times more code per rule. The pure planner path ships the rules in a single file, under test, and integrates directly with the BOM. Future integration into the KG registry is additive.

**Snapshot p-traps + cleanouts into the `.elbow` bundle at save time.** Rejected — the plan is a *derivation* from scene geometry, not an intrinsic property of the scene. Re-deriving on load is fast and always correct; storing a snapshot risks drift if the scene is edited elsewhere.

**Emit warnings only; don't auto-include in BOM.** Rejected. A "warning" the contractor has to manually resolve is exactly the friction we're trying to remove. Auto-inclusion is the safer default; the compliance panel gives the user a review surface if they want to double-check.

**Let the user select which requirements to include.** Considered. Rejected for MVP because the IPC thresholds aren't opinions — they're legal minimums. "Opt out of compliance" isn't a valid contractor workflow. Edge cases (inspector waives the 100-ft rule for a specific job) are a v2 feature: `PlannerRules` accept overrides, and the compliance panel could grow an "exclude from BOM" checkbox per item.

**Render p-traps + cleanouts visually in the 3D scene.** Good UX, but needs quaternion alignment (which way does the trap face? where does the cleanout riser go?). FittingMeshes already has mesh definitions for both types — hooking them up is a clear v2 task. MVP ships the math and the BOM impact; visuals follow.

## Validation

- `Vitest`:
  - `src/core/compliance/__tests__/pTrapCleanoutPlanner.spec.ts` — **40 tests** covering every IPC rule: p-trap for each drain fixture, skip integral-trap and supply-only fixtures, trap-size diameter by subtype, code-ref tagging, material inference (nearest drain, fallback, supply-pipe exclusion), cleanouts filtered by system (waste + storm only), stack-base at V→H and H→V, direction change > 45° at 90° and 60°, no cleanout at 30° bend, long-run injection at 100 ft / 200 ft / no-trigger, run counter resets on vertical break, dangling end detection, fixture-terminated end not flagged, junction-shared end not flagged, dedupe at shared positions, `planToFittings` output shape + unique IDs, `summary.cleanoutsByReason` breakdown, low-level helpers (`classifySegment`, `angleDegBetween`).
  - All prior test files (BOM, pricing, pTrapCleanoutPlanner, proposalData, assemblyTemplate, etc.) continue to pass.
- `tsc --noEmit` — clean.
- `vite build` — clean, no new bundle growth (no new deps).
- Manual plan:
  - Draw a 2-bath rough-in (water closet, lavatory, bathtub + connecting drain pipes).
  - Press Ctrl+Shift+L — panel shows 2 p-traps (lavatory + bathtub; water closet integral), N cleanouts based on the drain geometry.
  - Close panel, press Ctrl+Shift+E → export CSV → open in Excel → verify a `p_trap` row with quantity 2 + a `cleanout_adapter` row(s) with totals that reconcile with the panel.
  - Export proposal PDF — grand total includes trap + cleanout cost + labor.
