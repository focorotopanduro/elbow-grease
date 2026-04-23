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
import type { GraphEdge, PipeMaterial } from '../graph/GraphEdge';
import {
  composeMutationBatch,
  isEmptyBatch,
  pipeGraphIds,
  pipeToMutations,
  fixtureNodeId,
  defaultSystemForFixture,
  type PipeCommit,
  type FixtureCommit,
  type GraphMutationBatch,
} from './mutationBatching';
import type { FixtureSubtype } from '../graph/GraphNode';
import {
  SharedDagBuffer,
  isSabAvailable,
  dagBufferSize,
  type PackedNodeInput,
  type PackedEdgeInput,
  type NodeTypeStr,
  type SystemTypeStr,
  type FixtureSubtypeStr,
  type PipeMaterialStr,
} from './SharedDagBuffer';
import { getFlag, useFeatureFlagStore } from '@store/featureFlagStore';
// Phase 2c (ARCHITECTURE.md §4.5) — appMode read at the top of the
// PIPE_COMPLETE / pipe:removed / fixture handlers to early-return
// when the user is in the roofing workspace. The bridge is
// plumbing-only; PIPE_COMPLETE must never wake the worker on a
// roof-section commit that happens to reuse the same event name.
import { useAppModeStore } from '@store/appModeStore';
import { logger } from '@core/logger/Logger';
// Phase 10.D — round-trip latency → PerfStats.
// Phase 14.AC.4 — batch size → PerfStats.
import { recordWorkerRoundTrip, recordBatchMutation } from '@core/perf/PerfStats';

const log = logger('SimBridge');

// Default capacity for the SAB graph transport. Chosen to cover a
// large commercial scene (mid-rise, ~8 stories × 4 apartments/floor).
// A graph that overflows these limits falls back to structured clone
// automatically — no hard failure mode.
const DEFAULT_SAB_CAPACITY = {
  nodes: 4096,
  edges: 12288,
  idTableBytes: 256 * 1024, // 256 KB room for string IDs
};

/**
 * Phase 14.AC.7 — pipe-endpoint → fixture proximity tolerance, in
 * feet. Pipe endpoints within this radius of a known fixture's
 * position get spliced onto the fixture's graph node instead of
 * creating a fresh `wp-…-0` junction.
 *
 * 0.1 ft = ~1.2 inches. Tighter than the 0.3 ft draw-snap grid
 * so two fixtures at neighboring cells can't both claim the same
 * pipe endpoint. See `findFixtureNodeAt` for the lookup logic.
 */
const FIXTURE_SNAP_TOLERANCE_FT = 0.1;

// ── Bridge state ────────────────────────────────────────────────

export class SimulationBridge {
  private worker: Worker | null = null;
  private solveQueued = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs = 50; // coalesce rapid graph changes
  /**
   * Phase 10.D — Timestamp of the most-recent SOLVE_REQUEST sent to
   * the worker. On SIMULATION_COMPLETE we compute the round-trip and
   * feed it to PerfStats. Zero-overhead when the HUD is off — the
   * recording call is a single array write.
   */
  private lastSolveSentAt = 0;

  /**
   * Phase 14.AC.3 — outgoing graph mutation queue. PIPE_COMPLETE and
   * pipe:removed events push here instead of posting per-segment. At
   * debounce flush time we build ONE `BATCH_MUTATE` message and send
   * it before the SOLVE_REQUEST. Typical paste / riser-drop goes from
   * ~40 postMessage crossings down to 2.
   */
  private pendingPipeCommits: PipeCommit[] = [];
  private pendingRemovedNodeIds: string[] = [];
  private pendingRemovedEdgeIds: string[] = [];

  /**
   * Phase 14.AC.6 — fixture side of the same queue. Only populated
   * when the `fixtureGraph` feature flag is on. Pure add-only: the
   * fixture node ID goes into `pendingRemovedNodeIds` on removal,
   * piggybacking on the existing node-removal path.
   */
  private pendingFixtureCommits: FixtureCommit[] = [];

  /**
   * Most-recent known position per fixture. Phase 14.AC.6.
   *
   * The `FIXTURE_PARAMS_CHANGED` event doesn't carry position (the
   * fixtureStore's `setPosition` doesn't emit any event — a latent
   * gap, out of scope here), so to re-build a fixture's node after
   * a params change we need to remember where the thing lives. This
   * index is populated on every FIXTURE_PLACED and read on
   * FIXTURE_PARAMS_CHANGED.
   */
  private fixturePositionIndex = new Map<string, [number, number, number]>();

