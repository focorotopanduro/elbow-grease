# ADR 032 — Bid-Ready Pricing Engine (Phase 14.A)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 14.A
- **Depends on:** ADR 030 (BOM Accuracy), ADR 031 (BOM Data Freshness).

## Context

After Phase 13.A/B the BOM is structurally accurate: every pipe + fitting has correct material cost and labor hours, 4-way crosses are detected, subtotals reconcile, 151 coverage tests lock it in. What a contractor gets from the current export is:

> "45.2 hours labor, $1,240 material, 12% waste"

What a contractor needs in order to hand a quote to a customer:

> "Bid: $3,475"

The missing layer is the contractor's own bid-math inputs — their hourly rate (not an industry average), overhead markup, profit margin, and sales tax. Without these, the app stops one step short of being a bid tool.

For the user's context (Orlando FL residential plumbing), the defaults must reflect FL rules: **sales tax applies to material but not to new-residential labor**. This is a common source of over-bidding in off-the-shelf estimators that assume every line is taxable.

## Decision

Ship three pure modules + one panel:

### 1. `computeBid.ts` — pure math

```ts
function computeBid(bom: BOMReport, profile: PricingProfile): BidResult;
```

Pure function. No React, no Zustand, no Three.js. Order of operations:

```
1. rawMaterialCost    ← BOM.grandTotal
2. rawLaborHours      ← BOM.grandLaborHours
3. rawLaborCost       ← rawLaborHours × profile.laborRateUsdPerHr
4. markedUpMaterial   ← raw × (1 + overhead)
5. markedUpLabor      ← raw × (1 + overhead)
6. preTaxSubtotal     ← markedUpMaterial + markedUpLabor
7. taxableBase        ← (taxOnMaterial ? markedUpMaterial : 0)
                       + (taxOnLabor ? markedUpLabor : 0)
8. taxAmount          ← taxableBase × salesTaxPercent
9. preMarginTotal     ← preTaxSubtotal + taxAmount
10. marginAmount      ← preMarginTotal × profitMarginPercent
11. grandTotal        ← preMarginTotal + marginAmount
```

### Why this order

- **Overhead FIRST, tax SECOND.** Tax has to apply to the real selling price of material, not just the contractor's cost. Applying overhead after tax would undertax the bid.
- **Margin LAST, on the subtotal-plus-tax.** Contractor's profit is on the full exposed value of the job. This is the standard FL residential convention; commercial bidding sometimes embeds margin in overhead instead — a future profile flag can expose "margin mode" if needed.
- **Tax flags are INDEPENDENT.** Florida new-residential construction: `taxOnMaterial: true`, `taxOnLabor: false`. Repair work is different. Commercial is different. Other states are different. The profile makes it explicit rather than hardcoding a rule.

### Hand-calculated baseline (tested)

```
$1000 raw material, 10 hours at $95/hr, 15% overhead, 20% margin, 6.5% tax (mat only):
  rawLaborCost       = 950.00
  markedUpMaterial   = 1150.00
  markedUpLabor      = 1092.50
  preTaxSubtotal     = 2242.50
  taxableBase        = 1150.00
  taxAmount          = 74.75
  preMarginTotal     = 2317.25
  marginAmount       = 463.45
  grandTotal         = 2780.70  ← what the customer sees
```

The unit test file (`computeBid.spec.ts`) encodes every intermediate step with `toBeCloseTo(4)` precision. A refactor that changes math produces a per-step failure, not a silent grand-total drift.

### 2. `pricingStore.ts` — single active profile

Simple Zustand store with one `profile: PricingProfile`. Seeded with `FL_RESIDENTIAL_DEFAULT` on first boot. Edits persist to localStorage. `getActivePricingProfile()` is the non-React getter consumed by `ExportPanel` when assembling CSV/JSON exports.

Why single-profile: 90% of solo contractors use one rate book. Per-customer overrides + multi-profile library are real needs but v2 scope — not forcing a selection UI on a solo user who just wants to set their rate and bid.

### 3. `BOMExporter` integration

`generateBOM(pipes, fittings, profile?)` — when `profile` is present, the returned `BOMReport` carries an additional `bid: BidResult` field. When omitted (tests, programmatic consumers), the raw take-off is unchanged.

`bomToCSV` appends a BID SUMMARY section when `report.bid` is present. Main BOM rows are unchanged, so an Excel import that reads the material table without the bid summary still works.

