/**
 * lazyImport — Phase 10.B tests.
 *
 * Covers:
 *   • Cache: two .get() calls resolve to the same module without
 *     invoking the factory twice.
 *   • prewarm() + get() share the in-flight promise.
 *   • Failure clears cache so a retry can succeed.
 *   • isReady() flips true on success.
 *   • hoverPrewarm delays; cancels on onLeave within delay.
 *   • reset() clears the cached module (test-only affordance).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeLazyLoader, hoverPrewarm } from '../lazyImport';

describe('makeLazyLoader — caching', () => {
  it('calling get() twice invokes the factory ONCE', async () => {
    const factory = vi.fn(() => Promise.resolve({ value: 42 }));
    const loader = makeLazyLoader('test-a', factory);
    const a = await loader.get();
    const b = await loader.get();
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('prewarm() + get() share the same promise', async () => {
    const factory = vi.fn(() => Promise.resolve({ value: 7 }));
    const loader = makeLazyLoader('test-b', factory);
    loader.prewarm();
    loader.prewarm();
    const mod = await loader.get();
    expect(mod.value).toBe(7);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('isReady is false before load, true after', async () => {
    const loader = makeLazyLoader('test-c', () => Promise.resolve(null));
    expect(loader.isReady()).toBe(false);
    await loader.get();
    expect(loader.isReady()).toBe(true);
  });
});

describe('makeLazyLoader — error recovery', () => {
  it('failed load clears cache; retry can succeed', async () => {
    let attempts = 0;
    const factory = vi.fn(() => {
      attempts++;
      if (attempts < 2) return Promise.reject(new Error('network'));
      return Promise.resolve({ ok: true });
    });
    const loader = makeLazyLoader('test-d', factory);

    await expect(loader.get()).rejects.toThrow('network');
    expect(loader.isReady()).toBe(false);

    const mod = await loader.get();
    expect(mod.ok).toBe(true);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('isReady stays false after failed load', async () => {
    const loader = makeLazyLoader('test-e', () => Promise.reject(new Error('boom')));
    await loader.get().catch(() => undefined);
    expect(loader.isReady()).toBe(false);
  });
});

describe('makeLazyLoader — reset', () => {
  it('reset() clears cache; next get() refetches', async () => {
    const factory = vi.fn(() => Promise.resolve({ v: 1 }));
    const loader = makeLazyLoader('test-f', factory);
    await loader.get();
    loader.reset();
    await loader.get();
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe('hoverPrewarm', () => {
  beforeEach(() => vi.useFakeTimers());

  it('fires prewarm after delay', () => {
    const factory = vi.fn(() => Promise.resolve({}));
    const loader = makeLazyLoader('test-g', factory);
    const hp = hoverPrewarm(loader, 500);
    hp.onEnter();
    expect(factory).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('cancels if onLeave fires before delay', () => {
    const factory = vi.fn(() => Promise.resolve({}));
    const loader = makeLazyLoader('test-h', factory);
    const hp = hoverPrewarm(loader, 500);
    hp.onEnter();
    vi.advanceTimersByTime(200);
    hp.onLeave();
    vi.advanceTimersByTime(1000);
    expect(factory).not.toHaveBeenCalled();
  });

  it('does NOT re-fire if loader is already ready', async () => {
    const factory = vi.fn(() => Promise.resolve({}));
    const loader = makeLazyLoader('test-i', factory);
    // Pre-load
    vi.useRealTimers();
    await loader.get();
    vi.useFakeTimers();
    expect(factory).toHaveBeenCalledTimes(1);

    const hp = hoverPrewarm(loader, 500);
    hp.onEnter();
    vi.advanceTimersByTime(500);
    // Still just 1 — hover was a no-op because loader.isReady()
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('multiple overlapping onEnter calls still only arm one timer', () => {
    const factory = vi.fn(() => Promise.resolve({}));
    const loader = makeLazyLoader('test-j', factory);
    const hp = hoverPrewarm(loader, 500);
    hp.onEnter();
    hp.onEnter();
    hp.onEnter();
    vi.advanceTimersByTime(500);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
