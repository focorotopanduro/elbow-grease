/**
 * SessionTelemetry — Phase 10.E tests.
 *
 * Covers:
 *   • start() → subscribes, initializes session + bucket
 *   • start() resumes a recent session from localStorage
 *   • start() discards a stale session (older than SESSION_MAX_AGE_MS)
 *   • start() discards a session from a different appVersion
 *   • PerfStats sampling populates bucket reservoirs (with dedup on
 *     repeated worker-latency reads)
 *   • Command bus subscription populates command counts
 *   • Logger subscription counts warn/error/fatal correctly
 *   • forceRollover produces a bucket with correct aggregates (mean, p50, p95)
 *   • MAX_BUCKETS cap enforced
 *   • stop() unsubscribes but keeps session accessible for export
 *   • reset() zeroes everything
 *   • exportJSON returns a valid JSON string
 *   • exportJSONL emits header + 1 line per bucket
 *   • buckets with no activity are not recorded (empty-rollover is a no-op)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  start,
  stop,
  reset,
  getSession,
  flushBucket,
  exportJSON,
  exportJSONL,
  isCollecting,
  __testables,
  type TelemetrySession,
} from '../SessionTelemetry';
import { commandBus } from '@core/commands/CommandBus';
import { __resetLoggerForTests } from '@core/logger/Logger';

// ── Utilities ──────────────────────────────────────────────────

function freshSample(overrides: Partial<{
  fps: number;
  frameTimeMs: number;
  workerLatencyMs: number;
}> = {}) {
  return {
    fps: 60,
    frameTimeMs: 16.6,
    workerLatencyMs: 0,
    frameTimeHistory: new Float32Array(0),
    meanFrameTimeMs: 0,
    p95FrameTimeMs: 0,
    workerLatencyP95: 0,
    drawCalls: 0,
    triangles: 0,
    heapUsedMB: null,
    heapLimitMB: null,
    pipeLoop: {
      cacheHits: 0,
      cacheMisses: 0,
      cacheCalls: 0,
      cacheHitRate: 1,
      lastBatchOps: 0,
      rafEmissionsReceived: 0,
      rafInvocationsFired: 0,
      rafDropRate: 0,
    },
    ...overrides,
  };
}

beforeEach(() => {
  reset();
  __resetLoggerForTests();
  // Wipe the commandBus log to isolate test command counts.
  commandBus.clearLog();
  // Also wipe localStorage so prior tests don't leak state.
  try { localStorage.clear(); } catch { /* ignore */ }
});

afterEach(() => {
  reset();
  try { localStorage.clear(); } catch { /* ignore */ }
});

// ── Tests ──────────────────────────────────────────────────────

describe('start()', () => {
  it('is idempotent — second start() is a no-op', () => {
    const first = vi.fn();
    start({ persist: first, sessionIdFactory: () => 'id-1' });
    const sessA = getSession();
    start({ persist: first, sessionIdFactory: () => 'id-2' });
    const sessB = getSession();
    expect(sessA?.sessionId).toBe('id-1');
    expect(sessB?.sessionId).toBe('id-1');
  });

  it('creates a session with a unique id on first start', () => {
    start({ sessionIdFactory: () => 'abc' });
    const s = getSession();
    expect(s?.sessionId).toBe('abc');
    expect(s?.buckets).toEqual([]);
  });

  it('resumes a recent session from localStorage', () => {
    const existing: TelemetrySession = {
      sessionId: 'resumed',
      sessionStartTs: Date.now() - 5 * 60 * 1000, // 5 min old
      appVersion: 'v1',
      userAgent: 'test-agent',
      buckets: [{
        bucketStartTs: Date.now() - 2 * 60 * 1000,
        durationMs: 60_000,
        fps: { mean: 60, p50: 60, p95: 59, min: 58, samples: 60 },
        frameTimeMs: { mean: 16.6, p95: 17, max: 20 },
        workerLatencyMs: { mean: 0, p95: 0, count: 0 },
        commandCount: 10,
        commandRejections: 0,
        commandsByType: { 'pipe.add': 10 },
        warnings: 0, errors: 0, fatals: 0,
        pipeCount: 5, fixtureCount: 3,
      }],
    };
    localStorage.setItem('elbow-grease-telemetry', JSON.stringify(existing));
    start({ appVersion: 'v1', sessionIdFactory: () => 'new-id' });
    expect(getSession()?.sessionId).toBe('resumed');
    expect(getSession()?.buckets.length).toBe(1);
  });

  it('discards a stale session (> SESSION_MAX_AGE_MS)', () => {
    const stale: TelemetrySession = {
      sessionId: 'stale',
      sessionStartTs: Date.now() - __testables.SESSION_MAX_AGE_MS - 1000,
      appVersion: 'v1',
      userAgent: 'test-agent',
      buckets: [],
    };
    localStorage.setItem('elbow-grease-telemetry', JSON.stringify(stale));
    start({ appVersion: 'v1', sessionIdFactory: () => 'fresh' });
    expect(getSession()?.sessionId).toBe('fresh');
  });

  it('discards a session with a mismatched app version', () => {
    const oldVersion: TelemetrySession = {
      sessionId: 'older',
      sessionStartTs: Date.now() - 60_000,
      appVersion: 'v1.0.0',
      userAgent: 'test-agent',
      buckets: [],
    };
    localStorage.setItem('elbow-grease-telemetry', JSON.stringify(oldVersion));
    start({ appVersion: 'v2.0.0', sessionIdFactory: () => 'fresh2' });
    expect(getSession()?.sessionId).toBe('fresh2');
  });

  it('isCollecting() reports true after start and false after stop', () => {
    expect(isCollecting()).toBe(false);
    start();
    expect(isCollecting()).toBe(true);
    stop();
    expect(isCollecting()).toBe(false);
  });
});

