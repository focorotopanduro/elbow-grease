/**
 * FloorStore — multi-story building state.
 *
 * Real buildings have multiple floors. When drafting, users want to
 * focus on one floor at a time without losing spatial context of
 * the others. This store tracks:
 *
 *   - Defined floors (name, elevation range, thickness)
 *   - Active floor (the one currently being edited)
 *   - Visibility mode: "solo" (hide others), "ghost" (show others dim)
 *
 * Pipes and fixtures are assigned to a floor based on their Y
 * coordinate. The PipeRenderer queries this store to apply visibility
 * and opacity overrides on non-active floors.
 *
 * The plumbingLayerStore handles system-level visibility (waste/vent/supply)
 * while this store handles elevation-level visibility (by floor).
 * The two are orthogonal — you can show ONLY waste pipes on floor 2.
 */

import { create } from 'zustand';

// ── Types ───────────────────────────────────────────────────────

export type FloorVisibilityMode = 'all' | 'active_only' | 'ghost';

export interface Floor {
  id: string;
  name: string;
  /** Lower Y bound in feet (floor level). */
  elevationBase: number;
  /** Upper Y bound in feet (ceiling level). */
  elevationTop: number;
  /** Display color accent. */
  color: string;
  /** Icon (emoji). */
  icon: string;
  /** Order (lower = below). */
  order: number;
}

// ── Standard floors ─────────────────────────────────────────────

const STANDARD_FLOORS: Floor[] = [
  { id: 'basement', name: 'Basement',   elevationBase: -10, elevationTop: -1, color: '#5d4037', icon: '🏚️', order: 0 },
  { id: 'slab',     name: 'Slab',       elevationBase: -1,  elevationTop: 0,  color: '#8d6e63', icon: '🟫', order: 1 },
  { id: 'floor_1',  name: '1st Floor',  elevationBase: 0,   elevationTop: 9,  color: '#00e5ff', icon: '🏠', order: 2 },
  { id: 'floor_2',  name: '2nd Floor',  elevationBase: 9,   elevationTop: 18, color: '#ffc107', icon: '🏢', order: 3 },
  { id: 'floor_3',  name: '3rd Floor',  elevationBase: 18,  elevationTop: 27, color: '#ef5350', icon: '🏢', order: 4 },
  { id: 'attic',    name: 'Attic',      elevationBase: 27,  elevationTop: 35, color: '#78909c', icon: '🔺', order: 5 },
];

// ── Store state ─────────────────────────────────────────────────

interface FloorState {
  floors: Record<string, Floor>;
  activeFloorId: string;
  visibilityMode: FloorVisibilityMode;
  /** Ghost opacity when in ghost mode (0-1). */
  ghostOpacity: number;
  /** Color when greyed-out in ghost mode. */
  ghostColor: string;
  /** Timestamp of last floor switch (for fade animations). */
  lastSwitchTs: number;
  /** Visible floor-plane outlines at each floor's base elevation. */
  showFloorPlanes: boolean;
  /** If true, drawing auto-snaps Y to active floor's base. */
  constrainDrawToActiveFloor: boolean;
  /** Per-floor hidden overrides (individual hide toggles). */
  hiddenFloorIds: Set<string>;

  setActiveFloor: (id: string) => void;
  setVisibilityMode: (mode: FloorVisibilityMode) => void;
  cycleVisibilityMode: () => void;
  setGhostOpacity: (opacity: number) => void;
  addFloor: (floor: Floor) => void;
  removeFloor: (id: string) => void;
  getFloorForElevation: (y: number) => Floor | null;
  getFloorsOrdered: () => Floor[];
  isFloorActive: (id: string) => boolean;
  isElevationVisible: (y: number) => boolean;
  isElevationActive: (y: number) => boolean;
  toggleShowFloorPlanes: () => void;
  toggleConstrainDraw: () => void;
  toggleFloorHidden: (id: string) => void;
  isFloorHidden: (id: string) => boolean;
  jumpFloorUp: () => void;
  jumpFloorDown: () => void;
}

