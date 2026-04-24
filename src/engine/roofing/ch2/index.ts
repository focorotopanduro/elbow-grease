/**
 * Chapter 2 — Sheathing, Decking & Loading module.
 *
 * Public API surface. Import from here:
 *
 *     import {
 *       determine_sheathing_type,
 *       SheathingSpecViolation,
 *       type JobInputs,
 *       type BidOutput,
 *     } from '@engine/roofing/ch2';
 *
 * Phased implementation status:
 *   • Phase 1 (shipped): types, constants, errors, ALG-001
 *   • Phase 2 (pending): ALG-002/003/013 loads + APA panel + OSB
 *   • Phase 3 (pending): ALG-004–011 board/spaced/fasteners/gaps/zones
 *   • Phase 4 (pending): ALG-014–017 tile staging + frame-load + venting
 *   • Phase 5 (pending): ALG-018–020 + RateSet + FL overrides + cost engine
 *   • Phase 6 (pending): 40-row edge-case matrix + RoofingInspector wiring
 *
 * Each phase lands as its own commit; public API stays additive.
 */

// Types
export * from './types';

// Constants
export * from './constants';

// Errors
export * from './errors';

// Algorithms
export { determine_sheathing_type } from './algorithms/sheathingDecision';
export { nails_per_rafter_for_board } from './algorithms/board';
export { spaced_sheathing_layout } from './algorithms/spaced';
export {
  LOW_SLOPE_WOOD_BUILD_UP_STACK,
  low_slope_wood_layer_stack,
} from './algorithms/lowSlope';
export { edge_support_required } from './algorithms/edgeSupport';
export {
  nail_schedule_for_panel,
  staple_schedule_for_panel,
} from './algorithms/fasteners';
export {
  panel_expansion_gaps,
  validate_gaps_match_humidity,
} from './algorithms/expansionGaps';
export { solid_zones_for_spaced_roof } from './algorithms/solidZones';
export {
  compute_effective_live_load_psf,
  compute_loads,
  compute_total_dead_load_psf,
} from './algorithms/loads';
export {
  select_apa_panel,
  type SelectApaPanelOptions,
} from './algorithms/panels';
export {
  osb_max_span_for_thickness,
  osb_meets_min_thickness,
  parse_fractional_thickness_in,
  validate_osb_panel_spec,
  validate_osb_spec,                 // back-compat alias
  validate_waferboard_panel_spec,
} from './algorithms/osb';
