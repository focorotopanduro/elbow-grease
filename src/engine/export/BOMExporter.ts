/**
 * BOM Exporter — generates procurement-ready Bill of Materials.
 *
 * Combines data from:
 *   - CutLengthOptimizer (stock pieces with minimal waste)
 *   - FittingGenerator (fitting counts by type/size)
 *   - FixtureFlowProfile (fixture specifications)
 *   - PipeMaterial cost tables (2026 contractor pricing)
 *
 * Output formats:
 *   - CSV  — importable into Excel, QuickBooks, contractor spreadsheets
 *   - JSON — machine-readable for API integration / procurement systems
 *
 * Each line item includes:
 *   - Description, material, size, quantity, unit, unit cost, total cost
 *   - Per-unit + total LABOR HOURS (Phase 13.A — HIGH-severity audit fix;
 *     the prior export omitted labor entirely, which is the dominant
 *     line-item on any real plumbing bid).
 *   - Supplier part number hint (generic, not brand-specific)
 *
 * See `docs/adr/030-bom-accuracy.md` for Phase 13.A audit findings
 * and the correctness guarantees this module provides.
 */

import type { CommittedPipe } from '../../store/pipeStore';
import type { FixtureInstance } from '../../store/fixtureStore';
import type { FittingInstance } from '../../ui/pipe/FittingGenerator';
import type { FixtureSubtype } from '../graph/GraphNode';
import { optimizeCutList, type CutListResult } from './CutLengthOptimizer';
import { COST_PER_FT, type PipeMaterial } from '../graph/GraphEdge';
import { logger } from '@core/logger/Logger';
// Phase 14.A — bid math. Keeping the import here (and NOT re-exporting
// computeBid from this module) means tests can still exercise
// generateBOM without pulling in the pricing surface.
import { computeBid, bidToCSVRows, type BidResult, type PricingProfile } from './computeBid';
import { evaluateFormula } from '@core/formula/formulaEngine';

const log = logger('BOM');

// ── Freshness metadata (Phase 13.B) ────────────────────────────
//
// All pricing + labor tables below are anchored to these values and
// must be updated in lockstep with them. A runtime check in
// `generateBOM` logs a warning if the data is older than
// `DATA_STALE_AFTER_DAYS` so bids on stale numbers don't go out
// silently. Reviewers: grep for "DATA_LAST_REVIEWED" annually and
// bump the date after a market-price + labor-rate pass.

/** ISO date (YYYY-MM-DD) of the last manual review of these tables. */
export const DATA_LAST_REVIEWED = '2025-01-15';

/** Primary references the current values were calibrated against. */
export const DATA_SOURCES = [
  'Ferguson Plumbing Supplies catalog (Q1 2025 pricing)',
  'Home Depot online pricing (Jan 2025)',
  'RSMeans Residential Plumbing 2025 — mean US-national labor productivity',
] as const;

/** Geographic region the labor rates are averaged across. */
export const DATA_REGION = 'US National (Florida-weighted for Beit Building Contractors)';

/** Staleness threshold — 365 days triggers the warn log. */
const DATA_STALE_AFTER_DAYS = 365;

// ── Fitting costs (per unit, 2025 contractor pricing) ──────────
//
// Source: Ferguson + Home Depot catalog averages, Q1 2025. Check the
// Freshness metadata above before trusting values that have aged > 1
// year — supplier price indices can move 5–12% annually.

