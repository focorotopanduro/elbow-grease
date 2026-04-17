/**
 * Bayesian Optimizer — multi-objective surrogate model.
 *
 * Uses a lightweight Gaussian Process (GP) approximation to predict
 * objective values for unvisited regions of the design space, then
 * selects the next-best candidate via Expected Improvement (EI).
 *
 * This is the "brain" that decides which route variations to suggest
 * next so the human engineer explores the most informative tradeoffs.
 */

import type { ObjectiveVector, RouteCandidate } from './ParetoFrontier';

// ── GP Surrogate (RBF kernel, simplified) ───────────────────────

interface Observation {
  /** Encoded feature vector of the route (length, bends, elevation Δ, etc.) */
  features: number[];
  /** Observed objective value for one objective. */
  value: number;
}

/** Radial Basis Function kernel. */
function rbfKernel(a: number[], b: number[], lengthScale: number): number {
  let sqDist = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sqDist += d * d;
  }
  return Math.exp(-sqDist / (2 * lengthScale * lengthScale));
}

/** Build the kernel matrix K(X, X) + noise. */
function buildKernelMatrix(
  obs: Observation[],
  lengthScale: number,
  noise: number,
): number[][] {
  const n = obs.length;
  const K: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const k = rbfKernel(obs[i]!.features, obs[j]!.features, lengthScale);
      K[i]![j] = k + (i === j ? noise : 0);
      K[j]![i] = K[i]![j]!;
    }
  }
  return K;
}

/** Cholesky decomposition (lower triangular). */
function cholesky(A: number[][]): number[][] {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) {
        sum += (L[i]![k] ?? 0) * (L[j]![k] ?? 0);
      }
      if (i === j) {
        L[i]![j] = Math.sqrt(Math.max(1e-10, (A[i]![i] ?? 0) - sum));
      } else {
        L[i]![j] = ((A[i]![j] ?? 0) - sum) / (L[j]![j] ?? 1e-10);
      }
    }
  }
  return L;
}

/** Solve Lx = b via forward substitution. */
function forwardSolve(L: number[][], b: number[]): number[] {
  const n = b.length;
  const x = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < i; j++) sum += (L[i]![j] ?? 0) * (x[j] ?? 0);
    x[i] = ((b[i] ?? 0) - sum) / (L[i]![i] ?? 1e-10);
  }
  return x;
}

/** Solve L^T x = b via back substitution. */
function backSolve(L: number[][], b: number[]): number[] {
  const n = b.length;
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = 0;
    for (let j = i + 1; j < n; j++) sum += (L[j]![i] ?? 0) * (x[j] ?? 0);
    x[i] = ((b[i] ?? 0) - sum) / (L[i]![i] ?? 1e-10);
  }
  return x;
}

// ── GP Prediction ───────────────────────────────────────────────

interface GPPrediction {
  mean: number;
  variance: number;
}

function gpPredict(
  obs: Observation[],
  queryFeatures: number[],
  lengthScale: number,
  noise: number,
): GPPrediction {
  if (obs.length === 0) return { mean: 0, variance: 1 };

  const K = buildKernelMatrix(obs, lengthScale, noise);
  const L = cholesky(K);
  const y = obs.map((o) => o.value);

  // alpha = K^{-1} y
  const alpha = backSolve(L, forwardSolve(L, y));

  // k* = kernel between query and each observation
  const kStar = obs.map((o) => rbfKernel(o.features, queryFeatures, lengthScale));

  // Predictive mean = k*^T alpha
  let mean = 0;
  for (let i = 0; i < kStar.length; i++) mean += (kStar[i] ?? 0) * (alpha[i] ?? 0);

  // Predictive variance = k(x*,x*) - k*^T K^{-1} k*
  const v = forwardSolve(L, kStar);
  let vNorm = 0;
  for (const vi of v) vNorm += vi * vi;
  const variance = Math.max(1e-8, 1.0 + noise - vNorm);

  return { mean, variance };
}

// ── Expected Improvement ────────────────────────────────────────

/** Standard normal CDF approximation (Abramowitz & Stegun). */
function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1 + sign * y);
}

function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Expected Improvement acquisition function. */
function expectedImprovement(mean: number, variance: number, bestSoFar: number): number {
  const std = Math.sqrt(variance);
  if (std < 1e-10) return 0;
  const z = (bestSoFar - mean) / std; // minimization
  return (bestSoFar - mean) * normalCDF(z) + std * normalPDF(z);
}

