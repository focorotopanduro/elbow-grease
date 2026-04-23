/**
 * pipeDirections — Phase 14.AD.30.
 *
 * Lock the canonical direction helpers. Failures here indicate
 * foundational geometry math has drifted, which would cascade
 * into fitting rotation / retraction / junction bugs everywhere.
 */

import { describe, it, expect } from 'vitest';
import {
  ZERO_DIR,
  WORLD_UP,
  length,
  lengthSq,
  normalize,
  sub,
  add,
  scale,
  dot,
  cross,
  distance,
  segmentTangent,
  outwardStart,
  outwardEnd,
  travelIntoEnd,
  travelOutOfStart,
  angleBetweenDeg,
  bendAngleAtVertex,
  branchAngleDeg,
  classifyOrientation,
  perpendicularTo,
  isNear,
  nearestEndpoint,
} from '../pipeDirections';
import type { Vec3 } from '@core/events';

// ── Core vector math ─────────────────────────────────────────────

describe('core vector math', () => {
  it('length + lengthSq', () => {
    expect(length([3, 4, 0])).toBeCloseTo(5, 5);
    expect(lengthSq([3, 4, 0])).toBe(25);
    expect(length([0, 0, 0])).toBe(0);
  });

  it('normalize', () => {
    const n = normalize([3, 4, 0]);
    expect(n[0]).toBeCloseTo(0.6, 5);
    expect(n[1]).toBeCloseTo(0.8, 5);
    expect(n[2]).toBeCloseTo(0, 5);
  });

  it('normalize returns ZERO_DIR for zero-length input', () => {
    expect(normalize([0, 0, 0])).toEqual(ZERO_DIR);
  });

  it('normalize returns ZERO_DIR for tiny input (below EPS)', () => {
    expect(normalize([1e-10, 0, 0])).toEqual(ZERO_DIR);
  });

  it('sub / add / scale', () => {
    expect(sub([5, 7, 9], [1, 2, 3])).toEqual([4, 5, 6]);
    expect(add([1, 2, 3], [4, 5, 6])).toEqual([5, 7, 9]);
    expect(scale([1, 2, 3], 3)).toEqual([3, 6, 9]);
  });

  it('dot + cross', () => {
    expect(dot([1, 0, 0], [0, 1, 0])).toBe(0);
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(4 + 10 + 18);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
  });

  it('distance', () => {
    expect(distance([0, 0, 0], [3, 4, 0])).toBeCloseTo(5, 5);
    expect(distance([1, 1, 1], [1, 1, 1])).toBe(0);
  });
});

// ── Semantic direction helpers ───────────────────────────────────

describe('segmentTangent — travel direction from→to', () => {
  it('simple east-going segment → +X', () => {
    expect(segmentTangent([0, 0, 0], [5, 0, 0])).toEqual([1, 0, 0]);
  });

  it('diagonal segment normalizes to unit length', () => {
    const t = segmentTangent([0, 0, 0], [3, 4, 0]);
    expect(t[0]).toBeCloseTo(0.6, 5);
    expect(t[1]).toBeCloseTo(0.8, 5);
    expect(length(t)).toBeCloseTo(1, 5);
  });

  it('zero-length segment returns ZERO_DIR (no NaN)', () => {
    expect(segmentTangent([1, 2, 3], [1, 2, 3])).toEqual(ZERO_DIR);
  });
});

describe('outwardStart / outwardEnd', () => {
  const pipe: Vec3[] = [[0, 0, 0], [10, 0, 0], [10, 0, 5]];

  it('outwardStart points FROM first point INTO pipe body', () => {
    // points[0] = (0,0,0), points[1] = (10,0,0). Outward is +X.
    expect(outwardStart(pipe)).toEqual([1, 0, 0]);
  });

  it('outwardEnd points FROM last point INTO pipe body', () => {
    // points[last] = (10,0,5), points[last-1] = (10,0,0). Outward
    // is from (10,0,5) to (10,0,0) = -Z.
    expect(outwardEnd(pipe)).toEqual([0, 0, -1]);
  });

  it('returns ZERO_DIR for 1-point pipe', () => {
    expect(outwardStart([[0, 0, 0]])).toEqual(ZERO_DIR);
    expect(outwardEnd([[0, 0, 0]])).toEqual(ZERO_DIR);
  });

  it('handles coincident first/last two points without NaN', () => {
    const degenStart: Vec3[] = [[1, 1, 1], [1, 1, 1], [2, 2, 2]];
    expect(outwardStart(degenStart)).toEqual(ZERO_DIR);
    const degenEnd: Vec3[] = [[0, 0, 0], [1, 1, 1], [1, 1, 1]];
    expect(outwardEnd(degenEnd)).toEqual(ZERO_DIR);
  });
});

