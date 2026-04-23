/**
 * fl_roofing.estimator — Phase 14.R.F.3.
 *
 * Port of `fl_roofing/estimator.py` (784 LOC) to TypeScript.
 * Single entry point: `estimate(project)` → `Estimate`.
 *
 * Composes:
 *   • Wind lookup (county → Vult, exposure, HVHZ, …)
 *   • ASCE 7-22 pressure-zone decomposition (Zone 1/2e/2n/3e/3r)
 *   • FBC R803.2.3.1 sheathing attachment matrix lookup
 *   • Covering-specific BOM builders (shingle / tile / metal)
 *   • Penetration flashing items (vents / skylights / chimneys)
 *   • Deck + underlayment + covering fastener quantities
 *   • Compliance + corrosion + confidence warnings
 *
 * Every output value carries a `Confidence` tier; the estimate's
 * overall confidence is the weakest link across the chain.
 *
 * Source ref:
 *   C:\Users\Owner\Downloads\roofs\extracted\fl_roofing\estimator.py
 */

import {
  type Confidence,
  type EstimateWarning,
  type Estimate,
  type LineItem,
  type Project,
  type RoofGeometry,
  type SheathingSpec,
  type SystemFL,
  type WindProfile,
  type ZoneProfile,
  Confidence as CC,
  createLineItem,
  createEstimate,
} from './core';
import {
  type ProductMatch,
  type SheathingSourceConfidence,
  loadWindZones,
  loadSheathingMatrix,
  lookupProduct,
} from './data';

// ── Wind profile ────────────────────────────────────────────────

/**
 * Resolve the wind profile for a project's county. Mirrors
 * Python `_resolve_wind()`. Throws when the county isn't in the
 * wind_zones data — caller (API layer) converts to HTTP 400.
 */
export function resolveWind(project: Project): WindProfile {
  const zones = loadWindZones();
  const z = zones[project.county.toLowerCase()];
  if (!z) {
    throw new Error(`County '${project.county}' not found in wind zones.`);
  }
  return {
    vult_mph: z.vult_peak_mph,
    exposure: z.exposure_default,
    hvhz: Boolean(z.hvhz_flag),
    wbdr: Boolean(z.wbdr_flag),
    coastal: Boolean(z.coastal_flag),
    region: z.region,
    confidence: CC.VERIFIED,
    source: `${z.county} County peak (conservative)`,
  };
}

// ── ASCE 7-22 pressure zones ────────────────────────────────────

/** Parse a pitch string like "6:12" → degrees from horizontal. */
function slopeDeg(pitch: string): number {
  const [riseStr, runStr] = pitch.split(':');
  const rise = Number(riseStr);
  const run = Number(runStr);
  if (!Number.isFinite(rise) || !Number.isFinite(run) || run === 0) return 0;
  return Math.atan(rise / run) * (180 / Math.PI);
}

/**
 * ASCE 7-22 "a" dimension — edge-zone width.
 *   a_upper = min(0.1 × least plan dim, 0.4 × mean roof height)
 *   a_lower = max(0.04 × least plan dim, 3 ft)
 *   a = max(a_upper, a_lower)
 */
function computeA(leastDim: number, meanHeight: number): number {
  const aUpper = Math.min(0.1 * leastDim, 0.4 * meanHeight);
  const aLower = Math.max(0.04 * leastDim, 3.0);
  return Math.max(aUpper, aLower);
}

/**
 * Decompose the roof plan into ASCE 7-22 pressure zones. Handles
 * the degenerate small-roof case (width or length ≤ 2·a) by
 * collapsing to a pure-perimeter profile.
 *
 * Matches Python `_compute_zones()` field-by-field.
 */
