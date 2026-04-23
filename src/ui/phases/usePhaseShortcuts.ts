/**
 * usePhaseShortcuts — keyboard bindings for construction-phase navigation.
 *
 * Bindings (ignored when typing in inputs):
 *
 *   [1]          activate Underground
 *   [2]          activate Rough-in
 *   [3]          activate Trim
 *   [P]          cycle visibility mode (All → Single → Cumulative)
 *   [Alt+T]      toggle phase tint on pipes
 *   [Alt+H]      toggle phase halo on fixtures
 *
 * Note: digit hotkeys [1-3] are scoped so they don't collide with
 * camera/layer shortcuts — if the user is in any text input, they're
 * ignored.
 */

import { useEffect } from 'react';
import { usePlumbingPhaseStore } from '@store/plumbingPhaseStore';
import { PHASE_ORDER } from '@core/phases/PhaseTypes';

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}

export function usePhaseShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (e.ctrlKey || e.metaKey) return;

      const st = usePlumbingPhaseStore.getState();

      // Digit 1-3 → phase jump (no modifiers)
      if (!e.altKey && !e.shiftKey) {
        if (e.key === '1' || e.key === '2' || e.key === '3') {
          const idx = parseInt(e.key, 10) - 1;
          const phase = PHASE_ORDER[idx];
          if (phase) {
            e.preventDefault();
            st.setActivePhase(phase);
          }
          return;
        }
        if (e.key.toLowerCase() === 'p') {
          e.preventDefault();
          st.cycleVisibilityMode();
          return;
        }
      }

      // Alt+T → toggle tint
      if (e.altKey && !e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        st.toggleTint();
        return;
      }
      // Alt+H → toggle halo
      if (e.altKey && !e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        st.toggleHalo();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
