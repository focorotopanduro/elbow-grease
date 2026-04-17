/**
 * Hydraulic Benchmark — measures solve time and accuracy for each
 * friction method against the Colebrook-White reference.
 *
 * Run this to verify that Swamee-Jain stays within 3% error and
 * to measure actual microseconds-per-solve on the user's hardware.
 *
 * Also benchmarks Manning vs Saint-Venant for drainage scenarios.
 */

import {
  swameeJain,
  haaland,
  churchill,
  colebrookWhite,
  moody,
  type FrictionMethod,
  type FrictionResult,
} from './FrictionSolvers';
import { manningFlow } from './ManningFlow';

// ── Benchmark result ────────────────────────────────────────────

export interface BenchmarkResult {
  method: FrictionMethod;
  /** Average solve time in microseconds. */
  avgMicroseconds: number;
  /** Maximum error vs Colebrook-White (fraction). */
  maxError: number;
  /** Mean error vs Colebrook-White (fraction). */
  meanError: number;
  /** Number of test cases. */
  testCases: number;
  /** Speedup vs Colebrook-White. */
  speedup: number;
}

// ── Test matrix ─────────────────────────────────────────────────

interface TestCase {
  Re: number;
  epsilon: number; // ft
  D: number;       // ft
  label: string;
}

function generateTestCases(): TestCase[] {
  const cases: TestCase[] = [];
  const reValues = [1000, 3000, 5000, 1e4, 5e4, 1e5, 5e5, 1e6, 5e6, 1e7];
  const roughValues = [
    { epsilon: 0.000005, label: 'PVC' },
    { epsilon: 0.0005, label: 'galvanized' },
    { epsilon: 0.00085, label: 'cast iron' },
  ];
  const diameters = [0.5 / 12, 1 / 12, 2 / 12, 4 / 12, 6 / 12]; // ft

  for (const Re of reValues) {
    for (const { epsilon, label } of roughValues) {
      for (const D of diameters) {
        cases.push({ Re, epsilon, D, label: `${label} ${(D * 12).toFixed(1)}"` });
      }
    }
  }

  return cases;
}

// ── Run benchmark ───────────────────────────────────────────────

/**
 * Benchmark all friction methods against Colebrook-White.
 * Returns per-method stats: speed, accuracy, and speedup.
 */
export function runFrictionBenchmark(iterations: number = 100): BenchmarkResult[] {
  const testCases = generateTestCases();
  const methods: { name: FrictionMethod; fn: (Re: number, e: number, D: number) => FrictionResult }[] = [
    { name: 'swamee-jain', fn: swameeJain },
    { name: 'haaland', fn: haaland },
    { name: 'churchill', fn: churchill },
    { name: 'colebrook-white', fn: colebrookWhite },
    { name: 'moody', fn: moody },
  ];

  // First: compute reference values (Colebrook-White)
  const references = testCases.map((tc) => colebrookWhite(tc.Re, tc.epsilon, tc.D).f);

  // Time Colebrook-White
  const cwStart = performance.now();
  for (let iter = 0; iter < iterations; iter++) {
    for (const tc of testCases) {
      colebrookWhite(tc.Re, tc.epsilon, tc.D);
    }
  }
  const cwTotalMs = performance.now() - cwStart;
  const cwAvgUs = (cwTotalMs * 1000) / (iterations * testCases.length);

  const results: BenchmarkResult[] = [];

  for (const method of methods) {
    let maxError = 0;
    let totalError = 0;

    // Accuracy check
    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i]!;
      const result = method.fn(tc.Re, tc.epsilon, tc.D);
      const ref = references[i]!;

      if (ref > 0 && tc.Re >= 4000) { // skip laminar (all methods agree)
        const error = Math.abs(result.f - ref) / ref;
        maxError = Math.max(maxError, error);
        totalError += error;
      }
    }

    // Speed check
    const start = performance.now();
    for (let iter = 0; iter < iterations; iter++) {
      for (const tc of testCases) {
        method.fn(tc.Re, tc.epsilon, tc.D);
      }
    }
    const totalMs = performance.now() - start;
    const avgUs = (totalMs * 1000) / (iterations * testCases.length);

    const turbulentCount = testCases.filter((tc) => tc.Re >= 4000).length;

    results.push({
      method: method.name,
      avgMicroseconds: Math.round(avgUs * 100) / 100,
      maxError: Math.round(maxError * 10000) / 10000,
      meanError: turbulentCount > 0
        ? Math.round((totalError / turbulentCount) * 10000) / 10000
        : 0,
      testCases: testCases.length,
      speedup: avgUs > 0 ? Math.round((cwAvgUs / avgUs) * 10) / 10 : 1,
    });
  }

  return results;
}

/**
 * Quick validation: ensure Swamee-Jain stays within 3% for all
 * practical plumbing scenarios. Returns false if any case exceeds 3%.
 */
export function validateSwameeJain(): { valid: boolean; worstCase: number; worstRe: number } {
  const testCases = generateTestCases();
  let worstError = 0;
  let worstRe = 0;

  for (const tc of testCases) {
    if (tc.Re < 5000) continue; // Swamee-Jain valid range starts at 5000

    const sj = swameeJain(tc.Re, tc.epsilon, tc.D);
    const cw = colebrookWhite(tc.Re, tc.epsilon, tc.D);

    const error = Math.abs(sj.f - cw.f) / cw.f;
    if (error > worstError) {
      worstError = error;
      worstRe = tc.Re;
    }
  }

  return {
    valid: worstError <= 0.03,
    worstCase: worstError,
    worstRe,
  };
}
