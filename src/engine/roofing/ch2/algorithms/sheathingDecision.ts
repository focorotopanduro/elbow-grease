/**
 * ALG-001 — Sheathing type decision.
 *
 * Source: spec §6 ALG-001, study packet §2A, §2B, §2I, §2K.
 *
 * Decides whether a roof takes SOLID sheathing, SPACED_WITH_SOLID_ZONES,
 * or SPACED_OVER_SOLID_HYBRID (low-slope wood build-up). The order of
 * checks is SAFETY-CRITICAL — seismic wins over everything, covering
 * overrides second, cold triggers before slope, etc. Every early return
 * is a book rule; don't reorder without updating the citations.
 *
 * Pure function: reads only from `inputs` + appends to `flags`. No
 * I/O, no store reads, no side effects beyond the passed-in array.
 */

import {
  type JobInputs,
  type SheathingType,
  type WarningFlag,
  SOLID_REQUIRED_COVERINGS,
  WOOD_COVERINGS,
} from '../types';
import {
  WOOD_SHINGLE_COLD_DESIGN_TEMP_F_MAX,
  WOOD_SHINGLE_JAN_MEAN_TEMP_F_MAX,
  WOOD_SHINGLE_MIN_SLOPE_RISE_PER_12,
} from '../constants';
import { InvalidGeometry, UnknownCoveringType } from '../errors';

/**
 * Pick the appropriate sheathing type for the given job.
 *
 * `flags` is mutated in-place — appended to rather than returned.
 * Callers either use an existing flag collector (spec §3
 * `WarningFlag[]`) or pass an empty array they consume after the
 * call. Not ideal functional form but mirrors the Python spec's
 * signature so migration is 1:1.
 *
 * @throws {InvalidGeometry} slope < 0 or roof_area_sf ≤ 0.
 * @throws {UnknownCoveringType} covering type isn't in the enum.
 */
export function determine_sheathing_type(
  inputs: JobInputs,
  flags: WarningFlag[],
): SheathingType {
  // ─── 1. Geometry validation (spec §6 ALG-001 step 1) ────────
  if (inputs.slope_rise_per_12 < 0) {
    throw new InvalidGeometry(
      `slope_rise_per_12 cannot be negative, got ${inputs.slope_rise_per_12}`,
    );
  }
  if (inputs.roof_area_sf <= 0) {
    throw new InvalidGeometry(
      `roof_area_sf must be > 0, got ${inputs.roof_area_sf}`,
    );
  }

  // ─── 2. Seismic override wins (per §2A) ─────────────────────
  // Seismic-zone roofs take solid sheathing regardless of
  // covering / slope / climate. This is an SHORT-CIRCUIT return —
  // no other rule can override.
  if (inputs.climate.seismic_zone) {
    return 'solid';
  }

  // ─── 3. Flat-slope flag (cross-cut — before covering gate) ──
  // Flat or near-flat roofs need a Chapter 10 (built-up / modified
  // bitumen) review regardless of what covering the user picked.
  // Surface the flag without altering the sheathing decision here.
  if (inputs.slope_rise_per_12 === 0) {
    flags.push({
      code: 'flat_slope_review_ch10',
      severity: 'warning',
      message: 'Zero-slope roof — verify drainage + underlayment per Ch 10.',
      remediation: 'Confirm covering is code-appropriate for a flat slope.',
    });
  }

  // ─── 4. Covering-driven decisions ───────────────────────────
  const covering = inputs.covering.covering_type;

  // 4a. SOLID-required coverings — §2A.
  // Covers asphalt/fiberglass/metal shingles, mineral-surfaced
  // roll, built-up, tile (clay + concrete), slate, metal sheet.
  if (SOLID_REQUIRED_COVERINGS.has(covering)) {
    return 'solid';
  }

  // 4b. Corrugated metal — §2A.
  // Default to solid; some localities allow spaced for this one
  // metal profile. Surface an info flag so the estimator can
  // present a "deviate to spaced?" affordance to the user.
  if (covering === 'metal_corrugated') {
    flags.push({
      code: 'metal_corrugated_spaced_allowed_by_local_code',
      severity: 'info',
      message:
        'Corrugated metal can be installed over spaced sheathing where ' +
        'local code permits. Default is solid; verify local rule before ' +
        'deviating.',
    });
    return 'solid';
  }

  // 4c. Wood coverings — §2B, §2I, §2K.
  // Wood shingles + shakes branch on climate and slope.
  if (WOOD_COVERINGS.has(covering)) {
    // i. Cold triggers — §2B. Any ONE of these forces solid:
    //    - Design temp ≤ 0°F   (ice dam risk)
    //    - Jan mean  ≤ 25°F    (cold, prolonged wetting)
    //    - Known ice risk at eaves
    const cold = inputs.climate.cold_design_temp_f <= WOOD_SHINGLE_COLD_DESIGN_TEMP_F_MAX;
    const freezingMean = inputs.climate.january_mean_temp_f <= WOOD_SHINGLE_JAN_MEAN_TEMP_F_MAX;
    const iceRisk = inputs.climate.ice_risk_at_eaves;
    if (cold || freezingMean || iceRisk) {
      return 'solid';
    }

    // ii. Low slope — §2K. Strictly LESS THAN 4:12 (4.0 is OK as
    //     spaced-with-solid-zones; 3.99 is hybrid). Boundary
    //     behavior is test-pinned in ALG-001 spec edge case #2.
    if (inputs.slope_rise_per_12 < WOOD_SHINGLE_MIN_SLOPE_RISE_PER_12) {
      return 'spaced_over_solid_hybrid';
    }

    // iii. FL wind-driven-rain zone — §2A.
    //      Per strict book logic, we still return SPACED_WITH_SOLID_ZONES,
    //      but surface a warning flag so the UI can present the FL
    //      override (default solid even when rule allows spaced).
    //      The FL overrides module (§9.4) flips this to solid when
    //      invoked — here we stay true to the base rule.
    if (inputs.climate.wind_driven_rain_zone) {
      flags.push({
        code: 'wind_rain_zone_solid_recommended',
        severity: 'warning',
        message:
          'Wind-driven rain zone: FL override recommends solid sheathing ' +
          'even for wood coverings. Book strict rule allows spaced; ' +
          'apply FL override if jurisdiction requires.',
        remediation:
          'Call `applyFloridaOverrides()` (§9.4) if this job is FL-HVHZ.',
      });
      return 'spaced_with_solid_zones';
    }

    // iv. Default wood path: spaced with solid zones at eaves / ridge.
    return 'spaced_with_solid_zones';
  }

  // ─── 5. Unreachable ────────────────────────────────────────
  // Every CoveringType is handled by one of the branches above.
  // If we get here, the caller extended the enum without
  // updating this function — fail loudly.
  throw new UnknownCoveringType(
    `covering_type=${covering} not handled by determine_sheathing_type`,
  );
}
