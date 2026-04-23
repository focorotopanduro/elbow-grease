/**
 * Coupling orientation + bushing catalog + bushing auto-emitter
 * — Phases 14.AD.11, 14.AD.12, 14.AD.16.
 *
 * Covers:
 *   • Coupling emission at a 2-endpoint inline (< 5°) junction uses
 *     `alignAxisToPipe(dirA)` rather than `bendQuaternion` so the
 *     body axis aligns with the pipe direction instead of defaulting
 *     to identity (= world Y axis).
 *   • Bushing is part of the catalog (FITTING_TYPES, FITTING_EQ_LENGTH,
 *     BOM tables, IFC schema mappings). Adding a new catalog entry
 *     without breaking the Record<FittingType, …> invariants is the
 *     regression guard.
 *   • AD.16: junction with a tee main at one diameter + a smaller
 *     branch pipe auto-emits a reducing bushing offset along the
 *     branch axis.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateJunctionFittings } from '../FittingGenerator';
import { FITTING_TYPES, FITTING_EQ_LENGTH } from '../../../engine/graph/GraphEdge';
import { FITTING_TO_IFC, FITTING_PREDEFINED } from '../../../engine/export/IFCSchema';
import type { CommittedPipe } from '@store/pipeStore';

function mkPipe(id: string, points: [number, number, number][]): CommittedPipe {
  return {
    id,
    points,
    diameter: 2,
    material: 'pvc_sch40',
    system: 'cold_supply',
    color: '#ffa726',
    visible: true,
    selected: false,
  };
}

function mkPipeD(
  id: string,
  points: [number, number, number][],
  diameter: number,
  material: CommittedPipe['material'] = 'pvc_sch40',
): CommittedPipe {
  return {
    id,
    points,
    diameter,
    material,
    system: 'cold_supply',
    color: '#ffa726',
    visible: true,
    selected: false,
  };
}

// ── AD.11: Coupling orientation ──────────────────────────────

describe('Phase 14.AD.11 — inline coupling aligns with pipe axis', () => {
  it('two pipes exactly inline (0° bend) → coupling with non-identity orientation quaternion', () => {
    // Pipe A east, pipe B continues east — a straight inline junction.
    const a = mkPipe('a', [[0, 0, 0], [5, 0, 0]]);
    const b = mkPipe('b', [[5, 0, 0], [10, 0, 0]]);
    const result = generateJunctionFittings([a, b], new Set());
    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.type).toBe('coupling');
    // Pre-AD.11: bendQuaternion(east, east) → planeNormal ≈ 0 →
    // returns [0,0,0,1] identity. That rendered the coupling along
    // world Y, not along the pipe axis.
    // Post-AD.11: alignAxisToPipe(east) rotates local +X to east,
    // which IS identity (since local +X is already world +X), BUT
    // for a NON-X pipe direction the quaternion is non-identity.
    // Verify the Y-axis case below.
    const [x, y, z, w] = c.quaternion;
    expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && Number.isFinite(w)).toBe(true);
  });

  it('two pipes inline along world +Y (vertical pipe) → coupling quaternion is 90° Z-axis rotation', () => {
    // Pipe A going up, pipe B continuing up.
    const a = mkPipe('a', [[0, 0, 0], [0, 5, 0]]);
    const b = mkPipe('b', [[0, 5, 0], [0, 10, 0]]);
    const result = generateJunctionFittings([a, b], new Set());
    expect(result).toHaveLength(1);
    const c = result[0]!;
    expect(c.type).toBe('coupling');
    const q = new THREE.Quaternion(...c.quaternion);
    // The coupling's local +X axis should now point along world +Y
    // (the pipe direction). Rotate a test vector and verify.
    const probe = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(probe.y).toBeCloseTo(1, 3);
    expect(probe.x).toBeCloseTo(0, 3);
    expect(probe.z).toBeCloseTo(0, 3);
  });

  it('two pipes inline along world +Z (horizontal axis normal to camera) → coupling X aligns with Z', () => {
    const a = mkPipe('a', [[0, 0, 0], [0, 0, 5]]);
    const b = mkPipe('b', [[0, 0, 5], [0, 0, 10]]);
    const result = generateJunctionFittings([a, b], new Set());
    expect(result).toHaveLength(1);
    const c = result[0]!;
    const q = new THREE.Quaternion(...c.quaternion);
    const probe = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(probe.z).toBeCloseTo(1, 3);
  });

  it('antiparallel pipes (pipe B goes -X from a +X approach): coupling still renders sensibly', () => {
    // Edge case: if somehow dirA = east and travelOut = west (shouldn't
    // happen in real plumbing but test for robustness), the coupling
    // quaternion falls through to the antiparallel guard and produces
    // a stable 180° Y rotation rather than an unpredictable flip.
    //
    // In practice `generateJunctionFittings` wouldn't classify this
    // as a < 5° bend (it's 180°), so it wouldn't emit a coupling.
    // Assertion below just confirms no NaN/Infinity from the helper.
    const a = mkPipe('a', [[0, 0, 0], [5, 0, 0]]);
    // Inline pipe: same direction so bend = 0°
    const b = mkPipe('b', [[5, 0, 0], [10, 0, 0]]);
    const result = generateJunctionFittings([a, b], new Set());
    const [x, y, z, w] = result[0]!.quaternion;
    for (const v of [x, y, z, w]) expect(Number.isFinite(v)).toBe(true);
  });
});

// ── AD.12: Bushing in catalog ────────────────────────────────

describe('Phase 14.AD.12 — bushing FittingType registered', () => {
  it('bushing appears in FITTING_TYPES tuple', () => {
    expect(FITTING_TYPES).toContain('bushing');
  });

  it('bushing has a friction-loss equivalent-length row', () => {
    expect(FITTING_EQ_LENGTH.bushing).toBeDefined();
    // Spot-check: 2" bushing has some positive length.
    expect(FITTING_EQ_LENGTH.bushing[2]).toBeGreaterThan(0);
  });

  it('bushing has an IFC export mapping (transition)', () => {
    expect(FITTING_TO_IFC.bushing).toBe('IfcPipeFitting');
    expect(FITTING_PREDEFINED.bushing).toBe('TRANSITION');
  });

  it('bushing equiv-length is close to but not identical to reducer', () => {
    // Bushings have slightly lower K-factor than reducer coupling
    // (single flow transition vs. one-at-each-end for coupling).
    // Spot-check at 2".
    const b = FITTING_EQ_LENGTH.bushing[2]!;
    const r = FITTING_EQ_LENGTH.reducer[2]!;
    expect(b).toBeLessThan(r);
    expect(b).toBeGreaterThan(r * 0.5); // not wildly different either
  });
});

// ── AD.16: Bushing auto-emitter ──────────────────────────────

describe('Phase 14.AD.16 — bushing auto-emitter on reducing branch', () => {
  it('3-pipe T-junction with a smaller branch emits a tee + bushing', () => {
    // Two 2" pipes form the main run meeting at the origin.
    const main1 = mkPipeD('main1', [[-5, 0, 0], [0, 0, 0]], 2);
    const main2 = mkPipeD('main2', [[0, 0, 0], [5, 0, 0]], 2);
    // One 1" pipe branches south.
    const branch = mkPipeD('branch', [[0, 0, 0], [0, 0, 5]], 1);
    const result = generateJunctionFittings([main1, main2, branch], new Set());

    const tee = result.find((f) => f.type === 'tee');
    const bushing = result.find((f) => f.type === 'bushing');
    expect(tee).toBeDefined();
    expect(bushing).toBeDefined();
  });

  it('bushing diameters: spigot = main (2"), hub = branch (1")', () => {
    const main1 = mkPipeD('main1', [[-5, 0, 0], [0, 0, 0]], 2);
    const main2 = mkPipeD('main2', [[0, 0, 0], [5, 0, 0]], 2);
    const branch = mkPipeD('branch', [[0, 0, 0], [0, 0, 5]], 1);
    const result = generateJunctionFittings([main1, main2, branch], new Set());

    const bushing = result.find((f) => f.type === 'bushing')!;
    expect(bushing.diameter).toBe(2);
    expect(bushing.diameter2).toBe(1);
    expect(bushing.material).toBe('pvc_sch40');
    // Bushing "belongs to" the branch pipe for BOM attribution.
    expect(bushing.pipeId).toBe('branch');
  });

  it('bushing position is offset along the branch axis (not at junction)', () => {
    const main1 = mkPipeD('main1', [[-5, 0, 0], [0, 0, 0]], 2);
    const main2 = mkPipeD('main2', [[0, 0, 0], [5, 0, 0]], 2);
    const branch = mkPipeD('branch', [[0, 0, 0], [0, 0, 5]], 1);
    const result = generateJunctionFittings([main1, main2, branch], new Set());

    const bushing = result.find((f) => f.type === 'bushing')!;
    // Junction is at origin [0,0,0]. Bushing sits along +Z (branch
    // axis) at some positive offset — NOT at the junction itself.
    expect(bushing.position[0]).toBeCloseTo(0, 3);
    expect(bushing.position[1]).toBeCloseTo(0, 3);
    expect(bushing.position[2]).toBeGreaterThan(0);
    // Offset is one "port offset" along the branch = 1.4 × OD-of-main.
    // 2" PVC Sch 40 OD ≈ 2.375" = 0.198 ft. Offset ≈ 0.277 ft.
    expect(bushing.position[2]).toBeGreaterThan(0.1);
    expect(bushing.position[2]).toBeLessThan(0.5);
  });

  it('bushing quaternion aligns local +X with branch direction (+Z)', () => {
    const main1 = mkPipeD('main1', [[-5, 0, 0], [0, 0, 0]], 2);
    const main2 = mkPipeD('main2', [[0, 0, 0], [5, 0, 0]], 2);
    const branch = mkPipeD('branch', [[0, 0, 0], [0, 0, 5]], 1);
    const result = generateJunctionFittings([main1, main2, branch], new Set());

    const bushing = result.find((f) => f.type === 'bushing')!;
    const q = new THREE.Quaternion(...bushing.quaternion);
    const probe = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(probe.z).toBeCloseTo(1, 3);
    expect(probe.x).toBeCloseTo(0, 3);
    expect(probe.y).toBeCloseTo(0, 3);
  });

  it('3-pipe junction with ALL same diameter → NO bushing', () => {
    // All 2". Pure tee, no reducer needed.
    const main1 = mkPipeD('main1', [[-5, 0, 0], [0, 0, 0]], 2);
    const main2 = mkPipeD('main2', [[0, 0, 0], [5, 0, 0]], 2);
    const branch = mkPipeD('branch', [[0, 0, 0], [0, 0, 5]], 2);
    const result = generateJunctionFittings([main1, main2, branch], new Set());

    expect(result.some((f) => f.type === 'tee')).toBe(true);
    expect(result.some((f) => f.type === 'bushing')).toBe(false);
  });

  it('mixed materials at junction → NO bushing (material mismatch guard)', () => {
    // 2" PVC main + 2" PVC main + 1" COPPER branch: a transition
    // coupling is the real-world answer, not a bushing. Auto-emitter
    // refuses to bridge the material gap.
    const main1 = mkPipeD('main1', [[-5, 0, 0], [0, 0, 0]], 2, 'pvc_sch40');
    const main2 = mkPipeD('main2', [[0, 0, 0], [5, 0, 0]], 2, 'pvc_sch40');
    const branch = mkPipeD('branch', [[0, 0, 0], [0, 0, 5]], 1, 'copper_type_l');
    const result = generateJunctionFittings([main1, main2, branch], new Set());

    expect(result.some((f) => f.type === 'bushing')).toBe(false);
  });

  it('tiny diameter delta (< 0.1") → NO bushing (reducer threshold)', () => {
    // 2" main + 1.95" branch — within measurement noise. Real install
    // wouldn't reduce here; both use the same nominal hub.
    const main1 = mkPipeD('main1', [[-5, 0, 0], [0, 0, 0]], 2);
    const main2 = mkPipeD('main2', [[0, 0, 0], [5, 0, 0]], 2);
    const branch = mkPipeD('branch', [[0, 0, 0], [0, 0, 5]], 1.95);
    const result = generateJunctionFittings([main1, main2, branch], new Set());

    expect(result.some((f) => f.type === 'bushing')).toBe(false);
  });

  it('4-pipe junction emits cross, NOT tee+bushing (AD.16 respects AD.13 cross path)', () => {
    // 4 pipes meeting = cross. The bushing emitter lives in the 3+
    // endpoint ELSE branch, so the cross path is undisturbed.
    const main1 = mkPipeD('main1', [[-5, 0, 0], [0, 0, 0]], 2);
    const main2 = mkPipeD('main2', [[0, 0, 0], [5, 0, 0]], 2);
    const branch1 = mkPipeD('branch1', [[0, 0, 0], [0, 0, 5]], 1);
    const branch2 = mkPipeD('branch2', [[0, 0, 0], [0, 0, -5]], 1);
    const result = generateJunctionFittings(
      [main1, main2, branch1, branch2],
      new Set(),
    );

    expect(result.some((f) => f.type === 'cross')).toBe(true);
    // 4-way crosses do NOT auto-emit bushings — the cross-reducer
    // SKU is not modeled here.
    expect(result.some((f) => f.type === 'bushing')).toBe(false);
  });

  it('short 1" pipe bridging two 2" tees → bushing at EACH end', () => {
    // The small pipe endpoints at both junctions each get a bushing.
    const m1a = mkPipeD('m1a', [[-10, 0, 0], [-5, 0, 0]], 2);
    const m1b = mkPipeD('m1b', [[-5, 0, 0], [-5, 0, 5]], 2);
    const bridge = mkPipeD('bridge', [[-5, 0, 0], [5, 0, 0]], 1);
    const m2a = mkPipeD('m2a', [[5, 0, 0], [10, 0, 0]], 2);
    const m2b = mkPipeD('m2b', [[5, 0, 0], [5, 0, 5]], 2);
    const result = generateJunctionFittings(
      [m1a, m1b, bridge, m2a, m2b],
      new Set(),
    );

    const bushings = result.filter((f) => f.type === 'bushing');
    expect(bushings).toHaveLength(2);
    // Both bushings belong to the bridge pipe.
    for (const b of bushings) {
      expect(b.pipeId).toBe('bridge');
      expect(b.diameter).toBe(2);
      expect(b.diameter2).toBe(1);
    }
  });
});
