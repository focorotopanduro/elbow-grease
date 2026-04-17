/**
 * Clearance Enforcer — validates minimum separation between pipes
 * and structural elements, and between pipes and other pipes.
 *
 * Rules enforced:
 *   1. Pipe-to-structure clearance (per StructuralElements rules)
 *   2. Pipe-to-pipe clearance (parallel runs need separation)
 *   3. Penetration validation (hole size vs element depth)
 *   4. Support spacing (horizontal pipes need hangers per IPC 308)
 *
 * Returns a list of ClearanceViolation objects with:
 *   - Position of the clash
 *   - Which elements are involved
 *   - Required vs actual clearance
 *   - Suggested remediation
 */

import type { Vec3 } from '../events';
import type { CommittedPipe } from '../../store/pipeStore';
import {
  type StructuralElement,
  type StructuralType,
  CLEARANCE_RULES,
  checkPenetration,
} from './StructuralElements';

// ── Violation types ─────────────────────────────────────────────

export interface ClearanceViolation {
  id: string;
  type: 'pipe_structure' | 'pipe_pipe' | 'penetration' | 'support';
  severity: 'error' | 'warning';
  position: Vec3;
  /** Which pipe is violating. */
  pipeId: string;
  /** Which structural element (if pipe_structure). */
  elementId?: string;
  elementType?: StructuralType;
  /** Which other pipe (if pipe_pipe). */
  otherPipeId?: string;
  /** Required clearance in feet. */
  requiredClearance: number;
  /** Actual clearance in feet. */
  actualClearance: number;
  /** Human message. */
  message: string;
  /** Suggested fix. */
  remediation: string;
}

// ── Pipe-to-pipe clearance rules ────────────────────────────────

/**
 * Minimum separation between parallel pipes (center-to-center) in feet.
 * Based on combined radii + 1" working clearance.
 */
function minPipeSeparation(diam1Inches: number, diam2Inches: number): number {
  return (diam1Inches + diam2Inches) / 2 / 12 + 1 / 12; // radii sum + 1"
}

/**
 * IPC 308 — Horizontal pipe support intervals (feet).
 */
function maxSupportSpacing(material: string, diameterInches: number): number {
  // PVC/ABS: 4ft for all sizes
  if (material.includes('pvc') || material.includes('abs') || material.includes('cpvc')) return 4;
  // Copper: varies by size
  if (material.includes('copper')) return diameterInches <= 1 ? 6 : diameterInches <= 2 ? 8 : 10;
  // Cast iron: 5ft at every joint + mid-span
  if (material.includes('cast_iron') || material.includes('ductile')) return 5;
  // PEX: 32" (2.67ft) for horizontal runs
  if (material.includes('pex')) return 2.67;
  // Steel: 10-12ft
  if (material.includes('steel')) return 10;
  return 4; // conservative default
}

// ── AABB helpers ────────────────────────────────────────────────

