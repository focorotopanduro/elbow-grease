/**
 * Chapter 2 — Sheathing, Decking & Loading type definitions.
 *
 * Direct port of the Python spec at
 * `roofing_estimation_book_sources/Chapter2_ClaudeCode_Spec.md` §3.
 *
 * Conventions:
 *   • `snake_case` fields — matches existing FL estimator
 *     (`fl/core.ts`) so the two modules can exchange data without
 *     name munging.
 *   • String-literal unions in place of Python enums — tree-shakes
 *     cleanly, serialises as plain JSON, no runtime enum object.
 *   • `readonly` interfaces in place of `@dataclass(frozen=True)` —
 *     TypeScript equivalent of immutable DTOs.
 *   • `ReadonlySet<T>` in place of `frozenset` — O(1) membership
 *     tests without exposing mutation.
 */

// ── Covering types ─────────────────────────────────────────────

export const COVERING_TYPES = [
  'asphalt_shingle',
  'fiberglass_shingle',
  'metal_shingle',
  'mineral_surfaced_roll',
  'built_up',
  'tile_clay',
  'tile_concrete',
  'slate',
  'metal_corrugated',   // the single spaced-allowed metal
  'metal_sheet',
  'wood_shingle',
  'wood_shake',
] as const;
export type CoveringType = typeof COVERING_TYPES[number];

/** Coverings that REQUIRE solid sheathing (spec §2A). */
export const SOLID_REQUIRED_COVERINGS: ReadonlySet<CoveringType> = new Set<CoveringType>([
  'asphalt_shingle',
  'fiberglass_shingle',
  'metal_shingle',
  'mineral_surfaced_roll',
  'built_up',
  'tile_clay',
  'tile_concrete',
  'slate',
  'metal_sheet',
]);

/** Wood coverings whose sheathing type depends on slope + climate. */
export const WOOD_COVERINGS: ReadonlySet<CoveringType> = new Set<CoveringType>([
  'wood_shingle',
  'wood_shake',
]);

/** Brittle coverings (tile, slate) that impose heavier dead loads. */
export const BRITTLE_COVERINGS: ReadonlySet<CoveringType> = new Set<CoveringType>([
  'tile_clay',
  'tile_concrete',
  'slate',
]);

// ── Sheathing type / material ──────────────────────────────────

export const SHEATHING_TYPES = [
  'solid',
  'spaced_with_solid_zones',
  'spaced_over_solid_hybrid',   // <4:12 wood shingle/shake build-up
] as const;
export type SheathingType = typeof SHEATHING_TYPES[number];

export const SHEATHING_MATERIALS = [
  'board',
  'plywood',
  'osb',
  'waferboard',
  'roof_decking',   // exposed-ceiling decking
] as const;
export type SheathingMaterial = typeof SHEATHING_MATERIALS[number];

export const BOARD_EDGE_PROFILES = [
  'square_edged',
  'shiplap',
  'tongue_and_groove',
] as const;
export type BoardEdgeProfile = typeof BOARD_EDGE_PROFILES[number];

// ── Climate ────────────────────────────────────────────────────

export const CLIMATE_HUMIDITIES = ['low', 'normal', 'high'] as const;
export type ClimateHumidity = typeof CLIMATE_HUMIDITIES[number];

// ── Roof shape / frame ─────────────────────────────────────────

export const ROOF_SHAPES = ['gable', 'hip', 'shed', 'complex'] as const;
export type RoofShape = typeof ROOF_SHAPES[number];

export const FRAME_TYPES = ['conventional_stick', 'truss'] as const;
export type FrameType = typeof FRAME_TYPES[number];

// ── Edge support + fasteners ───────────────────────────────────

export const EDGE_SUPPORT_METHODS = [
  'tongue_and_groove',
  'panel_edge_clips',
  'blocking_2x4',
] as const;
export type EdgeSupportMethod = typeof EDGE_SUPPORT_METHODS[number];

export const NAIL_TYPES = [
  'common_6d',
  'common_8d',
  'ring_shank_8d',
  'annular_threaded_8d',
] as const;
export type NailType = typeof NAIL_TYPES[number];

