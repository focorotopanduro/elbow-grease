/**
 * Roofing calc engine — Phase 14.R.0.
 *
 * Every formula from the Python AROYH `calc_engine.py` cross-
 * checked against the reference implementation. Expected values
 * derived from the Python source + hand-checked against the
 * 9-sheet Roofing_Master_Bilingual.xlsx.
 */

import { describe, it, expect } from 'vitest';
import {
  slopeFactor,
  hipValleyFactor,
  hipValleyPlanFactor,
  roofAngleDeg,
  slopeFromRiseRun,
  riseFromSlopeRun,
  runFromSlopeRise,
  pitchFromRiseSpan,
  slopeFromPitch,
  rafterRidge,
  perimeterSimple,
  perimeterRecess,
  perimeterHip,
  perimeterGable,
  netVsGross,
  estimateMaterials,
  quickEstimate,
  estimatePricing,
  slopeFactorTable,
  ftToFtIn,
  ftInToFt,
  type RoofSectionLike,
  DEFAULT_ROOFING_PRICES,
  DEFAULT_ROOFING_LABOR,
} from '../calcEngine';

// ── Slope fundamentals ─────────────────────────────────────────

describe('slope fundamentals', () => {
  it('slopeFactor(0) → 1 (flat roof)', () => {
    expect(slopeFactor(0)).toBe(1);
    expect(slopeFactor(-1)).toBe(1);
  });

  it('slopeFactor(12) = √(1 + 1) = √2 ≈ 1.414', () => {
    expect(slopeFactor(12)).toBeCloseTo(Math.SQRT2, 5);
  });

  it('slopeFactor(4) = √(1 + (4/12)²) ≈ 1.0541', () => {
    expect(slopeFactor(4)).toBeCloseTo(1.0541, 3);
  });

  it('slopeFactor(6) = √(1 + 0.25) = √1.25 ≈ 1.118', () => {
    expect(slopeFactor(6)).toBeCloseTo(1.118, 3);
  });

  it('hipValleyFactor(0) → √2 (flat)', () => {
    expect(hipValleyFactor(0)).toBeCloseTo(Math.SQRT2, 5);
  });

  it('hipValleyFactor(12) = √(2 + 1) = √3 ≈ 1.732', () => {
    expect(hipValleyFactor(12)).toBeCloseTo(Math.sqrt(3), 5);
  });

  it('hipValleyPlanFactor(0) = 1', () => {
    expect(hipValleyPlanFactor(0)).toBeCloseTo(1, 5);
  });

  it('hipValleyPlanFactor(12) = √3 / √2 ≈ 1.225', () => {
    expect(hipValleyPlanFactor(12)).toBeCloseTo(Math.sqrt(3) / Math.SQRT2, 5);
  });

  it('roofAngleDeg(0) = 0', () => {
    expect(roofAngleDeg(0)).toBe(0);
  });

  it('roofAngleDeg(12) = 45° (full slope 12:12)', () => {
    expect(roofAngleDeg(12)).toBeCloseTo(45, 3);
  });

  it('roofAngleDeg(4) ≈ 18.43°', () => {
    expect(roofAngleDeg(4)).toBeCloseTo(18.43, 1);
  });
});

// ── Slope Calculator sheet ──────────────────────────────────────

describe('slope calculator formulas (Eq 1-4 / 1-5 / 1-6)', () => {
  it('slopeFromRiseRun(3, 9) → 4 (4:12)', () => {
    expect(slopeFromRiseRun(3, 9)).toBeCloseTo(4, 5);
  });

  it('slopeFromRiseRun — zero run returns 0', () => {
    expect(slopeFromRiseRun(5, 0)).toBe(0);
  });

  it('riseFromSlopeRun(4, 9) = 3 ft', () => {
    expect(riseFromSlopeRun(4, 9)).toBeCloseTo(3, 5);
  });

  it('runFromSlopeRise(4, 3) = 9 ft', () => {
    expect(runFromSlopeRise(4, 3)).toBeCloseTo(9, 5);
  });

  it('runFromSlopeRise — zero slope returns 0', () => {
    expect(runFromSlopeRise(0, 5)).toBe(0);
  });

  it('pitchFromRiseSpan(4, 16) = 0.25', () => {
    expect(pitchFromRiseSpan(4, 16)).toBeCloseTo(0.25, 5);
  });

  it('pitchFromRiseSpan — zero span returns 0', () => {
    expect(pitchFromRiseSpan(5, 0)).toBe(0);
  });

  it('slopeFromPitch(0.25) = 6 (pitch 1/4 → slope 6:12)', () => {
    expect(slopeFromPitch(0.25)).toBeCloseTo(6, 5);
  });
});

