/**
 * groupRotation — Phase 14.M tests.
 *
 * Covers:
 *   • computeGroupCentroid: pipes + fixtures averaged together
 *   • rotatePointAroundCenter: 90° / 180° / 360° cardinal cases
 *   • rotateGroupAroundY: pipes + fixtures simultaneous rotation
 *   • Fixture rotationDeg accumulates the delta
 *   • Y is preserved (rotation is XZ only)
 *   • Empty input is safe
 *   • Round-trip: rotate by +Δ then −Δ returns original positions
 */

import { describe, it, expect } from 'vitest';
import {
  computeGroupCentroid,
  rotatePointAroundCenter,
  rotateGroupAroundY,
  normalizeDeg,
} from '../groupRotation';

// ── computeGroupCentroid ─────────────────────────────────────

describe('computeGroupCentroid', () => {
  it('returns [0,0,0] for empty input', () => {
    expect(computeGroupCentroid([], [])).toEqual([0, 0, 0]);
  });

  it('averages pipe points + fixture positions equally', () => {
    const c = computeGroupCentroid(
      [{ id: 'p1', points: [[0, 0, 0], [10, 0, 0]] }],
      [{ id: 'f1', position: [4, 0, 0], rotationDeg: 0 },
       { id: 'f2', position: [6, 0, 0], rotationDeg: 0 }],
    );
    // sum_x = 0 + 10 + 4 + 6 = 20, n = 4 → 5
    expect(c).toEqual([5, 0, 0]);
  });

  it('preserves Y (uses average)', () => {
    const c = computeGroupCentroid(
      [],
      [
        { id: 'a', position: [0, 0, 0], rotationDeg: 0 },
        { id: 'b', position: [0, 10, 0], rotationDeg: 0 },
      ],
    );
    expect(c[1]).toBeCloseTo(5, 3);
  });
});

// ── rotatePointAroundCenter ──────────────────────────────────

describe('rotatePointAroundCenter', () => {
  it('0° is a no-op', () => {
    expect(rotatePointAroundCenter([3, 0, 4], [0, 0, 0], 0)).toEqual([3, 0, 4]);
  });

  it('90° CCW around origin: (1,0,0) → (0,0,1)', () => {
    const r = rotatePointAroundCenter([1, 0, 0], [0, 0, 0], 90);
    expect(r[0]).toBeCloseTo(0, 5);
    expect(r[2]).toBeCloseTo(1, 5);
  });

  it('180° around origin flips both signs', () => {
    const r = rotatePointAroundCenter([3, 0, 4], [0, 0, 0], 180);
    expect(r[0]).toBeCloseTo(-3, 5);
    expect(r[2]).toBeCloseTo(-4, 5);
  });

  it('360° returns to original', () => {
    const r = rotatePointAroundCenter([3, 5, 4], [1, 2, 1], 360);
    expect(r[0]).toBeCloseTo(3, 5);
    expect(r[1]).toBeCloseTo(5, 5);
    expect(r[2]).toBeCloseTo(4, 5);
  });

  it('preserves Y — rotation is around world Y axis', () => {
    const r = rotatePointAroundCenter([3, 7, 4], [0, 0, 0], 90);
    expect(r[1]).toBe(7);
  });

  it('rotates around a non-zero center', () => {
    // Point (11, 0, 10) rotated 90° CCW around (10, 0, 10) → (10, 0, 11)
    const r = rotatePointAroundCenter([11, 0, 10], [10, 0, 10], 90);
    expect(r[0]).toBeCloseTo(10, 5);
    expect(r[2]).toBeCloseTo(11, 5);
  });
});

// ── rotateGroupAroundY ───────────────────────────────────────

describe('rotateGroupAroundY', () => {
  it('rotates every pipe point + fixture position around center', () => {
    const result = rotateGroupAroundY(
      {
        pipes: [{ id: 'p1', points: [[1, 0, 0], [2, 0, 0]] }],
        fixtures: [{ id: 'f1', position: [0, 0, 1], rotationDeg: 0 }],
      },
      [0, 0, 0],
      90,
    );
    // Pipe points rotated 90° CCW
    expect(result.pipes[0]!.points[0]![0]).toBeCloseTo(0, 5);
    expect(result.pipes[0]!.points[0]![2]).toBeCloseTo(1, 5);
    expect(result.pipes[0]!.points[1]![0]).toBeCloseTo(0, 5);
    expect(result.pipes[0]!.points[1]![2]).toBeCloseTo(2, 5);
    // Fixture position rotated: (0,0,1) → (-1,0,0)
    expect(result.fixtures[0]!.position[0]).toBeCloseTo(-1, 5);
    expect(result.fixtures[0]!.position[2]).toBeCloseTo(0, 5);
  });

  it('fixture rotationDeg accumulates the delta', () => {
    const result = rotateGroupAroundY(
      {
        pipes: [],
        fixtures: [{ id: 'f1', position: [0, 0, 0], rotationDeg: 45 }],
      },
      [0, 0, 0],
      90,
    );
    expect(result.fixtures[0]!.rotationDeg).toBeCloseTo(135, 5);
  });

  it('fixture rotationDeg wraps past 360', () => {
    const result = rotateGroupAroundY(
      {
        pipes: [],
        fixtures: [{ id: 'f1', position: [0, 0, 0], rotationDeg: 350 }],
      },
      [0, 0, 0],
      30,
    );
    expect(result.fixtures[0]!.rotationDeg).toBeCloseTo(20, 5);
  });

  it('handles empty input', () => {
    const result = rotateGroupAroundY({ pipes: [], fixtures: [] }, [0, 0, 0], 90);
    expect(result.pipes).toEqual([]);
    expect(result.fixtures).toEqual([]);
  });

  it('round-trip: rotate +Δ then −Δ returns original positions', () => {
    const input = {
      pipes: [{ id: 'p1', points: [[3, 5, 4], [7, 5, 1]] as [number, number, number][] }],
      fixtures: [{ id: 'f1', position: [2, 0, 6] as [number, number, number], rotationDeg: 15 }],
    };
    const center: [number, number, number] = [5, 0, 5];
    const forward = rotateGroupAroundY(input, center, 73);
    const back = rotateGroupAroundY(
      { pipes: forward.pipes, fixtures: forward.fixtures },
      center,
      -73,
    );
    // Pipe points should be within a tiny epsilon of the original.
    for (let i = 0; i < input.pipes[0]!.points.length; i++) {
      const orig = input.pipes[0]!.points[i]!;
      const rt = back.pipes[0]!.points[i]!;
      expect(rt[0]).toBeCloseTo(orig[0], 4);
      expect(rt[1]).toBeCloseTo(orig[1], 4);
      expect(rt[2]).toBeCloseTo(orig[2], 4);
    }
    // Fixture position + rotation restored.
    expect(back.fixtures[0]!.position[0]).toBeCloseTo(input.fixtures[0]!.position[0], 4);
    expect(back.fixtures[0]!.position[2]).toBeCloseTo(input.fixtures[0]!.position[2], 4);
    expect(back.fixtures[0]!.rotationDeg).toBeCloseTo(input.fixtures[0]!.rotationDeg, 4);
  });
});

// ── normalizeDeg (export hygiene check) ──────────────────────

describe('normalizeDeg', () => {
  it('handles wrap + negative', () => {
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(-15)).toBe(345);
  });
});
