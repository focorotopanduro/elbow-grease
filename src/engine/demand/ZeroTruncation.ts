/**
 * Zero-Truncated Poisson Binomial Distribution (ZTPBD).
 *
 * The standard PBD includes P(X = 0) — the probability that NO
 * fixtures are active. But for peak demand sizing, we condition on
 * "at least one fixture is in use" because we're designing for
 * the scenario where someone IS using water.
 *
 * The zero-truncated distribution:
 *   P_ZT(X = k) = P(X = k) / (1 - P(X = 0))    for k ≥ 1
 *   P_ZT(X = 0) = 0
 *
 * This is mathematically critical because:
 *   1. P(X = 0) can be large for small systems (e.g. 40% for a
 *      2-bathroom house during non-peak hours)
 *   2. Without truncation, the 99th percentile is pulled DOWN
 *      by the zero-flow mass, undersizing the pipe
 *   3. The ZTPBD gives the correct answer: "given someone is
 *      using water, what flow rate do we design for?"
 *
 * The ZTPBD is also the key to stagnation analysis:
 *   P(stagnation) = P(X = 0) from the un-truncated PBD
 *   tells us how often the system has zero flow, which
 *   correlates with Legionella/biofilm risk.
 */

import {
  poissonBinomialPMF,
  poissonBinomialPMF_DFT,
  pmfToCDF,
  quantile,
  type PBDStats,
  pdbStatistics,
} from './PoissonBinomial';

// ── ZTPBD result ────────────────────────────────────────────────

export interface ZTPBDResult {
  /** Original (un-truncated) PMF. */
  rawPMF: Float64Array;
  /** Zero-truncated PMF (P_ZT(X=k) for k=0..n, where k=0 is forced to 0). */
  truncatedPMF: Float64Array;
  /** Zero-truncated CDF. */
  truncatedCDF: Float64Array;
  /** P(X = 0) — probability of zero simultaneous usage (stagnation risk). */
  zeroProb: number;
  /** 1 - P(X = 0) — probability that at least one fixture is active. */
  nonZeroProb: number;
  /** Statistics of the truncated distribution. */
  stats: ZTPBDStats;
}

export interface ZTPBDStats extends PBDStats {
  /** Mean of the zero-truncated distribution. */
  truncatedMean: number;
  /** Variance of the zero-truncated distribution. */
  truncatedVariance: number;
}

// ── Compute ZTPBD ───────────────────────────────────────────────

/**
 * Compute the Zero-Truncated Poisson Binomial Distribution.
 *
 * @param probs — per-fixture probabilities of being active during peak
 * @returns Full ZTPBD result including both truncated and raw distributions
 */
export function computeZTPBD(probs: number[]): ZTPBDResult {
  // Choose algorithm based on fixture count
  const rawPMF = probs.length > 100
    ? poissonBinomialPMF_DFT(probs)
    : poissonBinomialPMF(probs);

  const zeroProb = rawPMF[0] ?? 1;
  const nonZeroProb = 1 - zeroProb;

  // Build truncated PMF
  const truncatedPMF = new Float64Array(rawPMF.length);
  if (nonZeroProb > 1e-15) {
    for (let k = 1; k < rawPMF.length; k++) {
      truncatedPMF[k] = rawPMF[k]! / nonZeroProb;
    }
  } else {
    // Edge case: all fixtures have p ≈ 0 (system is basically idle)
    // Set truncated PMF to uniform over k=1..n as fallback
    const n = rawPMF.length - 1;
    for (let k = 1; k <= n; k++) {
      truncatedPMF[k] = 1 / n;
    }
  }

  const truncatedCDF = pmfToCDF(truncatedPMF);

  // Compute statistics
  const rawStats = pdbStatistics(probs);
  let truncMean = 0;
  let truncMeanSq = 0;
  for (let k = 1; k < truncatedPMF.length; k++) {
    truncMean += k * truncatedPMF[k]!;
    truncMeanSq += k * k * truncatedPMF[k]!;
  }
  const truncVariance = truncMeanSq - truncMean * truncMean;

  return {
    rawPMF,
    truncatedPMF,
    truncatedCDF,
    zeroProb,
    nonZeroProb,
    stats: {
      ...rawStats,
      truncatedMean: truncMean,
      truncatedVariance: Math.max(0, truncVariance),
    },
  };
}

/**
 * Get the q-th quantile of the ZTPBD.
 * This is the key output: "at the 99th percentile, how many
 * fixtures are simultaneously active?"
 */
export function ztpbdQuantile(result: ZTPBDResult, q: number): number {
  return quantile(result.truncatedCDF, q);
}

/**
 * Compute the 99th percentile simultaneous fixture count.
 * This is the design value used for pipe sizing.
 */
export function designFixtureCount(probs: number[]): number {
  const result = computeZTPBD(probs);
  return ztpbdQuantile(result, 0.99);
}
