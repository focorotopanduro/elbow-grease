/**
 * drawFeedbackStore — single source of truth for the state the
 * drawing/editing feedback layer reads.
 *
 * Four systems (DrawInteraction, EndpointExtender, PipeHitboxes,
 * ManifoldRenderer) all own slices of "what's the cursor doing
 * right now". Phase 9 consolidates the visible-feedback portion of
 * that into one store so the hint bar, cursor badge, snap indicator,
 * and future overlays can react off a single tick.
 *
 * Scope boundaries:
 *   • This store holds VISUAL FEEDBACK state only — cursor position,
 *     what's snapped-to, what the next click will do.
 *   • The actual drawing data (drawPoints, mode, diameter, material)
 *     continues to live in plumbingDrawStore.
 *   • The pivot/extend sessions stay as module-local singletons in
 *     their respective files.
 *
 * Update discipline:
 *   • DrawInteraction writes `cursorWorld` + `snapTarget` every frame
 *     via useFrame. Cost: one Zustand set per frame. Negligible for
 *     the feedback subscribers because they use stable selectors.
 */

import { create } from 'zustand';
import type { Vec3 } from '@core/events';

// ── Types ──────────────────────────────────────────────────────

export type SnapKind =
  /** Cursor is snapped to a grid intersection. */
  | 'grid'
  /** Cursor is snapped to an existing pipe endpoint (within threshold). */
  | 'endpoint'
  /** Cursor is snapped to a pipe body (perpendicular projection). */
  | 'body'
  /** Cursor is snapped to a fixture connection point. */
  | 'fixture'
  /** Cursor is snapped to a manifold port. */
  | 'manifold-port';

export interface SnapTarget {
  kind: SnapKind;
  /** World-space position the cursor will commit to if clicked now. */
  position: Vec3;
  /**
   * Display label for the hint bar.
   * Examples: "Pipe endpoint · 1" PEX (cold)", "Grid · (5, 0, 3)"
   */
  label: string;
  /** For endpoint/body snaps: which pipe ID the snap references. */
  pipeId?: string;
  /** For body snap: segment index + t parameter (0..1). */
  segmentIdx?: number;
  segmentT?: number;
}

/**
 * What the NEXT primary click will do at the cursor's current position.
 * Drives DrawingHintBar's main message + CursorBadge's icon.
 */
export type NextAction =
  | 'place-first-point'    // empty space, no pipe in progress
  | 'place-next-point'     // pipe in progress, clicking adds another point
  | 'finish-at-endpoint'   // pipe in progress AND cursor is on an endpoint — close the run
  | 'start-from-endpoint'  // nothing in progress, cursor is on an endpoint — continues it
  | 'insert-tee'           // nothing in progress, cursor is on a pipe body
  | 'select'               // select mode, click to select whatever's under cursor
  | 'pan-only';            // navigate mode — nothing to place

interface DrawFeedbackState {
  /** Last-known cursor position in world space. */
  cursorWorld: Vec3 | null;
  /** Cursor position in screen pixels, for DOM-overlay placement. */
  cursorClient: { x: number; y: number } | null;
  /** Active snap target, if cursor is within snap range of anything. */
  snapTarget: SnapTarget | null;
  /** What the next click will do — computed by DrawInteraction. */
  nextAction: NextAction;

  setCursor: (world: Vec3 | null, client: { x: number; y: number } | null) => void;
  setSnapTarget: (t: SnapTarget | null) => void;
  setNextAction: (a: NextAction) => void;
  clear: () => void;
}

// ── Store ──────────────────────────────────────────────────────

export const useDrawFeedbackStore = create<DrawFeedbackState>((set) => ({
  cursorWorld: null,
  cursorClient: null,
  snapTarget: null,
  nextAction: 'pan-only',

  setCursor: (world, client) => set({ cursorWorld: world, cursorClient: client }),
  setSnapTarget: (t) => set({ snapTarget: t }),
  setNextAction: (a) => set({ nextAction: a }),
  clear: () => set({
    cursorWorld: null,
    cursorClient: null,
    snapTarget: null,
    nextAction: 'pan-only',
  }),
}));
