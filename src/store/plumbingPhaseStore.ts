/**
 * plumbingPhaseStore — plumbing construction phase filter and
 * per-item overrides.
 *
 * Renamed from `phaseStore` in Phase 6b of the hybrid-architecture
 * refactor (ARCHITECTURE.md §7.8). The "phases" modelled here are
 * rough-in / top-out / trim-out — strictly plumbing construction
 * stages. Roofing has different phases (tear-off / dry-in /
 * shingle / finish) and will get its own `roofingPhaseStore` when
 * needed (§4.7 — "After renaming to plumbingPhaseStore, the
 * selector no-ops when appMode === 'roofing'").
 *
 * Tracks:
 *   - activePhase          Which phase the user is currently focused on
 *   - visibilityMode       'single' / 'cumulative' / 'all'
 *   - pipeOverrides        Map<pipeId, ConstructionPhase> — manual
 *                          override for objects the classifier got wrong
 *   - fixtureOverrides     Same for fixtures
 *   - tintByPhase          Whether to tint pipe colors by their phase
 *                          (useful for at-a-glance phase identification)
 *
 * The phaseFor(id, auto) helper returns the effective phase taking
 * overrides into account.
 */

import { create } from 'zustand';
import type { ConstructionPhase, PhaseVisibilityMode } from '@core/phases/PhaseTypes';

interface PhaseState {
  activePhase: ConstructionPhase;
  visibilityMode: PhaseVisibilityMode;
  pipeOverrides: Record<string, ConstructionPhase>;
  fixtureOverrides: Record<string, ConstructionPhase>;
  tintByPhase: boolean;
  /** Show phase color accent ring on fixtures. */
  showPhaseHalo: boolean;
  /** Last switch timestamp — used for UI fade animations. */
  lastSwitchTs: number;

  setActivePhase: (phase: ConstructionPhase) => void;
  setVisibilityMode: (mode: PhaseVisibilityMode) => void;
  cycleVisibilityMode: () => void;

  setPipeOverride: (pipeId: string, phase: ConstructionPhase | null) => void;
  setFixtureOverride: (fixtureId: string, phase: ConstructionPhase | null) => void;
  clearAllOverrides: () => void;

  phaseForPipe: (pipeId: string, autoDetected: ConstructionPhase) => ConstructionPhase;
  phaseForFixture: (fixtureId: string, autoDetected: ConstructionPhase) => ConstructionPhase;

  toggleTint: () => void;
  toggleHalo: () => void;
}

export const usePlumbingPhaseStore = create<PhaseState>((set, get) => ({
  activePhase: 'rough_in',
  visibilityMode: 'all',
  pipeOverrides: {},
  fixtureOverrides: {},
  tintByPhase: false,
  showPhaseHalo: true,
  lastSwitchTs: 0,

  setActivePhase: (phase) => set({ activePhase: phase, lastSwitchTs: performance.now() }),
  setVisibilityMode: (mode) => set({ visibilityMode: mode }),

  cycleVisibilityMode: () => {
    const modes: PhaseVisibilityMode[] = ['all', 'single', 'cumulative'];
    const current = get().visibilityMode;
    const next = modes[(modes.indexOf(current) + 1) % modes.length]!;
    set({ visibilityMode: next, lastSwitchTs: performance.now() });
  },

  setPipeOverride: (pipeId, phase) => {
    set((s) => {
      const copy = { ...s.pipeOverrides };
      if (phase === null) delete copy[pipeId];
      else copy[pipeId] = phase;
      return { pipeOverrides: copy };
    });
  },

  setFixtureOverride: (fixtureId, phase) => {
    set((s) => {
      const copy = { ...s.fixtureOverrides };
      if (phase === null) delete copy[fixtureId];
      else copy[fixtureId] = phase;
      return { fixtureOverrides: copy };
    });
  },

  clearAllOverrides: () => set({ pipeOverrides: {}, fixtureOverrides: {} }),

  phaseForPipe: (pipeId, autoDetected) => {
    return get().pipeOverrides[pipeId] ?? autoDetected;
  },

  phaseForFixture: (fixtureId, autoDetected) => {
    return get().fixtureOverrides[fixtureId] ?? autoDetected;
  },

  toggleTint: () => set((s) => ({ tintByPhase: !s.tintByPhase })),
  toggleHalo: () => set((s) => ({ showPhaseHalo: !s.showPhaseHalo })),
}));

// ── Reactive hook helper ───────────────────────────────────────

import { useMemo } from 'react';

/**
 * Returns a memoized filter object whose identity is stable unless one
 * of its primitive dependencies actually changes. Callers can safely
 * pass the returned value into other hooks' dep arrays.
 *
 * Earlier versions built a fresh object literal on every call, which
 * defeated downstream useMemo/useCallback cache keys and caused the
 * scene to rebuild geometry on every render — producing visible
 * fixture glitching during wheel interactions.
 */
export function usePhaseFilter(): {
  activePhase: ConstructionPhase;
  mode: PhaseVisibilityMode;
  pipeOverride: (id: string) => ConstructionPhase | undefined;
  fixtureOverride: (id: string) => ConstructionPhase | undefined;
  tintByPhase: boolean;
} {
  const activePhase = usePlumbingPhaseStore((s) => s.activePhase);
  const mode = usePlumbingPhaseStore((s) => s.visibilityMode);
  const pipeOverrides = usePlumbingPhaseStore((s) => s.pipeOverrides);
  const fixtureOverrides = usePlumbingPhaseStore((s) => s.fixtureOverrides);
  const tintByPhase = usePlumbingPhaseStore((s) => s.tintByPhase);

  return useMemo(
    () => ({
      activePhase,
      mode,
      pipeOverride: (id: string) => pipeOverrides[id],
      fixtureOverride: (id: string) => fixtureOverrides[id],
      tintByPhase,
    }),
    [activePhase, mode, pipeOverrides, fixtureOverrides, tintByPhase],
  );
}
