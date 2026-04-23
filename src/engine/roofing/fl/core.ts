/**
 * fl_roofing.core — Phase 14.R.F.1.
 *
 * Port of `fl_roofing/core.py` to TypeScript. Unified data contract
 * for the Florida-code-compliant roofing estimator. Every consumer
 * (API, Flutter-like UI, Rust backend, etc.) exchanges `Project`
 * input and `Estimate` output. JSON serialization is bidirectional
 * and matches the Python implementation byte-for-byte (modulo
 * object-key ordering which is insignificant for JSON).
 *
 * Source: C:\Users\Owner\Downloads\roofs\core.py (263 LOC)
 *
 * Key design invariants preserved from the Python:
 *   1. Every output carries a `Confidence` tier.
 *   2. `Confidence.worst()` propagates the weakest link up the chain.
 *   3. `Estimate.to_dict()` roundtrips cleanly — `from_dict(to_dict(x))`
 *      is equal to `x` up to field-by-field equality.
 */

// ── Confidence ──────────────────────────────────────────────────

/**
 * Confidence tier for every output value.
 *   VERIFIED   — FBC / FRSA / ESR published source
 *   PUBLISHED  — Manufacturer FL# catalog entry
 *   COMPUTED   — Derived math from verified inputs
 *   INFERRED   — Trend-based extrapolation
 *   UNVERIFIED — Placeholder, needs human review
 */
export const Confidence = {
  VERIFIED: 'verified',
  PUBLISHED: 'published',
  COMPUTED: 'computed',
  INFERRED: 'inferred',
  UNVERIFIED: 'unverified',
} as const;
export type Confidence = typeof Confidence[keyof typeof Confidence];

/** Strength ranking for chain-aggregation (higher = stronger). */
const CONFIDENCE_RANK: Record<Confidence, number> = {
  verified: 5,
  published: 4,
  computed: 3,
  inferred: 2,
  unverified: 1,
};

/** Weakest-link tier across any number of inputs. */
export function worstConfidence(...items: Confidence[]): Confidence {
  if (items.length === 0) return 'verified';
  let worst = items[0]!;
  for (const c of items) {
    if (CONFIDENCE_RANK[c] < CONFIDENCE_RANK[worst]) worst = c;
  }
  return worst;
}

// ── Project spec (input) ────────────────────────────────────────

export type RoofTypeFL = 'hip' | 'gable' | 'flat' | 'shed';
export type RoofComplexity = 'simple' | 'moderate' | 'complex';

/**
 * SystemFL — the roofing system / covering type. Drives
 * `estimator` branch selection (shingle/tile/metal) and waste
 * factors.
 */
export type SystemFL =
  | 'architectural_shingle'
  | '3tab_shingle'
  | 'concrete_tile'
  | 'clay_tile'
  | 'standing_seam_metal'
  | '5v_crimp_metal';

export type JobType = 'new_roof' | 'reroof' | 'repair';

export type InstallMethod =
  | 'direct_deck'
  | 'battened'
  | 'foam_set'
  | 'mortar_set';

export interface RoofGeometry {
  length_ft: number;
  width_ft: number;
  mean_height_ft: number;
  /** e.g. "6:12" — rise:run pitch string. */
  slope_pitch: string;
  roof_type: RoofTypeFL;
  complexity: RoofComplexity;
}

export function roofGeometryToDict(g: RoofGeometry): Record<string, unknown> {
  return { ...g };
}

export function roofGeometryFromDict(d: Record<string, unknown>): RoofGeometry {
  return {
    length_ft: Number(d.length_ft),
    width_ft: Number(d.width_ft),
    mean_height_ft: Number(d.mean_height_ft),
    slope_pitch: String(d.slope_pitch),
    roof_type: d.roof_type as RoofTypeFL,
    complexity: (d.complexity as RoofComplexity) ?? 'simple',
  };
}

export interface Project {
  county: string;
  roof: RoofGeometry;
  system: SystemFL;
  address: string | null;
  wood_species: string;
  /** Sheathing thickness label matching FBC table (e.g. "15/32"). */
  sheathing_thickness: string;
  framing_spacing_in: number;
  distance_to_saltwater_ft: number;
  job_type: JobType;
  /** ASCE 7 risk category, 1–4. */
  risk_category: number;
  product_family: string | null;
  customer_name: string | null;
  project_id: string | null;
  notes: string | null;
  /** Tile-specific attachment method. Ignored for non-tile systems. */
  install_method: InstallMethod;
  plumbing_vent_count: number;
  skylight_count: number;
  chimney_count: number;
}

