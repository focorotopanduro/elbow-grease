/**
 * liveRouteBuild — Phase 14.Q tests.
 *
 * Covers:
 *   • distance / horizontalDistance
 *   • buildRouteSegments: empty / single-point / straight / L / vertical
 *   • zero-length segments are skipped (user double-clicks same spot)
 *   • slopeInchesPerFoot matches DimensionHelpers' committed formula
 *   • isVertical is true iff horizontal component < 1 mm
 *   • requiredSlopeForDiameter boundaries (2.5", 6", 8")
 *   • classifySlope: compliant / marginal / undershot / flat verdicts
 *   • bendAnglesDeg: straight = 0°, right angle = 90°
 *   • totalLength
 */

import { describe, it, expect } from 'vitest';
import {
  distance,
  horizontalDistance,
  buildRouteSegments,
  requiredSlopeForDiameter,
  classifySlope,
  bendAnglesDeg,
  totalLength,
} from '../liveRouteBuild';
import type { Vec3 } from '@core/events';

// ── Vector ops ────────────────────────────────────────────────

describe('distance', () => {
  it('0 for same point', () => {
    expect(distance([1, 2, 3], [1, 2, 3])).toBe(0);
  });
  it('3-4-5 triangle', () => {
    expect(distance([0, 0, 0], [3, 0, 4])).toBe(5);
  });
  it('y-component counted', () => {
    expect(distance([0, 0, 0], [0, 5, 0])).toBe(5);
  });
});

describe('horizontalDistance', () => {
  it('ignores Y', () => {
    expect(horizontalDistance([0, 100, 0], [3, -50, 4])).toBeCloseTo(5);
  });
  it('0 for pure vertical', () => {
    expect(horizontalDistance([5, 0, 5], [5, 10, 5])).toBe(0);
  });
});

// ── buildRouteSegments ────────────────────────────────────────

describe('buildRouteSegments', () => {
  it('empty array on 0 points', () => {
    expect(buildRouteSegments([])).toEqual([]);
  });

  it('empty array on 1 point', () => {
    expect(buildRouteSegments([[0, 0, 0]])).toEqual([]);
  });

  it('one segment for a straight run', () => {
    const segs = buildRouteSegments([[0, 0, 0], [10, 0, 0]]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.length).toBeCloseTo(10);
    expect(segs[0]!.mid).toEqual([5, 0, 0]);
    expect(segs[0]!.slopeInchesPerFoot).toBe(0);
    expect(segs[0]!.isVertical).toBe(false);
  });

  it('two segments for an L', () => {
    const segs = buildRouteSegments([[0, 0, 0], [5, 0, 0], [5, 0, 5]]);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.direction).toEqual([1, 0, 0]);
    expect(segs[1]!.direction).toEqual([0, 0, 1]);
  });

  it('skips zero-length segments (double-click)', () => {
    const segs = buildRouteSegments([[0, 0, 0], [5, 0, 0], [5, 0, 0], [5, 0, 5]]);
    // Two real segs, one duplicate removed
    expect(segs).toHaveLength(2);
  });

  it('detects vertical segment', () => {
    const segs = buildRouteSegments([[0, 0, 0], [0, 9, 0]]);
    expect(segs[0]!.isVertical).toBe(true);
    expect(segs[0]!.slopeInchesPerFoot).toBe(0);
  });

  it('computes slope in in/ft (1/4" per ft)', () => {
    // 10 ft horizontal + 2.5 inches drop = 0.25" / ft
    const segs = buildRouteSegments([[0, 0, 0], [10, -2.5 / 12, 0]]);
    expect(segs[0]!.slopeInchesPerFoot).toBeCloseTo(0.25);
  });

  it('slope positive regardless of drop direction', () => {
    // Upward grade also reports positive slope (we care magnitude)
    const down = buildRouteSegments([[0, 0, 0], [10, -1 / 12, 0]]);
    const up = buildRouteSegments([[0, 0, 0], [10, 1 / 12, 0]]);
    expect(down[0]!.slopeInchesPerFoot).toBeCloseTo(up[0]!.slopeInchesPerFoot);
  });
});