function pointToBoxDistance(
  px: number, py: number, pz: number,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): number {
  const dx = Math.max(minX - px, 0, px - maxX);
  const dy = Math.max(minY - py, 0, py - maxY);
  const dz = Math.max(minZ - pz, 0, pz - maxZ);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function pointInsideBox(
  px: number, py: number, pz: number,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): boolean {
  return px >= minX && px <= maxX &&
         py >= minY && py <= maxY &&
         pz >= minZ && pz <= maxZ;
}

// ── Main enforcement ────────────────────────────────────────────

let violationIdCounter = 0;

/**
 * Check all clearance rules for the current pipe network.
 *
 * @param pipes — committed pipes
 * @param elements — structural elements in the building
 * @returns list of clearance violations
 */
export function enforceClearances(
  pipes: CommittedPipe[],
  elements: StructuralElement[],
): ClearanceViolation[] {
  const violations: ClearanceViolation[] = [];

  // 1. Pipe-to-structure clearance
  for (const pipe of pipes) {
    const pipeRadius = pipe.diameter / 24; // inches → feet radius

    for (const elem of elements) {
      const rule = CLEARANCE_RULES[elem.type];
      const reqClearance = elem.clearanceOverride ?? rule.minClearance;

      // Check each waypoint against the element AABB
      for (let i = 0; i < pipe.points.length; i++) {
        const pt = pipe.points[i]!;
        const dist = pointToBoxDistance(
          pt[0], pt[1], pt[2],
          elem.min[0], elem.min[1], elem.min[2],
          elem.max[0], elem.max[1], elem.max[2],
        );

        const actualClearance = dist - pipeRadius;

        // Inside the element → penetration check
        if (pointInsideBox(
          pt[0], pt[1], pt[2],
          elem.min[0], elem.min[1], elem.min[2],
          elem.max[0], elem.max[1], elem.max[2],
        )) {
          const penCheck = checkPenetration(elem, pipe.diameter);
          if (!penCheck.allowed) {
            violations.push({
              id: `cv-${violationIdCounter++}`,
              type: 'penetration',
              severity: 'error',
              position: pt,
              pipeId: pipe.id,
              elementId: elem.id,
              elementType: elem.type,
              requiredClearance: reqClearance,
              actualClearance: 0,
              message: `${pipe.diameter}" pipe penetrates ${elem.label}: ${penCheck.reason}`,
              remediation: `Reroute pipe around ${elem.label} or reduce pipe size below ${penCheck.maxHoleDiameter.toFixed(1)}"`,
            });
          }
          continue;
        }

        // Too close → clearance violation
        if (actualClearance < reqClearance && actualClearance >= 0) {
          violations.push({
            id: `cv-${violationIdCounter++}`,
            type: 'pipe_structure',
            severity: actualClearance < reqClearance * 0.5 ? 'error' : 'warning',
            position: pt,
            pipeId: pipe.id,
            elementId: elem.id,
            elementType: elem.type,
            requiredClearance: reqClearance,
            actualClearance,
            message: `${(actualClearance * 12).toFixed(1)}" clearance to ${elem.label}, minimum ${(reqClearance * 12).toFixed(1)}" required`,
            remediation: `Move pipe ${((reqClearance - actualClearance) * 12).toFixed(1)}" away from ${elem.label}`,
          });
        }
      }
    }
  }

  // 2. Pipe-to-pipe clearance
  for (let i = 0; i < pipes.length; i++) {
    for (let j = i + 1; j < pipes.length; j++) {
      const pipeA = pipes[i]!;
      const pipeB = pipes[j]!;
      const minSep = minPipeSeparation(pipeA.diameter, pipeB.diameter);

      // Check nearest points between the two pipe paths
      for (const ptA of pipeA.points) {
        for (const ptB of pipeB.points) {
          const dx = ptA[0] - ptB[0];
          const dy = ptA[1] - ptB[1];
          const dz = ptA[2] - ptB[2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist < minSep && dist > 0.01) {
            violations.push({
              id: `cv-${violationIdCounter++}`,
              type: 'pipe_pipe',
              severity: dist < minSep * 0.5 ? 'error' : 'warning',
              position: [
                (ptA[0] + ptB[0]) / 2,
                (ptA[1] + ptB[1]) / 2,
                (ptA[2] + ptB[2]) / 2,
              ],
              pipeId: pipeA.id,
              otherPipeId: pipeB.id,
              requiredClearance: minSep,
              actualClearance: dist,
              message: `${pipeA.diameter}" and ${pipeB.diameter}" pipes ${(dist * 12).toFixed(1)}" apart, minimum ${(minSep * 12).toFixed(1)}" required`,
              remediation: `Separate pipes by ${((minSep - dist) * 12).toFixed(1)}" or offset vertically`,
            });
            break; // one violation per pipe pair is enough
          }
        }
        if (violations.some((v) => v.pipeId === pipeA.id && v.otherPipeId === pipeB.id)) break;
      }
    }
  }

  // 3. Support spacing check
  for (const pipe of pipes) {
    const maxSpan = maxSupportSpacing(pipe.material, pipe.diameter);
    let runLength = 0;

    for (let i = 1; i < pipe.points.length; i++) {
      const prev = pipe.points[i - 1]!;
      const curr = pipe.points[i]!;
      const dy = Math.abs(curr[1] - prev[1]);
      const horizDist = Math.sqrt(
        (curr[0] - prev[0]) ** 2 + (curr[2] - prev[2]) ** 2,
      );

      // Only check horizontal runs (vertical pipes have different support rules)
      if (horizDist > dy) {
        runLength += Math.sqrt(
          (curr[0] - prev[0]) ** 2 +
          (curr[1] - prev[1]) ** 2 +
          (curr[2] - prev[2]) ** 2,
        );

        if (runLength > maxSpan) {
          violations.push({
            id: `cv-${violationIdCounter++}`,
            type: 'support',
            severity: 'warning',
            position: curr,
            pipeId: pipe.id,
            requiredClearance: maxSpan,
            actualClearance: runLength,
            message: `${runLength.toFixed(1)}ft unsupported horizontal run, max ${maxSpan}ft for ${pipe.material.replace(/_/g, ' ')} (IPC 308)`,
            remediation: `Add pipe hanger/support within ${maxSpan}ft intervals`,
          });
          runLength = 0; // reset after flagging
        }
      } else {
        runLength = 0; // vertical segment resets run
      }
    }
  }

  return violations;
}
