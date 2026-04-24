/**
 * Chapter 2 constants — one source of truth for every numeric
 * threshold in the sheathing / decking / loading ruleset.
 *
 * Modifying a value requires updating:
 *   (a) the citation in this file
 *   (b) the corresponding test in `__tests__/`
 *   (c) the study packet source section
 *
 * Port of Python spec §4. All constants named identically to the
 * Python original so code reviews can cross-reference.
 *
 * Source citation convention: `// §2X` — cross-refs the study packet
 * section. When a rule is enforced in an algorithm, that function
 * should also carry a `// per Ch. 2 §2X` comment.
 */

// ─── Load rules — §2E ──────────────────────────────────────────

export const DEAD_LOAD_BASELINE_PSF = 10.0;
export const LIVE_LOAD_CODE_MIN_PSF = 30.0;
/** Max deflection = span / 240. Used by downstream deflection
 *  checks (not strictly Ch 2 but referenced for panel span logic). */
export const DEFLECTION_RATIO = 240;

/** Component weights in psf, keyed by short identifier. Caller
 *  looks up a deck + underlayment here, then adds the covering's
 *  own `weight_psf` to get total dead load. */
export const WEIGHT_PSF: Readonly<Record<string, number>> = {
  wood_deck:          3.0,
  felt_15lb:          0.15,
  felt_30lb:          0.30,
  roll_roofing_90lb:  0.9,
  asphalt_shingle:    2.0,
  fiberglass_shingle: 2.0,
  tile_clay:          16.0,
  tile_concrete:      10.0,    // verify per product datasheet
  slate:              10.0,    // verify per product datasheet
  metal_panel:        1.5,     // verify per product datasheet
  wood_shake:         3.0,
};

// ─── Panel specs — §2D ─────────────────────────────────────────

/** Plywood minimum thickness when the covering is built-up roof. */
export const MIN_PLYWOOD_THICKNESS_UNDER_BUILT_UP_IN = 0.5;
/** Max rafter spacing when using ½" plywood under built-up. */
export const MAX_RAFTER_SPACING_BUILT_UP_HALF_INCH_PLY_IN = 24;

export const MIN_PANEL_SPAN_RATING_UNSANDED = '32/16';
export const MIN_PANEL_SPAN_RATING_SANDED   = 'Group 1';

// ─── Panel expansion gaps — §2D ────────────────────────────────

export const PANEL_END_GAP_STANDARD_IN  = 1 / 16;   // 0.0625
export const PANEL_SIDE_GAP_STANDARD_IN = 1 / 8;    // 0.125
/** Doubles gaps in humid climates. 2× end + 2× side. */
export const HIGH_HUMIDITY_GAP_MULTIPLIER = 2.0;

// ─── Fastener specs (nails) — §2D ──────────────────────────────

export const NAIL_EDGE_OC_IN  = 6.0;
export const NAIL_FIELD_OC_IN = 12.0;

// ─── Fastener specs (staples) — §2D ────────────────────────────

export const STAPLE_CROWN_MIN_IN = 3 / 8;   // 0.375
/** Staple must penetrate panel + 1" more (into the framing). */
export const STAPLE_LENGTH_OVER_PANEL_THICKNESS_IN = 1.0;
export const STAPLE_GAUGE = 16;

/** Staple schedules — the "light" values apply to panels ≤ ½",
 *  the "heavy" values to thicker panels. */
export const STAPLE_EDGE_OC_IN_LIGHT  = 4.0;   // ≤ ½" panels
export const STAPLE_FIELD_OC_IN_LIGHT = 8.0;
export const STAPLE_EDGE_OC_IN_HEAVY  = 2.0;   // > ½"
export const STAPLE_FIELD_OC_IN_HEAVY = 5.0;

/** The ½" breakpoint between light + heavy fastener schedules. */
export const PANEL_THICKNESS_FASTENER_BREAKPOINT_IN = 0.5;

// ─── Board sheathing — §2C ─────────────────────────────────────

export const BOARD_NAILS_PER_RAFTER_UP_TO_1X8 = 2;
export const BOARD_NAILS_PER_RAFTER_OVER_1X8  = 3;
export const MAX_BOARD_NOMINAL_WIDTH_RECOMMENDED_IN = 6;   // book prefers 1×6 max
export const MIN_END_JOINT_GAP_IN = 1 / 8;

export const BOARD_FACE_NAIL_SIZE = '8d common';   // §2C

// ─── OSB / Waferboard — §2G ────────────────────────────────────

export const OSB_MIN_THICKNESS_IN = 15 / 32;   // ≈ 0.46875

export const WAFERBOARD_MAX_SPAN_IN: Readonly<Record<string, number>> = {
  '3/8':  16,
  '7/16': 24,
  '1/2':  24,
};

// ─── Wood shingle / shake — §2B, §2I, §2K ──────────────────────

/** Wood shingles/shakes require ≥ 4:12 slope without build-up. */
export const WOOD_SHINGLE_MIN_SLOPE_RISE_PER_12 = 4.0;

/** Cold-climate triggers that force solid under wood — §2B.
 *  Evaluated with `<=` against the thresholds. */
export const WOOD_SHINGLE_COLD_DESIGN_TEMP_F_MAX = 0;
export const WOOD_SHINGLE_JAN_MEAN_TEMP_F_MAX    = 25;

/** Shake spaced-sheathing hard cap — §2I. Exceeding this causes
 *  the interlayment felt to sag into the gap. */
export const SHAKE_SPACING_MAX_IN = 2.5;

// ─── Solid zones on spaced-sheathing roofs — §2J ───────────────