const FITTING_COSTS: Record<string, Record<number, number>> = {
  elbow_90:         { 0.5: 0.85, 0.75: 1.20, 1: 1.80, 1.5: 3.50, 2: 5.00, 3: 12, 4: 22 },
  elbow_45:         { 0.5: 0.75, 0.75: 1.00, 1: 1.50, 1.5: 3.00, 2: 4.50, 3: 10, 4: 18 },
  bend_22_5:        { 0.5: 0.70, 0.75: 0.95, 1: 1.40, 1.5: 2.80, 2: 4.20, 3:  9, 4: 17 },
  bend_45:          { 0.5: 0.75, 0.75: 1.00, 1: 1.50, 1.5: 3.00, 2: 4.50, 3: 10, 4: 18 },
  bend_90:          { 0.5: 0.85, 0.75: 1.20, 1: 1.80, 1.5: 3.50, 2: 5.00, 3: 12, 4: 22 },
  bend_90_ls:       { 0.5: 1.00, 0.75: 1.50, 1: 2.20, 1.5: 4.50, 2: 6.50, 3: 15, 4: 27 },
  // Phase 14.V — Uponor ProPEX 90° elbow. Brass body; significantly
  // more expensive per fitting than a PVC 90° because the expansion-
  // ring fitting includes the ring and a barbed insert. Uponor
  // contractor pricing, 2024-era list.
  pex_elbow_90:     { 0.5: 3.50, 0.75: 4.80, 1: 7.50, 1.5: 14.00, 2: 22.00 },
  tee:              { 0.5: 1.20, 0.75: 1.80, 1: 2.50, 1.5: 5.00, 2: 8.00, 3: 18, 4: 32 },
  sanitary_tee:     { 1.5: 6.00, 2: 9.00, 3: 22, 4: 38 },
  wye:              { 1.5: 5.50, 2: 8.50, 3: 20, 4: 35 },
  // Phase 13.B — combo wye + 1/8 bend (DWV). Small premium over a
  // plain wye because the fitting bundles two geometries.
  combo_wye_eighth: { 1.5: 7.50, 2: 11.00, 3: 24, 4: 40 },
  cross:            { 1: 5.50, 1.5: 10.00, 2: 16.00, 3: 38, 4: 65 },
  coupling:         { 0.5: 0.40, 0.75: 0.55, 1: 0.80, 1.5: 1.50, 2: 2.50, 3: 5, 4: 9 },
  reducer:          { 0.75: 1.50, 1: 2.00, 1.5: 3.50, 2: 5.50, 3: 12, 4: 20 },
  // Phase 14.AD.12 — bushing (hub-by-spigot adapter). Priced slightly
  // below a reducer because it uses less material (no second hub).
  // Ferguson PVC bushing pricing, Q1 2025.
  bushing:          { 0.75: 1.20, 1: 1.75, 1.5: 3.00, 2: 4.75, 3: 10, 4: 17 },
  cap:              { 0.5: 0.30, 0.75: 0.40, 1: 0.60, 1.5: 1.00, 2: 1.50, 3: 3, 4: 5 },
  p_trap:           { 1.25: 8.00, 1.5: 10.00, 2: 14.00 },
  cleanout_adapter: { 1.5: 4.00, 2: 5.50, 3: 9.00, 4: 14.00 },
  // Phase 13.B — toilet closet flange (PVC 3" is by far the most
  // common; 4" for larger fixtures). Prior to this entry, every
  // closet flange fell back to the $5 default — a real cost error.
  closet_flange:    { 3: 6.50, 4: 12.00 },
  // Phase 13.B — PEX manifolds. Priced at a nominal 1" trunk
  // diameter which is the dominant residential spec (bigger trunks
  // would be priced by manufacturer quote, not this table).
  // Dangerous prior state: $5 default — manifolds are $40–300 parts
  // whose omission inflated apparent fitting margin on bids.
  manifold_2:       { 1: 45 },
  manifold_4:       { 1: 95 },
  manifold_6:       { 1: 155 },
  manifold_8:       { 1: 225 },
};

// ── Labor hours (Phase 13.A — new) ─────────────────────────────
//
// Installation time per fitting, person-hours. Industry ballpark for
// trained-journeyman work rates. Skilled helpers may be faster;
// awkward rough-in sequencing may be slower. Conservative enough to
// bid with, rounded to 0.05 hr granularity.
//
// Each value combines:
//   • position + align the fitting
//   • joint prep (primer, flux, solder, thread dope)
//   • joint make-up (glue, sweat, crimp, thread)
//   • visual inspection
//
// Bigger diameters are NOT linearly proportional — prep dominates
// small sizes while joint make-up dominates large sizes.

