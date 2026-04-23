/**
 * Compliance Engine — bridges the KnowledgeGraph rules to PCSP
 * constraints instantiated over the live PlumbingDAG.
 *
 * This is the "compiler" that translates declarative IPC knowledge
 * (triples + rule templates) into executable constraint functions
 * (PCSP variables + cost functions) bound to actual pipe/fixture
 * entities in the user's design.
 *
 * Pipeline:
 *   1. Load IPC knowledge base (triples + rules)
 *   2. Bind DAG entities to KG triples (create bldg: instances)
 *   3. For each rule template, match conditions against the KG
 *   4. Each match instantiates a PCSP constraint
 *   5. Solve the PCSP → get costs, violations, suggestions
 *   6. Package into a ComplianceReport with code references
 */

import type { PlumbingDAG } from '../graph/PlumbingDAG';
import type { GraphNode } from '../graph/GraphNode';
import type { GraphEdge } from '../graph/GraphEdge';
import { KnowledgeGraph, type Triple, type RuleTemplate } from './KnowledgeGraph';
import { loadIPCKnowledgeBase } from './IPCRuleParser';
import {
  PCSPSolver,
  type PCSPVariable,
  type PCSPConstraint,
  type PCSPSolution,
  type ConstraintResult,
} from './PCSPSolver';
import type { CodeReference, RemediationAction, ViolationSeverity } from './IPCOntology';
import type { ViolationTrace, TracedConstraint, TracedRuleCondition } from './ViolationTrace';

/**
 * Controls trace construction. Read once at solver entry.
 *
 * The worker has no direct access to the main thread's Zustand store —
 * we set this from the bridge each solve via `setComplianceTraceEnabled`
 * below. Solver code only needs to check `TRACE_ENABLED`.
 */
let TRACE_ENABLED = false;

/** Called from the bridge (main thread) OR bootstrap code BEFORE solve. */
export function setComplianceTraceEnabled(on: boolean): void {
  TRACE_ENABLED = on;
}

/** Test hook. */
export function __getComplianceTraceEnabled(): boolean {
  return TRACE_ENABLED;
}

// ── Standard pipe diameter domain ───────────────────────────────

const STANDARD_DIAMETERS = [0.375, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12];
const STANDARD_SLOPES = [0, 0.0625, 0.125, 0.25, 0.5]; // in/ft

// ── Compliance report ───────────────────────────────────────────

export interface ComplianceViolation {
  ruleId: string;
  ruleName: string;
  codeRef: CodeReference;
  severity: ViolationSeverity;
  cost: number;
  message: string;
  entityId: string;
  entityType: 'node' | 'edge';
  remediations: RemediationAction[];
  /**
   * Phase 2 — inference chain. Populated only when TRACE_ENABLED
   * (mirrors the `complianceTrace` feature flag). Undefined in
   * production builds so the payload stays small and zero-copy costs
   * are unchanged.
   */
  trace?: ViolationTrace;
}

export interface ComplianceReport {
  /** Overall pass/fail. */
  compliant: boolean;
  /** PCSP satisfaction ratio (0–1). */
  satisfactionRatio: number;
  /** Total weighted violation cost. */
  totalCost: number;
  /** All violations sorted by severity then cost. */
  violations: ComplianceViolation[];
  /** Count by severity. */
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** Top remediation suggestions. */
  topRemediations: RemediationAction[];
  /** Solve timing. */
  solveMs: number;
  /** How many KG triples were evaluated. */
  triplesEvaluated: number;
  /** How many PCSP constraints were instantiated. */
  constraintsInstantiated: number;
}

// ── Engine ──────────────────────────────────────────────────────

export class ComplianceEngine {
  private kg: KnowledgeGraph;
  private solver: PCSPSolver;

  constructor() {
    this.kg = loadIPCKnowledgeBase();
    this.solver = new PCSPSolver();
  }

  /**
   * Run full compliance check on a PlumbingDAG.
   * This is the replacement for the hardcoded Pass 4 in PropagationSolver.
   */
  check(dag: PlumbingDAG): ComplianceReport {
    const t0 = performance.now();

    // Clear previous solve state
    this.solver.clear();

    // Step 1: Bind DAG entities to KG triples
    const bindingCount = this.bindDAGToKG(dag);

    // Step 2: Create PCSP variables from DAG computed properties
    this.createVariables(dag);

    // Step 3: Instantiate constraints from KG rule templates
    this.instantiateConstraints(dag);

    // Step 4: Enforce arc consistency (prune impossible values)
    this.solver.enforceArcConsistency();

    // Step 5: Solve
    const solution = this.solver.solve();

    // Step 6: Package into report
    const report = this.buildReport(dag, solution, performance.now() - t0, bindingCount);

    // Write compliance state back to DAG nodes
    this.applyToDAG(dag, report);

    return report;
  }

