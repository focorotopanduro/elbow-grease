/**
 * multiSelectStore — Phase 14.I
 *
 * Unifying selection layer that spans pipes + fixtures. Layers on
 * top of the existing single-select stores (`pipeStore.selectedId`
 * and `fixtureStore.selectedFixtureId`) — when the user Shift+clicks
 * to build up a selection, items accumulate here; bare clicks still
 * route through the single-select stores for backward compat.
 *
 * Design contract:
 *   • Empty  — single-select stores are authoritative. Renderers
 *              behave exactly as pre-14.I.
 *   • ≥ 1    — this store is authoritative. Any item in either this
 *              store OR the single-select stores renders as selected.
 *              Bulk ops (delete, save-selection-as-template, etc.)
 *              consume from this store.
 *
 * Shapes + rationale:
 *   - Kept as `Record<string, true>` (not `Set<string>`) because
 *     Zustand's immutability uses shallow object equality; Sets don't
 *     play nicely with React's StrictMode + devtools.
 *   - Separate pipe/fixture maps so callers can ask "all selected
 *     pipes" without filtering a union.
 */

import { create } from 'zustand';

interface MultiSelectState {
  pipeIds: Record<string, true>;
  fixtureIds: Record<string, true>;

  // ── Set / toggle ─────────────────────────────────────
  /** Add a pipe to the selection. No-op if already present. */
  addPipe: (id: string) => void;
  /** Add a fixture to the selection. No-op if already present. */
  addFixture: (id: string) => void;
  /** Remove a pipe. No-op if absent. */
  removePipe: (id: string) => void;
  /** Remove a fixture. No-op if absent. */
  removeFixture: (id: string) => void;
  /** Flip a pipe's membership. */
  togglePipe: (id: string) => void;
  /** Flip a fixture's membership. */
  toggleFixture: (id: string) => void;

  // ── Bulk ─────────────────────────────────────────────
  /** Clear EVERYTHING (both pipes + fixtures). */
  clear: () => void;
  /** Replace the selection with the given ids. */
  setSelection: (pipeIds: readonly string[], fixtureIds: readonly string[]) => void;
  /** Add the given ids to the existing selection. */
  addMany: (pipeIds: readonly string[], fixtureIds: readonly string[]) => void;

  // ── Queries ──────────────────────────────────────────
  isPipeSelected: (id: string) => boolean;
  isFixtureSelected: (id: string) => boolean;
  /** Total count (pipes + fixtures). */
  count: () => number;
  /** True when nothing is selected. */
  isEmpty: () => boolean;
  /** Ordered array of selected pipe ids. */
  selectedPipeIds: () => string[];
  /** Ordered array of selected fixture ids. */
  selectedFixtureIds: () => string[];
}

export const useMultiSelectStore = create<MultiSelectState>((set, get) => ({
  pipeIds: {},
  fixtureIds: {},

  addPipe: (id) => {
    const existing = get().pipeIds;
    if (existing[id]) return;
    set({ pipeIds: { ...existing, [id]: true } });
  },
  addFixture: (id) => {
    const existing = get().fixtureIds;
    if (existing[id]) return;
    set({ fixtureIds: { ...existing, [id]: true } });
  },

  removePipe: (id) => {
    const existing = get().pipeIds;
    if (!existing[id]) return;
    const { [id]: _, ...rest } = existing;
    set({ pipeIds: rest });
  },
  removeFixture: (id) => {
    const existing = get().fixtureIds;
    if (!existing[id]) return;
    const { [id]: _, ...rest } = existing;
    set({ fixtureIds: rest });
  },

  togglePipe: (id) => {
    const existing = get().pipeIds;
    if (existing[id]) {
      const { [id]: _, ...rest } = existing;
      set({ pipeIds: rest });
    } else {
      set({ pipeIds: { ...existing, [id]: true } });
    }
  },
  toggleFixture: (id) => {
    const existing = get().fixtureIds;
    if (existing[id]) {
      const { [id]: _, ...rest } = existing;
      set({ fixtureIds: rest });
    } else {
      set({ fixtureIds: { ...existing, [id]: true } });
    }
  },

  clear: () => set({ pipeIds: {}, fixtureIds: {} }),

  setSelection: (pipeIds, fixtureIds) => {
    const pipeMap: Record<string, true> = {};
    for (const id of pipeIds) pipeMap[id] = true;
    const fixtureMap: Record<string, true> = {};
    for (const id of fixtureIds) fixtureMap[id] = true;
    set({ pipeIds: pipeMap, fixtureIds: fixtureMap });
  },

  addMany: (pipeIds, fixtureIds) => {
    const pipeMap = { ...get().pipeIds };
    for (const id of pipeIds) pipeMap[id] = true;
    const fixtureMap = { ...get().fixtureIds };
    for (const id of fixtureIds) fixtureMap[id] = true;
    set({ pipeIds: pipeMap, fixtureIds: fixtureMap });
  },

  isPipeSelected: (id) => get().pipeIds[id] === true,
  isFixtureSelected: (id) => get().fixtureIds[id] === true,
  count: () => Object.keys(get().pipeIds).length + Object.keys(get().fixtureIds).length,
  isEmpty: () => Object.keys(get().pipeIds).length === 0
              && Object.keys(get().fixtureIds).length === 0,
  selectedPipeIds: () => Object.keys(get().pipeIds),
  selectedFixtureIds: () => Object.keys(get().fixtureIds),
}));
