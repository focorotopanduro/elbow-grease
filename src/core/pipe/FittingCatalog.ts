/**
 * FittingCatalog — what fittings are legal per material, at what sizes,
 * and what they cost.
 *
 * Different piping standards support different bend angles and branch
 * styles:
 *
 *   PVC DWV        1/16 (22.5°), 1/8 (45°), 1/4 (90°), long-sweep 1/4,
 *                  sanitary tee, wye, combo wye+1/8, closet flange,
 *                  cleanout, P-trap, coupling, reducer, cap
 *
 *   PVC supply     no DWV-specific fittings; uses tee, elbow 90/45,
 *                  coupling, reducer, cap, cross
 *
 *   Copper L/M     elbow 90/45 only (no 22.5°), tee, coupling, reducer,
 *                  cap. No wye/sanitary because copper isn't used for
 *                  DWV in residential.
 *
 *   Cast Iron      1/16, 1/8, 1/4, long-sweep 1/4, sanitary tee, wye,
 *                  combo, closet flange, cleanout. Gasket-joined.
 *
 *   PEX (Uponor)   MINIMAL — only tees, couplings, reducers, caps, and
 *                  manifolds. No elbows because PEX-A bends to 6× OD.
 *                  This matches Uponor ProPEX install guides.
 *
 *   CPVC           elbow 90/45, tee, coupling, reducer, cap.
 *
 *   ABS DWV        same topology as PVC DWV.
 *
 *   Galvanized     elbow 90/45, tee, coupling, reducer. Threaded joints.
 *
 * Legal bend angles are enforced when generating fittings: a 30° bend
 * on PVC snaps to the nearest legal angle (45° in this case), or flags
 * the geometry as illegal.
 */

import type { FittingType, PipeMaterial } from '../../engine/graph/GraphEdge';

// ── Per-fitting metadata ────────────────────────────────────────

export interface FittingDef {
  id: FittingType;
  label: string;
  shortLabel: string;
  /** Bend angle in degrees, or null for non-bend fittings. */
  angleDeg: number | null;
  kind: 'bend' | 'tee' | 'wye' | 'combo' | 'cross' | 'coupling' | 'reducer' | 'cap' | 'special' | 'manifold';
  /** Nominal sizes this fitting is available in (inches). */
  sizes: number[];
  /** Icon for UI. */
  icon: string;
  /** Is this a branching fitting (multiple pipe connections)? */
  isBranch: boolean;
  /** Which materials support this fitting. */
  materials: PipeMaterial[];
}

// ── Material short lists ────────────────────────────────────────

const PVC_DWV: PipeMaterial[] = ['pvc_sch40', 'pvc_sch80', 'abs'];
const CAST_DWV: PipeMaterial[] = ['cast_iron', 'ductile_iron'];
const ALL_DWV: PipeMaterial[] = [...PVC_DWV, ...CAST_DWV];
const RIGID_SUPPLY: PipeMaterial[] = ['pvc_sch40', 'pvc_sch80', 'cpvc', 'copper_type_l', 'copper_type_m', 'galvanized_steel'];
const FLEXIBLE: PipeMaterial[] = ['pex'];

// ── Catalog ─────────────────────────────────────────────────────

