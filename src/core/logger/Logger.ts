/**
 * Logger — structured, leveled, observable logging subsystem.
 *
 * Replaces scattered `console.warn` / `console.error` with a single
 * pipeline that the God Mode "Logs" tab, future telemetry (Phase
 * 10.D), and any other observer can tap.
 *
 * ── Why this isn't just console.* ─────────────────────────────
 *
 *   console.log is unfilterable, un-ringable, unsubscribable.
 *   Observability at scale needs: level gating, source attribution,
 *   ring-buffered history, and a subscription API. This is a thin
 *   layer over all of those, designed so every existing call site
 *   migrates with one-line substitutions.
 *
 * ── API (ergonomics) ──────────────────────────────────────────
 *
 *   const log = logger('SimBridge');
 *   log.info('solve complete', { ms: 42 });
 *   log.warn('slow solve', { ms: 420 });
 *   log.error('worker crash', err);
 *
 *   // Lazy-eval variant for hot paths:
 *   log.trace(() => `computed deep thing: ${expensiveDump()}`);
 *
 * ── Levels ────────────────────────────────────────────────────
 *
 *   trace < debug < info < warn < error < fatal
 *
 *   Default threshold: `info` in dev (DEV=true), `warn` in prod.
 *   Runtime override via useFeatureFlagStore.logLevel.
 *
 * ── Storage ───────────────────────────────────────────────────
 *
 *   1000-entry ring buffer. Overflow drops oldest. Each entry:
 *
 *     { level, source, timestamp, message, args, correlationId? }
 *
 *   Separate from the CommandBus log (which holds MUTATIONS) —
 *   logs are OBSERVATIONS. Different lifecycle, different consumers.
 */

// ── Types ──────────────────────────────────────────────────────

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5,
};

/** Entry shape stored in the ring buffer + published to subscribers. */
export interface LogEntry {
  level: LogLevel;
  /** Subsystem / component name. Free text; use dotted namespaces if you need hierarchy (`ui.pipe`). */
  source: string;
  /** `performance.now()` when the log was emitted. */
  timestamp: number;
  /** The first argument (a string, lazily resolved, or `any`). */
  message: string;
  /** Remaining variadic args — objects, errors, primitives. */
  args: unknown[];
  /** Optional correlation id from the active command chain. */
  correlationId?: string;
}

/** Subscriber receives every entry above the active threshold. */
export type LogSubscriber = (entry: LogEntry) => void;

// ── Ring buffer ────────────────────────────────────────────────

const BUFFER_CAPACITY = 1000;

class LogRing {
  private buf: Array<LogEntry | undefined> = new Array(BUFFER_CAPACITY);
  private head = 0;
  private count = 0;

  push(e: LogEntry): void {
    this.buf[this.head] = e;
    this.head = (this.head + 1) % BUFFER_CAPACITY;
    if (this.count < BUFFER_CAPACITY) this.count++;
  }

  /** Oldest → newest. */
  toArray(): LogEntry[] {
    const out: LogEntry[] = [];
    const start = this.count < BUFFER_CAPACITY ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const e = this.buf[(start + i) % BUFFER_CAPACITY];
      if (e) out.push(e);
    }
    return out;
  }

  clear(): void {
    this.buf.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  get size(): number { return this.count; }
}

// ── Internal state ────────────────────────────────────────────

const ring = new LogRing();
const subscribers = new Set<LogSubscriber>();

/** The active threshold. Entries BELOW this level are discarded. */
let activeThreshold: LogLevel = defaultThreshold();

/** If true, every entry (≥ threshold) is also written to `console.*`.
 *  Useful during dev. Can be disabled by telemetry / production builds. */
let consoleMirror = defaultConsoleMirror();

/** Test-only correlation context (set by wrap*) so logs inside a
 *  command handler can link back to the command's correlationId
 *  without every call site having to pass it. Real production
 *  code reads this via `withCorrelation(id, fn)`. */
let activeCorrelationId: string | null = null;

function defaultThreshold(): LogLevel {
  // Build-time gate: production defaults to `warn` so user-facing
  // installs don't spam the log with info chatter.
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
      return 'info';
    }
  } catch { /* import.meta.env unavailable — tests, SSR */ }
  return 'warn';
}

