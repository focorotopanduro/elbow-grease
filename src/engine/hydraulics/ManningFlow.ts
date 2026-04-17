/**
 * Manning's Equation — open-channel gravity drainage flow.
 *
 * Drainage pipes (waste, storm) operate as open channels under
 * gravity, not pressurized flow. Manning's equation gives the
 * flow velocity and capacity for partially-filled circular pipes:
 *
 *   V = (1.49/n) × R^(2/3) × S^(1/2)
 *
 * Where:
 *   V = velocity (ft/s)
 *   n = Manning's roughness coefficient
 *   R = hydraulic radius (ft) = A / P (area / wetted perimeter)
 *   S = slope (ft/ft)
 *
 * For partially-filled circular pipes, A, P, and R are functions
 * of the fill depth ratio (d/D).
 *
 * This is used instead of Darcy-Weisbach for drainage systems
 * because waste pipes are never fully pressurized (they run at
 * 50-75% capacity to allow air flow for venting).
 */

// ── Manning's n coefficients ────────────────────────────────────

import type { PipeMaterial } from '../graph/GraphEdge';

export const MANNING_N: Record<PipeMaterial, number> = {
  pvc_sch40:         0.009,
  pvc_sch80:         0.009,
  abs:               0.009,
  cast_iron:         0.013,
  copper_type_l:     0.011,
  copper_type_m:     0.011,
  cpvc:              0.009,
  pex:               0.009,
  galvanized_steel:  0.015,
  ductile_iron:      0.013,
};

// ── Partial-fill geometry for circular pipes ────────────────────

export interface PartialFillGeometry {
  /** Central angle subtended by the water surface (radians). */
  theta: number;
  /** Flow area (ft²). */
  area: number;
  /** Wetted perimeter (ft). */
  wettedPerimeter: number;
  /** Hydraulic radius R = A/P (ft). */
  hydraulicRadius: number;
  /** Top width of water surface (ft). */
  topWidth: number;
  /** Fill ratio d/D (0–1). */
  fillRatio: number;
}

/**
 * Compute partial-fill geometry for a circular pipe.
 *
 * @param D — pipe internal diameter (ft)
 * @param fillRatio — depth of flow / diameter (0–1)
 */
export function partialFillGeometry(D: number, fillRatio: number): PartialFillGeometry {
  const r = D / 2;
  const d = fillRatio * D;

  // Central angle: θ = 2 × arccos( (r - d) / r )
  const cosArg = Math.max(-1, Math.min(1, (r - d) / r));
  const theta = 2 * Math.acos(cosArg);

  // Flow area: A = (r²/2)(θ - sin θ)
  const area = (r * r / 2) * (theta - Math.sin(theta));

  // Wetted perimeter: P = r × θ
  const wettedPerimeter = r * theta;

  // Hydraulic radius
  const hydraulicRadius = wettedPerimeter > 0 ? area / wettedPerimeter : 0;

  // Top width: T = D × sin(θ/2)
  const topWidth = D * Math.sin(theta / 2);

  return {
    theta,
    area,
    wettedPerimeter,
    hydraulicRadius,
    topWidth,
    fillRatio,
  };
}

// ── Manning's equation ──────────────────────────────────────────

export interface ManningResult {
  /** Flow velocity (ft/s). */
  velocity: number;
  /** Volumetric flow rate (GPM). */
  flowGPM: number;
  /** Volumetric flow rate (ft³/s). */
  flowCFS: number;
  /** Froude number (>1 = supercritical). */
  froude: number;
  /** Pipe capacity at given fill ratio (GPM). */
  capacity: number;
  /** Partial-fill geometry. */
  geometry: PartialFillGeometry;
  /** Whether flow is subcritical (normal for drainage). */
  subcritical: boolean;
}

/**
 * Calculate Manning's flow for a partially-filled circular pipe.
 *
 * @param D_inches — pipe diameter in inches
 * @param slope_inPerFt — slope in inches per foot
 * @param n — Manning's roughness coefficient
 * @param fillRatio — depth/diameter ratio (default 0.5 = half-full)
 */
export function manningFlow(
  D_inches: number,
  slope_inPerFt: number,
  n: number,
  fillRatio: number = 0.5,
): ManningResult {
  const D_ft = D_inches / 12;
  const S = slope_inPerFt / 12; // convert in/ft to ft/ft

  const geo = partialFillGeometry(D_ft, fillRatio);

  // Manning's velocity: V = (1.49/n) × R^(2/3) × S^(1/2)
  const velocity = S > 0 && geo.hydraulicRadius > 0
    ? (1.49 / n) * Math.pow(geo.hydraulicRadius, 2 / 3) * Math.pow(S, 0.5)
    : 0;

  // Flow rate
  const flowCFS = velocity * geo.area;
  const flowGPM = flowCFS * 448.831;

  // Froude number: Fr = V / √(g × D_h)
  // where D_h = A / T (hydraulic depth = area / top width)
  const hydraulicDepth = geo.topWidth > 0 ? geo.area / geo.topWidth : 0;
  const froude = hydraulicDepth > 0
    ? velocity / Math.sqrt(32.174 * hydraulicDepth)
    : 0;

  return {
    velocity,
    flowGPM,
    flowCFS,
    froude,
    capacity: flowGPM,
    geometry: geo,
    subcritical: froude < 1,
  };
}

/**
 * Calculate pipe capacity at standard fill ratios.
 * IPC designs at 50% full for branches, 75% for building drains.
 */
export function pipeCapacity(
  D_inches: number,
  slope_inPerFt: number,
  material: PipeMaterial,
  fillRatio: number = 0.5,
): ManningResult {
  const n = MANNING_N[material];
  return manningFlow(D_inches, slope_inPerFt, n, fillRatio);
}

/**
 * Find the minimum pipe diameter that can carry a given flow rate.
 *
 * @param targetGPM — required flow capacity
 * @param slope_inPerFt — available slope
 * @param material — pipe material
 * @param fillRatio — design fill ratio
 * @returns minimum diameter in inches (from standard sizes)
 */
export function minimumDiameterForFlow(
  targetGPM: number,
  slope_inPerFt: number,
  material: PipeMaterial,
  fillRatio: number = 0.5,
): number {
  const standardSizes = [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12];

  for (const dia of standardSizes) {
    const result = pipeCapacity(dia, slope_inPerFt, material, fillRatio);
    if (result.flowGPM >= targetGPM) return dia;
  }

  return standardSizes[standardSizes.length - 1]!;
}
