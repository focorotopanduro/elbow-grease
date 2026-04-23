/**
 * FittingGenerator — analyzes the committed pipe network and emits a
 * list of fittings to render + price.
 *
 * Rules enforced:
 *
 *   1. **Rigid pipe (PVC, Cast Iron, Copper, CPVC, ABS, Galvanized):**
 *      Every direction change between consecutive segments gets a
 *      bend fitting. The bend angle is snapped to a legal fitting
 *      (22.5° / 45° / 90°). Bends that don't fit any legal angle are
 *      tagged `illegal` for the diagnostics panel but still rendered.
 *
 *   2. **Flexible pipe (PEX):**
 *      Bends produce NO fittings — PEX-A bends to 6× OD cold without
 *      an elbow. Only branches (tees, manifolds) and end joints
 *      (couplings, reducers) are generated.
 *
 *   3. **Branches** (multiple pipes meeting at a common point):
 *      Chooses an appropriate branch fitting based on material + the
 *      measured branch angle:
 *        - DWV rigid + 90° branch → sanitary_tee
 *        - DWV rigid + 45° branch → wye
 *        - DWV rigid + other     → combo_wye_eighth
 *        - Supply rigid          → tee
 *        - PEX                   → tee (elbow-based branching not used)
 *
 *   4. **Reducers** where two pipes of different diameters meet.
 *
 *   5. **Long-sweep 1/4 bends** are preferred for DWV horizontal →
 *      vertical transitions (Y-axis delta > 0.5 ft across the bend).
 *
 * Each emitted FittingInstance carries enough info (type, size,
 * material) for FittingMeshes to render the correct 3D shape AND for
 * PhaseBOMPanel to price it using FittingCatalog.
 */

import * as THREE from 'three';
import type { Vec3 } from '@core/events';
import type { CommittedPipe } from '@store/pipeStore';
import type { FittingType, PipeMaterial } from '../../engine/graph/GraphEdge';
import {
  classifyBendAngle,
  defaultTeeFor,
  requiresBendFittings,
} from '@core/pipe/FittingCatalog';
import { isFlexibleMaterial, getOuterDiameterFt } from '@core/pipe/PipeSizeSpec';
import { getBendCenterlineRadiusFt } from '@core/pipe/PipeStandards';
import { JUNCTION_TOLERANCE_FT } from '@core/pipe/junctionConstants';
import {
  classifyBend,
  FITTING_90_TOLERANCE_DEG,
  SHARP_BEND_DEFLECTION_DEG,
  SMOOTH_CURVE_THRESHOLD_DEG,
} from '@core/pipe/PexBendClassifier';
import { validateArcRadii } from '@core/pipe/arcRadiusValidator';
// Phase 7.B.ii — detect merged PEX vertices so fittings at smooth bends
// don't render (the merged tube already provides continuous geometry).
import { mergePexRuns, mergedVertexKey } from '@core/pipe/mergePexRuns';

// ── Fitting instance ────────────────────────────────────────────

export interface FittingInstance {
  id: string;
  type: FittingType;
  position: Vec3;
  /** Quaternion as [x, y, z, w]. */
  quaternion: [number, number, number, number];
  /** Pipe diameter at this fitting (inches). */
  diameter: number;
  /** Second diameter if this is a reducer. */
  diameter2?: number;
  /** Material at this fitting (drives visual + price). */
  material: PipeMaterial;
  /** Which pipe this fitting belongs to. */
  pipeId: string;
  /** True if the bend angle couldn't snap to a legal detent — render as a warning. */
  illegalAngle?: boolean;
  /** Original measured bend angle (degrees), only set for bend fittings. */
  measuredAngleDeg?: number;
}

// ── Vector helpers ──────────────────────────────────────────────

function toV3(p: Vec3): THREE.Vector3 {
  return new THREE.Vector3(p[0], p[1], p[2]);
}

function angleBetween(a: THREE.Vector3, b: THREE.Vector3): number {
  const dot = a.dot(b);
  const cross = new THREE.Vector3().crossVectors(a, b);
  return Math.atan2(cross.length(), dot);
}

function directionVector(from: Vec3, to: Vec3): THREE.Vector3 {
  return toV3(to).sub(toV3(from)).normalize();
}

/**
 * Phase 14.AD.19 — elbow rotation basis, CORRECT.
 *
 * The elbow geometry (`buildMathBend` in FittingMeshes.tsx) is
 * built in the local XY plane with its torus arc from θ=-φ/2 to
 * θ=+φ/2 after a rotateZ(-φ/2) centering step. This means, in the
 * elbow's LOCAL frame:
 *   • The two hub tangent vectors (the PIPE directions going INTO
 *     and OUT of the elbow) are `(sin(φ/2), cos(φ/2), 0)` and
 *     `(-sin(φ/2), cos(φ/2), 0)` respectively. Their SUM (bisector
 *     of the two pipe directions) is `(0, 2cos(φ/2), 0)`, i.e.
 *     along local +Y. Their DIFFERENCE (antibisector) is
 *     `(2sin(φ/2), 0, 0)`, i.e. along local +X.
 *   • The torus rotation axis (bend plane normal) is local +Z.
 *
 * So the correct world → local mapping is:
 *   • local +X → world antiBisector = (dirIn − dirOut)/|…|
 *   • local +Y → world bisector    = (dirIn + dirOut)/|…|
 *   • local +Z → world planeNormal = (dirIn × dirOut)/|…|
 *
 * The BROKEN original code used `makeBasis(right, planeNormal,
 * bisector)` which put local +Y along planeNormal (perpendicular to
 * the bend plane) and local +Z along bisector — 90° off in a way
 * that spun the elbow OUT of the bend plane entirely. User-facing
 * symptom: the quarter-torus floats sideways, not tangent to either
 * pipe. See the 2026-04-20 bug report screenshot.
 *
 * The `right` variable (= bisector × planeNormal) happens to equal
 * the antiBisector (verified by hand: for dirIn=+X, dirOut=+Y,
 * right = (0.707, 0.707, 0) × (0, 0, 1) = (0.707, −0.707, 0) =
 * antiBisector). So the minimal fix is swapping columns 2 and 3.
 */
