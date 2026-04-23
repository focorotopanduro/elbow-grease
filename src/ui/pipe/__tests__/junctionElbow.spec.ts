/**
 * Junction elbow emission — Phase 14.AD.5.
 *
 * Regression guard for the "I drew a 45° PVC bend and no fitting
 * showed up" bug. The root cause was that `generateJunctionFittings`
 * treated every two-pipe endpoint-to-endpoint meeting as a tee-like
 * junction and routed through `defaultTeeFor` — producing `tee`,
 * `sanitary_tee`, or `combo_wye_eighth`. Two pipes meeting is an
 * ELBOW (or coupling); a tee/wye requires a third pipe.
 *
 * These tests lock the new `endpointCount === 2` branch. If someone
 * refactors the junction classification and drops the elbow path,
 * the named assertions fail immediately.
 */

import { describe, it, expect } from 'vitest';
import { generateJunctionFittings } from '../FittingGenerator';
import type { CommittedPipe } from '@store/pipeStore';
import type { PipeMaterial } from '../../../engine/graph/GraphEdge';

type V3 = [number, number, number];

function mkPipe(
  id: string,
  points: V3[],
  material: PipeMaterial = 'pvc_sch40',
  system: 'waste' | 'cold_supply' | 'hot_supply' | 'vent' | 'storm' = 'waste',
): CommittedPipe {
  return {
    id,
    points,
    diameter: 2,
    material,
    system,
    color: '#ffa726',
    visible: true,
    selected: false,
  };
}

// ── 2-endpoint elbow emission ────────────────────────────────

describe('generateJunctionFittings — 2 pipes meeting at a bend', () => {
  it('PVC 45° bend → bend_45 fitting (NOT combo_wye_eighth)', () => {
    // Pipe A east, pipe B northeast from A's end point — classic 45°
    // residential waste run around an interior corner.
    const pipeA = mkPipe('a', [[0, 0, 0], [5, 0, 0]]);
    const pipeB = mkPipe('b', [[5, 0, 0], [10, 0, 5]]);
    const result = generateJunctionFittings([pipeA, pipeB], new Set());

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('bend_45');
    // Phase 14.AD.19 — elbow position is at the BEND CENTER, offset
    // from the kink point (5,0,0) into the L's interior by
    // bendR/cos(22.5°) along the perpendicular bisector. The precise
    // numerics fall out of PVC 2" 45° short-sweep geometry.
    const [x, y, z] = result[0]!.position;
    expect(x).toBeCloseTo(4.918, 2); // slightly west of corner
    expect(y).toBeCloseTo(0, 3);     // stays in drawn plane
    expect(z).toBeCloseTo(0.198, 2); // offset forward (into L interior)
  });

  it('PVC 90° bend → bend_90 fitting (NOT sanitary_tee)', () => {
    const pipeA = mkPipe('a', [[0, 0, 0], [5, 0, 0]]);
    const pipeB = mkPipe('b', [[5, 0, 0], [5, 0, 5]]); // 90° turn north
    const result = generateJunctionFittings([pipeA, pipeB], new Set());

    expect(result).toHaveLength(1);
    // DWV vertical turn produces long-sweep variant; either is acceptable
    // as long as it's an ELBOW of some kind, not a tee.
    expect(['bend_90', 'bend_90_ls']).toContain(result[0]!.type);
  });

  it('PVC 22.5° bend → bend_22_5 fitting', () => {
    // sin(22.5°) ≈ 0.383, cos(22.5°) ≈ 0.924
    const pipeA = mkPipe('a', [[0, 0, 0], [5, 0, 0]]);
    const pipeB = mkPipe('b', [[5, 0, 0], [9.62, 0, 1.91]]); // 22.5° off east
    const result = generateJunctionFittings([pipeA, pipeB], new Set());

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('bend_22_5');
  });

  it('Copper 45° bend uses legacy elbow_45 name (not bend_45)', () => {
    const pipeA = mkPipe('a', [[0, 0, 0], [5, 0, 0]], 'copper_type_l', 'cold_supply');
    const pipeB = mkPipe('b', [[5, 0, 0], [10, 0, 5]], 'copper_type_l', 'cold_supply');
    const result = generateJunctionFittings([pipeA, pipeB], new Set());

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('elbow_45');
  });

  it('Copper 90° bend uses legacy elbow_90 name', () => {
    const pipeA = mkPipe('a', [[0, 0, 0], [5, 0, 0]], 'copper_type_l', 'cold_supply');
    const pipeB = mkPipe('b', [[5, 0, 0], [5, 0, 5]], 'copper_type_l', 'cold_supply');
    const result = generateJunctionFittings([pipeA, pipeB], new Set());

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('elbow_90');
  });

  it('Inline (0°) junction → coupling (not elbow, not tee)', () => {
    // Two PVC pipes meeting end-to-end in a straight line.
    const pipeA = mkPipe('a', [[0, 0, 0], [5, 0, 0]]);
    const pipeB = mkPipe('b', [[5, 0, 0], [10, 0, 0]]); // continues straight east
    const result = generateJunctionFittings([pipeA, pipeB], new Set());

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('coupling');
  });
});