export function computeZones(roof: RoofGeometry): ZoneProfile {
  const a = computeA(roof.width_ft, roof.mean_height_ft);
  const L = roof.length_ft;
  const W = roof.width_ft;
  const total = L * W;
  const slopeFactor = 1.0 / Math.cos((slopeDeg(roof.slope_pitch) * Math.PI) / 180);
  const sloped = total * slopeFactor;

  if (W <= 2 * a || L <= 2 * a) {
    return {
      a_dimension_ft: a,
      zone_1_sqft: 0,
      zone_2e_sqft: total / 2,
      zone_2n_sqft: total / 2,
      zone_3e_sqft: 0,
      zone_3r_sqft: 0,
      interior_sqft: 0,
      perimeter_sqft: total,
      corners_sqft: 0,
      total_plan_sqft: total,
      sloped_area_sqft: sloped,
      perimeter_fraction: 1.0,
      confidence: CC.COMPUTED,
    };
  }

  const cornersTotal = 4 * a * a;
  const eaves = 2 * a * (L - 2 * a);
  const rakes = 2 * a * (W - 2 * a);
  const interior = (L - 2 * a) * (W - 2 * a);

  let zone3e: number;
  let zone3r: number;
  if (roof.roof_type === 'gable') {
    zone3e = 2 * a * a;
    zone3r = 2 * a * a;
  } else {
    zone3e = cornersTotal;
    zone3r = 0;
  }

  const perimeter = eaves + rakes + cornersTotal;
  return {
    a_dimension_ft: a,
    zone_1_sqft: interior,
    zone_2e_sqft: eaves,
    zone_2n_sqft: rakes,
    zone_3e_sqft: zone3e,
    zone_3r_sqft: zone3r,
    interior_sqft: interior,
    perimeter_sqft: perimeter,
    corners_sqft: cornersTotal,
    total_plan_sqft: total,
    sloped_area_sqft: sloped,
    perimeter_fraction: perimeter / total,
    confidence: CC.COMPUTED,
  };
}

// ── Sheathing attachment lookup ────────────────────────────────

/** Wood-species → specific-gravity map from Python. */
const SG_MAP: Record<string, number> = {
  SYP: 0.49, SP: 0.49, DF: 0.49, DFL: 0.49,
  HF: 0.42, SPF: 0.42,
};

const SHEATHING_CONFIDENCE_MAP: Record<SheathingSourceConfidence, Confidence> = {
  VERIFIED_FBC_FACT_SHEET: CC.VERIFIED,
  ENGINEERING_INFERENCE: CC.INFERRED,
  NEEDS_VERIFICATION: CC.UNVERIFIED,
};

/**
 * Look up the FBC R803.2.3.1 sheathing attachment spec for this
 * project. Returns null for unknown wood species OR when no row
 * matches the (exposure, SG, framing, thickness) filter.
 *
 * Picks the smallest-Vult row whose Vult ≥ project Vult (conservative).
 * If every candidate row is below project Vult, picks the highest-Vult
 * row (best-available, flagged via its confidence).
 */
export function resolveSheathing(
  project: Project,
  wind: WindProfile,
): SheathingSpec | null {
  const sg = SG_MAP[project.wood_species.toUpperCase()];
  if (sg === undefined) return null;

  const rows = loadSheathingMatrix();
  const candidates = rows.filter(
    (r) =>
      r.exposure === wind.exposure
      && r.wood_sg === sg
      && r.framing_spacing_in === project.framing_spacing_in
      && r.sheathing_thickness === project.sheathing_thickness,
  );
  if (candidates.length === 0) return null;

  const byVult = [...candidates].sort((a, b) => a.vult_mph - b.vult_mph);
  let matched = byVult.find((r) => r.vult_mph >= wind.vult_mph);
  if (!matched) {
    matched = byVult.reduce((best, r) =>
      r.vult_mph > best.vult_mph ? r : best,
    );
  }

  return {
    fastener: matched.fastener_ref,
    panel_edge_in: matched.panel_edge_spacing_in ?? 0,
    panel_field_in: matched.panel_field_spacing_in ?? 0,
    interior_override_in: matched.interior_zone_override_in ?? 6,
    confidence:
      SHEATHING_CONFIDENCE_MAP[matched.source_confidence] ?? CC.UNVERIFIED,
    source: `FBC R803.2.3.1 matrix row #${matched.id}`,
    code_reference: 'FBC R803.2.3.1',
  };
}

// ── BOM helpers ────────────────────────────────────────────────

function perimeterLf(roof: RoofGeometry): number {
  return 2 * (roof.length_ft + roof.width_ft);
}

/**
 * Approximate hip + ridge linear feet for a rectangular roof.
 *   hip:   4 hips × √2·(W/2) × slope factor, + ridge (L - W)
 *   gable: just the ridge (L)
 *   flat/shed: 0
 */
