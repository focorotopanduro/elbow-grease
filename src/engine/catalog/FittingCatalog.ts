/**
 * FittingCatalog — IPC-accurate library of plumbing fittings.
 *
 * This is the canonical source of truth for every fitting the app
 * can place. Each entry captures:
 *   - Manufacturer-agnostic fitting identity (type + subtype)
 *   - Real-world angle (for geometry constraints)
 *   - Equivalent length in feet (for friction loss calcs)
 *   - Cost per unit by diameter (for BOM rollup)
 *   - Allowed pipe materials (PVC, copper, PEX, etc.)
 *   - Part number hints (generic, supplier lookup key)
 *   - IPC section references (for compliance checking)
 *
 * The snap-and-populate engine, angle constraint solver, and auto-
 * router all query this catalog to determine which fitting to insert
 * at any given junction or direction change.
 *
 * Terminology note: the "1/16 bend" in plumbing parlance is actually
 * a 22.5° fitting (360°/16 = 22.5°). Similarly 1/8 bend = 45°,
 * 1/4 bend = 90°, 1/5 bend = 72°, 1/6 bend = 60°. The catalog
 * preserves both the fractional name and the numerical angle so the
 * UI can show either depending on context.
 */

import type { PipeMaterial, FittingType } from '../graph/GraphEdge';

// ── Fitting bend fractions ──────────────────────────────────────

export type BendFraction = '1/16' | '1/8' | '1/6' | '1/5' | '1/4';

/** Map fraction names to their mathematical angle in radians. */
export const BEND_ANGLE_RAD: Record<BendFraction, number> = {
  '1/16': Math.PI / 8,    // 22.5°
  '1/8':  Math.PI / 4,    // 45°
  '1/6':  Math.PI / 3,    // 60°
  '1/5':  (2 * Math.PI) / 5, // 72°
  '1/4':  Math.PI / 2,    // 90°
};

/** Map fraction names to degrees. */
export const BEND_ANGLE_DEG: Record<BendFraction, number> = {
  '1/16': 22.5,
  '1/8':  45,
  '1/6':  60,
  '1/5':  72,
  '1/4':  90,
};

// ── Fitting connection patterns ─────────────────────────────────

/** How many pipes connect to this fitting, and at what relative angles. */
export interface ConnectionPattern {
  /** Number of ports on this fitting. */
  portCount: number;
  /**
   * Angle (radians) of each port measured from the fitting's primary
   * axis. Port 0 is always at 0 (primary inlet).
   */
  portAngles: number[];
  /** Whether flow direction matters (true for wyes, sanitary tees). */
  directional: boolean;
}

// ── Fitting entry ───────────────────────────────────────────────

export interface FittingEntry {
  /** Unique catalog ID (e.g. "pvc-sch40-elbow-1/4-2in"). */
  id: string;
  /** Core fitting type (matches graph/GraphEdge.ts FittingType). */
  type: FittingType;
  /** Human-readable name ("2\" PVC 1/4 Bend"). */
  name: string;
  /** Trade term ("elbow", "ell", "90", "quarter bend"). */
  tradeTerms: string[];

  /** Bend fraction (for elbows/bends). */
  bendFraction?: BendFraction;
  /** Bend angle in radians. Zero for non-bend fittings. */
  bendAngleRad: number;

  /** Nominal diameter in inches. For reducers, this is the LARGER end. */
  diameter: number;
  /** Secondary diameter (only set for reducers, couplings with step). */
  diameterReduced?: number;

  /** Pipe material this fitting pairs with. */
  material: PipeMaterial;

  /** Connection topology. */
  connection: ConnectionPattern;

  /** Equivalent length in feet for friction loss (Darcy-Weisbach). */
  equivalentLengthFt: number;
  /** Unit cost in USD (2026 contractor pricing). */
  unitCost: number;
  /** Supplier part number hint (generic). */
  partNumber: string;

  /** IPC/UPC section references this fitting is relevant to. */
  codeRefs: string[];

  /** Notes for the drafter (e.g. "vent fitting only — do not use for drainage"). */
  notes?: string;

  /**
   * Allowed flow direction pair. For directional fittings (sanitary
   * tee, wye), specifies which ports are inlets vs outlets.
   */
  flowDirection?: { inlet: number[]; outlet: number[] };
}

// ── Standard pipe diameters (inches) ────────────────────────────

