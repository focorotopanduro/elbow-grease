/**
 * AngleSnap — constraint solver for plumbing geometry.
 *
 * Real plumbing can only turn at angles matching manufactured fittings:
 *   22.5° (1/16 bend), 45° (1/8 bend), 60° (1/6 bend),
 *   72° (1/5 bend), 90° (1/4 bend), plus 0° (straight).
 *
 * Drawing at any other angle is mathematically non-realizable without
 * either a custom-cut fitting (rare, expensive) or misalignment
 * (non-compliant). This solver enforces valid angles during drawing,
 * snapping the user's cursor to the nearest legal bend direction.
 *
 * Features:
 *   - Relative snapping: new segment snaps relative to previous direction
 *   - Absolute snapping: segments align to global orthographic axes
 *   - Hybrid mode: uses whichever snap is closer
 *   - Fitting-aware: only offers angles that have a real fitting in catalog
 *   - Tolerance zones: visible feedback when near snap vs when locked
 *   - Snap-back protocol: rejects invalid releases, reverts segment
 *
 * The solver works in 3D but respects the active drawing plane. On
 * the horizontal plane, snapping happens in XZ. On vertical planes,
 * it happens in XY or ZY depending on camera orientation.
 */

import { getStandardBendAngles } from '../../engine/catalog/FittingCatalog';
import type { PipeMaterial } from '../../engine/graph/GraphEdge';
import type { Vec3 } from '../events';

// ── Snap mode ───────────────────────────────────────────────────

export type SnapMode = 'relative' | 'absolute' | 'hybrid';

export interface SnapConfig {
  mode: SnapMode;
  /** Tolerance in radians within which we snap (default: 3°). */
  toleranceRad: number;
  /** Whether to allow 0° (straight continuation). */
  allowStraight: boolean;
  /** Custom snap angles (radians) to ADD to the catalog set. */
  customAngles: number[];
  /** Whether to allow reverse direction (180°, useful for U-turns). */
  allowReverse: boolean;
}

export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  mode: 'hybrid',
  toleranceRad: Math.PI / 60, // 3°
  allowStraight: true,
  customAngles: [],
  allowReverse: false,
};

// ── Snap result ─────────────────────────────────────────────────

export interface SnapResult {
  /** The snapped direction vector (normalized). */
  snappedDir: Vec3;
  /** The snapped angle (absolute, radians). */
  snappedAngleRad: number;
  /** Angle relative to the previous segment (radians). */
  relativeAngleRad: number;
  /** Whether the input was already within tolerance of a snap. */
  wasInTolerance: boolean;
  /** Residual error in radians between input and snapped output. */
  residualRad: number;
  /** Which snap rule locked the angle ("absolute-x", "relative-45", etc.). */
  snapLabel: string;
  /**
   * The closest standard bend fraction ("1/4", "1/8", "1/16", etc.)
   * that a fitting installed at this bend would use. Null if straight.
   */
  fittingFraction: string | null;
}

// ── Math helpers ────────────────────────────────────────────────

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len < 1e-10) return [1, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function angleBetween(a: Vec3, b: Vec3): number {
  const d = Math.max(-1, Math.min(1, dot(normalize(a), normalize(b))));
  return Math.acos(d);
}

/** Rotate 2D vector by angle θ in a specified plane. */
function rotateOnPlane(
  v: Vec3,
  angleRad: number,
  plane: 'xy' | 'xz' | 'zy',
): Vec3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  switch (plane) {
    case 'xz':
      return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c];
    case 'xy':
      return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
    case 'zy':
      return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
  }
}

// ── Snap set generation ─────────────────────────────────────────

/** The standard axis directions for absolute snapping (on XZ plane). */
const ABSOLUTE_AXES_XZ: Vec3[] = [
  [1, 0, 0],   // +X (east)
  [-1, 0, 0],  // -X (west)
  [0, 0, 1],   // +Z (south)
  [0, 0, -1],  // -Z (north)
];

