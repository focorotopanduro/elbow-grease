/**
 * SessionTelemetry — local-only, opt-in usage + performance metrics.
 *
 * Design principles:
 *
 *   1. NO network. Ever. The whole module is designed to produce a
 *      downloadable JSONL file the user can voluntarily attach to a
 *      bug report. It never posts anywhere, never sends a heartbeat,
 *      never phones home.
 *
 *   2. Opt-in at runtime. Flag-gated (`telemetryEnabled`); while off,
 *      the module is literally dormant — no subscriptions, no timers,
 *      no storage. Zero cost when disabled.
 *
 *   3. No PII. The payload carries a per-session UUID, the app version,
 *      the browser user-agent string (for "my Electron build misbehaves
 *      on Windows 11" triage) — and otherwise only performance numbers,
 *      command-type counts, error counts, and scene element counts.
 *      Pipe coordinates, fixture parameters, customer data — never.
 *
 *   4. Bounded memory. Buckets are 1 minute; retention is capped at 60
 *      (1 hour). The active session persists to localStorage on each
 *      bucket close; on boot, sessions older than 4 hours are discarded.
 *
 * Data sources (all existing):
 *   • PerfStats.getSample()     — FPS, frame time, worker latency
 *   • commandBus.subscribe()    — command counts by type + rejections
 *   • logger.subscribe()        — warning/error/fatal counts
 *   • pipeStore.getState()      — pipe count at bucket close
 *   • fixtureStore.getState()   — fixture count at bucket close
 *
 * Only the module itself reads these — callers just
 * `bootSessionTelemetry()` once and forget. Stats flow in automatically
 * while the flag is on.
 */

import { commandBus } from '@core/commands/CommandBus';
import { subscribe as subscribeLog, type LogEntry } from '@core/logger/Logger';
import { getSample, type PerfSample } from '@core/perf/PerfStats';
import { logger } from '@core/logger/Logger';

const log = logger('Telemetry');

// ── Constants ───────────────────────────────────────────────────

/** Bucket window in milliseconds. 60 s matches a natural "what happened this minute" grain. */
const BUCKET_DURATION_MS = 60_000;
/** How often we sample PerfStats inside an active bucket. 1 Hz is enough for a 60-s window. */
const PERF_SAMPLE_MS = 1_000;
/** Max buckets kept per session (rolling). 60 = 1 hour of history. */
const MAX_BUCKETS = 60;
/** Session is discarded on boot if older than this (e.g. left app open overnight). */
const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1_000;
/** localStorage key for the active session. */
const STORAGE_KEY = 'elbow-grease-telemetry';

// ── Types ──────────────────────────────────────────────────────

export interface TelemetryBucket {
  /** Wall-clock (Unix epoch ms) at bucket start. */
  bucketStartTs: number;
  /** Elapsed ms between bucket open and close. Usually BUCKET_DURATION_MS ± scheduling jitter. */
  durationMs: number;

  fps: {
    mean: number;
    p50: number;
    p95: number;
    min: number;
    samples: number;
  };
  frameTimeMs: {
    mean: number;
    p95: number;
    max: number;
  };
  workerLatencyMs: {
    mean: number;
    p95: number;
    /** Number of solve round-trips observed this bucket. */
    count: number;
  };

  commandCount: number;
  commandRejections: number;
  /** Per-command-type count. Truncated to top 20 types at bucket close to cap size. */
  commandsByType: Record<string, number>;

  warnings: number;
  errors: number;
  fatals: number;

  /** Scene snapshot at bucket close (NOT aggregated over the window). */
  pipeCount: number;
  fixtureCount: number;
}

export interface TelemetrySession {
  sessionId: string;
  /** Wall-clock at session start. */
  sessionStartTs: number;
  /** From package.json via Vite's __APP_VERSION__ (see vite.config.ts), or 'unknown'. */
  appVersion: string;
  /** navigator.userAgent — platform-useful, no PII beyond what every page request already leaks. */
  userAgent: string;
  buckets: TelemetryBucket[];
}

// ── Module state ───────────────────────────────────────────────

let session: TelemetrySession | null = null;
let currentBucketStart = 0;
/** Raw PerfStats samples inside the current bucket window. */
let fpsSamples: number[] = [];
let frameTimeSamples: number[] = [];
let workerLatencySamples: number[] = [];
let commandCount = 0;
let commandRejections = 0;
const commandsByType = new Map<string, number>();
let warnings = 0;
let errors = 0;
let fatals = 0;

let rolloverTimer: ReturnType<typeof setInterval> | null = null;
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let unsubCommand: (() => void) | null = null;
let unsubLog: (() => void) | null = null;

/**
 * Scene-count provider. Injected at boot so the telemetry module doesn't
 * create a cross-module dependency on the UI stores. Tests can pass a stub.
 */
