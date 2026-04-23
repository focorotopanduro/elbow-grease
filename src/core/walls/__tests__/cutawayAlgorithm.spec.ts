/**
 * cutawayAlgorithm — Phase 12.A tests.
 *
 * Pure geometry, so we can cover every edge case deterministically.
 *
 * Scene layout (top-down, XZ plane):
 *
 *       Z
 *       ^
 *    5  |          o focus (0, 0)
 *       |
 *    0  |=============   ← wall A (south wall from (-5,0) to (5,0))
 *       |
 *   -5  |          o camera (0, -5)
 *       +------------------->  X
 *          -5       0       5
 *
 *   In this layout wall A is between camera and focus → culled.
 *   A wall north of the focus (e.g. Z=5) is NOT culled.
 */

import { describe, it, expect } from 'vitest';
import { computeCutawaySet, segmentsIntersect, type CutawayWall } from '../cutawayAlgorithm';

// ── segmentsIntersect — low-level geometry ────────────────────

describe('segmentsIntersect', () => {
  it('perpendicular crossing returns true', () => {
    expect(segmentsIntersect([0, -1], [0, 1], [-1, 0], [1, 0])).toBe(true);
  });

  it('parallel, non-overlapping returns false', () => {
    expect(segmentsIntersect([0, 0], [2, 0], [0, 1], [2, 1])).toBe(false);
  });

  it('collinear overlapping returns false (wall along sight line is not an occluder)', () => {
    expect(segmentsIntersect([0, 0], [4, 0], [2, 0], [6, 0])).toBe(false);
  });

  it('segments that share an endpoint count as intersecting', () => {
    // Sight line from (0,0) to (2,2); wall ending at (2,2).
    expect(segmentsIntersect([0, 0], [2, 2], [2, 2], [3, 5])).toBe(true);
  });

  it('T-junction (endpoint lies on the other segment) counts', () => {
    expect(segmentsIntersect([0, -1], [0, 1], [-1, 0], [0, 0])).toBe(true);
  });

  it('segments near but not touching return false', () => {
    expect(segmentsIntersect([0, 0], [1, 0], [2, -1], [2, 1])).toBe(false);
  });
});

// ── computeCutawaySet — end-to-end scene ──────────────────────

describe('computeCutawaySet', () => {
  it('empty walls list → empty set', () => {
    const out = computeCutawaySet({
      camera: [0, -5],
      focus: [0, 5],
      walls: [],
    });
    expect(out.size).toBe(0);
  });

  it('camera === focus (degenerate) → nothing culled even with walls present', () => {
    const wall: CutawayWall = { id: 'w1', start: [-1, 0], end: [1, 0] };
    const out = computeCutawaySet({
      camera: [0, 0],
      focus: [0, 0],
      walls: [wall],
    });
    expect(out.size).toBe(0);
  });

  it('wall physically between camera and focus → culled', () => {
    const southWall: CutawayWall = { id: 'south', start: [-5, 0], end: [5, 0] };
    const out = computeCutawaySet({
      camera: [0, -5],
      focus: [0, 5],
      walls: [southWall],
    });
    expect(out.has('south')).toBe(true);
    expect(out.size).toBe(1);
  });

  it('wall behind focus is NOT culled', () => {
    const northWall: CutawayWall = { id: 'north', start: [-5, 10], end: [5, 10] };
    const out = computeCutawaySet({
      camera: [0, -5],
      focus: [0, 5],
      walls: [northWall],
    });
    expect(out.has('north')).toBe(false);
  });

  it('mix: only the intervening walls cull', () => {
    const walls: CutawayWall[] = [
      { id: 'south',  start: [-5, 0],   end: [5, 0] },    // between
      { id: 'north',  start: [-5, 10],  end: [5, 10] },   // behind focus
      { id: 'west',   start: [-10, -5], end: [-10, 15] }, // sideways, not in line
      { id: 'east',   start: [10, -5],  end: [10, 15] },  // sideways, not in line
    ];
    const out = computeCutawaySet({
      camera: [0, -5],
      focus: [0, 5],
      walls,
    });
    expect([...out].sort()).toEqual(['south']);
  });

  it('diagonal sight line catches angled walls', () => {
    const diagWall: CutawayWall = { id: 'diag', start: [0, 0], end: [4, 0] };
    const out = computeCutawaySet({
      camera: [-2, -2],
      focus: [6, 2],
      walls: [diagWall],
    });
    expect(out.has('diag')).toBe(true);
  });

  it('returns a stable Set (no duplicates on re-entry)', () => {
    const wall: CutawayWall = { id: 'south', start: [-5, 0], end: [5, 0] };
    const a = computeCutawaySet({ camera: [0, -5], focus: [0, 5], walls: [wall] });
    const b = computeCutawaySet({ camera: [0, -5], focus: [0, 5], walls: [wall] });
    expect([...a]).toEqual([...b]);
  });
});
