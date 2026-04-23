/**
 * Logger — Phase 10.A tests.
 *
 * Every fractal dimension from the prompt gets at least one test:
 *   1. API: factory tags source; leveled methods exist.
 *   2. Storage: ring buffer fills + wraps at capacity.
 *   3. Filtering: level gate drops below-threshold entries.
 *   4. Performance: lazy-eval callback is NOT invoked when below threshold.
 *   5. Subscribers: every emission fans out; unsubscribe works.
 *   6. Correlation: withCorrelation injects id; resets after.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  logger,
  setLogLevel,
  getLogLevel,
  setConsoleMirror,
  getLog,
  clearLog,
  subscribe,
  withCorrelation,
  __resetLoggerForTests,
  type LogEntry,
} from '../Logger';

beforeEach(() => {
  __resetLoggerForTests();
  setConsoleMirror(false);
});

// ── API + source tagging ──────────────────────────────────────

describe('Logger — factory & source tagging', () => {
  it('logger(source) returns an object with all 6 levels', () => {
    const log = logger('Test');
    for (const lvl of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
      expect(typeof log[lvl]).toBe('function');
    }
  });

  it('every emitted entry is tagged with the factory source', () => {
    setLogLevel('trace');
    const a = logger('Alpha');
    const b = logger('Beta');
    a.info('from a');
    b.warn('from b');
    const entries = getLog();
    expect(entries.map((e) => e.source)).toEqual(['Alpha', 'Beta']);
  });
});

// ── Level filtering ──────────────────────────────────────────

describe('Logger — level filtering', () => {
  it('drops entries below the active threshold', () => {
    setLogLevel('warn');
    const log = logger('T');
    log.trace('t'); log.debug('d'); log.info('i');
    log.warn('w');  log.error('e'); log.fatal('f');
    const levels = getLog().map((e) => e.level);
    expect(levels).toEqual(['warn', 'error', 'fatal']);
  });

  it('getLogLevel returns the active threshold', () => {
    setLogLevel('debug');
    expect(getLogLevel()).toBe('debug');
  });

  it('raising the threshold mid-stream affects subsequent calls only', () => {
    setLogLevel('trace');
    const log = logger('T');
    log.trace('keep 1');
    setLogLevel('warn');
    log.trace('drop');
    log.error('keep 2');
    const messages = getLog().map((e) => e.message);
    expect(messages).toEqual(['keep 1', 'keep 2']);
  });
});

// ── Lazy evaluation (performance) ────────────────────────────

describe('Logger — lazy evaluation', () => {
  it('below threshold: lazy callback is NOT invoked', () => {
    setLogLevel('warn');
    const spy = vi.fn(() => 'expensive');
    const log = logger('T');
    log.trace(spy);
    log.debug(spy);
    log.info(spy);
    expect(spy).not.toHaveBeenCalled();
  });

  it('at/above threshold: lazy callback IS invoked exactly once', () => {
    setLogLevel('trace');
    const spy = vi.fn(() => 'computed');
    const log = logger('T');
    log.trace(spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(getLog()[0]!.message).toBe('computed');
  });

  it('lazy callback that throws is captured, not propagated', () => {
    setLogLevel('trace');
    const log = logger('T');
    expect(() => log.trace(() => { throw new Error('boom'); })).not.toThrow();
    expect(getLog()[0]!.message).toMatch(/lazy eval threw/);
  });
});

// ── Ring buffer ──────────────────────────────────────────────

describe('Logger — ring buffer', () => {
  it('buffer caps at 1000 entries', () => {
    setLogLevel('trace');
    const log = logger('T');
    for (let i = 0; i < 1200; i++) log.info(`msg ${i}`);
    expect(getLog()).toHaveLength(1000);
    // Oldest visible should be msg 200 (we emitted 0..1199, buffer drops first 200).
    expect(getLog()[0]!.message).toBe('msg 200');
    expect(getLog()[999]!.message).toBe('msg 1199');
  });

  it('clearLog resets the buffer', () => {
    setLogLevel('trace');
    logger('T').info('a');
    expect(getLog()).toHaveLength(1);
    clearLog();
    expect(getLog()).toHaveLength(0);
  });
});

// ── Subscribers ──────────────────────────────────────────────

describe('Logger — subscribers', () => {
  it('every emission fans out to subscribers', () => {
    setLogLevel('info');
    const seen: LogEntry[] = [];
    const unsub = subscribe((e) => seen.push(e));
    const log = logger('S');
    log.info('one');
    log.warn('two');
    unsub();
    log.error('three after unsub');
    expect(seen.map((e) => e.message)).toEqual(['one', 'two']);
  });

  it('subscriber throws never break emission or other subscribers', () => {
    setLogLevel('info');
    const thrower = () => { throw new Error('sub blew up'); };
    const seen: string[] = [];
    subscribe(thrower);
    subscribe((e) => seen.push(e.message));
    logger('S').info('a');
    expect(seen).toEqual(['a']);
    // Ring buffer still captured the entry.
    expect(getLog()[0]!.message).toBe('a');
  });
});

// ── Correlation ──────────────────────────────────────────────

describe('Logger — withCorrelation', () => {
  it('injects correlationId on logs inside the callback', () => {
    setLogLevel('info');
    const log = logger('C');
    log.info('before');
    withCorrelation('corr-abc', () => {
      log.info('during');
    });
    log.info('after');
    const entries = getLog();
    expect(entries[0]!.correlationId).toBeUndefined();
    expect(entries[1]!.correlationId).toBe('corr-abc');
    expect(entries[2]!.correlationId).toBeUndefined();
  });

  it('nested withCorrelation stacks + restores', () => {
    setLogLevel('info');
    const log = logger('C');
    withCorrelation('outer', () => {
      log.info('a');
      withCorrelation('inner', () => {
        log.info('b');
      });
      log.info('c');
    });
    const ids = getLog().map((e) => e.correlationId);
    expect(ids).toEqual(['outer', 'inner', 'outer']);
  });

  it('returns the callback\'s return value', () => {
    const r = withCorrelation('x', () => 42);
    expect(r).toBe(42);
  });

  it('restores correlationId even if callback throws', () => {
    setLogLevel('info');
    const log = logger('C');
    try {
      withCorrelation('oops', () => { throw new Error('bad'); });
    } catch { /* expected */ }
    log.info('after');
    expect(getLog()[0]!.correlationId).toBeUndefined();
  });
});

// ── Args + message formatting ────────────────────────────────

describe('Logger — args', () => {
  it('preserves variadic args alongside the message', () => {
    setLogLevel('info');
    logger('T').info('slow', { ms: 420 }, 'extra');
    const e = getLog()[0]!;
    expect(e.message).toBe('slow');
    expect(e.args).toEqual([{ ms: 420 }, 'extra']);
  });

  it('non-string first arg is coerced via String()', () => {
    setLogLevel('info');
    logger('T').info(42 as unknown as string);
    expect(getLog()[0]!.message).toBe('42');
  });
});
