/**
 * ALG-020 — Cost engine entry point.
 *
 * Source: spec §6 ALG-020. Entire Ch 2 spec.
 *
 * ─── Orchestration flow ──────────────────────────────────────
 *
 *   1. validate_job_inputs(inputs)              [§7 gate — throws]
 *   2. determine_sheathing_type(inputs, flags)  [ALG-001]
 *   3. compute_loads(...)                       [ALG-002]
 *   4. select_apa_panel(...) if plywood path    [ALG-003]
 *      (Non-plywood paths emit `sheathing_path_not_yet_costed`
 *       flag for now — Phase 6 fleshes them out.)
 *   5. nail_schedule_for_panel(...)             [ALG-008]
 *   6. panel_expansion_gaps(humidity)           [ALG-010]
 *   7. validate_gaps_match_humidity(...)        [ALG-012 — throws on drift]
 *   8. edge_support_required(...)               [ALG-007]
 *   9. flag_frame_load_check_needed(...)        [ALG-016]
 *  10. check_attic_ventilation(...)             [ALG-017]
 *  11. check_rate_set_staleness(rate_set)       [§9.2 gate]
 *  12. material_cost_line(...)                  [ALG-018]
 *  13. labor_cost_line(...)                     [ALG-019]
 *  14. Sum subtotal + apply tax → total.
 *  15. Staging instruction string for tile roofs (gable/hip).
 *  16. Assemble BidOutput with rate_set_version + priced_on.
 *
 * ─── Error contract (per design decision p) ──────────────────
 *
 * Throws propagate — the caller surfaces the typed error to the
 * user. The cost engine doesn't catch and convert to `flags`
 * because the spec treats violations as "this bid cannot be
 * priced, fix the inputs." Ambiguous partial bids are worse than
 * a clear "we can't price this" state.
 *
 * The validation gates (§7 throw, ALG-012 throw) fire BEFORE the
 * cost engine produces any data — so when they throw, no
 * BidOutput has been created yet and the caller hasn't seen
 * partial state.
 *
 * ─── Non-plywood paths (Phase 5b scope limitation) ───────────
 *
 * The spec's ALG-020 step 4 covers SOLID (plywood / OSB / board)
 * and SPACED (board-with-solid-zones, spaced-over-solid hybrid).
 * This phase fully implements SOLID + plywood. Other paths emit
 * a `sheathing_path_not_yet_costed` flag and return a partial
 * BidOutput with empty materials / labor arrays. Phase 6 fleshes
 * them out driven by the edge-case matrix.
 */

import type {
  BidOutput,
  CostLine,
  FastenerSpec,
  JobInputs,
  RateSet,
  SheathingSpec,
  SheathingType,
  WarningFlag,
} from '../types';
import { compute_loads } from '../algorithms/loads';
import { determine_sheathing_type } from '../algorithms/sheathingDecision';
import {
  apply_florida_bid_audit_flags,
  apply_florida_sheathing_type_override,
} from '../floridaOverrides';
import { edge_support_required } from '../algorithms/edgeSupport';
import { flag_frame_load_check_needed } from '../algorithms/frameLoad';
import { nail_schedule_for_panel } from '../algorithms/fasteners';
import {
  panel_expansion_gaps,
  validate_gaps_match_humidity,
} from '../algorithms/expansionGaps';
import { select_apa_panel } from '../algorithms/panels';
import { check_attic_ventilation } from '../algorithms/ventilation';
import {
  gable_tile_loading_pattern,
  hip_tile_loading_pattern,
} from '../algorithms/tileStaging';
import { check_rate_set_staleness } from '../rateSet';
import { validate_job_inputs } from '../validation';
import { labor_cost_line } from './laborCost';
import { material_cost_line } from './materialCost';

/** Today's date as YYYY-MM-DD. Factored so tests can override via
 *  dependency injection if deterministic pricing dates become a
 *  testing concern. For now, `new Date()` suffices. */
