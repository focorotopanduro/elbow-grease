/**
 * Roofing Calculation Engine — Phase 14.R.0.
 *
 * Port of AROYH's `calc_engine.py` (BEIT Building Contractors —
 * Orlando, FL) to TypeScript. Every formula from the 9-sheet
 * Roofing_Master_Bilingual.xlsx, translated line-for-line so the
 * roofing estimator computes live as sections are drawn.
 *
 * Source reference:
 *   C:\LOVEDECIDES\WiLeads\elbow_grease\roofing\calc_engine.py
 *
 * Sheets covered:
 *   • Quick Estimator   → quickEstimate()
 *   • Slope Calculator  → slopeFromRiseRun(), riseFromSlopeRun(), …
 *   • Rafter & Ridge    → rafterRidge()
 *   • Roof Area         → sectionArea() + estimateMaterials() totals
 *   • Net vs Gross      → netVsGross()
 *   • Perimeter         → perimeterSimple/Recess/Hip/Gable()
 *   • Slope Factors     → slopeFactorTable()
 *   • Ft-In Converter   → ftToFtIn(), ftInToFt()
 *
 * Pure module. No React, no Zustand, no Three. All inputs are
 * numeric primitives; outputs are plain object records. Tests
 * drive the math directly and cross-check against the Python
 * reference implementation.
 */

// ── Types ────────────────────────────────────────────────────────

/**
 * Matches `RoofSection` dataclass from roof_graph.py — a single
 * rectangular roof section with a pitched top surface. The full
 * section type (with vertices, area_actual, etc.) will land in
 * R.1 when we port roof_graph.py; this slim version is enough
 * for the calc engine's consumption.
 */
export interface RoofSectionLike {
  sectionId: string;
  label: string;
  x: number;
  y: number;
  length: number;
  run: number;
  slope: number;
  roofType: 'gable' | 'hip' | 'shed';
  overhang: number;
  /** Computed: actual sloped-surface area (sf). */
  areaActual: number;
  /** Computed: plan perimeter (lf). */
  perimeterPlan: number;
  /** Computed: ridge length (lf). */
  ridgeLength: number;
}

// ── Slope fundamentals ─────────────────────────────────────────

/** √(1 + (slope/12)²) — common/jack rafter factor. */
export function slopeFactor(slope: number): number {
  if (slope <= 0) return 1;
  return Math.sqrt(1 + (slope / 12) ** 2);
}

/** √(2 + (slope/12)²) — hip/valley rafter factor × run. */
export function hipValleyFactor(slope: number): number {
  if (slope <= 0) return Math.SQRT2;
  return Math.sqrt(2 + (slope / 12) ** 2);
}

/** hip_valley_factor / √2 — factor × plan length. */
export function hipValleyPlanFactor(slope: number): number {
  return hipValleyFactor(slope) / Math.SQRT2;
}

/** Slope → angle in degrees (rise/12 run → degrees). */
export function roofAngleDeg(slope: number): number {
  if (slope <= 0) return 0;
  return (Math.atan(slope / 12) * 180) / Math.PI;
}

// ── Slope Calculator sheet (Eq 1-4 through 1-6) ──────────────────

/** Eq 1-4: Slope (X in 12) from rise and run in feet. */
export function slopeFromRiseRun(riseFt: number, runFt: number): number {
  if (runFt <= 0) return 0;
  return (riseFt / runFt) * 12;
}

/** Eq 1-5: Total rise (ft) from slope (X in 12) and run (ft). */
export function riseFromSlopeRun(slope: number, runFt: number): number {
  return (slope / 12) * runFt;
}

/** Run (ft) from slope (X in 12) and rise (ft). */
export function runFromSlopeRise(slope: number, riseFt: number): number {
  if (slope <= 0) return 0;
  return riseFt / (slope / 12);
}

/** Eq 1-5: Pitch = Rise / Span. */
export function pitchFromRiseSpan(riseFt: number, spanFt: number): number {
  if (spanFt <= 0) return 0;
  return riseFt / spanFt;
}

/** Eq 1-6: Slope = 2 × Pitch × 12. */
export function slopeFromPitch(pitch: number): number {
  return 2 * pitch * 12;
}

// ── Rafter & Ridge ──────────────────────────────────────────────

export interface RafterRidge {
  totalRun: number;
  totalRise: number;
  slopeFac: number;
  commonRafter: number;
  rafterWithOverhang: number;
  ridgeHip: number;
  ridgeGable: number;
  hipValleyPlan: number;
  hipValleyActual: number;
}

