/**
 * a11y hooks — Phase 10.C tests.
 *
 * Covers:
 *   • useReducedMotion + isReducedMotionPreferred read matchMedia.
 *   • useFocusTrap — moves focus on activate, restores on deactivate.
 *   • useFocusTrap — Tab wraps at last focusable; Shift+Tab at first.
 *   • useFocusTrap — container-less mount is safe (no crash).
 *
 * jsdom does not implement real focus / matchMedia perfectly; we
 * mock what's needed via @testing-library/react's hook rendering.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReducedMotion, isReducedMotionPreferred } from '../useReducedMotion';
import { useFocusTrap } from '../useFocusTrap';
import React from 'react';

// ── matchMedia mock shared across tests ──────────────────────

let matches = false;
let listener: ((ev: MediaQueryListEvent) => void) | null = null;

beforeEach(() => {
  matches = false;
  listener = null;
  const mql = {
    get matches() { return matches; },
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_: string, fn: (ev: MediaQueryListEvent) => void) => { listener = fn; },
    removeEventListener: () => { listener = null; },
    dispatchEvent: () => true,
    onchange: null,
  };
  // @ts-expect-error — jsdom doesn't expose matchMedia
  window.matchMedia = vi.fn(() => mql);
});

// ── useReducedMotion ──────────────────────────────────────────

describe('useReducedMotion', () => {
  it('returns initial matches value', () => {
    matches = true;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('updates when the OS preference changes', () => {
    matches = false;
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      matches = true;
      listener?.({ matches: true } as MediaQueryListEvent);
    });
    expect(result.current).toBe(true);
  });

  it('isReducedMotionPreferred reads synchronously', () => {
    matches = true;
    expect(isReducedMotionPreferred()).toBe(true);
    matches = false;
    expect(isReducedMotionPreferred()).toBe(false);
  });
});

// ── useFocusTrap ──────────────────────────────────────────────

describe('useFocusTrap', () => {
  function buildContainer(html: string): HTMLDivElement {
    const c = document.createElement('div');
    c.innerHTML = html;
    document.body.appendChild(c);
    return c;
  }

  it('moves focus to the first focusable on activate', () => {
    const container = buildContainer(`
      <button id="a">A</button>
      <button id="b">B</button>
    `);
    const { result } = renderHook(() => useFocusTrap<HTMLDivElement>(true));
    // Manually attach ref to an existing DOM container.
    act(() => {
      (result.current as React.MutableRefObject<HTMLDivElement | null>).current = container as unknown as HTMLDivElement;
    });
    // Rerender to let the effect run.
    const { rerender } = renderHook(({ on }: { on: boolean }) => {
      const ref = useFocusTrap<HTMLDivElement>(on);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container as unknown as HTMLDivElement;
      return ref;
    }, { initialProps: { on: false } });
    rerender({ on: true });

    expect(document.activeElement?.id).toBe('a');

    document.body.removeChild(container);
  });

  it('restores focus on deactivate', () => {
    const trigger = document.createElement('button');
    trigger.id = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement?.id).toBe('trigger');

    const container = buildContainer('<button id="inner">inner</button>');

    const { rerender, unmount } = renderHook(({ on }: { on: boolean }) => {
      const ref = useFocusTrap<HTMLDivElement>(on);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container as unknown as HTMLDivElement;
      return ref;
    }, { initialProps: { on: true } });

    // Inside the trap focus was moved to 'inner'.
    // Deactivate — focus should return to 'trigger'.
    rerender({ on: false });
    unmount();
    expect(document.activeElement?.id).toBe('trigger');

    document.body.removeChild(trigger);
    document.body.removeChild(container);
  });

  it('does not crash when container is empty', () => {
    const container = buildContainer('');
    const { result } = renderHook(({ on }: { on: boolean }) => {
      const ref = useFocusTrap<HTMLDivElement>(on);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container as unknown as HTMLDivElement;
      return ref;
    }, { initialProps: { on: true } });

    expect(result.current).toBeDefined();
    // Should focus the container itself as fallback.
    expect(document.activeElement).toBe(container);

    document.body.removeChild(container);
  });

  it('Tab at last focusable wraps to first', () => {
    const container = buildContainer(`
      <button id="a">A</button>
      <button id="b">B</button>
    `);

    renderHook(({ on }: { on: boolean }) => {
      const ref = useFocusTrap<HTMLDivElement>(on);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container as unknown as HTMLDivElement;
      return ref;
    }, { initialProps: { on: true } });

    // Focus the last manually, then simulate Tab.
    (container.querySelector('#b') as HTMLButtonElement).focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    container.dispatchEvent(ev);
    expect(document.activeElement?.id).toBe('a');

    document.body.removeChild(container);
  });

  it('Shift+Tab at first focusable wraps to last', () => {
    const container = buildContainer(`
      <button id="a">A</button>
      <button id="b">B</button>
    `);

    renderHook(({ on }: { on: boolean }) => {
      const ref = useFocusTrap<HTMLDivElement>(on);
      (ref as React.MutableRefObject<HTMLDivElement | null>).current = container as unknown as HTMLDivElement;
      return ref;
    }, { initialProps: { on: true } });

    // After mount, 'a' has focus. Simulate Shift+Tab — should wrap to 'b'.
    const ev = new KeyboardEvent('keydown', {
      key: 'Tab', shiftKey: true, bubbles: true, cancelable: true,
    });
    container.dispatchEvent(ev);
    expect(document.activeElement?.id).toBe('b');

    document.body.removeChild(container);
  });
});
