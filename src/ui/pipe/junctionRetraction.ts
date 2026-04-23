/**
 * Junction retraction — Phase 14.AD.21.
 *
 * Classifies the specific fitting landing at each pipe endpoint and
 * computes the exact retraction distance (in feet) that makes the
 * pipe's visible end line up with that fitting's hub mouth.
 *
 * Replaces the prior boolean-flag approach (Phase 14.AD.7/8) where
 * a single fixed retraction amount was applied at every endpoint
 * marked "in a junction". That fixed amount was too short for
 * elbows (left a gap) and too long for couplings / tees / reducers
 * (pipe ended before the fitting) — user-visible as "some of the
 * pipes end before the fitting, so they don't look completed."
 *
 * Classifications:
 *   • Coupling (2-pipe inline, bend < 5°)            → socketDepth
 *   • Reducer (2-pipe, mismatched diameters)         → socketDepth
 *   • Tee / wye / cross (3+ pipe endpoint cluster)   → socketDepth
 *   • 2-pipe elbow at endpoint                       → socketDepth
 *                                                      + bendR(angle)
 *   • Mid-pipe branch (endpoint interior to another  → socketDepth
 *     pipe's segment — AD.20)                          + 1.5 × OD
 *   • Free end (no junction)                         → 0
 *
 * Two renderer surfaces use this: the 3D `PipeRenderer` (through
 * `buildPipeGeometry`) and the fast-mode `PipeInstanceRenderer`
 * (through `segmentExtractCache`).
 */

import * as THREE from 'three';
import type { CommittedPipe } from '@store/pipeStore';
import type { PipeMaterial } from '../../engine/graph/GraphEdge';
import type { Vec3 } from '@core/events';
import { JUNCTION_TOLERANCE_FT, JUNCTION_TOLERANCE_FT_SQ } from '@core/pipe/junctionConstants';
import { getOuterDiameterFt } from '@core/pipe/PipeSizeSpec';
import { getSocketDepthFt, getBendCenterlineRadiusFt } from '@core/pipe/PipeStandards';

export interface RetractionHint {
  retractStartFt: number;
  retractEndFt: number;
}

function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function projectOnSegmentInterior(
  pos: Vec3,
  v0: Vec3,
  v1: Vec3,
): boolean {
  const sx = v1[0] - v0[0], sy = v1[1] - v0[1], sz = v1[2] - v0[2];
  const segLen2 = sx * sx + sy * sy + sz * sz;
  if (segLen2 < 1e-8) return false;
  const ex = pos[0] - v0[0], ey = pos[1] - v0[1], ez = pos[2] - v0[2];
  const t = (ex * sx + ey * sy + ez * sz) / segLen2;
  if (t < 0.02 || t > 0.98) return false;
  const cx = v0[0] + sx * t, cy = v0[1] + sy * t, cz = v0[2] + sz * t;
  const dx = pos[0] - cx, dy = pos[1] - cy, dz = pos[2] - cz;
  return dx * dx + dy * dy + dz * dz <= JUNCTION_TOLERANCE_FT_SQ;
}

/** Unused-but-exported so consumers depending on TOL constant
 *  indirectly don't get tree-shaken. Pure no-op. */
export const JUNCTION_RETRACTION_TOL_FT = JUNCTION_TOLERANCE_FT;