describe('PerfSample ingestion', () => {
  beforeEach(() => { start({ sessionIdFactory: () => 's' }); });

  it('accumulates fps + frame-time samples', () => {
    __testables.feedPerfSample(freshSample({ fps: 60, frameTimeMs: 16.6 }));
    __testables.feedPerfSample(freshSample({ fps: 58, frameTimeMs: 17.2 }));
    expect(__testables.fpsSampleCount).toBe(2);
  });

  it('de-duplicates a repeated worker latency read', () => {
    // Three identical reads → only one latency sample.
    __testables.feedPerfSample(freshSample({ workerLatencyMs: 12.3 }));
    __testables.feedPerfSample(freshSample({ workerLatencyMs: 12.3 }));
    __testables.feedPerfSample(freshSample({ workerLatencyMs: 12.3 }));
    const captured: TelemetrySession[] = [];
    __testables.forceRollover((s) => captured.push(JSON.parse(JSON.stringify(s))));
    expect(captured[0]!.buckets[0]!.workerLatencyMs.count).toBe(1);
  });

  it('captures separate latency samples when values change', () => {
    __testables.feedPerfSample(freshSample({ workerLatencyMs: 5 }));
    __testables.feedPerfSample(freshSample({ workerLatencyMs: 10 }));
    __testables.feedPerfSample(freshSample({ workerLatencyMs: 15 }));
    const captured: TelemetrySession[] = [];
    __testables.forceRollover((s) => captured.push(JSON.parse(JSON.stringify(s))));
    expect(captured[0]!.buckets[0]!.workerLatencyMs.count).toBe(3);
  });

  it('skips fps=0 and dt=0 noise', () => {
    __testables.feedPerfSample(freshSample({ fps: 0, frameTimeMs: 0 }));
    expect(__testables.fpsSampleCount).toBe(0);
  });
});

describe('commandBus subscription', () => {
  beforeEach(() => { start({ sessionIdFactory: () => 's' }); });

  it('counts dispatched commands and flags rejections', () => {
    // CommandBus auto-rejects unregistered types + still notifies
    // subscribers with a rejected entry — we can use that to exercise
    // the counting path without touching real handlers.
    commandBus.dispatch({ type: 'test.never-registered', payload: {}, issuedBy: 'replay' });
    commandBus.dispatch({ type: 'test.never-registered', payload: {}, issuedBy: 'replay' });
    expect(__testables.commandCount).toBe(2);
    // Both were rejections (no handler).
    const captured: TelemetrySession[] = [];
    __testables.forceRollover((s) => captured.push(JSON.parse(JSON.stringify(s))));
    expect(captured[0]!.buckets[0]!.commandRejections).toBe(2);
    expect(captured[0]!.buckets[0]!.commandsByType['test.never-registered']).toBe(2);
  });
});