function today_iso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Tile coverings use the gable/hip staging patterns for their
 *  work-order staging_instruction field. Other coverings get a
 *  generic install instruction. */
function build_staging_instruction(
  inputs: JobInputs,
  flags: WarningFlag[],
): string {
  const covering = inputs.covering.covering_type;
  const is_tile = covering === 'tile_clay' || covering === 'tile_concrete';
  if (!is_tile) {
    return (
      'Install per §2D nail schedule. Maintain expansion gaps per §2D. ' +
      'Do not walk panels until all edges are fastened.'
    );
  }

  // Tile staging depends on roof shape. Approximation: use
  // inputs.roof_area_sf / typical_course_coverage as a course
  // count. Typical tile course covers ~10 sf per course per ridge
  // line — rough. A real implementation would walk the roof
  // geometry; for now the 10-sf-per-course heuristic is OK for
  // a staging string.
  const estimated_courses = Math.max(3, Math.floor(inputs.roof_area_sf / 50));
  const pattern =
    inputs.roof_shape === 'hip'
      ? hip_tile_loading_pattern(estimated_courses, flags)
      : gable_tile_loading_pattern(estimated_courses);
  return pattern.general_rules.join(' ');
}

/**
 * Build the `SheathingSpec` for the canonical SOLID + plywood path.
 * Non-plywood paths produce a simplified spec with minimal fields
 * and rely on the caller to branch on `flags` for "not yet costed".
 */
function build_solid_plywood_spec(
  inputs: JobInputs,
  sheathing_type: SheathingType,
  flags: WarningFlag[],
): SheathingSpec {
  // Loads (ALG-002)
  const { effective_live_psf } = compute_loads(
    'wood_deck',
    'felt_30lb',
    inputs.covering.weight_psf,
    flags,
  );

  // Panel selection (ALG-003) — assumes caller wants edge support
  // (clips / blocking) on hand, cheaper + faster than T&G panels.
  const panel = select_apa_panel(
    inputs.frame.rafter_spacing_in,
    effective_live_psf,
    inputs.covering.covering_type,
    true,
    { flags },
  );

  // Edge support (ALG-007)
  const edge = edge_support_required(
    panel,
    inputs.frame.rafter_spacing_in,
    inputs.covering.covering_type,
  );

  // Fasteners (ALG-008 — nail default; ALG-009 available for
  // staple-fastened panels but FL convention is nails).
  const fasteners: FastenerSpec = nail_schedule_for_panel(
    panel.thickness_in,
    inputs.climate.wind_driven_rain_zone, // ring-shank in HVHZ
  );

  // Gaps (ALG-010) — then validate (ALG-012) as belt-and-braces.
  const gaps = panel_expansion_gaps(inputs.climate.humidity);
  validate_gaps_match_humidity(gaps, inputs.climate.humidity);

  return {
    sheathing_type,
    panel,
    board_width_nominal_in: null,
    board_profile: null,
    edge_support: edge.method,
    fasteners,
    gaps,
    solid_zones: null, // SOLID only — no spaced zones
  };
}

// ─── ALG-020 public entry ─────────────────────────────────────

/**
 * Price a Chapter-2 sheathing bid.
 *
 * Runs every ALG-00x in the correct order, aggregates flags, and
 * produces a fully-assembled `BidOutput`. Throws `Ch2Error`
 * subclasses (caller handles with `instanceof Ch2Error`).
 *
 * @param inputs    Validated job inputs.
 * @param rate_set  Versioned pricing + labor rates.
 * @returns         Fully-priced `BidOutput`.
 *
 * @throws {InvalidGeometry | MissingRequiredInput | UnknownCoveringType
 *          | SheathingSpecViolation | PanelSelectionFailed
 *          | HumidityGapMismatch}  Per-algorithm violations.
 */