export const PIPE_DIAMETERS: Record<string, number[]> = {
  dwv:         [1.5, 2, 2.5, 3, 4, 6, 8, 10, 12],
  supply_cold: [0.375, 0.5, 0.75, 1, 1.25, 1.5, 2],
  supply_hot:  [0.375, 0.5, 0.75, 1, 1.25, 1.5, 2],
  vent:        [1.25, 1.5, 2, 2.5, 3, 4],
  storm:       [2, 3, 4, 6, 8, 10, 12, 15],
};

// ── Catalog builder helpers ─────────────────────────────────────

/**
 * Equivalent length tables (feet) for PVC schedule 40 DWV fittings.
 * Source: Plumbing Engineering Design Handbook Vol 2, Ch 3.
 */
const EQ_LENGTH_PVC_DWV: Record<string, Record<number, number>> = {
  elbow_1_4:    { 1.5: 4,   2: 5,   3: 7,   4: 10,  6: 15 }, // 90°
  elbow_1_8:    { 1.5: 2,   2: 2.5, 3: 3.5, 4: 5,   6: 7.5 }, // 45°
  elbow_1_16:   { 1.5: 1,   2: 1.3, 3: 1.8, 4: 2.5, 6: 3.8 }, // 22.5°
  tee_sanitary: { 1.5: 5,   2: 7,   3: 10,  4: 14,  6: 20 },
  wye:          { 1.5: 3,   2: 4,   3: 6,   4: 8,   6: 12 },
  coupling:     { 1.5: 0,   2: 0,   3: 0,   4: 0,   6: 0 },
  reducer:      { 1.5: 1,   2: 1.5, 3: 2.5, 4: 3.5, 6: 5 },
  p_trap:       { 1.25: 3, 1.5: 4, 2: 5,   3: 7 },
};

/**
 * Retail cost per fitting (USD) by type × diameter.
 * Reflects 2026 big-box pricing; professional supply houses discount.
 */
const COST_PVC_DWV: Record<string, Record<number, number>> = {
  elbow_1_4:    { 1.5: 2.50, 2: 4.00, 3: 10, 4: 20, 6: 48 },
  elbow_1_8:    { 1.5: 2.00, 2: 3.50, 3: 9,  4: 18, 6: 40 },
  elbow_1_16:   { 1.5: 3.00, 2: 5.00, 3: 12, 4: 22, 6: 55 },
  tee_sanitary: { 1.5: 5.00, 2: 7.50, 3: 18, 4: 32, 6: 80 },
  wye:          { 1.5: 4.50, 2: 7.00, 3: 17, 4: 30, 6: 72 },
  coupling:     { 1.5: 1.20, 2: 2.00, 3: 4,  4: 8,  6: 20 },
  reducer:      { 1.5: 3.00, 2: 4.50, 3: 10, 4: 18, 6: 40 },
  p_trap:       { 1.25: 8, 1.5: 10,  2: 14,  3: 28 },
};

// ── Build the full catalog ──────────────────────────────────────

let idCounter = 0;
const allEntries: FittingEntry[] = [];

function addBend(
  material: PipeMaterial,
  fraction: BendFraction,
  diameter: number,
  eqLength: number,
  cost: number,
): void {
  const angle = BEND_ANGLE_RAD[fraction];
  const angleDeg = BEND_ANGLE_DEG[fraction];
  const fracKey = fraction.replace('/', '_');
  const fittingType: FittingType = angleDeg === 90 ? 'elbow_90' :
                                    angleDeg === 45 ? 'elbow_45' :
                                    'elbow_90'; // collapse non-standard to closest

  allEntries.push({
    id: `fit-${idCounter++}`,
    type: fittingType,
    name: `${diameter}" ${material.replace('_', ' ')} ${fraction} Bend (${angleDeg}°)`,
    tradeTerms: [
      `${fraction} bend`,
      angleDeg === 90 ? 'elbow' : `${angleDeg}° elbow`,
      angleDeg === 90 ? '90' : `${angleDeg}`,
    ],
    bendFraction: fraction,
    bendAngleRad: angle,
    diameter,
    material,
    connection: {
      portCount: 2,
      portAngles: [0, angle],
      directional: false,
    },
    equivalentLengthFt: eqLength,
    unitCost: cost,
    partNumber: `${material.toUpperCase().replace('_', '-')}-ELB-${fracKey}-${diameter}`,
    codeRefs: ['IPC 706.3', 'IPC 706.4'],
  });
}