  /** Get the knowledge graph (for inspection / debugging). */
  getKnowledgeGraph(): KnowledgeGraph {
    return this.kg;
  }

  // ── Step 1: Bind DAG → KG ─────────────────────────────────────

  private bindDAGToKG(dag: PlumbingDAG): number {
    let count = 0;

    // Create triples for each node
    for (const node of dag.getAllNodes()) {
      const uri = `bldg:${node.id}`;
      const triples: Triple[] = [
        { subject: uri, predicate: 'rdf:type', object: `ipc:${capitalize(node.type)}` },
        { subject: uri, predicate: 'ipc:system', object: node.system },
        { subject: uri, predicate: 'ipc:dfu', object: node.dfu },
        { subject: uri, predicate: 'ipc:accumulatedDFU', object: node.computed.accumulatedDFU },
        { subject: uri, predicate: 'ipc:pressure', object: node.computed.pressure },
        { subject: uri, predicate: 'ipc:flowRate', object: node.computed.flowRate },
        { subject: uri, predicate: 'ipc:elevation', object: node.elevation },
        { subject: uri, predicate: 'ipc:sizedDiameter', object: node.computed.sizedDiameter },
      ];
      if (node.type === 'fixture') {
        triples.push(
          { subject: uri, predicate: 'ipc:trapSize', object: node.trapSize },
          { subject: uri, predicate: 'ipc:hasTrap', object: node.trapSize > 0 },
          { subject: uri, predicate: 'ipc:wsfu', object: node.supply.totalWSFU },
        );
      }
      this.kg.addBatch(triples);
      count += triples.length;
    }

    // Create triples for each edge
    for (const edge of dag.getAllEdges()) {
      const uri = `bldg:${edge.id}`;
      const triples: Triple[] = [
        { subject: uri, predicate: 'rdf:type', object: 'ipc:Pipe' },
        { subject: uri, predicate: 'ipc:from', object: `bldg:${edge.from}` },
        { subject: uri, predicate: 'ipc:to', object: `bldg:${edge.to}` },
        { subject: uri, predicate: 'ipc:diameter', object: edge.diameter },
        { subject: uri, predicate: 'ipc:length', object: edge.length },
        { subject: uri, predicate: 'ipc:slope', object: edge.slope },
        { subject: uri, predicate: 'ipc:material', object: edge.material },
        { subject: uri, predicate: 'ipc:velocity', object: edge.computed.velocity },
        { subject: uri, predicate: 'ipc:pressureDrop', object: edge.computed.pressureDrop },
      ];

      // Determine system from nodes
      const fromNode = dag.getNode(edge.from);
      if (fromNode) {
        triples.push({ subject: uri, predicate: 'ipc:system', object: fromNode.system });
      }

      // Connectivity
      const fromUri = `bldg:${edge.from}`;
      const toUri = `bldg:${edge.to}`;
      triples.push(
        { subject: fromUri, predicate: 'ipc:connectsTo', object: uri },
        { subject: uri, predicate: 'ipc:connectsTo', object: toUri },
        { subject: fromUri, predicate: 'ipc:isUpstreamOf', object: toUri },
      );

      this.kg.addBatch(triples);
      count += triples.length;
    }

    return count;
  }

  // ── Step 2: Create PCSP variables ─────────────────────────────