export function price_sheathing_bid(
  inputs: JobInputs,
  rate_set: RateSet,
): BidOutput {
  const flags: WarningFlag[] = [];

  // ─── §7 + §9 gates ──────────────────────────────────────
  validate_job_inputs(inputs);
  // Cross-check: inputs.rate_set_version should match rate_set.version.
  // Mismatch means the caller passed the wrong RateSet for this bid.
  if (inputs.rate_set_version !== rate_set.version) {
    flags.push({
      code: 'rate_set_version_mismatch',
      severity: 'warning',
      message:
        `JobInputs.rate_set_version='${inputs.rate_set_version}' doesn't ` +
        `match RateSet.version='${rate_set.version}'. The bid is being ` +
        `priced against a different rate set than the inputs claim.`,
      remediation:
        'Update JobInputs.rate_set_version to match, or load the ' +
        'correct RateSet.',
    });
  }
  const stale_flag = check_rate_set_staleness(rate_set);
  if (stale_flag !== null) flags.push(stale_flag);

  // ─── ALG-001 sheathing type ──────────────────────────────
  let sheathing_type = determine_sheathing_type(inputs, flags);

  // ─── §9.4 pre-process — FL forced-solid override ────────
  // Must run AFTER ALG-001 (which emits the
  // `wind_rain_zone_solid_recommended` flag for wood + FL) but
  // BEFORE panel selection (because the override affects which
  // algorithms run next). Keeps FL logic in its own module.
  sheathing_type = apply_florida_sheathing_type_override(
    inputs,
    sheathing_type,
    flags,
  );

  // ─── Non-plywood paths: flag + return partial ───────────
  const material_pref = inputs.sheathing_material_pref ?? 'plywood';
  if (sheathing_type !== 'solid' || material_pref !== 'plywood') {
    flags.push({
      code: 'sheathing_path_not_yet_costed',
      severity: 'warning',
      message:
        `Sheathing path (${sheathing_type} + ${material_pref}) not yet ` +
        `fully costed. Only SOLID + plywood is implemented in Phase 5b.`,
      remediation:
        'Bid is returned with empty materials/labor arrays. Wait for ' +
        'Phase 6 edge-case matrix expansion, or price manually.',
    });

    // Minimal stub SheathingSpec so the shape is preserved.
    const stub_fasteners: FastenerSpec = {
      mode: 'nail',
      nail_type: 'common_8d',
      staple_gauge: null,
      staple_crown_in: null,
      staple_length_in: null,
      edge_oc_in: 6,
      field_oc_in: 12,
    };
    const stub_spec: SheathingSpec = {
      sheathing_type,
      panel: null,
      board_width_nominal_in: null,
      board_profile: null,
      edge_support: null,
      fasteners: stub_fasteners,
      gaps: null,
      solid_zones: null,
    };

    return apply_florida_bid_audit_flags(inputs, {
      sheathing_spec: stub_spec,
      materials: [],
      labor: [],
      adders: [],
      subtotal_usd: 0,
      total_usd: 0,
      flags,
      staging_instruction: build_staging_instruction(inputs, flags),
      rate_set_version: rate_set.version,
      priced_on: today_iso(),
    });
  }

  // ─── SOLID + plywood canonical path ─────────────────────
  const spec = build_solid_plywood_spec(inputs, sheathing_type, flags);

  // ─── ALG-016 + ALG-017 warning flags ────────────────────
  const frame_flag = flag_frame_load_check_needed(
    inputs.covering.weight_psf,
    inputs.reroof.existing_covering_weight_psf ?? null,
    inputs.reroof.is_reroof_over_existing,
  );
  if (frame_flag !== null) flags.push(frame_flag);

  const vent_flag = check_attic_ventilation(
    spec.sheathing_type,
    inputs.frame.has_vented_attic,
  );
  if (vent_flag !== null) flags.push(vent_flag);

  // ─── Cost lines ─────────────────────────────────────────
  // Material: look up the panel's SKU price from the RateSet.
  // The SKU key convention mirrors what TEST_RATE_SET seeds:
  //   `plywood_<span_rating_as_underscore>_<thickness_as_underscore>`
  // e.g. "plywood_32_16_15_32" for a 32/16 @ 15/32" panel.
  const panel = spec.panel!;
  const sku = build_plywood_sku_key(panel.span_rating!, panel.thickness_in);
  const unit_price = rate_set.material_skus_usd_per_sf[sku];
  const materials: CostLine[] = [];
  if (unit_price === undefined) {
    flags.push({
      code: 'material_sku_not_in_rate_set',
      severity: 'error',
      message:
        `Panel SKU '${sku}' not found in RateSet '${rate_set.version}'. ` +
        `Material cost cannot be computed.`,
      remediation:
        `Add '${sku}' to RateSet.material_skus_usd_per_sf with a unit price, ` +
        `or use a different panel selection.`,
    });
  } else {
    materials.push(
      material_cost_line(
        inputs.roof_area_sf,
        inputs.waste_factor,
        unit_price,
        `${panel.span_rating} plywood sheathing (${panel.thickness_in.toFixed(4)}")`,
      ),
    );
  }

  // Labor: pass the RateSet's per-material rate as override so
  // ALG-019 doesn't fall back to the book constant.
  const labor_rate_key = 'plywood_sheathing';
  const labor_mh_per_sf = rate_set.labor_rates_mh_per_sf[labor_rate_key];
  const labor: CostLine[] = [
    labor_cost_line(
      inputs.roof_area_sf,
      'plywood',
      rate_set.crew_manhour_rate_usd,
      labor_mh_per_sf, // may be undefined — ALG-019 then falls back to the §2N constant
    ),
  ];

  // ─── Adders (skeletal for Phase 5b — Phase 5c / 6 expand) ─
  const adders: readonly CostLine[] = [];

  // ─── Subtotal + tax → total ─────────────────────────────
  const subtotal_usd =
    materials.reduce((s, l) => s + l.extended_usd, 0) +
    labor.reduce((s, l) => s + l.extended_usd, 0) +
    adders.reduce((s, l) => s + l.extended_usd, 0);
  const total_usd = subtotal_usd * (1 + rate_set.tax_rate);

  return apply_florida_bid_audit_flags(inputs, {
    sheathing_spec: spec,
    materials,
    labor,
    adders,
    subtotal_usd,
    total_usd,
    flags,
    staging_instruction: build_staging_instruction(inputs, flags),
    rate_set_version: rate_set.version,
    priced_on: today_iso(),
  });
}

