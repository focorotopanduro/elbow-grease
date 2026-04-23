/**
 * SimulationBridge — Phase 14.AC.3 batching behaviour.
 *
 * Integration-level: boot a real SimulationBridge (worker auto-fails
 * under jsdom → main-thread fallback → messages are dispatched to
 * `simBus`). Subscribe to simBus and verify:
 *
 *   • A PIPE_COMPLETE burst emits ONE BATCH_MUTATE at debounce time,
 *     not N individual ADD_NODE / ADD_EDGE messages.
 *   • BATCH_MUTATE fires BEFORE the SOLVE_REQUEST.
 *   • pipe:removed queues the correct exact IDs from the pipe's
 *     commit (not the old enumerate-to-50 fallback).
 *   • Pipe added + removed within the same debounce window cancels.
 *
 * Debounce is 50ms so tests use vi.useFakeTimers() to skip ahead
 * deterministically.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eventBus } from '@core/EventBus';
import { simBus, SIM_MSG, type SimMessage, type SimMessageType } from '../../graph/MessageBus';
import { EV, type PipeCompletePayload } from '@core/events';
import { SimulationBridge } from '../SimulationBridge';
// Phase 2c (ARCHITECTURE.md §4.5) — exercise the mode guard.
import { useAppModeStore as useAppModeStoreForTest } from '@store/appModeStore';

describe('SimulationBridge — Phase 14.AC.3 batching', () => {
  let bridge: SimulationBridge;
  let seen: { type: SimMessageType; payload: unknown; ts: number }[] = [];
  let unsubs: Array<() => void> = [];

  function spyOn(type: SimMessageType) {
    const unsub = simBus.on(type, (m: SimMessage) => {
      seen.push({ type: m.type, payload: m.payload, ts: m.timestamp });
    });
    unsubs.push(unsub);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    seen = [];
    unsubs = [];
    eventBus.clear();
    simBus.clear();
    bridge = new SimulationBridge();
  });

  afterEach(() => {
    for (const u of unsubs) u();
    bridge.destroy();
    vi.useRealTimers();
    eventBus.clear();
    simBus.clear();
  });

  function emitCommit(id: string, pts: number) {
    const payload: PipeCompletePayload = {
      id,
      points: Array.from({ length: pts }, (_, i) => [i, 0, 0] as [number, number, number]),
      diameter: 2,
      material: 'pvc_sch40',
    };
    eventBus.emit(EV.PIPE_COMPLETE, payload);
  }

  it('single pipe commit produces 1 BATCH_MUTATE then 1 SOLVE_REQUEST', () => {
    spyOn(SIM_MSG.BATCH_MUTATE);
    spyOn(SIM_MSG.SOLVE_REQUEST);

    emitCommit('p1', 3);
    // Before debounce fires — nothing should have gone through yet
    expect(seen).toHaveLength(0);

    vi.runAllTimers(); // flush debounce

    expect(seen).toHaveLength(2);
    expect(seen[0]!.type).toBe(SIM_MSG.BATCH_MUTATE);
    expect(seen[1]!.type).toBe(SIM_MSG.SOLVE_REQUEST);
  });

  it('the batch contains all of a single pipes nodes + edges', () => {
    spyOn(SIM_MSG.BATCH_MUTATE);

    emitCommit('p1', 4);
    vi.runAllTimers();

    const batch = seen[0]!.payload as {
      nodesToAdd: { id: string }[];
      edgesToAdd: { id: string }[];
    };
    expect(batch.nodesToAdd.map((n) => n.id)).toEqual(['wp-p1-0', 'wp-p1-1', 'wp-p1-2', 'wp-p1-3']);
    expect(batch.edgesToAdd.map((e) => e.id)).toEqual(['edge-p1-1', 'edge-p1-2', 'edge-p1-3']);
  });

  it('10 rapid commits coalesce into ONE BATCH_MUTATE', () => {
    spyOn(SIM_MSG.BATCH_MUTATE);
    spyOn(SIM_MSG.SOLVE_REQUEST);
    spyOn(SIM_MSG.ADD_NODE);
    spyOn(SIM_MSG.ADD_EDGE);

    for (let i = 0; i < 10; i++) emitCommit(`p${i}`, 3);
    vi.runAllTimers();

    const batches = seen.filter((s) => s.type === SIM_MSG.BATCH_MUTATE);
    const solves = seen.filter((s) => s.type === SIM_MSG.SOLVE_REQUEST);
    const addNodes = seen.filter((s) => s.type === SIM_MSG.ADD_NODE);
    const addEdges = seen.filter((s) => s.type === SIM_MSG.ADD_EDGE);

    expect(batches).toHaveLength(1);
    expect(solves).toHaveLength(1);
    // Crucial regression guard: the per-segment ADD_NODE / ADD_EDGE
    // path MUST NOT be taken any more. Bridge sends exclusively via
    // BATCH_MUTATE for the commit path.
    expect(addNodes).toHaveLength(0);
    expect(addEdges).toHaveLength(0);

    const batch = batches[0]!.payload as { nodesToAdd: unknown[]; edgesToAdd: unknown[] };
    expect(batch.nodesToAdd).toHaveLength(30); // 10 × 3
    expect(batch.edgesToAdd).toHaveLength(20); // 10 × 2
  });

  it('BATCH_MUTATE fires before SOLVE_REQUEST in the same flush', () => {
    spyOn(SIM_MSG.BATCH_MUTATE);
    spyOn(SIM_MSG.SOLVE_REQUEST);

    emitCommit('p1', 3);
    vi.runAllTimers();

    expect(seen[0]!.type).toBe(SIM_MSG.BATCH_MUTATE);
    expect(seen[1]!.type).toBe(SIM_MSG.SOLVE_REQUEST);
  });

  it('pipe:removed after a known commit uses the exact id index (no 0..50 enumeration)', () => {
    spyOn(SIM_MSG.BATCH_MUTATE);

    // Commit first
    emitCommit('p1', 3);
    vi.runAllTimers();
    seen = []; // drop the add-batch

    // Then remove
    eventBus.emit('pipe:removed', { id: 'p1' });
    vi.runAllTimers();

    const batch = seen[0]!.payload as {
      nodeIdsToRemove: string[];
      edgeIdsToRemove: string[];
    };
    // Exact IDs, not 0..50 padding
    expect(batch.nodeIdsToRemove).toEqual(['wp-p1-0', 'wp-p1-1', 'wp-p1-2']);
    expect(batch.edgeIdsToRemove).toEqual(['edge-p1-1', 'edge-p1-2']);
  });

  it('commit + remove in same debounce window cancels (empty batch = no postMessage)', () => {
    spyOn(SIM_MSG.BATCH_MUTATE);
    spyOn(SIM_MSG.SOLVE_REQUEST);

    emitCommit('ephemeral', 3);
    eventBus.emit('pipe:removed', { id: 'ephemeral' });
    vi.runAllTimers();

    const batches = seen.filter((s) => s.type === SIM_MSG.BATCH_MUTATE);
    const solves = seen.filter((s) => s.type === SIM_MSG.SOLVE_REQUEST);

    // Empty batch is suppressed — no BATCH_MUTATE emitted
    expect(batches).toHaveLength(0);
    // But we still solve (the empty change still conceptually warrants
    // a re-solve; the worker's graph is unchanged so cost is trivial)
    expect(solves).toHaveLength(1);
  });

  it('pipe:removed for an unknown pipe falls back to safe over-enumeration', () => {
    spyOn(SIM_MSG.BATCH_MUTATE);

    // Remove a pipe we never saw committed — simulate stale undo
    eventBus.emit('pipe:removed', { id: 'ghost' });
    vi.runAllTimers();

    const batch = seen[0]!.payload as {
      nodeIdsToRemove: string[];
      edgeIdsToRemove: string[];
    };
    // Fallback enumerates 0..64 for nodes, 1..64 for edges
    expect(batch.nodeIdsToRemove.length).toBeGreaterThanOrEqual(50);
    expect(batch.nodeIdsToRemove[0]).toBe('wp-ghost-0');
    expect(batch.edgeIdsToRemove[0]).toBe('edge-ghost-1');
  });

  it('lastBatchSent exposes the most recent batch for instrumentation', () => {
    emitCommit('p1', 3);
    vi.runAllTimers();

    expect(bridge.lastBatchSent).not.toBeNull();
    expect(bridge.lastBatchSent!.nodesToAdd).toHaveLength(3);
    expect(bridge.lastBatchSent!.edgesToAdd).toHaveLength(2);
  });
});

// ── Phase 2c — ARCHITECTURE.md §4.5 mode guard ────────────────

describe('SimulationBridge — plumbing-only guard (ARCHITECTURE.md §4.5)', () => {
  // The roofing workspace never wants the plumbing worker to wake.
  // These tests exercise the early-return at the top of the
  // PIPE_COMPLETE handler by flipping appModeStore and confirming
  // no simBus traffic lands.

  let bridge: SimulationBridge;
  let seen: { type: SimMessageType }[];
  let unsubs: Array<() => void>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    seen = [];
    unsubs = [];
    eventBus.clear();
    simBus.clear();
    bridge = new SimulationBridge();
  });

  afterEach(() => {
    for (const u of unsubs) u();
    bridge.destroy();
    vi.useRealTimers();
    eventBus.clear();
    simBus.clear();
    // Restore plumbing as the default so downstream tests aren't
    // affected by a leaked roofing mode.
    useAppModeStoreForTest.setState({ mode: 'plumbing' });
  });

  function spy(type: SimMessageType) {
    const u = simBus.on(type, (m: SimMessage) => { seen.push({ type: m.type }); });
    unsubs.push(u);
  }

  function emitCommit(id: string, pts: number) {
    const payload: PipeCompletePayload = {
      id,
      points: Array.from({ length: pts }, (_, i) => [i, 0, 0] as [number, number, number]),
      diameter: 2,
      material: 'pvc_sch40',
    };
    eventBus.emit(EV.PIPE_COMPLETE, payload);
  }

  it('PIPE_COMPLETE in roofing mode does NOT post to the worker (no BATCH_MUTATE / SOLVE_REQUEST)', () => {
    spy(SIM_MSG.BATCH_MUTATE);
    spy(SIM_MSG.SOLVE_REQUEST);
    spy(SIM_MSG.ADD_NODE);
    spy(SIM_MSG.ADD_EDGE);

    useAppModeStoreForTest.setState({ mode: 'roofing' });

    emitCommit('rp1', 3);
    vi.runAllTimers();

    expect(seen).toHaveLength(0);
    // Also verify the bridge didn't record an internal batch.
    expect(bridge.lastBatchSent).toBeNull();
  });

  it('switching back to plumbing re-enables the handler', () => {
    spy(SIM_MSG.BATCH_MUTATE);

    // First: verify roofing mode silences it.
    useAppModeStoreForTest.setState({ mode: 'roofing' });
    emitCommit('rp1', 3);
    vi.runAllTimers();
    expect(seen).toHaveLength(0);

    // Then flip back and confirm the next commit flows through.
    useAppModeStoreForTest.setState({ mode: 'plumbing' });
    emitCommit('pp1', 3);
    vi.runAllTimers();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.type).toBe(SIM_MSG.BATCH_MUTATE);
  });
});
