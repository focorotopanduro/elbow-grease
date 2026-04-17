/**
 * useMeasureShortcuts — keyboard bindings for Phase 2.G tools.
 *
 *   W    toggle wall-draw (interior by default)
 *   R    toggle ruler
 *   K    toggle scale calibration
 *   Escape   cancel any in-progress measure/wall draw
 *   Delete   delete selected wall / backdrop
 *
 * W is reserved by FloorStore shortcuts (Shift+P etc) but not by the
 * unshifted single-letter bindings — we only listen to the plain key.
 */

import { useEffect } from 'react';
import { useWallStore } from '@store/wallStore';
import { useMeasureStore } from '@store/measureStore';
import { useBackdropStore } from '@store/backdropStore';

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}

export function useMeasureShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.shiftKey) return; // let shift-bindings through to other handlers

      const k = e.key.toLowerCase();

      const wallStore = useWallStore.getState();
      const measureStore = useMeasureStore.getState();
      const backdropStore = useBackdropStore.getState();

      // W → wall draw toggle (interior default)
      if (k === 'w') {
        if (wallStore.drawSession) wallStore.cancelWallDraw();
        else wallStore.beginWallDraw('interior');
        e.preventDefault();
        return;
      }

      // R → ruler toggle
      if (k === 'r') {
        measureStore.setMode(measureStore.mode === 'ruler' ? 'off' : 'ruler');
        e.preventDefault();
        return;
      }

      // K → scale calibrate toggle
      if (k === 'k') {
        measureStore.setMode(measureStore.mode === 'scale' ? 'off' : 'scale');
        e.preventDefault();
        return;
      }

      if (e.key === 'Escape') {
        if (wallStore.drawSession) wallStore.cancelWallDraw();
        if (measureStore.mode !== 'off') measureStore.setMode('off');
        if (measureStore.pendingScalePair) measureStore.cancelScale();
      }

      if (e.key === 'Delete') {
        if (wallStore.selectedWallId) {
          wallStore.removeWall(wallStore.selectedWallId);
          e.preventDefault();
          return;
        }
        if (backdropStore.selectedId) {
          backdropStore.removeBackdrop(backdropStore.selectedId);
          e.preventDefault();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
