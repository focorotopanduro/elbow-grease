/**
 * computeBid — Phase 14.A tests.
 *
 * Every scenario below is HAND-CALCULATED to the cent so the expected
 * values are independently verifiable. If these fail after a refactor,
 * either the math changed (update the expectations with new hand-calcs)
 * or the refactor broke the bid — surface in code review.
 *
 * Golden scenario (used as baseline):
 *   • Raw material: $1000.00
 *   • Raw labor:    10.00 hrs × $95/hr = $950.00
 *   • Overhead:     15% → markup on each
 *   • Margin:       20% → on pre-margin total
 *   • Sales tax:    6.5% (FL Orange County)
 *   • Tax on material only (FL new residential)
 *
 * Step-by-step hand-calc:
 *   rawMaterial        = 1000.00
 *   rawLaborHours      = 10.00
 *   rawLaborCost       = 10 × 95                  = 950.00
 *   markedUpMaterial   = 1000 × 1.15              = 1150.00
 *   markedUpLabor      = 950 × 1.15               = 1092.50
 *   overheadAmount     = 150 + 142.50             = 292.50
 *   preTaxSubtotal     = 1150 + 1092.50           = 2242.50
 *   taxableBase        = 1150 (material only)     = 1150.00
 *   taxAmount          = 1150 × 0.065             = 74.75
 *   preMarginTotal     = 2242.50 + 74.75          = 2317.25
 *   marginAmount       = 2317.25 × 0.20           = 463.45
 *   grandTotal         = 2317.25 + 463.45         = 2780.70
 */

import { describe, it, expect } from 'vitest';
import {
  computeBid,
  bidToCSVRows,
  FL_RESIDENTIAL_DEFAULT,
  type PricingProfile,
  type BidResult,
} from '../computeBid';
import type { BOMReport } from '../BOMExporter';

// ── Helpers ───────────────────────────────────────────────────

function mkBom(overrides: Partial<BOMReport> = {}): BOMReport {
  return {
    items: [],
    subtotals: { pipe: 0, fitting: 0, fixture: 0, support: 0, misc: 0 },
    grandTotal: 0,
    grandLaborHours: 0,
    cutList: {
      perDiameter: [],
      totalStockLength: 0,
      totalRequiredLength: 0,
      totalWaste: 0,
      wastePercent: 0,
      summary: [],
    } as unknown as BOMReport['cutList'],
    generatedAt: '2026-04-18T00:00:00Z',
    ...overrides,
  };
}

const GOLDEN_PROFILE: PricingProfile = {
  id: 'test-golden',
  name: 'Golden FL Residential',
  laborRateUsdPerHr: 95,
  overheadMarkupPercent: 0.15,
  profitMarginPercent: 0.20,
  salesTaxPercent: 0.065,
  taxOnMaterial: true,
  taxOnLabor: false,
  notes: 'hand-calc test baseline',
};

// ── Core math ────────────────────────────────────────────────

describe('golden hand-calculated scenario', () => {
  const bom = mkBom({ grandTotal: 1000, grandLaborHours: 10 });
  const bid = computeBid(bom, GOLDEN_PROFILE);

  it('rawMaterialCost pulled from BOM.grandTotal', () => {
    expect(bid.rawMaterialCost).toBe(1000);
  });

  it('rawLaborHours pulled from BOM.grandLaborHours', () => {
    expect(bid.rawLaborHours).toBe(10);
  });

  it('rawLaborCost = hours × rate', () => {
    expect(bid.rawLaborCost).toBeCloseTo(950, 4);
  });

  it('markedUpMaterial = 1000 × 1.15 = $1150.00', () => {
    expect(bid.markedUpMaterial).toBeCloseTo(1150, 4);
  });

  it('markedUpLabor = 950 × 1.15 = $1092.50', () => {
    expect(bid.markedUpLabor).toBeCloseTo(1092.5, 4);
  });

  it('overheadAmount = 150 + 142.50 = $292.50', () => {
    expect(bid.overheadAmount).toBeCloseTo(292.5, 4);
  });

  it('preTaxSubtotal = markedUpMaterial + markedUpLabor = $2242.50', () => {
    expect(bid.preTaxSubtotal).toBeCloseTo(2242.5, 4);
  });

  it('taxableBase = markedUpMaterial only (FL rule) = $1150', () => {
    expect(bid.taxableBase).toBeCloseTo(1150, 4);
  });

  it('taxAmount = taxableBase × 6.5% = $74.75', () => {
    expect(bid.taxAmount).toBeCloseTo(74.75, 4);
  });

  it('preMarginTotal = subtotal + tax = $2317.25', () => {
    expect(bid.preMarginTotal).toBeCloseTo(2317.25, 4);
  });

  it('marginAmount = pre-margin × 20% = $463.45', () => {
    expect(bid.marginAmount).toBeCloseTo(463.45, 4);
  });

  it('grandTotal = pre-margin + margin = $2780.70', () => {
    expect(bid.grandTotal).toBeCloseTo(2780.7, 4);
  });
});

