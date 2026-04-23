# ADR 070 — Fixture BOM Rollup (Phase 14.AC.10)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AC.10
- **Depends on:** ADR 066–069 (fixture graph scaffold → default on),
  ADR 030 (BOM accuracy), ADR 060 (fitting price override chain).

## Context

14.AC.9 flipped the `fixtureGraph` default on. Fixtures now reach
the solver DAG with real DFU / WSFU, and compliance output reflects
real load. But the BOM was unchanged — `generateBOM` still iterated
pipes + fittings, never touched fixtures. A 3-bath residential
bid showed pipes, fittings, supports, consumables, labor — and
zero dollars for the plumbing the whole project revolves around.

That was the largest single category missing from every real
contractor bid the app has produced. Fixing it is 14.AC.10.

## Decision

Three-part extension matching the fitting pricing pattern.

### 1. Two static lookup tables

`FIXTURE_COSTS: Record<string, number>` — per-unit mid-range
residential pricing for every `FixtureSubtype` the fixture store
supports. Ferguson + Home Depot Q1 2025, Florida-weighted via
the existing `DATA_SOURCES` block.

`LABOR_HR_PER_FIXTURE: Record<string, number>` — install labor
averages covering drain + trap + supply + set + leak check.
RSMeans 2025 mean productivity.

Zero-cost subtypes (dishwasher, clothes_washer) still carry labor
— contractor stubs for the customer-supplied appliance.

### 2. Three-tier override chain

Mirrors the fitting pattern (ADR 060):

```
1. profile.fixturePriceOverrides[subtype]           (vendor quote — top)
2. profile.fixtureCostFormulaOverrides[subtype]     (shunting-yard formula)
3. FIXTURE_COSTS[subtype]                           (catalog default)
```

Formula variables available: `[materialCost]`, `[laborHours]`,
`[quantity]`, `[laborRate]`. Example overrides:

- `fixturePriceOverrides: { water_closet: 249 }` — every toilet
  on this bid is the $249 Kohler Cimarron I quoted from Ferguson.
- `fixtureCostFormulaOverrides: { lavatory: '[materialCost] + [laborHours] * [laborRate]' }` —
  roll labor into a bundled "install-included" line item.

Zero is a valid override (promotional free-goods). Negative / NaN
/ Infinity fall through to the next tier — same corrupt-data guard
as fittings.

### 3. Extended `generateBOM` signature

```ts
generateBOM(
  pipes: CommittedPipe[],
  fittings: FittingInstance[],
  pricingProfile?: PricingProfile,
  opts?: GenerateBOMOptions,
  fixtures: FixtureInstance[] = [],   // NEW, default empty
): BOMReport
```

Fifth positional param with a default — every existing 3/4-arg
caller works without change. The three call sites that already
had `fixtureList` in scope (ExportPanel CSV export, ExportPanel
JSON export, printProposal, printBidPackage) pass it through.

### Output shape

Each distinct `subtype` produces one BOM line item:

```
category:      'fixture'
description:   'Water Closet'          (prettified subtype)
material:      'Fixture'               (static — no per-item variant yet)
size:          'standard'              (reserved for future subtype variants)
quantity:      <count>
unit:          'ea'
unitCost:      <from 3-tier chain>
totalCost:     unitCost × quantity
unitLaborHours:<from LABOR_HR_PER_FIXTURE>
laborHours:    unitLaborHours × quantity
partHint:      'FIXTURE-{SUBTYPE}'     (e.g. FIXTURE-WATER_CLOSET)
```

Items emit in stable alphabetical order by subtype so BOM diffs
across runs are readable.

### What the output looks like on a realistic bid

Three-bathroom residential (3 water_closet + 3 lavatory + 2
bathtub + 1 kitchen_sink + 1 dishwasher + 1 clothes_washer +
1 water_heater + 3 floor_drain + 1 hose_bibb):

- 9 new fixture line items, catalog-priced
- Material subtotal: ~$2,500 (was $0)
- Labor hours added: ~23 hr (was 0 for fixtures)
- At $80/hr burdened labor, that's ~$1,840 more labor cost

A ~$4,300 swing upward on a bid that was previously underbid by
the full fixture package. This is the correctness recovery.

## Trade-offs

- **No per-fixture variant tiers.** Today "water_closet" is one
  line. If the contractor sells a premium toilet + a basic
  toilet on the same job, they'd need to differentiate via
  fixtureStore `params` or a future subtype variant
  (`water_closet_premium` etc.). The override lever handles the
  common case (blanket quote per subtype); the variant case is
  a future extension.
- **Fixture labor is a flat per-unit number.** No rough-in vs.
  finish split, no multiplier for wall-mount vs. floor-mount.
  RSMeans averages cover the typical residential case. If
  commercial bids surface pain, a `laborMultiplier` param on
  the fixture or a subtype breakdown resolves it.
- **No BOM tax on fixtures beyond what the pricing profile's
  `taxOnMaterial` already applies.** Florida treats fixtures as
  material — the default profile is correct. Other jurisdictions
  may tax fixtures differently from pipe; if so, a
  `taxOnFixtures` flag mirrors the `taxOnLabor` pattern.
- **Stub fixtures (dishwasher / clothes_washer) price at $0.**
  Some contractors bid a "fixture set/hookup" labor line
  separate from the appliance — labor column captures this.
  Line description doesn't highlight "contractor-supplied vs
  customer-supplied"; a future UI polish can add an annotation.
- **The old "reserved but empty" `fixture` subtotal slot was
  already allocated** (BOMExporter.ts:517). This phase just
  fills it in without structural shape change — BOMReport
  consumers that already handled the field continue to work.

## Verification

- `npx vitest run` — 1534 tests pass (1516 prior + 18 new):
  9 core pricing / labor / aggregation tests, 6 override chain
  tests, 3 defensive / back-compat tests.
- `npx tsc -b --noEmit` — clean.
- Manual: CSV export from a scene with fixtures now shows the
  new lines. I did NOT verify the print path end-to-end; the
  BOMReport shape is unchanged so the PrintableProposal
  renderer picks up fixture lines through the same
  `bom.items` iteration it already does.

## Files

- `src/engine/export/computeBid.ts` — `PricingProfile` gains
  `fixturePriceOverrides` + `fixtureCostFormulaOverrides`.
- `src/engine/export/BOMExporter.ts` — `FIXTURE_COSTS` +
  `LABOR_HR_PER_FIXTURE` tables, `fixtureCatalogCost`,
  `fixtureCostWithOverride` (3-tier), `fixtureLaborHours`,
  `generateBOM` gains 5th `fixtures` param + emission loop.
- `src/ui/ExportPanel.tsx` — 2 call sites now pass `fixtureList`.
- `src/core/print/printProposal.ts` — passes `fixtures`.
- `src/core/print/printBidPackage.ts` — passes `fixtures`.
- `src/engine/export/__tests__/fixtureBOMRollup.spec.ts` —
  18 tests.
- `docs/adr/070-fixture-bom-rollup.md` — this document.

## What's queued

- **14.AC.11** — `fixtureStore.setPosition` emits
  `FIXTURE_MOVED`; bridge handles it as remove + re-add.
  Currently moving a placed fixture doesn't update its graph
  node position.
- **14.AC.12** — post-bake telemetry review after 2-4 weeks
  of AC.9 + AC.10 shipping. Validate that no shipped bids
  regressed in total price more than expected, and that
  compliance-warning counts stabilize.
- **14.AC.13** — per-subtype variant differentiation (premium
  vs basic toilet on the same bid) if customers ask.
