/**
 * Roof Graph Model — Phase 14.R.1.
 *
 * Port of AROYH's `roof_graph.py` (620 LOC) to TypeScript. The
 * central data types + pure geometry functions for the roofing
 * CAD application. Paired with `src/store/roofStore.ts` which
 * holds the mutation layer (CRUD + undo + observers) in a
 * Zustand store matching the existing `pipeStore` pattern.
 *
 * Design choice: PURE TYPES + PURE FUNCTIONS here (no classes, no
 * internal state). Every "derived property" on the Python
 * `RoofSection` dataclass becomes an exported function taking a
 * `RoofSection` record. Rationale:
 *
 *   1. Easier to test — each function is data-in/data-out.
 *   2. Composable — callers pick exactly the fields they need.
 *   3. Tree-shakable — functions not used by a given view drop.
 *   4. Zustand-native — section records store cleanly in the
 *      store without needing `class` rehydration on load.
 *
 * Source reference:
 *   C:\LOVEDECIDES\WiLeads\elbow_grease\roofing\roof_graph.py
 */

// ── Types ────────────────────────────────────────────────────────

/** Roof type — determines 3D vertex topology + edge classification. */
export type RoofType = 'gable' | 'hip' | 'shed' | 'flat';

/** Section-type label drives palette + BOM categorization. */
export type SectionType =
  | 'main_roof'
  | 'wing'
  | 'garage'
  | 'porch'
  | 'dormer'
  | 'other';

/** Drawable view for 2D projections + hit testing. */
export type RoofView = 'top' | 'front' | 'side';

/** Edge classification for styled rendering + BOM.
 *
 *   eave   — drip edge along the roof's low perimeter
 *   ridge  — horizontal line at the top of a rect hip / gable
 *   rake   — sloped gable end edge
 *   hip    — sloped edge from corner to ridge on a hip roof
 *   slope  — generic slope edge (not classified as above)
 *   valley — Phase 14.R.13: diagonal interior ridge at a concave
 *            corner (L/T/U hip). Runs from the reflex polygon vertex
 *            up to where the adjacent sub-rect ridges meet; gets its
 *            own BOM line (valley metal flashing) in real framing.
 */
export type EdgeType = 'eave' | 'ridge' | 'rake' | 'hip' | 'slope' | 'valley';

/** Face classification for surface colors + solar/shade analysis. */
export type FaceType =
  | 'flat'
  | 'slope'
  | 'slope_near'
  | 'slope_far'
  | 'gable_left'
  | 'gable_right'
  | 'hip_left'
  | 'hip_right';

export interface RoofVertex {
  vertexId: string;
  x: number;
  y: number;
  label: string;
}

export interface RoofSection {
  sectionId: string;
  label: string;
  // Plan rectangle (before rotation). When `polygon` is set the
  // rectangle is still populated as the polygon's axis-aligned
  // bounding box, so the rect-only code paths (legacy exports,
  // hit-testing cache, thumbnails) degrade gracefully.
  x: number;
  y: number;
  length: number;
  run: number;
  rotation: number; // degrees CCW from +X
  // Slope + type
  slope: number;    // X in 12
  roofType: RoofType;
  sectionType: SectionType;
  overhang: number; // feet
  // Elevation
  z: number;        // feet above grade
  // Waste overrides
  wastePct: number;
  // Visual
  colorIdx: number; // palette index
  locked: boolean;
  /**
   * Phase 14.R.9 — polygon footprint. When present, this overrides
   * the rect-derived corners for geometry, hit testing, area, and
   * perimeter. Currently treated as FLAT-roof only by the 3D
   * renderer + aggregator (hip/gable/shed over an irregular polygon
   * is a framing problem we defer to a later phase). Vertices are
   * stored in world XZ (plan) coords, NOT rotated — `rotation`
   * stays 0 for polygon sections.
   */
  polygon?: ReadonlyArray<readonly [number, number]>;
  /**
   * Phase 14.R.20 — override the gable-ridge / shed-tilt axis angle
   * (degrees CCW from +X). When present, `computePolygonGable` and
   * `computePolygonShed` use this instead of the bbox-derived
   * auto-pick. Lets a contractor align a gable ridge with the
   * building's architectural grain even when the bbox suggests a
   * different orientation. Ignored for polygon + flat / hip.
   */
  roofAxisOverrideDeg?: number;
}

export interface MeasureLine {
  lineId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
}

/**
 * Phase 14.R.27 — spatial roof penetrations.
 *
 * A `RoofPenetration` is a chimney, skylight, or plumbing vent
 * placed on the plan at a specific XY. It drives the estimator's
 * scalar counts (`chimney_count`, `skylight_count`,
 * `plumbing_vent_count`) automatically — when any spatial
 * penetrations exist for a kind, the aggregator derives the count
 * from them instead of reading the manual form input. This lets a
 * contractor click-place features on a blueprint and have the
 * flashing / boot material quantities follow.
 *
 * Coordinates are in plan-XY feet, same frame as `RoofVertex`.
 * `widthFt` and `lengthFt` describe the penetration's footprint —
 * currently used only for visual rendering, not for
 * shingle-deduction (a small reveal cut is negligible against the
 * existing waste % allowance; we may revisit in a later phase if
 * users report under-order on skylight-heavy jobs).
 */
export type PenetrationKind = 'chimney' | 'skylight' | 'plumbing_vent';

export interface RoofPenetration {
  id: string;
  kind: PenetrationKind;
  /** Plan-X, feet (same frame as RoofVertex.x). */
  x: number;
  /** Plan-Y, feet (same frame as RoofVertex.y). */
  y: number;
  /** Footprint width (X extent, feet). */
  widthFt: number;
  /** Footprint length (Y extent, feet). */
  lengthFt: number;
  label: string;
}

/**
 * Kind-specific default footprints (feet). Based on typical
 * residential-FL values:
 *   • Plumbing vent: a 3"–4" stack with 6" flashing boot.
 *   • Skylight: common 2x4 "standard" curb-mount.
 *   • Chimney: small-masonry single-flue.
 */
export const PENETRATION_DEFAULTS: Record<PenetrationKind, { widthFt: number; lengthFt: number }> = {
  plumbing_vent: { widthFt: 0.5, lengthFt: 0.5 },
  skylight:      { widthFt: 2.0, lengthFt: 4.0 },
  chimney:       { widthFt: 3.0, lengthFt: 3.0 },
};

/** Human-readable label prefix used when auto-generating labels. */
export const PENETRATION_LABELS: Record<PenetrationKind, string> = {
  plumbing_vent: 'Vent',
  skylight:      'Skylight',
  chimney:       'Chimney',
};

/**
 * Construct a RoofPenetration with sensible per-kind defaults for
 * size + label. Partial overrides win over the defaults.
 */
export function createPenetration(
  overrides: Partial<RoofPenetration> & { id: string; kind: PenetrationKind; x: number; y: number },
): RoofPenetration {
  const defaults = PENETRATION_DEFAULTS[overrides.kind];
  return {
    widthFt: defaults.widthFt,
    lengthFt: defaults.lengthFt,
    label: PENETRATION_LABELS[overrides.kind],
    ...overrides,
  };
}

/**
 * Tally penetrations by kind. Used by the FL aggregator to override
 * the project input's scalar counts when the user has placed
 * spatial markers. Returns zero counts for kinds that have no
 * placements, so callers can fall back to the manual-entry value
 * by passing these through `Math.max(manual, spatial)` or similar.
 */
export function penetrationCounts(
  penetrations: ReadonlyArray<RoofPenetration>,
): Record<PenetrationKind, number> {
  const out: Record<PenetrationKind, number> = {
    plumbing_vent: 0,
    skylight: 0,
    chimney: 0,
  };
  for (const p of penetrations) {
    out[p.kind] += 1;
  }
  return out;
}

export interface PDFLayer {
  pdfPath: string;
  page: number;
  // Calibration: two known points + known distance
  calX1: number;
  calY1: number;
  calX2: number;
  calY2: number;
  calDistanceFt: number;
  // Transform
  offsetX: number;
  offsetY: number;
  scale: number;    // pixels per foot
  opacity: number;
  visible: boolean;
  locked: boolean;
  // Phase 14.R.5 — rendered-image carrier. Optional so pre-R.5
  // snapshots + tests that construct a PDFLayer by hand continue
  // to work. Populated by `roofStore.loadPdfImage()` after a
  // `renderPdfPage()` finishes asynchronously.
  imageDataUrl?: string; // PNG data URL of the rendered page
  widthPx?: number;      // pixel width of the rendered image
  heightPx?: number;     // pixel height
  fileName?: string;     // source filename — shown in the UI panel
  rotationDeg?: number;  // ground-plane rotation (default 0)
}

export interface LayerInfo {
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
}

/** Canonical serialization shape for the entire roof graph. */
export interface RoofGraphSnapshot {
  sections: Record<string, RoofSection>;
  vertices: Record<string, RoofVertex>;
  measures: Record<string, MeasureLine>;
  layers: LayerInfo[];
  pdf: PDFLayer;
  /**
   * Phase 14.R.27 — spatial penetrations. Optional on the snapshot
   * so pre-R.27 bundles continue to load without migration (the
   * apply path defaults missing fields to empty objects / arrays).
   */
  penetrations?: Record<string, RoofPenetration>;
  penetrationOrder?: string[];
}

// ── Defaults ─────────────────────────────────────────────────────

export const DEFAULT_LAYERS: LayerInfo[] = [
  { name: 'PDF Blueprint', visible: true,  locked: true,  opacity: 0.30 },
  { name: 'Measurements',  visible: true,  locked: false, opacity: 1.00 },
  { name: 'Roof Sections', visible: true,  locked: false, opacity: 0.85 },
  { name: 'Ridge / Hip',   visible: true,  locked: true,  opacity: 0.70 },
  { name: 'Annotations',   visible: true,  locked: false, opacity: 1.00 },
];

export function emptyPdfLayer(): PDFLayer {
  return {
    pdfPath: '',
    page: 0,
    calX1: 0, calY1: 0, calX2: 0, calY2: 0,
    calDistanceFt: 0,
    offsetX: 0, offsetY: 0,
    scale: 1,
    opacity: 0.3,
    visible: true,
    // Phase 14.R.5: default to UNLOCKED so the user can move/rotate/
    // calibrate a fresh PDF without an extra "unlock" step. Matches
    // contractor expectation of drop-pdf → tweak-position.
    locked: false,
    rotationDeg: 0,
  };
}

/**
 * Phase 14.R.5 — derive the PDF plane's physical footprint (feet)
 * from its pixel dimensions and calibration scale. Returns null when
 * the image hasn't loaded yet or scale is non-positive.
 */
export function pdfPhysicalSize(
  pdf: Pick<PDFLayer, 'widthPx' | 'heightPx' | 'scale'>,
): { widthFt: number; depthFt: number } | null {
  if (!pdf.widthPx || !pdf.heightPx) return null;
  if (pdf.scale <= 0) return null;
  return {
    widthFt: pdf.widthPx / pdf.scale,
    depthFt: pdf.heightPx / pdf.scale,
  };
}

/**
 * Phase 14.R.5 — recompute the `scale` when the user has two WORLD
 * points (ft, ft in ground-plane coords) they want to be `realFt`
 * apart. Accounts for the fact that the world distance under the
 * CURRENT scale doesn't equal the real one.
 *
 *   pxDist     = worldDist * currentScale
 *   newScale   = pxDist / realFt
 *            = worldDist * currentScale / realFt
 *
 * Unchanged when realFt ≤ 0 or the two points coincide — matches
 * the behavior of `calibratePdf()` for its degenerate inputs.
 */
export function rescaleFromWorldPoints(
  currentScale: number,
  w1: readonly [number, number],
  w2: readonly [number, number],
  realFt: number,
): number {
  if (realFt <= 0) return currentScale;
  const dx = w2[0] - w1[0];
  const dy = w2[1] - w1[1];
  const worldDist = Math.sqrt(dx * dx + dy * dy);
  if (worldDist <= 0) return currentScale;
  const pxDist = worldDist * currentScale;
  if (pxDist <= 0) return currentScale;
  return pxDist / realFt;
}