// ── Existing tee/wye behaviour preserved for 3+ endpoints ────

describe('generateJunctionFittings — 3+ pipes (tees) unaffected', () => {
  it('Three PVC pipes meeting at 90° branch → sanitary_tee (DWV)', () => {
    // Main line A runs east 0→10. Pipe B ends at the midpoint as the
    // through-line. Pipe C branches perpendicular from that midpoint.
    // The junction generator needs pipe endpoints NEAR the midpoint of
    // a third pipe for a tee-shaped cluster.
    const pipeA = mkPipe('a', [[0, 0, 0], [5, 0, 0]]);
    const pipeB = mkPipe('b', [[5, 0, 0], [10, 0, 0]]);  // continues main
    const pipeC = mkPipe('c', [[5, 0, 0], [5, 0, 5]]);   // perpendicular branch
    const result = generateJunctionFittings([pipeA, pipeB, pipeC], new Set());

    // 3 endpoints all meeting at (5,0,0). This is NOT a 2-endpoint case.
    // Should emit a tee (or sanitary_tee for DWV/90°).
    expect(result.length).toBeGreaterThanOrEqual(1);
    const types = result.map((f) => f.type);
    // Should be a tee-family fitting, not a bend.
    const teeLike = types.some((t) => t === 'sanitary_tee' || t === 'tee' || t === 'combo_wye_eighth');
    expect(teeLike).toBe(true);
  });

  it('4-way cross: 4 pipes meeting → cross fitting', () => {
    const a = mkPipe('a', [[0, 0, 0], [5, 0, 0]]);
    const b = mkPipe('b', [[5, 0, 0], [10, 0, 0]]);
    const c = mkPipe('c', [[5, 0, 0], [5, 0, 5]]);
    const d = mkPipe('d', [[5, 0, 0], [5, 0, -5]]);
    const result = generateJunctionFittings([a, b, c, d], new Set());

    const types = result.map((f) => f.type);
    expect(types).toContain('cross');
  });

  it('Reducer: 2 pipes different diameters at endpoints', () => {
    const pipeA: CommittedPipe = { ...mkPipe('a', [[0, 0, 0], [5, 0, 0]]), diameter: 3 };
    const pipeB: CommittedPipe = { ...mkPipe('b', [[5, 0, 0], [10, 0, 0]]), diameter: 2 };
    const result = generateJunctionFittings([pipeA, pipeB], new Set());

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('reducer');
  });
});

// ── Quaternion sanity: elbow orientation follows the bend ───

describe('generateJunctionFittings — elbow orientation', () => {
  it('quaternion differs between 45° and 90° bends', () => {
    const bend45A = mkPipe('a', [[0, 0, 0], [5, 0, 0]]);
    const bend45B = mkPipe('b', [[5, 0, 0], [10, 0, 5]]);
    const r45 = generateJunctionFittings([bend45A, bend45B], new Set());

    const bend90A = mkPipe('x', [[0, 0, 0], [5, 0, 0]]);
    const bend90B = mkPipe('y', [[5, 0, 0], [5, 0, 5]]);
    const r90 = generateJunctionFittings([bend90A, bend90B], new Set());

    expect(r45[0]!.quaternion).not.toEqual(r90[0]!.quaternion);
  });

  it('all 4 quaternion components are finite numbers', () => {
    const pipeA = mkPipe('a', [[0, 0, 0], [5, 0, 0]]);
    const pipeB = mkPipe('b', [[5, 0, 0], [10, 0, 5]]);
    const result = generateJunctionFittings([pipeA, pipeB], new Set());

    for (const q of result[0]!.quaternion) {
      expect(Number.isFinite(q)).toBe(true);
    }
  });
});