function classifyEndpoint(
  pipe: CommittedPipe,
  endpointPos: Vec3,
  endpointOutDir: THREE.Vector3,
  allPipes: readonly CommittedPipe[],
): number {
  const mat = pipe.material as PipeMaterial;
  const socketDepth = getSocketDepthFt(mat, pipe.diameter);
  const pipeOdFt = getOuterDiameterFt(mat, pipe.diameter);

  // Collect OTHER pipes with endpoints at this position.
  const otherEndpoints: Array<{ diameter: number; outDir: THREE.Vector3 }> = [];
  for (const other of allPipes) {
    if (other.id === pipe.id || other.points.length < 2) continue;
    const oStart = other.points[0]!;
    const oEnd = other.points[other.points.length - 1]!;
    if (dist2(endpointPos, oStart) <= JUNCTION_TOLERANCE_FT_SQ) {
      const od = new THREE.Vector3(
        other.points[1]![0] - oStart[0],
        other.points[1]![1] - oStart[1],
        other.points[1]![2] - oStart[2],
      ).normalize();
      otherEndpoints.push({ diameter: other.diameter, outDir: od });
    } else if (dist2(endpointPos, oEnd) <= JUNCTION_TOLERANCE_FT_SQ) {
      const lastIdx = other.points.length - 1;
      const od = new THREE.Vector3(
        other.points[lastIdx - 1]![0] - oEnd[0],
        other.points[lastIdx - 1]![1] - oEnd[1],
        other.points[lastIdx - 1]![2] - oEnd[2],
      ).normalize();
      otherEndpoints.push({ diameter: other.diameter, outDir: od });
    }
  }

  if (otherEndpoints.length >= 2) {
    // 3+ pipe endpoint cluster — tee / wye / cross. Hub at corner.
    return socketDepth;
  }

  if (otherEndpoints.length === 1) {
    const other = otherEndpoints[0]!;
    if (Math.abs(other.diameter - pipe.diameter) > 0.1) {
      // Reducer — straight-through, hub at corner.
      return socketDepth;
    }
    // Compute travel-direction bend angle. outDir points FROM
    // endpoint INTO pipe body (outward from junction). Other's
    // outDir similarly points from junction into other's body.
    // The PIPE TRAVEL direction is OPPOSITE outDir. So bend angle
    // between travel flows = angle(-outDir, other.outDir).
    const cosBend = Math.max(-1, Math.min(1, -endpointOutDir.dot(other.outDir)));
    const bendAngleDeg = Math.acos(cosBend) * 180 / Math.PI;
    if (bendAngleDeg < 5) {
      // Inline coupling.
      return socketDepth;
    }
    let bendKind: 'sixteenth' | 'eighth' | 'short_sweep';
    if (bendAngleDeg < 30) bendKind = 'sixteenth';
    else if (bendAngleDeg < 67.5) bendKind = 'eighth';
    else bendKind = 'short_sweep';
    const bendR = getBendCenterlineRadiusFt(mat, pipeOdFt, bendKind);
    return socketDepth + bendR;
  }

  // otherEndpoints.length === 0 — check mid-pipe branch (AD.20).
  for (const other of allPipes) {
    if (other.id === pipe.id || other.points.length < 2) continue;
    for (let s = 0; s < other.points.length - 1; s++) {
      if (projectOnSegmentInterior(
        endpointPos,
        other.points[s]!,
        other.points[s + 1]!,
      )) {
        // Mid-pipe branch: pipe enters the tee's branch outlet,
        // which extends ~1.5 × OD perpendicular to the main axis.
        return socketDepth + pipeOdFt * 1.5;
      }
    }
  }

  return 0;
}

/**
 * Build a per-pipe retraction-hints map from the visible pipe list.
 * Output format matches `segmentExtractCache.JunctionHints`.
 */
export function computeJunctionHints(
  pipes: readonly CommittedPipe[],
): Map<string, RetractionHint> {
  const out = new Map<string, RetractionHint>();
  for (const p of pipes) {
    if (p.points.length < 2) {
      out.set(p.id, { retractStartFt: 0, retractEndFt: 0 });
      continue;
    }
    const startPos = p.points[0]!;
    const endPos = p.points[p.points.length - 1]!;
    const startOut = new THREE.Vector3(
      p.points[1]![0] - startPos[0],
      p.points[1]![1] - startPos[1],
      p.points[1]![2] - startPos[2],
    ).normalize();
    const endIdx = p.points.length - 1;
    const endOut = new THREE.Vector3(
      p.points[endIdx - 1]![0] - endPos[0],
      p.points[endIdx - 1]![1] - endPos[1],
      p.points[endIdx - 1]![2] - endPos[2],
    ).normalize();
    out.set(p.id, {
      retractStartFt: classifyEndpoint(p, startPos, startOut, pipes),
      retractEndFt: classifyEndpoint(p, endPos, endOut, pipes),
    });
  }
  return out;
}
