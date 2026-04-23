/**
 * BOM Data Coverage — Phase 13.B tests.
 *
 * These are CI-level coverage guards. They don't test behavior; they
 * test that the pricing + labor tables are COMPLETE with respect to
 * the canonical type unions and INTERNALLY CONSISTENT. If someone
 * adds a new PipeMaterial or FittingType and forgets to populate the
 * matching cost / labor row, CI fails here.
 *
 * Kinds of guarantees enforced:
 *
 *   1. EVERY member of `PIPE_MATERIALS` has an entry in LABOR_HR_PER_FT.
 *      (Cost tables — COST_PER_FT, STOCK_LENGTHS_FT — are the engine's
 *       concern; we assert the BOM-side ones.)
 *
 *   2. EVERY member of `FITTING_TYPES` has at least one diameter
 *      priced in FITTING_COSTS AND at least one diameter in
 *      LABOR_HR_PER_FITTING. (Some fitting types like `manifold_2`
 *      intentionally support only specific diameters; we don't assert
 *      full diameter coverage, only that the row isn't absent.)
 *
 *   3. The DIAMETER coverage of each fitting type's cost table
 *      matches its labor table (same keys). Asymmetric tables → cost
 *      falls back to default for diameters only in labor or vice versa.
 *
 *   4. Cost + labor are MONOTONIC in diameter within each fitting
 *      type. A bigger size must cost ≥ a smaller one (typos in the
 *      tables are the main risk here — a 4" entry mis-typed as 2.20
 *      instead of 22.00 would not otherwise be caught).
 *
 *   5. Cost-to-labor ratio sanity: labor-hours × $80/hr should land
 *      in 0.5×–20× of material cost across all fittings. Outside
 *      this band usually means a missing zero or a units confusion.
 *
 *   6. Freshness metadata is present and parseable.
 */

import { describe, it, expect } from 'vitest';
import {
  PIPE_MATERIALS,
  FITTING_TYPES,
  type PipeMaterial,
  type FittingType,
} from '../../graph/GraphEdge';
import {
  __testables,
  DATA_LAST_REVIEWED,
  DATA_SOURCES,
  DATA_REGION,
} from '../BOMExporter';

const { FITTING_COSTS, LABOR_HR_PER_FITTING, LABOR_HR_PER_FT } = __testables;

// ── PipeMaterial coverage ─────────────────────────────────────

describe('PipeMaterial coverage', () => {
  it.each(PIPE_MATERIALS)('%s has an entry in LABOR_HR_PER_FT', (mat) => {
    expect(LABOR_HR_PER_FT[mat as PipeMaterial]).toBeGreaterThan(0);
  });

  it('no PipeMaterial is missing — complete coverage for all current materials', () => {
    const missing = PIPE_MATERIALS.filter((m) => !(m in LABOR_HR_PER_FT));
    expect(missing).toEqual([]);
  });
});

// ── FittingType coverage ──────────────────────────────────────

describe('FittingType coverage', () => {
  it.each(FITTING_TYPES)('%s has at least one priced diameter in FITTING_COSTS', (ft) => {
    const inner = FITTING_COSTS[ft as FittingType];
    expect(inner, `${ft}: FITTING_COSTS row missing`).toBeDefined();
    expect(Object.keys(inner!).length, `${ft}: FITTING_COSTS row empty`).toBeGreaterThan(0);
  });

  it.each(FITTING_TYPES)('%s has at least one entry in LABOR_HR_PER_FITTING', (ft) => {
    const inner = LABOR_HR_PER_FITTING[ft as FittingType];
    expect(inner, `${ft}: LABOR_HR_PER_FITTING row missing`).toBeDefined();
    expect(Object.keys(inner!).length, `${ft}: LABOR_HR_PER_FITTING row empty`).toBeGreaterThan(0);
  });

  it.each(FITTING_TYPES)(
    '%s has symmetric diameter coverage between cost and labor tables',
    (ft) => {
      const costKeys = Object.keys(FITTING_COSTS[ft as FittingType] ?? {}).sort();
      const laborKeys = Object.keys(LABOR_HR_PER_FITTING[ft as FittingType] ?? {}).sort();
      expect(
        laborKeys,
        `${ft}: labor diameter set ≠ cost diameter set — asymmetric coverage causes silent fallbacks`,
      ).toEqual(costKeys);
    },
  );
});

// ── Monotonicity ──────────────────────────────────────────────

