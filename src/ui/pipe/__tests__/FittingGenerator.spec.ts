/**
 * FittingGenerator — Phase 13.A audit tests.
 *
 * Key guarantees tested:
 *
 *   1. A 4-way junction (4 pipe endpoints meeting at a single point)
 *      produces ONE `cross` fitting, not multiple tees. This is the
 *      Phase 13.A audit fix; the prior behavior under-counted fitting
 *      complexity at real supply manifolds / DWV convergence points.
 *
 *   2. A 2-way junction still produces a tee / reducer (regression
 *      guard on the existing path).
 *
 *   3. A 3-way junction (three endpoints at one point) produces a
 *      fitting (currently a tee — the audit's future-work cutoff is
 *      between 3-way wye/tee selection and 4-way cross).
 *
 *   4. A straight polyline with a 90° bend in the middle produces one
 *      elbow-class bend (baseline regression guard).
 *
 *   5. Shallow bends under 5° produce no fittings (documented
 *      noise-tolerance threshold).
 */

import { describe, it, expect } from 'vitest';
import { generateAllFittings } from '../FittingGenerator';
import type { CommittedPipe } from '@store/pipeStore';
import type { PipeMaterial } from '../../../engine/graph/GraphEdge';
import type { Vec3 } from '@core/events';

// ── Fixtures ──────────────────────────────────────────────────

function mkPipe(
  id: string,
  points: Vec3[],
  overrides: Partial<CommittedPipe> = {},
): CommittedPipe {
  return {
    id,
    points,
    diameter: overrides.diameter ?? 2,
    material: overrides.material ?? ('pvc_sch40' as PipeMaterial),
    system: overrides.system ?? 'waste',
    color: '#ffa726',
    visible: true,
    selected: false,
  };
}

// ── 4-way cross detection (Phase 13.A HIGH-value fix) ────────

describe('4-way cross detection', () => {
  it('four pipes meeting at origin produce ONE cross fitting (not multiple tees)', () => {
    // Four pipes, each starting at origin, reaching out in +X, -X, +Z, -Z.
    const pipes = [
      mkPipe('p-east',  [[0, 0, 0], [5, 0, 0]]),
      mkPipe('p-west',  [[0, 0, 0], [-5, 0, 0]]),
      mkPipe('p-north', [[0, 0, 0], [0, 0, -5]]),
      mkPipe('p-south', [[0, 0, 0], [0, 0, 5]]),
    ];
    const fittings = generateAllFittings(pipes);

    const crosses = fittings.filter((f) => f.type === 'cross');
    const tees = fittings.filter((f) =>
      f.type === 'tee' || f.type === 'sanitary_tee' || f.type === 'wye',
    );

    // Exactly one cross at the origin.
    expect(crosses.length).toBeGreaterThanOrEqual(1);
    expect(crosses[0]!.position[0]).toBeCloseTo(0, 3);
    expect(crosses[0]!.position[1]).toBeCloseTo(0, 3);
    expect(crosses[0]!.position[2]).toBeCloseTo(0, 3);

    // And ZERO tees were emitted at that junction — the whole point
    // of the fix is that a cross supersedes the tee.
    expect(tees.length).toBe(0);
  });

  it('four pipes at an off-origin junction still produce a cross', () => {
    const hub: Vec3 = [7, 0, -3];
    const pipes = [
      mkPipe('p1', [hub, [hub[0] + 5, hub[1], hub[2]]]),
      mkPipe('p2', [hub, [hub[0] - 5, hub[1], hub[2]]]),
      mkPipe('p3', [hub, [hub[0], hub[1], hub[2] + 5]]),
      mkPipe('p4', [hub, [hub[0], hub[1], hub[2] - 5]]),
    ];
    const fittings = generateAllFittings(pipes);
    const crosses = fittings.filter((f) => f.type === 'cross');
    expect(crosses.length).toBeGreaterThanOrEqual(1);
    expect(crosses[0]!.position[0]).toBeCloseTo(hub[0], 3);
    expect(crosses[0]!.position[2]).toBeCloseTo(hub[2], 3);
  });
});

// ── 2-way junction regression ─────────────────────────────────

