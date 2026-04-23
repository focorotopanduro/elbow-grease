/**
 * isAnyDrawActive — cross-store selector (ARCHITECTURE.md §4.2).
 *
 * Single source of truth for the question "is the user currently
 * in a drawing interaction anywhere in the app?". Previously we
 * had two separate reads:
 *
 *   • `usePlumbingDrawStore.getState().mode === 'draw'`
 *   • `useRoofingDrawStore.getState().mode !== 'idle'`
 *
 * Any feature that needs to know "is any draw active" (autosave
 * `isDirty` gating, Escape handling, onboarding advancement, radial-
 * menu open/close) must not be wrong about one of the domains —
 * both modes can hold the user mid-action. This selector unifies
 * the two reads so no caller has to know both stores.
 *
 * Policy (§4.2):
 *   • Route NEW code through this selector.
 *   • Existing callers migrate opportunistically — do not batch a
 *     sweep; each call site gets updated when it's next touched.
 *   • Pure function, no side effects. Reads via `getState()` so it
 *     can be called outside React and in hot paths without
 *     subscribing a re-render.
 */

import { usePlumbingDrawStore } from '@store/plumbingDrawStore';
import { useRoofingDrawStore } from '@store/roofingDrawStore';

/**
 * True iff the user has an active drawing interaction in either
 * the plumbing or the roofing workspace. Cheap — two
 * `getState()` reads and a single enum compare each.
 */
export function isAnyDrawActive(): boolean {
  return (
    usePlumbingDrawStore.getState().mode === 'draw'
    || useRoofingDrawStore.getState().mode !== 'idle'
  );
}
