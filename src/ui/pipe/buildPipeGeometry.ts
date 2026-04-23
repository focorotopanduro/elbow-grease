/**
 * buildPipeGeometry — Phase 14.AD.4
 *
 * Pure geometry-construction helper for `FullPipe` (the 3D-quality
 * pipe renderer). Extracted from the component body so the
 * rigid-vs-flexible rendering rules are testable in isolation.
 *
 * Rules encoded here:
 *
 *   • Flexible materials (PEX and its variants) render as a SINGLE
 *     `TubeGeometry` sampled along a Catmull-Rom spline. Frenet-
 *     frame orientation produces smooth continuous curves at
 *     vertices — which is what real Uponor PEX tubing looks like in
 *     the field when it routes around a joist with a gentle radius.
 *
 *   • Rigid materials (PVC, CPVC, ABS, copper, cast iron,
 *     galvanized, ductile iron) render as ONE `TubeGeometry` PER
 *     SEGMENT, with the per-segment buffers merged into one
 *     `BufferGeometry` for draw-call efficiency. Each segment is a
 *     straight cylinder; vertices produce crisp angular corners
 *     rather than Frenet-smoothed curves. The bend fitting emitted
 *     by `generateBendFittings` at the junction fills the angular
 *     void between adjacent segments.
 *
 * The prior implementation wrapped a `CurvePath<LineCurve3[]>` in
 * a single `TubeGeometry`. TubeGeometry's Frenet-frame orientation
 * smooths its cross-section normals continuously along the curve,
 * which at a sharp PVC vertex produced a visibly curved tube plus
 * a detached elbow-fitting sitting awkwardly on top of it — the
 * "2 weird fittings" bug.
 */

import * as THREE from 'three';
import { isFlexibleMaterial, getOuterRadiusFt } from '@core/pipe/PipeSizeSpec';
import { getSocketDepthFt, getBendCenterlineRadiusFt } from '@core/pipe/PipeStandards';
import type { PipeMaterial } from '../../engine/graph/GraphEdge';
import { mergeGeometries } from './perf/GeometryBatcher';

/**
 * Phase 14.AD.19 — how much pipe needs to retract at a bend vertex
 * so its visible end lines up with the elbow's hub mouth.
 *
 * The elbow fitting (`FittingGenerator.bendFittingOffset`) is now
 * placed at the BEND CENTER, offset from the polyline vertex by
 * `bendR / cos(angle/2)` into the interior of the L. That pushes
 * each hub mouth `bendR` further along the pipe axis than the
 * corner itself. For the pipe's visible end to meet the hub mouth,
 * the pipe must retract by `socketDepth + bendR`.
 *
 * Caller passes the two unit-length segment directions meeting at
 * the vertex. Returns 0 for non-bending vertices (straight runs,
 * which don't get an elbow emitter and so don't need the extra
 * retraction).
 */
function bendRadiusAtVertex(
  material: PipeMaterial,
  pipeOdFt: number,
  prevDir: THREE.Vector3,
  nextDir: THREE.Vector3,
): number {
  const cosAngle = Math.max(-1, Math.min(1, prevDir.dot(nextDir)));
  const angleDeg = Math.acos(cosAngle) * 180 / Math.PI;
  if (angleDeg < 5) return 0; // straight run, no fitting emitted
  let bendKind: 'sixteenth' | 'eighth' | 'short_sweep';
  if (angleDeg < 30) bendKind = 'sixteenth';
  else if (angleDeg < 67.5) bendKind = 'eighth';
  else bendKind = 'short_sweep';
  return getBendCenterlineRadiusFt(material, pipeOdFt, bendKind);
}

