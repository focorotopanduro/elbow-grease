/**
 * groupTranslate — Phase 14.O tests.
 *
 * Covers:
 *   • translateVec / translateGroup apply delta correctly
 *   • constrainToDominantAxis picks the larger axis
 *   • snapDeltaToGrid rounds to step, preserves Y
 *   • beginTranslateDrag + dragToTranslation end-to-end with modifiers
 *   • computeCentroid empty / populated
 *   • Round-trip: translate +delta then -delta restores original
 */

import { describe, it, expect } from 'vitest';
import {
  translateVec,
  translateGroup,
  constrainToDominantAxis,
  snapDeltaToGrid,
  beginTranslateDrag,
  dragToTranslation,
  computeCentroid,
} from '../groupTranslate';

// ── translateVec / translateGroup ────────────────────────────

describe('translateVec', () => {
  it('adds delta component-wise', () => {
    expect(translateVec([1, 2, 3], [10, 20, 30])).toEqual([11, 22, 33]);
  });

  it('zero delta is identity', () => {
    expect(translateVec([3, 4, 5], [0, 0, 0])).toEqual([3, 4, 5]);
  });

  it('negative delta subtracts', () => {
    expect(translateVec([5, 5, 5], [-1, -2, -3])).toEqual([4, 3, 2]);
  });
});

describe('translateGroup', () => {
  it('shifts every pipe point + fixture position', () => {
    const r = translateGroup(
      {
        pipes: [{ id: 'p1', points: [[0, 0, 0], [5, 0, 0]] }],
        fixtures: [{ id: 'f1', position: [3, 0, 3] }],
      },
      [10, 0, 10],
    );
    expect(r.pipes[0]!.points[0]).toEqual([10, 0, 10]);
    expect(r.pipes[0]!.points[1]).toEqual([15, 0, 10]);
    expect(r.fixtures[0]!.position).toEqual([13, 0, 13]);
  });

  it('round-trip: +delta then -delta returns original', () => {
    const input = {
      pipes: [{ id: 'p1', points: [[1, 2, 3], [4, 5, 6]] as [number, number, number][] }],
      fixtures: [{ id: 'f1', position: [7, 8, 9] as [number, number, number] }],
    };
    const delta: [number, number, number] = [2.5, 0, -3.7];
    const forward = translateGroup(input, delta);
    const back = translateGroup(forward, [-delta[0], -delta[1], -delta[2]]);
    expect(back.pipes[0]!.points[0]).toEqual([1, 2, 3]);
    expect(back.pipes[0]!.points[1]).toEqual([4, 5, 6]);
    expect(back.fixtures[0]!.position).toEqual([7, 8, 9]);
  });

  it('empty input → empty output', () => {
    const r = translateGroup({ pipes: [], fixtures: [] }, [1, 2, 3]);
    expect(r.pipes).toEqual([]);
    expect(r.fixtures).toEqual([]);
  });
});

// ── constrainToDominantAxis ─────────────────────────────────

describe('constrainToDominantAxis', () => {
  it('picks X when |dx| > |dz|', () => {
    expect(constrainToDominantAxis([5, 0, 2])).toEqual([5, 0, 0]);
  });

  it('picks Z when |dz| > |dx|', () => {
    expect(constrainToDominantAxis([2, 0, 5])).toEqual([0, 0, 5]);
  });

  it('picks X when equal (tie goes to first axis)', () => {
    expect(constrainToDominantAxis([3, 0, 3])).toEqual([3, 0, 0]);
  });

  it('preserves Y component in the constrained result', () => {
    expect(constrainToDominantAxis([5, 10, 2])).toEqual([5, 10, 0]);
  });

  it('handles negative axes (absolute value for comparison)', () => {
    expect(constrainToDominantAxis([-5, 0, 2])).toEqual([-5, 0, 0]);
    expect(constrainToDominantAxis([1, 0, -7])).toEqual([0, 0, -7]);
  });
});

// ── snapDeltaToGrid ─────────────────────────────────────────

describe('snapDeltaToGrid', () => {
  it('rounds to nearest step', () => {
    expect(snapDeltaToGrid([1.3, 0, 2.7], 1)).toEqual([1, 0, 3]);
    expect(snapDeltaToGrid([0.4, 0, 0.6], 1)).toEqual([0, 0, 1]);
  });

  it('fractional step snaps to half-feet', () => {
    expect(snapDeltaToGrid([1.24, 0, 1.26], 0.5)).toEqual([1, 0, 1.5]);
  });

  it('preserves Y (vertical snapping belongs to floor elevation)', () => {
    expect(snapDeltaToGrid([1.3, 2.7, 1.4], 1)).toEqual([1, 2.7, 1]);
  });

  it('step ≤ 0 → passthrough', () => {
    expect(snapDeltaToGrid([1.23, 0, 4.56], 0)).toEqual([1.23, 0, 4.56]);
    expect(snapDeltaToGrid([1.23, 0, 4.56], -1)).toEqual([1.23, 0, 4.56]);
  });
});

// ── Drag session ────────────────────────────────────────────

describe('drag session', () => {
  const start = { startHit: [0, 0, 0] as [number, number, number], startCentroid: [10, 3, 10] as [number, number, number] };

  it('dragToTranslation: bare drag = straight delta', () => {
    const r = dragToTranslation(
      beginTranslateDrag(start.startHit, start.startCentroid),
      [5, 0, 3],
    );
    expect(r.delta).toEqual([5, 0, 3]);
    expect(r.newCentroid).toEqual([15, 3, 13]);
  });

  it('constrainToAxis picks the larger axis', () => {
    const r = dragToTranslation(
      beginTranslateDrag(start.startHit, start.startCentroid),
      [5, 0, 2],
      { constrainToAxis: true },
    );
    expect(r.delta).toEqual([5, 0, 0]);
  });

  it('snapStep rounds the delta before applying', () => {
    const r = dragToTranslation(
      beginTranslateDrag(start.startHit, start.startCentroid),
      [1.3, 0, 2.7],
      { snapStep: 1 },
    );
    expect(r.delta).toEqual([1, 0, 3]);
    expect(r.newCentroid).toEqual([11, 3, 13]);
  });

  it('constrain + snap compose: axis first, then snap', () => {
    const r = dragToTranslation(
      beginTranslateDrag(start.startHit, start.startCentroid),
      [5.4, 0, 2.1],
      { constrainToAxis: true, snapStep: 1 },
    );
    expect(r.delta).toEqual([5, 0, 0]);
  });

  it('no-op drag returns zero delta', () => {
    const r = dragToTranslation(
      beginTranslateDrag([5, 0, 5], [10, 3, 10]),
      [5, 0, 5],
    );
    expect(r.delta).toEqual([0, 0, 0]);
    expect(r.newCentroid).toEqual([10, 3, 10]);
  });
});

// ── Centroid ────────────────────────────────────────────────

describe('computeCentroid', () => {
  it('empty → [0,0,0]', () => {
    expect(computeCentroid([], [])).toEqual([0, 0, 0]);
  });

  it('averages across pipes + fixtures', () => {
    const c = computeCentroid(
      [{ id: 'p', points: [[0, 0, 0], [10, 0, 0]] }],
      [{ id: 'f', position: [2, 0, 0] }],
    );
    expect(c).toEqual([4, 0, 0]);
  });
});
