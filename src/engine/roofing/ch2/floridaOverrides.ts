/**
 * Florida-specific overrides — spec §9.4.
 *
 * ─── Purpose ──────────────────────────────────────────────────
 *
 * Florida's climate + code regime adds specific rules on top of
 * the national book (spec §9.4). This module centralises those
 * rules so the core algorithms (ALG-001..020) stay FL-agnostic
 * and the FL-specific behaviour lives in one auditable place.
 *
 * §9.4 rules:
 *
 *   1. Default sheathing preference: SOLID (even where national
 *      code would allow SPACED). For FL wood-covered roofs,
 *      force SOLID regardless of what ALG-001 returned.
 *
 *   2. Default nail: RING_SHANK_8D (not COMMON_8D). ALG-008
 *      already handles this via its `prefer_ring_shank` param,
 *      which the orchestrator routes from
 *      `wind_driven_rain_zone === true`. No override needed here.
 *
 *   3. Expansion gaps: doubled. Already handled by ALG-010 via
 *      `humidity === 'high'` which FL callers set explicitly.
 *      No override needed here.
 *
 *   4. HVHZ rider flag: Miami-Dade or Broward (both mapped to
 *      `jurisdiction === 'fl_hvhz'`) trigger the
 *      `hvhz_fastener_schedule_verify` flag. Per spec: "do not
 *      alter the base rule — only add the flag."
 *
 * ─── Why two entry points ─────────────────────────────────────
 *
 * Rule 1 affects PANEL SELECTION (solid vs spaced changes which
 * algorithms run downstream). Rule 4 is purely additive flags.
 * So the module exposes:
 *
 *   apply_florida_sheathing_type_override(inputs, type, flags)
 *     → pre-process, called between ALG-001 and ALG-003 by the
 *       orchestrator. Adjusts sheathing_type when FL + wood.
 *
 *   apply_florida_bid_audit_flags(inputs, bid)
 *     → post-process, called by the orchestrator just before
 *       returning the BidOutput. Appends audit flags; doesn't
 *       modify numbers.
 *
 * Callers that want to opt OUT of either override pass non-FL
 * inputs (jurisdiction omitted or set to 'other').
 *
 * ─── FL detection ─────────────────────────────────────────────
 *
 * A job counts as "FL" if EITHER:
 *   - `climate.jurisdiction === 'fl_hvhz' || 'fl_non_hvhz'`, OR
 *   - `climate.wind_driven_rain_zone === true` (back-compat proxy)
 *
 * HVHZ is the strict subset — only `jurisdiction === 'fl_hvhz'`.
 */

import type { BidOutput, Climate, JobInputs, SheathingType, WarningFlag } from './types';

/**
 * True iff the inputs' climate indicates a Florida job. Uses the
 * `jurisdiction` field when present; falls back to
 * `wind_driven_rain_zone` for older callers.
 */
export function is_fl_job(climate: Climate): boolean {
  if (climate.jurisdiction === 'fl_hvhz' || climate.jurisdiction === 'fl_non_hvhz') {
    return true;
  }
  if (climate.jurisdiction === 'other') {
    // Explicitly non-FL — don't fall back to the wind-rain proxy.
    return false;
  }
  // jurisdiction undefined → legacy proxy via wind_driven_rain_zone
  return climate.wind_driven_rain_zone === true;
}

/**
 * True iff the inputs' climate indicates a Florida HVHZ job
 * (Miami-Dade or Broward). Requires `jurisdiction === 'fl_hvhz'`
 * — there's no legacy proxy because HVHZ is a strict code
 * designation, not a general wind-rain flag.
 */
export function is_hvhz_job(climate: Climate): boolean {
  return climate.jurisdiction === 'fl_hvhz';
}

/**
 * §9.4 point 1 — force SOLID sheathing for FL wood-covered roofs.
 *
 * ALG-001 returns SPACED_WITH_SOLID_ZONES for wood shingle/shake
 * at normal slopes in wind-rain climates; it appends a flag but
 * doesn't override. This function applies the FL-specific rule:
 * force SOLID, append an audit flag.
 *
 * @param inputs          Original JobInputs — used for FL detection
 *                        + covering type.
 * @param sheathing_type  Result from ALG-001 (what the book rule
 *                        produced).
 * @param flags           Mutated — audit flag appended when the
 *                        override actually fires.
 *
 * @returns  Possibly-adjusted sheathing_type. Unchanged if the
 *           override doesn't apply.
 */
export function apply_florida_sheathing_type_override(
  inputs: JobInputs,
  sheathing_type: SheathingType,
  flags: WarningFlag[],
): SheathingType {
  // Only fires when:
  //   (a) job is in FL
  //   (b) ALG-001 returned a spaced variant
  //   (c) the covering is a wood one — other coverings already
  //       hit SOLID via ALG-001's SOLID_REQUIRED_COVERINGS gate.
  if (!is_fl_job(inputs.climate)) {
    return sheathing_type;
  }
  if (sheathing_type === 'solid') {
    return sheathing_type;  // already solid — nothing to override
  }

  const covering = inputs.covering.covering_type;
  const is_wood = covering === 'wood_shingle' || covering === 'wood_shake';
  if (!is_wood) {
    return sheathing_type;  // non-wood spaced paths aren't in spec
  }

  // Fire the override + audit flag.
  flags.push({
    code: 'fl_override_forced_solid',
    severity: 'info',
    message:
      `FL jurisdiction: forcing SOLID sheathing for ${covering} per §9.4 ` +
      `point 1 (ALG-001 returned ${sheathing_type} under national code, ` +
      `but FL default is solid regardless).`,
    remediation:
      'If a different sheathing type is desired, move the job out of ' +
      'the FL jurisdiction or consult local building code.',
  });
  return 'solid';
}

/**
 * §9.4 point 4 — append audit flags to a completed BidOutput.
 *
 *   fl_overrides_applied      (info) — FL job detected; overrides ran
 *   hvhz_fastener_schedule_verify (warning) — only for HVHZ
 *
 * Does NOT modify prices, cost lines, or sheathing spec — per
 * spec §9.4: "do not alter the base rule — only add the flag."
 *
 * Returns a NEW BidOutput with the flags appended; the input bid
 * is not mutated (readonly fields are respected).
 */
export function apply_florida_bid_audit_flags(
  inputs: JobInputs,
  bid: BidOutput,
): BidOutput {
  if (!is_fl_job(inputs.climate)) {
    return bid;
  }

  const new_flags: WarningFlag[] = [...bid.flags];

  new_flags.push({
    code: 'fl_overrides_applied',
    severity: 'info',
    message:
      `FL jurisdiction detected (` +
      `${inputs.climate.jurisdiction ?? 'legacy wind_driven_rain proxy'}). ` +
      `FL overrides per §9.4 have been applied during bid assembly.`,
  });

  if (is_hvhz_job(inputs.climate)) {
    new_flags.push({
      code: 'hvhz_fastener_schedule_verify',
      severity: 'warning',
      message:
        'HVHZ (Miami-Dade / Broward) job — fastener schedule in the ' +
        'BidOutput reflects APA 6"/12" baseline. FBC HVHZ may require ' +
        'tighter panel-edge spacing; verify against the current FBC ' +
        'before submitting the bid.',
      remediation:
        'Check FBC HVHZ fastener schedule for the panel + covering ' +
        'combination and override if required.',
    });
  }

  return {
    ...bid,
    flags: new_flags,
  };
}