  /**
   * Remember the exact node+edge IDs each committed pipe owns so that
   * `pipe:removed` can do precise removals instead of enumerating
   * `wp-{id}-0..50` the way the pre-14.AC.3 bridge did.
   */
  private pipeIdIndex = new Map<string, { nodeIds: string[]; edgeIds: string[] }>();

  /** Expose last-batch instrumentation for tests + future perf overlay. */
  public lastBatchSent: GraphMutationBatch | null = null;

  /**
   * Phase 14.AC.8 — unsubscribe callback for the feature-flag
   * store subscription. Held so `destroy()` can clean it up.
   */
  private flagUnsubscribe: (() => void) | null = null;

  constructor() {
    this.initWorker();
    this.wireEventBus();
    this.wireFlagFlip();
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
        log.error('worker error', err);
        simBus.send(SIM_MSG.SIMULATION_ERROR, { message: String(err) });
      };
    } catch {
      log.info('Web Worker unavailable, using main-thread fallback');
      this.worker = null;
    }
  }

  /** Terminate the worker (cleanup). */
  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.flagUnsubscribe?.();
    this.flagUnsubscribe = null;
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

  /**
   * Send the full graph to the worker (initial load or reset).
   *
   * Phase 3: when the `sabIpc` flag is on AND SharedArrayBuffer is
   * available AND the graph fits in the default capacity, we ship it
   * as a packed slab in a SAB — no structured clone. Otherwise we
   * fall back to today's postMessage path, preserving semantics.
   */
  setGraph(nodes: GraphNode[], edges: GraphEdge[]): void {
    if (
      getFlag('sabIpc') &&
      isSabAvailable() &&
      this.worker &&
      nodes.length <= DEFAULT_SAB_CAPACITY.nodes &&
      edges.length <= DEFAULT_SAB_CAPACITY.edges
    ) {
      try {
        this.setGraphViaSab(nodes, edges);
        this.queueSolve();
        return;
      } catch (err) {
        // Any failure (overflow, lock timeout, etc) falls through to
        // structured clone. Log once so the God Mode "Logs" tab sees it.
        log.info('SAB setGraph failed, falling back to structured clone', err);
      }
    }
    this.postToWorker(SIM_MSG.SET_GRAPH, { nodes, edges });
    this.queueSolve();
  }

  // ── SAB graph transport (Phase 3) ─────────────────────────

  /**
   * Write the graph into a fresh SharedDagBuffer and post a lightweight
   * control message to the worker with a transferable reference. The
   * worker re-wraps the buffer via `new SharedDagBuffer(capacity, buf)`
   * and reads the graph without any structured-clone cost.
   *
   * Note: SharedArrayBuffer itself is shared, NOT transferred — both
   * sides keep independent DataViews over the same bytes.
   */
  private setGraphViaSab(nodes: GraphNode[], edges: GraphEdge[]): void {
    if (!this.worker) return;

    const nodeIdToIdx = new Map<string, number>();
    nodes.forEach((n, i) => nodeIdToIdx.set(n.id, i));

    const packedNodes: PackedNodeInput[] = nodes.map((n) => ({
      id: n.id,
      type: n.type as NodeTypeStr,
      system: n.system as SystemTypeStr,
      fixtureSubtype: n.fixtureSubtype as FixtureSubtypeStr | undefined,
      dfu: n.dfu,
      trapSize: n.trapSize,
      elevation: n.elevation,
      coldWSFU: n.supply.coldWSFU,
      hotWSFU: n.supply.hotWSFU,
    }));

    const packedEdges: PackedEdgeInput[] = edges.map((e) => ({
      id: e.id,
      fromNodeIdx: nodeIdToIdx.get(e.from) ?? 0,
      toNodeIdx: nodeIdToIdx.get(e.to) ?? 0,
      material: e.material as PipeMaterialStr,
      diameter: e.diameter,
      length: e.length,
      slope: e.slope,
      elevationDelta: e.elevationDelta,
    }));

    // Use existing buffer if one exists & capacity matches; otherwise
    // allocate a fresh SAB sized to the default capacity.
    if (!this.sharedDagBuffer) {
      this.sharedDagBuffer = new SharedDagBuffer(DEFAULT_SAB_CAPACITY);
    }
    this.sharedDagBuffer.writeGraph(packedNodes, packedEdges);

    // Ship the buffer handle + capacity to the worker. Structured clone
    // of the SharedArrayBuffer itself is ~O(1) — the underlying bytes
    // are NOT copied, only the handle is shared.
    this.worker.postMessage({
      type: SIM_MSG.SET_GRAPH_SAB,
      payload: {
        buffer: this.sharedDagBuffer.buffer,
        capacity: DEFAULT_SAB_CAPACITY,
      },
      timestamp: performance.now(),
    });
  }

  /** Heap-held buffer reused across setGraphViaSab calls. */
  private sharedDagBuffer: SharedDagBuffer | null = null;

  /**
   * Request a full solve. Debounced to coalesce rapid changes. Any
   * mutations pushed between now and the debounce fire are flushed as
   * a single `BATCH_MUTATE` postMessage immediately before the
   * `SOLVE_REQUEST` — see Phase 14.AC.3.
   */
  queueSolve(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.flushPendingMutations();
      // Stamp now so we can measure round-trip when the result arrives.
      this.lastSolveSentAt = performance.now();
      this.postToWorker(SIM_MSG.SOLVE_REQUEST, {});
    }, this.debounceMs);
  }

  /**
   * Build one `BATCH_MUTATE` payload from whatever has accumulated in
   * the pending queues and post it. No-op if everything cancelled out
   * (pipe added + removed in the same window).
   */
  private flushPendingMutations(): void {
    if (
      this.pendingPipeCommits.length === 0
      && this.pendingFixtureCommits.length === 0
      && this.pendingRemovedNodeIds.length === 0
      && this.pendingRemovedEdgeIds.length === 0
    ) {
      this.lastBatchSent = null;
      return;
    }

    const batch = composeMutationBatch(
      this.pendingPipeCommits,
      this.pendingRemovedNodeIds,
      this.pendingRemovedEdgeIds,
      this.pendingFixtureCommits,
    );

    // Clear queues BEFORE posting so a re-entrant solve (from inside
    // a response handler) starts with a clean slate.
    this.pendingPipeCommits = [];
    this.pendingFixtureCommits = [];
    this.pendingRemovedNodeIds = [];
    this.pendingRemovedEdgeIds = [];

    this.lastBatchSent = batch;

    // Always publish the batch size (including 0 for empty-cancel)
    // so the PerfHUD reflects the current state rather than a stale
    // number from a previous burst. (Phase 14.AC.4.)
    const totalOps =
      batch.nodesToAdd.length
      + batch.edgesToAdd.length
      + batch.nodeIdsToRemove.length
      + batch.edgeIdsToRemove.length;
    recordBatchMutation(totalOps);

    if (!isEmptyBatch(batch)) {
      this.postToWorker(SIM_MSG.BATCH_MUTATE, batch);
    }
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

    // Log solve timing + record round-trip for PerfStats.
    if (msg.type === SIM_MSG.SIMULATION_COMPLETE) {
      const result = msg.payload as { timing: SolveTimingPayload };
      if (result.timing.totalMs > 30) {
        log.warn(`slow solve: ${result.timing.totalMs.toFixed(1)}ms (target: <30ms)`, result.timing);
      }
      // Phase 10.D — round-trip from solve request dispatch to
      // complete-arrival includes worker CPU + postMessage queueing.
      if (this.lastSolveSentAt > 0) {
        const rtt = performance.now() - this.lastSolveSentAt;
        recordWorkerRoundTrip(rtt);
        this.lastSolveSentAt = 0;
      }
    }
  };

  // ── EventBus → Worker wiring ────────────────────────────────

  private wireEventBus(): void {
    // When a pipe route is committed, QUEUE graph mutations; they'll
    // be flushed as one BATCH_MUTATE at the next debounce fire. Bursts
    // of commits (paste, riser drop, auto-route) now cost one
    // postMessage total instead of N per pipe.
    eventBus.on<PipeCompletePayload>(EV.PIPE_COMPLETE, (payload) => {
      // Phase 2c (ARCHITECTURE.md §4.5) — SimulationBridge is
      // plumbing-only. When the user is in the roofing workspace,
      // ignore the event entirely: no mutations queued, no worker
      // wake, no fixture-node lookups. Cheap insurance against any
      // future event leakage (e.g. a roof takeoff flow accidentally
      // emitting PIPE_COMPLETE during a polygon commit).
      if (useAppModeStore.getState().mode !== 'plumbing') return;

      // Phase 14.AC.7 — when the fixture-graph flag is on, check
      // whether the pipe's endpoints sit on a known fixture and
      // splice the fixture's node ID into the edge. This is the
      // step that makes DFU / WSFU actually propagate: pipe →
      // fixture connections give the solver somewhere to put the
      // load. When the flag is off, overrides stay undefined and
      // the pipe commits with all-junction waypoints (pre-AC.7
      // behaviour).
      const startNodeOverride = getFlag('fixtureGraph')
        ? this.findFixtureNodeAt(payload.points[0]!)
        : undefined;
      const endNodeOverride = getFlag('fixtureGraph')
        ? this.findFixtureNodeAt(payload.points[payload.points.length - 1]!)
        : undefined;

      const commit: PipeCommit = {
        id: payload.id,
        points: payload.points,
        diameter: payload.diameter,
        material: (payload.material ?? 'pvc_sch40') as PipeMaterial,
        startNodeOverride,
        endNodeOverride,
      };
      this.pendingPipeCommits.push(commit);

      // Remember the EXACT node ids we'll create so a later
      // pipe:removed cleans up precisely — and crucially, does
      // NOT remove the fixture node(s) we spliced in. Derive by
      // actually running the pure builder once up front.
      const { nodes, edges } = pipeToMutations(commit);
      this.pipeIdIndex.set(payload.id, {
        nodeIds: nodes.map((n) => n.id),
        edgeIds: edges.map((e) => e.id),
      });

      this.queueSolve();
    });

    // When a pipe is removed (undo, delete), queue its exact IDs for
    // removal in the next batch.
    eventBus.on<{ id: string }>('pipe:removed', (payload) => {
      this.queuePipeRemoval(payload.id);
    });

    // Phase 14.AC.6 — fixture graph wiring (flag-gated).
    //
    // Handlers are ALWAYS subscribed so the flag can be toggled at
    // runtime without resubscribing. The `fixtureGraph` check inside
    // each handler is one boolean read — cheaper than juggling
    // unsubscribe callbacks.
    //
    // Behaviour when flag is off: events arrive but nothing is
    // queued. Solver graph stays junction-only (pre-14.AC.6 state).
    eventBus.on<{ id: string; subtype: FixtureSubtype; position: [number, number, number] }>(
      EV.FIXTURE_PLACED,
      (payload) => {
        if (!getFlag('fixtureGraph')) return;
        this.fixturePositionIndex.set(payload.id, payload.position);
        this.queueFixturePlacement(payload.id, payload.subtype, payload.position);
      },
    );

    eventBus.on<{ id: string }>(EV.FIXTURE_REMOVED, (payload) => {
      if (!getFlag('fixtureGraph')) return;
      this.pendingRemovedNodeIds.push(fixtureNodeId(payload.id));
      this.fixturePositionIndex.delete(payload.id);
      this.queueSolve();
    });

    // FIXTURE_PARAMS_CHANGED can alter DFU / supply (subtype in
    // practice is creation-time, but we re-read it defensively in
    // case it ever becomes mutable).
    //
    // Phase 14.AC.11 — we used to queue a remove + re-add for the
    // PARAMS_CHANGED case, relying on composeMutationBatch's
    // cancellation to no-op the identical-payload branch. Problem:
    // `dag.removeNode()` cascade-destroys every incident edge, so
    // removing + re-adding a fixture that has live pipes connected
    // would orphan the pipe edges on the worker side. The fix is
    // just to push a fresh commit without a pending removal —
    // `dag.addNode()` is already idempotent (overwrites the node
    // in-place via `Map.set`) AND preserves its adjacency sets
    // (the `if (!this.outgoing.has(...))` guard in addNode keeps
    // the edges wired). One extra postMessage payload if the
    // change was cosmetic; that's trivial compared to silently
    // dropping pipe connections.
    eventBus.on<{ id: string; subtype: FixtureSubtype }>(
      EV.FIXTURE_PARAMS_CHANGED,
      (payload) => {
        if (!getFlag('fixtureGraph')) return;
        const pos = this.fixturePositionIndex.get(payload.id);
        if (!pos) return; // we never saw the placement → nothing to update
        this.queueFixturePlacement(payload.id, payload.subtype, pos);
      },
    );

    // Phase 14.AC.11 — position changes. Just push an updated
    // commit; `dag.addNode` replaces in-place AND preserves edge
    // adjacency, so pipes connected to the moved fixture stay
    // connected. Updating `fixturePositionIndex` first means a
    // pipe commit in the same debounce window sees the new
    // position when computing proximity substitution.
    //
    // We gate on `fixturePositionIndex.has(id)` so a stale move
    // (arriving after FIXTURE_REMOVED) no-ops instead of
    // resurrecting a deleted fixture on the worker side.
    eventBus.on<{ id: string; subtype: FixtureSubtype; position: [number, number, number] }>(
      EV.FIXTURE_MOVED,
      (payload) => {
        if (!getFlag('fixtureGraph')) return;
        if (!this.fixturePositionIndex.has(payload.id)) return;
        this.fixturePositionIndex.set(payload.id, payload.position);
        this.queueFixturePlacement(payload.id, payload.subtype, payload.position);
      },
    );
  }

  /** Push a fixture onto the pending queue + schedule a flush. */
  private queueFixturePlacement(
    id: string,
    subtype: FixtureSubtype,
    position: [number, number, number],
  ): void {
    this.pendingFixtureCommits.push({
      id,
      subtype,
      position,
      system: defaultSystemForFixture(subtype),
    });
    this.queueSolve();
  }

  // ── Phase 14.AC.8 — rehydration + flag-flip catch-up ───────

  /**
   * Subscribe to `fixtureGraph` flag transitions. When it flips
   * from false → true, replay the current pipeStore + fixtureStore
   * into the worker graph so the flag toggle doesn't leave the
   * solver with a half-populated DAG.
   *
   * Lazy import of the stores avoids eager coupling at module
   * init time (matters for tests that replace the bridge
   * singleton before store boot).
   */
  private wireFlagFlip(): void {
    this.flagUnsubscribe = useFeatureFlagStore.subscribe((state, prev) => {
      if (!prev.fixtureGraph && state.fixtureGraph) {
        // Lazy require so we don't force-load the stores at
        // bridge construction time.
        void this.rehydrateFromCurrentStores();
      }
    });
  }

  /**
   * Entry point used by both the flag-flip subscription and the
   * bundle-load `rehydrateWorkerGraph` helper. Reads the current
   * pipe + fixture store snapshots and feeds them into the
   * existing pending-mutation queue.
   */
  private async rehydrateFromCurrentStores(): Promise<void> {
    // Dynamic imports keep the bridge loosely coupled to the
    // store modules (no circular-import hazard even if stores
    // grow new cross-dependencies).
    const { usePipeStore } = await import('@store/pipeStore');
    const { useFixtureStore } = await import('@store/fixtureStore');
    this.rehydrateFromStores(
      useFixtureStore.getState().fixtures,
      usePipeStore.getState().pipes,
    );
  }

  /**
   * Re-emit a snapshot of placed fixtures + committed pipes into
   * the worker graph. Flag-gated — a noop when `fixtureGraph` is
   * off, so legacy users see exactly the pre-14.AC.6 behaviour.
   *
   * Fixtures are queued FIRST so `fixturePositionIndex` is
   * populated before the pipe loop runs its proximity lookup.
   * That way a bundle containing (fixture, pipe-attached-to-
   * fixture) rehydrates with the connection intact on the first
   * pass.
   *
   * Exported for testability — callers pass plain Records so the
   * method itself doesn't import from stores.
   */
  rehydrateFromStores(
    fixtures: Record<string, {
      id: string;
      subtype: FixtureSubtype;
      position: [number, number, number];
    }>,
    pipes: Record<string, {
      id: string;
      points: [number, number, number][];
      diameter: number;
      material: string;
    }>,
  ): void {
    if (!getFlag('fixtureGraph')) return;

    // 1. Fixtures first (so proximity substitution below works).
    for (const f of Object.values(fixtures)) {
      this.fixturePositionIndex.set(f.id, f.position);
      this.pendingFixtureCommits.push({
        id: f.id,
        subtype: f.subtype,
        position: f.position,
        system: defaultSystemForFixture(f.subtype),
      });
    }

    // 2. Pipes next — proximity substitution sees the freshly
    //    populated index and splices fixture-endpoint edges.
    for (const p of Object.values(pipes)) {
      const startNodeOverride =
        p.points.length > 0
          ? this.findFixtureNodeAt(p.points[0]!)
          : undefined;
      const endNodeOverride =
        p.points.length > 0
          ? this.findFixtureNodeAt(p.points[p.points.length - 1]!)
          : undefined;

      const commit: PipeCommit = {
        id: p.id,
        points: p.points,
        diameter: p.diameter,
        material: p.material as PipeMaterial,
        startNodeOverride,
        endNodeOverride,
      };
      this.pendingPipeCommits.push(commit);

      // Remember exact IDs for removal — same invariant as the
      // live PIPE_COMPLETE handler.
      const { nodes, edges } = pipeToMutations(commit);
      this.pipeIdIndex.set(p.id, {
        nodeIds: nodes.map((n) => n.id),
        edgeIds: edges.map((e) => e.id),
      });
    }

    // Schedule one batched flush. `queueSolve` will call
    // `flushPendingMutations` at the 50ms debounce tick, producing
    // ONE BATCH_MUTATE postMessage for the entire rehydrated
    // scene regardless of pipe + fixture count.
    this.queueSolve();
  }

  /**
   * Phase 14.AC.7 — proximity lookup for pipe endpoint substitution.
   *
   * Returns the `fx-{id}` node id of a fixture within
   * `FIXTURE_SNAP_TOLERANCE_FT` of `pt`, or undefined if none.
   * Distance is measured in 3D (plumbing units = feet).
   *
   * Tolerance rationale: 0.1 ft (~1.2 inches) is tighter than the
   * draw-snap grid (0.3 ft) — a fixture connection point within an
   * inch of a pipe endpoint is almost certainly intentional, and
   * tighter-than-grid means two fixtures at adjacent grid cells
   * can't both claim the same pipe endpoint. If real-world usage
   * shows false negatives (pipe a bit off the fixture's connection
   * point), the loosening is a one-line change here.
   *
   * Ties: first fixture found wins. The fixturePositionIndex is a
   * Map so iteration order is insertion order, meaning the
   * earliest-placed fixture in the scene takes precedence when
   * two are within tolerance of the same point. That's stable and
   * predictable for regression tests.
   */
  private findFixtureNodeAt(pt: [number, number, number]): string | undefined {
    const tol = FIXTURE_SNAP_TOLERANCE_FT;
    const tolSq = tol * tol;
    for (const [id, fp] of this.fixturePositionIndex) {
      const dx = pt[0] - fp[0];
      const dy = pt[1] - fp[1];
      const dz = pt[2] - fp[2];
      if (dx * dx + dy * dy + dz * dz <= tolSq) {
        return fixtureNodeId(id);
      }
    }
    return undefined;
  }

  /**
   * Queue a pipe's node + edge IDs for removal in the next batch.
   * If we have a precise id index for this pipe (the usual case when
   * the same SimulationBridge instance saw the commit), use it. As a
   * safety net for cross-session undo or malformed histories, we fall
   * back to enumerating `wp-{id}-0..64` / `edge-{id}-1..64` — the
   * worker silently ignores unknown IDs so over-enumeration is safe.
   */
  private queuePipeRemoval(pipeId: string): void {
    const known = this.pipeIdIndex.get(pipeId);
    if (known) {
      this.pendingRemovedNodeIds.push(...known.nodeIds);
      this.pendingRemovedEdgeIds.push(...known.edgeIds);
      this.pipeIdIndex.delete(pipeId);
    } else {
      // Unknown — enumerate a conservative range. This matches the
      // pre-14.AC.3 behavior for backwards compatibility on long-
      // running sessions that predate the id index.
      for (let i = 0; i < 65; i++) {
        this.pendingRemovedNodeIds.push(`wp-${pipeId}-${i}`);
      }
      for (let i = 1; i < 65; i++) {
        this.pendingRemovedEdgeIds.push(`edge-${pipeId}-${i}`);
      }
    }
    this.queueSolve();
  }
}

/** Singleton bridge instance. */
let bridge: SimulationBridge | null = null;

export function getSimulationBridge(): SimulationBridge {
  if (!bridge) bridge = new SimulationBridge();
  return bridge;
}
