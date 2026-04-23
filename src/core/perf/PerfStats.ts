/**
 * PerfStats — singleton performance telemetry collector.
 *
 * This module exists because we have three sources of "is the app
 * healthy right now?" signal that nobody was aggregating:
 *
 *   1. Frame pacing (useFrame dt in `AdaptiveQuality.tsx`) — was being
 *      used only for render-tier escalation; the raw samples were
 *      thrown away every second.
 *   2. Worker solve latency (`SimulationBridge.onWorkerMessage`) — was
 *      log-warned at > 30 ms and otherwise ignored.
 *   3. Three.js renderer.info (draw calls, triangles) — never read.
 *
 * PerfStats unifies all three behind one tiny API. The PerfHUD component
 * polls it; future telemetry shippers can subscribe. No React, no Zustand,
 * no per-frame re-renders — the collector is a plain singleton so every
 * writer path (useFrame, worker callback) can hit it without thinking
 * about component lifecycle.
 *
 * Design choices:
 *   • Frame-time history as a `Float32Array` ring buffer — cache-friendly,
 *     no per-frame allocation, O(1) insert.
 *   • Worker latency as a small circular buffer for p95 computation.
 *   • `getSample()` synthesizes a snapshot on demand; the HUD polls at
 *     10 Hz (interval: 100 ms) so the HUD does not re-render at 60 Hz.
 *   • Heap stats come from the non-standard `performance.memory` and
 *     degrade gracefully to `null` when unavailable (Firefox, Safari).
 */

// ── Ring buffers ────────────────────────────────────────────────

/**
 * Last 120 frame-times in milliseconds. 120 samples at 60 Hz = 2 s of
 * history — enough to paint a sparkline and compute a smoothed FPS
 * without retaining a minute's worth of numbers.
 */
const FRAME_HISTORY_SIZE = 120;
const frameTimes = new Float32Array(FRAME_HISTORY_SIZE);
let frameWriteIdx = 0;
let frameSampleCount = 0; // saturates at FRAME_HISTORY_SIZE

/**
 * Last 20 worker solve round-trips in milliseconds. Used to compute a
 * stable p95 — 20 is enough to see the tail without overweighting
 * stale numbers.
 */
const LATENCY_HISTORY_SIZE = 20;
const latencies = new Float32Array(LATENCY_HISTORY_SIZE);
let latencyWriteIdx = 0;
let latencySampleCount = 0;

// ── Exponentially-smoothed FPS ─────────────────────────────────
//
// Raw 1-frame FPS is too twitchy for a readout. Store an EMA with
// alpha≈0.1 — settles in ~20 frames (~0.3 s at 60 Hz) but still
// tracks real degradation within half a second.

let smoothedFps = 60;
const FPS_EMA_ALPHA = 0.1;

// ── Renderer info (cheap, just stashed) ─────────────────────────

let drawCalls = 0;
let triangles = 0;

// ── Pipe loop metrics (Phase 14.AC.4) ──────────────────────────
//
// Surfaces the three hot-path optimizations shipped in 14.AC.1–3:
//
//   • Segment-extract cache (14.AC.2) — are pipe mutations hitting
//     the cache or forcing full re-walks?
//   • Bridge batch mutate (14.AC.3) — did the last burst of pipe
//     commits collapse into a single postMessage?
//   • rAF-coalesced events (14.AC.1) — how many preview emissions
//     were dropped vs delivered?
//
// All three are plain monotonic counters since the last reset —
// cheap to maintain (two integer increments on hot paths), easy to
// reset for an ad-hoc measurement.

let cacheHits = 0;
let cacheMisses = 0;
let cacheCalls = 0;

let lastBatchOps = 0;

let rafEmissionsReceived = 0;
let rafInvocationsFired = 0;

// ── Public API ──────────────────────────────────────────────────

