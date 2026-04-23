/**
 * Aggregate Estimator — Phase 14.R.6.
 *
 * Runs the single-section FL estimator once per drawn `RoofSection`
 * and merges the results into ONE aggregate `Estimate`. Enables a
 * realistic whole-house quote from the multi-section roof the user
 * drew on the canvas (main + garage + wing + dormer), not just the
 * one currently-selected section.
 *
 * Merge rules:
 *
 *   Line items      — grouped by (category | name | unit | fl_approval | noa).
 *                     Quantities summed; `waste_factor_pct` takes the MAX
 *                     across the group (conservative); confidence takes
 *                     the WORST; notes concat uniquely.
 *
 *   Zones           — sqft fields summed; `a_dimension_ft` takes the
 *                     MAX (drives fastening spacing — worst case wins);
 *                     `perimeter_fraction` becomes a plan-area weighted
 *                     average; confidence = worst across sections.
 *
 *   Warnings        — deduped by (severity | category | message | ref).
 *                     Same geometry-driven warning appearing on 5
 *                     sections only shows once in the aggregate UI.
 *
 *   Wind + Sheathing — project-level, not per-section. All sections
 *                      share the same county/risk, so we just use the
 *                      first section's result.
 *
 *   Penetrations    — plumbing vents / skylights / chimneys are
 *                     project-level. We assign the FULL counts to the
 *                     LARGEST section (by plan area) and zero on the
 *                     rest, so penetration flashing line items appear
 *                     exactly once in the aggregate.
 *
 * Pure function — no global state, no side effects. Safe to call on
 * every React render; the estimator completes in microseconds.
 */

import {
  type Confidence,
  type Estimate,
  type EstimateWarning,
  type LineItem,
  type Project,
  type RoofGeometry,
  type RoofTypeFL,
  type WindProfile,
  type ZoneProfile,
  type SheathingSpec,
  createProject,
  worstConfidence,
  nowIsoUtc,
} from './core';
import { estimate } from './estimator';
import {
  type RoofSection,
  type RoofPenetration,
  type PenetrationKind,
  areaPlan,
  rise,
  hasPolygon,
  isConvexPolygon,
  polygonArea,
  polygonPerimeter,
  polygonPyramidRise,
  classifyPolygonRoof,
  decomposeRectilinearPolygon,
  polygonSplitAtReflexBisector,
  polygonDecomposeToConvex,
  computePolygonGable,
  computePolygonShed,
  penetrationCounts,
  type RoofType,
} from '../RoofGraph';

/** RoofGraph roof-type → FL estimator roof-type (1:1 for the four we draw). */
const ROOF_TYPE_BRIDGE: Record<RoofType, RoofTypeFL> = {
  hip: 'hip',
  gable: 'gable',
  shed: 'shed',
  flat: 'flat',
};

/**
 * Phase 14.R.7 — mean-roof-height above grade for ASCE 7-22 wind
 * pressure. Returns the height ASCE's Kz factor will see for this
 * section, so a second-story dormer at z=12 correctly experiences
 * higher velocity pressure than the main roof at grade.
 *
 * Components:
 *   1. Eave height = `max(section.z, baseMeanHeightFt)`.
 *      Contractors typically draw ground-floor sections with z=0
 *      and rely on the form's `mean_height_ft` default (10 ft = a
 *      normal wall). Explicitly raised sections (section.z > 0)
 *      represent an upper floor or elevated addition, in which
 *      case section.z IS the literal eave elevation — the base
 *      default no longer applies.
 *   2. Offset = mean of (eave, ridge) MINUS the eave:
 *      • flat  → 0
 *      • shed  → rise(sec)        — shed ridge is `(slope/12)*run`
 *                                   above the eave; mean is half
 *                                   of that. RoofGraph.rise() is
 *                                   `(slope/12)*(run/2)`, which
 *                                   happens to equal half the full
 *                                   shed rise — hence the identity.
 *      • gable → rise(sec) / 2    — eaves both at z, ridge at
 *                                   z+rise(sec); mean = z + rise/2.
 *      • hip   → rise(sec) / 2    — same as gable; the pyramid
 *                                   peak lives at rise(sec) above
 *                                   the eaves.
 */
