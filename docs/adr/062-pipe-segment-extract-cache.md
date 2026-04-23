# ADR 062 — Pipe Segment-Extract Cache (Phase 14.AC.2)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AC.2
- **Depends on:** ADR 061 (pipe game-loop coalescing), ADR 024
  (rendering foundation).

## Context

`PipeInstanceRenderer` is the workhorse that turns committed pipes
into InstancedMesh batches. Its `useMemo` is keyed on
`[pipes, systemVisibility, getFloorParams, phaseFilter]`, which
means any one of those changing runs `extractSegments` — a full
walk over every pipe, bucketing by
`(diameter, material, ghost-state)` and allocating two
`THREE.Vector3` per segment.

Worst case today:

- O(N pipes × M segments) per invocation.
- No per-pipe memoization: even if only ONE pipe was added or
  edited, all N pipes are re-walked and their Vector3 pairs
  re-allocated.

Real triggers that walk everything:

| Trigger | Frequency |
|---|---|
| A single pipe committed | Common — every route completion |
| Pipe mutated (solver-sized, selection, color) | Common |
| Layer toggle (visibility system) | Rare but user-initiated |
| Active-floor change | Rare |
| Phase filter change | Rare |

The common cases are the cheap ones we were overpaying for: a solo
add/edit shouldn't force a 100× re-walk for 100 pipes.

## Decision

Introduce a per-pipe cache inside `PipeInstanceRenderer` that
reuses prior work when the pipe's object identity is unchanged.

### Mechanism

1. **`buildPipeEntry(pipe, ctx) → PipeEntry | null`** — pure
   function that runs all gates (visible, selected, system,
   phase, floor) and, if a pipe passes, builds its bucket key and
   segment list. Returns `null` for gated-out pipes.

2. **`SegmentExtractCache`** — stateful wrapper with a
   `Map<pipeId, { pipeRef, entry }>`. Extract pass:

   - If any external context ref (`systemVisibility`,
     `getFloorParams`, `phaseFilter`) changed → clear everything
     and rebuild. Safe because any of those can flip any pipe's
     gate or bucket.
   - Otherwise for each incoming pipe:
     - If `slot.pipeRef === pipe` → hit, reuse cached entry.
     - Else → rebuild that one pipe's entry, update the slot.
   - Evict slots for pipes no longer present.
   - Assemble bucket map from slots with non-null entries.

3. **Ref stability matters.** Zustand immutable updates mean any
   field change on a pipe produces a new object. That's the signal
   we key off. `usePhaseFilter` already memoizes itself.
   `useFloorParams` returns a module-level function (stable).
   `useLayerStore((s) => s.systems)` returns the stable `systems`
   record until a toggle. So in the common single-pipe-mutation
   case only `pipes` changes — the cache keeps N−1 entries, does
   1 miss.

### Per-trigger cost after this change

| Trigger | Prior | Now |
|---|---|---|
| Add 1 pipe to 100 | O(101) walk | 1 miss, 100 hits |
| Edit 1 pipe of 100 | O(100) walk | 1 miss, 99 hits |
| Remove 1 pipe of 100 | O(99) walk | 0 misses, 99 hits, 1 eviction |
| Layer toggle, 100 pipes | O(100) walk | full 100 misses (same as prior) |
| Floor change, 100 pipes | O(100) walk | full 100 misses (same as prior) |

Best case: ~100× speedup on single-pipe mutations. Worst case:
identical to prior.

### Instrumentation

`cache.lastHits`, `cache.lastMisses`, `cache.lastEvictions` are
set on every `extract()` call. Useful for a future perf overlay
and for the 21 unit tests that assert the counter values.

### Gated-out pipes

Invisible / selected / phase-hidden pipes cache a `null` entry
rather than being skipped entirely. This means a pipe whose ref
is unchanged across calls still registers a cache hit when it's
invisible — no re-gate on repeat reads.

## Trade-offs

- **Context refs must be stable in the common case.** If some
  future caller constructed a fresh `phaseFilter` object on every
  render, we'd invalidate every time. The current
  `usePhaseFilter()` already memoizes; a regression there would
  need to be caught by a test, which we don't yet have. Left as
  a follow-up if we see a regression.
- **Cache lives per component instance.** `PipeInstanceRenderer`
  is currently mounted once in the scene. If it were remounted
  (e.g. under a future tab-switch), the cache would be discarded
  and rebuilt — acceptable because remount is also rare.
- **Module-level cache rejected.** Tempting, but keeps us
  component-scoped so test suites don't leak state across runs.
- **No refcount invariants on Vector3 objects.** Segments retain
  their `THREE.Vector3` instances between calls — the
  `InstancedBucket`'s `useEffect` reads them into the instance
  matrix and doesn't mutate. Safe as long as that invariant holds;
  added a code comment in `segmentExtractCache.ts`.

## Verification

- `npx vitest run` — 1410 tests pass (1389 prior + 21 new:
  11 SegmentExtractCache + 6 gating + 4 realism).
- `npx tsc -b --noEmit` — clean.
- `extractSegments` is deleted from `PipeInstanceRenderer.tsx`;
  the cache-backed path is the only one. Renderer output
  structure (bucket map → `InstancedBucket` children) is
  unchanged — no visual behaviour change is expected, only
  allocation reduction.

## Files

- `src/ui/pipe/perf/segmentExtractCache.ts` — 180 LOC new.
- `src/ui/pipe/perf/__tests__/segmentExtractCache.spec.ts` —
  21 tests new.
- `src/ui/pipe/perf/PipeInstanceRenderer.tsx` — removed inline
  `extractSegments` + `pipeYBoundsLocal`; inlined filter pulled
  into `buildPipeEntry`; `SegmentExtractCache` held in a
  `useRef`; unused imports stripped.
- `docs/adr/062-pipe-segment-extract-cache.md` — this document.

## What's queued

- **14.AC.3** — Worker-side batch solve: the 50 ms
  `SimulationBridge` debounce batches calls by time, not by
  count. Multi-pipe paste + riser templates emit 3-20
  `PIPE_COMPLETE`s in a burst; they should coalesce into a single
  `SOLVE_REQUEST` instead of N serialized round-trips.
- **14.AC.4** — Optional perf overlay surfacing `cache.lastHits /
  lastMisses / lastEvictions` + rAF-coalescer queue depth. Dev
  build only.
