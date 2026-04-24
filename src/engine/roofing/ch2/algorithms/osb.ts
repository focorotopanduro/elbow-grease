/**
 * ALG-013 — OSB / waferboard span validation.
 *
 * Source: spec §6 ALG-013. Book §2G.
 *
 * ─── Two materials, one table, different rules ────────────────
 *
 * The book's §2G tabulates max rafter spacing for a shared "OSB /
 * waferboard" panel thickness list:
 *
 *     3/8  → 16" o.c. max
 *     7/16 → 24" o.c. max
 *     1/2  → 24" o.c. max
 *
 * AND separately declares: OSB minimum thickness is 15/32".
 *
 * That creates a split between the two panel materials:
 *
 *     OSB       — min thickness 15/32. Only 1/2 from the table
 *                 qualifies (3/8 and 7/16 are BELOW the min).
 *     WAFERBOARD — no min-thickness rule in the book; all three
 *                 tabulated thicknesses are valid.
 *
 * This module exposes BOTH validators so the caller can pick the
 * right one based on the material they're actually installing.
 * A combined `validate_osb_spec` exists for the common case.
 *
 * ─── Spec §6 ALG-013 edge cases (partial — not tabulated in spec) ─
 *
 *   thickness | spacing | material    | expected
 *   ----------|---------|-------------|---------
 *     '1/2'   |   24    | OSB         | passes
 *     '1/2'   |   16    | OSB         | passes
 *     '7/16'  |   16    | OSB         | throws (below 15/32 min)
 *     '7/16'  |   16    | WAFERBOARD  | passes
 *     '3/8'   |   16    | OSB         | throws (below min)
 *     '3/8'   |   16    | WAFERBOARD  | passes
 *     '3/8'   |   24    | WAFERBOARD  | throws (3/8 max is 16")
 *     '15/32' |   24    | OSB         | throws (not in span table)
 *     'banana'| any     | either      | throws (malformed)
 */

import { OSB_MIN_THICKNESS_IN, WAFERBOARD_MAX_SPAN_IN } from '../constants';
import { SheathingSpecViolation } from '../errors';

/**
 * Max rafter spacing allowed for a given tabulated panel thickness.
 *
 * This is the raw §2G table lookup. Works for both OSB and
 * WAFERBOARD — the table is shared. Material-specific minimums
 * (OSB 15/32) are enforced by the dedicated validators below, not
 * here.
 *
 * @param thickness_str  One of '3/8', '7/16', '1/2' (case-sensitive).
 * @throws {SheathingSpecViolation} thickness isn't a key in the table.
 */
export function osb_max_span_for_thickness(thickness_str: string): number {
  const span = WAFERBOARD_MAX_SPAN_IN[thickness_str];
  if (span === undefined) {
    throw new SheathingSpecViolation(
      `Panel thickness '${thickness_str}' not tabulated in §2G. ` +
        `Valid: ${Object.keys(WAFERBOARD_MAX_SPAN_IN).join(', ')}`,
    );
  }
  return span;
}

/**
 * Convert an OSB fractional thickness string to a decimal number.
 *
 * Accepts both "N/M" fractions and bare decimals. Throws on any
 * other format. The per-character trim matters — some datasheets
 * emit "15 / 32" with spaces around the slash.
 *
 * @throws {SheathingSpecViolation} malformed input.
 */
export function parse_fractional_thickness_in(thickness_str: string): number {
  // "N/M" form — most common in the spec + constant tables
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
        `malformed fractional thickness '${thickness_str}' — ` +
          `expected N/M with non-zero denominator.`,
      );
    }
    return num / den;
  }
  // Bare decimal fallback — less common but occasionally used
  const asFloat = Number(thickness_str);
  if (!Number.isFinite(asFloat)) {
    throw new SheathingSpecViolation(
      `malformed thickness '${thickness_str}' — not a number or N/M fraction`,
    );
  }
  return asFloat;
}

/**
 * Pure boolean check — does a panel thickness meet the OSB-specific
 * absolute minimum of 15/32"?
 *
 * Separated from the full validator so callers can test the rule
 * without catching an exception. When the caller wants enforcement,
 * use `validate_osb_panel_spec` instead.
 */
export function osb_meets_min_thickness(thickness_in: number): boolean {
  return thickness_in >= OSB_MIN_THICKNESS_IN;
}

/**
 * Full validation for an OSB panel installation.
 *
 * Enforces BOTH rules from §2G:
 *   1. Thickness ≥ 15/32" (OSB-specific absolute minimum)
 *   2. Rafter spacing ≤ the tabulated max for that thickness
 *
 * Failure order: min-thickness fires first (it's the universal
 * OSB rule), then span. Tighter error messages per failure mode
 * so callers can distinguish and present the right remediation.
 *
 * @throws {SheathingSpecViolation} either rule violated.
 */
export function validate_osb_panel_spec(
  thickness_str: string,
  rafter_spacing_in: number,
): void {
  const thickness_in = parse_fractional_thickness_in(thickness_str);

  if (!osb_meets_min_thickness(thickness_in)) {
    throw new SheathingSpecViolation(
      `OSB thickness ${thickness_str} (${thickness_in.toFixed(4)}") is ` +
        `below the ${OSB_MIN_THICKNESS_IN.toFixed(4)}" (15/32) minimum per §2G. ` +
        `OSB panels thinner than 15/32 are not permitted for roof sheathing.`,
    );
  }

  const max_span = osb_max_span_for_thickness(thickness_str);
  if (rafter_spacing_in > max_span) {
    throw new SheathingSpecViolation(
      `OSB ${thickness_str} supports rafters up to ${max_span}" o.c. per §2G, ` +
        `but rafter_spacing_in=${rafter_spacing_in}. ` +
        `Either reduce rafter spacing or upgrade panel thickness.`,
    );
  }
}

/**
 * Full validation for a WAFERBOARD panel installation.
 *
 * Waferboard has NO explicit minimum-thickness rule in the book —
 * just the span table. Don't confuse with OSB's 15/32 minimum.
 *
 * @throws {SheathingSpecViolation} unknown thickness or span exceeded.
 */
export function validate_waferboard_panel_spec(
  thickness_str: string,
  rafter_spacing_in: number,
): void {
  const max_span = osb_max_span_for_thickness(thickness_str);
  if (rafter_spacing_in > max_span) {
    throw new SheathingSpecViolation(
      `Waferboard ${thickness_str} supports rafters up to ${max_span}" o.c. ` +
        `per §2G, but rafter_spacing_in=${rafter_spacing_in}.`,
    );
  }
}

/**
 * Back-compat alias for the OSB-strict validator. The original
 * spec signature was `validate_osb_spec` without material
 * disambiguation; this alias keeps older callers working while
 * the code base migrates to the explicit `validate_osb_panel_spec`
 * (OSB) and `validate_waferboard_panel_spec` (waferboard) pair.
 *
 * @deprecated Prefer `validate_osb_panel_spec` for OSB specifically,
 *             or `validate_waferboard_panel_spec` for waferboard.
 */
export const validate_osb_spec = validate_osb_panel_spec;
