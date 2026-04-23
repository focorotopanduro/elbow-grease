/**
 * fittingCostWithOverride — Phase 14.AB.1 integration test.
 *
 * Locks the pricing-profile formula override behavior at the BOM
 * layer: when a profile carries a `costFormulaOverrides[type]`, the
 * BOM uses the formula's evaluation instead of the catalog price.
 */

import { describe, it, expect } from 'vitest';
import { fittingCostWithOverride } from '../BOMExporter';
import type { PricingProfile } from '../computeBid';

const BASE_PROFILE: PricingProfile = {
  id: 'p1',
  name: 'Test profile',
  laborRateUsdPerHr: 100,
  overheadMarkupPercent: 0.15,
  profitMarginPercent: 0.10,
  salesTaxPercent: 0.065,
  taxOnMaterial: true,
  taxOnLabor: false,
};

describe('fittingCostWithOverride', () => {
  it('no formula → static catalog cost', () => {
    // elbow_90 @ 2" = $5.00 in the catalog
    const cost = fittingCostWithOverride('elbow_90', 2, 1, BASE_PROFILE);
    expect(cost).toBe(5.0);
  });

  it('empty formula → static catalog cost', () => {
    const profile: PricingProfile = {
      ...BASE_PROFILE,
      costFormulaOverrides: { elbow_90: '' },
    };
    const cost = fittingCostWithOverride('elbow_90', 2, 1, profile);
    expect(cost).toBe(5.0);
  });

  it('formula references [materialCost] and modifies it', () => {
    const profile: PricingProfile = {
      ...BASE_PROFILE,
      costFormulaOverrides: { elbow_90: '[materialCost] * 1.2 + 3' },
    };
    // 5 * 1.2 + 3 = 9
    const cost = fittingCostWithOverride('elbow_90', 2, 1, profile);
    expect(cost).toBeCloseTo(9.0, 5);
  });

  it('formula with [laborHours] + [laborRate]', () => {
    // elbow_90 @ 2" cost = $5.00, labor = 0.35 hr
    // Formula: [materialCost] + [laborHours] * [laborRate]
    //        = 5 + 0.35 * 100 = 40
    const profile: PricingProfile = {
      ...BASE_PROFILE,
      costFormulaOverrides: {
        elbow_90: '[materialCost] + [laborHours] * [laborRate]',
      },
    };
    const cost = fittingCostWithOverride('elbow_90', 2, 1, profile);
    expect(cost).toBeCloseTo(40.0, 5);
  });

  it('formula with [diameter] + [quantity]', () => {
    const profile: PricingProfile = {
      ...BASE_PROFILE,
      costFormulaOverrides: {
        bend_45: '[materialCost] + [diameter] * 0.5 + [quantity] * 0.1',
      },
    };
    // bend_45 @ 2" base = $4.50. Formula: 4.5 + 2*0.5 + 10*0.1 = 6.5
    const cost = fittingCostWithOverride('bend_45', 2, 10, profile);
    expect(cost).toBeCloseTo(6.5, 5);
  });

  it('malformed formula silently falls back to catalog (no crash)', () => {
    const profile: PricingProfile = {
      ...BASE_PROFILE,
      costFormulaOverrides: { elbow_90: '[materialCost] * * 2' },
    };
    const cost = fittingCostWithOverride('elbow_90', 2, 1, profile);
    // Falls back to catalog $5.00
    expect(cost).toBe(5.0);
  });

  it('formula with missing variable falls back to catalog', () => {
    const profile: PricingProfile = {
      ...BASE_PROFILE,
      costFormulaOverrides: { elbow_90: '[unknownVar] + 5' },
    };
    const cost = fittingCostWithOverride('elbow_90', 2, 1, profile);
    expect(cost).toBe(5.0);
  });

  it('divide-by-zero silently falls back to catalog', () => {
    const profile: PricingProfile = {
      ...BASE_PROFILE,
      costFormulaOverrides: { elbow_90: '[materialCost] / 0' },
    };
    const cost = fittingCostWithOverride('elbow_90', 2, 1, profile);
    expect(cost).toBe(5.0);
  });

  it('per-type: elbow_90 overridden, bend_45 uses default', () => {
    const profile: PricingProfile = {
      ...BASE_PROFILE,
      costFormulaOverrides: { elbow_90: '[materialCost] * 2' },
    };
    // elbow_90 @ 2" = $5 * 2 = 10
    expect(fittingCostWithOverride('elbow_90', 2, 1, profile)).toBe(10);
    // bend_45 @ 2" = $4.50 (catalog, no override)
    expect(fittingCostWithOverride('bend_45', 2, 1, profile)).toBe(4.5);
  });

  it('realistic "add $5 handling fee" per ProPEX elbow', () => {
    // pex_elbow_90 @ 0.75" base = $4.80
    const profile: PricingProfile = {
      ...BASE_PROFILE,
      costFormulaOverrides: { pex_elbow_90: '[materialCost] + 5' },
    };
    const cost = fittingCostWithOverride('pex_elbow_90', 0.75, 1, profile);
    expect(cost).toBeCloseTo(9.80, 5);
  });
});
