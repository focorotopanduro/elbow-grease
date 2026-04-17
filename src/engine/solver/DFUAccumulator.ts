/**
 * DFU Accumulator — drainage fixture unit summation per IPC.
 *
 * Traverses the waste DAG in reverse topological order (fixtures first,
 * drain last), accumulating DFU at each junction and stack node.
 *
 * This is Pass 1 of the multi-pass solver. Its output feeds directly
 * into the PipeSizer (Pass 2).
 *
 * IPC references:
 *   Table 709.1 — DFU values per fixture type
 *   Table 710.1 — Max DFU on horizontal branches by pipe size
 *   Table 710.2 — Max DFU on vertical stacks by pipe size
 */

import type { PlumbingDAG } from '../graph/PlumbingDAG';
import type { GraphNode } from '../graph/GraphNode';

export interface DFUResult {
  nodeId: string;
  accumulatedDFU: number;
  upstreamFixtureCount: number;
}

/**
 * Accumulate DFU from fixtures → junctions → stacks → drain.
 *
 * Uses reverse topological order: process leaves (fixtures) first,
 * then propagate upstream accumulations downstream through junctions.
 */
export function accumulateDFU(dag: PlumbingDAG): DFUResult[] {
  const topo = dag.topologicalSort();
  const results: DFUResult[] = [];

  // Initialize accumulators
  const dfuMap = new Map<string, number>();
  const fixtureCountMap = new Map<string, number>();

  for (const nodeId of topo) {
    const node = dag.getNode(nodeId)!;
    // Start with this node's own DFU (fixtures have DFU > 0, others = 0)
    dfuMap.set(nodeId, node.dfu);
    fixtureCountMap.set(nodeId, node.type === 'fixture' ? 1 : 0);
  }

  // Forward pass: accumulate from upstream → downstream
  for (const nodeId of topo) {
    const outEdges = dag.getOutgoingEdges(nodeId);
    const myDFU = dfuMap.get(nodeId)!;
    const myCount = fixtureCountMap.get(nodeId)!;

    for (const edge of outEdges) {
      const downId = edge.to;
      dfuMap.set(downId, (dfuMap.get(downId) ?? 0) + myDFU);
      fixtureCountMap.set(downId, (fixtureCountMap.get(downId) ?? 0) + myCount);
    }
  }

  // Write results back to node computed state
  for (const nodeId of topo) {
    const node = dag.getNode(nodeId)!;
    const accDFU = dfuMap.get(nodeId) ?? 0;
    node.computed.accumulatedDFU = accDFU;

    results.push({
      nodeId,
      accumulatedDFU: accDFU,
      upstreamFixtureCount: fixtureCountMap.get(nodeId) ?? 0,
    });
  }

  return results;
}

// ── WSFU accumulation (supply side) ─────────────────────────────

export interface WSFUResult {
  nodeId: string;
  accumulatedWSFU: number;
  coldWSFU: number;
  hotWSFU: number;
}

/**
 * Accumulate WSFU from fixtures backward to supply source.
 * Uses reverse topological order (drain→source direction).
 */
export function accumulateWSFU(dag: PlumbingDAG): WSFUResult[] {
  const reverseTopo = dag.reverseTopologicalSort();
  const results: WSFUResult[] = [];

  const coldMap = new Map<string, number>();
  const hotMap = new Map<string, number>();

  // Initialize with fixture demands
  for (const nodeId of reverseTopo) {
    const node = dag.getNode(nodeId)!;
    coldMap.set(nodeId, node.supply.coldWSFU);
    hotMap.set(nodeId, node.supply.hotWSFU);
  }

  // Backward pass: accumulate from downstream → upstream
  for (const nodeId of reverseTopo) {
    const inEdges = dag.getIncomingEdges(nodeId);
    const myCold = coldMap.get(nodeId)!;
    const myHot = hotMap.get(nodeId)!;

    for (const edge of inEdges) {
      const upId = edge.from;
      coldMap.set(upId, (coldMap.get(upId) ?? 0) + myCold);
      hotMap.set(upId, (hotMap.get(upId) ?? 0) + myHot);
    }
  }

  for (const nodeId of reverseTopo) {
    const node = dag.getNode(nodeId)!;
    const cold = coldMap.get(nodeId) ?? 0;
    const hot = hotMap.get(nodeId) ?? 0;
    node.computed.accumulatedWSFU = cold + hot;

    results.push({
      nodeId,
      accumulatedWSFU: cold + hot,
      coldWSFU: cold,
      hotWSFU: hot,
    });
  }

  return results;
}
