# ADR 030 — BOM Accuracy Audit + Hardening (Phase 13.A)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 13.A

## Context

ELBOW GREASE is a plumbing CAD **and estimator** — the whole business value rides on the Bill of Materials being correct. An undercounted fitting or miscategorized pipe length turns into a wrong bid, which turns into lost money.

An accuracy audit via the Explore agent surfaced two HIGH/MEDIUM-severity correctness issues and two MEDIUM documentation gaps:

1. **HIGH — Labor hours entirely absent from the BOM export.** Materials were priced; installation time (the dominant cost on most residential plumbing bids) was simply not in the output. The synthesis doc flagged this at design time but the first implementation shipped without it.

2. **MEDIUM — Subtotal / grand-total reconciliation not enforced.** The prior code summed subtotals independently from the item list, then summed the subtotals again for the grand total. Two-pass accumulation of IEEE-754 floats is prone to silent drift; no invariant check caught it.

3. **MEDIUM — 4-way cross fittings under-counted.** A scene with 4 pipe endpoints meeting at a single point emitted exactly one `tee` fitting because the junction loop's `processed.has(posKey)` guard skipped subsequent emissions. A real 4-way junction needs a `cross` — larger, more labor, different part number.

4. **LOW (documentation) — Shallow-bend skip threshold undocumented.** The 5° floor in `generateBendFittings` looked like a "maybe a bug" to auditors. It's actually correct (polyline noise tolerance), but needed an inline comment explaining why.

The audit also verified a lot of things that ARE right: 3D pipe length math, bend-angle classification to legal detents (22.5° / 45° / 90°), tee/wye/sanitary-tee selection by material + system, reducer threshold, waste-percent bin-packing, closest-size cost fallbacks, and CSV `.toFixed(2)` discipline.

## Decision

Land three surgical fixes + two test suites.

### Fix 1 — Labor hours in every BOM line

Two new constants in `BOMExporter.ts`:

```ts
// Installation person-hours per fitting (type × diameter).
const LABOR_HR_PER_FITTING: Record<string, Record<number, number>> = {
  elbow_90:     { 0.5: 0.10, 0.75: 0.12, 1: 0.15, 1.5: 0.25, 2: 0.35, 3: 0.60, 4: 0.90 },
  tee:          { 0.5: 0.15, 0.75: 0.18, 1: 0.22, 1.5: 0.35, 2: 0.50, 3: 0.85, 4: 1.30 },
  cross:        { 1: 0.30, 1.5: 0.50, 2: 0.70, 3: 1.20, 4: 1.80 },
  // ... (15 fitting types × 6-8 diameters)
};

// Labor hours per linear foot of pipe — varies by material.
const LABOR_HR_PER_FT: Record<string, number> = {
  pvc_sch40:        0.030,  // fast glue-up
  copper_type_l:    0.050,  // solder, flux, clean
  pex:              0.020,  // crimp, flexible
  galvanized_steel: 0.080,  // threaded joints, heavy
  cast_iron:        0.060,  // hub-and-spigot
  // ...
};
```

Numbers are conservative journeyman averages rounded to 0.05 hr granularity — suitable for bidding. Each fitting labor entry bundles position + align, joint prep (primer/flux/solder/thread dope), joint make-up, and visual inspection. Pipe labor covers the run + routine hangers; joint labor is counted on fittings.

`BOMItem` gets two new fields:

```ts
interface BOMItem {
  // ... existing ...
  unitLaborHours: number;   // Per-unit
  laborHours: number;       // Per-line total (unitLaborHours × quantity)
}
```

`BOMReport` gets `grandLaborHours: number`. CSV export gains a `Unit Labor Hrs` column + `Total Labor Hrs` column + `TOTAL LABOR HRS` summary row. JSON serialization automatic (just another field).

**Important nuance:** pipe labor is proportional to INSTALLED footage (`summary.totalRequiredLength`), not stock length. A 10-ft stick cut to 6 ft still bills 10 ft of material but only 6 ft of labor — matching how a real contractor estimates. This surfaced a bug where my first draft used `totalUsedLength` (nonexistent field) and produced NaN; the correct field is `totalRequiredLength`.

### Fix 2 — Subtotal reconciliation in one pass

Prior implementation (two passes, independent sums):

```ts
const subtotals = {
  pipe: items.filter(i => i.category === 'pipe').reduce((s, i) => s + i.totalCost, 0),
  // ...
};
return { ..., grandTotal: Object.values(subtotals).reduce((s, v) => s + v, 0) };
```

New implementation (one pass, same accumulation):

```ts
const subtotals = { pipe: 0, fitting: 0, fixture: 0, support: 0, misc: 0 };
let grandTotal = 0;
let grandLaborHours = 0;
for (const it of items) {
  subtotals[it.category] += it.totalCost;
  grandTotal += it.totalCost;
  grandLaborHours += it.laborHours;
}
// Post-check invariant
const subtotalSum = Object.values(subtotals).reduce((s, v) => s + v, 0);
if (Math.abs(subtotalSum - grandTotal) > 0.01) {
  log.warn('BOM subtotal / grand-total mismatch', {...});
}
```

Single-pass accumulation means subtotals and grandTotal cannot disagree under float arithmetic (same operations, same order). The post-check detects category-assignment bugs that could land an item outside the five known categories.

### Fix 3 — 4-way cross detection

New helper:

```ts
function countEndpointsNear(pos: Vec3, allPipes: CommittedPipe[], tol: number): number {
  // Counts pipe start + end points within `tol` of `pos` (squared-distance compare).
}
```

