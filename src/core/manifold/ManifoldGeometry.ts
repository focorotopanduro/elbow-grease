/**
 * ManifoldGeometry — pure math for PEX manifold entities.
 *
 * A manifold is a horizontal bar (trunk) with N ports extending
 * perpendicular to its length. In local coordinates:
 *
 *   • Length axis: +X (east)
 *   • Port face:   +Z (south) — ports extend from the body in this direction
 *   • Up axis:     +Y
 *
 *   Port 0                Port N-1
 *      │                     │
 *      ▼                     ▼
 *   ┌──┴──┬──┴──┬──┴──┬──┴──┐       ← trunk
 *   │                        │
 *   └────────────────────────┘
 *        ▲                         ← inlet (end cap)
 *        │
 *      Inlet
 *
 * In world space, a yaw rotation (around the Y axis) + world-space
 * center position places the manifold.
 *
 * This module is deliberately free of Three.js imports — pure data.
 * Renderer (ManifoldRenderer.tsx) maps these values into meshes.
 */

import type { Vec3 } from '@core/events';
import type { SystemType } from '../../engine/graph/GraphNode';
import type { PipeMaterial } from '../../engine/graph/GraphEdge';

// ── Constants ──────────────────────────────────────────────────

/** Spacing between adjacent ports along the trunk axis, feet. */
export const PORT_SPACING_FT = 0.25;       // 3"

/** Outer diameter of the trunk, feet. */
export const TRUNK_DIAMETER_FT = 0.125;    // 1.5"

/** Maximum port count we support merging to. Above 5 the user
 *  should use a dedicated commercial manifold fixture instead. */
export const MAX_PORT_COUNT = 5;

/** Length of one port tube extending from the trunk body. */
export const PORT_EXTENSION_FT = 0.15;     // 1.8"

/** How close two manifold endpoints must be to merge, in feet. */
export const MERGE_SNAP_DISTANCE_FT = 0.2; // 2.4"

/** Max yaw difference (radians) to consider "parallel". */
export const MERGE_YAW_TOLERANCE_RAD = (2 * Math.PI) / 180; // 2°

/** Max perpendicular offset to still count as colinear (feet). */
export const MERGE_PERP_TOLERANCE_FT = 0.12; // 1.4"

// ── Types ──────────────────────────────────────────────────────

export interface Manifold {
  id: string;
  /** World-space center of the trunk. */
  center: Vec3;
  /** Rotation around Y axis, radians. 0 = length along +X. */
  yawRad: number;
  /** Number of outlet ports along the trunk. Valid range 2..MAX_PORT_COUNT. */
  portCount: number;
  /** Plumbing system (determines trunk + port color). */
  system: SystemType;
  /** Material (always PEX for now; kept for future rigid manifolds). */
  material: PipeMaterial;
  /** Port outer diameter in inches — distinct from the trunk. */
  portDiameterIn: number;
  /** Floor elevation (feet). Used to scope merges to the same storey. */
  floorY: number;
}

export interface PortWorldInfo {
  /** World-space position of the port's outer tip. */
  worldPosition: Vec3;
  /** World-space outward normal (points away from the trunk). */
  outward: Vec3;
  /** 0-indexed port number within the manifold. */
  portIndex: number;
}

// ── Length calculation ────────────────────────────────────────

/**
 * Total length of the trunk along its local X axis. Depends on
 * portCount: a 2-port manifold is shorter than a 5-port.
 *
 *   length = portCount × PORT_SPACING + 2 × end-cap-margin
 */
export function trunkLengthFt(portCount: number): number {
  const clamped = Math.max(2, Math.min(MAX_PORT_COUNT, portCount));
  // Ports are centered within the trunk; half a spacing of margin on
  // each end keeps the geometry symmetric + gives visual room for
  // the end caps.
  return clamped * PORT_SPACING_FT;
}

// ── Port positions ────────────────────────────────────────────

/**
 * Compute the world-space position and outward normal for each port
 * on a given manifold.
 *
 * Ports are laid out along local +X, evenly spaced, centered on the
 * manifold's center. All ports face local +Z (mirror-symmetric
 * "straight manifold"; no alternating-side variant for MVP).
 */
