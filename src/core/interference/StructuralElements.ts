/**
 * Structural Elements — typed obstacle catalog for the building.
 *
 * Each structural element has a physical geometry, a required
 * clearance zone, and a routing cost weight. The interference
 * system uses these to:
 *
 *   1. Populate the SDF with accurate obstacle shapes
 *   2. Enforce element-specific clearance minimums
 *   3. Weight routing costs (pipes prefer running parallel to
 *      joists, avoid crossing beams, stay away from ducts)
 *
 * Element types and their IPC/construction clearance rules:
 *
 *   BEAM        — steel/LVL structural beam. Pipes NEVER penetrate.
 *                 Minimum 2" clearance. Routes go under or around.
 *
 *   JOIST       — floor/ceiling joists (wood or steel).
 *                 Pipes CAN pass through holes per IRC R502.8
 *                 (max hole = 1/3 joist depth, min 2" from edges).
 *                 Preferred routing: parallel between joists.
 *
 *   WALL        — stud wall. Pipes pass through bored holes per
 *                 IRC R602.6 (max 60% of stud depth for bearing,
 *                 40% for non-bearing). Route prefers wall cavities.
 *
 *   COLUMN      — vertical structural column (steel/concrete).
 *                 No penetration. Minimum 3" clearance.
 *
 *   DUCT        — HVAC ductwork. No penetration. Pipes can run
 *                 parallel with 1" clearance. Cross over/under.
 *
 *   SLAB        — concrete slab (floor/foundation). Pipes below slab
 *                 require trenching. Costly but sometimes necessary.
 *
 *   FOOTING     — foundation footing. Never penetrate. Route around.
 */

import type { Vec3 } from '../events';

// ── Element type ────────────────────────────────────────────────

export type StructuralType =
  | 'beam'
  | 'joist'
  | 'wall'
  | 'column'
  | 'duct'
  | 'slab'
  | 'footing';

// ── Clearance rules per element type ────────────────────────────

export interface ClearanceRule {
  /** Minimum clearance in feet from element surface. */
  minClearance: number;
  /** Can pipes penetrate this element (with proper holes)? */
  penetrable: boolean;
  /** Maximum penetration hole diameter as fraction of element depth. */
  maxHoleFraction: number;
  /** Minimum distance from element edge for penetration holes (inches). */
  minEdgeDistance: number;
  /** SDF cost weight (higher = router avoids more aggressively). */
  costWeight: number;
  /** Preferred routing relationship. */
  preferredRouting: 'parallel' | 'perpendicular' | 'avoid' | 'through';
}

export const CLEARANCE_RULES: Record<StructuralType, ClearanceRule> = {
  beam: {
    minClearance: 2 / 12,      // 2 inches
    penetrable: false,
    maxHoleFraction: 0,
    minEdgeDistance: 0,
    costWeight: 50,             // very high — never route through
    preferredRouting: 'avoid',
  },
  joist: {
    minClearance: 0.5 / 12,    // 1/2 inch (can run between joists touching)
    penetrable: true,
    maxHoleFraction: 0.333,    // 1/3 of joist depth (IRC R502.8)
    minEdgeDistance: 2,         // 2 inches from top/bottom
    costWeight: 3,              // moderate — prefer parallel but can cross
    preferredRouting: 'parallel',
  },
  wall: {
    minClearance: 0,            // pipes live inside wall cavities
    penetrable: true,
    maxHoleFraction: 0.6,      // 60% of stud depth for bearing walls
    minEdgeDistance: 0.625,     // 5/8" from edge (IRC R602.6)
    costWeight: 2,              // low — walls are preferred pipe runs
    preferredRouting: 'through',
  },
  column: {
    minClearance: 3 / 12,      // 3 inches
    penetrable: false,
    maxHoleFraction: 0,
    minEdgeDistance: 0,
    costWeight: 40,             // very high
    preferredRouting: 'avoid',
  },
  duct: {
    minClearance: 1 / 12,      // 1 inch
    penetrable: false,
    maxHoleFraction: 0,
    minEdgeDistance: 0,
    costWeight: 8,              // moderate-high — can run parallel nearby
    preferredRouting: 'parallel',
  },
  slab: {
    minClearance: 0,
    penetrable: true,           // with trenching/sleeves
    maxHoleFraction: 1,
    minEdgeDistance: 0,
    costWeight: 20,             // high — trenching is expensive
    preferredRouting: 'avoid',
  },
  footing: {
    minClearance: 6 / 12,      // 6 inches
    penetrable: false,
    maxHoleFraction: 0,
    minEdgeDistance: 0,
    costWeight: 100,            // maximum — never route through
    preferredRouting: 'avoid',
  },
};