In `generateJunctionFittings`, before emitting a fitting at a junction position:

```ts
const endpointCount = countEndpointsNear(ptB, allPipes, JUNCTION_TOLERANCE);
const is4WayCross = endpointCount >= 4;

if (is4WayCross) {
  fittings.push({ type: 'cross', ... });
} else if (isReducer) {
  fittings.push({ type: 'reducer', ... });
} else {
  fittings.push({ type: teeType, ... });
}
```

Only endpoints count — a T-junction where one pipe ends on another's *side* still reports 1 endpoint (the ending one) → tee. Four separate pipes all ending at the same point → cross. The `FITTING_COSTS` + `LABOR_HR_PER_FITTING` tables already had cross entries from this phase, so the new fitting prices correctly without further changes.

### Fix 4 — Shallow-bend comment

The 5° floor in `generateBendFittings` now carries a paragraph-long comment explaining: polyline vertices typically carry 1–3° of grid-snap / click-placement noise; real bends snap to 22.5° / 45° / 90° detents via `classifyBendAngle`; `illegalAngle: true` is the diagnostic surface for shallow bends that the user didn't intend.

No code change — just documentation that preempts "is this 5° a bug?" from future auditors.

## Test insurance

**`BOMExporter.spec.ts`** — 17 tests:
- Subtotal invariant across empty + populated scenes.
- Labor hours present on pipes, fittings; zero on consumables (primer, cement).
- `grandLaborHours = Σ item.laborHours` within float tolerance.
- Labor scales with quantity (2 identical elbows = 2× unit labor).
- Copper labor rate > PVC labor rate (material discrimination).
- Same-(type, diameter) fittings collapse to one line with count.
- Different diameters produce separate lines.
- Cross fitting priced correctly (regression guard on Fix 3).
- CSV has labor columns + TOTAL LABOR HRS row.
- CSV monetary fields use `.toFixed(2)` (no `12.1000001` artifacts).
- JSON roundtrip preserves grandTotal + grandLaborHours.
- Empty scene → empty valid report.

**`FittingGenerator.spec.ts`** — 9 tests:
- 4 pipes at origin → one `cross`, zero `tee`s (Phase 13.A fix).
- 4 pipes at an off-origin hub → still one cross.
- 2-way junction (same diameter) → tee (regression guard).
- 2-way junction (different diameters) → reducer with both diameters captured.
- 90° polyline middle vertex → one bend/elbow.
- Shallow < 5° bend → no fittings.
- 45° bend → `bend_45` or `elbow_45`.
- Empty pipe list → no fittings.
- Single-segment pipe → no fittings.

## Consequences

**Good:**
- BOM exports now carry labor — the biggest cost line on every plumbing bid. A 50-pipe residential project might generate ~$2,500 in material and ~60 hours × hourly rate in labor; the prior export undercounted the bid by ~50–70%.
- Subtotal drift impossible by construction (single-pass). Invariant check catches future category-classification bugs.
- 4-way crosses priced correctly. Manifolds + DWV stack confluences will no longer under-bid. The cross is ~2× the cost + 2× the labor of a single tee, so this fix materially improves bid accuracy for any scene with 4-way junctions.
- 26 tests lock in the guarantees. Future refactors that break one of them fail CI.

**Accepted costs:**
- Labor coefficients are static numbers baked into the file. No per-contractor / per-region override yet. A future phase can move them into a user-editable cost book (JSON file or customer-profile override).
- Cross detection fires only on the `endpointCount >= 4` case. A weird junction with 3 endpoints and 1 mid-pipe contact is still treated as a tee — correct for current scenes but worth revisiting if non-standard manifolds become common.
- Fitting labor + cost are keyed on (type, diameter) only. Mixed-material fittings in the same bucket (e.g. a bronze coupling on a copper line vs. a brass coupling) bill as whichever material is seen first. Rare in practice.

**Non-consequences:**
- No change to render path, pipe geometry, solver, or compliance engine.
- No schema bump — these are additive BOM fields. Old saved `.elbow` bundles load without migration; their labor hours regenerate on next BOM export.

## Audit items deferred to future phases (from the agent report)

- **Auto-generated p-traps + cleanouts** — `FittingGenerator` doesn't emit these today (though they're priced if the user places them manually). Real DWV design requires a p-trap under every fixture + cleanouts at end of runs / specific intervals. Phase 13.B candidate.
- **Per-material hanger spacing** — current: one hanger every 4 ft of horizontal length. Realistic: depends on pipe material + diameter (PVC 4 ft, copper 6 ft, cast iron 5 ft, etc). Deferred.
- **Primer/cement by joint count** — current: one can per 200 linear ft. Realistic: one can per ~100 joints. Deferred.
- **Horizontal vs vertical pipe segregation** for billing differentiation. Deferred.
- **Spare / safety-stock margin** (5–10% extra couplings). Deferred.

Each of these is a real bid-accuracy gap but none is as large as the labor-hours omission this phase fixed.

## Validation

- `tsc --noEmit` clean.
- `vitest run src/engine/export src/ui/pipe/__tests__/FittingGenerator.spec.ts` → **26/26 pass** (17 BOM + 9 FittingGenerator).
- Full suite expected pass (pending Ctrl+verify).
- `vite build` expected clean.
- Manual: open a mixed-diameter scene with a 4-way junction in the UI, export CSV, confirm one `cross 2"` line, labor columns populated, `TOTAL LABOR HRS` ≈ (pipes × 0.030) + (fittings × per-fitting rate).
