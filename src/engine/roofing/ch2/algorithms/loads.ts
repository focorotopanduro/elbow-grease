/**
 * ALG-002 — Dead load + effective live load.
 *
 * Source: spec §6 ALG-002. Book §2E.
 *
 * ─── Rule of thumb ─────────────────────────────────────────────
 *
 * The building code sets a MINIMUM DESIGN LIVE LOAD of 30 psf for
 * roof construction (workers + temporary loads + typical snow-free
 * service). If the permanent DEAD LOAD exceeds the baseline 10 psf,
 * the excess "bumps" the effective live load by the same delta:
 *
 *     effective_live_load_psf = 30 + max(0, total_dead_load - 10)
 *
 * A 20-psf-dead tile roof therefore designs for 40 psf effective
 * live load, which drives the APA panel selector (ALG-003) toward
 * a thicker panel.
 *
 * ─── Component weights (WEIGHT_PSF lookup) ─────────────────────
 *
 * Generic component weights live in `constants.WEIGHT_PSF`. When
 * the manufacturer publishes a specific datasheet, prefer the
 * `CoveringSpec.weight_psf` field on `JobInputs` and skip the
 * table — the weight argument here is explicit for exactly this
 * reason.
 *
 * ─── Spec §6 ALG-002 edge-case table (inlined for review) ──────
 *
 *   # | dead (psf) | effective live (psf) | notes
 *   --|------------|----------------------|--------------------
 *   1 |      5     |        30            | no excess
 *   2 |     10     |        30            | boundary (≤)
 *   3 |     10.01  |        30.01         | one tick over
 *   4 |     20     |        40            | tile example
 *   5 |      0     |        30            | zero deck weight
 *   6 |     -1     |        30            | clamp + warn
 *   7 | bad deck   |   throws             | caller bug
 *
 * ─── Design decisions, cited to Ground Rules (spec §0) ─────────
 *
 *   • Ground Rule #6 (fail loudly): unknown deck / underlayment
 *     keys throw — silently defaulting to 0 would hide a caller
 *     bug and land in the bid.
 *   • Ground Rule #7 (warn, don't block): negative dead loads
 *     clamp to the baseline and append a warning flag rather than
 *     throwing. Legitimate causes (measurement noise on a
 *     sensor-fed dead-load input) are tolerated.
 */

import type { WarningFlag } from '../types';
import {
  DEAD_LOAD_BASELINE_PSF,
  LIVE_LOAD_CODE_MIN_PSF,
  WEIGHT_PSF,
} from '../constants';
import { MissingRequiredInput } from '../errors';

/**
 * Sum the component weights to get total dead load in psf.
 *
 * @param deck_type           Key into `WEIGHT_PSF` (e.g. `'wood_deck'`).
 * @param underlayment_type   Key into `WEIGHT_PSF` (e.g. `'felt_30lb'`).
 * @param covering_weight_psf Explicit covering weight — prefer
 *                            manufacturer datasheet over the generic
 *                            `WEIGHT_PSF` entry. Must be ≥ 0 for
 *                            physical plausibility.
 *
 * @throws {MissingRequiredInput} `deck_type` or `underlayment_type`
 *         isn't a key in WEIGHT_PSF — per Ground Rule #6 we fail
 *         loudly rather than silently contributing zero.
 */
export function compute_total_dead_load_psf(
  deck_type: string,
  underlayment_type: string,
  covering_weight_psf: number,
): number {
  const deck = WEIGHT_PSF[deck_type];
  const underlayment = WEIGHT_PSF[underlayment_type];
  if (deck === undefined) {
    throw new MissingRequiredInput(
      `unknown deck_type '${deck_type}' — not in WEIGHT_PSF. ` +
        `Valid keys: ${Object.keys(WEIGHT_PSF).join(', ')}`,
    );
  }
  if (underlayment === undefined) {
    throw new MissingRequiredInput(
      `unknown underlayment_type '${underlayment_type}' — not in WEIGHT_PSF. ` +
        `Valid keys: ${Object.keys(WEIGHT_PSF).join(', ')}`,
    );
  }
  return deck + underlayment + covering_weight_psf;
}

/**
 * Compute effective design live load given a total dead load.
 *
 * Per §2E: excess dead load above the 10 psf baseline pushes the
 * effective live load up by the same delta. The effective live
 * load can never fall below the code minimum of 30 psf — negative
 * dead loads (measurement error) are clamped.
 *
 * @param total_dead_load_psf From `compute_total_dead_load_psf`
 *                            or a manual override. If < 0 the
 *                            function returns the baseline 30 psf
 *                            and appends a warning flag (if `flags`
 *                            is provided).
 * @param flags               Optional mutable collector. If passed,
 *                            the function appends a `negative_dead_load_clamped`
 *                            flag when the input is negative. Matches
 *                            the flags-array convention set by ALG-001.
 *
 * @returns Effective design live load in psf.
 */
export function compute_effective_live_load_psf(
  total_dead_load_psf: number,
  flags?: WarningFlag[],
): number {
  if (total_dead_load_psf < 0 && flags !== undefined) {
    flags.push({
      code: 'negative_dead_load_clamped',
      severity: 'warning',
      message:
        `total_dead_load_psf=${total_dead_load_psf} is negative. ` +
        `Clamping to baseline ${DEAD_LOAD_BASELINE_PSF} psf. ` +
        `Verify the dead-load source.`,
      remediation:
        'Recheck deck + underlayment + covering weights for sign errors.',
    });
  }
  const excess = Math.max(0, total_dead_load_psf - DEAD_LOAD_BASELINE_PSF);
  return LIVE_LOAD_CODE_MIN_PSF + excess;
}

/**
 * Convenience one-shot that chains `compute_total_dead_load_psf` and
 * `compute_effective_live_load_psf`. Returned object carries BOTH
 * numbers so downstream callers (panel selector, framing flag) don't
 * have to re-compute either value.
 *
 * This is NOT in the spec — it's a cross-cutting helper that saves
 * every caller from writing the same two lines. Kept as a pure
 * wrapper; both component functions remain individually exported.
 */
export function compute_loads(
  deck_type: string,
  underlayment_type: string,
  covering_weight_psf: number,
  flags?: WarningFlag[],
): { total_dead_psf: number; effective_live_psf: number } {
  const total_dead_psf = compute_total_dead_load_psf(
    deck_type,
    underlayment_type,
    covering_weight_psf,
  );
  const effective_live_psf = compute_effective_live_load_psf(total_dead_psf, flags);
  return { total_dead_psf, effective_live_psf };
}
