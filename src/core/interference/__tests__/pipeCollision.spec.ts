/**
 * pipeCollision — Phase 14.X tests.
 *
 * Covers:
 *   • closestPointsOnSegments: identity/parallel/skew/touching
 *   • detectPipePipeCollisions:
 *       - empty / single pipe → []
 *       - parallel pipes at safe distance → []
 *       - parallel pipes hugging each other → 'clip'/'overlap'
 *       - perpendicular crossing at same Y → 'clip'
 *       - shared endpoint (legal junction) → NOT flagged
 *       - pipes on different floors → no collision
 *   • Invisible pipes skipped.
 *   • Summary counts match.
 */

import { describe, it, expect } from 'vitest';
import {
  closestPointsOnSegments,
  detectPipePipeCollisions,
  summarizePipeCollisions,
} from '../pipeCollision';
import type { Vec3 } from '@core/events';
import type { CommittedPipe } from '../../../store/pipeStore';

// ── Fixtures ──────────────────────────────────────────────────

function mkPipe(id: string, points: Vec3[], opts: Partial<CommittedPipe> = {}): CommittedPipe {
  return {
    id, points,
    diameter: opts.diameter ?? 2,
    material: opts.material ?? 'pvc_sch40',
    system: opts.system ?? 'waste',
    color: opts.color ?? '#ffa726',
    visible: opts.visible ?? true,
    selected: false,
  };
}

// ── closestPointsOnSegments ───────────────────────────────────

describe('closestPointsOnSegments', () => {
  it('identical segments → distance 0', () => {
    const r = closestPointsOnSegments(
      [0, 0, 0], [5, 0, 0],
      [0, 0, 0], [5, 0, 0],
    );
    expect(r.distance).toBeCloseTo(0, 6);
  });

  it('parallel offset segments → correct distance', () => {
    const r = closestPointsOnSegments(
      [0, 0, 0], [5, 0, 0],
      [0, 0, 3], [5, 0, 3],
    );
    expect(r.distance).toBeCloseTo(3, 6);
  });

  it('perpendicular crossing at same Y → 0', () => {
    // A: along X-axis, B: along Z-axis. They cross at (2,0,0) / (2,0,0).
    const r = closestPointsOnSegments(
      [0, 0, 0], [4, 0, 0],
      [2, 0, -2], [2, 0, 2],
    );
    expect(r.distance).toBeCloseTo(0, 6);
  });

  it('perpendicular crossing at different Y → Y delta', () => {
    // A at y=0, B at y=3
    const r = closestPointsOnSegments(
      [0, 0, 0], [4, 0, 0],
      [2, 3, -2], [2, 3, 2],
    );
    expect(r.distance).toBeCloseTo(3, 6);
  });

  it('skew segments (not coplanar) → correct minimum distance', () => {
    // Two segments on different planes, closest approach at (2,0,0) and (2,1,0)
    const r = closestPointsOnSegments(
      [0, 0, 0], [4, 0, 0],
      [0, 1, 0], [4, 1, 0],
    );
    expect(r.distance).toBeCloseTo(1, 6);
  });

  it('endpoint-to-endpoint touch → 0', () => {
    const r = closestPointsOnSegments(
      [0, 0, 0], [5, 0, 0],
      [5, 0, 0], [10, 0, 0],
    );
    expect(r.distance).toBeCloseTo(0, 6);
  });
});

// ── detectPipePipeCollisions ──────────────────────────────────

