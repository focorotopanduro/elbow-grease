/**
 * RadialMenuStore — Zustand store governing all radial wheel state.
 *
 * Responsibilities:
 *   - Track which wheel is active (if any)
 *   - Per-sector selection history for each wheel
 *   - Subtype cycling via mouse scroll within a sector
 *   - Wheel stack for nested navigation (sub-wheels)
 *   - Breadcrumb trail showing navigation path
 *   - Cursor angle tracking for live sector highlighting
 *
 * The store is independent of any specific wheel's content — content
 * lives in the wheel config files (src/ui/radial/wheels/*). This store
 * just tracks "which wheel is open and what's selected."
 */

import { create } from 'zustand';

// ── Types ───────────────────────────────────────────────────────

export type WheelId = 'drawing' | 'fixture' | 'customer' | 'customer_edit' | string;

/** A single sector selection (e.g. "left" sector with subtype index 2). */
export interface SectorSelection {
  /** The sector's stable ID (defined in wheel config). */
  sectorId: string;
  /** Index into the sector's subtype list (cycled via scroll). */
  subtypeIndex: number;
  /** When this selection was made (timestamp). */
  selectedAt: number;
}

/** Per-wheel memory: remembers last selected sector + subtypes. */
export interface WheelMemory {
  lastSectorId: string | null;
  /** Subtype index per sector: { "left": 2, "top": 0, ... } */
  subtypeBySector: Record<string, number>;
  /** Ordered history of selections from this wheel. */
  history: SectorSelection[];
  /** User-pinned favorites (sector IDs). */
  favorites: string[];
}

/** A cursor position sample (for trail rendering + gesture analysis). */
export interface TrailSample {
  x: number; // screen pixel X relative to wheel center
  y: number; // screen pixel Y relative to wheel center
  t: number; // timestamp (performance.now)
}

// ── State ───────────────────────────────────────────────────────

interface RadialState {
  /** Currently visible wheel, null = no wheel open. */
  activeWheelId: WheelId | null;
  /** Wheel stack for nested navigation (top = current). */
  wheelStack: WheelId[];
  /**
   * Screen-space pixel origin the wheel expands from. null means center
   * of screen (the default chord-opened behavior). Set by openWheelAt
   * when the user clicks a corner icon — gives an "unfolding" feel.
   */
  wheelOrigin: { x: number; y: number } | null;
  /** Closing animation active? */
  closing: boolean;
  /** Current mouse angle relative to wheel center (radians, 0 = east, CCW). */
  cursorAngleRad: number;
  /** Distance from wheel center in pixels (for dead-zone detection). */
  cursorDistance: number;
  /** Currently highlighted sector ID (updated by RadialMenu component). */
  highlightedSectorId: string | null;
  /** Per-wheel memory. */
  memory: Record<WheelId, WheelMemory>;
  /** Scroll direction accumulator for subtype cycling. */
  scrollAccumulator: number;
  /** Wheel entry animation progress (0-1). */
  entryProgress: number;
  /** Whether the backdrop blur is active. */
  backdropActive: boolean;
  /**
   * Marking menu mode: commit on mouse-release instead of click.
   * Power users: flick-and-release for instant selection without
   * waiting for the wheel to render.
   */
  markingMode: boolean;
  /** Cursor trail samples (last N positions for trail rendering). */
  cursorTrail: TrailSample[];
  /** Maximum trail length (older samples are dropped). */
  trailMaxAgeMs: number;
  /** Ripple effect state: timestamp of last click, null if none. */
  lastRippleTs: number | null;
  /** Last committed selection label (shown briefly after close). */
  lastCommittedLabel: string | null;

  // Actions
  openWheel: (id: WheelId) => void;
  openWheelAt: (id: WheelId, originX: number, originY: number) => void;
  closeWheel: () => void;
  pushWheel: (id: WheelId) => void;
  popWheel: () => void;
  setCursor: (angleRad: number, distance: number) => void;
  setHighlighted: (sectorId: string | null) => void;
  selectSector: (sectorId: string, commitLabel?: string) => void;
  cycleSubtype: (direction: 1 | -1, max: number) => void;
  accumulateScroll: (delta: number) => void;
  setEntryProgress: (p: number) => void;
  getWheelMemory: (id: WheelId) => WheelMemory;
  getSubtypeIndex: (wheelId: WheelId, sectorId: string) => number;
  clearHistory: (wheelId?: WheelId) => void;
  toggleFavorite: (sectorId: string) => void;
  isFavorite: (sectorId: string) => boolean;
  getRecents: (wheelId: WheelId, limit?: number) => SectorSelection[];
  setMarkingMode: (on: boolean) => void;
  addTrailSample: (x: number, y: number) => void;
  clearTrail: () => void;
  triggerRipple: () => void;
}