export function sectionMeanHeightFt(
  section: Pick<RoofSection, 'z' | 'slope' | 'run' | 'roofType' | 'polygon' | 'roofAxisOverrideDeg'>,
  baseMeanHeightFt: number,
): number {
  const eaveHeight = Math.max(section.z, baseMeanHeightFt);
  const offset = roofHeightOffsetAboveEave(section);
  return eaveHeight + offset;
}

/**
 * Phase 14.R.9 — area- and perimeter-preserving rectangle for a
 * polygon footprint.
 *
 * Given a polygon with area A and perimeter P, find L, W such that:
 *    L * W   === A   (so material quantity lines up)
 *    2(L+W)  === P   (so drip edge / fascia lines up)
 *
 * L and W are the roots of `t² - (P/2)t + A = 0`:
 *    disc = (P/2)² - 4A
 *    L = (P/2 + √disc) / 2    (longer edge)
 *    W = (P/2 - √disc) / 2    (shorter edge)
 *
 * For compact shapes (high A/P — e.g. circles or near-regular
 * polygons) the discriminant goes negative, meaning no rectangle
 * has both the same area AND the same perimeter. In that case we
 * fall back to `L = W = √A`, which preserves area exactly at the
 * cost of under-reporting perimeter-derived line items.
 *
 * Exported for test coverage.
 */
export function equivalentRectangle(
  polygon: ReadonlyArray<readonly [number, number]>,
): { length_ft: number; width_ft: number } {
  const area = polygonArea(polygon);
  const perim = polygonPerimeter(polygon);
  if (area <= 0 || perim <= 0) {
    return { length_ft: 0, width_ft: 0 };
  }
  const halfP = perim / 2;
  const disc = halfP * halfP - 4 * area;
  if (disc < 0) {
    const s = Math.sqrt(area);
    return { length_ft: s, width_ft: s };
  }
  const sq = Math.sqrt(disc);
  return {
    length_ft: (halfP + sq) / 2,
    width_ft: Math.max((halfP - sq) / 2, 0.01),
  };
}

/**
 * Offset (feet) from the eave to the mean of the roof surface, by
 * roof type. Exported for tests + panel readouts that want to
 * separate "eave height" from "roof thickness".
 */
