/**
 * Structured logger — replaces ad-hoc console.log/warn/error calls
 * with a consistent JSON format that production log sinks (Datadog,
 * Logflare, Vercel Logs, BetterStack) parse cleanly.
 *
 * Every line is single-line JSON with fixed top-level fields:
 *   - level: 'debug' | 'info' | 'warn' | 'error'
 *   - source: file/component identifier (e.g. 'api/leads')
 *   - msg: short human-readable message
 *   - reqId: optional request ID for log correlation
 *   - ts: ISO 8601 timestamp
 *   - ...rest: arbitrary structured fields the caller wants
 *
 * This makes log search efficient: you can filter by `level=error`,
 * group by `source`, trace a single request via `reqId`, etc.
 *
 * SECURITY:
 *   - Field values are JSON-stringified. Strings can contain anything
 *     except a literal newline (which would break log parsing). We
 *     sanitize string values via `sanitizeForLog` to strip control
 *     chars + cap length, preventing log injection attacks.
 *   - Caller should NEVER pass raw user input as a top-level field
 *     value without first thinking about whether it could contain
 *     PII. Lead names + phone numbers should be hashed first
 *     (see `sha256Hex` in api/_lib/security.ts).
 *
 * USAGE:
 *   import { logger } from './api/_lib/logger';
 *   const log = logger('api/leads', { reqId });
 *   log.info('lead received', { confirmation_id, source });
 *   log.error('storage failed', { err: String(err) });
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogFields {
  [key: string]: unknown;
}

/** Strip control characters + cap length from string log values
 *  to prevent log injection (an attacker injecting fake log lines
 *  by putting newlines in their input). */
function sanitizeForLog(value: unknown, maxLen = 1000): unknown {
  if (typeof value !== 'string') return value;
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')
    .slice(0, maxLen);
}

/** Reserved field names that can NEVER be overridden by caller-
 *  supplied fields. Without this, a caller passing
 *  `log.info('m', { level: 'fake', source: 'evil' })` could spoof
 *  the structural shape of log lines + confuse log parsers. */
const RESERVED_FIELDS = new Set(['level', 'source', 'msg', 'ts']);

function emit(level: LogLevel, source: string, msg: string, fields: LogFields, baseFields: LogFields): void {
  const merged: LogFields = {};
  // Apply baseFields FIRST, then per-call fields, then structural
  // fields LAST so they're always authoritative. The for-of loop
  // also runs sanitizeForLog on every value (which the previous
  // spread-based version skipped for baseFields).
  for (const [k, v] of Object.entries(baseFields)) {
    if (RESERVED_FIELDS.has(k)) continue;
    merged[k] = sanitizeForLog(v);
  }
  for (const [k, v] of Object.entries(fields)) {
    if (RESERVED_FIELDS.has(k)) continue;
    merged[k] = sanitizeForLog(v);
  }
  // Structural fields written LAST — guaranteed authoritative.
  merged.level = level;
  merged.source = source;
  merged.msg = sanitizeForLog(msg, 200);
  merged.ts = new Date().toISOString();
  // Single-line JSON. Use the matching console method so log sinks
  // that read stderr separately still work.
  const line = JSON.stringify(merged);
  // eslint-disable-next-line no-console
  if (level === 'error' || level === 'warn') console.error(line);
  // eslint-disable-next-line no-console
  else console.log(line);
}

interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Returns a child logger with the given fields merged into every line. */
  child(extra: LogFields): Logger;
}

export function logger(source: string, baseFields: LogFields = {}): Logger {
  return {
    debug: (msg, fields = {}) => emit('debug', source, msg, fields, baseFields),
    info: (msg, fields = {}) => emit('info', source, msg, fields, baseFields),
    warn: (msg, fields = {}) => emit('warn', source, msg, fields, baseFields),
    error: (msg, fields = {}) => emit('error', source, msg, fields, baseFields),
    child: (extra) => logger(source, { ...baseFields, ...extra }),
  };
}
