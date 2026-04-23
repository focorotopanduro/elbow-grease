/**
 * ExtendSession — module-local singleton tracking an in-flight pipe
 * extension drag.
 *
 * Extracted out of EndpointExtender in Phase 7.A so PipeHitboxes can
 * also start a session (for tee-from-middle-drag) and both components
 * share one preview + commit pathway.
 *
 * Why a module singleton (not a store):
 *   • Lives for the duration of a single pointer gesture (~1s max).
 *   • Persistence to localStorage would be pathological.
 *   • The React re-render cost of a Zustand subscription for a
 *     60Hz-updated cursor position is non-trivial; a manual
 *     subscriber set keeps the preview component the only thing
 *     that re-renders per move.
 */

import { useInteractionStore } from '@store/interactionStore';
import { commandBus } from '@core/commands/CommandBus';
import { newCorrelationId } from '@core/commands/correlationId';
import { eventBus } from '@core/EventBus';
import { EV, type Vec3 } from '@core/events';

// ── Origin ─────────────────────────────────────────────────────

export type ExtendOrigin =
  /** From a pipe's starting endpoint (point[0]). */
  | 'endpoint-start'
  /** From a pipe's ending endpoint (last point). */
  | 'endpoint-end'
  /** Inserted into the middle of a pipe → will split into a tee on commit. */
  | 'tee';

// ── Session shape ──────────────────────────────────────────────

export interface ExtendSession {
  parentPipeId: string;
  origin: ExtendOrigin;
  /**
   * For 'tee' origin: the segment index (0-based) within the parent
   * pipe's points array where the anchor should be inserted. If
   * origin=tee, this MUST be defined — the commit path reads it.
   */
  teeSegmentIdx?: number;
  /** World-space position the new pipe starts from. */
  anchor: Vec3;
  /** Current cursor position (grid-snapped, same elevation as anchor). */
  currentCursor: Vec3;
  /** `performance.now()` at session start — for gesture timing checks. */
  startedAt: number;
}

// ── Internal state ─────────────────────────────────────────────

let activeSession: ExtendSession | null = null;
const listeners = new Set<() => void>();

/** Minimum straight-line distance anchor→cursor for a valid commit. */
export const MIN_EXTEND_LENGTH_FT = 0.45;

// ── API ────────────────────────────────────────────────────────

export function getActiveExtendSession(): ExtendSession | null {
  return activeSession;
}

export function subscribeExtendSession(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function beginExtend(params: {
  parentPipeId: string;
  origin: ExtendOrigin;
  anchor: Vec3;
  teeSegmentIdx?: number;
}): void {
  useInteractionStore.getState().setNavFrozen(true);
  activeSession = {
    parentPipeId: params.parentPipeId,
    origin: params.origin,
    teeSegmentIdx: params.teeSegmentIdx,
    anchor: params.anchor,
    currentCursor: params.anchor,
    startedAt: performance.now(),
  };
  notify();
}

export function updateExtendCursor(cursor: Vec3): void {
  if (!activeSession) return;
  activeSession = { ...activeSession, currentCursor: cursor };
  notify();
}

/**
 * Commit the in-flight session:
 *   1. If origin is 'tee', first dispatch `pipe.insertAnchor` on the
 *      parent pipe so its polyline gains the new vertex — otherwise
 *      the fitting logic can't see a 3-way join.
 *   2. Emit `EV.PIPE_COMPLETE` for the new branch pipe.
 *
 * Short gestures (below MIN_EXTEND_LENGTH_FT) are canceled silently so
 * an accidental tap-and-wiggle doesn't drop a micro-pipe.
 */
export function commitExtendSession(): void {
  const s = activeSession;
  activeSession = null;
  useInteractionStore.getState().setNavFrozen(false);
  notify();
  if (!s) return;

  const len = distance3(s.anchor, s.currentCursor);
  if (len < MIN_EXTEND_LENGTH_FT) return;

  const correlationId = newCorrelationId();

  // Step 1: if origin is 'tee', split the parent pipe by inserting the
  // anchor at the recorded segment index. The command handler validates
  // preconditions (pipe exists, idx in range) so a stale session gets
  // rejected rather than corrupting state.
  if (s.origin === 'tee' && typeof s.teeSegmentIdx === 'number') {
    commandBus.dispatch({
      type: 'pipe.insertAnchor',
      payload: {
        pipeId: s.parentPipeId,
        segmentIdx: s.teeSegmentIdx,
        position: s.anchor,
      },
      issuedBy: 'user',
      correlationId,
    });
  }

  // Step 2: emit PIPE_COMPLETE for the new branch. The legacy
  // EventBus path OR the Phase 1 commandBus translator (whichever is
  // flag-active) will add it to pipeStore.
  const ix = useInteractionStore.getState();
  eventBus.emit(EV.PIPE_COMPLETE, {
    id: `pipe-${Date.now()}-branch`,
    points: [s.anchor, s.currentCursor],
    diameter: ix.drawDiameter,
    material: ix.drawMaterial,
  });
}

export function cancelExtendSession(): void {
  if (!activeSession) return;
  activeSession = null;
  useInteractionStore.getState().setNavFrozen(false);
  notify();
}

// ── Internal ───────────────────────────────────────────────────

function notify(): void {
  for (const l of listeners) {
    try { l(); } catch { /* never break the session on subscriber throw */ }
  }
}

function distance3(a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ── Test hook ──────────────────────────────────────────────────

/** Never call from app code — test resetter only. */
export function __resetExtendSessionForTests(): void {
  activeSession = null;
  listeners.clear();
}