/** Build the full set of valid relative angles from the fitting catalog. */
function buildRelativeSnapAngles(
  material: PipeMaterial,
  diameter: number,
  config: SnapConfig,
): number[] {
  const fromCatalog = getStandardBendAngles(material, diameter);
  const set = new Set<number>(fromCatalog);

  if (config.allowStraight) set.add(0);
  if (config.allowReverse) set.add(Math.PI);
  for (const a of config.customAngles) set.add(a);

  // Mirror for negative direction (bends can go either way)
  const out = new Set<number>();
  for (const a of set) {
    out.add(a);
    if (a > 0 && a < Math.PI) out.add(-a);
  }

  return [...out].sort((a, b) => a - b);
}

// ── Snap to relative angles ─────────────────────────────────────

/**
 * Snap a target direction vector so it makes a legal bend angle
 * relative to the previous segment's direction.
 */
function snapRelative(
  prevDir: Vec3,
  targetDir: Vec3,
  material: PipeMaterial,
  diameter: number,
  plane: 'xy' | 'xz' | 'zy',
  config: SnapConfig,
): { dir: Vec3; snapAngle: number; residual: number } {
  const snapAngles = buildRelativeSnapAngles(material, diameter, config);

  // Measure current angle between prev and target
  const currentAngle = angleBetween(prevDir, targetDir);

  // Determine rotation sign (left or right turn on plane)
  // Cross product sign tells us which way
  const cross = prevDir[0] * targetDir[2] - prevDir[2] * targetDir[0]; // y-component
  const signedAngle = cross >= 0 ? currentAngle : -currentAngle;

  // Find nearest snap
  let bestSnap = snapAngles[0] ?? 0;
  let bestDiff = Math.abs(signedAngle - bestSnap);
  for (const a of snapAngles) {
    const d = Math.abs(signedAngle - a);
    if (d < bestDiff) { bestDiff = d; bestSnap = a; }
  }

  // Build snapped direction by rotating prevDir by the snap angle
  const snappedDir = rotateOnPlane(prevDir, bestSnap, plane);

  return {
    dir: normalize(snappedDir),
    snapAngle: bestSnap,
    residual: bestDiff,
  };
}

// ── Snap to absolute axes ───────────────────────────────────────

function snapAbsolute(
  targetDir: Vec3,
  _plane: 'xy' | 'xz' | 'zy',
): { dir: Vec3; snapAngle: number; residual: number } {
  let best: Vec3 = ABSOLUTE_AXES_XZ[0]!;
  let bestDot = -Infinity;

  const n = normalize(targetDir);
  for (const axis of ABSOLUTE_AXES_XZ) {
    const d = dot(n, axis);
    if (d > bestDot) { bestDot = d; best = axis; }
  }

  const residual = Math.acos(Math.max(-1, Math.min(1, bestDot)));
  const snapAngle = Math.atan2(best[2], best[0]);

  return { dir: best, snapAngle, residual };
}

// ── Main snap function ──────────────────────────────────────────

/**
 * Snap a cursor direction to the nearest legal bend angle.
 *
 * @param prevDir — direction of the previous pipe segment (null if first segment)
 * @param targetDir — raw direction from cursor position
 * @param material — pipe material (determines available fittings)
 * @param diameter — pipe diameter in inches
 * @param plane — which plane to snap on
 * @param config — snap behavior config
 */
