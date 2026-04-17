/**
 * Propagation Solver — multi-pass orchestrator.
 *
 * Runs all solver passes in sequence on the PlumbingDAG:
 *
 *   Pass 1: DFU accumulation (waste) + WSFU accumulation (supply)
 *   Pass 2: Auto pipe sizing from accumulated loads
 *   Pass 3: Darcy-Weisbach pressure drop per edge
 *   Pass 4: ACC compliance (Knowledge Graph + PCSP)  [Phase 2.2]
 *   Pass 5: BOM aggregation
 *
 * Pass 4 was upgraded from hardcoded if/else checks to a full
 * Automated Compliance Checking engine that uses:
 *   - Knowledge Graph triple store (IPC ontology)
 *   - Partial Constraint Satisfaction (cost-minimizing)
 *   - Remediation suggestions with cost impact
 *
 * Target: full solve in < 30ms for a 200-fixture residential building.
 */

import type { PlumbingDAG } from '../graph/PlumbingDAG';
import { simBus, SIM_MSG, type SolveTimingPayload, type CompliancePayload, type BOMPayload } from '../graph/MessageBus';
import { accumulateDFU, accumulateWSFU } from './DFUAccumulator';
import { sizeAllPipes } from './PipeSizer';
import { solveGraphPressure } from './PressureDropCalculator';
import { getComplianceEngine, type ComplianceReport } from '../compliance/ComplianceEngine';

// ── BOM aggregator (Pass 5) ─────────────────────────────────────

function generateBOM(dag: PlumbingDAG): BOMPayload {
  const pipeMap = new Map<string, { length: number; cost: number }>();
  let totalFittingCost = 0;

  for (const edge of dag.getAllEdges()) {
    const key = `${edge.material}|${edge.diameter}`;
    const existing = pipeMap.get(key) ?? { length: 0, cost: 0 };
    existing.length += edge.length;
    existing.cost += edge.computed.materialCost;
    pipeMap.set(key, existing);

    for (const f of edge.fittings) {
      const fittingCost = (5 + edge.diameter * 3) * f.count;
      totalFittingCost += fittingCost;
    }
  }

  const items: BOMPayload['items'] = [];
  for (const [key, data] of pipeMap) {
    const [material, diamStr] = key.split('|');
    const diameter = Number(diamStr);
    items.push({
      description: `${material!.replace(/_/g, ' ')} ${diameter}" pipe`,
      material: material!,
      diameter,
      length: Math.ceil(data.length),
      quantity: 1,
      unitCost: data.length > 0 ? data.cost / data.length : 0,
      totalCost: data.cost,
    });
  }

  const totalMaterialCost = items.reduce((s, i) => s + i.totalCost, 0);

  return {
    items,
    totalMaterialCost,
    totalFittingCost,
    grandTotal: totalMaterialCost + totalFittingCost,
  };
}

// ── Convert ComplianceReport → legacy CompliancePayload ─────────

function reportToPayload(report: ComplianceReport): CompliancePayload {
  return {
    totalViolations: report.violations.length,
    violations: report.violations.map((v) => ({
      nodeId: v.entityType === 'node' ? v.entityId : undefined,
      edgeId: v.entityType === 'edge' ? v.entityId : undefined,
      ruleId: v.ruleId,
      codeRef: `IPC ${v.codeRef.section}`,
      message: v.message,
      severity: v.severity === 'info' ? 'warning' as const : v.severity,
    })),
  };
}

// ── Full solve ──────────────────────────────────────────────────

export interface SolveResult {
  timing: SolveTimingPayload;
  compliance: CompliancePayload;
  complianceReport: ComplianceReport;
  bom: BOMPayload;
}

/**
 * Execute the complete multi-pass solve on the DAG.
 * Emits incremental results on the MessageBus after each pass.
 */
export function solve(dag: PlumbingDAG, tempF: number = 60): SolveResult {
  const t0 = performance.now();

  // Pass 1: DFU + WSFU accumulation
  const dfuResults = accumulateDFU(dag);
  const wsfuResults = accumulateWSFU(dag);
  const t1 = performance.now();
  simBus.send(SIM_MSG.DFU_PROPAGATED, { dfu: dfuResults, wsfu: wsfuResults });

  // Pass 2: Auto pipe sizing
  const sizingResults = sizeAllPipes(dag);
  const t2 = performance.now();
  simBus.send(SIM_MSG.PIPES_SIZED, sizingResults);

  // Pass 3: Pressure drop (Darcy-Weisbach + Colebrook-White)
  const pressureResults = solveGraphPressure(dag, tempF);
  const t3 = performance.now();
  simBus.send(SIM_MSG.PRESSURE_SOLVED, pressureResults);

  // Pass 4: ACC Compliance (Knowledge Graph + PCSP)
  const complianceEngine = getComplianceEngine();
  const complianceReport = complianceEngine.check(dag);
  const compliance = reportToPayload(complianceReport);
  const t4 = performance.now();
  simBus.send(SIM_MSG.COMPLIANCE_CHECKED, compliance);

  // Pass 5: BOM
  const bom = generateBOM(dag);
  const t5 = performance.now();
  simBus.send(SIM_MSG.BOM_GENERATED, bom);

  const timing: SolveTimingPayload = {
    dfuMs: t1 - t0,
    sizingMs: t2 - t1,
    pressureMs: t3 - t2,
    flowMs: 0,
    complianceMs: t4 - t3,
    bomMs: t5 - t4,
    totalMs: t5 - t0,
  };

  simBus.send(SIM_MSG.SIMULATION_COMPLETE, { timing, compliance, complianceReport, bom });

  return { timing, compliance, complianceReport, bom };
}
