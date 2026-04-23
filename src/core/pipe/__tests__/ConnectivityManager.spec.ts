/**
 * ConnectivityManager — Phase 7.D acceptance tests.
 *
 * Covers:
 *   • Index correctness: two pipes sharing an endpoint are "connected".
 *   • Orphan detection: removing one of a connected pair caps the other's
 *     endpoint at the shared position.
 *   • No false positives: removing an isolated pipe creates no caps.
 *   • Self-heal: adding a new pipe at a capped position removes the cap.
 *   • Tee (3-way): removing ONE pipe from a 3-way junction leaves the
 *     remaining 2 still connected — no cap.
 *   • Cap idempotency: adding the same cap twice returns the same id.
 *
 * Tests exercise the CommandBus path end-to-end because that's the
 * real production flow (pipe.add/remove are routed through bus).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { commandBus } from '@core/commands/CommandBus';
import { registerAllHandlers } from '@core/commands/handlers';
import {
  bootConnectivityManager,
  __resetConnectivityManagerForTests,
} from '../ConnectivityManager';
import { usePipeConnectivityStore } from '@store/pipeConnectivityStore';
import { useCappedEndpointStore } from '@store/cappedEndpointStore';
import { usePipeStore } from '@store/pipeStore';
import type { Vec3 } from '@core/events';

// ── Lifecycle ──────────────────────────────────────────────────

beforeEach(() => {
  commandBus.__reset();
  registerAllHandlers();
  usePipeStore.setState({
    pipes: {}, pipeOrder: [], selectedId: null,
    undoStack: [], redoStack: [], pivotSession: null,
  });
  __resetConnectivityManagerForTests();
  bootConnectivityManager();
});

// ── Helpers ────────────────────────────────────────────────────

function addPipe(id: string, points: Vec3[], material = 'pvc_sch40', diameter = 2) {
  return commandBus.dispatch({
    type: 'pipe.add',
    payload: { id, points, diameter, material },
  });
}

function removePipe(id: string) {
  return commandBus.dispatch({
    type: 'pipe.remove',
    payload: { id },
  });
}

// ── Connectivity indexing ─────────────────────────────────────

describe('pipeConnectivityStore — index', () => {
  it('two pipes sharing an endpoint → isConnected returns true at the shared point', () => {
    addPipe('a', [[0, 0, 0], [5, 0, 0]]);
    addPipe('b', [[5, 0, 0], [5, 0, 5]]);
    const store = usePipeConnectivityStore.getState();
    expect(store.isConnected([5, 0, 0])).toBe(true);
    expect(store.incidencesAt([5, 0, 0])).toHaveLength(2);
  });

  it('single pipe → endpoints are not connected (only 1 incidence)', () => {
    addPipe('a', [[0, 0, 0], [5, 0, 0]]);
    const store = usePipeConnectivityStore.getState();
    expect(store.isConnected([0, 0, 0])).toBe(false);
    expect(store.isConnected([5, 0, 0])).toBe(false);
  });

  it('unindex on removal clears incidences', () => {
    addPipe('a', [[0, 0, 0], [5, 0, 0]]);
    removePipe('a');
    const store = usePipeConnectivityStore.getState();
    expect(store.incidencesAt([0, 0, 0])).toHaveLength(0);
    expect(store.incidencesAt([5, 0, 0])).toHaveLength(0);
  });
});

// ── Auto-plug on delete ───────────────────────────────────────

describe('auto-plug on delete', () => {
  it('removing one of a connected pair caps the other\'s orphaned end', () => {
    addPipe('a', [[0, 0, 0], [5, 0, 0]]);
    addPipe('b', [[5, 0, 0], [5, 0, 5]]);
    // Sanity: no caps yet.
    expect(Object.keys(useCappedEndpointStore.getState().caps)).toHaveLength(0);

    removePipe('a');

    const caps = Object.values(useCappedEndpointStore.getState().caps);
    expect(caps).toHaveLength(1);
    const cap = caps[0]!;
    // The surviving pipe b's start endpoint at (5,0,0) is now orphaned.
    expect(cap.position[0]).toBeCloseTo(5, 3);
    expect(cap.position[1]).toBeCloseTo(0, 3);
    expect(cap.position[2]).toBeCloseTo(0, 3);
    // Outward points from (5,0,5) → (5,0,0) → direction (0, 0, -1).
    expect(cap.outward[2]).toBeLessThan(0);
  });

  it('removing an isolated pipe creates no cap', () => {
    addPipe('a', [[0, 0, 0], [5, 0, 0]]);
    removePipe('a');
    expect(Object.keys(useCappedEndpointStore.getState().caps)).toHaveLength(0);
  });

  it('tee junction (3-way): removing ONE leaves the other 2 still connected — no cap', () => {
    addPipe('a', [[0, 0, 0], [5, 0, 0]]);
    addPipe('b', [[5, 0, 0], [5, 0, 5]]);
    addPipe('c', [[5, 0, 0], [10, 0, 0]]);
    removePipe('a');

    // At (5,0,0), pipes b + c still share the endpoint → no orphan → no cap.
    const caps = Object.values(useCappedEndpointStore.getState().caps);
    expect(caps).toHaveLength(0);
  });

  it('a\'s start is orphaned but not capped if a was isolated (no sibling ever)', () => {
    addPipe('a', [[0, 0, 0], [5, 0, 0]]);
    removePipe('a');
    expect(Object.keys(useCappedEndpointStore.getState().caps)).toHaveLength(0);
  });
});

// ── Self-heal on re-add ───────────────────────────────────────

describe('self-heal', () => {
  it('adding a new pipe whose endpoint lands on a cap removes the cap', () => {
    // Setup: a + b share endpoint, remove a → cap at (5,0,0).
    addPipe('a', [[0, 0, 0], [5, 0, 0]]);
    addPipe('b', [[5, 0, 0], [5, 0, 5]]);
    removePipe('a');
    expect(Object.keys(useCappedEndpointStore.getState().caps)).toHaveLength(1);

    // Re-add a pipe at the capped position — cap should vanish.
    addPipe('a2', [[0, 0, 0], [5, 0, 0]]);
    expect(Object.keys(useCappedEndpointStore.getState().caps)).toHaveLength(0);
  });

  it('re-adding far from the cap leaves the cap alone', () => {
    addPipe('a', [[0, 0, 0], [5, 0, 0]]);
    addPipe('b', [[5, 0, 0], [5, 0, 5]]);
    removePipe('a');
    // Add an unrelated pipe elsewhere.
    addPipe('c', [[100, 0, 0], [105, 0, 0]]);
    expect(Object.keys(useCappedEndpointStore.getState().caps)).toHaveLength(1);
  });
});

// ── Phase 7.D.i: manifold ports as connectivity ───────────────

describe('manifold ports as connectivity', () => {
  it('indexes manifold ports so incidencesAt returns manifold entries', async () => {
    const { useManifoldStore } = await import('@store/manifoldStore');
    useManifoldStore.setState({ manifolds: {}, order: [], selectedId: null });

    commandBus.dispatch({
      type: 'manifold.add',
      payload: {
        position: [0, 0, 0] as Vec3,
        portCount: 2,
        yawRad: 0,
        system: 'cold_supply',
        material: 'pex',
        portDiameterIn: 0.5,
        floorY: 0,
      },
    });

    const { computePortPositions } = await import('@core/manifold/ManifoldGeometry');
    const theManifold = Object.values(useManifoldStore.getState().manifolds)[0]!;
    const ports = computePortPositions(theManifold);
    expect(ports.length).toBe(2);

    const inc = usePipeConnectivityStore.getState().incidencesAt(ports[0]!.worldPosition);
    expect(inc.some((x) => x.source === 'manifold')).toBe(true);

    useManifoldStore.setState({ manifolds: {}, order: [], selectedId: null });
  });

  it('pipe connected to a manifold port is NOT capped when a sibling pipe is removed', async () => {
    const { useManifoldStore } = await import('@store/manifoldStore');
    useManifoldStore.setState({ manifolds: {}, order: [], selectedId: null });

    commandBus.dispatch({
      type: 'manifold.add',
      payload: {
        position: [0, 0, 0] as Vec3,
        portCount: 2,
        yawRad: 0,
        system: 'cold_supply',
        material: 'pex',
        portDiameterIn: 0.5,
        floorY: 0,
      },
    });
    const { computePortPositions } = await import('@core/manifold/ManifoldGeometry');
    const theManifold = Object.values(useManifoldStore.getState().manifolds)[0]!;
    const port0 = computePortPositions(theManifold)[0]!.worldPosition;

    // Two pipes both ending at the manifold port.
    addPipe('a', [[10, 0, 10], port0]);
    addPipe('b', [[20, 0, 10], port0]);

    // Remove one — no cap should appear (the manifold keeps the port occupied).
    removePipe('a');
    expect(Object.keys(useCappedEndpointStore.getState().caps)).toHaveLength(0);

    useManifoldStore.setState({ manifolds: {}, order: [], selectedId: null });
  });
});

// ── Phase 7.D.ii: undo of pipe.remove reverses auto-cap ──────

describe('undo pipe.remove reverses auto-cap', () => {
  it('undoing a pipe.remove that produced a cap also removes the cap', async () => {
    addPipe('a', [[0, 0, 0], [5, 0, 0]]);
    addPipe('b', [[5, 0, 0], [5, 0, 5]]);

    // Remove 'a' — cap appears at (5,0,0).
    const removeRes = commandBus.dispatch({
      type: 'pipe.remove',
      payload: { id: 'a' },
    });
    expect(removeRes.ok).toBe(true);
    expect(Object.keys(useCappedEndpointStore.getState().caps)).toHaveLength(1);

    // Pull the handler + run its undo with the snapshot.
    const { pipeRemoveHandler } = await import('@core/commands/handlers/pipeHandlers');
    const snap = (removeRes as { snapshot: unknown }).snapshot;
    pipeRemoveHandler.undo!(
      { id: 'a' },
      snap,
      { childCorrelation: () => 'x', currentCommand: removeRes.command as any },
    );

    // Pipe restored
    expect(usePipeStore.getState().pipes.a).toBeDefined();
    // Cap removed
    expect(Object.keys(useCappedEndpointStore.getState().caps)).toHaveLength(0);
    // Connectivity re-indexed
    const inc = usePipeConnectivityStore.getState().incidencesAt([5, 0, 0]);
    expect(inc.length).toBe(2); // pipe 'a' endpoint + pipe 'b' endpoint
  });
});

// ── Idempotency ───────────────────────────────────────────────

describe('cap idempotency', () => {
  it('double-add of a cap at the same position returns the same id', () => {
    const id1 = useCappedEndpointStore.getState().addCap({
      position: [1, 0, 0],
      outward: [0, 0, 1],
      diameterIn: 2,
      system: 'cold_supply',
    });
    const id2 = useCappedEndpointStore.getState().addCap({
      position: [1, 0, 0],
      outward: [0, 0, 1],
      diameterIn: 2,
      system: 'cold_supply',
    });
    expect(id1).toBe(id2);
    expect(Object.keys(useCappedEndpointStore.getState().caps)).toHaveLength(1);
  });

  it('removeCapAt handles floating-point drift within epsilon', () => {
    const exact: Vec3 = [1, 0, 0];
    const driftedByTinyAmount: Vec3 = [1.00001, 0, 0];
    useCappedEndpointStore.getState().addCap({
      position: exact,
      outward: [0, 0, 1],
      diameterIn: 2,
      system: 'cold_supply',
    });
    const removed = useCappedEndpointStore.getState().removeCapAt(driftedByTinyAmount);
    expect(removed).toBe(true);
    expect(Object.keys(useCappedEndpointStore.getState().caps)).toHaveLength(0);
  });
});