function hipRidgeLf(roof: RoofGeometry): number {
  if (roof.roof_type === 'hip') {
    const slopeFactor = 1.0 / Math.cos((slopeDeg(roof.slope_pitch) * Math.PI) / 180);
    const hipPlan = Math.sqrt(2 * (roof.width_ft / 2) ** 2);
    const hipTrue = hipPlan * slopeFactor;
    const ridge = Math.max(roof.length_ft - roof.width_ft, 0);
    return 4 * hipTrue + ridge;
  }
  if (roof.roof_type === 'gable') return roof.length_ft;
  return 0;
}

function shingleWaste(roof: RoofGeometry): number {
  const complexityAdd =
    roof.complexity === 'moderate' ? 3 : roof.complexity === 'complex' ? 6 : 0;
  const base = roof.roof_type === 'hip' ? 12 : roof.roof_type === 'gable' ? 8 : 5;
  return base + complexityAdd;
}

function tileWaste(roof: RoofGeometry): number {
  const complexityAdd =
    roof.complexity === 'moderate' ? 3 : roof.complexity === 'complex' ? 6 : 0;
  const base = roof.roof_type === 'hip' ? 14 : roof.roof_type === 'gable' ? 10 : 7;
  return base + complexityAdd;
}

// ── Covering-specific builders ─────────────────────────────────

function shingleCoveringItems(
  project: Project,
  zones: ZoneProfile,
  perim: number,
  product: ProductMatch | null,
): LineItem[] {
  const items: LineItem[] = [];
  const slopedSq = zones.sloped_area_sqft / 100;

  items.push(
    createLineItem({
      category: 'covering',
      name: project.product_family ?? 'Asphalt shingle (generic)',
      quantity: slopedSq,
      unit: 'square',
      waste_factor_pct: shingleWaste(project.roof),
      fl_approval: product?.fl_approval ?? null,
      noa_number: product?.noa_number ?? null,
      confidence: product ? CC.PUBLISHED : CC.COMPUTED,
    }),
  );
  items.push(
    createLineItem({
      category: 'covering',
      name: 'Starter strip',
      quantity: perim,
      unit: 'linear_ft',
      waste_factor_pct: 5,
      confidence: CC.COMPUTED,
    }),
  );

  const hrLf = hipRidgeLf(project.roof);
  if (hrLf > 0) {
    items.push(
      createLineItem({
        category: 'covering',
        name: 'Hip/ridge cap shingles',
        quantity: Math.ceil(hrLf / 33),
        unit: 'bundle',
        waste_factor_pct: 5,
        confidence: CC.COMPUTED,
        notes: `~${hrLf.toFixed(0)} lf hip/ridge @ 33 lf/bundle`,
      }),
    );
  }
  return items;
}

