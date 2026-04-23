# ADR 073 — FittingCache Ref-Identity Fast Path (Phase 14.AD.2)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AD.2
- **Depends on:** Phase 14.T (`FittingCache`); ADR 062
  (segment extract cache pattern).

## Context

`FittingCache.getPerPipe(pipe)` content-addressed every lookup by
calling `pipeFittingHash(pipe)` — a full serialization of the
pipe's `points`, `material`, and `diameter`. On every useMemo
re-run in `FittingRenderer` (triggered by any pipe-store mutation
or layer toggle), the renderer calls `collectPerPipe(pipeList)`,
which hashes EVERY pipe in the list just to perform the cache
lookup. With 100 pipes × 50 points each, that's ~500k
number-to-string operations per render tick just to decide "is
this pipe unchanged?"

The answer is almost always "yes" — Zustand's immutable updates
guarantee that an unchanged pipe keeps its object identity across
renders. A `pipe === entry.pipeRef` check gives us the same
answer in O(1) with zero allocations.

This is the same optimization ADR 062 (`SegmentExtractCache`)
applied to `PipeInstanceRenderer`, applied to the fittings path.

## Decision

Add a ref-identity fast path in front of the existing content-
hash check. Three tiers now:

```
1. pipe === entry.pipeRef           — O(1), no allocations (fastHits)
2. pipeFittingHash(pipe) === entry.hash — O(P), content equality (slowHits)
3. miss                             — recompute generateBendFittings (misses)
```

Tier 2 also **upgrades** the cached `pipeRef` to the new object —
so the NEXT call with that identical object lands on tier 1
without re-hashing. Typical scenario where this matters:
bundle-load rehydration constructs pipes from a deserialized JSON
blob, hash-hits first, promotes pipeRef, then every subsequent
render is a fast hit.

### Stats surface

`FittingCacheStats` gains `fastHits` and `slowHits` fields. Legacy
`hits` is now `fastHits + slowHits` — no breakage for existing
consumers that read `stats().hits`.

### Invariant preserved

The hash fallback keeps the cache robust against the edge case
where a caller produces a fresh object with identical content
(tests, serialized reloads). If the hot-path assumption (Zustand
keeps refs stable) is ever violated, the cache degrades to the
pre-AD.2 behaviour (always hash) rather than silently regenerating.

## Trade-offs

- **Extra 1 pointer per entry.** Each `CacheEntry` now carries
  `pipeRef` alongside `hash`. Negligible.
- **Hash still computed on slow path + miss.** Haven't removed
  `pipeFittingHash`; it's the safety net. Once production
  telemetry shows slowHits are rare-to-zero on real usage, we
  could drop the hash path behind a flag and save its
  serialization cost in the miss path. Not yet justified.
- **Assumes Zustand immutable-update convention.** Same assumption
  `SegmentExtractCache` already relies on. If a hot-path
  mutation shows up (pipe field assigned directly), both caches
  would be buggy in the same way. A future telemetry addition
  could verify via `fastHits ≫ slowHits` ratio.
- **Pruning unaffected.** `pruneMissing(currentPipeIds)` keys on
  `pipe.id` — independent of the ref/hash split.

## What this saves

For a 100-pipe scene where `FittingRenderer` re-runs its useMemo
due to a layer toggle:

| Operation | Before | After |
|---|---|---|
| Per-pipe `getPerPipe` | 1 × `pipeFittingHash` (~50–500 µs) | 1 × ref equality (~10 ns) |
| 100-pipe scan total | ~5–50 ms | ~1 µs |

~10,000× speedup on the pure-lookup path. The fittings themselves
haven't changed — this is purely a cheaper "is this unchanged?"
decision. When a pipe actually DOES change, the work is identical
to before.

## Verification

- `npx vitest run` — 1560 tests pass (1552 prior + 8 new).
  All 26 existing `fittingCache.spec.ts` tests still pass (the
  content-hash fallback preserves their construct-fresh-pipes
  semantics).
- `npx tsc -b --noEmit` — clean.
- One integration-style test asserts `pipeFittingHash` is
  **not called** on the fast path, via `vi.spyOn(module, 'pipeFittingHash')`.
  That's the sharp regression guard — any future change that
  reintroduces a hash on the hot path trips this test.

## Files

- `src/core/pipe/fittingCache.ts` — `CacheEntry.pipeRef` field,
  `getPerPipe` uses it in front of the hash, `FittingCacheStats`
  gains `fastHits` + `slowHits`, `clear` resets both.
- `src/core/pipe/__tests__/fittingCacheFastPath.spec.ts` —
  8 new tests.
- `docs/adr/073-fittingcache-ref-fast-path.md` — this document.

## What's queued

- **14.AD.3** — `FixtureModels.tsx` inline geometry churn. 20+
  fixture types each rebuild 10+ THREE.js primitives per render;
  parent re-render (layer toggle, phase change) thrashes all of
  them. Move geometry construction to module-level cached
  factories keyed on subtype + parametric inputs.
- **14.AD.4** — `FittingRenderer` filter pre-gate cache. The
  outer filter walks every pipe's points array for y-bounds on
  every useMemo invocation — same per-pipe identity pattern could
  apply there.