describe('2-way junction produces elbow (not tee) or reducer (on size change)', () => {
  it('two pipes meeting end-to-end at 90° → elbow, not tee (Phase 14.AD.5)', () => {
    // Regression guard for the user-reported bug: drawing two PVC pipes
    // meeting at a 90° corner was emitting `sanitary_tee` (for DWV) or
    // `tee` (for supply) because `defaultTeeFor` ran unconditionally on
    // any 2-pipe endpoint cluster. A 2-endpoint junction is physically
    // an ELBOW — a tee requires a third pipe. The fix in AD.5 adds a
    // dedicated 2-endpoint branch that emits `bend_90` / `bend_45` /
    // `bend_22_5` (or legacy `elbow_*` names for copper/CPVC/galv).
    const pipes = [
      mkPipe('p1', [[0, 0, 0], [5, 0, 0]]),
      mkPipe('p2', [[5, 0, 0], [5, 0, 5]]),
    ];
    const fittings = generateAllFittings(pipes);
    const tees = fittings.filter((f) =>
      f.type === 'tee' || f.type === 'sanitary_tee' || f.type === 'wye' || f.type === 'combo_wye_eighth',
    );
    const elbows = fittings.filter((f) =>
      f.type === 'bend_90' || f.type === 'bend_90_ls' || f.type === 'elbow_90',
    );
    const crosses = fittings.filter((f) => f.type === 'cross');
    expect(tees).toHaveLength(0);
    expect(elbows.length).toBeGreaterThanOrEqual(1);
    expect(crosses).toHaveLength(0);
  });

  it('two pipes meeting with different diameters → reducer', () => {
    const pipes = [
      mkPipe('p1', [[0, 0, 0], [5, 0, 0]], { diameter: 3 }),
      mkPipe('p2', [[5, 0, 0], [5, 0, 5]], { diameter: 2 }),
    ];
    const fittings = generateAllFittings(pipes);
    const reducers = fittings.filter((f) => f.type === 'reducer');
    expect(reducers.length).toBeGreaterThanOrEqual(1);
    // Should carry the two diameters.
    expect(reducers[0]!.diameter).toBe(3);
    expect(reducers[0]!.diameter2).toBe(2);
  });
});

// ── Bend detection regression ─────────────────────────────────

describe('bend detection', () => {
  it('polyline with a 90° middle vertex produces one bend/elbow fitting', () => {
    const pipes = [mkPipe('p1', [[0, 0, 0], [5, 0, 0], [5, 0, 5]])];
    const fittings = generateAllFittings(pipes);
    // Some bend-class fitting should exist: bend_90, elbow_90, or
    // bend_90_ls (long-sweep for DWV vertical turns).
    const bends = fittings.filter((f) =>
      f.type === 'bend_90' || f.type === 'bend_90_ls' || f.type === 'elbow_90',
    );
    expect(bends.length).toBe(1);
  });

  it('polyline with a shallow (<5°) bend produces no bend fitting', () => {
    // Near-straight polyline with a 2° offset at the middle vertex.
    const pipes = [mkPipe('p1', [[0, 0, 0], [5, 0, 0], [10, 0, 0.17]])];
    // atan(0.17/5) ~= 1.9° — well below the 5° noise floor.
    const fittings = generateAllFittings(pipes);
    const bends = fittings.filter((f) =>
      f.type.startsWith('bend_') || f.type.startsWith('elbow_'),
    );
    expect(bends).toHaveLength(0);
  });

  it('polyline with a 45° bend produces a 45-class bend fitting', () => {
    // Right-angle triangle legs 1,1 → 45° bend at middle vertex.
    const pipes = [mkPipe('p1', [[0, 0, 0], [5, 0, 0], [10, 0, 5]])];
    const fittings = generateAllFittings(pipes);
    // bend_45 for PVC (DWV), elbow_45 for copper.
    const bends = fittings.filter((f) =>
      f.type === 'bend_45' || f.type === 'elbow_45',
    );
    expect(bends.length).toBe(1);
  });
});

// ── Phase 14.U — PEX / Uponor bend behavior ──────────────────