// ── Public Optimizer ────────────────────────────────────────────

export type RouteFeatureExtractor = (candidate: RouteCandidate) => number[];

export class BayesianOptimizer {
  private observations = new Map<keyof ObjectiveVector, Observation[]>();
  private lengthScale = 1.0;
  private noise = 0.01;
  private featureExtractor: RouteFeatureExtractor;

  constructor(featureExtractor: RouteFeatureExtractor) {
    this.featureExtractor = featureExtractor;
  }

  /** Record an evaluated route's objectives. */
  observe(candidate: RouteCandidate): void {
    const features = this.featureExtractor(candidate);
    for (const [key, value] of Object.entries(candidate.objectives)) {
      const k = key as keyof ObjectiveVector;
      if (!this.observations.has(k)) this.observations.set(k, []);
      this.observations.get(k)!.push({ features, value });
    }
  }

  /**
   * Score a candidate route's Expected Improvement across all objectives.
   * Returns a composite EI that the HILO coordinator uses to rank
   * which route variants to suggest next.
   */
  scoreCandidate(
    candidate: RouteCandidate,
    weights: ObjectiveVector,
  ): number {
    const features = this.featureExtractor(candidate);
    let compositeEI = 0;

    for (const [key, w] of Object.entries(weights)) {
      const k = key as keyof ObjectiveVector;
      const obs = this.observations.get(k) ?? [];
      if (obs.length === 0) {
        compositeEI += w; // maximum exploration when no data
        continue;
      }

      const bestSoFar = Math.min(...obs.map((o) => o.value));
      const pred = gpPredict(obs, features, this.lengthScale, this.noise);
      compositeEI += expectedImprovement(pred.mean, pred.variance, bestSoFar) * w;
    }

    return compositeEI;
  }

  /**
   * Given a pool of candidates, return the top-k most informative
   * ones to present to the human engineer.
   */
  selectNextBatch(
    pool: RouteCandidate[],
    weights: ObjectiveVector,
    k: number,
  ): RouteCandidate[] {
    const scored = pool.map((c) => ({
      candidate: c,
      ei: this.scoreCandidate(c, weights),
    }));
    scored.sort((a, b) => b.ei - a.ei);
    return scored.slice(0, k).map((s) => s.candidate);
  }

  /** Reset all observations (new design session). */
  reset(): void {
    this.observations.clear();
  }
}

// ── Default feature extractor ───────────────────────────────────

/** Extracts a numeric feature vector from a RouteCandidate's geometry. */
export function defaultFeatureExtractor(c: RouteCandidate): number[] {
  const pts = c.points;
  const n = pts.length;

  // Total length
  let totalLength = 0;
  for (let i = 1; i < n; i++) {
    const dx = (pts[i]![0] ?? 0) - (pts[i - 1]![0] ?? 0);
    const dy = (pts[i]![1] ?? 0) - (pts[i - 1]![1] ?? 0);
    const dz = (pts[i]![2] ?? 0) - (pts[i - 1]![2] ?? 0);
    totalLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Number of bends (direction changes)
  let bends = 0;
  for (let i = 2; i < n; i++) {
    const d1x = (pts[i - 1]![0] ?? 0) - (pts[i - 2]![0] ?? 0);
    const d1z = (pts[i - 1]![2] ?? 0) - (pts[i - 2]![2] ?? 0);
    const d2x = (pts[i]![0] ?? 0) - (pts[i - 1]![0] ?? 0);
    const d2z = (pts[i]![2] ?? 0) - (pts[i - 1]![2] ?? 0);
    if (Math.abs(d1x - d2x) > 0.01 || Math.abs(d1z - d2z) > 0.01) bends++;
  }

  // Elevation delta
  const elevDelta = Math.abs((pts[n - 1]![1] ?? 0) - (pts[0]![1] ?? 0));

  // Straight-line distance (start to end)
  const dx = (pts[n - 1]![0] ?? 0) - (pts[0]![0] ?? 0);
  const dz = (pts[n - 1]![2] ?? 0) - (pts[0]![2] ?? 0);
  const straightLine = Math.sqrt(dx * dx + dz * dz);

  // Tortuosity ratio
  const tortuosity = straightLine > 0 ? totalLength / straightLine : 1;

  return [totalLength, bends, elevDelta, tortuosity, n];
}
