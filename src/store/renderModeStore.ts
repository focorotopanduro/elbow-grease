/**
 * renderModeStore — Sims-style wall-visibility mode.
 *
 * Three modes map directly to The Sims' "Walls Up / Walls Down /
 * Cutaway" toggle, which is the established UX idiom for "let me see
 * inside this building without the camera getting trapped":
 *
 *   walls-up   — default. Every wall rendered at its configured
 *                opacity. Full spatial context, but the camera can
 *                clip into walls in tight interiors.
 *
 *   walls-down — global dim. Every wall drops to a low baseline
 *                opacity (~8%). Preserves structural footprint so the
 *                user still sees where walls ARE, while getting an
 *                unobstructed top-down view of what's inside.
 *
 *   cutaway    — algorithmic dim. A wall is dimmed only when it's
 *                between the camera and the current focus point;
 *                walls behind/around the focus stay opaque.
 *                Implementation lives in @core/walls/cutawayAlgorithm.
 *
 * Persistence:
 *   localStorage, so the user's preferred mode survives reload. Single
 *   small boolean-plus-enum state — no quota concern.
 */

import { create } from 'zustand';

export type RenderMode = 'walls-up' | 'walls-down' | 'cutaway';

const STORAGE_KEY = 'elbow-grease-render-mode';

/** Cycle order used by the "Shift+W" hotkey. */
const MODE_CYCLE: RenderMode[] = ['walls-up', 'walls-down', 'cutaway'];

export interface RenderModeState {
  mode: RenderMode;
  setMode: (m: RenderMode) => void;
  cycle: () => void;
}

function loadMode(): RenderMode {
  if (typeof window === 'undefined') return 'walls-up';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'walls-up' || raw === 'walls-down' || raw === 'cutaway') return raw;
  } catch { /* ignore */ }
  return 'walls-up';
}

function persist(mode: RenderMode): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
}

export const useRenderModeStore = create<RenderModeState>((set, get) => ({
  mode: loadMode(),

  setMode: (m) => {
    set({ mode: m });
    persist(m);
  },

  cycle: () => {
    const current = get().mode;
    const idx = MODE_CYCLE.indexOf(current);
    const next = MODE_CYCLE[(idx + 1) % MODE_CYCLE.length]!;
    set({ mode: next });
    persist(next);
  },
}));

// ── Constants exported for tests + the HUD ───────────────────

export const RENDER_MODE_LABELS: Record<RenderMode, string> = {
  'walls-up':   'Walls Up',
  'walls-down': 'Walls Down',
  'cutaway':    'Cutaway',
};

/**
 * Baseline opacity multiplier per mode. WallRenderer multiplies its
 * own opacity setting by this factor. `cutaway` uses 1.0 as the
 * baseline because individual walls are dimmed per-instance by the
 * algorithm — the mode itself doesn't globally dim.
 */
export const RENDER_MODE_OPACITY: Record<RenderMode, number> = {
  'walls-up':   1.0,
  'walls-down': 0.08,
  'cutaway':    1.0,
};

export const __testables = {
  STORAGE_KEY,
  MODE_CYCLE,
};
