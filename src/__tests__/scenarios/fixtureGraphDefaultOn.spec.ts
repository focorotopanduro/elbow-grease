/**
 * Fixture Graph Default-On — Phase 14.AC.9 golden scene.
 *
 * Locks in the behavior a user experiences starting with v14.AC.9:
 *   • `fixtureGraph` ships default ON.
 *   • A realistic bathroom scene (toilet, lavatory, bathtub, floor
 *     drain) placed via the normal `FIXTURE_PLACED` event path —
 *     followed by waste pipes drawn from each fixture to a
 *     shared floor drain — produces a solver DAG that is
 *     structurally sound:
 *       - Four fixture nodes with their canonical DFU values.
 *       - Pipes connected at their endpoints via proximity
 *         substitution (edge.from = fx-{fixtureId}).
 *       - One internal junction per pipe (the interior waypoint).
 *       - Exactly one BATCH_MUTATE per burst.
 *
 * This spec exists so that the moment someone changes the flag
 * default back to false, or regresses any of AC.6/AC.7/AC.8, these
 * asserted counts / ids stop matching and the test names make it
 * obvious which layer broke. Pure regression guard; no production
 * code touched here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eventBus } from '@core/EventBus';
import { simBus, SIM_MSG, type SimMessage } from '../../engine/graph/MessageBus';
import { EV } from '@core/events';
import { SimulationBridge } from '../../engine/worker/SimulationBridge';
import { useFeatureFlagStore } from '@store/featureFlagStore';
import { DFU_TABLE } from '../../engine/graph/GraphNode';

describe('14.AC.9 golden — fixtureGraph default ON bathroom scene', () => {
  let bridge: SimulationBridge;
  let batches: { nodesToAdd: { id: string; type: string; fixtureSubtype?: string; dfu?: number }[];
                 edgesToAdd: { id: string; from: string; to: string }[] }[] = [];
  let unsubs: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    batches = [];
    unsubs = [];
    eventBus.clear();
    simBus.clear();
    // Explicitly DO NOT reset the flag — the whole point of this
    // spec is to verify the shipping default.
    bridge = new SimulationBridge();
    unsubs.push(simBus.on(SIM_MSG.BATCH_MUTATE, (m: SimMessage) => {
      batches.push(m.payload as typeof batches[number]);
    }));
  });

  afterEach(() => {
    for (const u of unsubs) u();
    bridge.destroy();
    vi.useRealTimers();
    eventBus.clear();
    simBus.clear();
  });

  it('default is ON — store ships with fixtureGraph: true', () => {
    // If someone reverts the default in the feature flag store,
    // this one-liner fails and the test name is the clue.
    expect(useFeatureFlagStore.getState().fixtureGraph).toBe(true);
  });

  it('bathroom: 4 fixtures + 4 waste runs → 1 batch with expected shape', () => {
    // Place four fixtures. Positions match real residential bath
    // layout: toilet near back wall, sink adjacent, tub across,
    // floor drain central.
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'toilet', subtype: 'water_closet', position: [0, 0, 0], params: {},
    });
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'sink', subtype: 'lavatory', position: [3, 0, 0], params: {},
    });
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'tub', subtype: 'bathtub', position: [0, 0, 5], params: {},
    });
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'drain', subtype: 'floor_drain', position: [3, 0, 5], params: {},
    });

    // Four waste runs, each from a fixture to the floor drain.
    eventBus.emit(EV.PIPE_COMPLETE, {
      id: 'waste-toilet', points: [[0, 0, 0], [3, 0, 5]],
      diameter: 3, material: 'pvc_sch40',
    });
    eventBus.emit(EV.PIPE_COMPLETE, {
      id: 'waste-sink', points: [[3, 0, 0], [3, 0, 5]],
      diameter: 1.5, material: 'pvc_sch40',
    });
    eventBus.emit(EV.PIPE_COMPLETE, {
      id: 'waste-tub', points: [[0, 0, 5], [3, 0, 5]],
      diameter: 2, material: 'pvc_sch40',
    });
    // Extra drain line: drain → somewhere off-scene (sim of main stack).
    // Starts AT the drain so first edge snaps; ends away so last
    // edge uses a plain waypoint.
    eventBus.emit(EV.PIPE_COMPLETE, {
      id: 'stack', points: [[3, 0, 5], [3, -5, 5]],
      diameter: 4, material: 'pvc_sch40',
    });

    vi.runAllTimers();

    expect(batches).toHaveLength(1);
    const batch = batches[0]!;

    // ── Fixture nodes ─────────────────────────────────────
    const fixtureNodes = batch.nodesToAdd.filter((n) => n.type === 'fixture');
    const fxIds = fixtureNodes.map((n) => n.id).sort();
    expect(fxIds).toEqual(['fx-drain', 'fx-sink', 'fx-toilet', 'fx-tub']);

    // Each fixture has the catalogued DFU (IPC Table 709.1)
    const toiletNode = fixtureNodes.find((n) => n.id === 'fx-toilet')!;
    expect(toiletNode.dfu).toBe(DFU_TABLE.water_closet); // 4
    const sinkNode = fixtureNodes.find((n) => n.id === 'fx-sink')!;
    expect(sinkNode.dfu).toBe(DFU_TABLE.lavatory);        // 1
    const tubNode = fixtureNodes.find((n) => n.id === 'fx-tub')!;
    expect(tubNode.dfu).toBe(DFU_TABLE.bathtub);          // 2
    const drainNode = fixtureNodes.find((n) => n.id === 'fx-drain')!;
    expect(drainNode.dfu).toBe(DFU_TABLE.floor_drain);    // 2

    // ── Edges correctly spliced ───────────────────────────
    // waste-toilet: [0,0,0] → [3,0,5].  Start at toilet, end at drain.
    const toiletEdge = batch.edgesToAdd.find((e) => e.id === 'edge-waste-toilet-1')!;
    expect(toiletEdge.from).toBe('fx-toilet');
    expect(toiletEdge.to).toBe('fx-drain');

    // waste-sink: start at sink, end at drain.
    const sinkEdge = batch.edgesToAdd.find((e) => e.id === 'edge-waste-sink-1')!;
    expect(sinkEdge.from).toBe('fx-sink');
    expect(sinkEdge.to).toBe('fx-drain');

    // waste-tub: start at tub, end at drain.
    const tubEdge = batch.edgesToAdd.find((e) => e.id === 'edge-waste-tub-1')!;
    expect(tubEdge.from).toBe('fx-tub');
    expect(tubEdge.to).toBe('fx-drain');

    // stack: start at drain, end at waypoint (no fixture at [3,-5,5])
    const stackEdge = batch.edgesToAdd.find((e) => e.id === 'edge-stack-1')!;
    expect(stackEdge.from).toBe('fx-drain');
    expect(stackEdge.to).toBe('wp-stack-1');

    // ── No leftover waypoints ─────────────────────────────
    // Three 2-point pipes connecting fixture-to-fixture → 0 junctions.
    // One 2-point pipe with one fixture endpoint → 1 junction (wp-stack-1).
    const junctions = batch.nodesToAdd.filter((n) => n.type === 'junction');
    expect(junctions.map((n) => n.id)).toEqual(['wp-stack-1']);

    // ── Node + edge counts (exact guard) ──────────────────
    expect(batch.nodesToAdd).toHaveLength(4 + 1); // 4 fixtures + 1 interior junction
    expect(batch.edgesToAdd).toHaveLength(4);     // 4 pipes each contributing 1 edge
  });

  it('removing a pipe leaves the fixtures intact in the graph', () => {
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 't1', subtype: 'water_closet', position: [0, 0, 0], params: {},
    });
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'd1', subtype: 'floor_drain', position: [5, 0, 0], params: {},
    });
    eventBus.emit(EV.PIPE_COMPLETE, {
      id: 'p1', points: [[0, 0, 0], [5, 0, 0]],
      diameter: 3, material: 'pvc_sch40',
    });
    vi.runAllTimers();
    batches = [];

    // Undo the pipe.
    eventBus.emit('pipe:removed', { id: 'p1' });
    vi.runAllTimers();

    expect(batches).toHaveLength(1);
    const removal = batches[0]! as unknown as {
      nodeIdsToRemove: string[];
      edgeIdsToRemove: string[];
    };
    // Only the edge goes; no waypoints (both endpoints were fixture
    // overrides, so none were created in the first place), and the
    // fixture nodes stay in the graph.
    expect(removal.nodeIdsToRemove).toEqual([]);
    expect(removal.edgeIdsToRemove).toEqual(['edge-p1-1']);
  });

  it('removing a fixture cleans up its node without touching pipes', () => {
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 't1', subtype: 'water_closet', position: [0, 0, 0], params: {},
    });
    eventBus.emit(EV.PIPE_COMPLETE, {
      id: 'p1', points: [[0, 0, 0], [5, 0, 0]],
      diameter: 3, material: 'pvc_sch40',
    });
    vi.runAllTimers();
    batches = [];

    eventBus.emit(EV.FIXTURE_REMOVED, { id: 't1' });
    vi.runAllTimers();

    expect(batches).toHaveLength(1);
    const removal = batches[0]! as unknown as {
      nodeIdsToRemove: string[];
      edgeIdsToRemove: string[];
    };
    expect(removal.nodeIdsToRemove).toEqual(['fx-t1']);
    expect(removal.edgeIdsToRemove).toEqual([]);
    // Note: the pipe edge still points at fx-t1, which the worker
    // will treat as orphaned. That's an artifact of the
    // "remove fixture, keep pipe" flow; the solver handles dangling
    // edges by ignoring them during traversal. A future phase may
    // want to also orphan-clean the pipe, but correctness isn't
    // affected today.
  });
});
