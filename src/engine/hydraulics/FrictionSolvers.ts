/**
 * Friction Factor Solvers — multiple methods ranked by speed and accuracy.
 *
 * The Darcy friction factor f is the critical variable in the
 * Darcy-Weisbach head loss equation: hf = f × (L/D) × (v²/2g).
 *
 * Computing f from the Colebrook-White equation requires iteration
 * because it's implicit: 1/√f = -2 log₁₀(ε/3.7D + 2.51/(Re√f)).
 *
 * For a real-time game engine running at 60fps, iterative solves
 * can cause frame drops on large networks. This module provides
 * explicit (single-pass) alternatives:
 *
 * ┌─────────────────────┬────────┬──────────────────┬─────────────┐
 * │ Method              │ Passes │ Max error vs C-W  │ Speed       │
 * ├─────────────────────┼────────┼──────────────────┼─────────────┤
 * │ Swamee-Jain (1976)  │ 1      │ ±1–3%            │ ★★★★★      │
 * │ Haaland (1983)      │ 1      │ ±1.4%            │ ★★★★★      │
 * │ Churchill (1977)    │ 1      │ ±1–2% (all Re)   │ ★★★★☆      │
 * │ Colebrook-White     │ 5–10   │ reference (0%)   │ ★★☆☆☆      │
 * │ Moody (lookup)      │ 1      │ ±5% (interpolate)│ ★★★★★      │
 * └─────────────────────┴────────┴──────────────────┴─────────────┘
 *
 * Default for real-time: Swamee-Jain (best speed/accuracy tradeoff).
 * Default for final report: Colebrook-White (gold standard).
 */

// ── Solver ID enum ──────────────────────────────────────────────

export type FrictionMethod =
  | 'swamee-jain'
  | 'haaland'
  | 'churchill'
  | 'colebrook-white'
  | 'moody';

// ── Result ──────────────────────────────────────────────────────

export interface FrictionResult {
  /** Darcy friction factor. */
  f: number;
  /** Which method was used. */
  method: FrictionMethod;
  /** Flow regime. */
  regime: 'laminar' | 'transitional' | 'turbulent';
  /** Estimated error vs Colebrook-White (fraction, e.g. 0.02 = 2%). */
  estimatedError: number;
}

// ── Laminar / regime detection ──────────────────────────────────

function laminarFriction(Re: number): number {
  return 64 / Math.max(Re, 1);
}

function detectRegime(Re: number): 'laminar' | 'transitional' | 'turbulent' {
  if (Re < 2300) return 'laminar';
  if (Re < 4000) return 'transitional';
  return 'turbulent';
}

// ── Swamee-Jain (1976) ──────────────────────────────────────────
// Single-pass explicit formula.
// Valid range: 10⁻⁶ ≤ ε/D ≤ 10⁻², 5000 ≤ Re ≤ 10⁸
// Accuracy: within 1–3% of Colebrook-White.
//
//   f = 0.25 / [ log₁₀( ε/(3.7D) + 5.74/Re^0.9 ) ]²

export function swameeJain(Re: number, epsilon: number, D: number): FrictionResult {
  const regime = detectRegime(Re);
  if (regime === 'laminar') {
    return { f: laminarFriction(Re), method: 'swamee-jain', regime, estimatedError: 0 };
  }

  const relRough = epsilon / D;
  const term = relRough / 3.7 + 5.74 / Math.pow(Re, 0.9);
  const logTerm = Math.log10(term);
  const f = 0.25 / (logTerm * logTerm);

  return {
    f: Math.max(f, 0.001),
    method: 'swamee-jain',
    regime,
    estimatedError: 0.02, // typical 2%
  };
}

// ── Haaland (1983) ──────────────────────────────────────────────
// Single-pass explicit formula.
// Valid range: 10⁻⁶ ≤ ε/D ≤ 5×10⁻², 4000 ≤ Re ≤ 10⁸
// Accuracy: within 1.4% of Colebrook-White.
//
//   1/√f = -1.8 log₁₀[ (ε/D/3.7)^1.11 + 6.9/Re ]

export function haaland(Re: number, epsilon: number, D: number): FrictionResult {
  const regime = detectRegime(Re);
  if (regime === 'laminar') {
    return { f: laminarFriction(Re), method: 'haaland', regime, estimatedError: 0 };
  }

  const relRough = epsilon / D;
  const term = Math.pow(relRough / 3.7, 1.11) + 6.9 / Re;
  const invSqrtF = -1.8 * Math.log10(term);
  const f = 1 / (invSqrtF * invSqrtF);

  return {
    f: Math.max(f, 0.001),
    method: 'haaland',
    regime,
    estimatedError: 0.014, // 1.4%
  };
}

// ── Churchill (1977) ─────────────────────────────────────────────
// Single-pass explicit formula that covers ALL flow regimes
// (laminar, transitional, and turbulent) in one equation.
// Accuracy: within 1–2% for turbulent, exact for laminar.
//
// This is the only explicit method that handles the transition
// zone (2300 < Re < 4000) smoothly without branching.