describe('bucket rollover', () => {
  beforeEach(() => { start({ sessionIdFactory: () => 's' }); });

  it('produces mean, p50, p95 over a known FPS series', () => {
    // Feed a known distribution: 20 samples of [50..59]
    for (let i = 0; i < 20; i++) {
      __testables.feedPerfSample(freshSample({ fps: 50 + (i % 10), frameTimeMs: 16 }));
    }
    const captured: TelemetrySession[] = [];
    __testables.forceRollover((s) => captured.push(JSON.parse(JSON.stringify(s))));
    const b = captured[0]!.buckets[0]!;
    // mean of [50..59] × 2 = 54.5
    expect(b.fps.mean).toBeCloseTo(54.5, 1);
    expect(b.fps.samples).toBe(20);
    expect(b.fps.min).toBe(50);
    expect(b.fps.p95).toBeGreaterThanOrEqual(58);
  });

  it('does NOT push an empty bucket (no samples, no commands, no warnings)', () => {
    __testables.forceRollover(() => {});
    expect(getSession()?.buckets.length).toBe(0);
  });

  it('persists via the supplied callback on rollover', () => {
    __testables.feedPerfSample(freshSample({ fps: 55 }));
    const persisted: TelemetrySession[] = [];
    __testables.forceRollover((s) => persisted.push(s));
    expect(persisted.length).toBe(1);
    expect(persisted[0]!.buckets.length).toBe(1);
  });

  it('caps retention at MAX_BUCKETS', () => {
    for (let i = 0; i < __testables.MAX_BUCKETS + 5; i++) {
      __testables.feedPerfSample(freshSample({ fps: 55 + i * 0.1 }));
      __testables.forceRollover(() => {});
    }
    expect(getSession()!.buckets.length).toBe(__testables.MAX_BUCKETS);
  });
});

describe('stop()', () => {
  it('unsubscribes but keeps session data accessible', () => {
    start({ sessionIdFactory: () => 'alpha' });
    __testables.feedPerfSample(freshSample({ fps: 60 }));
    __testables.forceRollover(() => {});
    stop();
    expect(isCollecting()).toBe(false);
    // Session + bucket still present.
    expect(getSession()?.sessionId).toBe('alpha');
    expect(getSession()?.buckets.length).toBe(1);
  });
});

describe('reset()', () => {
  it('drops session, buckets, and localStorage', () => {
    start({ sessionIdFactory: () => 'beta' });
    __testables.feedPerfSample(freshSample({ fps: 60 }));
    __testables.forceRollover(() => {});
    expect(getSession()).not.toBeNull();
    reset();
    expect(getSession()).toBeNull();
    expect(localStorage.getItem('elbow-grease-telemetry')).toBeNull();
  });
});

describe('exports', () => {
  it('exportJSON returns valid JSON of the session', () => {
    start({ sessionIdFactory: () => 'exp' });
    __testables.feedPerfSample(freshSample({ fps: 55 }));
    __testables.forceRollover(() => {});
    const json = exportJSON();
    const parsed = JSON.parse(json);
    expect(parsed.sessionId).toBe('exp');
    expect(parsed.buckets.length).toBe(1);
  });

  it('exportJSONL emits header + one line per bucket', () => {
    start({ sessionIdFactory: () => 'jl' });
    __testables.feedPerfSample(freshSample({ fps: 55 }));
    __testables.forceRollover(() => {});
    __testables.feedPerfSample(freshSample({ fps: 50 }));
    __testables.forceRollover(() => {});

    const jsonl = exportJSONL();
    const lines = jsonl.trim().split('\n');
    expect(lines.length).toBe(3); // header + 2 buckets
    const header = JSON.parse(lines[0]!);
    expect(header.sessionId).toBe('jl');
    expect('buckets' in header).toBe(false); // stripped
    const b0 = JSON.parse(lines[1]!);
    expect(b0.bucketStartTs).toBeGreaterThan(0);
  });

  it('exportJSON returns empty-object string when no session', () => {
    expect(exportJSON()).toBe('{}');
  });

  it('exportJSONL returns empty string when no session', () => {
    expect(exportJSONL()).toBe('');
  });
});

describe('flushBucket', () => {
  it('closes the current bucket immediately', () => {
    start({ sessionIdFactory: () => 'flush' });
    __testables.feedPerfSample(freshSample({ fps: 60 }));
    expect(getSession()?.buckets.length).toBe(0);
    flushBucket(() => {});
    expect(getSession()?.buckets.length).toBe(1);
  });
});