function defaultConsoleMirror(): boolean {
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) return true;
  } catch { /* */ }
  return false;
}

// ── Public API ────────────────────────────────────────────────

export interface LeveledLogger {
  trace: (...args: unknown[] | [() => string]) => void;
  debug: (...args: unknown[] | [() => string]) => void;
  info: (...args: unknown[] | [() => string]) => void;
  warn: (...args: unknown[] | [() => string]) => void;
  error: (...args: unknown[] | [() => string]) => void;
  fatal: (...args: unknown[] | [() => string]) => void;
}

/**
 * Factory. Call once per subsystem, store the returned instance:
 *
 *   const log = logger('SimBridge');
 *
 * Every call captures `source='SimBridge'` automatically. Cheap to
 * call repeatedly — nothing is cached; the logger functions just
 * close over `source`.
 */
export function logger(source: string): LeveledLogger {
  const make = (lvl: LogLevel) => (...args: unknown[]) => emit(lvl, source, args);
  return {
    trace: make('trace'),
    debug: make('debug'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    fatal: make('fatal'),
  };
}

export function setLogLevel(level: LogLevel): void {
  activeThreshold = level;
}

export function getLogLevel(): LogLevel {
  return activeThreshold;
}

export function setConsoleMirror(on: boolean): void {
  consoleMirror = on;
}

export function getLog(): LogEntry[] {
  return ring.toArray();
}

export function clearLog(): void {
  ring.clear();
}

export function subscribe(fn: LogSubscriber): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

/**
 * Run `fn` with `correlationId` attached to every log emitted inside
 * it. Threads context without polluting every call signature.
 * Returns whatever `fn` returns. Synchronous only.
 */
export function withCorrelation<R>(correlationId: string, fn: () => R): R {
  const prev = activeCorrelationId;
  activeCorrelationId = correlationId;
  try {
    return fn();
  } finally {
    activeCorrelationId = prev;
  }
}

// ── Emission (the hot path) ───────────────────────────────────

function emit(level: LogLevel, source: string, args: unknown[]): void {
  // Fast-reject below threshold BEFORE evaluating any lazy arg.
  if (LEVEL_ORDER[level] < LEVEL_ORDER[activeThreshold]) return;

  // Lazy-eval: if the sole arg is a function, call it now to get the message.
  let message: string;
  let rest: unknown[];
  if (args.length === 1 && typeof args[0] === 'function') {
    try {
      const v = (args[0] as () => unknown)();
      message = typeof v === 'string' ? v : String(v);
    } catch (err) {
      message = `<lazy eval threw: ${err instanceof Error ? err.message : String(err)}>`;
    }
    rest = [];
  } else {
    // First arg is the message; stringify if it's not a string.
    const [first, ...others] = args;
    message = typeof first === 'string' ? first : String(first);
    rest = others;
  }

  const entry: LogEntry = {
    level,
    source,
    timestamp: performance.now(),
    message,
    args: rest,
    correlationId: activeCorrelationId ?? undefined,
  };

  ring.push(entry);

  // Fan out
  for (const s of subscribers) {
    try { s(entry); } catch { /* never propagate */ }
  }

  if (consoleMirror) {
    mirrorToConsole(entry);
  }
}

function mirrorToConsole(e: LogEntry): void {
  const prefix = `[${e.source}]`;
  // eslint-disable-next-line no-console -- intentional: this IS the console boundary
  const c = console;
  switch (e.level) {
    case 'trace': case 'debug':
      c.debug?.(prefix, e.message, ...e.args);
      break;
    case 'info':
      c.info?.(prefix, e.message, ...e.args);
      break;
    case 'warn':
      c.warn?.(prefix, e.message, ...e.args);
      break;
    case 'error': case 'fatal':
      c.error?.(prefix, e.message, ...e.args);
      break;
  }
}

// ── Test helpers ──────────────────────────────────────────────

export function __resetLoggerForTests(): void {
  ring.clear();
  subscribers.clear();
  activeThreshold = defaultThreshold();
  consoleMirror = false;
  activeCorrelationId = null;
}