function tileCoveringItems(
  project: Project,
  _wind: WindProfile,
  zones: ZoneProfile,
  _perim: number,
  product: ProductMatch | null,
): LineItem[] {
  const items: LineItem[] = [];
  const slopedSq = zones.sloped_area_sqft / 100;
  const hrLf = hipRidgeLf(project.roof);
  const profile = product?.profile ?? 'flat';
  const isProfiled = ['s_tile', 'barrel', 'spanish', 'mission'].includes(profile);

  // Field tile
  items.push(
    createLineItem({
      category: 'covering',
      name: project.product_family ?? `${project.system} (generic)`,
      quantity: slopedSq,
      unit: 'square',
      waste_factor_pct: tileWaste(project.roof),
      fl_approval: product?.fl_approval ?? null,
      noa_number: product?.noa_number ?? null,
      confidence: product ? CC.PUBLISHED : CC.COMPUTED,
      notes: product ? `Profile: ${profile}` : null,
    }),
  );

  // Starter tile (eave course): ~1 tile per lf of eave
  const eaveLf =
    project.roof.roof_type === 'hip'
      ? project.roof.length_ft * 2
      : project.roof.length_ft;
  items.push(
    createLineItem({
      category: 'covering',
      name: 'Starter tile (eave course)',
      quantity: eaveLf,
      unit: 'linear_ft',
      waste_factor_pct: 5,
      confidence: CC.COMPUTED,
      notes: 'Eave course starter; use same manufacturer as field tile',
    }),
  );

  // Hip and ridge tile (purpose-made)
  if (hrLf > 0) {
    items.push(
      createLineItem({
        category: 'covering',
        name: 'Hip/ridge tile',
        quantity: Math.ceil(hrLf),
        unit: 'ea',
        waste_factor_pct: 8,
        confidence: CC.COMPUTED,
        notes: `${hrLf.toFixed(0)} lf hip/ridge @ ~1 ft coverage per tile`,
      }),
    );
  }

  // Bird stops / eave closures (profiled tile only)
  if (isProfiled) {
    items.push(
      createLineItem({
        category: 'accessory',
        name: 'Bird stop / eave closure (26ga)',
        quantity: eaveLf,
        unit: 'linear_ft',
        waste_factor_pct: 8,
        confidence: CC.VERIFIED,
        notes: 'FRSA/TRI 7th Ed: required for S-tile, barrel, mission',
      }),
    );
  }

  // Install-method-specific items
  if (project.install_method === 'battened') {
    const battenLf = zones.sloped_area_sqft;
    items.push(
      createLineItem({
        category: 'accessory',
        name: 'Tile batten 1x2 PT',
        quantity: battenLf,
        unit: 'linear_ft',
        waste_factor_pct: 10,
        confidence: CC.COMPUTED,
        notes: 'Pressure-treated, exterior grade',
      }),
    );
  }

  if (project.install_method === 'foam_set') {
    // Polyset AH-160: ~90–100 tiles per kit
    const tilesPerSq = isProfiled ? 90 : 110;
    const approxTiles = slopedSq * tilesPerSq;
    const kits = Math.ceil(approxTiles / 90);
    items.push(
      createLineItem({
        category: 'adhesive',
        name: 'Polyset AH-160 (2-part polyurethane)',
        quantity: kits,
        unit: 'kit',
        waste_factor_pct: 18,
        fl_approval: 'FL5259',
        confidence: CC.PUBLISHED,
        notes: 'Qualified Applicator required; mix ratio 1.00-1.15',
      }),
    );
  }

  if (project.install_method === 'mortar_set') {
    const tilesPerSq = isProfiled ? 90 : 110;
    const approxTiles = slopedSq * tilesPerSq;
    const bags = Math.ceil(approxTiles / 85);
    items.push(
      createLineItem({
        category: 'adhesive',
        name: 'Type S mortar (tile bedding)',
        quantity: bags,
        unit: 'bag',
        waste_factor_pct: 10,
        confidence: CC.COMPUTED,
        notes: 'RAS 117/118 in HVHZ; field-mix per manufacturer',
      }),
    );
  }

  // Hip/ridge nailer
  if (hrLf > 0) {
    items.push(
      createLineItem({
        category: 'accessory',
        name: 'Hip/ridge nailer (2x PT or cant bracket)',
        quantity: hrLf,
        unit: 'linear_ft',
        waste_factor_pct: 8,
        confidence: CC.VERIFIED,
        notes: 'FRSA/TRI 7th Ed; decay-resistant support required',
      }),
    );
  }

  return items;
}

function metalCoveringItems(
  project: Project,
  zones: ZoneProfile,
  _perim: number,
  product: ProductMatch | null,
): LineItem[] {
  const items: LineItem[] = [];
  const slopedSq = zones.sloped_area_sqft / 100;

  items.push(
    createLineItem({
      category: 'covering',
      name: project.product_family ?? `${project.system} (generic)`,
      quantity: slopedSq,
      unit: 'square',
      waste_factor_pct: 8,
      fl_approval: product?.fl_approval ?? null,
      noa_number: product?.noa_number ?? null,
      confidence: product ? CC.PUBLISHED : CC.COMPUTED,
    }),
  );

  const hrLf = hipRidgeLf(project.roof);
  if (hrLf > 0) {
    items.push(
      createLineItem({
        category: 'covering',
        name: 'Metal ridge/hip cap',
        quantity: hrLf,
        unit: 'linear_ft',
        waste_factor_pct: 8,
        confidence: CC.COMPUTED,
      }),
    );
    items.push(
      createLineItem({
        category: 'accessory',
        name: 'Closure strip (foam/butyl)',
        quantity: hrLf * 2,
        unit: 'linear_ft',
        waste_factor_pct: 5,
        confidence: CC.COMPUTED,
        notes: 'Two runs along each ridge/hip cap',
      }),
    );
  }
  return items;
}

