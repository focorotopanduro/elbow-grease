/**
 * ALG-002 — Dead load + effective live load.
 *
 * Source: spec §6 ALG-002, study packet §2E.
 *
 * Philosophy: the building code sets a minimum DESIGN LIVE LOAD of
 * 30 psf (construction + temporary loads). If the roof's DEAD LOAD
 * exceeds the baseline 10 psf, the excess "bumps" the effective
 * design live load by the same delta. A 20-psf-dead tile roof
 * therefore designs for 40 psf effective live load.
 *
 * Pure function — no side effects, no I/O.
 */

import { DEAD_LOAD_BASELINE_PSF, LIVE_LOAD_CODE_MIN_PSF, WEIGHT_PSF } from '../constants';

/**
 * Sum the component weights to get total dead load in psf.
 *
 * @param deck_type           Key into `WEIGHT_PSF` (e.g. `'wood_deck'`).
 * @param underlayment_type   Key into `WEIGHT_PSF` (e.g. `'felt_30lb'`).
 * @param covering_weight_psf From `CoveringSpec.weight_psf` — keep
 *                            as an explicit argument rather than a
 *                            lookup so manufacturer datasheets can
 *                            override the generic WEIGHT_PSF entry.
 * @throws {Error} if `deck_type` or `underlayment_type` isn't a
 *                 key in `WEIGHT_PSF` (caller bug).
 */
export function compute_total_dead_load_psf(
  deck_type: string,
  underlayment_type: string,
  covering_weight_psf: number,
): number {
  const deck = WEIGHT_PSF[deck_type];
  const underlayment = WEIGHT_PSF[underlayment_type];
  if (deck === undefined) {
    throw new Error(`unknown deck_type '${deck_type}' in WEIGHT_PSF`);
  }
  if (underlayment === undefined) {
    throw new Error(`unknown underlayment_type '${underlayment_type}' in WEIGHT_PSF`);
  }
  return deck + underlayment + covering_weight_psf;
}

/**
 * Compute effective design live load given a total dead load.
 *
 * Per §2E: excess dead load (above the 10 psf baseline) pushes the
 * effective live load up by the same amount.
 *
 *   effective_live_load = 30 + max(0, total_dead_load - 10)
 *
 * Examples:
 *   - dead = 5 psf  → effective live = 30 psf (no excess)
 *   - dead = 10 psf → effective live = 30 psf (at baseline)
 *   - dead = 20 psf → effective live = 40 psf (tile territory)
 *
 * Note: negative dead loads don't make physical sense. We don't
 * throw — some caller geometry might legitimately produce tiny
 * negatives from measurement error — but the algorithm clamps
 * excess to 0 so the live load can never dip below the code
 * minimum.
 */
export function compute_effective_live_load_psf(
  total_dead_load_psf: number,
): number {
  const excess = Math.max(0, total_dead_load_psf - DEAD_LOAD_BASELINE_PSF);
  return LIVE_LOAD_CODE_MIN_PSF + excess;
}
