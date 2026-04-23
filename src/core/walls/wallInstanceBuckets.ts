/**
 * wallInstanceBuckets — pure bucketing for instanced wall rendering.
 *
 * Converts a wall list + visual-state inputs into pre-computed instance
 * data grouped by render state. The R3F renderer consumes the result
 * without further per-wall React work.
 *
 * Three output buckets:
 *
 *   full     — bright, interactive. Rendered as one InstancedMesh at
 *              `wallOpacity` with edge outlines.
 *   dim      — ghosted (off-floor), cutaway-hit, or walls-down mode.
 *              Rendered as a second InstancedMesh at a lower opacity.
 *              Not interactive.
 *   selected — the single wall under `selectedId`, if it survives the
 *              visibility filter. Rendered separately (non-instanced)
 *              so the gold edge highlight is easy.
 *
 * Walls that fail `wall.hidden || !floorParams.visible` are excluded
 * entirely — not in any bucket.
 *
 * This module is intentionally free of `react`, `three`, `@react-three/*`
 * and Zustand imports. Tests drive it directly with plain wall structs.
 * The R3F consumer imports it and feeds the result into instanced meshes.
 *
 * See `docs/adr/026-wall-instancing.md` for the design rationale.
 */

import type { Wall, WallType } from '@store/wallStore';

// ── Types ──────────────────────────────────────────────────────

/**
 * Subset of `FloorRenderParams` that the bucketer actually reads. Matches
 * what `getPipeFloorParams(yMin, yMax)` returns in `floorStore.ts` — but
 * typed independently so we don't pull the whole store module into tests.
 */
export interface FloorParams {
  visible: boolean;
  opacity: number;
  disableInteraction: boolean;
  colorOverride: string | null;
}

export type GetFloorParams = (yMin: number, yMax: number) => FloorParams;

export type RenderMode = 'walls-up' | 'walls-down' | 'cutaway';

/**
 * Everything the renderer needs to draw a single wall instance — pre-
 * computed in world space so the R3F component just uploads matrices.
 *
 * position/quaternion/scale compose into a `Matrix4` via `.compose()`,
 * applied to a unit box (1×1×1). Scale (length, height, thickness)
 * stretches the box to the wall's actual size.
 */
export interface WallInstance {
  wall: Wall;
  /** World-space center of the box (midpoint of segment at floorY + H/2). */
  position: [number, number, number];
  /** Quaternion for rotation around +Y; already wedge-signed so composer
   * matches the existing WallMesh orientation exactly. */
  quaternion: [number, number, number, number];
  /** Scale of the unit box: [length, height, thickness]. */
  scale: [number, number, number];
  /** Per-instance color (hex string). Usually the wall-type color. */
  color: string;
  /** Can the user click this wall to select it? Cutaway-dim + ghost are false. */
  interactive: boolean;
}

export interface BucketResult {
  full: WallInstance[];
  dim: WallInstance[];
  selected: WallInstance | null;
}

export interface BucketInput {
  walls: readonly Wall[];
  selectedId: string | null;
  cutawaySet: ReadonlySet<string>;
  renderMode: RenderMode;
  getFloorParams: GetFloorParams;
  /** WALL_TYPE_META lookup — injected for test injection; in prod pass the
   * real map. Keeps this module decoupled from @store/wallStore beyond types. */
  wallTypeColor: (type: WallType) => string;
}

// ── Main ───────────────────────────────────────────────────────

export function bucketWalls(input: BucketInput): BucketResult {
  const full: WallInstance[] = [];
  const dim: WallInstance[] = [];
  let selected: WallInstance | null = null;

  for (const wall of input.walls) {
    if (wall.hidden) continue;

    const fp = input.getFloorParams(wall.floorY, wall.floorY + wall.height);
    if (!fp.visible) continue;

    const instance = buildInstance(wall, fp, input.wallTypeColor);

    // Selected wall is its own bucket regardless of mode — the renderer
    // wants to treat it specially (non-instanced + highlight edges).
    if (wall.id === input.selectedId) {
      selected = instance;
      continue;
    }

    // Dim bucket conditions, in order of specificity:
    //   1. Off-floor ghost  (fp.opacity < 1)
    //   2. walls-down mode globally
    //   3. cutaway mode + in the cutaway set
    if (fp.opacity < 1) {
      instance.interactive = false;
      dim.push(instance);
      continue;
    }
    if (input.renderMode === 'walls-down') {
      dim.push(instance);
      continue;
    }
    if (input.renderMode === 'cutaway' && input.cutawaySet.has(wall.id)) {
      dim.push(instance);
      continue;
    }

    full.push(instance);
  }

  return { full, dim, selected };
}

// ── Internal: geometry for one wall ───────────────────────────

