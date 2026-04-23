/**
 * Fixture Graph Wiring — Phase 14.AC.6 tests.
 *
 * Covers:
 *   • The pure batch-builder extension: fixtures turn into fixture-
 *     typed graph nodes with the right DFU / supply, and their add +
 *     same-batch removal cancel.
 *   • The bridge wiring: when `fixtureGraph` is ON, FIXTURE_PLACED /
 *     FIXTURE_REMOVED / FIXTURE_PARAMS_CHANGED events flow into the
 *     pending batch. When OFF, they are ignored entirely — current
 *     behaviour preserved.
 *
 * Crucially: this phase ships a flag-gated SCAFFOLD. Isolated
 * fixture nodes reach the worker graph; no edges connect them to
 * pipes yet (connection phase = 14.AC.7). The solver-output
 * regression guards are light: they check that the graph RECEIVES
 * fixtures and that connection-phase callers will have what they
 * need.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eventBus } from '@core/EventBus';
import { simBus, SIM_MSG, type SimMessage, type SimMessageType } from '../../graph/MessageBus';
import { EV } from '@core/events';
import { SimulationBridge } from '../SimulationBridge';
import {
  composeMutationBatch,
  fixtureToNode,
  fixtureNodeId,
  defaultSystemForFixture,
  type FixtureCommit,
  type PipeCommit,
} from '../mutationBatching';
import { DFU_TABLE, SUPPLY_TABLE } from '../../graph/GraphNode';
import { useFeatureFlagStore } from '@store/featureFlagStore';

// ── Pure module tests ────────────────────────────────────────

describe('fixtureToNode — pure builder', () => {
  it('toilet → DFU 4, trapSize 3, type=fixture, waste system default', () => {
    const commit: FixtureCommit = {
      id: 'f1', subtype: 'water_closet', position: [0, 2, 0], system: 'waste',
    };
    const node = fixtureToNode(commit);
    expect(node.type).toBe('fixture');
    expect(node.fixtureSubtype).toBe('water_closet');
    expect(node.system).toBe('waste');
    expect(node.dfu).toBe(DFU_TABLE.water_closet);
    expect(node.trapSize).toBe(3);
    expect(node.computed.accumulatedDFU).toBe(DFU_TABLE.water_closet);
    expect(node.elevation).toBe(2); // y-coord
  });

  it('lavatory → DFU 1, trapSize 1.5', () => {
    const node = fixtureToNode({
      id: 'f2', subtype: 'lavatory', position: [5, 0, 0], system: 'waste',
    });
    expect(node.dfu).toBe(DFU_TABLE.lavatory);
    expect(node.trapSize).toBe(1.5);
  });

  it('floor_drain → trapSize 2', () => {
    const node = fixtureToNode({
      id: 'f3', subtype: 'floor_drain', position: [0, 0, 0], system: 'waste',
    });
    expect(node.trapSize).toBe(2);
  });

  it('water_heater → cold_supply by defaultSystemForFixture heuristic', () => {
    expect(defaultSystemForFixture('water_heater')).toBe('cold_supply');
    expect(defaultSystemForFixture('hose_bibb')).toBe('cold_supply');
    expect(defaultSystemForFixture('tankless_water_heater')).toBe('cold_supply');
    expect(defaultSystemForFixture('backflow_preventer')).toBe('cold_supply');
  });

  it('waste fixtures default to waste', () => {
    expect(defaultSystemForFixture('water_closet')).toBe('waste');
    expect(defaultSystemForFixture('kitchen_sink')).toBe('waste');
    expect(defaultSystemForFixture('bathtub')).toBe('waste');
    expect(defaultSystemForFixture('floor_drain')).toBe('waste');
  });

  it('fixture node id follows fx-{id}', () => {
    expect(fixtureNodeId('abc')).toBe('fx-abc');
  });

  it('supply populated from SUPPLY_TABLE', () => {
    const node = fixtureToNode({
      id: 'f', subtype: 'water_closet', position: [0, 0, 0], system: 'waste',
    });
    expect(node.supply).toEqual(SUPPLY_TABLE.water_closet);
  });
});

describe('composeMutationBatch — fixture integration', () => {
  const makePipe = (id: string): PipeCommit => ({
    id,
    points: [[0, 0, 0], [5, 0, 0]],
    diameter: 2,
    material: 'pvc_sch40',
  });

  it('mixed pipes + fixtures produces both node types', () => {
    const fixture: FixtureCommit = {
      id: 'f1', subtype: 'water_closet', position: [0, 0, 0], system: 'waste',
    };
    const batch = composeMutationBatch([makePipe('p1')], [], [], [fixture]);

    const pipeNodes = batch.nodesToAdd.filter((n) => n.type === 'junction');
    const fixtureNodes = batch.nodesToAdd.filter((n) => n.type === 'fixture');
    expect(pipeNodes).toHaveLength(2);
    expect(fixtureNodes).toHaveLength(1);
    expect(fixtureNodes[0]!.id).toBe('fx-f1');
  });

  it('fixtures only, no pipes → just the fixture node', () => {
    const batch = composeMutationBatch([], [], [], [
      { id: 'a', subtype: 'lavatory', position: [0, 0, 0], system: 'waste' },
      { id: 'b', subtype: 'bathtub', position: [5, 0, 0], system: 'waste' },
    ]);
    expect(batch.nodesToAdd).toHaveLength(2);
    expect(batch.nodesToAdd.every((n) => n.type === 'fixture')).toBe(true);
    expect(batch.edgesToAdd).toHaveLength(0);
  });

  it('fixture added AND removed in same batch → net no-op', () => {
    const batch = composeMutationBatch(
      [],
      ['fx-f1'],
      [],
      [{ id: 'f1', subtype: 'water_closet', position: [0, 0, 0], system: 'waste' }],
    );
    expect(batch.nodesToAdd).toHaveLength(0);
    expect(batch.nodeIdsToRemove).toHaveLength(0);
  });

  it('legacy 3-arg form still works (defaults fixtures to empty)', () => {
    const batch = composeMutationBatch([makePipe('p1')], [], []);
    expect(batch.nodesToAdd).toHaveLength(2);
    expect(batch.nodesToAdd.every((n) => n.type === 'junction')).toBe(true);
  });
});

// ── Bridge integration tests ─────────────────────────────────

describe('SimulationBridge — fixtureGraph flag gating', () => {
  let bridge: SimulationBridge;
  let seen: { type: SimMessageType; payload: unknown }[] = [];
  let unsubs: Array<() => void> = [];

  function spyOn(type: SimMessageType) {
    unsubs.push(simBus.on(type, (m: SimMessage) => {
      seen.push({ type: m.type, payload: m.payload });
    }));
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    seen = [];
    unsubs = [];
    eventBus.clear();
    simBus.clear();
    // Reset flag to default before each test
    useFeatureFlagStore.setState({ fixtureGraph: false });
    bridge = new SimulationBridge();
  });

  afterEach(() => {
    for (const u of unsubs) u();
    bridge.destroy();
    vi.useRealTimers();
    eventBus.clear();
    simBus.clear();
    useFeatureFlagStore.setState({ fixtureGraph: false });
  });

  it('flag OFF: FIXTURE_PLACED is ignored, no batch sent', () => {
    spyOn(SIM_MSG.BATCH_MUTATE);
    spyOn(SIM_MSG.SOLVE_REQUEST);

    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'f1', subtype: 'water_closet', position: [0, 0, 0], params: {},
    });
    vi.runAllTimers();

    // No batch (nothing to send) and no stray solve either, since
    // queueSolve is never called from a handler that early-returns.
    expect(seen.filter((s) => s.type === SIM_MSG.BATCH_MUTATE)).toHaveLength(0);
    expect(seen.filter((s) => s.type === SIM_MSG.SOLVE_REQUEST)).toHaveLength(0);
  });

  it('flag ON: FIXTURE_PLACED produces a batch with fixture node', () => {
    useFeatureFlagStore.setState({ fixtureGraph: true });
    spyOn(SIM_MSG.BATCH_MUTATE);

    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'f1', subtype: 'water_closet', position: [3, 2, 5], params: {},
    });
    vi.runAllTimers();

    expect(seen).toHaveLength(1);
    const batch = seen[0]!.payload as {
      nodesToAdd: { id: string; type: string; fixtureSubtype?: string; dfu: number }[];
    };
    expect(batch.nodesToAdd).toHaveLength(1);
    expect(batch.nodesToAdd[0]!.id).toBe('fx-f1');
    expect(batch.nodesToAdd[0]!.type).toBe('fixture');
    expect(batch.nodesToAdd[0]!.fixtureSubtype).toBe('water_closet');
    expect(batch.nodesToAdd[0]!.dfu).toBe(DFU_TABLE.water_closet);
  });

  it('flag ON: FIXTURE_REMOVED queues a node removal', () => {
    useFeatureFlagStore.setState({ fixtureGraph: true });
    spyOn(SIM_MSG.BATCH_MUTATE);

    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'f1', subtype: 'water_closet', position: [0, 0, 0], params: {},
    });
    vi.runAllTimers();
    seen = [];

    eventBus.emit(EV.FIXTURE_REMOVED, { id: 'f1' });
    vi.runAllTimers();

    expect(seen).toHaveLength(1);
    const batch = seen[0]!.payload as { nodeIdsToRemove: string[] };
    expect(batch.nodeIdsToRemove).toEqual(['fx-f1']);
  });

  it('flag ON: 5 FIXTURE_PLACED events in one burst → 1 batch with 5 nodes', () => {
    useFeatureFlagStore.setState({ fixtureGraph: true });
    spyOn(SIM_MSG.BATCH_MUTATE);

    for (let i = 0; i < 5; i++) {
      eventBus.emit(EV.FIXTURE_PLACED, {
        id: `f${i}`, subtype: 'lavatory', position: [i, 0, 0], params: {},
      });
    }
    vi.runAllTimers();

    expect(seen).toHaveLength(1);
    const batch = seen[0]!.payload as { nodesToAdd: unknown[] };
    expect(batch.nodesToAdd).toHaveLength(5);
  });

  it('flag ON: mixed pipe + fixture burst produces ONE batch with both', () => {
    useFeatureFlagStore.setState({ fixtureGraph: true });
    spyOn(SIM_MSG.BATCH_MUTATE);

    // Fixture placed FAR from the pipe endpoints so AC.7's proximity
    // substitution doesn't kick in — we're testing "both types end up
    // in one batch" not the connection logic (which has its own spec).
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'f1', subtype: 'water_closet', position: [100, 0, 100], params: {},
    });
    eventBus.emit(EV.PIPE_COMPLETE, {
      id: 'p1',
      points: [[0, 0, 0], [5, 0, 0]],
      diameter: 2,
      material: 'pvc_sch40',
    });
    vi.runAllTimers();

    expect(seen).toHaveLength(1);
    const batch = seen[0]!.payload as {
      nodesToAdd: { id: string; type: string }[];
    };
    const types = batch.nodesToAdd.map((n) => n.type);
    expect(types.filter((t) => t === 'fixture')).toHaveLength(1);
    expect(types.filter((t) => t === 'junction')).toHaveLength(2);
  });

  it('flag ON: FIXTURE_PARAMS_CHANGED re-adds fixture in place (14.AC.11 semantics)', () => {
    useFeatureFlagStore.setState({ fixtureGraph: true });
    spyOn(SIM_MSG.BATCH_MUTATE);

    // Initial placement flushes
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'f1', subtype: 'water_closet', position: [2, 3, 4], params: {},
    });
    vi.runAllTimers();
    seen = [];

    // 14.AC.11: param change now just re-adds (no remove). The
    // worker's `dag.addNode` replaces in-place via `Map.set` while
    // preserving edge adjacency — so a PARAMS_CHANGED can NEVER
    // orphan pipe edges, even if the underlying fixture has
    // connections.
    eventBus.emit(EV.FIXTURE_PARAMS_CHANGED, {
      id: 'f1', subtype: 'water_closet', params: { flushVolumeGpf: 1.28 }, changedKey: 'flushVolumeGpf',
    });
    vi.runAllTimers();

    expect(seen).toHaveLength(1);
    const batch = seen[0]!.payload as {
      nodesToAdd: { id: string }[];
      nodeIdsToRemove: string[];
    };
    // Re-add the fixture, no removal (in-place replace)
    expect(batch.nodesToAdd.map((n) => n.id)).toEqual(['fx-f1']);
    expect(batch.nodeIdsToRemove).toEqual([]);
  });

  it('flag ON: FIXTURE_PARAMS_CHANGED for unknown fixture is a no-op', () => {
    useFeatureFlagStore.setState({ fixtureGraph: true });
    spyOn(SIM_MSG.BATCH_MUTATE);
    spyOn(SIM_MSG.SOLVE_REQUEST);

    // No FIXTURE_PLACED seen → position index empty → no-op
    eventBus.emit(EV.FIXTURE_PARAMS_CHANGED, {
      id: 'ghost', subtype: 'water_closet', params: {}, changedKey: null,
    });
    vi.runAllTimers();

    expect(seen.filter((s) => s.type === SIM_MSG.BATCH_MUTATE)).toHaveLength(0);
    expect(seen.filter((s) => s.type === SIM_MSG.SOLVE_REQUEST)).toHaveLength(0);
  });

  it('flag toggled mid-session: OFF→ON picks up new events only', () => {
    spyOn(SIM_MSG.BATCH_MUTATE);

    // While flag off — placement ignored
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'f1', subtype: 'water_closet', position: [0, 0, 0], params: {},
    });
    vi.runAllTimers();
    expect(seen).toHaveLength(0);

    // Flip flag on — only NEW events are wired; f1 is lost to the
    // solver. This is acceptable for the scaffold phase; the
    // project-load rehydration path (14.AC.7) is responsible for
    // catching up existing fixtures when the flag flips.
    useFeatureFlagStore.setState({ fixtureGraph: true });
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'f2', subtype: 'lavatory', position: [0, 0, 0], params: {},
    });
    vi.runAllTimers();

    expect(seen).toHaveLength(1);
    const batch = seen[0]!.payload as { nodesToAdd: { id: string }[] };
    expect(batch.nodesToAdd.map((n) => n.id)).toEqual(['fx-f2']);
  });
});
