# ADR 046 — Incremental Fitting Cache (Phase 14.T)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.T
- **Depends on:** ADR 024 (Rendering Foundation), 14.M/N/O (Group ops
  that mutate many pipes at once).

## Context

Every call to `FittingRenderer` ran
`generateAllFittings(pipeList)` — a full O(P·M) walk over every
committed pipe in the filtered set, on every pipe-store update. For
a tiny scene (10–20 pipes) this was invisible. For a commercial job
(200–500 pipes), the cost compounded in two specific flows:

1. **Group operations.** Phase 14.M rotation, 14.N mass edit, and
   14.O translation all call `usePipeStore.setState` multiple times
   in a single commit (once per selected pipe). Each setState fires
   a re-render of FittingRenderer, each of which ran the full fitting
   pass — so rotating 50 pipes meant 50 × full-scene regens, each
   O(500·M).
2. **Bundle load + autosave recovery.** Loading a .elbow bundle
   replays all pipes into the store. Each replay triggered a full
   fitting pass. For a 300-pipe project this was a noticeable tab-
   freeze on load.

The core inefficiency: per-pipe bend generation is **pure per
pipe** — `generateBendFittings(pipe)` has zero dependencies on
other pipes. Only `generateJunctionFittings` crosses pipes, and
junctions are a comparatively small O(J) list (typically 10–30
junctions vs. 500 bends).

## Decision

Introduce a content-addressed per-pipe memo cache for the bend +
flex-warning portion of the fitting pipeline. Junctions remain
recomputed on every call (they're cheap + they actually span pipes).

### Cache shape (`src/core/pipe/fittingCache.ts`)

```ts
class FittingCache {
  getPerPipe(pipe): { bends, flexWarnings }  // cached or regen
  pruneMissing(currentIds): number            // GC absent entries
  invalidate(pipeId): boolean                 // manual pop
  collectPerPipe(pipes): FittingInstance[]    // aggregate + prune
  stats(): { hits, misses, evictions, size }
  clear(): void
}
```

**Keying:** `pipe.id` (stable across edits).
**Hash:** `material | diameter | points(fixed-6)`.

The hash deliberately excludes fields that don't affect bend geometry:

- `color` — derived from diameter, doesn't move the mesh
- `selected` — ephemeral UI state
- `visible` — rendering concern, not shape
- `system` — waste vs vent is labeling, not bend-type-affecting

This means **selecting a pipe scores a cache HIT** — no regen on
hover / click, unlike if we'd hashed the full object.

**Precision:** point coordinates snap to fixed-6 decimals before
hashing. Below-µft float drift (e.g. from bundle round-trips) maps
to the same hash key — stable across sessions.

### Wire-in (`FittingMeshes.tsx`)

`FittingRenderer`'s `useMemo` previously called:

```ts
const fittings = generateAllFittings(pipeList);
```

Now:

```ts
const cache = getFittingCache();
const perPipe = cache.collectPerPipe(pipeList);
const { mergedVertices } = mergePexRuns(pipeList);
const junctions = generateJunctionFittings(pipeList, mergedVertices);
const fittings = [...perPipe, ...junctions];
```

`collectPerPipe` handles both the hit-path and the prune
automatically — simplest possible caller contract.

### Why not cache junctions too

Junctions cross pipes. A junction at the endpoint of pipe A
depends on the endpoint of pipe B — so invalidating just pipe A's
cache entry isn't enough. We'd need a pair-or-greater invalidation
scheme, which is a lot of code for cost that's already small
(O(P²) in the worst case but small constants; empirically < 1 ms
for 500 pipes).

### Why not worker-offload

Considered moving the fitting pass to a web worker. Rejected:

- Fitting data is consumed synchronously by the render pass.
  A worker handoff adds a postMessage round-trip that's LONGER
  than the fitting pass it replaces for reasonable pipe counts.
- The memo + `collectPerPipe` already handles the typical
  worst-case (group operations) in near-zero time.

If we ever hit a 10K-pipe scene where even the cached path is
slow, the next step is worker-based + incremental diffs — not
the first step.

## Trade-offs

- **Junction recompute is still O(P·M).** For a 10K-pipe scene
  junctions become the new bottleneck. Not a problem until then.
- **Cache size grows unbounded.** A project that loads 10K pipes
  holds 10K cache entries. Each entry is small (~100 B of bend
  + flex fitting arrays per pipe), so worst case ~1 MB. Not
  worth LRU-bounding until we see it matter.
- **Stats counters are per-cache-instance.** The shared singleton
  counters reset only on `__resetFittingCache()` (test helper) or
  process restart. Fine — they're observability, not correctness.

## Performance

Perf floor (not statistics) locked by
`fittingCachePerf.spec.ts`:

- 100-pipe scene: cached pass < first pass / 2
- 500-pipe scene: cached pass < first pass / 2

In practice measured 10–40× faster on the cached pass on a quiet
M1-class machine. The spec ratio is deliberately conservative
(2×) so it doesn't flake under CI-shared-CPU noise.

Real-world impact sampled manually:

| Flow | Before | After |
|---|---|---|
| Rotate 50-pipe group (14.M) | 30–60 ms hitch | < 2 ms |
| Mass-edit 100 pipes (14.N) | ~80 ms hitch | < 3 ms |
| Load 300-pipe bundle | ~140 ms freeze | ~40 ms |

The gains come from BOTH the per-pipe memo AND from the fact that
group operations only touch a subset of pipes — cached pipes score
hits, mutated pipes miss.

## Verification

- `npx vitest run` — 1066 tests pass (1036 prior + 30 new, of which
  26 unit + 4 perf-floor).
- `npx tsc -b --noEmit` — clean.
- Manual in the desktop app:
  1. Load a 500-pipe test bundle (not shipped; internal QA).
  2. Select 50 pipes, rotate group — no visible frame hitch.
  3. Open God Mode (Ctrl+Shift+G) → Logs tab — cache hit rate
     logged via FittingCache.stats() on every render.

## Files

- `src/core/pipe/fittingCache.ts` — 168 LOC, zero deps besides
  `CommittedPipe` + `FittingGenerator` pure functions.
- `src/core/pipe/__tests__/fittingCache.spec.ts` — 26 tests.
- `src/core/pipe/__tests__/fittingCachePerf.spec.ts` — 4 floor
  specs guarding against accidental de-memoization.
- `src/ui/pipe/FittingMeshes.tsx` — `FittingRenderer` swapped to
  cache-backed pipeline. Import shuffle: `generateAllFittings`
  dropped, `generateJunctionFittings` + `mergePexRuns` +
  `getFittingCache` imported.
- `src/ui/pipe/FittingGenerator.ts` — three previously-private
  functions exported (`generateBendFittings`,
  `generateFlexibleBendWarnings`, `generateJunctionFittings`).
  Still callable directly for ExportPanel / PDF / phase-BOM paths
  that want freshness over speed.
