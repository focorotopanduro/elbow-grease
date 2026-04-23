/**
 * Layer Store — Zustand store for system-level visibility toggles.
 *
 * Controls which plumbing systems are visible in the 3D scene.
 * PipeRenderer, FittingRenderer, FixtureLayer, and DimensionHelpers
 * all read from this store to skip rendering hidden elements.
 *
 * Keyboard shortcuts: W=waste, V=vent, C=cold supply, H=hot supply,
 * T=storm, F=fittings, X=fixtures, D=dimensions, A=show all.
 */

import { create } from 'zustand';
import type { SystemType } from '../engine/graph/GraphNode';

// ── Layer state ─────────────────────────────────────────────────

export interface LayerState {
  /** System type visibility. */
  systems: Record<SystemType, boolean>;
  /** Component-level visibility. */
  fittings: boolean;
  fixtures: boolean;
  dimensions: boolean;
  ghostPreviews: boolean;
  livePreview: boolean;

  // Actions
  toggleSystem: (system: SystemType) => void;
  setSystem: (system: SystemType, visible: boolean) => void;
  soloSystem: (system: SystemType) => void;
  showAllSystems: () => void;
  toggleFittings: () => void;
  toggleFixtures: () => void;
  toggleDimensions: () => void;
  setComponentVisible: (component: 'fittings' | 'fixtures' | 'dimensions' | 'ghostPreviews' | 'livePreview', visible: boolean) => void;
}

// ── System colors (for the layer panel UI) ──────────────────────

export const SYSTEM_COLORS: Record<SystemType, string> = {
  waste:       '#ef5350',
  vent:        '#66bb6a',
  cold_supply: '#29b6f6',
  hot_supply:  '#ff7043',
  storm:       '#78909c',
  // Phase 14.AA.3 — HVAC condensate. Light cyan/purple per
  // industry drafting convention so it reads distinct from
  // potable supply blue and DWV waste colors.
  condensate:  '#9575cd',
};

export const SYSTEM_LABELS: Record<SystemType, string> = {
  waste:       'Waste / DWV',
  vent:        'Vent',
  cold_supply: 'Cold Supply',
  hot_supply:  'Hot Supply',
  storm:       'Storm',
  condensate:  'Condensate',
};

export const SYSTEM_KEYS: Record<string, SystemType> = {
  w: 'waste',
  v: 'vent',
  c: 'cold_supply',
  h: 'hot_supply',
  t: 'storm',
  d: 'condensate',
};

// ── Store ───────────────────────────────────────────────────────

const ALL_SYSTEMS: SystemType[] = ['waste', 'vent', 'cold_supply', 'hot_supply', 'storm', 'condensate'];

export const useLayerStore = create<LayerState>((set) => ({
  systems: {
    waste: true,
    vent: true,
    cold_supply: true,
    hot_supply: true,
    storm: true,
    condensate: true,
  },
  fittings: true,
  fixtures: true,
  dimensions: true,
  ghostPreviews: true,
  livePreview: true,

  toggleSystem: (system) =>
    set((s) => ({
      systems: { ...s.systems, [system]: !s.systems[system] },
    })),

  setSystem: (system, visible) =>
    set((s) => ({
      systems: { ...s.systems, [system]: visible },
    })),

  soloSystem: (system) =>
    set(() => {
      const systems: Record<SystemType, boolean> = {
        waste: false, vent: false, cold_supply: false, hot_supply: false, storm: false, condensate: false,
      };
      systems[system] = true;
      return { systems };
    }),

  showAllSystems: () =>
    set(() => ({
      systems: {
        waste: true, vent: true, cold_supply: true, hot_supply: true, storm: true, condensate: true,
      },
    })),

  toggleFittings: () => set((s) => ({ fittings: !s.fittings })),
  toggleFixtures: () => set((s) => ({ fixtures: !s.fixtures })),
  toggleDimensions: () => set((s) => ({ dimensions: !s.dimensions })),

  setComponentVisible: (component, visible) =>
    set(() => ({ [component]: visible })),
}));

// ── Convenience hook: is a system visible? ──────────────────────

export function useSystemVisible(system: SystemType): boolean {
  return useLayerStore((s) => s.systems[system]);
}
