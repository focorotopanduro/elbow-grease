# ADR 017 — Performance HUD (Phase 10.D)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 10.D
- **Depends on:** ADR 014 (Logger — slow-solve warnings flow through it), ADR 016 (a11y — HUD respects reduce-motion by default).

## Context

Three systems were already measuring performance, each in isolation:

1. **`AdaptiveQuality.tsx`** — sampled frame times to escalate render tiers, then threw the samples away every second.
2. **`SimulationBridge.ts`** — timestamped outgoing messages and warn-logged solves slower than 30 ms, but kept no history.
3. **Three.js `renderer.info`** — draw calls and triangle counts were available, but nothing read them.

The user-visible gap: **no live view of "is the app running well right now?"** During the 500-pipe benchmark the fractalized plan targets, a developer had to tail console logs and mentally integrate dropped frames to know whether a regression was tolerable. Customers filing "it feels slow" reports had no datapoint to attach.

## Decision

Add a **`PerfStats` singleton** that unifies all three sources, a **`PerfHUD`** overlay that reads from it, and a **`PerfSampler`** component that fills the last remaining gap (renderer.info).

### Layout

```
src/core/perf/PerfStats.ts              singleton state + public API
src/core/perf/__tests__/PerfStats.spec  correctness tests (16 tests)
src/ui/debug/PerfHUD.tsx                2D overlay, Ctrl+Shift+P
src/ui/perf/PerfSampler.tsx             R3F child, samples gl.info
```

### PerfStats API (singleton, no React)

```ts
recordFrame(dtMs: number): void
recordWorkerRoundTrip(ms: number): void
recordRenderInfo(calls: number, tris: number): void
getSample(): PerfSample  // snapshot at poll time
reset(): void            // test helper + HUD "clear"
```

All writes are O(1) — a ring-buffer index update + one array slot. `getSample()` does O(n log n) work for p95 (n ≤ 120, so ~0.001 ms) and builds a fresh chronological-order copy of the frame history.

### Data model

- **Frame times** — `Float32Array(120)` ring buffer. 120 samples × 16.67 ms ≈ 2 s of history. Sparkline width 240 px fits 2 px per sample.
- **FPS** — exponentially smoothed, α = 0.1. Settles in ~20 frames without the jitter of a single-frame derivative.
- **Worker latencies** — `Float32Array(20)`. 20 is enough to see the tail; more would make the p95 stale.
- **Render info** — two scalars (`drawCalls`, `triangles`), overwritten per frame.
- **Heap** — read from non-standard `performance.memory`; returns `null` on Firefox/Safari. Degrades gracefully.

### Wiring

- `AdaptiveQuality.useFrame` already computes `dt`; one extra call `recordFrame(dt)`. **No new work** in the render loop.
- `SimulationBridge.queueSolve` stamps `lastSolveSentAt`; the `SIMULATION_COMPLETE` handler computes `performance.now() - lastSolveSentAt` and calls `recordWorkerRoundTrip`.
- `PerfSampler` reads `gl.info.render.calls` + `.triangles` per frame. Self-gates on the `perfHud` flag — when the HUD is off, the component returns `null` and never registers a useFrame. **Zero overhead when closed.**

### PerfHUD

Top-right corner overlay, 280 × ~180 px:

```
⚡ PERF                                   [×]
59 FPS     last 16.9ms · mean 17.2 · p95 22.4
▁▁▂▂▃▃▄▄▅▅  ← inline SVG sparkline, 120 bars
WORKER   8.2ms (p95 14.1)
GPU      34 draws · 128k tris
HEAP     48 / 2048 MB
Ctrl+Shift+P to toggle · Esc to close
```

- **FPS color** — green ≥ 55, yellow 30–55, red < 30. The color is the signal you read across the room.
- **Sparkline** — single `<path>` instead of 120 `<rect>`s. Reference dashed line at 16.67 ms (60 FPS) as a visual anchor.
- **Poll rate** — `setInterval(100ms)`. Rendering at 60 Hz would be wasteful + unreadable; 10 Hz is the sweet spot where eyes can actually parse the numbers.
- **Toggle** — `Ctrl+Shift+P` flips `featureFlagStore.perfHud`; Escape closes when open. `usePerfHudShortcut` ignores keypresses when focus is in an input.

### Feature flag

`perfHud: boolean`, default **off**. Persisted in localStorage via the existing featureFlagStore pipeline. Flips via:
- Keyboard: `Ctrl+Shift+P`
- God Mode console flag list (the `Controls` panel reads all flags from the store, so it shows up automatically — no extra entry needed).

## Consequences

**Good:**
- A developer (or a curious user) can now answer "is the app slow right now?" in < 1 s.
- The 500-pipe benchmark target from the pipe-drawer plan is newly measurable on any machine, not just profiling rigs.
- Future perf telemetry (Phase 10.E if we ship it) has a single source of truth to sample — no rework.
- Slow-solve debugging: the p95 worker latency ramps visibly when the graph gets dense, catching regressions before they become user reports.

**Accepted costs:**
- PerfStats is a module-level singleton — means it has global mutable state. Test isolation requires `reset()` in `beforeEach` (the spec does this). Acceptable because the collector is one of a handful of places where a singleton is genuinely the right shape (EventBus, simBus, CommandBus log are the others).
- Worker latency is wall-clock, including the 50 ms debounce. The HUD displays "worker 58ms p95 62" for a 10 ms solve when the debounce dominates. This is correct — it's what the user actually waits — but worth calling out for readers.
- `performance.memory` is Chrome-only and non-standard. Firefox/Safari users see no heap row. That's fine; we don't fake it.

## Alternatives considered

**stats.js.** The reference library. Rejected because:
- Three numbers total (FPS, MS, MB). We need worker latency + draw calls too; adding them means modifying the library, at which point we've built our own.
- It paints to a `<canvas>` at 60 Hz. We poll at 10 Hz, DOM elements, which matches our existing HUD aesthetic.
- Cost of the dep: ~3 KB gz. Cost of our version: ~4 KB gz with 3× the data. Marginal.

**Log every frame to the logger (Phase 10.A).** Could have expanded the logger's `debug` level to include a per-frame dump. Rejected — log-buffer churn would be noisy, and the natural format is a real-time graph, not a log tail.

**`useFrame` in PerfHUD directly.** Would mean the HUD has to mount inside the Canvas. We want the HUD to be a DOM overlay — outside the WebGL tree, positioned against the viewport. So: sampler inside Canvas (for `useThree`), HUD outside, talking through the singleton.

## Validation

- `Vitest`: `src/core/perf/__tests__/PerfStats.spec.ts` — 16 tests covering ring-buffer wrap, EMA FPS settling, p95 correctness, heap degradation, reset, regression guards. All phases combined: 54/54 tests pass.
- `tsc --noEmit` clean.
- `vite build` clean — no new warnings, no chunk-size regression.
- Manual: opened the HUD, drew 50 pipes with the dev scene, confirmed FPS stayed ≥ 55, worker latency < 10 ms, draw calls scaled with pipe count.

## Future hooks (out of scope for 10.D)

- **Telemetry shipper** — subscribe to `PerfStats`, aggregate over 1 min windows, post to a metrics endpoint (opt-in). Design: a subscribe API on PerfStats, bucketing in the shipper.
- **Regression budget** — store a baseline `PerfSample` per release, flag the HUD red when FPS p95 regresses > 10%.
- **Flamegraph on demand** — `Ctrl+Shift+Alt+P` could capture the next 5 s of `performance.now()` spans around useFrame callbacks and render them as a stacked bar chart inside the HUD.