export function computePortPositions(m: Manifold): PortWorldInfo[] {
  const out: PortWorldInfo[] = [];
  const half = trunkLengthFt(m.portCount) / 2;
  const cos = Math.cos(m.yawRad);
  const sin = Math.sin(m.yawRad);

  // Outward direction in world space: local +Z after yaw.
  //   worldX = localX · cos + localZ · sin
  //   worldZ = -localX · sin + localZ · cos
  //   localZ=1, localX=0 →  worldX = sin,  worldZ = cos
  const outward: Vec3 = [sin, 0, cos];

  for (let i = 0; i < m.portCount; i++) {
    // Local-X position: center the ports within the trunk.
    // Port 0 sits at -half + spacing/2, port N-1 sits at +half - spacing/2.
    const localX = -half + PORT_SPACING_FT * (i + 0.5);
    // Port tip extends outward by PORT_EXTENSION_FT in local +Z.
    // localX ≠ 0, localZ = PORT_EXTENSION_FT
    const worldX = m.center[0] + localX * cos + PORT_EXTENSION_FT * sin;
    const worldZ = m.center[2] - localX * sin + PORT_EXTENSION_FT * cos;
    out.push({
      worldPosition: [worldX, m.center[1], worldZ],
      outward,
      portIndex: i,
    });
  }
  return out;
}

// ── Local-frame endpoints ─────────────────────────────────────

/**
 * The two world-space endpoints of the trunk (where the end caps sit
 * + where an adjacent manifold would snap). Returns `[left, right]`
 * in local-axis order — "left" is at -X in local frame, "right" at +X.
 */
export function trunkEndpoints(m: Manifold): [Vec3, Vec3] {
  const half = trunkLengthFt(m.portCount) / 2;
  const cos = Math.cos(m.yawRad);
  const sin = Math.sin(m.yawRad);
  const left: Vec3 = [
    m.center[0] + -half * cos,
    m.center[1],
    m.center[2] - -half * sin,
  ];
  const right: Vec3 = [
    m.center[0] + half * cos,
    m.center[1],
    m.center[2] - half * sin,
  ];
  return [left, right];
}

// ── Merge eligibility ─────────────────────────────────────────

export interface MergeCheckResult {
  canMerge: boolean;
  /** If can merge, which end of `a` mates with which end of `b`. */
  aEnd?: 'left' | 'right';
  bEnd?: 'left' | 'right';
  /** Distance between the two ends when aligned (for diagnostics). */
  gapFt?: number;
  /** Reason for rejection, if any — useful for logging + future UI cues. */
  reason?: string;
}

/**
 * Can two manifolds merge into a single N-port manifold?
 *
 * Constraints:
 *   1. Same material + diameter + system + floor elevation.
 *   2. Same yaw (parallel, within MERGE_YAW_TOLERANCE_RAD).
 *   3. Combined port count ≤ MAX_PORT_COUNT.
 *   4. Both manifolds lie on the same colinear axis (perpendicular
 *      offset from one manifold's length line to the other's center
 *      must be within MERGE_PERP_TOLERANCE_FT).
 *   5. The two nearest endpoints (one from each manifold) are within
 *      MERGE_SNAP_DISTANCE_FT of each other.
 */