### 4. `PricingProfilePanel` — the editor

Modal triggered by `Ctrl+Shift+B` ("Bid"). Focus-trapped, Escape-closable.

Fields:
- Labor rate ($/hr) — must be the BURDENED rate (payroll + WC + benefits)
- Overhead markup % — shown/edited as %, stored as decimal
- Profit margin % — same
- Sales tax rate % — same; defaults to 6.5% (FL + Orange County)
- Tax on material (checkbox, default on)
- Tax on labor (checkbox, default off)
- Notes (textarea)
- "Reset to FL default" button with confirm
- "Done" button

**Live preview strip** at the bottom: shows what a hypothetical $1000 material + 10-labor-hour scene would bid at with the current profile. Updates every keystroke. Gives the user immediate feedback for "does a 1% rate change actually move the bid?"

## Consequences

**Good:**
- The app goes from "accurate takeoff" to "bid-ready" in ~4 hours of work. This is the final piece that makes BOM exports actually submittable as customer quotes.
- 31 hand-calculated tests pin every math step. No silent drift under refactor.
- Pure module isolation: `computeBid` imports nothing runtime-related (React, Zustand). Can be re-used in a future CLI, headless batch processor, or server-side quote generator.
- FL rules aren't hardcoded — they're in the default profile. A contractor working under different rules (NY, TX, commercial) edits the profile; the math stays correct.
- Store's `updatedAt` stamp on every edit gives an audit trail of when rates changed.

**Accepted costs:**
- Labor rate is flat (single class). Multi-class (journeyman / helper / apprentice) is a clear v2 enhancement; the current model is correct for solo contractors or contractors bidding at a blended rate.
- Sales-tax rule is two-booleans (material + labor). Some jurisdictions have partial-taxability (e.g. labor taxable above N%, full taxable on certain fixture installs). The two-boolean model covers 95% of FL cases without adding cognitive load; complex cases would need a v2 "tax engine" with rule expressions.
- No per-customer pricing override yet. A contractor with two very different rate structures for commercial vs residential has to manually swap profiles.

**Non-consequences:**
- No changes to render path, BOM data, or existing fitting/material tables. This phase is pure downstream math.
- No schema bump on bundles. Bid is computed on-demand at export time, not saved into the `.elbow` bundle. A future phase can snapshot the profile at bid-time into the bundle for contract-lock purposes.

## Alternatives considered

**Embed margin inside overhead (no separate margin line).** Some contractors do this — a flat 30% markup that covers both overhead and profit. Rejected as default because separating the two gives the user visibility + control: they can see what's "cost of doing business" vs "profit." A future profile flag can expose "combined markup mode" if users prefer.

**Apply tax BEFORE overhead.** Undertaxes the bid (tax on contractor's cost, not selling price). Against FL rule. Rejected.

**Apply margin BEFORE tax.** Technically some commercial contractors do this. Rejected as default because FL residential convention is tax on the material subtotal, margin on the pre-margin total. Configurable as a future option if needed.

**Hardcode FL rules, skip profile config.** Rejected — an Orlando contractor working on one Alabama job would silently over-bid. The profile makes the jurisdiction explicit.

**Live-update the BOM as the profile changes.** Rejected for UI simplicity — the profile panel's preview strip shows the delta for a standard sample scene; the real BOM re-bills when the user exports. Saves per-frame recomputation on every rate keystroke.

## Validation

- `Vitest`:
  - `src/engine/export/__tests__/computeBid.spec.ts` — **31 tests** covering golden hand-calculated scenario (every step), empty BOM, tax flag combinations (on/off/both), 0% overhead, 0% margin, high-overhead + high-margin stacking, profile snapshot isolation, FL_RESIDENTIAL_DEFAULT sanity, CSV formatting, invariants (subtotal + tax = preMargin, preMargin + margin = grand, rate scales labor linearly).
  - Existing `BOMExporter.spec.ts` + `BOMDataCoverage.spec.ts` still pass.
- `tsc --noEmit` clean (pending).
- `vite build` clean (pending).
- Manual plan:
  - Open the app, press Ctrl+Shift+B, edit labor rate to $100/hr.
  - Preview strip immediately shows updated bid total.
  - Close panel, draw some pipes, export CSV — file contains a BID SUMMARY section with the contractor's numbers.
  - Edit the profile, re-export — new CSV reflects new rates.
