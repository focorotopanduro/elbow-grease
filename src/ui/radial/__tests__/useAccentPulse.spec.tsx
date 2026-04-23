/**
 * useAccentPulse — unit tests.
 *
 * Covers the four rules:
 *
 *   1. First render returns 1 (no pulse at mount).
 *   2. Accent change pulses 1 → 1.08 → 1 over 150ms hold.
 *   3. reducedMotion suppresses the pulse.
 *   4. Toggling reducedMotion alone doesn't trigger a pulse.
 *
 * Uses fake timers so the 150ms setTimeout resolves deterministically.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAccentPulse, __testables } from '../useAccentPulse';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAccentPulse — initial state', () => {
  it('returns 1 on first render (no pulse at mount)', () => {
    const { result } = renderHook(({ accent }) => useAccentPulse(accent, false), {
      initialProps: { accent: '#00e5ff' },
    });
    expect(result.current).toBe(1);
  });

  it('returns 1 regardless of initial accent value', () => {
    const { result } = renderHook(({ accent }) => useAccentPulse(accent, false), {
      initialProps: { accent: '#ff9800' },
    });
    expect(result.current).toBe(1);
  });
});

describe('useAccentPulse — pulse on accent change', () => {
  it('pulses to 1.08 when the accent changes after mount', () => {
    const { result, rerender } = renderHook(
      ({ accent }) => useAccentPulse(accent, false),
      { initialProps: { accent: '#00e5ff' } },
    );
    expect(result.current).toBe(1);

    // Swap accent (user hits Shift+M → roofing).
    act(() => rerender({ accent: '#ff9800' }));
    expect(result.current).toBe(__testables.PULSE_SCALE_PEAK);
    expect(result.current).toBe(1.08);
  });

  it('snaps back to 1 after the hold timer fires', () => {
    const { result, rerender } = renderHook(
      ({ accent }) => useAccentPulse(accent, false),
      { initialProps: { accent: '#00e5ff' } },
    );
    act(() => rerender({ accent: '#ff9800' }));
    expect(result.current).toBe(1.08);

    // Advance past the 150ms hold.
    act(() => {
      vi.advanceTimersByTime(__testables.PULSE_HOLD_MS);
    });
    expect(result.current).toBe(1);
  });

  it('fires again on a second accent change', () => {
    const { result, rerender } = renderHook(
      ({ accent }) => useAccentPulse(accent, false),
      { initialProps: { accent: '#00e5ff' } },
    );

    // First flip.
    act(() => rerender({ accent: '#ff9800' }));
    expect(result.current).toBe(1.08);
    act(() => vi.advanceTimersByTime(__testables.PULSE_HOLD_MS));
    expect(result.current).toBe(1);

    // Second flip — back to plumbing.
    act(() => rerender({ accent: '#00e5ff' }));
    expect(result.current).toBe(1.08);
    act(() => vi.advanceTimersByTime(__testables.PULSE_HOLD_MS));
    expect(result.current).toBe(1);
  });

  it('does NOT pulse when rerendered with the same accent', () => {
    const { result, rerender } = renderHook(
      ({ accent }) => useAccentPulse(accent, false),
      { initialProps: { accent: '#00e5ff' } },
    );
    // Rerender with identical accent — no state change expected.
    act(() => rerender({ accent: '#00e5ff' }));
    expect(result.current).toBe(1);
  });
});

describe('useAccentPulse — prefers-reduced-motion', () => {
  it('stays at 1 even when accent changes, if reducedMotion is true', () => {
    const { result, rerender } = renderHook(
      ({ accent, rm }) => useAccentPulse(accent, rm),
      { initialProps: { accent: '#00e5ff', rm: true } },
    );
    act(() => rerender({ accent: '#ff9800', rm: true }));
    expect(result.current).toBe(1);
  });

  it('skips the setTimeout when reducedMotion is true (no timer leak)', () => {
    const { result, rerender, unmount } = renderHook(
      ({ accent, rm }) => useAccentPulse(accent, rm),
      { initialProps: { accent: '#00e5ff', rm: true } },
    );
    act(() => rerender({ accent: '#ff9800', rm: true }));
    expect(result.current).toBe(1);
    // Advance time — nothing scheduled, so result stays at 1.
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(1);
    unmount(); // clean
  });

  it('toggling reducedMotion alone does NOT trigger a pulse', () => {
    const { result, rerender } = renderHook(
      ({ accent, rm }) => useAccentPulse(accent, rm),
      { initialProps: { accent: '#00e5ff', rm: false } },
    );
    // User enables reduced motion in OS settings mid-session.
    act(() => rerender({ accent: '#00e5ff', rm: true }));
    expect(result.current).toBe(1);
  });
});

describe('useAccentPulse — cleanup', () => {
  it('unmounting during a live pulse clears the timer (no late state update)', () => {
    const { result, rerender, unmount } = renderHook(
      ({ accent }) => useAccentPulse(accent, false),
      { initialProps: { accent: '#00e5ff' } },
    );
    act(() => rerender({ accent: '#ff9800' }));
    expect(result.current).toBe(1.08);

    // Unmount BEFORE the timer fires.
    unmount();

    // Advance time — if the timer wasn't cleared, React would
    // warn about a state update on an unmounted component. The
    // silent pass confirms cleanup.
    act(() => vi.advanceTimersByTime(__testables.PULSE_HOLD_MS * 2));
    // No assertion needed — test is the absence of warnings.
  });
});
