/**
 * CursorTracker — global pointermove listener that keeps
 * `drawFeedbackStore.cursorClient` in sync with the actual pointer.
 *
 * Split from DrawInteraction because the CursorBadge and other DOM
 * overlays need client-space coordinates in all modes, not just Draw.
 * R3F's useFrame reads world-space from the raycaster; that's a
 * separate concern handled inside DrawInteraction.
 *
 * Minimal listener — just an (x, y) write on each move. Store writes
 * are cheap; selectors on the store use shallow-equal so consumers
 * don't re-render when the badge's position is the only thing that
 * changed (subscribers that read other fields stay stable).
 */

import { useEffect } from 'react';
import { useDrawFeedbackStore } from '@store/drawFeedbackStore';

export function CursorTracker() {
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      // Snap target + world-space are populated elsewhere. Here we just
      // mirror the client coords so DOM overlays can follow the cursor.
      const s = useDrawFeedbackStore.getState();
      s.setCursor(s.cursorWorld, { x: e.clientX, y: e.clientY });
    };
    const onLeave = () => {
      const s = useDrawFeedbackStore.getState();
      s.setCursor(s.cursorWorld, null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return null;
}
