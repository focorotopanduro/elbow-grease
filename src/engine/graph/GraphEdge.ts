/**
 * Graph Edge — directed pipe segment connecting two nodes.
 *
 * Edges carry the physical properties of the pipe: material,
 * diameter, length, slope, roughness. They are the conduits
 * through which DFU, pressure, and flow propagate.
 *
 * Direction convention:
 *   Waste system  → flow direction (fixture → drain)
 *   Supply system → flow direction (source → fixture)
 *   Vent system   → upward toward atmosphere
 *
 * The solver traverses edges in topological order, accumulating
 * values at each downstream node.
 */

// ── Pipe materials and roughness ────────────────────────────────

export type PipeMaterial =
  | 'pvc_sch40'
  | 'pvc_sch80'
  | 'abs'
  | 'cast_iron'
  | 'copper_type_l'
  | 'copper_type_m'
  | 'cpvc'
  | 'pex'
  | 'galvanized_steel'
  | 'ductile_iron';

/**
 * Absolute roughness ε in feet (Darcy-Weisbach).
 * Source: Moody chart / manufacturer specs.
 */
export const ROUGHNESS_FT: Record<PipeMaterial, number> = {
  pvc_sch40:         0.000005,
  pvc_sch80:         0.000005,
  abs:               0.000005,
  cast_iron:         0.00085,
  copper_type_l:     0.000005,
  copper_type_m:     0.000005,
  cpvc:              0.000005,
  pex:               0.000007,
  galvanized_steel:  0.0005,
  ductile_iron:      0.0004,
};

/**
 * Hazen-Williams C coefficient (for quick flow estimates).
 */
export const HAZEN_WILLIAMS_C: Record<PipeMaterial, number> = {
  pvc_sch40:         150,
  pvc_sch80:         150,
  abs:               150,
  cast_iron:         100,
  copper_type_l:     140,
  copper_type_m:     140,
  cpvc:              150,
  pex:               150,
  galvanized_steel:  120,
  ductile_iron:      140,
};

/**
 * Cost per linear foot (USD, approximate 2026 contractor pricing).
 */
export const COST_PER_FT: Record<PipeMaterial, Record<number, number>> = {
  pvc_sch40:         { 0.5: 0.8, 0.75: 1.1, 1: 1.5, 1.5: 2.5, 2: 3.8, 3: 7, 4: 11 },
  pvc_sch80:         { 0.5: 1.5, 0.75: 2.0, 1: 2.8, 1.5: 4.5, 2: 7, 3: 13, 4: 20 },
  abs:               { 1.5: 2.2, 2: 3.5, 3: 6.5, 4: 10 },
  cast_iron:         { 2: 12, 3: 18, 4: 24 },
  copper_type_l:     { 0.375: 2.5, 0.5: 3.5, 0.75: 5, 1: 8 },
  copper_type_m:     { 0.375: 1.8, 0.5: 2.5, 0.75: 3.8, 1: 6 },
  cpvc:              { 0.375: 0.6, 0.5: 0.9, 0.75: 1.3, 1: 2 },
  pex:               { 0.375: 0.4, 0.5: 0.6, 0.75: 0.9, 1: 1.5 },
  galvanized_steel:  { 0.5: 3, 0.75: 4, 1: 6, 1.5: 10, 2: 15 },
  ductile_iron:      { 3: 22, 4: 30, 6: 50 },
};

// ── Fitting types ───────────────────────────────────────────────

export type FittingType =
  // Rigid-pipe bend fittings (legal angles only — 1/16, 1/8, 1/4)
  | 'bend_22_5'        // 1/16 bend
  | 'bend_45'          // 1/8 bend
  | 'bend_90'          // 1/4 bend (short sweep)
  | 'bend_90_ls'       // 1/4 bend (long sweep — DWV preferred for horizontal→vertical)
  // Legacy aliases kept for backward-compat with solver code
  | 'elbow_90'
  | 'elbow_45'
  // Branching
  | 'tee'              // standard tee (supply)
  | 'sanitary_tee'     // DWV sanitary tee (perpendicular branch)
  | 'wye'              // 45° wye (DWV)
  | 'combo_wye_eighth' // combination wye + 1/8 bend (DWV)
  | 'cross'            // 4-way (rare)
  // Straight joints
  | 'coupling'
  | 'reducer'
  | 'cap'
  // DWV-specific
  | 'cleanout_adapter'
  | 'p_trap'
  | 'closet_flange'
  // Manifolds (PEX home-run supply)
  | 'manifold_2'
  | 'manifold_4'
  | 'manifold_6'
  | 'manifold_8';

/**
 * Equivalent length in feet for friction loss calculations.
 * Values for schedule 40 PVC (representative).
 */