function bendQuaternion(
  dirIn: THREE.Vector3,
  dirOut: THREE.Vector3,
): [number, number, number, number] {
  const bisector = new THREE.Vector3().addVectors(dirIn, dirOut).normalize();
  const planeNormal = new THREE.Vector3().crossVectors(dirIn, dirOut).normalize();
  if (planeNormal.length() < 0.001) return [0, 0, 0, 1];
  const antiBisector = new THREE.Vector3().crossVectors(bisector, planeNormal).normalize();
  const mat = new THREE.Matrix4().makeBasis(antiBisector, bisector, planeNormal);
  const quat = new THREE.Quaternion().setFromRotationMatrix(mat);
  return [quat.x, quat.y, quat.z, quat.w];
}

/**
 * Phase 14.AD.19 — elbow position offset, CORRECT.
 *
 * The elbow geometry's LOCAL ORIGIN is the BEND CENTER of the arc
 * (the center of curvature, which lies INSIDE the bend). The pipe
 * corner ptB is the KINK point where the two pipe centerlines
 * geometrically intersect — OUTSIDE the bend center by
 *     kinkOffset = bendR / cos(angle/2)
 * in the direction of `-inPlane` (where inPlane = planeNormal ×
 * bisector points FROM the corner INTO the bend).
 *
 * Equivalently: bend center = ptB + inPlane · (bendR / cos(angle/2)).
 * Placing the elbow's origin at this offset position makes the two
 * tangent pipe lines extending from the hub mouths meet exactly at
 * ptB (the user-drawn corner), producing the visual "pipes meet at
 * the corner, elbow fills the bend" a contractor expects.
 *
 * For a 90° bend (angle=π/2): kinkOffset = bendR · √2. For a 45°
 * bend: kinkOffset ≈ 1.082 · bendR.
 *
 * Returns the world-space DELTA to add to ptB.
 */
function bendFittingOffset(
  dirIn: THREE.Vector3,
  dirOut: THREE.Vector3,
  bendRadiusFt: number,
): THREE.Vector3 {
  const bisector = new THREE.Vector3().addVectors(dirIn, dirOut);
  const bisectorLen = bisector.length();
  if (bisectorLen < 1e-6) return new THREE.Vector3(0, 0, 0);
  bisector.multiplyScalar(1 / bisectorLen);
  // |dirIn+dirOut| = 2·cos(angle/2) when dirIn, dirOut are unit
  // vectors (from law-of-cosines). So cos(angle/2) = bisectorLen/2.
  const cosHalf = bisectorLen / 2;
  if (cosHalf < 1e-3) return new THREE.Vector3(0, 0, 0);
  const planeNormal = new THREE.Vector3().crossVectors(dirIn, dirOut);
  if (planeNormal.lengthSq() < 1e-6) return new THREE.Vector3(0, 0, 0);
  planeNormal.normalize();
  const inPlane = new THREE.Vector3().crossVectors(planeNormal, bisector).normalize();
  const kinkOffset = bendRadiusFt / cosHalf;
  return inPlane.multiplyScalar(kinkOffset);
}

/**
 * Phase 14.AD.19 — bend radius lookup for a given fitting type.
 *
 * Returns the centerline bend radius (in feet) for the fitting
 * specified by `type` on a pipe of (material, diameter). Non-bend
 * types return 0.
 *
 * Used by the emitters to compute the correct world-space position
 * offset that places the elbow's bend center at the right point
 * (kink point lies at the pipe corner, so the two tangent pipe
 * lines from the elbow's hub outlets meet exactly at ptB).
 */
function bendRadiusForFittingType(
  material: PipeMaterial,
  diameter: number,
  type: FittingType,
): number {
  const pipeOdFt = getOuterDiameterFt(material, diameter);
  switch (type) {
    case 'bend_22_5':
      return getBendCenterlineRadiusFt(material, pipeOdFt, 'sixteenth');
    case 'bend_45':
    case 'elbow_45':
      return getBendCenterlineRadiusFt(material, pipeOdFt, 'eighth');
    case 'bend_90':
    case 'elbow_90':
      return getBendCenterlineRadiusFt(material, pipeOdFt, 'short_sweep');
    case 'bend_90_ls':
      return getBendCenterlineRadiusFt(material, pipeOdFt, 'long_sweep');
    case 'pex_elbow_90':
      // ProPEX 90° elbow — tighter radius than short-sweep rigid.
      // `buildPexElbow90` uses `pipeOdFt * 1.5` explicitly.
      return pipeOdFt * 1.5;
    default:
      return 0;
  }
}

/**
 * Phase 14.AD.11 — axis-alignment quaternion for straight fittings
 * whose local body axis is +X (couplings, caps, bushings). Aligns
 * the local +X direction with `pipeDir`. When the pipe direction is
 * already +X, returns identity. Handles the antiparallel (pipeDir
 * = -X) case which `setFromUnitVectors` sometimes produces a weird
 * 180° rotation for: pick an arbitrary perpendicular axis (+Y) for
 * the rotation plane.
 */
function alignAxisToPipe(
  pipeDir: THREE.Vector3,
): [number, number, number, number] {
  // Phase 14.AD.30 — zero-length guard. `setFromUnitVectors` with a
  // zero-length target produces NaN quaternion components, which
  // cascade into invalid `position` matrices on THREE.Object3D and
  // cause the entire fitting to render at (NaN, NaN, NaN). Silently
  // falls back to identity for degenerate input.
  if (pipeDir.lengthSq() < 1e-8) return [0, 0, 0, 1];
  const target = pipeDir.clone().normalize();
  const fromAxis = new THREE.Vector3(1, 0, 0);
  // Antiparallel guard: setFromUnitVectors on (x, -x) produces a
  // 180° rotation around an arbitrary axis which may flip the body
  // unpredictably. Force a clean 180° around +Y for that case.
  if (target.dot(fromAxis) < -0.9999) {
    return [0, 1, 0, 0];
  }
  const quat = new THREE.Quaternion().setFromUnitVectors(fromAxis, target);
  return [quat.x, quat.y, quat.z, quat.w];
}

