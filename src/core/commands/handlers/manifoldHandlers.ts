/**
 * Manifold command handlers — Phase 7.C.
 *
 * Every manifold mutation routes through the CommandBus so the God
 * Mode console (Phase 1) logs the drag/merge chain, and any future
 * bulk undo can reverse manifold drops uniformly.
 */

import type { CommandHandler } from '../types';
import { useManifoldStore } from '@store/manifoldStore';
import type { Vec3 } from '@core/events';
import type { Manifold } from '../../manifold/ManifoldGeometry';
import type { SystemType } from '../../../engine/graph/GraphNode';
import type { PipeMaterial } from '../../../engine/graph/GraphEdge';

// ── Payloads ──────────────────────────────────────────────────

export interface ManifoldAddPayload {
  position: Vec3;
  yawRad?: number;
  portCount?: number;
  system?: SystemType;
  material?: PipeMaterial;
  portDiameterIn?: number;
  floorY?: number;
}

export interface ManifoldRemovePayload {
  id: string;
}

export interface ManifoldMovePayload {
  id: string;
  center: Vec3;
}

export interface ManifoldSelectPayload {
  id: string | null;
}

export interface ManifoldMergeNeighborsPayload {
  id: string;
}

// ── Handlers ──────────────────────────────────────────────────

export const manifoldAddHandler: CommandHandler<ManifoldAddPayload, string> = {
  type: 'manifold.add',
  mode: 'plumbing',
  apply: (p) => useManifoldStore.getState().addManifold(p),
};

export const manifoldRemoveHandler: CommandHandler<ManifoldRemovePayload, void> = {
  type: 'manifold.remove',
  mode: 'plumbing',
  preconditions: (p) => {
    if (!useManifoldStore.getState().manifolds[p.id]) {
      return `manifold.remove: no manifold "${p.id}"`;
    }
    return null;
  },
  snapshot: (p) => useManifoldStore.getState().manifolds[p.id] ?? null,
  apply: (p) => useManifoldStore.getState().removeManifold(p.id),
  undo: (_p, snap) => {
    const m = snap as Manifold | null;
    if (!m) return;
    // Restore by re-inserting into the map preserving id.
    useManifoldStore.setState((s) => ({
      manifolds: { ...s.manifolds, [m.id]: m },
      order: s.order.includes(m.id) ? s.order : [...s.order, m.id],
    }));
  },
};

export const manifoldMoveHandler: CommandHandler<ManifoldMovePayload, void> = {
  type: 'manifold.move',
  mode: 'plumbing',
  preconditions: (p) => {
    if (!useManifoldStore.getState().manifolds[p.id]) {
      return `manifold.move: no manifold "${p.id}"`;
    }
    return null;
  },
  snapshot: (p) => ({
    prevCenter: useManifoldStore.getState().manifolds[p.id]?.center,
  }),
  apply: (p) => useManifoldStore.getState().moveManifold(p.id, p.center),
  undo: (p, snap) => {
    const s = snap as { prevCenter?: Vec3 } | null;
    if (!s?.prevCenter) return;
    useManifoldStore.getState().moveManifold(p.id, s.prevCenter);
  },
};

export const manifoldSelectHandler: CommandHandler<ManifoldSelectPayload, void> = {
  type: 'manifold.select',
  mode: 'plumbing',
  apply: (p) => useManifoldStore.getState().selectManifold(p.id),
};

/**
 * manifold.mergeNeighbors — the capstone drag-merge action.
 *
 * Snapshots ALL manifolds so undo can restore the pre-merge scene
 * verbatim (simpler than tracking which specific pair merged, since
 * a single drag can trigger a chain of merges).
 */
export const manifoldMergeNeighborsHandler: CommandHandler<
  ManifoldMergeNeighborsPayload,
  string | null
> = {
  type: 'manifold.mergeNeighbors',
  mode: 'plumbing',
  preconditions: (p) => {
    if (!useManifoldStore.getState().manifolds[p.id]) {
      return `manifold.mergeNeighbors: no manifold "${p.id}"`;
    }
    return null;
  },
  snapshot: () => ({
    manifolds: { ...useManifoldStore.getState().manifolds },
    order: [...useManifoldStore.getState().order],
  }),
  apply: (p) => {
    return useManifoldStore.getState().tryMergeWithNeighbors(p.id);
  },
  undo: (_p, snap) => {
    const s = snap as { manifolds: Record<string, Manifold>; order: string[] } | null;
    if (!s) return;
    useManifoldStore.setState({ manifolds: s.manifolds, order: s.order });
  },
};

export const manifoldHandlers = [
  manifoldAddHandler,
  manifoldRemoveHandler,
  manifoldMoveHandler,
  manifoldSelectHandler,
  manifoldMergeNeighborsHandler,
] as const;
