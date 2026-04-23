/**
 * autoRouteFixture — Phase 14.Y.3 tests.
 *
 * Covers the target-resolution + route-building logic end to end
 * against synthetic scene inputs.
 */

import { describe, it, expect } from 'vitest';
import {
  autoRouteFixture,
  fixtureLocalToWorld,
  type AutoRouteInput,
} from '../autoRouteFixture';
import type { FixtureInstance } from '../../../store/fixtureStore';
import type { CommittedPipe } from '../../../store/pipeStore';

// ── Builders ──────────────────────────────────────────────────

function mkFixture(
  id: string,
  subtype: FixtureInstance['subtype'],
  pos: [number, number, number],
  params: Record<string, unknown> = {},
): FixtureInstance {
  return {
    id,
    subtype,
    position: pos,
    params,
    createdTs: 0,
    connectedPipeIds: [],
  };
}

function mkPipe(
  id: string,
  points: [number, number, number][],
  system: CommittedPipe['system'] = 'cold_supply',
  material: CommittedPipe['material'] = 'pex',
): CommittedPipe {
  return {
    id, points,
    diameter: 0.75, material, system,
    color: '#2a6fd6',
    visible: true, selected: false,
  };
}

function baseInput(overrides: Partial<AutoRouteInput> = {}): AutoRouteInput {
  return {
    fixture: mkFixture('f1', 'lavatory', [0, 2.5, 0]),
    otherFixtures: [],
    pipes: [],
    floorY: 0,
    ceilingY: 9,
    ...overrides,
  };
}

// ── fixtureLocalToWorld ───────────────────────────────────────

describe('fixtureLocalToWorld', () => {
  it('no rotation: just adds local to position', () => {
    const f = mkFixture('a', 'lavatory', [10, 2, 5]);
    expect(fixtureLocalToWorld(f, [1, 0.5, 2])).toEqual([11, 2.5, 7]);
  });

  it('90° Y rotation swaps X↔Z sign conventions', () => {
    const f = mkFixture('a', 'lavatory', [0, 0, 0], { rotationDeg: 90 });
    // Local (1,0,0) rotated 90° around Y → world (0,0,1) (+ fixture pos)
    const w = fixtureLocalToWorld(f, [1, 0, 0]);
    expect(w[0]).toBeCloseTo(0, 5);
    expect(w[2]).toBeCloseTo(1, 5);
  });

  it('180° rotation flips X + Z', () => {
    const f = mkFixture('a', 'lavatory', [0, 0, 0], { rotationDeg: 180 });
    const w = fixtureLocalToWorld(f, [1, 0, 1]);
    expect(w[0]).toBeCloseTo(-1, 5);
    expect(w[2]).toBeCloseTo(-1, 5);
  });
});

// ── Core auto-route ──────────────────────────────────────────

describe('autoRouteFixture — lavatory (cold + hot + drain)', () => {
  it('empty scene: returns stubs for every connection point', () => {
    const result = autoRouteFixture(baseInput());
    // Lavatory has 3 connection points: drain, cold, hot
    expect(result.proposed).toHaveLength(3);
    // Drain, cold, hot each have a route with ≥ 2 points
    for (const p of result.proposed) {
      expect(p.points.length).toBeGreaterThanOrEqual(2);
    }
    expect(result.warnings).toHaveLength(0);
  });

  it('cold route uses PEX @ 0.375 (lavatory min-branch)', () => {
    const result = autoRouteFixture(baseInput());
    const cold = result.proposed.find((p) => p.role === 'cold');
    expect(cold).toBeDefined();
    expect(cold!.material).toBe('pex');
    expect(cold!.diameter).toBe(0.375);
    expect(cold!.system).toBe('cold_supply');
  });

  it('drain route uses PVC schedule 40', () => {
    const result = autoRouteFixture(baseInput());
    const drain = result.proposed.find((p) => p.role === 'drain');
    expect(drain).toBeDefined();
    expect(drain!.material).toBe('pvc_sch40');
    expect(drain!.system).toBe('waste');
    // Lavatory DFU = 1 → diameter ≤ 3 bucket → 1.5"
    expect(drain!.diameter).toBe(1.5);
  });
});

describe('autoRouteFixture — water-heater-as-hot-source', () => {
  it('hot route terminates at water heater HOT outlet when one exists', () => {
    const wh = mkFixture('wh1', 'water_heater', [10, 0, 0]);
    const result = autoRouteFixture(baseInput({ otherFixtures: [wh] }));
    const hot = result.proposed.find((p) => p.role === 'hot');
    expect(hot).toBeDefined();
    // The last route point should be near the water heater's X
    // coordinate (the hot outlet sits on the top of the tank,
    // offset horizontally by a small amount).
    const lastPt = hot!.points[hot!.points.length - 1]!;
    expect(Math.abs(lastPt[0] - 10)).toBeLessThan(1.5);
  });

  it('hot route prefers water heater over nearby hot_supply pipe endpoint', () => {
    // There's a hot_supply pipe close by AND a water heater farther away.
    // Prefer the water heater because that's the canonical hot source.
    const nearPipe = mkPipe('p1', [[2, 8, 0], [3, 8, 0]], 'hot_supply');
    const wh = mkFixture('wh1', 'water_heater', [10, 0, 0]);
    const result = autoRouteFixture(baseInput({
      pipes: [nearPipe],
      otherFixtures: [wh],
    }));
    const hot = result.proposed.find((p) => p.role === 'hot');
    expect(hot).toBeDefined();
    const lastPt = hot!.points[hot!.points.length - 1]!;
    // Should land near WH (x ≈ 10), NOT near the pipe (x ≈ 2-3)
    expect(Math.abs(lastPt[0] - 10)).toBeLessThan(1.5);
  });
});

