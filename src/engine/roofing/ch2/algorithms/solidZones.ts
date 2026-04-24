/**
 * ALG-011 — Solid zones on spaced-sheathing roofs.
 *
 * Source: spec §6 ALG-011. Book §2J.
 *
 * ─── What this produces ───────────────────────────────────────
 *
 * When a roof uses spaced sheathing (wood shingles/shakes over
 * 1×4 or 1×6 boards), certain regions of the deck MUST be solid
 * instead:
 *
 *   • Eave band: 12–24 in past the interior wall face (36 on
 *     low-slope). Catches ice-dam meltwater and funnels it into
 *     the eave-protection membrane.
 *   • Ridge band: 18 in each side of the ridge (§2J author rec).
 *     Provides nailing surface for ridge caps + hip caps.
 *   • Gable overhang: solid iff the gable has an open cornice
 *     (exposed rafter tails). Otherwise boards fine.
 *   • Ice-and-water / eave-protection membrane: 36 in minimum
 *     regardless of slope or climate. Extends from fascia up.
 *
 * ─── Configurable eave width ──────────────────────────────────
 *
 * The book allows ANY width in [12, 24] for the normal-slope
 * eave band. The default is the midpoint 18" (ref:
 * `EAVE_SOLID_DEFAULT_IN`). Callers can override via the
 * `eave_solid_override_in` parameter when a jurisdiction or
 * insurance carrier prescribes otherwise.
 *
 * Low-slope roofs (< 4:12) IGNORE the override — the 36" wide
 * band is driven by water-management physics, not stylistic
 * choice. An override passed for a low-slope roof silently takes
 * second place to the physics rule (no throw, no warning — the
 * override would be nonsensical there anyway).
 *
 * ─── When to call this ────────────────────────────────────────
 *
 * Only populate `SolidZones` when `SheathingType` is
 * `'spaced_with_solid_zones'` or `'spaced_over_solid_hybrid'`.
 * `'solid'` roofs have no spaced section and therefore no zones
 * concept — the entire deck is solid. Caller is responsible for
 * checking the sheathing type before invoking.
 *
 * ─── Spec §6 ALG-011 edge cases (implicit — not tabulated) ────
 *
 *   slope | has_open_cornice | override | eave_solid result
 *   ------|------------------|----------|------------------------
 *    6    |       true       |   -      | 18 (default), gable=true
 *    6    |       false      |   -      | 18 (default), gable=false
 *    6    |       false      |   22     | 22, gable=false
 *    3.99 |       false      |   -      | 36 (low-slope override)
 *    3.99 |       false      |   22     | 36 (low-slope wins)
 *    4    |       false      |   -      | 18 (boundary — NOT low-slope)
 *    6    |       false      |   10     | THROWS (10 < min 12)
 *    6    |       false      |   30     | THROWS (30 > max 24)
 */

import type { SolidZones } from '../types';
import {
  EAVE_PROTECTION_MIN_IN,
  EAVE_SOLID_DEFAULT_IN,
  EAVE_SOLID_LOW_SLOPE_IN,
  EAVE_SOLID_MAX_IN,
  EAVE_SOLID_MIN_IN,
  RIDGE_SOLID_EACH_SIDE_IN,
  WOOD_SHINGLE_MIN_SLOPE_RISE_PER_12,
} from '../constants';
import { InvalidGeometry, SheathingSpecViolation } from '../errors';

/**
 * Compute the solid-zone layout for a spaced-sheathing roof.
 *
 * @param slope_rise_per_12        Rise-per-12 ratio. Must be ≥ 0.
 *                                 Used to detect low-slope (< 4:12)
 *                                 for the 36" eave override.
 * @param has_open_cornice_gable   True when the gable has exposed
 *                                 rafter tails — triggers the
 *                                 gable-overhang solid requirement.
 * @param eave_solid_override_in   Optional override for the normal-
 *                                 slope eave band width. Must be in
 *                                 [`EAVE_SOLID_MIN_IN`, `EAVE_SOLID_MAX_IN`]
 *                                 (12–24). Ignored when slope < 4:12.
 *
 * @throws {InvalidGeometry}         negative slope.
 * @throws {SheathingSpecViolation}  override out of [12, 24] on a
 *                                   NORMAL slope.
 */
export function solid_zones_for_spaced_roof(
  slope_rise_per_12: number,
  has_open_cornice_gable: boolean,
  eave_solid_override_in?: number,
): SolidZones {
  if (!Number.isFinite(slope_rise_per_12) || slope_rise_per_12 < 0) {
    throw new InvalidGeometry(
      `slope_rise_per_12 must be ≥ 0 (finite), got ${slope_rise_per_12}`,
    );
  }

  // ─── Eave band width — slope + override interaction ───────
  let eave_solid_in: number;
  if (slope_rise_per_12 < WOOD_SHINGLE_MIN_SLOPE_RISE_PER_12) {
    // Low-slope physics rule: 36" regardless of any override.
    // §2J — low slopes hold more melt water at the eave, so the
    // solid band widens to catch it. Override ignored silently.
    eave_solid_in = EAVE_SOLID_LOW_SLOPE_IN;
  } else if (eave_solid_override_in !== undefined) {
    // Validate override lies in the book's [12, 24] range.
    // Outside the range isn't just "unusual" — it's §2J non-
    // compliant. Throw loudly rather than silently clamping.
    if (
      eave_solid_override_in < EAVE_SOLID_MIN_IN ||
      eave_solid_override_in > EAVE_SOLID_MAX_IN
    ) {
      throw new SheathingSpecViolation(
        `eave_solid_override_in ${eave_solid_override_in}" is outside ` +
          `[${EAVE_SOLID_MIN_IN}", ${EAVE_SOLID_MAX_IN}"] per §2J. ` +
          `Use a value in range or omit the override to accept the ` +
          `${EAVE_SOLID_DEFAULT_IN}" default.`,
      );
    }
    eave_solid_in = eave_solid_override_in;
  } else {
    eave_solid_in = EAVE_SOLID_DEFAULT_IN;
  }

  return {
    eave_solid_in,
    ridge_solid_each_side_in: RIDGE_SOLID_EACH_SIDE_IN,
    gable_overhang_solid: has_open_cornice_gable,
    eave_protection_membrane_min_in: EAVE_PROTECTION_MIN_IN,
  };
}
