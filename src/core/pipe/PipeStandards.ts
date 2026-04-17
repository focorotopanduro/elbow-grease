/**
 * PipeStandards — supplementary dimensional data for fittings,
 * socket depths, and bend radii per industry standards.
 *
 * References:
 *   ASTM D-2665  — PVC plastic drain, waste, vent fittings
 *   ASTM D-1785  — PVC pressure pipe + fittings
 *   ASTM F-877   — PEX-A / SDR-9 crosslinked polyethylene
 *   ASME B16.22  — Copper wrought sweat fittings
 *   CISPI 301    — Cast iron no-hub DWV
 *   Uponor       — ProPEX LF brass fitting catalog
 *
 * All dimensions in inches unless noted otherwise.
 */

import type { PipeMaterial } from '../../engine/graph/GraphEdge';

// ── Socket / hub depth (how far the pipe seats into the fitting) ─

/**
 * How many inches of pipe slip into a hub socket. For copper this is
 * the joint overlap that gets soldered. For PVC it's the socket cement
 * contact length. For PEX it's the fitting insert length.
 */
const PVC_SOCKET_DEPTH: Record<number, number> = {
  0.5:  0.875, 0.75: 1.125, 1: 1.375, 1.25: 1.625, 1.5: 1.875,
  2:    2.375, 2.5:  2.875, 3: 3.625, 4: 4.625,    6: 6.625,
};

const COPPER_SOLDER_DEPTH: Record<number, number> = {
  0.375: 0.375, 0.5: 0.500, 0.75: 0.750, 1: 0.890, 1.25: 1.010, 1.5: 1.110, 2: 1.375,
};

const PEX_INSERT_DEPTH: Record<number, number> = {
  0.375: 0.50, 0.5: 0.62, 0.75: 0.80, 1: 1.00, 1.25: 1.25, 1.5: 1.50, 2: 2.00,
};

const CAST_HUB_DEPTH: Record<number, number> = {
  1.5: 2.5, 2: 2.5, 3: 3.0, 4: 3.5, 6: 4.5,
};

/** Socket (hub) depth in INCHES for a given material + nominal size. */
export function getSocketDepthIn(material: PipeMaterial, nominalIn: number): number {
  switch (material) {
    case 'pvc_sch40':
    case 'pvc_sch80':
    case 'abs':
    case 'cpvc':
      return PVC_SOCKET_DEPTH[nominalIn] ?? nominalIn * 1.1;
    case 'copper_type_l':
    case 'copper_type_m':
      return COPPER_SOLDER_DEPTH[nominalIn] ?? nominalIn;
    case 'pex':
      return PEX_INSERT_DEPTH[nominalIn] ?? nominalIn;
    case 'cast_iron':
    case 'ductile_iron':
      return CAST_HUB_DEPTH[nominalIn] ?? nominalIn * 1.2;
    case 'galvanized_steel':
      return nominalIn * 0.9; // threaded engagement
    default:
      return nominalIn;
  }
}

/** Socket depth in FEET. */
export function getSocketDepthFt(material: PipeMaterial, nominalIn: number): number {
  return getSocketDepthIn(material, nominalIn) / 12;
}

// ── Hub OD multiplier — how much wider the hub is than pipe OD ──

const HUB_OVERSIZE: Record<PipeMaterial, number> = {
  pvc_sch40:        1.16,
  pvc_sch80:        1.20,
  abs:              1.16,
  cpvc:             1.14,
  pex:              1.12, // PEX fittings only mildly oversize (crimp ring)
  copper_type_l:    1.04, // sweat cup barely oversize
  copper_type_m:    1.04,
  cast_iron:        1.30, // hub is dramatically oversize
  ductile_iron:     1.30,
  galvanized_steel: 1.18,
};

/** Outer radius of the hub in feet for visual bell/socket. */
export function getHubOuterRadiusFt(material: PipeMaterial, pipeOdFt: number): number {
  const pipeRadius = pipeOdFt / 2;
  const mult = HUB_OVERSIZE[material] ?? 1.15;
  return pipeRadius * mult;
}

// ── Bend radius — centerline of a bend fitting ──────────────────