// ── Empty-scene edge ─────────────────────────────────────────

describe('empty BOM', () => {
  it('produces a zero bid, no NaN, profileSnapshot preserved', () => {
    const bid = computeBid(mkBom(), GOLDEN_PROFILE);
    expect(bid.rawMaterialCost).toBe(0);
    expect(bid.rawLaborHours).toBe(0);
    expect(bid.rawLaborCost).toBe(0);
    expect(bid.preTaxSubtotal).toBe(0);
    expect(bid.taxAmount).toBe(0);
    expect(bid.marginAmount).toBe(0);
    expect(bid.grandTotal).toBe(0);
    expect(bid.profileSnapshot.id).toBe('test-golden');
  });
});

// ── Tax flag combinations ───────────────────────────────────

describe('tax application', () => {
  const baseBom = mkBom({ grandTotal: 1000, grandLaborHours: 10 });

  it('taxOnMaterial=false, taxOnLabor=false → zero tax', () => {
    const profile: PricingProfile = { ...GOLDEN_PROFILE, taxOnMaterial: false, taxOnLabor: false };
    const bid = computeBid(baseBom, profile);
    expect(bid.taxableBase).toBe(0);
    expect(bid.taxAmount).toBe(0);
  });

  it('taxOnLabor=true adds labor to the taxable base', () => {
    const profile: PricingProfile = { ...GOLDEN_PROFILE, taxOnMaterial: true, taxOnLabor: true };
    const bid = computeBid(baseBom, profile);
    // taxableBase = markedUpMaterial(1150) + markedUpLabor(1092.50) = 2242.50
    expect(bid.taxableBase).toBeCloseTo(2242.5, 4);
    // tax = 2242.50 × 0.065 = 145.7625
    expect(bid.taxAmount).toBeCloseTo(145.7625, 4);
  });

  it('taxOnMaterial=false, taxOnLabor=true (unusual) taxes labor only', () => {
    const profile: PricingProfile = { ...GOLDEN_PROFILE, taxOnMaterial: false, taxOnLabor: true };
    const bid = computeBid(baseBom, profile);
    expect(bid.taxableBase).toBeCloseTo(1092.5, 4);
    expect(bid.taxAmount).toBeCloseTo(1092.5 * 0.065, 4);
  });
});

// ── Overhead / margin edge cases ────────────────────────────

describe('markup edges', () => {
  const baseBom = mkBom({ grandTotal: 1000, grandLaborHours: 10 });

  it('0% overhead → marked-up == raw', () => {
    const profile: PricingProfile = { ...GOLDEN_PROFILE, overheadMarkupPercent: 0 };
    const bid = computeBid(baseBom, profile);
    expect(bid.markedUpMaterial).toBeCloseTo(1000, 4);
    expect(bid.markedUpLabor).toBeCloseTo(950, 4);
    expect(bid.overheadAmount).toBeCloseTo(0, 4);
  });

  it('0% margin → grandTotal == preMarginTotal', () => {
    const profile: PricingProfile = { ...GOLDEN_PROFILE, profitMarginPercent: 0 };
    const bid = computeBid(baseBom, profile);
    expect(bid.marginAmount).toBeCloseTo(0, 4);
    expect(bid.grandTotal).toBeCloseTo(bid.preMarginTotal, 4);
  });

  it('high overhead (30%) and high margin (25%) stack correctly', () => {
    const profile: PricingProfile = {
      ...GOLDEN_PROFILE,
      overheadMarkupPercent: 0.30,
      profitMarginPercent: 0.25,
    };
    const bid = computeBid(baseBom, profile);
    // markedUpMaterial = 1000 × 1.30 = 1300
    // markedUpLabor    = 950  × 1.30 = 1235
    // preTax           = 2535
    // taxable (mat)    = 1300
    // tax              = 1300 × 0.065 = 84.50
    // preMargin        = 2619.50
    // margin           = 2619.50 × 0.25 = 654.875
    // grand            = 3274.375
    expect(bid.preTaxSubtotal).toBeCloseTo(2535, 4);
    expect(bid.taxAmount).toBeCloseTo(84.5, 4);
    expect(bid.preMarginTotal).toBeCloseTo(2619.5, 4);
    expect(bid.marginAmount).toBeCloseTo(654.875, 4);
    expect(bid.grandTotal).toBeCloseTo(3274.375, 4);
  });
});

// ── Profile snapshot (audit trail) ──────────────────────────