// ── Defaults ────────────────────────────────────────────────────

function blankMemory(): WheelMemory {
  return {
    lastSectorId: null,
    subtypeBySector: {},
    history: [],
    favorites: [],
  };
}

// ── Store ───────────────────────────────────────────────────────

export const useRadialMenuStore = create<RadialState>((set, get) => ({
  activeWheelId: null,
  wheelStack: [],
  wheelOrigin: null,
  closing: false,
  cursorAngleRad: 0,
  cursorDistance: 0,
  highlightedSectorId: null,
  memory: {},
  scrollAccumulator: 0,
  entryProgress: 0,
  backdropActive: false,
  markingMode: false,
  cursorTrail: [],
  trailMaxAgeMs: 220,
  lastRippleTs: null,
  lastCommittedLabel: null,

  openWheel: (id) => {
    set({
      activeWheelId: id,
      wheelStack: [id],
      wheelOrigin: null,
      closing: false,
      backdropActive: true,
      entryProgress: 0,
      highlightedSectorId: null,
      scrollAccumulator: 0,
      cursorTrail: [],
      lastRippleTs: null,
      lastCommittedLabel: null,
    });
    // Animate in
    requestAnimationFrame(() => set({ entryProgress: 1 }));
  },

  openWheelAt: (id, originX, originY) => {
    set({
      activeWheelId: id,
      wheelStack: [id],
      wheelOrigin: { x: originX, y: originY },
      closing: false,
      backdropActive: true,
      entryProgress: 0,
      highlightedSectorId: null,
      scrollAccumulator: 0,
      cursorTrail: [],
      lastRippleTs: null,
      lastCommittedLabel: null,
    });
    requestAnimationFrame(() => set({ entryProgress: 1 }));
  },

  closeWheel: () => {
    // Two-phase close: play reverse animation then clear state.
    // 120ms matches the open transition for balanced in/out feel.
    set({ closing: true, entryProgress: 0 });
    setTimeout(() => {
      set({
        activeWheelId: null,
        wheelStack: [],
        wheelOrigin: null,
        closing: false,
        backdropActive: false,
        entryProgress: 0,
        highlightedSectorId: null,
        cursorTrail: [],
      });
    }, 80);
  },

  pushWheel: (id) => {
    set((s) => ({
      activeWheelId: id,
      wheelStack: [...s.wheelStack, id],
      entryProgress: 0,
      highlightedSectorId: null,
    }));
    requestAnimationFrame(() => set({ entryProgress: 1 }));
  },

  popWheel: () => {
    set((s) => {
      const newStack = s.wheelStack.slice(0, -1);
      const top = newStack[newStack.length - 1] ?? null;
      return {
        wheelStack: newStack,
        activeWheelId: top,
        backdropActive: top !== null,
        entryProgress: 1,
        highlightedSectorId: null,
      };
    });
  },

  setCursor: (angleRad, distance) => {
    set({ cursorAngleRad: angleRad, cursorDistance: distance });
  },

  setHighlighted: (sectorId) => {
    set({ highlightedSectorId: sectorId });
  },

  selectSector: (sectorId, commitLabel) => {
    const { activeWheelId, memory } = get();
    if (!activeWheelId) return;

    const existing = memory[activeWheelId] ?? blankMemory();

    const subtypeIndex = existing.subtypeBySector[sectorId] ?? 0;
    const selection: SectorSelection = {
      sectorId,
      subtypeIndex,
      selectedAt: Date.now(),
    };

    set((s) => ({
      memory: {
        ...s.memory,
        [activeWheelId]: {
          ...existing,
          lastSectorId: sectorId,
          history: [...existing.history.slice(-19), selection],
        },
      },
      lastCommittedLabel: commitLabel ?? sectorId,
      lastRippleTs: performance.now(),
    }));
  },

  cycleSubtype: (direction, max) => {
    const { activeWheelId, highlightedSectorId, memory } = get();
    if (!activeWheelId || !highlightedSectorId) return;
    if (max <= 0) return;

    const wheel = memory[activeWheelId] ?? blankMemory();
    const current = wheel.subtypeBySector[highlightedSectorId] ?? 0;
    const next = ((current + direction) % max + max) % max;

    set((s) => ({
      memory: {
        ...s.memory,
        [activeWheelId]: {
          ...wheel,
          subtypeBySector: { ...wheel.subtypeBySector, [highlightedSectorId]: next },
        },
      },
    }));
  },

  accumulateScroll: (delta) => {
    set((s) => ({ scrollAccumulator: s.scrollAccumulator + delta }));
  },

  setEntryProgress: (p) => set({ entryProgress: Math.max(0, Math.min(1, p)) }),

  getWheelMemory: (id) => {
    const existing = get().memory[id];
    if (existing) return existing;
    return blankMemory();
  },

  getSubtypeIndex: (wheelId, sectorId) => {
    const wheel = get().memory[wheelId];
    return wheel?.subtypeBySector[sectorId] ?? 0;
  },

  clearHistory: (wheelId) => {
    set((s) => {
      if (!wheelId) return { memory: {} };
      const copy = { ...s.memory };
      delete copy[wheelId];
      return { memory: copy };
    });
  },

  toggleFavorite: (sectorId) => {
    const { activeWheelId, memory } = get();
    if (!activeWheelId) return;
    const existing = memory[activeWheelId] ?? blankMemory();
    const favSet = new Set(existing.favorites);
    if (favSet.has(sectorId)) favSet.delete(sectorId);
    else favSet.add(sectorId);
    set((s) => ({
      memory: {
        ...s.memory,
        [activeWheelId]: { ...existing, favorites: [...favSet] },
      },
    }));
  },

  isFavorite: (sectorId) => {
    const { activeWheelId, memory } = get();
    if (!activeWheelId) return false;
    return memory[activeWheelId]?.favorites?.includes(sectorId) ?? false;
  },

  getRecents: (wheelId, limit = 5) => {
    const wheel = get().memory[wheelId];
    if (!wheel) return [];
    // Dedupe by sectorId, most recent first
    const seen = new Set<string>();
    const out: SectorSelection[] = [];
    for (let i = wheel.history.length - 1; i >= 0 && out.length < limit; i--) {
      const sel = wheel.history[i]!;
      if (seen.has(sel.sectorId)) continue;
      seen.add(sel.sectorId);
      out.push(sel);
    }
    return out;
  },

  setMarkingMode: (on) => set({ markingMode: on }),

  addTrailSample: (x, y) => {
    set((s) => {
      const now = performance.now();
      const newSample: TrailSample = { x, y, t: now };
      // Prune old samples
      const pruned = s.cursorTrail.filter((t) => now - t.t < s.trailMaxAgeMs);
      return { cursorTrail: [...pruned, newSample].slice(-30) };
    });
  },

  clearTrail: () => set({ cursorTrail: [] }),

  triggerRipple: () => set({ lastRippleTs: performance.now() }),
}));