export function roofHeightOffsetAboveEave(
  section: Pick<RoofSection, 'slope' | 'run' | 'roofType' | 'polygon' | 'roofAxisOverrideDeg'>,
): number {
  // Phase 14.R.11 — convex polygon + hip is a pyramid with apex at
  // the centroid, so the mean roof height above the eave is HALF the
  // pyramid rise.
  // Phase 14.R.12 — rectilinear concave + hip decomposes into sub-
  // rects; each sub-rect is a rect-hip with rise = (slope/12)·(min
  // of halfL, halfR). The aggregate wind-height uses the MAX sub-
  // rect rise so pressure stays conservative (fasteners sized for
  // the tallest piece of the L/T/U).
  if (hasPolygon(section)) {
    const mode = classifyPolygonRoof(section);
    if (mode === 'pyramid') {
      return polygonPyramidRise(section.polygon, section.slope) / 2;
    }
    if (mode === 'rectilinear-union') {
      const rects = decomposeRectilinearPolygon(section.polygon);
      let maxRise = 0;
      for (const r of rects) {
        // rect-hip rise = (slope/12) · min(halfL, halfR)
        const halfMin = Math.min(r.w, r.h) / 2;
        const subRise = (section.slope / 12) * halfMin;
        if (subRise > maxRise) maxRise = subRise;
      }
      return maxRise / 2;
    }
    if (mode === 'skeleton-single-reflex') {
      // Phase 14.R.14 — each sub-polygon is a convex pyramid. Use
      // the MAX rise between the two halves for conservative wind.
      const split = polygonSplitAtReflexBisector(section.polygon);
      if (split) {
        const riseA = polygonPyramidRise(split.subPolyA, section.slope);
        const riseB = polygonPyramidRise(split.subPolyB, section.slope);
        return Math.max(riseA, riseB) / 2;
      }
    }
    if (mode === 'skeleton-multi-reflex') {
      // Phase 14.R.15 — max rise across every convex leaf of the
      // recursive decomposition. Conservative for wind pressure:
      // the tallest sub-pyramid sets the mean-roof-height offset.
      const decomp = polygonDecomposeToConvex(section.polygon);
      if (decomp) {
        let maxRise = 0;
        for (const leaf of decomp.convexLeaves) {
          const leafRise = polygonPyramidRise(leaf, section.slope);
          if (leafRise > maxRise) maxRise = leafRise;
        }
        return maxRise / 2;
      }
    }
    if (mode === 'gable-ridge-auto') {
      // Phase 14.R.16 — polygon gable mean roof height is half the
      // gable rise above the eave (eaves at z, ridge at z + rise).
      // Phase 14.R.20 — honors the section's axis override.
      const g = computePolygonGable(
        section.polygon, section.slope, section.roofAxisOverrideDeg,
      );
      if (g) return g.rise / 2;
    }
    if (mode === 'skeleton-gable') {
      // Phase 14.R.21 — concave + gable: compute the max gable rise
      // across every convex leaf. Conservative for wind pressure.
      const decomp = polygonDecomposeToConvex(section.polygon);
      if (decomp) {
        let maxRise = 0;
        for (const leaf of decomp.convexLeaves) {
          const g = computePolygonGable(
            leaf, section.slope, section.roofAxisOverrideDeg,
          );
          if (g && g.rise > maxRise) maxRise = g.rise;
        }
        return maxRise / 2;
      }
    }
    if (mode === 'shed-auto') {
      // Phase 14.R.17 — polygon shed: mean roof height above eave is
      // half the riseAtHigh (eave at z, ridge at z + riseAtHigh).
      // Phase 14.R.20 — honors the section's axis override.
      const s = computePolygonShed(
        section.polygon, section.slope, section.roofAxisOverrideDeg,
      );
      if (s) return s.riseAtHigh / 2;
    }
    return 0;
  }
  if (section.roofType === 'flat') return 0;
  if (section.roofType === 'shed') return rise(section);
  // gable + hip (rectangular) — symmetric roofs, mean is half of rise-to-ridge.
  return rise(section) / 2;
}

/**
 * Build a single-section `Project` for the FL estimator out of a drawn
 * `RoofSection` and the user's base inputs (county / system / etc).
 *
 * The `penetrationOverrides` arg lets the aggregator route penetrations
 * onto the largest section and zero out the rest.
 */