export const FITTING_CATALOG: Partial<Record<FittingType, FittingDef>> = {
  // Bends (rigid pipe only — legal angle detents)
  bend_22_5: {
    id: 'bend_22_5', label: '1/16 Bend (22.5°)', shortLabel: '1/16',
    angleDeg: 22.5, kind: 'bend', sizes: [1.5, 2, 3, 4, 6], icon: '◜',
    isBranch: false, materials: [...ALL_DWV, ...RIGID_SUPPLY],
  },
  bend_45: {
    id: 'bend_45', label: '1/8 Bend (45°)', shortLabel: '1/8',
    angleDeg: 45, kind: 'bend', sizes: [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6], icon: '◝',
    isBranch: false, materials: [...ALL_DWV, ...RIGID_SUPPLY],
  },
  bend_90: {
    id: 'bend_90', label: '1/4 Bend (90°)', shortLabel: '1/4',
    angleDeg: 90, kind: 'bend', sizes: [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6], icon: '└',
    isBranch: false, materials: [...ALL_DWV, ...RIGID_SUPPLY],
  },
  bend_90_ls: {
    id: 'bend_90_ls', label: '1/4 Bend — Long Sweep', shortLabel: 'LS 1/4',
    angleDeg: 90, kind: 'bend', sizes: [1.5, 2, 3, 4], icon: '╰',
    isBranch: false, materials: ALL_DWV,
  },

  // Legacy elbow aliases (copper/galvanized use "elbow" naming)
  elbow_90: {
    id: 'elbow_90', label: 'Elbow 90°', shortLabel: 'E90',
    angleDeg: 90, kind: 'bend', sizes: [0.375, 0.5, 0.75, 1, 1.25, 1.5, 2], icon: '└',
    isBranch: false, materials: ['copper_type_l', 'copper_type_m', 'cpvc', 'galvanized_steel'],
  },
  elbow_45: {
    id: 'elbow_45', label: 'Elbow 45°', shortLabel: 'E45',
    angleDeg: 45, kind: 'bend', sizes: [0.375, 0.5, 0.75, 1, 1.25, 1.5, 2], icon: '◝',
    isBranch: false, materials: ['copper_type_l', 'copper_type_m', 'cpvc', 'galvanized_steel'],
  },

  // Branching
  tee: {
    id: 'tee', label: 'Tee', shortLabel: 'T',
    angleDeg: 90, kind: 'tee', sizes: [0.375, 0.5, 0.75, 1, 1.25, 1.5, 2], icon: '┬',
    isBranch: true, materials: [...RIGID_SUPPLY, ...FLEXIBLE],
  },
  sanitary_tee: {
    id: 'sanitary_tee', label: 'Sanitary Tee', shortLabel: 'SAN T',
    angleDeg: 90, kind: 'tee', sizes: [1.5, 2, 3, 4], icon: '┬',
    isBranch: true, materials: ALL_DWV,
  },
  wye: {
    // Stand-alone wye (no 1/8 bend) — seldom used in residential DWV;
    // kept in the catalog for completeness but the auto-classifier
    // never selects it. Prefer combo_wye_eighth in practice.
    id: 'wye', label: 'Wye 45° (rare)', shortLabel: 'Y',
    angleDeg: 45, kind: 'wye', sizes: [1.5, 2, 3, 4, 6], icon: 'Y',
    isBranch: true, materials: ALL_DWV,
  },
  combo_wye_eighth: {
    id: 'combo_wye_eighth', label: 'Combo Wye + 1/8', shortLabel: 'COMBO',
    angleDeg: 45, kind: 'combo', sizes: [1.5, 2, 3, 4], icon: '⟋',
    isBranch: true, materials: ALL_DWV,
  },
  cross: {
    id: 'cross', label: 'Cross (4-way)', shortLabel: 'X',
    angleDeg: 90, kind: 'cross', sizes: [0.5, 0.75, 1, 1.5, 2], icon: '┼',
    isBranch: true, materials: RIGID_SUPPLY,
  },

  // Joints
  coupling: {
    id: 'coupling', label: 'Coupling', shortLabel: 'CPL',
    angleDeg: null, kind: 'coupling', sizes: [0.375, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4], icon: '═',
    isBranch: false, materials: [...RIGID_SUPPLY, ...ALL_DWV, ...FLEXIBLE],
  },
  reducer: {
    id: 'reducer', label: 'Reducer', shortLabel: 'RED',
    angleDeg: null, kind: 'reducer', sizes: [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4], icon: '⊐',
    isBranch: false, materials: [...RIGID_SUPPLY, ...ALL_DWV, ...FLEXIBLE],
  },
  cap: {
    id: 'cap', label: 'Cap', shortLabel: 'CAP',
    angleDeg: null, kind: 'cap', sizes: [0.375, 0.5, 0.75, 1, 1.5, 2, 3, 4], icon: '●',
    isBranch: false, materials: [...RIGID_SUPPLY, ...ALL_DWV, ...FLEXIBLE],
  },

  // DWV specials
  p_trap: {
    id: 'p_trap', label: 'P-Trap', shortLabel: 'P-TRAP',
    angleDeg: null, kind: 'special', sizes: [1.25, 1.5, 2, 3], icon: '⌒',
    isBranch: false, materials: ALL_DWV,
  },
  cleanout_adapter: {
    id: 'cleanout_adapter', label: 'Cleanout', shortLabel: 'CO',
    angleDeg: null, kind: 'special', sizes: [1.5, 2, 3, 4], icon: '◉',
    isBranch: false, materials: ALL_DWV,
  },
  closet_flange: {
    id: 'closet_flange', label: 'Closet Flange', shortLabel: 'CF',
    angleDeg: null, kind: 'special', sizes: [3, 4], icon: '⊙',
    isBranch: false, materials: ALL_DWV,
  },

  // PEX Manifolds (home-run supply distribution)
  manifold_2: {
    id: 'manifold_2', label: 'Manifold 2-port', shortLabel: 'M×2',
    angleDeg: null, kind: 'manifold', sizes: [0.5, 0.75, 1], icon: '⫶',
    isBranch: true, materials: FLEXIBLE,
  },
  manifold_4: {
    id: 'manifold_4', label: 'Manifold 4-port', shortLabel: 'M×4',
    angleDeg: null, kind: 'manifold', sizes: [0.5, 0.75, 1], icon: '⫶',
    isBranch: true, materials: FLEXIBLE,
  },
  manifold_6: {
    id: 'manifold_6', label: 'Manifold 6-port', shortLabel: 'M×6',
    angleDeg: null, kind: 'manifold', sizes: [0.75, 1], icon: '⫶',
    isBranch: true, materials: FLEXIBLE,
  },
  manifold_8: {
    id: 'manifold_8', label: 'Manifold 8-port', shortLabel: 'M×8',
    angleDeg: null, kind: 'manifold', sizes: [1], icon: '⫶',
    isBranch: true, materials: FLEXIBLE,
  },
};

