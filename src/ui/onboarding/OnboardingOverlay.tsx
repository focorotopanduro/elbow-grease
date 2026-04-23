/**
 * OnboardingOverlay — orchestrates the first-run walkthrough.
 *
 * Responsibilities:
 *   1. On mount, if `onboardingStore.status === 'inactive'`, auto-start
 *      the tutorial after a short delay (~800 ms) — lets the app paint
 *      first so the welcome card lands in a drawn UI, not a blank canvas.
 *   2. While active, subscribe to the EventBus event specified by the
 *      current step's `advanceOn` (if any) and call `.next()` when it
 *      fires. Also exits active mode when the index exceeds the step
 *      count (→ complete()).
 *   3. Install an Escape-to-dismiss key handler while active.
 *   4. Render <CoachMark> for the current step, nothing when inactive.
 *
 * The overlay NEVER forces the user. Skip is always offered, Escape
 * dismisses, and clicking the backdrop dismisses. On second launch
 * the dismissed state is remembered and the overlay stays inactive.
 */

import { useEffect } from 'react';
import { eventBus } from '@core/EventBus';
import { useOnboardingStore } from '@store/onboardingStore';
import { ONBOARDING_STEPS } from '@core/onboarding/steps';
import { CoachMark } from './CoachMark';

const AUTO_START_DELAY_MS = 800;

export function OnboardingOverlay() {
  const status = useOnboardingStore((s) => s.status);
  const currentStepIdx = useOnboardingStore((s) => s.currentStepIdx);
  const start = useOnboardingStore((s) => s.start);
  const next = useOnboardingStore((s) => s.next);
  const dismiss = useOnboardingStore((s) => s.dismiss);
  const complete = useOnboardingStore((s) => s.complete);

  // ── Auto-start on first launch ────────────────────────────
  useEffect(() => {
    if (status !== 'inactive') return;
    const t = window.setTimeout(() => {
      // Re-check — user may have dismissed via another route before delay elapsed.
      if (useOnboardingStore.getState().status === 'inactive') start();
    }, AUTO_START_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [status, start]);

  // ── Auto-advance when the step's EventBus event fires ─────
  useEffect(() => {
    if (status !== 'active') return;
    const step = ONBOARDING_STEPS[currentStepIdx];
    if (!step?.advanceOn) return;
    const off = eventBus.on(step.advanceOn, () => {
      // Only advance if the SAME step is still current — guards against
      // a handler firing after the user has already clicked Next.
      const s = useOnboardingStore.getState();
      if (s.status === 'active' && s.currentStepIdx === currentStepIdx) {
        next();
      }
    });
    return off;
  }, [status, currentStepIdx, next]);

  // ── Finalize when stepping past the last step ─────────────
  useEffect(() => {
    if (status !== 'active') return;
    if (currentStepIdx >= ONBOARDING_STEPS.length) {
      complete();
    }
  }, [status, currentStepIdx, complete]);

  // ── Escape dismisses ──────────────────────────────────────
  useEffect(() => {
    if (status !== 'active') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, dismiss]);

  if (status !== 'active') return null;
  const step = ONBOARDING_STEPS[currentStepIdx];
  if (!step) return null;

  return (
    <CoachMark
      step={step}
      stepNumber={currentStepIdx + 1}
      totalSteps={ONBOARDING_STEPS.length}
      onNext={next}
      onDismiss={dismiss}
    />
  );
}
