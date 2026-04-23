/**
 * onboardingStore — first-run coach-mark walkthrough state.
 *
 * Shape:
 *   status         'inactive' | 'active' | 'completed' | 'dismissed'
 *   currentStepIdx index into STEPS (0…STEPS.length-1)
 *   dismissedAt    wall-clock ms, null if never dismissed
 *
 * Persistence strategy:
 *   We persist only `dismissedAt` and `completedAt`. The per-run
 *   `currentStepIdx` is ephemeral — if the user reloads mid-tutorial
 *   they get sent back to step 0. Mid-tutorial reload is rare enough
 *   that the trade-off (simpler state, no "resume from step 3" edge
 *   cases) is worth it.
 *
 * Relationship to featureFlagStore:
 *   Separate store intentionally. Feature flags are developer kill-
 *   switches; onboarding state is user-facing lifecycle. Mixing them
 *   would pollute the flag UI ("reset all flags" shouldn't replay
 *   the tutorial).
 */

import { create } from 'zustand';
import type { OnboardingStep } from '@core/onboarding/steps';

const STORAGE_KEY = 'elbow-grease-onboarding';

interface PersistedState {
  dismissedAt: number | null;
  completedAt: number | null;
}

type Status = 'inactive' | 'active' | 'completed' | 'dismissed';

export interface OnboardingState {
  status: Status;
  currentStepIdx: number;
  dismissedAt: number | null;
  completedAt: number | null;

  /** Start a new run (e.g. replay from HelpOverlay or first launch). */
  start: () => void;
  /** Advance to the next step, or finish if on the last one. */
  next: () => void;
  /** Jump back one step (optional UX — currently unused but keeps the API symmetric). */
  back: () => void;
  /** Stop the tutorial without marking it complete. */
  dismiss: () => void;
  /** Mark the full walkthrough as successfully finished. */
  complete: () => void;
  /** Wipe persisted state — used by "Replay tutorial" in HelpOverlay. */
  resetPersisted: () => void;
}

function loadPersisted(): PersistedState {
  if (typeof window === 'undefined') return { dismissedAt: null, completedAt: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { dismissedAt: null, completedAt: null };
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      dismissedAt: parsed.dismissedAt ?? null,
      completedAt: parsed.completedAt ?? null,
    };
  } catch {
    return { dismissedAt: null, completedAt: null };
  }
}

function savePersisted(state: PersistedState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota exceeded — silent */
  }
}

function initialStatus(persisted: PersistedState): Status {
  if (persisted.completedAt !== null) return 'completed';
  if (persisted.dismissedAt !== null) return 'dismissed';
  return 'inactive';
}

export const useOnboardingStore = create<OnboardingState>((set, get) => {
  const persisted = loadPersisted();
  return {
    status: initialStatus(persisted),
    currentStepIdx: 0,
    dismissedAt: persisted.dismissedAt,
    completedAt: persisted.completedAt,

    start: () => {
      set({ status: 'active', currentStepIdx: 0 });
    },

    next: () => {
      const { currentStepIdx } = get();
      // The steps array length is injected at runtime by the overlay
      // to avoid a circular import here; the overlay calls complete()
      // when it detects we've stepped past the end.
      set({ currentStepIdx: currentStepIdx + 1 });
    },

    back: () => {
      set((s) => ({ currentStepIdx: Math.max(0, s.currentStepIdx - 1) }));
    },

    dismiss: () => {
      const now = Date.now();
      set({ status: 'dismissed', dismissedAt: now, currentStepIdx: 0 });
      savePersisted({ dismissedAt: now, completedAt: get().completedAt });
    },

    complete: () => {
      const now = Date.now();
      set({ status: 'completed', completedAt: now, currentStepIdx: 0 });
      savePersisted({ dismissedAt: get().dismissedAt, completedAt: now });
    },

    resetPersisted: () => {
      set({
        status: 'inactive',
        currentStepIdx: 0,
        dismissedAt: null,
        completedAt: null,
      });
      if (typeof window !== 'undefined') {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      }
    },
  };
});

/**
 * True if the user should see the tutorial on this launch — never
 * dismissed AND never completed.
 */
export function shouldShowOnFirstLaunch(): boolean {
  const s = useOnboardingStore.getState();
  return s.status === 'inactive';
}

/** Helper for the overlay: returns the current step or null. */
export function currentStep(steps: OnboardingStep[]): OnboardingStep | null {
  const s = useOnboardingStore.getState();
  if (s.status !== 'active') return null;
  return steps[s.currentStepIdx] ?? null;
}
