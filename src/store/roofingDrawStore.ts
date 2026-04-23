/**
 * roofingDrawStore — Phase 14.R.4.
 *
 * Transient interaction state for the roofing CANVAS drawing tools.
 * Kept SEPARATE from `roofStore` (which owns committed sections) and
 * from `appModeStore` (which owns "which workspace is active") so that
 * each layer has a single concern:
 *
 *   roofStore.ts           — persistent roof geometry (sections, undo/redo)
 *   roofingProjectStore.ts — flat FL estimator input (one primary section)
 *   appModeStore.ts        — plumbing vs roofing workspace toggle
 *   roofingDrawStore.ts    — "what is the user currently drawing?"   ← this file
 *
 * Flow:
 *   1. User clicks "Draw Rectangle" in the RoofingToolbar →
 *      `beginDrawRect()`  sets mode='draw-rect'.
 *   2. User clicks on the ground plane catcher →
 *      `setDraftStart(pt)` captures the first corner.
 *   3. useFrame updates the cursor via `setDraftEnd(pt)` (throttled;
 *      only the preview cares, the draft-start persists).
 *   4. User clicks again →
 *      `commitDraft()` writes a RoofSection to `roofStore` and clears draft.
 *   5. Escape / `cancelDraft()` dumps the draft without committing.
 *
 * The store does NOT call into `roofStore` itself — that coupling lives
 * in the UI layer, so the store stays a pure data container and the
 * tests don't have to mock Three.js.
 */

import { create } from 'zustand';
import type { RoofType, SectionType, PenetrationKind } from '@engine/roofing/RoofGraph';

/** Canonical ground-plane coordinate (plan x + plan z, NOT Three.js y). */
export type GroundPoint = readonly [number, number];

/** What the user is currently drawing, if anything.
 *
 *   'idle'             — no active draw session.
 *   'draw-rect'        — two-click rectangle (R.4).
 *   'draw-polygon'     — click-click-click polygon (R.9). Commit on
 *                        Enter, double-click, or click-back-to-start.
 *   'place-penetration'— single-click drops a chimney / skylight /
 *                        plumbing vent at the click point (R.27).
 *                        The specific kind lives in `penetrationKind`
 *                        so the toolbar can swap kind without losing
 *                        the "currently placing" mode.
 */
export type RoofingDrawMode = 'idle' | 'draw-rect' | 'draw-polygon' | 'place-penetration';

export interface RoofingDrawState {
  // ── Tool state ─────────────────────────────────────────
  mode: RoofingDrawMode;
  /** First corner of the rectangle (ground-plane XZ). `null` until
   *  the user places it. */
  draftStart: GroundPoint | null;
  /** Live cursor position while the draft is open. Updated by the
   *  interaction layer's useFrame at 60fps; component subscribers
   *  can selectively re-render. */
  draftEnd: GroundPoint | null;
  /** Phase 14.R.9 — committed polygon vertices for the in-progress
   *  polygon draw. Empty when not in draw-polygon mode. The live
   *  cursor tip is tracked separately via `draftEnd` so the preview
   *  rubber-band works identically for rect + polygon. */
  polygonVertices: ReadonlyArray<GroundPoint>;
  /** Phase 14.R.27 — which penetration kind is armed for placement.
   *  Only meaningful when `mode === 'place-penetration'`. Defaults
   *  to 'plumbing_vent' because vents are the most common
   *  penetration by count in residential re-roofs. */
  penetrationKind: PenetrationKind;

  // ── Defaults for the NEXT section to be committed ──────
  /** Roof type applied on commit. Switchable in the toolbar. */
  defaultRoofType: RoofType;
  /** Section type (used for palette + BOM categorization). */
  defaultSectionType: SectionType;
  /** Slope in "X in 12" — drives rise, actual-area, pressure-zone math. */
  defaultSlope: number;
  /** Overhang in feet — applies around the plan rectangle. */
  defaultOverhang: number;
  /** Elevation of the section's eave in feet above grade — supports
   *  stacked-floor roof compositions (second-story dormer, etc.). */
  defaultElevation: number;

