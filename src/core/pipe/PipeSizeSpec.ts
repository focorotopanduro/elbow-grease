/**
 * PipeSizeSpec — real-world outer/inner diameter tables per material.
 *
 * In North American plumbing, "nominal" size (1/2", 3/4", 2", 3" etc) is
 * NOT the actual physical dimension — it's a loose historical label.
 * Each material standard has its own OD/ID relationship:
 *
 *   - IPS (iron pipe size) — PVC, CPVC, Galvanized.
 *     Nominal 2" → OD 2.375", ID varies by schedule.
 *   - Copper Tube Size (CTS) — Copper, PEX, some CPVC.
 *     Nominal 1/2" → OD 0.625", nominal 3/4" → OD 0.875".
 *   - Cast Iron NPS — nominal matches approximate OD.
 *
 * Accurate ODs are essential for:
 *   1. **Visual fidelity**: a 1" PEX line next to a 1" PVC looks
 *      correctly thinner (1.125" vs 1.315") just like in real life.
 *   2. **Fitting geometry**: fittings are made to slip over a specific
 *      OD — mismatches matter for the visual+estimation pass.
 *   3. **Clearance checks**: a 4" DWV stack's real OD is 4.5", which
 *      affects whether it fits inside a 6" wall cavity.
 *
 * All values in inches. Convert to world feet with `/12`.
 *
 * Unsupported (material, nominal) combos return null — callers fall
 * back to naive nominal sizing.
 */

import type { PipeMaterial } from '../../engine/graph/GraphEdge';

// ── Outside-diameter tables (inches) ────────────────────────────

/** IPS / Schedule-40 PVC and friends. */
const IPS_OD: Record<number, number> = {
  0.25:  0.540,
  0.375: 0.675,
  0.5:   0.840,
  0.75:  1.050,
  1:     1.315,
  1.25:  1.660,
  1.5:   1.900,
  2:     2.375,
  2.5:   2.875,
  3:     3.500,
  4:     4.500,
  5:     5.563,
  6:     6.625,
  8:     8.625,
  10:   10.750,
  12:   12.750,
};

/** Copper Tube Size — used by copper, PEX, Uponor. */
const CTS_OD: Record<number, number> = {
  0.25:  0.375,
  0.375: 0.500,
  0.5:   0.625,
  0.75:  0.875,
  1:     1.125,
  1.25:  1.375,
  1.5:   1.625,
  2:     2.125,
  2.5:   2.625,
  3:     3.125,
};

/** Cast Iron (hub + spigot, service-weight). */
const CAST_IRON_OD: Record<number, number> = {
  1.5: 1.96,
  2:   2.38,
  3:   3.50,
  4:   4.50,
  5:   5.50,
  6:   6.50,
  8:   8.50,
};

// ── Wall thickness (inches) ─────────────────────────────────────

/** Wall thickness per schedule. Affects ID for flow calcs. */
const WALL_T: Partial<Record<PipeMaterial, Record<number, number>>> = {
  pvc_sch40: {
    0.5: 0.109, 0.75: 0.113, 1: 0.133, 1.25: 0.140, 1.5: 0.145,
    2: 0.154, 3: 0.216, 4: 0.237, 6: 0.280,
  },
  pvc_sch80: {
    0.5: 0.147, 0.75: 0.154, 1: 0.179, 1.25: 0.191, 1.5: 0.200,
    2: 0.218, 3: 0.300, 4: 0.337, 6: 0.432,
  },
  cpvc: {
    0.375: 0.070, 0.5: 0.080, 0.75: 0.095, 1: 0.113,
  },
  pex: {
    // PEX-A (cross-linked polyethylene, Uponor AquaPEX SDR-9)
    0.375: 0.062, 0.5: 0.070, 0.75: 0.097, 1: 0.125, 1.25: 0.153, 1.5: 0.181, 2: 0.236,
  },
  copper_type_l: {
    // Type L medium-wall
    0.25: 0.030, 0.375: 0.035, 0.5: 0.040, 0.75: 0.045, 1: 0.050, 1.25: 0.055, 1.5: 0.060, 2: 0.070,
  },
  copper_type_m: {
    0.25: 0.025, 0.375: 0.025, 0.5: 0.028, 0.75: 0.032, 1: 0.035, 1.25: 0.042, 1.5: 0.049, 2: 0.058,
  },
  cast_iron: {
    1.5: 0.160, 2: 0.190, 3: 0.220, 4: 0.250, 6: 0.330,
  },
  abs: {
    1.5: 0.145, 2: 0.154, 3: 0.216, 4: 0.237,
  },
  galvanized_steel: {
    0.5: 0.109, 0.75: 0.113, 1: 0.133, 1.5: 0.145, 2: 0.154,
  },
  ductile_iron: {
    3: 0.250, 4: 0.280, 6: 0.320,
  },
};

