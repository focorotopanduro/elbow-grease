/**
 * roofingEstimateScopeStore — Phase 14.R.6.
 *
 * Which drawn-sections feed the RoofingInspector's live FL estimate:
 *
 *   'selected' — only the section currently highlighted in the
 *                SectionsPanel (R.4 behavior). Good for spot-checking
 *                one roof piece.
 *
 *   'all'      — every section on the canvas, aggregated into a
 *                single BOM (R.6). Good for whole-house quotes.
 *
 * Persisted to localStorage so the contractor's preference sticks
 * across launches. Mirrors the same key pattern as the other
 * roofing stores.
 */

import { create } from 'zustand';

export type EstimateScope = 'selected' | 'all';

const STORAGE_KEY = 'elbow-grease-roofing-estimate-scope';

export interface EstimateScopeState {
  scope: EstimateScope;
  setScope: (s: EstimateScope) => void;
  toggle: () => void;
}

function loadScope(): EstimateScope {
  if (typeof window === 'undefined') return 'all';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'selected' || raw === 'all') return raw;
  } catch { /* ignore */ }
  // Default to 'all' — most contractors want whole-roof totals on
  // the first glance; power-users flip to 'selected' for spot checks.
  return 'all';
}

function persist(scope: EstimateScope): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, scope); } catch { /* ignore */ }
}

export const useRoofingEstimateScopeStore = create<EstimateScopeState>((set, get) => ({
  scope: loadScope(),

  setScope: (s) => {
    set({ scope: s });
    persist(s);
  },

  toggle: () => {
    const next: EstimateScope = get().scope === 'all' ? 'selected' : 'all';
    set({ scope: next });
    persist(next);
  },
}));

export const __testables = { STORAGE_KEY };
