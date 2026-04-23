/**
 * cappedEndpointStore — orphaned pipe endpoints that should render a
 * visible cap + retaining ring (CapPlug).
 *
 * When the user deletes a pipe whose endpoint was touching another
 * pipe, the surviving pipe's endpoint is now "dangling" — a physical
 * install would cap it off. `ConnectivityManager` detects this via
 * the pipeConnectivityStore and pushes a record here.
 *
 * Self-heal: when a NEW pipe is added whose endpoint lands on a
 * capped position, the cap is removed automatically. The user gets
 * a plug for free when they delete; the plug disappears the moment
 * they reconnect something.
 *
 * Cap id is derived from the position (stable) so idempotent adds
 * don't create duplicates, and removal by position is one lookup.
 */

import { create } from 'zustand';
import type { Vec3 } from '@core/events';
import type { SystemType } from '../engine/graph/GraphNode';
import { posKey, JOIN_EPSILON_FT } from './pipeConnectivityStore';

// ── Types ──────────────────────────────────────────────────────

export interface CappedEndpoint {
  /** Stable id = `cap_${posKey}`. Re-capping the same spot is a no-op. */
  id: string;
  /** World-space position of the orphaned endpoint. */
  position: Vec3;
  /** Outward-facing unit vector — the cap points this way. */
  outward: Vec3;
  /** Pipe outer diameter in inches — sizes the plug geometry. */
  diameterIn: number;
  /** Plumbing system — ring color follows system. */
  system: SystemType;
  /** Timestamp the cap was created; stable across re-renders. */
  createdAt: number;
}

interface CappedState {
  caps: Record<string, CappedEndpoint>;

  addCap: (params: Omit<CappedEndpoint, 'id' | 'createdAt'>) => string;
  removeCapAt: (pos: Vec3) => boolean;
  removeCapById: (id: string) => void;
  clearAll: () => void;
  /** Visual-layer accessor for render. */
  all: () => CappedEndpoint[];
}

// ── Store ──────────────────────────────────────────────────────

function normalizeOutward(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-6) return [0, 0, 1]; // arbitrary default
  return [v[0] / len, v[1] / len, v[2] / len];
}

export const useCappedEndpointStore = create<CappedState>((set, get) => ({
  caps: {},

  addCap: (params) => {
    const id = `cap_${posKey(params.position)}`;
    const existing = get().caps[id];
    if (existing) return existing.id; // idempotent
    const cap: CappedEndpoint = {
      id,
      position: params.position,
      outward: normalizeOutward(params.outward),
      diameterIn: params.diameterIn,
      system: params.system,
      createdAt: performance.now(),
    };
    set((s) => ({ caps: { ...s.caps, [id]: cap } }));
    return id;
  },

  removeCapAt: (pos) => {
    const id = `cap_${posKey(pos)}`;
    const exists = id in get().caps;
    if (!exists) {
      // Also check a small neighborhood — floating-point drift on a
      // re-dropped pipe might round differently.
      const all = Object.values(get().caps);
      const hit = all.find((c) => {
        const dx = c.position[0] - pos[0];
        const dy = c.position[1] - pos[1];
        const dz = c.position[2] - pos[2];
        return dx * dx + dy * dy + dz * dz <= JOIN_EPSILON_FT * JOIN_EPSILON_FT;
      });
      if (!hit) return false;
      set((s) => {
        const { [hit.id]: _gone, ...rest } = s.caps;
        return { caps: rest };
      });
      return true;
    }
    set((s) => {
      const { [id]: _gone, ...rest } = s.caps;
      return { caps: rest };
    });
    return true;
  },

  removeCapById: (id) => {
    set((s) => {
      const { [id]: _gone, ...rest } = s.caps;
      return { caps: rest };
    });
  },

  clearAll: () => set({ caps: {} }),

  all: () => Object.values(get().caps),
}));
