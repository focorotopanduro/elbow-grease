/**
 * useFixtureRotationShortcuts — Phase 14.E
 *
 * Quick-rotate shortcuts for the currently selected fixture:
 *
 *   [       → -15° (rotate CCW)
 *   ]       → +15° (rotate CW)
 *   Shift+[ → -5°  (fine CCW)
 *   Shift+] → +5°  (fine CW)
 *   Ctrl+[  → -90° (cardinal CCW)
 *   Ctrl+]  → +90° (cardinal CW)
 *
 * Why brackets and not R: R is already taken for the measurement
 * ruler. Bracket keys are a CAD / editor convention (many apps use
 * them for rotation / nudge) and they live next to the P key, easy
 * to hit with the left hand while the right hand moves the cursor.
 *
 * The shortcut is **scene-wide**: it fires any time a fixture is
 * the active selection (regardless of which mode the user is in),
 * EXCEPT when focus is inside a text input, textarea, or
 * contenteditable — standard "don't steal typing" guard.
 *
 * Activation requires `selectedFixtureId` to be non-null in the
 * fixture store. A follow-up concern is "what if two fixtures are
 * selected?" — multi-select doesn't exist yet, so single selection
 * is the only case to handle.
 */

import { useEffect } from 'react';
import { useFixtureStore } from '@store/fixtureStore';
// Phase 14.M — group-rotate path. When multi-select has ≥ 2 items, the
// same bracket chords rotate the group around its centroid instead of
// mutating a single fixture's rotationDeg.
import { usePlumbingMultiSelectStore } from '@store/plumbingMultiSelectStore';
import { usePipeStore } from '@store/pipeStore';
import {
  computeGroupCentroid,
  rotateGroupAroundY,
} from '@core/selection/groupRotation';

/** Keep the stored rotation in [0, 360). Uses `((x % 360) + 360) % 360`
 *  to avoid the JS `-0` gotcha on exact multiples of 360. */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export interface RotationKeyEvent {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Pure handler: given a key event + current fixture rotation,
 * return the next rotation (or null if the event doesn't match).
 * Exported for unit-testing the shortcut math without a DOM.
 */
export function rotationKeyToDeg(
  currentDeg: number,
  ev: RotationKeyEvent,
): number | null {
  // Don't fire under meta — leave that for browser shortcuts.
  if (ev.metaKey) return null;

  const key = ev.key;
  const isOpen = key === '[' || key === '{';
  const isClose = key === ']' || key === '}';
  if (!isOpen && !isClose) return null;

  // Shift+[ on US layout produces `{`, Shift+] produces `}`.
  // `shiftKey` is still true, so we use that as the primary signal
  // and treat the produced character as informational.
  const sign = isOpen ? -1 : 1;
  let step: number;
  if (ev.ctrlKey) step = 90;
  else if (ev.shiftKey) step = 5;
  else step = 15;

  return normalizeDeg(currentDeg + sign * step);
}

export function useFixtureRotationShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip if user is typing in an input / textarea / contenteditable.
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return;
      }

      // First decode the chord → deltaDeg. Both paths need it.
      const probeDeg = rotationKeyToDeg(0, {
        key: e.key,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      });
      if (probeDeg === null) return;
      // probeDeg is normalized to [0, 360). Recover signed delta:
      // keys that set a negative step (the `[` direction) produce a
      // probe of 360 − step, e.g. `[` alone = 360 − 15 = 345.
      const deltaDeg = probeDeg > 180 ? probeDeg - 360 : probeDeg;

      const multi = usePlumbingMultiSelectStore.getState();
      const selectedFixtureIds = multi.selectedFixtureIds();
      const selectedPipeIds = multi.selectedPipeIds();
      const groupSize = selectedFixtureIds.length + selectedPipeIds.length;

      if (groupSize >= 2) {
        // ── Group path ──
        e.preventDefault();
        const pipeStore = usePipeStore.getState();
        const fixtureStore = useFixtureStore.getState();
        const selPipes = selectedPipeIds
          .map((id) => pipeStore.pipes[id])
          .filter(Boolean)
          .map((p) => ({ id: p!.id, points: p!.points }));
        const selFixtures = selectedFixtureIds
          .map((id) => fixtureStore.fixtures[id])
          .filter(Boolean)
          .map((f) => ({
            id: f!.id,
            position: f!.position,
            rotationDeg: Number(f!.params['rotationDeg'] ?? 0),
          }));
        const center = computeGroupCentroid(selPipes, selFixtures);
        const result = rotateGroupAroundY(
          { pipes: selPipes, fixtures: selFixtures },
          center,
          deltaDeg,
        );
        for (const p of result.pipes) pipeStore.setPoints(p.id, p.points);
        for (const f of result.fixtures) {
          fixtureStore.setPosition(f.id, f.position);
          fixtureStore.updateParam(f.id, 'rotationDeg', f.rotationDeg);
        }
        return;
      }

      // ── Single path (pre-14.M behavior) ──
      const state = useFixtureStore.getState();
      const id = state.selectedFixtureId;
      if (!id) return;
      const fixture = state.fixtures[id];
      if (!fixture) return;

      const currentRaw = fixture.params['rotationDeg'];
      const currentDeg = typeof currentRaw === 'number' ? currentRaw : 0;
      const nextDeg = rotationKeyToDeg(currentDeg, {
        key: e.key,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      });
      if (nextDeg === null) return;

      e.preventDefault();
      state.updateParam(id, 'rotationDeg', nextDeg);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Small mount-only component that installs the shortcut on the window. */
export function FixtureRotationShortcutsBinder(): null {
  useFixtureRotationShortcuts();
  return null;
}
