/**
 * Simulation Web Worker — runs the headless solver off the main thread.
 *
 * Receives graph data and solve commands via postMessage.
 * Runs the full PropagationSolver and posts results back.
 * The main thread NEVER directly accesses the DAG — all data
 * flows through structured-clone serialized messages.
 *
 * This guarantees zero framerate impact from heavy engineering
 * calculations, even on large commercial building networks.
 */

import { PlumbingDAG } from '../graph/PlumbingDAG';
import { SIM_MSG, type SimMessage } from '../graph/MessageBus';
import { solve } from '../solver/PropagationSolver';
import type { GraphNode } from '../graph/GraphNode';
import type { GraphEdge } from '../graph/GraphEdge';
import { SharedDagBuffer, type DagBufferCapacity } from './SharedDagBuffer';
import { createFixtureNode, createJunctionNode, createDrainNode } from '../graph/GraphNode';
import { createEdge } from '../graph/GraphEdge';

// ── Worker state ────────────────────────────────────────────────

let dag = new PlumbingDAG();

// ── Message handler ─────────────────────────────────────────────

self.onmessage = (event: MessageEvent<SimMessage>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case SIM_MSG.SET_GRAPH: {
        const data = msg.payload as { nodes: GraphNode[]; edges: GraphEdge[] };
        dag = PlumbingDAG.deserialize(data);
        postResult(SIM_MSG.GRAPH_UPDATED, {
          nodeCount: dag.nodeCount,
          edgeCount: dag.edgeCount,
        });
        break;
      }

      // Phase 3: zero-copy graph transport. Main thread packed the DAG
      // into a SharedArrayBuffer; we re-wrap it and rebuild the DAG
      // without any structured-clone cost. The heavy work is object
      // construction — which we have to do anyway to feed into the
      // existing solver. A future phase can push the packed format
      // deeper into the solver so this rehydration step goes away.
      case SIM_MSG.SET_GRAPH_SAB: {
        const data = msg.payload as {
          buffer: SharedArrayBuffer | ArrayBuffer;
          capacity: DagBufferCapacity;
        };
        const sharedBuf = new SharedDagBuffer(data.capacity, data.buffer);
        const { nodes: packedNodes, edges: packedEdges } = sharedBuf.readGraph();

        dag = new PlumbingDAG();
        // Rehydrate into the engine's existing node/edge shape.
        for (const pn of packedNodes) {
          // Node factories generate their own string IDs; we need the
          // original IDs so edges match. Construct minimally and
          // overwrite id.
          let node: GraphNode;
          if (pn.type === 'fixture' && pn.fixtureSubtype) {
            node = createFixtureNode(pn.fixtureSubtype, pn.system, pn.elevation);
          } else if (pn.type === 'drain') {
            node = createDrainNode(pn.elevation);
          } else {
            node = createJunctionNode(pn.system, pn.elevation);
          }
          node.id = pn.id;
          node.dfu = pn.dfu;
          node.trapSize = pn.trapSize;
          node.supply.coldWSFU = pn.coldWSFU;
          node.supply.hotWSFU = pn.hotWSFU;
          node.supply.totalWSFU = pn.coldWSFU + pn.hotWSFU;
          dag.addNode(node);
        }

        for (const pe of packedEdges) {
          const fromNode = packedNodes[pe.fromNodeIdx];
          const toNode = packedNodes[pe.toNodeIdx];
          if (!fromNode || !toNode) continue;
          const edge = createEdge(
            fromNode.id,
            toNode.id,
            pe.material,
            pe.diameter,
            pe.length,
            pe.slope,
            pe.elevationDelta,
          );
          edge.id = pe.id;
          dag.addEdge(edge);
        }

        postResult(SIM_MSG.GRAPH_UPDATED, {
          nodeCount: dag.nodeCount,
          edgeCount: dag.edgeCount,
        });
        break;
      }

      case SIM_MSG.ADD_NODE: {
        const node = msg.payload as GraphNode;
        dag.addNode(node);
        postResult(SIM_MSG.GRAPH_UPDATED, {
          nodeCount: dag.nodeCount,
          edgeCount: dag.edgeCount,
        });
        break;
      }

      case SIM_MSG.ADD_EDGE: {
        const edge = msg.payload as GraphEdge;
        dag.addEdge(edge);
        postResult(SIM_MSG.GRAPH_UPDATED, {
          nodeCount: dag.nodeCount,
          edgeCount: dag.edgeCount,
        });
        break;
      }

      case SIM_MSG.REMOVE_NODE: {
        const { nodeId } = msg.payload as { nodeId: string };
        dag.removeNode(nodeId);
        postResult(SIM_MSG.GRAPH_UPDATED, {
          nodeCount: dag.nodeCount,
          edgeCount: dag.edgeCount,
        });
        break;
      }

      case SIM_MSG.REMOVE_EDGE: {
        const { edgeId } = msg.payload as { edgeId: string };
        dag.removeEdge(edgeId);
        postResult(SIM_MSG.GRAPH_UPDATED, {
          nodeCount: dag.nodeCount,
          edgeCount: dag.edgeCount,
        });
        break;
      }

      // Phase 14.AC.3 — batch add/remove in one postMessage. Order
      // matters: remove edges FIRST (so we don't leave orphan edges
      // pointing at nodes we're about to delete), then remove nodes,
      // then add nodes (parents of new edges must exist), then add
      // edges. One GRAPH_UPDATED at the end replaces the N responses
      // the individual-message path produced.
      case SIM_MSG.BATCH_MUTATE: {
        const batch = msg.payload as {
          nodesToAdd: GraphNode[];
          edgesToAdd: GraphEdge[];
          nodeIdsToRemove: string[];
          edgeIdsToRemove: string[];
        };
        for (const id of batch.edgeIdsToRemove) dag.removeEdge(id);
        for (const id of batch.nodeIdsToRemove) dag.removeNode(id);
        for (const node of batch.nodesToAdd) dag.addNode(node);
        for (const edge of batch.edgesToAdd) dag.addEdge(edge);
        postResult(SIM_MSG.GRAPH_UPDATED, {
          nodeCount: dag.nodeCount,
          edgeCount: dag.edgeCount,
        });
        break;
      }

      case SIM_MSG.SOLVE_REQUEST: {
        const opts = (msg.payload ?? {}) as { tempF?: number };
        const result = solve(dag, opts.tempF ?? 60);

        // Send per-node computed state
        for (const node of dag.getAllNodes()) {
          postResult(SIM_MSG.NODE_COMPUTED, {
            nodeId: node.id,
            ...node.computed,
          });
        }

        // Send per-edge computed state
        for (const edge of dag.getAllEdges()) {
          postResult(SIM_MSG.EDGE_COMPUTED, {
            edgeId: edge.id,
            ...edge.computed,
          });
        }

        // Send final results
        postResult(SIM_MSG.SIMULATION_COMPLETE, result);
        break;
      }
    }
  } catch (err) {
    postResult(SIM_MSG.SIMULATION_ERROR, {
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

// ── Helper ──────────────────────────────────────────────────────

function postResult(type: string, payload: unknown): void {
  (self as unknown as Worker).postMessage({
    type,
    payload,
    timestamp: performance.now(),
  });
}
