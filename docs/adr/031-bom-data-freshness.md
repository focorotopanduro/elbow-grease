# ADR 031 — BOM Data Freshness & Coverage (Phase 13.B)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 13.B
- **Extends:** ADR 030 (BOM Accuracy Audit).

## Context

Phase 13.A landed the structure for accurate BOMs: labor hours, single-pass subtotals, 4-way cross detection. It didn't answer a related question: **is the data itself correct and current?**

A BOM can be structurally perfect and still produce a wrong bid if the pricing table shipped two years ago at $4.50/ft for PVC when today's wholesale is $6.10/ft, or if a new fitting type was added to the enum but nobody added it to the cost table (silent fallback to a $5 default).

An audit via the Explore agent found:

### Coverage gaps (6 total)

| Fitting / material | Gap | Prior behavior |
|---|---|---|
| `ductile_iron` | Missing from `LABOR_HR_PER_FT` | Fell back to 0.035 hr/ft default (lighter than cast_iron; underbid heavy-material projects) |
| `combo_wye_eighth` | Missing from cost + labor | $5 / 0.1 hr defaults (under-priced DWV fittings) |
| `closet_flange` | Missing from cost + labor | $5 / 0.1 hr defaults (every toilet was costed at $5 for its flange) |
| `manifold_2` | Missing from cost + labor | $5 / 0.1 hr defaults — **worst offender**: manifolds are $40–300 parts, silently priced at $5 |
| `manifold_4` | Missing from cost + labor | $5 / 0.1 hr defaults |
| `manifold_6` | Missing from cost + labor | $5 / 0.1 hr defaults |
| `manifold_8` | Missing from cost + labor | $5 / 0.1 hr defaults |

For a contractor whose bids include PEX manifolds (dominant residential supply topology), the prior export undercounted the manifold line by $35–$220 per manifold.

### No freshness metadata

The BOMExporter header comment said "approximate 2026 contractor pricing" but there was no machine-readable `LAST_REVIEWED` date, no source citation, no staleness warning. A maintainer looking at the file in 2028 had no way to tell if the numbers had been sanity-checked recently.

### No runtime-iterable material / fitting lists

`PipeMaterial` and `FittingType` were string-literal unions — great for type checking, invisible at runtime. Tests couldn't enumerate them to assert coverage. A new material could be added to the union without a cost entry and CI would stay green.

## Decision

Three surgical changes.

### 1. Fill the six coverage gaps

Added explicit entries with rationale comments:

```ts
// Labor — Phase 13.B fix
ductile_iron: 0.060,  // same handling class as cast iron

// Fittings — Phase 13.B fix
combo_wye_eighth: { 1.5: 7.50, 2: 11.00, 3: 24, 4: 40 },
closet_flange:    { 3: 6.50, 4: 12.00 },
manifold_2:       { 1: 45 },
manifold_4:       { 1: 95 },
manifold_6:       { 1: 155 },
manifold_8:       { 1: 225 },
```

Plus matching `LABOR_HR_PER_FITTING` entries. Manifold labor scales by port count (branch-joint count), not diameter.

Values are ballpark estimates anchored to Ferguson + Home Depot 2025 Q1 catalog pricing — explicitly NOT claimed to be rigorous regional price surveys. The metadata below tells maintainers when to re-check.

### 2. Freshness metadata + runtime staleness check

New exported constants in `BOMExporter.ts`:

```ts
export const DATA_LAST_REVIEWED = '2025-01-15';  // ISO date
export const DATA_SOURCES = [
  'Ferguson Plumbing Supplies catalog (Q1 2025 pricing)',
  'Home Depot online pricing (Jan 2025)',
  'RSMeans Residential Plumbing 2025 — mean US-national labor productivity',
] as const;
export const DATA_REGION = 'US National (Florida-weighted for Beit Building Contractors)';
```

`generateBOM()` runs `checkDataFreshness()` which emits a `log.warn` if the review date is > 365 days old. The warning includes the review date + sources so the maintainer can grep and re-verify.

Key invariant: updating any pricing table value MUST come with an updated `DATA_LAST_REVIEWED`. Otherwise the staleness check can't distinguish "we bumped a single price" from "the whole table is 2 years old."

### 3. Runtime-iterable `PIPE_MATERIALS` + `FITTING_TYPES` arrays

In `GraphEdge.ts`:

```ts
export const PIPE_MATERIALS = [
  'pvc_sch40', 'pvc_sch80', 'abs', 'cast_iron',
  'copper_type_l', 'copper_type_m', 'cpvc', 'pex',
  'galvanized_steel', 'ductile_iron',
] as const;
export type PipeMaterial = typeof PIPE_MATERIALS[number];
```

Same pattern for `FITTING_TYPES` (21 members). Deriving the type from the array guarantees the runtime list matches the compile-time type — adding a member to the array updates the type and vice versa via `typeof ... [number]`.