const LABOR_HR_PER_FITTING: Record<string, Record<number, number>> = {
  elbow_90:         { 0.5: 0.10, 0.75: 0.12, 1: 0.15, 1.5: 0.25, 2: 0.35, 3: 0.60, 4: 0.90 },
  elbow_45:         { 0.5: 0.09, 0.75: 0.11, 1: 0.14, 1.5: 0.22, 2: 0.32, 3: 0.55, 4: 0.80 },
  bend_22_5:        { 0.5: 0.08, 0.75: 0.10, 1: 0.13, 1.5: 0.20, 2: 0.28, 3: 0.50, 4: 0.72 },
  bend_45:          { 0.5: 0.09, 0.75: 0.11, 1: 0.14, 1.5: 0.22, 2: 0.32, 3: 0.55, 4: 0.80 },
  bend_90:          { 0.5: 0.10, 0.75: 0.12, 1: 0.15, 1.5: 0.25, 2: 0.35, 3: 0.60, 4: 0.90 },
  bend_90_ls:       { 0.5: 0.11, 0.75: 0.14, 1: 0.18, 1.5: 0.30, 2: 0.42, 3: 0.75, 4: 1.10 },
  // Phase 14.V — ProPEX elbow install: expansion-tool + ring set
  // before the elbow can be inserted. About 50% slower than a PVC
  // 90° for the crimp cycle.
  pex_elbow_90:     { 0.5: 0.15, 0.75: 0.18, 1: 0.22, 1.5: 0.36, 2: 0.50 },
  tee:              { 0.5: 0.15, 0.75: 0.18, 1: 0.22, 1.5: 0.35, 2: 0.50, 3: 0.85, 4: 1.30 },
  sanitary_tee:     { 1.5: 0.38, 2: 0.55, 3: 0.95, 4: 1.45 },
  wye:              { 1.5: 0.40, 2: 0.58, 3: 1.00, 4: 1.50 },
  // Phase 13.B — slight premium over plain wye for the extra joint.
  combo_wye_eighth: { 1.5: 0.48, 2: 0.68, 3: 1.10, 4: 1.65 },
  cross:            { 1: 0.30, 1.5: 0.50, 2: 0.70, 3: 1.20, 4: 1.80 },
  coupling:         { 0.5: 0.05, 0.75: 0.06, 1: 0.08, 1.5: 0.12, 2: 0.18, 3: 0.30, 4: 0.45 },
  reducer:          { 0.75: 0.09, 1: 0.11, 1.5: 0.18, 2: 0.26, 3: 0.44, 4: 0.65 },
  // Phase 14.AD.12 — bushing install labor. Slightly faster than
  // reducer because only one glue joint (the spigot side slips
  // directly into the host fitting's socket — no second prep pass).
  bushing:          { 0.75: 0.07, 1: 0.09, 1.5: 0.14, 2: 0.20, 3: 0.35, 4: 0.50 },
  cap:              { 0.5: 0.04, 0.75: 0.05, 1: 0.06, 1.5: 0.10, 2: 0.15, 3: 0.25, 4: 0.35 },
  p_trap:           { 1.25: 0.25, 1.5: 0.30, 2: 0.40 },
  cleanout_adapter: { 1.5: 0.20, 2: 0.28, 3: 0.50, 4: 0.75 },
  // Phase 13.B — closet flange install includes bolt-down to subfloor
  // + gasket seating + alignment with waste stub.
  closet_flange:    { 3: 0.35, 4: 0.45 },
  // Phase 13.B — manifold labor covers the manifold body mount + all
  // branch make-ups (more branches = more joints). Scales with port
  // count, not linearly with diameter.
  manifold_2:       { 1: 0.60 },
  manifold_4:       { 1: 0.95 },
  manifold_6:       { 1: 1.35 },
  manifold_8:       { 1: 1.75 },
};

/**
 * Labor hours per linear foot of pipe (material-dependent).
 * Covers the run itself + routine hangers; joint labor is counted on
 * the fitting, not the pipe.
 */
const LABOR_HR_PER_FT: Record<string, number> = {
  pvc_sch40:        0.030,   // standard DWV, fast glue-up
  pvc_sch80:        0.035,
  abs:              0.030,
  cpvc:             0.040,   // primer + cement + hot-water spec
  copper_type_l:    0.050,   // solder, clean + flux
  copper_type_m:    0.050,
  pex:              0.020,   // crimp, flexible routing
  pex_a:            0.020,
  pex_b:            0.020,
  galvanized_steel: 0.080,   // threaded, heavy
  cast_iron:        0.060,   // hub-and-spigot or no-hub, heavy
  // Phase 13.B — ductile_iron added (previously fell back to 0.035
  // default — underestimated labor for the heaviest pipe material).
  // Same handling complexity as cast iron; mechanical push-on joints.
  ductile_iron:     0.060,
};

function fittingCost(type: string, diameter: number): number {
  return lookupWithClosestSize(FITTING_COSTS, type, diameter, 5);
}