/**
 * Phase 14.AD.24 — tee / wye / combo rotation basis, FIXED.
 *
 * The tee-family geometries (sanitary_tee, wye, combo_wye_eighth,
 * cross) are built in FittingMeshes.tsx with a consistent local
 * axis convention:
 *
 *   • Main body cylinder along LOCAL +X  (CylinderGeometry's default
 *                                         +Y axis → +X after
 *                                         `body.rotateZ(Math.PI / 2)`)
 *   • Branch along LOCAL +Y  (san-tee unrotated stub) or along
 *                             LOCAL (cos45°, sin45°, 0)  (wye /
 *                             combo's 45° arm — still lies in the
 *                             local XY plane)
 *   • Bend plane normal along LOCAL +Z
 *
 * The PREVIOUS basis `makeBasis(branchDir, up, mainDir)` was
 * inverted: it mapped local +X to world branchDir (so the TEE'S
 * MAIN CYLINDER was being rendered along the BRANCH direction)
 * and local +Z to world mainDir. User-facing symptom: the wye
 * visibly rotates onto a weird axis, main cylinder looks detached
 * from the through-pipe it's supposed to run along.
 *
 * The correct basis uses Gram-Schmidt to pull the perpendicular
 * component of `branchDir` out of `mainDir`, then builds:
 *
 *   • Local +X → world mainDir                     (tee's main aligns)
 *   • Local +Y → perp (⊥ mainDir, in bend plane)   (tee's 90° branch
 *                                                    aligns; wye's
 *                                                    45° branch hits
 *                                                    the right angle)
 *   • Local +Z → world up (= mainDir × perp)       (bend plane normal)
 *
 * For sanitary_tee (90° branch): perp = branchDir exactly.
 * For wye (45° branch): local (cos45°, sin45°, 0) = cos45°·mainDir +
 *   sin45°·perp, which by Gram-Schmidt equals world branchDir. ✓
 */
function teeQuaternion(
  mainDir: THREE.Vector3,
  branchDir: THREE.Vector3,
): [number, number, number, number] {
  const m = mainDir.clone().normalize();
  const b = branchDir.clone().normalize();
  // Component of branchDir perpendicular to mainDir (Gram-Schmidt).
  const dot = b.dot(m);
  const perp = b.clone().addScaledVector(m, -dot);
  if (perp.lengthSq() < 1e-6) return [0, 0, 0, 1]; // parallel pipes
  perp.normalize();
  const up = new THREE.Vector3().crossVectors(m, perp).normalize();
  const mat = new THREE.Matrix4().makeBasis(m, perp, up);
  const quat = new THREE.Quaternion().setFromRotationMatrix(mat);
  return [quat.x, quat.y, quat.z, quat.w];
}

// ── Bend fitting detection ──────────────────────────────────────

let fittingIdCounter = 0;
const newId = () => `fit-${(fittingIdCounter++).toString(36)}`;

/** System classification helper — DWV uses sanitary fittings. */
function isDWVSystem(pipe: CommittedPipe): boolean {
  return pipe.system === 'waste' || pipe.system === 'vent' || pipe.system === 'storm';
}

/**
 * Generate bend fittings for a single pipe.
 *
 * RIGID (PVC / cast iron / copper / cpvc / galv / ductile iron):
 *   every non-straight vertex becomes a fitting snapped to a legal
 *   angle (22.5° / 45° / 90°), or gets flagged `illegalAngle` for
 *   the compliance panel. Long-sweep 1/4 bends emitted for
 *   DWV horizontal → vertical transitions.
 *
 * FLEXIBLE (PEX / Uponor AquaPEX):
 *   We call `classifyBend` per vertex. The rule the user originally
 *   asked for (see PexBendClassifier docblock):
 *     • < 15° deflection       → no fitting; smooth continuation
 *     • ≈ 90° (±7°) deflection → emit a PEX 90° elbow — the user
 *                                 drew a right angle deliberately,
 *                                 so honor it with a ProPEX-style
 *                                 corner fitting
 *     • 15°–120° elsewhere     → no fitting; PEX bends physically
 *                                 (MergedPexRun renders the
 *                                 continuous tube through this vertex)
 *     • > 120° deflection      → emit a fitting with illegalAngle=true
 *                                 (kink territory, user must fix)
 *
 * Branch fittings (tees / crosses) are NOT this function's job —
 * they come out of `generateJunctionFittings`. PEX tees get the
 * plain `tee` type from `defaultTeeFor`.
 */