export type SceneCountReader = () => { pipeCount: number; fixtureCount: number };
let readSceneCounts: SceneCountReader = () => ({ pipeCount: 0, fixtureCount: 0 });

/** Last previous worker-latency observed via PerfStats; de-dup consecutive identical reads. */
let lastWorkerLatencySeen = -1;

// ── Public API ──────────────────────────────────────────────────

export interface StartOptions {
  /** Called at each bucket close to let the host persist. Default: localStorage. */
  persist?: (s: TelemetrySession) => void;
  /** Provider for pipeCount / fixtureCount. Default: returns zeros. */
  sceneCountReader?: SceneCountReader;
  /** App version. Default reads __APP_VERSION__ or falls back to 'unknown'. */
  appVersion?: string;
  /** UUID generator. Default uses crypto.randomUUID() when available, else a fallback. */
  sessionIdFactory?: () => string;
}

/** Start collection. Idempotent — calling start() twice in a row is a no-op. */
export function start(opts: StartOptions = {}): void {
  if (session) return; // already running

  readSceneCounts = opts.sceneCountReader ?? (() => ({ pipeCount: 0, fixtureCount: 0 }));

  const persist = opts.persist ?? persistToLocalStorage;
  const appVersion = opts.appVersion ?? readAppVersion();
  const sessionIdFactory = opts.sessionIdFactory ?? defaultSessionIdFactory;

  // Try to resume a recent session; if stale or absent, open a new one.
  const resumed = loadFromLocalStorage(appVersion);
  if (resumed && Date.now() - resumed.sessionStartTs < SESSION_MAX_AGE_MS) {
    session = resumed;
    log.debug('resumed telemetry session', { sessionId: session.sessionId, buckets: session.buckets.length });
  } else {
    session = {
      sessionId: sessionIdFactory(),
      sessionStartTs: Date.now(),
      appVersion,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      buckets: [],
    };
    log.debug('new telemetry session', { sessionId: session.sessionId });
  }

  resetBucket();

  // Subscribe to command bus — count + track rejections.
  unsubCommand = commandBus.subscribe((entry) => {
    commandCount++;
    if (!entry.result.ok) commandRejections++;
    const type = entry.command.type;
    commandsByType.set(type, (commandsByType.get(type) ?? 0) + 1);
  });

  // Subscribe to logger — count warnings/errors/fatals.
  unsubLog = subscribeLog((entry: LogEntry) => {
    if (entry.level === 'warn') warnings++;
    else if (entry.level === 'error') errors++;
    else if (entry.level === 'fatal') fatals++;
  });

  // Sample PerfStats at 1 Hz — cheap.
  sampleTimer = setInterval(() => {
    const s = getSample();
    sampleFromPerfSnapshot(s);
  }, PERF_SAMPLE_MS);

  // Roll the bucket over every minute.
  rolloverTimer = setInterval(() => {
    rolloverBucket(persist);
  }, BUCKET_DURATION_MS);
}

/** Stop collection. Unsubscribes and clears timers. Pending bucket is discarded. */
export function stop(): void {
  if (rolloverTimer) { clearInterval(rolloverTimer); rolloverTimer = null; }
  if (sampleTimer)   { clearInterval(sampleTimer);   sampleTimer   = null; }
  if (unsubCommand)  { unsubCommand(); unsubCommand = null; }
  if (unsubLog)      { unsubLog();     unsubLog     = null; }
  // Keep `session` in memory so the user can still export after they
  // toggle the flag off. `reset()` clears it entirely.
}

