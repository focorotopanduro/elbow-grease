/**
 * ALG-010 + ALG-012 — Panel expansion gaps and humidity validation.
 *
 * Source: spec §6 ALG-010, ALG-012. Book §2D (humidity-doubling).
 *
 * ─── ALG-010 Rule ──────────────────────────────────────────────
 *
 * Panel expansion gaps exist so plywood / OSB / waferboard can
 * absorb moisture-driven swelling without buckling. The book §2D
 * gives two baselines:
 *
 *     end-to-end gap:   1/16"   (~0.0625")
 *     side-to-side gap: 1/8"    (~0.125")
 *
 * In HIGH-humidity climates (FL default) both gaps DOUBLE. Normal
 * and Low humidity both use the baselines — there's no in-between.
 *
 * ─── ALG-012 Rule ──────────────────────────────────────────────
 *
 * `validate_gaps_match_humidity` is a belt-and-braces code-
 * compliance gate run before the cost engine prices the bid.
 * Because the caller COULD construct a gaps value by hand (not
 * via ALG-010), the gate exists to catch that mismatch loudly
 * rather than letting a plausible-but-wrong gap ship into a BOM.
 *
 * The comparison is exact — floating-point equality against the
 * constants. Any drift (e.g. someone inlining 0.0625 by hand but
 * later reading back 1/16) fires the mismatch. Documented in
 * spec edge case E-024.
 *
 * ─── Spec §6 ALG-010 edge-case table ──────────────────────────
 *
 *   humidity  | end gap | side gap
 *   ----------|---------|---------
 *   low       |  1/16"  |  1/8"
 *   normal    |  1/16"  |  1/8"
 *   high (FL) |  1/8"   |  1/4"
 */

import type { ClimateHumidity, ExpansionGaps } from '../types';
import {
  HIGH_HUMIDITY_GAP_MULTIPLIER,
  PANEL_END_GAP_STANDARD_IN,
  PANEL_SIDE_GAP_STANDARD_IN,
} from '../constants';
import { HumidityGapMismatch } from '../errors';

/**
 * Return the code-prescribed panel expansion gaps for a given
 * humidity class.
 *
 * The returned object is a fresh immutable structure each call —
 * safe to embed in larger bids without worrying about shared
 * references. Immutability is carried by the `ExpansionGaps`
 * interface's `readonly` fields.
 */
export function panel_expansion_gaps(humidity: ClimateHumidity): ExpansionGaps {
  let end_gap_in = PANEL_END_GAP_STANDARD_IN;
  let side_gap_in = PANEL_SIDE_GAP_STANDARD_IN;

  // §2D humidity-doubling rule — high-humidity climates (FL HVHZ,
  // Gulf coast, Pacific NW) double both gaps so the panels have
  // headroom to swell without buckling.
  if (humidity === 'high') {
    end_gap_in *= HIGH_HUMIDITY_GAP_MULTIPLIER;
    side_gap_in *= HIGH_HUMIDITY_GAP_MULTIPLIER;
  }

  return { end_gap_in, side_gap_in };
}

/**
 * ALG-012 — Validate that a caller-supplied `ExpansionGaps` matches
 * the gaps that ALG-010 would produce for the given humidity.
 *
 * Strict equality — any drift fires the typed throw. The gate is
 * meant to run in the validation phase (§7), before the cost
 * engine prices the bid.
 *
 * @throws {HumidityGapMismatch} when the gaps object doesn't
 *         exactly match what `panel_expansion_gaps(humidity)`
 *         would return.
 */
export function validate_gaps_match_humidity(
  gaps: ExpansionGaps,
  humidity: ClimateHumidity,
): void {
  const expected = panel_expansion_gaps(humidity);
  if (
    gaps.end_gap_in !== expected.end_gap_in ||
    gaps.side_gap_in !== expected.side_gap_in
  ) {
    throw new HumidityGapMismatch(
      `humidity='${humidity}' requires gaps end=${expected.end_gap_in}", ` +
        `side=${expected.side_gap_in}", but got end=${gaps.end_gap_in}", ` +
        `side=${gaps.side_gap_in}". Regenerate gaps via panel_expansion_gaps(${humidity}).`,
    );
  }
}