/**
 * Phase 14.AD.29 — disc cap for a free pipe end.
 *
 * Without this, `TubeGeometry(curve, segs, radius, radialSegs,
 * closed=false)` produces an OPEN-ENDED cylinder: the cross-section
 * is a hole straight through the pipe. Fine when a fitting hub
 * sleeves over the end, but a pipe with no fitting at its
 * termination (a stubbed-out riser, an unconnected run-end) reads
 * as "cut off" because the camera sees into the tube.
 *
 * This function returns a CircleGeometry oriented so its face
 * normal aligns with the outward pipe-axis direction at the end,
 * positioned at `endPoint` (the pipe's visible tip after any
 * retraction). Merging this disc into the main geometry closes
 * the open end.
 *
 * Caller determines whether an end is free by checking
 * `retractStartFt === 0` / `retractEndFt === 0` — a zero retraction
 * means no fitting is expected there, so the cap should render.
 */
function buildEndCap(
  endPoint: THREE.Vector3,
  adjacentPoint: THREE.Vector3,
  radius: number,
): THREE.BufferGeometry {
  const outward = new THREE.Vector3().subVectors(endPoint, adjacentPoint);
  if (outward.lengthSq() < 1e-8) {
    return new THREE.CircleGeometry(radius, 16);
  }
  outward.normalize();
  // CircleGeometry faces +Z by default. Rotate so its normal aligns
  // with the outward pipe-axis direction at this end.
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    outward,
  );
  const circle = new THREE.CircleGeometry(radius, 16);
  const m = new THREE.Matrix4().compose(endPoint, q, new THREE.Vector3(1, 1, 1));
  circle.applyMatrix4(m);
  return circle;
}

export interface PipeGeometryBundle {
  main: THREE.BufferGeometry;
  wall: THREE.BufferGeometry;
  radius: number;
  /**
   * Diagnostic flag — `true` when the output was built via the
   * per-segment rigid path, `false` for the Catmull-Rom flexible
   * path. Regression-guard tests assert this to pin the routing
   * for each material class.
   */
  isRigid: boolean;
}

export interface BuildPipeGeometryInput {
  points: readonly [number, number, number][];
  diameter: number;
  material: PipeMaterial;
  /**
   * Phase 14.AD.21 — per-endpoint retraction amounts IN FEET. The
   * caller (PipeRenderer.junctionMap, or the fast-mode renderer
   * via JunctionHints) decides how far each endpoint retracts
   * based on the specific fitting landing there:
   *
   *   • Coupling (inline < 5° junction)        → socketDepth
   *   • Reducer (2-pipe, mismatched diameters) → socketDepth
   *   • Tee / wye / cross (3+ pipe junction)   → socketDepth
   *   • Bushing outlet                         → socketDepth
   *   • 2-pipe elbow at endpoint               → socketDepth + bendR
   *   • Mid-pipe branch (AD.20, this pipe is   → socketDepth + bendR
   *     the branch entering a main pipe's tee)
   *   • No junction (free end)                 → 0
   *
   * Previously these were boolean flags and buildPipeGeometry
   * applied a fixed `socketDepth + bendR_short_sweep` whenever the
   * flag was true. That over-retracted for non-elbow junctions
   * (couplings, tees) and left a visible gap between the pipe end
   * and the fitting hub mouth. User-facing symptom: "some of the
   * pipes end before the fitting, so they don't look completed."
   */
  retractStartFt?: number;
  retractEndFt?: number;
}

/**
 * Produce the main + wall-shell tube buffers for a committed pipe.
 * Returns `null` on degenerate input (<2 points) so the caller can
 * skip rendering.
 */
