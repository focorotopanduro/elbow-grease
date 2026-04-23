/**
 * buildPipeGeometry — Phase 14.AD.4 regression tests.
 *
 * These tests exist to lock in the rigid-vs-flexible rendering
 * contract. They're the regression guard against re-introducing the
 * "PVC renders as a smooth curve" bug that this phase fixes.
 *
 * Conceptually:
 *   • Rigid materials MUST take the per-segment merged path.
 *   • Flexible materials (PEX) MUST take the single Catmull-Rom path.
 *
 * The output's `isRigid` flag is the structural signal. A Frenet-
 * frame-smoothed flexible tube at a sharp vertex is VISIBLY
 * different from a crisp-cornered rigid tube — but that's a
 * rendering-pipeline property. We assert the STRUCTURAL choice
 * here, which is necessary and sufficient to rule out the bug.
 *
 * For extra coverage, we assert vertex counts to catch a silent
 * regression where someone accidentally routes a material through
 * the wrong branch.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildPipeGeometry } from '../buildPipeGeometry';
import type { PipeMaterial } from '../../../engine/graph/GraphEdge';

type P = [number, number, number];

function bundle(material: PipeMaterial, points: P[], diameter = 2) {
  return buildPipeGeometry({ points, diameter, material });
}

// ── Degenerate input ────────────────────────────────────────

describe('buildPipeGeometry — degenerate input', () => {
  it('returns null for 0-point pipe', () => {
    expect(bundle('pvc_sch40', [])).toBeNull();
  });

  it('returns null for 1-point pipe', () => {
    expect(bundle('pvc_sch40', [[0, 0, 0]])).toBeNull();
  });
});

// ── Flexible materials: single smooth path ──────────────────

describe('buildPipeGeometry — flexible (PEX) path', () => {
  it('PEX: isRigid = false', () => {
    const r = bundle('pex', [[0, 0, 0], [5, 0, 0], [5, 0, 5]]);
    expect(r).not.toBeNull();
    expect(r!.isRigid).toBe(false);
  });

  it('PEX produces a high-vertex-count smooth tube (≥32 curve segs × 21 radial = 672+)', () => {
    // The flexible branch uses segs = max(32, points.length * 24)
    // and 20 radial segments. A 3-point pipe gets 72 curve segs
    // × 21 radial points per ring ≈ 1512 vertices.
    const r = bundle('pex', [[0, 0, 0], [5, 0, 0], [5, 0, 5]]);
    const vCount = r!.main.getAttribute('position').count;
    expect(vCount).toBeGreaterThan(500);
  });
});

// ── Rigid materials: per-segment straight path ──────────────

describe('buildPipeGeometry — rigid materials use per-segment merge', () => {
  const RIGID_MATERIALS: PipeMaterial[] = [
    'pvc_sch40',
    'pvc_sch80',
    'abs',
    'cpvc',
    'copper_type_l',
    'copper_type_m',
    'cast_iron',
    'galvanized_steel',
    'ductile_iron',
  ];

  for (const material of RIGID_MATERIALS) {
    it(`${material}: isRigid = true`, () => {
      const r = bundle(material, [[0, 0, 0], [5, 0, 0], [5, 0, 5]]);
      expect(r).not.toBeNull();
      expect(r!.isRigid).toBe(true);
    });
  }

  // Phase 14.AD.29: pipe ENDS now receive a CircleGeometry(radius, 16)
  // disc cap when the end is free (no fitting expected, retraction 0).
  // Each cap contributes 18 verts (1 center + 17 outer ring). Both
  // ends free → +36 verts.
  const CAP_VERTS = 18;
  const TUBE_VERTS_PER_SEG = 26;

  it('PVC straight 2-point pipe: 1 segment (26 tube verts) + 2 end caps (36 verts) = 62', () => {
    const r = bundle('pvc_sch40', [[0, 0, 0], [5, 0, 0]]);
    const vCount = r!.main.getAttribute('position').count;
    expect(vCount).toBe(TUBE_VERTS_PER_SEG + 2 * CAP_VERTS);
  });

  it('PVC 3-point pipe (1 bend): 2 segments + 2 end caps', () => {
    const r = bundle('pvc_sch40', [[0, 0, 0], [5, 0, 0], [5, 0, 5]]);
    const vCount = r!.main.getAttribute('position').count;
    expect(vCount).toBe(2 * TUBE_VERTS_PER_SEG + 2 * CAP_VERTS);
  });

  it('PVC 4-point pipe (2 bends): 3 segments + 2 end caps', () => {
    const r = bundle('pvc_sch40', [[0, 0, 0], [5, 0, 0], [5, 0, 5], [10, 0, 5]]);
    const vCount = r!.main.getAttribute('position').count;
    expect(vCount).toBe(3 * TUBE_VERTS_PER_SEG + 2 * CAP_VERTS);
  });

  it('wall tube has SAME segment count as main minus end caps (caps are main-only)', () => {
    const r = bundle('pvc_sch40', [[0, 0, 0], [5, 0, 0], [5, 0, 5]]);
    // Wall shell skips the end caps because the wall material is
    // already transparent — a sealed wall at pipe-end would just
    // hide the main cap underneath.
    expect(r!.wall.getAttribute('position').count).toBe(
      r!.main.getAttribute('position').count - 2 * CAP_VERTS,
    );
  });

  it('end caps omitted when retraction > 0 (fitting covers the end)', () => {
    // Both ends "retracted" (fitting expected) → no caps.
    const r = buildPipeGeometry({
      points: [[0, 0, 0], [5, 0, 0]],
      diameter: 2,
      material: 'pvc_sch40',
      retractStartFt: 0.125,
      retractEndFt: 0.125,
    });
    expect(r!.main.getAttribute('position').count).toBe(TUBE_VERTS_PER_SEG);
  });
});

// ── The "PVC smooth curve" bug itself ───────────────────────

describe('buildPipeGeometry — PVC smooth curve regression guard', () => {
  it('PVC does NOT take the flexible path even with a sharp vertex', () => {
    // A sharp 90° bend is the exact scenario the screenshot-bug was
    // reported on. Assert structurally that the rigid branch runs.
    const r = bundle('pvc_sch40', [[0, 0, 0], [5, 0, 0], [5, 0, 5]]);
    expect(r!.isRigid).toBe(true);
  });

  it('PVC vertex count is DETERMINISTIC and linear in segment count', () => {
    // If someone re-introduces a Catmull-Rom or compound-curve
    // TubeGeometry in the rigid path, the vertex count would jump
    // from 26 × N to 672+ (flexible branch). This assertion pins
    // the contract. Phase 14.AD.29: both free ends receive a cap
    // disc (+18 verts each = +36 total).
    for (let segs = 1; segs <= 5; segs++) {
      const points: P[] = [];
      for (let i = 0; i <= segs; i++) points.push([i, 0, 0]);
      const r = bundle('pvc_sch40', points);
      expect(r!.main.getAttribute('position').count).toBe(segs * 26 + 36);
    }
  });

  it('flexible PEX vertex count scales with curve sampling (NOT with segment count linearly)', () => {
    // The flexible branch uses a smooth curve sampled densely. Vertex
    // count goes up with point count but follows the formula
    // max(32, n*24) × 21. This establishes the invariant contrast
    // with rigid so a future bug that swaps the branches would trip
    // the test.
    const r2 = bundle('pex', [[0, 0, 0], [1, 0, 0]]);
    const r5 = bundle('pex', [[0, 0, 0], [1, 0, 0], [1, 1, 0], [2, 1, 0], [2, 1, 1]]);
    const v2 = r2!.main.getAttribute('position').count;
    const v5 = r5!.main.getAttribute('position').count;
    // Flexible = smooth curve — more points → more samples → more verts.
    expect(v5).toBeGreaterThan(v2);
    // And both should be much higher than what rigid would produce
    // for the same point counts (rigid would be 26 and 4*26=104).
    expect(v2).toBeGreaterThan(104);
  });
});

// ── Phase 14.AD.6 — Pipe-end retraction at bend vertices ────

describe('buildPipeGeometry — socket-depth retraction at internal bends', () => {
  it('2-point pipe: no retraction (both ends are true pipe ends)', () => {
    // Single straight segment between its two real endpoints. No bend
    // inside the pipe, so nothing to retract for — the segment spans
    // the full [start, end] distance.
    const r = bundle('pvc_sch40', [[0, 0, 0], [10, 0, 0]]);
    // Geometry's bounding box should span the full 10 ft (allow a
    // little slop for radial tube thickness).
    r!.main.computeBoundingBox();
    const box = r!.main.boundingBox!;
    const span = box.max.x - box.min.x;
    expect(span).toBeCloseTo(10.0, 1);
  });

  it('3-point pipe: internal vertex retracts both adjacent segments by socket depth', () => {
    // Pipe: (0,0,0) → (10,0,0) → (10,0,10). Vertex at (10,0,0).
    // socketDepth for 2" PVC Sch 40 = 1.5" = 0.125 ft.
    // Segment 1 (horizontal): spans 10 ft minus 0.125 end retraction
    //   = extends from (0,0,0) to (9.875, 0, 0).
    // Segment 2 (vertical): spans 10 ft minus 0.125 start retraction
    //   = extends from (10, 0, 0.125) to (10, 0, 10).
    const r = bundle('pvc_sch40', [[0, 0, 0], [10, 0, 0], [10, 0, 10]]);
    r!.main.computeBoundingBox();
    const box = r!.main.boundingBox!;

    // X span: from 0 to max(9.875 from seg1, 10 from seg2) = 10 (seg2 extends to x=10).
    // But seg2 goes vertical, so its x stays at 10. Seg1 ends at 9.875.
    // Actually seg2 keeps x=10 for both start and end. So X goes 0 → 10.
    // The retraction is not visible in X dimension directly because seg2
    // pulls x back to 10 regardless. Let's check Z instead.
    //
    // Z span: seg1 stays at z=0, seg2 goes from z=0.125 to z=10. So the
    // geometry bounding box in Z = [0, 10].
    // Hmm, that doesn't show retraction either because seg1 has z=0 and
    // seg2 starts at z=0.125 — bbox still includes z=0 from seg1.
    //
    // The meaningful test: the vertex at (10,0,0) should NOT have
    // pipe geometry within socketDepth of it along seg1's direction.
    // Sample the position buffer and confirm the nearest vertex to
    // (10,0,0) is at least socketDepth/2 away.
    const pos = r!.main.getAttribute('position');
    const V1 = new THREE.Vector3(10, 0, 0);
    let minDistToV1 = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const d = v.distanceTo(V1);
      if (d < minDistToV1) minDistToV1 = d;
    }
    // Socket depth for 2" Sch 40 = 1.5 / 12 = 0.125 ft. Retraction
    // pulls each adjacent segment's endpoint back by that amount.
    // Accounting for the pipe's radial thickness (~0.099 ft radius),
    // the nearest geometry vertex to V1 should be roughly
    // socketDepth + radius ≈ 0.22 ft.
    // Pre-AD.6 (no retraction), the nearest vertex would be AT the
    // vertex (distance ≤ radius ≈ 0.1 ft).
    expect(minDistToV1).toBeGreaterThan(0.1); // retracted
  });

  it('retraction is clamped when segment is shorter than 2× socket depth', () => {
    // Segment = 0.05 ft (very short), socket depth for 2" Sch 40 =
    // 0.125 ft. Both ends want to retract by 0.125 but clamping caps
    // each at segLen/2 = 0.025. That leaves segLen - 2×0.025 = 0 ft.
    // The guard `segLen - startPullback - endPullback < 0.01` skips
    // this degenerate segment entirely — no crash, no inside-out
    // geometry.
    const r = bundle('pvc_sch40', [[0, 0, 0], [10, 0, 0], [10.05, 0, 0], [10.05, 0, 10]]);
    expect(r).not.toBeNull();
    // The middle super-short segment gets skipped; result is still
    // valid geometry (just with a visual gap at the pinch point,
    // which is acceptable degenerate handling).
    const vCount = r!.main.getAttribute('position').count;
    expect(vCount).toBeGreaterThan(0);
  });

  it('flexible PEX is NOT retracted (smooth curve, no fittings at bends)', () => {
    // Retraction only makes sense for rigid pipes where discrete fittings
    // fill the vertex angular void. PEX bends smoothly and there's no
    // fitting at a continuous curve vertex. Direct assertion: flexible
    // branch doesn't go through the retraction loop at all.
    const r = bundle('pex', [[0, 0, 0], [10, 0, 0], [10, 0, 10]]);
    expect(r!.isRigid).toBe(false);
    // Catmull-Rom tension-0.4 slightly under/overshoots control points
    // — that's expected smoothing behavior, not retraction. The
    // important invariant is just that isRigid = false so consumers
    // know which rendering path produced the geometry.
  });
});

// ── Phase 14.AD.7/21 — Endpoint retraction (numeric hints) ───

describe('buildPipeGeometry — endpoint retraction via retractStartFt/retractEndFt', () => {
  // Retraction amount for a 2" PVC Sch 40 coupling-style junction:
  // socket depth only = 1.5" = 0.125 ft.
  const SOCKET_DEPTH_FT = 0.125;
  // Retraction amount for a 2" PVC Sch 40 90°-elbow endpoint:
  // socketDepth + short-sweep bendR (1.5 × OD) ≈ 0.125 + 0.297 ≈ 0.422.
  const ELBOW_RETRACT_FT = 0.422;

  function bundleWithAmounts(
    points: [number, number, number][],
    retractStartFt: number,
    retractEndFt: number,
  ) {
    return buildPipeGeometry({
      points,
      diameter: 2,
      material: 'pvc_sch40',
      retractStartFt,
      retractEndFt,
    });
  }

  it('default (zeros) — endpoints keep full extent', () => {
    const r = bundleWithAmounts([[0, 0, 0], [10, 0, 0]], 0, 0);
    r!.main.computeBoundingBox();
    const box = r!.main.boundingBox!;
    expect(box.min.x).toBeLessThan(0.01);
    expect(box.max.x).toBeGreaterThan(9.99);
  });

  it('retractStartFt=socketDepth: start pulled back by socket depth', () => {
    const r = bundleWithAmounts([[0, 0, 0], [10, 0, 0]], SOCKET_DEPTH_FT, 0);
    r!.main.computeBoundingBox();
    const box = r!.main.boundingBox!;
    expect(box.min.x).toBeGreaterThan(0.1);
    expect(box.max.x).toBeGreaterThan(9.99);
  });

  it('retractEndFt=socketDepth: end pulled back by socket depth', () => {
    const r = bundleWithAmounts([[0, 0, 0], [10, 0, 0]], 0, SOCKET_DEPTH_FT);
    r!.main.computeBoundingBox();
    const box = r!.main.boundingBox!;
    expect(box.min.x).toBeLessThan(0.01);
    expect(box.max.x).toBeLessThan(9.95);
  });

  it('both endpoints: pipe shortened at both sides', () => {
    const r = bundleWithAmounts([[0, 0, 0], [10, 0, 0]], SOCKET_DEPTH_FT, SOCKET_DEPTH_FT);
    r!.main.computeBoundingBox();
    const box = r!.main.boundingBox!;
    expect(box.min.x).toBeGreaterThan(0.1);
    expect(box.max.x).toBeLessThan(9.95);
  });

  it('elbow-endpoint retraction (socketDepth + bendR) pulls further than socketDepth alone', () => {
    const couplingR = bundleWithAmounts([[0, 0, 0], [10, 0, 0]], SOCKET_DEPTH_FT, 0);
    const elbowR = bundleWithAmounts([[0, 0, 0], [10, 0, 0]], ELBOW_RETRACT_FT, 0);
    couplingR!.main.computeBoundingBox();
    elbowR!.main.computeBoundingBox();
    const cBox = couplingR!.main.boundingBox!;
    const eBox = elbowR!.main.boundingBox!;
    // Elbow retract is larger than coupling retract → start further east.
    expect(eBox.min.x).toBeGreaterThan(cBox.min.x);
  });

  it('AD.6 internal-vertex retraction still happens regardless of hints', () => {
    // 3-point pipe, zero endpoint hints — internal vertex still retracts
    // adjacent segments.
    const r = bundleWithAmounts([[0, 0, 0], [10, 0, 0], [10, 0, 10]], 0, 0);
    const pos = r!.main.getAttribute('position');
    const V1 = new THREE.Vector3(10, 0, 0);
    let minDistToV1 = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const d = v.distanceTo(V1);
      if (d < minDistToV1) minDistToV1 = d;
    }
    expect(minDistToV1).toBeGreaterThan(0.1);
  });

  it('flexible PEX ignores the hints', () => {
    const r = buildPipeGeometry({
      points: [[0, 0, 0], [10, 0, 0]],
      diameter: 2,
      material: 'pex',
      retractStartFt: 0.5,
      retractEndFt: 0.5,
    });
    expect(r!.isRigid).toBe(false);
    r!.main.computeBoundingBox();
    const box = r!.main.boundingBox!;
    expect(box.max.x - box.min.x).toBeGreaterThan(9);
  });
});
