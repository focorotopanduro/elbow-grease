/**
 * Structured logger — contract tests.
 *
 * Locks the post-fix behavior of `api/_lib/logger.ts`. The logger is
 * the single chokepoint where user-controlled data may end up in
 * production log sinks; if any of these tests regress, log injection
 * + log spoofing become possible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

interface CapturedLine {
  channel: 'log' | 'error';
  data: Record<string, unknown>;
}

/** Capture every console.log + console.error call from the logger
 *  and return them as parsed JSON objects. The logger writes one
 *  single-line JSON object per call, so every captured arg should
 *  parse cleanly. */
function captureLogs(): { lines: CapturedLine[]; restore: () => void } {
  const lines: CapturedLine[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((arg: unknown) => {
    lines.push({ channel: 'log', data: JSON.parse(String(arg)) });
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((arg: unknown) => {
    lines.push({ channel: 'error', data: JSON.parse(String(arg)) });
  });
  return {
    lines,
    restore: () => {
      logSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

describe('logger — output shape', () => {
  let capture: ReturnType<typeof captureLogs>;
  beforeEach(() => { capture = captureLogs(); });
  afterEach(() => { capture.restore(); });

  it('produces single-line JSON with required fields', () => {
    logger('test/source').info('hello', { foo: 'bar' });
    expect(capture.lines).toHaveLength(1);
    const { data } = capture.lines[0];
    expect(data.level).toBe('info');
    expect(data.source).toBe('test/source');
    expect(data.msg).toBe('hello');
    expect(data.foo).toBe('bar');
    expect(typeof data.ts).toBe('string');
    // ISO 8601 timestamp shape
    expect(data.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('routes warn + error to stderr (console.error)', () => {
    const log = logger('s');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    const channels = capture.lines.map((l) => l.channel);
    expect(channels).toEqual(['log', 'log', 'error', 'error']);
  });

  it('merges baseFields into every line', () => {
    const log = logger('s', { reqId: 'req-ABC', deploy: 'v1' });
    log.info('first');
    log.error('second');

    expect(capture.lines[0].data.reqId).toBe('req-ABC');
    expect(capture.lines[0].data.deploy).toBe('v1');
    expect(capture.lines[1].data.reqId).toBe('req-ABC');
    expect(capture.lines[1].data.deploy).toBe('v1');
  });

  it('child() inherits + extends base fields', () => {
    const root = logger('s', { reqId: 'r1' });
    const child = root.child({ userId: 'u1' });
    child.info('child line');

    const data = capture.lines[0].data;
    expect(data.reqId).toBe('r1');
    expect(data.userId).toBe('u1');
    expect(data.source).toBe('s');
  });
});

describe('logger — sanitization (log injection defense)', () => {
  let capture: ReturnType<typeof captureLogs>;
  beforeEach(() => { capture = captureLogs(); });
  afterEach(() => { capture.restore(); });

  it('strips newlines from string field values', () => {
    // The classic log-injection attack: an attacker submits a value
    // containing a newline, causing the log line to break + the
    // attacker-controlled second line to look like a separate log
    // entry (potentially with different severity, fake timestamps,
    // or fabricated messages).
    logger('s').info('lead received', {
      attacker_input: 'normal\n2026-01-01 ERROR fake-line-here',
    });
    const data = capture.lines[0].data;
    expect(data.attacker_input).not.toContain('\n');
    expect(data.attacker_input).toContain('normal');
  });

  it('strips carriage returns + null bytes + DEL', () => {
    logger('s').info('m', {
      a: `line1\rline2`,
      b: `text${String.fromCharCode(0)}null`,
      c: `text${String.fromCharCode(0x7f)}del`,
    });
    const data = capture.lines[0].data;
    expect(data.a).toBe('line1line2');
    expect(data.b).toBe('textnull');
    expect(data.c).toBe('textdel');
  });

  it('caps string field values at 1000 chars', () => {
    const huge = 'a'.repeat(5000);
    logger('s').info('m', { big: huge });
    const data = capture.lines[0].data as { big: string };
    expect(data.big.length).toBe(1000);
  });

  it('caps msg at 200 chars', () => {
    const huge = 'm'.repeat(500);
    logger('s').info(huge);
    const data = capture.lines[0].data as { msg: string };
    expect(data.msg.length).toBe(200);
  });

  it('preserves non-string values (numbers, booleans, objects)', () => {
    logger('s').info('m', {
      count: 42,
      ok: true,
      nested: { a: 1 },
    });
    const data = capture.lines[0].data;
    expect(data.count).toBe(42);
    expect(data.ok).toBe(true);
    expect(data.nested).toEqual({ a: 1 });
  });
});

describe('logger — reserved-field protection (log spoofing defense)', () => {
  let capture: ReturnType<typeof captureLogs>;
  beforeEach(() => { capture = captureLogs(); });
  afterEach(() => { capture.restore(); });

  it('rejects caller-supplied level overrides', () => {
    // Without this protection, a caller could pass user-controlled
    // data containing { level: 'debug' } and downgrade an error
    // log to debug — making real attacks invisible to ops dashboards
    // that filter on severity.
    logger('s').error('real error', { level: 'debug', evil: 'spoofed' });
    const data = capture.lines[0].data;
    expect(data.level).toBe('error');
    expect(data.evil).toBe('spoofed'); // non-reserved field still passes through
  });

  it('rejects caller-supplied source overrides', () => {
    logger('api/leads').info('m', { source: 'something-else' });
    const data = capture.lines[0].data;
    expect(data.source).toBe('api/leads');
  });

  it('rejects caller-supplied msg overrides', () => {
    logger('s').info('real message', { msg: 'fake message' });
    const data = capture.lines[0].data;
    expect(data.msg).toBe('real message');
  });

  it('rejects caller-supplied ts overrides', () => {
    logger('s').info('m', { ts: '1970-01-01T00:00:00.000Z' });
    const data = capture.lines[0].data;
    expect(data.ts).not.toBe('1970-01-01T00:00:00.000Z');
    // Fresh timestamp should be in the current decade
    expect(String(data.ts)).toMatch(/^20[2-9]\d-/);
  });

  it('rejects baseFields overriding reserved fields', () => {
    // Same protection at the constructor level — if someone
    // accidentally passes user data as baseFields, it can't spoof
    // structural fields either.
    const log = logger('real-source', { source: 'evil-source', level: 'fake' });
    log.info('m');
    const data = capture.lines[0].data;
    expect(data.source).toBe('real-source');
    expect(data.level).toBe('info');
  });
});
