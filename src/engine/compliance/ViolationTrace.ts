/**
 * ViolationTrace — inference chain behind a ComplianceViolation.
 *
 * A violation today is a terse row: "IPC 704.1 — slope below 0.25"/ft".
 * That's enough for the 3D beacon to pulse red, but useless when a user
 * (or developer) asks "WHY did this rule fire?"
 *
 * The trace answers that question. It carries, for each violation,
 * the full path from the raw knowledge-graph triples → the rule that
 * matched → the PCSP constraint the rule compiled into → the variable
 * values the constraint rejected.
 *
 * Critical design constraints:
 *
 *   1. SERIALIZABLE across the Web Worker boundary. The solver runs
 *      in the worker and posts results to the main thread via
 *      structured clone. Functions don't clone. Therefore we capture
 *      PCSPConstraint's DATA (id, name, variableIds, message, cost,
 *      weight, hard, codeRef) but NOT its `costFn` closure.
 *
 *   2. DEV-FLAG-GATED. Every trace object costs CPU to build and
 *      memory to ship. Gate every construction site behind the
 *      `complianceTrace` feature flag so production users pay zero.
 *
 *   3. CORRELATION-AWARE. When Phase 1 dispatches `pipe.add`, and
 *      the subsequent solver run fires a violation, the trace stores
 *      the `correlationId` of that pipe.add so the God Mode console
 *      can jump from the violation to the command that caused it.
 */

import type { Triple } from './KnowledgeGraph';

/** The rule/condition half of the trace (before the constraint fires). */
export interface TracedRuleCondition {
  /** Rule template id this condition belongs to. */
  ruleId: string;
  /** Rule template name (human-readable). */
  ruleName: string;
  /** Did the condition match during this solve? */
  matched: boolean;
  /** Which entity(s) the condition bound to, if matched. */
  boundEntities: string[];
}

/**
 * Flattened, serializable snapshot of the PCSPConstraint that failed.
 * Fields mirror src/engine/compliance/PCSPSolver.ts::PCSPConstraint
 * EXCEPT the unclonable `costFn`.
 */
export interface TracedConstraint {
  id: string;
  name: string;
  codeRef: string;
  variableIds: string[];
  weight: number;
  hard: boolean;
  message: string;
  /** Weighted cost computed by the solver (cost × weight). */
  cost: number;
  /** Raw cost before weighting. */
  rawCost: number;
}

/** Which phase of the solver produced the rejection. */
export type SolverPhase = 'arc-consistency' | 'solve' | 'suggest';

/** Code-book reference with optional deep link. */
export interface TracedCodeReference {
  code: string;           // 'IPC'
  edition: string;        // '2021'
  chapter: number;
  section: string;        // '704.1'
  description: string;
  /** External URL (opened via @tauri-apps/plugin-shell). */
  url?: string;
}

/**
 * Full inference chain. Rendered as a collapsible tree in the
 * ComplianceDebugger panel.
 */
export interface ViolationTrace {
  /**
   * Correlation ID of the Phase 1 command that ultimately caused this
   * violation (e.g. the `pipe.add` dispatch). Lets God Mode console
   * jump from violation → causing command.
   */
  correlationId?: string;

  /** Which rules were applied to the subject entity during this solve. */
  appliedConditions: TracedRuleCondition[];

  /** The single constraint that rejected. */
  failedConstraint: TracedConstraint;

  /**
   * Triples from the knowledge graph that contributed to the constraint
   * — filtered to those involving the violating entity as subject.
   */
  sourceTriples: Triple[];

  /** IPC section + deep link. */
  sourceCode: TracedCodeReference;

  /** Which solver phase rejected. */
  phase: SolverPhase;

  /** Variable values at time of rejection (for reproducing the failure). */
  variableValues: Record<string, number>;

  /** Wall-clock timestamp of the solve (ms since performance.timeOrigin). */
  solvedAt: number;
}