// ── Rafter & Ridge sheet ────────────────────────────────────────

describe('rafterRidge', () => {
  it('simple 30×20 gable at 4:12, 1 ft overhang', () => {
    const r = rafterRidge(30, 20, 4, 1);
    expect(r.totalRun).toBe(10);
    expect(r.totalRise).toBeCloseTo(10 / 3, 4); // (4/12) × 10
    expect(r.slopeFac).toBeCloseTo(1.0541, 3);
    // common = √(10² + (10/3)²) ≈ 10.541
    expect(r.commonRafter).toBeCloseTo(10.541, 2);
    expect(r.rafterWithOverhang).toBeCloseTo(r.commonRafter + 1 * r.slopeFac, 5);
    expect(r.ridgeGable).toBe(30);
    expect(r.ridgeHip).toBe(10); // 30 - 20
  });

  it('square roof — hip-dominant (ridgeHip = 0)', () => {
    const r = rafterRidge(20, 20, 6);
    expect(r.ridgeHip).toBe(0);
  });

  it('L > W → positive ridge', () => {
    const r = rafterRidge(40, 24, 6);
    expect(r.ridgeHip).toBe(16);
  });

  it('hip-valley metrics scale with run', () => {
    const r = rafterRidge(30, 20, 6);
    expect(r.hipValleyPlan).toBeCloseTo(1.414 * 10, 3);
    expect(r.hipValleyActual).toBeGreaterThan(r.hipValleyPlan);
  });
});

// ── Perimeter calculations ──────────────────────────────────────

describe('perimeter formulas', () => {
  it('perimeterSimple(40, 30) = 140', () => {
    expect(perimeterSimple(40, 30)).toBe(140);
  });

  it('perimeterRecess(40, 30, 5) = 2·(40+30+5) = 150', () => {
    expect(perimeterRecess(40, 30, 5)).toBe(150);
  });

  it('perimeterHip equals perimeterSimple', () => {
    expect(perimeterHip(40, 30)).toBe(perimeterSimple(40, 30));
  });

  it('perimeterGable applies slope factor to WIDTH (rake)', () => {
    // length 30, width 20, slope 6. sf = slopeFactor(6) exactly.
    expect(perimeterGable(30, 20, 6)).toBeCloseTo(60 + 20 * slopeFactor(6), 5);
  });

  it('perimeterGable at flat slope = 2L + W (no rake correction)', () => {
    expect(perimeterGable(40, 30, 0)).toBe(2 * 40 + 30 * 1);
  });
});

// ── Net-vs-Gross sheet ──────────────────────────────────────────

describe('netVsGross', () => {
  it('base case — 1000 sf net, no ridge/hip/valley', () => {
    const w = netVsGross(1000);
    expect(w.netArea).toBe(1000);
    expect(w.ridgeWaste).toBe(0);
    expect(w.hipWaste).toBe(0);
    expect(w.valleyWaste).toBe(0);
    expect(w.edgeWaste).toBeCloseTo(30, 5); // 3%
    expect(w.cuttingWaste).toBeCloseTo(50, 5); // 5%
    expect(w.totalWaste).toBeCloseTo(80, 5);
    expect(w.grossArea).toBeCloseTo(1080, 5);
    expect(w.wastePct).toBeCloseTo(8, 3);
  });

  it('with ridge + hip + valley footage', () => {
    const w = netVsGross(2000, { ridgeLf: 30, hipLf: 40, valleyLf: 20 });
    expect(w.ridgeWaste).toBeCloseTo(30 * 1.33, 5);
    expect(w.hipWaste).toBeCloseTo(40 * 1.5, 5);
    expect(w.valleyWaste).toBeCloseTo(20 * 1.5, 5);
    expect(w.grossArea).toBeGreaterThan(2000);
  });

  it('zero net area → zero wastePct (no divide by zero)', () => {
    const w = netVsGross(0);
    expect(w.wastePct).toBe(0);
  });

  it('custom edge / cutting waste percentages override defaults', () => {
    const w = netVsGross(1000, { edgeWastePct: 5, cuttingWastePct: 10 });
    expect(w.edgeWaste).toBeCloseTo(50, 5);
    expect(w.cuttingWaste).toBeCloseTo(100, 5);
  });
});