describe('detectPipePipeCollisions — basic cases', () => {
  it('empty list → empty result', () => {
    expect(detectPipePipeCollisions([])).toEqual([]);
  });

  it('single pipe → empty result', () => {
    expect(detectPipePipeCollisions([
      mkPipe('a', [[0, 0, 0], [5, 0, 0]]),
    ])).toEqual([]);
  });

  it('two parallel pipes at safe distance → no collision', () => {
    const pipes = [
      mkPipe('a', [[0, 0, 0], [10, 0, 0]], { diameter: 2 }),
      mkPipe('b', [[0, 0, 5], [10, 0, 5]], { diameter: 2 }),
    ];
    expect(detectPipePipeCollisions(pipes)).toEqual([]);
  });

  it('two parallel pipes hugging (center distance < 2× OD) → collision', () => {
    // 2" PVC OD ≈ 2.375" so radius ≈ 0.1 ft. Required clearance = 0.1+0.1+1/12 ≈ 0.28 ft.
    // Put them 0.15 ft apart → 'clip' (< sum of radii)
    const pipes = [
      mkPipe('a', [[0, 0, 0], [10, 0, 0]], { diameter: 2 }),
      mkPipe('b', [[0, 0, 0.15], [10, 0, 0.15]], { diameter: 2 }),
    ];
    const cols = detectPipePipeCollisions(pipes);
    expect(cols.length).toBeGreaterThanOrEqual(1);
    // They clip (centerlines within radius sum)
    expect(cols.some((c) => c.severity === 'clip' || c.severity === 'overlap')).toBe(true);
  });

  it('perpendicular crossing at same Y → clip', () => {
    // A along X, B along Z, both at y=0 — they clip at the cross.
    // Put B's endpoints far enough apart that they don't share with A.
    const pipes = [
      mkPipe('a', [[0, 0, 0], [10, 0, 0]], { diameter: 2 }),
      mkPipe('b', [[5, 0, -5], [5, 0, 5]], { diameter: 2 }),
    ];
    const cols = detectPipePipeCollisions(pipes);
    expect(cols.length).toBeGreaterThanOrEqual(1);
    const c = cols[0]!;
    expect(c.severity).toBe('clip');
    // Collision should be somewhere near (5, 0, 0) where they cross
    expect(Math.abs(c.position[0] - 5)).toBeLessThan(0.5);
  });

  it('crossing at different Y → no collision (vertical separation)', () => {
    const pipes = [
      mkPipe('a', [[0, 0, 0], [10, 0, 0]], { diameter: 2 }),
      mkPipe('b', [[5, 3, -5], [5, 3, 5]], { diameter: 2 }),
    ];
    expect(detectPipePipeCollisions(pipes)).toEqual([]);
  });
});

// ── Shared-endpoint legal junctions ───────────────────────────

describe('shared endpoints (legal junctions)', () => {
  it('end-to-end connection → NOT flagged as collision', () => {
    const pipes = [
      mkPipe('a', [[0, 0, 0], [5, 0, 0]], { diameter: 2 }),
      mkPipe('b', [[5, 0, 0], [10, 0, 0]], { diameter: 2 }),
    ];
    expect(detectPipePipeCollisions(pipes)).toEqual([]);
  });

  it('tee junction (endpoint touches endpoint) → NOT flagged', () => {
    const pipes = [
      mkPipe('a', [[0, 0, 0], [5, 0, 0]], { diameter: 2 }),
      mkPipe('b', [[5, 0, 0], [5, 0, 5]], { diameter: 2 }),
    ];
    expect(detectPipePipeCollisions(pipes)).toEqual([]);
  });

  it('endpoints within tolerance (< 0.15 ft) treated as shared', () => {
    const pipes = [
      mkPipe('a', [[0, 0, 0], [5, 0, 0]], { diameter: 2 }),
      mkPipe('b', [[5.1, 0, 0], [5.1, 0, 5]], { diameter: 2 }),
    ];
    // Endpoints (5,0,0) and (5.1,0,0) are within 0.15 ft → junction
    expect(detectPipePipeCollisions(pipes)).toEqual([]);
  });
});

// ── Visibility filter ─────────────────────────────────────────

describe('visibility filter', () => {
  it('invisible pipe excluded from collision checks', () => {
    const pipes = [
      mkPipe('a', [[0, 0, 0], [10, 0, 0]], { diameter: 2 }),
      mkPipe('b', [[5, 0, -5], [5, 0, 5]], { diameter: 2, visible: false }),
    ];
    expect(detectPipePipeCollisions(pipes)).toEqual([]);
  });
});

// ── Summary ───────────────────────────────────────────────────

describe('summarizePipeCollisions', () => {
  it('counts by severity', () => {
    const pipes = [
      // Two clipping pairs
      mkPipe('a', [[0, 0, 0], [10, 0, 0]], { diameter: 2 }),
      mkPipe('b', [[5, 0, -5], [5, 0, 5]], { diameter: 2 }),
      mkPipe('c', [[0, 0, 3], [10, 0, 3]], { diameter: 2 }),
      mkPipe('d', [[5, 0, 1], [5, 0, 4]], { diameter: 2 }),
    ];
    const cols = detectPipePipeCollisions(pipes);
    const summary = summarizePipeCollisions(cols);
    expect(summary.total).toBe(cols.length);
    expect(summary.clip + summary.overlap + summary.touch).toBe(summary.total);
  });

  it('0/0/0 for empty input', () => {
    expect(summarizePipeCollisions([])).toEqual({
      total: 0, clip: 0, overlap: 0, touch: 0,
    });
  });
});

// ── Perf-floor ────────────────────────────────────────────────

describe('perf floor', () => {
  it('200-pipe scene completes in < 500 ms', () => {
    const pipes: CommittedPipe[] = [];
    for (let i = 0; i < 200; i++) {
      pipes.push(mkPipe(
        `p${i}`,
        [[i * 2, 0, 0], [i * 2 + 1, 0, 0], [i * 2 + 1, 0, 1]],
      ));
    }
    const t0 = performance.now();
    detectPipePipeCollisions(pipes);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(500);
  });
});
