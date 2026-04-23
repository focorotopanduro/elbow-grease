/**
 * Logger boot — mirrors `featureFlagStore.logLevel` into the logger
 * module's internal threshold, both at startup and on every runtime
 * change.
 *
 * Called once from App.tsx during bootstrap. Idempotent.
 */

import { useFeatureFlagStore } from '@store/featureFlagStore';
import { setLogLevel } from './Logger';

let booted = false;

export function bootLogger(): void {
  if (booted) return;
  booted = true;

  // Initial sync (feature-flag store loads from localStorage before this).
  setLogLevel(useFeatureFlagStore.getState().logLevel);

  // Live-sync on flag change.
  useFeatureFlagStore.subscribe((state, prev) => {
    if (state.logLevel !== prev.logLevel) {
      setLogLevel(state.logLevel);
    }
  });
}
