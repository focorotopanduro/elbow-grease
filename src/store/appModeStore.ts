/**
 * appModeStore — Phase 14.R.3.
 *
 * Top-level mode switch between Plumbing (original ELBOW GREASE
 * tool) and Roofing (AROYH + fl_roofing estimators). The two modes
 * share the same 3D canvas, viewport, camera, and keyboard but
 * surface completely different inspector panels + toolbars.
 *
 * Mode changes persist to localStorage so the user's last-used
 * workspace reopens on next launch.
 *
 * Why a dedicated store (not a field on `plumbingDrawStore`):
 *   - `plumbingDrawStore` is pipe-specific — its `mode: 'draw'` etc.
 *     are plumbing draw-tool states. Conflating "which workspace"
 *     with "which drawing tool" would make the plumbing-specific
 *     states leak into the roofing world.
 *   - Persisting a single enum is a 20-LOC file that doesn't need
 *     to know about pipes OR roofs — any future third mode (HVAC,
 *     framing) can slot in without touching drawing internals.
 *
 * Mirrors the `renderModeStore.ts` pattern for consistency.
 */

import { create } from 'zustand';

export type AppMode = 'plumbing' | 'roofing';

const STORAGE_KEY = 'elbow-grease-app-mode';

const MODE_CYCLE: AppMode[] = ['plumbing', 'roofing'];

export interface AppModeState {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  /** Toggle to the "other" mode. Same semantics as the Shift+M
   *  hotkey binding in App.tsx. */
  toggle: () => void;
}

function loadMode(): AppMode {
  if (typeof window === 'undefined') return 'plumbing';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'plumbing' || raw === 'roofing') return raw;
  } catch { /* ignore */ }
  return 'plumbing';
}

function persist(mode: AppMode): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
}

export const useAppModeStore = create<AppModeState>((set, get) => ({
  mode: loadMode(),

  setMode: (m) => {
    set({ mode: m });
    persist(m);
  },

  toggle: () => {
    const current = get().mode;
    const idx = MODE_CYCLE.indexOf(current);
    const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length]!;
    set({ mode: next });
    persist(next);
  },
}));

// ── Exported metadata ───────────────────────────────────────────

export const APP_MODE_LABELS: Record<AppMode, string> = {
  plumbing: 'Plumbing',
  roofing: 'Roofing',
};

export const APP_MODE_ICONS: Record<AppMode, string> = {
  plumbing: '🔧',
  roofing: '🏠',
};

export const APP_MODE_ACCENTS: Record<AppMode, string> = {
  plumbing: '#00e5ff', // cyan — matches existing plumbing accents
  roofing: '#ff9800',  // orange — maps to "warm / exterior / roof"
};

/**
 * Accent for "shared chrome" — panels that appear in BOTH workspaces
 * but aren't part of the trade-specific toolchain (camera HUD, floor
 * selector, view-mode toggle, visibility controls).
 *
 * Plumbing mode uses cyan (matches `APP_MODE_ACCENTS.plumbing`) —
 * shared chrome is indistinguishable from primary chrome, by design.
 * Roofing mode uses AMBER instead of orange so the eye reads a
 * hierarchy:
 *   ORANGE = roofing-specific (toolbar, inspector, stripe)
 *   AMBER  = meta-panels (camera, floors, view mode) visible in
 *            roofing mode but not carrying roofing domain meaning.
 *
 * Amber (#ffd54f, Material Design amber 300) is warm — pairs
 * visually with the roofing orange — but distinct enough that a
 * glance at the amber panel immediately registers "utility chrome"
 * rather than "another roofing tool".
 */
export const SHARED_CHROME_ACCENTS: Record<AppMode, string> = {
  plumbing: '#00e5ff', // cyan — same as primary (plumbing is monochrome)
  roofing: '#ffd54f',  // amber — distinct from the orange primary
};

export const __testables = {
  STORAGE_KEY,
  MODE_CYCLE,
};
