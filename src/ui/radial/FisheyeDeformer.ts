/**
 * FisheyeDeformer — angular deformation of radial menu sectors.
 *
 * Standard radial menus give every sector equal angular width. This
 * looks balanced but wastes screen real estate on sectors the user
 * isn't aiming at. The fisheye deformer solves this by:
 *
 *   1. Finding the cursor's current angular position
 *   2. Identifying which BASE sector the cursor is pointing at
 *   3. Expanding that sector's visual width (magnification)
 *   4. Proportionally compressing its neighbors, with the compression
 *      falling off the farther a sector is from the cursor
 *
 * Visually this makes the target sector "reach out" toward the cursor,
 * like a magnetic lens. The effect is subtle but makes selection feel
 * responsive and intentional — the UI anticipates your intent.
 *
 * Key design decisions:
 *
 *   • Hit-testing runs against the BASE (equal-width) layout — predictable,
 *     no feedback loops between cursor position and sector geometry.
 *
 *   • Visualization runs against the DEFORMED layout — dynamic, beautiful,
 *     feels responsive.
 *
 *   • Weights follow a gaussian falloff centered on the hovered sector.
 *     Nearby sectors compress more; far sectors are only slightly affected.
 *
 *   • Output widths always sum to 2π (the full circle) — conservation.
 *
 *   • A "strength" factor [0,1] lets callers fade the effect in/out,
 *     enabling animated activation when cursor enters the active ring.
 */

// ── Types ───────────────────────────────────────────────────────

export interface BaseSector {
  id: string;
  /** Base center angle (radians). */
  centerAngleRad: number;
  /** Base half-width (radians). */
  halfWidthRad: number;
}

export interface DeformedSector {
  id: string;
  /** Deformed center angle. */
  centerAngleRad: number;
  /** Deformed half-width. */
  halfWidthRad: number;
  /** Visual scale factor for this sector [0.8, 1.25] — useful for UI. */
  lensScale: number;
  /** Fractional distance from hovered sector [0=hovered, 1=opposite]. */
  distanceFromHover: number;
}

export interface FisheyeConfig {
  /** Peak expansion factor for the hovered sector (default 1.45). */
  maxExpansion: number;
  /** Gaussian σ in sectors (default 1.1) — how quickly falloff occurs. */
  falloffSigma: number;
  /** Strength [0,1] — 0 = no deformation, 1 = full effect. */
  strength: number;
  /** Hover-distance threshold below which strength ramps down (pixels). */
  deadZonePx: number;
}

export const DEFAULT_FISHEYE_CONFIG: FisheyeConfig = {
  maxExpansion: 1.45,
  falloffSigma: 1.1,
  strength: 1.0,
  deadZonePx: 0,
};

// ── Angular distance helper ─────────────────────────────────────

/** Minimum angular distance between two angles, respecting 2π wraparound. */
function angularDistance(a: number, b: number): number {
  const TAU = Math.PI * 2;
  const d = Math.abs(((a - b) % TAU + TAU) % TAU);
  return Math.min(d, TAU - d);
}

// ── Find cursor's base sector ───────────────────────────────────

