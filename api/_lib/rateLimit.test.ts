/**
 * Rate limiter — contract tests.
 *
 * Locks the post-fix behavior of `api/_lib/rateLimit.ts`. The
 * critical fix here was C1 from the security review: replacing the
 * two-call INCR + EXPIRE sequence with a pipelined INCR + EXPIRE NX
 * to prevent orphan-key permanent lockout when EXPIRE failed after
 * INCR succeeded. These tests prove the fix works + catch regressions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock kvPipeline before importing the module under test
vi.mock('./kv', () => ({
  kvPipeline: vi.fn(),
}));

import { kvPipeline } from './kv';
import { rateLimitCheck } from './rateLimit';

const kvPipelineMock = kvPipeline as unknown as ReturnType<typeof vi.fn>;

describe('rateLimitCheck', () => {
  beforeEach(() => {
    kvPipelineMock.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('allows the first request in a window (count=1)', async () => {
    // INCR returns 1, EXPIRE returns 1 (TTL set successfully)
    kvPipelineMock.mockResolvedValueOnce([1, 1]);

    const result = await rateLimitCheck({
      prefix: 'test',
      bucket: '1.2.3.4',
      limit: 10,
      windowSeconds: 60,
    });

    expect(result.limited).toBe(false);
    expect(result.count).toBe(1);
    expect(result.applied).toBe(true);
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });

  it('allows requests up to the limit', async () => {
    kvPipelineMock.mockResolvedValueOnce([10, 0]); // 10th request, EXPIRE NX no-op

    const result = await rateLimitCheck({
      prefix: 'test',
      bucket: '1.2.3.4',
      limit: 10,
      windowSeconds: 60,
    });

    expect(result.limited).toBe(false);
    expect(result.count).toBe(10);
  });

  it('rejects requests over the limit', async () => {
    kvPipelineMock.mockResolvedValueOnce([11, 0]);

    const result = await rateLimitCheck({
      prefix: 'test',
      bucket: '1.2.3.4',
      limit: 10,
      windowSeconds: 60,
    });

    expect(result.limited).toBe(true);
    expect(result.count).toBe(11);
    expect(result.applied).toBe(true);
  });

  it('FAILS OPEN when KV returns null (KV down)', async () => {
    // The fail-open philosophy: if KV is down, allow requests through.
    // The upstream Vercel edge has its own DDoS protection; we'd rather
    // lose a rate-limit window than reject legitimate users when our
    // storage layer hiccups.
    kvPipelineMock.mockResolvedValueOnce([null, null]);

    const result = await rateLimitCheck({
      prefix: 'test',
      bucket: '1.2.3.4',
      limit: 10,
      windowSeconds: 60,
    });

    expect(result.limited).toBe(false);
    expect(result.applied).toBe(false);
  });

  it('FAILS OPEN when kvPipeline throws (network error)', async () => {
    kvPipelineMock.mockRejectedValueOnce(new Error('network down'));

    const result = await rateLimitCheck({
      prefix: 'test',
      bucket: '1.2.3.4',
      limit: 10,
      windowSeconds: 60,
    });

    expect(result.limited).toBe(false);
    expect(result.applied).toBe(false);
  });

  it('uses a SINGLE pipeline call for INCR + EXPIRE (the C1 fix)', async () => {
    // CRITICAL: the previous implementation made TWO separate kvCommand
    // calls (INCR then EXPIRE). If EXPIRE failed after INCR succeeded,
    // the key persisted with no TTL and the bucket got permanently
    // locked once count crossed the limit. The fix uses kvPipeline
    // so both commands go in one round-trip — atomic from the network
    // perspective, no orphan-key risk.
    kvPipelineMock.mockResolvedValueOnce([1, 1]);

    await rateLimitCheck({
      prefix: 'test',
      bucket: '1.2.3.4',
      limit: 10,
      windowSeconds: 60,
    });

    expect(kvPipelineMock).toHaveBeenCalledTimes(1);
    const callArgs = kvPipelineMock.mock.calls[0][0];
    // Pipeline should have INCR followed by EXPIRE NX
    expect(callArgs).toHaveLength(2);
    expect(callArgs[0][0]).toBe('INCR');
    expect(callArgs[1][0]).toBe('EXPIRE');
    expect(callArgs[1][3]).toBe('NX'); // NX flag — defends against sliding-TTL attack
  });

  it('uses EXPIRE NX flag (idempotent; no sliding-TTL attack)', async () => {
    // The previous design only set TTL on count===1, which had a
    // race. The fix uses EXPIRE ... NX which only sets the TTL if
    // there isn't one — safe to call on every request. This test
    // pins the NX flag presence.
    kvPipelineMock.mockResolvedValueOnce([5, 0]);

    await rateLimitCheck({
      prefix: 'test',
      bucket: '1.2.3.4',
      limit: 10,
      windowSeconds: 60,
    });

    const callArgs = kvPipelineMock.mock.calls[0][0];
    expect(callArgs[1]).toContain('NX');
  });

  it('builds keys with namespace prefix (no cross-endpoint contamination)', async () => {
    // Each endpoint uses its own prefix ('lead-ip', 'event-ip',
    // 'lead-phone', etc) so a flood on one doesn't affect the
    // others. Test that the prefix is honored.
    kvPipelineMock.mockResolvedValueOnce([1, 1]);

    await rateLimitCheck({
      prefix: 'special-namespace',
      bucket: 'abc',
      limit: 10,
      windowSeconds: 60,
    });

    const incrCmd = kvPipelineMock.mock.calls[0][0][0];
    const key = incrCmd[1] as string;
    expect(key).toContain('rl:special-namespace:');
  });

  it('sanitizes the bucket value (no key-collision attacks)', async () => {
    // An attacker submitting a bucket value with control chars or
    // colons could potentially collide their key with another
    // user's key, getting their counter reset. The bucket must be
    // sanitized before being used as part of a Redis key.
    kvPipelineMock.mockResolvedValueOnce([1, 1]);

    await rateLimitCheck({
      prefix: 'test',
      bucket: 'evil:::::injected',
      limit: 10,
      windowSeconds: 60,
    });

    const key = kvPipelineMock.mock.calls[0][0][0][1] as string;
    // Sanitization strips colons (key-separator chars) so the
    // attacker can't escape into another namespace.
    expect(key).not.toContain('evil:::::');
    expect(key).toContain('evilinjected'); // colons stripped
  });

  it('falls back to "unknown" bucket if all chars are stripped', async () => {
    kvPipelineMock.mockResolvedValueOnce([1, 1]);

    await rateLimitCheck({
      prefix: 'test',
      bucket: '@#$%^&*()',
      limit: 10,
      windowSeconds: 60,
    });

    const key = kvPipelineMock.mock.calls[0][0][0][1] as string;
    expect(key).toContain(':unknown:');
  });

  it('returns resetAt timestamp aligned to the window boundary', async () => {
    kvPipelineMock.mockResolvedValueOnce([1, 1]);

    const before = Date.now();
    const result = await rateLimitCheck({
      prefix: 'test',
      bucket: 'x',
      limit: 10,
      windowSeconds: 60,
    });

    // resetAt should be at most one window-length in the future
    const windowMs = 60 * 1000;
    expect(result.resetAt).toBeGreaterThan(before);
    expect(result.resetAt).toBeLessThanOrEqual(before + windowMs);
  });

  it('different windows produce different keys (window boundary stability)', async () => {
    // Across two distinct windows the same bucket should get
    // distinct keys so the counter resets at boundary.
    kvPipelineMock.mockResolvedValue([1, 1]);

    const r1 = rateLimitCheck({
      prefix: 'test',
      bucket: 'x',
      limit: 10,
      windowSeconds: 60,
    });
    await r1;
    const key1 = kvPipelineMock.mock.calls[0][0][0][1] as string;

    // Mock Date.now to be in next window
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    kvPipelineMock.mockClear();

    const r2 = rateLimitCheck({
      prefix: 'test',
      bucket: 'x',
      limit: 10,
      windowSeconds: 60,
    });
    await r2;
    const key2 = kvPipelineMock.mock.calls[0][0][0][1] as string;

    Date.now = realNow;

    expect(key1).not.toBe(key2);
  });
});
