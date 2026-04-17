/**
 * Modified Wistort Method (MWM) — 2024 UPC Appendix M implementation.
 *
 * The full pipeline for calculating 99th-percentile peak water demand:
 *
 *   1. COLLECT fixture inventory from the PlumbingDAG
 *   2. GROUP fixtures by temperature demand (cold, hot, combined)
 *   3. ASSIGN per-fixture probability p_i = t_i / T from FlowProfiles
 *   4. COMPUTE the Poisson Binomial Distribution (PBD) over all p_i
 *   5. TRUNCATE at zero (ZTPBD) to condition on "someone is using water"
 *   6. FIND the 99th percentile simultaneous fixture count k_99
 *   7. SUM the flow rates of the k_99 highest-flow fixtures
 *   8. RETURN the design peak GPM for pipe sizing
 *
 * Why this matters:
 *   - Hunter's Curve (1940): uses WSFU lookup tables → oversizes by 30-60%
 *   - MWM (2024): uses exact probability → right-sized pipes, lower cost
 *   - For a typical 4-bathroom house:
 *       Hunter: ~22 GPM → 1" main
 *       MWM:   ~12 GPM → 3/4" main (saves $200+ in pipe and fittings)
 *
 * Reference:
 *   UPC 2024 Appendix M: "Peak Water Demand Calculator"
 *   Wistort, R.A. (1994). "A New Look at Determining Water Demands"
 *   ASPE Research Foundation (2020). "Residential End Uses of Water 2"
 */

import type { PlumbingDAG } from '../graph/PlumbingDAG';
import type { FixtureSubtype } from '../graph/GraphNode';
import { FLOW_PROFILES, type FlowProfile } from './FixtureFlowProfile';
import { computeZTPBD, ztpbdQuantile, type ZTPBDResult } from './ZeroTruncation';

// ── Demand group ────────────────────────────────────────────────

export type DemandGroup = 'cold' | 'hot' | 'combined';

export interface FixtureEntry {
  nodeId: string;
  subtype: FixtureSubtype;
  profile: FlowProfile;
  group: DemandGroup;
}

// ── MWM result ──────────────────────────────────────────────────

export interface MWMResult {
  /** Design peak flow rate in GPM (99th percentile). */
  designGPM: number;
  /** Number of fixtures simultaneously active at 99th percentile. */
  simultaneousFixtures: number;
  /** Total fixture count in the network. */
  totalFixtures: number;
  /** ZTPBD distribution details. */
  distribution: ZTPBDResult;
  /** Per-group breakdown. */
  groups: {
    cold: GroupResult;
    hot: GroupResult;
    combined: GroupResult;
  };
  /** Comparison with Hunter's Curve. */
  hunterComparison: HunterComparison;
  /** Stagnation risk assessment. */
  stagnation: StagnationAssessment;
}

export interface GroupResult {
  fixtureCount: number;
  /** Per-fixture probabilities used in PBD. */
  probabilities: number[];
  /** Per-fixture flow rates (GPM). */
  flowRates: number[];
  /** 99th percentile simultaneous count. */
  k99: number;
  /** 99th percentile peak GPM. */
  peakGPM: number;
  /** ZTPBD for this group. */
  distribution: ZTPBDResult;
}

export interface HunterComparison {
  /** Hunter's Curve GPM estimate (from WSFU). */
  hunterGPM: number;
  /** MWM GPM estimate. */
  mwmGPM: number;
  /** Oversizing ratio: hunter / mwm. */
  oversizingRatio: number;
  /** Estimated cost savings from right-sizing. */
  estimatedSavings: string;
}

export interface StagnationAssessment {
  /** Probability of zero flow during peak period. */
  zeroFlowProbability: number;
  /** Risk level. */
  riskLevel: 'low' | 'moderate' | 'high' | 'critical';
  /** Hours per day with zero flow (estimated). */
  estimatedZeroFlowHours: number;
  /** Whether Legionella management plan is recommended. */
  legionellaRiskFlag: boolean;
}

// ── Hunter's Curve lookup (for comparison) ──────────────────────

function hunterWSFUtoGPM(totalWSFU: number): number {
  // Hunter's Curve approximation (ASHRAE / IPC historical)
  if (totalWSFU <= 0) return 0;
  if (totalWSFU <= 1) return 3;
  if (totalWSFU <= 2) return 5;
  if (totalWSFU <= 5) return 7;
  if (totalWSFU <= 10) return 10;
  if (totalWSFU <= 20) return 14.5;
  if (totalWSFU <= 40) return 20;
  if (totalWSFU <= 80) return 28;
  if (totalWSFU <= 150) return 39;
  if (totalWSFU <= 300) return 55;
  // Large systems: square root regression
  return 1.04 * Math.pow(totalWSFU, 0.51);
}

// ── Peak GPM from simultaneous fixture count ────────────────────

/**
 * Given k simultaneously active fixtures, compute the peak GPM
 * by summing the k highest individual flow rates.
 *
 * This correctly accounts for fixture heterogeneity — a shower
 * at 2.0 GPM contributes more than a lavatory at 0.5 GPM.
 */
function peakGPMFromCount(flowRates: number[], k: number): number {
  if (k <= 0 || flowRates.length === 0) return 0;
  // Sort descending and sum top-k
  const sorted = [...flowRates].sort((a, b) => b - a);
  let sum = 0;
  for (let i = 0; i < Math.min(k, sorted.length); i++) {
    sum += sorted[i]!;
  }
  return sum;
}

// ── Stagnation risk ─────────────────────────────────────────────