export function generateBendFittings(pipe: CommittedPipe): FittingInstance[] {
  const material = pipe.material as PipeMaterial;
  if (!requiresBendFittings(material)) {
    return generatePexBendFittings(pipe);
  }

  const fittings: FittingInstance[] = [];
  const pts = pipe.points;
  const isDWV = isDWVSystem(pipe);

  for (let i = 1; i < pts.length - 1; i++) {
    const dirIn = directionVector(pts[i - 1]!, pts[i]!);
    const dirOut = directionVector(pts[i]!, pts[i + 1]!);
    const angleRad = angleBetween(dirIn, dirOut);
    const angleDeg = (angleRad * 180) / Math.PI;

    // Phase 13.A audit: 5° is a deliberate noise-tolerance floor, NOT
    // a code threshold. Polyline vertices routinely carry 1–3° of
    // grid-snap / click-placement noise; emitting an elbow for each
    // would inflate the fitting count. Real plumbing bends are snapped
    // to 22.5° / 45° / 90° detents by classifyBendAngle below — so any
    // true bend is well above 5°. If you need the warning surface for
    // shallow bends, `illegalAngle: true` carries through the BOM.
    if (angleDeg < 5) continue;

    // Long-sweep hint: DWV + horizontal→vertical transition
    const verticalTurn = isDWV && (
      Math.abs(dirIn.y) < 0.3 && Math.abs(dirOut.y) > 0.7
    );

    const classified = classifyBendAngle(angleDeg, { sweepHint: verticalTurn });
    if (classified.kind === 'straight') continue;

    // For copper/galvanized, use the legacy elbow_* names instead of bend_*
    let type: FittingType = classified.fittingType ?? 'bend_90';
    if (
      (material === 'copper_type_l' || material === 'copper_type_m' ||
       material === 'galvanized_steel' || material === 'cpvc')
      && classified.kind === 'snapped'
    ) {
      if (type === 'bend_90' || type === 'bend_90_ls') type = 'elbow_90';
      if (type === 'bend_45') type = 'elbow_45';
      if (type === 'bend_22_5') type = 'elbow_45';
    }

    // Phase 14.AD.19 — offset the elbow from the vertex (ptB) to its
    // BEND CENTER so the two tangent pipe lines extending from the
    // elbow's hubs geometrically meet at ptB. Without this, the
    // elbow's arc sits OUTSIDE the corner (bend center AT ptB → arc
    // midpoint offset +antiBisector). With it, the arc curves
    // through the inside of the L as expected.
    const bendR = bendRadiusForFittingType(material, pipe.diameter, type);
    const offset = bendFittingOffset(dirIn, dirOut, bendR);
    const pos: Vec3 = [pts[i]![0] + offset.x, pts[i]![1] + offset.y, pts[i]![2] + offset.z];

    fittings.push({
      id: newId(),
      type,
      position: pos,
      quaternion: bendQuaternion(dirIn, dirOut),
      diameter: pipe.diameter,
      material,
      pipeId: pipe.id,
      illegalAngle: classified.kind === 'illegal',
      measuredAngleDeg: angleDeg,
    });
  }

  return fittings;
}

// ── PEX / Uponor bend classifier → fitting ────────────────────

/**
 * Phase 14.U — flexible-pipe bend fittings.
 *
 * Previous behavior: `generateBendFittings` short-circuited on
 * flexible materials and emitted zero fittings. That's wrong for
 * the user's original intent (PexBendClassifier docblock) which
 * says a PEX vertex drawn at ≈ 90° should get an elbow, because
 * the user deliberately aimed for a right angle and would use a
 * ProPEX elbow in the field.
 *
 * Contract per `classifyBend`:
 *   fitting_90   → emit bend_90 (ProPEX 90° elbow)
 *   smooth_bend  → no fitting (MergedPexRun handles the continuous tube)
 *   smooth_curve → no fitting (barely-curved, visually straight)
 *   sharp_bend   → emit bend_90 with illegalAngle=true (kink warning)
 */
function generatePexBendFittings(pipe: CommittedPipe): FittingInstance[] {
  const material = pipe.material as PipeMaterial;
  if (!isFlexibleMaterial(material)) return [];
  const fittings: FittingInstance[] = [];
  const pts = pipe.points;

  for (let i = 1; i < pts.length - 1; i++) {
    const dirIn = directionVector(pts[i - 1]!, pts[i]!);
    const dirOut = directionVector(pts[i]!, pts[i + 1]!);
    const classification = classifyBend(
      [dirIn.x, dirIn.y, dirIn.z],
      [dirOut.x, dirOut.y, dirOut.z],
      material,
    );

    // Suppress: smooth_curve (barely bent) + smooth_bend (mid-range
    // deflection where PEX physically flexes). The MergedPexRun
    // geometry already draws through these without a lump.
    if (classification.kind === 'smooth_curve') continue;
    if (classification.kind === 'smooth_bend') continue;

    // 90° PEX elbow — explicit right-angle the user aimed at.
    // Phase 14.V: emit the PEX-specific FittingType so the BOM
    // prices it as a ProPEX elbow (not a rigid 1/4-bend) and the
    // renderer picks up the distinctive collared geometry.
    if (classification.kind === 'fitting_90') {
      // Phase 14.AD.19 — bend-center offset for the ProPEX elbow too.
      const bendR = bendRadiusForFittingType(material, pipe.diameter, 'pex_elbow_90');
      const offset = bendFittingOffset(dirIn, dirOut, bendR);
      const pos: Vec3 = [pts[i]![0] + offset.x, pts[i]![1] + offset.y, pts[i]![2] + offset.z];
      fittings.push({
        id: newId(),
        type: 'pex_elbow_90',
        position: pos,
        quaternion: bendQuaternion(dirIn, dirOut),
        diameter: pipe.diameter,
        material,
        pipeId: pipe.id,
        measuredAngleDeg: classification.deflectionDeg,
      });
      continue;
    }

    // sharp_bend — past PEX minimum bend radius. Emit the ProPEX
    // elbow geometry (because the only way to field-resolve a kink
    // in a PEX run is to cut it and put a real elbow in), flagged
    // illegal so the compliance panel tells the user they need to
    // add the fitting or reroute.
    if (classification.kind === 'sharp_bend') {
      // Phase 14.AD.19 — same offset for the illegal-kink case so
      // the flagged elbow still renders geometrically where it
      // belongs, just with the illegalAngle flag for the panel.
      const bendR = bendRadiusForFittingType(material, pipe.diameter, 'pex_elbow_90');
      const offset = bendFittingOffset(dirIn, dirOut, bendR);
      const pos: Vec3 = [pts[i]![0] + offset.x, pts[i]![1] + offset.y, pts[i]![2] + offset.z];
      fittings.push({
        id: newId(),
        type: 'pex_elbow_90',
        position: pos,
        quaternion: bendQuaternion(dirIn, dirOut),
        diameter: pipe.diameter,
        material,
        pipeId: pipe.id,
        illegalAngle: true,
        measuredAngleDeg: classification.deflectionDeg,
      });
    }
  }

  // Phase 14.V — aggregate-arc check. Per-vertex classification
  // above uses DEFLECTION ANGLE alone, which can miss a cumulative
  // tight-radius arc: a 180° return drawn as 10 shorter segments
  // each at 18° passes every individual vertex check, but the
  // overall radius is sub-spec. `validateArcRadii` uses the leg-
  // length geometry (R ≈ halfLeg / tan(θ/2)) so it catches those
  // cases — and flags them as illegalAngle fittings for the
  // compliance panel, without emitting a duplicate elbow at a
  // vertex that already has one.
  const alreadyFlaggedVertices = new Set<number>();
  for (const f of fittings) {
    // Find which vertex each existing fitting sits on so we skip it below.
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]!;
      if (
        Math.abs(p[0] - f.position[0]) < 1e-6
        && Math.abs(p[1] - f.position[1]) < 1e-6
        && Math.abs(p[2] - f.position[2]) < 1e-6
      ) {
        alreadyFlaggedVertices.add(i);
        break;
      }
    }
  }
  const arcViolations = validateArcRadii(pts, material, pipe.diameter);
  for (const v of arcViolations) {
    if (alreadyFlaggedVertices.has(v.vertexIndex)) continue;
    const dirIn = directionVector(pts[v.vertexIndex - 1]!, pts[v.vertexIndex]!);
    const dirOut = directionVector(pts[v.vertexIndex]!, pts[v.vertexIndex + 1]!);
    // Phase 14.AD.19 — same bend-center offset for arc-violation PEX elbows.
    const bendR = bendRadiusForFittingType(material, pipe.diameter, 'pex_elbow_90');
    const offset = bendFittingOffset(dirIn, dirOut, bendR);
    const pos: Vec3 = [v.position[0] + offset.x, v.position[1] + offset.y, v.position[2] + offset.z];
    fittings.push({
      id: newId(),
      type: 'pex_elbow_90',
      position: pos,
      quaternion: bendQuaternion(dirIn, dirOut),
      diameter: pipe.diameter,
      material,
      pipeId: pipe.id,
      illegalAngle: true,
      measuredAngleDeg: v.deflectionDeg,
    });
  }

  return fittings;
}

