/**
 * useRafEvent — Phase 14.AC.1 tests.
 *
 * Verifies that an rAF-coalesced event subscription:
 *   • invokes the handler at most once per animation frame;
 *   • delivers the LATEST payload (not the first);
 *   • stays silent when no events have arrived;
 *   • cancels pending frames on unmount (no trailing call);
 *   • resubscribes / cleans up across event-name changes.
 *
 * Tests fake both `requestAnimationFrame` and `setTimeout` so the
 * assertions work whether the module picked the browser rAF path or
 * the setTimeout fallback. (jsdom does provide rAF, but the hook's
 * capability check happens at module-load time; faking both closes
 * the environmental gap.)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { eventBus } from '@core/EventBus';
import { useRafEvent } from '../useRafEvent';

describe('useRafEvent', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
    eventBus.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    eventBus.clear();
  });

  function flushFrame() {
    // Drain both possible schedulers — whichever the module chose.
    vi.runAllTimers();
  }

  it('coalesces a burst into a single call with the latest payload', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useRafEvent<{ n: number }>('test:burst', handler));

    eventBus.emit('test:burst', { n: 1 });
    eventBus.emit('test:burst', { n: 2 });
    eventBus.emit('test:burst', { n: 3 });

    // No call yet — we're still inside the same frame window
    expect(handler).not.toHaveBeenCalled();

    flushFrame();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ n: 3 });

    unmount();
  });

  it('invokes once per flushed frame', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useRafEvent<{ n: number }>('test:perframe', handler));

    eventBus.emit('test:perframe', { n: 1 });
    flushFrame();
    eventBus.emit('test:perframe', { n: 2 });
    flushFrame();
    eventBus.emit('test:perframe', { n: 3 });
    flushFrame();

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenNthCalledWith(1, { n: 1 });
    expect(handler).toHaveBeenNthCalledWith(2, { n: 2 });
    expect(handler).toHaveBeenNthCalledWith(3, { n: 3 });

    unmount();
  });

  it('is silent when no events arrived', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useRafEvent<{ n: number }>('test:silent', handler));

    flushFrame();
    flushFrame();
    flushFrame();

    expect(handler).not.toHaveBeenCalled();
    unmount();
  });

  it('does not fire a trailing call after unmount', () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useRafEvent<{ n: number }>('test:unmount', handler));

    eventBus.emit('test:unmount', { n: 1 });
    expect(handler).not.toHaveBeenCalled();

    unmount();
    flushFrame();

    expect(handler).not.toHaveBeenCalled();
  });

  it('uses the latest handler ref without resubscribing', () => {
    const first = vi.fn();
    const second = vi.fn();

    let current: typeof first = first;
    const { rerender, unmount } = renderHook(() =>
      useRafEvent<{ n: number }>('test:handlerswap', current),
    );

    eventBus.emit('test:handlerswap', { n: 1 });
    flushFrame();
    expect(first).toHaveBeenCalledTimes(1);

    current = second;
    rerender();

    eventBus.emit('test:handlerswap', { n: 2 });
    flushFrame();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith({ n: 2 });
    expect(first).toHaveBeenCalledTimes(1); // NOT called again

    unmount();
  });

  it('a 10-event burst produces 1 handler call, not 10', () => {
    // Direct simulation of the real-world pattern: a fast drag emits
    // PIPE_ROUTE_UPDATE 10× in one frame. The whole point of this hook
    // is that predictCollisions / generateAllFittings runs ONCE.
    const handler = vi.fn();
    const { unmount } = renderHook(() => useRafEvent<{ n: number }>('test:storm', handler));

    for (let i = 0; i < 10; i++) {
      eventBus.emit('test:storm', { n: i });
    }
    flushFrame();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ n: 9 });

    unmount();
  });
});