// ── Fixture costs (per unit, 2025 contractor pricing) ──────────
//
// Phase 14.AC.10 — fixture pricing finally enters the BOM. Before
// this, `type: 'fixture'` nodes existed in the solver DAG (as of
// 14.AC.6 + .7) but BOM read only pipe edges. A 3-bathroom bid
// omitted the fixtures themselves — the biggest single line-item
// category on any real residential quote.
//
// Source: Ferguson + Home Depot catalog averages, Q1 2025.
// Mid-range residential; upgrade tiers vary 2-4× on the high end.
// Reviewers: bump DATA_LAST_REVIEWED when these change.
//
// Fixtures the contractor doesn't supply (dishwasher, clothes
// washer) are flagged with zero material cost. Labor rough-in is
// still charged.
const FIXTURE_COSTS: Record<string, number> = {
  water_closet:            220,   // standard 1.28 gpf, two-piece
  lavatory:                110,   // drop-in basin + trim
  kitchen_sink:            210,   // single-bowl stainless
  bathtub:                 420,   // 60" alcove, enamel steel
  shower:                  160,   // faucet + valve trim (enclosure not included)
  floor_drain:              45,   // 2" PVC body + strainer
  laundry_standpipe:        30,   // just the P-trap + standpipe stub
  dishwasher:                0,   // customer-supplied appliance
  clothes_washer:            0,   // customer-supplied appliance
  hose_bibb:                30,   // freeze-proof sillcock
  urinal:                  350,   // flush valve included
  mop_sink:                280,   // floor-set basin + faucet
  drinking_fountain:       650,   // ADA-compliant bi-level
  water_heater:            800,   // 50 gal gas, mid-tier
  tankless_water_heater:  1100,   // gas condensing, ~190 kBTU
  bidet:                   320,   // floor-mount, non-electronic
  laundry_tub:             140,   // plastic, single-compartment
  utility_sink:            110,   // slop-sink, plastic
  expansion_tank:           55,   // 2-gal thermal expansion, sweated
  backflow_preventer:      240,   // 3/4" RPZ residential
  pressure_reducing_valve:  85,   // 3/4" adjustable
  cleanout_access:          25,   // ABS / PVC cleanout + cap
};

// Labor-hour averages for fixture rough-in + set. Covers:
//   • drain + trap make-up
//   • supply stops + risers
//   • unit set / level / shim / caulk
//   • final flush / leak check
// Does NOT cover finished-wall carpentry, tile, or trim-out.
// Calibrated to RSMeans 2025 mean productivity, Florida-weighted.
const LABOR_HR_PER_FIXTURE: Record<string, number> = {
  water_closet:            1.5,
  lavatory:                1.0,
  kitchen_sink:            1.5,
  bathtub:                 3.0,   // heaviest — frame + plumb + set
  shower:                  2.5,
  floor_drain:             0.5,
  laundry_standpipe:       0.5,
  dishwasher:              1.0,   // stub + supply + drain connect
  clothes_washer:          0.5,
  hose_bibb:               0.5,
  urinal:                  1.5,
  mop_sink:                1.5,
  drinking_fountain:       1.5,
  water_heater:            3.0,   // set + vent + gas + water + relief
  tankless_water_heater:   4.0,   // more vent / gas / mounting complexity
  bidet:                   1.5,
  laundry_tub:             1.0,
  utility_sink:            1.0,
  expansion_tank:          0.5,
  backflow_preventer:      1.0,
  pressure_reducing_valve: 0.5,
  cleanout_access:         0.25,
};

/**
 * Catalog fixture cost lookup. Returns 0 for unknown subtypes
 * rather than throwing, matching the fitting path's forgiveness —
 * a brand-new FixtureSubtype added upstream shouldn't crash a bid
 * export just because the cost table wasn't extended in lockstep.
 */
function fixtureCatalogCost(subtype: string): number {
  return FIXTURE_COSTS[subtype] ?? 0;
}

/**
 * Apply the three-tier fixture cost override chain, mirroring the
 * fitting path:
 *
 *   1. fixturePriceOverrides[subtype]   — vendor-quoted exact price
 *   2. fixtureCostFormulaOverrides[subtype] — shunting-yard formula
 *   3. FIXTURE_COSTS[subtype]           — catalog default
 *
 * Zero is a VALID vendor override (customer-supplied, free-goods
 * promo). Negative / non-finite falls through to the next tier —
 * corrupt-data guard.
 */
function fixtureCostWithOverride(
  subtype: string,
  profile: PricingProfile | undefined,
  laborHoursPerUnit: number,
  quantity: number,
): number {
  // Tier 1 — exact price override
  const priced = profile?.fixturePriceOverrides?.[subtype];
  if (typeof priced === 'number' && Number.isFinite(priced) && priced >= 0) {
    return priced;
  }

  // Tier 3 default (also used as `[materialCost]` in the formula
  // below).
  const catalog = fixtureCatalogCost(subtype);

  // Tier 2 — formula override
  const formula = profile?.fixtureCostFormulaOverrides?.[subtype];
  if (formula && formula.trim().length > 0) {
    const result = evaluateFormula(formula, {
      materialCost: catalog,
      laborHours: laborHoursPerUnit,
      quantity,
      laborRate: profile?.laborRateUsdPerHr ?? 0,
    });
    if (result.ok && Number.isFinite(result.value) && result.value >= 0) {
      return result.value;
    }
  }

  return catalog;
}