// ── Pricing ─────────────────────────────────────────────────────

/**
 * Approximate 2026 contractor pricing per fitting (USD).
 * Structure: material → fittingType → nominalSize → price.
 * Falls back to DEFAULT_PRICE when the combo isn't listed.
 */
export const FITTING_PRICE_USD: Partial<Record<PipeMaterial,
  Partial<Record<FittingType, Record<number, number>>>>> = {
  pvc_sch40: {
    bend_22_5:   { 2: 2.10, 3: 4.80, 4: 8.50 },
    bend_45:     { 0.5: 0.85, 0.75: 1.10, 1: 1.60, 1.5: 2.40, 2: 3.20, 3: 6.50, 4: 11.00 },
    bend_90:     { 0.5: 0.95, 0.75: 1.25, 1: 1.90, 1.5: 2.80, 2: 3.80, 3: 7.50, 4: 13.00 },
    bend_90_ls:  { 1.5: 3.20, 2: 4.50, 3: 8.50, 4: 14.50 },
    tee:         { 0.5: 1.20, 0.75: 1.60, 1: 2.20, 1.5: 3.20, 2: 4.50 },
    sanitary_tee:{ 1.5: 4.50, 2: 6.00, 3: 10.00, 4: 17.00 },
    wye:         { 1.5: 5.50, 2: 7.50, 3: 12.50, 4: 21.00 },
    combo_wye_eighth: { 1.5: 6.80, 2: 9.00, 3: 15.00, 4: 26.00 },
    coupling:    { 0.5: 0.50, 0.75: 0.65, 1: 0.90, 1.5: 1.40, 2: 1.90, 3: 4.00, 4: 7.00 },
    reducer:     { 0.75: 1.20, 1: 1.80, 1.5: 2.80, 2: 3.80, 3: 7.50, 4: 13.00 },
    cap:         { 0.5: 0.55, 1: 0.95, 2: 2.10, 3: 4.50, 4: 7.80 },
    p_trap:      { 1.25: 3.80, 1.5: 4.50, 2: 6.00, 3: 10.50 },
    cleanout_adapter: { 2: 5.00, 3: 8.50, 4: 15.00 },
    closet_flange:    { 3: 6.50, 4: 9.50 },
  },
  pex: {
    tee:         { 0.5: 2.80, 0.75: 4.50, 1: 7.00 },
    coupling:    { 0.5: 1.60, 0.75: 2.40, 1: 3.80 },
    reducer:     { 0.75: 2.80, 1: 4.20 },
    cap:         { 0.5: 1.20, 0.75: 1.80, 1: 2.80 },
    manifold_2:  { 0.5: 22.00, 0.75: 28.00, 1: 38.00 },
    manifold_4:  { 0.5: 45.00, 0.75: 58.00, 1: 78.00 },
    manifold_6:  { 0.75: 85.00, 1: 110.00 },
    manifold_8:  { 1: 150.00 },
  },
  copper_type_l: {
    elbow_90:    { 0.5: 2.20, 0.75: 3.80, 1: 6.50 },
    elbow_45:    { 0.5: 3.50, 0.75: 5.80, 1: 9.50 },
    tee:         { 0.5: 3.80, 0.75: 6.50, 1: 11.00 },
    coupling:    { 0.5: 1.20, 0.75: 1.80, 1: 3.20 },
    reducer:     { 0.75: 3.50, 1: 5.80 },
    cap:         { 0.5: 1.50, 0.75: 2.50 },
  },
  copper_type_m: {
    elbow_90:    { 0.5: 1.60, 0.75: 2.80, 1: 4.80 },
    elbow_45:    { 0.5: 2.50, 0.75: 4.20, 1: 7.00 },
    tee:         { 0.5: 2.80, 0.75: 4.80, 1: 8.00 },
    coupling:    { 0.5: 0.85, 0.75: 1.30, 1: 2.40 },
  },
  cast_iron: {
    bend_22_5:   { 2: 18, 3: 28, 4: 42 },
    bend_45:     { 2: 20, 3: 32, 4: 48 },
    bend_90:     { 2: 25, 3: 40, 4: 60 },
    bend_90_ls:  { 3: 55, 4: 85 },
    sanitary_tee:{ 2: 40, 3: 62, 4: 95 },
    wye:         { 2: 45, 3: 72, 4: 110 },
    combo_wye_eighth: { 2: 55, 3: 85, 4: 135 },
  },
  cpvc: {
    elbow_90:    { 0.5: 0.85, 0.75: 1.20 },
    elbow_45:    { 0.5: 1.20, 0.75: 1.60 },
    tee:         { 0.5: 1.30, 0.75: 1.90 },
    coupling:    { 0.5: 0.50, 0.75: 0.70 },
  },
  abs: {
    bend_45:     { 1.5: 2.40, 2: 3.00, 3: 5.50, 4: 9.50 },
    bend_90:     { 1.5: 2.80, 2: 3.60, 3: 6.80, 4: 11.50 },
    sanitary_tee:{ 1.5: 4.20, 2: 5.80, 3: 9.50, 4: 16.00 },
    wye:         { 1.5: 5.20, 2: 7.20, 3: 12.00, 4: 20.00 },
  },
};

