/**
 * ALG-016 — Frame load capacity flag for reroofs.
 *
 * Source: spec §6 ALG-016. Book §1B, §2E.
 *
 * ─── Why this flag exists ─────────────────────────────────────
 *
 * On a reroof job, the estimator is responsible for checking that
 * the existing frame can carry the new covering's dead load. The
 * book (§1B + §2E) treats this as a "structural review required"
 * trigger — not a hard stop, because the GC or structural engineer
 * will do the actual math, but a must-not-miss flag on the bid.
 *
 * The flag fires when either:
 *
 *   (a) The existing covering's weight is UNKNOWN. We can't prove
 *       the new load doesn't exceed, so the conservative answer is
 *       "get it checked."
 *   (b) The new weight STRICTLY EXCEEDS the existing weight. A
 *       heavier covering means a heavier load, which means the
 *       frame may need reinforcement.
 *
 * Neither (a) nor (b) applies on new-construction (non-reroof) jobs
 * — the frame was designed with the specified covering in mind.
 *
 * ─── Implicit edge cases ──────────────────────────────────────
 *
 *   is_reroof | existing | new   | result
 *   ----------|----------|-------|------------------------------
 *    false    | any      | any   | null (new construction — no flag)
 *    true     | null     | any   | flag (unknown → conservative)
 *    true     | 5.0      | 3.0   | null (lighter — frame safe)
 *    true     | 5.0      | 5.0   | null (equal — no load increase)
 *    true     | 5.0      | 5.001 | flag (strictly greater)
 *    true     | 5.0      | 6.0   | flag (heavier covering)
 *
 * ─── Pure function ────────────────────────────────────────────
 *
 * No side effects, no I/O. Returns a single optional `WarningFlag`
 * rather than appending to a shared array — the algorithm fires at
 * most ONE flag per call. Callers pushing to a larger flag
 * collector write:
 *
 *   const flag = flag_frame_load_check_needed(...);
 *   if (flag !== null) flags.push(flag);
 */

import type { WarningFlag } from '../types';

/**
 * Determine whether a reroof job should surface a frame-load-
 * check flag on the bid.
 *
 * @param new_weight_psf       Dead load of the new covering in psf.
 *                             Must be a finite non-negative number.
 * @param existing_weight_psf  Dead load of the existing covering
 *                             in psf. `null` when unknown — this
 *                             is the conservative "flag required"
 *                             case per §1B.
 * @param is_reroof            True when the job is a reroof over
 *                             existing covering. New-construction
 *                             jobs always return null (the frame
 *                             was designed for the specified
 *                             covering up-front).
 *
 * @returns A `WarningFlag` with code `'frame_load_check_required'`
 *          when the conditions above fire, otherwise `null`.
 */
export function flag_frame_load_check_needed(
  new_weight_psf: number,
  existing_weight_psf: number | null,
  is_reroof: boolean,
): WarningFlag | null {
  // Non-reroof: the design process already accounted for the
  // covering. No flag regardless of weight comparison.
  if (!is_reroof) return null;

  // Reroof WITH unknown existing weight — conservative flag.
  // We can't prove the new load is equal or lighter, so we
  // ask for a structural review.
  if (existing_weight_psf === null) {
    return {
      code: 'frame_load_check_required',
      severity: 'warning',
      message:
        `Reroof — existing covering weight is unknown. Frame load ` +
        `capacity review required before committing to the new ` +
        `covering (§1B).`,
      remediation:
        'Get existing covering weight from as-builts or site survey, ' +
        'or have a structural engineer review frame capacity.',
    };
  }

  // Reroof with KNOWN existing weight: fire only when new is
  // STRICTLY heavier. Equal-weight or lighter reroofs are safe.
  if (new_weight_psf > existing_weight_psf) {
    return {
      code: 'frame_load_check_required',
      severity: 'warning',
      message:
        `Reroof — new covering (${new_weight_psf.toFixed(2)} psf) is ` +
        `heavier than existing (${existing_weight_psf.toFixed(2)} psf). ` +
        `Frame load capacity review required before committing (§2E).`,
      remediation:
        'Have a structural engineer confirm the existing frame can ' +
        'carry the increased dead load, or specify a lighter covering.',
    };
  }

  return null;
}
