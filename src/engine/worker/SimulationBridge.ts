/**
 * Simulation Bridge — relays messages between the main-thread
 * EventBus / SimulationMessageBus and the Web Worker.
 *
 * The bridge:
 *   1. Intercepts graph mutations from the UI (pipe committed,
 *      fixture placed) via the EventBus
 *   2. Serializes them and posts to the Worker
 *   3. Receives computed results from the Worker
 *   4. Re-emits them on the SimulationMessageBus
 *   5. Translates key results into UI EventBus events
 *      (e.g. compliance violations → CUE events for red highlights)
 *
 * If Web Workers are unavailable (e.g. SSR), falls back to running
 * the solver synchronously on the main thread.
 */

import { eventBus } from '../../core/EventBus';
import { EV, type PipeCompletePayload, type ViolationPayload } from '../../core/events';
import {
  simBus,
  SIM_MSG,
  type SimMessage,
  type CompliancePayload,
  type BOMPayload,
  type SolveTimingPayload,
  createMessage,
} from '../graph/MessageBus';
import type { GraphNode } from '../graph/GraphNode';
import type { GraphEdge } from '../graph/GraphEdge';

// ── Bridge state ────────────────────────────────────────────────

export class SimulationBridge {
  private worker: Worker | null = null;
  private solveQueued = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs = 50; // coalesce rapid graph changes

  constructor() {
    this.initWorker();
    this.wireEventBus();
  }

  // ── Worker lifecycle ────────────────────────────────────────

  private initWorker(): void {
    try {
      this.worker = new Worker(
        new URL('./simulation.worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.onmessage = this.onWorkerMessage;
      this.worker.onerror = (err) => {
        console.error('[SimBridge] Worker error:', err);
        simBus.send(SIM_MSG.SIMULATION_ERROR, { message: String(err) });
      };
    } catch {
      console.warn('[SimBridge] Web Worker unavailable, using main-thread fallback');
      this.worker = null;
    }
  }

  /** Terminate the worker (cleanup). */
  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  // ── Send to worker ──────────────────────────────────────────

  private postToWorker(type: string, payload: unknown): void {
    if (!this.worker) {
      // Main-thread fallback: dispatch directly to simBus
      simBus.dispatch(createMessage(type as any, payload));
      return;
    }
    this.worker.postMessage({ type, payload, timestamp: performance.now() });
  }

  /** Send the full graph to the worker (initial load or reset). */
  setGraph(nodes: GraphNode[], edges: GraphEdge[]): void {
    this.postToWorker(SIM_MSG.SET_GRAPH, { nodes, edges });
    this.queueSolve();
  }

  /** Request a full solve. Debounced to coalesce rapid changes. */
  queueSolve(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.postToWorker(SIM_MSG.SOLVE_REQUEST, {});
    }, this.debounceMs);
  }

  // ── Receive from worker ─────────────────────────────────────

  private onWorkerMessage = (event: MessageEvent<SimMessage>): void => {
    const msg = event.data;

    // Forward all messages to the simulation message bus
    simBus.dispatch(msg);

    // Translate compliance violations into UI feedback events
    if (msg.type === SIM_MSG.COMPLIANCE_CHECKED) {
      const compliance = msg.payload as CompliancePayload;
      for (const v of compliance.violations) {
        eventBus.emit<ViolationPayload>(EV.CODE_VIOLATION, {
          ruleId: v.ruleId,
          message: v.message,
          position: [0, 0, 0], // Position will be resolved by visual layer
          codeRef: v.codeRef,
        });
      }
      if (compliance.totalViolations === 0) {
        eventBus.emit(EV.CODE_COMPLIANT, null);
      }
    }

    // Log solve timing
    if (msg.type === SIM_MSG.SIMULATION_COMPLETE) {
      const result = msg.payload as { timing: SolveTimingPayload };
      if (result.timing.totalMs > 30) {
        console.warn(
          `[SimBridge] Solve took ${result.timing.totalMs.toFixed(1)}ms (target: <30ms)`,
        );
      }
    }
  };