export function createSection(
  overrides: Partial<RoofSection> & { sectionId: string; x: number; y: number },
): RoofSection {
  return {
    label: 'Section',
    length: 30,
    run: 15,
    rotation: 0,
    slope: 6,
    roofType: 'gable',
    sectionType: 'main_roof',
    overhang: 1,
    z: 0,
    wastePct: 15,
    colorIdx: 0,
    locked: false,
    ...overrides,
  };
}

// ── Pure geometry — derived section properties ──────────────────

export function slopeFactorOf(sec: Pick<RoofSection, 'slope'>): number {
  if (sec.slope <= 0) return 1;
  return Math.sqrt(1 + (sec.slope / 12) ** 2);
}

export function adjLength(sec: Pick<RoofSection, 'length' | 'overhang'>): number {
  return sec.length + 2 * sec.overhang;
}

export function adjRun(sec: Pick<RoofSection, 'run' | 'overhang'>): number {
  return sec.run + 2 * sec.overhang;
}

export function areaPlan(
  sec: Pick<RoofSection, 'length' | 'run' | 'overhang' | 'polygon'>,
): number {
  // Phase 14.R.9 — when a polygon footprint is present it IS the
  // plan geometry; overhang becomes a fascia/drip concern rather
  // than a dimensional expansion (we'd need per-edge normals to
  // offset a polygon by `overhang` feet correctly). Treating
  // polygons as overhang-zero for area is an acceptable compromise
  // for R.9 since contractor intuition for custom footprints is
  // "draw the ACTUAL roof edge, then list drip-edge by perimeter".
  if (hasPolygon(sec)) return polygonArea(sec.polygon);
  return adjLength(sec) * adjRun(sec);
}

export function areaActual(
  sec: Pick<RoofSection, 'length' | 'run' | 'overhang' | 'slope' | 'polygon'>,
): number {
  return areaPlan(sec) * slopeFactorOf(sec);
}

export function perimeterPlan(
  sec: Pick<RoofSection, 'length' | 'run' | 'overhang' | 'polygon'>,
): number {
  if (hasPolygon(sec)) return polygonPerimeter(sec.polygon);
  return 2 * (adjLength(sec) + adjRun(sec));
}

export function rise(sec: Pick<RoofSection, 'slope' | 'run'>): number {
  return (sec.slope / 12) * (sec.run / 2);
}

export function commonRafter(sec: Pick<RoofSection, 'slope' | 'run' | 'overhang'>): number {
  return (sec.run / 2 + sec.overhang) * slopeFactorOf(sec);
}

export function ridgeLength(
  sec: Pick<RoofSection, 'length' | 'run' | 'overhang' | 'roofType'>,
): number {
  if (sec.roofType === 'hip') {
    return Math.max(adjLength(sec) - adjRun(sec), 0);
  }
  return adjLength(sec);
}

export function roofAngleDeg(sec: Pick<RoofSection, 'slope'>): number {
  if (sec.slope <= 0) return 0;
  return (Math.atan(sec.slope / 12) * 180) / Math.PI;
}

// ── Polygon helpers (R.9) ───────────────────────────────────────

/**
 * Shoelace area for an ordered polygon. Returns a positive number
 * regardless of winding direction, so callers don't have to guess
 * CCW vs CW. Zero for degenerate (< 3 vertices).
 */
export function polygonArea(poly: ReadonlyArray<readonly [number, number]>): number {
  if (poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** Sum of edge lengths around the polygon. */
export function polygonPerimeter(
  poly: ReadonlyArray<readonly [number, number]>,
): number {
  if (poly.length < 2) return 0;
  let per = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    per += Math.hypot(x2 - x1, y2 - y1);
  }
  return per;
}

/** Axis-aligned bounding box of a polygon. Returns null for empty. */
export function polygonBoundingBox(
  poly: ReadonlyArray<readonly [number, number]>,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (poly.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** True when this section is stored as an explicit polygon. */
export function hasPolygon(
  sec: Pick<RoofSection, 'polygon'>,
): sec is typeof sec & { polygon: ReadonlyArray<readonly [number, number]> } {
  return Array.isArray(sec.polygon) && sec.polygon.length >= 3;
}

/**
 * Phase 14.R.11 — convexity test. Returns true when all consecutive
 * cross products of edge vectors share the same sign (strictly
 * non-zero). Degenerate inputs (<3 vertices, all collinear) return
 * false. Used to gate the polygon-hip pyramid rendering: the apex
 * sits at the centroid, which for concave polygons (L / U / T)
 * can lie outside the polygon — producing inverted / self-intersecting
 * faces. Concave-polygon hip is a separate phase (straight skeleton).
 */
export function isConvexPolygon(
  poly: ReadonlyArray<readonly [number, number]>,
): boolean {
  const n = poly.length;
  if (n < 3) return false;
  let firstSign = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = poly[i]!;
    const [bx, by] = poly[(i + 1) % n]!;
    const [cx, cy] = poly[(i + 2) % n]!;
    const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (cross !== 0) {
      if (firstSign === 0) {
        firstSign = Math.sign(cross);
      } else if (Math.sign(cross) !== firstSign) {
        return false;
      }
    }
  }
  // All cross products had the same sign (or were zero). If every
  // single one was zero (degenerate collinear polygon) firstSign is
  // still 0 — not a real convex polygon.
  return firstSign !== 0;
}

// ── Rectilinear decomposition (R.12) ────────────────────────────

/**
 * Phase 14.R.12 — true when every edge of the polygon is axis-aligned
 * (horizontal or vertical). Matches L / T / U / cross shapes and any
 * orthogonal concave footprint the user traces from a blueprint PDF.
 * Rotated rectangles or polygons with diagonal edges return false.
 *
 * Tolerance is zero — polygon vertices arrive from `snapToGrid()` at
 * 0.5 ft resolution, so exact equality on one axis is the right
 * discriminator. Allowing floating-point slack here would collapse
 * near-rectilinear-but-not-actually shapes into the hip path and
 * produce subtly wrong ridges.
 */
export function isRectilinearPolygon(
  poly: ReadonlyArray<readonly [number, number]>,
): boolean {
  if (poly.length < 4) return false;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i]!;
    const p2 = poly[(i + 1) % poly.length]!;
    // Edge must have zero change in exactly one axis.
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    if (dx !== 0 && dy !== 0) return false;
    if (dx === 0 && dy === 0) return false; // degenerate zero-length
  }
  return true;
}

/**
 * Phase 14.R.12 — horizontal-strip decomposition of a rectilinear
 * polygon into axis-aligned sub-rectangles. Returns [] when the
 * polygon isn't rectilinear.
 *
 * Algorithm:
 *   1. Collect every distinct y-coordinate from the polygon vertices.
 *   2. For each consecutive (y_lo, y_hi) strip, find all vertical
 *      polygon edges that SPAN the strip (their min-y ≤ y_lo and
 *      their max-y ≥ y_hi).
 *   3. Those edges' x-coordinates, sorted left-to-right, pair off
 *      into "inside" intervals — each pair is one sub-rectangle for
 *      this strip.
 *
 * This produces the textbook rectangle decomposition for L / T / U /
 * cross / staircase shapes, with the number of sub-rects bounded by
 * (N − 2) for a polygon with N vertices on a simple rectilinear
 * polygon. Odd crossing counts indicate a malformed polygon and are
 * handled by ignoring the trailing unpaired vertex.
 */
export interface AxisRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function decomposeRectilinearPolygon(
  poly: ReadonlyArray<readonly [number, number]>,
): AxisRect[] {
  if (!isRectilinearPolygon(poly)) return [];

  // 1. Unique sorted y values.
  const ySet = new Set<number>();
  for (const [, y] of poly) ySet.add(y);
  const ys = Array.from(ySet).sort((a, b) => a - b);
  if (ys.length < 2) return [];

  const rects: AxisRect[] = [];

  // Pre-extract vertical edges as [x, yMin, yMax] triples.
  const verticals: Array<[number, number, number]> = [];
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i]!;
    const p2 = poly[(i + 1) % poly.length]!;
    if (p1[0] !== p2[0]) continue; // not vertical
    const yMin = Math.min(p1[1], p2[1]);
    const yMax = Math.max(p1[1], p2[1]);
    verticals.push([p1[0], yMin, yMax]);
  }

  for (let i = 0; i < ys.length - 1; i++) {
    const y0 = ys[i]!;
    const y1 = ys[i + 1]!;
    // Edges spanning the strip (inclusive of endpoints — rectilinear
    // polygon vertices always fall exactly on the strip boundaries).
    const xs: number[] = [];
    for (const [x, yMin, yMax] of verticals) {
      if (yMin <= y0 && yMax >= y1) xs.push(x);
    }
    xs.sort((a, b) => a - b);
    // Pair left-right for "inside" intervals.
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = xs[k]!;
      const x1 = xs[k + 1]!;
      if (x1 > x0) {
        rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
    }
  }
  return rects;
}

/**
 * Phase 14.R.12 — roof-rendering mode for polygon sections. Drives
 * the branches in `vertices3d` / `edges3d` / `faces3d` and in the
 * FL aggregator's `projectForSection`. Callers can cache the result
 * (same polygon → same mode).
 *
 *   'pyramid'           → convex polygon + hip: single centroid apex (R.11)
 *   'rectilinear-union' → rectilinear concave + hip: decompose into
 *                         sub-rects, each rendered as a rect-hip (R.12)
 *   'flat'              → everything else (non-convex non-rectilinear
 *                         polygon + hip, or any polygon + gable / shed
 *                         / flat — treated as flat at elevation z)
 */
export type PolygonRoofMode =
  | 'pyramid'
  | 'rectilinear-union'
  | 'skeleton-single-reflex'
  | 'skeleton-multi-reflex'
  | 'gable-ridge-auto'
  | 'skeleton-gable'
  | 'shed-auto'
  | 'flat';

export function classifyPolygonRoof(
  sec: Pick<RoofSection, 'polygon' | 'roofType' | 'roofAxisOverrideDeg'>,
): PolygonRoofMode {
  if (!hasPolygon(sec)) return 'flat';
  if (sec.roofType === 'hip') {
    if (isConvexPolygon(sec.polygon)) return 'pyramid';
    if (isRectilinearPolygon(sec.polygon)) return 'rectilinear-union';
    // Phase 14.R.14 — non-rectilinear concave with exactly 1 reflex
    // vertex is handled by splitting along the reflex bisector into
    // two convex sub-polygons. Only classify this way if the split
    // actually succeeds (both halves convex).
    const singleSplit = polygonSplitAtReflexBisector(sec.polygon);
    if (singleSplit) return 'skeleton-single-reflex';
    // Phase 14.R.15 — multi-reflex non-rectilinear: recursively split
    // along bisectors until every leaf is convex. Classify as skeleton
    // only if the full decomposition succeeds — pathological cases
    // (self-intersecting bisectors, unreachable opposite edges) still
    // fall back to flat.
    const decomp = polygonDecomposeToConvex(sec.polygon);
    if (decomp) return 'skeleton-multi-reflex';
    return 'flat';
  }
  // Phase 14.R.16 — gable over a convex polygon. Ridge axis auto-
  // picked along the bbox long axis; gable details computed in
  // `computePolygonGable`. Concave polygon + gable still falls back
  // to flat (multi-ridge polygon gables are a separate phase).
  // Phase 14.R.20 — pass the section's optional axis override.
  if (sec.roofType === 'gable') {
    const g = computePolygonGable(
      sec.polygon, 1 /* slope irrelevant for classification */,
      sec.roofAxisOverrideDeg,
    );
    if (g) return 'gable-ridge-auto';
    // Phase 14.R.21 — concave + gable: recursively decompose into
    // convex leaves, apply a gable to each. Shared seams between
    // leaves become valley edges in the downstream composition.
    // Degrades to flat when decomposition fails (self-intersecting
    // bisectors, multi-reflex non-rectilinear with no valid split).
    const decomp = polygonDecomposeToConvex(sec.polygon);
    if (decomp) return 'skeleton-gable';
    return 'flat';
  }
  // Phase 14.R.17 — shed over a convex polygon. Axis auto-picked
  // perpendicular to the ridge axis gable would pick (short bbox
  // dimension), so gable ↔ shed toggles keep slope direction
  // consistent on the same polygon.
  if (sec.roofType === 'shed') {
    const s = computePolygonShed(
      sec.polygon, 1,
      sec.roofAxisOverrideDeg,
    );
    if (s) return 'shed-auto';
    return 'flat';
  }
  return 'flat';
}