// ── Penetration flashings ──────────────────────────────────────

function penetrationFlashingItems(project: Project): LineItem[] {
  const items: LineItem[] = [];

  if (project.plumbing_vent_count > 0) {
    const isMetal =
      project.system === 'standing_seam_metal' || project.system === '5v_crimp_metal';
    const name = isMetal
      ? 'EPDM pipe boot with aluminum band'
      : 'Lead pipe flashing 2.5 lb';
    const notes = isMetal
      ? 'Never use lead on aluminum/Galvalume (galvanic)'
      : 'Traditional FL standard for non-metal roofs';
    items.push(
      createLineItem({
        category: 'flashing',
        name,
        quantity: project.plumbing_vent_count,
        unit: 'ea',
        waste_factor_pct: 5,
        confidence: CC.VERIFIED,
        notes,
      }),
    );
  }

  if (project.skylight_count > 0) {
    items.push(
      createLineItem({
        category: 'flashing',
        name: 'Skylight flashing kit',
        quantity: project.skylight_count,
        unit: 'kit',
        waste_factor_pct: 0,
        confidence: CC.COMPUTED,
        notes: 'Manufacturer-matched to skylight model',
      }),
    );
  }

  if (project.chimney_count > 0) {
    items.push(
      createLineItem({
        category: 'flashing',
        name: 'Chimney flashing (step + counter + cricket)',
        quantity: project.chimney_count,
        unit: 'set',
        waste_factor_pct: 0,
        confidence: CC.COMPUTED,
        notes: 'Cricket required per FBC §R905.2.8.3 if width > 30"',
      }),
    );
  }

  return items;
}

// ── Main BOM generator ─────────────────────────────────────────