/** Replicate the Rafter & Ridge sheet for one section. */
export function rafterRidge(
  length: number,
  width: number,
  slope: number,
  overhang: number = 0,
): RafterRidge {
  const sf = slopeFactor(slope);
  const run = width / 2;
  const rise = (slope / 12) * run;
  const common = run > 0 ? Math.sqrt(run * run + rise * rise) : 0;
  const rafterOh = common + overhang * sf;
  const ridgeHip = Math.max(length - width, 0);
  const hipPlan = 1.414 * run;
  const hipActual = run > 0 ? Math.sqrt(hipPlan * hipPlan + rise * rise) : 0;
  return {
    totalRun: run,
    totalRise: rise,
    slopeFac: sf,
    commonRafter: common,
    rafterWithOverhang: rafterOh,
    ridgeHip,
    ridgeGable: length,
    hipValleyPlan: hipPlan,
    hipValleyActual: hipActual,
  };
}

// ── Perimeter calculations (Eq 1-2 through 1-11) ─────────────────

/** Eq 1-3: Simple rectangular perimeter. */
export function perimeterSimple(length: number, width: number): number {
  return 2 * (length + width);
}

/** Eq 1-2: Rectangular with recess. */
export function perimeterRecess(
  length: number,
  width: number,
  recess: number,
): number {
  return 2 * (length + width + recess);
}

/** Eq 1-7: Hip roof = 2(L+W) at eave level. */
export function perimeterHip(length: number, width: number): number {
  return 2 * (length + width);
}

/** Eq 1-11: Gable roof — rakes are slope-corrected. */
export function perimeterGable(
  length: number,
  width: number,
  slope: number,
): number {
  const sf = slopeFactor(slope);
  return 2 * length + width * sf;
}

// ── Waste & Net-vs-Gross (Net vs Gross sheet) ────────────────────

export interface WasteBreakdown {
  netArea: number;
  ridgeWaste: number;
  hipWaste: number;
  valleyWaste: number;
  edgeWaste: number;
  cuttingWaste: number;
  totalWaste: number;
  grossArea: number;
  wastePct: number;
}

/**
 * Replicate the Net vs Gross sheet — itemized waste breakdown.
 * Factors per ARMA / NRCA guidance:
 *   • Ridge cap overlap: 1.33 sf/lf
 *   • Hip & valley overlap: 1.5 sf/lf each
 *   • Edge trim loss: default 3%
 *   • Cutting / starter loss: default 5%
 */
export function netVsGross(
  netArea: number,
  opts: {
    ridgeLf?: number;
    hipLf?: number;
    valleyLf?: number;
    edgeWastePct?: number;
    cuttingWastePct?: number;
  } = {},
): WasteBreakdown {
  const {
    ridgeLf = 0,
    hipLf = 0,
    valleyLf = 0,
    edgeWastePct = 3,
    cuttingWastePct = 5,
  } = opts;

  const ridgeWaste = ridgeLf * 1.33;
  const hipWaste = hipLf * 1.5;
  const valleyWaste = valleyLf * 1.5;
  const edgeWaste = netArea * (edgeWastePct / 100);
  const cuttingWaste = netArea * (cuttingWastePct / 100);
  const totalWaste = ridgeWaste + hipWaste + valleyWaste + edgeWaste + cuttingWaste;
  const grossArea = netArea + totalWaste;
  const wastePct = netArea > 0 ? (totalWaste / netArea) * 100 : 0;
  return {
    netArea,
    ridgeWaste,
    hipWaste,
    valleyWaste,
    edgeWaste,
    cuttingWaste,
    totalWaste,
    grossArea,
    wastePct,
  };
}

// ── Material estimates ───────────────────────────────────────────

export interface MaterialEstimate {
  netAreaSf: number;
  grossAreaSf: number;
  wastePct: number;
  netSquares: number;
  grossSquares: number;
  shingleBundles: number;
  dripEdgePcs: number;
  starterBundles: number;
  ridgeCapBundles: number;
  feltRolls: number;
  syntheticRolls: number;
  iceWaterRolls: number;
  roofingNailsLbs: number;
  perimeterLf: number;
  ridgeLf: number;
}

const EMPTY_MATERIALS: MaterialEstimate = {
  netAreaSf: 0,
  grossAreaSf: 0,
  wastePct: 0,
  netSquares: 0,
  grossSquares: 0,
  shingleBundles: 0,
  dripEdgePcs: 0,
  starterBundles: 0,
  ridgeCapBundles: 0,
  feltRolls: 0,
  syntheticRolls: 0,
  iceWaterRolls: 0,
  roofingNailsLbs: 0,
  perimeterLf: 0,
  ridgeLf: 0,
};

/**
 * Compute full material quantities from drawn sections.
 * Coverage rules per standard roofing practice:
 *   • 3 bundles per square (shingle pack)
 *   • 10 ft per drip-edge piece
 *   • 105 LF per starter bundle
 *   • 33 LF per ridge-cap bundle
 *   • 400 SF per 15# felt roll
 *   • 1000 SF per synthetic underlayment roll
 *   • Ice & water ~ 15% of net SF at 200 SF per roll
 *   • 1.5 lbs of nails per square
 */