function buildInstance(
  wall: Wall,
  fp: FloorParams,
  wallTypeColor: (t: WallType) => string,
): WallInstance {
  const dx = wall.end[0] - wall.start[0];
  const dz = wall.end[1] - wall.start[1];
  const length = Math.sqrt(dx * dx + dz * dz);

  // Midpoint of the segment in XZ, plus floorY + height/2 in Y — this
  // matches the existing WallMesh's <group position={mid}> structure.
  const position: [number, number, number] = [
    (wall.start[0] + wall.end[0]) / 2,
    wall.floorY + wall.height / 2,
    (wall.start[1] + wall.end[1]) / 2,
  ];

  // Rotation around +Y by -atan2(dz, dx). Expressed as a quaternion
  // (axis=[0,1,0], half-angle = -angle/2) for clean matrix composition
  // without a second Three.js dep in this pure module.
  const angle = Math.atan2(dz, dx);
  const half = -angle / 2;
  const quaternion: [number, number, number, number] = [
    0, Math.sin(half), 0, Math.cos(half),
  ];

  const scale: [number, number, number] = [length, wall.height, wall.thickness];

  // Color: ghost colorOverride wins if present (tinted grey), otherwise
  // use the wall-type accent color.
  const color = fp.colorOverride ?? wallTypeColor(wall.type);

  return {
    wall,
    position,
    quaternion,
    scale,
    color,
    interactive: !fp.disableInteraction,
  };
}

// ── Helper: per-wall edge vertices in world space ─────────────

/**
 * 12 edges of a unit cube centered at origin. Each entry is a pair of
 * corner-indices into the 8 cube corners. Used by the renderer to
 * build a single merged LineSegments geometry spanning all walls in a
 * bucket — 1 draw call for all wall outlines per bucket.
 */
export const UNIT_BOX_CORNERS: readonly [number, number, number][] = [
  [-0.5, -0.5, -0.5], // 0
  [ 0.5, -0.5, -0.5], // 1
  [ 0.5,  0.5, -0.5], // 2
  [-0.5,  0.5, -0.5], // 3
  [-0.5, -0.5,  0.5], // 4
  [ 0.5, -0.5,  0.5], // 5
  [ 0.5,  0.5,  0.5], // 6
  [-0.5,  0.5,  0.5], // 7
];

export const UNIT_BOX_EDGES: readonly [number, number][] = [
  // Bottom square
  [0, 1], [1, 5], [5, 4], [4, 0],
  // Top square
  [3, 2], [2, 6], [6, 7], [7, 3],
  // Vertical connectors
  [0, 3], [1, 2], [5, 6], [4, 7],
];

/** Number of vertices per wall when serializing edges (12 edges × 2 verts). */
export const EDGE_VERTS_PER_WALL = UNIT_BOX_EDGES.length * 2;

/**
 * Write all 24 edge vertices for `instance` into `dst` starting at
 * offset `offset`. Each vertex is 3 floats. Returns the new offset
 * (offset + EDGE_VERTS_PER_WALL * 3).
 *
 * The caller allocates `dst` once with capacity EDGE_VERTS_PER_WALL × 3
 * × walls.length and reuses it across frames when only the color or
 * opacity changes (matrix stays the same until walls mutate).
 *
 * Inlined transform: for each corner, scale then rotate around Y then
 * translate to center. Cheaper than building a Matrix4 per wall (no
 * THREE.js dep here anyway).
 */
export function writeWallEdges(
  instance: WallInstance,
  dst: Float32Array,
  offset: number,
): number {
  const [cx, cy, cz] = instance.position;
  const [sx, sy, sz] = instance.scale;
  const [qx, qy, qz, qw] = instance.quaternion;

  // Precompute the Y-axis rotation matrix elements from the quaternion.
  // For a pure Y-axis rotation, the matrix is:
  //   [ cos θ    0    sin θ ]
  //   [   0     1       0   ]
  //   [ -sin θ  0    cos θ ]
  // where (sin θ/2, cos θ/2) = (qy, qw). We reconstruct sin θ and cos θ
  // via the half-angle identities: sin θ = 2·qy·qw, cos θ = 1 - 2·qy².
  // Works equally for positive and negative angles.
  const sinT = 2 * qy * qw;
  const cosT = 1 - 2 * qy * qy;
  void qx; void qz; // unused (axis is Y)

  for (const [aIdx, bIdx] of UNIT_BOX_EDGES) {
    const a = UNIT_BOX_CORNERS[aIdx]!;
    const b = UNIT_BOX_CORNERS[bIdx]!;
    // Scale → rotate around Y → translate, once per endpoint.
    offset = writeVert(dst, offset, a, sx, sy, sz, sinT, cosT, cx, cy, cz);
    offset = writeVert(dst, offset, b, sx, sy, sz, sinT, cosT, cx, cy, cz);
  }
  return offset;
}

function writeVert(
  dst: Float32Array,
  offset: number,
  v: readonly [number, number, number],
  sx: number, sy: number, sz: number,
  sinT: number, cosT: number,
  cx: number, cy: number, cz: number,
): number {
  const lx = v[0] * sx;
  const ly = v[1] * sy;
  const lz = v[2] * sz;
  // Y-axis rotation:
  //   x' =  cos θ * x + sin θ * z
  //   y' =  y
  //   z' = -sin θ * x + cos θ * z
  dst[offset++] = cosT * lx + sinT * lz + cx;
  dst[offset++] = ly + cy;
  dst[offset++] = -sinT * lx + cosT * lz + cz;
  return offset;
}