function assessStagnation(zeroProb: number): StagnationAssessment {
  // Estimate zero-flow hours per day:
  // If peak period is 5 min and P(X=0) = zeroProb during peak,
  // off-peak P(X=0) is much higher. Rough model:
  // Peak hours ≈ 4/day, off-peak ≈ 20/day
  // P(zero during off-peak) ≈ min(1, zeroProb × 3)
  const peakZeroHours = 4 * zeroProb;
  const offPeakZeroHours = 20 * Math.min(1, zeroProb * 3);
  const totalZeroHours = peakZeroHours + offPeakZeroHours;

  let riskLevel: StagnationAssessment['riskLevel'];
  if (totalZeroHours > 18) riskLevel = 'critical';
  else if (totalZeroHours > 12) riskLevel = 'high';
  else if (totalZeroHours > 6) riskLevel = 'moderate';
  else riskLevel = 'low';

  return {
    zeroFlowProbability: zeroProb,
    riskLevel,
    estimatedZeroFlowHours: Math.round(totalZeroHours * 10) / 10,
    legionellaRiskFlag: riskLevel === 'high' || riskLevel === 'critical',
  };
}

// ── Main MWM function ───────────────────────────────────────────

/**
 * Execute the Modified Wistort Method on a PlumbingDAG.
 * Returns the exact 99th-percentile peak demand for pipe sizing.
 */
export function calculatePeakDemand(dag: PlumbingDAG): MWMResult {
  // Step 1: Collect fixtures
  const fixtures: FixtureEntry[] = [];
  for (const node of dag.getAllNodes()) {
    if (node.type !== 'fixture' || !node.fixtureSubtype) continue;
    const profile = FLOW_PROFILES[node.fixtureSubtype];
    if (!profile || profile.q <= 0) continue;

    fixtures.push({
      nodeId: node.id,
      subtype: node.fixtureSubtype,
      profile,
      group: profile.temperture === 'cold' ? 'cold' :
             profile.temperture === 'hot' ? 'hot' : 'combined',
    });
  }

  // Step 2: Group by temperature
  const groups: Record<DemandGroup, FixtureEntry[]> = {
    cold: [],
    hot: [],
    combined: [],
  };
  for (const f of fixtures) {
    groups[f.group].push(f);
    // 'both' fixtures also contribute to cold and hot
    if (f.profile.temperture === 'both') {
      groups.cold.push(f);
      groups.hot.push(f);
    }
  }

  // Step 3–7: Compute per-group demand
  function computeGroup(entries: FixtureEntry[]): GroupResult {
    const probs = entries.map((e) => e.profile.p);
    const flowRates = entries.map((e) => e.profile.q);

    if (probs.length === 0) {
      return {
        fixtureCount: 0,
        probabilities: [],
        flowRates: [],
        k99: 0,
        peakGPM: 0,
        distribution: computeZTPBD([]),
      };
    }

    const dist = computeZTPBD(probs);
    const k99 = ztpbdQuantile(dist, 0.99);
    const peakGPM = peakGPMFromCount(flowRates, k99);

    return {
      fixtureCount: entries.length,
      probabilities: probs,
      flowRates,
      k99,
      peakGPM,
      distribution: dist,
    };
  }

  const coldResult = computeGroup(groups.cold);
  const hotResult = computeGroup(groups.hot);

  // Combined: use ALL fixtures regardless of temperature
  const allProbs = fixtures.map((f) => f.profile.p);
  const allFlows = fixtures.map((f) => f.profile.q);
  const combinedDist = computeZTPBD(allProbs);
  const combinedK99 = ztpbdQuantile(combinedDist, 0.99);
  const combinedPeakGPM = peakGPMFromCount(allFlows, combinedK99);

  const combinedResult: GroupResult = {
    fixtureCount: fixtures.length,
    probabilities: allProbs,
    flowRates: allFlows,
    k99: combinedK99,
    peakGPM: combinedPeakGPM,
    distribution: combinedDist,
  };

  // Step 8: Hunter's Curve comparison
  const totalWSFU = fixtures.reduce(
    (sum, f) => sum + f.profile.hunterWSFU, 0,
  );
  const hunterGPM = hunterWSFUtoGPM(totalWSFU);
  const oversizingRatio = combinedPeakGPM > 0 ? hunterGPM / combinedPeakGPM : 1;

  let savings: string;
  if (oversizingRatio > 1.5) savings = 'Significant (30-60% pipe cost reduction possible)';
  else if (oversizingRatio > 1.2) savings = 'Moderate (10-30% pipe cost reduction possible)';
  else savings = 'Minimal (systems are similarly sized)';

  // Stagnation assessment
  const stagnation = assessStagnation(combinedDist.zeroProb);

  return {
    designGPM: combinedPeakGPM,
    simultaneousFixtures: combinedK99,
    totalFixtures: fixtures.length,
    distribution: combinedDist,
    groups: {
      cold: coldResult,
      hot: hotResult,
      combined: combinedResult,
    },
    hunterComparison: {
      hunterGPM,
      mwmGPM: combinedPeakGPM,
      oversizingRatio,
      estimatedSavings: savings,
    },
    stagnation,
  };
}

/**
 * Quick GPM calculation for a single supply branch.
 * Used by PressureDropCalculator as a drop-in replacement for
 * the old regression approximation.
 */
export function branchPeakGPM(
  fixtureSubtypes: FixtureSubtype[],
  percentile: number = 0.99,
): number {
  const probs: number[] = [];
  const flows: number[] = [];

  for (const subtype of fixtureSubtypes) {
    const profile = FLOW_PROFILES[subtype];
    if (!profile || profile.q <= 0) continue;
    probs.push(profile.p);
    flows.push(profile.q);
  }

  if (probs.length === 0) return 0;

  const dist = computeZTPBD(probs);
  const k = ztpbdQuantile(dist, percentile);
  return peakGPMFromCount(flows, k);
}
