/**
 * ALG-013 — OSB / waferboard span check.
 *
 * Source: spec §6 ALG-013, study packet §2G.
 *
 * OSB panels have a tabulated max span per thickness:
 *   3/8"  → 16" o.c. max
 *   7/16" → 24" o.c. max
 *   1/2"  → 24" o.c. max
 *
 * OSB's absolute minimum thickness under any covering is 15/32".
 * Panels thinner than that are rejected regardless of their
 * tabulated span.
 */

import { OSB_MIN_THICKNESS_IN, WAFERBOARD_MAX_SPAN_IN } from '../constants';
import { SheathingSpecViolation } from '../errors';

/**
 * Max rafter spacing allowed for a given OSB thickness.
 *
 * @param thickness_str One of '3/8', '7/16', '1/2'.
 * @throws {SheathingSpecViolation} unknown thickness string.
 */
export function osb_max_span_for_thickness(thickness_str: string): number {
  const span = WAFERBOARD_MAX_SPAN_IN[thickness_str];
  if (span === undefined) {
    throw new SheathingSpecViolation(
      `OSB thickness '${thickness_str}' not in Table (§2G). ` +
        `Valid: ${Object.keys(WAFERBOARD_MAX_SPAN_IN).join(', ')}`,
    );
  }
  return span;
}

/**
 * Convert an OSB fractional thickness string like "15/32" to a
 * decimal number. Separated out so callers can compare against
 * `OSB_MIN_THICKNESS_IN` without pulling in a math library.
 */
export function parse_fractional_thickness_in(thickness_str: string): number {
  // Accept "N/M" and bare decimals like "0.5".
  if (thickness_str.includes('/')) {
    const parts = thickness_str.split('/').map((s) => Number(s.trim()));
    const num = parts[0];
    const den = parts[1];
    if (
      num === undefined ||
      den === undefined ||
      !Number.isFinite(num) ||
      !Number.isFinite(den) ||
      den === 0
    ) {
      throw new SheathingSpecViolation(
        `malformed fractional thickness '${thickness_str}'`,
      );
    }
    return num / den;
  }
  const asFloat = Number(thickness_str);
  if (!Number.isFinite(asFloat)) {
    throw new SheathingSpecViolation(
      `malformed thickness '${thickness_str}' — not a number or N/M fraction`,
    );
  }
  return asFloat;
}

/**
 * Validate an OSB panel meets the spec's minimum thickness of 15/32".
 *
 * Pure boolean guard — returns true iff the thickness passes.
 * Most callers will want to throw on failure; this split makes
 * that caller-side decision explicit.
 */
export function osb_meets_min_thickness(thickness_in: number): boolean {
  return thickness_in >= OSB_MIN_THICKNESS_IN;
}

/**
 * Validate an OSB panel meets BOTH the thickness-for-span lookup
 * AND the absolute minimum. Throws on violation.
 */
export function validate_osb_spec(
  thickness_str: string,
  rafter_spacing_in: number,
): void {
  const thickness_in = parse_fractional_thickness_in(thickness_str);

  // Absolute min (OSB-wide)
  if (!osb_meets_min_thickness(thickness_in)) {
    throw new SheathingSpecViolation(
      `OSB thickness ${thickness_str} (${thickness_in.toFixed(4)}") is ` +
        `below the ${OSB_MIN_THICKNESS_IN.toFixed(4)}" (15/32) minimum per §2G`,
    );
  }

  // Per-thickness span max
  const max_span = osb_max_span_for_thickness(thickness_str);
  if (rafter_spacing_in > max_span) {
    throw new SheathingSpecViolation(
      `OSB ${thickness_str} supports rafters up to ${max_span}" o.c., ` +
        `but rafter_spacing_in=${rafter_spacing_in}`,
    );
  }
}