export function estimateMaterials(
  sections: ReadonlyArray<RoofSectionLike>,
  /** Kept for API parity with the Python version; overridden by
   *  the itemized `netVsGross()` below. Not used internally. */
  _wastePctHint: number = 15,
): MaterialEstimate {
  if (sections.length === 0) return { ...EMPTY_MATERIALS };

  let netAreaSf = 0;
  let perimeterLf = 0;
  let totalRidge = 0;
  let totalHipLf = 0;
  for (const sec of sections) {
    netAreaSf += sec.areaActual;
    perimeterLf += sec.perimeterPlan;
    totalRidge += sec.ridgeLength;
    if (sec.roofType === 'hip') {
      totalHipLf += 4 * (1.414 * (sec.run / 2 + sec.overhang));
    }
  }

  const wst = netVsGross(netAreaSf, {
    ridgeLf: totalRidge,
    hipLf: totalHipLf,
  });

  const grossAreaSf = wst.grossArea;
  const wastePct = wst.wastePct;
  const netSquares = netAreaSf / 100;
  const grossSquares = grossAreaSf / 100;

  const shingleBundles = Math.ceil(grossSquares * 3);
  const dripEdgePcs = Math.ceil(perimeterLf / 10);
  const starterBundles = Math.ceil(perimeterLf / 105);
  const capLf = totalRidge + totalHipLf;
  const ridgeCapBundles = capLf > 0 ? Math.ceil(capLf / 33) : 0;
  const feltRolls = Math.ceil(netAreaSf / 400);
  const syntheticRolls = Math.ceil(netAreaSf / 1000);
  const iceWaterRolls = Math.ceil((netAreaSf * 0.15) / 200);
  const roofingNailsLbs = Math.ceil(netSquares * 1.5);

  return {
    netAreaSf,
    grossAreaSf,
    wastePct,
    netSquares,
    grossSquares,
    shingleBundles,
    dripEdgePcs,
    starterBundles,
    ridgeCapBundles,
    feltRolls,
    syntheticRolls,
    iceWaterRolls,
    roofingNailsLbs,
    perimeterLf,
    ridgeLf: totalRidge,
  };
}

// ── Quick Estimator (all-in-one for simple roofs) ────────────────

export interface QuickEstimate {
  slopeFac: number;
  run: number;
  adjLength: number;
  adjWidth: number;
  commonRafter: number;
  totalRise: number;
  ridgeHip: number;
  ridgeGable: number;
  netArea: number;
  perimeter: number;
  materials: MaterialEstimate;
}

const EMPTY_QUICK: QuickEstimate = {
  slopeFac: 1,
  run: 0,
  adjLength: 0,
  adjWidth: 0,
  commonRafter: 0,
  totalRise: 0,
  ridgeHip: 0,
  ridgeGable: 0,
  netArea: 0,
  perimeter: 0,
  materials: { ...EMPTY_MATERIALS },
};

/** Single-call all-in-one estimate for a simple roof. */
export function quickEstimate(
  length: number,
  width: number,
  slope: number,
  overhang: number = 0,
  roofType: 'gable' | 'hip' | 'shed' = 'gable',
): QuickEstimate {
  if (length <= 0 || width <= 0 || slope <= 0) {
    return { ...EMPTY_QUICK, materials: { ...EMPTY_MATERIALS } };
  }
  const sf = slopeFactor(slope);
  const run = width / 2;
  const adjLength = length + 2 * overhang;
  const adjWidth = width + 2 * overhang;
  const commonRafter = (width / 2 + overhang) * sf;
  const totalRise = (slope / 12) * (width / 2);
  const ridgeHip = Math.max(length - width, 0);
  const ridgeGable = length;
  const netArea = adjLength * adjWidth * sf;
  const perimeter = roofType === 'hip'
    ? 2 * (adjLength + adjWidth)
    : 2 * adjLength + adjWidth * sf;

  // Wrap into a single-section material estimate.
  const sec: RoofSectionLike = {
    sectionId: 'quick',
    label: 'Quick',
    x: 0,
    y: 0,
    length,
    run: width,
    slope,
    roofType,
    overhang,
    areaActual: netArea,
    perimeterPlan: perimeter,
    ridgeLength: roofType === 'hip' ? ridgeHip : length,
  };
  const materials = estimateMaterials([sec]);

  return {
    slopeFac: sf,
    run,
    adjLength,
    adjWidth,
    commonRafter,
    totalRise,
    ridgeHip,
    ridgeGable,
    netArea,
    perimeter,
    materials,
  };
}

// ── Pricing engine ───────────────────────────────────────────────

