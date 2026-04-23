/**
 * Fixture Move — Phase 14.AC.11 tests.
 *
 * Covers:
 *   • `fixtureStore.setPosition` emits `EV.FIXTURE_MOVED` with the
 *     new position.
 *   • Bridge handles `FIXTURE_MOVED` (flag gated): queues a remove
 *     + re-add with the new elevation.
 *   • Flag OFF: no batch produced.
 *   • Updated `fixturePositionIndex` is visible to a subsequent
 *     pipe commit in the same batch (proximity snaps to NEW
 *     position).
 *   • Position index is cleared when a fixture is removed —
 *     moving a removed fixture is a no-op, no leaked references.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eventBus } from '@core/EventBus';
import { simBus, SIM_MSG, type SimMessage, type SimMessageType } from '../../graph/MessageBus';
import { EV } from '@core/events';
import { SimulationBridge } from '../SimulationBridge';
import { useFeatureFlagStore } from '@store/featureFlagStore';
import { useFixtureStore } from '@store/fixtureStore';

// ── Store-level emission ─────────────────────────────────────

describe('fixtureStore.setPosition — emits FIXTURE_MOVED', () => {
  beforeEach(() => {
    eventBus.clear();
    useFixtureStore.setState({ fixtures: {}, selectedFixtureId: null });
  });

  afterEach(() => {
    eventBus.clear();
    useFixtureStore.setState({ fixtures: {}, selectedFixtureId: null });
  });

  it('emits event with new position after set', () => {
    const seen: Array<{ id: string; subtype: string; position: [number, number, number] }> = [];
    eventBus.on(EV.FIXTURE_MOVED, (p) => seen.push(p as typeof seen[number]));

    const id = useFixtureStore.getState().addFixture('water_closet', [0, 0, 0]);
    useFixtureStore.getState().setPosition(id, [5, 0, 7]);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe(id);
    expect(seen[0]!.subtype).toBe('water_closet');
    expect(seen[0]!.position).toEqual([5, 0, 7]);
  });

  it('no event when the id does not exist', () => {
    const seen: unknown[] = [];
    eventBus.on(EV.FIXTURE_MOVED, (p) => seen.push(p));

    useFixtureStore.getState().setPosition('ghost', [1, 2, 3]);
    expect(seen).toHaveLength(0);
  });

  it('multiple moves fire multiple events with latest position', () => {
    const seen: Array<{ position: [number, number, number] }> = [];
    eventBus.on(EV.FIXTURE_MOVED, (p) => seen.push(p as typeof seen[number]));

    const id = useFixtureStore.getState().addFixture('lavatory', [0, 0, 0]);
    useFixtureStore.getState().setPosition(id, [1, 0, 0]);
    useFixtureStore.getState().setPosition(id, [2, 0, 0]);
    useFixtureStore.getState().setPosition(id, [3, 0, 0]);

    expect(seen.map((s) => s.position)).toEqual([[1, 0, 0], [2, 0, 0], [3, 0, 0]]);
  });
});

// ── Bridge integration ──────────────────────────────────────

describe('SimulationBridge — FIXTURE_MOVED handling', () => {
  let bridge: SimulationBridge;
  let seen: { type: SimMessageType; payload: unknown }[] = [];
  let unsubs: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    seen = [];
    unsubs = [];
    eventBus.clear();
    simBus.clear();
    useFeatureFlagStore.setState({ fixtureGraph: true });
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
  });

  function lastBatch() {
    return seen[seen.length - 1]!.payload as {
      nodesToAdd: { id: string; type: string; elevation?: number }[];
      nodeIdsToRemove: string[];
    };
  }

  it('FIXTURE_MOVED with flag ON → batch re-adds the fixture with updated elevation (no remove)', () => {
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'f1', subtype: 'water_closet', position: [0, 0, 0], params: {},
    });
    vi.runAllTimers();
    seen = [];

    eventBus.emit(EV.FIXTURE_MOVED, {
      id: 'f1', subtype: 'water_closet', position: [5, 3, 7],
    });
    vi.runAllTimers();

    expect(seen).toHaveLength(1);
    const batch = lastBatch();
    // Critical: no removal — dag.removeNode cascade-destroys
    // incident edges, which would orphan connected pipes. The
    // move replaces the node in-place via dag.addNode's
    // Map.set semantics, preserving edge adjacency.
    expect(batch.nodeIdsToRemove).toEqual([]);
    const added = batch.nodesToAdd.find((n) => n.id === 'fx-f1')!;
    expect(added).toBeDefined();
    expect(added.elevation).toBe(3); // y-coord of new position
  });

  it('flag OFF: FIXTURE_MOVED is ignored, no batch sent', () => {
    useFeatureFlagStore.setState({ fixtureGraph: false });
    eventBus.emit(EV.FIXTURE_MOVED, {
      id: 'f1', subtype: 'water_closet', position: [5, 3, 7],
    });
    vi.runAllTimers();
    expect(seen).toHaveLength(0);
  });

  it('move then pipe commit in same batch: pipe snaps to NEW position', () => {
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'f1', subtype: 'water_closet', position: [0, 0, 0], params: {},
    });
    vi.runAllTimers();
    seen = [];

    // Move fixture to new position, then draw pipe starting AT the
    // new position, all in one batch window.
    eventBus.emit(EV.FIXTURE_MOVED, {
      id: 'f1', subtype: 'water_closet', position: [10, 0, 0],
    });
    eventBus.emit(EV.PIPE_COMPLETE, {
      id: 'p1', points: [[10, 0, 0], [15, 0, 0]],
      diameter: 2, material: 'pvc_sch40',
    });
    vi.runAllTimers();

    expect(seen).toHaveLength(1);
    const batch = seen[0]!.payload as {
      edgesToAdd: { id: string; from: string; to: string }[];
    };
    const edge = batch.edgesToAdd.find((e) => e.id === 'edge-p1-1')!;
    expect(edge.from).toBe('fx-f1'); // snapped to moved fixture
  });

  it('move then pipe commit at OLD position: no fixture snap', () => {
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'f1', subtype: 'water_closet', position: [0, 0, 0], params: {},
    });
    vi.runAllTimers();
    seen = [];

    eventBus.emit(EV.FIXTURE_MOVED, {
      id: 'f1', subtype: 'water_closet', position: [10, 0, 0],
    });
    // Pipe at the OLD position — fixture has moved away, should
    // not snap.
    eventBus.emit(EV.PIPE_COMPLETE, {
      id: 'p1', points: [[0, 0, 0], [5, 0, 0]],
      diameter: 2, material: 'pvc_sch40',
    });
    vi.runAllTimers();

    const batch = seen[0]!.payload as {
      edgesToAdd: { id: string; from: string; to: string }[];
    };
    const edge = batch.edgesToAdd.find((e) => e.id === 'edge-p1-1')!;
    expect(edge.from).toBe('wp-p1-0'); // no fixture at [0,0,0] any more
  });

  it('FIXTURE_MOVED for removed fixture is a no-op', () => {
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'f1', subtype: 'water_closet', position: [0, 0, 0], params: {},
    });
    eventBus.emit(EV.FIXTURE_REMOVED, { id: 'f1' });
    vi.runAllTimers();
    seen = [];

    // Stale move event after removal — bridge ignores it because
    // the fixturePositionIndex entry was dropped on FIXTURE_REMOVED.
    eventBus.emit(EV.FIXTURE_MOVED, {
      id: 'f1', subtype: 'water_closet', position: [5, 0, 0],
    });
    vi.runAllTimers();

    expect(seen).toHaveLength(0);
  });

  it('moved fixture preserves pipe connection (no edge orphaning)', () => {
    // This is the critical regression guard for the bug fixed
    // mid-AC.11: queueing a remove + re-add for moves would cause
    // dag.removeNode to cascade-destroy the fixture's pipe edges.
    // The fix replaces in-place via dag.addNode; this spec locks
    // the batch shape so any future "cleanup" of the move path
    // that reintroduces remove trips here.
    eventBus.emit(EV.FIXTURE_PLACED, {
      id: 'f1', subtype: 'water_closet', position: [0, 0, 0], params: {},
    });
    eventBus.emit(EV.PIPE_COMPLETE, {
      id: 'p1', points: [[0, 0, 0], [5, 0, 0]],
      diameter: 2, material: 'pvc_sch40',
    });
    vi.runAllTimers();
    seen = [];

    // Move the fixture. Batch must NOT remove fx-f1 (would orphan
    // edge-p1-1 which references it).
    eventBus.emit(EV.FIXTURE_MOVED, {
      id: 'f1', subtype: 'water_closet', position: [0, 5, 0],
    });
    vi.runAllTimers();

    const batch = lastBatch();
    expect(batch.nodeIdsToRemove).not.toContain('fx-f1');
  });
});
