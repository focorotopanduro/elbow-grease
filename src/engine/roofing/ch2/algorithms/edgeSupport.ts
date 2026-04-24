/**
 * ALG-007 — Edge support requirement for panel sheathing.
 *
 * Source: spec §6 ALG-007. Book §2D (+ Table 22 footnote a for
 * the BUILT_UP @ 48" doubled-clip rule).
 *
 * ─── Decision tree ─────────────────────────────────────────────
 *
 * 1. If the panel has built-in tongue-and-groove edges:
 *    return { method: 'tongue_and_groove', clips_per_span: 0,
 *             reason: 'panel_tongue_and_groove' }.
 *    (No aftermarket edge support needed — the panel itself
 *    carries the edge load between rafters.)
 *
 * 2. If `rafter_spacing_in` ≤ `panel.max_span_without_edge_support_in`:
 *    return { method: null, clips_per_span: 0,
 *             reason: 'within_max_wo_edge' }.
 *    (Panel naturally spans the rafter spacing without help.)
 *
 * 3. Edge support IS required. Default method: `panel_edge_clips`
 *    (cheapest + fastest to install). Quantity: 1 per span.
 *    - Exception: BUILT_UP covering at 48" rafter spacing → 2
 *      clips per span per §2D Table 22 footnote a.
 *
 * Return type is `EdgeSupportRequirement` (see types.ts). Wider
 * than the spec's `Optional[EdgeSupportMethod]` because the
 * "2 clips per span" rule is a quantity, not a different method.
 *
 * ─── Alternative method: 2×4 blocking ─────────────────────────
 *
 * The book allows `'blocking_2x4'` as an alternative to clips. This
 * function always prefers clips (cheaper + faster); callers that
 * want blocking substitute the method string after-the-fact or
 * drive the decision through a RateSet preference in Phase 5.
 *
 * ─── Spec §6 ALG-007 edge-case table ──────────────────────────
 *
 *   # | thickness panel | max_wo_edge | spacing | covering  | expected
 *   --|-----------------|-------------|---------|-----------|-----------------------
 *   1 | 15/32 (32/16)   |     28      |   24    | asphalt   | method=null   (24 ≤ 28)
 *   2 | 15/32 (32/16)   |     28      |   32    | asphalt   | panel_edge_clips × 1
 *   3 | 23/32 (48/24)   |     36      |   48    | built_up  | panel_edge_clips × 2 !
 *   4 | T&G panel       |  (any)      | (any)   | (any)     | tongue_and_groove × 0
 *   5 | panel w/o max_wo| undefined   | (any)   | (any)     | conservative: require clips
 */

import type {
  BoardEdgeProfile,
  CoveringType,
  EdgeSupportRequirement,
  PanelSpec,
} from '../types';

/** Rafter spacing at which BUILT_UP gets the 2-clip doubling.
 *  Table 22 footnote a. Keep local until we find another use. */
const BUILT_UP_DOUBLE_CLIP_SPACING_IN = 48;

/**
 * Decide whether edge support is required for the given panel +
 * rafter spacing + covering + (optionally) the board profile in
 * use if this is a board-sheathing hybrid.
 *
 * @param panel                 Panel returned by ALG-003, or a
 *                              custom panel. Reads
 *                              `max_span_without_edge_support_in`
 *                              + `has_tongue_and_groove_edges`.
 * @param rafter_spacing_in     Spacing (inches). Positive only.
 * @param covering              Covering type. Used to detect the
 *                              BUILT_UP @ 48" doubled-clip rule.
 * @param board_profile_in_use  Present when the panel is over
 *                              board sheathing (not plywood). T&G
 *                              profile implies edge support is
 *                              already covered by the boards
 *                              themselves. Pass `null` for plain
 *                              plywood-over-rafters installs.
 *
 * @returns EdgeSupportRequirement — never throws for valid inputs.
 *          Callers that need blocking instead of clips can remap
 *          `method: 'panel_edge_clips'` → `'blocking_2x4'` after
 *          the fact (quantity stays the same).
 */
export function edge_support_required(
  panel: PanelSpec,
  rafter_spacing_in: number,
  covering: CoveringType,
  board_profile_in_use: BoardEdgeProfile | null = null,
): EdgeSupportRequirement {
  // ─── 1. Panel has T&G edges → built-in edge support ────────
  if (panel.has_tongue_and_groove_edges === true) {
    return {
      method: 'tongue_and_groove',
      clips_per_span: 0,
      reason: 'panel_tongue_and_groove',
    };
  }

  // ─── 1b. Board-underlayment T&G treats as T&G too ──────────
  // When boards beneath the panel are T&G themselves, the boards
  // carry the edge support load. This covers the hybrid case
  // (spaced-over-solid wood build-up rafters through boards).
  if (board_profile_in_use === 'tongue_and_groove') {
    return {
      method: 'tongue_and_groove',
      clips_per_span: 0,
      reason: 'panel_tongue_and_groove',
    };
  }

  // ─── 2. Within the panel's max-without-edge-support span ──
  // If we don't know the panel's max_wo value (custom panel without
  // an APA row), default to "require clips" — conservative.
  const max_wo = panel.max_span_without_edge_support_in;
  if (max_wo !== undefined && rafter_spacing_in <= max_wo) {
    return {
      method: null,
      clips_per_span: 0,
      reason: 'within_max_wo_edge',
    };
  }

  // ─── 3. Edge support required ─────────────────────────────
  // BUILT_UP at exactly 48" o.c. → 2 clips per span (§2D Table 22
  // footnote a). All other cases: 1 clip per span default.
  if (
    covering === 'built_up' &&
    rafter_spacing_in >= BUILT_UP_DOUBLE_CLIP_SPACING_IN
  ) {
    return {
      method: 'panel_edge_clips',
      clips_per_span: 2,
      reason: 'built_up_48in_double_clips',
    };
  }

  return {
    method: 'panel_edge_clips',
    clips_per_span: 1,
    reason: 'spacing_exceeds_wo_edge',
  };
}