describe('travelIntoEnd / travelOutOfStart', () => {
  const pipe: Vec3[] = [[0, 0, 0], [10, 0, 0], [10, 0, 5]];

  it('travelIntoEnd = -outwardEnd', () => {
    const intoEnd = travelIntoEnd(pipe);
    const outEnd = outwardEnd(pipe);
    expect(intoEnd[0]).toBeCloseTo(-outEnd[0], 5);
    expect(intoEnd[1]).toBeCloseTo(-outEnd[1], 5);
    expect(intoEnd[2]).toBeCloseTo(-outEnd[2], 5);
  });

  it('travelOutOfStart = outwardStart', () => {
    expect(travelOutOfStart(pipe)).toEqual(outwardStart(pipe));
  });
});

// ── Angle helpers ────────────────────────────────────────────────

describe('angleBetweenDeg', () => {
  it('perpendicular vectors → 90°', () => {
    expect(angleBetweenDeg([1, 0, 0], [0, 1, 0])).toBeCloseTo(90, 3);
  });

  it('parallel vectors → 0°', () => {
    expect(angleBetweenDeg([1, 0, 0], [1, 0, 0])).toBeCloseTo(0, 3);
    expect(angleBetweenDeg([1, 0, 0], [5, 0, 0])).toBeCloseTo(0, 3);
  });

  it('antiparallel vectors → 180°', () => {
    expect(angleBetweenDeg([1, 0, 0], [-1, 0, 0])).toBeCloseTo(180, 3);
  });

  it('45° diagonal → 45°', () => {
    expect(angleBetweenDeg([1, 0, 0], [1, 1, 0])).toBeCloseTo(45, 3);
  });

  it('handles zero-length input without NaN', () => {
    expect(angleBetweenDeg([0, 0, 0], [1, 0, 0])).toBe(0);
    expect(angleBetweenDeg([1, 0, 0], [0, 0, 0])).toBe(0);
  });
});

describe('bendAngleAtVertex', () => {
  it('straight polyline → 0° bend', () => {
    expect(bendAngleAtVertex([0, 0, 0], [5, 0, 0], [10, 0, 0])).toBeCloseTo(0, 3);
  });

  it('90° L-bend → 90°', () => {
    expect(bendAngleAtVertex([0, 0, 0], [10, 0, 0], [10, 0, 10])).toBeCloseTo(90, 3);
  });

  it('45° bend → 45°', () => {
    expect(bendAngleAtVertex([0, 0, 0], [10, 0, 0], [20, 0, 10])).toBeCloseTo(45, 3);
  });

  it('U-turn (180°) → 180°', () => {
    expect(bendAngleAtVertex([0, 0, 0], [5, 0, 0], [0, 0, 0])).toBeCloseTo(180, 3);
  });
});

describe('branchAngleDeg', () => {
  it('90° branch: two approaches perpendicular → 90°', () => {
    expect(branchAngleDeg([1, 0, 0], [0, 1, 0])).toBeCloseTo(90, 3);
  });

  it('45° branch: diagonal → 45°', () => {
    expect(branchAngleDeg([1, 0, 0], [1, 1, 0])).toBeCloseTo(45, 3);
  });
});

// ── Orientation classification ───────────────────────────────────

