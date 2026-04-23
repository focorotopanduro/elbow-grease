/**
 * PexBendClassifier — Phase 6 tests.
 *
 * Every assertion encodes one sentence from the user's ask:
 *
 *   "90° turn → 90° fitting"                       (fitting_90)
 *   "45° turn → smooth bend (no fitting)"          (smooth_bend)
 *   "PEX doesn't generate 90s unless specifically" (yes if ~90, else smooth)
 *   "gentle deviations → smooth out the edges"     (smooth_curve)
 *   "too tight → sharp_bend warning"               (sharp_bend)
 */

import { describe, it, expect } from 'vitest';
import {
  classifyBend,
  classifyRoute,
  deflectionDeg,
  snapToStandardFittingAngle,
  FITTING_90_TOLERANCE_DEG,
} from '../PexBendClassifier';

// ── Direction fixtures ─────────────────────────────────────────

const X: [number, number, number] = [1, 0, 0];
const Z: [number, number, number] = [0, 0, 1];
const NEG_X: [number, number, number] = [-1, 0, 0];
const DIAG_XZ: [number, number, number] = [1, 0, 1]; // 45° in XZ plane

// ── deflectionDeg ──────────────────────────────────────────────

describe('deflectionDeg', () => {
  it('returns 0 for collinear continuation (straight)', () => {
    expect(deflectionDeg(X, X)).toBeCloseTo(0, 3);
  });

  it('returns 90 for a right-angle turn', () => {
    expect(deflectionDeg(X, Z)).toBeCloseTo(90, 3);
  });

  it('returns 45 for a 45° turn in-plane', () => {
    expect(deflectionDeg(X, DIAG_XZ)).toBeCloseTo(45, 3);
  });

  it('returns 180 for a full reversal', () => {
    expect(deflectionDeg(X, NEG_X)).toBeCloseTo(180, 3);
  });

  it('handles unnormalized inputs', () => {
    const big: [number, number, number] = [10, 0, 0];
    const up: [number, number, number] = [0, 0, 5];
    expect(deflectionDeg(big, up)).toBeCloseTo(90, 3);
  });

  it('handles zero-length defensively', () => {
    const zero: [number, number, number] = [0, 0, 0];
    // Zero-normalized input → dot=0 → acos(0) = 90. Not meaningful
    // geometrically, but must not throw.
    expect(() => deflectionDeg(zero, X)).not.toThrow();
  });
});

// ── snapToStandardFittingAngle ────────────────────────────────

describe('snapToStandardFittingAngle', () => {
  it('snaps 91° to 90°', () => {
    expect(snapToStandardFittingAngle(91)).toBe(90);
  });

  it('snaps 46° to 45°', () => {
    expect(snapToStandardFittingAngle(46)).toBe(45);
  });

  it('snaps 25° to 22.5°', () => {
    expect(snapToStandardFittingAngle(25)).toBe(22.5);
  });

  it('returns "custom" for 65° (too far from any standard)', () => {
    expect(snapToStandardFittingAngle(65)).toBe('custom');
  });
});

// ── classifyBend: PEX ─────────────────────────────────────────

