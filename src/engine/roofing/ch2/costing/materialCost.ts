/**
 * ALG-018 — Material cost line.
 *
 * Source: spec §6 ALG-018. Book §2N.
 *
 * ─── Formula ──────────────────────────────────────────────────
 *
 *     quantity = roof_area_sf × (1 + waste_factor)
 *     extended = quantity × material_cost_per_sf_usd
 *
 * `waste_factor` is a proportion (0.10 = 10% waste). Typical
 * plywood waste factor is 0.10; OSB 0.10; boards 0.15.
 *
 * ─── Validation rules ────────────────────────────────────────
 *
 *   roof_area_sf                > 0      (physical roof)
 *   0 ≤ waste_factor < 1                 (no scam — can't be ≥ 100%)
 *   material_cost_per_sf_usd    ≥ 0      (free / bundled allowed)
 *
 * Violations throw `InvalidGeometry` (spec maps geometry-like
 * violations there; negative-cost is its own category but
 * `MissingRequiredInput` would be misleading for a value that was
 * present but wrong). Callers use the typed throw to decide how
 * to surface the bug — raw Error would make `instanceof` checks
 * unreliable.
 */

import type { CostLine } from '../types';
import { InvalidGeometry } from '../errors';

/**
 * Produce a `CostLine` for a material purchase scaled by roof area
 * and waste factor.
 *
 * @param roof_area_sf              Net roof area to cover, in sf.
 *                                  Must be > 0.
 * @param waste_factor              Proportion of waste (0.10 = 10%).
 *                                  Must be in [0, 1).
 * @param material_cost_per_sf_usd  Unit price per sf from RateSet.
 *                                  Must be ≥ 0.
 * @param description               Human-readable line-item
 *                                  description (e.g. "15/32 APA
 *                                  32/16 plywood sheathing").
 *
 * @throws {InvalidGeometry} any input out of its permitted range.
 */
export function material_cost_line(
  roof_area_sf: number,
  waste_factor: number,
  material_cost_per_sf_usd: number,
  description: string,
): CostLine {
  if (!Number.isFinite(roof_area_sf) || roof_area_sf <= 0) {
    throw new InvalidGeometry(
      `roof_area_sf must be a finite number > 0, got ${roof_area_sf}`,
    );
  }
  if (!Number.isFinite(waste_factor) || waste_factor < 0 || waste_factor >= 1) {
    throw new InvalidGeometry(
      `waste_factor must be a finite number in [0, 1), got ${waste_factor}`,
    );
  }
  if (
    !Number.isFinite(material_cost_per_sf_usd) ||
    material_cost_per_sf_usd < 0
  ) {
    throw new InvalidGeometry(
      `material_cost_per_sf_usd must be a finite number ≥ 0, ` +
        `got ${material_cost_per_sf_usd}`,
    );
  }

  const quantity = roof_area_sf * (1 + waste_factor);
  const extended_usd = quantity * material_cost_per_sf_usd;

  return {
    description,
    quantity,
    unit: 'SF',
    unit_cost_usd: material_cost_per_sf_usd,
    extended_usd,
  };
}
