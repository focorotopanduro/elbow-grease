/**
 * useInteractiveButton — unit + integration tests.
 *
 * Exercises the four edge cases documented at the top of the hook:
 *
 *   1. Mouseleave during press releases BOTH hovered and pressed.
 *   2. MouseUp always clears press.
 *   3. Focused + hovered can stack on the same button.
 *   4. Binding identity is stable across renders (React handler
 *      attachment isn't thrashed on parent re-renders).
 *
 * Plus a small integration test that spreads the bindings onto a real
 * `<button>` and fires synthetic events to confirm the full loop.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, render, fireEvent, cleanup, act } from '@testing-library/react';
import { useInteractiveButton } from '../useInteractiveButton';

afterEach(() => {
  cleanup();
});

describe('useInteractiveButton — initial state', () => {
  it('all three flags start false', () => {
    const { result } = renderHook(() => useInteractiveButton());
    expect(result.current.hovered).toBe(false);
    expect(result.current.pressed).toBe(false);
    expect(result.current.focused).toBe(false);
  });

  it('returns a bindings object with all six handlers', () => {
    const { result } = renderHook(() => useInteractiveButton());
    const b = result.current.bindings;
    expect(typeof b.onMouseEnter).toBe('function');
    expect(typeof b.onMouseLeave).toBe('function');
    expect(typeof b.onMouseDown).toBe('function');
    expect(typeof b.onMouseUp).toBe('function');
    expect(typeof b.onFocus).toBe('function');
    expect(typeof b.onBlur).toBe('function');
  });
});

describe('useInteractiveButton — hover lifecycle', () => {
  it('onMouseEnter sets hovered=true', () => {
    const { result } = renderHook(() => useInteractiveButton());
    act(() => result.current.bindings.onMouseEnter());
    expect(result.current.hovered).toBe(true);
  });

  it('onMouseLeave clears hovered', () => {
    const { result } = renderHook(() => useInteractiveButton());
    act(() => result.current.bindings.onMouseEnter());
    act(() => result.current.bindings.onMouseLeave());
    expect(result.current.hovered).toBe(false);
  });
});

describe('useInteractiveButton — press lifecycle', () => {
  it('onMouseDown sets pressed=true', () => {
    const { result } = renderHook(() => useInteractiveButton());
    act(() => result.current.bindings.onMouseDown());
    expect(result.current.pressed).toBe(true);
  });

  it('onMouseUp clears pressed', () => {
    const { result } = renderHook(() => useInteractiveButton());
    act(() => result.current.bindings.onMouseDown());
    act(() => result.current.bindings.onMouseUp());
    expect(result.current.pressed).toBe(false);
  });

  it('onMouseLeave during press releases BOTH hovered AND pressed (drag-off abort)', () => {
    const { result } = renderHook(() => useInteractiveButton());
    // Simulate user hovering, pressing, then dragging off.
    act(() => result.current.bindings.onMouseEnter());
    act(() => result.current.bindings.onMouseDown());
    expect(result.current.hovered).toBe(true);
    expect(result.current.pressed).toBe(true);

    act(() => result.current.bindings.onMouseLeave());

    // Both flags cleared — button snaps back to rest even though
    // there was no mouseup on it.
    expect(result.current.hovered).toBe(false);
    expect(result.current.pressed).toBe(false);
  });
});

describe('useInteractiveButton — focus lifecycle', () => {
  it('onFocus sets focused=true', () => {
    const { result } = renderHook(() => useInteractiveButton());
    act(() => result.current.bindings.onFocus());
    expect(result.current.focused).toBe(true);
  });

  it('onBlur clears focused', () => {
    const { result } = renderHook(() => useInteractiveButton());
    act(() => result.current.bindings.onFocus());
    act(() => result.current.bindings.onBlur());
    expect(result.current.focused).toBe(false);
  });

  it('focused does NOT clear when the mouse leaves (keyboard-only users keep their ring)', () => {
    const { result } = renderHook(() => useInteractiveButton());
    act(() => result.current.bindings.onFocus());
    act(() => result.current.bindings.onMouseLeave());
    // Focus ring should persist — tabbing off is the only way to
    // clear focus.
    expect(result.current.focused).toBe(true);
  });
});

describe('useInteractiveButton — state stacking', () => {
  it('focused + hovered can both be true simultaneously', () => {
    const { result } = renderHook(() => useInteractiveButton());
    act(() => result.current.bindings.onFocus());
    act(() => result.current.bindings.onMouseEnter());
    expect(result.current.focused).toBe(true);
    expect(result.current.hovered).toBe(true);
  });

  it('hovered + pressed can both be true (mid-click)', () => {
    const { result } = renderHook(() => useInteractiveButton());
    act(() => result.current.bindings.onMouseEnter());
    act(() => result.current.bindings.onMouseDown());
    expect(result.current.hovered).toBe(true);
    expect(result.current.pressed).toBe(true);
  });

  it('all three can be true (keyboard user pressed into their focused button with mouse)', () => {
    const { result } = renderHook(() => useInteractiveButton());
    act(() => result.current.bindings.onFocus());
    act(() => result.current.bindings.onMouseEnter());
    act(() => result.current.bindings.onMouseDown());
    expect(result.current.hovered).toBe(true);
    expect(result.current.pressed).toBe(true);
    expect(result.current.focused).toBe(true);
  });
});

describe('useInteractiveButton — binding identity stability', () => {
  it('bindings object identity survives re-renders (stable handlers)', () => {
    const { result, rerender } = renderHook(() => useInteractiveButton());
    const firstBindings = result.current.bindings;

    // Trigger a state change — a re-render is forced.
    act(() => result.current.bindings.onMouseEnter());
    rerender();
    act(() => result.current.bindings.onFocus());
    rerender();

    // Still the same object — React won't detach / reattach the
    // handlers on the child button.
    expect(result.current.bindings).toBe(firstBindings);
  });
});

describe('useInteractiveButton — integration on a real <button>', () => {
  function DemoButton() {
    const { hovered, pressed, focused, bindings } = useInteractiveButton();
    return (
      <button
        data-testid="btn"
        data-hovered={hovered}
        data-pressed={pressed}
        data-focused={focused}
        {...bindings}
      >
        hit me
      </button>
    );
  }

  it('data-attributes track hover/press/focus through synthetic events', () => {
    const { getByTestId } = render(<DemoButton />);
    const btn = getByTestId('btn');

    expect(btn.dataset.hovered).toBe('false');
    expect(btn.dataset.pressed).toBe('false');
    expect(btn.dataset.focused).toBe('false');

    fireEvent.mouseEnter(btn);
    expect(btn.dataset.hovered).toBe('true');

    fireEvent.mouseDown(btn);
    expect(btn.dataset.pressed).toBe('true');

    fireEvent.mouseUp(btn);
    expect(btn.dataset.pressed).toBe('false');

    fireEvent.focus(btn);
    expect(btn.dataset.focused).toBe('true');

    fireEvent.blur(btn);
    expect(btn.dataset.focused).toBe('false');

    fireEvent.mouseLeave(btn);
    expect(btn.dataset.hovered).toBe('false');
  });

  it('drag-off during press clears both hover and press (integration)', () => {
    const { getByTestId } = render(<DemoButton />);
    const btn = getByTestId('btn');

    fireEvent.mouseEnter(btn);
    fireEvent.mouseDown(btn);
    expect(btn.dataset.hovered).toBe('true');
    expect(btn.dataset.pressed).toBe('true');

    // User drags off without releasing — both clear.
    fireEvent.mouseLeave(btn);
    expect(btn.dataset.hovered).toBe('false');
    expect(btn.dataset.pressed).toBe('false');
  });
});
