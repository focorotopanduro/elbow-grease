/**
 * pointsKey — Phase 14.AC.1 tests.
 *
 * Verifies value-stability + correct differentiation so it's safe
 * to use as a useMemo dep on regenerated Vec3[] arrays.
 */

import { describe, it, expect } from 'vitest';
import { pointsKey, type Vec3Tuple } from '../pointsKey';

describe('pointsKey — stability', () => {
  it('identical values across different array identities → same key', () => {
    const a: Vec3Tuple[] = [[0, 1, 2], [3, 4, 5]];
    const b: Vec3Tuple[] = [[0, 1, 2], [3, 4, 5]];
    expect(pointsKey(a)).toBe(pointsKey(b));
    // And, crucially, NOT the same array
    expect(a).not.toBe(b);
  });

  it('sub-precision jitter stays on the same key', () => {
    // 1e-5 is below our 1e-4 precision — should round to the same coord
    const a: Vec3Tuple[] = [[0.12345, 0.67890, 1.23456]];
    const b: Vec3Tuple[] = [[0.12346, 0.67891, 1.23457]];
    expect(pointsKey(a)).toBe(pointsKey(b));
  });

  it('differs on coord change above precision', () => {
    const a: Vec3Tuple[] = [[0, 1, 2]];
    const b: Vec3Tuple[] = [[0, 1, 2.001]]; // 1e-3 — well above 1e-4
    expect(pointsKey(a)).not.toBe(pointsKey(b));
  });

  it('differs on point-count change', () => {
    const two: Vec3Tuple[] = [[0, 0, 0], [1, 1, 1]];
    const three: Vec3Tuple[] = [[0, 0, 0], [1, 1, 1], [2, 2, 2]];
    expect(pointsKey(two)).not.toBe(pointsKey(three));
  });

  it('cannot alias — prefix of a longer polyline produces distinct key', () => {
    const short: Vec3Tuple[] = [[0, 0, 0], [1, 0, 0]];
    const longer: Vec3Tuple[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];
    expect(pointsKey(short)).not.toBe(pointsKey(longer));
  });

  it('empty + null + undefined → stable degenerate key', () => {
    expect(pointsKey([])).toBe('0:');
    expect(pointsKey(null)).toBe('0:');
    expect(pointsKey(undefined)).toBe('0:');
  });

  it('NaN / Infinity coords round to 0 (no key explosions from bad math)', () => {
    const bad: Vec3Tuple[] = [[NaN, Infinity, -Infinity]];
    const zero: Vec3Tuple[] = [[0, 0, 0]];
    expect(pointsKey(bad)).toBe(pointsKey(zero));
  });

  it('negative-zero normalizes with positive-zero', () => {
    const neg: Vec3Tuple[] = [[-0, -0, -0]];
    const pos: Vec3Tuple[] = [[0, 0, 0]];
    expect(pointsKey(neg)).toBe(pointsKey(pos));
  });
});

describe('pointsKey — realism check', () => {
  it('real pivot-session sized drag produces identical keys for identical geometry', () => {
    // Simulates a pivot session where the controller builds the same
    // 3-point polyline each frame from snapped anchor + grabbed angle.
    const frame1: Vec3Tuple[] = [[0, 0, 0], [5, 0, 0], [5, 0, 5]];
    const frame2: Vec3Tuple[] = [[0, 0, 0], [5, 0, 0], [5, 0, 5]];
    const frame3: Vec3Tuple[] = [[0, 0, 0], [5, 0, 0], [5, 0, 5]];
    const k = pointsKey(frame1);
    expect(pointsKey(frame2)).toBe(k);
    expect(pointsKey(frame3)).toBe(k);
  });

  it('a real user nudge (0.5 unit grid step) produces a different key', () => {
    const before: Vec3Tuple[] = [[0, 0, 0], [5, 0, 0]];
    const after: Vec3Tuple[] = [[0, 0, 0], [5.5, 0, 0]];
    expect(pointsKey(before)).not.toBe(pointsKey(after));
  });
});