// ── Junction detection ──────────────────────────────────────────

// Phase 14.AD.14 — single canonical source via junctionConstants.
const JUNCTION_TOLERANCE = JUNCTION_TOLERANCE_FT;

/**
 * Phase 13.A — count how many pipe ENDPOINTS sit within `tol` of `pos`.
 * Used to decide between a 2-way tee/reducer and a 4-way cross at a
 * shared junction. Mid-pipe waypoints don't count — only the start +
 * end of each pipe. A T-junction where one pipe ends on the side of
 * another reports 1 endpoint (the end), not 2.
 */
function countEndpointsNear(
  pos: Vec3,
  allPipes: readonly CommittedPipe[],
  tol: number,
): number {
  const tol2 = tol * tol;
  let n = 0;
  for (const p of allPipes) {
    const first = p.points[0];
    const last = p.points[p.points.length - 1];
    if (first) {
      const dx = first[0] - pos[0], dy = first[1] - pos[1], dz = first[2] - pos[2];
      if (dx * dx + dy * dy + dz * dz <= tol2) n++;
    }
    if (last && p.points.length > 1) {
      const dx = last[0] - pos[0], dy = last[1] - pos[1], dz = last[2] - pos[2];
      if (dx * dx + dy * dy + dz * dz <= tol2) n++;
    }
  }
  return n;
}

/**
 * Detect tee/wye/manifold-worthy junctions where pipes meet at shared
 * endpoints or mid-pipe points.
 *
 * @param suppressedVertices - Phase 7.B.ii: posKeys of vertices where
 *   two PEX pipes smooth-merge. Junction fittings at these positions
 *   are suppressed — the merged tube from `MergedPexRun` already
 *   provides continuous geometry there.
 */
