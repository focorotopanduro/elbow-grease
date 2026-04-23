# ADR 064 — Pipe Loop Telemetry in PerfHUD (Phase 14.AC.4)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AC.4
- **Depends on:** ADR 061 (rAF coalescing), ADR 062 (segment extract
  cache), ADR 063 (graph mutation batching), Phase 10.D PerfStats
  + PerfHUD.

## Context

14.AC.1-3 shipped three hot-path optimizations on the pipe loop:

- rAF-coalesced preview events (~120 Hz → 60 Hz)
- Segment-extract cache (per-pipe identity memo)
- Graph mutation batching (N postMessages → 1)

All three have tests asserting *correctness*, but no live readout
telling a developer whether they're *paying off* on a real scene.
If someone regresses ref stability on `phaseFilter`, the cache
silently thrashes at 0% hit rate. If a refactor slips per-segment
postMessages back into the commit path, the batching test catches
it — but a subtler regression (e.g. adding a new spontaneous solve
trigger that fires outside the debounce) would go unnoticed.

A dev-visible readout closes that gap.

## Decision

Extend the existing PerfStats + PerfHUD — not a new overlay, not
a new shortcut. `Ctrl+Shift+P` already toggles the HUD. Add a
pipe-loop section that appears only when there's pipe activity on
the scene.

### 1. `PerfStats` counters

Three groups of module-level counters, each with a `record*`
function that's cheap enough to always run (integer adds only):

```ts
// Segment extract cache (monotonic)
cacheHits, cacheMisses, cacheCalls

// Graph mutation batching (most-recent only)
lastBatchOps

// rAF event coalescing (monotonic)
rafEmissionsReceived, rafInvocationsFired
```

Surfaced via a new `PerfSample.pipeLoop: PipeLoopMetrics` field.
Derived `cacheHitRate` + `rafDropRate` computed on read, not on
write.

`resetPipeLoopStats()` added as a standalone reset (for a future
"reset pipe metrics" button) plus folded into the existing
global `reset()` for test isolation.

### 2. Wiring

Three edits, each one line plus a comment:

| Call site | Recorder |
|---|---|
| `SegmentExtractCache.extract()` tail | `recordSegmentCacheStats(lastHits, lastMisses)` |
| `SimulationBridge.flushPendingMutations()` | `recordBatchMutation(totalOps)` — runs for empty-cancel too |
| `useRafEvent` listener | `recordRafEmission()` per emission |
| `useRafEvent` flush | `recordRafInvocation()` per handler call |

### 3. PerfHUD section

Adds a `PipeLoopPanel` subcomponent rendered below the existing
heap row. Three rows:

```
  CACHE   94% · 312 hits · 18 miss
  BATCH   last 24 ops
  RAF     68% · 423 / 1204 fired
```

Colour cues:
- **cache hit rate** green ≥ 80%, yellow 40-80%, red < 40% (red
  is the "it's thrashing, look at me" state).
- **rAF drop rate** green ≥ 30% (coalescer earning its keep),
  grey < 30% (no bursts happening — that's fine, nothing to save).

The panel is **hidden entirely** when every counter is zero —
which is every session's initial state and an empty scene. A
new user doesn't see zeros implying something's wrong. The panel
appears the moment the first pipe touches the cache.

`rAF` row only shows once `rafEmissionsReceived > 0` — same
logic: don't flash "0% drop rate" at a user who's never drawn a
pipe.

### 4. No new flag, no new shortcut

Piggybacks on `perfHud` because the pipe-loop metrics are a
natural extension of the FPS / worker / GPU view that HUD already
provides. Gating behind a separate flag would be extra cognitive
load for no payoff — if you want to see perf you already pressed
`Ctrl+Shift+P`.

## Trade-offs

- **Always-on recording.** Even with the HUD closed, the record
  functions run on every cache call, batch flush, and rAF event.
  The cost is 2-6 integer adds per event — well below any
  perceivable threshold. Gating behind a flag would add a branch
  per record call with no real savings.
- **Monotonic counters overflow.** Not realistically in a single
  session — 2^53 integer adds at 120 Hz would take ~2.4 million
  years — but if someone leaves a tab open forever the counters
  grow large. The HUD formats raw numbers rather than percentages
  for the totals, so a user with a 6-digit count still gets
  sensible output. Future work: periodic decay if this ever
  matters.
- **No sparkline for cache hit rate.** A trend graph would be
  nicer than a single percentage but would require a ring buffer
  + another SVG. Deferred — the percentage + raw counts are
  enough to notice a regression. If someone wants a sparkline,
  reuse the existing `frameTimeHistory` pattern.
- **No per-event drill-down.** We don't record WHICH events fed
  the rAF coalescer or WHICH pipes missed the cache. That's a
  God Mode Logs job — the HUD is for overview, not diagnosis.

## Verification

- `npx vitest run` — 1455 tests pass (1443 prior + 12 new
  PerfStats.pipeLoop).
- `npx tsc -b --noEmit` — clean.
- Manual: pressing `Ctrl+Shift+P` with a fresh scene shows the
  classic FPS + worker + GPU + heap readout with no pipe section.
  The moment the first pipe commits, the `CACHE` and `BATCH`
  rows appear. Drawing a pipe (pointer-rate bursts into the rAF
  coalescer) surfaces the `RAF` row.

## Files

- `src/core/perf/PerfStats.ts` — new `PipeLoopMetrics` interface,
  6 counters, 4 record functions, `resetPipeLoopStats()`,
  `getSample().pipeLoop` field.
- `src/ui/pipe/perf/segmentExtractCache.ts` — calls
  `recordSegmentCacheStats` in `extract()`.
- `src/engine/worker/SimulationBridge.ts` — calls
  `recordBatchMutation` in `flushPendingMutations`.
- `src/hooks/useRafEvent.ts` — calls `recordRafEmission` /
  `recordRafInvocation` in listener / flush.
- `src/ui/debug/PerfHUD.tsx` — `PipeLoopPanel` subcomponent +
  `sectionDivider` style.
- `src/core/telemetry/__tests__/SessionTelemetry.spec.ts` —
  test fixture updated to include `pipeLoop` field (required by
  the new PerfSample shape).
- `src/core/perf/__tests__/PerfStats.pipeLoop.spec.ts` — 12
  tests new.
- `docs/adr/064-pipe-loop-perf-hud.md` — this document.

## What's queued

- **14.AC.5** — similar batching pass for fixture mutations
  (`FIXTURE_PLACED` / `FIXTURE_REMOVED` still fire per-event).
- **14.AC.6** — optional "reset pipe metrics" button on the HUD
  plus a cache-hit-rate sparkline, if the single-number readout
  proves insufficient in real use.
