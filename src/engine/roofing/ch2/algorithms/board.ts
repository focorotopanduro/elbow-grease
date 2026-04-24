/**
 * ALG-004 — Board sheathing nail count.
 *
 * Source: spec §6 ALG-004. Book §2C.
 *
 * ─── Rule ──────────────────────────────────────────────────────
 *
 * For solid board sheathing (1×N tongue-and-groove, shiplap, or
 * square-edged planks), the face-nail count per rafter depends on
 * board width:
 *
 *     nominal width ≤ 8"  →  2 nails per rafter (typical 1×4, 1×6, 1×8)
 *     nominal width > 8"  →  3 nails per rafter (1×10, 1×12)
 *
 * Boards are face-nailed with 8d common per §2C; that detail is
 * carried in `BOARD_FACE_NAIL_SIZE` constant — this function only
 * returns the COUNT. The nail-size selection is ALG-008's
 * responsibility.
 *
 * ─── Book recommendation ───────────────────────────────────────
 *
 * §2C prefers 1×6 max for board sheathing. Wider boards (1×8 and
 * up) are permitted but the author recommends against them — wide
 * boards shrink more across the grain, opening gaps between
 * boards that can buckle the underlayment. The function exposes
 * an optional `flags` array; when provided, the function appends
 * a `board_wider_than_recommended` info flag for widths > 6.
 *
 * ─── Spec §6 ALG-004 edge-case table ──────────────────────────
 *
 *   # | width | expected
 *   --|-------|---------
 *   1 |   4   |   2
 *   2 |   6   |   2
 *   3 |   8   |   2  ← boundary (≤ 8 path)
 *   4 |  10   |   3
 *   5 |  12   |   3
 *   6 | ≤ 0   |   throws InvalidGeometry
 */

import type { WarningFlag } from '../types';
import {
  BOARD_NAILS_PER_RAFTER_OVER_1X8,
  BOARD_NAILS_PER_RAFTER_UP_TO_1X8,
  MAX_BOARD_NOMINAL_WIDTH_RECOMMENDED_IN,
} from '../constants';
import { InvalidGeometry } from '../errors';

/**
 * Return the book-prescribed number of face nails per rafter for
 * a given nominal board width.
 *
 * @param board_width_nominal_in  Nominal width in inches (integer).
 *                                1×6 → pass 6; 1×10 → pass 10.
 *                                Must be > 0.
 * @param flags                   Optional warning-flag collector.
 *                                If provided, the function appends
 *                                `board_wider_than_recommended` for
 *                                widths > 6" (book recommends 1×6 max).
 *
 * @throws {InvalidGeometry} `board_width_nominal_in` ≤ 0.
 */
export function nails_per_rafter_for_board(
  board_width_nominal_in: number,
  flags?: WarningFlag[],
): number {
  if (!Number.isFinite(board_width_nominal_in) || board_width_nominal_in <= 0) {
    throw new InvalidGeometry(
      `board_width_nominal_in must be > 0 (finite), got ${board_width_nominal_in}`,
    );
  }

  // Author recommendation (§2C): prefer 1×6 max. Surface an info
  // flag when the caller passes something wider. Not an error —
  // wider boards ARE permitted, just not preferred.
  if (
    flags !== undefined &&
    board_width_nominal_in > MAX_BOARD_NOMINAL_WIDTH_RECOMMENDED_IN
  ) {
    flags.push({
      code: 'board_wider_than_recommended',
      severity: 'info',
      message:
        `Board nominal width ${board_width_nominal_in}" exceeds the ` +
        `${MAX_BOARD_NOMINAL_WIDTH_RECOMMENDED_IN}" book-recommended max ` +
        `(§2C). Wider boards may open cross-grain shrinkage gaps.`,
      remediation:
        'Consider 1×6 or narrower if permitted by available stock; ' +
        'otherwise proceed — wider boards are permitted, just not preferred.',
    });
  }

  return board_width_nominal_in <= 8
    ? BOARD_NAILS_PER_RAFTER_UP_TO_1X8
    : BOARD_NAILS_PER_RAFTER_OVER_1X8;
}