export function generateJunctionFittings(
  allPipes: CommittedPipe[],
  suppressedVertices: Set<string>,
): FittingInstance[] {
  const fittings: FittingInstance[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < allPipes.length; i++) {
    const pipeA = allPipes[i]!;
    const endpointsA = [
      { pos: pipeA.points[0]!, isStart: true },
      { pos: pipeA.points[pipeA.points.length - 1]!, isStart: false },
    ];

    // Phase 14.AD.28 — was `j = i + 1` so each unordered pair was
    // iterated once. That missed the asymmetric case where pipeA's
    // interior VERTEX meets pipeB's ENDPOINT: the outer loop only
    // iterates pipeA's endpoints as `epA`, and with j > i the
    // reverse perspective (pipeB's endpoints vs pipeA's interior
    // vertex) never ran. Happens after a mid-pipe branch split
    // (AD.23 OrthoPipeInteraction): the main pipe now has a vertex
    // at the branch point, the branch pipe has an endpoint there,
    // but if the branch was added AFTER the main (typical), the
    // pair (main, branch) only checks main's endpoints.
    //
    // Fix: iterate every pair in both directions. The `processed`
    // position-key set dedupes so each junction still emits once.
    for (let j = 0; j < allPipes.length; j++) {
      if (j === i) continue;
      const pipeB = allPipes[j]!;

      for (const epA of endpointsA) {
        for (let k = 0; k < pipeB.points.length; k++) {
          const ptB = pipeB.points[k]!;
          const dx = epA.pos[0] - ptB[0];
          const dy = epA.pos[1] - ptB[1];
          const dz = epA.pos[2] - ptB[2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist > JUNCTION_TOLERANCE) continue;

          const posKey = `${Math.round(ptB[0] * 10)},${Math.round(ptB[1] * 10)},${Math.round(ptB[2] * 10)}`;
          if (processed.has(posKey)) continue;
          processed.add(posKey);

          // Phase 7.B.ii: suppress junction fittings at merged PEX
          // vertices. The MergedPexRun already draws a continuous tube
          // through this position — adding a coupling/tee here produces
          // a visible lump where the merge should be invisible.
          if (suppressedVertices.has(mergedVertexKey(ptB))) continue;

          // Directions at the junction
          const dirA = epA.isStart
            ? directionVector(pipeA.points[1]!, pipeA.points[0]!)
            : directionVector(
                pipeA.points[pipeA.points.length - 2]!,
                pipeA.points[pipeA.points.length - 1]!,
              );

          let dirB: THREE.Vector3;
          if (k === 0) {
            dirB = directionVector(pipeB.points[1]!, pipeB.points[0]!);
          } else if (k === pipeB.points.length - 1) {
            dirB = directionVector(pipeB.points[k - 1]!, pipeB.points[k]!);
          } else {
            dirB = directionVector(pipeB.points[k - 1]!, pipeB.points[k]!);
          }

          const branchAngleDeg = (angleBetween(dirA, dirB) * 180) / Math.PI;

          // Choose material that "owns" the fitting (larger-diameter wins)
          const bigger = pipeA.diameter >= pipeB.diameter ? pipeA : pipeB;
          const material = bigger.material as PipeMaterial;

          // Phase 13.A — 4-way cross detection. Count all pipe endpoints
          // within JUNCTION_TOLERANCE of this point. The prior code
          // emitted a single `tee` for any junction cluster regardless
          // of how many pipes actually met there, which under-counted
          // the fitting cost + complexity when 4 pipes truly meet at a
          // cross (common in supply manifolds, DWV stacks with 4
          // tributaries). A 4+ endpoint cluster emits one `cross`.
          const endpointCount = countEndpointsNear(ptB, allPipes, JUNCTION_TOLERANCE);
          const is4WayCross = endpointCount >= 4;

          // Reducer if diameters differ meaningfully (skipped for crosses
          // — a cross with mismatched diameters is vanishingly rare and
          // would need a reducing-cross which we don't currently model).
          //
          // Phase 14.AD.16 — also require endpointCount === 2. A 3+
          // endpoint junction with a mismatched-diameter (i,j) pair is
          // a TEE with a smaller branch, not a reducing coupling. The
          // pre-AD.16 condition fired the reducer branch here and
          // silently swallowed the tee + auto-emitted bushing.
          const isReducer = !is4WayCross &&
            endpointCount === 2 &&
            Math.abs(pipeA.diameter - pipeB.diameter) > 0.1;

          if (is4WayCross) {
            fittings.push({
              id: newId(),
              type: 'cross',
              position: ptB,
              quaternion: teeQuaternion(dirB, dirA),
              diameter: bigger.diameter,
              material,
              pipeId: pipeA.id,
            });
          } else if (isReducer) {
            fittings.push({
              id: newId(),
              type: 'reducer',
              position: ptB,
              quaternion: teeQuaternion(dirB, dirA),
              diameter: Math.max(pipeA.diameter, pipeB.diameter),
              diameter2: Math.min(pipeA.diameter, pipeB.diameter),
              material,
              pipeId: pipeA.id,
            });
          } else if (endpointCount === 2) {
            // Phase 14.AD.5 — TWO pipes meeting endpoint-to-endpoint
            // at an angle is an ELBOW, not a tee. A tee / wye / combo
            // requires a third pipe. Before this branch the code fell
            // through to `defaultTeeFor` which emitted tee /
            // sanitary_tee / combo_wye_eighth even for simple 2-pipe
            // bends — producing visually-broken geometry at the
            // junction (or nothing visible, when the teeQuaternion
            // rotation put the branch inside the pipe body). User-
            // facing symptom: "I drew a 45° PVC bend and no fitting
            // showed up."
            //
            // Junction code's dirA = travel direction INTO the vertex
            // from pipeA's side. dirB = pipeB's outward axis, which
            // equals the NEGATIVE of the travel direction leaving the
            // vertex into B. Negate it to get a proper `travelOut`
            // vector. The bend angle is then angleBetween(dirA, travelOut).
            const travelOut = dirB.clone().multiplyScalar(-1);
            const bendAngleRad = dirA.angleTo(travelOut);
            const bendAngleDeg = (bendAngleRad * 180) / Math.PI;

            if (bendAngleDeg < 5) {
              // Effectively inline — plain coupling.
              // Phase 14.AD.11 — align the coupling's local +X axis
              // with the pipe travel direction. Previously this used
              // `bendQuaternion(dirA, travelOut)` which falls through
              // to identity when the two vectors are parallel (zero
              // plane normal), leaving the coupling rendered along
              // world Y instead of the actual pipe axis.
              fittings.push({
                id: newId(),
                type: 'coupling',
                position: ptB,
                quaternion: alignAxisToPipe(dirA),
                diameter: bigger.diameter,
                material,
                pipeId: pipeA.id,
              });
            } else {
              const isDWV = isDWVSystem(bigger);
              const verticalTurn = isDWV && (
                Math.abs(dirA.y) < 0.3 && Math.abs(travelOut.y) > 0.7
              );
              const classified = classifyBendAngle(
                bendAngleDeg,
                { sweepHint: verticalTurn },
              );
              let type: FittingType = classified.fittingType ?? 'bend_90';
              // Copper / CPVC / galvanized use the legacy `elbow_*`
              // naming for snapped detents (catalog alignment).
              if (
                (material === 'copper_type_l' || material === 'copper_type_m' ||
                 material === 'galvanized_steel' || material === 'cpvc')
                && classified.kind === 'snapped'
              ) {
                if (type === 'bend_90' || type === 'bend_90_ls') type = 'elbow_90';
                if (type === 'bend_45') type = 'elbow_45';
                if (type === 'bend_22_5') type = 'elbow_45';
              }
              // Phase 14.AD.19 — bend-center offset for the 2-pipe
              // endpoint-junction elbow. Using `bigger.diameter`
              // because the tee/elbow selector already picked the
              // larger pipe's material/diameter for the fitting SKU.
              const bendR = bendRadiusForFittingType(material, bigger.diameter, type);
              const offset = bendFittingOffset(dirA, travelOut, bendR);
              const pos: Vec3 = [
                ptB[0] + offset.x,
                ptB[1] + offset.y,
                ptB[2] + offset.z,
              ];
              fittings.push({
                id: newId(),
                type,
                position: pos,
                quaternion: bendQuaternion(dirA, travelOut),
                diameter: bigger.diameter,
                material,
                pipeId: pipeA.id,
                illegalAngle: classified.kind === 'illegal',
                measuredAngleDeg: bendAngleDeg,
              });
            }
          } else {
            // 3+ endpoint cluster, not a 4-way: proper tee / wye / combo.
            // AD.22 — pass direction vectors so the classifier can
            // apply orientation-aware rules (san-tee for
            // horizontal→vertical, combo for vertical→horizontal or
            // horizontal-flat, wye for strict 45°-in-plane).
            const teeType = defaultTeeFor(
              material,
              branchAngleDeg,
              isDWVSystem(bigger),
              {
                mainDir: [dirB.x, dirB.y, dirB.z],
                branchDir: [dirA.x, dirA.y, dirA.z],
              },
            );
            fittings.push({
              id: newId(),
              type: teeType,
              position: ptB,
              quaternion: teeQuaternion(dirB, dirA),
              diameter: bigger.diameter,
              material,
              pipeId: pipeA.id,
            });

            // Phase 14.AD.16 — bushing auto-emitter. A real tee at a
            // multi-pipe junction is sized to its main run: every
            // outlet exits at `bigger.diameter`. If one of the pipes
            // at this junction is smaller, a real install steps down
            // with a reducing bushing (threaded hub + tapered spigot)
            // before the small pipe continues. Without this, the
            // renderer shows a large tee outlet abutting a thin pipe
            // with nothing bridging the diameter gap — visually
            // broken AND materially inaccurate (the bushing is a
            // separate SKU for BOM pricing).
            //
            // Scan all pipes terminating at ptB; for each one smaller
            // than `bigger.diameter` by the reducer threshold (0.1"
            // — matches the tee/reducer discrimination above), emit
            // a bushing offset one tee-port-length along that pipe's
            // outbound axis. Bushing's `diameter` = spigot/bigger,
            // `diameter2` = hub/smaller, `material` = shared material.
            const tol2 = JUNCTION_TOLERANCE * JUNCTION_TOLERANCE;
            const odBiggerFt = getOuterDiameterFt(material, bigger.diameter);
            const portOffsetFt = odBiggerFt * 1.4;
            for (const branchPipe of allPipes) {
              if (branchPipe.id === bigger.id) continue;
              if (branchPipe.material !== bigger.material) continue;
              if (branchPipe.diameter >= bigger.diameter - 0.1) continue;
              if (branchPipe.points.length < 2) continue;
              const first = branchPipe.points[0]!;
              const last = branchPipe.points[branchPipe.points.length - 1]!;
              let branchDir: THREE.Vector3 | null = null;
              const d2First =
                (first[0] - ptB[0]) ** 2 +
                (first[1] - ptB[1]) ** 2 +
                (first[2] - ptB[2]) ** 2;
              const d2Last =
                (last[0] - ptB[0]) ** 2 +
                (last[1] - ptB[1]) ** 2 +
                (last[2] - ptB[2]) ** 2;
              if (d2First <= tol2) {
                branchDir = directionVector(branchPipe.points[0]!, branchPipe.points[1]!);
              } else if (d2Last <= tol2) {
                branchDir = directionVector(
                  branchPipe.points[branchPipe.points.length - 1]!,
                  branchPipe.points[branchPipe.points.length - 2]!,
                );
              } else {
                continue; // pipe doesn't terminate at this junction
              }
              const pos: Vec3 = [
                ptB[0] + branchDir.x * portOffsetFt,
                ptB[1] + branchDir.y * portOffsetFt,
                ptB[2] + branchDir.z * portOffsetFt,
              ];
              fittings.push({
                id: newId(),
                type: 'bushing',
                position: pos,
                quaternion: alignAxisToPipe(branchDir),
                diameter: bigger.diameter,
                diameter2: branchPipe.diameter,
                material,
                pipeId: branchPipe.id,
              });
            }
          }
        }
      }
    }
  }

  // ── Phase 14.AD.20 — mid-segment branch detection ─────────────
  //
  // The loops above emit fittings when ONE pipe's endpoint meets
  // ANOTHER pipe's vertex. That misses the "branch starts from the
  // middle of an existing pipe" case: pipe A runs straight through
  // (0,0,0)→(10,0,0), pipe B starts at (5,0,0) and branches off.
  // Pipe A has no vertex at (5,0,0) — only its endpoints — so none
  // of the endpoint↔vertex pairs above trigger. Result (pre-AD.20):
  // no fitting emitted, and the pipe-collision detector flags the
  // overlap as a CLIP warning instead of a legal branch.
  //
  // Fix: for each pipe endpoint, check whether it lies INTERIOR to
  // any other pipe's segment (perpendicular distance within tol,
  // projection parameter strictly in (0, 1)). Emit a tee / wye /
  // combo fitting at that position with the through-pipe's segment
  // tangent as the "main" direction.
  for (let i = 0; i < allPipes.length; i++) {
    const branchPipe = allPipes[i]!;
    if (branchPipe.points.length < 2) continue;
    const endpoints: Array<{ pos: Vec3; outDir: THREE.Vector3 }> = [
      {
        pos: branchPipe.points[0]!,
        outDir: directionVector(branchPipe.points[0]!, branchPipe.points[1]!),
      },
      {
        pos: branchPipe.points[branchPipe.points.length - 1]!,
        outDir: directionVector(
          branchPipe.points[branchPipe.points.length - 1]!,
          branchPipe.points[branchPipe.points.length - 2]!,
        ),
      },
    ];

    for (const ep of endpoints) {
      // Skip positions already handled by the endpoint↔vertex
      // loop above (they fired the proper tee/wye/elbow path).
      const posKey = `${Math.round(ep.pos[0] * 10)},${Math.round(ep.pos[1] * 10)},${Math.round(ep.pos[2] * 10)}`;
      if (processed.has(posKey)) continue;
      if (suppressedVertices.has(mergedVertexKey(ep.pos))) continue;

      for (let j = 0; j < allPipes.length; j++) {
        if (j === i) continue;
        const mainPipe = allPipes[j]!;
        if (mainPipe.points.length < 2) continue;

        // Walk each segment of mainPipe looking for a hit where
        // branchPipe's endpoint projects INTERIOR to the segment.
        for (let s = 0; s < mainPipe.points.length - 1; s++) {
          const v0 = mainPipe.points[s]!;
          const v1 = mainPipe.points[s + 1]!;
          const sx = v1[0] - v0[0];
          const sy = v1[1] - v0[1];
          const sz = v1[2] - v0[2];
          const segLen2 = sx * sx + sy * sy + sz * sz;
          if (segLen2 < 1e-8) continue;

          // Projection parameter of ep.pos onto the segment.
          const ex = ep.pos[0] - v0[0];
          const ey = ep.pos[1] - v0[1];
          const ez = ep.pos[2] - v0[2];
          const t = (ex * sx + ey * sy + ez * sz) / segLen2;
          // Strictly INTERIOR — if t is ~0 or ~1 the endpoint
          // coincides with one of the segment's vertices, and the
          // loop above already handled it.
          if (t < 0.02 || t > 0.98) continue;

          // Closest point on the segment to ep.pos.
          const cx = v0[0] + sx * t;
          const cy = v0[1] + sy * t;
          const cz = v0[2] + sz * t;
          const dx = ep.pos[0] - cx;
          const dy = ep.pos[1] - cy;
          const dz = ep.pos[2] - cz;
          const perpDist2 = dx * dx + dy * dy + dz * dz;
          if (perpDist2 > JUNCTION_TOLERANCE * JUNCTION_TOLERANCE) continue;

          // Mark this spot as handled before emitting to dedupe
          // across (i, j) pairs hitting the same mid-segment.
          const midKey = `${Math.round(cx * 10)},${Math.round(cy * 10)},${Math.round(cz * 10)}`;
          if (processed.has(midKey)) continue;
          processed.add(midKey);

          const bigger = branchPipe.diameter >= mainPipe.diameter ? branchPipe : mainPipe;
          const mat = bigger.material as PipeMaterial;
          const mainDir = new THREE.Vector3(sx, sy, sz).normalize();
          // branch goes OUTWARD from the junction — ep.outDir points
          // from the endpoint into the pipe body, which IS the
          // outward direction at the branch.
          const branchDirOut = ep.outDir.clone();
          const branchAngleDeg = (angleBetween(mainDir, branchDirOut) * 180) / Math.PI;

          // Pick tee family; if branch is same diameter as main,
          // straight tee/wye. Otherwise emit as a reducing branch:
          // current catalog doesn't have reducing variants so we
          // still emit the unreduced tee + a bushing (AD.16) for
          // the reduced side.
          // AD.22 — orientation-aware classifier: san-tee /
          // combo / wye selected based on which segments are
          // horizontal vs vertical (not just the angle).
          const teeType = defaultTeeFor(
            mat,
            branchAngleDeg,
            isDWVSystem(bigger),
            {
              mainDir: [mainDir.x, mainDir.y, mainDir.z],
              branchDir: [branchDirOut.x, branchDirOut.y, branchDirOut.z],
            },
          );
          fittings.push({
            id: newId(),
            type: teeType,
            position: [cx, cy, cz],
            quaternion: teeQuaternion(mainDir, branchDirOut),
            diameter: bigger.diameter,
            material: mat,
            pipeId: mainPipe.id,
          });

          // Mid-pipe bushing for a reduced branch (AD.16 analog).
          if (
            branchPipe.material === mainPipe.material
            && branchPipe.diameter < bigger.diameter - 0.1
          ) {
            const odBiggerFt = getOuterDiameterFt(mat, bigger.diameter);
            const portOffsetFt = odBiggerFt * 1.4;
            const bpos: Vec3 = [
              cx + branchDirOut.x * portOffsetFt,
              cy + branchDirOut.y * portOffsetFt,
              cz + branchDirOut.z * portOffsetFt,
            ];
            fittings.push({
              id: newId(),
              type: 'bushing',
              position: bpos,
              quaternion: alignAxisToPipe(branchDirOut),
              diameter: bigger.diameter,
              diameter2: branchPipe.diameter,
              material: mat,
              pipeId: branchPipe.id,
            });
          }
          break; // this endpoint handled, move on
        }
      }
    }
  }

  return fittings;
}

