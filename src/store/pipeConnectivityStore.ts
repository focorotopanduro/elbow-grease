/**
 * pipeConnectivityStore — which pipe endpoints touch which.
 *
 * Zustand-backed spatial index. Keys are quantized world-space
 * positions (round to 3 decimals, ~0.001 ft ≈ 0.01"). Values are
 * lists of `{pipeId, which}` pairs telling us every pipe endpoint
 * that sits on that position.
 *
 * Maintained by `ConnectivityManager` which subscribes to
 * `pipe.add` / `pipe.remove` on the CommandBus.
 *
 * Why a separate store (not derived from pipeStore on-demand):
 *   1. Queries are O(1) — crucial for the orphan-detection pass
 *      that runs on every pipe deletion.
 *   2. Encapsulates the spatial-hash epsilon in one place; the
 *      PipeRenderer, FittingRenderer, and cap logic all share it.
 *   3. Phase 7.B.ii (fitting suppression at merged PEX vertices)
 *      needs "is this vertex a tee" in constant time during render.
 */

import { create } from 'zustand';
import type { Vec3 } from '@core/events';

// ── Constants ──────────────────────────────────────────────────

/** Endpoint-merge tolerance (feet). Pipes whose endpoints land within
 *  this distance are considered connected. 0.05 ft ≈ 0.6" — generous
 *  enough to tolerate floating-point drift but tight enough to never
 *  merge two genuinely separate fixtures. */
export const JOIN_EPSILON_FT = 0.05;

/** Position-quantization precision for hash keys (decimal places). */
export const POS_DECIMALS = 3;

// ── Types ──────────────────────────────────────────────────────

export type EndpointSide = 'start' | 'end';

/**
 * Phase 7.D.i — what kind of thing sits at this position.
 *   'pipe'     — a pipe endpoint (start or end of the polyline).
 *   'manifold' — a manifold's outlet port tip.
 *
 * Pipes connected to manifold ports are NOT orphaned when a neighbor
 * pipe is removed — the manifold itself counts as a neighbor for the
 * orphan-detection pass.
 */
export type IncidenceSource = 'pipe' | 'manifold';

export interface EndpointIncidence {
  source: IncidenceSource;
  /** Identifier of the owning entity (pipe id or manifold id). */
  entityId: string;
  /** For pipe source: 'start' | 'end'. For manifold source: undefined. */
  which?: EndpointSide;
  /** World-space endpoint, pre-quantization (for outward-normal math). */
  position: Vec3;
  /** Interior point for outward-normal computation. For manifold ports,
   *  this is a point just inside the port opening (toward the trunk). */
  interiorPoint: Vec3;
}

interface ConnectivityState {
  /** posKey → list of incidences at that position. */
  endpointIndex: Record<string, EndpointIncidence[]>;

  indexPipe: (pipeId: string, points: Vec3[]) => void;
  unindexPipe: (pipeId: string) => void;
  /**
   * Phase 7.D.i — register a manifold's outlet ports as connectivity
   * incidences. Each port gets an entry so a pipe ending at that port
   * is detected as "connected" during the orphan-detection pass.
   * Replaces any prior entries for this manifold id.
   */
  indexManifoldPorts: (
    manifoldId: string,
    ports: Array<{ position: Vec3; interiorPoint: Vec3 }>,
  ) => void;
  /** Remove all incidences belonging to a manifold. */
  unindexManifold: (manifoldId: string) => void;
  /** All incidences at a position (within JOIN_EPSILON_FT). */
  incidencesAt: (pos: Vec3) => EndpointIncidence[];
  /** True if >1 pipe's endpoint sits at this position. */
  isConnected: (pos: Vec3) => boolean;
  clearAll: () => void;
}

// ── Helpers ────────────────────────────────────────────────────

export function posKey(v: Vec3): string {
  const round = (n: number) => n.toFixed(POS_DECIMALS);
  return `${round(v[0])},${round(v[1])},${round(v[2])}`;
}