  private createVariables(dag: PlumbingDAG): void {
    for (const edge of dag.getAllEdges()) {
      // Diameter variable (adjustable)
      this.solver.addVariable({
        id: `${edge.id}:diameter`,
        name: `${edge.id} diameter`,
        entityId: edge.id,
        property: 'diameter',
        value: edge.diameter,
        domain: { type: 'discrete', values: STANDARD_DIAMETERS },
        fixed: false,
      });

      // Slope variable (adjustable for waste pipes)
      const fromNode = dag.getNode(edge.from);
      this.solver.addVariable({
        id: `${edge.id}:slope`,
        name: `${edge.id} slope`,
        entityId: edge.id,
        property: 'slope',
        value: edge.slope,
        domain: { type: 'discrete', values: STANDARD_SLOPES },
        fixed: fromNode?.system !== 'waste',
      });

      // Length variable (fixed — user-determined by routing)
      this.solver.addVariable({
        id: `${edge.id}:length`,
        name: `${edge.id} length`,
        entityId: edge.id,
        property: 'length',
        value: edge.length,
        domain: { type: 'continuous', min: 0, max: 200 },
        fixed: true,
      });

      // Velocity (computed, read-only)
      this.solver.addVariable({
        id: `${edge.id}:velocity`,
        name: `${edge.id} velocity`,
        entityId: edge.id,
        property: 'velocity',
        value: edge.computed.velocity,
        domain: { type: 'continuous', min: 0, max: 20 },
        fixed: true,
      });
    }

    for (const node of dag.getAllNodes()) {
      // Pressure at fixtures
      if (node.type === 'fixture') {
        this.solver.addVariable({
          id: `${node.id}:pressure`,
          name: `${node.label} pressure`,
          entityId: node.id,
          property: 'pressure',
          value: node.computed.pressure,
          domain: { type: 'continuous', min: 0, max: 150 },
          fixed: true,
        });
      }

      // Accumulated DFU
      this.solver.addVariable({
        id: `${node.id}:accDFU`,
        name: `${node.label} accumulated DFU`,
        entityId: node.id,
        property: 'accumulatedDFU',
        value: node.computed.accumulatedDFU,
        domain: { type: 'continuous', min: 0, max: 5000 },
        fixed: true,
      });
    }
  }

  // ── Step 3: Instantiate constraints ───────────────────────────

  private instantiateConstraints(dag: PlumbingDAG): void {
    // Trap arm distance constraints
    for (const node of dag.getAllNodes()) {
      if (node.type !== 'fixture' || node.trapSize <= 0) continue;

      const maxDist = this.kg.value(
        `ipc:TrapArm/${node.trapSize}in`,
        'ipc:maxDistance',
      ) as number | undefined;
      if (maxDist === undefined) continue;

      for (const edge of dag.getOutgoingEdges(node.id)) {
        const lengthVarId = `${edge.id}:length`;
        this.solver.addConstraint({
          id: `trap-arm-${node.id}-${edge.id}`,
          name: `Trap arm distance (${node.label})`,
          codeRef: 'IPC 906.1',
          variableIds: [lengthVarId],
          weight: 10, // high weight — hard code violation
          hard: true,
          costFn: (values) => {
            const len = values.get(lengthVarId) ?? 0;
            return len > maxDist ? (len - maxDist) / maxDist : 0;
          },
          message: `Trap arm exceeds ${maxDist}ft max for ${node.trapSize}" trap (IPC 906.1)`,
        });
      }
    }

    // Minimum slope constraints (waste system)
    for (const edge of dag.getAllEdges()) {
      const fromNode = dag.getNode(edge.from);
      if (!fromNode || fromNode.system !== 'waste') continue;

      const diamVarId = `${edge.id}:diameter`;
      const slopeVarId = `${edge.id}:slope`;
      const minSlope = edge.diameter <= 3 ? 0.25 : 0.125;

      this.solver.addConstraint({
        id: `min-slope-${edge.id}`,
        name: `Minimum slope (${edge.id})`,
        codeRef: 'IPC 704.1',
        variableIds: [slopeVarId, diamVarId],
        weight: 8,
        hard: true,
        costFn: (values) => {
          const slope = values.get(slopeVarId) ?? 0;
          if (slope <= 0) return 0; // vertical or no slope specified
          return slope < minSlope ? (minSlope - slope) / minSlope : 0;
        },
        message: `Slope below ${minSlope}"/ft minimum (IPC 704.1)`,
      });
    }

    // Maximum velocity constraints (supply system)
    for (const edge of dag.getAllEdges()) {
      const fromNode = dag.getNode(edge.from);
      if (!fromNode) continue;
      if (fromNode.system !== 'cold_supply' && fromNode.system !== 'hot_supply') continue;

      const velVarId = `${edge.id}:velocity`;
      this.solver.addConstraint({
        id: `max-velocity-${edge.id}`,
        name: `Max velocity (${edge.id})`,
        codeRef: 'IPC 604.5',
        variableIds: [velVarId],
        weight: 5,
        hard: false, // warning, not error
        costFn: (values) => {
          const vel = values.get(velVarId) ?? 0;
          return vel > 8 ? (vel - 8) / 8 : 0;
        },
        message: `Velocity exceeds 8 ft/s max (IPC 604.5)`,
      });
    }

    // Minimum pressure at fixtures
    for (const node of dag.getAllNodes()) {
      if (node.type !== 'fixture') continue;
      const pressVarId = `${node.id}:pressure`;

      this.solver.addConstraint({
        id: `min-pressure-${node.id}`,
        name: `Min pressure (${node.label})`,
        codeRef: 'IPC 604.6',
        variableIds: [pressVarId],
        weight: 9,
        hard: true,
        costFn: (values) => {
          const p = values.get(pressVarId) ?? 0;
          if (p <= 0) return 0; // not yet solved
          return p < 8 ? (8 - p) / 8 : 0;
        },
        message: `Fixture pressure below 8 psi minimum (IPC 604.6)`,
      });
    }

    // DFU capacity constraints
    const dfuLimits: Record<number, number> = { 1.5: 1, 2: 3, 3: 20, 4: 160, 6: 620 };
    for (const edge of dag.getAllEdges()) {
      const toNode = dag.getNode(edge.to);
      if (!toNode || toNode.system !== 'waste') continue;

      const diamVarId = `${edge.id}:diameter`;
      const dfuVarId = `${toNode.id}:accDFU`;
      const maxDFU = dfuLimits[edge.diameter] ?? 999;

      this.solver.addConstraint({
        id: `max-dfu-${edge.id}`,
        name: `Max DFU capacity (${edge.id})`,
        codeRef: 'IPC 710.1',
        variableIds: [dfuVarId, diamVarId],
        weight: 7,
        hard: true,
        costFn: (values) => {
          const dfu = values.get(dfuVarId) ?? 0;
          return dfu > maxDFU ? (dfu - maxDFU) / maxDFU : 0;
        },
        message: `DFU exceeds capacity for ${edge.diameter}" pipe (IPC Table 710.1)`,
      });
    }
  }

