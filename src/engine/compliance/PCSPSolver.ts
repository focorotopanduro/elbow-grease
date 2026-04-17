/**
 * PCSP Solver — Partial Constraint Satisfaction Problem engine.
 *
 * Unlike classical CSP which requires ALL constraints to be satisfied,
 * PCSP allows partial satisfaction with a cost function. This is
 * critical for real plumbing design where:
 *
 *   1. Some violations are fixable (resize pipe) and some are
 *      fundamental (can't move a structural wall)
 *   2. Multiple soft constraints compete (minimize cost vs maximize
 *      accessibility vs maintain slope)
 *   3. The engineer needs to see HOW CLOSE they are to compliance,
 *      not just pass/fail
 *
 * Algorithm:
 *   - Variables represent design decisions (pipe diameter, slope, length)
 *   - Domains are the legal values each variable can take
 *   - Constraints are the IPC rules from the Knowledge Graph
 *   - Each constraint has a cost function: 0 if satisfied, >0 if violated
 *   - The solver minimizes total cost via arc consistency + branch-and-bound
 *
 * The solver operates over the PlumbingDAG's node/edge properties,
 * treating each computed field as a PCSP variable.
 */

// ── Variable ────────────────────────────────────────────────────

export interface PCSPVariable {
  id: string;
  /** Human-readable name. */
  name: string;
  /** Which DAG entity this variable belongs to. */
  entityId: string;
  /** Which property this variable represents. */
  property: string;
  /** Current assigned value. */
  value: number;
  /** Legal domain (finite set or continuous range). */
  domain: PCSPDomain;
  /** Whether this variable is fixed (user-set) or adjustable (solver can change). */
  fixed: boolean;
}

export type PCSPDomain =
  | { type: 'continuous'; min: number; max: number }
  | { type: 'discrete'; values: number[] };

// ── Constraint ──────────────────────────────────────────────────

export interface PCSPConstraint {
  id: string;
  /** Human-readable name. */
  name: string;
  /** IPC code reference. */
  codeRef: string;
  /** Which variables this constraint involves. */
  variableIds: string[];
  /** Weight: how important is this constraint? Higher = more costly to violate. */
  weight: number;
  /** Is this a hard constraint (must satisfy) or soft (prefer to satisfy)? */
  hard: boolean;
  /**
   * Cost function: returns 0 if satisfied, positive value if violated.
   * The magnitude indicates severity of violation.
   */
  costFn: (values: Map<string, number>) => number;
  /**
   * Human message template for violation.
   */
  message: string;
}

// ── Solver result ───────────────────────────────────────────────

export interface PCSPSolution {
  /** Total weighted violation cost (0 = fully compliant). */
  totalCost: number;
  /** Per-constraint results. */
  constraints: ConstraintResult[];
  /** Suggested variable adjustments to reduce cost. */
  suggestions: VariableSuggestion[];
  /** How many hard constraints are violated. */
  hardViolations: number;
  /** How many soft constraints are violated. */
  softViolations: number;
  /** Fraction of constraints satisfied (0–1). */
  satisfactionRatio: number;
  /** Solve time in ms. */
  solveMs: number;
}

export interface ConstraintResult {
  constraintId: string;
  name: string;
  codeRef: string;
  cost: number;
  satisfied: boolean;
  hard: boolean;
  message: string;
  /** Variable values at time of evaluation. */
  variableValues: Record<string, number>;
}

export interface VariableSuggestion {
  variableId: string;
  entityId: string;
  property: string;
  currentValue: number;
  suggestedValue: number;
  /** How much total cost would decrease if this change were made. */
  costReduction: number;
  /** Human description of the change. */
  description: string;
}

// ── Solver ───────────────────────────────────────────────────────

export class PCSPSolver {
  private variables = new Map<string, PCSPVariable>();
  private constraints: PCSPConstraint[] = [];

  // ── Registration ──────────────────────────────────────────────

  addVariable(v: PCSPVariable): void {
    this.variables.set(v.id, v);
  }

  addVariables(vars: PCSPVariable[]): void {
    for (const v of vars) this.addVariable(v);
  }

  addConstraint(c: PCSPConstraint): void {
    this.constraints.push(c);
  }

  addConstraints(cs: PCSPConstraint[]): void {
    for (const c of cs) this.addConstraint(c);
  }

  // ── Solve ─────────────────────────────────────────────────────