/** Eave solid zone extends 12–24 in past the interior wall face. */
export const EAVE_SOLID_MIN_IN       = 12;
export const EAVE_SOLID_MAX_IN       = 24;
/** Low-slope eave solid zone widens to 36 in. Slope < 4:12. */
export const EAVE_SOLID_LOW_SLOPE_IN = 36;
/** Solid sheathing band each side of the ridge. Author rec. */
export const RIDGE_SOLID_EACH_SIDE_IN = 18;
/** Minimum width of the eave-protection membrane (ice-and-water
 *  shield or equivalent). */
export const EAVE_PROTECTION_MIN_IN = 36;

// ─── Labor rates — §2N ─────────────────────────────────────────

/** Default labor rates in manhours per square foot. Serve as
 *  defaults when a `RateSet` doesn't override per-material. Keys
 *  mirror the RateSet interface. */
export const DEFAULT_LABOR_RATE_MH_PER_SF: Readonly<Record<string, number>> = {
  board_sheathing:   0.026,
  plywood_sheathing: 0.013,
  // OSB + roof decking: add when field-verified
};

/** NEVER use as a runtime default. Historical reference only —
 *  callers must source a real crew rate from a `RateSet`. The
 *  constant exists so the fixtures + migration tests can assert
 *  against the book value. */
export const BOOK_HISTORICAL_CREW_MH_RATE_USD = 33.85;

// ─── Tile loading — §2M ────────────────────────────────────────

/** Horizontal gap between tile stacks on a course. */
export const TILE_HORIZONTAL_GAP_BETWEEN_STACKS_FT = 1.0;
/** Stack size on every 4th course (gable roofs), below ridge. */
export const GABLE_STACK_SIZE_EVERY_4TH_COURSE = 8;
/** Stack size at the ridge. */
export const GABLE_STACK_SIZE_AT_RIDGE = 4;
/** Course interval for staging stacks. */
export const GABLE_COURSE_INTERVAL_FOR_STACKS = 4;

// ─── APA Table 21 — §2F ────────────────────────────────────────

/**
 * APA panel span ratings — Table 21 from the study packet.
 *
 * Each row:
 *   [span_rating, min_thick_in, max_span_with_edge_support_in,
 *    max_span_without_edge_support_in, live_loads_psf_by_spacing]
 *
 * `live_loads_psf_by_spacing` is the allowable live load (psf) at
 * each rafter spacing (inches) where the panel has a published
 * value. If a spacing isn't a key in the dict, the panel is not
 * rated for that spacing — algorithm treats it as "does not
 * satisfy" and moves to the next row.
 *
 * Rows are ordered smallest to largest. Panel selection picks the
 * FIRST row that satisfies both spacing-and-load constraints.
 */
export interface ApaPanelRow {
  readonly span_rating: string;
  readonly min_thick_in: number;
  readonly max_w_edge_support_in: number;
  readonly max_wo_edge_support_in: number;
  /** Allowable live load in psf keyed by rafter spacing in inches. */
  readonly live_loads_psf_by_spacing: Readonly<Record<number, number>>;
}

export const APA_TABLE_21: readonly ApaPanelRow[] = [
  {
    span_rating: '12/0',
    min_thick_in: 5 / 16,
    max_w_edge_support_in: 12,
    max_wo_edge_support_in: 12,
    live_loads_psf_by_spacing: { 12: 30 },
  },
  {
    span_rating: '16/0',
    min_thick_in: 5 / 16,
    max_w_edge_support_in: 16,
    max_wo_edge_support_in: 16,
    live_loads_psf_by_spacing: { 12: 70, 16: 30 },
  },
  {
    span_rating: '20/0',
    min_thick_in: 5 / 16,
    max_w_edge_support_in: 20,
    max_wo_edge_support_in: 20,
    live_loads_psf_by_spacing: { 12: 120, 16: 50, 20: 30 },
  },
  {
    span_rating: '24/0',
    min_thick_in: 3 / 8,
    max_w_edge_support_in: 24,
    max_wo_edge_support_in: 20,
    live_loads_psf_by_spacing: { 12: 190, 16: 100, 20: 60, 24: 30 },
  },
  {
    span_rating: '24/16',
    min_thick_in: 7 / 16,
    max_w_edge_support_in: 24,
    max_wo_edge_support_in: 24,
    live_loads_psf_by_spacing: { 12: 190, 16: 100, 20: 65, 24: 40 },
  },
  {
    span_rating: '32/16',
    min_thick_in: 15 / 32,
    max_w_edge_support_in: 32,
    max_wo_edge_support_in: 28,
    live_loads_psf_by_spacing: { 12: 325, 16: 180, 20: 120, 24: 70, 32: 30 },
  },
  {
    span_rating: '40/20',
    min_thick_in: 19 / 32,
    max_w_edge_support_in: 40,
    max_wo_edge_support_in: 32,
    live_loads_psf_by_spacing: { 16: 305, 20: 205, 24: 130, 32: 60, 40: 30 },
  },
  {
    span_rating: '48/24',
    min_thick_in: 23 / 32,
    max_w_edge_support_in: 48,
    max_wo_edge_support_in: 36,
    live_loads_psf_by_spacing: { 20: 280, 24: 175, 32: 95, 40: 45, 48: 35 },
  },
  {
    span_rating: '60/32',
    min_thick_in: 7 / 8,
    max_w_edge_support_in: 60,
    max_wo_edge_support_in: 48,
    live_loads_psf_by_spacing: { 24: 305, 32: 165, 40: 100, 48: 70, 60: 35 },
  },
];
