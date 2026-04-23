/**
 * ManifoldGeometry — Phase 7.C acceptance tests.
 *
 * Each case pins one invariant of the merge rule the user asked for:
 *
 *   • 2 manifolds end-to-end at matching yaw → merge into a bigger one.
 *   • Perpendicular offset beyond tolerance → no merge.
 *   • Different yaws → no merge.
 *   • Port-count cap enforced (2+5 rejected).
 *   • Different material/system → no merge.
 *   • Merged center sits between the two OUTER endpoints.
 *   • Port positions respect yaw rotation.
 */

import { describe, it, expect } from 'vitest';
import {
  computePortPositions,
  trunkEndpoints,
  trunkLengthFt,
  checkManifoldMerge,
  computeMerged,
  PORT_SPACING_FT,
  MAX_PORT_COUNT,
  MERGE_SNAP_DISTANCE_FT,
  type Manifold,
} from '../ManifoldGeometry';

// ── Fixtures ───────────────────────────────────────────────────

function manifold(
  id: string,
  center: [number, number, number],
  portCount: number,
  yawRad = 0,
  overrides: Partial<Manifold> = {},
): Manifold {
  return {
    id,
    center,
    yawRad,
    portCount,
    system: 'cold_supply',
    material: 'pex',
    portDiameterIn: 0.5,
    floorY: 0,
    ...overrides,
  };
}

// ── trunkLengthFt ─────────────────────────────────────────────

describe('trunkLengthFt', () => {
  it('2 ports → 2 × spacing', () => {
    expect(trunkLengthFt(2)).toBeCloseTo(PORT_SPACING_FT * 2, 5);
  });
  it('5 ports → 5 × spacing', () => {
    expect(trunkLengthFt(5)).toBeCloseTo(PORT_SPACING_FT * 5, 5);
  });
  it('clamps below 2 to 2', () => {
    expect(trunkLengthFt(1)).toBeCloseTo(PORT_SPACING_FT * 2, 5);
  });
  it('clamps above MAX to MAX', () => {
    expect(trunkLengthFt(99)).toBeCloseTo(PORT_SPACING_FT * MAX_PORT_COUNT, 5);
  });
});

// ── Port positions ────────────────────────────────────────────

describe('computePortPositions', () => {
  it('2-port at origin, yaw=0 → ports symmetric around X=0', () => {
    const m = manifold('a', [0, 0, 0], 2, 0);
    const ports = computePortPositions(m);
    expect(ports).toHaveLength(2);
    // Ports along local X, outward along local +Z
    expect(ports[0]!.worldPosition[0]).toBeCloseTo(-PORT_SPACING_FT / 2, 5);
    expect(ports[1]!.worldPosition[0]).toBeCloseTo(+PORT_SPACING_FT / 2, 5);
    // All at same Y
    for (const p of ports) expect(p.worldPosition[1]).toBe(0);
  });

  it('ports extend outward (+Z at yaw=0)', () => {
    const m = manifold('a', [0, 0, 0], 2, 0);
    const ports = computePortPositions(m);
    // Z coord = cos(0) * extension = +extension > 0
    for (const p of ports) expect(p.worldPosition[2]).toBeGreaterThan(0);
  });

  it('yaw=90° rotates ports: length now along +Z, outward along -X', () => {
    const m = manifold('a', [0, 0, 0], 2, Math.PI / 2);
    const ports = computePortPositions(m);
    // After 90° yaw: local X → world Z (negative), local Z → world X
    // Ports separate along Z, outward along X
    expect(Math.abs(ports[1]!.worldPosition[0] - ports[0]!.worldPosition[0])).toBeLessThan(0.01);
    expect(Math.abs(ports[1]!.worldPosition[2] - ports[0]!.worldPosition[2]))
      .toBeCloseTo(PORT_SPACING_FT, 3);
  });

  it('3-port at origin has middle port at X=0', () => {
    const m = manifold('a', [0, 0, 0], 3, 0);
    const ports = computePortPositions(m);
    expect(ports[1]!.worldPosition[0]).toBeCloseTo(0, 5);
  });
});

// ── Trunk endpoints ───────────────────────────────────────────

describe('trunkEndpoints', () => {
  it('2-port at origin yaw=0: ends at ±spacing along X', () => {
    const m = manifold('a', [0, 0, 0], 2, 0);
    const [L, R] = trunkEndpoints(m);
    expect(L[0]).toBeCloseTo(-PORT_SPACING_FT, 5);
    expect(R[0]).toBeCloseTo(+PORT_SPACING_FT, 5);
  });

  it('endpoints preserve center Y', () => {
    const m = manifold('a', [3, 4, 5], 3, 0);
    const [L, R] = trunkEndpoints(m);
    expect(L[1]).toBe(4);
    expect(R[1]).toBe(4);
  });
});

// ── Merge eligibility ────────────────────────────────────────