export function snapDirection(
  prevDir: Vec3 | null,
  targetDir: Vec3,
  material: PipeMaterial,
  diameter: number,
  plane: 'xy' | 'xz' | 'zy' = 'xz',
  config: SnapConfig = DEFAULT_SNAP_CONFIG,
): SnapResult {
  const tNorm = normalize(targetDir);

  // First segment: always absolute snap
  if (!prevDir) {
    const abs = snapAbsolute(tNorm, plane);
    return {
      snappedDir: abs.dir,
      snappedAngleRad: abs.snapAngle,
      relativeAngleRad: 0,
      wasInTolerance: abs.residual <= config.toleranceRad,
      residualRad: abs.residual,
      snapLabel: `absolute-${Math.round(abs.snapAngle * 180 / Math.PI)}°`,
      fittingFraction: null,
    };
  }

  // Subsequent segments: depends on mode
  let dir = tNorm;
  let snapLabel = 'free';
  let residual = 0;
  let relativeAngle = angleBetween(prevDir, tNorm);

  if (config.mode === 'relative') {
    const rel = snapRelative(prevDir, tNorm, material, diameter, plane, config);
    dir = rel.dir;
    residual = rel.residual;
    relativeAngle = rel.snapAngle;
    snapLabel = `relative-${Math.round(rel.snapAngle * 180 / Math.PI)}°`;
  } else if (config.mode === 'absolute') {
    const abs = snapAbsolute(tNorm, plane);
    dir = abs.dir;
    residual = abs.residual;
    relativeAngle = angleBetween(prevDir, abs.dir);
    snapLabel = `absolute-${Math.round(abs.snapAngle * 180 / Math.PI)}°`;
  } else {
    // Hybrid: choose whichever is closer
    const rel = snapRelative(prevDir, tNorm, material, diameter, plane, config);
    const abs = snapAbsolute(tNorm, plane);
    if (rel.residual <= abs.residual) {
      dir = rel.dir;
      residual = rel.residual;
      relativeAngle = rel.snapAngle;
      snapLabel = `relative-${Math.round(rel.snapAngle * 180 / Math.PI)}°`;
    } else {
      dir = abs.dir;
      residual = abs.residual;
      relativeAngle = angleBetween(prevDir, abs.dir);
      snapLabel = `absolute-${Math.round(abs.snapAngle * 180 / Math.PI)}°`;
    }
  }

  // Map to nearest fitting fraction
  const relAbs = Math.abs(relativeAngle);
  let fraction: string | null = null;
  if (relAbs < 0.01) fraction = 'straight';
  else if (Math.abs(relAbs - Math.PI / 8) < 0.01) fraction = '1/16';
  else if (Math.abs(relAbs - Math.PI / 4) < 0.01) fraction = '1/8';
  else if (Math.abs(relAbs - Math.PI / 3) < 0.01) fraction = '1/6';
  else if (Math.abs(relAbs - (2 * Math.PI) / 5) < 0.01) fraction = '1/5';
  else if (Math.abs(relAbs - Math.PI / 2) < 0.01) fraction = '1/4';

  return {
    snappedDir: dir,
    snappedAngleRad: Math.atan2(dir[2], dir[0]),
    relativeAngleRad: relativeAngle,
    wasInTolerance: residual <= config.toleranceRad,
    residualRad: residual,
    snapLabel,
    fittingFraction: fraction,
  };
}

// ── Snap position (endpoint calculation) ────────────────────────

/**
 * Given a starting point and a snapped direction, project the cursor
 * position onto the snapped line. This is how the snap feels "locked"
 * to the user — the endpoint slides along the constrained direction.
 */
export function projectOntoDirection(
  startPos: Vec3,
  cursorPos: Vec3,
  direction: Vec3,
): Vec3 {
  const dx = cursorPos[0] - startPos[0];
  const dy = cursorPos[1] - startPos[1];
  const dz = cursorPos[2] - startPos[2];

  // Project cursor delta onto the unit direction
  const t = dx * direction[0] + dy * direction[1] + dz * direction[2];

  return [
    startPos[0] + direction[0] * t,
    startPos[1] + direction[1] * t,
    startPos[2] + direction[2] * t,
  ];
}

/** Clamp a projected length to the nearest grid multiple for stability. */
export function snapLength(rawLength: number, gridSnap: number): number {
  return Math.round(rawLength / gridSnap) * gridSnap;
}

// ── Validation ──────────────────────────────────────────────────

/**
 * After the user releases the cursor, validate that the final angle
 * is actually within tolerance of a legal snap. Used by the snap-back
 * protocol to reject invalid placements.
 */
export function isLegalRelease(
  prevDir: Vec3 | null,
  finalDir: Vec3,
  material: PipeMaterial,
  diameter: number,
  plane: 'xy' | 'xz' | 'zy' = 'xz',
  config: SnapConfig = DEFAULT_SNAP_CONFIG,
): { legal: boolean; nearestSnap: SnapResult } {
  const snap = snapDirection(prevDir, finalDir, material, diameter, plane, config);
  return { legal: snap.wasInTolerance, nearestSnap: snap };
}
