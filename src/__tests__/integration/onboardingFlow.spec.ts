/**
 * Integration: onboarding walkthrough progression via EventBus.
 *
 * Verifies that when a step has an `advanceOn` event, emitting that
 * event on the EventBus actually advances the onboarding store.
 *
 * Unit tests on the store exist; those cover state transitions in
 * isolation. This test covers the wiring that only exists when the
 * OnboardingOverlay is mounted — so we instantiate it via renderHook
 * with an inline React tree.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { useOnboardingStore } from '@store/onboardingStore';
import { ONBOARDING_STEPS } from '@core/onboarding/steps';
import { OnboardingOverlay } from '@ui/onboarding/OnboardingOverlay';
import { EV } from '@core/events';
import { resetAllStores, emit } from './harness';

beforeEach(() => {
  resetAllStores();
});

describe('onboarding advancement', () => {
  it('emitting EV.FIXTURE_PLACED while on the place-fixture step advances to draw-pipe', () => {
    // Start on step 1 (place-fixture has index 1).
    useOnboardingStore.setState({
      status: 'active',
      currentStepIdx: 1,
      dismissedAt: null,
      completedAt: null,
    });
    // Sanity: the step at index 1 is the one we expect.
    expect(ONBOARDING_STEPS[1]!.id).toBe('place-fixture');
    expect(ONBOARDING_STEPS[1]!.advanceOn).toBe(EV.FIXTURE_PLACED);

    // Real render so the overlay's useEffect attaches to the EventBus.
    const { unmount } = render(React.createElement(OnboardingOverlay));

    act(() => {
      emit(EV.FIXTURE_PLACED, {
        id: 'f1',
        subtype: 'water_closet',
        position: [0, 0, 0],
      });
    });

    expect(useOnboardingStore.getState().currentStepIdx).toBe(2);
    expect(ONBOARDING_STEPS[2]!.id).toBe('draw-pipe');

    unmount();
  });

  it('emits on a non-active step are ignored (overlay inactive)', () => {
    useOnboardingStore.setState({
      status: 'dismissed',
      currentStepIdx: 1,
      dismissedAt: Date.now(),
      completedAt: null,
    });

    const { unmount } = render(React.createElement(OnboardingOverlay));

    emit(EV.FIXTURE_PLACED, {
      id: 'f-1',
      subtype: 'water_closet',
      position: [0, 0, 0],
    });

    // Dismissed overlay should not advance.
    const s = useOnboardingStore.getState();
    expect(s.status).toBe('dismissed');
    expect(s.currentStepIdx).toBe(1);

    unmount();
  });

  it('stepping past the final step flips status to completed', () => {
    useOnboardingStore.setState({
      status: 'active',
      currentStepIdx: ONBOARDING_STEPS.length - 1,
      dismissedAt: null,
      completedAt: null,
    });

    const { unmount } = render(React.createElement(OnboardingOverlay));

    act(() => {
      useOnboardingStore.getState().next();
    });

    // OnboardingOverlay's useEffect runs on the post-increment render,
    // which triggers complete().
    expect(useOnboardingStore.getState().status).toBe('completed');
    expect(useOnboardingStore.getState().completedAt).not.toBeNull();

    unmount();
  });
});
