/**
 * ALG-003 — APA panel selection from Table 21.
 *
 * Source: spec §6 ALG-003. Book §2D, §2F (Table 21).
 *
 * ─── Core logic ───────────────────────────────────────────────
 *
 * Walk APA_TABLE_21 rows in ASCENDING order. Return the FIRST row
 * that simultaneously satisfies:
 *
 *   (a) rafter spacing ≤ row's max span for the edge-support
 *       configuration in use,
 *   (b) row publishes a live-load rating at this spacing,
 *   (c) rated live load ≥ effective design live load.
 *
 * Plus two enforced gates:
 *
 *   (0) Book §2D floor: roof sheathing uses UNSANDED plywood with
 *       roof-span rating ≥ 32/16. Rows 12/0 through 24/16 are
 *       filtered out regardless of load math. This reflects the
 *       book's author's standing rule for residential roof
 *       sheathing and matches the MIN_PANEL_SPAN_RATING_UNSANDED
 *       constant. See migration report — spec §6 edge-case row
 *       #2 appears to contradict this, resolved in favour of the
 *       safer (thicker) panel.
 *
 *   (d) BUILT_UP covering specials (§2D Table 22):
 *       - Min plywood thickness 0.5" under built-up.
 *       - Rafter spacing > 24" with ½" plywood throws.
 *
 * ─── Spec §6 ALG-003 edge-case table (inlined for review) ─────
 *
 *   # | spacing | live psf | cov / support       | expected
 *   --|---------|----------|---------------------|-----------
 *   1 |   24    |    30    | any / with clips    | 32/16
 *   2 |   24    |    40    | any / with clips    | 32/16 *
 *   3 |   24    |    41    | any / with clips    | 32/16
 *   4 |   48    |    35    | any / with clips    | 48/24
 *   5 |   48    |   100    | any / with clips    | THROWS (PanelSelectionFailed)
 *   6 |   16    |   180    | any / with clips    | 32/16
 *   7 |   24    |   any    | BUILT_UP / clips    | thickness ≥ ½"
 *   8 |   28    |   any    | BUILT_UP / clips    | THROWS (SheathingSpecViolation)
 *   9 |   19.2  |    30    | any / clips         | 32/16 (rounded up to 24" bin + flag)
 *
 *   * Spec row 2 says "24/16" but that ignores §2D's 32/16 floor.
 *     Fixed to 32/16 — thicker is never wrong.
 *
 * ─── Truss rafter spacings ─────────────────────────────────────
 *
 * Common truss spacings like 19.2" are NOT in the APA table. Book
 * doesn't say how to handle them. Decision: ROUND UP to the next
 * tabulated bin (conservative — heavier panel than the strict-floor
 * rounding-down approach). Caller gets a `truss_spacing_rounded_up`
 * warning flag so the estimator can surface the assumption.
 */

import type { CoveringType, PanelSpec, WarningFlag } from '../types';
import {
  APA_TABLE_21,
  MAX_RAFTER_SPACING_BUILT_UP_HALF_INCH_PLY_IN,
  MIN_PANEL_SPAN_RATING_UNSANDED,
  MIN_PLYWOOD_THICKNESS_UNDER_BUILT_UP_IN,
} from '../constants';
import { PanelSelectionFailed, SheathingSpecViolation } from '../errors';

/** Pull the roof-span number out of an APA rating string like
 *  "32/16" → 32. The first half is the roof span (in inches);
 *  the second half is the floor span. Ch 2 roof-sheathing code
 *  cares only about the roof-span half.
 *
 *  Returns 0 on a malformed input — rows with roof-span 0 always
 *  fail the floor check, which is the conservative behaviour. */