/** Labor hours per unit for a fixture subtype. */
function fixtureLaborHours(subtype: string): number {
  return LABOR_HR_PER_FIXTURE[subtype] ?? 0;
}

/**
 * Phase 14.AB.1 — apply an optional formula override from the
 * active pricing profile. Falls back to the static table lookup on:
 *   • no formula present for this type
 *   • empty / whitespace formula
 *   • formula evaluates to a non-finite value or error
 *
 * Exported so computeBid / tests can reuse the same override logic.
 */
export function fittingCostWithOverride(
  type: string,
  diameter: number,
  quantity: number,
  profile: import('./computeBid').PricingProfile,
): number {
  // Phase 14.AB.2 — static per-type × per-diameter price overrides
  // (populated from a vendor CSV import) take TOP priority. A
  // concrete quoted price IS the contractor's real cost; no
  // formula or catalog should override it.
  const priced = profile.fittingPriceOverrides?.[type]?.[diameter];
  if (typeof priced === 'number' && Number.isFinite(priced) && priced >= 0) {
    return priced;
  }

  const baseCost = fittingCost(type, diameter);
  const expr = profile.costFormulaOverrides?.[type];
  if (!expr || !expr.trim()) return baseCost;

  const baseLabor = fittingLaborHours(type, diameter);
  const r = evaluateFormula(expr, {
    materialCost: baseCost,
    laborHours: baseLabor,
    diameter,
    quantity,
    laborRate: profile.laborRateUsdPerHr,
  });
  if (!r.ok) {
    // Formula was wrong — don't silently corrupt the BOM. Fall back
    // to the static price + log once per mis-formula. Consumers
    // that want strict error propagation call evaluateFormula
    // directly instead of this helper.
    return baseCost;
  }
  return r.value;
}

function fittingLaborHours(type: string, diameter: number): number {
  return lookupWithClosestSize(LABOR_HR_PER_FITTING, type, diameter, 0.1);
}

function pipeLaborHoursPerFt(material: string): number {
  return LABOR_HR_PER_FT[material] ?? 0.035; // default: average glued-pipe rate
}

// ── Test-only exports (Phase 13.B coverage + freshness) ───────
//
// Exposed as readonly handles so the coverage test suite can enumerate
// table members without a parallel hardcoded list. Callers that
// mutate these would silently corrupt bids — never do that.

export const __testables = {
  FITTING_COSTS: FITTING_COSTS as Readonly<typeof FITTING_COSTS>,
  LABOR_HR_PER_FITTING: LABOR_HR_PER_FITTING as Readonly<typeof LABOR_HR_PER_FITTING>,
  LABOR_HR_PER_FT: LABOR_HR_PER_FT as Readonly<typeof LABOR_HR_PER_FT>,
  DATA_STALE_AFTER_DAYS,
};

/**
 * Find the cost/labor entry for an exact size, or the nearest-diameter
 * fallback. Returns `defaultValue` if the fitting type has no entries.
 */
function lookupWithClosestSize(
  table: Record<string, Record<number, number>>,
  type: string,
  diameter: number,
  defaultValue: number,
): number {
  const inner = table[type];
  if (!inner) return defaultValue;
  const sizes = Object.keys(inner).map(Number).sort((a, b) => a - b);
  if (sizes.length === 0) return defaultValue;
  const closest = sizes.reduce((prev, curr) =>
    Math.abs(curr - diameter) < Math.abs(prev - diameter) ? curr : prev,
  );
  return inner[closest] ?? defaultValue;
}

// ── BOM line item ───────────────────────────────────────────────

export interface BOMItem {
  category: 'pipe' | 'fitting' | 'fixture' | 'support' | 'misc';
  description: string;
  material: string;
  size: string;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  /** Phase 13.A — per-unit labor in person-hours. 0 for consumables. */
  unitLaborHours: number;
  /** Phase 13.A — total labor for this line (unitLaborHours × quantity). */
  laborHours: number;
  partHint: string;
}

export interface BOMReport {
  items: BOMItem[];
  subtotals: {
    pipe: number;
    fitting: number;
    fixture: number;
    support: number;
    misc: number;
  };
  grandTotal: number;
  /** Phase 13.A — total labor across every line item, in person-hours. */
  grandLaborHours: number;
  cutList: CutListResult;
  generatedAt: string;
  /**
   * Phase 14.A — bid-ready totals, populated when generateBOM is given
   * a PricingProfile. Raw BOMReport without `bid` is material + hours
   * only; with `bid` it's a full contractor-ready quote.
   */
  bid?: BidResult;
}

