/**
 * Isometric projection helpers — pure 3D-world → 2D-screen math.
 *
 * Convention:
 *   World axes: +X = building width (right), +Y = building depth (into page),
 *               +Z = up.
 *   Screen: SVG coordinates, Y-axis pointing DOWN.
 *
 * Projection (axes 30° from horizontal — true isometric):
 *   sx = (X − Y) · cos30
 *   sy = (X + Y) · sin30 − Z
 *
 * That puts +X going right-and-down, +Y going left-and-down, +Z going
 * straight up — i.e. we're viewing the building from upper-right-front.
 *
 * The result is then scaled and translated so the house sits centered in
 * the 800×480 SVG viewBox.
 */

const COS30 = 0.866025;
const SIN30 = 0.5;

/** World-space → SVG-space scale. 1 unit = 1 SVG px after projection. */
export const ISO_SCALE = 1;

/** Where the world origin (0,0,0) lands on screen. */
export const ISO_ORIGIN_X = 360;
export const ISO_ORIGIN_Y = 280;

export type Pt3 = [number, number, number];

/** Project a single 3D world point to 2D SVG coordinates. */
export function iso(x: number, y: number, z: number): [number, number] {
  const sx = (x - y) * COS30 * ISO_SCALE + ISO_ORIGIN_X;
  const sy = ((x + y) * SIN30 - z) * ISO_SCALE + ISO_ORIGIN_Y;
  return [sx, sy];
}

/** Convenience: project a Pt3 tuple. */
export function isoP(p: Pt3): [number, number] {
  return iso(p[0], p[1], p[2]);
}

/**
 * Build an SVG `points="x,y x,y …"` attribute string from a list of
 * world-space corners. Used by every polygon in the iso scene.
 */
export function pts(...corners: Pt3[]): string {
  return corners
    .map((p) => {
      const [sx, sy] = isoP(p);
      return `${sx.toFixed(1)},${sy.toFixed(1)}`;
    })
    .join(' ');
}

/**
 * Canonical building dimensions (world units = SVG px after projection).
 * Centralised so every iso layer (house, roof, annotations) reads from one
 * source — change a number here, every component shifts coherently.
 *
 * These are scaled to fit the same visual footprint as the front view.
 */
export const ISO_DIMS = {
  /** Main house — width (X), depth (Y), wall height (Z) */
  mainW: 220,
  mainD: 150,
  mainH: 96,
  /** Gable rise above wall top */
  roofR: 56,
  /** Garage attached on the LEFT (negative X) */
  garageW: 92,   // garage width (extends from x=-92 to x=0)
  garageD: 110,  // garage depth (typically shallower than main)
  garageH: 78,
  garageR: 38,
  /** Foundation height (extends from z=−foundH to z=0) */
  foundH: 9,
  /** Front door footprint (x range on the front face, height) */
  doorX0: 84,
  doorX1: 116,
  doorH: 72,
  /** Window dimensions (each on the front face) */
  winY0: 26,    // window sill height above floor
  winY1: 76,    // window head
  /** Left window x-range, right window x-range on front face */
  winLX0: 18,
  winLX1: 58,
  winRX0: 142,
  winRX1: 182,
  /** Chimney (sits on roof) */
  chimX: 145,
  chimDepthY: 60,
  chimW: 18,
  chimD: 18,
  chimH: 38,    // sticks up from roof eave height
} as const;