// ── Straight-skeleton helpers (R.13) ────────────────────────────

/**
 * Phase 14.R.13 — indices of the reflex (concave) vertices of a
 * CCW-or-CW polygon. A reflex vertex has an interior angle > 180°;
 * for a rectilinear concave polygon (L / T / U / cross) these are
 * the corners where the two adjacent axis-aligned edges form a 270°
 * interior angle.
 *
 * Uses the signed cross product of successive edge vectors. For a
 * CCW polygon a negative cross indicates a reflex; for CW, positive.
 * Winding is detected from the polygon's signed area.
 */
export function reflexVertexIndices(
  polygon: ReadonlyArray<readonly [number, number]>,
): number[] {
  const n = polygon.length;
  if (n < 4) return [];
  let signed = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i]!;
    const [x2, y2] = polygon[(i + 1) % n]!;
    signed += x1 * y2 - x2 * y1;
  }
  if (signed === 0) return [];
  const ccw = signed > 0;
  const reflexSign = ccw ? -1 : 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = polygon[(i + n - 1) % n]!;
    const cur = polygon[i]!;
    const next = polygon[(i + 1) % n]!;
    const e1x = cur[0] - prev[0];
    const e1y = cur[1] - prev[1];
    const e2x = next[0] - cur[0];
    const e2y = next[1] - cur[1];
    const cross = e1x * e2y - e1y * e2x;
    if (cross === 0) continue; // collinear — not reflex
    if (Math.sign(cross) === reflexSign) out.push(i);
  }
  return out;
}

/**
 * Phase 14.R.13 — unit-length interior bisector direction at a reflex
 * vertex. For a simple polygon, the CCW-interior normal of an edge
 * (a → b) is rotate(b − a, +90°) = (−dy, dx); the bisector at a
 * shared vertex is the sum of its two edges' interior normals,
 * normalized. For a rectilinear reflex vertex this collapses to one
 * of the four 45° diagonals.
 *
 * Returns `null` for degenerate input (zero-length edges or bisector
 * of zero magnitude).
 */
export function polygonVertexInteriorBisector(
  polygon: ReadonlyArray<readonly [number, number]>,
  i: number,
): [number, number] | null {
  const n = polygon.length;
  if (n < 3) return null;
  // Detect winding once so we can rotate the interior normal correctly.
  let signed = 0;
  for (let k = 0; k < n; k++) {
    const [x1, y1] = polygon[k]!;
    const [x2, y2] = polygon[(k + 1) % n]!;
    signed += x1 * y2 - x2 * y1;
  }
  if (signed === 0) return null;
  const ccw = signed > 0;
  const prev = polygon[(i + n - 1) % n]!;
  const cur = polygon[i]!;
  const next = polygon[(i + 1) % n]!;
  const e1x = cur[0] - prev[0];
  const e1y = cur[1] - prev[1];
  const e2x = next[0] - cur[0];
  const e2y = next[1] - cur[1];
  const len1 = Math.hypot(e1x, e1y);
  const len2 = Math.hypot(e2x, e2y);
  if (len1 === 0 || len2 === 0) return null;
  // Interior normal of edge e. CCW → rotate 90° CCW: (-ey, ex).
  // CW → rotate 90° CW: (ey, -ex).
  const n1x = (ccw ? -e1y : e1y) / len1;
  const n1y = (ccw ? e1x : -e1x) / len1;
  const n2x = (ccw ? -e2y : e2y) / len2;
  const n2y = (ccw ? e2x : -e2x) / len2;
  const bx = n1x + n2x;
  const by = n1y + n2y;
  const blen = Math.hypot(bx, by);
  if (blen === 0) return null;
  return [bx / blen, by / blen];
}

/**
 * Phase 14.R.13 — ridge segment of one sub-rect of a rectilinear-
 * union hip. Returns:
 *   • A line segment between two endpoints for non-square sub-rects
 *     (standard rect hip ridge running along the longer axis).
 *   • A degenerate segment where both endpoints coincide at the
 *     centroid for squares (pyramid apex).
 *
 * `zRidge` is the elevation of the ridge above the sub-rect's eaves
 * (= (slope/12)·min(w,h)/2 — same formula `rise()` uses for rect
 * sections).
 */
export interface SubRectRidge {
  from: readonly [number, number];
  to: readonly [number, number];
  zRidge: number;
}

export function subRectRidges(
  rects: ReadonlyArray<AxisRect>,
  slopeXIn12: number,
): SubRectRidge[] {
  const out: SubRectRidge[] = [];
  for (const r of rects) {
    const halfMin = Math.min(r.w, r.h) / 2;
    const z = (slopeXIn12 / 12) * halfMin;
    if (r.w > r.h) {
      const y = r.y + r.h / 2;
      const x1 = r.x + r.h / 2;
      const x2 = r.x + r.w - r.h / 2;
      out.push({ from: [x1, y], to: [x2, y], zRidge: z });
    } else if (r.h > r.w) {
      const x = r.x + r.w / 2;
      const y1 = r.y + r.w / 2;
      const y2 = r.y + r.h - r.w / 2;
      out.push({ from: [x, y1], to: [x, y2], zRidge: z });
    } else {
      // Square — pyramid apex as a point.
      const x = r.x + r.w / 2;
      const y = r.y + r.h / 2;
      out.push({ from: [x, y], to: [x, y], zRidge: z });
    }
  }
  return out;
}

/**
 * Phase 14.R.15 — compose the 3D vertex list that multi-reflex mode
 * produces, given a pre-computed list of convex leaves. Mirrors the
 * loop inside `vertices3d`'s skeleton-multi-reflex branch, used by
 * `edges3d` for valley-endpoint lookup without triggering the whole
 * classify+decompose dance twice.
 */
function vertices3dFromLeaves(
  sec: Pick<RoofSection, 'slope' | 'z'>,
  leaves: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
): [number, number, number][] {
  const all: [number, number, number][] = [];
  for (const leaf of leaves) {
    const subSec = subPolyHipSection(sec, leaf);
    for (const v of vertices3d(subSec)) all.push(v);
  }
  return all;
}

/**
 * Phase 14.R.13 — locate a composed sub-rect vertex by (x, y, z)
 * with a small tolerance for floating-point drift. Returns the
 * index into the passed vertex list or -1 on miss. O(n) scan —
 * the vertex list is tens of entries for any realistic polygon, so
 * a hash-based lookup isn't worth the complexity.
 */
function findComposedVertex(
  verts: ReadonlyArray<readonly [number, number, number]>,
  x: number, y: number, z: number,
  eps: number = 1e-6,
): number {
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i]!;
    if (Math.abs(v[0] - x) < eps
      && Math.abs(v[1] - y) < eps
      && Math.abs(v[2] - z) < eps) {
      return i;
    }
  }
  return -1;
}

/**
 * Phase 14.R.14 — general 2D ray vs. line-segment intersection.
 * Segment can be arbitrary (diagonal edges are fine). Returns the
 * ray parameter `t > eps` plus the hit point, or null if:
 *   • lines are parallel (zero denominator)
 *   • t ≤ eps (segment is behind or at the ray origin)
 *   • hit point lies outside the segment's parametric [0, 1] range
 *
 * Math:  ray(t) = O + t·D,   seg(u) = A + u·(B − A)
 * Solve: O + t·D = A + u·(B − A)   →   2x2 linear system in (t, u).
 */
export function rayHitSegment(
  ox: number, oy: number,
  dx: number, dy: number,
  ax: number, ay: number,
  bx: number, by: number,
  eps: number = 1e-9,
): { t: number; u: number; x: number; y: number } | null {
  const sx = bx - ax;
  const sy = by - ay;
  const denom = dx * (-sy) - dy * (-sx); // = dx·sy·(−1) − dy·(−sx) rearranged
  // Correct 2x2 solve:
  //   [dx  -sx] [t]   [ax - ox]
  //   [dy  -sy] [u] = [ay - oy]
  const det = dx * (-sy) - dy * (-sx);
  if (Math.abs(det) < eps) return null;
  const rx = ax - ox;
  const ry = ay - oy;
  const t = (rx * (-sy) - ry * (-sx)) / det;
  const u = (dx * ry - dy * rx) / det;
  if (t <= eps) return null;
  if (u < -eps || u > 1 + eps) return null;
  void denom;
  return {
    t,
    u: Math.max(0, Math.min(1, u)),
    x: ox + t * dx,
    y: oy + t * dy,
  };
}

/**
 * Phase 14.R.14 — split a single-reflex non-rectilinear concave
 * polygon along its reflex vertex's inward bisector. The bisector
 * ray extends from the reflex vertex until it hits a non-adjacent
 * polygon edge; the polygon is sliced into two sub-polygons at that
 * hit. Returns null when:
 *   • the polygon has ≠ 1 reflex vertex
 *   • the bisector ray misses every non-adjacent edge
 *   • one of the resulting sub-polygons isn't convex (degenerate
 *     layout — callers fall back to flat)
 *
 * The two sub-polygons share the bisector segment as an edge; that
 * edge becomes a 'valley' in the downstream 3D composition.
 */
export interface ReflexSplit {
  /** Sub-polygon containing the reflex vertex and vertex-list before it. */
  subPolyA: [number, number][];
  /** Sub-polygon on the other side of the bisector. */
  subPolyB: [number, number][];
  /** World point where the bisector ray hit the opposite edge. */
  bisectorHit: [number, number];
  /** Index of the edge that was hit (polygon[edgeIdx] → polygon[edgeIdx+1]). */
  hitEdgeIdx: number;
  /** Index of the reflex vertex in the original polygon. */
  reflexIdx: number;
}

export function polygonSplitAtReflexBisector(
  polygon: ReadonlyArray<readonly [number, number]>,
): ReflexSplit | null {
  const reflex = reflexVertexIndices(polygon);
  if (reflex.length !== 1) return null;
  return splitAtReflexIdx(polygon, reflex[0]!, /* requireConvexHalves */ true);
}

/**
 * Phase 14.R.15 — multi-reflex entry: try splitting at ANY reflex
 * vertex, without requiring the resulting halves to be convex. Used
 * by the recursive decomposer. Halves still must be simple polygons
 * with ≥ 3 vertices.
 */
export function polygonSplitTryAnyReflex(
  polygon: ReadonlyArray<readonly [number, number]>,
): ReflexSplit | null {
  const reflex = reflexVertexIndices(polygon);
  for (const i of reflex) {
    const split = splitAtReflexIdx(polygon, i, /* requireConvexHalves */ false);
    if (split) return split;
  }
  return null;
}

/** Shared split-at-reflex routine. `requireConvexHalves` gates the
 *  post-split validation — R.14's single-reflex path demands it,
 *  R.15's recursive path relaxes it. */
