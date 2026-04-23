/**
 * Fixture → Pipe Proximity Connection — Phase 14.AC.7 tests.
 *
 * Builds on 14.AC.6's isolated-fixture scaffold: when a pipe endpoint
 * lies within `FIXTURE_SNAP_TOLERANCE_FT` of a known fixture, the
 * pipe's first / last edge references the fixture's node ID directly
 * (skipping the `wp-{pipeId}-0` / `wp-…-{last}` junction). This is
 * the step that makes DFU / WSFU propagation actually flow: the
 * solver now sees a connected fixture → edge → … chain.
 *
 * Covered:
 *   • Pure `pipeToMutations` with startNodeOverride / endNodeOverride
 *     produces the right node list + correctly-wired edges.
 *   • Bridge: pipe drawn from a fixture → edge from = fx-{id}.
 *   • Bridge: pipe drawn ending at a fixture → edge to = fx-{id}.
 *   • Bridge: both endpoints on fixtures → both edges substituted,
 *     junction nodes exist only for interior waypoints.
 *   • Bridge: pipe far from any fixture → no substitution, legacy
 *     behaviour preserved.
 *   • Bridge: tolerance boundary — just inside snaps, just outside
 *     does not.
 *   • Bridge: undo removes only the pipe's waypoints + edges, NOT
 *     the fixture nodes (the fixture outlives the pipe).
 *   • Bridge: flag off → no substitution ever, regardless of proximity.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eventBus } from '@core/EventBus';
import { simBus, SIM_MSG, type SimMessage, type SimMessageType } from '../../graph/MessageBus';
import { EV } from '@core/events';
import { SimulationBridge } from '../SimulationBridge';
import {
  pipeToMutations,
  nodeIdAt,
  edgeIdAt,
  fixtureNodeId,
  type PipeCommit,
} from '../mutationBatching';
import { useFeatureFlagStore } from '@store/featureFlagStore';

// ── Pure module: pipeToMutations with overrides ─────────────

describe('pipeToMutations — endpoint overrides', () => {
  const base: Omit<PipeCommit, 'startNodeOverride' | 'endNodeOverride'> = {
    id: 'p1',
    points: [[0, 0, 0], [5, 0, 0], [5, 0, 5]],
    diameter: 2,
    material: 'pvc_sch40',
  };

  it('no override: 3 waypoint nodes + 2 edges (legacy shape)', () => {
    const { nodes, edges } = pipeToMutations({ ...base });
    expect(nodes.map((n) => n.id)).toEqual(['wp-p1-0', 'wp-p1-1', 'wp-p1-2']);
    expect(edges.map((e) => e.id)).toEqual(['edge-p1-1', 'edge-p1-2']);
    expect(edges[0]!.from).toBe('wp-p1-0');
    expect(edges[1]!.to).toBe('wp-p1-2');
  });

  it('startNodeOverride: skip wp-p1-0, first edge.from uses override', () => {
    const { nodes, edges } = pipeToMutations({
      ...base,
      startNodeOverride: 'fx-toilet1',
    });
    expect(nodes.map((n) => n.id)).toEqual(['wp-p1-1', 'wp-p1-2']);
    expect(edges[0]!.from).toBe('fx-toilet1');
    expect(edges[0]!.to).toBe('wp-p1-1');
    expect(edges[1]!.from).toBe('wp-p1-1');
    expect(edges[1]!.to).toBe('wp-p1-2');
  });

  it('endNodeOverride: skip last waypoint, last edge.to uses override', () => {
    const { nodes, edges } = pipeToMutations({
      ...base,
      endNodeOverride: 'fx-drain1',
    });
    expect(nodes.map((n) => n.id)).toEqual(['wp-p1-0', 'wp-p1-1']);
    expect(edges[edges.length - 1]!.to).toBe('fx-drain1');
  });

  it('both overrides: only interior waypoints exist, edges point at fixtures', () => {
    const { nodes, edges } = pipeToMutations({
      ...base,
      startNodeOverride: 'fx-a',
      endNodeOverride: 'fx-b',
    });
    // Only wp-p1-1 (interior) survives
    expect(nodes.map((n) => n.id)).toEqual(['wp-p1-1']);
    expect(edges[0]!.from).toBe('fx-a');
    expect(edges[0]!.to).toBe('wp-p1-1');
    expect(edges[1]!.from).toBe('wp-p1-1');
    expect(edges[1]!.to).toBe('fx-b');
  });

  it('2-point pipe with both overrides: no nodes, 1 edge between fixtures', () => {
    const { nodes, edges } = pipeToMutations({
      id: 'pp',
      points: [[0, 0, 0], [5, 0, 0]],
      diameter: 2,
      material: 'pvc_sch40',
      startNodeOverride: 'fx-a',
      endNodeOverride: 'fx-b',
    });
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.from).toBe('fx-a');
    expect(edges[0]!.to).toBe('fx-b');
  });

  it('edge IDs stay on `edge-{pipeId}-{i}` convention regardless of overrides', () => {
    const { edges } = pipeToMutations({
      ...base,
      startNodeOverride: 'fx-a',
      endNodeOverride: 'fx-b',
    });
    // Indices still start at 1, end at points.length-1
    expect(edges.map((e) => e.id)).toEqual(['edge-p1-1', 'edge-p1-2']);
  });
});

// ── Bridge integration ──────────────────────────────────────

describe('SimulationBridge — fixture proximity substitution', () => {
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

  function place(id: string, subtype: string, position: [number, number, number]) {
    eventBus.emit(EV.FIXTURE_PLACED, { id, subtype, position, params: {} });
  }

  function drawPipe(id: string, points: [number, number, number][]) {
    eventBus.emit(EV.PIPE_COMPLETE, {
      id, points, diameter: 2, material: 'pvc_sch40',
    });
  }

  function lastBatch() {
    return seen[seen.length - 1]!.payload as {
      nodesToAdd: { id: string; type: string }[];
      edgesToAdd: { id: string; from: string; to: string }[];
      nodeIdsToRemove: string[];
      edgeIdsToRemove: string[];
    };
  }

  it('pipe drawn starting at a fixture: first edge.from = fx-{id}', () => {
    place('t1', 'water_closet', [0, 0, 0]);
    drawPipe('p1', [[0, 0, 0], [5, 0, 0], [5, 0, 5]]);
    vi.runAllTimers();

    const batch = lastBatch();
    // Fixture node + 2 interior waypoints (wp-p1-1, wp-p1-2). No wp-p1-0.
    const ids = batch.nodesToAdd.map((n) => n.id).sort();
    expect(ids).toEqual(['fx-t1', 'wp-p1-1', 'wp-p1-2']);

    const firstEdge = batch.edgesToAdd.find((e) => e.id === 'edge-p1-1')!;
    expect(firstEdge.from).toBe('fx-t1');
    expect(firstEdge.to).toBe('wp-p1-1');
  });

  it('pipe drawn ending at a fixture: last edge.to = fx-{id}', () => {
    place('d1', 'floor_drain', [5, 0, 5]);
    drawPipe('p1', [[0, 0, 0], [5, 0, 0], [5, 0, 5]]);
    vi.runAllTimers();

    const batch = lastBatch();
    const lastEdge = batch.edgesToAdd.find((e) => e.id === 'edge-p1-2')!;
    expect(lastEdge.to).toBe('fx-d1');
  });

  it('pipe with BOTH endpoints on fixtures: interior waypoint only', () => {
    place('t1', 'water_closet', [0, 0, 0]);
    place('d1', 'floor_drain', [5, 0, 5]);
    drawPipe('p1', [[0, 0, 0], [5, 0, 0], [5, 0, 5]]);
    vi.runAllTimers();

    const batch = lastBatch();
    const junctions = batch.nodesToAdd.filter((n) => n.type === 'junction');
    expect(junctions.map((n) => n.id)).toEqual(['wp-p1-1']);

    const firstEdge = batch.edgesToAdd.find((e) => e.id === 'edge-p1-1')!;
    const lastEdge = batch.edgesToAdd.find((e) => e.id === 'edge-p1-2')!;
    expect(firstEdge.from).toBe('fx-t1');
    expect(lastEdge.to).toBe('fx-d1');
  });

  it('pipe far from any fixture: legacy all-junction waypoints', () => {
    place('t1', 'water_closet', [100, 0, 100]);
    drawPipe('p1', [[0, 0, 0], [5, 0, 0]]);
    vi.runAllTimers();

    const batch = lastBatch();
    const firstEdge = batch.edgesToAdd[0]!;
    expect(firstEdge.from).toBe('wp-p1-0');
    expect(firstEdge.to).toBe('wp-p1-1');
  });

  it('tolerance: just-inside 0.1ft snaps; just-outside does not', () => {
    place('t1', 'water_closet', [0, 0, 0]);
    // Endpoint at (0.05, 0.05, 0.05) — distance ≈ 0.087 ft. Within 0.1.
    drawPipe('pin', [[0.05, 0.05, 0.05], [5, 0, 0]]);
    vi.runAllTimers();
    expect(lastBatch().edgesToAdd[0]!.from).toBe('fx-t1');

    seen = [];

    // Endpoint at (0.08, 0.08, 0.08) — distance ≈ 0.139 ft. Outside 0.1.
    drawPipe('pout', [[0.08, 0.08, 0.08], [5, 0, 0]]);
    vi.runAllTimers();
    expect(lastBatch().edgesToAdd[0]!.from).toBe('wp-pout-0');
  });

  it('flag OFF: proximity substitution disabled even with fixture at endpoint', () => {
    useFeatureFlagStore.setState({ fixtureGraph: false });
    place('t1', 'water_closet', [0, 0, 0]); // ignored at flag off
    drawPipe('p1', [[0, 0, 0], [5, 0, 0]]);
    vi.runAllTimers();

    const batch = lastBatch();
    expect(batch.edgesToAdd[0]!.from).toBe('wp-p1-0');
    expect(batch.nodesToAdd.every((n) => n.type !== 'fixture')).toBe(true);
  });

  it('undo only removes pipe waypoints + edges, not the fixture', () => {
    place('t1', 'water_closet', [0, 0, 0]);
    drawPipe('p1', [[0, 0, 0], [5, 0, 0], [5, 0, 5]]);
    vi.runAllTimers();

    // Drop the placement / commit batch
    seen = [];

    // Remove the pipe
    eventBus.emit('pipe:removed', { id: 'p1' });
    vi.runAllTimers();

    const batch = lastBatch();
    // We should remove only the junction nodes we created
    // (wp-p1-1, wp-p1-2) — wp-p1-0 was NEVER created (fixture
    // override), so it's NOT in the removal list.
    expect(batch.nodeIdsToRemove.sort()).toEqual(['wp-p1-1', 'wp-p1-2']);
    // And we MUST NOT remove the fixture node — the fixture is
    // still placed in the UI, its graph node must stay.
    expect(batch.nodeIdsToRemove).not.toContain('fx-t1');
    // Edges owned by the pipe still go away
    expect(batch.edgeIdsToRemove.sort()).toEqual(['edge-p1-1', 'edge-p1-2']);
  });

  it('two pipes from same fixture: both edges point at fx-{id}', () => {
    place('t1', 'water_closet', [0, 0, 0]);
    drawPipe('p1', [[0, 0, 0], [5, 0, 0]]);
    drawPipe('p2', [[0, 0, 0], [0, 0, 5]]);
    vi.runAllTimers();

    const batch = lastBatch();
    const p1Edge = batch.edgesToAdd.find((e) => e.id === 'edge-p1-1')!;
    const p2Edge = batch.edgesToAdd.find((e) => e.id === 'edge-p2-1')!;
    expect(p1Edge.from).toBe('fx-t1');
    expect(p2Edge.from).toBe('fx-t1');
  });

  it('fixture placed AFTER the pipe is drawn: no retroactive connection', () => {
    drawPipe('p1', [[0, 0, 0], [5, 0, 0]]);
    place('t1', 'water_closet', [0, 0, 0]);
    vi.runAllTimers();

    // Both batched in one flush, but the pipe commit ran first and
    // didn't see the fixture yet, so the edge is wp-based.
    const batch = lastBatch();
    const pipeEdge = batch.edgesToAdd.find((e) => e.id === 'edge-p1-1')!;
    expect(pipeEdge.from).toBe('wp-p1-0');
    // The fixture is still in the batch as an isolated node.
    expect(batch.nodesToAdd.find((n) => n.id === 'fx-t1')).toBeDefined();
  });

  it('fixture removed, then pipe redrawn: no ghost connection', () => {
    place('t1', 'water_closet', [0, 0, 0]);
    drawPipe('p1', [[0, 0, 0], [5, 0, 0]]);
    vi.runAllTimers();
    expect(lastBatch().edgesToAdd[0]!.from).toBe('fx-t1');

    seen = [];

    eventBus.emit(EV.FIXTURE_REMOVED, { id: 't1' });
    drawPipe('p2', [[0, 0, 0], [5, 0, 0]]);
    vi.runAllTimers();

    const batch = lastBatch();
    const p2Edge = batch.edgesToAdd.find((e) => e.id === 'edge-p2-1')!;
    expect(p2Edge.from).toBe('wp-p2-0');
  });
});