export function projectForSection(
  section: RoofSection,
  base: Project,
  penetrationOverrides?: {
    plumbing_vent_count?: number;
    skylight_count?: number;
    chimney_count?: number;
  },
): Project {
  // Phase 14.R.9 — polygon sections: derive an area- AND
  // perimeter-preserving equivalent rectangle so the FL estimator
  // (which sees `length_ft`, `width_ft` plus the roof_type) returns
  // BOM quantities that match the polygon's real footprint.
  //
  // Phase 14.R.11 — when the polygon is convex AND the user chose
  // `hip`, the estimator runs as a hip roof at the section's slope
  // (pyramid geometry). Non-convex-hip, gable, shed, and flat all
  // fall through to the flat estimator (roof_type='flat', slope=0)
  // — this matches what the 3D renderer does, so BOM agrees with
  // what the user sees on canvas. A future phase may implement
  // polygon + gable (ridge axis) and polygon + shed (slope dir).
  const polygonOverride = hasPolygon(section)
    ? equivalentRectangle(section.polygon)
    : null;
  // Phase 14.R.12 — classifyPolygonRoof unifies the three supported
  // polygon render modes. Hip is live for both convex (pyramid) AND
  // rectilinear-concave (L/T/U, via sub-rect decomposition); the FL
  // estimator gets roof_type='hip' in both cases since the BOM math
  // is driven by the area- + perimeter-preserving equivalent rect.
  const polyMode = hasPolygon(section) ? classifyPolygonRoof(section) : null;

  let roofTypeOut: RoofTypeFL;
  let slopePitchOut: string;
  if (!polygonOverride) {
    roofTypeOut = ROOF_TYPE_BRIDGE[section.roofType];
    slopePitchOut = `${section.slope}:12`;
  } else if (
    polyMode === 'pyramid'
    || polyMode === 'rectilinear-union'
    || polyMode === 'skeleton-single-reflex'
    || polyMode === 'skeleton-multi-reflex'
  ) {
    // Phase 14.R.14 — single-reflex non-rectilinear concave + hip is
    // also a hip in the FL estimator. The equivalent-rectangle L/W
    // keeps area + perimeter faithful; the FL wind + BOM modules
    // don't need to know which skeleton sub-case produced it.
    // Phase 14.R.15 — multi-reflex concave + hip joins the hip bucket
    // too: same equivalent-rectangle treatment, correct total area,
    // worst-case wind pressure from the tallest sub-pyramid.
    roofTypeOut = 'hip';
    slopePitchOut = `${section.slope}:12`;
  } else if (polyMode === 'gable-ridge-auto' || polyMode === 'skeleton-gable') {
    // Phase 14.R.16 — polygon gable with auto-axis ridge.
    // Phase 14.R.21 — concave + gable via skeleton decomposition
    // joins the gable bucket too: each convex leaf is itself a
    // gable, and the equivalent-rectangle L/W on the original
    // polygon still captures total area + perimeter faithfully.
    roofTypeOut = 'gable';
    slopePitchOut = `${section.slope}:12`;
  } else if (polyMode === 'shed-auto') {
    // Phase 14.R.17 — polygon shed tilts along the bbox short axis.
    // FL estimator's 'shed' type treats the whole roof as one slope
    // face; equivalent-rectangle L/W preserves area + perimeter.
    roofTypeOut = 'shed';
    slopePitchOut = `${section.slope}:12`;
  } else {
    roofTypeOut = 'flat';
    slopePitchOut = '0:12';
  }

  const roof: RoofGeometry = {
    length_ft: polygonOverride ? polygonOverride.length_ft : section.length,
    width_ft: polygonOverride ? polygonOverride.width_ft : section.run,
    // Phase 14.R.7 — per-section wind-height correction. A dormer
    // at z=12 ft lands in a higher Kz band than the main roof at
    // grade; routing them through one `base.roof.mean_height_ft`
    // collapsed that distinction and under-estimated pressure on
    // the elevated piece. sectionMeanHeightFt() restores it.
    mean_height_ft: sectionMeanHeightFt(section, base.roof.mean_height_ft),
    slope_pitch: slopePitchOut,
    roof_type: roofTypeOut,
    complexity: base.roof.complexity,
  };
  return createProject({
    county: base.county,
    roof,
    system: base.system,
    address: base.address,
    wood_species: base.wood_species,
    sheathing_thickness: base.sheathing_thickness,
    framing_spacing_in: base.framing_spacing_in,
    distance_to_saltwater_ft: base.distance_to_saltwater_ft,
    job_type: base.job_type,
    risk_category: base.risk_category,
    product_family: base.product_family,
    customer_name: base.customer_name,
    project_id: base.project_id,
    notes: base.notes,
    install_method: base.install_method,
    plumbing_vent_count:
      penetrationOverrides?.plumbing_vent_count ?? base.plumbing_vent_count,
    skylight_count:
      penetrationOverrides?.skylight_count ?? base.skylight_count,
    chimney_count:
      penetrationOverrides?.chimney_count ?? base.chimney_count,
  });
}

// ── Line-item merging ───────────────────────────────────────────

/**
 * Composite merge key. Treats null-valued fl_approval / noa_number
 * distinctly from missing, so an approved item + an unapproved item
 * with the same name stay separate.
 */
export function lineItemKey(li: LineItem): string {
  return [
    li.category,
    li.name,
    li.unit,
    li.fl_approval ?? '',
    li.noa_number ?? '',
  ].join('|');
}

