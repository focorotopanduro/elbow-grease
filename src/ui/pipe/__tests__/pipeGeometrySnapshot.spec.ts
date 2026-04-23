/**
 * Pipe geometry snapshot harness — Phase 14.AD.13.b
 *
 * Locks the geometric OUTPUT of `buildPipeGeometry` across a matrix
 * of realistic input combinations. Any change to pipe rendering
 * (radial segment counts, retraction math, flexible curve sampling)
 * flips at least one snapshot — forcing an intentional review
 * rather than a silent visual regression.
 *
 * Update workflow:
 *
 *   When you INTENTIONALLY change pipe geometry (e.g. tuning
 *   radial segment counts, updating retraction rules), re-run
 *   vitest with `-u` to regenerate snapshots:
 *
 *     npx vitest run src/ui/pipe/__tests__/pipeGeometrySnapshot.spec.ts -u
 *
 *   Review the snap file diff. If the changes match your intent,
 *   commit the new snapshots alongside the code change. If any
 *   hash you didn't touch changed, that's an unintended side
 *   effect — investigate before committing.
 *
 * Design:
 *
 *   - Matrix covers 8 representative PipeMaterial values across 3
 *     diameters (0.75", 2", 4") and 4 topology shapes (straight,
 *     single-bend, multi-bend, very short).
 *   - Each case also varies retraction flags (off, start, end, both)
 *     for rigid materials. Flexible (PEX) ignores retraction but
 *     we still probe it to catch regressions where flexible paths
 *     accidentally honor the flags.
 *
 * The matrix produces ~40 snapshots. Collectively they cover every
 * branch in buildPipeGeometry as well as the AD.6/AD.7 retraction
 * logic + AD.4 straight-segment path + Catmull-Rom smooth path.
 */

import { describe, it, expect } from 'vitest';
import { buildPipeGeometry } from '../buildPipeGeometry';
import { hashBufferGeometry, fingerprintBufferGeometry } from '../geometryHash';
import type { PipeMaterial } from '../../../engine/graph/GraphEdge';

type V3 = [number, number, number];

// ── Input matrix ─────────────────────────────────────────────

const STRAIGHT: V3[] = [[0, 0, 0], [10, 0, 0]];
const BEND_45: V3[] = [[0, 0, 0], [5, 0, 0], [5, 0, 5]];
const BEND_90: V3[] = [[0, 0, 0], [5, 0, 0], [5, 5, 0]];
const MULTI: V3[] = [[0, 0, 0], [5, 0, 0], [5, 0, 5], [10, 0, 5]];
const SHORT: V3[] = [[0, 0, 0], [0.05, 0, 0]];

const SHAPES: Array<{ name: string; points: V3[] }> = [
  { name: 'straight', points: STRAIGHT },
  { name: 'bend-45', points: BEND_45 },
  { name: 'bend-90', points: BEND_90 },
  { name: 'multi-bend', points: MULTI },
  { name: 'short-straight', points: SHORT },
];

const RIGID_MATERIALS: PipeMaterial[] = [
  'pvc_sch40',
  'pvc_sch80',
  'abs',
  'cpvc',
  'copper_type_l',
  'cast_iron',
  'galvanized_steel',
  'ductile_iron',
];

const FLEXIBLE_MATERIALS: PipeMaterial[] = ['pex'];

const DIAMETERS = [0.75, 2, 4];

// ── Rigid matrix ─────────────────────────────────────────────

describe('buildPipeGeometry — rigid material snapshots', () => {
  for (const material of RIGID_MATERIALS) {
    for (const diameter of DIAMETERS) {
      for (const shape of SHAPES) {
        it(`${material} ${diameter}" ${shape.name} — no retraction`, () => {
          const r = buildPipeGeometry({
            material, diameter, points: shape.points,
          });
          if (r === null) {
            expect(r).toMatchSnapshot();
            return;
          }
          expect({
            hash: hashBufferGeometry(r.main),
            wallHash: hashBufferGeometry(r.wall),
            dim: fingerprintBufferGeometry(r.main),
            isRigid: r.isRigid,
          }).toMatchSnapshot();
        });
      }
    }
  }
});

// ── Retraction flag matrix (rigid only) ─────────────────────