export function buildPipeGeometry(
  pipe: BuildPipeGeometryInput,
): PipeGeometryBundle | null {
  if (pipe.points.length < 2) return null;

  const vecs = pipe.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const radius = getOuterRadiusFt(pipe.material, pipe.diameter);
  const flexible = isFlexibleMaterial(pipe.material);

  if (flexible) {
    // Silky-smooth PEX: single TubeGeometry along a Catmull-Rom
    // curve. Frenet frame produces the gentle rounded bends.
    const curve = new THREE.CatmullRomCurve3(vecs, false, 'catmullrom', 0.4);
    const segs = Math.max(32, pipe.points.length * 24);
    const tube = new THREE.TubeGeometry(curve, segs, radius, 20, false);
    const wall = new THREE.TubeGeometry(curve, segs, radius * 1.08, 20, false);
    // Phase 14.AD.29 — cap free ends on PEX too. Uses the curve's
    // tangent at the endpoint for orientation (captures the curve's
    // actual direction, not the naive polyline segment).
    const caps: THREE.BufferGeometry[] = [];
    if ((pipe.retractStartFt ?? 0) < 1e-4) {
      const p0 = vecs[0]!;
      const p1 = vecs[1]!;
      caps.push(buildEndCap(p0, p1, radius));
    }
    if ((pipe.retractEndFt ?? 0) < 1e-4) {
      const pLast = vecs[vecs.length - 1]!;
      const pPrev = vecs[vecs.length - 2]!;
      caps.push(buildEndCap(pLast, pPrev, radius));
    }
    const mergedMain = caps.length > 0 ? mergeGeometries([tube, ...caps]) : tube;
    for (const c of caps) c.dispose();
    return {
      main: mergedMain,
      wall,
      radius,
      isRigid: false,
    };
  }

  // Rigid: one TubeGeometry per segment, merged into a single
  // BufferGeometry. Straight cylinders meeting at sharp corners.
  //
  // Phase 14.AD.6 — RETRACT at internal bend vertices. Real PVC
  // plumbing: the pipe terminates at the fitting's socket depth
  // from the vertex, and the elbow fitting's hub shoulder covers
  // the last `socketDepth` of each pipe visually. Without this
  // retraction the pipe geometry overlaps the fitting's hub
  // (pipe ends at vertex, fitting hub also extends to vertex), so
  // the fitting looks "buried" or the pipe looks over-long. With
  // retraction, the pipe stops short of the vertex and the fitting
  // hub fills the angular void + the straight stub out to where the
  // pipe starts.
  //
  // Retraction rules:
  //   - First segment: end at (V1 - socketDepth × dir01). Start is
  //     unchanged (the pipe's true start — no fitting expected unless
  //     it's a junction, which this module doesn't know about).
  //   - Middle segment i (between vertex V_i and V_{i+1}): both ends
  //     retract toward the vertex by socketDepth.
  //   - Last segment: start at (V_{last-1} + socketDepth × dir). End
  //     is unchanged.
  //
  // If socketDepth exceeds half the segment length (a very short
  // segment between two bends), we clamp retraction to that half so
  // the segment doesn't flip inside-out.
  const socketDepth = getSocketDepthFt(pipe.material, pipe.diameter);
  // Phase 14.AD.19/21 — bend-radius lookup needs pipe OD in feet.
  // getOuterRadiusFt returns half the OD, so multiply by 2.
  const pipeOdFt = getOuterRadiusFt(pipe.material, pipe.diameter) * 2;
  const lastIdx = vecs.length - 1;
  // Pre-compute segment direction for each segment once so we can
  // reuse them for per-vertex bend radius lookups.
  const segDirs: THREE.Vector3[] = [];
  for (let i = 1; i < vecs.length; i++) {
    const d = new THREE.Vector3().subVectors(vecs[i]!, vecs[i - 1]!);
    if (d.lengthSq() > 1e-8) d.normalize();
    segDirs.push(d);
  }
  const mainSegs: THREE.TubeGeometry[] = [];
  const wallSegs: THREE.TubeGeometry[] = [];
  for (let i = 1; i < vecs.length; i++) {
    const rawStart = vecs[i - 1]!;
    const rawEnd = vecs[i]!;
    const segLen = rawStart.distanceTo(rawEnd);
    if (segLen <= 0.0001) continue; // skip degenerate

    // Phase 14.AD.19/21 — retraction math:
    //
    // - Internal vertex (start of segment i>1, or end of segment
    //   i<lastIdx): the fitting at the vertex is ALWAYS a bend
    //   (generateBendFittings always emits one), and its position
    //   is offset by bendR/cos(angle/2) from the vertex. Pipe must
    //   retract by socketDepth + bendR(actual angle) to land at the
    //   hub mouth.
    // - First-segment start / last-segment end: use the CALLER-
    //   PROVIDED `retractStartFt` / `retractEndFt`. Caller
    //   (PipeRenderer.junctionMap) classifies the specific fitting
    //   at each endpoint and passes the exact retraction distance
    //   — elbow endpoints get socketDepth+bendR, couplings /
    //   tees / reducers / bushings get just socketDepth, free
    //   ends get 0.
    const internalStartPullback = i === 1
      ? (pipe.retractStartFt ?? 0)
      : socketDepth + bendRadiusAtVertex(pipe.material, pipeOdFt, segDirs[i - 2]!, segDirs[i - 1]!);
    const internalEndPullback = i === lastIdx
      ? (pipe.retractEndFt ?? 0)
      : socketDepth + bendRadiusAtVertex(pipe.material, pipeOdFt, segDirs[i - 1]!, segDirs[i]!);
    let startPullback = Math.min(internalStartPullback, segLen / 2);
    let endPullback = Math.min(internalEndPullback, segLen / 2);
    // Bug-fix (user report "half the pipe is rendered"): the old
    // behavior SKIPPED any segment whose combined pullback ≥ segLen,
    // which made short middle / endpoint segments vanish entirely
    // (grid snap is 1"; a 1" segment with 1.5" socket depth on each
    // end collapses to negative length). Instead: if the two pullbacks
    // would consume too much of the segment, scale them down
    // proportionally so at least `MIN_VISIBLE_FT` of the segment
    // survives. Fitting hubs then merely overlap the body by a hair
    // rather than leaving the body missing altogether.
    const MIN_VISIBLE_FT = 0.02;
    const maxPull = Math.max(0, segLen - MIN_VISIBLE_FT);
    const requested = startPullback + endPullback;
    if (requested > maxPull && requested > 0) {
      const scale = maxPull / requested;
      startPullback *= scale;
      endPullback *= scale;
    }
    if (segLen - startPullback - endPullback < 0.005) continue;

    const dir = new THREE.Vector3().subVectors(rawEnd, rawStart).normalize();
    const trimmedStart = rawStart.clone().addScaledVector(dir, startPullback);
    const trimmedEnd = rawEnd.clone().addScaledVector(dir, -endPullback);

    const c = new THREE.LineCurve3(trimmedStart, trimmedEnd);
    mainSegs.push(new THREE.TubeGeometry(c, 1, radius, 12, false));
    wallSegs.push(new THREE.TubeGeometry(c, 1, radius * 1.08, 12, false));
  }

  // Phase 14.AD.29 — end caps on free (non-junction) pipe ends.
  // When retraction is 0 no fitting is expected there, so the open
  // tube cross-section would be visible. Close it with a disc.
  //
  // We use the FIRST and LAST rendered segment's direction to
  // orient the cap outward. For retracted ends (fitting expected)
  // we skip — the fitting's hub geometry covers the pipe's true
  // end, the TubeGeometry's open end is inside the hub sleeve.
  const endCaps: THREE.BufferGeometry[] = [];
  const startFree = (pipe.retractStartFt ?? 0) < 1e-4;
  const endFree = (pipe.retractEndFt ?? 0) < 1e-4;
  if (startFree && vecs.length >= 2) {
    const p0 = vecs[0]!;
    const p1 = vecs[1]!;
    // Outward direction = from adjacent point toward the end. For the
    // pipe START, that's from points[1] toward points[0].
    endCaps.push(buildEndCap(p0, p1, radius));
  }
  if (endFree && vecs.length >= 2) {
    const pLast = vecs[vecs.length - 1]!;
    const pPrev = vecs[vecs.length - 2]!;
    endCaps.push(buildEndCap(pLast, pPrev, radius));
  }

  const mergedMain = mergeGeometries([...mainSegs, ...endCaps]);
  const mergedWall = mergeGeometries(wallSegs);
  for (const g of mainSegs) g.dispose();
  for (const g of wallSegs) g.dispose();
  for (const g of endCaps) g.dispose();
  return {
    main: mergedMain,
    wall: mergedWall,
    radius,
    isRigid: true,
  };
}