describe('profile snapshot', () => {
  it('captures a deep copy of the profile at bid time', () => {
    const profile: PricingProfile = { ...GOLDEN_PROFILE };
    const bid = computeBid(mkBom({ grandTotal: 100, grandLaborHours: 1 }), profile);

    // Mutate the original — snapshot should be isolated.
    profile.laborRateUsdPerHr = 999;
    expect(bid.profileSnapshot.laborRateUsdPerHr).toBe(95);
  });

  it('includes an ISO computedAt timestamp', () => {
    const bid = computeBid(mkBom(), GOLDEN_PROFILE);
    expect(bid.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── FL default profile sanity ──────────────────────────────

describe('FL_RESIDENTIAL_DEFAULT sanity', () => {
  it('parses as a valid profile', () => {
    expect(FL_RESIDENTIAL_DEFAULT.laborRateUsdPerHr).toBeGreaterThan(0);
    expect(FL_RESIDENTIAL_DEFAULT.overheadMarkupPercent).toBeGreaterThanOrEqual(0);
    expect(FL_RESIDENTIAL_DEFAULT.salesTaxPercent).toBeGreaterThanOrEqual(0);
  });

  it('matches Florida rules: tax on material, NOT on new-residential labor', () => {
    expect(FL_RESIDENTIAL_DEFAULT.taxOnMaterial).toBe(true);
    expect(FL_RESIDENTIAL_DEFAULT.taxOnLabor).toBe(false);
  });

  it('sales tax is in the plausible FL band (6–7.5%)', () => {
    expect(FL_RESIDENTIAL_DEFAULT.salesTaxPercent).toBeGreaterThanOrEqual(0.06);
    expect(FL_RESIDENTIAL_DEFAULT.salesTaxPercent).toBeLessThanOrEqual(0.075);
  });
});

// ── CSV formatter ──────────────────────────────────────────

describe('bidToCSVRows', () => {
  it('produces a BID SUMMARY section with the grand total line', () => {
    const bid = computeBid(mkBom({ grandTotal: 1000, grandLaborHours: 10 }), GOLDEN_PROFILE);
    const rows = bidToCSVRows(bid);
    const joined = rows.join('\n');
    expect(joined).toContain('BID SUMMARY');
    expect(joined).toContain('BID TOTAL:,$2780.70');
    expect(joined).toContain('Profile:,Golden FL Residential');
  });

  it('formats percentages + dollars with 2 decimals', () => {
    const bid = computeBid(mkBom({ grandTotal: 100, grandLaborHours: 1 }), GOLDEN_PROFILE);
    const rows = bidToCSVRows(bid);
    const joined = rows.join('\n');
    // Every $ amount should appear with a 2-decimal format (no raw floats).
    expect(joined).not.toMatch(/\$\d+\.\d{3,}/); // 3+ decimals = bad
    // Percentages are formatted like "15.00%".
    expect(joined).toMatch(/\d+\.\d{2}%/);
  });
});

// ── Invariants ──────────────────────────────────────────────

describe('invariants', () => {
  const baseBom = mkBom({ grandTotal: 1000, grandLaborHours: 10 });

  it('grandTotal = preMarginTotal + marginAmount exactly', () => {
    const bid = computeBid(baseBom, GOLDEN_PROFILE);
    expect(bid.grandTotal - (bid.preMarginTotal + bid.marginAmount)).toBeCloseTo(0, 8);
  });

  it('preMarginTotal = preTaxSubtotal + taxAmount exactly', () => {
    const bid = computeBid(baseBom, GOLDEN_PROFILE);
    expect(bid.preMarginTotal - (bid.preTaxSubtotal + bid.taxAmount)).toBeCloseTo(0, 8);
  });

  it('preTaxSubtotal = markedUpMaterial + markedUpLabor exactly', () => {
    const bid = computeBid(baseBom, GOLDEN_PROFILE);
    expect(
      bid.preTaxSubtotal - (bid.markedUpMaterial + bid.markedUpLabor),
    ).toBeCloseTo(0, 8);
  });

  it('grandTotal ≥ rawMaterialCost + rawLaborCost (always at least raw cost)', () => {
    const bid = computeBid(baseBom, GOLDEN_PROFILE);
    expect(bid.grandTotal).toBeGreaterThanOrEqual(
      bid.rawMaterialCost + bid.rawLaborCost,
    );
  });

  it('changing rate scales raw labor cost linearly', () => {
    const p1: PricingProfile = { ...GOLDEN_PROFILE, laborRateUsdPerHr: 100 };
    const p2: PricingProfile = { ...GOLDEN_PROFILE, laborRateUsdPerHr: 200 };
    const b1 = computeBid(baseBom, p1);
    const b2 = computeBid(baseBom, p2);
    expect(b2.rawLaborCost / b1.rawLaborCost).toBeCloseTo(2, 6);
  });
});