export function mergeLineItems(groups: ReadonlyArray<ReadonlyArray<LineItem>>): LineItem[] {
  const byKey = new Map<string, LineItem>();
  for (const group of groups) {
    for (const li of group) {
      const key = lineItemKey(li);
      const existing = byKey.get(key);
      if (!existing) {
        // Clone so later mutations can't leak back into the source.
        byKey.set(key, { ...li });
        continue;
      }
      existing.quantity += li.quantity;
      existing.waste_factor_pct = Math.max(
        existing.waste_factor_pct,
        li.waste_factor_pct,
      );
      existing.confidence = worstConfidence(existing.confidence, li.confidence);
      existing.notes = mergeNotes(existing.notes, li.notes);
    }
  }
  return Array.from(byKey.values());
}

function mergeNotes(a: string | null, b: string | null): string | null {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;
  // Concat deduped + trimmed.
  const uniq = new Set<string>();
  for (const part of a.split(/[;\n]/)) uniq.add(part.trim());
  for (const part of b.split(/[;\n]/)) uniq.add(part.trim());
  uniq.delete('');
  return Array.from(uniq).join('; ');
}

// ── Zone merging ────────────────────────────────────────────────

export function mergeZones(zones: ReadonlyArray<ZoneProfile>): ZoneProfile {
  if (zones.length === 0) {
    return {
      a_dimension_ft: 0,
      zone_1_sqft: 0,
      zone_2e_sqft: 0,
      zone_2n_sqft: 0,
      zone_3e_sqft: 0,
      zone_3r_sqft: 0,
      interior_sqft: 0,
      perimeter_sqft: 0,
      corners_sqft: 0,
      total_plan_sqft: 0,
      sloped_area_sqft: 0,
      perimeter_fraction: 0,
      confidence: 'verified' as Confidence,
    };
  }
  if (zones.length === 1) return { ...zones[0]! };

  let a_dim = 0;
  let z1 = 0, z2e = 0, z2n = 0, z3e = 0, z3r = 0;
  let interior = 0, perim = 0, corners = 0;
  let plan = 0, sloped = 0;
  let weightedFraction = 0;
  const confidences: Confidence[] = [];
  for (const z of zones) {
    a_dim = Math.max(a_dim, z.a_dimension_ft);
    z1 += z.zone_1_sqft;
    z2e += z.zone_2e_sqft;
    z2n += z.zone_2n_sqft;
    z3e += z.zone_3e_sqft;
    z3r += z.zone_3r_sqft;
    interior += z.interior_sqft;
    perim += z.perimeter_sqft;
    corners += z.corners_sqft;
    plan += z.total_plan_sqft;
    sloped += z.sloped_area_sqft;
    weightedFraction += z.perimeter_fraction * z.total_plan_sqft;
    confidences.push(z.confidence);
  }
  const avgFraction = plan > 0 ? weightedFraction / plan : 0;
  return {
    a_dimension_ft: a_dim,
    zone_1_sqft: z1,
    zone_2e_sqft: z2e,
    zone_2n_sqft: z2n,
    zone_3e_sqft: z3e,
    zone_3r_sqft: z3r,
    interior_sqft: interior,
    perimeter_sqft: perim,
    corners_sqft: corners,
    total_plan_sqft: plan,
    sloped_area_sqft: sloped,
    perimeter_fraction: avgFraction,
    confidence: worstConfidence(...confidences),
  };
}

// ── Warning dedup ───────────────────────────────────────────────

export function warningKey(w: EstimateWarning): string {
  return [w.severity, w.category, w.message, w.reference ?? ''].join('|');
}