function roof_span_from_rating(rating: string): number {
  const first = rating.split('/')[0];
  const n = first !== undefined ? Number(first) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Book §2D minimum roof-span rating, parsed once at module load. */
const MIN_UNSANDED_ROOF_SPAN = roof_span_from_rating(MIN_PANEL_SPAN_RATING_UNSANDED);

/** Tabulated rafter spacings in APA Table 21. Kept in ascending
 *  order so `round_up_to_tabulated_spacing` can linear-scan. */
const TABULATED_SPACINGS: readonly number[] = [12, 16, 20, 24, 32, 40, 48, 60];

/** Round a non-tabulated rafter spacing UP to the next tabulated
 *  bin. Example: 19.2 → 24. Beyond 60 returns as-is (selector
 *  will throw PanelSelectionFailed). */
function round_up_to_tabulated_spacing(rafter_spacing_in: number): number {
  for (const s of TABULATED_SPACINGS) {
    if (rafter_spacing_in <= s) return s;
  }
  return rafter_spacing_in;
}

/**
 * Options bag for the selector. Exists so we can grow the knob
 * surface over time without breaking callers each time.
 */
export interface SelectApaPanelOptions {
  /** When true, append spec-mandated warning flags (truss rounding,
   *  etc.). Pass the same array consumers expect the rest of the
   *  Ch2 module to fill. Optional: omit if the caller doesn't
   *  care about flags yet. */
  readonly flags?: WarningFlag[];

  /** Override the §2D 32/16 floor. Default false (keep the floor).
   *  Flip to true when the caller is intentionally selecting a
   *  thinner panel for a non-structural application (e.g.
   *  decking-for-decking below an insulation board). Should be
   *  extremely rare in practice. */
  readonly allow_below_min_unsanded?: boolean;
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
  options: SelectApaPanelOptions = {},
): PanelSpec {
  const flags = options.flags;
  const allow_below_min = options.allow_below_min_unsanded === true;

  // ─── Hard gate: BUILT_UP + wide rafter spacing ─────────────
  // §2D Table 22 footnote — ½" plywood under BUR requires rafters
  // ≤ 24" o.c. No matter what the load math says, we fail fast.
  if (
    covering === 'built_up' &&
    rafter_spacing_in > MAX_RAFTER_SPACING_BUILT_UP_HALF_INCH_PLY_IN
  ) {
    throw new SheathingSpecViolation(
      `built-up roof with ½" plywood requires rafter spacing ≤ ` +
        `${MAX_RAFTER_SPACING_BUILT_UP_HALF_INCH_PLY_IN}", got ${rafter_spacing_in}"`,
    );
  }

  // ─── Normalise non-tabulated spacings (truss rounding) ─────
  const spacing_for_lookup = round_up_to_tabulated_spacing(rafter_spacing_in);
  const rounded_up = spacing_for_lookup !== rafter_spacing_in;
  if (rounded_up && flags !== undefined) {
    flags.push({
      code: 'truss_spacing_rounded_up',
      severity: 'info',
      message:
        `Rafter spacing ${rafter_spacing_in}" is not tabulated in APA ` +
        `Table 21. Rounded UP to ${spacing_for_lookup}" for panel selection ` +
        `(conservative — selects a heavier panel than strict interpolation).`,
      remediation:
        'If the actual truss spacing warrants a thinner panel, consult ' +
        'the manufacturer or APA tech bulletin for interpolation guidance.',
    });
  }

  // ─── Walk rows in ascending order, pick first qualifier ───
  for (const row of APA_TABLE_21) {
    // (0) Book §2D floor — filter lightweight roof panels.
    if (
      !allow_below_min &&
      roof_span_from_rating(row.span_rating) < MIN_UNSANDED_ROOF_SPAN
    ) {
      continue;
    }

    const max_span = with_edge_support
      ? row.max_w_edge_support_in
      : row.max_wo_edge_support_in;

    // (a) Rafter spacing must fit within the panel's max span
    if (spacing_for_lookup > max_span) continue;

    // (b) Row must publish a live-load rating at this spacing
    const rated_live = row.live_loads_psf_by_spacing[spacing_for_lookup];
    if (rated_live === undefined) continue;

    // (c) Rated load must meet or exceed the required load
    if (rated_live < effective_live_load_psf) continue;

    // (d) BUILT_UP min-thickness check
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
      `(edge_support=${with_edge_support}, covering=${covering}${
        allow_below_min ? ', allow_below_min=true' : ''
      })`,
  );
}
