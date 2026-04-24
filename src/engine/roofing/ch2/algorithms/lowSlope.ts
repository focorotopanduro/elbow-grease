/**
 * ALG-006 — Low-slope wood shingle/shake build-up layer stack.
 *
 * Source: spec §6 ALG-006. Book §2K.
 *
 * ─── The 10-layer stack ───────────────────────────────────────
 *
 * When a wood-covered roof has slope < 4:12, the book forbids the
 * straightforward spaced-sheathing layout (the felt interlayment
 * sags at low pitch and ponds water). Instead, §2K prescribes a
 * hybrid "spaced-over-solid" build-up:
 *
 *   1. solid sheathing (the deck itself)
 *   2. 36" wide felt underlay membrane
 *   3. hot-mop built-up roof over the felt
 *   4. 15" shake starter course
 *   5. 18" felt overlay between shake courses
 *   6. 2×4 spacers at 24" o.c. (create drainage gaps)
 *   7. 1×4 or 1×6 nailing strips on top of the 2×4 spacers
 *   8. 4" felt overlap between courses
 *   9. 24" handsplit resawn shakes at 10" exposure
 *  10. 2 nails per shake
 *
 * Returned bottom-up: index 0 = solid sheathing, index 9 = top
 * nailing pattern. Callers rendering a section view, BOM list, or
 * work-order staging list walk the array in order.
 *
 * ─── Edge cases (spec §6 ALG-006) ─────────────────────────────
 *
 *   slope_rise_per_12 | behaviour
 *   ------------------|-----------------------------
 *        3:12         | returns stack
 *        4:12         | THROWS (boundary — >= 4 uses ALG-005)
 *        0:12         | returns stack + extreme-slope flag
 *
 * The upper boundary is EXCLUSIVE: slope 4 is NOT low-slope. This
 * matches ALG-001's wood-covering threshold — both use
 * `WOOD_SHINGLE_MIN_SLOPE_RISE_PER_12` and the comparison is
 * `slope < MIN` to trigger the low-slope path.
 */

import type { WarningFlag } from '../types';
import { WOOD_SHINGLE_MIN_SLOPE_RISE_PER_12 } from '../constants';
import { SheathingSpecViolation } from '../errors';

/**
 * Canonical low-slope wood build-up stack. Frozen at module load
 * so callers can hold the reference without worrying about
 * mutation. The strings are snake_case identifiers, not free-form
 * prose — downstream code can match on them for BOM expansion.
 */
const LOW_SLOPE_WOOD_BUILD_UP_STACK: readonly string[] = Object.freeze([
  'solid_sheathing',
  '36in_felt_underlay',
  'hot_mop_built_up',
  '15in_shake_starter_course',
  '18in_felt_overlay_between_courses',
  '2x4_spacers_at_24in_oc',
  '1x4_or_1x6_nailing_strips',
  '4in_felt_overlap_between_courses',
  '24in_handsplit_resawn_shakes_at_10in_exposure',
  '2_nails_per_shake',
] as const);

/**
 * Return the 10-layer build-up stack for a low-slope
 * wood-shingle/shake roof (slope < 4:12).
 *
 * @param slope_rise_per_12  Rise-per-12 ratio. Must be in the
 *                           half-open range [0, 4). Negative slopes
 *                           raise `InvalidGeometry` earlier
 *                           (ALG-001); this function accepts 0 as
 *                           extreme-flat per §2K.
 * @param flags              Optional warning-flag collector. Slope
 *                           of exactly 0 appends an
 *                           `extreme_low_slope_review_ch10_builtup`
 *                           flag — the book's §2K stack is built
 *                           for 1–3:12 range; true flat needs the
 *                           ch10 built-up review.
 *
 * @throws {SheathingSpecViolation} slope ≥ 4:12 (use ALG-005).
 */
export function low_slope_wood_layer_stack(
  slope_rise_per_12: number,
  flags?: WarningFlag[],
): readonly string[] {
  if (slope_rise_per_12 >= WOOD_SHINGLE_MIN_SLOPE_RISE_PER_12) {
    throw new SheathingSpecViolation(
      `low-slope build-up not applicable at ≥${WOOD_SHINGLE_MIN_SLOPE_RISE_PER_12}:12 ` +
        `(got ${slope_rise_per_12}:12). Use the ALG-005 spaced-sheathing layout.`,
    );
  }

  // Extreme-flat warning — §2K's stack is authored for 1–3:12
  // residential sheds + cabin roofs. A true zero-slope deck
  // belongs to the Ch 10 built-up / modified bitumen review
  // track, not the spaced-over-solid wood hybrid.
  if (slope_rise_per_12 === 0 && flags !== undefined) {
    flags.push({
      code: 'extreme_low_slope_review_ch10_builtup',
      severity: 'warning',
      message:
        `Slope 0:12 — §2K build-up stack is authored for 1–3:12 range. ` +
        `Verify drainage + consider switching to a Ch 10 built-up ` +
        `roofing assembly.`,
      remediation:
        'Review with the roofing spec committee before committing to this BOM.',
    });
  }

  return LOW_SLOPE_WOOD_BUILD_UP_STACK;
}

/** Exposed for tests and for consumers that need the canonical
 *  list without a slope argument (e.g. docs / BOM viewer). */
export { LOW_SLOPE_WOOD_BUILD_UP_STACK };