export function dedupeWarnings(ws: ReadonlyArray<EstimateWarning>): EstimateWarning[] {
  const seen = new Set<string>();
  const out: EstimateWarning[] = [];
  for (const w of ws) {
    const key = warningKey(w);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

// ── Top-level aggregate ─────────────────────────────────────────

export interface AggregateResult {
  estimate: Estimate | null;
  /** Error from the underlying estimator — typically "unknown county".
   *  Propagated so the UI can show it once, not N times. */
  error: string | null;
  /** Number of sections contributing to the merge. 0 when `sections`
   *  was empty (in which case the aggregator did nothing). */
  sectionCount: number;
}

/**
 * Phase 14.R.27 — resolve the effective penetration count per kind.
 *
 * Per-kind override rule: for each kind, if at least one spatial
 * marker has been placed, the placed count WINS over the
 * manually-entered form value. Kinds without any markers fall back
 * to the manual baseProject value, so a user who placed skylights
 * on the canvas but still wants to type "3 vents" in the inspector
 * gets the hybrid they expect.
 *
 * Exported for tests + UI readouts that want to show "counts as
 * seen by the estimator".
 */
export function resolvePenetrationCounts(
  baseProject: Project,
  penetrations: ReadonlyArray<RoofPenetration> | undefined,
): Record<PenetrationKind, number> {
  const spatial = penetrationCounts(penetrations ?? []);
  const placedAny: Record<PenetrationKind, boolean> = {
    plumbing_vent: spatial.plumbing_vent > 0,
    skylight: spatial.skylight > 0,
    chimney: spatial.chimney > 0,
  };
  return {
    plumbing_vent: placedAny.plumbing_vent ? spatial.plumbing_vent : baseProject.plumbing_vent_count,
    skylight:      placedAny.skylight      ? spatial.skylight      : baseProject.skylight_count,
    chimney:       placedAny.chimney       ? spatial.chimney       : baseProject.chimney_count,
  };
}

/**
 * Run the FL estimator once per section and merge into ONE estimate.
 * Returns `{ estimate: null, error }` on failure, `{ estimate: null,
 * error: null, sectionCount: 0 }` when `sections` is empty.
 *
 * Phase 14.R.27 — when `penetrations` is provided, spatial marker
 * counts override the manual form counts per kind (see
 * `resolvePenetrationCounts`). Omit to preserve pre-R.27 behaviour.
 */
export function aggregateEstimate(
  sections: ReadonlyArray<RoofSection>,
  baseProject: Project,
  penetrations?: ReadonlyArray<RoofPenetration>,
): AggregateResult {
  if (sections.length === 0) {
    return { estimate: null, error: null, sectionCount: 0 };
  }

  // Identify the "penetration carrier" — the largest section by plan
  // area. Ties broken by first-inserted (stable over the array).
  const largest = sections.reduce((best, s) =>
    areaPlan(s) > areaPlan(best) ? s : best,
    sections[0]!,
  );

  // Phase 14.R.27 — resolve counts once for the whole aggregate so
  // every per-section call sees identical numbers. The largest
  // section still carries the non-zero count; others get zero. This
  // preserves the original invariant that penetration-flashing line
  // items appear EXACTLY ONCE in the aggregate.
  const effectiveCounts = resolvePenetrationCounts(baseProject, penetrations);

  const perSection: Estimate[] = [];
  try {
    for (const sec of sections) {
      const isLargest = sec.sectionId === largest.sectionId;
      const project = projectForSection(sec, baseProject, {
        plumbing_vent_count: isLargest ? effectiveCounts.plumbing_vent : 0,
        skylight_count:      isLargest ? effectiveCounts.skylight      : 0,
        chimney_count:       isLargest ? effectiveCounts.chimney       : 0,
      });
      perSection.push(estimate(project));
    }
  } catch (err) {
    return {
      estimate: null,
      error: err instanceof Error ? err.message : String(err),
      sectionCount: sections.length,
    };
  }

  const firstEst = perSection[0]!;
  const wind: WindProfile = firstEst.wind;
  const sheathing: SheathingSpec | null = firstEst.sheathing;

  const lineItems = mergeLineItems(perSection.map((e) => e.line_items));
  const zones = mergeZones(perSection.map((e) => e.zones));
  const warnings = dedupeWarnings(
    perSection.flatMap((e) => e.warnings),
  );

  const agg: Estimate = {
    project: baseProject,
    wind,
    zones,
    sheathing,
    line_items: lineItems,
    warnings,
    generated_at: nowIsoUtc(),
    version: firstEst.version,
  };

  return { estimate: agg, error: null, sectionCount: sections.length };
}