// ── Generate BOM ────────────────────────────────────────────────

/**
 * Phase 13.B — staleness check. Runs once per generateBOM call; the
 * log thresholding keeps it cheap. If it fires, the user's bid may be
 * drifting from current market prices and someone should do an
 * annual review pass (grep for DATA_LAST_REVIEWED).
 */
function checkDataFreshness(): void {
  const reviewedMs = Date.parse(DATA_LAST_REVIEWED);
  if (Number.isNaN(reviewedMs)) return;
  const ageDays = (Date.now() - reviewedMs) / (1000 * 60 * 60 * 24);
  if (ageDays > DATA_STALE_AFTER_DAYS) {
    log.warn('BOM pricing data is stale — annual review due', {
      lastReviewed: DATA_LAST_REVIEWED,
      ageDays: Math.round(ageDays),
      sources: DATA_SOURCES,
    });
  }
}

export interface GenerateBOMOptions {
  /**
   * Phase 14.H — pre-computed pipe support line items. When provided,
   * BOMExporter's built-in 4-ft-flat HANGER-STRAP rollup is REPLACED
   * by these items. Intended for use with `hangerPlanner.planToBOMItems`
   * which emits per-material, per-diameter support lines reflecting
   * IPC 308.5 / 308.7 spacing. When omitted, legacy behavior is used
   * (backward compatible).
   */
  supportItemsOverride?: BOMItem[];
}