// ── PEX bend warnings ─────────────────────────────────────────

/**
 * Retained for API compatibility + as an extension point for future
 * non-bend PEX diagnostics (e.g. long-run thermal expansion markers).
 *
 * Phase 14.U: the body is now a no-op. The old implementation
 * emitted a `coupling` fitting flagged `illegalAngle` for every
 * PEX bend > 30°, which double-fired with the new
 * `generatePexBendFittings` path (which emits a proper 90° elbow at
 * right angles and flags true kinks itself). Keeping the function
 * lets existing callers (BOM export, print path) keep their
 * imports without a 14.U-aware branch. Empty output is correct.
 */
export function generateFlexibleBendWarnings(_pipe: CommittedPipe): FittingInstance[] {
  return [];
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Generate all fittings for the current pipe network.
 * Call whenever pipes are added/removed/modified.
 */
export function generateAllFittings(allPipes: CommittedPipe[]): FittingInstance[] {
  const fittings: FittingInstance[] = [];

  for (const pipe of allPipes) {
    fittings.push(...generateBendFittings(pipe));
    fittings.push(...generateFlexibleBendWarnings(pipe));
  }

  // Phase 7.B.ii: compute the PEX-merge vertex set once per call and
  // thread it into junction generation so fittings at smooth-merge
  // points aren't emitted. Cost: one UnionFind pass ≤ O(P + V).
  const { mergedVertices } = mergePexRuns(allPipes);
  fittings.push(...generateJunctionFittings(allPipes, mergedVertices));

  return fittings;
}