function splitAtReflexIdx(
  polygon: ReadonlyArray<readonly [number, number]>,
  i: number,
  requireConvexHalves: boolean,
): ReflexSplit | null {
  const bisector = polygonVertexInteriorBisector(polygon, i);
  if (!bisector) return null;
  const [rx, ry] = polygon[i]!;
  const [dx, dy] = bisector;

  const n = polygon.length;
  // Find nearest NON-ADJACENT edge the bisector ray hits.
  // Adjacent edges are polygon[i-1 → i] and polygon[i → i+1] — skip both.
  let bestT = Infinity;
  let bestHit: { x: number; y: number } | null = null;
  let bestEdgeIdx = -1;
  for (let j = 0; j < n; j++) {
    // Edge j runs polygon[j] → polygon[(j+1)%n].
    if (j === i || j === (i + n - 1) % n) continue; // adjacent edges
    const a = polygon[j]!;
    const b = polygon[(j + 1) % n]!;
    const hit = rayHitSegment(rx, ry, dx, dy, a[0], a[1], b[0], b[1]);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      bestHit = { x: hit.x, y: hit.y };
      bestEdgeIdx = j;
    }
  }
  if (!bestHit || bestEdgeIdx < 0) return null;

  // Slice the polygon along the bisector from polygon[i] → hit.
  // BOTH sub-polygons contain the reflex vertex AND the hit point
  // as consecutive vertices (the shared bisector edge):
  //   subPolyA: polygon[i], polygon[i+1], …, polygon[bestEdgeIdx], hit
  //     closing edge: hit → polygon[i]  (the bisector)
  //   subPolyB: hit, polygon[bestEdgeIdx+1], …, polygon[i]
  //     closing edge: polygon[i] → hit  (the bisector, reversed)
  //
  // Preserving the polygon's original winding in each sub-polygon
  // means ear-clipping + centroid math downstream remain consistent.
  const hitPoint: [number, number] = [bestHit.x, bestHit.y];
  const subPolyA: [number, number][] = [[polygon[i]![0], polygon[i]![1]]];
  {
    let k = (i + 1) % n;
    while (true) {
      subPolyA.push([polygon[k]![0], polygon[k]![1]]);
      if (k === bestEdgeIdx) break;
      k = (k + 1) % n;
    }
    subPolyA.push([hitPoint[0], hitPoint[1]]);
  }
  const subPolyB: [number, number][] = [[hitPoint[0], hitPoint[1]]];
  {
    let k = (bestEdgeIdx + 1) % n;
    while (true) {
      subPolyB.push([polygon[k]![0], polygon[k]![1]]);
      if (k === i) break;
      k = (k + 1) % n;
    }
  }

  // Sub-polygons must be structurally valid (≥ 3 verts). R.14's
  // caller additionally requires both halves be convex so the
  // downstream pyramid geometry is well-defined; R.15's recursive
  // caller skips that check since it will recurse on any leftover
  // reflex vertices.
  if (subPolyA.length < 3 || subPolyB.length < 3) return null;
  if (requireConvexHalves
    && (!isConvexPolygon(subPolyA) || !isConvexPolygon(subPolyB))) {
    return null;
  }

  return {
    subPolyA,
    subPolyB,
    bisectorHit: hitPoint,
    hitEdgeIdx: bestEdgeIdx,
    reflexIdx: i,
  };
}

/**
 * Phase 14.R.15 — one segment of the straight-skeleton bisector
 * decomposition: the reflex vertex + its bisector-hit point. Each
 * recursive split produces one such segment; the set across the
 * whole recursion is the internal valley/ridge network.
 */
export interface SkeletonValley {
  from: readonly [number, number];
  to: readonly [number, number];
}

/**
 * Phase 14.R.15 — recursive convex decomposition of a simple
 * concave polygon. Tries to split at each reflex vertex's bisector
 * in turn; on success, recurses on both halves. Returns:
 *   • `{ convexLeaves, valleys }` when every piece is convex, OR
 *   • `null` when the polygon can't be decomposed — caller falls
 *     back to flat rendering.
 *
 * Guards against infinite recursion with a depth cap. Bubble-up
 * semantics: if any sub-polygon fails to decompose, the entire
 * top-level call returns null.
 */
export interface ConvexDecomposition {
  convexLeaves: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
  valleys: ReadonlyArray<SkeletonValley>;
}

export function polygonDecomposeToConvex(
  polygon: ReadonlyArray<readonly [number, number]>,
  depth: number = 0,
): ConvexDecomposition | null {
  // Guard against pathological recursion. Real polygons bottom out in
  // well under a dozen splits; a 20-deep call is already a red flag.
  if (depth > 20) return null;
  if (polygon.length < 3) return null;
  if (isConvexPolygon(polygon)) {
    // Clone the leaf so downstream mutation can't leak into the input.
    const leaf: [number, number][] = polygon.map(
      ([x, y]) => [x, y] as [number, number],
    );
    return { convexLeaves: [leaf], valleys: [] };
  }
  const split = polygonSplitTryAnyReflex(polygon);
  if (!split) return null;
  const left = polygonDecomposeToConvex(split.subPolyA, depth + 1);
  if (!left) return null;
  const right = polygonDecomposeToConvex(split.subPolyB, depth + 1);
  if (!right) return null;
  const valleys: SkeletonValley[] = [
    {
      from: [polygon[split.reflexIdx]![0], polygon[split.reflexIdx]![1]],
      to: [split.bisectorHit[0], split.bisectorHit[1]],
    },
    ...left.valleys,
    ...right.valleys,
  ];
  return {
    convexLeaves: [...left.convexLeaves, ...right.convexLeaves],
    valleys,
  };
}

/**
 * Phase 14.R.13 — 2D ray vs. axis-aligned segment intersection.
 * `t` is the ray parameter (≥ 0). Returns null on miss, on t ≤ 0,
 * or when the ray direction is parallel to the segment.
 */
export function rayHitAxisSegment(
  rx: number, ry: number,
  dx: number, dy: number,
  x1: number, y1: number,
  x2: number, y2: number,
  eps: number = 1e-9,
): { t: number; x: number; y: number } | null {
  if (y1 === y2) {
    // Horizontal segment at y = y1.
    if (Math.abs(dy) < eps) return null;
    const t = (y1 - ry) / dy;
    if (t <= eps) return null;
    const x = rx + t * dx;
    const xMin = Math.min(x1, x2);
    const xMax = Math.max(x1, x2);
    if (x < xMin - eps || x > xMax + eps) return null;
    return { t, x, y: y1 };
  }
  if (x1 === x2) {
    if (Math.abs(dx) < eps) return null;
    const t = (x1 - rx) / dx;
    if (t <= eps) return null;
    const y = ry + t * dy;
    const yMin = Math.min(y1, y2);
    const yMax = Math.max(y1, y2);
    if (y < yMin - eps || y > yMax + eps) return null;
    return { t, x: x1, y };
  }
  return null; // not axis-aligned
}

/**
 * Phase 14.R.12 — build a virtual RECT hip section for one sub-rect
 * of a rectilinear-union decomposition. Returns exactly the fields
 * the geometry functions (`vertices3d` / `edges3d` / `faces3d`) read,
 * so parents don't need to pass through the cosmetic fields (label,
 * sectionId, colorIdx, etc.). `polygon` is omitted so the recursion
 * lands in the rect path; `rotation` + `overhang` zeroed since sub-
 * rects carry absolute coords and overhang would double-count at
 * seams between adjacent sub-rects.
 */
type SubRectHipInput = Pick<RoofSection,
  'x' | 'y' | 'length' | 'run' | 'overhang' | 'slope' | 'z'
  | 'rotation' | 'roofType' | 'polygon' | 'roofAxisOverrideDeg'>;

function subRectHipSection(
  parent: Pick<RoofSection, 'slope' | 'z'>,
  rect: AxisRect,
): SubRectHipInput {
  return {
    x: rect.x,
    y: rect.y,
    length: rect.w,
    run: rect.h,
    rotation: 0,
    slope: parent.slope,
    overhang: 0,
    z: parent.z,
    roofType: 'hip',
    // polygon left undefined — rect path triggers downstream.
  };
}

/**
 * Phase 14.R.14 — build a virtual convex-polygon hip section for
 * one half of a skeleton split. Passes the sub-polygon through so
 * the recursion lands in the pyramid (R.11) branch. Bounding-box
 * fields carry `section.x/y/length/run` placeholders that rect-only
 * legacy code paths can still read.
 */
function subPolyHipSection(
  parent: Pick<RoofSection, 'slope' | 'z'>,
  polygon: ReadonlyArray<readonly [number, number]>,
): SubRectHipInput {
  const bbox = polygonBoundingBox(polygon);
  const polyClone: [number, number][] = polygon.map(
    ([x, y]) => [x, y] as [number, number],
  );
  return {
    x: bbox ? bbox.minX : 0,
    y: bbox ? bbox.minY : 0,
    length: bbox ? bbox.maxX - bbox.minX : 0,
    run: bbox ? bbox.maxY - bbox.minY : 0,
    rotation: 0,
    slope: parent.slope,
    overhang: 0,
    z: parent.z,
    roofType: 'hip',
    polygon: polyClone,
  };
}

/**
 * Phase 14.R.21 — build a virtual convex-polygon gable section for
 * one leaf of a skeleton decomposition. Same shape as
 * `subPolyHipSection` but with `roofType='gable'` so the recursion
 * lands in the R.16 gable branch. The parent's `roofAxisOverrideDeg`
 * is propagated so an L-shaped house with the user's explicit axis
 * override (R.20) keeps a consistent ridge direction across every
 * leaf; when the parent has no override, each leaf auto-picks its
 * own bbox-aligned axis, which naturally gives perpendicular ridges
 * on perpendicular wings.
 */
function subPolyGableSection(
  parent: Pick<RoofSection, 'slope' | 'z' | 'roofAxisOverrideDeg'>,
  polygon: ReadonlyArray<readonly [number, number]>,
): SubRectHipInput {
  const bbox = polygonBoundingBox(polygon);
  const polyClone: [number, number][] = polygon.map(
    ([x, y]) => [x, y] as [number, number],
  );
  return {
    x: bbox ? bbox.minX : 0,
    y: bbox ? bbox.minY : 0,
    length: bbox ? bbox.maxX - bbox.minX : 0,
    run: bbox ? bbox.maxY - bbox.minY : 0,
    rotation: 0,
    slope: parent.slope,
    overhang: 0,
    z: parent.z,
    roofType: 'gable',
    polygon: polyClone,
    ...(parent.roofAxisOverrideDeg !== undefined
      ? { roofAxisOverrideDeg: parent.roofAxisOverrideDeg }
      : {}),
  };
}

// ── Polygon shed (R.17) ─────────────────────────────────────────

/**
 * Phase 14.R.17 — single-slope shed roof over a convex polygon.
 *
 * Geometry: one planar slope face tilts from the LOW edge (eave at
 * z = sec.z) up to the HIGH edge (ridge at z = sec.z + riseAtHigh).
 * Tilt direction is auto-picked along the polygon's bbox SHORT axis
 * — matches the perpendicular direction a gable roof would slope in
 * (R.16), so toggling gable → shed on the same polygon keeps the
 * slope orientation consistent. Contractor convention: "tall wall on
 * the long side, low wall on the short side, slope over the short
 * run."
 *
 * Each polygon vertex gets a per-vertex rise proportional to its
 * perpendicular distance from the low edge line (linear interpolation
 * between z=0 at low and z=riseAtHigh at high). Because every vertex
 * lies on the single tilted plane, the shed face can be ear-clip-
 * triangulated directly in 2D plan space and rendered at per-vertex
 * 3D elevation — no extra apex / projection vertices needed.
 *
 * Returns null for non-convex polygons or degenerate bbox dimensions.
 */
export interface PolygonShed {
  /** Unit vector pointing from the low edge to the high edge. */
  axis: readonly [number, number];
  /** Along-axis scalar (v · axis) of the low (eave) edge. */
  lowValue: number;
  /** Along-axis scalar of the high (ridge) edge. */
  highValue: number;
  /** Total rise at the high edge above the low-edge eave plane. */
  riseAtHigh: number;
  /** Per-polygon-vertex rise above the low-edge eave. */
  perVertexRise: ReadonlyArray<number>;
  /** Per-polygon-vertex along-axis scalar (v · axis). Used by the
   *  edge classifier to mark low / high / rake edges. */
  alongAxis: ReadonlyArray<number>;
}

/**
 * Phase 14.R.20 — `axisDegOverride` (degrees CCW from +X) forces
 * the tilt direction. When null/undefined, auto-pick along the
 * bbox short axis (R.17 behavior — matches gable's perpendicular
 * direction for a consistent gable↔shed toggle on the same polygon).
 *
 * Phase 14.R.22 — concavity check dropped. A shed roof is a single
 * tilted plane; the plane equation `z = along_axis · slope/12` works
 * for any simple polygon with ≥ 3 vertices. Concave polygons (L/T/U)
 * render as one continuous slope face, ear-clip-triangulated via
 * R.10's concave-aware path. The interior seams of the concavity
 * lie on the shared tilt plane — no valley edges needed, unlike the
 * hip/gable concave cases that require per-piece framing.
 */
