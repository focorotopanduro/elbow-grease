/**
 * ConnectivityManager — keeps pipeConnectivityStore in sync with
 * pipeStore, and auto-pushes/removes caps in cappedEndpointStore.
 *
 * Lifecycle:
 *   1. `bootConnectivityManager()` subscribes to the CommandBus for
 *      `pipe.add`, `pipe.remove`, and `pipe.insertAnchor` (the last
 *      changes a pipe's endpoints when a tee is inserted at an end).
 *   2. Every time a pipe is added/removed, we re-index its endpoints.
 *   3. On remove, we detect orphans: former neighbors whose endpoint
 *      is now alone. Each orphan gets a cap pushed to cappedEndpointStore.
 *   4. On add, we detect un-orphans: endpoints that had caps are now
 *      connected again; the cap is removed (self-heal).
 *
 * This module is pure glue — all state lives in the stores. It also
 * registers a tiny system handler on the bus so the subscription is
 * testable in isolation.
 */

import { commandBus } from '@core/commands/CommandBus';
import type { CommandLogEntry } from '@core/commands/types';
import { usePipeStore } from '@store/pipeStore';
import {
  usePipeConnectivityStore,
  type EndpointIncidence,
} from '@store/pipeConnectivityStore';
import { useCappedEndpointStore } from '@store/cappedEndpointStore';
import { useManifoldStore } from '@store/manifoldStore';
import type { Vec3 } from '@core/events';
import type { SystemType } from '../../engine/graph/GraphNode';
import {
  computePortPositions,
  PORT_EXTENSION_FT,
  type Manifold,
} from '../manifold/ManifoldGeometry';

// ── Boot/teardown ─────────────────────────────────────────────

let booted = false;
let unsubscribe: (() => void) | null = null;

export function bootConnectivityManager(): void {
  if (booted) return;
  booted = true;

  // Index any pipes that already exist at boot (e.g. from restored state).
  const { pipes } = usePipeStore.getState();
  for (const p of Object.values(pipes)) {
    usePipeConnectivityStore.getState().indexPipe(p.id, p.points);
  }

  // Phase 7.D.i — index any manifolds that exist at boot.
  const { manifolds } = useManifoldStore.getState();
  for (const m of Object.values(manifolds)) {
    indexManifold(m);
  }

  // Subscribe to command events that affect connectivity.
  unsubscribe = commandBus.subscribe((entry) => {
    onCommand(entry);
  });
}

export function shutdownConnectivityManager(): void {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  booted = false;
}

/** Test-only reset. */
export function __resetConnectivityManagerForTests(): void {
  shutdownConnectivityManager();
  usePipeConnectivityStore.getState().clearAll();
  useCappedEndpointStore.getState().clearAll();
}

// ── Command dispatcher ────────────────────────────────────────

function onCommand(entry: CommandLogEntry): void {
  if (!entry.result.ok) return;
  const { type, payload } = entry.command;

  switch (type) {
    case 'pipe.add': {
      const p = payload as { id: string; points: Vec3[] };
      handlePipeAdded(p.id, p.points);
      break;
    }
    case 'pipe.remove': {
      const p = payload as { id: string };
      handlePipeRemoved(p.id);
      break;
    }
    case 'pipe.insertAnchor': {
      // Tee insertion changes the pipe's polyline but endpoints stay
      // the same. Re-index defensively — cheap and keeps the invariant
      // exact if we ever change that.
      const p = payload as { pipeId: string };
      const pipe = usePipeStore.getState().pipes[p.pipeId];
      if (pipe) {
        usePipeConnectivityStore.getState().indexPipe(p.pipeId, pipe.points);
      }
      break;
    }

    // ── Phase 7.D.i — manifold port indexing ────────────────
    case 'manifold.add':
    case 'manifold.move':
    case 'manifold.mergeNeighbors': {
      // Re-index the affected manifold from its current store state.
      // For add, we look up by id from the result; for move/merge,
      // the payload carries the id directly (mergeNeighbors keeps the
      // source id, so the same id is still valid post-merge).
      const p = payload as { id?: string } & Record<string, unknown>;
      const id = typeof p.id === 'string' ? p.id : undefined;
      if (id) {
        const m = useManifoldStore.getState().manifolds[id];
        if (m) indexManifold(m);
      }
      // mergeNeighbors may also have consumed another manifold — the
      // store removed it, so unindex by scanning what the store no
      // longer contains. Cheap fallback: just clear + reindex all
      // manifolds. At ≤ hundreds of manifolds this is microseconds.
      reindexAllManifolds();
      break;
    }
    case 'manifold.remove': {
      const p = payload as { id: string };
      usePipeConnectivityStore.getState().unindexManifold(p.id);
      break;
    }

    default:
      // unrelated command; ignore
      break;
  }
}

// ── Manifold indexing helper ──────────────────────────────────