export const FASTENER_MODES = ['nail', 'staple'] as const;
export type FastenerMode = typeof FASTENER_MODES[number];

// ── Input DTOs ─────────────────────────────────────────────────

/** Climate descriptor. In FL builds, `humidity='high'`,
 *  `wind_driven_rain_zone=true` for coastal zones. Seismic is
 *  typically false in FL but kept for multi-state readiness. */
export interface Climate {
  readonly humidity: ClimateHumidity;
  readonly cold_design_temp_f: number;
  readonly january_mean_temp_f: number;
  readonly ice_risk_at_eaves: boolean;
  readonly wind_driven_rain_zone: boolean;
  readonly seismic_zone: boolean;
}

export interface Frame {
  readonly frame_type: FrameType;
  readonly rafter_spacing_in: number;
  readonly has_open_cornice_gable: boolean;
  readonly has_vented_attic: boolean;
}

export interface CoveringSpec {
  readonly covering_type: CoveringType;
  /** Specific product weight in psf. Use WEIGHT_PSF lookup when
   *  the caller doesn't have a manufacturer datasheet. */
  readonly weight_psf: number;
  readonly life_expectancy_years?: number;
}

export interface ReroofContext {
  readonly is_reroof_over_existing: boolean;
  readonly existing_covering_weight_psf?: number;
  readonly existing_deck_has_pitch_or_loose_knots?: boolean;
}

export interface JobInputs {
  // Roof geometry
  readonly roof_area_sf: number;
  readonly roof_shape: RoofShape;
  readonly slope_rise_per_12: number;

  // Frame
  readonly frame: Frame;

  // New covering
  readonly covering: CoveringSpec;

  // Reroof context
  readonly reroof: ReroofContext;

  // Climate
  readonly climate: Climate;

  // Material preference (optional; algorithm may override)
  readonly sheathing_material_pref?: SheathingMaterial;

  // Estimating inputs
  readonly waste_factor: number;        // default 0.10 in spec
  readonly rate_set_version: string;    // required; non-empty
}

// ── Output DTOs ────────────────────────────────────────────────

export interface PanelSpec {
  readonly material: SheathingMaterial;
  readonly thickness_in: number;
  /** APA span rating e.g. "32/16". Null for boards. */
  readonly span_rating: string | null;
  /** Grade string e.g. "C-D Ext Glue". Null for boards. */
  readonly grade: string | null;
  /** Max rafter spacing this panel can span WITHOUT aftermarket
   *  edge support (T&G, clips, or blocking). Populated for APA
   *  panels selected via ALG-003. Undefined for boards and for
   *  custom panels whose row isn't in Table 21. ALG-007 uses
   *  this to decide whether edge support is required. */
  readonly max_span_without_edge_support_in?: number;
  /** True if the panel ships with tongue-and-groove edges —
   *  edge support is then built-in and aftermarket clips /
   *  blocking aren't needed. Defaults to false (undefined). */
  readonly has_tongue_and_groove_edges?: boolean;
}

export interface FastenerSpec {
  readonly mode: FastenerMode;
  readonly nail_type: NailType | null;      // populated when mode === 'nail'
  readonly staple_gauge: number | null;     // populated when mode === 'staple'
  readonly staple_crown_in: number | null;
  readonly staple_length_in: number | null;
  readonly edge_oc_in: number;
  readonly field_oc_in: number;
}

export interface ExpansionGaps {
  readonly end_gap_in: number;
  readonly side_gap_in: number;
}

export interface SolidZones {
  /** 12–24 in. Widens to 36 on low-slope. */
  readonly eave_solid_in: number;
  /** 18 per book author recommendation. */
  readonly ridge_solid_each_side_in: number;
  /** True when the gable has an open-cornice — the overhang
   *  sheathing must be continuous through the cornice. */
  readonly gable_overhang_solid: boolean;
  /** Min width of ice-and-water / eave-protection membrane. 36 per
   *  §2J unless local code is stricter. */
  readonly eave_protection_membrane_min_in: number;
}