export function computePolygonShed(
  polygon: ReadonlyArray<readonly [number, number]>,
  slopeXIn12: number,
  axisDegOverride?: number | null,
): PolygonShed | null {
  if (polygon.length < 3) return null;
  const bbox = polygonBoundingBox(polygon);
  if (!bbox) return null;
  const bboxW = bbox.maxX - bbox.minX;
  const bboxH = bbox.maxY - bbox.minY;
  if (bboxW <= 0 || bboxH <= 0) return null;

  // Direction the slope rises in. Override takes precedence; fallback
  // is bbox SHORT axis (same as R.17's auto-pick semantics).
  const axisRad = axisDegOverride != null
    ? (axisDegOverride * Math.PI) / 180
    : bboxH <= bboxW ? Math.PI / 2 : 0;
  const axis: [number, number] = [Math.cos(axisRad), Math.sin(axisRad)];

  // Project every polygon vertex onto the axis (scalar = v · axis).
  const alongAxis = polygon.map(([x, y]) => x * axis[0] + y * axis[1]);
  let lowValue = Infinity;
  let highValue = -Infinity;
  for (const a of alongAxis) {
    if (a < lowValue) lowValue = a;
    if (a > highValue) highValue = a;
  }
  const run = highValue - lowValue;
  if (run <= 0) return null;
  const riseAtHigh = (slopeXIn12 / 12) * run;

  const perVertexRise = alongAxis.map((a) => ((a - lowValue) / run) * riseAtHigh);

  return { axis, lowValue, highValue, riseAtHigh, perVertexRise, alongAxis };
}

// ── Polygon gable (R.16) ────────────────────────────────────────

/**
 * Phase 14.R.16 — geometric description of a gable roof over a
 * convex polygon footprint. The ridge axis is auto-picked along the
 * polygon's bbox long axis; the ridge segment is clipped to the
 * polygon's interior via ray-casting from the centroid. Each polygon
 * vertex gets a perpendicular projection onto the ridge segment
 * (clamped to endpoints) — the slope face of that edge rises from
 * the eave to those projection points.
 *
 * Returns null for degenerate input (non-convex polygon, zero
 * bbox width or height, zero-length ridge).
 */
export interface PolygonGable {
  /** First endpoint of the ridge segment, in polygon-plane coords. */
  ridgeStart: readonly [number, number];
  /** Second endpoint of the ridge segment. */
  ridgeEnd: readonly [number, number];
  /** Elevation of the ridge above the eave plane. */
  rise: number;
  /** Unit direction along the ridge axis (from ridgeStart to ridgeEnd). */
  axis: readonly [number, number];
  /** One entry per polygon vertex — its perpendicular projection
   *  onto the ridge segment, clamped to segment endpoints. */
  projections: ReadonlyArray<readonly [number, number]>;
}

/**
 * Phase 14.R.20 — `axisDegOverride` lets the caller specify the
 * ridge orientation (degrees CCW from +X). When null/undefined, the
 * helper auto-picks along the bbox long axis (R.16 behavior).
 */
export function computePolygonGable(
  polygon: ReadonlyArray<readonly [number, number]>,
  slopeXIn12: number,
  axisDegOverride?: number | null,
): PolygonGable | null {
  if (!isConvexPolygon(polygon)) return null;
  const bbox = polygonBoundingBox(polygon);
  if (!bbox) return null;
  const bboxW = bbox.maxX - bbox.minX;
  const bboxH = bbox.maxY - bbox.minY;
  if (bboxW <= 0 || bboxH <= 0) return null;

  const centroid = polygonCentroid(polygon);
  // Unit direction along ridge. Override takes precedence; fallback
  // is horizontal (+X) when bbox is wider-than-tall, else vertical.
  const axisRad = axisDegOverride != null
    ? (axisDegOverride * Math.PI) / 180
    : bboxW >= bboxH ? 0 : Math.PI / 2;
  const axis: [number, number] = [Math.cos(axisRad), Math.sin(axisRad)];

  // Clip the ridge to the polygon interior: ray-cast from centroid
  // in both +axis and −axis directions against every polygon edge.
  // Nearest hits are the clipped endpoints.
  const posHit = rayHitPolygonBoundary(polygon, centroid, axis);
  const negHit = rayHitPolygonBoundary(polygon, centroid, [-axis[0], -axis[1]]);
  if (!posHit || !negHit) return null;
  const ridgeStart = negHit;
  const ridgeEnd = posHit;
  const ridgeDx = ridgeEnd[0] - ridgeStart[0];
  const ridgeDy = ridgeEnd[1] - ridgeStart[1];
  const ridgeLen = Math.hypot(ridgeDx, ridgeDy);
  if (ridgeLen < 1e-9) return null;
  // Unit ridge direction recomputed from clipped endpoints (avoids
  // inheriting any sign ambiguity from the requested `axis`).
  const ridgeUnit: [number, number] = [ridgeDx / ridgeLen, ridgeDy / ridgeLen];

  // Max perpendicular distance from ridge line to any polygon
  // vertex — this is the "half-run" for the gable's rise.
  // For an axis-aligned rect, this equals bbox-perp-dim / 2.
  let maxPerp = 0;
  for (const [px, py] of polygon) {
    const dx = px - ridgeStart[0];
    const dy = py - ridgeStart[1];
    const along = dx * ridgeUnit[0] + dy * ridgeUnit[1];
    const perpX = dx - along * ridgeUnit[0];
    const perpY = dy - along * ridgeUnit[1];
    const perp = Math.hypot(perpX, perpY);
    if (perp > maxPerp) maxPerp = perp;
  }
  const rise = (slopeXIn12 / 12) * maxPerp;

  // Projections: perpendicular projection of each polygon vertex
  // onto the ridge segment, clamped to [ridgeStart, ridgeEnd].
  const projections: [number, number][] = polygon.map(([px, py]) => {
    const dx = px - ridgeStart[0];
    const dy = py - ridgeStart[1];
    const tRaw = dx * ridgeUnit[0] + dy * ridgeUnit[1];
    const t = Math.max(0, Math.min(ridgeLen, tRaw));
    return [
      ridgeStart[0] + t * ridgeUnit[0],
      ridgeStart[1] + t * ridgeUnit[1],
    ];
  });

  return { ridgeStart, ridgeEnd, rise, axis: ridgeUnit, projections };
}

function clamp(v: number, lo: number, hi: number): number {
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
  if (v < a) return a;
  if (v > b) return b;
  return v;
}

/**
 * Phase 14.R.16 — ray-cast from a point inside a polygon to its
 * boundary. Returns the NEAREST hit point (smallest t > 0) or null
 * if the ray misses every edge (shouldn't happen for a point
 * strictly inside a simple polygon, but guard anyway).
 */
function rayHitPolygonBoundary(
  polygon: ReadonlyArray<readonly [number, number]>,
  origin: readonly [number, number],
  dir: readonly [number, number],
): [number, number] | null {
  const n = polygon.length;
  let bestT = Infinity;
  let bestHit: [number, number] | null = null;
  for (let i = 0; i < n; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % n]!;
    const hit = rayHitSegment(origin[0], origin[1], dir[0], dir[1], a[0], a[1], b[0], b[1]);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      bestHit = [hit.x, hit.y];
    }
  }
  return bestHit;
}

/**
 * Phase 14.R.11 — pyramidal rise over a polygon for roofType='hip'.
 *
 * Anchored to the polygon's equivalent-rectangle half-width so the
 * pitch matches what an area+perimeter-equivalent rectangular hip
 * would have. Concretely:
 *   W_eff = polygonArea / (polygonPerimeter / 4)
 *   rise  = (slope/12) · (W_eff / 2)
 *
 * Falls back to 0 for degenerate polygons (zero area or perimeter).
 */
export function polygonPyramidRise(
  poly: ReadonlyArray<readonly [number, number]>,
  slopeXIn12: number,
): number {
  if (slopeXIn12 <= 0) return 0;
  const area = polygonArea(poly);
  const perim = polygonPerimeter(poly);
  if (area <= 0 || perim <= 0) return 0;
  // W_eff ≈ short side of the equivalent rectangle (4A / P).
  const wEff = (4 * area) / perim;
  return (slopeXIn12 / 12) * (wEff / 2);
}

/**
 * Phase 14.R.19 — rotate every polygon vertex by `angleDeg` degrees
 * (CCW positive) around `center`, returning a new polygon. Pure
 * function — input is not mutated. Matches the rotation semantics
 * used by `corners()` for rectangular sections, so polygon + rect
 * rotations feel identical to the user.
 */
export function rotatePolygon(
  polygon: ReadonlyArray<readonly [number, number]>,
  center: readonly [number, number],
  angleDeg: number,
): [number, number][] {
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return polygon.map(([x, y]) => {
    const dx = x - center[0];
    const dy = y - center[1];
    return [
      center[0] + dx * c - dy * s,
      center[1] + dx * s + dy * c,
    ];
  });
}

/**
 * Phase 14.R.11 — true polygon centroid (center of mass), NOT the
 * bounding-box midpoint. Formula:
 *   Cx = (1/6A) · Σ (xi + xi+1) · (xi·yi+1 − xi+1·yi)
 *   Cy = (1/6A) · Σ (yi + yi+1) · (xi·yi+1 − xi+1·yi)
 *   A  = (1/2)  · Σ (xi·yi+1 − xi+1·yi)   (signed — direction matters here)
 *
 * For degenerate input (<3 vertices, zero signed area) falls back to
 * the arithmetic mean of vertices so callers always get something
 * sensible.
 */
export function polygonCentroid(
  poly: ReadonlyArray<readonly [number, number]>,
): [number, number] {
  const n = poly.length;
  if (n === 0) return [0, 0];
  if (n < 3) {
    // Arithmetic mean — same as centroid of a line segment / point.
    let mx = 0, my = 0;
    for (const [x, y] of poly) { mx += x; my += y; }
    return [mx / n, my / n];
  }
  let signed2A = 0;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % n]!;
    const k = x1 * y2 - x2 * y1;
    signed2A += k;
    cx += (x1 + x2) * k;
    cy += (y1 + y2) * k;
  }
  if (signed2A === 0) {
    // Collinear — fall back to mean of vertices.
    let mx = 0, my = 0;
    for (const [x, y] of poly) { mx += x; my += y; }
    return [mx / n, my / n];
  }
  // signed2A is twice the signed area; the (1/6A) becomes (1/3·signed2A).
  return [cx / (3 * signed2A), cy / (3 * signed2A)];
}

// ── Ear-clipping triangulation (R.10) ───────────────────────────

/**
 * Ear-clipping triangulation for simple (non-self-intersecting)
 * polygons, convex OR concave. Returns an array of triangles where
 * each triangle is a 3-element array of indices into the INPUT
 * `polygon` (not into an intermediate reversed list).
 *
 * The algorithm:
 *   1. Detect winding via signed area; flip the cross-product sign
 *      for CW input so the "ear convex?" test works regardless.
 *   2. Walk the remaining polygon vertex-list as a ring. A vertex
 *      `v[i]` is an ear when:
 *        a. The corner at v[i] is convex (cross in the polygon's
 *           winding direction is positive).
 *        b. The triangle (v[i-1], v[i], v[i+1]) contains no OTHER
 *           polygon vertex in its interior.
 *   3. Emit ear → splice v[i] → repeat until 3 vertices remain.
 *
 * Complexity is O(n²) worst-case, more than acceptable for the
 * tens-of-vertices polygons a contractor would draw. Bails out
 * after n² iterations on pathological input (returns whatever
 * triangles were found so far).
 *
 * Output triangles preserve the input's winding: CCW-in → CCW-out,
 * CW-in → CW-out. Callers needing a specific winding can reverse
 * each triple in-place.
 */
export function earClipTriangulate(
  polygon: ReadonlyArray<readonly [number, number]>,
): [number, number, number][] {
  const n = polygon.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];

  // Winding: positive signed area === CCW (standard).
  let signed = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i]!;
    const [x2, y2] = polygon[(i + 1) % n]!;
    signed += x1 * y2 - x2 * y1;
  }
  const ccw = signed > 0;
  // Convex check sign flips for CW input so the same cross-product
  // formula works either way.
  const convexSign = ccw ? 1 : -1;

  const ring: number[] = Array.from({ length: n }, (_, i) => i);
  const triangles: [number, number, number][] = [];
  let guard = n * n;

  while (ring.length > 3 && guard-- > 0) {
    let earIdx = -1;
    for (let i = 0; i < ring.length; i++) {
      const prev = ring[(i + ring.length - 1) % ring.length]!;
      const cur = ring[i]!;
      const next = ring[(i + 1) % ring.length]!;
      if (isEarAt(polygon, ring, prev, cur, next, convexSign)) {
        earIdx = i;
        break;
      }
    }
    if (earIdx < 0) {
      // Degenerate — no ear found (collinear spike, duplicate
      // vertices, etc.). Bail with what we have.
      break;
    }
    const prev = ring[(earIdx + ring.length - 1) % ring.length]!;
    const cur = ring[earIdx]!;
    const next = ring[(earIdx + 1) % ring.length]!;
    triangles.push([prev, cur, next]);
    ring.splice(earIdx, 1);
  }

  if (ring.length === 3) {
    triangles.push([ring[0]!, ring[1]!, ring[2]!]);
  }
  return triangles;
}