export interface RoofingPrices {
  shingle_bundle: number;
  drip_edge_10ft: number;
  starter_bundle: number;
  ridge_cap_bundle: number;
  felt_roll: number;
  synthetic_roll: number;
  ice_water_roll: number;
  roofing_nails_lb: number;
  plywood_sheet: number;
  fascia_board_lf: number;
  drip_edge_metal: number;
}

export interface RoofingLabor {
  rate_per_hour: number;
  hours_per_square: number;
  tear_off_per_square: number;
  crew_size: number;
}

export const DEFAULT_ROOFING_PRICES: RoofingPrices = {
  shingle_bundle: 35.0,
  drip_edge_10ft: 8.5,
  starter_bundle: 28.0,
  ridge_cap_bundle: 35.0,
  felt_roll: 22.0,
  synthetic_roll: 65.0,
  ice_water_roll: 45.0,
  roofing_nails_lb: 3.5,
  plywood_sheet: 42.0,    // 4×8 CDX
  fascia_board_lf: 2.25,
  drip_edge_metal: 12.0,
};

export const DEFAULT_ROOFING_LABOR: RoofingLabor = {
  rate_per_hour: 45.0,
  hours_per_square: 1.5,
  tear_off_per_square: 0.75,
  crew_size: 4,
};

export interface PricingEstimate {
  materialCost: number;
  laborHours: number;
  laborCost: number;
  subtotal: number;
  overheadPct: number;
  overheadCost: number;
  profitPct: number;
  profitAmount: number;
  total: number;
  pricePerSquare: number;
}

export interface EstimatePricingOpts {
  prices?: Partial<RoofingPrices>;
  labor?: Partial<RoofingLabor>;
  overheadPct?: number;
  profitPct?: number;
  tearOff?: boolean;
}

/** Compute full job pricing from a material estimate. */
export function estimatePricing(
  mat: MaterialEstimate,
  opts: EstimatePricingOpts = {},
): PricingEstimate {
  const p = { ...DEFAULT_ROOFING_PRICES, ...(opts.prices ?? {}) };
  const lb = { ...DEFAULT_ROOFING_LABOR, ...(opts.labor ?? {}) };
  const overheadPct = opts.overheadPct ?? 15.0;
  const profitPct = opts.profitPct ?? 20.0;
  const tearOff = opts.tearOff ?? false;

  const materialCost =
    mat.shingleBundles * p.shingle_bundle
    + mat.dripEdgePcs * p.drip_edge_10ft
    + mat.starterBundles * p.starter_bundle
    + mat.ridgeCapBundles * p.ridge_cap_bundle
    + mat.feltRolls * p.felt_roll
    + mat.syntheticRolls * p.synthetic_roll
    + mat.iceWaterRolls * p.ice_water_roll
    + mat.roofingNailsLbs * p.roofing_nails_lb;

  const sq = Math.max(mat.netSquares, 0.1);
  const install = sq * lb.hours_per_square;
  const rip = tearOff ? sq * lb.tear_off_per_square : 0;
  const laborHours = install + rip;
  const laborCost = laborHours * lb.rate_per_hour * lb.crew_size;

  const subtotal = materialCost + laborCost;
  const overheadCost = (subtotal * overheadPct) / 100;
  const profitAmount = ((subtotal + overheadCost) * profitPct) / 100;
  const total = subtotal + overheadCost + profitAmount;
  const pricePerSquare = total / sq;

  return {
    materialCost,
    laborHours,
    laborCost,
    subtotal,
    overheadPct,
    overheadCost,
    profitPct,
    profitAmount,
    total,
    pricePerSquare,
  };
}

// ── Slope Factor table (Figure 1-19) ─────────────────────────────

export interface SlopeFactorRow {
  slope: number;
  commonFactor: number;
  hipValleyFactor: number;
  hipValleyPlan: number;
  degrees: number;
}

/** Generate the full slope-factor table (slopes 1-24 in 12). */
export function slopeFactorTable(): SlopeFactorRow[] {
  const rows: SlopeFactorRow[] = [];
  for (let s = 1; s <= 24; s++) {
    rows.push({
      slope: s,
      commonFactor: slopeFactor(s),
      hipValleyFactor: hipValleyFactor(s),
      hipValleyPlan: hipValleyPlanFactor(s),
      degrees: roofAngleDeg(s),
    });
  }
  return rows;
}

// ── Ft-In converter ──────────────────────────────────────────────

/** Convert decimal feet to feet'-inches" string (round to 1"). */
export function ftToFtIn(decimalFt: number): string {
  if (decimalFt <= 0) return `0'-0"`;
  let whole = Math.trunc(decimalFt);
  let inches = Math.round((decimalFt - whole) * 12);
  if (inches >= 12) {
    whole += 1;
    inches -= 12;
  }
  return `${whole}'-${inches}"`;
}

/** Convert feet + inches to decimal feet. */
export function ftInToFt(feet: number, inches: number): number {
  return feet + inches / 12;
}
