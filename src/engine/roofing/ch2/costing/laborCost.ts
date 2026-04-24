/**
 * ALG-019 — Labor cost line.
 *
 * Source: spec §6 ALG-019. Book §2N.
 *
 * ─── Formula ──────────────────────────────────────────────────
 *
 *     manhours     = roof_area_sf × mh_per_sf
 *     extended_usd = manhours × crew_manhour_rate_usd
 *
 * `mh_per_sf` is labor intensity — how many man-hours to install
 * one square foot. Book §2N baselines:
 *
 *     board_sheathing   0.026 mh/sf
 *     plywood_sheathing 0.013 mh/sf
 *
 * These are historical and live in `DEFAULT_LABOR_RATE_MH_PER_SF`
 * as a FALLBACK — production callers override via the explicit
 * `rate_override_mh_per_sf` arg (pulled from the RateSet).
 *
 * ─── Spec signature fidelity ──────────────────────────────────
 *
 * Spec keeps `rate_override_mh_per_sf` optional; when omitted the
 * function reads from `DEFAULT_LABOR_RATE_MH_PER_SF`. This lets
 * quick ad-hoc calls work with book defaults for smoke tests +
 * integration shims. The orchestrator (ALG-020) always passes the
 * override explicitly from the active RateSet — per Ground Rule #8
 * ("Never hardcode rates or prices").
 *
 * Unknown material + no override → `MissingRequiredInput` (OSB
 * and decking aren't in the default table yet per the seed
 * comment; FL estimators must provide the rate explicitly).
 */

import type { CostLine, SheathingMaterial } from '../types';
import { DEFAULT_LABOR_RATE_MH_PER_SF } from '../constants';
import { InvalidGeometry, MissingRequiredInput } from '../errors';

/** Map a `SheathingMaterial` to its key in `DEFAULT_LABOR_RATE_MH_PER_SF`. */
function default_rate_key(material: SheathingMaterial): string | null {
  switch (material) {
    case 'board':
      return 'board_sheathing';
    case 'plywood':
      return 'plywood_sheathing';
    default:
      // OSB, waferboard, roof_decking — not in the book's §2N
      // default table. Callers must pass explicit rate override.
      return null;
  }
}

/**
 * Produce a `CostLine` for installation labor scaled by roof area.
 *
 * @param roof_area_sf              Net roof area in sf. Must be > 0.
 * @param sheathing_material        Used to look up the default
 *                                  per-material mh/sf rate when no
 *                                  override is provided.
 * @param crew_manhour_rate_usd     USD per man-hour for the crew.
 *                                  Must be > 0. Comes from RateSet.
 * @param rate_override_mh_per_sf   Optional explicit labor intensity
 *                                  (mh/sf). When provided, wins over
 *                                  the default lookup. Orchestrator
 *                                  always passes this from the
 *                                  RateSet.
 *
 * @throws {InvalidGeometry}         roof area or crew rate invalid.
 * @throws {MissingRequiredInput}    no default + no override for the
 *                                   material (e.g. OSB without override).
 */
export function labor_cost_line(
  roof_area_sf: number,
  sheathing_material: SheathingMaterial,
  crew_manhour_rate_usd: number,
  rate_override_mh_per_sf?: number,
): CostLine {
  // ─── Validate ────────────────────────────────────────────
  if (!Number.isFinite(roof_area_sf) || roof_area_sf <= 0) {
    throw new InvalidGeometry(
      `roof_area_sf must be a finite number > 0, got ${roof_area_sf}`,
    );
  }
  if (
    !Number.isFinite(crew_manhour_rate_usd) ||
    crew_manhour_rate_usd <= 0
  ) {
    throw new InvalidGeometry(
      `crew_manhour_rate_usd must be a finite number > 0, ` +
        `got ${crew_manhour_rate_usd}`,
    );
  }

  // ─── Resolve rate (override > default lookup > fail) ────
  let mh_per_sf: number;
  if (rate_override_mh_per_sf !== undefined) {
    if (
      !Number.isFinite(rate_override_mh_per_sf) ||
      rate_override_mh_per_sf <= 0
    ) {
      throw new InvalidGeometry(
        `rate_override_mh_per_sf must be a finite number > 0, ` +
          `got ${rate_override_mh_per_sf}`,
      );
    }
    mh_per_sf = rate_override_mh_per_sf;
  } else {
    const key = default_rate_key(sheathing_material);
    if (key === null || DEFAULT_LABOR_RATE_MH_PER_SF[key] === undefined) {
      throw new MissingRequiredInput(
        `no default labor rate for sheathing_material='${sheathing_material}' ` +
          `and no rate_override_mh_per_sf provided. Book §2N tabulates ` +
          `rates for 'board' and 'plywood' only — other materials require ` +
          `an explicit override from the RateSet.`,
      );
    }
    mh_per_sf = DEFAULT_LABOR_RATE_MH_PER_SF[key] as number;
  }

  const manhours = roof_area_sf * mh_per_sf;
  const extended_usd = manhours * crew_manhour_rate_usd;

  return {
    description: 'Sheathing install labor',
    quantity: manhours,
    unit: 'MH',
    unit_cost_usd: crew_manhour_rate_usd,
    extended_usd,
  };
}