function isEarAt(
  polygon: ReadonlyArray<readonly [number, number]>,
  ring: ReadonlyArray<number>,
  prev: number,
  cur: number,
  next: number,
  convexSign: number,
): boolean {
  const a = polygon[prev]!;
  const b = polygon[cur]!;
  const c = polygon[next]!;
  // Convex-at-b check (cross product).
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (cross * convexSign <= 0) return false; // reflex or collinear — not an ear
  // No other polygon vertex may lie inside triangle abc.
  for (const idx of ring) {
    if (idx === prev || idx === cur || idx === next) continue;
    if (pointInTriangleStrict(polygon[idx]!, a, b, c)) return false;
  }
  return true;
}

function pointInTriangleStrict(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): boolean {
  const d1 = triangleSign(p, a, b);
  const d2 = triangleSign(p, b, c);
  const d3 = triangleSign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function triangleSign(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  return (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
}

// ── Plan corners (with rotation) ────────────────────────────────

/**
 * Return the corners of the section in plan coordinates, accounting
 * for rotation. For rectangular sections: 4 corners in BL, BR, TR,
 * TL order. For polygon sections (R.9): the polygon vertices
 * directly — rotation is ignored because polygons carry their own
 * absolute coordinates.
 *
 * NOTE: matches the Python behavior for rects — the rotation center
 * is the section's nominal center `(x + length/2, y + run/2)`, NOT
 * the rotated rectangle's center. This is the expected behavior
 * for the AROYH canvas.
 */
export function corners(
  sec: Pick<RoofSection, 'x' | 'y' | 'length' | 'run' | 'rotation' | 'polygon'>,
): [number, number][] {
  if (hasPolygon(sec)) {
    // Defensive clone so callers can't mutate the stored polygon.
    return sec.polygon.map(([x, y]) => [x, y]);
  }
  const cx = sec.x + sec.length / 2;
  const cy = sec.y + sec.run / 2;
  const hw = sec.length / 2;
  const hh = sec.run / 2;
  const raw: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  const rad = (sec.rotation * Math.PI) / 180;
  const cr = Math.cos(rad);
  const sr = Math.sin(rad);
  return raw.map(([px, py]) => [
    cx + px * cr - py * sr,
    cy + px * sr + py * cr,
  ]);
}

/** Section center (in the same plan coords as `corners`). */
export function center(
  sec: Pick<RoofSection, 'x' | 'y' | 'length' | 'run'>,
): [number, number] {
  return [sec.x + sec.length / 2, sec.y + sec.run / 2];
}

// ── Point-in-polygon (ray casting) ──────────────────────────────

function pointInPolygon(
  px: number,
  py: number,
  polygon: ReadonlyArray<readonly [number, number]>,
): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (
      (yi > py) !== (yj > py)
      && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

/** Point-in-rotated-rectangle hit test (plan view). Polygon
 *  sections route through the polygon vertices via `corners()`. */
export function containsPoint(
  sec: Pick<RoofSection, 'x' | 'y' | 'length' | 'run' | 'rotation' | 'polygon'>,
  wx: number,
  wy: number,
): boolean {
  return pointInPolygon(wx, wy, corners(sec));
}

// ── 3D geometry — multi-view projection ─────────────────────────

/**
 * All 3D vertices for the roof shape, with rotation applied.
 *
 * Vertex layout by roof type:
 *   gable: [E_BL, E_BR, E_TR, E_TL, R_L, R_R]  (6)
 *   hip:   [E_BL, E_BR, E_TR, E_TL, R_L, R_R]  (6)
 *   shed:  [LOW_BL, LOW_BR, HIGH_TR, HIGH_TL]  (4)
 *   flat:  [BL, BR, TR, TL]                     (4)
 *
 * Polygon footprints (R.9) ignore roof_type and return the polygon
 * vertices at elevation `z` (flat-roof treatment — hip/gable/shed
 * over a polygon is future work).
 *
 * Eave dimensions include overhang for rects. Z = elevation + rise.
 */
export function vertices3d(
  sec: Pick<RoofSection,
    'x' | 'y' | 'length' | 'run' | 'overhang' | 'slope' | 'z' | 'rotation' | 'roofType' | 'polygon' | 'roofAxisOverrideDeg'>,
): [number, number, number][] {
  if (hasPolygon(sec)) {
    const mode = classifyPolygonRoof(sec);
    // Phase 14.R.11 — polygon + hip + CONVEX → pyramid with apex at
    // the polygon centroid. Rise is anchored to the equivalent-
    // rectangle's half-width so the pitch matches what a rect of
    // the same area/perimeter would exhibit.
    if (mode === 'pyramid') {
      const verts: [number, number, number][] = sec.polygon.map(
        ([px, py]) => [px, py, sec.z],
      );
      const [cxp, cyp] = polygonCentroid(sec.polygon);
      const polygonRise = polygonPyramidRise(sec.polygon, sec.slope);
      verts.push([cxp, cyp, sec.z + polygonRise]);
      return verts;
    }
    // Phase 14.R.12 — rectilinear concave + hip → decompose into
    // axis-aligned sub-rects, each rendered as a rect-hip via the
    // classic 6-vertex hip geometry. Concatenated in order: every
    // sub-rect contributes 6 vertices (4 eave corners + 2 ridge
    // points, possibly coincident as a pyramid apex for squares).
    if (mode === 'rectilinear-union') {
      const rects = decomposeRectilinearPolygon(sec.polygon);
      const all: [number, number, number][] = [];
      for (const r of rects) {
        const subSec = subRectHipSection(sec, r);
        for (const v of vertices3d(subSec)) all.push(v);
      }
      return all;
    }
    // Phase 14.R.14 — non-rectilinear concave with 1 reflex vertex.
    // Split along the reflex bisector into two convex sub-polygons,
    // each rendered as a pyramid. Each sub-poly contributes (N_i + 1)
    // vertices: its polygon corners at z, then an apex at z + rise_i.
    if (mode === 'skeleton-single-reflex') {
      const split = polygonSplitAtReflexBisector(sec.polygon);
      if (split) {
        const subA = subPolyHipSection(sec, split.subPolyA);
        const subB = subPolyHipSection(sec, split.subPolyB);
        return [...vertices3d(subA), ...vertices3d(subB)];
      }
      // Defensive fallback — classifyPolygonRoof already returned
      // 'skeleton-single-reflex' so the split should never be null
      // here, but guard anyway.
    }
    // Phase 14.R.15 — non-rectilinear concave with 2+ reflex vertices.
    // Recursively decompose into convex leaves; each leaf becomes a
    // pyramid, concatenated into one vertex list.
    if (mode === 'skeleton-multi-reflex') {
      const decomp = polygonDecomposeToConvex(sec.polygon);
      if (decomp) {
        const all: [number, number, number][] = [];
        for (const leaf of decomp.convexLeaves) {
          const subSec = subPolyHipSection(sec, leaf);
          for (const v of vertices3d(subSec)) all.push(v);
        }
        return all;
      }
    }
    // Phase 14.R.16 — convex polygon + gable. N eave corners at z
    // followed by N per-vertex ridge projections at z + rise.
    // Duplicate projections (multiple polygon verts on the same
    // ridge point) are allowed — rendering handles them fine, and
    // it keeps face/edge indexing trivially index-to-index.
    if (mode === 'gable-ridge-auto') {
      const g = computePolygonGable(
        sec.polygon, sec.slope, sec.roofAxisOverrideDeg,
      );
      if (g) {
        const verts: [number, number, number][] = [];
        for (const [px, py] of sec.polygon) {
          verts.push([px, py, sec.z]);
        }
        for (const [rx, ry] of g.projections) {
          verts.push([rx, ry, sec.z + g.rise]);
        }
        return verts;
      }
    }
    // Phase 14.R.21 — concave polygon + gable via recursive
    // decomposition. Each convex leaf becomes its own R.16 gable;
    // the concatenated vertex list is [leaf0 eaves, leaf0 projs,
    // leaf1 eaves, leaf1 projs, ...].
    if (mode === 'skeleton-gable') {
      const decomp = polygonDecomposeToConvex(sec.polygon);
      if (decomp) {
        const all: [number, number, number][] = [];
        for (const leaf of decomp.convexLeaves) {
          const subSec = subPolyGableSection(sec, leaf);
          for (const v of vertices3d(subSec)) all.push(v);
        }
        return all;
      }
    }
    // Phase 14.R.17 — convex polygon + shed. N polygon corners at
    // per-vertex elevations — all sitting on the single tilted
    // plane, so no extra ridge or apex vertices are needed.
    if (mode === 'shed-auto') {
      const s = computePolygonShed(
        sec.polygon, sec.slope, sec.roofAxisOverrideDeg,
      );
      if (s) {
        return sec.polygon.map(([px, py], i) => [
          px, py, sec.z + s.perVertexRise[i]!,
        ]);
      }
    }
    // Flat (R.9) + any non-hip polygon roof type: flat rendering.
    return sec.polygon.map(([px, py]) => [px, py, sec.z]);
  }
  const L = adjLength(sec);
  const R = adjRun(sec);
  const halfL = L / 2;
  const halfR = R / 2;
  const r = rise(sec);

  let local: [number, number, number][];
  if (sec.roofType === 'flat') {
    local = [
      [-halfL, -halfR, 0],
      [halfL, -halfR, 0],
      [halfL, halfR, 0],
      [-halfL, halfR, 0],
    ];
  } else if (sec.roofType === 'shed') {
    const rf = (sec.slope / 12) * sec.run;
    local = [
      [-halfL, -halfR, 0],
      [halfL, -halfR, 0],
      [halfL, halfR, rf],
      [-halfL, halfR, rf],
    ];
  } else if (sec.roofType === 'hip') {
    const hi = Math.min(halfR, halfL);
    const rh = Math.max(halfL - hi, 0);
    local = [
      [-halfL, -halfR, 0],
      [halfL, -halfR, 0],
      [halfL, halfR, 0],
      [-halfL, halfR, 0],
      [-rh, 0, r],
      [rh, 0, r],
    ];
  } else { // gable (default)
    local = [
      [-halfL, -halfR, 0],
      [halfL, -halfR, 0],
      [halfL, halfR, 0],
      [-halfL, halfR, 0],
      [-halfL, 0, r],
      [halfL, 0, r],
    ];
  }

  const cx = sec.x + sec.length / 2;
  const cy = sec.y + sec.run / 2;
  const rad = (sec.rotation * Math.PI) / 180;
  const cr = Math.cos(rad);
  const sr = Math.sin(rad);
  return local.map(([lx, ly, lz]) => [
    cx + lx * cr - ly * sr,
    cy + lx * sr + ly * cr,
    sec.z + lz,
  ]);
}

export interface Edge3d {
  fromIdx: number;
  toIdx: number;
  edgeType: EdgeType;
}

/** Edge topology for the section's roof type.
 *  • Polygon + flat (R.9): one eave edge per polygon side.
 *  • Polygon + hip + convex (R.11): N eave edges around the base
 *    plus N hip edges from each base vertex to the apex at index N. */
export function edges3d(
  sec: Pick<RoofSection,
    'x' | 'y' | 'length' | 'run' | 'overhang' | 'slope' | 'z' | 'rotation' | 'roofType' | 'polygon' | 'roofAxisOverrideDeg'>,
): Edge3d[] {
  if (hasPolygon(sec)) {
    const mode = classifyPolygonRoof(sec);
    if (mode === 'rectilinear-union') {
      // Phase 14.R.12 — each sub-rect emits its own edges; we offset
      // indices so they align with the concatenated vertex list
      // produced by vertices3d. Shared interior eave-edges between
      // adjacent sub-rects are allowed to duplicate — structurally
      // those segments ARE valleys in the real L/T/U hip roof.
      const rects = decomposeRectilinearPolygon(sec.polygon);
      const out: Edge3d[] = [];
      let offset = 0;
      for (const r of rects) {
        const subSec = subRectHipSection(sec, r);
        const subEdges = edges3d(subSec);
        const subVerts = vertices3d(subSec).length; // typically 6 for hip
        for (const e of subEdges) {
          out.push({
            fromIdx: e.fromIdx + offset,
            toIdx: e.toIdx + offset,
            edgeType: e.edgeType,
          });
        }
        offset += subVerts;
      }
      // Phase 14.R.13 — valley edges. At each reflex vertex of the
      // original polygon, a 45° diagonal ridge runs inward until it
      // hits the nearest sub-rect ridge (or apex point). We locate
      // the valley endpoints in the already-composed vertex list —
      // they naturally coincide with sub-rect eave corners + ridge
      // endpoints, so no new vertices need to be appended.
      const composed = vertices3d(sec);
      const ridges = subRectRidges(rects, sec.slope);
      const reflex = reflexVertexIndices(sec.polygon);
      for (const i of reflex) {
        const bisector = polygonVertexInteriorBisector(sec.polygon, i);
        if (!bisector) continue;
        const [rx, ry] = sec.polygon[i]!;
        // Find nearest ridge-hit along the bisector ray.
        let bestT = Infinity;
        let bestHit: { x: number; y: number; zRidge: number } | null = null;
        for (const ridge of ridges) {
          const hit = rayHitAxisSegment(
            rx, ry, bisector[0], bisector[1],
            ridge.from[0], ridge.from[1], ridge.to[0], ridge.to[1],
          );
          if (hit && hit.t < bestT) {
            bestT = hit.t;
            bestHit = { x: hit.x, y: hit.y, zRidge: ridge.zRidge };
          }
        }
        if (!bestHit) continue;
        const fromIdx = findComposedVertex(composed, rx, ry, sec.z);
        const toIdx = findComposedVertex(
          composed, bestHit.x, bestHit.y, sec.z + bestHit.zRidge,
        );
        if (fromIdx < 0 || toIdx < 0) continue;
        out.push({ fromIdx, toIdx, edgeType: 'valley' });
      }
      return out;
    }
    // Phase 14.R.14 — skeleton-single-reflex edges = union of both
    // sub-polygons' edges, with the shared bisector edge reclassified
    // as 'valley' in each. The bisector is always the LAST eave edge
    // of each sub-polygon (closing-edge from its last vertex back to
    // its first).
    if (mode === 'skeleton-single-reflex') {
      const split = polygonSplitAtReflexBisector(sec.polygon);
      if (split) {
        const subA = subPolyHipSection(sec, split.subPolyA);
        const subB = subPolyHipSection(sec, split.subPolyB);
        const subAVertCount = vertices3d(subA).length;
        const out: Edge3d[] = [];
        const emitSub = (
          subEdges: Edge3d[],
          vertCount: number,
          offset: number,
        ) => {
          for (const e of subEdges) {
            // The closing eave edge of a convex polygon in
            // edges3d() has `fromIdx === N-1` and `toIdx === 0`
            // (where N === polyCount). That's the bisector — flag
            // it as valley.
            const polyCount = vertCount - 1; // apex is at index N-1 ... wait
            // Actually for a pyramid: N polygon verts at indices [0, N-1],
            // apex at index N. So polyCount = vertCount - 1.
            const isClosingEave = e.edgeType === 'eave'
              && e.fromIdx === polyCount - 1
              && e.toIdx === 0;
            out.push({
              fromIdx: e.fromIdx + offset,
              toIdx: e.toIdx + offset,
              edgeType: isClosingEave ? 'valley' : e.edgeType,
            });
          }
        };
        emitSub(edges3d(subA), subAVertCount, 0);
        emitSub(edges3d(subB), vertices3d(subB).length, subAVertCount);
        return out;
      }
    }
    // Phase 14.R.17 / R.20 — convex polygon shed. One edge per
    // polygon side, classified by its endpoints' along-axis scalars:
    //   • both endpoints at low-edge value → eave
    //   • both endpoints at high-edge value → ridge
    //   • mixed (spans low to high) → rake
    if (mode === 'shed-auto') {
      const s = computePolygonShed(
        sec.polygon, sec.slope, sec.roofAxisOverrideDeg,
      );
      if (s) {
        const out: Edge3d[] = [];
        const n = sec.polygon.length;
        const eps = 1e-6;
        const isAt = (v: number, target: number) => Math.abs(v - target) < eps;
        for (let i = 0; i < n; i++) {
          const next = (i + 1) % n;
          const a1 = s.alongAxis[i]!;
          const a2 = s.alongAxis[next]!;
          const bothLow = isAt(a1, s.lowValue) && isAt(a2, s.lowValue);
          const bothHigh = isAt(a1, s.highValue) && isAt(a2, s.highValue);
          const type: EdgeType = bothLow ? 'eave' : bothHigh ? 'ridge' : 'rake';
          out.push({ fromIdx: i, toIdx: next, edgeType: type });
        }
        return out;
      }
    }
    // Phase 14.R.16 — convex polygon gable. Vertex indices:
    //   [0, N-1]    polygon eave corners at z
    //   [N, 2N-1]   per-vertex ridge projections at z + rise
    // Emits N eave edges around the base, N slope-or-rake edges
    // connecting each eave corner to its ridge projection, and one
    // ridge edge for each pair of consecutive polygon vertices whose
    // projections differ (suppressed when projections coincide — the
    // two eave corners share an apex point, the classic gable-end).
    if (mode === 'gable-ridge-auto') {
      const g = computePolygonGable(sec.polygon, sec.slope);
      if (g) {
        const out: Edge3d[] = [];
        const n = sec.polygon.length;
        const eps = 1e-6;
        const sameXY = (
          a: readonly [number, number],
          b: readonly [number, number],
        ) => Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps;
        const atRidgeEnd = (p: readonly [number, number]) =>
          sameXY(p, g.ridgeStart) || sameXY(p, g.ridgeEnd);

        for (let i = 0; i < n; i++) {
          out.push({ fromIdx: i, toIdx: (i + 1) % n, edgeType: 'eave' });
        }
        for (let i = 0; i < n; i++) {
          // A slope edge becomes a 'rake' when it terminates at one
          // of the ridge segment's endpoints — the classic gable-end
          // slanted rake board lives here.
          const type: EdgeType = atRidgeEnd(g.projections[i]!) ? 'rake' : 'slope';
          out.push({ fromIdx: i, toIdx: n + i, edgeType: type });
        }
        for (let i = 0; i < n; i++) {
          const next = (i + 1) % n;
          if (sameXY(g.projections[i]!, g.projections[next]!)) continue;
          out.push({ fromIdx: n + i, toIdx: n + next, edgeType: 'ridge' });
        }
        return out;
      }
    }
    // Phase 14.R.21 — concave + gable. Emit each convex leaf's gable
    // edges with the correct offset, then overlay valley edges at
    // ground level for every bisector split in the decomposition.
    if (mode === 'skeleton-gable') {
      const decomp = polygonDecomposeToConvex(sec.polygon);
      if (decomp) {
        const out: Edge3d[] = [];
        // Compose all leaves' vertices once for valley lookup.
        const composed: [number, number, number][] = [];
        let offset = 0;
        for (const leaf of decomp.convexLeaves) {
          const subSec = subPolyGableSection(sec, leaf);
          const subEdges = edges3d(subSec);
          const subVerts = vertices3d(subSec);
          for (const v of subVerts) composed.push(v);
          for (const e of subEdges) {
            out.push({
              fromIdx: e.fromIdx + offset,
              toIdx: e.toIdx + offset,
              edgeType: e.edgeType,
            });
          }
          offset += subVerts.length;
        }
        // Overlay valley edges between reflex vertices and bisector
        // hits — both endpoints at z = sec.z (ground plane).
        for (const v of decomp.valleys) {
          const fromIdx = findComposedVertex(composed, v.from[0], v.from[1], sec.z);
          const toIdx = findComposedVertex(composed, v.to[0], v.to[1], sec.z);
          if (fromIdx < 0 || toIdx < 0) continue;
          out.push({ fromIdx, toIdx, edgeType: 'valley' });
        }
        return out;
      }
    }
    // Phase 14.R.15 — multi-reflex recursive decomposition. Emit each
    // convex leaf's edges with the right offset; explicit valley
    // edges are overlaid from the decomposition's valley list
    // (connecting reflex vertices to their bisector hits). Ground-
    // plane valleys mean the 3D endpoints are at z=sec.z; we look up
    // matching composed vertices.
    if (mode === 'skeleton-multi-reflex') {
      const decomp = polygonDecomposeToConvex(sec.polygon);
      if (decomp) {
        const composed = vertices3dFromLeaves(sec, decomp.convexLeaves);
        const out: Edge3d[] = [];
        let offset = 0;
        for (const leaf of decomp.convexLeaves) {
          const subSec = subPolyHipSection(sec, leaf);
          const subEdges = edges3d(subSec);
          const subVerts = vertices3d(subSec).length;
          for (const e of subEdges) {
            out.push({
              fromIdx: e.fromIdx + offset,
              toIdx: e.toIdx + offset,
              edgeType: e.edgeType,
            });
          }
          offset += subVerts;
        }
        // Overlay valley edges (at ground level — they sit on the
        // shared seams between leaves).
        for (const v of decomp.valleys) {
          const fromIdx = findComposedVertex(composed, v.from[0], v.from[1], sec.z);
          const toIdx = findComposedVertex(composed, v.to[0], v.to[1], sec.z);
          if (fromIdx < 0 || toIdx < 0) continue;
          out.push({ fromIdx, toIdx, edgeType: 'valley' });
        }
        return out;
      }
    }
    const n = sec.polygon.length;
    const out: Edge3d[] = [];
    for (let i = 0; i < n; i++) {
      out.push({ fromIdx: i, toIdx: (i + 1) % n, edgeType: 'eave' });
    }
    if (mode === 'pyramid') {
      // Apex is at index n (appended by vertices3d).
      for (let i = 0; i < n; i++) {
        out.push({ fromIdx: i, toIdx: n, edgeType: 'hip' });
      }
    }
    return out;
  }
  if (sec.roofType === 'flat') {
    return [
      { fromIdx: 0, toIdx: 1, edgeType: 'eave' },
      { fromIdx: 1, toIdx: 2, edgeType: 'eave' },
      { fromIdx: 2, toIdx: 3, edgeType: 'eave' },
      { fromIdx: 3, toIdx: 0, edgeType: 'eave' },
    ];
  }
  if (sec.roofType === 'shed') {
    return [
      { fromIdx: 0, toIdx: 1, edgeType: 'eave' },
      { fromIdx: 2, toIdx: 3, edgeType: 'ridge' },
      { fromIdx: 0, toIdx: 3, edgeType: 'rake' },
      { fromIdx: 1, toIdx: 2, edgeType: 'rake' },
    ];
  }
  if (sec.roofType === 'hip') {
    const edges: Edge3d[] = [
      { fromIdx: 0, toIdx: 1, edgeType: 'eave' },
      { fromIdx: 1, toIdx: 2, edgeType: 'eave' },
      { fromIdx: 2, toIdx: 3, edgeType: 'eave' },
      { fromIdx: 3, toIdx: 0, edgeType: 'eave' },
    ];
    const v = vertices3d(sec);
    if (
      v.length >= 6
      && Math.abs(v[4]![0] - v[5]![0]) < 0.01
      && Math.abs(v[4]![1] - v[5]![1]) < 0.01
    ) {
      // Pyramid — single peak
      edges.push(
        { fromIdx: 0, toIdx: 4, edgeType: 'hip' },
        { fromIdx: 1, toIdx: 4, edgeType: 'hip' },
        { fromIdx: 2, toIdx: 4, edgeType: 'hip' },
        { fromIdx: 3, toIdx: 4, edgeType: 'hip' },
      );
    } else {
      edges.push(
        { fromIdx: 4, toIdx: 5, edgeType: 'ridge' },
        { fromIdx: 0, toIdx: 4, edgeType: 'hip' },
        { fromIdx: 3, toIdx: 4, edgeType: 'hip' },
        { fromIdx: 1, toIdx: 5, edgeType: 'hip' },
        { fromIdx: 2, toIdx: 5, edgeType: 'hip' },
      );
    }
    return edges;
  }
  // gable
  return [
    { fromIdx: 0, toIdx: 1, edgeType: 'eave' },
    { fromIdx: 2, toIdx: 3, edgeType: 'eave' },
    { fromIdx: 0, toIdx: 3, edgeType: 'rake' },
    { fromIdx: 1, toIdx: 2, edgeType: 'rake' },
    { fromIdx: 4, toIdx: 5, edgeType: 'ridge' },
    { fromIdx: 0, toIdx: 4, edgeType: 'slope' },
    { fromIdx: 3, toIdx: 4, edgeType: 'slope' },
    { fromIdx: 1, toIdx: 5, edgeType: 'slope' },
    { fromIdx: 2, toIdx: 5, edgeType: 'slope' },
  ];
}

export interface Face3d {
  vertexIndices: number[];
  faceType: FaceType;
}

/** Faces as vertex-index lists + a type classifier for rendering.
 *  • Polygon + flat (R.9): ONE face covering every vertex in order.
 *    Concave shapes need ear-clipping downstream.
 *  • Polygon + hip + convex (R.11): N triangular faces (one per
 *    base edge, each a `hip_left` triangle sloping up to the apex).
 *    Already triangles — downstream fan-triangulation is a no-op. */
export function faces3d(
  sec: Pick<RoofSection,
    'x' | 'y' | 'length' | 'run' | 'overhang' | 'slope' | 'z' | 'rotation' | 'roofType' | 'polygon' | 'roofAxisOverrideDeg'>,
): Face3d[] {
  if (hasPolygon(sec)) {
    const mode = classifyPolygonRoof(sec);
    if (mode === 'pyramid') {
      const n = sec.polygon.length;
      const out: Face3d[] = [];
      for (let i = 0; i < n; i++) {
        out.push({
          vertexIndices: [i, (i + 1) % n, n],
          faceType: 'hip_left',
        });
      }
      return out;
    }
    if (mode === 'rectilinear-union') {
      // Phase 14.R.12 — each sub-rect's faces concatenated with
      // an offset so their vertex indices point into the combined
      // vertex list produced by vertices3d.
      const rects = decomposeRectilinearPolygon(sec.polygon);
      const out: Face3d[] = [];
      let offset = 0;
      for (const r of rects) {
        const subSec = subRectHipSection(sec, r);
        const subFaces = faces3d(subSec);
        const subVerts = vertices3d(subSec).length;
        for (const f of subFaces) {
          out.push({
            vertexIndices: f.vertexIndices.map((i) => i + offset),
            faceType: f.faceType,
          });
        }
        offset += subVerts;
      }
      return out;
    }
    // Phase 14.R.14 — skeleton-single-reflex: concat both sub-poly
    // pyramid faces with index offsets matching vertices3d.
    if (mode === 'skeleton-single-reflex') {
      const split = polygonSplitAtReflexBisector(sec.polygon);
      if (split) {
        const subA = subPolyHipSection(sec, split.subPolyA);
        const subB = subPolyHipSection(sec, split.subPolyB);
        const subAVertCount = vertices3d(subA).length;
        const out: Face3d[] = [];
        for (const f of faces3d(subA)) {
          out.push({ vertexIndices: [...f.vertexIndices], faceType: f.faceType });
        }
        for (const f of faces3d(subB)) {
          out.push({
            vertexIndices: f.vertexIndices.map((i) => i + subAVertCount),
            faceType: f.faceType,
          });
        }
        return out;
      }
    }
    // Phase 14.R.17 — convex polygon shed: ONE tilted slope face
    // covering all N polygon vertices. All vertices lie on the
    // tilted plane (z = f(y) or z = f(x) linear in the axis
    // coordinate), so the face is planar despite looking like a
    // generic polygon.
    if (mode === 'shed-auto') {
      const s = computePolygonShed(sec.polygon, sec.slope);
      if (s) {
        const indices = sec.polygon.map((_, i) => i);
        return [{ vertexIndices: indices, faceType: 'slope' }];
      }
    }
    // Phase 14.R.16 — convex polygon gable. One face per polygon
    // edge. Quadrilateral (trapezoidal slope face) when the two
    // endpoint projections differ; triangle ("gable-end" rake face)
    // when they coincide — fan-triangulation handles both cleanly.
    if (mode === 'gable-ridge-auto') {
      const g = computePolygonGable(sec.polygon, sec.slope);
      if (g) {
        const n = sec.polygon.length;
        const out: Face3d[] = [];
        const eps = 1e-6;
        for (let i = 0; i < n; i++) {
          const next = (i + 1) % n;
          const pi = g.projections[i]!;
          const pn = g.projections[next]!;
          const sameProj
            = Math.abs(pi[0] - pn[0]) < eps && Math.abs(pi[1] - pn[1]) < eps;
          if (sameProj) {
            out.push({
              vertexIndices: [i, next, n + i],
              faceType: 'gable_left',
            });
          } else {
            out.push({
              vertexIndices: [i, next, n + next, n + i],
              faceType: 'slope_near',
            });
          }
        }
        return out;
      }
    }
    // Phase 14.R.21 — concave + gable: concat per-leaf gable faces
    // with cumulative index offsets that line up with vertices3d's
    // emission order. Each leaf contributes its own N_i trapezoid
    // + triangle face set from R.16's gable geometry.
    if (mode === 'skeleton-gable') {
      const decomp = polygonDecomposeToConvex(sec.polygon);
      if (decomp) {
        const out: Face3d[] = [];
        let offset = 0;
        for (const leaf of decomp.convexLeaves) {
          const subSec = subPolyGableSection(sec, leaf);
          const subFaces = faces3d(subSec);
          const subVerts = vertices3d(subSec).length;
          for (const f of subFaces) {
            out.push({
              vertexIndices: f.vertexIndices.map((i) => i + offset),
              faceType: f.faceType,
            });
          }
          offset += subVerts;
        }
        return out;
      }
    }
    // Phase 14.R.15 — multi-reflex: concat every convex leaf's
    // pyramid faces with cumulative index offsets that line up with
    // vertices3d's emission order.
    if (mode === 'skeleton-multi-reflex') {
      const decomp = polygonDecomposeToConvex(sec.polygon);
      if (decomp) {
        const out: Face3d[] = [];
        let offset = 0;
        for (const leaf of decomp.convexLeaves) {
          const subSec = subPolyHipSection(sec, leaf);
          const subFaces = faces3d(subSec);
          const subVerts = vertices3d(subSec).length;
          for (const f of subFaces) {
            out.push({
              vertexIndices: f.vertexIndices.map((i) => i + offset),
              faceType: f.faceType,
            });
          }
          offset += subVerts;
        }
        return out;
      }
    }
    const indices = sec.polygon.map((_, i) => i);
    return [{ vertexIndices: indices, faceType: 'flat' }];
  }
  if (sec.roofType === 'flat') {
    return [{ vertexIndices: [0, 1, 2, 3], faceType: 'flat' }];
  }
  if (sec.roofType === 'shed') {
    return [{ vertexIndices: [0, 1, 2, 3], faceType: 'slope' }];
  }
  if (sec.roofType === 'hip') {
    const v = vertices3d(sec);
    const isPyramid =
      v.length >= 6
      && Math.abs(v[4]![0] - v[5]![0]) < 0.01
      && Math.abs(v[4]![1] - v[5]![1]) < 0.01;
    if (!isPyramid) {
      return [
        { vertexIndices: [0, 1, 5, 4], faceType: 'slope_near' },
        { vertexIndices: [3, 2, 5, 4], faceType: 'slope_far' },
        { vertexIndices: [0, 3, 4],    faceType: 'hip_left' },
        { vertexIndices: [1, 2, 5],    faceType: 'hip_right' },
      ];
    }
    return [
      { vertexIndices: [0, 1, 4], faceType: 'slope_near' },
      { vertexIndices: [2, 3, 4], faceType: 'slope_far' },
      { vertexIndices: [0, 3, 4], faceType: 'hip_left' },
      { vertexIndices: [1, 2, 4], faceType: 'hip_right' },
    ];
  }
  // gable
  return [
    { vertexIndices: [0, 1, 5, 4], faceType: 'slope_near' },
    { vertexIndices: [3, 2, 5, 4], faceType: 'slope_far' },
    { vertexIndices: [0, 3, 4],    faceType: 'gable_left' },
    { vertexIndices: [1, 2, 5],    faceType: 'gable_right' },
  ];
}

// ── 2D view outlines + hit testing ───────────────────────────────

/**
 * Convex outline polygon in 2D for a given view. Used for hit
 * testing in elevation/profile views.
 */
export function outlineForView(
  sec: Pick<RoofSection,
    'x' | 'y' | 'length' | 'run' | 'overhang' | 'slope' | 'z' | 'rotation' | 'roofType'>,
  view: RoofView,
): [number, number][] {
  if (view === 'top') return corners(sec);
  const verts = vertices3d(sec);
  const pts: [number, number][] = view === 'front'
    ? verts.map(([x, _y, z]) => [x, z])
    : verts.map(([_x, y, z]) => [y, z]);

  if (pts.length < 3) return pts;

  // Deduplicate + sort by angle around centroid (poor-man's
  // convex hull; matches Python's behavior). Good enough for
  // hit-testing rectangular-ish section profiles.
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const seen = new Set<string>();
  const unique: [number, number][] = [];
  for (const p of pts) {
    const key = `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  unique.sort((a, b) =>
    Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx),
  );
  return unique;
}

/** Hit-test for any view (plan, front, side/profile). */
export function containsPointView(
  sec: Pick<RoofSection,
    'x' | 'y' | 'length' | 'run' | 'overhang' | 'slope' | 'z' | 'rotation' | 'roofType'>,
  wx: number,
  wy: number,
  view: RoofView,
): boolean {
  return pointInPolygon(wx, wy, outlineForView(sec, view));
}

// ── Measure line length ─────────────────────────────────────────

export function measureLength(m: Pick<MeasureLine, 'x1' | 'y1' | 'x2' | 'y2'>): number {
  const dx = m.x2 - m.x1;
  const dy = m.y2 - m.y1;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── PDF calibration ─────────────────────────────────────────────

/**
 * Compute calibration `scale` (pixels per foot) from two screen
 * points + a known real-world distance in feet. Returns a new
 * PDFLayer with scale + calibration anchors set.
 */
export function calibratePdf(
  pdf: PDFLayer,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  realFt: number,
): PDFLayer {
  const pxDist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  const scale = realFt > 0 && pxDist > 0 ? pxDist / realFt : pdf.scale;
  return {
    ...pdf,
    calX1: x1, calY1: y1, calX2: x2, calY2: y2,
    calDistanceFt: realFt,
    scale,
  };
}

// ── Aggregate queries (operate on section lists) ─────────────────

export function totalAreaNet(sections: ReadonlyArray<RoofSection>): number {
  return sections.reduce((s, sec) => s + areaActual(sec), 0);
}

export function totalAreaPlan(sections: ReadonlyArray<RoofSection>): number {
  return sections.reduce((s, sec) => s + areaPlan(sec), 0);
}

export function totalPerimeter(sections: ReadonlyArray<RoofSection>): number {
  return sections.reduce((s, sec) => s + perimeterPlan(sec), 0);
}

// ── Hit test across a section collection ────────────────────────

/**
 * Return the section ID of the TOPMOST section containing the
 * given point in the given view, or null if none. "Topmost"
 * means the section added last takes precedence when drawings
 * overlap — matches the Python `reversed(list(...))` iteration.
 */
export function sectionAt(
  sections: ReadonlyArray<RoofSection>,
  wx: number,
  wy: number,
  view: RoofView = 'top',
): string | null {
  for (let i = sections.length - 1; i >= 0; i--) {
    const sec = sections[i]!;
    if (containsPointView(sec, wx, wy, view)) {
      return sec.sectionId;
    }
  }
  return null;
}

// ── Distance helper (for RoofVertex) ────────────────────────────

export function vertexDistance(
  a: Pick<RoofVertex, 'x' | 'y'>,
  b: Pick<RoofVertex, 'x' | 'y'>,
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Empty / initial snapshot ────────────────────────────────────

export function emptyRoofSnapshot(): RoofGraphSnapshot {
  return {
    sections: {},
    vertices: {},
    measures: {},
    layers: DEFAULT_LAYERS.map((l) => ({ ...l })),
    pdf: emptyPdfLayer(),
    penetrations: {},
    penetrationOrder: [],
  };
}