// ── Material estimates ──────────────────────────────────────────

function mkSection(overrides: Partial<RoofSectionLike> = {}): RoofSectionLike {
  return {
    sectionId: 'S',
    label: 'Section',
    x: 0,
    y: 0,
    length: 30,
    run: 20,
    slope: 6,
    roofType: 'gable',
    overhang: 1,
    areaActual: 700,
    perimeterPlan: 100,
    ridgeLength: 28,
    ...overrides,
  };
}

describe('estimateMaterials', () => {
  it('empty section list → zero materials', () => {
    const m = estimateMaterials([]);
    expect(m.netAreaSf).toBe(0);
    expect(m.shingleBundles).toBe(0);
    expect(m.feltRolls).toBe(0);
  });

  it('single section — bundle / roll counts scale sensibly', () => {
    const m = estimateMaterials([mkSection()]);
    expect(m.netAreaSf).toBe(700);
    expect(m.netSquares).toBeCloseTo(7, 5);
    expect(m.shingleBundles).toBeGreaterThanOrEqual(Math.ceil(m.grossSquares * 3));
    expect(m.dripEdgePcs).toBe(Math.ceil(100 / 10));
    expect(m.starterBundles).toBe(Math.ceil(100 / 105));
    expect(m.feltRolls).toBe(Math.ceil(700 / 400));
    expect(m.syntheticRolls).toBe(Math.ceil(700 / 1000));
    expect(m.roofingNailsLbs).toBe(Math.ceil(7 * 1.5));
  });

  it('hip roof adds hip LF to ridge-cap bundles', () => {
    const gable = estimateMaterials([mkSection({ roofType: 'gable' })]);
    const hip = estimateMaterials([mkSection({ roofType: 'hip' })]);
    expect(hip.ridgeCapBundles).toBeGreaterThanOrEqual(gable.ridgeCapBundles);
  });

  it('two sections accumulate net area + perimeter', () => {
    const m = estimateMaterials([
      mkSection({ sectionId: 'A', areaActual: 500 }),
      mkSection({ sectionId: 'B', areaActual: 700 }),
    ]);
    expect(m.netAreaSf).toBe(1200);
    expect(m.perimeterLf).toBe(200);
  });
});

// ── Quick Estimator ─────────────────────────────────────────────

describe('quickEstimate', () => {
  it('zero / negative inputs → zero-shaped result', () => {
    expect(quickEstimate(0, 10, 6).netArea).toBe(0);
    expect(quickEstimate(10, 0, 6).netArea).toBe(0);
    expect(quickEstimate(10, 10, 0).netArea).toBe(0);
  });

  it('30×20 gable at 6:12 with 1 ft overhang', () => {
    const q = quickEstimate(30, 20, 6, 1, 'gable');
    expect(q.slopeFac).toBeCloseTo(1.118, 3);
    expect(q.run).toBe(10);
    expect(q.adjLength).toBe(32);
    expect(q.adjWidth).toBe(22);
    // common = (10 + 1) × slopeFac
    expect(q.commonRafter).toBeCloseTo(11 * q.slopeFac, 5);
    expect(q.totalRise).toBeCloseTo(5, 5); // (6/12) × 10
    expect(q.ridgeGable).toBe(30);
    // netArea = 32 × 22 × exact-slopeFac (not the rounded 1.118)
    expect(q.netArea).toBeCloseTo(32 * 22 * q.slopeFac, 5);
    // Gable perim = 2×32 + 22×slopeFac
    expect(q.perimeter).toBeCloseTo(64 + 22 * q.slopeFac, 5);
    expect(q.materials.netAreaSf).toBe(q.netArea);
  });

  it('hip roof uses 2(L+W) perimeter', () => {
    const q = quickEstimate(40, 30, 4, 0, 'hip');
    expect(q.perimeter).toBeCloseTo(2 * (40 + 30), 3);
  });
});

// ── Pricing ──────────────────────────────────────────────────────