/** Drop everything — session + buckets + counters. Used by "Clear history". */
export function reset(): void {
  stop();
  session = null;
  resetBucket();
  if (typeof window !== 'undefined') {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}

/** True if start() has been called and stop() hasn't superseded it. */
export function isCollecting(): boolean {
  return rolloverTimer !== null;
}

/** Read the current session (may be null if never started). */
export function getSession(): TelemetrySession | null {
  return session;
}

/** Force-close the current bucket NOW. Useful before export. */
export function flushBucket(persist?: (s: TelemetrySession) => void): void {
  if (!session) return;
  rolloverBucket(persist ?? persistToLocalStorage);
}

/** Serialize the session as pretty JSON. */
export function exportJSON(): string {
  if (!session) return '{}';
  return JSON.stringify(session, null, 2);
}

/**
 * Serialize the session as JSONL — first line is the session header
 * (without buckets), each subsequent line is one bucket. Easier to
 * tail + grep than a monolithic JSON object.
 */
export function exportJSONL(): string {
  if (!session) return '';
  const { buckets, ...header } = session;
  const lines = [JSON.stringify(header), ...buckets.map((b) => JSON.stringify(b))];
  return lines.join('\n') + '\n';
}

// ── Internal ───────────────────────────────────────────────────

function resetBucket(): void {
  currentBucketStart = Date.now();
  fpsSamples = [];
  frameTimeSamples = [];
  workerLatencySamples = [];
  commandCount = 0;
  commandRejections = 0;
  commandsByType.clear();
  warnings = 0;
  errors = 0;
  fatals = 0;
  lastWorkerLatencySeen = -1;
}

/**
 * Pull the live PerfStats sample into the bucket reservoirs. Worker
 * latency is de-duplicated — PerfStats holds the most-recent round
 * trip, and we don't want to count the same solve 60 times during its
 * idle minute.
 */
function sampleFromPerfSnapshot(s: PerfSample): void {
  if (s.fps > 0) fpsSamples.push(s.fps);
  if (s.frameTimeMs > 0) frameTimeSamples.push(s.frameTimeMs);
  if (s.workerLatencyMs > 0 && s.workerLatencyMs !== lastWorkerLatencySeen) {
    workerLatencySamples.push(s.workerLatencyMs);
    lastWorkerLatencySeen = s.workerLatencyMs;
  }
}

function rolloverBucket(persist: (s: TelemetrySession) => void): void {
  if (!session) return;

  const now = Date.now();
  const durationMs = now - currentBucketStart;

  // Don't record a bucket if nothing meaningful happened.
  if (fpsSamples.length === 0 && commandCount === 0 && warnings === 0 && errors === 0) {
    resetBucket();
    return;
  }

  const scene = readSceneCounts();

  const bucket: TelemetryBucket = {
    bucketStartTs: currentBucketStart,
    durationMs,
    fps: fpsSamples.length > 0
      ? {
          mean: mean(fpsSamples),
          p50: percentile(fpsSamples, 0.5),
          p95: percentile(fpsSamples, 0.95),
          min: Math.min(...fpsSamples),
          samples: fpsSamples.length,
        }
      : { mean: 0, p50: 0, p95: 0, min: 0, samples: 0 },
    frameTimeMs: frameTimeSamples.length > 0
      ? {
          mean: mean(frameTimeSamples),
          p95: percentile(frameTimeSamples, 0.95),
          max: Math.max(...frameTimeSamples),
        }
      : { mean: 0, p95: 0, max: 0 },
    workerLatencyMs: workerLatencySamples.length > 0
      ? {
          mean: mean(workerLatencySamples),
          p95: percentile(workerLatencySamples, 0.95),
          count: workerLatencySamples.length,
        }
      : { mean: 0, p95: 0, count: 0 },
    commandCount,
    commandRejections,
    commandsByType: topN(commandsByType, 20),
    warnings,
    errors,
    fatals,
    pipeCount: scene.pipeCount,
    fixtureCount: scene.fixtureCount,
  };

  session.buckets.push(bucket);
  // Cap retention.
  if (session.buckets.length > MAX_BUCKETS) {
    session.buckets.splice(0, session.buckets.length - MAX_BUCKETS);
  }

  resetBucket();

  try { persist(session); } catch (err) { log.warn('telemetry persist failed', err); }
}

function topN(map: Map<string, number>, n: number): Record<string, number> {
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return Object.fromEntries(entries);
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}

// ── Persistence ───────────────────────────────────────────────

function persistToLocalStorage(s: TelemetrySession): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* quota exceeded or unavailable — silent */
  }
}

function loadFromLocalStorage(appVersion: string): TelemetrySession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TelemetrySession;
    // If the app version changed, the prior session's numbers compare
    // against a different codebase — discard to avoid misleading graphs.
    if (parsed.appVersion !== appVersion) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Version + UUID helpers ────────────────────────────────────

function readAppVersion(): string {
  // Vite surfaces package.json version via define() in most setups.
  // Fall back to 'unknown' so the module never crashes on missing env.
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return env?.VITE_APP_VERSION ?? env?.PACKAGE_VERSION ?? 'unknown';
}

function defaultSessionIdFactory(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random. Collision-free enough for local telemetry.
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Test hooks ─────────────────────────────────────────────────
//
// Public-but-underscored — consumed by SessionTelemetry.spec.ts to
// drive the aggregator deterministically.

export const __testables = {
  BUCKET_DURATION_MS,
  PERF_SAMPLE_MS,
  MAX_BUCKETS,
  SESSION_MAX_AGE_MS,
  /** Feed a synthetic PerfSample through the sampler path. */
  feedPerfSample(s: PerfSample) { sampleFromPerfSnapshot(s); },
  /** Force a rollover against a custom persist hook. */
  forceRollover(persist: (s: TelemetrySession) => void) { rolloverBucket(persist); },
  /** Getters for bucket-in-progress state. */
  get fpsSampleCount() { return fpsSamples.length; },
  get commandCount() { return commandCount; },
  get warnings() { return warnings; },
};