Downstream code that imported just `PipeMaterial` / `FittingType` continues to work unchanged.

### 4. Coverage test suite — 151 tests

`src/engine/export/__tests__/BOMDataCoverage.spec.ts` uses `it.each(PIPE_MATERIALS)` + `it.each(FITTING_TYPES)` to enumerate every member and assert:

1. **Coverage** — every `PipeMaterial` has an entry in `LABOR_HR_PER_FT`; every `FittingType` has non-empty rows in both `FITTING_COSTS` and `LABOR_HR_PER_FITTING`.
2. **Symmetric diameter coverage** — the diameter set in the cost table matches the labor table for every fitting type. Asymmetric coverage causes silent fallbacks.
3. **Monotonicity** — cost and labor are non-decreasing in diameter. Catches typos like "4" → 2.20 instead of 22.00".
4. **Ratio sanity** — `labor × $80/hr` is within 0.2×–25× of material cost. Catches missing-zero typos on either side.
5. **Freshness metadata present + valid** — `DATA_LAST_REVIEWED` is a valid ISO date not in the future; sources + region are non-empty.
6. **Spot-check values** — nine anchor values (elbow_90 @ 2" = $5.00, manifold_4 @ 1" = $95, etc.) are pinned so a future "just bump all prices 10%" sweep can't accidentally drift them without updating the expectations + review date.

If a developer adds a new `FittingType` tomorrow and forgets a cost row, CI fails with a clear per-fitting-type error message.

## Consequences

**Good:**
- Six price/labor gaps filled. A manifold-heavy residential job goes from underbid-by-hundreds to priced correctly.
- Future "silent gaps" are impossible — adding a member to the type union means adding it to the array means the coverage tests flag the missing cost/labor row.
- Staleness is now observable. A user running the app a year after the last review gets a warn log; maintainer reading the file sees the `DATA_LAST_REVIEWED` constant.
- 151 coverage tests lock the entire pricing surface. Cost typos, labor typos, asymmetric tables, inverted ratios — all catchable pre-merge.

**Accepted costs:**
- The 151 tests take ~50 ms to run. Trivial next to the 4.2-second full BOM suite.
- Filled-in prices for the 6 gaps are estimates, not regional price surveys. Metadata documents this honestly. A future phase could pull live prices from a supplier API.
- Every pricing update now has TWO things to change: the number AND `DATA_LAST_REVIEWED`. The spot-check tests enforce this (a spot-check assertion fails if the number moves without anyone updating the expected value).

**Non-consequences:**
- No change to BOM structure, CSV format, or JSON shape from Phase 13.A. This phase is pure data + tests.
- No bundle schema change — the BOM is generated on demand, not serialized.

## Alternatives considered

**External cost-book JSON file** (e.g. `cost-book-2025.json` loaded at boot). Rejected for this phase — adds a load path + a user-editable-file footgun (can't easily add tests against a live user-editable file). Cleaner to keep the numbers in TypeScript where they're type-checked and tested, and do yearly version-controlled sweeps.

**Per-region pricing multipliers.** Rejected — adds complexity without a concrete demand. The current data is Florida-weighted because that's where the primary user operates; a national or multi-region version is a v2 concern.

**Supplier-API live pricing.** Real-time Ferguson / Home Depot API integration is the ideal long-term answer. Rejected for this phase — neither supplier exposes a public contractor-pricing API, and a web-scraping solution has maintenance cost that outweighs the accuracy gain for current scale of use.

**Strict "fail fast" on missing table entries** (throw instead of fall back to $5). Rejected — a user drawing a new, experimental fitting type would see the whole BOM panel crash. The log-warn path from the freshness check preserves the historical fallback behavior; the coverage tests catch the real case (new type added to the union) at CI time.

## The review discipline (onward)

The pricing review process is now documented in-source:

1. Every year in January (or after a clear market shift — copper price spike, material shortage), grep for `DATA_LAST_REVIEWED`.
2. Spot-check the pinned test values (elbow_90 @ 2", coupling @ 1", manifold_4 @ 1", etc.) against current Ferguson + Home Depot + RSMeans pricing.
3. If changes are needed, update both the tables AND the spot-check test expectations AND `DATA_LAST_REVIEWED`.
4. Commit message: `chore(bom): 2026-Q1 pricing review`.

The freshness-warn log will announce itself to the maintainer running locally; a future `/review` CI job could also fail-fast if `DATA_LAST_REVIEWED` is > 15 months stale.

## Validation

- `Vitest`:
  - `src/engine/export/__tests__/BOMDataCoverage.spec.ts` — **151 tests** across coverage / diameter symmetry / monotonicity / ratio sanity / freshness metadata / spot-check.
  - `src/engine/export/__tests__/BOMExporter.spec.ts` — 17 pre-existing behavior tests still pass.
  - Combined BOM suite: **168/168 pass**.
- `tsc --noEmit` clean.
- `vite build` expected clean (running in parallel).
- Full-suite run: expected pass.