/**
 * Build a RateSet SKU key for an APA plywood panel.
 *
 * Convention (matches TEST_RATE_SET):
 *   plywood_<span_rating>_<thickness_fraction>
 *
 * With non-alphanumerics replaced by underscores. Examples:
 *   "32/16" + 15/32" → "plywood_32_16_15_32"
 *   "48/24" + 23/32" → "plywood_48_24_23_32"
 *
 * Keeping this logic in one helper so the convention can be
 * changed in one place if the data team switches naming schemes.
 */
function build_plywood_sku_key(span_rating: string, thickness_in: number): string {
  const span_part = span_rating.replace('/', '_');
  // thickness expressed as Ntimes32 fraction — common roof panels
  // land at 15/32, 19/32, 23/32 etc. 32nds gives whole numerators.
  const thirtySeconds = Math.round(thickness_in * 32);
  const thickness_part = `${thirtySeconds}_32`;
  // 7/8" is 28/32 but commonly tagged as 7_8. Handle the clean-
  // fraction cases explicitly so the SKU key matches what datasets
  // conventionally publish.
  const clean_fraction_by_32nds: Readonly<Record<number, string>> = {
    16: '1_2',  // 16/32 = 1/2
    24: '3_4',  // 24/32 = 3/4
    28: '7_8',  // 28/32 = 7/8
  };
  const cleaned = clean_fraction_by_32nds[thirtySeconds] ?? thickness_part;
  return `plywood_${span_part}_${cleaned}`;
}