const DEFAULT_PRICE = 3.00;

export function getFittingPrice(
  material: PipeMaterial,
  type: FittingType,
  sizeIn: number,
): number {
  const mat = FITTING_PRICE_USD[material];
  if (!mat) return DEFAULT_PRICE;
  const byType = mat[type];
  if (!byType) return DEFAULT_PRICE;
  // Exact size match
  if (byType[sizeIn] != null) return byType[sizeIn]!;
  // Closest size fallback
  const sizes = Object.keys(byType).map(Number);
  if (sizes.length === 0) return DEFAULT_PRICE;
  const closest = sizes.reduce((prev, cur) =>
    Math.abs(cur - sizeIn) < Math.abs(prev - sizeIn) ? cur : prev,
  );
  return byType[closest] ?? DEFAULT_PRICE;
}

// ── Angle classification ────────────────────────────────────────

/** Legal bend angles for rigid pipe (degrees). */
export const LEGAL_BEND_ANGLES_DEG = [22.5, 45, 90] as const;
export type LegalBendAngle = typeof LEGAL_BEND_ANGLES_DEG[number];

/** Tolerance within which a measured bend snaps to a legal angle. */
export const BEND_SNAP_TOLERANCE_DEG = 8;

/**
 * Classify a measured bend angle to the nearest legal fitting.
 * Returns null for near-straight bends (< 5° — not a fitting at all).
 * Returns { type: 'illegal', ... } for bends outside snap tolerance.
 * Returns { type: 'bend_XX', ... } for bends within tolerance.
 *
 * The long-sweep variant is preferred for DWV horizontal→vertical
 * transitions when the bend radius is large (hinted by `sweepHint`).
 */
