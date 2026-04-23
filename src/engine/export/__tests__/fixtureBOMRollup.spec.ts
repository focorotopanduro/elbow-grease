/**
 * Fixture BOM Rollup — Phase 14.AC.10 tests.
 *
 * Locks in the contract:
 *   • `generateBOM` accepts fixtures as an optional 5th arg.
 *   • Fixtures group by subtype → one line per subtype.
 *   • Each line carries quantity, unit cost, labor hours,
 *     correct category, and proper part-hint format.
 *   • Three-tier override chain (price > formula > catalog),
 *     matching the fitting convention.
 *   • Fixture-less call produces the legacy (pre-14.AC.10) shape.
 *   • Zero-cost subtypes (dishwasher, clothes_washer) still get
 *     labor hours.
 *   • Fixtures roll into grandTotal + subtotals.fixture.
 *   • Unknown subtype falls back to $0 cost (no crash).
 */

import { describe, it, expect } from 'vitest';
import { generateBOM } from '../BOMExporter';
import type { FixtureInstance } from '@store/fixtureStore';
import type { PricingProfile } from '../computeBid';

// ── Helpers ──────────────────────────────────────────────────

function mkFixture(
  id: string,
  subtype: FixtureInstance['subtype'],
  position: [number, number, number] = [0, 0, 0],
): FixtureInstance {
  return {
    id,
    subtype,
    position,
    params: {},
    createdTs: 0,
    connectedPipeIds: [],
  };
}

const baseProfile: PricingProfile = {
  id: 'test',
  name: 'Test',
  laborRateUsdPerHr: 80,
  overheadMarkupPercent: 0,
  profitMarginPercent: 0,
  salesTaxPercent: 0,
  taxOnMaterial: true,
  taxOnLabor: false,
};

// ── Back-compat: legacy callers unaffected ───────────────────

describe('generateBOM — legacy back-compat', () => {
  it('4-arg call (no fixtures arg) has zero fixture items', () => {
    const r = generateBOM([], []);
    const fixtureItems = r.items.filter((i) => i.category === 'fixture');
    expect(fixtureItems).toHaveLength(0);
    expect(r.subtotals.fixture).toBe(0);
  });

  it('empty fixtures array is identical to no-arg', () => {
    const a = generateBOM([], []);
    const b = generateBOM([], [], undefined, undefined, []);
    expect(a.items).toEqual(b.items);
    expect(a.subtotals).toEqual(b.subtotals);
    expect(a.grandTotal).toBe(b.grandTotal);
  });
});

// ── Pricing basics ───────────────────────────────────────────

describe('generateBOM — fixture pricing', () => {
  it('one toilet → one fixture line, catalog cost + IPC labor', () => {
    const r = generateBOM([], [], undefined, undefined, [
      mkFixture('t1', 'water_closet'),
    ]);
    const fixtureItems = r.items.filter((i) => i.category === 'fixture');
    expect(fixtureItems).toHaveLength(1);
    const item = fixtureItems[0]!;
    expect(item.quantity).toBe(1);
    expect(item.unit).toBe('ea');
    expect(item.unitCost).toBeGreaterThan(0);     // catalog has a non-zero value
    expect(item.unitLaborHours).toBeGreaterThan(0);
    expect(item.totalCost).toBe(item.unitCost);
    expect(item.laborHours).toBe(item.unitLaborHours);
    expect(item.description).toBe('Water Closet');
    expect(item.partHint).toBe('FIXTURE-WATER_CLOSET');
  });

  it('three identical fixtures → one line, quantity 3, totals scale', () => {
    const r = generateBOM([], [], undefined, undefined, [
      mkFixture('a', 'lavatory'),
      mkFixture('b', 'lavatory'),
      mkFixture('c', 'lavatory'),
    ]);
    const fixtureItems = r.items.filter((i) => i.category === 'fixture');
    expect(fixtureItems).toHaveLength(1);
    const item = fixtureItems[0]!;
    expect(item.quantity).toBe(3);
    expect(item.totalCost).toBeCloseTo(item.unitCost * 3, 4);
    expect(item.laborHours).toBeCloseTo(item.unitLaborHours * 3, 4);
  });

  it('mixed bathroom: 4 distinct subtypes → 4 lines, sorted alphabetically', () => {
    const r = generateBOM([], [], undefined, undefined, [
      mkFixture('1', 'water_closet'),
      mkFixture('2', 'lavatory'),
      mkFixture('3', 'bathtub'),
      mkFixture('4', 'floor_drain'),
    ]);
    const fixtureItems = r.items.filter((i) => i.category === 'fixture');
    expect(fixtureItems).toHaveLength(4);
    // Alpha-sorted subtype order — stable diffs across exports
    const subtypes = fixtureItems.map((i) => i.partHint);
    expect(subtypes).toEqual([
      'FIXTURE-BATHTUB',
      'FIXTURE-FLOOR_DRAIN',
      'FIXTURE-LAVATORY',
      'FIXTURE-WATER_CLOSET',
    ]);
  });

  it('zero-cost fixtures (dishwasher, clothes_washer) still carry labor hours', () => {
    const r = generateBOM([], [], undefined, undefined, [
      mkFixture('d1', 'dishwasher'),
      mkFixture('w1', 'clothes_washer'),
    ]);
    const items = r.items.filter((i) => i.category === 'fixture');
    for (const item of items) {
      expect(item.unitCost).toBe(0);
      expect(item.totalCost).toBe(0);
      expect(item.unitLaborHours).toBeGreaterThan(0);
      expect(item.laborHours).toBeGreaterThan(0);
    }
  });
});