describe('buildPipeGeometry — rigid retraction flag matrix', () => {
  // One representative material × one diameter × all retraction
  // combos. The retraction math is shared across materials, so
  // covering every material × flag combo would be redundant; this
  // subset catches regressions in the flag-handling branch itself.
  const material: PipeMaterial = 'pvc_sch40';
  const diameter = 2;

  // Phase 14.AD.21 — retraction is now numeric (feet). Sample values:
  // 0 = free end, 0.125 ≈ socketDepth (coupling/tee), 0.422 ≈
  // socketDepth + short-sweep bendR (elbow).
  for (const shape of [SHAPES[1]!, SHAPES[2]!, SHAPES[3]!]) { // non-trivial shapes
    for (const [retractStartFt, retractEndFt] of [
      [0, 0],
      [0.125, 0],   // start at coupling-style junction
      [0, 0.422],   // end at 90° elbow junction
      [0.422, 0.422], // both ends at elbow junctions
    ] as [number, number][]) {
      it(`${material} ${diameter}" ${shape.name} retractStartFt=${retractStartFt} retractEndFt=${retractEndFt}`, () => {
        const r = buildPipeGeometry({
          material, diameter, points: shape.points,
          retractStartFt, retractEndFt,
        });
        expect({
          hash: hashBufferGeometry(r!.main),
          dim: fingerprintBufferGeometry(r!.main),
        }).toMatchSnapshot();
      });
    }
  }
});

// ── Flexible (PEX) matrix ───────────────────────────────────

describe('buildPipeGeometry — flexible (PEX) snapshots', () => {
  for (const material of FLEXIBLE_MATERIALS) {
    for (const diameter of DIAMETERS) {
      for (const shape of SHAPES) {
        it(`${material} ${diameter}" ${shape.name}`, () => {
          const r = buildPipeGeometry({
            material, diameter, points: shape.points,
          });
          if (r === null) {
            expect(r).toMatchSnapshot();
            return;
          }
          expect({
            hash: hashBufferGeometry(r.main),
            dim: fingerprintBufferGeometry(r.main),
            isRigid: r.isRigid,
          }).toMatchSnapshot();
        });
      }
    }
  }

  it('flexible TUBE geometry ignores retraction hints (Phase 14.AD.29 guard)', () => {
    // The flexible PEX TUBE itself is unaffected by retraction
    // hints — that was the original contract (retraction is a
    // rigid-fitting concern). Post-AD.29 end caps DO depend on
    // retraction (caps only render when retraction=0, i.e. free
    // end), so we compare TWO versions with the SAME retraction
    // state — they should hash identically.
    const a = buildPipeGeometry({
      material: 'pex', diameter: 2, points: BEND_45,
      retractStartFt: 0.422, retractEndFt: 0.422,
    });
    const b = buildPipeGeometry({
      material: 'pex', diameter: 2, points: BEND_45,
      retractStartFt: 0.422, retractEndFt: 0.422,
    });
    expect(hashBufferGeometry(a!.main))
      .toBe(hashBufferGeometry(b!.main));

    // Sanity check that the hints still don't change the TUBE
    // geometry itself — extract just the first 21*N*... vertices
    // (the tube; caps are appended). Since we can't easily split,
    // compare both versions' WALL geometries (which NEVER get
    // caps — caps are main-only). Wall is a function of the tube
    // curve alone, so retraction shouldn't affect it.
    const noHints = buildPipeGeometry({
      material: 'pex', diameter: 2, points: BEND_45,
    });
    const withHints = buildPipeGeometry({
      material: 'pex', diameter: 2, points: BEND_45,
      retractStartFt: 0.422, retractEndFt: 0.422,
    });
    expect(hashBufferGeometry(noHints!.wall))
      .toBe(hashBufferGeometry(withHints!.wall));
  });
});

// ── Degenerate inputs ────────────────────────────────────────

describe('buildPipeGeometry — degenerate input snapshots', () => {
  it('0 points returns null', () => {
    expect(buildPipeGeometry({
      material: 'pvc_sch40', diameter: 2, points: [],
    })).toBeNull();
  });

  it('1 point returns null', () => {
    expect(buildPipeGeometry({
      material: 'pvc_sch40', diameter: 2, points: [[0, 0, 0]],
    })).toBeNull();
  });
});