// ── Structural element instance ─────────────────────────────────

export interface StructuralElement {
  id: string;
  type: StructuralType;
  label: string;

  /** Geometry: axis-aligned bounding box. */
  min: Vec3;
  max: Vec3;

  /** Element depth in inches (for penetration hole calculation). */
  depth: number;

  /** Orientation: which axis the element runs along. */
  primaryAxis: 'x' | 'y' | 'z';

  /** Custom clearance override (null = use type default). */
  clearanceOverride?: number;
}

// ── Factories ───────────────────────────────────────────────────

let elemIdCounter = 0;

export function createBeam(
  min: Vec3, max: Vec3,
  primaryAxis: 'x' | 'z' = 'x',
  depth: number = 12,
  label?: string,
): StructuralElement {
  return {
    id: `struct-${elemIdCounter++}`,
    type: 'beam',
    label: label ?? 'Steel Beam',
    min, max, depth, primaryAxis,
  };
}

export function createJoistField(
  floorY: number,
  joistDepth: number,
  spacing: number,
  count: number,
  startX: number,
  startZ: number,
  length: number,
  axis: 'x' | 'z' = 'x',
): StructuralElement[] {
  const joists: StructuralElement[] = [];
  const depthFt = joistDepth / 12;

  for (let i = 0; i < count; i++) {
    const offset = i * spacing;
    const min: Vec3 = axis === 'x'
      ? [startX, floorY, startZ + offset]
      : [startX + offset, floorY, startZ];
    const max: Vec3 = axis === 'x'
      ? [startX + length, floorY + depthFt, startZ + offset + 1.5 / 12]
      : [startX + offset + 1.5 / 12, floorY + depthFt, startZ + length];

    joists.push({
      id: `struct-${elemIdCounter++}`,
      type: 'joist',
      label: `Joist ${i + 1}`,
      min, max,
      depth: joistDepth,
      primaryAxis: axis,
    });
  }

  return joists;
}

export function createWall(
  min: Vec3, max: Vec3,
  depth: number = 3.5,
  primaryAxis: 'x' | 'z' = 'x',
  label?: string,
): StructuralElement {
  return {
    id: `struct-${elemIdCounter++}`,
    type: 'wall',
    label: label ?? 'Stud Wall',
    min, max, depth, primaryAxis,
  };
}

export function createColumn(
  centerX: number, centerZ: number,
  width: number, height: number,
  floorY: number = 0,
  label?: string,
): StructuralElement {
  const hw = width / 2;
  return {
    id: `struct-${elemIdCounter++}`,
    type: 'column',
    label: label ?? 'Column',
    min: [centerX - hw, floorY, centerZ - hw],
    max: [centerX + hw, floorY + height, centerZ + hw],
    depth: width * 12,
    primaryAxis: 'y',
  };
}

export function createDuct(
  min: Vec3, max: Vec3,
  primaryAxis: 'x' | 'z' = 'x',
  label?: string,
): StructuralElement {
  return {
    id: `struct-${elemIdCounter++}`,
    type: 'duct',
    label: label ?? 'HVAC Duct',
    min, max,
    depth: Math.max(max[1] - min[1], max[0] - min[0]) * 12,
    primaryAxis,
  };
}

// ── Penetration check ───────────────────────────────────────────

export interface PenetrationCheck {
  allowed: boolean;
  maxHoleDiameter: number; // inches
  reason: string;
}

/**
 * Check if a pipe of given diameter can penetrate a structural element.
 */
export function checkPenetration(
  element: StructuralElement,
  pipeDiameterInches: number,
): PenetrationCheck {
  const rule = CLEARANCE_RULES[element.type];

  if (!rule.penetrable) {
    return {
      allowed: false,
      maxHoleDiameter: 0,
      reason: `${element.type} elements cannot be penetrated`,
    };
  }

  const maxHole = element.depth * rule.maxHoleFraction;

  // Pipe needs hole = pipe OD + 1/4" clearance each side
  const requiredHole = pipeDiameterInches + 0.5;

  if (requiredHole > maxHole) {
    return {
      allowed: false,
      maxHoleDiameter: maxHole,
      reason: `Pipe ${pipeDiameterInches}" requires ${requiredHole}" hole, max allowed ${maxHole.toFixed(1)}" (${(rule.maxHoleFraction * 100).toFixed(0)}% of ${element.depth}" depth)`,
    };
  }

  return {
    allowed: true,
    maxHoleDiameter: maxHole,
    reason: `OK: ${requiredHole}" hole within ${maxHole.toFixed(1)}" max`,
  };
}