  // ── Step 6: Build report ──────────────────────────────────────

  private buildReport(
    dag: PlumbingDAG,
    solution: PCSPSolution,
    totalMs: number,
    tripleCount: number,
  ): ComplianceReport {
    const violations: ComplianceViolation[] = solution.constraints
      .filter((c) => !c.satisfied)
      .map((c) => {
        // Find the entity this constraint references
        const constraint = this.solver.getConstraints()
          .find((pc) => pc.id === c.constraintId);
        const firstVarId = constraint?.variableIds[0] ?? '';
        const variable = this.solver.getVariable(firstVarId);

        // Build remediations from PCSP suggestions
        const remediations: RemediationAction[] = solution.suggestions
          .filter((s) => constraint?.variableIds.includes(s.variableId))
          .map((s) => ({
            description: s.description,
            targetEntityId: s.entityId,
            property: s.property as any,
            suggestedValue: s.suggestedValue,
            costDelta: -s.costReduction,
          }));

        const severity: ViolationSeverity = c.hard ? 'error' : c.cost > 0.5 ? 'warning' : 'info';

        const entityId = variable?.entityId ?? '';
        const entityType: 'node' | 'edge' =
          variable?.entityId.startsWith('edge') ? 'edge' : 'node';

        const codeRefObj = {
          code: 'IPC' as const,
          edition: '2021',
          chapter: parseInt(c.codeRef.split(' ')[1] ?? '0'),
          section: c.codeRef.split(' ')[1] ?? '',
          description: c.name,
        };

        // Phase 2: optional inference trace. Skipped entirely when
        // TRACE_ENABLED is false so production builds pay zero.
        const trace = TRACE_ENABLED && constraint
          ? this.buildTrace({
              entityId,
              constraint,
              result: c,
              codeRef: codeRefObj,
            })
          : undefined;

        return {
          ruleId: c.constraintId,
          ruleName: c.name,
          codeRef: codeRefObj,
          severity,
          cost: c.cost,
          message: c.message,
          entityId,
          entityType,
          remediations,
          trace,
        };
      });

    // Sort: errors first, then by cost descending
    violations.sort((a, b) => {
      if (a.severity !== b.severity) {
        const order: Record<ViolationSeverity, number> = { error: 0, warning: 1, info: 2 };
        return order[a.severity] - order[b.severity];
      }
      return b.cost - a.cost;
    });

    const errorCount = violations.filter((v) => v.severity === 'error').length;
    const warningCount = violations.filter((v) => v.severity === 'warning').length;
    const infoCount = violations.filter((v) => v.severity === 'info').length;

    // Top 5 remediations
    const topRemediations = solution.suggestions.slice(0, 5).map((s) => ({
      description: s.description,
      targetEntityId: s.entityId,
      property: s.property as any,
      suggestedValue: s.suggestedValue,
      costDelta: -s.costReduction,
    }));

    return {
      compliant: errorCount === 0,
      satisfactionRatio: solution.satisfactionRatio,
      totalCost: solution.totalCost,
      violations,
      errorCount,
      warningCount,
      infoCount,
      topRemediations,
      solveMs: totalMs,
      triplesEvaluated: tripleCount,
      constraintsInstantiated: this.solver.constraintCount,
    };
  }

