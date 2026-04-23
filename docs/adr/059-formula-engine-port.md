# ADR 059 — Formula Engine Port + Pricing Formula Overrides (Phase 14.AB.1)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AB.1
- **Depends on:** ADR 032 (Bid pricing engine) + PricingProfile.
- **Source:** ported from `C:\LOVEDECIDES\WiDecide\lib\services\formula_engine.dart`.

## Context

Audit of the LOVEDECIDES workspace (`C:\LOVEDECIDES\`) identified
seven potentially-portable features. After filtering for fit +
feasibility:

| Candidate | Decision | Reason |
|---|---|---|
| **Shunting-yard formula engine** (WiDecide) | **PORT** | Pure code, zero deps, immediately useful for contractor pricing overrides |
| Wi-Fi LAN sync server | SKIP | Rust/Node side needs a whole HTTP server stack; Tauri doesn't embed Dart's `shelf` |
| Receipt OCR | SKIP | Requires Tesseract external dep; out-of-process complexity not worth it here |
| Python process bridge | SKIP | Rewrite doesn't ship Python; rewriting the heavy math in TS was already done (AdaptiveSolver, PCSP, FrictionSolvers) |
| Data ingestion orchestrator | CONSIDER | Useful for vendor price-list imports; deferred to 14.AC |
| Lead gen / property search | SKIP | Real-estate domain, no plumbing fit |
| Personal finance ledger | SKIP | Not applicable |

The formula engine alone is high-ROI: it's a self-contained ~200
LOC that unlocks contractor-specific pricing formulas on the BOM
side.

## Decision

Port the Dart shunting-yard evaluator to TypeScript + wire it into
the pricing profile's fitting-cost lookup.

### 1. `src/core/formula/formulaEngine.ts` — pure evaluator

Same grammar + unary-minus handling as the Dart version, but:

- **Typed variables**: `FormulaVariables = Record<string, number>`
  instead of Dart's `Map<String, dynamic>` with runtime $/comma
  stripping.
- **Discriminated-union result**: `FormulaResult = { ok: true;
  value } | { ok: false; error }`. The Dart version swallowed
  errors and returned 0, which would silently mis-price BOM rows.
  This port fails loudly so the caller can choose fallback
  behavior.
- **Divide-by-zero** returns `{ ok: false, error: 'divide by zero' }`
  (Dart returned 0).
- **Unknown-variable detection** aggregates all missing names into
  a single error string — makes debugging multi-variable formulas
  faster.
- **`parseCurrencyNumber` + `aggregate` helpers** preserved from
  the Dart version (for spreadsheet-shaped data).

Grammar supported:

```
expr    = term ( ('+' | '-') term )*
term    = factor ( ('*' | '/') factor )*
factor  = '-'? ( number | '[' ident ']' | '(' expr ')' )
ident   = [any char except ']'] +
```

Identifiers with spaces work out of the box (`[Material Cost]`),
matching spreadsheet conventions the user's original Dart code
relied on.

### 2. `PricingProfile.costFormulaOverrides`

New optional field on `PricingProfile`:

```ts
costFormulaOverrides?: Record<string, string>;
```

Keyed by `FittingType` string (e.g. `'elbow_90'`). Each value is a
formula expression. Available variables in scope:

| Variable | Source |
|---|---|
| `[materialCost]` | Catalog price for this type + diameter |
| `[laborHours]` | Catalog labor hours for this type + diameter |
| `[diameter]` | Pipe diameter (inches) |
| `[quantity]` | Count of this fitting in the BOM |
| `[laborRate]` | The profile's `laborRateUsdPerHr` |

### 3. `fittingCostWithOverride` in BOMExporter

Exported helper:

```ts
fittingCostWithOverride(type, diameter, quantity, profile) → number
```

- No formula → catalog cost
- Empty / whitespace formula → catalog cost
- Valid formula → `evaluateFormula(expr, vars).value`
- Malformed / unknown-variable / divide-by-zero → catalog cost
  (silent fallback, **not** a BOM error — we'd rather ship a bid
  than block one on a bad override)

`generateBOM` uses this helper for every fitting row when a
pricing profile is passed.

### Example pricing overrides

| Use case | Formula |
|---|---|
| 20% markup + $5 handling | `[materialCost] * 1.2 + 5` |
| Roll labor into unit price | `[materialCost] + [laborHours] * [laborRate]` |
| Size-premium | `[materialCost] * (1 + [diameter] / 10)` |
| Volume discount | `[materialCost] * (1 - [quantity] / 100)` (capped in formula) |
| Fixed override | `42` (just a number) |

## Trade-offs

- **Silent fallback on malformed formulas.** Deliberately chosen —
  a BOM should always produce a price. A future "validate profile"
  button in the Pricing Profile panel could surface formula errors
  to the user explicitly; for now the bid completes with catalog
  pricing on the affected rows.
- **Formulas are per-fitting-type, not per-diameter.** A single
  formula applies to ALL diameters of a type. If a contractor
  wants diameter-tiered pricing they use `[diameter]` in the
  formula. Explicit per-diameter overrides would need a nested
  record + more schema churn.
- **No labor-hour override.** Only cost is formula-driven; labor
  hours stay on the catalog lookup. Rationale: labor is a
  physical-work metric, not a pricing choice — it belongs to
  install spec, not contractor pricing. If the user wants to
  inflate labor-hour billing, the formula `[materialCost] +
  [laborHours] * [laborRate] * 1.2` is the right place.
- **No UI yet.** 14.AB.1 ships the plumbing (pun intended). An
  editor in `PricingProfilePanel` is a natural 14.AB.2 candidate —
  a textarea per fitting type with a "test formula" preview. Not
  required for the engine to work; contractors can set overrides
  via JSON import.

## Verification

- `npx vitest run` — 1320 tests pass (1274 prior + 46 new: 36
  unit + 10 integration).
- `npx tsc -b --noEmit` — clean.
- Integration:
  - No override → BOM uses catalog prices (regression guard).
  - Override present → BOM uses formula result.
  - Malformed override → BOM falls back to catalog (silent
    + logged at debug level via evaluateFormula's result).
  - Per-type override: `elbow_90` overridden doesn't affect
    `bend_45` pricing.

## Files

- `src/core/formula/formulaEngine.ts` — 255 LOC pure module.
- `src/core/formula/__tests__/formulaEngine.spec.ts` — 36 tests.
- `src/engine/export/computeBid.ts` — `costFormulaOverrides` field
  added to `PricingProfile`.
- `src/engine/export/BOMExporter.ts` — `fittingCostWithOverride`
  exported + used in `generateBOM`'s fitting loop.
- `src/engine/export/__tests__/fittingCostWithOverride.spec.ts` —
  10 integration tests.
- `docs/adr/059-formula-engine-port.md` — this document.

## What's queued from LOVEDECIDES

- **14.AB.2 — Vendor price-list CSV importer** (the data-ingestion
  orchestrator). Map CSV columns to fitting types, import into a
  pricing profile. High utility for contractors who buy material
  at bulk from specific suppliers.
- **14.AB.3 — Formula editor UI** in `PricingProfilePanel` with
  per-formula live-eval preview + error display.

Each is a standalone phase. Roadmap continues when user asks.
