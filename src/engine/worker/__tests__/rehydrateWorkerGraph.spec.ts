/**
 * Rehydrate Worker Graph — Phase 14.AC.8 tests.
 *
 * Covers:
 *   • `bridge.rehydrateFromStores` directly: correct nodes + edges
 *     produced, proximity connections survive rehydration, flag-off
 *     is a no-op.
 *   • `fixtureGraph` flag-flip subscription: toggling the flag from
 *     false to true replays the current store state into the worker.
 *   • `rehydrateWorkerGraph()` helper reads stores and calls bridge.
 *     Verified implicitly via the flag-flip path (which uses it).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eventBus } from '@core/EventBus';
import { simBus, SIM_MSG, type SimMessage, type SimMessageType } from '../../graph/MessageBus';
import { SimulationBridge } from '../SimulationBridge';
import { useFeatureFlagStore } from '@store/featureFlagStore';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import type { FixtureSubtype } from '../../graph/GraphNode';

// ── Helpers ──────────────────────────────────────────────────

function fixtureRecord(id: string, subtype: FixtureSubtype, position: [number, number, number]) {
  return { id, subtype, position };
}

function pipeRecord(id: string, points: [number, number, number][], diameter = 2) {
  return { id, points, diameter, material: 'pvc_sch40' };
}

// ── rehydrateFromStores — direct call ────────────────────────

describe('SimulationBridge.rehydrateFromStores', () => {
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

  function lastBatch() {
    return seen[seen.length - 1]!.payload as {
      nodesToAdd: { id: string; type: string }[];
      edgesToAdd: { id: string; from: string; to: string }[];
    };
  }

  it('flag OFF: rehydrate is a no-op — no batch sent', () => {
    spyOn(SIM_MSG.BATCH_MUTATE);
    bridge.rehydrateFromStores(
      { f1: fixtureRecord('f1', 'water_closet', [0, 0, 0]) },
      { p1: pipeRecord('p1', [[0, 0, 0], [5, 0, 0]]) },
    );
    vi.runAllTimers();
    expect(seen).toHaveLength(0);
  });

  it('flag ON: 1 fixture + 1 pipe → single batch with fixture + edge → fixture', () => {
    useFeatureFlagStore.setState({ fixtureGraph: true });
    spyOn(SIM_MSG.BATCH_MUTATE);

    bridge.rehydrateFromStores(
      { f1: fixtureRecord('f1', 'water_closet', [0, 0, 0]) },
      { p1: pipeRecord('p1', [[0, 0, 0], [5, 0, 0]]) },
    );
    vi.runAllTimers();

    expect(seen).toHaveLength(1);
    const batch = lastBatch();
    const fixtureNodes = batch.nodesToAdd.filter((n) => n.type === 'fixture');
    const junctionNodes = batch.nodesToAdd.filter((n) => n.type === 'junction');
    expect(fixtureNodes.map((n) => n.id)).toEqual(['fx-f1']);
    // Start point snapped to fixture → only wp-p1-1 is created.
    expect(junctionNodes.map((n) => n.id)).toEqual(['wp-p1-1']);
    // First edge bridges fixture → waypoint
    const edge = batch.edgesToAdd.find((e) => e.id === 'edge-p1-1')!;
    expect(edge.from).toBe('fx-f1');
    expect(edge.to).toBe('wp-p1-1');
  });

  it('empty stores → no-op', () => {
    useFeatureFlagStore.setState({ fixtureGraph: true });
    spyOn(SIM_MSG.BATCH_MUTATE);

    bridge.rehydrateFromStores({}, {});
    vi.runAllTimers();
    expect(seen).toHaveLength(0);
  });

  it('realistic 10-fixture / 10-pipe scene: ONE BATCH_MUTATE', () => {
    useFeatureFlagStore.setState({ fixtureGraph: true });
    spyOn(SIM_MSG.BATCH_MUTATE);

    const fixtures: Record<string, ReturnType<typeof fixtureRecord>> = {};
    const pipes: Record<string, ReturnType<typeof pipeRecord>> = {};
    for (let i = 0; i < 10; i++) {
      fixtures[`f${i}`] = fixtureRecord(`f${i}`, 'lavatory', [i * 2, 0, 0]);
      // Each pipe spans from fixture i to 5 units east — no fixture there
      pipes[`p${i}`] = pipeRecord(`p${i}`, [[i * 2, 0, 0], [i * 2 + 5, 0, 0]]);
    }
    bridge.rehydrateFromStores(fixtures, pipes);
    vi.runAllTimers();

    expect(seen).toHaveLength(1);
    const batch = lastBatch();
    // 10 fixtures + 10 pipe ends (far side only — near side snaps to fixture)
    expect(batch.nodesToAdd.filter((n) => n.type === 'fixture')).toHaveLength(10);
    expect(batch.nodesToAdd.filter((n) => n.type === 'junction')).toHaveLength(10);
    // 10 edges, each from fx-{i} to wp-{pi}-1
    expect(batch.edgesToAdd).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      const edge = batch.edgesToAdd.find((e) => e.id === `edge-p${i}-1`)!;
      expect(edge.from).toBe(`fx-f${i}`);
    }
  });

  it('pipe without nearby fixture: all-waypoint shape preserved', () => {
    useFeatureFlagStore.setState({ fixtureGraph: true });
    spyOn(SIM_MSG.BATCH_MUTATE);

    bridge.rehydrateFromStores(
      { f1: fixtureRecord('f1', 'water_closet', [100, 0, 100]) },
      { p1: pipeRecord('p1', [[0, 0, 0], [5, 0, 0]]) },
    );
    vi.runAllTimers();

    const batch = lastBatch();
    const edge = batch.edgesToAdd.find((e) => e.id === 'edge-p1-1')!;
    expect(edge.from).toBe('wp-p1-0');
    expect(edge.to).toBe('wp-p1-1');
  });
});

// ── Flag-flip subscription ──────────────────────────────────

describe('SimulationBridge — fixtureGraph flag-flip rehydration', () => {
  let bridge: SimulationBridge;
  let seen: { type: SimMessageType; payload: unknown }[] = [];
  let unsubs: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    seen = [];
    unsubs = [];
    eventBus.clear();
    simBus.clear();
    useFeatureFlagStore.setState({ fixtureGraph: false });
    // Reset stores to known-empty state
    usePipeStore.setState({ pipes: {}, pipeOrder: [], selectedId: null, undoStack: [], redoStack: [], pivotSession: null });
    useFixtureStore.setState({ fixtures: {}, selectedFixtureId: null });
    bridge = new SimulationBridge();
    unsubs.push(simBus.on(SIM_MSG.BATCH_MUTATE, (m: SimMessage) => {
      seen.push({ type: m.type, payload: m.payload });
    }));
  });

  afterEach(() => {
    for (const u of unsubs) u();
    bridge.destroy();
    vi.useRealTimers();
    eventBus.clear();
    simBus.clear();
    useFeatureFlagStore.setState({ fixtureGraph: false });
    usePipeStore.setState({ pipes: {}, pipeOrder: [], selectedId: null, undoStack: [], redoStack: [], pivotSession: null });
    useFixtureStore.setState({ fixtures: {}, selectedFixtureId: null });
  });

  it('flag false → true triggers rehydration from current stores', async () => {
    // Seed stores with an unrelated fixture + pipe while flag is off.
    useFixtureStore.setState({
      fixtures: {
        f1: {
          id: 'f1',
          subtype: 'water_closet',
          position: [0, 0, 0],
          params: {},
          createdTs: 0,
          connectedPipeIds: [],
        },
      },
      selectedFixtureId: null,
    });
    usePipeStore.setState({
      pipes: {
        p1: {
          id: 'p1',
          points: [[0, 0, 0], [5, 0, 0]],
          diameter: 2,
          material: 'pvc_sch40',
          system: 'waste',
          color: '#ffa726',
          visible: true,
          selected: false,
        },
      },
      pipeOrder: ['p1'],
      selectedId: null,
      undoStack: [],
      redoStack: [],
      pivotSession: null,
    });

    // No batch yet — flag is still off.
    vi.runAllTimers();
    expect(seen).toHaveLength(0);

    // Flip the flag on — triggers the subscription.
    useFeatureFlagStore.setState({ fixtureGraph: true });

    // The subscription uses dynamic imports, so let microtasks + timers flush.
    await vi.runAllTimersAsync();

    expect(seen.length).toBeGreaterThanOrEqual(1);
    const batch = seen[0]!.payload as {
      nodesToAdd: { id: string; type: string }[];
    };
    // Expect fixture + the interior waypoint from proximity substitution.
    const ids = batch.nodesToAdd.map((n) => n.id).sort();
    expect(ids).toContain('fx-f1');
    expect(ids).toContain('wp-p1-1');
  });

  it('flag already true on construction: subscription does NOT re-fire for same value', async () => {
    useFeatureFlagStore.setState({ fixtureGraph: true });

    // Setting the same value shouldn't trigger (Zustand only fires
    // subscribers on actual state change).
    useFeatureFlagStore.setState({ fixtureGraph: true });
    await vi.runAllTimersAsync();
    expect(seen).toHaveLength(0);
  });

  it('flag true → false → true: SECOND flip rehydrates', async () => {
    // Seed a fixture and toggle flag.
    useFixtureStore.setState({
      fixtures: {
        f1: {
          id: 'f1', subtype: 'lavatory', position: [10, 0, 0],
          params: {}, createdTs: 0, connectedPipeIds: [],
        },
      },
      selectedFixtureId: null,
    });
    useFeatureFlagStore.setState({ fixtureGraph: true });
    await vi.runAllTimersAsync();
    seen = [];

    useFeatureFlagStore.setState({ fixtureGraph: false });
    useFeatureFlagStore.setState({ fixtureGraph: true });
    await vi.runAllTimersAsync();

    expect(seen.length).toBeGreaterThanOrEqual(1);
    const batch = seen[0]!.payload as { nodesToAdd: { id: string }[] };
    expect(batch.nodesToAdd.map((n) => n.id)).toContain('fx-f1');
  });

  it('destroy unsubscribes from flag store — flag flip afterwards is no-op', async () => {
    bridge.destroy();
    useFeatureFlagStore.setState({ fixtureGraph: true });
    await vi.runAllTimersAsync();
    expect(seen).toHaveLength(0);
  });
});