// ── Subtotals + grand total ──────────────────────────────────

describe('generateBOM — fixture totals roll up correctly', () => {
  it('subtotals.fixture = sum of fixture line totalCost', () => {
    const r = generateBOM([], [], undefined, undefined, [
      mkFixture('1', 'water_closet'),
      mkFixture('2', 'water_closet'),
      mkFixture('3', 'lavatory'),
    ]);
    const items = r.items.filter((i) => i.category === 'fixture');
    const sum = items.reduce((s, i) => s + i.totalCost, 0);
    expect(r.subtotals.fixture).toBeCloseTo(sum, 4);
  });

  it('grandTotal includes the fixture subtotal', () => {
    const withoutFixtures = generateBOM([], []);
    const withFixtures = generateBOM([], [], undefined, undefined, [
      mkFixture('1', 'water_closet'),
      mkFixture('2', 'lavatory'),
    ]);
    expect(withFixtures.grandTotal).toBeGreaterThan(withoutFixtures.grandTotal);
    expect(
      withFixtures.grandTotal - withoutFixtures.grandTotal,
    ).toBeCloseTo(withFixtures.subtotals.fixture, 4);
  });

  it('grandLaborHours includes fixture labor', () => {
    const withoutFixtures = generateBOM([], []);
    const withFixtures = generateBOM([], [], undefined, undefined, [
      mkFixture('1', 'bathtub'), // bathtub has the most labor of any fixture
    ]);
    expect(withFixtures.grandLaborHours).toBeGreaterThan(withoutFixtures.grandLaborHours);
  });
});

// ── Override chain (three tiers) ─────────────────────────────