  // ── EventBus → Worker wiring ────────────────────────────────

  private wireEventBus(): void {
    // When a pipe route is committed, add edges to the graph
    eventBus.on<PipeCompletePayload>(EV.PIPE_COMPLETE, (payload) => {
      // Each consecutive pair of points becomes an edge
      for (let i = 1; i < payload.points.length; i++) {
        const from = payload.points[i - 1]!;
        const to = payload.points[i]!;
        const dx = to[0] - from[0];
        const dy = to[1] - from[1];
        const dz = to[2] - from[2];
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Create junction nodes at each waypoint
        const fromNodeId = `wp-${payload.id}-${i - 1}`;
        const toNodeId = `wp-${payload.id}-${i}`;

        this.postToWorker(SIM_MSG.ADD_NODE, {
          id: fromNodeId,
          type: 'junction',
          system: 'waste',
          dfu: 0,
          trapSize: 0,
          supply: { coldWSFU: 0, hotWSFU: 0, totalWSFU: 0, minBranchSize: 0 },
          computed: {
            accumulatedDFU: 0, accumulatedWSFU: 0,
            pressure: 0, flowRate: 0,
            compliant: true, violations: [],
            sizedDiameter: 0,
          },
          elevation: from[1],
          label: `waypoint ${i - 1}`,
        });

        if (i === payload.points.length - 1) {
          this.postToWorker(SIM_MSG.ADD_NODE, {
            id: toNodeId,
            type: 'junction',
            system: 'waste',
            dfu: 0,
            trapSize: 0,
            supply: { coldWSFU: 0, hotWSFU: 0, totalWSFU: 0, minBranchSize: 0 },
            computed: {
              accumulatedDFU: 0, accumulatedWSFU: 0,
              pressure: 0, flowRate: 0,
              compliant: true, violations: [],
              sizedDiameter: 0,
            },
            elevation: to[1],
            label: `waypoint ${i}`,
          });
        }

        this.postToWorker(SIM_MSG.ADD_EDGE, {
          id: `edge-${payload.id}-${i}`,
          from: fromNodeId,
          to: toNodeId,
          material: payload.material ?? 'pvc_sch40',
          diameter: payload.diameter,
          length,
          slope: length > 0 ? Math.abs(dy) / Math.sqrt(dx * dx + dz * dz + 0.001) * 12 : 0,
          elevationDelta: dy,
          fittings: [],
          computed: {
            equivalentLength: length,
            frictionLoss: 0, velocity: 0, reynolds: 0,
            frictionFactor: 0, pressureDrop: 0,
            properlySized: true, materialCost: 0,
          },
        });
      }

      // Trigger re-solve after all edges are added
      this.queueSolve();
    });

    // When a pipe is removed (undo), remove its nodes and edges from the graph
    eventBus.on<{ id: string }>('pipe:removed', (payload) => {
      this.removePipeFromGraph(payload.id);
    });
  }

  /**
   * Remove all graph nodes and edges that belong to a specific pipe.
   * Node IDs: wp-{pipeId}-{index}, Edge IDs: edge-{pipeId}-{index}
   */
  private removePipeFromGraph(pipeId: string): void {
    // We don't know the exact segment count, so remove by prefix.
    // Send removals for indices 0..50 (more than any realistic pipe).
    // The worker silently ignores removals for non-existent IDs.
    for (let i = 0; i < 50; i++) {
      this.postToWorker(SIM_MSG.REMOVE_EDGE, { edgeId: `edge-${pipeId}-${i}` });
    }
    for (let i = 0; i < 51; i++) {
      this.postToWorker(SIM_MSG.REMOVE_NODE, { nodeId: `wp-${pipeId}-${i}` });
    }

    // Re-solve with the reduced graph
    this.queueSolve();
  }
}

/** Singleton bridge instance. */
let bridge: SimulationBridge | null = null;

export function getSimulationBridge(): SimulationBridge {
  if (!bridge) bridge = new SimulationBridge();
  return bridge;
}
