/**
 * boxSelectMath — Phase 14.M
 *
 * Pure math for lasso / box-select: project world points through a
 * camera matrix into normalized device coords (NDC), map to screen
 * pixels, and test against a rectangle.
 *
 * The caller (BoxSelectOverlay) supplies the camera matrix + viewport
 * size; this module stays React-free + Three-free so the projection
 * logic is unit-testable with a plain 4×4 matrix.
 *
 * Projection math:
 *   1. Build a clip-space vec4: [x, y, z, 1]
 *   2. Multiply by camera.projectionMatrix · camera.matrixWorldInverse
 *   3. Divide by w → NDC vec3 in [-1, 1]³
 *   4. Map NDC.x,y to screen pixels:
 *        screenX = (ndc.x + 1) * 0.5 * viewportWidth
 *        screenY = (1 - ndc.y) * 0.5 * viewportHeight   (Y flips)
 *
 * Cull behind the camera: if the transformed z or w is ≤ 0, the point
 * is behind the camera and should not be considered for selection.
 */

import type { Vec3 } from '@core/events';

// ── Types ─────────────────────────────────────────────────────

/** 4×4 column-major matrix (Three.js / WebGL convention). */
export type Mat4 = readonly number[] & { length: 16 };

export interface ScreenRect {
  /** Pixel coords — any two opposite corners work; normalized internally. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface BoxSelectInput {
  /** combined projection · view matrix: camera.projectionMatrix ⨉ camera.matrixWorldInverse */
  worldToClip: Mat4;
  viewport: Viewport;
  rect: ScreenRect;
}

// ── Geometry helpers ──────────────────────────────────────────

/** Normalize any two opposite corners into a min/max pixel rect. */
export function normalizeRect(rect: ScreenRect): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(rect.x1, rect.x2),
    minY: Math.min(rect.y1, rect.y2),
    maxX: Math.max(rect.x1, rect.x2),
    maxY: Math.max(rect.y1, rect.y2),
  };
}

export function rectArea(rect: ScreenRect): number {
  const { minX, minY, maxX, maxY } = normalizeRect(rect);
  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}

// ── Projection ───────────────────────────────────────────────

/**
 * Project a world-space point through the combined world-to-clip
 * matrix. Returns null when the point is behind the camera (clip.w ≤ 0).
 *
 * WebGL/Three.js convention: column-major matrix; multiplication is
 * `result = M · v` where v is a column vector.
 */
export function projectToScreen(
  world: Vec3,
  worldToClip: Mat4,
  viewport: Viewport,
): { x: number; y: number } | null {
  const m = worldToClip;
  const x = world[0], y = world[1], z = world[2];
  // Column-major: v' = M · v where M is indexed m[col*4 + row].
  // Equivalently: row r = [m[r], m[r+4], m[r+8], m[r+12]] for THREE.Matrix4.elements.
  const cx = m[0]! * x + m[4]! * y + m[8]!  * z + m[12]!;
  const cy = m[1]! * x + m[5]! * y + m[9]!  * z + m[13]!;
  const cz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  if (cw <= 0) return null;          // behind (or on) camera plane
  if (cz < -cw || cz > cw) return null; // outside frustum on z
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  if (ndcX < -1 || ndcX > 1 || ndcY < -1 || ndcY > 1) return null; // off-screen
  return {
    x: (ndcX + 1) * 0.5 * viewport.width,
    y: (1 - ndcY) * 0.5 * viewport.height,
  };
}

// ── Hit test ─────────────────────────────────────────────────

/**
 * True if `world` projects into `rect`. Returns false for points
 * behind the camera or outside the viewport.
 */
export function pointInRect(world: Vec3, input: BoxSelectInput): boolean {
  const scr = projectToScreen(world, input.worldToClip, input.viewport);
  if (!scr) return false;
  const r = normalizeRect(input.rect);
  return scr.x >= r.minX && scr.x <= r.maxX && scr.y >= r.minY && scr.y <= r.maxY;
}

/**
 * True if ANY point in `points` lands inside `rect`. Used for pipes:
 * a pipe is considered selected if any of its polyline points projects
 * into the lasso rectangle. This is the "conservative" selection rule —
 * a pipe crossing the rectangle with only its middle inside WON'T be
 * caught (a v2 line-segment-rectangle test would fix this), but the
 * user can always enlarge the lasso or click the pipe directly.
 */
export function anyPointInRect(points: readonly Vec3[], input: BoxSelectInput): boolean {
  for (const pt of points) {
    if (pointInRect(pt, input)) return true;
  }
  return false;
}

// ── Bulk filter ──────────────────────────────────────────────

export interface BulkFilterInput extends BoxSelectInput {
  pipes: ReadonlyArray<{ id: string; points: readonly Vec3[] }>;
  fixtures: ReadonlyArray<{ id: string; position: Vec3 }>;
}

export interface BulkFilterResult {
  pipeIds: string[];
  fixtureIds: string[];
}

export function filterEntitiesInRect(input: BulkFilterInput): BulkFilterResult {
  const pipeIds: string[] = [];
  const fixtureIds: string[] = [];
  for (const p of input.pipes) {
    if (anyPointInRect(p.points, input)) pipeIds.push(p.id);
  }
  for (const f of input.fixtures) {
    if (pointInRect(f.position, input)) fixtureIds.push(f.id);
  }
  return { pipeIds, fixtureIds };
}
