/**
 * computeBid — pure bid math on top of a BOMReport.
 *
 * Takes the raw material + labor output from generateBOM() and a
 * PricingProfile (the contractor's rate / overhead / margin / tax
 * configuration) and produces a bid-ready dollar breakdown the user
 * can hand to a customer.
 *
 * Order of operations (standard construction bid math):
 *
 *   1. Raw material cost ← Σ item.totalCost
 *   2. Raw labor hours   ← Σ item.laborHours
 *   3. Raw labor cost    ← rawLaborHours × profile.laborRateUsdPerHr
 *   4. Marked-up material ← raw × (1 + overhead)
 *   5. Marked-up labor    ← raw × (1 + overhead)
 *   6. Pre-tax subtotal   ← markedUpMaterial + markedUpLabor
 *   7. Taxable base       ← (taxOnMaterial ? markedUpMaterial : 0)
 *                          + (taxOnLabor    ? markedUpLabor    : 0)
 *   8. Tax                ← taxableBase × salesTaxPercent
 *   9. Pre-margin total   ← preTaxSubtotal + tax
 *  10. Margin amount      ← preMarginTotal × profitMarginPercent
 *  11. Grand total        ← preMarginTotal + marginAmount
 *
 * Why this order:
 *   • Overhead FIRST so tax applies to the real selling price of
 *     material, not just cost. Putting overhead after tax would
 *     undertax the bid.
 *   • Margin LAST, applied to the subtotal-plus-tax, so the contractor's
 *     profit is on the full exposed value of the job, not just cost.
 *     This is the standard FL-residential convention; commercial
 *     work sometimes embeds margin inside overhead instead — a future
 *     phase can add a "margin mode" flag if needed.
 *   • Tax applies to `taxOnMaterial` / `taxOnLabor` INDEPENDENTLY.
 *     Florida's rule for new residential construction: labor is
 *     generally not taxable, material is. For repair work some rules
 *     flip. Make this explicit per profile rather than hardcoding.
 *
 * Pure function — no React, no Zustand, no Three.js. The R3F consumer
 * imports it via BOMExporter.
 */

import type { BOMReport } from './BOMExporter';

// ── Pricing profile type ──────────────────────────────────────

export interface PricingProfile {
  /** Stable id for multi-profile futures. v1 has just one active. */
  id: string;
  /** Human-readable name ("FL Residential Default", "Commercial Markup"). */
  name: string;

  /**
   * Contractor's effective hourly labor rate (USD).
   * Should be the BURDENED rate — includes workers' comp, payroll tax,
   * benefits — not just the take-home wage.
   */
  laborRateUsdPerHr: number;

  /**
   * Overhead markup applied to BOTH material and labor before tax.
   * Expressed as a decimal (0.15 = 15%). Typical small-contractor
   * range: 10%–30%.
   */
  overheadMarkupPercent: number;

  /**
   * Profit margin applied to the pre-margin total (subtotal + tax).
   * Decimal (0.20 = 20%). Typical healthy-contractor range: 10%–25%.
   * Set to 0 if profit is already embedded in `overheadMarkupPercent`.
   */
  profitMarginPercent: number;

  /**
   * Combined state + local sales tax rate (decimal).
   * Florida state: 0.06; Orange County (Orlando) adds 0.005 → 0.065.
   * Other Florida counties vary from 0.06 to 0.075.
   */
  salesTaxPercent: number;

  /**
   * Is tax applied to the MATERIAL portion of the bid?
   * Florida: true. Set per-jurisdiction.
   */
  taxOnMaterial: boolean;

  /**
   * Is tax applied to the LABOR portion of the bid?
   * Florida new residential construction: false. Florida repair:
   * depends on the repair type. Check state rules.
   */
  taxOnLabor: boolean;

  /** Free-text notes (e.g. effective date, jurisdiction caveats). */
  notes?: string;

  /** ISO timestamp the profile was last edited. */
  updatedAt?: string;

  /**
   * Phase 14.AB.2 — static per-type + per-diameter price overrides,
   * populated by importing a vendor's CSV price list. Takes priority
   * OVER both the catalog default AND the formula override: when the
   * contractor has a concrete quoted price for an elbow, use that
   * exact number.
   *
   *   fittingPriceOverrides['elbow_90'][2] = 12.50
   *   → every 2" 90° elbow is $12.50 on this profile
   *
   * Missing entries fall through to formula → catalog.
   */
  fittingPriceOverrides?: Record<string, Record<number, number>>;