  // ── Phase 2: Trace builder ────────────────────────────────────

  /**
   * Build a serializable inference chain for a single failed constraint.
   *
   * Called per violation during buildReport when TRACE_ENABLED. The
   * chain carries the data UI needs to answer "why did this fire?"
   * WITHOUT holding references to closures (costFn) that can't cross
   * the worker postMessage boundary.
   */
  private buildTrace(args: {
    entityId: string;
    constraint: PCSPConstraint;
    result: ConstraintResult;
    codeRef: CodeReference;
  }): ViolationTrace {
    const { entityId, constraint, result, codeRef } = args;

    // Serializable constraint snapshot — strips costFn.
    const failedConstraint: TracedConstraint = {
      id: constraint.id,
      name: constraint.name,
      codeRef: constraint.codeRef,
      variableIds: constraint.variableIds,
      weight: constraint.weight,
      hard: constraint.hard,
      message: constraint.message,
      cost: result.cost,
      rawCost: result.cost / (constraint.weight || 1),
    };

    // Triples whose subject or connectivity references the violating
    // entity. This shows "what facts in the KG led to this rule firing".
    // Filter is conservative: show only the entity's own triples plus
    // its outgoing/incoming connectsTo edges. Keeps the panel focused.
    const entityUri = `bldg:${entityId}`;
    const sourceTriples = this.kg
      .getAll()
      .filter(
        (t) =>
          t.subject === entityUri ||
          (t.predicate === 'ipc:connectsTo' && t.object === entityUri),
      );

    // Applied conditions: the engine currently hardcodes constraint
    // instantiation per constraint-family rather than scanning rule
    // templates, so conditions reflect the constraint family. This is
    // honest — there's no "rule" that produced trap-arm-distance
    // beyond the engine's own code. When IPCRuleParser gains declarative
    // rules, this list gets populated from the actual matched templates.
    const appliedConditions: TracedRuleCondition[] = [
      {
        ruleId: constraint.id.split('-')[0] ?? 'unknown',
        ruleName: constraint.name,
        matched: true,
        boundEntities: [entityId],
      },
    ];

    return {
      correlationId: undefined, // attached later by the bridge
      appliedConditions,
      failedConstraint,
      sourceTriples,
      sourceCode: {
        code: 'IPC',
        edition: codeRef.edition,
        chapter: codeRef.chapter,
        section: codeRef.section,
        description: codeRef.description,
        url: ipcSectionUrl(codeRef.section),
      },
      // PCSPSolver.solve() is the single phase we currently run; arc
      // consistency is a separate call that may prune domains without
      // producing violations. Mark accordingly.
      phase: 'solve',
      variableValues: result.variableValues,
      solvedAt: performance.now(),
    };
  }

  // ── Apply to DAG ──────────────────────────────────────────────

  private applyToDAG(dag: PlumbingDAG, report: ComplianceReport): void {
    // Clear all violations
    for (const node of dag.getAllNodes()) {
      node.computed.compliant = true;
      node.computed.violations = [];
    }

    // Write violations
    for (const v of report.violations) {
      if (v.entityType === 'node') {
        const node = dag.getNode(v.entityId);
        if (node) {
          node.computed.compliant = false;
          node.computed.violations.push(`[${v.codeRef.section}] ${v.message}`);
        }
      } else {
        const edge = dag.getEdge(v.entityId);
        if (edge) {
          // Write to downstream node
          const toNode = dag.getNode(edge.to);
          if (toNode) {
            toNode.computed.compliant = false;
            toNode.computed.violations.push(`[${v.codeRef.section}] ${v.message}`);
          }
        }
      }
    }
  }
}

// ── Utility ─────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build a deep link to a specific IPC section on UpCodes (best public
 * IPC viewer). Returns undefined for sections the builder doesn't
 * recognize; the UI hides the link gracefully.
 */
function ipcSectionUrl(section: string): string | undefined {
  if (!section || !/^\d/.test(section)) return undefined;
  const chapter = section.split('.')[0];
  if (!chapter) return undefined;
  return `https://up.codes/viewer/general/ipc-2021/chapter/${chapter}#${section}`;
}

/** Singleton. */
let engine: ComplianceEngine | null = null;

export function getComplianceEngine(): ComplianceEngine {
  if (!engine) engine = new ComplianceEngine();
  return engine;
}