export interface PerfSample {
  /** Last single-frame delta in milliseconds. */
  frameTimeMs: number;
  /** Exponentially-smoothed FPS (alpha 0.1). */
  fps: number;
  /** Last FRAME_HISTORY_SIZE frame times, oldest first. Fresh copy each call. */
  frameTimeHistory: Float32Array;
  /** Mean frame time across the history, in ms. */
  meanFrameTimeMs: number;
  /** 95th-percentile frame time across the history, in ms. */
  p95FrameTimeMs: number;
  /** Most-recent worker round-trip, in ms (0 if no solves have run). */
  workerLatencyMs: number;
  /** P95 over the last LATENCY_HISTORY_SIZE solves. */
  workerLatencyP95: number;
  /** Number of WebGL draw calls on the last rendered frame. */
  drawCalls: number;
  /** Triangles rasterized on the last rendered frame. */
  triangles: number;
  /** JS heap usage in MB, or null if the browser doesn't expose it. */
  heapUsedMB: number | null;
  /** JS heap size limit in MB, or null. */
  heapLimitMB: number | null;
  /** Pipe-loop telemetry (Phase 14.AC.4). Zero when no pipe activity. */
  pipeLoop: PipeLoopMetrics;
}

export interface PipeLoopMetrics {
  /** SegmentExtractCache: pipes whose cached entry was reused. */
  cacheHits: number;
  /** SegmentExtractCache: pipes that had to be rebuilt. */
  cacheMisses: number;
  /** Total `extract()` invocations (hits + misses is per-pipe, not per-call). */
  cacheCalls: number;
  /** Derived: hits / (hits + misses), 0..1. 1 when no work has happened. */
  cacheHitRate: number;
  /** Total mutation ops in the most recent BATCH_MUTATE flush. */
  lastBatchOps: number;
  /** useRafEvent: bus emissions that arrived (every call to the listener). */
  rafEmissionsReceived: number;
  /** useRafEvent: handler invocations that actually fired (one per frame w/ work). */
  rafInvocationsFired: number;
  /** Derived: 1 - fired/received, 0..1. How much load the coalescer saved. */
  rafDropRate: number;
}

/** Record one frame's delta. Called from `AdaptiveQuality`'s useFrame. */
export function recordFrame(dtMs: number): void {
  frameTimes[frameWriteIdx] = dtMs;
  frameWriteIdx = (frameWriteIdx + 1) % FRAME_HISTORY_SIZE;
  if (frameSampleCount < FRAME_HISTORY_SIZE) frameSampleCount++;

  // Update smoothed FPS. Guard against dt=0 frames (paused tab, first
  // frame) which would produce Infinity.
  if (dtMs > 0.5) {
    const instantFps = 1000 / dtMs;
    smoothedFps = smoothedFps * (1 - FPS_EMA_ALPHA) + instantFps * FPS_EMA_ALPHA;
  }
}

/** Record one worker solve round-trip. Called from `SimulationBridge`. */
export function recordWorkerRoundTrip(ms: number): void {
  latencies[latencyWriteIdx] = ms;
  latencyWriteIdx = (latencyWriteIdx + 1) % LATENCY_HISTORY_SIZE;
  if (latencySampleCount < LATENCY_HISTORY_SIZE) latencySampleCount++;
}

/** Record Three.js renderer.info. Called per frame from `PerfSampler`. */
export function recordRenderInfo(calls: number, tris: number): void {
  drawCalls = calls;
  triangles = tris;
}

// ── Pipe loop recorders (Phase 14.AC.4) ────────────────────────

/**
 * Record the outcome of one `SegmentExtractCache.extract()` call.
 * Called from the cache itself. Cheap — three integer adds.
 */
export function recordSegmentCacheStats(hits: number, misses: number): void {
  cacheHits += hits;
  cacheMisses += misses;
  cacheCalls += 1;
}

/**
 * Record the size of the most recent graph mutation batch. Called
 * from `SimulationBridge.flushPendingMutations`. Passes zero for
 * empty-cancel batches so the HUD shows an honest "0 last batch"
 * rather than stale state.
 */
export function recordBatchMutation(totalOps: number): void {
  lastBatchOps = totalOps;
}

/**
 * Record one event-bus emission that reached the rAF coalescer.
 * Called from `useRafEvent`'s listener. We increment on every
 * incoming emission, regardless of whether it survives to a handler
 * invocation.
 */
export function recordRafEmission(): void {
  rafEmissionsReceived += 1;
}

/**
 * Record one handler invocation that the rAF coalescer actually
 * fired. Called when the frame flushes with a non-null payload.
 */
export function recordRafInvocation(): void {
  rafInvocationsFired += 1;
}

