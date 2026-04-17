/**
 * Preference Model — learns objective weights from user choices.
 *
 * Every time the user selects one route over alternatives, this model
 * updates its belief about which objectives matter most to this
 * particular engineer. Uses exponential moving average so recent
 * choices have more influence than old ones.
 *
 * The learned weights feed back into BayesianOptimizer.scoreCandidate()
 * and ParetoFrontier.rankByPreference() to personalize suggestions.
 */

import type { ObjectiveVector, RouteCandidate } from '../optimizer/ParetoFrontier';

const OBJ_KEYS: (keyof ObjectiveVector)[] = [
  'pipeLength',
  'slopeCompliance',
  'materialCost',
  'accessibility',
  'violations',
];

/** Directions: -1 = lower is better, +1 = higher is better. */
const DIRECTIONS: Record<keyof ObjectiveVector, -1 | 1> = {
  pipeLength:      -1,
  slopeCompliance:  1,
  materialCost:    -1,
  accessibility:    1,
  violations:      -1,
};

export class PreferenceModel {
  private weights: ObjectiveVector;
  private alpha: number; // learning rate (EMA decay)
  private choiceCount = 0;

  constructor(alpha = 0.3) {
    this.alpha = alpha;
    // Start with uniform weights
    this.weights = {
      pipeLength:      1,
      slopeCompliance: 1,
      materialCost:    1,
      accessibility:   1,
      violations:      1,
    };
  }

  /**
   * Record that the user chose `selected` from the set `alternatives`.
   * Updates weights toward the objectives where the selected route
   * outperforms the rejected alternatives.
   */
  recordChoice(selected: RouteCandidate, alternatives: RouteCandidate[]): void {
    if (alternatives.length === 0) return;

    // Average the rejected alternatives' objectives
    const avgRejected: ObjectiveVector = { ...this.weights };
    for (const k of OBJ_KEYS) avgRejected[k] = 0;
    for (const alt of alternatives) {
      for (const k of OBJ_KEYS) avgRejected[k] += alt.objectives[k];
    }
    for (const k of OBJ_KEYS) avgRejected[k] /= alternatives.length;

    // Compute preference signal: how much better is the selected
    // route in each objective? (oriented so positive = preferred)
    const signal: Record<string, number> = {};
    for (const k of OBJ_KEYS) {
      const diff = (selected.objectives[k] - avgRejected[k]) * DIRECTIONS[k];
      signal[k] = diff;
    }

    // Normalize signal to [0, 1]
    const vals = Object.values(signal);
    const maxAbs = Math.max(...vals.map(Math.abs), 1e-8);
    for (const k of OBJ_KEYS) {
      signal[k] = ((signal[k] ?? 0) / maxAbs + 1) / 2; // map [-1,1] → [0,1]
    }

    // Exponential moving average update
    for (const k of OBJ_KEYS) {
      this.weights[k] = this.weights[k] * (1 - this.alpha) + (signal[k] ?? 0.5) * this.alpha;
    }

    // Renormalize weights so they sum to OBJ_KEYS.length
    let sum = 0;
    for (const k of OBJ_KEYS) sum += this.weights[k];
    const scale = OBJ_KEYS.length / (sum || 1);
    for (const k of OBJ_KEYS) this.weights[k] *= scale;

    this.choiceCount++;
  }

  /** Current learned weights. */
  getWeights(): ObjectiveVector {
    return { ...this.weights };
  }

  /** How many choices the model has observed. */
  get observations(): number {
    return this.choiceCount;
  }

  /** Reset to uniform (new session or explicit reset). */
  reset(): void {
    for (const k of OBJ_KEYS) this.weights[k] = 1;
    this.choiceCount = 0;
  }
}
