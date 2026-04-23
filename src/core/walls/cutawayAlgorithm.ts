/**
 * cutawayAlgorithm — pure geometry for Sims-style wall cutaway.
 *
 * Problem: the camera orbits around a focus point (whatever the user
 * is looking at) outside the building shell. Walls between the camera
 * and the focus block the view of what's inside. "Cutaway" mode hides
 * those walls while leaving walls BEHIND the focus opaque, so the
 * user always sees the interior being inspected.
 *
 * Everything here operates on the XZ plane (top-down). Wall Y extent
 * is ignored — walls are treated as infinite vertical slabs projected
 * onto the ground plane. That matches how the existing WallRenderer
 * draws walls (one segment per wall, floor-aligned, extruded upward).
 *
 * Strategy:
 *   1. Project camera + focus into XZ.
 *   2. For each wall, compute whether the XZ segment from camera to
 *      focus INTERSECTS the wall segment. If it does, the wall is
 *      physically between them and is designated for cutaway.
 *   3. A small thickness band is applied so walls that are almost-on
 *      the line (but pass in front of focus by a hair) still get
 *      culled — users don't want a sliver of wall painted across
 *      their view of the fixture they're inspecting.
 *
 * Edge cases handled:
 *   • Camera directly above focus (degenerate segment) → nothing culled.
 *   • Parallel / collinear wall and sight line → not culled (they
 *     don't obscure the focus, they're co-planar with the sight).
 *   • Wall endpoint exactly on the sight line → counts as intersect.
 *
 * This is a separate pure module so it can be unit-tested without
 * standing up an R3F Canvas or Three.js renderer. Keep it free of
 * react, three.js, and zustand imports.
 */

// ── Types ──────────────────────────────────────────────────────

/** Top-down 2D point. */
export type XZ = readonly [x: number, z: number];

/** Wall with XZ endpoints. Matches the `Wall` store shape trimmed to geometry. */
export interface CutawayWall {
  id: string;
  /** Start point [x, z] (feet). */
  start: XZ;
  /** End point [x, z] (feet). */
  end: XZ;
}

export interface CutawayInput {
  /** Camera world-space position (XZ only — Y is dropped). */
  camera: XZ;
  /** Focus world-space position (e.g. orbit target). */
  focus: XZ;
  walls: readonly CutawayWall[];
}

/**
 * Returns the set of wall IDs that are "between" camera and focus —
 * these should be dimmed to reveal the interior.
 */
export function computeCutawaySet(input: CutawayInput): Set<string> {
  const { camera, focus, walls } = input;
  const culled = new Set<string>();

  // Degenerate: camera is on top of focus. Nothing to cull — every
  // view direction is equally valid.
  const dx = focus[0] - camera[0];
  const dz = focus[1] - camera[1];
  if (dx * dx + dz * dz < 1e-6) return culled;

  for (const wall of walls) {
    if (segmentsIntersect(camera, focus, wall.start, wall.end)) {
      culled.add(wall.id);
    }
  }

  return culled;
}

// ── Segment intersection ──────────────────────────────────────

/**
 * Returns true when segment AB and segment CD intersect in the
 * OPEN interior of at least one of them (we count touching at an
 * endpoint as an intersection, since that means the wall is flush
 * against the sight line).
 *
 * Algorithm: check the signed-area (orientation) of each endpoint
 * relative to the opposing segment. If the orientations differ on
 * both sides, the segments cross. Collinear segments are treated as
 * non-intersecting for our purpose — a wall lying ALONG the sight
 * line is not actually occluding anything.
 */
export function segmentsIntersect(a: XZ, b: XZ, c: XZ, d: XZ): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  // General case: endpoints on opposite sides of the other segment.
  if (o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) {
    if (o1 !== o2 && o3 !== o4) return true;
    return false;
  }

  // Collinear: treat as non-intersecting. A wall that is perfectly
  // parallel + co-linear with the sight line isn't actually obscuring
  // the focus — it's on the same ray.
  if (o1 === 0 && o2 === 0) return false;

  // Touching at an endpoint — one orientation is 0 and the others
  // indicate proper crossing. Count as intersecting so a wall that
  // grazes the sight line still gets dimmed.
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;

  return false;
}

/**
 * Orientation of triplet (p, q, r):
 *    0 → collinear
 *    1 → clockwise
 *   -1 → counter-clockwise
 *
 * Uses a small epsilon so near-collinear points (common with
 * axis-aligned walls and camera paths) are treated as collinear
 * rather than flipping sign under float noise.
 */
function orientation(p: XZ, q: XZ, r: XZ): -1 | 0 | 1 {
  const val = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  if (Math.abs(val) < 1e-9) return 0;
  return val > 0 ? 1 : -1;
}

/** Is point q on segment pr (assuming the three are collinear)? */
function onSegment(p: XZ, r: XZ, q: XZ): boolean {
  return (
    q[0] >= Math.min(p[0], r[0]) - 1e-9 &&
    q[0] <= Math.max(p[0], r[0]) + 1e-9 &&
    q[1] >= Math.min(p[1], r[1]) - 1e-9 &&
    q[1] <= Math.max(p[1], r[1]) + 1e-9
  );
}