export const FITTING_EQ_LENGTH: Record<FittingType, Record<number, number>> = {
  bend_22_5:        { 0.5: 0.4, 0.75: 0.6, 1: 0.8, 1.5: 1.2, 2: 1.6, 3: 2.4, 4: 3.2 },
  bend_45:          { 0.5: 0.8, 0.75: 1,   1: 1.3, 1.5: 2,   2: 2.5, 3: 3.5, 4: 5 },
  bend_90:          { 0.5: 1.5, 0.75: 2,   1: 2.5, 1.5: 4,   2: 5,   3: 7,   4: 10 },
  bend_90_ls:       { 0.5: 1.2, 0.75: 1.6, 1: 2,   1.5: 3,   2: 3.8, 3: 5.5, 4: 7.5 },
  elbow_90:         { 0.5: 1.5, 0.75: 2,   1: 2.5, 1.5: 4,   2: 5,   3: 7,   4: 10 },
  elbow_45:         { 0.5: 0.8, 0.75: 1,   1: 1.3, 1.5: 2,   2: 2.5, 3: 3.5, 4: 5 },
  tee:              { 0.5: 3,   0.75: 4,   1: 5,   1.5: 7,   2: 10,  3: 14,  4: 18 },
  sanitary_tee:     { 1.5: 5,   2: 7,      3: 10,  4: 14 },
  wye:              { 1.5: 3,   2: 4,      3: 6,   4: 8 },
  combo_wye_eighth: { 1.5: 4,   2: 5,      3: 8,   4: 11 },
  cross:            { 0.5: 5,   0.75: 7,   1: 9,   1.5: 12,  2: 16 },
  coupling:         { 0.5: 0,   0.75: 0,   1: 0,   1.5: 0,   2: 0,   3: 0,   4: 0 },
  reducer:          { 0.5: 1,   0.75: 1,   1: 1.5, 1.5: 2,   2: 2.5, 3: 3.5, 4: 5 },
  cap:              { 0.5: 0,   0.75: 0,   1: 0,   1.5: 0,   2: 0,   3: 0,   4: 0 },
  cleanout_adapter: { 1.5: 1,   2: 1.5,    3: 2,   4: 3 },
  p_trap:           { 1.25: 3,  1.5: 4,    2: 5,   3: 7 },
  closet_flange:    { 3: 1,     4: 1.5 },
  manifold_2:       { 0.5: 2,   0.75: 2.5, 1: 3 },
  manifold_4:       { 0.5: 3,   0.75: 4,   1: 5 },
  manifold_6:       { 0.5: 4,   0.75: 5,   1: 6 },
  manifold_8:       { 0.5: 5,   0.75: 6,   1: 7 },
};

// ── Edge interface ──────────────────────────────────────────────

export interface GraphEdge {
  id: string;
  /** Source node ID (upstream). */
  from: string;
  /** Target node ID (downstream). */
  to: string;

  // ── Physical properties ─────────────────────────────────────
  material: PipeMaterial;
  /** Nominal diameter in inches. */
  diameter: number;
  /** Developed length in feet (actual pipe run, not straight-line). */
  length: number;
  /** Slope in inches per foot (drainage only, 0 for supply). */
  slope: number;
  /** Elevation change across this edge in feet (positive = rises). */
  elevationDelta: number;

  // ── Fittings on this edge ───────────────────────────────────
  fittings: { type: FittingType; count: number }[];

  // ── Computed by solver ──────────────────────────────────────
  computed: {
    /** Total equivalent length (developed + fittings). */
    equivalentLength: number;
    /** Friction head loss across this edge (feet of head). */
    frictionLoss: number;
    /** Velocity in ft/s. */
    velocity: number;
    /** Reynolds number. */
    reynolds: number;
    /** Friction factor (Darcy). */
    frictionFactor: number;
    /** Pressure drop in psi. */
    pressureDrop: number;
    /** Whether this edge is properly sized. */
    properlySized: boolean;
    /** Cost of this pipe segment (material only). */
    materialCost: number;
  };
}

// ── Factory ─────────────────────────────────────────────────────

let edgeIdCounter = 0;

export function createEdge(
  from: string,
  to: string,
  material: PipeMaterial,
  diameter: number,
  length: number,
  slope: number,
  elevationDelta: number,
  fittings: { type: FittingType; count: number }[] = [],
): GraphEdge {
  const id = `edge-${edgeIdCounter++}`;

  // Pre-compute equivalent length from fittings
  let eqLength = length;
  for (const f of fittings) {
    const table = FITTING_EQ_LENGTH[f.type];
    // Find closest diameter match
    const sizes = Object.keys(table).map(Number).sort((a, b) => a - b);
    const closest = sizes.reduce((prev, curr) =>
      Math.abs(curr - diameter) < Math.abs(prev - diameter) ? curr : prev,
    );
    eqLength += (table[closest] ?? 0) * f.count;
  }

  // Material cost
  const costTable = COST_PER_FT[material];
  const costSizes = Object.keys(costTable).map(Number).sort((a, b) => a - b);
  const closestCost = costSizes.reduce((prev, curr) =>
    Math.abs(curr - diameter) < Math.abs(prev - diameter) ? curr : prev,
  );
  const materialCost = (costTable[closestCost] ?? 5) * length;

  return {
    id,
    from,
    to,
    material,
    diameter,
    length,
    slope,
    elevationDelta,
    fittings,
    computed: {
      equivalentLength: eqLength,
      frictionLoss: 0,
      velocity: 0,
      reynolds: 0,
      frictionFactor: 0,
      pressureDrop: 0,
      properlySized: true,
      materialCost,
    },
  };
}