export interface SheathingSpec {
  readonly sheathing_type: SheathingType;
  readonly panel: PanelSpec | null;              // null if BOARD
  readonly board_width_nominal_in: number | null; // populated for BOARD
  readonly board_profile: BoardEdgeProfile | null;
  readonly edge_support: EdgeSupportMethod | null;
  readonly fasteners: FastenerSpec;
  readonly gaps: ExpansionGaps | null;            // null for BOARD
  readonly solid_zones: SolidZones | null;        // populated for SPACED variants
}

export interface CostLine {
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;                 // "SF", "LF", "EA", "MH", etc.
  readonly unit_cost_usd: number;
  readonly extended_usd: number;
}

export type WarningSeverity = 'info' | 'warning' | 'error';

export interface WarningFlag {
  /** snake_case identifier. Use the same code across all calls so
   *  the UI can de-dupe and cluster. */
  readonly code: string;
  readonly severity: WarningSeverity;
  readonly message: string;
  readonly remediation?: string;
}

/** Top-level result of a Chapter 2 sheathing bid.
 *
 *  Stable field names — the existing FL estimator embeds parts of
 *  this in its richer `Estimate` type, so renaming requires a
 *  coordinated update there too. */
export interface BidOutput {
  readonly sheathing_spec: SheathingSpec;
  readonly materials: readonly CostLine[];
  readonly labor: readonly CostLine[];
  readonly adders: readonly CostLine[];
  readonly subtotal_usd: number;
  readonly total_usd: number;
  readonly flags: readonly WarningFlag[];
  readonly staging_instruction: string;
  readonly rate_set_version: string;
  /** ISO-8601 date string (YYYY-MM-DD). TypeScript doesn't have
   *  a native `date` type, so we stringify at the source. */
  readonly priced_on: string;
}

// ── Tile staging (ALG-014 / ALG-015) ───────────────────────────

/**
 * One tile-stack location on a course of the roof. Written to the
 * work-order so the crew knows where to pre-stage pallets before
 * the installer starts setting tile.
 *
 * `course`: 1-indexed from the eave up. Course `slope_courses` is
 *           the ridge. Other courses without staging instructions
 *           are absent from the output list (not zero-sized entries).
 * `stack_size`: number of tiles per stack at this course — 4 for
 *           ridge stacks, 8 for every-4th-course stacks per §2M.
 * `horizontal_gap_ft`: spacing between adjacent stacks along the
 *           course. Constant 1 ft per §2M for typical residential.
 */
export interface TileStackEntry {
  readonly course: number;
  readonly stack_size: number;
  readonly horizontal_gap_ft: number;
}

/**
 * Composite staging instruction returned by the tile-loading
 * algorithms. `stacks` is the machine-readable pattern for a work-
 * order renderer; `general_rules` is human-readable prose the cost
 * engine can concatenate into `BidOutput.staging_instruction`.
 *
 * Gable (ALG-014) returns a populated `stacks` array; hip
 * (ALG-015) returns an empty `stacks` array + a `hip_tile_loading_review_needed`
 * flag until course-length-scaled SKU data is available.
 */
export interface TileLoadingPattern {
  readonly stacks: readonly TileStackEntry[];
  readonly general_rules: readonly string[];
}

// ── Edge-support determination (ALG-007) ───────────────────────

/**
 * Compact machine-readable reasons for the edge-support decision
 * returned by `edge_support_required` (ALG-007). Lets the UI group
 * panels by "why" when presenting cost lines.
 */
export const EDGE_SUPPORT_REASONS = [
  'panel_tongue_and_groove',     // panel has T&G edges; no aftermarket
  'within_max_wo_edge',          // spacing fits within max without edge support
  'spacing_exceeds_wo_edge',     // spacing > max_wo — clips required (default 1)
  'built_up_48in_double_clips',  // §2D Tbl 22 footnote a — BUILT_UP @ 48" needs 2
] as const;
export type EdgeSupportReason = typeof EDGE_SUPPORT_REASONS[number];

/**
 * Full result of `edge_support_required`.
 *
 * Wider than the spec's `Optional[EdgeSupportMethod]` return
 * because the "2 clips per span" rule (§2D Table 22 footnote a for
 * BUILT_UP at 48" spacing) is a quantity, not a different method.
 * Rolling it into the return keeps the cost engine's fastener-line
 * builder from having to re-derive the doubling.
 */