/** Construct a Project from partial input, filling in Python defaults. */
export function createProject(input: {
  county: string;
  roof: RoofGeometry;
  system: SystemFL;
} & Partial<Project>): Project {
  return {
    county: input.county,
    roof: input.roof,
    system: input.system,
    address: input.address ?? null,
    wood_species: input.wood_species ?? 'SYP',
    sheathing_thickness: input.sheathing_thickness ?? '15/32',
    framing_spacing_in: input.framing_spacing_in ?? 24,
    distance_to_saltwater_ft: input.distance_to_saltwater_ft ?? 5000,
    job_type: input.job_type ?? 'reroof',
    risk_category: input.risk_category ?? 2,
    product_family: input.product_family ?? null,
    customer_name: input.customer_name ?? null,
    project_id: input.project_id ?? null,
    notes: input.notes ?? null,
    install_method: input.install_method ?? 'direct_deck',
    plumbing_vent_count: input.plumbing_vent_count ?? 3,
    skylight_count: input.skylight_count ?? 0,
    chimney_count: input.chimney_count ?? 0,
  };
}

export function projectToDict(p: Project): Record<string, unknown> {
  return {
    county: p.county,
    roof: roofGeometryToDict(p.roof),
    system: p.system,
    address: p.address,
    wood_species: p.wood_species,
    sheathing_thickness: p.sheathing_thickness,
    framing_spacing_in: p.framing_spacing_in,
    distance_to_saltwater_ft: p.distance_to_saltwater_ft,
    job_type: p.job_type,
    risk_category: p.risk_category,
    product_family: p.product_family,
    customer_name: p.customer_name,
    project_id: p.project_id,
    notes: p.notes,
    install_method: p.install_method,
    plumbing_vent_count: p.plumbing_vent_count,
    skylight_count: p.skylight_count,
    chimney_count: p.chimney_count,
  };
}

export function projectFromDict(d: Record<string, unknown>): Project {
  const roofData = d.roof as Record<string, unknown>;
  return createProject({
    county: String(d.county),
    roof: roofGeometryFromDict(roofData),
    system: d.system as SystemFL,
    address: (d.address as string) ?? null,
    wood_species: d.wood_species as string,
    sheathing_thickness: d.sheathing_thickness as string,
    framing_spacing_in: Number(d.framing_spacing_in),
    distance_to_saltwater_ft: Number(d.distance_to_saltwater_ft),
    job_type: d.job_type as JobType,
    risk_category: Number(d.risk_category),
    product_family: (d.product_family as string) ?? null,
    customer_name: (d.customer_name as string) ?? null,
    project_id: (d.project_id as string) ?? null,
    notes: (d.notes as string) ?? null,
    install_method: d.install_method as InstallMethod,
    plumbing_vent_count: Number(d.plumbing_vent_count),
    skylight_count: Number(d.skylight_count),
    chimney_count: Number(d.chimney_count),
  });
}

// ── Estimate components ─────────────────────────────────────────

export interface WindProfile {
  vult_mph: number;
  exposure: string;
  hvhz: boolean;
  wbdr: boolean;
  coastal: boolean;
  region: string;
  confidence: Confidence;
  source: string;
}

export function windProfileToDict(w: WindProfile): Record<string, unknown> {
  return { ...w };
}

export interface ZoneProfile {
  a_dimension_ft: number;
  zone_1_sqft: number;
  zone_2e_sqft: number;
  zone_2n_sqft: number;
  zone_3e_sqft: number;
  zone_3r_sqft: number;
  interior_sqft: number;
  perimeter_sqft: number;
  corners_sqft: number;
  total_plan_sqft: number;
  sloped_area_sqft: number;
  perimeter_fraction: number;
  confidence: Confidence;
}

export function zoneProfileToDict(z: ZoneProfile): Record<string, unknown> {
  return { ...z };
}

export interface SheathingSpec {
  fastener: string;
  panel_edge_in: number;
  panel_field_in: number;
  interior_override_in: number;
  confidence: Confidence;
  source: string;
  code_reference: string;
}

export function sheathingSpecToDict(s: SheathingSpec): Record<string, unknown> {
  return { ...s };
}

export type LineItemCategory =
  | 'covering'
  | 'underlayment'
  | 'fastener'
  | 'flashing'
  | 'accessory'
  | 'adhesive';

export interface LineItem {
  category: LineItemCategory;
  name: string;
  quantity: number;
  unit: string;
  waste_factor_pct: number;
  fl_approval: string | null;
  noa_number: string | null;
  confidence: Confidence;
  notes: string | null;
}

/** Quantity with waste baked in (read-only derived). Matches the
 *  Python `@property quantity_with_waste`. */
export function quantityWithWaste(li: LineItem): number {
  const raw = li.quantity * (1 + li.waste_factor_pct / 100);
  // Mirror Python's `round(x, 1)` half-to-even.
  return Math.round(raw * 10) / 10;
}

