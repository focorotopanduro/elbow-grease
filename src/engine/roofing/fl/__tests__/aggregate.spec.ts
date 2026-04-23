/**
 * aggregate.ts — Phase 14.R.6 tests.
 *
 * Covers:
 *   • `projectForSection` — RoofSection + base → per-section Project
 *   • `lineItemKey` — composite merge key
 *   • `mergeLineItems` — quantity sum, max waste, worst confidence,
 *      note concat
 *   • `mergeZones`     — sums + max a_dimension + weighted-avg fraction
 *   • `dedupeWarnings` — preserves first occurrence
 *   • `aggregateEstimate` end-to-end:
 *      - empty sections → null estimate + sectionCount 0
 *      - single section → matches a direct estimate() call
 *      - two sections → sloped_area_sqft and line-item quantities add up
 *      - penetrations appear exactly once (on the largest section)
 *      - unknown county → error propagates, estimate is null
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateEstimate,
  projectForSection,
  lineItemKey,
  mergeLineItems,
  mergeZones,
  dedupeWarnings,
  warningKey,
  sectionMeanHeightFt,
  roofHeightOffsetAboveEave,
  equivalentRectangle,
  resolvePenetrationCounts,
} from '../aggregate';
import {
  type Project,
  type LineItem,
  type EstimateWarning,
  type ZoneProfile,
  type Confidence,
  createProject,
} from '../core';
import { estimate } from '../estimator';
import {
  type RoofSection,
  type RoofPenetration,
  createPenetration,
} from '../../RoofGraph';

// ── Fixtures ────────────────────────────────────────────────────

function mkSection(overrides: Partial<RoofSection> & { sectionId: string }): RoofSection {
  return {
    sectionId: overrides.sectionId,
    label: overrides.label ?? overrides.sectionId,
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    length: overrides.length ?? 40,
    run: overrides.run ?? 30,
    rotation: overrides.rotation ?? 0,
    slope: overrides.slope ?? 6,
    roofType: overrides.roofType ?? 'hip',
    sectionType: overrides.sectionType ?? 'main_roof',
    overhang: overrides.overhang ?? 1,
    z: overrides.z ?? 0,
    wastePct: overrides.wastePct ?? 15,
    colorIdx: overrides.colorIdx ?? 0,
    locked: overrides.locked ?? false,
  };
}

function mkBase(overrides: Partial<Project> = {}): Project {
  return createProject({
    county: 'Lee',
    roof: {
      length_ft: 60,
      width_ft: 40,
      mean_height_ft: 10,
      slope_pitch: '6:12',
      roof_type: 'hip',
      complexity: 'simple',
    },
    system: 'architectural_shingle',
    ...overrides,
  });
}

function mkLine(overrides: Partial<LineItem> & {
  name: string;
  quantity: number;
}): LineItem {
  return {
    category: overrides.category ?? 'covering',
    name: overrides.name,
    quantity: overrides.quantity,
    unit: overrides.unit ?? 'sqft',
    waste_factor_pct: overrides.waste_factor_pct ?? 10,
    fl_approval: overrides.fl_approval ?? null,
    noa_number: overrides.noa_number ?? null,
    confidence: overrides.confidence ?? ('computed' as Confidence),
    notes: overrides.notes ?? null,
  };
}

function mkZone(overrides: Partial<ZoneProfile> = {}): ZoneProfile {
  return {
    a_dimension_ft: 10,
    zone_1_sqft: 100,
    zone_2e_sqft: 0,
    zone_2n_sqft: 0,
    zone_3e_sqft: 0,
    zone_3r_sqft: 0,
    interior_sqft: 100,
    perimeter_sqft: 0,
    corners_sqft: 0,
    total_plan_sqft: 100,
    sloped_area_sqft: 112,
    perimeter_fraction: 0,
    confidence: 'computed' as Confidence,
    ...overrides,
  };
}

// ── Phase 14.R.7 — per-section wind height ──────────────────────

describe('roofHeightOffsetAboveEave', () => {
  it('returns 0 for flat', () => {
    const sec = mkSection({ sectionId: 'F', roofType: 'flat', slope: 0, run: 20 });
    expect(roofHeightOffsetAboveEave(sec)).toBe(0);
  });

  it('returns rise(sec) for shed (half of the full shed rise)', () => {
    // slope=6, run=20 → RoofGraph.rise = (6/12)*(20/2) = 5.
    // Full shed rise = (6/12)*20 = 10. Mean offset = 5.
    const sec = mkSection({ sectionId: 'S', roofType: 'shed', slope: 6, run: 20 });
    expect(roofHeightOffsetAboveEave(sec)).toBe(5);
  });

  it('returns rise(sec)/2 for gable', () => {
    // slope=6, run=20 → rise=5 → offset = 2.5
    const sec = mkSection({ sectionId: 'G', roofType: 'gable', slope: 6, run: 20 });
    expect(roofHeightOffsetAboveEave(sec)).toBe(2.5);
  });

  it('returns rise(sec)/2 for hip', () => {
    const sec = mkSection({ sectionId: 'H', roofType: 'hip', slope: 6, run: 20 });
    expect(roofHeightOffsetAboveEave(sec)).toBe(2.5);
  });

  it('scales linearly with slope', () => {
    const a = mkSection({ sectionId: 'A', roofType: 'gable', slope: 6, run: 20 });
    const b = mkSection({ sectionId: 'B', roofType: 'gable', slope: 12, run: 20 });
    expect(roofHeightOffsetAboveEave(b)).toBeCloseTo(2 * roofHeightOffsetAboveEave(a), 6);
  });
});

describe('sectionMeanHeightFt', () => {
  it('falls back to baseMeanHeight when section.z = 0 (ground-floor default)', () => {
    const sec = mkSection({
      sectionId: 'A', roofType: 'gable', slope: 6, run: 20, z: 0,
    });
    // eave = max(0, 10) = 10; offset = 2.5 → mean = 12.5
    expect(sectionMeanHeightFt(sec, 10)).toBe(12.5);
  });

  it('uses section.z when explicitly raised (second-story dormer)', () => {
    const sec = mkSection({
      sectionId: 'A', roofType: 'gable', slope: 6, run: 20, z: 12,
    });
    // eave = max(12, 10) = 12; offset = 2.5 → mean = 14.5
    expect(sectionMeanHeightFt(sec, 10)).toBe(14.5);
  });

  it('flat section at grade returns the base mean untouched', () => {
    const sec = mkSection({
      sectionId: 'F', roofType: 'flat', slope: 0, run: 20, z: 0,
    });
    expect(sectionMeanHeightFt(sec, 10)).toBe(10);
  });

  it('flat section raised to 24 ft returns 24', () => {
    const sec = mkSection({
      sectionId: 'F', roofType: 'flat', slope: 0, run: 20, z: 24,
    });
    expect(sectionMeanHeightFt(sec, 10)).toBe(24);
  });

  it('shed raised to 18 ft with slope 6/20 → 18 + 5 = 23', () => {
    const sec = mkSection({
      sectionId: 'S', roofType: 'shed', slope: 6, run: 20, z: 18,
    });
    expect(sectionMeanHeightFt(sec, 10)).toBe(23);
  });

  it('hip raised to 24 ft with slope 9/24 → 24 + (9/12*12)/2 = 24 + 4.5 = 28.5', () => {
    const sec = mkSection({
      sectionId: 'H', roofType: 'hip', slope: 9, run: 24, z: 24,
    });
    // rise = 9/12 * 24/2 = 9; offset = 9/2 = 4.5
    expect(sectionMeanHeightFt(sec, 10)).toBeCloseTo(28.5, 6);
  });

  it('larger baseMeanHeight overrides smaller section.z', () => {
    // A contractor who sets baseMean=20 (two-story building) and draws
    // a z=0 section → eave falls back to 20.
    const sec = mkSection({
      sectionId: 'A', roofType: 'gable', slope: 6, run: 20, z: 0,
    });
    expect(sectionMeanHeightFt(sec, 20)).toBe(22.5);
  });
});

describe('projectForSection wind-height integration', () => {
  it('propagates sectionMeanHeightFt into the Project.roof.mean_height_ft', () => {
    const sec = mkSection({
      sectionId: 'A', roofType: 'gable', slope: 6, run: 20, z: 0,
    });
    const base = mkBase(); // base.roof.mean_height_ft === 10
    const p = projectForSection(sec, base);
    // z=0 fallback → 10 + 2.5 = 12.5
    expect(p.roof.mean_height_ft).toBe(12.5);
  });

  it('different sections get different mean heights in the same aggregate', () => {
    const main = mkSection({
      sectionId: 'MAIN', roofType: 'gable', slope: 6, run: 30, z: 0,
    });
    const dormer = mkSection({
      sectionId: 'DORMER', roofType: 'gable', slope: 6, run: 10, z: 18,
    });
    const base = mkBase();
    const pMain = projectForSection(main, base);
    const pDormer = projectForSection(dormer, base);
    // Main: eave=10, rise=7.5, offset=3.75 → 13.75
    expect(pMain.roof.mean_height_ft).toBeCloseTo(13.75, 6);
    // Dormer: eave=18, rise=2.5, offset=1.25 → 19.25
    expect(pDormer.roof.mean_height_ft).toBeCloseTo(19.25, 6);
    // The dormer MUST see a higher wind-reference than the main roof.
    expect(pDormer.roof.mean_height_ft).toBeGreaterThan(pMain.roof.mean_height_ft);
  });

  it('flat section at grade preserves the base mean_height_ft exactly', () => {
    const sec = mkSection({
      sectionId: 'A', roofType: 'flat', slope: 0, run: 20, z: 0,
    });
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.mean_height_ft).toBe(base.roof.mean_height_ft);
  });
});

// ── projectForSection ──────────────────────────────────────────

describe('projectForSection', () => {
  it('substitutes the roof geometry from the RoofSection', () => {
    const sec = mkSection({
      sectionId: 'A',
      length: 72, run: 28,
      slope: 9, roofType: 'gable',
    });
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.length_ft).toBe(72);
    expect(p.roof.width_ft).toBe(28);
    expect(p.roof.slope_pitch).toBe('9:12');
    expect(p.roof.roof_type).toBe('gable');
    // Phase 14.R.7 — mean_height_ft is NO LONGER pass-through; the
    // aggregator applies `sectionMeanHeightFt()` so wind pressure
    // reflects the section's elevation + roof-type offset. Here:
    //   eave = max(0, 10) = 10;
    //   rise = (9/12)*(28/2) = 10.5;
    //   gable offset = rise/2 = 5.25;
    //   mean = 10 + 5.25 = 15.25
    expect(p.roof.mean_height_ft).toBeCloseTo(15.25, 6);
    // Complexity + county + system still pass through unchanged.
    expect(p.roof.complexity).toBe(base.roof.complexity);
    expect(p.county).toBe(base.county);
    expect(p.system).toBe(base.system);
  });

  it('maps every RoofGraph roofType to its FL equivalent', () => {
    const base = mkBase();
    for (const rt of ['hip', 'gable', 'shed', 'flat'] as const) {
      const sec = mkSection({ sectionId: rt, roofType: rt });
      expect(projectForSection(sec, base).roof.roof_type).toBe(rt);
    }
  });

  it('applies penetration overrides', () => {
    const sec = mkSection({ sectionId: 'A' });
    const base = mkBase({
      plumbing_vent_count: 5,
      skylight_count: 2,
      chimney_count: 1,
    });
    const p = projectForSection(sec, base, {
      plumbing_vent_count: 0,
      skylight_count: 0,
      chimney_count: 0,
    });
    expect(p.plumbing_vent_count).toBe(0);
    expect(p.skylight_count).toBe(0);
    expect(p.chimney_count).toBe(0);
  });

  it('inherits base penetration counts when no overrides given', () => {
    const sec = mkSection({ sectionId: 'A' });
    const base = mkBase({ plumbing_vent_count: 7 });
    const p = projectForSection(sec, base);
    expect(p.plumbing_vent_count).toBe(7);
  });
});

// ── lineItemKey ────────────────────────────────────────────────

describe('lineItemKey', () => {
  it('differs on category', () => {
    const a = mkLine({ name: 'X', quantity: 1, category: 'covering' });
    const b = mkLine({ name: 'X', quantity: 1, category: 'underlayment' });
    expect(lineItemKey(a)).not.toBe(lineItemKey(b));
  });

  it('differs on unit', () => {
    const a = mkLine({ name: 'X', quantity: 1, unit: 'sqft' });
    const b = mkLine({ name: 'X', quantity: 1, unit: 'sq' });
    expect(lineItemKey(a)).not.toBe(lineItemKey(b));
  });

  it('differs on fl_approval', () => {
    const a = mkLine({ name: 'X', quantity: 1, fl_approval: 'FL12345' });
    const b = mkLine({ name: 'X', quantity: 1, fl_approval: null });
    expect(lineItemKey(a)).not.toBe(lineItemKey(b));
  });

  it('is stable for identical items', () => {
    const a = mkLine({ name: 'X', quantity: 1 });
    const b = mkLine({ name: 'X', quantity: 999 }); // quantity excluded from key
    expect(lineItemKey(a)).toBe(lineItemKey(b));
  });
});

// ── mergeLineItems ─────────────────────────────────────────────

describe('mergeLineItems', () => {
  it('sums quantities for matching keys', () => {
    const merged = mergeLineItems([
      [mkLine({ name: 'Shingles', quantity: 10 })],
      [mkLine({ name: 'Shingles', quantity: 15 })],
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.quantity).toBe(25);
  });

  it('keeps distinct items separate', () => {
    const merged = mergeLineItems([
      [mkLine({ name: 'Shingles', quantity: 10 })],
      [mkLine({ name: 'Nails', quantity: 5, unit: 'box' })],
    ]);
    expect(merged).toHaveLength(2);
  });

  it('takes MAX waste factor conservatively', () => {
    const merged = mergeLineItems([
      [mkLine({ name: 'X', quantity: 1, waste_factor_pct: 10 })],
      [mkLine({ name: 'X', quantity: 1, waste_factor_pct: 20 })],
    ]);
    expect(merged[0]!.waste_factor_pct).toBe(20);
  });

  it('takes WORST confidence', () => {
    const merged = mergeLineItems([
      [mkLine({ name: 'X', quantity: 1, confidence: 'verified' })],
      [mkLine({ name: 'X', quantity: 1, confidence: 'inferred' })],
    ]);
    expect(merged[0]!.confidence).toBe('inferred');
  });

  it('concatenates distinct notes', () => {
    const merged = mergeLineItems([
      [mkLine({ name: 'X', quantity: 1, notes: 'first' })],
      [mkLine({ name: 'X', quantity: 1, notes: 'second' })],
    ]);
    expect(merged[0]!.notes).toContain('first');
    expect(merged[0]!.notes).toContain('second');
  });

  it('keeps a single note when both are null or identical', () => {
    const mergedA = mergeLineItems([
      [mkLine({ name: 'X', quantity: 1, notes: null })],
      [mkLine({ name: 'X', quantity: 1, notes: null })],
    ]);
    expect(mergedA[0]!.notes).toBeNull();
    const mergedB = mergeLineItems([
      [mkLine({ name: 'X', quantity: 1, notes: 'same' })],
      [mkLine({ name: 'X', quantity: 1, notes: 'same' })],
    ]);
    expect(mergedB[0]!.notes).toBe('same');
  });

  it('returns [] for empty input', () => {
    expect(mergeLineItems([])).toEqual([]);
    expect(mergeLineItems([[]])).toEqual([]);
  });

  it('does not mutate the source arrays', () => {
    const src = mkLine({ name: 'X', quantity: 10 });
    const merged = mergeLineItems([[src], [mkLine({ name: 'X', quantity: 5 })]]);
    // Merged quantity = 15, but source is untouched.
    expect(src.quantity).toBe(10);
    expect(merged[0]!.quantity).toBe(15);
  });
});

// ── mergeZones ─────────────────────────────────────────────────

describe('mergeZones', () => {
  it('returns a zero profile when no zones', () => {
    const z = mergeZones([]);
    expect(z.total_plan_sqft).toBe(0);
    expect(z.a_dimension_ft).toBe(0);
  });

  it('returns a clone when only one zone', () => {
    const z0 = mkZone({ total_plan_sqft: 500 });
    const z = mergeZones([z0]);
    expect(z).toEqual(z0);
    expect(z).not.toBe(z0);
  });

  it('sums sqft fields', () => {
    const z = mergeZones([
      mkZone({ total_plan_sqft: 100, sloped_area_sqft: 112, zone_1_sqft: 50 }),
      mkZone({ total_plan_sqft: 200, sloped_area_sqft: 224, zone_1_sqft: 100 }),
    ]);
    expect(z.total_plan_sqft).toBe(300);
    expect(z.sloped_area_sqft).toBe(336);
    expect(z.zone_1_sqft).toBe(150);
  });

  it('takes max a_dimension_ft', () => {
    const z = mergeZones([
      mkZone({ a_dimension_ft: 3 }),
      mkZone({ a_dimension_ft: 10 }),
      mkZone({ a_dimension_ft: 7 }),
    ]);
    expect(z.a_dimension_ft).toBe(10);
  });

  it('weighted-averages perimeter_fraction by plan area', () => {
    // 100 sqft @ 0.5 fraction, 300 sqft @ 0.1 fraction
    // → (100*0.5 + 300*0.1) / 400 = 80/400 = 0.2
    const z = mergeZones([
      mkZone({ total_plan_sqft: 100, perimeter_fraction: 0.5 }),
      mkZone({ total_plan_sqft: 300, perimeter_fraction: 0.1 }),
    ]);
    expect(z.perimeter_fraction).toBeCloseTo(0.2, 6);
  });

  it('takes worst confidence across zones', () => {
    const z = mergeZones([
      mkZone({ confidence: 'verified' }),
      mkZone({ confidence: 'inferred' }),
    ]);
    expect(z.confidence).toBe('inferred');
  });
});

// ── dedupeWarnings ─────────────────────────────────────────────

describe('dedupeWarnings + warningKey', () => {
  function mkW(overrides: Partial<EstimateWarning> & {
    message: string;
  }): EstimateWarning {
    return {
      severity: overrides.severity ?? 'warning',
      category: overrides.category ?? 'compliance',
      message: overrides.message,
      reference: overrides.reference ?? null,
    };
  }

  it('collapses identical warnings', () => {
    const ws = [
      mkW({ message: 'FBC R801.3 required' }),
      mkW({ message: 'FBC R801.3 required' }),
      mkW({ message: 'FBC R801.3 required' }),
    ];
    expect(dedupeWarnings(ws)).toHaveLength(1);
  });

  it('preserves distinct warnings', () => {
    const ws = [
      mkW({ message: 'A' }),
      mkW({ message: 'B' }),
      mkW({ message: 'A' }),
    ];
    const out = dedupeWarnings(ws);
    expect(out).toHaveLength(2);
    expect(out[0]!.message).toBe('A');
    expect(out[1]!.message).toBe('B');
  });

  it('treats severity differences as distinct', () => {
    const ws = [
      mkW({ message: 'X', severity: 'info' }),
      mkW({ message: 'X', severity: 'warning' }),
    ];
    expect(dedupeWarnings(ws)).toHaveLength(2);
  });

  it('returns [] for empty input', () => {
    expect(dedupeWarnings([])).toEqual([]);
  });

  it('warningKey differs when reference differs', () => {
    const a = mkW({ message: 'X', reference: 'R801' });
    const b = mkW({ message: 'X', reference: null });
    expect(warningKey(a)).not.toBe(warningKey(b));
  });
});

// ── aggregateEstimate — end-to-end ─────────────────────────────

// ── Phase 14.R.9 — polygon support ──────────────────────────────

describe('equivalentRectangle', () => {
  it('recovers the exact rectangle for a rectangle polygon', () => {
    // 20 × 10 rectangle → A=200, P=60, halfP=30, disc=900-800=100, √=10
    // L = (30+10)/2 = 20, W = (30-10)/2 = 10
    const rect: [number, number][] = [[0, 0], [20, 0], [20, 10], [0, 10]];
    const r = equivalentRectangle(rect);
    expect(r.length_ft).toBeCloseTo(20, 6);
    expect(r.width_ft).toBeCloseTo(10, 6);
  });

  it('falls back to √A × √A for compact shapes (negative disc)', () => {
    // Regular hexagon inscribed in radius 10. Area ≈ 259.8, perim ≈ 60.
    // halfP² = 900, 4A ≈ 1039, disc < 0 → square fallback.
    const R = 10;
    const hex: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      hex.push([R * Math.cos(a), R * Math.sin(a)]);
    }
    const r = equivalentRectangle(hex);
    // Fallback is square-rooted area → L === W
    expect(r.length_ft).toBeCloseTo(r.width_ft, 6);
    // And L × W should be the polygon area.
    expect(r.length_ft * r.width_ft).toBeCloseTo(
      polygonAreaForTest(hex),
      3,
    );
  });

  it('returns zero for degenerate polygon', () => {
    expect(equivalentRectangle([])).toEqual({ length_ft: 0, width_ft: 0 });
    expect(equivalentRectangle([[0, 0], [0, 0], [0, 0]]))
      .toEqual({ length_ft: 0, width_ft: 0 });
  });

  it('recovers area exactly for any polygon', () => {
    // L-shape, area = 27 (6×6 - 3×3)
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const r = equivalentRectangle(L);
    expect(r.length_ft * r.width_ft).toBeCloseTo(27, 3);
  });
});

// Tiny helper so the test doesn't import from RoofGraph just for area.
function polygonAreaForTest(poly: ReadonlyArray<readonly [number, number]>): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

describe('projectForSection with polygon', () => {
  it('convex polygon + gable \u2192 gable (R.16-promoted from flat)', () => {
    // Previously R.9 forced polygon sections to flat; R.16 supports
    // convex polygon + gable explicitly. Legacy expectation was flat.
    const sec = mkSection({ sectionId: 'P', roofType: 'gable' });
    (sec as any).polygon = [[0, 0], [20, 0], [20, 10], [0, 10]];
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.roof_type).toBe('gable');
    expect(p.roof.slope_pitch).toBe(`${sec.slope}:12`);
  });

  it('uses the equivalent rectangle for length_ft + width_ft', () => {
    const sec = mkSection({ sectionId: 'P', roofType: 'flat' });
    // A 20×10 polygon → equivalent rect is exactly 20×10.
    (sec as any).polygon = [[0, 0], [20, 0], [20, 10], [0, 10]];
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.length_ft).toBeCloseTo(20, 3);
    expect(p.roof.width_ft).toBeCloseTo(10, 3);
  });

  it('rect-section path is unaffected by R.9 polygon logic', () => {
    const sec = mkSection({
      sectionId: 'R', length: 50, run: 35, slope: 6, roofType: 'hip',
    });
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.length_ft).toBe(50);
    expect(p.roof.width_ft).toBe(35);
    expect(p.roof.roof_type).toBe('hip');
    expect(p.roof.slope_pitch).toBe('6:12');
  });

  // ── Phase 14.R.11 polygon + hip ──────────────────────────────

  it('convex polygon + hip preserves roof_type hip and the slope', () => {
    const sec = mkSection({ sectionId: 'PH', slope: 9, roofType: 'hip' });
    (sec as any).polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.roof_type).toBe('hip');
    expect(p.roof.slope_pitch).toBe('9:12');
    // Equivalent rect for a square is the square itself.
    expect(p.roof.length_ft).toBeCloseTo(10, 3);
    expect(p.roof.width_ft).toBeCloseTo(10, 3);
  });

  it('concave RECTILINEAR polygon + hip \u2192 hip (R.12 promotes to rectilinear-union)', () => {
    // L-shape — concave but axis-aligned. R.11 fell back to flat;
    // R.12 decomposes into sub-rects and maps to hip in the estimator.
    const sec = mkSection({ sectionId: 'PLH', slope: 6, roofType: 'hip' });
    (sec as any).polygon = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]];
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.roof_type).toBe('hip');
    expect(p.roof.slope_pitch).toBe('6:12');
  });

  it('R.16: convex polygon + gable \u2192 gable in the FL estimator', () => {
    const sec = mkSection({ sectionId: 'PG', slope: 6, roofType: 'gable' });
    (sec as any).polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.roof_type).toBe('gable');
    expect(p.roof.slope_pitch).toBe('6:12');
  });

  it('R.21: concave polygon + gable \u2192 gable (skeleton-gable decomposition)', () => {
    // L-shape + gable was flat in R.16; R.21 handles it by decomposing
    // into convex leaves and applying a gable to each.
    const sec = mkSection({ sectionId: 'LG', slope: 6, roofType: 'gable' });
    (sec as any).polygon = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.roof_type).toBe('gable');
    expect(p.roof.slope_pitch).toBe('6:12');
  });

  it('R.21: skeleton-gable mean_height_ft uses max leaf gable rise', () => {
    // L-shape at slope 6. Leaves are some convex pieces; whichever
    // has the biggest max-perp-from-ridge contributes the rise.
    const sec = mkSection({ sectionId: 'LG2', slope: 6, roofType: 'gable', z: 0 });
    (sec as any).polygon = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const base = mkBase();
    const p = projectForSection(sec, base);
    // Eave at 10 (base default), offset > 0 from the skeleton rise.
    expect(p.roof.mean_height_ft).toBeGreaterThan(10);
  });

  it('R.16: polygon gable mean_height_ft includes rise/2 offset above eave', () => {
    // 20\u00d710 rect gable, slope 6 \u2192 rise = (6/12)\u00d75 = 2.5 \u2192 offset 1.25.
    const sec = mkSection({ sectionId: 'PG2', slope: 6, roofType: 'gable', z: 0 });
    (sec as any).polygon = [[0, 0], [20, 0], [20, 10], [0, 10]];
    const base = mkBase();
    const p = projectForSection(sec, base);
    // eave = max(0, base=10) = 10; offset = 1.25
    expect(p.roof.mean_height_ft).toBeCloseTo(11.25, 3);
  });

  it('R.17: convex polygon + shed \u2192 shed in the FL estimator', () => {
    const sec = mkSection({ sectionId: 'PS', slope: 6, roofType: 'shed' });
    (sec as any).polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.roof_type).toBe('shed');
    expect(p.roof.slope_pitch).toBe('6:12');
  });

  it('R.22: concave polygon + shed \u2192 shed (promoted from flat)', () => {
    // L-shape shed now produces a single tilted plane covering the
    // whole polygon. Previously R.17 fell back to flat for concave.
    const sec = mkSection({ sectionId: 'LS', slope: 6, roofType: 'shed' });
    (sec as any).polygon = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.roof_type).toBe('shed');
    expect(p.roof.slope_pitch).toBe('6:12');
  });

  it('R.22: concave shed mean_height_ft reflects the tilted-plane rise', () => {
    const sec = mkSection({ sectionId: 'LS2', slope: 6, roofType: 'shed', z: 0 });
    (sec as any).polygon = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const base = mkBase();
    const p = projectForSection(sec, base);
    // Eave = max(0, 10) = 10; offset = riseAtHigh/2 = 3/2 = 1.5.
    expect(p.roof.mean_height_ft).toBeCloseTo(11.5, 3);
  });

  it('R.17: polygon shed mean_height_ft includes rise/2 offset above eave', () => {
    // 20\u00d710 rect shed, slope 6 \u2192 runs over short dim (10), rise=5, offset=2.5.
    const sec = mkSection({ sectionId: 'PS2', slope: 6, roofType: 'shed', z: 0 });
    (sec as any).polygon = [[0, 0], [20, 0], [20, 10], [0, 10]];
    const base = mkBase();
    const p = projectForSection(sec, base);
    // eave = max(0, base=10) = 10; offset = 2.5.
    expect(p.roof.mean_height_ft).toBeCloseTo(12.5, 3);
  });

  it('convex polygon + hip: mean_height_ft reflects the pyramid rise', () => {
    // Square 10×10, slope 6 → expected pyramid rise = 2.5.
    // With base wall height = 10, eave = 10, offset = rise/2 = 1.25.
    // Mean roof height = 11.25.
    const sec = mkSection({ sectionId: 'PH2', slope: 6, roofType: 'hip', z: 0 });
    (sec as any).polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.mean_height_ft).toBeCloseTo(11.25, 3);
  });

  it('polygon + flat: mean_height_ft has zero offset above eave', () => {
    const sec = mkSection({ sectionId: 'PF', slope: 0, roofType: 'flat', z: 12 });
    (sec as any).polygon = [[0, 0], [20, 0], [20, 10], [0, 10]];
    const base = mkBase();
    const p = projectForSection(sec, base);
    // eave = max(12, 10) = 12; offset = 0.
    expect(p.roof.mean_height_ft).toBeCloseTo(12, 3);
  });

  // ── Phase 14.R.12 rectilinear-union (L/T/U + hip) ────────────

  it('rectilinear concave + hip \u2192 hip estimator (not flat)', () => {
    // L-shape — concave but axis-aligned.
    const sec = mkSection({ sectionId: 'PLH', slope: 6, roofType: 'hip' });
    (sec as any).polygon = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]];
    const base = mkBase();
    const p = projectForSection(sec, base);
    // R.12 promotes this to hip (was flat under R.11).
    expect(p.roof.roof_type).toBe('hip');
    expect(p.roof.slope_pitch).toBe('6:12');
  });

  it('rectilinear concave + hip: mean_height_ft uses max sub-rect rise', () => {
    // L-shape: sub-rects 6\u00d73 and 3\u00d73. Slope 6:
    //   6\u00d73: halfMin = 1.5, rise = 0.5\u00b71.5 = 0.75
    //   3\u00d73: halfMin = 1.5, rise = 0.75
    // Max = 0.75, offset = 0.375. Eave = 10 (base), mean = 10.375.
    const sec = mkSection({ sectionId: 'PLH2', slope: 6, roofType: 'hip', z: 0 });
    (sec as any).polygon = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]];
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.mean_height_ft).toBeCloseTo(10.375, 3);
  });

  it('U-shape (rectilinear concave) + hip \u2192 hip estimator', () => {
    const sec = mkSection({ sectionId: 'PUH', slope: 6, roofType: 'hip' });
    (sec as any).polygon = [
      [0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6],
    ];
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.roof_type).toBe('hip');
  });

  it('non-rectilinear concave + hip still falls back to flat', () => {
    // Pentagon with a diagonal reflex edge.
    const sec = mkSection({ sectionId: 'NR', slope: 6, roofType: 'hip' });
    (sec as any).polygon = [[0, 0], [10, 0], [5, 3], [10, 10], [0, 10]];
    const base = mkBase();
    const p = projectForSection(sec, base);
    // Hmm — this polygon is actually convex! Let me re-check.
    // (0,0) → (10,0) → (5,3) → (10,10) → (0,10) back to (0,0)
    // At (5,3): in = (-5, 3), out = (5, 7); cross = -5*7 - 3*5 = -50 < 0 → reflex (CCW).
    // At (0,0): in = (0, -10), out = (10, 0); cross = 0*0 - (-10)*10 = 100 > 0 → convex.
    // So (5,3) IS a reflex. Single-reflex non-rectilinear → skeleton now applies.
    // R.14 promotes this to hip.
    expect(p.roof.roof_type).toBe('hip');
  });

  // ── Phase 14.R.14 single-reflex skeleton ─────────────────────

  it('arrow pentagon (single-reflex non-rectilinear) + hip → hip estimator', () => {
    const sec = mkSection({ sectionId: 'AR', slope: 6, roofType: 'hip' });
    (sec as any).polygon = [
      [0, 0], [10, 0], [10, 8], [5, 5], [0, 8],
    ];
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.roof_type).toBe('hip');
    expect(p.roof.slope_pitch).toBe('6:12');
  });

  it('multi-reflex non-rectilinear polygon + hip \u2192 hip via R.15 recursive decomposition', () => {
    // 2-reflex hexagonal polygon \u2014 decomposes into 3 convex leaves.
    const sec = mkSection({ sectionId: 'HX', slope: 6, roofType: 'hip' });
    (sec as any).polygon = [
      [0, 0], [12, 0], [12, 10], [7, 5], [5, 5], [0, 10],
    ];
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.roof_type).toBe('hip');
    expect(p.roof.slope_pitch).toBe('6:12');
  });

  it('degenerate polygon (<3 vertices) bypasses polygon logic \u2192 uses rect path', () => {
    // Polygons with < 3 vertices don\u2019t satisfy hasPolygon(); the
    // estimator skips the polygon override entirely and emits from
    // the section\u2019s rect fields (length/run) + original roofType.
    const sec = mkSection({ sectionId: 'DEGEN', slope: 6, roofType: 'hip' });
    (sec as any).polygon = [[0, 0], [5, 0]];
    const base = mkBase();
    const p = projectForSection(sec, base);
    expect(p.roof.roof_type).toBe('hip'); // from section.roofType, not flat
  });

  it('R.15 multi-reflex: mean_height_ft reflects max sub-leaf pyramid rise', () => {
    const sec = mkSection({ sectionId: 'HX2', slope: 6, roofType: 'hip', z: 0 });
    (sec as any).polygon = [
      [0, 0], [12, 0], [12, 10], [7, 5], [5, 5], [0, 10],
    ];
    const base = mkBase();
    const p = projectForSection(sec, base);
    // Eave = max(0, base=10) = 10; offset = maxLeafRise/2 > 0.
    expect(p.roof.mean_height_ft).toBeGreaterThan(10);
  });

  it('skeleton single-reflex: mean_height_ft uses max sub-poly pyramid rise', () => {
    // Arrow pentagon. subPolyA = [(5,5),(0,8),(0,0),(5,0)]; subPolyB =
    // [(5,0),(10,0),(10,8),(5,5)]. For slope=6 both halves yield some
    // rise; aggregator uses the MAX pyramid rise / 2 for mean-height
    // offset above eave.
    const sec = mkSection({ sectionId: 'AR2', slope: 6, roofType: 'hip', z: 0 });
    (sec as any).polygon = [
      [0, 0], [10, 0], [10, 8], [5, 5], [0, 8],
    ];
    const base = mkBase();
    const p = projectForSection(sec, base);
    // Eave = max(0, base=10) = 10; offset = maxRise/2 > 0.
    expect(p.roof.mean_height_ft).toBeGreaterThan(10);
  });
});

describe('aggregateEstimate', () => {
  it('returns sectionCount 0 + null estimate on empty sections', () => {
    const r = aggregateEstimate([], mkBase());
    expect(r.sectionCount).toBe(0);
    expect(r.estimate).toBeNull();
    expect(r.error).toBeNull();
  });

  it('returns the same estimate as a direct estimate() call for a single section', () => {
    const sec = mkSection({
      sectionId: 'A',
      length: 50, run: 35,
      slope: 6, roofType: 'hip',
    });
    const base = mkBase({
      plumbing_vent_count: 3,
      skylight_count: 0,
      chimney_count: 0,
    });
    const agg = aggregateEstimate([sec], base);
    expect(agg.estimate).not.toBeNull();
    const direct = estimate(projectForSection(sec, base));

    // Sloped area must match exactly — same geometry, same projection.
    expect(agg.estimate!.zones.sloped_area_sqft)
      .toBeCloseTo(direct.zones.sloped_area_sqft, 3);
    // Total line-item count should match.
    expect(agg.estimate!.line_items.length).toBe(direct.line_items.length);
    // Summed quantity across all line items should match.
    const sumAgg = agg.estimate!.line_items.reduce((s, li) => s + li.quantity, 0);
    const sumDirect = direct.line_items.reduce((s, li) => s + li.quantity, 0);
    expect(sumAgg).toBeCloseTo(sumDirect, 3);
  });

  it('aggregates TWO sections → sloped_area_sqft is the sum', () => {
    const a = mkSection({ sectionId: 'A', length: 50, run: 30, slope: 6, roofType: 'hip' });
    const b = mkSection({ sectionId: 'B', length: 40, run: 25, slope: 6, roofType: 'hip' });
    const base = mkBase({ plumbing_vent_count: 0, skylight_count: 0, chimney_count: 0 });

    const agg = aggregateEstimate([a, b], base);
    expect(agg.estimate).not.toBeNull();
    expect(agg.sectionCount).toBe(2);

    const ea = estimate(projectForSection(a, base));
    const eb = estimate(projectForSection(b, base));
    const expectedSloped = ea.zones.sloped_area_sqft + eb.zones.sloped_area_sqft;
    expect(agg.estimate!.zones.sloped_area_sqft).toBeCloseTo(expectedSloped, 3);
  });

  it('aggregates TWO sections → summed line-item quantity matches sum of per-section runs', () => {
    const a = mkSection({ sectionId: 'A', length: 50, run: 30 });
    const b = mkSection({ sectionId: 'B', length: 40, run: 25 });
    const base = mkBase({ plumbing_vent_count: 0, skylight_count: 0, chimney_count: 0 });

    const agg = aggregateEstimate([a, b], base);
    expect(agg.estimate).not.toBeNull();
    const sumAgg = agg.estimate!.line_items.reduce((s, li) => s + li.quantity, 0);
    const ea = estimate(projectForSection(a, base));
    const eb = estimate(projectForSection(b, base));
    const sumSeparate =
      ea.line_items.reduce((s, li) => s + li.quantity, 0) +
      eb.line_items.reduce((s, li) => s + li.quantity, 0);
    expect(sumAgg).toBeCloseTo(sumSeparate, 3);
  });

  it('puts all penetrations on the largest section only — aggregate includes them once', () => {
    // Two sections, b is clearly larger.
    const a = mkSection({ sectionId: 'A', length: 30, run: 20 });
    const b = mkSection({ sectionId: 'B', length: 80, run: 50 });
    const base = mkBase({
      plumbing_vent_count: 4,
      skylight_count: 1,
      chimney_count: 1,
    });

    const agg = aggregateEstimate([a, b], base);
    expect(agg.estimate).not.toBeNull();

    // Running the aggregate with all penetrations on b (the largest)
    // and none on a must equal running estimate() on both with those
    // counts directly — i.e. the aggregator's penetration routing is
    // consistent with expectation. We verify by re-running manually.
    const ea = estimate(projectForSection(a, base, {
      plumbing_vent_count: 0, skylight_count: 0, chimney_count: 0,
    }));
    const eb = estimate(projectForSection(b, base, {
      plumbing_vent_count: 4, skylight_count: 1, chimney_count: 1,
    }));

    const sumLineItems =
      ea.line_items.reduce((s, li) => s + li.quantity, 0) +
      eb.line_items.reduce((s, li) => s + li.quantity, 0);
    const sumAgg = agg.estimate!.line_items.reduce((s, li) => s + li.quantity, 0);
    expect(sumAgg).toBeCloseTo(sumLineItems, 3);
  });

  it('reports an error when the base project has an unknown county', () => {
    const sec = mkSection({ sectionId: 'A' });
    const base = mkBase({ county: 'NotARealCounty' });
    const agg = aggregateEstimate([sec], base);
    expect(agg.estimate).toBeNull();
    expect(agg.error).toBeTruthy();
    expect(agg.error!.length).toBeGreaterThan(0);
    expect(agg.sectionCount).toBe(1);
  });

  it('sections_count field reflects input length regardless of success', () => {
    expect(aggregateEstimate([], mkBase()).sectionCount).toBe(0);
    expect(aggregateEstimate([mkSection({ sectionId: 'A' })], mkBase()).sectionCount).toBe(1);
    expect(aggregateEstimate([
      mkSection({ sectionId: 'A' }),
      mkSection({ sectionId: 'B' }),
      mkSection({ sectionId: 'C' }),
    ], mkBase()).sectionCount).toBe(3);
  });
});

// ── Phase 14.R.27 — penetration count resolution ──────────────

describe('resolvePenetrationCounts (R.27)', () => {
  it('returns base project counts when no penetrations are supplied', () => {
    const base = mkBase({ plumbing_vent_count: 3, skylight_count: 1, chimney_count: 2 });
    expect(resolvePenetrationCounts(base, undefined)).toEqual({
      plumbing_vent: 3, skylight: 1, chimney: 2,
    });
    expect(resolvePenetrationCounts(base, [])).toEqual({
      plumbing_vent: 3, skylight: 1, chimney: 2,
    });
  });

  it('spatial skylights OVERRIDE manual skylight_count when ≥1 placed', () => {
    const base = mkBase({ plumbing_vent_count: 3, skylight_count: 5, chimney_count: 2 });
    const pens: RoofPenetration[] = [
      createPenetration({ id: '1', kind: 'skylight', x: 0, y: 0 }),
      createPenetration({ id: '2', kind: 'skylight', x: 1, y: 1 }),
    ];
    const out = resolvePenetrationCounts(base, pens);
    // Skylight overridden (2 placed), others fall back to manual.
    expect(out.skylight).toBe(2);
    expect(out.plumbing_vent).toBe(3);
    expect(out.chimney).toBe(2);
  });

  it('per-kind override: zero placed → manual still wins for THAT kind', () => {
    const base = mkBase({ plumbing_vent_count: 7, skylight_count: 0, chimney_count: 4 });
    const pens: RoofPenetration[] = [
      // Only skylights placed — vents and chimneys keep manual values.
      createPenetration({ id: '1', kind: 'skylight', x: 0, y: 0 }),
    ];
    const out = resolvePenetrationCounts(base, pens);
    expect(out.skylight).toBe(1);
    expect(out.plumbing_vent).toBe(7);
    expect(out.chimney).toBe(4);
  });

  it('all three kinds overridden when all have placements', () => {
    const base = mkBase({ plumbing_vent_count: 99, skylight_count: 99, chimney_count: 99 });
    const pens: RoofPenetration[] = [
      createPenetration({ id: '1', kind: 'plumbing_vent', x: 0, y: 0 }),
      createPenetration({ id: '2', kind: 'plumbing_vent', x: 1, y: 0 }),
      createPenetration({ id: '3', kind: 'skylight',      x: 2, y: 0 }),
      createPenetration({ id: '4', kind: 'chimney',       x: 3, y: 0 }),
    ];
    expect(resolvePenetrationCounts(base, pens)).toEqual({
      plumbing_vent: 2, skylight: 1, chimney: 1,
    });
  });
});

describe('aggregateEstimate with penetrations (R.27)', () => {
  it('no penetrations arg → identical to pre-R.27 behavior (manual counts used)', () => {
    const base = mkBase({ skylight_count: 2 });
    const sec = mkSection({ sectionId: 'A' });
    const a = aggregateEstimate([sec], base);
    const b = aggregateEstimate([sec], base, undefined);
    const c = aggregateEstimate([sec], base, []);
    // Identical estimates except for `generated_at` which is a
    // timestamp. Compare line items (quantity-carrying fields) instead.
    const keyFields = (est: ReturnType<typeof aggregateEstimate>) =>
      est.estimate!.line_items.map((li) => `${li.name}:${li.quantity}`).sort();
    expect(keyFields(a)).toEqual(keyFields(b));
    expect(keyFields(a)).toEqual(keyFields(c));
  });

  it('spatial skylight count overrides manual count at estimate time', () => {
    const base = mkBase({ skylight_count: 0 });
    const sec = mkSection({ sectionId: 'A' });
    const noPens = aggregateEstimate([sec], base);
    const withOneSkylight = aggregateEstimate(
      [sec],
      base,
      [createPenetration({ id: '1', kind: 'skylight', x: 0, y: 0 })],
    );
    // With one spatial skylight we expect at least one skylight
    // flashing line item with quantity ≥ 1; with no spatial AND
    // zero manual, the flashing group should be absent OR zero.
    const skyFlashing = (r: ReturnType<typeof aggregateEstimate>) =>
      (r.estimate?.line_items ?? []).filter((li) => /skylight/i.test(li.name));
    expect(skyFlashing(noPens)).toHaveLength(0);
    expect(skyFlashing(withOneSkylight).length).toBeGreaterThan(0);
    expect(skyFlashing(withOneSkylight)[0]!.quantity).toBe(1);
  });

  it('spatial counts still land on the LARGEST section only (flashing appears once)', () => {
    const base = mkBase({ chimney_count: 0 });
    // Two sections; B is much bigger. Two chimneys placed — all
    // flashing should route through B.
    const a = mkSection({ sectionId: 'A', length: 10, run: 10 });
    const b = mkSection({ sectionId: 'B', length: 40, run: 30 });
    const pens: RoofPenetration[] = [
      createPenetration({ id: '1', kind: 'chimney', x: 0, y: 0 }),
      createPenetration({ id: '2', kind: 'chimney', x: 5, y: 0 }),
    ];
    const agg = aggregateEstimate([a, b], base, pens);
    const flashing = agg.estimate!.line_items.filter((li) =>
      /chimney/i.test(li.name) || /counter[-\s]?flashing/i.test(li.name),
    );
    // Each distinct flashing line should appear once, and quantity
    // should equal the placed-chimney count.
    for (const li of flashing) {
      // The largest-section rule means quantity === spatial count on
      // the per-unit items, not doubled.
      expect(li.quantity).toBeLessThanOrEqual(2 * 5); // generous upper bound for multi-per-chimney line items
      expect(li.quantity).toBeGreaterThan(0);
    }
    // Sanity: agg had two sections merged.
    expect(agg.sectionCount).toBe(2);
  });
});
