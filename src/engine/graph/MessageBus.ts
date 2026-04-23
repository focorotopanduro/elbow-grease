/**
 * Simulation MessageBus — typed message-passing interface between
 * the headless engine and the visual frontend.
 *
 * This is NOT the same as the UI EventBus (src/core/EventBus.ts).
 * The UI EventBus handles user interactions and sensory feedback.
 * This MessageBus handles heavy engineering data flowing from the
 * simulation kernel to any subscriber — primarily the visual engine
 * and the BOM aggregator.
 *
 * Design principle: DATA IS NEVER DIRECTLY SHARED BETWEEN THREADS.
 * When the simulation runs in a Web Worker, messages are serialized
 * via structured clone. When running on the main thread (fallback),
 * messages are still passed through this interface to maintain the
 * same decoupled architecture.
 *
 * Message categories:
 *
 *   GRAPH_UPDATED       — The DAG structure changed (node/edge added/removed)
 *   DFU_PROPAGATED      — DFU accumulation pass completed
 *   PIPES_SIZED         — Auto-sizing pass completed
 *   PRESSURE_SOLVED     — Pressure drop calculation completed
 *   FLOW_SOLVED         — Flow rate calculation completed
 *   COMPLIANCE_CHECKED  — All code compliance checks completed
 *   BOM_GENERATED       — Bill of Materials generated
 *   SIMULATION_COMPLETE — Full solve cycle finished (all passes)
 *   SIMULATION_ERROR    — An error occurred during solving
 */

// ── Message types ───────────────────────────────────────────────

export const SIM_MSG = {
  // Commands (main thread → worker)
  SOLVE_REQUEST:       'sim:solve:request',
  ADD_NODE:            'sim:add:node',
  ADD_EDGE:            'sim:add:edge',
  REMOVE_NODE:         'sim:remove:node',
  REMOVE_EDGE:         'sim:remove:edge',
  SET_GRAPH:           'sim:set:graph',
  // Phase 3: zero-copy variant — payload is a SharedArrayBuffer handle
  // + capacity (main thread packs the slab, worker re-wraps and reads).
  SET_GRAPH_SAB:       'sim:set:graph:sab',
  // Phase 14.AC.3: one postMessage per debounce window carrying ALL
  // pipe add/remove mutations pending at flush time. See
  // `src/engine/worker/mutationBatching.ts` for the payload shape.
  BATCH_MUTATE:        'sim:batch:mutate',

  // Results (worker → main thread)
  GRAPH_UPDATED:       'sim:graph:updated',
  DFU_PROPAGATED:      'sim:dfu:propagated',
  PIPES_SIZED:         'sim:pipes:sized',
  PRESSURE_SOLVED:     'sim:pressure:solved',
  FLOW_SOLVED:         'sim:flow:solved',
  COMPLIANCE_CHECKED:  'sim:compliance:checked',
  BOM_GENERATED:       'sim:bom:generated',
  SIMULATION_COMPLETE: 'sim:complete',
  SIMULATION_ERROR:    'sim:error',

  // Incremental updates (per-node/edge results)
  NODE_COMPUTED:       'sim:node:computed',
  EDGE_COMPUTED:       'sim:edge:computed',
} as const;

export type SimMessageType = (typeof SIM_MSG)[keyof typeof SIM_MSG];

// ── Message payloads ────────────────────────────────────────────

export interface NodeComputedPayload {
  nodeId: string;
  accumulatedDFU: number;
  accumulatedWSFU: number;
  pressure: number;
  flowRate: number;
  sizedDiameter: number;
  compliant: boolean;
  violations: string[];
}

export interface EdgeComputedPayload {
  edgeId: string;
  equivalentLength: number;
  frictionLoss: number;
  velocity: number;
  reynolds: number;
  frictionFactor: number;
  pressureDrop: number;
  properlySized: boolean;
  materialCost: number;
}

export interface CompliancePayload {
  totalViolations: number;
  violations: {
    nodeId?: string;
    edgeId?: string;
    ruleId: string;
    codeRef: string;
    message: string;
    severity: 'warning' | 'error';
  }[];
}

export interface BOMPayload {
  items: {
    description: string;
    material: string;
    diameter: number;
    length: number;
    quantity: number;
    unitCost: number;
    totalCost: number;
  }[];
  totalMaterialCost: number;
  totalFittingCost: number;
  grandTotal: number;
}

export interface SolveTimingPayload {
  dfuMs: number;
  sizingMs: number;
  pressureMs: number;
  flowMs: number;
  complianceMs: number;
  bomMs: number;
  totalMs: number;
}

// ── Envelope ────────────────────────────────────────────────────

export interface SimMessage<T = unknown> {
  type: SimMessageType;
  payload: T;
  timestamp: number;
}

export function createMessage<T>(type: SimMessageType, payload: T): SimMessage<T> {
  return { type, payload, timestamp: performance.now() };
}

// ── MessageBus class ────────────────────────────────────────────

type SimHandler<T = unknown> = (msg: SimMessage<T>) => void;

export class SimulationMessageBus {
  private handlers = new Map<string, Set<SimHandler>>();

  on<T>(type: SimMessageType, handler: SimHandler<T>): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler as SimHandler);
    return () => this.off(type, handler);
  }

  off<T>(type: SimMessageType, handler: SimHandler<T>): void {
    this.handlers.get(type)?.delete(handler as SimHandler);
  }

  dispatch<T>(msg: SimMessage<T>): void {
    this.handlers.get(msg.type)?.forEach((h) => h(msg));
  }

  /** Convenience: create + dispatch in one call. */
  send<T>(type: SimMessageType, payload: T): void {
    this.dispatch(createMessage(type, payload));
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const simBus = new SimulationMessageBus();