function generateLineItems(
  project: Project,
  wind: WindProfile,
  zones: ZoneProfile,
  sheathing: SheathingSpec | null,
): LineItem[] {
  const items: LineItem[] = [];
  const slopedSq = zones.sloped_area_sqft / 100;
  const perim = perimeterLf(project.roof);

  const product = lookupProduct(project.system, project.product_family);

  // Covering + covering-specific accessories
  if (project.system === 'architectural_shingle' || project.system === '3tab_shingle') {
    items.push(...shingleCoveringItems(project, zones, perim, product));
  } else if (project.system === 'concrete_tile' || project.system === 'clay_tile') {
    items.push(...tileCoveringItems(project, wind, zones, perim, product));
  } else if (project.system === 'standing_seam_metal' || project.system === '5v_crimp_metal') {
    items.push(...metalCoveringItems(project, zones, perim, product));
  }

  // Underlayment
  const isTile = project.system === 'concrete_tile' || project.system === 'clay_tile';
  let underlaymentName: string;
  let underlaymentRolls: number;
  if (isTile) {
    underlaymentName = 'Tile underlayment (TAS 103 P&S)';
    underlaymentRolls = Math.ceil(slopedSq / 2);
  } else if (wind.hvhz) {
    underlaymentName = 'Peel-and-stick underlayment (D1970) - HVHZ';
    underlaymentRolls = Math.ceil(slopedSq / 2);
  } else {
    underlaymentName = 'Synthetic underlayment (D8257)';
    underlaymentRolls = Math.ceil(slopedSq / 10);
  }
  items.push(
    createLineItem({
      category: 'underlayment',
      name: underlaymentName,
      quantity: underlaymentRolls,
      unit: 'roll',
      waste_factor_pct: 10,
      confidence: CC.COMPUTED,
    }),
  );

  // Drip edge
  items.push(
    createLineItem({
      category: 'flashing',
      name: 'Drip edge (aluminum 0.019")',
      quantity: perim,
      unit: 'linear_ft',
      waste_factor_pct: 8,
      confidence: CC.COMPUTED,
    }),
  );

  // Penetration flashings
  items.push(...penetrationFlashingItems(project));

  // Deck fasteners
  if (sheathing && sheathing.panel_edge_in > 0) {
    const perimDensity = (12 / sheathing.panel_edge_in) ** 2;
    const interiorDensity = (12 / sheathing.interior_override_in) ** 2;
    const totalNails = Math.trunc(
      zones.perimeter_sqft * perimDensity + zones.interior_sqft * interiorDensity,
    );
    items.push(
      createLineItem({
        category: 'fastener',
        name: `${sheathing.fastener} deck ring-shank nails`,
        quantity: totalNails,
        unit: 'ea',
        waste_factor_pct: 8,
        confidence: sheathing.confidence,
        notes: `Perim ${sheathing.panel_edge_in}"/interior ${sheathing.interior_override_in}" o.c.`,
      }),
    );
  } else if (sheathing) {
    items.push(
      createLineItem({
        category: 'fastener',
        name: `${sheathing.fastener} deck nails (SPEC TBD)`,
        quantity: 0,
        unit: 'ea',
        confidence: CC.UNVERIFIED,
        notes: 'Sheathing spec requires verification against FBC code book',
      }),
    );
  }

  // Covering fasteners
  if (project.system === 'architectural_shingle') {
    const total = Math.trunc(slopedSq * 384);
    items.push(
      createLineItem({
        category: 'fastener',
        name: 'Roofing nails 12ga HDG 1.25"-1.5"',
        quantity: total,
        unit: 'ea',
        waste_factor_pct: 10,
        confidence: CC.COMPUTED,
        notes: '6-nail high-wind pattern',
      }),
    );
  } else if (project.system === 'concrete_tile' || project.system === 'clay_tile') {
    if (project.install_method === 'direct_deck' || project.install_method === 'battened') {
      const tileProfile = (product?.profile ?? 'flat');
      const tilesPerSq = ['s_tile', 'barrel', 'spanish', 'mission'].includes(tileProfile)
        ? 90
        : 110;
      const approxTiles = slopedSq * tilesPerSq;
      const isCoastal = project.distance_to_saltwater_ft <= 3000;
      const fastenerName = isCoastal
        ? 'Tile screw #8 x 2.5" SS (coastal)'
        : 'Tile screw #8 x 2.5" HDG';
      items.push(
        createLineItem({
          category: 'fastener',
          name: fastenerName,
          quantity: Math.trunc(approxTiles * 2),
          unit: 'ea',
          waste_factor_pct: 5,
          confidence: CC.VERIFIED,
          notes: '2 fasteners per tile (high-wind); FBC §1507.3.6',
        }),
      );
    }

    // Nose clips at Vult ≥ 140 mph
    if (wind.vult_mph >= 140) {
      const eaveLf =
        project.roof.roof_type === 'hip'
          ? project.roof.length_ft * 2
          : project.roof.length_ft;
      const isCoastal = project.distance_to_saltwater_ft <= 3000;
      const clipName = isCoastal
        ? 'Tile nose clip (storm clip) SS'
        : 'Tile nose clip (storm clip) HDG';
      items.push(
        createLineItem({
          category: 'fastener',
          name: clipName,
          quantity: Math.trunc(eaveLf),
          unit: 'ea',
          waste_factor_pct: 8,
          confidence: CC.VERIFIED,
          notes: 'Required Vult ≥ 140 mph per FRSA/TRI 7th Ed',
        }),
      );
    }
  } else if (project.system === 'standing_seam_metal') {
    const clipsPerSq = wind.vult_mph >= 160 ? 24 : 16;
    items.push(
      createLineItem({
        category: 'fastener',
        name: 'Standing seam clip screws #10 x 1" SS',
        quantity: Math.trunc(slopedSq * clipsPerSq * 2),
        unit: 'ea',
        waste_factor_pct: 5,
        confidence: CC.COMPUTED,
        notes: `${clipsPerSq} clips/sq × 2 screws/clip`,
      }),
    );
  } else if (project.system === '5v_crimp_metal') {
    const isCoastal = project.distance_to_saltwater_ft <= 3000;
    const fastenerName = isCoastal
      ? 'Exposed panel screw #10 x 1.5" SS + EPDM'
      : 'Exposed panel screw #10 x 1.5" HDG + EPDM';
    items.push(
      createLineItem({
        category: 'fastener',
        name: fastenerName,
        quantity: Math.trunc(slopedSq * 80),
        unit: 'ea',
        waste_factor_pct: 5,
        confidence: CC.COMPUTED,
        notes: 'Through-panel with bonded EPDM washer',
      }),
    );
  }

  // Underlayment fasteners (skip for tile/HVHZ P&S)
  if (!isTile && !wind.hvhz) {
    const perSq = wind.vult_mph >= 120 ? 55 : 35;
    const metalReq = wind.vult_mph >= 150;
    items.push(
      createLineItem({
        category: 'fastener',
        name: metalReq ? 'Metal cap nails 1" ring-shank' : 'Cap nails 1"',
        quantity: Math.trunc(slopedSq * perSq),
        unit: 'ea',
        waste_factor_pct: 12,
        confidence: CC.COMPUTED,
        notes: metalReq ? 'Metal caps required Vult ≥ 150 mph' : null,
      }),
    );
  }

  return items;
}