// ── Material classification ─────────────────────────────────────

const IPS_MATERIALS: PipeMaterial[] = ['pvc_sch40', 'pvc_sch80', 'cpvc', 'abs', 'galvanized_steel'];
const CTS_MATERIALS: PipeMaterial[] = ['copper_type_l', 'copper_type_m', 'pex'];
const CAST_MATERIALS: PipeMaterial[] = ['cast_iron', 'ductile_iron'];

// ── Flexible vs rigid ───────────────────────────────────────────

/**
 * Flexible pipe can bend to a minimum radius (~6–8× OD) without
 * fittings. Elbows are available but rarely used — typical residential
 * install uses only tees, couplings, reducers, manifolds.
 *
 * Rigid pipe requires angle fittings (22.5°/45°/90°) at every bend.
 */
const FLEXIBLE_MATERIALS: PipeMaterial[] = ['pex'];

export function isFlexibleMaterial(m: PipeMaterial): boolean {
  return FLEXIBLE_MATERIALS.includes(m);
}

// ── Public API ──────────────────────────────────────────────────

/** Actual OD in inches, or null if the combo isn't standard. */
export function getOuterDiameterIn(material: PipeMaterial, nominalIn: number): number | null {
  if (IPS_MATERIALS.includes(material)) return IPS_OD[nominalIn] ?? null;
  if (CTS_MATERIALS.includes(material)) return CTS_OD[nominalIn] ?? null;
  if (CAST_MATERIALS.includes(material)) return CAST_IRON_OD[nominalIn] ?? null;
  return null;
}

/** Actual OD in feet. Falls back to `nominalIn / 12` if no table entry. */
export function getOuterDiameterFt(material: PipeMaterial, nominalIn: number): number {
  const od = getOuterDiameterIn(material, nominalIn);
  return (od ?? nominalIn) / 12;
}

/** Outer radius in feet — convenient for THREE.js TubeGeometry. */
export function getOuterRadiusFt(material: PipeMaterial, nominalIn: number): number {
  return getOuterDiameterFt(material, nominalIn) / 2;
}

/** Wall thickness in inches, or null if unknown. */
export function getWallThicknessIn(material: PipeMaterial, nominalIn: number): number | null {
  const tbl = WALL_T[material];
  if (!tbl) return null;
  return tbl[nominalIn] ?? null;
}

/** Inner diameter in inches (OD − 2·wall). Used for flow calcs. */
export function getInnerDiameterIn(material: PipeMaterial, nominalIn: number): number | null {
  const od = getOuterDiameterIn(material, nominalIn);
  const wt = getWallThicknessIn(material, nominalIn);
  if (od === null || wt === null) return null;
  return od - 2 * wt;
}

/**
 * Minimum bend radius in feet for flexible pipe without a fitting.
 * Per Uponor PEX-A tech data: 6× OD cold-bend, 5× OD with heat.
 */
export function minBendRadiusFt(material: PipeMaterial, nominalIn: number): number | null {
  if (!isFlexibleMaterial(material)) return null;
  const odFt = getOuterDiameterFt(material, nominalIn);
  return odFt * 6;
}

/** Supported nominal sizes (inches) for a given material. */
export function supportedSizes(material: PipeMaterial): number[] {
  if (IPS_MATERIALS.includes(material)) return Object.keys(IPS_OD).map(Number).sort((a, b) => a - b);
  if (CTS_MATERIALS.includes(material)) return Object.keys(CTS_OD).map(Number).sort((a, b) => a - b);
  if (CAST_MATERIALS.includes(material)) return Object.keys(CAST_IRON_OD).map(Number).sort((a, b) => a - b);
  return [];
}

/** Format "1/2\"" from 0.5, etc — for UI display. */
export function formatNominal(nominalIn: number): string {
  if (nominalIn === 0.25)  return '1/4"';
  if (nominalIn === 0.375) return '3/8"';
  if (nominalIn === 0.5)   return '1/2"';
  if (nominalIn === 0.75)  return '3/4"';
  if (nominalIn === 1.25)  return '1-1/4"';
  if (nominalIn === 1.5)   return '1-1/2"';
  if (nominalIn === 2.5)   return '2-1/2"';
  if (Number.isInteger(nominalIn)) return `${nominalIn}"`;
  return `${nominalIn}"`;
}
