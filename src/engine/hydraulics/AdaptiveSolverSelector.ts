/**
 * Adaptive Solver Selector — auto-picks the friction solver based
 * on Reynolds number range, accuracy requirement, and frame budget.
 *
 * Strategy:
 *   - Real-time (routing, preview): Swamee-Jain (1 pass, ~2% error)
 *   - Idle refinement (user paused): Colebrook-White (gold standard)
 *   - Transition zone (2300 < Re < 4000): Churchill (smooth bridging)
 *   - Final report / export: Colebrook-White (full accuracy)
 *   - Budget exhausted (too many edges): Moody lookup
 *
 * The selector also tracks cumulative solve time per frame and
 * degrades to faster methods if the budget is being exceeded.
 */

import {
  type FrictionMethod,
  type FrictionResult,
  computeFriction,
} from './FrictionSolvers';

// ── Solver context ──────────────────────────────────────────────

export type SolverMode = 'realtime' | 'idle' | 'report';

export interface SolverBudget {
  /** Maximum milliseconds allowed for friction solves per frame. */
  maxFrameMs: number;
  /** Accumulated solve time this frame. */
  usedMs: number;
  /** Current solver mode. */
  mode: SolverMode;
}

// ── Selector ────────────────────────────────────────────────────

export class AdaptiveSolverSelector {
  private budget: SolverBudget = {
    maxFrameMs: 2, // 2ms budget (of 16.67ms frame at 60fps)
    usedMs: 0,
    mode: 'realtime',
  };

  private solveCount = 0;
  private totalSolveTime = 0;

  /** Set the solver mode for this frame. */
  setMode(mode: SolverMode): void {
    this.budget.mode = mode;
    this.budget.maxFrameMs = mode === 'realtime' ? 2 : mode === 'idle' ? 10 : 50;
  }

  /** Reset per-frame counters. Call at the start of each frame. */
  resetFrame(): void {
    this.budget.usedMs = 0;
    this.solveCount = 0;
  }

  /**
   * Select the best friction method for this particular solve,
   * given the current budget and Reynolds number.
   */
  selectMethod(Re: number): FrictionMethod {
    const regime = Re < 2300 ? 'laminar' : Re < 4000 ? 'transitional' : 'turbulent';

    // Laminar: exact formula, no solver needed (all methods return 64/Re)
    if (regime === 'laminar') return 'swamee-jain';

    // Transitional: only Churchill handles this smoothly
    if (regime === 'transitional') return 'churchill';

    // Budget check: if we're over budget, use the fastest solver
    if (this.budget.usedMs >= this.budget.maxFrameMs) return 'moody';

    // Mode-based selection
    switch (this.budget.mode) {
      case 'realtime':
        return 'swamee-jain';
      case 'idle':
        return 'colebrook-white';
      case 'report':
        return 'colebrook-white';
    }
  }

  /**
   * Solve friction with automatic method selection and budget tracking.
   */
  solve(Re: number, epsilon: number, D: number): FrictionResult {
    const method = this.selectMethod(Re);
    const t0 = performance.now();
    const result = computeFriction(Re, epsilon, D, method);
    const elapsed = performance.now() - t0;

    this.budget.usedMs += elapsed;
    this.solveCount++;
    this.totalSolveTime += elapsed;

    return result;
  }

  /**
   * Force a specific method (bypasses auto-selection).
   */
  solveWith(
    Re: number,
    epsilon: number,
    D: number,
    method: FrictionMethod,
  ): FrictionResult {
    const t0 = performance.now();
    const result = computeFriction(Re, epsilon, D, method);
    this.budget.usedMs += performance.now() - t0;
    this.solveCount++;
    return result;
  }

  /** Get diagnostic stats. */
  getStats() {
    return {
      mode: this.budget.mode,
      frameBudgetMs: this.budget.maxFrameMs,
      usedMs: this.budget.usedMs,
      solveCount: this.solveCount,
      avgSolveUs: this.solveCount > 0
        ? (this.totalSolveTime / this.solveCount) * 1000
        : 0,
      budgetExhausted: this.budget.usedMs >= this.budget.maxFrameMs,
    };
  }
}

export const solverSelector = new AdaptiveSolverSelector();
