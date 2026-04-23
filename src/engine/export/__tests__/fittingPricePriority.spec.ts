/**
 * fittingCostWithOverride priority — Phase 14.AB.2.
 *
 * Locks the three-tier pricing fallback:
 *   1. fittingPriceOverrides[type][diameter]     (highest — vendor CSV)
 *   2. costFormulaOverrides[type]                (formula evaluator)
 *   3. FITTING_COSTS[type][diameter]             (catalog baseline)
 */

import { describe, it, expect } from 'vitest';
import { fittingCostWithOverride } from '../BOMExporter';
import type { PricingProfile } from '../computeBid';

const BASE: PricingProfile = {
  id: 'p1',
  name: 'Test',
  laborRateUsdPerHr: 100,
  overheadMarkupPercent: 0.15,
  profitMarginPercent: 0.10,
  salesTaxPercent: 0.065,
  taxOnMaterial: true,
  taxOnLabor: false,
};

describe('fittingCostWithOverride priority', () => {
  it('no overrides → catalog', () => {
    // elbow_90 @ 2" = $5 in catalog
    expect(fittingCostWithOverride('elbow_90', 2, 1, BASE)).toBe(5.0);
  });

  it('formula only → formula wins over catalog', () => {
    const p: PricingProfile = {
      ...BASE,
      costFormulaOverrides: { elbow_90: '[materialCost] * 2' },
    };
    expect(fittingCostWithOverride('elbow_90', 2, 1, p)).toBe(10.0);
  });

  it('price override only → price wins over catalog', () => {
    const p: PricingProfile = {
      ...BASE,
      fittingPriceOverrides: { elbow_90: { 2: 8.50 } },
    };
    expect(fittingCostWithOverride('elbow_90', 2, 1, p)).toBe(8.50);
  });

  it('price + formula both set → PRICE wins (top priority)', () => {
    const p: PricingProfile = {
      ...BASE,
      costFormulaOverrides: { elbow_90: '[materialCost] * 100' },
      fittingPriceOverrides: { elbow_90: { 2: 8.50 } },
    };
    expect(fittingCostWithOverride('elbow_90', 2, 1, p)).toBe(8.50);
  });

  it('price override for different diameter → formula still applies at other diameters', () => {
    const p: PricingProfile = {
      ...BASE,
      costFormulaOverrides: { elbow_90: '[materialCost] * 2' },
      fittingPriceOverrides: { elbow_90: { 2: 8.50 } },
    };
    // 2" gets the price override
    expect(fittingCostWithOverride('elbow_90', 2, 1, p)).toBe(8.50);
    // 3" (catalog = $12) gets the formula — 12 * 2 = 24
    expect(fittingCostWithOverride('elbow_90', 3, 1, p)).toBe(24.0);
  });

  it('price override for different type → formula applies to others', () => {
    const p: PricingProfile = {
      ...BASE,
      costFormulaOverrides: { elbow_90: '[materialCost] * 2' },
      fittingPriceOverrides: { bend_45: { 2: 7.0 } },
    };
    expect(fittingCostWithOverride('bend_45', 2, 1, p)).toBe(7.0);
    // elbow_90 still formula-driven
    expect(fittingCostWithOverride('elbow_90', 2, 1, p)).toBe(10.0);
  });

  it('zero price is treated as a valid override (contractor got it free)', () => {
    const p: PricingProfile = {
      ...BASE,
      fittingPriceOverrides: { elbow_90: { 2: 0 } },
    };
    expect(fittingCostWithOverride('elbow_90', 2, 1, p)).toBe(0);
  });

  it('negative price → fall through to catalog (corrupt data guard)', () => {
    const p: PricingProfile = {
      ...BASE,
      fittingPriceOverrides: { elbow_90: { 2: -1 } },
    };
    expect(fittingCostWithOverride('elbow_90', 2, 1, p)).toBe(5.0);
  });

  it('NaN / Infinity → fall through to catalog', () => {
    const p: PricingProfile = {
      ...BASE,
      fittingPriceOverrides: { elbow_90: { 2: Infinity } },
    };
    expect(fittingCostWithOverride('elbow_90', 2, 1, p)).toBe(5.0);
  });
});
