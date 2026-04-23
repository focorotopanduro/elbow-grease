/**
 * polylineMath.nearestSegmentOnPolyline — Phase 7.A unit tests.
 *
 * Verifies segment selection + parameterization for the hit-point
 * projection the tee-from-middle-drag relies on.
 */

import { describe, it, expect } from 'vitest';
import { nearestSegmentOnPolyline } from '../polylineMath';
import type { Vec3 } from '@core/events';

// ── Fixtures ───────────────────────────────────────────────────

const THREE_POINT_L: Vec3[] = [
  [0, 0, 0],
  [5, 0, 0],
  [5, 0, 5],
];

// ── Empty / degenerate ─────────────────────────────────────────

describe('nearestSegmentOnPolyline — degenerate', () => {
  it('empty polyline returns null', () => {
    expect(nearestSegmentOnPolyline([], [0, 0, 0])).toBeNull();
  });

  it('single-point polyline returns null', () => {
    expect(nearestSegmentOnPolyline([[0, 0, 0]], [1, 2, 3])).toBeNull();
  });

  it('two coincident points (zero-length segment) returns null', () => {
    expect(nearestSegmentOnPolyline([[0, 0, 0], [0, 0, 0]], [1, 2, 3])).toBeNull();
  });
});

// ── Straight segment ──────────────────────────────────────────

describe('nearestSegmentOnPolyline — straight 2-point segment', () => {
  const seg: Vec3[] = [[0, 0, 0], [10, 0, 0]];

  it('hit at midpoint → t=0.5 on segment 0', () => {
    const r = nearestSegmentOnPolyline(seg, [5, 0, 0]);
    expect(r).not.toBeNull();
    expect(r!.segmentIdx).toBe(0);
    expect(r!.t).toBeCloseTo(0.5, 5);
    expect(r!.worldPoint).toEqual([5, 0, 0]);
  });

  it('hit at start endpoint → t=0', () => {
    const r = nearestSegmentOnPolyline(seg, [0, 0, 0]);
    expect(r!.t).toBeCloseTo(0, 5);
  });

  it('hit at end endpoint → t=1', () => {
    const r = nearestSegmentOnPolyline(seg, [10, 0, 0]);
    expect(r!.t).toBeCloseTo(1, 5);
  });

  it('hit off the segment clamps t to [0,1]', () => {
    const r = nearestSegmentOnPolyline(seg, [-5, 0, 0]);
    expect(r!.t).toBe(0); // clamped left
    const r2 = nearestSegmentOnPolyline(seg, [15, 0, 0]);
    expect(r2!.t).toBe(1); // clamped right
  });

  it('perpendicular offset does not affect t', () => {
    const r = nearestSegmentOnPolyline(seg, [3, 0, 2]); // off-axis hit
    expect(r!.t).toBeCloseTo(0.3, 5);
    expect(r!.worldPoint[0]).toBeCloseTo(3, 5);
    expect(r!.worldPoint[2]).toBeCloseTo(0, 5); // projected back onto segment
  });
});

// ── L-shaped polyline ─────────────────────────────────────────

describe('nearestSegmentOnPolyline — multi-segment', () => {
  it('hit near first segment picks segment 0', () => {
    const r = nearestSegmentOnPolyline(THREE_POINT_L, [2, 0, 0.1]);
    expect(r!.segmentIdx).toBe(0);
  });

  it('hit near second segment picks segment 1', () => {
    const r = nearestSegmentOnPolyline(THREE_POINT_L, [5.1, 0, 3]);
    expect(r!.segmentIdx).toBe(1);
  });

  it('hit at the corner is closer to one of the adjacent segments', () => {
    const r = nearestSegmentOnPolyline(THREE_POINT_L, [5, 0, 0]);
    expect(r!.distSq).toBeCloseTo(0, 5);
    // Either segment 0's endpoint OR segment 1's start: both valid, tie-break
    // goes to whichever was checked first (segment 0).
    expect([0, 1]).toContain(r!.segmentIdx);
  });
});