export const useFloorStore = create<FloorState>((set, get) => ({
  floors: STANDARD_FLOORS.reduce((acc, f) => {
    acc[f.id] = f;
    return acc;
  }, {} as Record<string, Floor>),
  activeFloorId: 'floor_1',
  // Default to 'all' — a fresh session should show every floor at full
  // opacity. 'ghost' is a great working mode once you have layout on
  // multiple floors, but kicking a new user into 15% opacity gives the
  // impression the scene is broken / the background is gone.
  visibilityMode: 'all',
  // If the user opts into ghost mode, default to a readable 35% rather
  // than the near-invisible 15% that was tripping people up.
  ghostOpacity: 0.35,
  ghostColor: '#444',
  lastSwitchTs: 0,
  showFloorPlanes: true,
  constrainDrawToActiveFloor: false,
  hiddenFloorIds: new Set<string>(),

  setActiveFloor: (id) => {
    if (get().floors[id]) {
      set({ activeFloorId: id, lastSwitchTs: performance.now() });
    }
  },

  setVisibilityMode: (mode) => set({ visibilityMode: mode }),
  setGhostOpacity: (opacity) => set({ ghostOpacity: Math.max(0, Math.min(1, opacity)) }),

  addFloor: (floor) => {
    set((s) => ({ floors: { ...s.floors, [floor.id]: floor } }));
  },

  removeFloor: (id) => {
    set((s) => {
      const copy = { ...s.floors };
      delete copy[id];
      const newActive = s.activeFloorId === id
        ? Object.keys(copy)[0] ?? ''
        : s.activeFloorId;
      return { floors: copy, activeFloorId: newActive };
    });
  },

  getFloorForElevation: (y) => {
    const floors = Object.values(get().floors);
    for (const f of floors) {
      if (y >= f.elevationBase && y < f.elevationTop) return f;
    }
    return null;
  },

  getFloorsOrdered: () => {
    return Object.values(get().floors).sort((a, b) => a.order - b.order);
  },

  isFloorActive: (id) => get().activeFloorId === id,

  isElevationVisible: (y) => {
    const { visibilityMode } = get();
    if (visibilityMode === 'all') return true;
    if (visibilityMode === 'ghost') return true; // still rendered, just dim
    // active_only
    const floor = get().getFloorForElevation(y);
    return floor?.id === get().activeFloorId;
  },

  isElevationActive: (y) => {
    const floor = get().getFloorForElevation(y);
    return floor?.id === get().activeFloorId;
  },

  cycleVisibilityMode: () => {
    const modes: FloorVisibilityMode[] = ['all', 'ghost', 'active_only'];
    const current = get().visibilityMode;
    const idx = modes.indexOf(current);
    const next = modes[(idx + 1) % modes.length]!;
    set({ visibilityMode: next, lastSwitchTs: performance.now() });
  },

  toggleShowFloorPlanes: () => {
    set((s) => ({ showFloorPlanes: !s.showFloorPlanes }));
  },

  toggleConstrainDraw: () => {
    set((s) => ({ constrainDrawToActiveFloor: !s.constrainDrawToActiveFloor }));
  },

  toggleFloorHidden: (id) => {
    set((s) => {
      const next = new Set(s.hiddenFloorIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { hiddenFloorIds: next };
    });
  },

  isFloorHidden: (id) => get().hiddenFloorIds.has(id),

  jumpFloorUp: () => {
    const ordered = get().getFloorsOrdered();
    const currentIdx = ordered.findIndex((f) => f.id === get().activeFloorId);
    if (currentIdx < 0) return;
    const next = ordered[Math.min(ordered.length - 1, currentIdx + 1)];
    if (next) set({ activeFloorId: next.id, lastSwitchTs: performance.now() });
  },

  jumpFloorDown: () => {
    const ordered = get().getFloorsOrdered();
    const currentIdx = ordered.findIndex((f) => f.id === get().activeFloorId);
    if (currentIdx < 0) return;
    const next = ordered[Math.max(0, currentIdx - 1)];
    if (next) set({ activeFloorId: next.id, lastSwitchTs: performance.now() });
  },
}));

// ── Visibility calculation for renderers ────────────────────────

/**
 * Get the rendering parameters for an object at a given elevation.
 * The PipeRenderer calls this to decide whether to show the pipe,
 * and if so at what opacity/color.
 */
export interface FloorRenderParams {
  visible: boolean;
  opacity: number;
  /** If set, override material color with this (for greyed-out). */
  colorOverride: string | null;
  /** If true, disable raycast (can't be clicked). */
  disableInteraction: boolean;
}

export function getFloorRenderParams(y: number): FloorRenderParams {
  const state = useFloorStore.getState();
  const { visibilityMode, ghostOpacity, ghostColor } = state;
  const floor = state.getFloorForElevation(y);

  // Per-floor explicit hide overrides visibility mode
  if (floor && state.hiddenFloorIds.has(floor.id)) {
    return { visible: false, opacity: 0, colorOverride: null, disableInteraction: true };
  }

  const active = floor?.id === state.activeFloorId;

  if (active) {
    return {
      visible: true,
      opacity: 1,
      colorOverride: null,
      disableInteraction: false,
    };
  }

  switch (visibilityMode) {
    case 'all':
      return { visible: true, opacity: 1, colorOverride: null, disableInteraction: false };
    case 'ghost':
      return {
        visible: true,
        opacity: ghostOpacity,
        colorOverride: ghostColor,
        disableInteraction: true,
      };
    case 'active_only':
      return { visible: false, opacity: 0, colorOverride: null, disableInteraction: true };
  }
}

/**
 * Pipe-level render params that handle pipes spanning multiple floors.
 *   - Fully on active floor   → full bright
 *   - Spans active floor + another → partial ghost (70% opacity, no color override)
 *   - Entirely off active floor → normal ghost rules
 *   - Any floor hidden via individual toggle → not visible
 */
export function getPipeFloorParams(pipeYMin: number, pipeYMax: number): FloorRenderParams {
  const state = useFloorStore.getState();
  const { visibilityMode, ghostOpacity, ghostColor, activeFloorId, floors, hiddenFloorIds } = state;

  const active = floors[activeFloorId];
  if (!active) {
    return { visible: true, opacity: 1, colorOverride: null, disableInteraction: false };
  }

  // Is the active floor hidden by toggle?
  if (hiddenFloorIds.has(activeFloorId)) {
    return { visible: false, opacity: 0, colorOverride: null, disableInteraction: true };
  }

  // Determine membership with active floor
  const overlapsActive = !(pipeYMax < active.elevationBase || pipeYMin > active.elevationTop);
  const pipeSpansMultiple = Object.values(floors).filter(
    (f) => !(pipeYMax < f.elevationBase || pipeYMin > f.elevationTop),
  ).length > 1;

  // Any intersected floor hidden? → hide pipe
  for (const f of Object.values(floors)) {
    const intersects = !(pipeYMax < f.elevationBase || pipeYMin > f.elevationTop);
    if (intersects && hiddenFloorIds.has(f.id)) {
      return { visible: false, opacity: 0, colorOverride: null, disableInteraction: true };
    }
  }

  if (overlapsActive) {
    // Pipe is on the active floor
    if (pipeSpansMultiple) {
      // Riser passing through — slightly faded to hint it extends beyond this floor
      return {
        visible: true,
        opacity: 0.82,
        colorOverride: null,
        disableInteraction: false,
      };
    }
    return { visible: true, opacity: 1, colorOverride: null, disableInteraction: false };
  }

  // Pipe is NOT on the active floor — apply visibility mode
  switch (visibilityMode) {
    case 'all':
      return { visible: true, opacity: 1, colorOverride: null, disableInteraction: false };
    case 'ghost':
      return {
        visible: true,
        opacity: ghostOpacity,
        colorOverride: ghostColor,
        disableInteraction: true,
      };
    case 'active_only':
      return { visible: false, opacity: 0, colorOverride: null, disableInteraction: true };
  }
}

// ── Reactive hook for React components ─────────────────────────

import { useSyncExternalStore } from 'react';

/**
 * Hook that re-renders the component whenever floor state changes.
 * Returns the `getPipeFloorParams` function bound to current state.
 */
export function useFloorParams(): (yMin: number, yMax: number) => FloorRenderParams {
  // Subscribe to floor store's relevant fields
  useFloorStore(
    (s) =>
      s.activeFloorId + '|' + s.visibilityMode + '|' + s.ghostOpacity
      + '|' + [...s.hiddenFloorIds].sort().join(','),
  );
  return getPipeFloorParams;
}