export function generateBOM(
  pipes: CommittedPipe[],
  fittings: FittingInstance[],
  /**
   * Phase 14.A — optional pricing profile. When provided, the returned
   * report includes a `bid` field with full markup/tax/margin math.
   * When omitted, the report is material + hours only (old behavior
   * preserved for code paths that want raw take-off).
   */
  pricingProfile?: PricingProfile,
  /**
   * Phase 14.H — optional overrides bag. Currently just carries the
   * support-items-override; future knobs land here.
   */
  opts?: GenerateBOMOptions,
  /**
   * Phase 14.AC.10 — placed fixtures. When supplied, BOM emits one
   * line item per distinct `FixtureSubtype`, quantity = count of
   * fixtures of that subtype. Uses `FIXTURE_COSTS` +
   * `LABOR_HR_PER_FIXTURE` plus the pricing profile's fixture
   * overrides. When omitted or empty, behaviour is identical to
   * pre-14.AC.10 (no fixture lines).
   */
  fixtures: FixtureInstance[] = [],
): BOMReport {
  checkDataFreshness();

  const items: BOMItem[] = [];

  // ── Pipe stock (from cut list optimizer) ────────────────────
  const cutList = optimizeCutList(pipes);

  for (const summary of cutList.summary) {
    const mat = summary.material as PipeMaterial;
    const costTable = COST_PER_FT[mat];
    const sizes = costTable ? Object.keys(costTable).map(Number) : [];
    const closestSize = sizes.reduce(
      (prev, curr) => Math.abs(curr - summary.diameter) < Math.abs(prev - summary.diameter) ? curr : prev,
      sizes[0] ?? 0,
    );
    const costPerFt = costTable?.[closestSize] ?? 5;
    const laborPerFt = pipeLaborHoursPerFt(summary.material);

    items.push({
      category: 'pipe',
      description: `${summary.material.replace(/_/g, ' ')} ${summary.diameter}" pipe`,
      material: summary.material,
      size: `${summary.diameter}"`,
      quantity: summary.stockPiecesNeeded,
      unit: `${summary.stockLength}ft stick`,
      unitCost: costPerFt * summary.stockLength,
      totalCost: costPerFt * summary.totalStockLength,
      // Labor is proportional to INSTALLED length. CutListSummary
      // exposes `totalRequiredLength` = actual used footage (stock
      // minus waste offcuts). Using that here means cut-off scraps
      // don't bill for install time. Material cost stays proportional
      // to stock length (customer pays for the whole stick).
      unitLaborHours: laborPerFt * summary.stockLength,
      laborHours: laborPerFt * summary.totalRequiredLength,
      partHint: `${summary.material.toUpperCase()}-${summary.diameter}-${summary.stockLength}FT`,
    });
  }

  // ── Fittings (counted by type + diameter) ───────────────────
  //
  // The fitting's `material` column carries the first-seen material for
  // that (type, diameter) bucket. Designs that mix materials within one
  // bucket (unusual) will price per the first material. A future
  // extension can key buckets on (type, diameter, material).
  const fittingBuckets = new Map<
    string,
    { type: string; diameter: number; material: string; count: number }
  >();
  for (const f of fittings) {
    const key = `${f.type}|${f.diameter}`;
    const existing = fittingBuckets.get(key);
    if (existing) {
      existing.count++;
    } else {
      fittingBuckets.set(key, { type: f.type, diameter: f.diameter, material: f.material, count: 1 });
    }
  }

  for (const [, { type, diameter, material, count }] of fittingBuckets) {
    // Phase 14.AB.1 — pricing profile may carry a per-type formula
    // that overrides the static catalog cost. Falls back to the
    // catalog on missing / empty / malformed formulas.
    const cost = pricingProfile
      ? fittingCostWithOverride(type, diameter, count, pricingProfile)
      : fittingCost(type, diameter);
    const unitLabor = fittingLaborHours(type, diameter);
    items.push({
      category: 'fitting',
      description: `${type.replace(/_/g, ' ')} ${diameter}"`,
      material: String(material),
      size: `${diameter}"`,
      quantity: count,
      unit: 'ea',
      unitCost: cost,
      totalCost: cost * count,
      unitLaborHours: unitLabor,
      laborHours: unitLabor * count,
      partHint: `FIT-${type.toUpperCase()}-${diameter}`,
    });
  }

  // ── Fixtures (Phase 14.AC.10) ───────────────────────────────
  //
  // Group incoming fixtures by subtype, emit one line per group.
  // Cost path honors the profile's three-tier override chain
  // (price > formula > catalog) exactly like fittings. Labor
  // comes straight from LABOR_HR_PER_FIXTURE; no per-install
  // override lever yet (add a `fixtureLaborOverrides` field on
  // the profile if the customer base asks for it).
  if (fixtures.length > 0) {
    const bySubtype = new Map<string, FixtureInstance[]>();
    for (const f of fixtures) {
      if (!bySubtype.has(f.subtype)) bySubtype.set(f.subtype, []);
      bySubtype.get(f.subtype)!.push(f);
    }
    // Emit in stable alphabetical order so BOM diffs across runs
    // are readable.
    const subtypes = [...bySubtype.keys()].sort();
    for (const subtype of subtypes) {
      const group = bySubtype.get(subtype)!;
      const quantity = group.length;
      const unitLaborHours = fixtureLaborHours(subtype);
      const unitCost = fixtureCostWithOverride(
        subtype,
        pricingProfile,
        unitLaborHours,
        quantity,
      );
      const totalCost = unitCost * quantity;
      // Pretty description: "Water Closet" not "water_closet".
      const description = subtype
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      items.push({
        category: 'fixture',
        description,
        material: 'Fixture',
        size: 'standard',
        quantity,
        unit: 'ea',
        unitCost,
        totalCost,
        unitLaborHours,
        laborHours: unitLaborHours * quantity,
        partHint: `FIXTURE-${subtype.toUpperCase()}`,
      });
    }
  }

  // ── Pipe supports ───────────────────────────────────────────
  // Phase 14.H: when the caller supplies `supportItemsOverride`, the
  // hanger planner has already computed per-material, per-diameter
  // support rows (IPC 308.5 / 308.7). Use those verbatim.
  //
  // Otherwise, fall back to the legacy rollup: one hanger every 4 ft
  // of horizontal pipe, single "Steel / assorted" row. Less accurate,
  // but keeps every code path that doesn't know about the planner
  // green.
  if (opts?.supportItemsOverride !== undefined) {
    for (const item of opts.supportItemsOverride) items.push(item);
  } else {
    const totalHorizLength = cutList.totalUsedLength;
    const supportCount = Math.ceil(totalHorizLength / 4); // one every 4ft
    if (supportCount > 0) {
      items.push({
        category: 'support',
        description: 'Pipe hanger / strap',
        material: 'Steel',
        size: 'assorted',
        quantity: supportCount,
        unit: 'ea',
        unitCost: 1.50,
        totalCost: supportCount * 1.50,
        unitLaborHours: 0.08,                    // ~5 min per hanger
        laborHours: supportCount * 0.08,
        partHint: 'HANGER-STRAP',
      });
    }
  }

  // ── Primer and cement (PVC/ABS/CPVC) ────────────────────────
  const pvcPipes = pipes.filter((p) =>
    p.material.includes('pvc') || p.material.includes('abs') || p.material.includes('cpvc'),
  );
  if (pvcPipes.length > 0) {
    const canCount = Math.ceil(cutList.totalUsedLength / 200);
    items.push({
      category: 'misc',
      description: 'PVC primer (purple)',
      material: 'Chemical',
      size: '8oz',
      quantity: canCount,
      unit: 'can',
      unitCost: 6.50,
      totalCost: canCount * 6.50,
      unitLaborHours: 0,                       // consumable, no install labor
      laborHours: 0,
      partHint: 'PRIMER-PVC-8OZ',
    });
    items.push({
      category: 'misc',
      description: 'PVC cement (clear/blue)',
      material: 'Chemical',
      size: '8oz',
      quantity: canCount,
      unit: 'can',
      unitCost: 7.50,
      totalCost: canCount * 7.50,
      unitLaborHours: 0,
      laborHours: 0,
      partHint: 'CEMENT-PVC-8OZ',
    });
  }

  // ── Totals (Phase 13.A — single source of truth) ────────────
  //
  // Subtotals and grandTotal are both derived from the SAME item list
  // in ONE pass. The prior implementation summed subtotals independently
  // and then re-summed them for the grand total — two accumulation
  // passes that could disagree under float round-off. Now:
  //   grandTotal = Σ item.totalCost
  //   subtotals  = Σ item.totalCost WHERE item.category === X
  // Any disagreement would indicate an item with an unknown category —
  // we log a warn so it doesn't get silently swallowed.
  const subtotals = { pipe: 0, fitting: 0, fixture: 0, support: 0, misc: 0 };
  let grandTotal = 0;
  let grandLaborHours = 0;

  for (const it of items) {
    subtotals[it.category] += it.totalCost;
    grandTotal += it.totalCost;
    grandLaborHours += it.laborHours;
  }

  const subtotalSum = Object.values(subtotals).reduce((s, v) => s + v, 0);
  if (Math.abs(subtotalSum - grandTotal) > 0.01) {
    log.warn('BOM subtotal / grand-total mismatch', {
      subtotalSum, grandTotal, delta: grandTotal - subtotalSum,
    });
  }

  const report: BOMReport = {
    items,
    subtotals,
    grandTotal,
    grandLaborHours,
    cutList,
    generatedAt: new Date().toISOString(),
  };

  // Phase 14.A — if a pricing profile was supplied, attach the bid.
  // The bid math lives in computeBid — this module just carries the
  // result through so `bomToCSV` + JSON export can find it.
  if (pricingProfile) {
    report.bid = computeBid(report, pricingProfile);
  }

  return report;
}