  // ── Actions ────────────────────────────────────────────
  beginDrawRect: () => void;
  /** Phase 14.R.9 — start a polygon draw. Clears previous draft
   *  state (rect AND polygon); the first click becomes vertex 0. */
  beginDrawPolygon: () => void;
  cancelDraft: () => void;
  setDraftStart: (pt: GroundPoint | null) => void;
  setDraftEnd: (pt: GroundPoint | null) => void;
  /** Phase 14.R.9 — append a vertex to the in-progress polygon. */
  addPolygonVertex: (pt: GroundPoint) => void;
  /** Phase 14.R.9 — pop the last polygon vertex (undo last click
   *  without ending the draw session). */
  removeLastPolygonVertex: () => void;
  /** Phase 14.R.27 — arm penetration placement with the given kind.
   *  Calling with the SAME kind while already armed is a no-op so
   *  repeated button clicks don't reset any intermediate state; call
   *  `cancelDraft` to disarm. */
  beginPlacePenetration: (kind: PenetrationKind) => void;
  /** Phase 14.R.27 — swap the armed kind without changing mode.
   *  No-op when not in 'place-penetration' mode. */
  setPenetrationKind: (kind: PenetrationKind) => void;

  setDefaultRoofType: (t: RoofType) => void;
  setDefaultSectionType: (t: SectionType) => void;
  setDefaultSlope: (s: number) => void;
  setDefaultOverhang: (o: number) => void;
  setDefaultElevation: (z: number) => void;
}

// ── Defaults ────────────────────────────────────────────────────

const DEFAULTS = {
  defaultRoofType: 'hip' as RoofType,
  defaultSectionType: 'main_roof' as SectionType,
  defaultSlope: 6,
  defaultOverhang: 1,
  defaultElevation: 0,
  penetrationKind: 'plumbing_vent' as PenetrationKind,
};

// ── Store ───────────────────────────────────────────────────────

export const useRoofingDrawStore = create<RoofingDrawState>((set) => ({
  mode: 'idle',
  draftStart: null,
  draftEnd: null,
  polygonVertices: [],
  ...DEFAULTS,

  beginDrawRect: () => set({
    mode: 'draw-rect',
    draftStart: null,
    draftEnd: null,
    polygonVertices: [],
  }),

  beginDrawPolygon: () => set({
    mode: 'draw-polygon',
    draftStart: null,
    draftEnd: null,
    polygonVertices: [],
  }),

  cancelDraft: () => set({
    mode: 'idle',
    draftStart: null,
    draftEnd: null,
    polygonVertices: [],
  }),

  setDraftStart: (pt) => set({ draftStart: pt }),
  setDraftEnd: (pt) => set({ draftEnd: pt }),

  addPolygonVertex: (pt) => set((s) => ({
    polygonVertices: [...s.polygonVertices, pt],
  })),

  removeLastPolygonVertex: () => set((s) => ({
    polygonVertices: s.polygonVertices.slice(0, -1),
  })),

  // Phase 14.R.27 — arm penetration placement. Also clears any
  // in-progress section draft so the cursor goes straight into
  // "drop a marker" behaviour.
  beginPlacePenetration: (kind) => set((s) => (
    s.mode === 'place-penetration' && s.penetrationKind === kind
      ? s
      : {
          mode: 'place-penetration',
          penetrationKind: kind,
          draftStart: null,
          draftEnd: null,
          polygonVertices: [],
        }
  )),

  setPenetrationKind: (kind) => set((s) => (
    s.mode === 'place-penetration'
      ? { penetrationKind: kind }
      : s
  )),

  setDefaultRoofType: (t) => set({ defaultRoofType: t }),
  setDefaultSectionType: (t) => set({ defaultSectionType: t }),
  setDefaultSlope: (s) => set({ defaultSlope: Math.max(0, s) }),
  setDefaultOverhang: (o) => set({ defaultOverhang: Math.max(0, o) }),
  setDefaultElevation: (z) => set({ defaultElevation: z }),
}));

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Compute the (x, y, length, run) of the rectangle whose opposite
 * corners are `a` and `b`. Uses absolute-min for origin so the
 * RoofSection's origin-in-bottom-left invariant holds regardless of
 * which corner the user clicked first.
 */
export function draftRectToSection(
  a: GroundPoint,
  b: GroundPoint,
): { x: number; y: number; length: number; run: number } {
  const minX = Math.min(a[0], b[0]);
  const maxX = Math.max(a[0], b[0]);
  const minY = Math.min(a[1], b[1]);
  const maxY = Math.max(a[1], b[1]);
  return {
    x: minX,
    y: minY,
    length: maxX - minX,
    run: maxY - minY,
  };
}

/**
 * Ground-plane snap to a regular grid. Default 0.5 ft matches the
 * plumbing app's finest snap grid. Returns a new point — does NOT
 * mutate.
 */
export function snapToGrid(pt: GroundPoint, grid: number = 0.5): GroundPoint {
  if (grid <= 0) return pt;
  return [
    Math.round(pt[0] / grid) * grid,
    Math.round(pt[1] / grid) * grid,
  ];
}

export const __testables = {
  DEFAULTS,
};
