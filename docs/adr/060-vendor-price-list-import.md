# ADR 060 — Vendor Price-List CSV Importer (Phase 14.AB.2)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AB.2
- **Depends on:** ADR 059 (formula engine), 14.AB.1
  (`costFormulaOverrides` field).

## Context

14.AB.1 shipped formula-driven pricing (formulas like
`[materialCost] * 1.2 + 5`). That works for **rules**, but
contractors also want **concrete vendor quotes**: "my Ferguson 2"
elbow is $5.85 each — use that exactly."

Drop a CSV from the vendor's portal → map columns → the active
pricing profile carries those prices. 14.AB.2 ships that flow.

## Decision

Three pure modules + a priority update to the BOM cost lookup.

### 1. `src/core/import/csvParser.ts`

Minimal RFC 4180 parser. Zero deps.

```ts
parseCsv(text, options?) → string[][]
parseCsvAsObjects(text, options?) → { headers, rows: Record<string, string>[] }
```

Covers the cases real vendor CSVs actually ship with:

- Quoted fields containing commas, quotes, or newlines
- Escaped quotes (`""` inside quoted cells)
- CRLF + LF line endings
- UTF-8 BOM on the first cell (Excel exports)
- Trailing empty rows (stripped)

19 tests lock these cases.

### 2. `src/core/import/priceListMapper.ts`

```ts
mapPriceListRows(rows, mapping) → PriceListImportResult
mergePriceOverrides(existing, imported, strategy) → FittingPriceOverrides
```

Two key primitives:

- **`resolveCanonicalType(raw, aliases)`** — normalizes vendor
  type identifiers (`ELBOW_90_DEG`, `elbow-90`, `ELL_90`)
  against our canonical `FittingType` set. Accepts a vendor-
  specific alias map for typical vendor-speak.
- **`parseDiameter(raw, aliases)`** — handles every format
  vendors ship:
  - Decimals (`0.75`, `2`, `4.0`)
  - Simple fractions (`3/4`, `1/2`)
  - Mixed fractions (`1-1/2`, `1 1/2`, `2-1/2`)
  - Inch suffixes (`2"`, `3/4"`, `2 in`, `3 inches`)
  - Custom aliases (`19mm → 0.75`, `25mm → 1`)

Every row that doesn't map cleanly becomes a `PriceListImportWarning`
with a specific reason code (`unknown_type`, `unknown_diameter`,
`invalid_price`). The UI can surface these for the contractor to
correct without blocking the import.

Three merge strategies:

| Strategy | Behavior |
|---|---|
| `replace` | Imported entries overwrite existing entries of the same `(type, diameter)`. Untouched existing entries survive. |
| `skip_existing` | Imported entries added only where no existing entry is present. Useful for "add new vendor items without touching what I've already tuned." |
| `overwrite_all` | Every prior entry is wiped; profile carries only the imported set. Useful for annual price-list refreshes. |

25 tests lock mapping + merge behavior.

### 3. `PricingProfile.fittingPriceOverrides`

New optional field:

```ts
fittingPriceOverrides?: Record<FittingType, Record<number, number>>;
//                                         ^ diameter ^ price USD
```

Example imported from a CSV:

```ts
{
  elbow_90: { 2: 5.85, 3: 12.00, 4: 22.50 },
  bend_45:  { 2: 4.50, 3: 10.00 },
  pex_elbow_90: { 0.75: 4.80, 1: 7.50 },
}
```

### 4. Three-tier priority in `fittingCostWithOverride`

Priority order when computing a fitting's unit cost:

```
1. profile.fittingPriceOverrides[type][diameter]   (top — vendor quote)
2. profile.costFormulaOverrides[type]              (formula engine)
3. FITTING_COSTS[type][diameter]                   (catalog default)
```

Rationale:

- A concrete quoted price from a vendor IS the contractor's real
  cost. Neither a markup formula nor a generic catalog should
  override it.
- Zero is a valid override (contractor might have a free-goods
  promotional line).
- Negative / non-finite values fall through to the next tier
  (corrupt-data guard).

9 integration tests lock the priority.

## Trade-offs

- **No diameter-alias inference across the whole catalog.** If the
  vendor ships `1-1/4"` but our catalog only has `1.25` entries,
  the mapper matches them. But if the vendor's `1/8 bend` (their
  parlance for 45° bend) isn't in the type aliases, the row is
  dropped. The mapping UI can expose an alias-editing panel later
  — 14.AB.3 is a candidate.
- **No diameter rounding / nearest-match.** Ferguson's `2" SCH 40
  elbow` vs our catalog's `2.0" elbow` — exact match required.
  For vendors whose diameters are `1.5001` rounding issues, the
  first user report prompts a match-within-1% policy.
- **No bulk-import UI yet.** Ship the pure modules + wire-up +
  tests. A "drop CSV → column-mapping dialog → review warnings →
  merge" modal is 14.AB.3.
- **Per-type overrides remain formula-only.** `costFormulaOverrides`
  is still a per-TYPE map (no diameter key); the new
  `fittingPriceOverrides` is per-TYPE + per-DIAMETER. The two
  live side-by-side. If a contractor wants diameter-specific
  formulas they use `[diameter]` in a formula or just import
  explicit prices.

## Verification

- `npx vitest run` — 1373 tests pass (1320 prior + 53 new: 19
  csvParser + 25 priceListMapper + 9 priority).
- `npx tsc -b --noEmit` — clean.
- Manual: a CSV import flow isn't wired to the UI yet. Pure
  modules are usable today via the future dialog / import JSON.

## Files

- `src/core/import/csvParser.ts` — 140 LOC.
- `src/core/import/priceListMapper.ts` — 215 LOC.
- `src/core/import/__tests__/csvParser.spec.ts` — 19 tests.
- `src/core/import/__tests__/priceListMapper.spec.ts` — 25 tests.
- `src/engine/export/computeBid.ts` — `fittingPriceOverrides`
  field added to `PricingProfile`.
- `src/engine/export/BOMExporter.ts` — `fittingCostWithOverride`
  now checks priceOverrides → formula → catalog in that order.
- `src/engine/export/__tests__/fittingPricePriority.spec.ts` —
  9 priority tests.
- `docs/adr/060-vendor-price-list-import.md` — this document.

## What's queued

- **14.AB.3** — UI: CSV import dialog with column mapping
  dropdowns + merge-strategy picker + warnings display + live
  preview of the mapped rows. Will consume the pure mapper
  unchanged.
- **14.AB.4** — Alias library (save vendor-specific aliases per
  `PricingProfile` so re-imports from Ferguson/HD Supply use the
  same translation without reconfiguring).
