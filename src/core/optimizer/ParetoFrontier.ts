/**
 * Pareto Frontier — non-dominated solution set manager.
 *
 * Given N objectives (minimize pipe length, maximize slope compliance,
 * minimize cost, maximize maintainability), a solution is Pareto-optimal
 * if no other solution is better in ALL objectives simultaneously.
 *
 * The frontier is the set of all such non-dominated solutions — the
 * "menu" of best tradeoffs presented to the human engineer via HILO.
 */

import type { Vec3 } from '../events';

// ── Types ───────────────────────────────────────────────────────

export interface ObjectiveVector {
  /** Total pipe length in feet. Lower is better. */
  pipeLength: number;
  /** Slope compliance score 0–1. Higher is better. */
  slopeCompliance: number;
  /** Estimated material cost in USD. Lower is better. */
  materialCost: number;
  /** Maintenance accessibility score 0–1. Higher is better. */
  accessibility: number;
  /** Number of code violations. Lower is better. */
  violations: number;
}

export interface RouteCandidate {
  id: string;
  points: Vec3[];
  objectives: ObjectiveVector;
  /** ECBS suboptimality bound that produced this route. */
  wBound: number;
  /** Whether this solution sits on the current Pareto frontier. */
  dominated: boolean;
}

// ── Dominance check ─────────────────────────────────────────────

/** Directions: -1 = minimize, +1 = maximize. */
const DIRECTIONS: Record<keyof ObjectiveVector, -1 | 1> = {
  pipeLength:      -1,
  slopeCompliance:  1,
  materialCost:    -1,
  accessibility:    1,
  violations:      -1,
};

const OBJ_KEYS = Object.keys(DIRECTIONS) as (keyof ObjectiveVector)[];

/**
 * Returns true if `a` dominates `b`:
 *   a is at least as good in every objective AND strictly better in at least one.
 */
function dominates(a: ObjectiveVector, b: ObjectiveVector): boolean {
  let strictlyBetter = false;
  for (const k of OBJ_KEYS) {
    const dir = DIRECTIONS[k];
    const diff = (a[k] - b[k]) * dir; // positive = a is better
    if (diff < 0) return false;        // a is worse in this objective
    if (diff > 0) strictlyBetter = true;
  }
  return strictlyBetter;
}

// ── Frontier class ──────────────────────────────────────────────

export class ParetoFrontier {
  private candidates: RouteCandidate[] = [];

  /** Insert a candidate. Re-computes dominance across the full set. */
  insert(candidate: RouteCandidate): void {
    this.candidates.push(candidate);
    this.recomputeDominance();
  }

  /** Bulk-insert multiple candidates then recompute once. */
  insertBatch(batch: RouteCandidate[]): void {
    this.candidates.push(...batch);
    this.recomputeDominance();
  }

  /** Get only the non-dominated (Pareto-optimal) solutions. */
  getFrontier(): RouteCandidate[] {
    return this.candidates.filter((c) => !c.dominated);
  }

  /** Get all candidates including dominated ones. */
  getAll(): RouteCandidate[] {
    return [...this.candidates];
  }

  /** Number of non-dominated solutions. */
  get frontierSize(): number {
    return this.candidates.filter((c) => !c.dominated).length;
  }

  /** Clear the entire set (e.g. when the user starts a new route). */
  clear(): void {
    this.candidates = [];
  }

  /**
   * Rank frontier solutions by a weighted preference vector.
   * Weights are user-learned preferences from PreferenceModel.
   * Returns frontier sorted best-first.
   */
  rankByPreference(weights: ObjectiveVector): RouteCandidate[] {
    const frontier = this.getFrontier();
    if (frontier.length === 0) return [];

    // Normalize each objective to [0, 1] across the frontier
    const mins = { ...frontier[0]!.objectives };
    const maxs = { ...frontier[0]!.objectives };
    for (const c of frontier) {
      for (const k of OBJ_KEYS) {
        if (c.objectives[k] < mins[k]) mins[k] = c.objectives[k];
        if (c.objectives[k] > maxs[k]) maxs[k] = c.objectives[k];
      }
    }

    function score(obj: ObjectiveVector): number {
      let s = 0;
      for (const k of OBJ_KEYS) {
        const range = maxs[k] - mins[k] || 1;
        const norm = (obj[k] - mins[k]) / range;
        // Flip minimization objectives so higher = better for scoring
        const oriented = DIRECTIONS[k] === -1 ? 1 - norm : norm;
        s += oriented * weights[k];
      }
      return s;
    }

    return [...frontier].sort((a, b) => score(b.objectives) - score(a.objectives));
  }

  // ── Internal ────────────────────────────────────────────────

  private recomputeDominance(): void {
    const n = this.candidates.length;
    for (let i = 0; i < n; i++) {
      this.candidates[i]!.dominated = false;
    }
    for (let i = 0; i < n; i++) {
      if (this.candidates[i]!.dominated) continue;
      for (let j = 0; j < n; j++) {
        if (i === j || this.candidates[j]!.dominated) continue;
        if (dominates(this.candidates[i]!.objectives, this.candidates[j]!.objectives)) {
          this.candidates[j]!.dominated = true;
        }
      }
    }
  }
}