  /**
   * Phase 14.AB.1 — per-fitting cost formulas (ported from
   * LOVEDECIDES/WiDecide's shunting-yard formula engine).
   *
   * Keyed by `FittingType` string. When a formula is present + valid,
   * it OVERRIDES the static FITTING_COSTS table lookup. Available
   * variables in the formula:
   *
   *   [materialCost] — the default catalog cost
   *   [laborHours]   — default labor hours for this type + diameter
   *   [diameter]     — pipe diameter in inches
   *   [quantity]     — number of fittings of this type in the BOM
   *   [laborRate]    — the profile's laborRateUsdPerHr
   *
   * Example: `[materialCost] * 1.2 + 5` applies a 20% markup + $5
   * flat per fitting. `[materialCost] + [laborHours] * [laborRate]`
   * rolls labor into the per-unit price. Missing variable is a
   * no-op (falls back to static catalog).
   *
   * Blank string → ignored (same as absent key).
   */
  costFormulaOverrides?: Record<string, string>;

  /**
   * Phase 14.AC.10 — per-fixture-subtype price overrides.
   *
   * Keyed by `FixtureSubtype` string (`water_closet`, `lavatory`, …).
   * Takes precedence over both `fixtureCostFormulaOverrides` and the
   * static FIXTURE_COSTS catalog. Use when the contractor has a
   * concrete quoted price for a fixture — e.g. "all lavatories on
   * this bid are the $119 Kohler Memoirs basin."
   *
   * Missing subtype → fall through to formula → catalog default.
   * Zero is a valid override (contractor-supplied bid includes
   * free-goods). Negative / non-finite → fall through (corrupt-data
   * guard, same semantics as fitting overrides).
   */
  fixturePriceOverrides?: Record<string, number>;

  /**
   * Phase 14.AC.10 — per-fixture-subtype cost formulas. Same
   * shunting-yard engine as fittings. Available variables:
   *
   *   [materialCost] — the default catalog cost for the subtype
   *   [laborHours]   — default labor hours for the subtype
   *   [quantity]     — count of fixtures of this subtype
   *   [laborRate]    — profile's laborRateUsdPerHr
   *
   * Example: `[materialCost] * 1.15` applies a 15% markup across
   * every fixture. `[materialCost] + [laborHours] * [laborRate]`
   * rolls labor into the per-unit price (useful for bundled
   * install-included line items).
   *
   * Blank string → ignored.
   */
  fixtureCostFormulaOverrides?: Record<string, string>;
}

// ── Bid result ────────────────────────────────────────────────

export interface BidResult {
  // ── Raw inputs (pulled from BOM) ──
  /** Pre-markup material cost (sum of every BOM line's totalCost). */
  rawMaterialCost: number;
  /** Total labor hours from every BOM line. */
  rawLaborHours: number;
  /** rawLaborHours × profile.laborRateUsdPerHr. */
  rawLaborCost: number;

  // ── After overhead markup ──
  markedUpMaterial: number;
  markedUpLabor: number;
  /** Sum of markup dollars added to material + labor. */
  overheadAmount: number;

  // ── Subtotals ──
  preTaxSubtotal: number;   // markedUpMaterial + markedUpLabor
  taxableBase: number;      // subject to tax per profile flags
  taxAmount: number;        // taxableBase × salesTaxPercent
  preMarginTotal: number;   // preTaxSubtotal + taxAmount

  // ── Margin ──
  marginAmount: number;     // preMarginTotal × profitMarginPercent
  grandTotal: number;       // preMarginTotal + marginAmount

  // ── Audit trail ──
  /** Deep-copied snapshot of the profile used for this bid. Lets a saved
   *  bundle record WHICH pricing numbers produced WHICH bid total. */
  profileSnapshot: PricingProfile;
  /** ISO timestamp when the bid was computed. */
  computedAt: string;
}

// ── Main ──────────────────────────────────────────────────────