// ── Warnings ────────────────────────────────────────────────────

function generateWarnings(
  project: Project,
  wind: WindProfile,
  sheathing: SheathingSpec | null,
): EstimateWarning[] {
  const warnings: EstimateWarning[] = [];

  if (wind.hvhz) {
    warnings.push({
      severity: 'warning',
      category: 'compliance',
      message:
        'HVHZ site: every envelope product requires Miami-Dade '
        + 'or Broward Product Control NOA. Verify each approval '
        + 'is current before permit submittal.',
      reference: 'FBC §1620',
    });
  }

  const d = project.distance_to_saltwater_ft;
  if (d <= 300) {
    warnings.push({
      severity: 'blocker',
      category: 'corrosion',
      message:
        `SS316 stainless fasteners required; aluminum panels only. `
        + `Site is within direct saltwater spray zone (${fmtInt(d)} ft).`,
      reference: 'FEMA Coastal',
    });
  } else if (d <= 1500) {
    warnings.push({
      severity: 'warning',
      category: 'corrosion',
      message:
        `Site is ${fmtInt(d)} ft from saltwater. SS304 minimum for all `
        + 'exposed fasteners; SS316 recommended.',
      reference: 'FEMA Coastal',
    });
  } else if (d <= 3000) {
    warnings.push({
      severity: 'info',
      category: 'corrosion',
      message:
        `Site is ${fmtInt(d)} ft from saltwater. HDG G185 minimum; `
        + 'SS304 recommended for exposed fasteners.',
      reference: 'FEMA Coastal',
    });
  }

  if (project.job_type === 'reroof') {
    warnings.push({
      severity: 'info',
      category: 'compliance',
      message:
        'Reroof: FBC-EB §706.7.1.2 requires deck re-nail '
        + 'evaluation. Budget supplemental RSRS-01 fasteners '
        + 'for existing deck upgrade.',
      reference: 'FBC-EB §706.7.1.2',
    });
  }

  if (
    sheathing
    && (sheathing.confidence === CC.INFERRED || sheathing.confidence === CC.UNVERIFIED)
  ) {
    warnings.push({
      severity: 'warning',
      category: 'confidence',
      message:
        `Sheathing spec confidence is '${sheathing.confidence}'. `
        + 'Verify against FBC R803.2.3.1 code book before permit.',
      reference: sheathing.source,
    });
  }

  if (wind.vult_mph >= 150) {
    warnings.push({
      severity: 'info',
      category: 'compliance',
      message: 'Vult ≥ 150 mph — plastic cap nails prohibited for underlayment.',
      reference: 'FBC §1507.1.1',
    });
  }

  return warnings;
}

/** Comma-formatted integer, matching Python's `f"{d:,.0f}"`. */
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

// ── Public entry point ─────────────────────────────────────────

/**
 * Single entry point. Takes a `Project`, returns a full `Estimate`
 * with wind profile, pressure zones, sheathing spec, BOM, warnings,
 * and a confidence report.
 *
 * Throws `Error("County '...' not found in wind zones")` when the
 * project's county isn't in the data. Callers at the API boundary
 * (Tauri IPC or a REST wrapper) should catch and convert to 400.
 */
export function estimate(project: Project): Estimate {
  const wind = resolveWind(project);
  const zones = computeZones(project.roof);
  const sheathing = resolveSheathing(project, wind);
  const line_items = generateLineItems(project, wind, zones, sheathing);
  const warnings = generateWarnings(project, wind, sheathing);

  return createEstimate({
    project,
    wind,
    zones,
    sheathing,
    line_items,
    warnings,
  });
}
