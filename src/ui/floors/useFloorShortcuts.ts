/**
 * useFloorShortcuts — keyboard integration for floor switching.
 *
 * Bindings (all ignored when user is typing in an input/textarea):
 *
 *   Ctrl+1 .. Ctrl+6    Jump directly to nth floor (basement..attic)
 *   PageUp              Jump to next-higher floor
 *   PageDown            Jump to next-lower floor
 *   Shift+G             Cycle visibility mode (ALL → GHOST → SOLO)
 *   Shift+A             Force mode = ALL
 *   Shift+S             Force mode = SOLO
 *   Shift+H             Toggle per-floor hide on ACTIVE floor
 *   Shift+P             Toggle floor planes
 *   Shift+D             Toggle constrain-draw
 *
 * Mount once in App.tsx: useFloorShortcuts();
 */

import { useEffect } from 'react';
import { useFloorStore } from '@store/floorStore';

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}

export function useFloorShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      const st = useFloorStore.getState();
      const ordered = st.getFloorsOrdered();

      // Ctrl+1..6 → direct floor jump
      if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        const digit = e.key;
        if (/^[1-9]$/.test(digit)) {
          const idx = parseInt(digit, 10) - 1;
          const target = ordered[idx];
          if (target) {
            e.preventDefault();
            st.setActiveFloor(target.id);
          }
          return;
        }
      }

      // PageUp/PageDown → adjacent floor
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.key === 'PageUp')   { e.preventDefault(); st.jumpFloorUp();   return; }
        if (e.key === 'PageDown') { e.preventDefault(); st.jumpFloorDown(); return; }
      }

      // Shift + letter commands
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'g':
            e.preventDefault();
            st.cycleVisibilityMode();
            return;
          case 'a':
            e.preventDefault();
            st.setVisibilityMode('all');
            return;
          case 's':
            e.preventDefault();
            st.setVisibilityMode('active_only');
            return;
          case 'h':
            e.preventDefault();
            st.toggleFloorHidden(st.activeFloorId);
            return;
          case 'p':
            e.preventDefault();
            st.toggleShowFloorPlanes();
            return;
          case 'd':
            e.preventDefault();
            st.toggleConstrainDraw();
            return;
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