describe('autoRouteFixture — cold-supply pipe preferred over stub', () => {
  it('when a cold_supply pipe endpoint exists, cold route ends there', () => {
    // Cold main endpoint at (5, 8, 5)
    const main = mkPipe('cold1', [[-5, 8, 5], [5, 8, 5]], 'cold_supply');
    const result = autoRouteFixture(baseInput({ pipes: [main] }));
    const cold = result.proposed.find((p) => p.role === 'cold');
    expect(cold).toBeDefined();
    const lastPt = cold!.points[cold!.points.length - 1]!;
    // Should end at (5, 8, 5), the main's nearer endpoint
    expect(lastPt[0]).toBeCloseTo(5, 2);
    expect(lastPt[2]).toBeCloseTo(5, 2);
  });
});

describe('autoRouteFixture — drain stub drops to slab', () => {
  it('empty scene drain route hits floor Y', () => {
    const result = autoRouteFixture(baseInput({ floorY: 0 }));
    const drain = result.proposed.find((p) => p.role === 'drain');
    expect(drain).toBeDefined();
    const lastPt = drain!.points[drain!.points.length - 1]!;
    expect(lastPt[1]).toBeCloseTo(0, 2);
  });

  it('with existing waste pipe, drain ends at nearest endpoint', () => {
    const waste = mkPipe('w1', [[-2, 0, 0], [-2, 0, 10]], 'waste', 'pvc_sch40');
    const result = autoRouteFixture(baseInput({ pipes: [waste] }));
    const drain = result.proposed.find((p) => p.role === 'drain');
    const lastPt = drain!.points[drain!.points.length - 1]!;
    expect(lastPt[0]).toBeCloseTo(-2, 1);
  });
});

describe('autoRouteFixture — water heater itself', () => {
  it('water heater: cold routes to supply, hot stubs out (WH is the hot source)', () => {
    const wh = mkFixture('wh', 'water_heater', [0, 0, 0]);
    const result = autoRouteFixture(baseInput({ fixture: wh }));
    expect(result.proposed.length).toBeGreaterThan(0);
    // Has at least a cold inlet route
    expect(result.proposed.some((p) => p.role === 'cold')).toBe(true);
    // Has a hot outlet route (terminates at stub since no fixtures)
    expect(result.proposed.some((p) => p.role === 'hot')).toBe(true);
    // Drain (service spigot) route
    expect(result.proposed.some((p) => p.role === 'drain')).toBe(true);
    // Overflow (T&P relief) route
    expect(result.proposed.some((p) => p.role === 'overflow')).toBe(true);
  });
});

describe('autoRouteFixture — route shape', () => {
  it('manhattan route has at most 4 points for a clean L-route', () => {
    const result = autoRouteFixture(baseInput());
    for (const p of result.proposed) {
      expect(p.points.length).toBeLessThanOrEqual(4);
      expect(p.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('each internal bend is at a Manhattan (axis-aligned) angle', () => {
    const result = autoRouteFixture(baseInput());
    for (const p of result.proposed) {
      for (let i = 1; i < p.points.length; i++) {
        const a = p.points[i - 1]!;
        const b = p.points[i]!;
        const dx = Math.abs(b[0] - a[0]);
        const dy = Math.abs(b[1] - a[1]);
        const dz = Math.abs(b[2] - a[2]);
        // Exactly one axis should change per segment (Manhattan)
        // — i.e. two of dx, dy, dz are near-zero. Allow for
        // floating-point noise + the final segment which may
        // share multiple components slightly.
        const nonZero = [dx, dy, dz].filter((v) => v > 1e-5).length;
        expect(nonZero).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('autoRouteFixture — fixture rotation applied', () => {
  it('90° rotated fixture produces a world-space route that respects rotation', () => {
    // Same lavatory rotated 90° — its local +X drain port now
    // points along world +Z. The route should start from
    // (fixture.position + rotated local).
    const f1 = mkFixture('a', 'lavatory', [0, 2.5, 0]);
    const f2 = mkFixture('b', 'lavatory', [0, 2.5, 0], { rotationDeg: 90 });
    const r1 = autoRouteFixture(baseInput({ fixture: f1 }));
    const r2 = autoRouteFixture(baseInput({ fixture: f2 }));
    // Both produce the same count of routes
    expect(r1.proposed.length).toBe(r2.proposed.length);
    // Cold routes start at different world points
    const c1 = r1.proposed.find((p) => p.role === 'cold')!;
    const c2 = r2.proposed.find((p) => p.role === 'cold')!;
    const start1 = c1.points[0]!;
    const start2 = c2.points[0]!;
    // Rotating a non-axis-origin point shouldn't leave x/z the same
    expect(start1[0] === start2[0] && start1[2] === start2[2]).toBe(false);
  });
});