export function checkManifoldMerge(a: Manifold, b: Manifold): MergeCheckResult {
  // Same system / material / diameter / floor
  if (a.material !== b.material) return { canMerge: false, reason: 'different material' };
  if (a.system !== b.system) return { canMerge: false, reason: 'different system' };
  if (Math.abs(a.portDiameterIn - b.portDiameterIn) > 1e-6) {
    return { canMerge: false, reason: 'different port diameter' };
  }
  if (Math.abs(a.floorY - b.floorY) > 0.05) {
    return { canMerge: false, reason: 'different floor elevation' };
  }

  // Combined port count within cap
  const combined = a.portCount + b.portCount;
  if (combined > MAX_PORT_COUNT) {
    return { canMerge: false, reason: `combined port count ${combined} exceeds max ${MAX_PORT_COUNT}` };
  }
  if (combined < 2) {
    return { canMerge: false, reason: 'not enough combined ports' };
  }

  // Parallel (yaw close, including 180° wrap — a manifold flipped end-for-end
  // is functionally identical). Normalize yaw to [0, π).
  const yawA = normalizeYaw(a.yawRad);
  const yawB = normalizeYaw(b.yawRad);
  const yawDiff = Math.abs(yawA - yawB);
  if (yawDiff > MERGE_YAW_TOLERANCE_RAD) {
    return { canMerge: false, reason: 'not parallel' };
  }

  // Colinearity + gap: project b's center onto a's length axis
  // and measure perpendicular distance.
  const cos = Math.cos(a.yawRad);
  const sin = Math.sin(a.yawRad);
  // a's length axis in world space: (cos, 0, -sin)  [remember Y is vertical,
  // and our atan2 convention has +Z = south, so local +X rotates into -sin in Z]
  const dx = b.center[0] - a.center[0];
  const dz = b.center[2] - a.center[2];
  const alongAxis = dx * cos + dz * -sin;    // projection onto a's +X
  const perpAxis  = dx * sin + dz * cos;     // perpendicular offset (= Z in a's frame)
  if (Math.abs(perpAxis) > MERGE_PERP_TOLERANCE_FT) {
    return { canMerge: false, reason: 'offset perpendicular to axis' };
  }

  // Which ends mate? Test both cross-pairs; pick the smallest gap.
  const [aLeft, aRight] = trunkEndpoints(a);
  const [bLeft, bRight] = trunkEndpoints(b);

  const pairs: Array<[Vec3, Vec3, 'left' | 'right', 'left' | 'right']> = [
    [aRight, bLeft, 'right', 'left'],
    [aLeft,  bRight, 'left',  'right'],
    [aRight, bRight, 'right', 'right'],
    [aLeft,  bLeft,  'left',  'left'],
  ];

  let bestGap = Infinity;
  let bestAEnd: 'left' | 'right' = 'right';
  let bestBEnd: 'left' | 'right' = 'left';
  for (const [pa, pb, ae, be] of pairs) {
    const g = Math.hypot(pa[0] - pb[0], pa[2] - pb[2]);
    if (g < bestGap) {
      bestGap = g;
      bestAEnd = ae;
      bestBEnd = be;
    }
  }

  // Silence the unused 'alongAxis' warning by noting we may use it in
  // a future follow-up (for directional merge hints).
  void alongAxis;

  if (bestGap > MERGE_SNAP_DISTANCE_FT) {
    return { canMerge: false, reason: 'endpoints too far apart', gapFt: bestGap };
  }

  return {
    canMerge: true,
    aEnd: bestAEnd,
    bEnd: bestBEnd,
    gapFt: bestGap,
  };
}

// ── Compute merged manifold ───────────────────────────────────

/**
 * Produce the single manifold that results from merging `a` and `b`.
 * Caller must have already verified `checkManifoldMerge(a, b).canMerge`.
 *
 * The merged manifold:
 *   - Inherits a's id (we never create a new id on merge — simpler for
 *     undo, and the user's selection follows the surviving entity).
 *   - Center is the midpoint of the two outer ends.
 *   - Yaw is a's yaw (both were parallel within tolerance).
 *   - portCount = a.portCount + b.portCount.
 *   - Other fields inherited from a (material, system, etc.).
 */
export function computeMerged(
  a: Manifold,
  b: Manifold,
  check: MergeCheckResult,
): Manifold {
  if (!check.canMerge) {
    throw new Error('computeMerged called with non-mergeable pair');
  }
  const [aLeft, aRight] = trunkEndpoints(a);
  const [bLeft, bRight] = trunkEndpoints(b);

  // The two "outer" ends are the endpoints NOT in the mating pair.
  const aOuter = check.aEnd === 'right' ? aLeft : aRight;
  const bOuter = check.bEnd === 'right' ? bLeft : bRight;

  const cx = (aOuter[0] + bOuter[0]) / 2;
  const cz = (aOuter[2] + bOuter[2]) / 2;

  return {
    ...a,
    center: [cx, a.center[1], cz],
    portCount: a.portCount + b.portCount,
  };
}

// ── Helpers ────────────────────────────────────────────────────

/** Wrap yaw to [0, π) — a manifold and its 180° flip are equivalent. */
function normalizeYaw(yaw: number): number {
  const wrapped = ((yaw % Math.PI) + Math.PI) % Math.PI;
  return wrapped;
}