/** All keys within one quantization step of `pos` — the spatial cell
 *  plus its 6 axis-aligned neighbors. Covers the epsilon case where
 *  two rounded points land in adjacent cells. */
function neighborKeys(pos: Vec3): string[] {
  const step = Math.pow(10, -POS_DECIMALS);
  const keys = new Set<string>();
  for (const dx of [-step, 0, step]) {
    for (const dy of [-step, 0, step]) {
      for (const dz of [-step, 0, step]) {
        keys.add(posKey([pos[0] + dx, pos[1] + dy, pos[2] + dz]));
      }
    }
  }
  return [...keys];
}

function within(a: Vec3, b: Vec3, eps: number): boolean {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz <= eps * eps;
}

// ── Store ──────────────────────────────────────────────────────

export const usePipeConnectivityStore = create<ConnectivityState>((set, get) => ({
  endpointIndex: {},

  indexPipe: (pipeId, points) => {
    if (points.length < 2) return;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const firstInterior = points[1]!;
    const lastInterior = points[points.length - 2]!;

    set((s) => {
      // Remove any stale incidence for this pipeId before re-indexing.
      const clean = stripEntityFromIndex(s.endpointIndex, 'pipe', pipeId);
      // Add fresh incidences.
      return {
        endpointIndex: addIncidences(clean, [
          {
            source: 'pipe',
            entityId: pipeId,
            which: 'start',
            position: first,
            interiorPoint: firstInterior,
          },
          {
            source: 'pipe',
            entityId: pipeId,
            which: 'end',
            position: last,
            interiorPoint: lastInterior,
          },
        ]),
      };
    });
  },

  unindexPipe: (pipeId) => {
    set((s) => ({
      endpointIndex: stripEntityFromIndex(s.endpointIndex, 'pipe', pipeId),
    }));
  },

  indexManifoldPorts: (manifoldId, ports) => {
    set((s) => {
      const clean = stripEntityFromIndex(s.endpointIndex, 'manifold', manifoldId);
      return {
        endpointIndex: addIncidences(
          clean,
          ports.map((p) => ({
            source: 'manifold',
            entityId: manifoldId,
            position: p.position,
            interiorPoint: p.interiorPoint,
          })),
        ),
      };
    });
  },

  unindexManifold: (manifoldId) => {
    set((s) => ({
      endpointIndex: stripEntityFromIndex(s.endpointIndex, 'manifold', manifoldId),
    }));
  },

  incidencesAt: (pos) => {
    const idx = get().endpointIndex;
    const seen = new Set<string>();
    const out: EndpointIncidence[] = [];
    for (const key of neighborKeys(pos)) {
      const list = idx[key];
      if (!list) continue;
      for (const inc of list) {
        if (!within(inc.position, pos, JOIN_EPSILON_FT)) continue;
        const id = `${inc.source}:${inc.entityId}|${inc.which ?? ''}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(inc);
      }
    }
    return out;
  },

  isConnected: (pos) => {
    return get().incidencesAt(pos).length > 1;
  },

  clearAll: () => set({ endpointIndex: {} }),
}));

// ── Pure helpers (no React / no Zustand state) ────────────────

function stripEntityFromIndex(
  index: Record<string, EndpointIncidence[]>,
  source: IncidenceSource,
  entityId: string,
): Record<string, EndpointIncidence[]> {
  const out: Record<string, EndpointIncidence[]> = {};
  for (const [key, list] of Object.entries(index)) {
    const filtered = list.filter(
      (inc) => !(inc.source === source && inc.entityId === entityId),
    );
    if (filtered.length > 0) out[key] = filtered;
  }
  return out;
}

function addIncidences(
  index: Record<string, EndpointIncidence[]>,
  incidences: EndpointIncidence[],
): Record<string, EndpointIncidence[]> {
  const out = { ...index };
  for (const inc of incidences) {
    const key = posKey(inc.position);
    out[key] = [...(out[key] ?? []), inc];
  }
  return out;
}
