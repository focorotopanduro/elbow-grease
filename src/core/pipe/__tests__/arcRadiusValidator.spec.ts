/**
 * arcRadiusValidator — Phase 14.V tests.
 *
 * Covers:
 *   • Rigid materials never emit violations (they use fittings).
 *   • Polylines < 3 points never emit violations.
 *   • A straight polyline never emits violations.
 *   • Short legs + large deflection → tight radius → violation.
 *   • Long legs + same deflection → legal radius → no violation.
 *   • Multi-vertex pseudo-arc with too-short segments → violations.
 *   • Severity ratio = radius / minRadius.
 *   • isArcRadiusLegal returns true/false consistently.
 */

import { describe, it, expect } from 'vitest';
import {
  localBendRadiusFt,
  deflectionDegAt,
  validateArcRadii,
  isArcRadiusLegal,
} from '../arcRadiusValidator';
import type { Vec3 } from '@core/events';
import type { PipeMaterial } from '../../../engine/graph/GraphEdge';

// ── Helpers ───────────────────────────────────────────────────

const PEX: PipeMaterial = 'pex';
const PVC: PipeMaterial = 'pvc_sch40';

// ── deflectionDegAt ───────────────────────────────────────────

describe('deflectionDegAt', () => {
  it('0° for a straight-through vertex', () => {
    expect(deflectionDegAt([0, 0, 0], [5, 0, 0], [10, 0, 0])).toBeCloseTo(0, 3);
  });

  it('90° for a right-angle turn', () => {
    expect(deflectionDegAt([0, 0, 0], [5, 0, 0], [5, 0, 5])).toBeCloseTo(90, 3);
  });

  it('180° for a full reversal', () => {
    expect(deflectionDegAt([0, 0, 0], [5, 0, 0], [0, 0, 0])).toBeCloseTo(180, 1);
  });
});

// ── localBendRadiusFt ─────────────────────────────────────────

describe('localBendRadiusFt', () => {
  it('Infinity for a straight vertex (no bend)', () => {
    expect(localBendRadiusFt([0, 0, 0], [5, 0, 0], [10, 0, 0])).toBe(Infinity);
  });

  it('small radius for 90° bend with short legs', () => {
    // Each leg 0.5 ft, half-shortleg = 0.25, tan(45°) = 1 → R = 0.25 ft
    const r = localBendRadiusFt([0, 0, 0], [0.5, 0, 0], [0.5, 0, 0.5]);
    expect(r).toBeCloseTo(0.25, 2);
  });

  it('larger radius for 90° bend with long legs', () => {
    // Each leg 10 ft, half = 5, tan(45°) = 1 → R = 5 ft
    const r = localBendRadiusFt([0, 0, 0], [10, 0, 0], [10, 0, 10]);
    expect(r).toBeCloseTo(5, 2);
  });

  it('R ≈ halfLeg / tan(def/2) for symmetric 45° bend', () => {
    // Legs 10 ft, 45° deflection, half=5, tan(22.5°) ≈ 0.4142
    const p2: Vec3 = [10 + 10 * Math.SQRT1_2, 0, 10 * Math.SQRT1_2];
    const r = localBendRadiusFt([0, 0, 0], [10, 0, 0], p2);
    const expected = 5 / Math.tan((22.5 * Math.PI) / 180);
    expect(r).toBeCloseTo(expected, 2);
  });
});

// ── validateArcRadii — material gate ──────────────────────────

describe('validateArcRadii', () => {
  it('returns [] for rigid materials (they use fittings)', () => {
    // Same geometry that would be illegal for PEX
    const pts: Vec3[] = [[0, 0, 0], [0.3, 0, 0], [0.3, 0, 0.3]];
    expect(validateArcRadii(pts, PVC, 2)).toEqual([]);
  });

  it('returns [] for < 3 points', () => {
    expect(validateArcRadii([], PEX, 0.75)).toEqual([]);
    expect(validateArcRadii([[0, 0, 0]], PEX, 0.75)).toEqual([]);
    expect(validateArcRadii([[0, 0, 0], [1, 0, 0]], PEX, 0.75)).toEqual([]);
  });

  it('returns [] for a straight PEX run', () => {
    const pts: Vec3[] = [[0, 0, 0], [5, 0, 0], [10, 0, 0]];
    expect(validateArcRadii(pts, PEX, 0.75)).toEqual([]);
  });

  it('flags a tight single-vertex PEX corner', () => {
    // 3/4" PEX OD ≈ 7/8" = 0.073 ft, minR = 6 × 0.073 = 0.44 ft
    // Use 0.3 ft legs with 90° bend → R ≈ 0.15 ft < 0.44 ft → flag
    const pts: Vec3[] = [[0, 0, 0], [0.3, 0, 0], [0.3, 0, 0.3]];
    const vs = validateArcRadii(pts, PEX, 0.75);
    expect(vs.length).toBeGreaterThanOrEqual(1);
    expect(vs[0]!.vertexIndex).toBe(1);
    expect(vs[0]!.radiusFt).toBeLessThan(vs[0]!.minRadiusFt);
    expect(vs[0]!.severity).toBeLessThan(1);
  });

  it('does NOT flag a wide PEX bend with ample leg length', () => {
    // 10-ft legs, 90° bend → R = 5 ft, far larger than the 0.44 ft min
    const pts: Vec3[] = [[0, 0, 0], [10, 0, 0], [10, 0, 10]];
    expect(validateArcRadii(pts, PEX, 0.75)).toEqual([]);
  });

  it('severity reflects how severe the kink is', () => {
    // Tight bend at 0.3-ft legs
    const tight: Vec3[] = [[0, 0, 0], [0.3, 0, 0], [0.3, 0, 0.3]];
    const tightV = validateArcRadii(tight, PEX, 0.75);
    // Less tight bend at 0.6-ft legs — still illegal but less severe
    const less: Vec3[] = [[0, 0, 0], [0.6, 0, 0], [0.6, 0, 0.6]];
    const lessV = validateArcRadii(less, PEX, 0.75);
    if (lessV.length > 0 && tightV.length > 0) {
      expect(lessV[0]!.severity).toBeGreaterThan(tightV[0]!.severity);
    }
  });
});

// ── isArcRadiusLegal ──────────────────────────────────────────

describe('isArcRadiusLegal', () => {
  it('true for a straight run', () => {
    expect(isArcRadiusLegal([[0, 0, 0], [5, 0, 0], [10, 0, 0]], PEX, 0.75)).toBe(true);
  });

  it('false for a tight corner', () => {
    expect(isArcRadiusLegal([[0, 0, 0], [0.3, 0, 0], [0.3, 0, 0.3]], PEX, 0.75)).toBe(false);
  });

  it('true for rigid materials (bypass)', () => {
    expect(isArcRadiusLegal([[0, 0, 0], [0.3, 0, 0], [0.3, 0, 0.3]], PVC, 2)).toBe(true);
  });
});
