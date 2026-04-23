/**
 * RoofingRotationKeyHandler — Phase 14.R.19.
 *
 * Null component that installs a window-level keydown listener for
 * the roofing rotation shortcuts:
 *
 *   [  → rotate selected section by  −15°
 *   ]  → rotate selected section by  +15°
 *   Shift+[  → −5°   (fine)
 *   Shift+]  → +5°   (fine)
 *   Ctrl+[   → −90°  (coarse, rectilinear snap)
 *   Ctrl+]   → +90°
 *
 * Each press is a discrete one-shot rotation routed through
 * `roofStore.rotateSectionByDelta`, which pushes one undo entry
 * per key press — so holding `]` and getting three rotations
 * becomes three undoable steps.
 *
 * Gating: the listener is ALWAYS installed but only acts when the
 * roofing mode is active, a section is selected + unlocked, and no
 * input element is focused. When the user is typing in the
 * RoofingInspector or any numeric field, the keys fall through to
 * the browser's default behavior.
 */

import { useEffect } from 'react';
import { useAppModeStore } from '@store/appModeStore';
import { useRoofStore } from '@store/roofStore';

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return true;
  if (t.isContentEditable) return true;
  return false;
}

export function RoofingRotationKeyHandler() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' && e.key !== ']' && e.key !== '{' && e.key !== '}') return;
      if (isEditableTarget(e.target)) return;
      if (useAppModeStore.getState().mode !== 'roofing') return;
      const sid = useRoofStore.getState().selectedSectionId;
      if (!sid) return;
      const sec = useRoofStore.getState().sections[sid];
      if (!sec || sec.locked) return;

      // Direction from the bare bracket character (Shift produces
      // the curly-brace variant, but we still want the same sign).
      const sign = (e.key === '[' || e.key === '{') ? -1 : 1;
      // Magnitude: 90° with Ctrl, 5° with Shift-only, 15° otherwise.
      let magnitude: number;
      if (e.ctrlKey || e.metaKey) magnitude = 90;
      else if (e.shiftKey) magnitude = 5;
      else magnitude = 15;

      e.preventDefault();
      useRoofStore.getState().rotateSectionByDelta(sid, sign * magnitude);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}