export interface ClassifiedBend {
  kind: 'straight' | 'snapped' | 'illegal';
  fittingType: FittingType | null;
  measuredDeg: number;
  snappedDeg: number | null;
  errorDeg: number;
}

export function classifyBendAngle(
  measuredDeg: number,
  opts: { sweepHint?: boolean } = {},
): ClassifiedBend {
  if (measuredDeg < 5) {
    return { kind: 'straight', fittingType: null, measuredDeg, snappedDeg: null, errorDeg: 0 };
  }

  // Find nearest legal angle
  let bestAngle: number = LEGAL_BEND_ANGLES_DEG[0];
  let bestErr = Infinity;
  for (const legal of LEGAL_BEND_ANGLES_DEG) {
    const err = Math.abs(measuredDeg - legal);
    if (err < bestErr) { bestErr = err; bestAngle = legal; }
  }

  const withinTolerance = bestErr <= BEND_SNAP_TOLERANCE_DEG;
  let type: FittingType;
  if (bestAngle === 22.5) type = 'bend_22_5';
  else if (bestAngle === 45) type = 'bend_45';
  else type = opts.sweepHint ? 'bend_90_ls' : 'bend_90';

  return {
    kind: withinTolerance ? 'snapped' : 'illegal',
    fittingType: withinTolerance ? type : null,
    measuredDeg,
    snappedDeg: bestAngle,
    errorDeg: bestErr,
  };
}

// ── Material feature flags ──────────────────────────────────────

/** Does this material REQUIRE bend fittings (rigid) or can it flex? */
export function requiresBendFittings(material: PipeMaterial): boolean {
  return !FLEXIBLE.includes(material);
}