// ── CSV export ──────────────────────────────────────────────────

export function bomToCSV(report: BOMReport): string {
  const header =
    'Category,Description,Material,Size,Qty,Unit,Unit Cost,Total Cost,Unit Labor Hrs,Total Labor Hrs,Part #';
  const rows = report.items.map((item) =>
    `${item.category},"${item.description}",${item.material},${item.size},${item.quantity},${item.unit},` +
    `$${item.unitCost.toFixed(2)},$${item.totalCost.toFixed(2)},` +
    `${item.unitLaborHours.toFixed(2)},${item.laborHours.toFixed(2)},` +
    `${item.partHint}`,
  );

  rows.push('');
  rows.push(`,,,,,,SUBTOTAL PIPE:,$${report.subtotals.pipe.toFixed(2)}`);
  rows.push(`,,,,,,SUBTOTAL FITTINGS:,$${report.subtotals.fitting.toFixed(2)}`);
  rows.push(`,,,,,,SUBTOTAL SUPPORTS:,$${report.subtotals.support.toFixed(2)}`);
  rows.push(`,,,,,,SUBTOTAL MISC:,$${report.subtotals.misc.toFixed(2)}`);
  rows.push(`,,,,,,GRAND TOTAL:,$${report.grandTotal.toFixed(2)}`);
  rows.push(`,,,,,,TOTAL LABOR HRS:,${report.grandLaborHours.toFixed(2)}`);
  rows.push('');
  rows.push(`,,,,,,Waste %:,${report.cutList.wastePercent.toFixed(1)}%`);
  rows.push(`,,,,,,Generated:,${report.generatedAt}`);

  // Phase 14.A — BID SUMMARY section appears at the bottom when a
  // pricing profile was supplied to generateBOM. Keeps the main BOM
  // rows intact so Excel importers reading just the material table
  // still work.
  if (report.bid) {
    rows.push(...bidToCSVRows(report.bid));
  }

  return [header, ...rows].join('\n');
}

// ── JSON export ─────────────────────────────────────────────────

export function bomToJSON(report: BOMReport): string {
  return JSON.stringify(report, null, 2);
}

// ── File download helper ────────────────────────────────────────

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
