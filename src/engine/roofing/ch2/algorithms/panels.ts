/**
 * ALG-003 — APA panel selection from Table 21.
 *
 * Source: spec §6 ALG-003, study packet §2D, §2F (Table 21).
 *
 * Walks the APA panel rows in ascending order and returns the FIRST
 * row that simultaneously satisfies:
 *   (a) rafter spacing fits within the row's max span for the
 *       edge-support configuration in use, AND
 *   (b) the row's rated live-load at that spacing is ≥ the
 *       effective design live load.
 *
 * Covering-specific enforcement:
 *   - BUILT_UP coverings require min thickness ≥ ½".
 *   - BUILT_UP with rafter spacing > 24" and ½" ply is a
 *     `SheathingSpecViolation` regardless of which panel fits.
 *
 * Edge case E-014 (truss 19.2" spacing): rounded UP to the next
 * tabulated spacing (24") with a TODO flag in the migration
 * report. Interpolation is rejected as too clever; rounding up
 * is conservative (heavier panel than strictly required).
 */

import type { CoveringType, PanelSpec } from '../types';
import {
  APA_TABLE_21,
  MAX_RAFTER_SPACING_BUILT_UP_HALF_INCH_PLY_IN,
  MIN_PANEL_SPAN_RATING_UNSANDED,
  MIN_PLYWOOD_THICKNESS_UNDER_BUILT_UP_IN,
} from '../constants';
import { PanelSelectionFailed, SheathingSpecViolation } from '../errors';

/** Pull the roof-span number out of an APA rating string like
 *  "32/16" → 32. The first half is the roof span (in inches);
 *  the second half is the floor span. Ch 2 cares only about the
 *  first half for roof sheathing. */
function roof_span_from_rating(rating: string): number {
  const first = rating.split('/')[0];
  const n = first !== undefined ? Number(first) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Cached minimum-span-rating threshold. Computed once from the
 *  spec constant at module load; rows below this roof-span are
 *  filtered out of the selector because the book mandates a
 *  32/16 minimum for unsanded roof sheathing (§2D). */
const MIN_UNSANDED_ROOF_SPAN = roof_span_from_rating(MIN_PANEL_SPAN_RATING_UNSANDED);

/** Round a potentially non-standard rafter spacing (like 19.2"
 *  truss spacing) UP to the next tabulated APA spacing bin. */
const TABULATED_SPACINGS = [12, 16, 20, 24, 32, 40, 48, 60] as const;

function round_up_to_tabulated_spacing(rafter_spacing_in: number): number {
  for (const s of TABULATED_SPACINGS) {
    if (rafter_spacing_in <= s) return s;
  }
  // Beyond 60" — the largest tabulated bin. Return as-is; the
  // panel selector will fail downstream with a helpful error.
  return rafter_spacing_in;
}

/**
 * Pick the cheapest APA plywood panel that satisfies both the
 * spacing and live-load requirements.
 *
 * @throws {SheathingSpecViolation}  BUILT_UP + spacing > 24".
 * @throws {PanelSelectionFailed}    no row in Table 21 qualifies.
 */
export function select_apa_panel(
  rafter_spacing_in: number,
  effective_live_load_psf: number,
  covering: CoveringType,
  with_edge_support: boolean,
): PanelSpec {
  // BUILT_UP + wide rafter spacing: hard-fail before even walking
  // the table. Per §2D Table 22 footnote — ½" plywood under BUR
  // requires rafters ≤ 24" o.c.
  if (
    covering === 'built_up' &&
    rafter_spacing_in > MAX_RAFTER_SPACING_BUILT_UP_HALF_INCH_PLY_IN
  ) {
    throw new SheathingSpecViolation(
      `built-up roof with ½" plywood requires rafter spacing ≤ ` +
        `${MAX_RAFTER_SPACING_BUILT_UP_HALF_INCH_PLY_IN}", got ${rafter_spacing_in}"`,
    );
  }

  // Normalise non-tabulated spacings (e.g. truss 19.2") up to the
  // next standard. Conservative: heavier panel than strict rounding-down.
  const spacing_for_lookup = round_up_to_tabulated_spacing(rafter_spacing_in);

  for (const row of APA_TABLE_21) {
    // (0) Book minimum for UNSANDED roof sheathing — §2D. Rows
    //     with a roof-span rating below 32 (i.e. 12/0 through
    //     24/16) are too light for structural roof sheathing
    //     regardless of whether the live-load math would approve.
    if (roof_span_from_rating(row.span_rating) < MIN_UNSANDED_ROOF_SPAN) {
      continue;
    }

    const max_span = with_edge_support
      ? row.max_w_edge_support_in
      : row.max_wo_edge_support_in;

    // (a) Row's max span must fit the rafter spacing
    if (spacing_for_lookup > max_span) continue;

    // (b) Row must publish a live-load rating at this exact spacing
    const rated_live = row.live_loads_psf_by_spacing[spacing_for_lookup];
    if (rated_live === undefined) continue;

    // (c) Rated load must be ≥ required
    if (rated_live < effective_live_load_psf) continue;

    // (d) BUILT_UP min-thickness check. Only filters when the
    //     book's 32/16 floor didn't already catch it.
    if (
      covering === 'built_up' &&
      row.min_thick_in < MIN_PLYWOOD_THICKNESS_UNDER_BUILT_UP_IN
    ) {
      continue;
    }

    // First qualifying row wins.
    return {
      material: 'plywood',
      thickness_in: row.min_thick_in,
      span_rating: row.span_rating,
      grade: 'C-D Ext Glue',
    };
  }

  throw new PanelSelectionFailed(
    `no APA panel in Table 21 supports ${rafter_spacing_in}" spacing at ` +
      `${effective_live_load_psf} psf effective live load ` +
      `(edge support=${with_edge_support})`,
  );
}