export function computeBid(bom: BOMReport, profile: PricingProfile): BidResult {
  // Step 1 + 2: raw totals from the BOM.
  const rawMaterialCost = bom.grandTotal;
  const rawLaborHours = bom.grandLaborHours;

  // Step 3: raw labor cost at the profile's rate.
  const rawLaborCost = rawLaborHours * profile.laborRateUsdPerHr;

  // Step 4 + 5: overhead applied to both.
  const overheadMul = 1 + profile.overheadMarkupPercent;
  const markedUpMaterial = rawMaterialCost * overheadMul;
  const markedUpLabor = rawLaborCost * overheadMul;
  const overheadAmount =
    (markedUpMaterial - rawMaterialCost) + (markedUpLabor - rawLaborCost);

  // Step 6: pre-tax subtotal.
  const preTaxSubtotal = markedUpMaterial + markedUpLabor;

  // Step 7 + 8: tax on the configured components.
  const taxableBase =
    (profile.taxOnMaterial ? markedUpMaterial : 0) +
    (profile.taxOnLabor ? markedUpLabor : 0);
  const taxAmount = taxableBase * profile.salesTaxPercent;

  // Step 9: pre-margin total.
  const preMarginTotal = preTaxSubtotal + taxAmount;

  // Step 10 + 11: margin applied to pre-margin; grand total.
  const marginAmount = preMarginTotal * profile.profitMarginPercent;
  const grandTotal = preMarginTotal + marginAmount;

  return {
    rawMaterialCost,
    rawLaborHours,
    rawLaborCost,
    markedUpMaterial,
    markedUpLabor,
    overheadAmount,
    preTaxSubtotal,
    taxableBase,
    taxAmount,
    preMarginTotal,
    marginAmount,
    grandTotal,
    profileSnapshot: { ...profile },
    computedAt: new Date().toISOString(),
  };
}

// ── Default profile (FL residential) ──────────────────────────

/**
 * Conservative FL residential defaults, suitable as the initial seed
 * for a new installation. The user SHOULD edit these to match their
 * actual burdened rate + overhead structure before submitting real bids.
 */
export const FL_RESIDENTIAL_DEFAULT: PricingProfile = {
  id: 'fl-residential-default',
  name: 'FL Residential Default',
  laborRateUsdPerHr: 95,           // journeyman burdened, 2025 Orlando avg
  overheadMarkupPercent: 0.15,     // 15% — small-contractor typical
  profitMarginPercent: 0.20,       // 20% — healthy residential margin
  salesTaxPercent: 0.065,          // FL 6% + Orange County 0.5%
  taxOnMaterial: true,
  taxOnLabor: false,               // new residential construction in FL
  notes:
    'Seed values — update laborRateUsdPerHr to your actual burdened rate ' +
    'before using for real bids. Tax rate is Orange County (Orlando); ' +
    'other FL counties range 6.0%–7.5%.',
  updatedAt: '2025-01-15',
};

// ── CSV formatting helpers ────────────────────────────────────

/**
 * Render the bid result as rows to append at the bottom of the BOM CSV.
 * Returns an array of CSV lines (without trailing newlines). The caller
 * joins them with \n and appends to the main CSV body.
 */
export function bidToCSVRows(bid: BidResult): string[] {
  const p = bid.profileSnapshot;
  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const usd = (n: number) => `$${n.toFixed(2)}`;

  return [
    '',
    ',,,,,,═══ BID SUMMARY ═══',
    `,,,,,,Profile:,${p.name}`,
    `,,,,,,Labor rate:,${usd(p.laborRateUsdPerHr)}/hr`,
    `,,,,,,Overhead markup:,${pct(p.overheadMarkupPercent)}`,
    `,,,,,,Profit margin:,${pct(p.profitMarginPercent)}`,
    `,,,,,,Sales tax:,${pct(p.salesTaxPercent)} ` +
      `(mat:${p.taxOnMaterial ? 'Y' : 'N'} lab:${p.taxOnLabor ? 'Y' : 'N'})`,
    '',
    `,,,,,,Raw material:,${usd(bid.rawMaterialCost)}`,
    `,,,,,,Raw labor (${bid.rawLaborHours.toFixed(2)} hrs):,${usd(bid.rawLaborCost)}`,
    `,,,,,,Marked-up material:,${usd(bid.markedUpMaterial)}`,
    `,,,,,,Marked-up labor:,${usd(bid.markedUpLabor)}`,
    `,,,,,,Overhead (included):,${usd(bid.overheadAmount)}`,
    `,,,,,,Pre-tax subtotal:,${usd(bid.preTaxSubtotal)}`,
    `,,,,,,Tax (on ${usd(bid.taxableBase)}):,${usd(bid.taxAmount)}`,
    `,,,,,,Pre-margin total:,${usd(bid.preMarginTotal)}`,
    `,,,,,,Margin:,${usd(bid.marginAmount)}`,
    `,,,,,,BID TOTAL:,${usd(bid.grandTotal)}`,
    `,,,,,,Computed:,${bid.computedAt}`,
  ];
}
