# ADR 065 — Pipe Loop Guardrail Tests (Phase 14.AC.5)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AC.5
- **Depends on:** ADR 061 (rAF coalescing), ADR 062 (segment extract
  cache), ADR 063 (graph mutation batching), ADR 064 (PerfHUD
  telemetry).

## Context

14.AC.1–3 shipped three correctness-tested optimizations and
14.AC.4 made the results observable in the PerfHUD. What was
missing: a failing-test signal when the *efficiency* silently
regresses.

Concrete failure modes none of the shipped tests catch:

- **Ref-stability regression on `usePhaseFilter`**: the hook uses
  `useMemo` today. If someone inlines its dependencies or switches
  to `useRef` wrong, every render would produce a fresh
  `phaseFilter` object. The `SegmentExtractCache` would clear its
  entire slot table on every extract. Existing tests all pass
  because correctness is unchanged — just slower.
- **New SimulationBridge code path sidesteps the batch**: a
  future feature (fixture graph nodes, ad-hoc graph inspection)
  could add its own `this.postToWorker(SIM_MSG.ADD_NODE, …)` call
  and nobody would notice. The 14.AC.3 bridge test checks one
  specific burst pattern; it doesn't assert the absence of
  per-segment traffic across arbitrary paths.
- **`useEvent` creeps back into a hot subscriber**: a developer
  fixing an unrelated bug in `InterferenceVisualizer` could
  accidentally change `useRafEvent` back to `useEvent` (they look
  almost identical). Responsiveness would degrade under drag but
  unit tests would still pass.

An ADR that says "the cache has ≥95% hit rate on realistic edit
workloads" is non-enforceable. An expect(hitRate).toBeGreaterThanOrEqual(0.95)
in a spec file is.

## Decision

One new file: `src/__tests__/perf/pipeLoopGuardrails.spec.ts`.
13 tests. Three sections, one per shipped phase.

### 14.AC.2 section — SegmentExtractCache hit rate

Five scenarios, each asserting exact hit / miss counts:

| Scenario | Assertion |
|---|---|
| Add 1 pipe to 100-pipe scene | 100 hits, 1 miss |
| Edit 1 pipe of 100 | 99 hits, 1 miss |
| Edit 5 pipes of 100 | 95 hits, 5 misses |
| Steady state, 10 re-extracts | 0 misses |
| Same-value ctx with new ref | full invalidation confirmed |

The last case is the REAL guardrail: if someone "accidentally"
adds spread/memoization in a way that produces a new ctx ref per
render, this test catches it because it asserts the INVERSE —
"only ref change forces invalidation." Combined with the other
four, we nail down the cache's behavior across the realistic
trigger space.

### 14.AC.3 section — SimulationBridge batching

Five scenarios, each using `vi.useFakeTimers` to flush the
debounce and simBus subscriptions to count messages by type:

| Scenario | Assertion |
|---|---|
| 20 pipes committed in one burst | 1 BATCH_MUTATE, 1 SOLVE_REQUEST |
| 5 pipe commits | 0 ADD_NODE / ADD_EDGE / REMOVE_* |
| Commit + remove mixed in one burst | 1 BATCH, 0 per-segment |
| Two bursts across debounces | 2 BATCH, 2 SOLVE |
| 100-pipe paste | 1 BATCH, under 500 ms wall time |

The "0 individual ADD_* messages" assertion is the sharp-edged
guardrail. Any future code path that sends `SIM_MSG.ADD_NODE`
individually during the commit path trips this test.

### 14.AC.1 section — useRafEvent coalescing

Three scenarios exercising the React hook under fake rAF timers:

| Scenario | Assertion |
|---|---|
| 10 emissions in one frame | exactly 1 handler call |
| 60 emissions across 10 frames | at most 10 handler calls |
| Realistic drag pattern (60/10) | PerfStats rafDropRate ≥ 0.83 |

The SLO-style assertion in the third test is the interesting
one: it goes through PerfStats (which 14.AC.4 wired), so it
verifies both the coalescer AND the telemetry path. If either
breaks, this test fails with a specific number that points at
the right subsystem.

## Trade-offs

- **Counts are exact, not thresholds.** I chose `toBe(100)` over
  `toBeGreaterThanOrEqual(95)` so the failure message is diagnostic
  — "expected 100, got 87" immediately points at specific missing
  hits rather than "hit rate degraded." Exact counts are brittle
  if the underlying logic changes, but 14.AC.1–3's behavior is
  well-defined enough that changing these counts should only
  happen if someone is intentionally changing the invariant.
- **Wall-clock assertion on the 100-pipe paste is loose (500 ms).**
  We can't make a cross-machine perf promise in CI. 500 ms is a
  ceiling against catastrophic regression (e.g. O(n²) work creeping
  back in), not a tight SLO.
- **No visual regression test for the PerfHUD panel.** Out of
  scope; this phase guards behavior, not pixels.
- **No guardrail for 14.AC.4's PerfStats recorders.** Those
  already have their own spec (`PerfStats.pipeLoop.spec.ts`).
  Rebuilding the same assertions here would be redundant.

## Verification

- `npx vitest run src/__tests__/perf/pipeLoopGuardrails.spec.ts`
  — 13 tests pass, runs in ≈50 ms.
- Full suite: 1468 pass (1455 prior + 13 new).
- `npx tsc -b --noEmit` — clean.

## Files

- `src/__tests__/perf/pipeLoopGuardrails.spec.ts` — 13 tests new.
- `docs/adr/065-pipe-loop-guardrails.md` — this document.

No production code touched.

## What's queued

- **14.AC.6** — actually wire fixtures into the worker graph. My
  original ADR 063 queue entry called this "batching fixture
  mutations" but a survey revealed fixtures don't currently flow
  to the worker AT ALL. The solver never sees fixture DFU /
  WSFU as graph nodes. Fixing that is correctness work, not
  performance work — it belongs in its own phase with careful
  review of solver output before and after.
- **14.AC.7** — cache-hit-rate sparkline in PerfHUD (from the
  14.AC.4 backlog).