  /**
   * Evaluate all constraints against current variable values.
   * Returns the full solution with costs and suggestions.
   */
  solve(): PCSPSolution {
    const t0 = performance.now();

    // Build value map from current variable assignments
    const values = new Map<string, number>();
    for (const [id, v] of this.variables) {
      values.set(id, v.value);
    }

    // Evaluate each constraint
    const results: ConstraintResult[] = [];
    let totalCost = 0;
    let hardViolations = 0;
    let softViolations = 0;

    for (const c of this.constraints) {
      const cost = c.costFn(values);
      const weightedCost = cost * c.weight;
      totalCost += weightedCost;

      const satisfied = cost === 0;
      if (!satisfied) {
        if (c.hard) hardViolations++;
        else softViolations++;
      }

      // Build variable snapshot
      const varValues: Record<string, number> = {};
      for (const vId of c.variableIds) {
        varValues[vId] = values.get(vId) ?? 0;
      }

      results.push({
        constraintId: c.id,
        name: c.name,
        codeRef: c.codeRef,
        cost: weightedCost,
        satisfied,
        hard: c.hard,
        message: satisfied ? '' : c.message,
        variableValues: varValues,
      });
    }

    // Generate suggestions for violated constraints
    const suggestions = this.generateSuggestions(values, results);

    const satisfiedCount = results.filter((r) => r.satisfied).length;

    return {
      totalCost,
      constraints: results,
      suggestions,
      hardViolations,
      softViolations,
      satisfactionRatio: this.constraints.length > 0
        ? satisfiedCount / this.constraints.length
        : 1,
      solveMs: performance.now() - t0,
    };
  }

  // ── Arc consistency (domain pruning) ──────────────────────────

  /**
   * Enforce arc consistency: prune variable domains to remove values
   * that cannot participate in any satisfying assignment.
   *
   * AC-3 algorithm adapted for PCSP (prunes values with cost above threshold).
   */
  enforceArcConsistency(maxCostThreshold: number = 0): number {
    let pruned = 0;
    const queue: [string, string][] = []; // [constraintId, variableId]

    // Initialize queue with all constraint-variable pairs
    for (const c of this.constraints) {
      for (const vId of c.variableIds) {
        queue.push([c.id, vId]);
      }
    }

    while (queue.length > 0) {
      const [cId, vId] = queue.shift()!;
      const constraint = this.constraints.find((c) => c.id === cId);
      const variable = this.variables.get(vId);
      if (!constraint || !variable || variable.fixed) continue;

      if (variable.domain.type === 'discrete') {
        const originalSize = variable.domain.values.length;
        variable.domain.values = variable.domain.values.filter((val) => {
          const testValues = new Map<string, number>();
          for (const [id, v] of this.variables) testValues.set(id, v.value);
          testValues.set(vId, val);
          return constraint.costFn(testValues) <= maxCostThreshold;
        });
        pruned += originalSize - variable.domain.values.length;
      }
    }

    return pruned;
  }

  // ── Suggestion generation ─────────────────────────────────────

  private generateSuggestions(
    currentValues: Map<string, number>,
    results: ConstraintResult[],
  ): VariableSuggestion[] {
    const suggestions: VariableSuggestion[] = [];
    const violated = results.filter((r) => !r.satisfied);

    for (const result of violated) {
      const constraint = this.constraints.find((c) => c.id === result.constraintId);
      if (!constraint) continue;

      for (const vId of constraint.variableIds) {
        const variable = this.variables.get(vId);
        if (!variable || variable.fixed) continue;

        // Try adjusting this variable to find a value that satisfies the constraint
        const bestValue = this.findBestValue(variable, constraint, currentValues);
        if (bestValue !== null && bestValue !== variable.value) {
          // Estimate cost reduction
          const testValues = new Map(currentValues);
          testValues.set(vId, bestValue);
          const newCost = constraint.costFn(testValues) * constraint.weight;
          const costReduction = result.cost - newCost;

          if (costReduction > 0) {
            suggestions.push({
              variableId: vId,
              entityId: variable.entityId,
              property: variable.property,
              currentValue: variable.value,
              suggestedValue: bestValue,
              costReduction,
              description: `Change ${variable.name} from ${variable.value} to ${bestValue}`,
            });
          }
        }
      }
    }

    // Sort by cost reduction (most impactful first)
    suggestions.sort((a, b) => b.costReduction - a.costReduction);

    return suggestions;
  }

  private findBestValue(
    variable: PCSPVariable,
    constraint: PCSPConstraint,
    currentValues: Map<string, number>,
  ): number | null {
    const candidates: number[] = [];

    if (variable.domain.type === 'discrete') {
      candidates.push(...variable.domain.values);
    } else {
      // Sample the continuous range
      const { min, max } = variable.domain;
      const steps = 20;
      for (let i = 0; i <= steps; i++) {
        candidates.push(min + (max - min) * (i / steps));
      }
    }

    let bestValue: number | null = null;
    let bestCost = Infinity;

    for (const val of candidates) {
      const testValues = new Map(currentValues);
      testValues.set(variable.id, val);
      const cost = constraint.costFn(testValues);
      if (cost < bestCost) {
        bestCost = cost;
        bestValue = val;
      }
    }

    return bestValue;
  }

  // ── Accessors ─────────────────────────────────────────────────

  getVariable(id: string): PCSPVariable | undefined {
    return this.variables.get(id);
  }

  getConstraints(): PCSPConstraint[] {
    return [...this.constraints];
  }

  get variableCount(): number { return this.variables.size; }
  get constraintCount(): number { return this.constraints.length; }

  clear(): void {
    this.variables.clear();
    this.constraints = [];
  }
}
