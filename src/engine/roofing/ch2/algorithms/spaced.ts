/**
 * ALG-005 — Spaced sheathing layout for wood shingles/shakes.
 *
 * Source: spec §6 ALG-005. Book §2I.
 *
 * ─── Two materials, three rules ────────────────────────────────
 *
 * Spaced sheathing appears under WOOD shingles and WOOD shakes.
 * Other coverings are rejected — they require solid sheathing
 * (enforced by ALG-001 separately; this function double-guards).
 *
 * Rules:
 *
 *   SHAKES (always):
 *     Board: 1×6 (nominal). Center-to-center spacing =
 *     weather_exposure_in. Exposure CAPPED at 2.5" (§2I) —
 *     exceeding this lets the interlayment felt sag into the gap
 *     between boards and eventually tear. Cap violation raises
 *     `SheathingSpecViolation`.
 *
 *   SHINGLES Method 1 (`1x4_one_per_course`):
 *     Board: 1×4. Center spacing = weather exposure. One shingle
 *     course lines up with each board.
 *
 *   SHINGLES Method 2 (`1x6_two_per_course`):
 *     Board: 1×6. Behaviour depends on exposure:
 *       - exposure ≤ 5.5": two shingle courses fit on each board.
 *         Layout is "two-per-course" (discriminant: two_per_course).
 *       - exposure > 5.5": degrades to single-per-course with
 *         center spacing = exposure. Discriminant: single_per_course.
 *
 * Why this function doesn't return plumbing-type `(board, spacing)`:
 * see `SpacedBoardLayout` discriminated-union doc in types.ts.
 *
 * ─── Spec §6 ALG-005 edge-case table ──────────────────────────
 *
 *   # | covering      | exposure | method              | expected
 *   --|---------------|----------|---------------------|--------------------------
 *   1 | wood_shake    |   2.5    | (ignored)           | kind=single, 1×6, 2.5" ✓
 *   2 | wood_shake    |   2.6    | (ignored)           | THROWS (interlayment cap)
 *   3 | wood_shingle  |   5.5    | 1x4_one_per_course  | kind=single, 1×4, 5.5"
 *   4 | wood_shingle  |   5.5    | 1x6_two_per_course  | kind=two_per_course, 1×6
 *   5 | wood_shingle  |   7.5    | 1x6_two_per_course  | kind=single, 1×6, 7.5"
 *   6 | asphalt       |   any    | any                 | THROWS (not a wood covering)
 */

import type {
  CoveringType,
  ShingleSpacingMethod,
  SpacedBoardLayout,
} from '../types';
import { SHAKE_SPACING_MAX_IN } from '../constants';
import { InvalidGeometry, SheathingSpecViolation } from '../errors';

/**
 * Pick the board-layout pattern for a wood-sheathed roof.
 *
 * @param covering             Wood coverings only (`wood_shake`,
 *                             `wood_shingle`). Anything else raises
 *                             `SheathingSpecViolation`.
 * @param weather_exposure_in  Per-course shingle/shake exposure.
 *                             Must be > 0. Drives both the shake
 *                             interlayment cap check and the
 *                             Method-2 branch on exposure ≤ 5.5".
 * @param method               Shingle layout method. Default
 *                             `'1x4_one_per_course'` matches the
 *                             Python spec's default argument.
 *                             IGNORED when covering is `wood_shake`.
 *
 * @throws {InvalidGeometry}         exposure ≤ 0.
 * @throws {SheathingSpecViolation}  shake exposure > 2.5", or
 *                                   covering is not a wood covering.
 */
export function spaced_sheathing_layout(
  covering: CoveringType,
  weather_exposure_in: number,
  method: ShingleSpacingMethod = '1x4_one_per_course',
): SpacedBoardLayout {
  // ─── Geometry guard ───────────────────────────────────────
  if (!Number.isFinite(weather_exposure_in) || weather_exposure_in <= 0) {
    throw new InvalidGeometry(
      `weather_exposure_in must be > 0 (finite), got ${weather_exposure_in}`,
    );
  }

  // ─── Shakes ───────────────────────────────────────────────
  if (covering === 'wood_shake') {
    // §2I interlayment cap — shakes ride on 1×6 boards; exceeding
    // 2.5" center spacing lets the interlayment felt sag.
    if (weather_exposure_in > SHAKE_SPACING_MAX_IN) {
      throw new SheathingSpecViolation(
        `shake spacing ${weather_exposure_in}" exceeds ${SHAKE_SPACING_MAX_IN}" ` +
          `max per §2I — interlayment felt will sag between boards. ` +
          `Reduce weather exposure or switch to solid sheathing.`,
      );
    }
    return {
      kind: 'single_per_course',
      board_nominal_in: 6,
      center_spacing_in: weather_exposure_in,
    };
  }

  // ─── Shingles ─────────────────────────────────────────────
  if (covering === 'wood_shingle') {
    if (method === '1x4_one_per_course') {
      return {
        kind: 'single_per_course',
        board_nominal_in: 4,
        center_spacing_in: weather_exposure_in,
      };
    }

    // Method 2: 1×6 boards. Exposure ≤ 5.5 packs two courses on
    // each board (two_per_course layout). Exposure > 5.5 degrades
    // to single_per_course on 1×6.
    if (weather_exposure_in <= 5.5) {
      return {
        kind: 'two_per_course',
        board_nominal_in: 6,
        exposure_in: weather_exposure_in,
      };
    }
    return {
      kind: 'single_per_course',
      board_nominal_in: 6,
      center_spacing_in: weather_exposure_in,
    };
  }

  // ─── Not a wood covering ──────────────────────────────────
  throw new SheathingSpecViolation(
    `spaced sheathing is wood-only. Covering '${covering}' must use solid ` +
      `sheathing per §2A. Call determine_sheathing_type first.`,
  );
}
