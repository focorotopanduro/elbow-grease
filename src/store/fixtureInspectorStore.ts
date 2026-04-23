/**
 * fixtureInspectorStore — Phase 14.F
 *
 * Selects which inspector surface renders when a fixture is selected:
 *
 *   'mini'   — compact bottom-right card, stays out of the way.
 *              Default mode; lets the user keep drawing pipes.
 *   'detail' — full parameter editor (Phase 10.C FixtureParamWindow).
 *              Opened on demand via the mini card's Expand button.
 *
 * Orthogonal to `fixtureStore.selectedFixtureId` (which tracks WHICH
 * fixture is inspected). This store tracks HOW it's inspected.
 *
 * Persists to localStorage so returning users keep their preferred
 * default mode across sessions.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'elbow-grease-fixture-inspector-mode';

export type InspectorMode = 'mini' | 'detail';

interface InspectorState {
  mode: InspectorMode;
  setMode: (m: InspectorMode) => void;
  toggle: () => void;
}

function loadMode(): InspectorMode {
  if (typeof window === 'undefined') return 'mini';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'detail' || raw === 'mini') return raw;
  } catch { /* quota / SSR */ }
  return 'mini';
}

function saveMode(m: InspectorMode): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, m); } catch { /* quota */ }
}

export const useFixtureInspectorStore = create<InspectorState>((set, get) => ({
  mode: loadMode(),
  setMode: (mode) => {
    saveMode(mode);
    set({ mode });
  },
  toggle: () => {
    const next: InspectorMode = get().mode === 'mini' ? 'detail' : 'mini';
    saveMode(next);
    set({ mode: next });
  },
}));
