/**
 * §7 Validation Gates — `validate_job_inputs`.
 *
 * Source: spec §7.
 *
 * ─── Purpose ──────────────────────────────────────────────────
 *
 * Runs ALL structural + schema checks on a `JobInputs` before the
 * cost engine (ALG-020) starts. Any violation throws a typed error
 * so the caller never gets a partially-priced bid with bogus
 * values.
 *
 * Each gate maps to a specific typed error:
 *   roof_area_sf ≤ 0                       → InvalidGeometry
 *   slope_rise_per_12 < 0                   → InvalidGeometry
 *   rafter_spacing_in ≤ 0                   → InvalidGeometry
 *   empty rate_set_version                  → MissingRequiredInput
 *   waste_factor not in [0, 1)              → InvalidGeometry
 *   covering_type not in enum               → UnknownCoveringType
 *   reroof missing existing_covering_weight → MissingRequiredInput
 *
 * Covering-specific rules (e.g. BUILT_UP + spacing > 24") are
 * enforced inside ALG-003, not here — they need intermediate
 * computation state. Per spec §7: this gate handles structure
 * only, not domain constraints.
 */

import type { JobInputs } from './types';
import { COVERING_TYPES } from './types';
import {
  InvalidGeometry,
  MissingRequiredInput,
  UnknownCoveringType,
} from './errors';

/**
 * Structural validator for `JobInputs`.
 *
 * Runs before any algorithm in the cost engine. Throws on the
 * first failure — no attempt to collect multiple errors because
 * each violation blocks the rest of the bid anyway.
 *
 * @throws {InvalidGeometry}        negative slope, zero/negative
 *                                  area, zero/negative rafter
 *                                  spacing, out-of-range waste_factor.
 * @throws {MissingRequiredInput}   empty rate_set_version, reroof
 *                                  without existing covering weight.
 * @throws {UnknownCoveringType}    covering_type isn't in
 *                                  `COVERING_TYPES`.
 */
export function validate_job_inputs(inputs: JobInputs): void {
  // ─── Geometry ────────────────────────────────────────────
  if (!Number.isFinite(inputs.roof_area_sf) || inputs.roof_area_sf <= 0) {
    throw new InvalidGeometry(
      `roof_area_sf must be a finite number > 0, got ${inputs.roof_area_sf}`,
    );
  }
  if (!Number.isFinite(inputs.slope_rise_per_12) || inputs.slope_rise_per_12 < 0) {
    throw new InvalidGeometry(
      `slope_rise_per_12 must be finite and ≥ 0, got ${inputs.slope_rise_per_12}`,
    );
  }
  if (
    !Number.isFinite(inputs.frame.rafter_spacing_in) ||
    inputs.frame.rafter_spacing_in <= 0
  ) {
    throw new InvalidGeometry(
      `frame.rafter_spacing_in must be a finite number > 0, ` +
        `got ${inputs.frame.rafter_spacing_in}`,
    );
  }

  // ─── Waste factor ───────────────────────────────────────
  if (
    !Number.isFinite(inputs.waste_factor) ||
    inputs.waste_factor < 0 ||
    inputs.waste_factor >= 1
  ) {
    throw new InvalidGeometry(
      `waste_factor must be a finite number in [0, 1), ` +
        `got ${inputs.waste_factor}`,
    );
  }

  // ─── Rate set audit trail ───────────────────────────────
  if (
    typeof inputs.rate_set_version !== 'string' ||
    inputs.rate_set_version.length === 0
  ) {
    throw new MissingRequiredInput(
      'rate_set_version is required for audit trail (spec §9.2). ' +
        'Pass the version string from the RateSet used to price this bid.',
    );
  }

  // ─── Covering enum membership ───────────────────────────
  if (!COVERING_TYPES.includes(inputs.covering.covering_type)) {
    throw new UnknownCoveringType(
      `covering_type='${inputs.covering.covering_type}' is not a member ` +
        `of COVERING_TYPES. Valid: ${COVERING_TYPES.join(', ')}`,
    );
  }

  // ─── Covering weight ────────────────────────────────────
  if (
    !Number.isFinite(inputs.covering.weight_psf) ||
    inputs.covering.weight_psf < 0
  ) {
    throw new InvalidGeometry(
      `covering.weight_psf must be a finite number ≥ 0, ` +
        `got ${inputs.covering.weight_psf}`,
    );
  }

  // ─── Reroof consistency ─────────────────────────────────
  if (
    inputs.reroof.is_reroof_over_existing &&
    (inputs.reroof.existing_covering_weight_psf === undefined ||
      inputs.reroof.existing_covering_weight_psf === null)
  ) {
    throw new MissingRequiredInput(
      'Reroof job requires reroof.existing_covering_weight_psf ' +
        '(ALG-016 frame-load flag depends on the existing weight).',
    );
  }
}
