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
import { isFlexibleMaterial } from '@core/pipe/PipeSizeSpec';

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

function bendQuaternion(
  dirIn: THREE.Vector3,
  dirOut: THREE.Vector3,
): [number, number, number, number] {
  const bisector = new THREE.Vector3().addVectors(dirIn, dirOut).normalize();
  const planeNormal = new THREE.Vector3().crossVectors(dirIn, dirOut).normalize();
  if (planeNormal.length() < 0.001) return [0, 0, 0, 1];
  const right = new THREE.Vector3().crossVectors(bisector, planeNormal).normalize();
  const mat = new THREE.Matrix4().makeBasis(right, planeNormal, bisector);
  const quat = new THREE.Quaternion().setFromRotationMatrix(mat);
  return [quat.x, quat.y, quat.z, quat.w];
}

function teeQuaternion(
  mainDir: THREE.Vector3,
  branchDir: THREE.Vector3,
): [number, number, number, number] {
  const up = new THREE.Vector3().crossVectors(mainDir, branchDir).normalize();
  if (up.length() < 0.001) return [0, 0, 0, 1];
  const mat = new THREE.Matrix4().makeBasis(
    branchDir.clone().normalize(),
    up,
    mainDir.clone().normalize(),
  );
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
 * PEX / other flexible pipe → no bend fittings.
 * Rigid pipe → snap each bend to a legal angle.
 */
function generateBendFittings(pipe: CommittedPipe): FittingInstance[] {
  const material = pipe.material as PipeMaterial;
  if (!requiresBendFittings(material)) return [];

  const fittings: FittingInstance[] = [];
  const pts = pipe.points;
  const isDWV = isDWVSystem(pipe);

  for (let i = 1; i < pts.length - 1; i++) {
    const dirIn = directionVector(pts[i - 1]!, pts[i]!);
    const dirOut = directionVector(pts[i]!, pts[i + 1]!);
    const angleRad = angleBetween(dirIn, dirOut);
    const angleDeg = (angleRad * 180) / Math.PI;

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

    fittings.push({
      id: newId(),
      type,
      position: pts[i]!,
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

// ── Junction detection ──────────────────────────────────────────

const JUNCTION_TOLERANCE = 0.15; // feet

/**
 * Detect tee/wye/manifold-worthy junctions where pipes meet at shared
 * endpoints or mid-pipe points.
 */
function generateJunctionFittings(allPipes: CommittedPipe[]): FittingInstance[] {
  const fittings: FittingInstance[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < allPipes.length; i++) {
    const pipeA = allPipes[i]!;
    const endpointsA = [
      { pos: pipeA.points[0]!, isStart: true },
      { pos: pipeA.points[pipeA.points.length - 1]!, isStart: false },
    ];

    for (let j = i + 1; j < allPipes.length; j++) {
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

          // Reducer if diameters differ meaningfully
          const isReducer = Math.abs(pipeA.diameter - pipeB.diameter) > 0.1;

          // Choose material that "owns" the fitting (larger-diameter wins)
          const bigger = pipeA.diameter >= pipeB.diameter ? pipeA : pipeB;
          const material = bigger.material as PipeMaterial;

          if (isReducer) {
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
          } else {
            const teeType = defaultTeeFor(
              material,
              branchAngleDeg,
              isDWVSystem(bigger),
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
          }
        }
      }
    }
  }

  return fittings;
}

// ── PEX bend-radius warnings (not fittings, but diagnostics) ────

/**
 * Flexible pipe has a minimum bend radius. Points that bend tighter
 * than the spec snap-back in real life or kink. We don't emit fittings
 * for flexible bends (that's the point of PEX) but we DO flag tight
 * bends as illegal geometry via the `illegalAngle` carrier.
 */
function generateFlexibleBendWarnings(pipe: CommittedPipe): FittingInstance[] {
  const material = pipe.material as PipeMaterial;
  if (!isFlexibleMaterial(material)) return [];
  const fittings: FittingInstance[] = [];
  const pts = pipe.points;

  for (let i = 1; i < pts.length - 1; i++) {
    const dirIn = directionVector(pts[i - 1]!, pts[i]!);
    const dirOut = directionVector(pts[i]!, pts[i + 1]!);
    const angleDeg = (angleBetween(dirIn, dirOut) * 180) / Math.PI;

    // A "kink" in PEX is anything sharper than ~30° at a single vertex.
    // In practice PEX should bend over ≥6× OD which corresponds to
    // smooth arcs across multiple waypoints. A sharp single-vertex bend
    // signals the plumber tried to use an elbow where they should let
    // the pipe curve.
    if (angleDeg > 30) {
      fittings.push({
        id: newId(),
        type: 'coupling',
        position: pts[i]!,
        quaternion: bendQuaternion(dirIn, dirOut),
        diameter: pipe.diameter,
        material,
        pipeId: pipe.id,
        illegalAngle: true,
        measuredAngleDeg: angleDeg,
      });
    }
  }

  return fittings;
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

  fittings.push(...generateJunctionFittings(allPipes));

  return fittings;
}
