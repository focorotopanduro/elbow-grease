/**
 * ALG-008 + ALG-009 — Fastener schedules for panel sheathing.
 *
 * Source: spec §6 ALG-008/ALG-009. Book §2D.
 *
 * ─── Common breakpoint ────────────────────────────────────────
 *
 * Both algorithms branch on the same panel-thickness breakpoint:
 *
 *     thickness_in ≤ 0.5 → "light" schedule
 *     thickness_in > 0.5 → "heavy" schedule
 *
 * The breakpoint is INCLUSIVE on the light side (≤). A 0.5-inch
 * panel gets the light schedule; 0.5001 gets the heavy. Spec
 * edge-case rows E-034 / E-035 pin this — thickness = 0.5 maps to
 * light, thickness = 0.5001 to heavy. Documented here to pre-empt
 * refactor drift.
 *
 * ─── ALG-008: Nail schedule (6d / 8d) ─────────────────────────
 *
 * thickness ≤ 0.5 : 6d common (or 8d ring-shank if caller prefers)
 * thickness > 0.5 : 8d ring-shank (or 8d common if !prefer_ring_shank)
 *
 * Ring-shank note: ring-shank nails only exist in 8d size in this
 * application. If the caller requests ring-shank on a ≤0.5" panel,
 * we UPGRADE to 8d — the size jumps together with the shank type.
 * This is both the spec's intent and code-compliant (HVHZ FL).
 *
 * Edge spacing (both schedules): 6" o.c. panel edges, 12" o.c. field.
 *
 * ─── ALG-009: Staple schedule ────────────────────────────────
 *
 * thickness ≤ 0.5 : 4" o.c. edges, 8" o.c. field   ("light")
 * thickness > 0.5 : 2" o.c. edges, 5" o.c. field   ("heavy")
 *
 * Crown always ≥ 3/8". Gauge always 16. Length = thickness + 1"
 * (the staple must penetrate the panel plus 1" into the framing).
 */

import type { FastenerSpec, NailType } from '../types';
import {
  NAIL_EDGE_OC_IN,
  NAIL_FIELD_OC_IN,
  PANEL_THICKNESS_FASTENER_BREAKPOINT_IN,
  STAPLE_CROWN_MIN_IN,
  STAPLE_EDGE_OC_IN_HEAVY,
  STAPLE_EDGE_OC_IN_LIGHT,
  STAPLE_FIELD_OC_IN_HEAVY,
  STAPLE_FIELD_OC_IN_LIGHT,
  STAPLE_GAUGE,
  STAPLE_LENGTH_OVER_PANEL_THICKNESS_IN,
} from '../constants';
import { InvalidGeometry } from '../errors';

/** Shared guard — both schedules require a positive, finite thickness. */
function guard_thickness(thickness_in: number): void {
  if (!Number.isFinite(thickness_in) || thickness_in <= 0) {
    throw new InvalidGeometry(
      `panel thickness must be > 0 (finite), got ${thickness_in}`,
    );
  }
}

/**
 * ALG-008 — Return a full `FastenerSpec` for a NAIL-fastened panel.
 *
 * @param thickness_in       Panel thickness in inches. Must be > 0.
 * @param prefer_ring_shank  When true (default), select ring-shank
 *                           8d for any case where ring-shank is
 *                           permitted. HVHZ FL installs should
 *                           always pass true.
 *
 * @throws {InvalidGeometry} thickness ≤ 0 or non-finite.
 */
export function nail_schedule_for_panel(
  thickness_in: number,
  prefer_ring_shank = true,
): FastenerSpec {
  guard_thickness(thickness_in);

  let nail_type: NailType;
  if (thickness_in <= PANEL_THICKNESS_FASTENER_BREAKPOINT_IN) {
    // Light panel: 6d common default. Ring-shank UPGRADES size to
    // 8d — ring-shank only exists in 8d for this application.
    nail_type = prefer_ring_shank ? 'ring_shank_8d' : 'common_6d';
  } else {
    // Heavy panel: 8d common or 8d ring-shank (same size, stronger).
    nail_type = prefer_ring_shank ? 'ring_shank_8d' : 'common_8d';
  }

  return {
    mode: 'nail',
    nail_type,
    staple_gauge: null,
    staple_crown_in: null,
    staple_length_in: null,
    edge_oc_in: NAIL_EDGE_OC_IN,
    field_oc_in: NAIL_FIELD_OC_IN,
  };
}

/**
 * ALG-009 — Return a full `FastenerSpec` for a STAPLE-fastened panel.
 *
 * Crown, gauge, length are book constants; edge/field spacing
 * depends on the light/heavy thickness split.
 *
 * @throws {InvalidGeometry} thickness ≤ 0 or non-finite.
 */
export function staple_schedule_for_panel(
  thickness_in: number,
): FastenerSpec {
  guard_thickness(thickness_in);

  const light = thickness_in <= PANEL_THICKNESS_FASTENER_BREAKPOINT_IN;
  const edge_oc_in = light ? STAPLE_EDGE_OC_IN_LIGHT : STAPLE_EDGE_OC_IN_HEAVY;
  const field_oc_in = light ? STAPLE_FIELD_OC_IN_LIGHT : STAPLE_FIELD_OC_IN_HEAVY;

  return {
    mode: 'staple',
    nail_type: null,
    staple_gauge: STAPLE_GAUGE,
    staple_crown_in: STAPLE_CROWN_MIN_IN,
    // Staple length = panel thickness + 1" penetration into framing.
    // Per §2D — the staple must go through the panel AND bite into
    // the rafter by at least 1".
    staple_length_in: thickness_in + STAPLE_LENGTH_OVER_PANEL_THICKNESS_IN,
    edge_oc_in,
    field_oc_in,
  };
}