function addTee(
  material: PipeMaterial,
  diameter: number,
  eqLength: number,
  cost: number,
  sanitary: boolean,
): void {
  allEntries.push({
    id: `fit-${idCounter++}`,
    type: sanitary ? 'sanitary_tee' : 'tee',
    name: `${diameter}" ${material.replace('_', ' ')} ${sanitary ? 'Sanitary ' : ''}Tee`,
    tradeTerms: sanitary ? ['sanitary tee', 'san tee', 't', 'branch tee'] : ['tee', 't'],
    bendAngleRad: Math.PI / 2,
    diameter,
    material,
    connection: {
      portCount: 3,
      portAngles: [0, Math.PI, Math.PI / 2], // in, out, branch
      directional: sanitary,
    },
    equivalentLengthFt: eqLength,
    unitCost: cost,
    partNumber: `${material.toUpperCase().replace('_', '-')}-TEE-${diameter}${sanitary ? '-SAN' : ''}`,
    codeRefs: sanitary ? ['IPC 706.3', 'IPC 706.3.2'] : ['IPC 706.3'],
    flowDirection: sanitary ? { inlet: [2], outlet: [1] } : undefined,
    notes: sanitary
      ? 'Sanitary tees for horizontal-to-vertical only. Use combo wye + 1/8 bend for horizontal branches.'
      : undefined,
  });
}

function addWye(
  material: PipeMaterial,
  diameter: number,
  eqLength: number,
  cost: number,
): void {
  allEntries.push({
    id: `fit-${idCounter++}`,
    type: 'wye',
    name: `${diameter}" ${material.replace('_', ' ')} Wye`,
    tradeTerms: ['wye', 'y', 'y-fitting'],
    bendAngleRad: Math.PI / 4, // 45° branch
    diameter,
    material,
    connection: {
      portCount: 3,
      portAngles: [0, Math.PI, Math.PI / 4],
      directional: true,
    },
    equivalentLengthFt: eqLength,
    unitCost: cost,
    partNumber: `${material.toUpperCase().replace('_', '-')}-WYE-${diameter}`,
    codeRefs: ['IPC 706.3', 'IPC 706.3.2'],
    flowDirection: { inlet: [2], outlet: [1] },
  });
}

// Build PVC Schedule 40 DWV fittings
for (const d of [1.5, 2, 3, 4, 6]) {
  for (const fraction of ['1/16', '1/8', '1/4'] as BendFraction[]) {
    const key = `elbow_${fraction.replace('/', '_')}`;
    const eq = EQ_LENGTH_PVC_DWV[key]?.[d] ?? 0;
    const cost = COST_PVC_DWV[key]?.[d] ?? 0;
    addBend('pvc_sch40', fraction, d, eq, cost);
  }
  addTee('pvc_sch40', d, EQ_LENGTH_PVC_DWV.tee_sanitary![d] ?? 0, COST_PVC_DWV.tee_sanitary![d] ?? 0, true);
  addWye('pvc_sch40', d, EQ_LENGTH_PVC_DWV.wye![d] ?? 0, COST_PVC_DWV.wye![d] ?? 0);
}

// P-traps
for (const d of [1.25, 1.5, 2, 3]) {
  allEntries.push({
    id: `fit-${idCounter++}`,
    type: 'p_trap',
    name: `${d}" PVC P-Trap`,
    tradeTerms: ['p-trap', 'ptrap', 'trap'],
    bendAngleRad: Math.PI, // U-bend = 180°
    diameter: d,
    material: 'pvc_sch40',
    connection: {
      portCount: 2,
      portAngles: [0, Math.PI],
      directional: true,
    },
    equivalentLengthFt: EQ_LENGTH_PVC_DWV.p_trap![d] ?? 4,
    unitCost: COST_PVC_DWV.p_trap![d] ?? 10,
    partNumber: `PVC-PTRAP-${d}`,
    codeRefs: ['IPC 1002.1', 'IPC 1002.4'],
    flowDirection: { inlet: [0], outlet: [1] },
    notes: 'Trap seal depth: 2" min, 4" max (IPC 1002.1).',
  });
}