// ── Sector selection math ───────────────────────────────────────

/**
 * Given the cursor angle (radians from east, CCW) and a list of
 * sector definitions, determine which sector the cursor is in.
 *
 * Each sector occupies an angular slice. Sectors are defined by
 * their center angle + half-width. This works for both quadrant
 * wheels (4 sectors) and decagonal wheels (10 sectors).
 */
export function sectorAtAngle(
  angleRad: number,
  sectors: { id: string; centerAngleRad: number; halfWidthRad: number }[],
): string | null {
  const normalized = ((angleRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

  for (const s of sectors) {
    const center = ((s.centerAngleRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    // Minimum angular distance considering wraparound
    const diff = Math.min(
      Math.abs(normalized - center),
      Math.PI * 2 - Math.abs(normalized - center),
    );
    if (diff <= s.halfWidthRad) return s.id;
  }
  return null;
}

/**
 * Build equal-angle sectors for a wheel with N slices, starting at
 * startAngleRad (default: east = 0 rad), going counterclockwise.
 */
export function equalSectors(
  ids: string[],
  startAngleRad: number = 0,
): { id: string; centerAngleRad: number; halfWidthRad: number }[] {
  const n = ids.length;
  const slice = (Math.PI * 2) / n;
  const half = slice / 2;
  return ids.map((id, i) => ({
    id,
    centerAngleRad: startAngleRad + i * slice,
    halfWidthRad: half,
  }));
}