describe('classifyBend — PEX', () => {
  it('90° turn → fitting_90 (user explicitly drew a right angle)', () => {
    const out = classifyBend(X, Z, 'pex');
    expect(out.kind).toBe('fitting_90');
    expect(out.standardFittingAngleDeg).toBe(90);
    expect(out.deflectionDeg).toBeCloseTo(90, 3);
  });

  it('88° turn (within 7° tolerance) → still fitting_90', () => {
    // Construct a 88° turn: x dir vs. (cos8°, 0, sin88°ish)
    const a = 88 * Math.PI / 180;
    const out = classifyBend(X, [Math.cos(a), 0, Math.sin(a)], 'pex');
    expect(out.kind).toBe('fitting_90');
  });

  it('100° turn (outside 7° tolerance) → smooth_bend', () => {
    const a = 100 * Math.PI / 180;
    const out = classifyBend(X, [Math.cos(a), 0, Math.sin(a)], 'pex');
    // 100° is beyond 90±7 so NOT a right-angle fitting. Still under
    // SHARP_BEND_DEFLECTION_DEG (120), so smooth_bend.
    expect(out.kind).toBe('smooth_bend');
  });

  it('45° turn → smooth_bend (the organic flex behavior)', () => {
    const out = classifyBend(X, DIAG_XZ, 'pex');
    expect(out.kind).toBe('smooth_bend');
    expect(out.deflectionDeg).toBeCloseTo(45, 3);
  });

  it('10° turn → smooth_curve (barely a deviation)', () => {
    const a = 10 * Math.PI / 180;
    const out = classifyBend(X, [Math.cos(a), 0, Math.sin(a)], 'pex');
    expect(out.kind).toBe('smooth_curve');
  });

  it('150° turn (very tight fold) → sharp_bend warning', () => {
    const a = 150 * Math.PI / 180;
    const out = classifyBend(X, [Math.cos(a), 0, Math.sin(a)], 'pex');
    expect(out.kind).toBe('sharp_bend');
  });
});

// ── classifyBend: rigid materials ──────────────────────────────

describe('classifyBend — rigid materials', () => {
  it('PVC at 90° → fitting_other with angle=90', () => {
    const out = classifyBend(X, Z, 'pvc_sch40');
    expect(out.kind).toBe('fitting_other');
    expect(out.standardFittingAngleDeg).toBe(90);
  });

  it('PVC at 45° → fitting_other with angle=45 (not smooth_bend!)', () => {
    const out = classifyBend(X, DIAG_XZ, 'pvc_sch40');
    expect(out.kind).toBe('fitting_other');
    expect(out.standardFittingAngleDeg).toBe(45);
  });

  it('PVC at 10° → smooth_curve (no fitting for near-straight)', () => {
    const a = 10 * Math.PI / 180;
    const out = classifyBend(X, [Math.cos(a), 0, Math.sin(a)], 'pvc_sch40');
    expect(out.kind).toBe('smooth_curve');
  });

  it('Copper behaves rigid-style like PVC', () => {
    const out = classifyBend(X, Z, 'copper_type_l');
    expect(out.kind).toBe('fitting_other');
    expect(out.standardFittingAngleDeg).toBe(90);
  });
});

// ── classifyRoute: full polyline walk ──────────────────────────

describe('classifyRoute', () => {
  it('empty for fewer than 3 points', () => {
    expect(classifyRoute([[0, 0, 0], [1, 0, 0]], 'pex')).toEqual([]);
  });

  it('classifies interior vertices of a zig-zag PEX route', () => {
    // X direction → Z direction → X direction: two 90° turns
    const pts: Array<[number, number, number]> = [
      [0, 0, 0],
      [5, 0, 0],
      [5, 0, 5],
      [10, 0, 5],
    ];
    const classes = classifyRoute(pts, 'pex');
    expect(classes).toHaveLength(2);
    expect(classes[0]!.kind).toBe('fitting_90');
    expect(classes[1]!.kind).toBe('fitting_90');
  });

  it('PEX 45° route: smooth_bends end-to-end', () => {
    const pts: Array<[number, number, number]> = [
      [0, 0, 0],
      [5, 0, 0],
      [10, 0, 5], // 45° turn
      [15, 0, 5], // 45° turn back
    ];
    const classes = classifyRoute(pts, 'pex');
    expect(classes).toHaveLength(2);
    for (const c of classes) expect(c.kind).toBe('smooth_bend');
  });
});

// ── Guardrail: FITTING_90_TOLERANCE_DEG is within sane range ─────

describe('classifier constants', () => {
  it('FITTING_90_TOLERANCE_DEG is reasonable for CAD snapping', () => {
    expect(FITTING_90_TOLERANCE_DEG).toBeGreaterThanOrEqual(3);
    expect(FITTING_90_TOLERANCE_DEG).toBeLessThanOrEqual(15);
  });
});