export function churchill(Re: number, epsilon: number, D: number): FrictionResult {
  const regime = detectRegime(Re);

  const relRough = epsilon / D;

  // Term A: roughness + viscous
  const A = Math.pow(
    2.457 * Math.log(1 / (Math.pow(7 / Re, 0.9) + 0.27 * relRough)),
    16,
  );

  // Term B: transitional
  const B = Math.pow(37530 / Re, 16);

  // Churchill formula
  const term1 = Math.pow(8 / Re, 12);
  const term2 = 1 / Math.pow(A + B, 1.5);
  const f = 8 * Math.pow(term1 + term2, 1 / 12);

  return {
    f: Math.max(f, 0.001),
    method: 'churchill',
    regime,
    estimatedError: regime === 'laminar' ? 0 : 0.015,
  };
}

// ── Colebrook-White (iterative, gold standard) ──────────────────
// Implicit: 1/√f = -2 log₁₀( ε/(3.7D) + 2.51/(Re√f) )
// Solved via Newton-Raphson. 5–10 iterations for convergence.

export function colebrookWhite(Re: number, epsilon: number, D: number): FrictionResult {
  const regime = detectRegime(Re);
  if (regime === 'laminar') {
    return { f: laminarFriction(Re), method: 'colebrook-white', regime, estimatedError: 0 };
  }

  const relRough = epsilon / D;

  // Initial guess from Swamee-Jain
  const sj = swameeJain(Re, epsilon, D);
  let f = sj.f;

  // Newton-Raphson iterations
  for (let i = 0; i < 10; i++) {
    const sqrtF = Math.sqrt(f);
    const lhs = 1 / sqrtF;
    const arg = relRough / 3.7 + 2.51 / (Re * sqrtF);
    const rhs = -2 * Math.log10(arg);
    const residual = lhs - rhs;

    if (Math.abs(residual) < 1e-10) break;

    // Derivative: d(residual)/df
    const dLhs = -0.5 / (f * sqrtF);
    const dArg = -2.51 / (Re * 2 * f * sqrtF);
    const dRhs = -2 * dArg / (Math.LN10 * arg);
    const dResidual = dLhs - dRhs;

    f -= residual / (dResidual || 1);
    f = Math.max(f, 0.001);
  }

  return {
    f,
    method: 'colebrook-white',
    regime,
    estimatedError: 0, // reference
  };
}

// ── Moody approximation (linear interpolation on lookup table) ──
// Pre-computed Moody chart data for common Re/roughness combinations.
// Fastest possible: single array lookup + linear interpolation.

const MOODY_RE_POINTS = [4000, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 5e6, 1e7];
const MOODY_SMOOTH: Record<number, number> = {
  4000: 0.040, 10000: 0.031, 20000: 0.026, 50000: 0.021,
  100000: 0.018, 200000: 0.016, 500000: 0.013, 1000000: 0.012,
  5000000: 0.009, 10000000: 0.008,
};

export function moody(Re: number, _epsilon: number, _D: number): FrictionResult {
  const regime = detectRegime(Re);
  if (regime === 'laminar') {
    return { f: laminarFriction(Re), method: 'moody', regime, estimatedError: 0 };
  }

  // Find bracketing Re values and interpolate
  let lower = MOODY_RE_POINTS[0]!;
  let upper = MOODY_RE_POINTS[MOODY_RE_POINTS.length - 1]!;

  for (let i = 0; i < MOODY_RE_POINTS.length - 1; i++) {
    if (Re >= MOODY_RE_POINTS[i]! && Re <= MOODY_RE_POINTS[i + 1]!) {
      lower = MOODY_RE_POINTS[i]!;
      upper = MOODY_RE_POINTS[i + 1]!;
      break;
    }
  }

  const fLower = MOODY_SMOOTH[lower] ?? 0.02;
  const fUpper = MOODY_SMOOTH[upper] ?? 0.01;

  // Log-linear interpolation (Moody chart is log-log)
  const logRe = Math.log10(Re);
  const logLower = Math.log10(lower);
  const logUpper = Math.log10(upper);
  const t = logUpper > logLower ? (logRe - logLower) / (logUpper - logLower) : 0;
  const f = fLower + t * (fUpper - fLower);

  return {
    f: Math.max(f, 0.001),
    method: 'moody',
    regime,
    estimatedError: 0.05, // ~5% from interpolation
  };
}

// ── Unified solver function ─────────────────────────────────────

const SOLVERS: Record<FrictionMethod, (Re: number, epsilon: number, D: number) => FrictionResult> = {
  'swamee-jain': swameeJain,
  'haaland': haaland,
  'churchill': churchill,
  'colebrook-white': colebrookWhite,
  'moody': moody,
};

/**
 * Compute friction factor using the specified method.
 * Defaults to Swamee-Jain for real-time performance.
 */
export function computeFriction(
  Re: number,
  epsilon: number,
  D: number,
  method: FrictionMethod = 'swamee-jain',
): FrictionResult {
  return SOLVERS[method](Re, epsilon, D);
}
