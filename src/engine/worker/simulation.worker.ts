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
