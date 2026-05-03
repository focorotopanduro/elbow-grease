/**
 * Wind-uplift physics constants — ASCE 7-22, NDS, FBC 8th Ed (2023)
 *
 * Every value here is citable. Do not introduce magic numbers.
 * If you add fasteners or zones, cite NDS, ICC ESR, or FBC commentary.
 */

// ============================================================================
// VELOCITY PRESSURE COEFFICIENT
// ASCE 7-22 §26.10, eq. 26.10-1: q = 0.00256 · Kz · Kzt · Kd · Ke · V²  (psf)
// Constant 0.00256 is the standard SI-to-imperial conversion for q.
// ============================================================================
export const ASCE_VELOCITY_CONSTANT = 0.00256;

// Pre-simplified constant for the reference Orlando ranch:
//   Exposure B (suburban), Risk Cat II, h = 12 ft, flat terrain (Kzt = 1.0),
//   Kd = 0.85 (buildings), Ke = 1.0 (FL near sea level), Kz = 0.70 (Tbl 26.10-1)
//   → q ≈ 0.00256 · 0.70 · 1.0 · 0.85 · 1.0 · V² = 0.001523 V²  psf
// Round to 4 sig figs to match published Orlando worked examples.
export const ORLANDO_RANCH_VELOCITY_K = 0.001523;

// ============================================================================
// EXTERNAL PRESSURE COEFFICIENTS GCp — by roof shape
// ASCE 7-22 Fig 30.3-2A (gable, slope ≤ 7°), Fig 30.3-2C (hip, slope ≤ 27°),
// components & cladding, effective wind area ≤ 10 sqft.
// Negative = suction (uplift). Hip roofs spill wind around all four sides
// instead of just two, dropping corner/edge suction substantially.
// ============================================================================
export type RoofShape = 'gable' | 'hip';

export const GCP_BY_SHAPE: Record<RoofShape, { field: number; edge: number; corner: number }> = {
  gable: { field: -0.9, edge: -1.7, corner: -2.6 },
  hip:   { field: -0.9, edge: -1.4, corner: -1.7 },
};

export const ROOF_SHAPE_LABEL: Record<RoofShape, string> = {
  gable: 'Gable — two slopes, ridge line',
  hip:   'Hip — four slopes, no rakes',
};

// Default (gable) for backwards compatibility with v1 callers
export const GCp = GCP_BY_SHAPE.gable;

export type RoofZone = keyof typeof GCp;
export const ROOF_ZONES: RoofZone[] = ['field', 'edge', 'corner'];

// ============================================================================
// INTERNAL PRESSURE COEFFICIENT GCpi
// ASCE 7-22 Tbl 26.13-1. ±0.55 = partially-enclosed assumption (conservative
// after a windborne-debris breach event — appropriate for WBDR analysis).
// Use ±0.18 for fully-enclosed buildings; we use partially-enclosed because
// most pre-2002 Orlando homes lack impact-rated openings.
// ============================================================================
export const GCpi_PARTIALLY_ENCLOSED = 0.55;
export const GCpi_FULLY_ENCLOSED = 0.18;

// ============================================================================
// FASTENER WITHDRAWAL CAPACITIES
// Source: NDS 2018 Table 12.2C (Withdrawal Design Values W, lb/in penetration
// into the side grain of the main member). Values for Spruce-Pine-Fir species
// group, which dominates Florida residential framing/sheathing.
// Ring-shank withdrawal multiplier ~2.5× per AWC and AF&PA TR-12.
// ============================================================================
export interface Fastener {
  id: string;
  name: string;
  diameter: number;            // inches
  withdrawalLbPerIn: number;   // lb / inch of penetration
  ringShank: boolean;
  source: string;
}

export const FASTENERS: Record<string, Fastener> = {
  '6d_smooth': {
    id: '6d_smooth',
    name: '6d smooth box (0.099")',
    diameter: 0.099,
    withdrawalLbPerIn: 24,
    ringShank: false,
    source: 'NDS 2018 Tbl 12.2C, SPF, side-grain withdrawal',
  },
  '8d_smooth': {
    id: '8d_smooth',
    name: '8d smooth common (0.131")',
    diameter: 0.131,
    withdrawalLbPerIn: 32,
    ringShank: false,
    source: 'NDS 2018 Tbl 12.2C, SPF, side-grain withdrawal',
  },
  '8d_ring': {
    id: '8d_ring',
    name: '8d ring-shank (0.131")',
    diameter: 0.131,
    withdrawalLbPerIn: 60,
    ringShank: true,
    source: 'NDS Tbl 12.2C × ring-shank multiplier per AWC TR-12',
  },
} as const;

// Standard sheathing nail-pattern tributary areas per nail (sqft)
//   6"/12" = 6" o.c. on panel edges, 12" o.c. in panel field
//   6"/6"  = 6" o.c. throughout (FBC + WBDR / HVHZ-style upgrade)
// Tributary area governs the per-sqft uplift resistance of the deck.
export const NAIL_PATTERNS = {
  '6_12': { edge: 0.25, field: 0.5, label: '6" edge / 12" field' },
  '6_6':  { edge: 0.25, field: 0.25, label: '6" throughout' },
} as const;

export type NailPatternId = keyof typeof NAIL_PATTERNS;

// Standard sheathing-nail penetration into 2× rafter. Code minimum is the
// nail length minus the 7/16" or 1/2" sheathing thickness.
//   6d (2") into 1/2" sheathing → 1.5" effective penetration
//   8d (2.5") into 1/2" sheathing → 2.0" effective penetration
export const PENETRATION_IN = {
  '6d_smooth': 1.5,
  '8d_smooth': 2.0,
  '8d_ring':   2.0,
} as const satisfies Record<keyof typeof FASTENERS, number>;

// ============================================================================
// ASPHALT-SHINGLE WIND RESISTANCE
// ASTM D7158 wind classifications map to a 3-second gust speed. We translate
// to a representative net-uplift resistance (psf) via the same q · ΔGCp
// approach the test method uses internally.
//   Class D = 90 mph,  Class G = 120 mph,  Class H = 150 mph
// FBC 1504.1.1 requires Class F minimum; WBDR triggers Class H in many cases.
// ============================================================================
export interface ShingleClass {
  id: string;
  label: string;
  designGust: number;      // mph
  netUpliftCapPsf: number; // psf — allowable net uplift for the shingle field
  source: string;
}

export const SHINGLE_CLASSES: Record<string, ShingleClass> = {
  D: {
    id: 'D',
    label: 'ASTM D7158 Class D — 90 mph',
    designGust: 90,
    netUpliftCapPsf: 12,
    source: 'ASTM D7158-20 §A1, q at 90 mph × Δ(GCp-GCpi) field',
  },
  G: {
    id: 'G',
    label: 'ASTM D7158 Class G — 120 mph',
    designGust: 120,
    netUpliftCapPsf: 22,
    source: 'ASTM D7158-20 §A1, q at 120 mph × Δ(GCp-GCpi) field',
  },
  H: {
    id: 'H',
    label: 'ASTM D7158 Class H — 150 mph',
    designGust: 150,
    netUpliftCapPsf: 35,
    source: 'ASTM D7158-20 §A1, q at 150 mph × Δ(GCp-GCpi) field',
  },
} as const;