// ── IPC slope tables ──────────────────────────────────────────

describe('requiredSlopeForDiameter', () => {
  it('2" waste → 1/4', () => expect(requiredSlopeForDiameter(2)).toBe(0.25));
  it('2.5" waste → 1/4 (boundary)', () => expect(requiredSlopeForDiameter(2.5)).toBe(0.25));
  it('3" waste → 1/8', () => expect(requiredSlopeForDiameter(3)).toBe(0.125));
  it('4" waste → 1/8', () => expect(requiredSlopeForDiameter(4)).toBe(0.125));
  it('6" waste → 1/8 (boundary)', () => expect(requiredSlopeForDiameter(6)).toBe(0.125));
  it('8" waste → 1/16', () => expect(requiredSlopeForDiameter(8)).toBe(0.0625));
});

// ── classifySlope ─────────────────────────────────────────────

describe('classifySlope', () => {
  it('flat below 0.01', () => {
    expect(classifySlope(0, 2)).toBe('flat');
    expect(classifySlope(0.005, 2)).toBe('flat');
  });
  it('compliant at or above required', () => {
    expect(classifySlope(0.25, 2)).toBe('compliant');
    expect(classifySlope(0.5, 2)).toBe('compliant');
  });
  it('marginal between half-req and req', () => {
    expect(classifySlope(0.15, 2)).toBe('marginal');
  });
  it('undershot below half of required', () => {
    expect(classifySlope(0.05, 2)).toBe('undershot');
  });
  it('3" → 1/8 threshold', () => {
    expect(classifySlope(0.125, 3)).toBe('compliant');
    expect(classifySlope(0.10, 3)).toBe('marginal');
    expect(classifySlope(0.05, 3)).toBe('undershot');
  });
});

// ── bendAnglesDeg ─────────────────────────────────────────────

describe('bendAnglesDeg', () => {
  it('empty for < 3 points', () => {
    expect(bendAnglesDeg([])).toEqual([]);
    expect(bendAnglesDeg([[0, 0, 0]])).toEqual([]);
    expect(bendAnglesDeg([[0, 0, 0], [1, 0, 0]])).toEqual([]);
  });

  it('0° for straight-through', () => {
    const angles = bendAnglesDeg([[0, 0, 0], [5, 0, 0], [10, 0, 0]]);
    expect(angles).toHaveLength(1);
    expect(angles[0]).toBeCloseTo(0, 3);
  });

  it('90° for a right-angle turn', () => {
    const angles = bendAnglesDeg([[0, 0, 0], [5, 0, 0], [5, 0, 5]]);
    expect(angles[0]).toBeCloseTo(90, 3);
  });

  it('45° for a 45-deg turn', () => {
    // Right-go 5, then turn 45° toward +Z by going (1,0,1) normalized × 5
    const p3: Vec3 = [5 + 5 * Math.SQRT1_2, 0, 5 * Math.SQRT1_2];
    const angles = bendAnglesDeg([[0, 0, 0], [5, 0, 0], p3]);
    expect(angles[0]).toBeCloseTo(45, 2);
  });

  it('one entry per internal vertex (5 pts → 3 internal angles)', () => {
    const pts: Vec3[] = [
      [0, 0, 0],
      [5, 0, 0],
      [5, 0, 5],
      [10, 0, 5],
      [10, 0, 0],
    ];
    expect(bendAnglesDeg(pts)).toHaveLength(3);
  });
});

// ── totalLength ───────────────────────────────────────────────

describe('totalLength', () => {
  it('0 for empty', () => expect(totalLength([])).toBe(0));
  it('0 for single point', () => expect(totalLength([[0, 0, 0]])).toBe(0));
  it('sums segment distances', () => {
    const pts: Vec3[] = [[0, 0, 0], [3, 0, 0], [3, 0, 4]];
    expect(totalLength(pts)).toBeCloseTo(7);
  });
});