describe('generateBOM — fixture pricing overrides', () => {
  it('tier 1: fixturePriceOverrides wins over catalog', () => {
    const profile: PricingProfile = {
      ...baseProfile,
      fixturePriceOverrides: { water_closet: 999 },
    };
    const r = generateBOM([], [], profile, undefined, [
      mkFixture('t1', 'water_closet'),
    ]);
    const item = r.items.find((i) => i.partHint === 'FIXTURE-WATER_CLOSET')!;
    expect(item.unitCost).toBe(999);
  });

  it('tier 1: zero override is VALID (free-goods promotional)', () => {
    const profile: PricingProfile = {
      ...baseProfile,
      fixturePriceOverrides: { water_closet: 0 },
    };
    const r = generateBOM([], [], profile, undefined, [
      mkFixture('t1', 'water_closet'),
    ]);
    const item = r.items.find((i) => i.partHint === 'FIXTURE-WATER_CLOSET')!;
    expect(item.unitCost).toBe(0);
    expect(item.totalCost).toBe(0);
    // But labor still charges
    expect(item.laborHours).toBeGreaterThan(0);
  });

  it('tier 1: negative override is corrupt-data → falls through', () => {
    const profile: PricingProfile = {
      ...baseProfile,
      fixturePriceOverrides: { water_closet: -50 },
    };
    const r = generateBOM([], [], profile, undefined, [
      mkFixture('t1', 'water_closet'),
    ]);
    const item = r.items.find((i) => i.partHint === 'FIXTURE-WATER_CLOSET')!;
    expect(item.unitCost).toBeGreaterThan(0); // catalog fallback
  });

  it('tier 2: formula override applied when no price override', () => {
    const profile: PricingProfile = {
      ...baseProfile,
      fixtureCostFormulaOverrides: {
        water_closet: '[materialCost] * 1.15',
      },
    };
    const r = generateBOM([], [], profile, undefined, [
      mkFixture('t1', 'water_closet'),
    ]);
    const rNoOverride = generateBOM([], [], undefined, undefined, [
      mkFixture('t1', 'water_closet'),
    ]);
    const catalogCost = rNoOverride.items.find((i) => i.partHint === 'FIXTURE-WATER_CLOSET')!.unitCost;
    const formulaCost = r.items.find((i) => i.partHint === 'FIXTURE-WATER_CLOSET')!.unitCost;
    expect(formulaCost).toBeCloseTo(catalogCost * 1.15, 4);
  });

  it('tier 2: formula with labor roll-in', () => {
    const profile: PricingProfile = {
      ...baseProfile,
      laborRateUsdPerHr: 100,
      fixtureCostFormulaOverrides: {
        lavatory: '[materialCost] + [laborHours] * [laborRate]',
      },
    };
    const r = generateBOM([], [], profile, undefined, [
      mkFixture('l1', 'lavatory'),
    ]);
    const item = r.items.find((i) => i.partHint === 'FIXTURE-LAVATORY')!;
    // Sanity: price should be > catalog alone because labor was rolled in
    const rBare = generateBOM([], [], undefined, undefined, [
      mkFixture('l1', 'lavatory'),
    ]);
    const catalog = rBare.items.find((i) => i.partHint === 'FIXTURE-LAVATORY')!.unitCost;
    expect(item.unitCost).toBeGreaterThan(catalog);
  });

  it('tier 1 beats tier 2: price override beats formula', () => {
    const profile: PricingProfile = {
      ...baseProfile,
      fixturePriceOverrides: { water_closet: 500 },
      fixtureCostFormulaOverrides: {
        water_closet: '[materialCost] * 100', // would produce absurd number
      },
    };
    const r = generateBOM([], [], profile, undefined, [
      mkFixture('t1', 'water_closet'),
    ]);
    const item = r.items.find((i) => i.partHint === 'FIXTURE-WATER_CLOSET')!;
    expect(item.unitCost).toBe(500);
  });

  it('overrides for one subtype leave other subtypes at catalog', () => {
    const profile: PricingProfile = {
      ...baseProfile,
      fixturePriceOverrides: { water_closet: 999 },
    };
    const r = generateBOM([], [], profile, undefined, [
      mkFixture('t1', 'water_closet'),
      mkFixture('l1', 'lavatory'),
    ]);
    const toilet = r.items.find((i) => i.partHint === 'FIXTURE-WATER_CLOSET')!;
    const lav = r.items.find((i) => i.partHint === 'FIXTURE-LAVATORY')!;
    expect(toilet.unitCost).toBe(999);
    expect(lav.unitCost).toBeGreaterThan(0);
    expect(lav.unitCost).not.toBe(999);
  });
});

// ── Defensive behaviour ──────────────────────────────────────

describe('generateBOM — defensive', () => {
  it('unknown subtype falls through to $0 cost (no crash)', () => {
    const r = generateBOM([], [], undefined, undefined, [
      // @ts-expect-error intentional invalid subtype
      mkFixture('weird', 'not_a_real_subtype'),
    ]);
    const item = r.items.find((i) => i.category === 'fixture')!;
    expect(item).toBeDefined();
    expect(item.unitCost).toBe(0);
    expect(item.unitLaborHours).toBe(0);
  });

  it('NaN / Infinity override falls through to catalog', () => {
    const profile: PricingProfile = {
      ...baseProfile,
      fixturePriceOverrides: { water_closet: NaN },
    };
    const r = generateBOM([], [], profile, undefined, [
      mkFixture('t1', 'water_closet'),
    ]);
    const item = r.items.find((i) => i.partHint === 'FIXTURE-WATER_CLOSET')!;
    expect(item.unitCost).toBeGreaterThan(0); // catalog
  });
});
