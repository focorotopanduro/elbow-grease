/**
 * manifoldStore — Zustand store for PEX manifold entities.
 *
 * A Manifold is a trunk + N outlet ports. Entities live here; the
 * ManifoldRenderer reads positions + port counts and produces 3D.
 *
 * Phase 7.C operations exposed:
 *   • addManifold   — new 2-port at a given position
 *   • removeManifold
 *   • moveManifold  — update center during/after drag
 *   • mergeIntoExisting — atomic combine of two manifolds
 *
 * Command handlers in `@core/commands/handlers/manifoldHandlers.ts`
 * wrap these actions so every mutation shows up in the God Mode
 * console (Phase 1).
 */

import { create } from 'zustand';
import type { Vec3 } from '@core/events';
import type {
  Manifold,
} from '../core/manifold/ManifoldGeometry';
import {
  MAX_PORT_COUNT,
  checkManifoldMerge,
  computeMerged,
} from '../core/manifold/ManifoldGeometry';
import type { SystemType } from '../engine/graph/GraphNode';
import type { PipeMaterial } from '../engine/graph/GraphEdge';

// ── State shape ────────────────────────────────────────────────

interface ManifoldState {
  manifolds: Record<string, Manifold>;
  order: string[];
  selectedId: string | null;

  addManifold: (params: {
    position: Vec3;
    yawRad?: number;
    portCount?: number;
    system?: SystemType;
    material?: PipeMaterial;
    portDiameterIn?: number;
    floorY?: number;
  }) => string;
  removeManifold: (id: string) => void;
  moveManifold: (id: string, center: Vec3) => void;
  selectManifold: (id: string | null) => void;
  /** Try to merge `sourceId` into any adjacent eligible manifold. Returns
   *  the surviving manifold id, or null if no merge occurred. */
  tryMergeWithNeighbors: (sourceId: string) => string | null;
  mergeInto: (survivorId: string, absorbedId: string) => void;
}

// ── Id generation ─────────────────────────────────────────────

let seq = 0;
function newManifoldId(): string {
  seq = (seq + 1) & 0xffff;
  return `mf_${Date.now().toString(36)}_${seq.toString(36)}`;
}

// ── Store ─────────────────────────────────────────────────────

export const useManifoldStore = create<ManifoldState>((set, get) => ({
  manifolds: {},
  order: [],
  selectedId: null,

  addManifold: (p) => {
    const id = newManifoldId();
    const manifold: Manifold = {
      id,
      center: p.position,
      yawRad: p.yawRad ?? 0,
      portCount: Math.max(2, Math.min(MAX_PORT_COUNT, p.portCount ?? 2)),
      system: p.system ?? 'cold_supply',
      material: p.material ?? 'pex',
      portDiameterIn: p.portDiameterIn ?? 0.5,
      floorY: p.floorY ?? p.position[1],
    };
    set((s) => ({
      manifolds: { ...s.manifolds, [id]: manifold },
      order: [...s.order, id],
    }));
    return id;
  },

  removeManifold: (id) => {
    set((s) => {
      const { [id]: _gone, ...rest } = s.manifolds;
      return {
        manifolds: rest,
        order: s.order.filter((x) => x !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
      };
    });
  },

  moveManifold: (id, center) => {
    set((s) => {
      const m = s.manifolds[id];
      if (!m) return s;
      return {
        manifolds: { ...s.manifolds, [id]: { ...m, center } },
      };
    });
  },

  selectManifold: (id) => set({ selectedId: id }),

  tryMergeWithNeighbors: (sourceId) => {
    const { manifolds } = get();
    const source = manifolds[sourceId];
    if (!source) return null;

    for (const candidate of Object.values(manifolds)) {
      if (candidate.id === sourceId) continue;
      const check = checkManifoldMerge(source, candidate);
      if (!check.canMerge) continue;
      // Merge: source absorbs the candidate, keeping source's id so
      // selection + command traceability follow the dragged entity.
      const merged = computeMerged(source, candidate, check);
      set((s) => {
        const { [candidate.id]: _gone, ...rest } = s.manifolds;
        return {
          manifolds: { ...rest, [sourceId]: merged },
          order: s.order.filter((x) => x !== candidate.id),
          selectedId: s.selectedId === candidate.id ? sourceId : s.selectedId,
        };
      });
      return sourceId;
    }
    return null;
  },

  mergeInto: (survivorId, absorbedId) => {
    const { manifolds } = get();
    const survivor = manifolds[survivorId];
    const absorbed = manifolds[absorbedId];
    if (!survivor || !absorbed) return;
    const check = checkManifoldMerge(survivor, absorbed);
    if (!check.canMerge) return;
    const merged = computeMerged(survivor, absorbed, check);
    set((s) => {
      const { [absorbedId]: _gone, ...rest } = s.manifolds;
      return {
        manifolds: { ...rest, [survivorId]: merged },
        order: s.order.filter((x) => x !== absorbedId),
        selectedId: s.selectedId === absorbedId ? survivorId : s.selectedId,
      };
    });
  },
}));
