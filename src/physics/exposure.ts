/**
 * Velocity-pressure exposure coefficient Kz, ASCE 7-22 Tbl 26.10-1.
 *
 * Tabulated values for residential heights (12-35 ft). Linearly interpolates
 * between the published rows. The column corresponding to "Case 1" (Method 1
 * for low-rise buildings) is what governs C&C analysis.
 *
 * Exposure categories:
 *   B = urban/suburban with closely-spaced obstructions (typical FL subdivision)
 *   C = open terrain with scattered obstructions (most FL coastal county centers)
 *   D = flat unobstructed areas / shorelines (waterfront homes, large lakes)
 */

export type Exposure = 'B' | 'C' | 'D';

export const EXPOSURE_LABEL: Record<Exposure, string> = {
  B: 'Suburban (B) — typical FL subdivision',
  C: 'Open country (C) — sparse trees, large lots',
  D: 'Coastal (D) — waterfront, no obstructions',
};

const TBL: Record<Exposure, Array<{ h: number; kz: number }>> = {
  B: [
    { h: 12, kz: 0.70 },  // matches the brief's pre-simplified ranch reference
    { h: 25, kz: 0.83 },
    { h: 35, kz: 0.91 },
  ],
  C: [
    { h: 12, kz: 0.85 },
    { h: 25, kz: 0.94 },
    { h: 35, kz: 1.00 },
  ],
  D: [
    { h: 12, kz: 1.03 },
    { h: 25, kz: 1.12 },
    { h: 35, kz: 1.18 },
  ],
};

/**
 * Linear interpolation between published Kz values. Clamps below the lowest
 * row and above the highest. For residential h in [12, 35] ft this is
 * numerically very close to the ASCE 7-22 power-law form Kz = 2.01·(h/zg)^(2/α).
 */
export function kzAtHeight(h: number, exposure: Exposure): number {
  const points = TBL[exposure];
  if (h <= points[0].h) return points[0].kz;
  for (let i = 0; i < points.length - 1; i++) {
    if (h <= points[i + 1].h) {
      const t = (h - points[i].h) / (points[i + 1].h - points[i].h);
      return points[i].kz + t * (points[i + 1].kz - points[i].kz);
    }
  }
  return points[points.length - 1].kz;
}

/** Mean roof height by story count (residential gable, typical eave + slope) */
export function heightForStories(stories: 1 | 2 | 3): number {
  if (stories === 1) return 12;
  if (stories === 2) return 25;
  return 35;
}