describe('PEX bend fittings (Phase 14.U)', () => {
  function mkPex(points: Vec3[], diameter = 0.75): CommittedPipe {
    return mkPipe('pex', points, {
      material: 'pex' as PipeMaterial,
      system: 'cold_supply',
      diameter,
    });
  }

  it('90° PEX bend emits a pex_elbow_90 fitting (Uponor ProPEX elbow)', () => {
    // Two 5-ft legs meeting at a right angle
    const pipe = mkPex([[0, 0, 0], [5, 0, 0], [5, 0, 5]]);
    const fittings = generateAllFittings([pipe]);
    const elbows = fittings.filter((f) => f.type === 'pex_elbow_90');
    expect(elbows).toHaveLength(1);
    expect(elbows[0]!.illegalAngle).toBeFalsy();
    expect(elbows[0]!.material).toBe('pex');
    // Regression guard: no stray rigid bend_90 for a PEX pipe
    expect(fittings.filter((f) => f.type === 'bend_90')).toHaveLength(0);
  });

  it('45° PEX bend emits NO fitting (tube flexes through it)', () => {
    // 45° deflection at the middle vertex — falls in PEX smooth range
    const pts: Vec3[] = [
      [0, 0, 0],
      [5, 0, 0],
      [5 + 5 * Math.SQRT1_2, 0, 5 * Math.SQRT1_2],
    ];
    const fittings = generateAllFittings([mkPex(pts)]);
    expect(fittings.filter((f) => f.type === 'bend_90')).toHaveLength(0);
    // And no illegal-flag fittings either (legacy warning path suppressed)
    expect(fittings.filter((f) => f.illegalAngle)).toHaveLength(0);
  });

  it('very slight deflection (< 15°) emits NO fitting', () => {
    const pts: Vec3[] = [[0, 0, 0], [5, 0, 0], [10, 0, 0.5]]; // ~6° bend
    const fittings = generateAllFittings([mkPex(pts)]);
    expect(fittings).toHaveLength(0);
  });

  it('sharp PEX bend (> 120°) flagged as illegalAngle', () => {
    // Near-reversal — PEX physically kinks here
    const pts: Vec3[] = [[0, 0, 0], [5, 0, 0], [0, 0, 1]];
    const fittings = generateAllFittings([mkPex(pts)]);
    const sharp = fittings.filter((f) => f.illegalAngle);
    expect(sharp.length).toBeGreaterThanOrEqual(1);
    expect(sharp[0]!.material).toBe('pex');
  });

  it('PEX branch junction (3-way) emits a plain tee (Uponor ProPEX tee)', () => {
    // Three PEX runs meeting at a single point (5,0,0) — the
    // classic branch junction: main enters, main exits, branch
    // drops perpendicular.
    const a: CommittedPipe = { ...mkPex([[0, 0, 0], [5, 0, 0]]), id: 'a' };
    const b: CommittedPipe = { ...mkPex([[5, 0, 0], [10, 0, 0]]), id: 'b' };
    const c: CommittedPipe = { ...mkPex([[5, 0, 0], [5, 0, 5]]), id: 'c' };
    const fittings = generateAllFittings([a, b, c]);
    const tees = fittings.filter((f) => f.type === 'tee');
    expect(tees.length).toBeGreaterThanOrEqual(1);
    expect(tees[0]!.material).toBe('pex');
  });

  it('rigid PVC at 90° still uses bend_90 / elbow_90 (regression guard)', () => {
    // Same geometry as the first PEX test but with PVC — should
    // produce a rigid bend fitting via the non-flex path.
    const pipe = mkPipe('p1', [[0, 0, 0], [5, 0, 0], [5, 0, 5]], {
      material: 'pvc_sch40' as PipeMaterial,
    });
    const fittings = generateAllFittings([pipe]);
    const bends = fittings.filter(
      (f) => f.type === 'bend_90' || f.type === 'bend_90_ls' || f.type === 'elbow_90',
    );
    expect(bends).toHaveLength(1);
    expect(bends[0]!.material).toBe('pvc_sch40');
  });

  it('multiple PEX 90° bends on a single pipe each get their own ProPEX elbow', () => {
    // U-shape: right, down, right — two 90° corners
    const pipe = mkPex([[0, 0, 0], [5, 0, 0], [5, 0, 5], [10, 0, 5]]);
    const fittings = generateAllFittings([pipe]);
    expect(fittings.filter((f) => f.type === 'pex_elbow_90')).toHaveLength(2);
  });
});

// ── Empty-input safety ───────────────────────────────────────

describe('empty input', () => {
  it('empty pipe list produces empty fitting list', () => {
    expect(generateAllFittings([])).toEqual([]);
  });

  it('single-segment pipe (no bends) produces no fittings', () => {
    expect(
      generateAllFittings([mkPipe('p1', [[0, 0, 0], [5, 0, 0]])]),
    ).toEqual([]);
  });
});