describe('checkManifoldMerge — positive cases', () => {
  it('2 + 2 manifolds touching end-to-end at yaw=0 → canMerge, combined 4', () => {
    // a is centered at origin, 2 ports, length=0.5. Right end at X=+0.25.
    // b is centered at X=+0.5, 2 ports, length=0.5. Left end at X=+0.25.
    // Ends touch at (+0.25, 0, 0). Merge OK.
    const a = manifold('a', [0, 0, 0], 2, 0);
    const b = manifold('b', [0.5, 0, 0], 2, 0);
    const r = checkManifoldMerge(a, b);
    expect(r.canMerge).toBe(true);
    expect(r.aEnd).toBe('right');
    expect(r.bEnd).toBe('left');
    expect(r.gapFt).toBeLessThan(0.01);
  });

  it('2 + 3 manifolds at small gap within tolerance → canMerge', () => {
    const a = manifold('a', [0, 0, 0], 2, 0);
    // b offset by 0.5 + small within-tolerance gap
    const b = manifold('b', [0.5 + MERGE_SNAP_DISTANCE_FT * 0.5, 0, 0], 3, 0);
    const r = checkManifoldMerge(a, b);
    expect(r.canMerge).toBe(true);
  });

  it('manifolds whose yaws differ by 180° are still parallel (same axis)', () => {
    const a = manifold('a', [0, 0, 0], 2, 0);
    const b = manifold('b', [0.5, 0, 0], 2, Math.PI);
    const r = checkManifoldMerge(a, b);
    expect(r.canMerge).toBe(true);
  });
});

describe('checkManifoldMerge — rejections', () => {
  it('different yaw beyond tolerance → no merge', () => {
    const a = manifold('a', [0, 0, 0], 2, 0);
    const b = manifold('b', [0.5, 0, 0], 2, Math.PI / 4);
    const r = checkManifoldMerge(a, b);
    expect(r.canMerge).toBe(false);
    expect(r.reason).toMatch(/parallel/);
  });

  it('perpendicular offset beyond tolerance → no merge', () => {
    const a = manifold('a', [0, 0, 0], 2, 0);
    // Offset along Z (perpendicular to length axis) by 1ft — way beyond tolerance
    const b = manifold('b', [0.5, 0, 1], 2, 0);
    const r = checkManifoldMerge(a, b);
    expect(r.canMerge).toBe(false);
    expect(r.reason).toMatch(/perpendicular/);
  });

  it('combined port count > MAX → no merge', () => {
    const a = manifold('a', [0, 0, 0], 3, 0);
    const b = manifold('b', [0.5 + 0.5 * 3 / 2 - 0.5, 0, 0], 3, 0); // positioned ambiguously
    // Force positions to be touching for this test
    const aT = manifold('a', [0, 0, 0], 3, 0);
    const bT = manifold('b', [trunkLengthFt(3), 0, 0], 3, 0);
    const r = checkManifoldMerge(aT, bT);
    expect(r.canMerge).toBe(false);
    expect(r.reason).toMatch(/exceeds max/);
    void a; void b;
  });

  it('different systems → no merge even when physically aligned', () => {
    const a = manifold('a', [0, 0, 0], 2, 0);
    const b = manifold('b', [0.5, 0, 0], 2, 0, { system: 'hot_supply' });
    const r = checkManifoldMerge(a, b);
    expect(r.canMerge).toBe(false);
    expect(r.reason).toMatch(/system/);
  });

  it('different port diameters → no merge', () => {
    const a = manifold('a', [0, 0, 0], 2, 0);
    const b = manifold('b', [0.5, 0, 0], 2, 0, { portDiameterIn: 0.75 });
    const r = checkManifoldMerge(a, b);
    expect(r.canMerge).toBe(false);
    expect(r.reason).toMatch(/diameter/);
  });

  it('different floor elevations → no merge', () => {
    const a = manifold('a', [0, 0, 0], 2, 0, { floorY: 0 });
    const b = manifold('b', [0.5, 10, 0], 2, 0, { floorY: 10 });
    const r = checkManifoldMerge(a, b);
    expect(r.canMerge).toBe(false);
    expect(r.reason).toMatch(/floor/);
  });

  it('too far apart along the axis → no merge', () => {
    const a = manifold('a', [0, 0, 0], 2, 0);
    const b = manifold('b', [3, 0, 0], 2, 0); // 3 ft separation, well past 0.25 + 0.25
    const r = checkManifoldMerge(a, b);
    expect(r.canMerge).toBe(false);
    expect(r.reason).toMatch(/too far/);
  });
});

// ── computeMerged ─────────────────────────────────────────────

describe('computeMerged', () => {
  it('merge of 2+2 produces a 4-port centered between outer ends', () => {
    const a = manifold('a', [0, 0, 0], 2, 0);
    const b = manifold('b', [0.5, 0, 0], 2, 0);
    const check = checkManifoldMerge(a, b);
    expect(check.canMerge).toBe(true);
    const m = computeMerged(a, b, check);
    expect(m.portCount).toBe(4);
    // The two OUTER ends: a's left (-0.25) and b's right (+0.75) → center at +0.25
    expect(m.center[0]).toBeCloseTo(0.25, 3);
    // Merge retains a's id
    expect(m.id).toBe('a');
  });

  it('merge of 2+3 produces a 5-port', () => {
    const a = manifold('a', [0, 0, 0], 2, 0);
    // Position b's left end just touching a's right end (length=0.5 for a, 0.75 for b).
    // a.right = 0.25, b center must be at 0.25 + 0.75/2 = 0.625
    const b = manifold('b', [0.625, 0, 0], 3, 0);
    const check = checkManifoldMerge(a, b);
    expect(check.canMerge).toBe(true);
    const m = computeMerged(a, b, check);
    expect(m.portCount).toBe(5);
  });

  it('throws if called with non-mergeable pair', () => {
    const a = manifold('a', [0, 0, 0], 2, 0);
    const b = manifold('b', [10, 0, 0], 2, 0);
    const check = checkManifoldMerge(a, b);
    expect(() => computeMerged(a, b, check)).toThrow();
  });
});