export interface EdgeSupportRequirement {
  /** `null` iff edge support is NOT required (T&G panel, or
   *  rafter spacing ≤ max without edge support). */
  readonly method: EdgeSupportMethod | null;
  /** How many clips / blocks per span. 0 when method is null or
   *  `'tongue_and_groove'`, 1 default for aftermarket, 2 for the
   *  BUILT_UP @ 48" doubled-clip rule. */
  readonly clips_per_span: number;
  /** Decision path. See `EdgeSupportReason` doc. */
  readonly reason: EdgeSupportReason;
}

// ── Spaced-sheathing layout (ALG-005) ──────────────────────────

/**
 * Method label for wood-shingle spaced-sheathing layouts.
 *
 * Per §2I + spec §6 ALG-005:
 *   - `1x4_one_per_course`: 1×4 boards, one shingle course per
 *     board, center spacing = weather exposure.
 *   - `1x6_two_per_course`: 1×6 boards, two shingle courses per
 *     board when exposure ≤ 5.5"; degrades to one-per-course
 *     (center spacing = exposure) when exposure > 5.5".
 *
 * Wood shakes always use 1×6 with one-per-course; there's no
 * method choice — hence no shake-specific method label here.
 */
export const SHINGLE_SPACING_METHODS = [
  '1x4_one_per_course',
  '1x6_two_per_course',
] as const;
export type ShingleSpacingMethod = typeof SHINGLE_SPACING_METHODS[number];

/**
 * Discriminated-union result of `spaced_sheathing_layout`.
 *
 * Why a discriminated union (vs a single interface with a
 * nullable field): the two layout modes carry semantically
 * different data. `single_per_course` has an explicit center-to-
 * center board spacing; `two_per_course` doesn't — the board
 * positions are derived from the shingle exposure pattern. A
 * single interface would force callers to branch on an `if`
 * anyway, but make the safety lossy (forgetting the branch
 * silently reads the wrong field). The union makes the branch
 * mandatory at the type level.
 *
 * Consumers discriminate on `kind`:
 *
 *     switch (layout.kind) {
 *       case 'single_per_course':
 *         // use layout.center_spacing_in
 *         break;
 *       case 'two_per_course':
 *         // use layout.exposure_in; spacing is implicit
 *         break;
 *     }
 */
export type SpacedBoardLayout =
  | {
      readonly kind: 'single_per_course';
      readonly board_nominal_in: number;
      /** Center-to-center spacing between boards.
       *  Equal to the weather exposure for single-per-course layouts. */
      readonly center_spacing_in: number;
    }
  | {
      readonly kind: 'two_per_course';
      readonly board_nominal_in: number;
      /** Shingle weather exposure the layout was designed for.
       *  Two courses fit within each 1×6 board — the explicit
       *  board-to-board spacing is a function of exposure, not
       *  stored separately. */
      readonly exposure_in: number;
    };

// ── RateSet ────────────────────────────────────────────────────

/**
 * Versioned pricing + labor-rate container. Every `BidOutput`
 * records which `rate_set_version` priced it — re-pricing a bid
 * under a new RateSet requires an explicit migration action.
 *
 * Load from a versioned config source (YAML, SQLite, HTTP). Never
 * hardcode rates inside algorithm modules — they must accept a
 * `RateSet` argument. Spec §9.
 */
export interface RateSet {
  /** e.g. "FL-2026-Q2-v1". Non-empty required. */
  readonly version: string;
  /** e.g. "NCE 2025", "in-house 2024 data". Descriptive only. */
  readonly source: string;
  readonly crew_manhour_rate_usd: number;
  /** Keys: "board_sheathing", "plywood_sheathing", "osb_sheathing". */
  readonly labor_rates_mh_per_sf: Readonly<Record<string, number>>;
  /** Keys: material SKU codes. Values: USD per SF. */
  readonly material_skus_usd_per_sf: Readonly<Record<string, number>>;
  /** Sales tax rate, 0.0–1.0. */
  readonly tax_rate: number;
  /** ISO-8601 date string. Warn if >1 year old. */
  readonly last_verified_date: string;
}