/**
 * Fitting centerline bend radius as a MULTIPLE of pipe OD.
 *
 * Short-sweep (standard): ~1.5× OD
 * Long-sweep:             ~3.0× OD (smoother flow, mandatory for certain
 *                                    DWV horizontal→vertical transitions)
 * 1/8 bend (45°):          ~1.0× OD  (shorter because less deflection)
 * 1/16 bend (22.5°):       ~0.5× OD
 *
 * Copper sweat bends are tighter than PVC (~1.0× OD) due to the way
 * they're formed.
 */
export function getBendCenterlineRadiusFt(
  material: PipeMaterial,
  pipeOdFt: number,
  bendKind: 'short_sweep' | 'long_sweep' | 'eighth' | 'sixteenth',
): number {
  let mult: number;
  const isCopperLike = material === 'copper_type_l' || material === 'copper_type_m' || material === 'cpvc';
  switch (bendKind) {
    case 'short_sweep': mult = isCopperLike ? 1.0 : 1.5; break;
    case 'long_sweep':  mult = isCopperLike ? 2.0 : 3.0; break;
    case 'eighth':      mult = isCopperLike ? 0.7 : 1.0; break;
    case 'sixteenth':   mult = 0.5; break;
  }
  return pipeOdFt * mult;
}

// ── Fitting shoulder (axial offset from center to each port) ────

/**
 * Distance from fitting center to where the pipe connection begins,
 * for straight-through fittings (coupling, reducer, tee main).
 */
export function getPortOffsetFt(material: PipeMaterial, pipeOdFt: number): number {
  return pipeOdFt * 1.4;
}

// ── Specific fitting dimensions ─────────────────────────────────

/**
 * Closet bend (toilet drain) — 3×4 nominal, 90° with specific geometry.
 * Returns vertical leg, horizontal leg, bend radius.
 */
export function getClosetBendGeometryFt(nominalIn: number): {
  verticalLegFt: number;
  horizontalLegFt: number;
  bendRadiusFt: number;
} {
  // 3" × 4" closet bend reduces from 4" to 3" at the flange side
  // Geometry per Charlotte PVC spec
  const inFt = nominalIn / 12;
  return {
    verticalLegFt: inFt * 6, // ~6× ID of riser
    horizontalLegFt: inFt * 10, // long horizontal run to pick up toilet offset
    bendRadiusFt: inFt * 2, // tighter than a standard sweep
  };
}

/**
 * P-trap minimum seal depth — water column retained between trap arm
 * crown and trap dip that keeps sewer gas out. Code minimum is 2", max 4".
 */
export const P_TRAP_SEAL_DEPTH_IN = 2.5;

/**
 * Standard trap arm minimum slope (per UPC 1003.3).
 * 1/4" per foot for drains ≤ 2.5" diameter
 * 1/8" per foot for drains ≥ 3"
 */
export function getTrapArmSlopePerFt(nominalIn: number): number {
  return nominalIn <= 2.5 ? 0.25 / 12 : 0.125 / 12;
}

// ── Friction-loss equivalent length (supplements GraphEdge) ─────

/**
 * Equivalent straight length of pipe (in FEET) added to the run for
 * friction loss calculations. More accurate than GraphEdge's table
 * because it factors pipe OD directly.
 *
 * Used when solver runs hydraulic analysis.
 */
export function getEquivLengthFt(
  fittingType: string,
  pipeOdFt: number,
): number {
  const odIn = pipeOdFt * 12;
  // K-factors from Crane TP-410 for threaded/socket fittings
  const kFactor: Record<string, number> = {
    bend_22_5:        0.20,
    bend_45:          0.40,
    bend_90:          0.85,
    bend_90_ls:       0.55,
    elbow_90:         0.85,
    elbow_45:         0.40,
    tee:              1.40,
    sanitary_tee:     1.80,
    wye:              0.80,
    combo_wye_eighth: 1.10,
    cross:            1.80,
    coupling:         0.05,
    reducer:          0.50,
    cap:              0,
    p_trap:           2.20,
    cleanout_adapter: 0.10,
    closet_flange:    0.30,
    manifold_2:       0.80,
    manifold_4:       1.20,
    manifold_6:       1.60,
    manifold_8:       2.00,
  };
  const K = kFactor[fittingType] ?? 0.5;
  // Equiv. length = K × (OD / friction-factor). Approximation: ~30 × OD × K
  return 30 * odIn * K / 12;
}