describe('estimatePricing', () => {
  const baseMat = estimateMaterials([mkSection()]);

  it('default prices + labor → positive total', () => {
    const p = estimatePricing(baseMat);
    expect(p.materialCost).toBeGreaterThan(0);
    expect(p.laborCost).toBeGreaterThan(0);
    expect(p.total).toBeGreaterThan(p.subtotal);
    expect(p.pricePerSquare).toBeGreaterThan(0);
  });

  it('overhead + profit compound correctly', () => {
    const p = estimatePricing(baseMat, { overheadPct: 10, profitPct: 15 });
    expect(p.overheadCost).toBeCloseTo(p.subtotal * 0.1, 2);
    // Profit applies AFTER overhead.
    const expectedProfit = (p.subtotal + p.overheadCost) * 0.15;
    expect(p.profitAmount).toBeCloseTo(expectedProfit, 2);
    expect(p.total).toBeCloseTo(p.subtotal + p.overheadCost + p.profitAmount, 2);
  });

  it('tear-off adds labor', () => {
    const noTear = estimatePricing(baseMat);
    const withTear = estimatePricing(baseMat, { tearOff: true });
    expect(withTear.laborHours).toBeGreaterThan(noTear.laborHours);
  });

  it('price override replaces the default line item', () => {
    const p = estimatePricing(baseMat, {
      prices: { shingle_bundle: 100 }, // bump from default 35
    });
    const pDefault = estimatePricing(baseMat);
    expect(p.materialCost).toBeGreaterThan(pDefault.materialCost);
  });

  it('labor override works', () => {
    const p = estimatePricing(baseMat, {
      labor: { rate_per_hour: 60 }, // bump from 45
    });
    const pDefault = estimatePricing(baseMat);
    expect(p.laborCost).toBeGreaterThan(pDefault.laborCost);
  });

  it('defaults are exposed for consumers', () => {
    expect(DEFAULT_ROOFING_PRICES.shingle_bundle).toBe(35);
    expect(DEFAULT_ROOFING_LABOR.rate_per_hour).toBe(45);
  });
});

// ── Slope Factor table ──────────────────────────────────────────

describe('slopeFactorTable', () => {
  it('returns 24 rows (slopes 1..24 in 12)', () => {
    const rows = slopeFactorTable();
    expect(rows).toHaveLength(24);
  });

  it('first row is slope=1, monotonically increasing factors', () => {
    const rows = slopeFactorTable();
    expect(rows[0]!.slope).toBe(1);
    expect(rows[23]!.slope).toBe(24);
    // commonFactor is monotonically non-decreasing.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.commonFactor).toBeGreaterThanOrEqual(rows[i - 1]!.commonFactor);
    }
  });

  it('slope 12 row matches direct formula', () => {
    const rows = slopeFactorTable();
    const r12 = rows.find((r) => r.slope === 12)!;
    expect(r12.commonFactor).toBeCloseTo(Math.SQRT2, 4);
    expect(r12.degrees).toBeCloseTo(45, 3);
  });
});

// ── Ft-In converter ─────────────────────────────────────────────

describe('ftToFtIn / ftInToFt', () => {
  it('0 ft → "0\'-0\""', () => {
    expect(ftToFtIn(0)).toBe(`0'-0"`);
  });

  it('5 ft → "5\'-0\""', () => {
    expect(ftToFtIn(5)).toBe(`5'-0"`);
  });

  it('5.5 ft → "5\'-6\""', () => {
    expect(ftToFtIn(5.5)).toBe(`5'-6"`);
  });

  it('rounds up — 5.9999 → "6\'-0\""', () => {
    expect(ftToFtIn(5.9999)).toBe(`6'-0"`);
  });

  it('handles carry into next foot — 5.99 → "5\'-12\"" which carries to "6\'-0\""', () => {
    // 5.99 × 12 = 71.88 leftover. (5.99 - 5) × 12 = 11.88 → round to 12 → carry.
    expect(ftToFtIn(5.99)).toBe(`6'-0"`);
  });

  it('round-trip ft-in → decimal ft', () => {
    expect(ftInToFt(5, 6)).toBeCloseTo(5.5, 5);
    expect(ftInToFt(0, 18)).toBeCloseTo(1.5, 5);
    expect(ftInToFt(10, 0)).toBe(10);
  });
});