// Couplings + reducers
for (const d of [1.5, 2, 3, 4, 6]) {
  allEntries.push({
    id: `fit-${idCounter++}`,
    type: 'coupling',
    name: `${d}" PVC Coupling`,
    tradeTerms: ['coupling', 'coup'],
    bendAngleRad: 0,
    diameter: d,
    material: 'pvc_sch40',
    connection: { portCount: 2, portAngles: [0, Math.PI], directional: false },
    equivalentLengthFt: 0,
    unitCost: COST_PVC_DWV.coupling![d] ?? 2,
    partNumber: `PVC-COUP-${d}`,
    codeRefs: ['IPC 705'],
  });
}

// Reducers (common step-downs)
const reducerPairs: [number, number][] = [[3, 2], [4, 3], [4, 2], [6, 4], [6, 3]];
for (const [big, small] of reducerPairs) {
  allEntries.push({
    id: `fit-${idCounter++}`,
    type: 'reducer',
    name: `${big}"×${small}" PVC Reducer Coupling`,
    tradeTerms: ['reducer', 'reducing coupling', 'bushing'],
    bendAngleRad: 0,
    diameter: big,
    diameterReduced: small,
    material: 'pvc_sch40',
    connection: { portCount: 2, portAngles: [0, Math.PI], directional: false },
    equivalentLengthFt: EQ_LENGTH_PVC_DWV.reducer![big] ?? 1,
    unitCost: COST_PVC_DWV.reducer![big] ?? 5,
    partNumber: `PVC-RED-${big}x${small}`,
    codeRefs: ['IPC 705.16.1'],
    notes: 'Reducing coupling. Orient large end up when used on vertical runs.',
  });
}

// Copper L/M — limited set for supply (90° elbows, tees)
for (const material of ['copper_type_l', 'copper_type_m'] as PipeMaterial[]) {
  for (const d of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
    addBend(material, '1/4', d, d * 2, 3 + d * 2); // 90° only for supply
    addBend(material, '1/8', d, d * 1, 2.5 + d * 1.5); // 45°
    addTee(material, d, d * 3, 4 + d * 3, false);
  }
}

// PEX — press/crimp fittings
for (const d of [0.375, 0.5, 0.75, 1]) {
  addBend('pex', '1/4', d, d * 1.5, 2 + d * 3); // PEX uses gentle bends
  addTee('pex', d, d * 2.5, 5 + d * 4, false);
}

// ── Public API ──────────────────────────────────────────────────

/** Get all catalog entries. */
export function getAllFittings(): FittingEntry[] {
  return allEntries;
}

/** Find fittings matching criteria. */
export function findFittings(criteria: {
  material?: PipeMaterial;
  diameter?: number;
  type?: FittingType;
  bendAngleRad?: number;
  tolerance?: number;
}): FittingEntry[] {
  const tol = criteria.tolerance ?? 0.001;
  return allEntries.filter((f) => {
    if (criteria.material && f.material !== criteria.material) return false;
    if (criteria.diameter !== undefined && Math.abs(f.diameter - criteria.diameter) > 0.001) return false;
    if (criteria.type && f.type !== criteria.type) return false;
    if (criteria.bendAngleRad !== undefined && Math.abs(f.bendAngleRad - criteria.bendAngleRad) > tol) return false;
    return true;
  });
}

/**
 * Given a measured bend angle (radians), return the closest standard
 * fitting and the residual error. Used by the angle constraint solver
 * to determine which fitting to snap to.
 */
export function nearestBendFitting(
  angleRad: number,
  material: PipeMaterial,
  diameter: number,
): { fitting: FittingEntry | null; residualRad: number } {
  const candidates = findFittings({ material, diameter }).filter(
    (f) => f.bendAngleRad > 0 && f.bendAngleRad < Math.PI,
  );

  let best: FittingEntry | null = null;
  let minDiff = Infinity;

  for (const c of candidates) {
    const diff = Math.abs(c.bendAngleRad - angleRad);
    if (diff < minDiff) {
      minDiff = diff;
      best = c;
    }
  }

  return { fitting: best, residualRad: minDiff };
}

/**
 * List of all standard bend angles (radians) for the current material
 * and diameter. Used by the angle snap engine to build its quantized
 * snap set.
 */
export function getStandardBendAngles(
  material: PipeMaterial,
  diameter: number,
): number[] {
  return [...new Set(
    findFittings({ material, diameter })
      .filter((f) => f.bendAngleRad > 0 && f.bendAngleRad < Math.PI)
      .map((f) => f.bendAngleRad),
  )].sort((a, b) => a - b);
}

/** Total catalog size. */
export function catalogSize(): number {
  return allEntries.length;
}