describe('classifyOrientation', () => {
  it('pure vertical → vertical', () => {
    expect(classifyOrientation([0, 1, 0])).toBe('vertical');
    expect(classifyOrientation([0, -1, 0])).toBe('vertical');
  });

  it('pure horizontal → horizontal', () => {
    expect(classifyOrientation([1, 0, 0])).toBe('horizontal');
    expect(classifyOrientation([0, 0, 1])).toBe('horizontal');
    expect(classifyOrientation([0.707, 0, 0.707])).toBe('horizontal');
  });

  it('45° diagonal → vertical (|y|=0.707 >= 0.7 cutoff)', () => {
    // The 0.7 cutoff matches `defaultTeeFor`'s vertical/horizontal
    // threshold — a direction >= 45° off horizontal is a stack/riser
    // in plumbing convention. Boundary inclusive.
    expect(classifyOrientation([0.707, 0.707, 0])).toBe('vertical');
  });

  it('shallower diagonal (|y|=0.5) → oblique', () => {
    expect(classifyOrientation([0.866, 0.5, 0])).toBe('oblique');
  });

  it('boundary: |y| = 0.7 → vertical (cutoff is >=)', () => {
    expect(classifyOrientation([0.714, 0.7, 0])).toBe('vertical');
  });

  it('boundary: |y| = 0.3 → horizontal (cutoff is <=)', () => {
    expect(classifyOrientation([0.954, 0.3, 0])).toBe('horizontal');
  });
});

// ── perpendicularTo ──────────────────────────────────────────────

describe('perpendicularTo', () => {
  it('perpendicular to +X with +Y component → unit +Y', () => {
    const p = perpendicularTo([0, 1, 0], [1, 0, 0]);
    expect(p[0]).toBeCloseTo(0, 5);
    expect(p[1]).toBeCloseTo(1, 5);
    expect(p[2]).toBeCloseTo(0, 5);
  });

  it('parallel input → falls back to WORLD_UP (or orthogonal)', () => {
    // v || axis: strip the parallel component → zero → fallback.
    const p = perpendicularTo([1, 0, 0], [1, 0, 0]);
    expect(lengthSq(p)).toBeCloseTo(1, 5); // always unit length
    expect(Math.abs(dot(p, [1, 0, 0]))).toBeLessThan(0.01);
  });

  it('result is always orthogonal to axis', () => {
    const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.707, 0.707, 0]];
    const vs: Vec3[] = [[0.5, 0.5, 0.5], [1, 2, 3], [0, 0, 1]];
    for (const axis of axes) {
      for (const v of vs) {
        const p = perpendicularTo(v, axis);
        expect(Math.abs(dot(p, normalize(axis)))).toBeLessThan(0.01);
        expect(lengthSq(p)).toBeCloseTo(1, 2);
      }
    }
  });

  it('parallel to WORLD_UP: fallback picks world +X, stays orthogonal', () => {
    const p = perpendicularTo(WORLD_UP, WORLD_UP);
    expect(Math.abs(dot(p, WORLD_UP))).toBeLessThan(0.01);
    expect(lengthSq(p)).toBeCloseTo(1, 2);
  });
});

// ── Endpoint proximity ──────────────────────────────────────────

describe('isNear + nearestEndpoint', () => {
  it('isNear returns true within tolerance', () => {
    expect(isNear([0, 0, 0], [0.05, 0, 0], 0.1)).toBe(true);
    expect(isNear([0, 0, 0], [0.15, 0, 0], 0.1)).toBe(false);
  });

  it('nearestEndpoint identifies start', () => {
    const pipe: Vec3[] = [[0, 0, 0], [10, 0, 0]];
    expect(nearestEndpoint(pipe, [0.05, 0, 0], 0.1)).toBe('start');
  });

  it('nearestEndpoint identifies end', () => {
    const pipe: Vec3[] = [[0, 0, 0], [10, 0, 0]];
    expect(nearestEndpoint(pipe, [9.95, 0, 0], 0.1)).toBe('end');
  });

  it('nearestEndpoint returns null when neither endpoint is close', () => {
    const pipe: Vec3[] = [[0, 0, 0], [10, 0, 0]];
    expect(nearestEndpoint(pipe, [5, 0, 0], 0.1)).toBeNull();
  });

  it('1-point pipe returns null', () => {
    expect(nearestEndpoint([[0, 0, 0]], [0, 0, 0], 1)).toBeNull();
  });

  it('tie-break prefers start when equidistant', () => {
    const pipe: Vec3[] = [[0, 0, 0], [10, 0, 0]];
    expect(nearestEndpoint(pipe, [5, 0, 0], 6)).toBe('start');
  });
});