/**
 * Default tee type for branch-joining two pipes of this material.
 *
 * Phase 14.AD.22 — ORIENTATION-AWARE DWV classifier.
 *
 * Real field-practice rules (per PVC catalog + UPC 706.3 + user
 * specification 2026-04-20):
 *
 *   PVC / Cast Iron DWV:
 *     • Horizontal main with a VERTICAL branch (up-vent, or a
 *       horizontal drain line tapping into a vertical stack) →
 *       **sanitary tee** (san-tee). The san-tee's perpendicular
 *       branch inlet is designed exactly for this case.
 *     • Vertical main with a HORIZONTAL branch (stack drop
 *       transitioning to a lateral drain) → **combo wye + 1/8
 *       bend** (combo). The combo's built-in 45° sweep lets the
 *       flow turn gracefully without a hydraulic jump.
 *     • Horizontal main with a HORIZONTAL branch (both pipes laid
 *       flat on the floor — DWV branch lateral) → **combo** too.
 *       Plumbers install these with the middle inlet against the
 *       floor so the branch's 45° sweep carries flow back into
 *       canonical drainage direction.
 *     • 45° branch ON A HORIZONTAL PLANE with no vertical
 *       component either side → plain **wye** (rarer; the simpler
 *       Y-fitting without the 1/8 bend).
 *
 *   Supply (PEX, copper, CPVC, galvanized):
 *     • Any branch → plain **tee**. Supply systems don't care
 *       about flow-sweep the way drainage does.
 *
 * If orientation vectors are NOT provided the function falls back
 * to angle-only classification (used by legacy tests + call sites
 * that don't plumb direction through). Angle-only rules:
 *   • ~90° → sanitary_tee (assumes horizontal-to-vertical)
 *   • ~45° → wye
 *   • other → combo_wye_eighth
 *
 * Y is the world vertical axis (THREE.js convention).
 */
export interface TeeClassifyOpts {
  /** Unit vector along the main run (the through pipe's direction). */
  mainDir?: readonly [number, number, number];
  /** Unit vector along the branch (the tapping pipe's direction, outward). */
  branchDir?: readonly [number, number, number];
}

export function defaultTeeFor(
  material: PipeMaterial,
  branchAngleDeg: number,
  isDWV: boolean,
  opts: TeeClassifyOpts = {},
): FittingType {
  if (FLEXIBLE.includes(material)) return 'tee';
  if (!isDWV) {
    // Supply-side rigid (copper, CPVC, galv): plain tee.
    return 'tee';
  }

  const { mainDir, branchDir } = opts;
  if (mainDir && branchDir) {
    // Y-axis dominance determines "vertical" vs "horizontal" run.
    // 0.7 cutoff ≈ 45° off-vertical; anything with a stronger Y
    // component than that is treated as a riser/stack.
    const VERT_CUTOFF = 0.7;
    const mainVertical = Math.abs(mainDir[1]) >= VERT_CUTOFF;
    const mainHorizontal = Math.abs(mainDir[1]) <= 1 - VERT_CUTOFF; // y ≤ 0.3
    const branchVertical = Math.abs(branchDir[1]) >= VERT_CUTOFF;
    const branchHorizontal = Math.abs(branchDir[1]) <= 1 - VERT_CUTOFF;

    // Rule 1: horizontal main + vertical branch → san-tee.
    if (mainHorizontal && branchVertical) return 'sanitary_tee';
    // Rule 2: vertical main + horizontal branch → combo.
    if (mainVertical && branchHorizontal) return 'combo_wye_eighth';
    // Rule 3: both horizontal (laid flat DWV lateral) → combo.
    if (mainHorizontal && branchHorizontal) {
      // Strictly-45° horizontal branch with no vertical component
      // is a plain wye; otherwise combo handles the sweep.
      if (Math.abs(branchAngleDeg - 45) <= 10) return 'wye';
      return 'combo_wye_eighth';
    }
    // Rule 4: both vertical (stack continuation + cleanout tee or
    // a parallel vent stack) → san-tee with the branch pointing
    // sideways. This is the upper-floor vent case.
    if (mainVertical && branchVertical) return 'sanitary_tee';
    // Mixed / in-between angles (e.g. a 45°-up branch off a
    // horizontal main) — fall through to angle heuristic.
  }

  // Angle-only fallback (no directions provided).
  if (Math.abs(branchAngleDeg - 90) <= 20) return 'sanitary_tee';
  if (Math.abs(branchAngleDeg - 45) <= 15) return 'wye';
  return 'combo_wye_eighth';
}