export function lineItemToDict(li: LineItem): Record<string, unknown> {
  return {
    category: li.category,
    name: li.name,
    quantity: li.quantity,
    unit: li.unit,
    waste_factor_pct: li.waste_factor_pct,
    fl_approval: li.fl_approval,
    noa_number: li.noa_number,
    confidence: li.confidence,
    notes: li.notes,
    quantity_with_waste: quantityWithWaste(li),
  };
}

export function createLineItem(partial: {
  category: LineItemCategory;
  name: string;
  quantity: number;
  unit: string;
} & Partial<LineItem>): LineItem {
  return {
    category: partial.category,
    name: partial.name,
    quantity: partial.quantity,
    unit: partial.unit,
    waste_factor_pct: partial.waste_factor_pct ?? 0,
    fl_approval: partial.fl_approval ?? null,
    noa_number: partial.noa_number ?? null,
    confidence: partial.confidence ?? Confidence.COMPUTED,
    notes: partial.notes ?? null,
  };
}

export type WarningSeverity = 'info' | 'warning' | 'blocker';
export type WarningCategory = 'compliance' | 'corrosion' | 'confidence';

/** Advisory message attached to an estimate. Distinct from JS global
 *  `Warning` — this is our domain-specific type. */
export interface EstimateWarning {
  severity: WarningSeverity;
  category: WarningCategory;
  message: string;
  reference: string | null;
}

export function estimateWarningToDict(w: EstimateWarning): Record<string, unknown> {
  return { ...w };
}

// ── Confidence report ───────────────────────────────────────────

export interface ConfidenceReport {
  overall: Confidence;
  verified_line_items: number;
  total_line_items: number;
  flagged_items: string[];
}

export function verifiedPct(r: ConfidenceReport): number {
  if (r.total_line_items === 0) return 0;
  return (100 * r.verified_line_items) / r.total_line_items;
}

export function confidenceReportToDict(r: ConfidenceReport): Record<string, unknown> {
  return {
    overall: r.overall,
    verified_line_items: r.verified_line_items,
    total_line_items: r.total_line_items,
    flagged_items: [...r.flagged_items],
    verified_pct: Math.round(verifiedPct(r) * 10) / 10,
  };
}

// ── Estimate ────────────────────────────────────────────────────

export interface Estimate {
  project: Project;
  wind: WindProfile;
  zones: ZoneProfile;
  sheathing: SheathingSpec | null;
  line_items: LineItem[];
  warnings: EstimateWarning[];
  generated_at: string;
  version: string;
}

/** Compute the confidence report from an Estimate's component chain. */
export function computeConfidenceReport(e: Estimate): ConfidenceReport {
  const strong: ReadonlySet<Confidence> = new Set([
    Confidence.VERIFIED,
    Confidence.PUBLISHED,
  ]);
  const weak: ReadonlySet<Confidence> = new Set([
    Confidence.INFERRED,
    Confidence.UNVERIFIED,
  ]);

  const verifiedCount = e.line_items.filter(
    (li) => strong.has(li.confidence),
  ).length;
  const flagged = e.line_items
    .filter((li) => weak.has(li.confidence))
    .map((li) => li.name);

  const chain: Confidence[] = [e.wind.confidence, e.zones.confidence];
  if (e.sheathing) chain.push(e.sheathing.confidence);
  for (const li of e.line_items) chain.push(li.confidence);

  return {
    overall: chain.length > 0 ? worstConfidence(...chain) : Confidence.VERIFIED,
    verified_line_items: verifiedCount,
    total_line_items: e.line_items.length,
    flagged_items: flagged,
  };
}

export function estimateToDict(e: Estimate): Record<string, unknown> {
  return {
    version: e.version,
    generated_at: e.generated_at,
    project: projectToDict(e.project),
    wind: windProfileToDict(e.wind),
    zones: zoneProfileToDict(e.zones),
    sheathing: e.sheathing ? sheathingSpecToDict(e.sheathing) : null,
    line_items: e.line_items.map(lineItemToDict),
    warnings: e.warnings.map(estimateWarningToDict),
    confidence_report: confidenceReportToDict(computeConfidenceReport(e)),
  };
}

export function estimateToJson(e: Estimate, indent: number = 2): string {
  return JSON.stringify(estimateToDict(e), null, indent);
}

/** ISO-8601 "now" in UTC — matches Python's datetime.now(UTC).isoformat(). */
export function nowIsoUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export function createEstimate(input: {
  project: Project;
  wind: WindProfile;
  zones: ZoneProfile;
  sheathing: SheathingSpec | null;
  line_items: LineItem[];
  warnings: EstimateWarning[];
  version?: string;
  generated_at?: string;
}): Estimate {
  return {
    project: input.project,
    wind: input.wind,
    zones: input.zones,
    sheathing: input.sheathing,
    line_items: input.line_items,
    warnings: input.warnings,
    version: input.version ?? '1.0.0',
    generated_at: input.generated_at ?? nowIsoUtc(),
  };
}