export function findSectorAtAngle(
  sectors: BaseSector[],
  cursorAngleRad: number,
): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < sectors.length; i++) {
    const d = angularDistance(sectors[i]!.centerAngleRad, cursorAngleRad);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

// ── Main deformation ────────────────────────────────────────────

/**
 * Apply fisheye deformation to a set of base sectors given cursor angle.
 *
 * Algorithm:
 *   1. Compute a "weight" for each sector based on angular distance
 *      from the hovered sector. Hovered = 1.0, falling off gaussian.
 *   2. Expand weights by multiplying hovered weight by maxExpansion.
 *   3. Normalize weights to sum to N (number of sectors) so the total
 *      angular coverage stays at 2π.
 *   4. Each sector's new width = (weight / totalWeight) × 2π.
 *   5. Each sector's new center = running cumulative half-width from the
 *      previous sector's center.
 */
export function deformSectors(
  baseSectors: BaseSector[],
  cursorAngleRad: number,
  config: FisheyeConfig = DEFAULT_FISHEYE_CONFIG,
): DeformedSector[] {
  const n = baseSectors.length;
  if (n === 0) return [];

  const s = Math.max(0, Math.min(1, config.strength));
  const hoverIdx = findSectorAtAngle(baseSectors, cursorAngleRad);

  // Compute per-sector weights
  const weights: number[] = [];
  for (let i = 0; i < n; i++) {
    const angDist = angularDistance(
      baseSectors[i]!.centerAngleRad,
      baseSectors[hoverIdx]!.centerAngleRad,
    );
    // Normalize by the base sector width so sigma is in "sectors"
    const sectorDist = angDist / (baseSectors[i]!.halfWidthRad * 2);
    // Gaussian falloff
    const gaussian = Math.exp(-(sectorDist * sectorDist) / (2 * config.falloffSigma * config.falloffSigma));
    // Interpolate between uniform (1.0) and fisheye (gaussian × maxExpansion)
    const target = 1 + gaussian * (config.maxExpansion - 1);
    weights.push(1 + s * (target - 1));
  }

  // Normalize so total weight equals n (each sector's base weight = 1)
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const scale = n / weightSum;
  for (let i = 0; i < n; i++) weights[i]! *= scale;

  // Build deformed sector list, maintaining angular order around the ring
  // We walk from the sector immediately after the hovered one, accumulating widths
  // Actually simpler: for each sector, compute its new width, and place its center
  // at the cumulative position around the ring.
  //
  // We need to preserve the cyclic ORDER of sectors. Start from sector 0 and
  // walk around the ring.

  // Compute new widths (angular, full width, not half-width)
  const baseWidth = Math.PI * 2 / n; // assumed equal base
  const newWidths: number[] = weights.map((w) => w * baseWidth);

  // Place sectors: compute new centers by running sum
  // Use the hovered sector's ORIGINAL center as the anchor so the magnified
  // region appears "centered where the mouse is", not drifting around.
  const deformed: DeformedSector[] = [];
  const anchorCenter = baseSectors[hoverIdx]!.centerAngleRad;
  const anchorHalfWidth = newWidths[hoverIdx]! / 2;

  // Walk forward from hoverIdx
  let cumPos = anchorCenter + anchorHalfWidth; // leading edge of hover sector
  const tempForward: DeformedSector[] = [];
  for (let step = 1; step <= n - 1; step++) {
    const i = (hoverIdx + step) % n;
    const width = newWidths[i]!;
    const center = cumPos + width / 2;
    cumPos += width;
    const dist = step / n;
    tempForward.push({
      id: baseSectors[i]!.id,
      centerAngleRad: center,
      halfWidthRad: width / 2,
      lensScale: 1 + (weights[i]! - 1) * 0.3, // gentle visual scale
      distanceFromHover: dist,
    });
  }

  // Add hovered sector
  const hoverSector: DeformedSector = {
    id: baseSectors[hoverIdx]!.id,
    centerAngleRad: anchorCenter,
    halfWidthRad: anchorHalfWidth,
    lensScale: 1 + (weights[hoverIdx]! - 1) * 0.3,
    distanceFromHover: 0,
  };

  // Rebuild in original base order so visual mapping stays consistent
  const byId = new Map<string, DeformedSector>();
  byId.set(hoverSector.id, hoverSector);
  for (const t of tempForward) byId.set(t.id, t);

  for (const base of baseSectors) {
    const d = byId.get(base.id);
    if (d) deformed.push(d);
    else deformed.push({
      id: base.id,
      centerAngleRad: base.centerAngleRad,
      halfWidthRad: base.halfWidthRad,
      lensScale: 1,
      distanceFromHover: 1,
    });
  }

  return deformed;
}

// ── Smoothing helper ────────────────────────────────────────────

/**
 * Interpolate between two sets of deformed sectors by id.
 * Used to smooth transitions when the hovered sector changes.
 */
export function lerpDeformed(
  a: DeformedSector[],
  b: DeformedSector[],
  t: number,
): DeformedSector[] {
  const bMap = new Map(b.map((s) => [s.id, s]));
  return a.map((from) => {
    const to = bMap.get(from.id);
    if (!to) return from;

    // Shortest-path angle lerp
    let deltaAngle = to.centerAngleRad - from.centerAngleRad;
    if (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
    if (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;

    return {
      id: from.id,
      centerAngleRad: from.centerAngleRad + deltaAngle * t,
      halfWidthRad: from.halfWidthRad + (to.halfWidthRad - from.halfWidthRad) * t,
      lensScale: from.lensScale + (to.lensScale - from.lensScale) * t,
      distanceFromHover: from.distanceFromHover + (to.distanceFromHover - from.distanceFromHover) * t,
    };
  });
}

/**
 * Strength ramp based on cursor distance from center — lets the
 * effect fade in as the user moves out of the dead zone.
 */
export function strengthForDistance(
  distPx: number,
  innerRadiusPx: number,
  outerRadiusPx: number,
): number {
  if (distPx < innerRadiusPx) return 0;
  const rampEnd = innerRadiusPx + (outerRadiusPx - innerRadiusPx) * 0.3;
  if (distPx > rampEnd) return 1;
  return (distPx - innerRadiusPx) / (rampEnd - innerRadiusPx);
}