/**
 * Reset the pipe-loop counters without touching frame / worker /
 * render telemetry. Bound to a future "reset pipe metrics" button
 * in the HUD; used by tests.
 */
export function resetPipeLoopStats(): void {
  cacheHits = 0;
  cacheMisses = 0;
  cacheCalls = 0;
  lastBatchOps = 0;
  rafEmissionsReceived = 0;
  rafInvocationsFired = 0;
}

function buildPipeLoopMetrics(): PipeLoopMetrics {
  const totalPipeOps = cacheHits + cacheMisses;
  const hitRate = totalPipeOps === 0 ? 1 : cacheHits / totalPipeOps;
  const dropRate = rafEmissionsReceived === 0
    ? 0
    : Math.max(0, 1 - rafInvocationsFired / rafEmissionsReceived);
  return {
    cacheHits,
    cacheMisses,
    cacheCalls,
    cacheHitRate: hitRate,
    lastBatchOps,
    rafEmissionsReceived,
    rafInvocationsFired,
    rafDropRate: dropRate,
  };
}

/** Build a snapshot. The HUD polls this at ~10 Hz. */
export function getSample(): PerfSample {
  const history = new Float32Array(FRAME_HISTORY_SIZE);
  // Rotate so the oldest sample is first (chronological order for
  // painting a left-to-right sparkline).
  for (let i = 0; i < FRAME_HISTORY_SIZE; i++) {
    history[i] = frameTimes[(frameWriteIdx + i) % FRAME_HISTORY_SIZE]!;
  }

  const validSamples = history.slice(FRAME_HISTORY_SIZE - frameSampleCount);
  const meanFrame = mean(validSamples);
  const p95Frame = percentile(validSamples, 0.95);

  const validLatencies = latencies.slice(0, latencySampleCount);
  const lastLatency = latencySampleCount > 0
    ? latencies[(latencyWriteIdx - 1 + LATENCY_HISTORY_SIZE) % LATENCY_HISTORY_SIZE]!
    : 0;
  const p95Latency = percentile(validLatencies, 0.95);

  return {
    frameTimeMs: frameSampleCount > 0
      ? frameTimes[(frameWriteIdx - 1 + FRAME_HISTORY_SIZE) % FRAME_HISTORY_SIZE]!
      : 0,
    fps: smoothedFps,
    frameTimeHistory: history,
    meanFrameTimeMs: meanFrame,
    p95FrameTimeMs: p95Frame,
    workerLatencyMs: lastLatency,
    workerLatencyP95: p95Latency,
    drawCalls,
    triangles,
    ...readHeap(),
    pipeLoop: buildPipeLoopMetrics(),
  };
}

/** Reset all counters. Test helper + "clear" button in the HUD. */
export function reset(): void {
  frameTimes.fill(0);
  frameWriteIdx = 0;
  frameSampleCount = 0;
  latencies.fill(0);
  latencyWriteIdx = 0;
  latencySampleCount = 0;
  smoothedFps = 60;
  drawCalls = 0;
  triangles = 0;
  resetPipeLoopStats();
}

// ── Internal helpers ───────────────────────────────────────────

function mean(arr: Float32Array): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i]!;
  return sum / arr.length;
}

/**
 * Percentile via sort-a-copy. O(n log n) per call — but `n` is at most
 * FRAME_HISTORY_SIZE (120), and the HUD polls at 10 Hz, so this is
 * negligible (~0.001 ms per call on a modern machine).
 */
function percentile(arr: Float32Array, p: number): number {
  if (arr.length === 0) return 0;
  const sorted = Array.from(arr).sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

function readHeap(): { heapUsedMB: number | null; heapLimitMB: number | null } {
  const perf = performance as PerformanceWithMemory;
  if (!perf.memory) return { heapUsedMB: null, heapLimitMB: null };
  return {
    heapUsedMB: perf.memory.usedJSHeapSize / (1024 * 1024),
    heapLimitMB: perf.memory.jsHeapSizeLimit / (1024 * 1024),
  };
}

// Test-only export for the spec.
export const __testables = {
  FRAME_HISTORY_SIZE,
  LATENCY_HISTORY_SIZE,
  FPS_EMA_ALPHA,
};