function indexManifold(m: Manifold): void {
  const ports = computePortPositions(m);
  // Interior point for each port: inset from the tip toward the trunk
  // by one PORT_EXTENSION_FT along -outward. Used for outward-normal
  // calculation if we ever cap a manifold port.
  const entries = ports.map((p) => ({
    position: p.worldPosition,
    interiorPoint: [
      p.worldPosition[0] - p.outward[0] * PORT_EXTENSION_FT,
      p.worldPosition[1] - p.outward[1] * PORT_EXTENSION_FT,
      p.worldPosition[2] - p.outward[2] * PORT_EXTENSION_FT,
    ] as Vec3,
  }));
  usePipeConnectivityStore.getState().indexManifoldPorts(m.id, entries);
}

/**
 * Full resync of the manifold portion of the connectivity index.
 * Cheap sledgehammer used when a merge just consumed a manifold so
 * we don't have to track the deleted id separately.
 */
function reindexAllManifolds(): void {
  const store = usePipeConnectivityStore.getState();
  // Pull every manifold-source entry out of the index…
  const idx = store.endpointIndex;
  const manifoldIds = new Set<string>();
  for (const list of Object.values(idx)) {
    for (const inc of list) {
      if (inc.source === 'manifold') manifoldIds.add(inc.entityId);
    }
  }
  for (const id of manifoldIds) store.unindexManifold(id);
  // …then re-add everything that still exists in manifoldStore.
  const manifolds = useManifoldStore.getState().manifolds;
  for (const m of Object.values(manifolds)) indexManifold(m);
}

// ── Add handler ───────────────────────────────────────────────

function handlePipeAdded(pipeId: string, points: Vec3[]): void {
  if (points.length < 2) return;

  const first = points[0]!;
  const last = points[points.length - 1]!;

  // Step 1: index the new pipe's endpoints.
  usePipeConnectivityStore.getState().indexPipe(pipeId, points);

  // Step 2: SELF-HEAL. If either endpoint had a cap, remove the cap —
  // the user just reconnected at that position.
  const capStore = useCappedEndpointStore.getState();
  capStore.removeCapAt(first);
  capStore.removeCapAt(last);
}

// ── Remove handler ────────────────────────────────────────────

function handlePipeRemoved(pipeId: string): void {
  const state = usePipeConnectivityStore.getState();

  // Find the removed pipe's endpoint incidences BEFORE unindexing, so
  // we can locate its former neighbors.
  const formerIncidences = findPipeIncidences(pipeId);

  // Unindex immediately so neighbor queries below reflect the post-remove
  // graph.
  state.unindexPipe(pipeId);

  if (formerIncidences.length === 0) return;

  // For each former endpoint of the removed pipe, check what (if
  // anything) is STILL at that position. If exactly one PIPE neighbor
  // remains, that pipe endpoint is now orphaned — cap it.
  //
  // Manifold ports don't get caps — they're entities that stand alone.
  // A pipe that was connected to a manifold port and is now deleted
  // leaves the port unchanged; the manifold itself still renders fine.
  for (const removedInc of formerIncidences) {
    const remaining = state.incidencesAt(removedInc.position);
    // Filter to pipe-source incidences. If exactly one pipe remains
    // AND no manifold port shares this position, the pipe is orphaned.
    const pipeRemaining = remaining.filter((r) => r.source === 'pipe');
    const hasManifoldPort = remaining.some((r) => r.source === 'manifold');
    if (pipeRemaining.length !== 1 || hasManifoldPort) continue;
    const orphan = pipeRemaining[0]!;
    pushCapForOrphan(orphan);
  }
}

/** Produce all incidences for a specific pipeId by scanning the index
 *  (before unindexing it). We don't store a reverse map because
 *  removals are rare; linear scan over the index is fine. */
function findPipeIncidences(pipeId: string): EndpointIncidence[] {
  const idx = usePipeConnectivityStore.getState().endpointIndex;
  const out: EndpointIncidence[] = [];
  for (const list of Object.values(idx)) {
    for (const inc of list) {
      if (inc.source === 'pipe' && inc.entityId === pipeId) out.push(inc);
    }
  }
  return out;
}

// ── Cap creation ──────────────────────────────────────────────

function pushCapForOrphan(orphan: EndpointIncidence): void {
  if (orphan.source !== 'pipe') return;
  const pipe = usePipeStore.getState().pipes[orphan.entityId];
  if (!pipe) return;

  // Outward direction: from the interior point toward the endpoint.
  // This orients the cap to face AWAY from the pipe centerline.
  const outward: Vec3 = [
    orphan.position[0] - orphan.interiorPoint[0],
    orphan.position[1] - orphan.interiorPoint[1],
    orphan.position[2] - orphan.interiorPoint[2],
  ];

  useCappedEndpointStore.getState().addCap({
    position: orphan.position,
    outward,
    diameterIn: pipe.diameter,
    system: pipe.system as SystemType,
  });
}
