/**
 * WallStore — structural wall segments acting as spatial constraints.
 *
 * Walls define the framing. Pipes/fixtures can snap to them; rendering
 * shows a translucent 3D box so the user can trace inside-walls.
 *
 * Each wall is an axis-agnostic 2D segment in plan (X/Z), extruded in
 * Y from floorY to floorY+height. Thickness is orthogonal to the
 * segment direction.
 *
 * Wall types inform thickness defaults and rendering accent color:
 *
 *   exterior    6"    brown   — rim/perimeter walls, often 2x6
 *   interior    4.5"  grey    — standard 2x4
 *   plumbing    6"    cyan    — wet wall with stacks (oversized)
 *   partition   3.5"  grey    — non-load-bearing divider
 *   knee        2.5"  orange  — low walls (3' high attic etc)
 */

import { create } from 'zustand';

export type WallType = 'exterior' | 'interior' | 'plumbing' | 'partition' | 'knee';

export interface Wall {
  id: string;
  /** Start point [x, z] in feet. */
  start: [number, number];
  /** End point [x, z] in feet. */
  end: [number, number];
  /** Thickness in feet (0.5 = 6"). */
  thickness: number;
  /** Floor elevation in feet. */
  floorY: number;
  /** Height in feet. */
  height: number;
  type: WallType;
  /** Optional label (e.g. "N-exterior"). */
  label?: string;
  /** Hidden from scene? (still used for snap). */
  hidden?: boolean;
}

export const WALL_TYPE_META: Record<WallType, { label: string; color: string; defaultThicknessFt: number; defaultHeightFt: number }> = {
  exterior:  { label: 'Exterior',  color: '#8d6e63', defaultThicknessFt: 0.5,   defaultHeightFt: 9 },
  interior:  { label: 'Interior',  color: '#9e9e9e', defaultThicknessFt: 0.375, defaultHeightFt: 9 },
  plumbing:  { label: 'Plumbing',  color: '#00bcd4', defaultThicknessFt: 0.5,   defaultHeightFt: 9 },
  partition: { label: 'Partition', color: '#b0bec5', defaultThicknessFt: 0.29,  defaultHeightFt: 7 },
  knee:      { label: 'Knee',      color: '#ffa726', defaultThicknessFt: 0.21,  defaultHeightFt: 3 },
};

// ── Session state while drawing a wall ─────────────────────────

export interface WallDrawSession {
  type: WallType;
  firstPoint: [number, number] | null;
  previewEnd: [number, number] | null;
  /** If true, draw continuous chain (each click adds a segment). */
  chain: boolean;
}

// ── Store ───────────────────────────────────────────────────────

interface WallState {
  walls: Record<string, Wall>;
  selectedWallId: string | null;
  drawSession: WallDrawSession | null;
  /** Show wall outlines even when the renderer hidden flag is true. */
  showWallsGlobal: boolean;
  /** Wall opacity (wireframe overlay). */
  wallOpacity: number;

  addWall: (start: [number, number], end: [number, number], type?: WallType, floorY?: number) => string;
  updateWall: (id: string, patch: Partial<Wall>) => void;
  removeWall: (id: string) => void;
  selectWall: (id: string | null) => void;

  beginWallDraw: (type: WallType, chain?: boolean) => void;
  placeWallPoint: (pt: [number, number], floorY: number) => void;
  setWallPreview: (pt: [number, number] | null) => void;
  cancelWallDraw: () => void;

  toggleShowWalls: () => void;
  setWallOpacity: (opacity: number) => void;
}

let seq = 0;
function wid(): string {
  seq = (seq + 1) & 0xffff;
  return `wall_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export const useWallStore = create<WallState>((set, get) => ({
  walls: {},
  selectedWallId: null,
  drawSession: null,
  showWallsGlobal: true,
  wallOpacity: 0.35,

  addWall: (start, end, type = 'interior', floorY = 0) => {
    const id = wid();
    const meta = WALL_TYPE_META[type];
    const wall: Wall = {
      id,
      start,
      end,
      type,
      thickness: meta.defaultThicknessFt,
      height: meta.defaultHeightFt,
      floorY,
    };
    set((s) => ({ walls: { ...s.walls, [id]: wall } }));
    return id;
  },

  updateWall: (id, patch) => {
    set((s) => {
      const w = s.walls[id];
      if (!w) return s;
      return { walls: { ...s.walls, [id]: { ...w, ...patch } } };
    });
  },

  removeWall: (id) => {
    set((s) => {
      const copy = { ...s.walls };
      delete copy[id];
      return {
        walls: copy,
        selectedWallId: s.selectedWallId === id ? null : s.selectedWallId,
      };
    });
  },

  selectWall: (id) => set({ selectedWallId: id }),

  beginWallDraw: (type, chain = true) => {
    set({ drawSession: { type, firstPoint: null, previewEnd: null, chain } });
  },

  placeWallPoint: (pt, floorY) => {
    const sess = get().drawSession;
    if (!sess) return;
    if (!sess.firstPoint) {
      set({ drawSession: { ...sess, firstPoint: pt } });
      return;
    }
    // Second click → commit segment
    const id = get().addWall(sess.firstPoint, pt, sess.type, floorY);
    void id;
    if (sess.chain) {
      // Continue chain — new first point = just-placed end
      set({ drawSession: { ...sess, firstPoint: pt, previewEnd: null } });
    } else {
      set({ drawSession: null });
    }
  },

  setWallPreview: (pt) => {
    const sess = get().drawSession;
    if (!sess) return;
    set({ drawSession: { ...sess, previewEnd: pt } });
  },

  cancelWallDraw: () => set({ drawSession: null }),

  toggleShowWalls: () => set((s) => ({ showWallsGlobal: !s.showWallsGlobal })),
  setWallOpacity: (opacity) => set({ wallOpacity: Math.max(0, Math.min(1, opacity)) }),
}));

// ── Snap helpers ───────────────────────────────────────────────

/**
 * Given a point [x, z], returns the nearest wall edge point within
 * snapRadiusFt, or null if none.
 */
export function snapPointToWall(
  p: [number, number],
  snapRadiusFt = 0.5,
): { wallId: string; point: [number, number]; distance: number } | null {
  const walls = Object.values(useWallStore.getState().walls);
  let best: { wallId: string; point: [number, number]; distance: number } | null = null;
  for (const w of walls) {
    if (w.hidden) continue;
    const pt = closestPointOnSegment(p, w.start, w.end);
    const dx = pt[0] - p[0], dz = pt[1] - p[1];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < snapRadiusFt && (!best || d < best.distance)) {
      best = { wallId: w.id, point: pt, distance: d };
    }
  }
  return best;
}

function closestPointOnSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): [number, number] {
  const ax = a[0], az = a[1];
  const dx = b[0] - ax, dz = b[1] - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) return a;
  let t = ((p[0] - ax) * dx + (p[1] - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return [ax + t * dx, az + t * dz];
}
