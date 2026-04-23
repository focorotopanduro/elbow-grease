/**
 * useGroupTranslateShortcuts — Phase 14.O
 *
 * Arrow-key translation for the current selection.
 *
 *   Arrow           → ±1 ft in X or Z
 *   Shift + arrow   → ±0.1 ft (fine nudge)
 *   Ctrl + arrow    → ±5 ft (coarse jump)
 *
 * Works in three modes based on what's currently selected:
 *
 *   • multi-select ≥ 2   → translate the entire group
 *   • single fixture     → translate just that fixture
 *   • single pipe        → translate every point of that pipe
 *   • nothing selected   → arrows unbound (fall through)
 *
 * Skipped when focus is inside a text input, textarea, or
 * contenteditable — standard "don't steal typing" guard.
 *
 * Layout convention: ArrowUp/Down move along -Z/+Z (i.e. "up on
 * screen" when the camera looks down at the floor from the default
 * iso angle); ArrowLeft/Right move along -X/+X. Matches the XZ-plane
 * compass the in-scene rotation gizmo implies.
 */

import { useEffect } from 'react';
import { useMultiSelectStore } from '@store/multiSelectStore';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { translateGroup, translateVec } from '@core/selection/groupTranslate';
import type { Vec3 } from '@core/events';

/** Returns the delta for a given arrow key + modifier, or null. */
export function arrowKeyToDelta(
  key: string,
  shiftKey: boolean,
  ctrlKey: boolean,
  metaKey: boolean,
): Vec3 | null {
  if (metaKey) return null;
  let step = 1;
  if (ctrlKey) step = 5;
  else if (shiftKey) step = 0.1;
  switch (key) {
    case 'ArrowLeft':  return [-step, 0, 0];
    case 'ArrowRight': return [+step, 0, 0];
    case 'ArrowUp':    return [0, 0, -step];
    case 'ArrowDown':  return [0, 0, +step];
    default:           return null;
  }
}

export function useGroupTranslateShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return;
      }
      const delta = arrowKeyToDelta(e.key, e.shiftKey, e.ctrlKey, e.metaKey);
      if (!delta) return;

      const multi = useMultiSelectStore.getState();
      const msPipeIds = multi.selectedPipeIds();
      const msFixtureIds = multi.selectedFixtureIds();
      const msCount = msPipeIds.length + msFixtureIds.length;

      const pipeStore = usePipeStore.getState();
      const fixtureStore = useFixtureStore.getState();

      if (msCount >= 2) {
        // Group path.
        e.preventDefault();
        const selPipes = msPipeIds
          .map((id) => pipeStore.pipes[id])
          .filter((p): p is NonNullable<typeof p> => !!p)
          .map((p) => ({ id: p.id, points: p.points }));
        const selFixtures = msFixtureIds
          .map((id) => fixtureStore.fixtures[id])
          .filter((f): f is NonNullable<typeof f> => !!f)
          .map((f) => ({ id: f.id, position: f.position }));
        const result = translateGroup({ pipes: selPipes, fixtures: selFixtures }, delta);
        for (const p of result.pipes) pipeStore.setPoints(p.id, p.points);
        for (const f of result.fixtures) fixtureStore.setPosition(f.id, f.position);
        return;
      }

      // Single-pipe path (selected via pipeStore.selectedId).
      const pipeId = pipeStore.selectedId;
      if (pipeId && pipeStore.pipes[pipeId]) {
        e.preventDefault();
        const pipe = pipeStore.pipes[pipeId]!;
        const newPoints = pipe.points.map((pt) => translateVec(pt, delta));
        pipeStore.setPoints(pipeId, newPoints);
        return;
      }

      // Single-fixture path (selected via fixtureStore.selectedFixtureId).
      const fixtureId = fixtureStore.selectedFixtureId;
      if (fixtureId && fixtureStore.fixtures[fixtureId]) {
        e.preventDefault();
        const fixture = fixtureStore.fixtures[fixtureId]!;
        fixtureStore.setPosition(fixtureId, translateVec(fixture.position, delta));
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function GroupTranslateShortcutsBinder(): null {
  useGroupTranslateShortcuts();
  return null;
}