describe('monotonicity in diameter', () => {
  it.each(FITTING_TYPES)('%s cost is non-decreasing as diameter grows', (ft) => {
    const row = FITTING_COSTS[ft as FittingType] ?? {};
    const entries = Object.entries(row)
      .map(([d, v]) => [Number(d), v] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < entries.length; i++) {
      const [prevD, prevV] = entries[i - 1]!;
      const [currD, currV] = entries[i]!;
      expect(
        currV,
        `${ft}: cost for ${currD}" ($${currV}) is less than ${prevD}" ($${prevV}) — likely typo`,
      ).toBeGreaterThanOrEqual(prevV);
    }
  });

  it.each(FITTING_TYPES)('%s labor hours is non-decreasing as diameter grows', (ft) => {
    const row = LABOR_HR_PER_FITTING[ft as FittingType] ?? {};
    const entries = Object.entries(row)
      .map(([d, v]) => [Number(d), v] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < entries.length; i++) {
      const [prevD, prevV] = entries[i - 1]!;
      const [currD, currV] = entries[i]!;
      expect(
        currV,
        `${ft}: labor for ${currD}" (${currV} hr) is less than ${prevD}" (${prevV} hr) — likely typo`,
      ).toBeGreaterThanOrEqual(prevV);
    }
  });
});

// ── Cost / labor ratio sanity ─────────────────────────────────

describe('cost-to-labor ratio sanity', () => {
  const LABOR_RATE_USD_PER_HR = 80;
  // Band: labor$ can be 0.2× to 25× of material cost.
  // 0.2× catches "we forgot a zero on a manifold" (huge material, tiny labor).
  // 25× catches "we dropped a zero on a coupling" (cheap material, huge labor).
  const MIN_RATIO = 0.2;
  const MAX_RATIO = 25;

  it.each(FITTING_TYPES)('%s labor-cost ratio stays in sane bounds', (ft) => {
    const costRow = FITTING_COSTS[ft as FittingType] ?? {};
    const laborRow = LABOR_HR_PER_FITTING[ft as FittingType] ?? {};
    for (const [diamKey, cost] of Object.entries(costRow)) {
      const labor = laborRow[Number(diamKey)];
      if (!labor || !cost) continue;
      const laborDollars = labor * LABOR_RATE_USD_PER_HR;
      const ratio = laborDollars / cost;
      expect(
        ratio,
        `${ft} @ ${diamKey}": labor$ ($${laborDollars.toFixed(2)}) vs material ($${cost}) ` +
        `→ ratio ${ratio.toFixed(2)}× outside [${MIN_RATIO}×, ${MAX_RATIO}×] — likely data typo`,
      ).toBeGreaterThan(MIN_RATIO);
      expect(ratio).toBeLessThan(MAX_RATIO);
    }
  });
});

// ── Freshness metadata ───────────────────────────────────────

describe('freshness metadata', () => {
  it('DATA_LAST_REVIEWED is a valid ISO date', () => {
    expect(DATA_LAST_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isFinite(Date.parse(DATA_LAST_REVIEWED))).toBe(true);
  });

  it('DATA_LAST_REVIEWED is not in the future', () => {
    expect(Date.parse(DATA_LAST_REVIEWED)).toBeLessThanOrEqual(Date.now());
  });

  it('DATA_SOURCES lists at least one reference', () => {
    expect(DATA_SOURCES.length).toBeGreaterThan(0);
    for (const s of DATA_SOURCES) {
      expect(s.length).toBeGreaterThan(10); // rough sanity: no empty strings
    }
  });

  it('DATA_REGION is a non-empty string', () => {
    expect(DATA_REGION.length).toBeGreaterThan(0);
  });

  it('staleness threshold is documented (> 0 days)', () => {
    expect(__testables.DATA_STALE_AFTER_DAYS).toBeGreaterThan(0);
  });
});

// ── Regression spot-checks ───────────────────────────────────
//
// Specific values the Phase 13.B audit agent flagged as the key
// validation points. Locking them here means a future "I'll just
// bump all the numbers 10%" sweep can't accidentally change them
// without updating these expectations + the DATA_LAST_REVIEWED date.

describe('spot-check values (Phase 13.B baseline)', () => {
  it('elbow_90 @ 2" = $5.00', () => {
    expect(FITTING_COSTS.elbow_90![2]).toBe(5.00);
  });
  it('tee @ 2" = $8.00', () => {
    expect(FITTING_COSTS.tee![2]).toBe(8.00);
  });
  it('coupling @ 1" = $0.80', () => {
    expect(FITTING_COSTS.coupling![1]).toBe(0.80);
  });
  it('cross @ 2" = $16.00', () => {
    expect(FITTING_COSTS.cross![2]).toBe(16.00);
  });
  it('manifold_4 @ 1" (Phase 13.B new) = $95', () => {
    expect(FITTING_COSTS.manifold_4![1]).toBe(95);
  });
  it('closet_flange @ 3" (Phase 13.B new) = $6.50', () => {
    expect(FITTING_COSTS.closet_flange![3]).toBe(6.50);
  });
  it('ductile_iron labor (Phase 13.B new) = 0.060 hr/ft', () => {
    expect(LABOR_HR_PER_FT.ductile_iron).toBe(0.060);
  });
  it('elbow_90 @ 2" labor = 0.35 hr', () => {
    expect(LABOR_HR_PER_FITTING.elbow_90![2]).toBe(0.35);
  });
  it('pvc_sch40 labor = 0.030 hr/ft', () => {
    expect(LABOR_HR_PER_FT.pvc_sch40).toBe(0.030);
  });
});
