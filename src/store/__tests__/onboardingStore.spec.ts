/**
 * onboardingStore — Phase 10.F tests.
 *
 * Covers:
 *   • initial status from localStorage (inactive / dismissed / completed)
 *   • start() transitions inactive → active at step 0
 *   • next()/back() bound to step count correctly
 *   • dismiss() persists + transitions active → dismissed
 *   • complete() persists + transitions active → completed
 *   • resetPersisted() wipes localStorage + returns to inactive
 *   • shouldShowOnFirstLaunch() returns the right bool for each status
 *   • ONBOARDING_STEPS content sanity (5 steps, last one is final, ids unique)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useOnboardingStore, shouldShowOnFirstLaunch } from '../onboardingStore';
import { ONBOARDING_STEPS } from '@core/onboarding/steps';

const STORAGE_KEY = 'elbow-grease-onboarding';

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  // Reset store manually (Zustand doesn't offer reset without middleware).
  useOnboardingStore.setState({
    status: 'inactive',
    currentStepIdx: 0,
    dismissedAt: null,
    completedAt: null,
  });
});

describe('initial status derivation', () => {
  it('is inactive when localStorage is empty', () => {
    expect(useOnboardingStore.getState().status).toBe('inactive');
  });

  it('treats "never dismissed, never completed" as first-launch-eligible', () => {
    expect(shouldShowOnFirstLaunch()).toBe(true);
  });

  it('disqualifies from first-launch when completed', () => {
    useOnboardingStore.getState().complete();
    expect(shouldShowOnFirstLaunch()).toBe(false);
  });

  it('disqualifies from first-launch when dismissed', () => {
    useOnboardingStore.getState().dismiss();
    expect(shouldShowOnFirstLaunch()).toBe(false);
  });
});

describe('start()', () => {
  it('transitions inactive → active at step 0', () => {
    useOnboardingStore.getState().start();
    const s = useOnboardingStore.getState();
    expect(s.status).toBe('active');
    expect(s.currentStepIdx).toBe(0);
  });
});

describe('next() / back()', () => {
  it('next() advances the index by one', () => {
    const { start, next } = useOnboardingStore.getState();
    start();
    next();
    expect(useOnboardingStore.getState().currentStepIdx).toBe(1);
    next();
    expect(useOnboardingStore.getState().currentStepIdx).toBe(2);
  });

  it('back() floors at 0', () => {
    const { start, back } = useOnboardingStore.getState();
    start();
    back();
    back();
    expect(useOnboardingStore.getState().currentStepIdx).toBe(0);
  });

  it('back() decrements from mid-stream', () => {
    const { start, next, back } = useOnboardingStore.getState();
    start();
    next();
    next();
    back();
    expect(useOnboardingStore.getState().currentStepIdx).toBe(1);
  });
});

describe('dismiss()', () => {
  it('transitions to dismissed and persists a timestamp', () => {
    const before = Date.now();
    useOnboardingStore.getState().dismiss();
    const s = useOnboardingStore.getState();
    expect(s.status).toBe('dismissed');
    expect(s.dismissedAt).not.toBeNull();
    expect(s.dismissedAt!).toBeGreaterThanOrEqual(before);

    // Persisted to localStorage.
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.dismissedAt).toBe(s.dismissedAt);
  });
});

describe('complete()', () => {
  it('transitions to completed and persists', () => {
    useOnboardingStore.getState().complete();
    const s = useOnboardingStore.getState();
    expect(s.status).toBe('completed');
    expect(s.completedAt).not.toBeNull();

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.completedAt).toBe(s.completedAt);
  });
});

describe('resetPersisted()', () => {
  it('wipes localStorage and returns to inactive', () => {
    useOnboardingStore.getState().complete();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    useOnboardingStore.getState().resetPersisted();
    const s = useOnboardingStore.getState();
    expect(s.status).toBe('inactive');
    expect(s.dismissedAt).toBeNull();
    expect(s.completedAt).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('ONBOARDING_STEPS content', () => {
  it('has exactly 5 steps', () => {
    expect(ONBOARDING_STEPS.length).toBe(5);
  });

  it('has unique step ids', () => {
    const ids = new Set(ONBOARDING_STEPS.map((s) => s.id));
    expect(ids.size).toBe(ONBOARDING_STEPS.length);
  });

  it('last step is marked final', () => {
    const last = ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1]!;
    expect(last.isFinal).toBe(true);
  });

  it('first step is welcome with no target selector', () => {
    const first = ONBOARDING_STEPS[0]!;
    expect(first.id).toBe('welcome');
    expect(first.targetSelector).toBeUndefined();
  });

  it('each step has a title and non-empty body', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });
});
